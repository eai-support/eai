import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMockServer } from '../helpers/mock-server.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { resourcesCommand } from '../../src/commands/resources.js';
import { clearTokens, storeTokens } from '../../src/lib/auth.js';

const API_BASE = 'https://test-api.example.com';
const PROD_AUTH_TENANT_NAME = 'enterpriseaiplatform';
const PROD_AUTH_TENANT_ID = 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26';
const PROD_AUTH_CLIENT_ID = 'd704bde5-fe36-44ff-9a26-221d53772dd0';

async function setupProject(dir: string): Promise<void> {
  await mkdir(join(dir, 'src', 'eai.config'), { recursive: true });
  await writeFile(join(dir, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
  await writeFile(
    join(dir, '.env.local'),
    `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-app\n`,
  );
}

async function storeTestTokens(dir: string): Promise<void> {
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
    activeTenantId: 'test-tenant-id',
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
      'Semantic resource search is not ready for this tenant.',
    );
    expect(output).toContain('eai resources storage doctor --format json');
    expect(output).toContain('eai resources search "<query>" --fulltext');
    expect(output).not.toContain(API_BASE);
  });

  test('explains the exact v4 envelope when resource create returns 422', async () => {
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
    expect(output).toContain('Create requires POST with {"data": {...}}');
    expect(output).toContain('Update requires PUT with {"data": {...}, "version": n}');
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
