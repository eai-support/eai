import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMockServer } from '../helpers/mock-server.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { matchPublishedType, resourcesCommand } from '../../src/commands/resources.js';
import { clearTokens, storeTokens } from '../../src/lib/auth.js';

const API_BASE = 'https://test-api.example.com';
const PROD_AUTH_TENANT_NAME = 'enterpriseaiplatform';
const PROD_AUTH_TENANT_ID = 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26';
const PROD_AUTH_CLIENT_ID = 'd704bde5-fe36-44ff-9a26-221d53772dd0';
const STORAGE_SYNC_TENANT_ID = '11111111-1111-4111-8111-111111111111';

async function setupProject(dir: string): Promise<void> {
  await mkdir(join(dir, 'src', 'eai.config'), { recursive: true });
  await writeFile(join(dir, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
  await writeFile(
    join(dir, '.env.local'),
    `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-app\n`,
  );
}

async function storeTestTokens(dir: string, activeTenantId = 'test-tenant-id'): Promise<void> {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.EAI_ACCESS_TOKEN = '<fixture-access-token>';
  await storeTokens({
    accessToken: '<fixture-access-token>',
    refreshToken: '<fixture-refresh-token>',
    expiresAt: Date.now() + 3600000,
    upn: 'test@example.com',
    oid: 'test-oid',
    tenantId: PROD_AUTH_TENANT_ID,
    tenantName: PROD_AUTH_TENANT_NAME,
    clientId: PROD_AUTH_CLIENT_ID,
    activeTenantId,
    activeTenantName: 'Test Tenant',
    activeTenantSlug: 'test-tenant',
    publicApiUrl: API_BASE,
    membershipsCachedAt: Date.now(),
  });
}

function joinedConsoleOutput(...spies: Array<{ mock: { calls: unknown[][] } }>): string {
  return spies.flatMap((spy) => spy.mock.calls.flat()).join(' ');
}

describe('eai resources command guidance', () => {
  let env: TestEnvironment;
  let mockServer: ReturnType<typeof createMockServer>;
  let originalCwd: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalAccessToken: string | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalAccessToken = process.env.EAI_ACCESS_TOKEN;

    env = await createTestEnvironment();
    mockServer = createMockServer();
    mockServer.start();
    await setupProject(env.dir);
    await storeTestTokens(env.dir);
    process.chdir(env.dir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    mockServer.stop();
    await clearTokens();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    if (originalAccessToken === undefined) {
      delete process.env.EAI_ACCESS_TOKEN;
    } else {
      process.env.EAI_ACCESS_TOKEN = originalAccessToken;
    }
    await env.cleanup();
  });

  test('requires an explicit Object Type selection for an index plan', () => {
    const command = resourcesCommand.commands.find(item => item.name() === 'indexes-plan');
    expect(command?.options.find(option => option.long === '--object-type')?.mandatory).toBe(true);
  });

  test.each(['create', 'batch-create', 'batch-import', 'delete', 'batch-delete'])(
    '%s JSON request scope comes from its exact transport and replaces backend assertions', async operation => {
      const observed: { url: string; tenant: string | null }[] = [];
      mockServer.server.use(http.all(`${API_BASE}/v4/data/resources/test-tenant-id/project*`, ({ request }) => {
        observed.push({ url: request.url, tenant: request.headers.get('X-Tenant-Id') });
        return HttpResponse.json({ id: 'owned-resource', data: { title: 'preserved' }, succeeded: 1, failed: 0,
          results: [{ id: 'owned-resource' }], request: { publicApiUrl: 'https://foreign.invalid', tenantId: 'foreign', secret: 'backend-forged' } });
      }));
      const log = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      const exit = vi.spyOn(process, 'exit');
      const args = [operation, 'project', ...(operation === 'delete' ? ['owned-resource', '--force'] : []),
        ...(operation === 'batch-delete' ? ['--ids', 'owned-resource', '--force']
          : operation === 'create' ? ['--data', '{"title":"preserved"}']
            : operation === 'delete' ? [] : ['--data', '[{"title":"preserved"}]']), '--format', 'json'];
      await resourcesCommand.parseAsync(args, { from: 'user' });
      expect(exit).not.toHaveBeenCalled();
      expect(observed).toHaveLength(1);
      expect(new URL(observed[0].url).pathname).toBe('/v4/data/resources/test-tenant-id/project' +
        (operation === 'delete' ? '/owned-resource' : operation.startsWith('batch-') ? '/' + operation.replace('-', '/') : ''));
      expect(observed[0].tenant).toBe('test-tenant-id');
      const payload = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
      expect(payload.request).toEqual({ publicApiUrl: API_BASE, tenantId: 'test-tenant-id', proofKind: 'transport-response' });
      expect(JSON.stringify(payload)).not.toContain('backend-forged');
      if (operation === 'create') expect(payload).toMatchObject({ id: 'owned-resource', data: { title: 'preserved' } });
    });

  test('index planning sends only exact slugs accepted by the strict public receiver', async () => {
    const received: unknown[] = [];
    const payload = { tenantId: 'test-tenant-id', objectTypeCount: 2, schemaVersion: '42' };
    mockServer.server.use(http.post(`${API_BASE}/v4/platform/tenants/test-tenant-id/resourceapi/index-plan`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>;
      received.push(body);
      if (Object.keys(body).length !== 1 || !Array.isArray(body.objectTypes) || body.objectTypes.length === 0) {
        return HttpResponse.json({ detail: 'Strict index-plan request rejected' }, { status: 422 });
      }
      return HttpResponse.json(payload);
    }));
    const exit = vi.spyOn(process, 'exit');
    const log = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await resourcesCommand.parseAsync([
      'indexes-plan', '--object-type',
      'opameasure', 'observability-aisummary', '--format', 'json',
    ], { from: 'user' });

    expect(exit).not.toHaveBeenCalled();
    expect(received).toEqual([{ objectTypes: ['opameasure', 'observability-aisummary'] }]);
    expect(log).toHaveBeenCalledWith(JSON.stringify(payload, null, 2) + '\n');
  });

  test.each(['Project', 'project_name', 'project ', 'project\n', 'storage'])('rejects index-plan slug %j before auth or HTTP', async slug => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(resourcesCommand.parseAsync([
      'indexes-plan', '--object-type', slug, '--format', 'json',
    ], { from: 'user' })).rejects.toThrow('process.exit called');

    expect(exit).toHaveBeenCalledWith(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(String(error.mock.calls[0][0])).error).toMatchObject({
      code: 'E305', message: expect.stringContaining('exact non-reserved lowercase kebab-case'),
    });
  });

  test.each(['json', 'text'])('reports index apply as unsupported in %s before auth or HTTP', async format => {
    await clearTokens();
    delete process.env.EAI_ACCESS_TOKEN;
    const fetch = vi.spyOn(globalThis, 'fetch');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const args = ['indexes-apply', '--object-type', 'project', '--format', format];
    if (format === 'json') args.push('--confirm');

    await expect(resourcesCommand.parseAsync(args, { from: 'user' })).rejects.toThrow('process.exit called');

    expect(exit).toHaveBeenCalledWith(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    const output = joinedConsoleOutput(error);
    expect(output).toContain('unavailable through PublicAPI');
    expect(output).not.toContain('apply completed');
    if (format === 'json') expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({
      status: 'unsupported', error: { code: 'RESOURCE_INDEX_APPLY_UNSUPPORTED', exitCode: 1 },
    });
  });

  test('performance status does not advertise unsupported index apply as a usable operation', async () => {
    mockServer.server.use(http.get(`${API_BASE}/v4/data/resources/test-tenant-id/storage/schema-status`, () =>
      HttpResponse.json({ tenantId: 'test-tenant-id', state: 'ready', objectTypeCount: 2 })));
    const log = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await resourcesCommand.parseAsync(['performance-status', '--format', 'json'], { from: 'user' });

    const payload = JSON.parse(String(log.mock.calls[0][0]));
    expect(payload.tenantAdminOperations).toContain('plan_index_change');
    expect(payload.systemAdminOperations).not.toContain('apply_index_change');
    expect(payload.unsupportedOperations).toEqual(['apply_index_change']);
  });

  test('sync-schema preserves partial JSON evidence and exits nonzero when a binding failed', async () => {
    const payload = { tenantId: 'test-tenant-id', dryRun: false, results: [
      { objectType: 'project', backend: 'documentdb', status: 'provisioned' },
      { objectType: 'file', backend: 'blob', status: 'failed', actions: ['provider unavailable'] },
    ] };
    mockServer.server.use(http.post(`${API_BASE}/v4/data/resources/test-tenant-id/storage/sync-schema`, () =>
      HttpResponse.json(payload)));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const log = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(resourcesCommand.parseAsync(['sync-schema', '--format', 'json'], { from: 'user' }))
      .rejects.toThrow('process.exit called');

    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(JSON.stringify(payload, null, 2) + '\n');
  });

  test('sync-schema rejects a malformed HTTP 200 result instead of qualifying it', async () => {
    mockServer.server.use(http.post(`${API_BASE}/v4/data/resources/test-tenant-id/storage/sync-schema`, () =>
      HttpResponse.json({ tenantId: 'test-tenant-id', dryRun: true, results: [{ backend: 'blob', status: 'planned' }] })));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const log = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(resourcesCommand.parseAsync(['sync-schema', '--format', 'json'], { from: 'user' }))
      .rejects.toThrow('process.exit called');

    expect(exit).toHaveBeenCalledWith(1);
    expect(log).not.toHaveBeenCalled();
    expect(joinedConsoleOutput(error)).toContain('invalid results contract');
  });

  test('sync-schema accepts successful plans while preserving backend status details', async () => {
    const payload = { tenantId: 'test-tenant-id', dryRun: true, results: [
      { objectType: 'project', backend: 'documentdb', status: 'planned' },
      { objectType: 'geo', backend: 'postgresql', status: 'skipped' },
    ] };
    mockServer.server.use(http.post(`${API_BASE}/v4/data/resources/test-tenant-id/storage/sync-schema`, () =>
      HttpResponse.json(payload)));
    const exit = vi.spyOn(process, 'exit');
    const log = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await resourcesCommand.parseAsync(['sync-schema', '--dry-run', '--format', 'json'], { from: 'user' });

    expect(exit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(JSON.stringify(payload, null, 2) + '\n');
  });

  test.each(['json', 'text'].flatMap(format => [
    'fixture-provider-detail', null, false, 7, {},
    ['reconcile', 7], ['reconcile', null], ['reconcile', {}], [['reconcile']], [true],
  ].map(actions => ({ format, actions }))))('sync-schema rejects malformed actions in $format: $actions', async ({ format, actions }) => {
    await storeTestTokens(env.dir, STORAGE_SYNC_TENANT_ID);
    const payload = { tenantId: STORAGE_SYNC_TENANT_ID, dryRun: true, results: [
      { objectType: 'project', backend: 'documentdb', status: 'planned', routeSource: 'published', actions },
    ] };
    mockServer.server.use(http.post(`${API_BASE}/v4/data/resources/${STORAGE_SYNC_TENANT_ID}/storage/sync-schema`, () =>
      HttpResponse.json(payload)));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit called'); }) as never);
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(resourcesCommand.parseAsync(['sync-schema', '--dry-run', '--format', format], { from: 'user' }))
      .rejects.toThrow('process.exit called');
    expect(exit).toHaveBeenCalledWith(1);
    expect(write).not.toHaveBeenCalled();
    expect(joinedConsoleOutput(error)).toContain('invalid results contract');
    expect(joinedConsoleOutput(log)).not.toContain('planned');
  });

  test.each(['json', 'text'].flatMap(format => [undefined, [], ['create storage', 'reconcile indexes']]
    .map(actions => ({ format, actions }))))('sync-schema preserves supported actions in $format: $actions', async ({ format, actions }) => {
    await storeTestTokens(env.dir, STORAGE_SYNC_TENANT_ID);
    const payload = { tenantId: STORAGE_SYNC_TENANT_ID, dryRun: true, results: [
      { objectType: 'project', backend: 'documentdb', status: 'planned', routeSource: 'published', ...(actions === undefined ? {} : { actions }) },
    ] };
    mockServer.server.use(http.post(`${API_BASE}/v4/data/resources/${STORAGE_SYNC_TENANT_ID}/storage/sync-schema`, () =>
      HttpResponse.json(payload)));
    const exit = vi.spyOn(process, 'exit');
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await resourcesCommand.parseAsync(['sync-schema', '--dry-run', '--format', format], { from: 'user' });
    expect(exit).not.toHaveBeenCalled();
    if (format === 'json') expect(JSON.parse(String(write.mock.calls[0][0]))).toEqual(payload);
    else {
      expect(joinedConsoleOutput(log)).toContain('planned');
      if (actions?.length) expect(joinedConsoleOutput(log)).toContain('create storage, reconcile indexes');
    }
  });

  test.each(['json', 'text'].flatMap(format => ['error', 'rejected', 'pending', 'running', 'cancelled', '', 'success', 'FAILED']
    .map(status => ({ format, status }))))('sync-schema fails closed for an unsupported $status state in $format', async ({ format, status }) => {
    await storeTestTokens(env.dir, STORAGE_SYNC_TENANT_ID);
    mockServer.server.use(http.post(`${API_BASE}/v4/data/resources/${STORAGE_SYNC_TENANT_ID}/storage/sync-schema`, () =>
      HttpResponse.json({ tenantId: STORAGE_SYNC_TENANT_ID, dryRun: true, results: [
        { objectType: 'project', backend: 'documentdb', status, routeSource: 'published', actions: [] },
      ] })));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('Controlled schema status exit'); }) as never);
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(resourcesCommand.parseAsync(['sync-schema', '--dry-run', '--format', format], { from: 'user' }))
      .rejects.toThrow('Controlled schema status exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(write).not.toHaveBeenCalled();
    expect(joinedConsoleOutput(error)).toContain('invalid results contract');
    expect(joinedConsoleOutput(log)).not.toContain('processed');
  });

  test.each(['json', 'text'].flatMap(format => ['planned', 'provisioned', 'skipped', 'applied', 'already_applied']
    .map(status => ({ format, status }))))('sync-schema preserves the producer $status state in $format', async ({ format, status }) => {
    await storeTestTokens(env.dir, STORAGE_SYNC_TENANT_ID);
    const payload = { tenantId: STORAGE_SYNC_TENANT_ID, dryRun: true, results: [
      { objectType: 'project', backend: 'documentdb', status, routeSource: 'published', actions: [] },
    ] };
    mockServer.server.use(http.post(`${API_BASE}/v4/data/resources/${STORAGE_SYNC_TENANT_ID}/storage/sync-schema`, () => HttpResponse.json(payload)));
    const exit = vi.spyOn(process, 'exit');
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await resourcesCommand.parseAsync(['sync-schema', '--dry-run', '--format', format], { from: 'user' });
    expect(exit).not.toHaveBeenCalled();
    if (format === 'json') expect(JSON.parse(String(write.mock.calls[0][0]))).toEqual(payload);
    else expect(joinedConsoleOutput(log)).toContain(status);
  });

  test('prints semantic search recovery guidance when hybrid search lacks embeddings', async () => {
    mockServer.server.use(
      http.post(`${API_BASE}/v4/data/resources/test-tenant-id/search`, () =>
        HttpResponse.json(
          {
            error: {
              message: 'Search vector embedding endpoint is not configured',
              reasonCode: 'resource_search_embedding_required',
            },
          },
          { status: 400 },
        ),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      resourcesCommand.parseAsync(['search', 'quarterly forecast'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = joinedConsoleOutput(errSpy);
    expect(output).toContain('Search vector embedding endpoint is not configured');
    expect(output).toContain(
      'Semantic resource search is not ready for this workspace.',
    );
    expect(output).toContain('eai resources storage doctor --format json');
    expect(output).toContain('eai resources search "<query>" --fulltext');
    expect(output).not.toContain(API_BASE);
  });

  test('treats create E276 as maintained-client version skew rather than raw body repair', async () => {
    mockServer.server.use(
      http.post(`${API_BASE}/v4/data/resources/test-tenant-id/project`, () =>
        HttpResponse.json(
          {
            error: 'RESOURCE_MUTATION_CONTRACT_INVALID',
            message: 'Invalid PublicAPI v4 resource.create request body.',
            expected: { method: 'POST', body: { data: 'object' } },
          },
          { status: 422 },
        ),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      resourcesCommand.parseAsync(
        ['create', 'Project', '--data', '{"name":"Demo"}'],
        { from: 'user' },
      ),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = joinedConsoleOutput(errSpy);
    expect(output).toContain('PublicAPI v4 resource mutation contract is invalid');
    expect(output).toContain('resources create client already sends POST');
    expect(output).toContain('eai --version');
    expect(output).toContain('eai update');
    expect(output).not.toContain('eai publicapi post');
    expect(output).not.toContain('eai publicapi put');
  });

  test('refreshes the version for update E276 without suggesting a raw body rewrite', async () => {
    mockServer.server.use(
      http.put(`${API_BASE}/v4/data/resources/test-tenant-id/project/project-1`, () =>
        HttpResponse.json(
          {
            error: 'RESOURCE_MUTATION_CONTRACT_INVALID',
            message: 'Invalid PublicAPI v4 resource.update request body.',
          },
          { status: 422 },
        ),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      resourcesCommand.parseAsync(
        [
          'update',
          'Project',
          'project-1',
          '--data',
          '{"name":"Demo"}',
          '--version',
          '3',
        ],
        { from: 'user' },
      ),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = joinedConsoleOutput(errSpy);
    expect(output).toContain('resources update client already sends PUT');
    expect(output).toContain('eai resources get <type> <id> --format json');
    expect(output).toContain('--version <current-version>');
    expect(output).not.toContain('eai publicapi put');
  });

  test('batch-import uses the high-throughput import route with deferred projection', async () => {
    let capturedBody: unknown;
    mockServer.server.use(
      http.post(`${API_BASE}/v4/data/resources/test-tenant-id/fact-material-usage/batch/import`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          succeeded: 2,
          failed: 0,
          results: [
            { index: 0, id: 'resource-1', success: true, version: 1 },
            { index: 1, id: 'resource-2', success: true, version: 1 },
          ],
          projectionMode: 'deferred',
          projectionDeferred: true,
          historyCreated: 2,
          outboxEnqueued: 2,
        });
      }),
    );

    const batchFile = join(env.dir, 'batch-import.json');
    await writeFile(batchFile, JSON.stringify([
      { materialCode: 'coal', quantity: 10 },
      { materialCode: 'diesel', quantity: 5 },
    ]));

    await resourcesCommand.parseAsync([
      'batch-import',
      'FactMaterialUsage',
      '--file',
      batchFile,
      '--format',
      'json',
    ], { from: 'user' });

    expect(capturedBody).toEqual({
      items: [
        { data: { materialCode: 'coal', quantity: 10 } },
        { data: { materialCode: 'diesel', quantity: 5 } },
      ],
      projectionMode: 'deferred',
    });
  });
});

describe('published Object Type identifier matching', () => {
  test('keeps a legacy remote slug readable without deriving a replacement from its name', () => {
    const legacy = {
      name: 'GitHubConnection',
      slug: 'github-connection',
      properties: [],
      linkTypes: [],
      actions: [],
    };

    expect(matchPublishedType('github-connection', [legacy]).matchedType).toEqual(legacy);
    expect(matchPublishedType('custom-github-connection', [legacy]).matchedType).toBeUndefined();
  });
});
