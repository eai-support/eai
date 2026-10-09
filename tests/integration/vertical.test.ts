import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import { cleanupTestTokens, workingDirectoryIs } from '../helpers/setup-dsl.js';
import { clearTokens, storeTokens } from '../../src/lib/auth.js';
import {
  DEFAULT_PROD_AUTH_CLIENT_ID,
  DEFAULT_PROD_AUTH_TENANT_ID,
  DEFAULT_PROD_AUTH_TENANT_NAME,
  setActiveProfile,
} from '../../src/lib/profile.js';
import {
  appCommand,
  buildSourceUnknownDeploymentData,
  buildSourceUnknownRegistrationData,
  buildSourceUnknownWorkflowEvidenceData,
  buildSourceUnknownWorkflowSetupData,
  isCompleteAppDeletionEnvironmentSet,
  validateNonInteractiveAppDeleteConfirmation,
  verticalCommand,
} from '../../src/commands/vertical.js';

const API_BASE = 'https://test-api.au.myenterprise.ai/public';
const COMPANY_TENANT_ID = 'company-tenant';
const PLATFORM_PARENT_ID = 'eai-developers';

function workflowEvidenceFixture(): Record<string, unknown> {
  return {
    operationId: 'source-unknown-op', nonce: 'nonce-token', environment: 'preview',
    workflowPath: '.github/workflows/eai-app.yml', workflowBlobSha: 'f'.repeat(40),
    collectorDigest: `sha256:${'9'.repeat(64)}`, ref: 'refs/heads/main', commitSha: 'a'.repeat(40),
    configHash: `sha256:${'e'.repeat(64)}`, artifactDigest: `sha256:${'a'.repeat(64)}`,
    imageArtifact: { id: '987654321', name: 'eai-generated-app-image', archiveDigest: `sha256:${'f'.repeat(64)}` },
    imageDigest: `sha256:${'b'.repeat(64)}`,
    schemaProvenance: {
      templateVersion: 'eai.generated_app_config.v1', baseTemplateSha: '483c609cd974fa732c8ccb5ce37855911f881d76',
      schemaDigest: `sha256:${'c'.repeat(64)}`, validatorDigest: `sha256:${'d'.repeat(64)}`,
    },
    workflowRun: { id: '123456789', attempt: '1' }, validationSummary: { status: 'passed' },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(init?: Parameters<typeof fetch>[1]): string {
  return String(init?.method || 'GET').toUpperCase();
}

async function seedLoggedInTenant(): Promise<void> {
  await storeTokens({
    accessToken: '<fixture-access-token>',
    refreshToken: '<fixture-refresh-token>',
    expiresAt: Date.now() + 3600000,
    tenantId: DEFAULT_PROD_AUTH_TENANT_ID,
    tenantName: DEFAULT_PROD_AUTH_TENANT_NAME,
    clientId: DEFAULT_PROD_AUTH_CLIENT_ID,
    oid: 'test-user-oid',
    upn: 'builder@example.com',
    activeTenantId: COMPANY_TENANT_ID,
    activeTenantName: 'Builder Workspace',
    activeTenantSlug: 'builder-workspace',
    publicApiUrl: API_BASE,
    membershipsCachedAt: Date.now(),
  });
}

async function seedProjectRoot(dir: string): Promise<void> {
  await mkdir(join(dir, 'src', 'eai.config'), { recursive: true });
  await writeFile(join(dir, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
  await writeFile(join(dir, '.env.local'), `BASE_URL_PUBLIC_API=${API_BASE}\n`);
}

describe('eai app', () => {
  let env: TestEnvironment;
  let ctx: TestContext;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalBaseUrl: string | undefined;
  let originalAccessToken: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalBaseUrl = process.env.BASE_URL_PUBLIC_API;
    originalAccessToken = process.env.EAI_ACCESS_TOKEN;
    setActiveProfile('default');
    env = await createTestEnvironment();
    ctx = {
      workingDir: env.dir,
      mockAPI: undefined as never,
      env: {},
      prompts: [],
    };
    workingDirectoryIs(ctx, env.dir);
    process.env.HOME = env.dir;
    process.env.USERPROFILE = env.dir;
    process.env.BASE_URL_PUBLIC_API = API_BASE;
    process.env.EAI_ACCESS_TOKEN = '<fixture-access-token>';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await cleanupTestTokens(ctx);
    await clearTokens();
    setActiveProfile('default');
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
    if (originalBaseUrl === undefined) {
      delete process.env.BASE_URL_PUBLIC_API;
    } else {
      process.env.BASE_URL_PUBLIC_API = originalBaseUrl;
    }
    if (originalAccessToken === undefined) {
      delete process.env.EAI_ACCESS_TOKEN;
    } else {
      process.env.EAI_ACCESS_TOKEN = originalAccessToken;
    }
    await env.cleanup();
  });

  function inventoryFetch(payload: unknown, status = 200): void {
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url.includes('/tenant-vertical-enrollment')) return new Response(JSON.stringify(payload), {
        status, headers: { 'Content-Type': 'application/json', 'x-request-id': 'd681b292-2bfd-4c50-a8ce-392f642b1816' },
      });
      if (url === `${API_BASE}/v4/identity/tenants`) return jsonResponse({ tenants: [{ id: COMPANY_TENANT_ID,
        displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'] }] });
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}`) return jsonResponse({ id: COMPANY_TENANT_ID,
        displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'], homeRegion: 'au' });
      return jsonResponse({ message: 'Unhandled controlled fixture' }, 500);
    }));
  }

  const emptyInventory = { docs: [], totalDocs: 0, totalPages: 1, limit: 50, page: 1, pagingCounter: 1,
    hasPrevPage: false, hasNextPage: false, prevPage: null, nextPage: null };

  test.each([0, 1])('app list accepts an authoritative empty page with totalPages=%i', async totalPages => {
    await seedLoggedInTenant(); inventoryFetch({ ...emptyInventory, totalPages });
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await appCommand.parseAsync(['list', '--tenant-id', COMPANY_TENANT_ID, '--format', 'json'], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(args => String(args[0])).join(''))).toEqual({ tenantId: COMPANY_TENANT_ID, apps: [] });
  });

  test.each([{}, { message: 'PRIVATE-response' }, { docs: [] }, { ...emptyInventory, totalDocs: 1 },
    { ...emptyInventory, hasNextPage: 'false' }, { ...emptyInventory, docs: [{ id: 'app', data: null }] }])
    ('app list rejects malformed HTTP 200 inventory %j', async payload => {
      await seedLoggedInTenant(); inventoryFetch(payload);
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('Controlled inventory exit'); }) as never);
      const errors = vi.spyOn(console, 'error');
      await expect(appCommand.parseAsync(['list', '--tenant-id', COMPANY_TENANT_ID, '--format', 'json'], { from: 'user' })).rejects.toThrow('Controlled inventory exit');
      expect(exit).toHaveBeenCalledWith(1);
      expect(errors.mock.calls.flat().join(' ')).toContain('invalid response');
      expect(errors.mock.calls.flat().join(' ')).not.toContain('PRIVATE-response');
    });

  test('app list retains published failure identifiers and never echoes upstream content', async () => {
    await seedLoggedInTenant(); inventoryFetch({ detail: { code: 'RESOURCEAPI_UNAVAILABLE',
      message: 'PRIVATE-SECRET /internal/path InternalService', supportReference: '9285486c-d8fd-44d9-98ed-c59511c0db38' } }, 503);
    vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('Controlled inventory exit'); }) as never);
    const errors = vi.spyOn(console, 'error');
    await expect(appCommand.parseAsync(['list', '--tenant-id', COMPANY_TENANT_ID, '--format', 'json'], { from: 'user' })).rejects.toThrow('Controlled inventory exit');
    const output = errors.mock.calls.flat().join(' ');
    expect(output).toContain('HTTP 503'); expect(output).toContain('RESOURCEAPI_UNAVAILABLE');
    expect(output).toContain('9285486c-d8fd-44d9-98ed-c59511c0db38'); expect(output).toContain('d681b292-2bfd-4c50-a8ce-392f642b1816');
    expect(output).not.toContain('PRIVATE-SECRET'); expect(output).not.toContain('/internal/path'); expect(output).not.toContain('InternalService');
  });

  test('HP001 creates an app from outside an EAI project using the selected builder workspace tenant', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}` && method === 'GET') {
        return jsonResponse({
          id: COMPANY_TENANT_ID,
          displayName: 'Builder Workspace',
          slug: 'builder-workspace',
          isActive: true,
          roles: ['tenant-admin'],
          homeRegion: 'au',
        });
      }

      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps` && method === 'POST') {
        return jsonResponse({ app: { id: 'app-1', verticalKey: 'planning-portal' } }, 201);
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'create',
      'PlanningPortal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--key',
      'planning-portal',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          appDisplayName: 'PlanningPortal',
          verticalKey: 'planning-portal',
          source: 'eai-cli',
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining(`/v4/platform/tenants/${PLATFORM_PARENT_ID}/apps`),
      expect.anything(),
    );
  });

  test('deletes an app through the V4 ownership plan and emits a verified JSON receipt', async () => {
    await seedLoggedInTenant();
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const manifestHash = 'a'.repeat(64);
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }
      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/post-pilot/deletion-plan` &&
        method === 'GET'
      ) {
        return jsonResponse({
          tenantId: COMPANY_TENANT_ID,
          appKey: 'post-pilot',
          confirmationRequired: 'post-pilot',
          ownershipManifestHash: manifestHash,
          environments: ['preview', 'dev', 'test', 'prod'],
          warning: 'This cannot be undone. All application data and metadata will be deleted.',
        });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/post-pilot` && method === 'DELETE') {
        return jsonResponse({
          schemaVersion: 'eai.app-deletion-receipt.v1',
          operationId: 'appdel-operation-1',
          planHash: manifestHash,
          tenantId: COMPANY_TENANT_ID,
          appKey: 'post-pilot',
          ownershipManifestHash: manifestHash,
          status: 'deleted',
          verified: true,
          deleted: { resourceAPI: { resources: 3 } },
          retained: { sharedObjectTypes: ['shared-user'] },
          steps: { resourceAPI: 'verified' },
        });
      }
      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'delete',
      'post-pilot',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--confirm',
      'post-pilot',
      '--non-interactive',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/post-pilot`,
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({
          confirmationAppKey: 'post-pilot',
          ownershipManifestHash: manifestHash,
          environments: ['preview', 'dev', 'test', 'prod'],
        }),
      }),
    );
    const emitted = outputSpy.mock.calls.map(call => String(call[0])).join('');
    expect(JSON.parse(emitted)).toMatchObject({
      tenantId: COMPANY_TENANT_ID,
      appKey: 'post-pilot',
      status: 'deleted',
      verified: true,
    });
  });

  test.each([
    ['current-parent-child', 'success', 1],
    ['plan-missing-targets', 'plan', 0],
    ['plan-duplicate-targets', 'plan', 0],
    ['plan-missing-parent', 'plan', 0],
    ['plan-unknown-contract', 'plan', 0],
    ['receipt-foreign-target', 'receipt', 1],
    ['receipt-missing-target', 'receipt', 1],
    ['receipt-duplicate-target', 'receipt', 1],
    ['receipt-reordered-targets', 'receipt', 1],
    ['legacy-unexpected-targets', 'receipt', 1],
  ])('binds deletion to original scoped plan without another request: %s', async (scenario, phase, expectedDeletes) => {
    await seedLoggedInTenant();
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
    const hash = 'a'.repeat(64);
    const targets = ['child-tenant', COMPANY_TENANT_ID];
    const plan: Record<string, unknown> = {
      tenantId: COMPANY_TENANT_ID, appKey: 'post-pilot', confirmationRequired: 'post-pilot',
      ownershipManifestHash: hash, environments: ['preview', 'dev', 'test', 'prod'],
      cleanupContract: 'eai.app-scoped-cleanup.v2', runtimeTenantIds: targets,
    };
    const receipt: Record<string, unknown> = {
      schemaVersion: 'eai.app-deletion-receipt.v1', operationId: 'appdel-operation-1',
      planHash: hash, ownershipManifestHash: hash, tenantId: COMPANY_TENANT_ID,
      appKey: 'post-pilot', status: 'deleted', verified: true, runtimeTenantIds: [...targets],
    };
    if (scenario === 'plan-missing-targets') delete plan.runtimeTenantIds;
    if (scenario === 'plan-duplicate-targets') plan.runtimeTenantIds = [...targets, COMPANY_TENANT_ID];
    if (scenario === 'plan-missing-parent') plan.runtimeTenantIds = ['child-tenant'];
    if (scenario === 'plan-unknown-contract') plan.cleanupContract = 'unknown-contract';
    if (scenario === 'receipt-foreign-target') receipt.runtimeTenantIds = ['foreign-child', COMPANY_TENANT_ID];
    if (scenario === 'receipt-missing-target') receipt.runtimeTenantIds = [COMPANY_TENANT_ID];
    if (scenario === 'receipt-duplicate-target') receipt.runtimeTenantIds = [...targets, COMPANY_TENANT_ID];
    if (scenario === 'receipt-reordered-targets') receipt.runtimeTenantIds = [...targets].reverse();
    if (scenario === 'legacy-unexpected-targets') { delete plan.runtimeTenantIds; delete plan.cleanupContract; }
    let identities = 0; let contexts = 0; let plans = 0; let deletes = 0;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input); const method = requestMethod(init);
      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        identities += 1;
        return jsonResponse({ tenants: [{ id: COMPANY_TENANT_ID, displayName: 'Builder Workspace',
          slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'] }] });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/management` && method === 'GET') {
        contexts += 1; return jsonResponse({ id: COMPANY_TENANT_ID, displayName: 'Builder Workspace', region: 'au' });
      }
      if (url.endsWith('/apps/post-pilot/deletion-plan') && method === 'GET') {
        plans += 1; return jsonResponse(plan);
      }
      if (url.endsWith('/apps/post-pilot') && method === 'DELETE') {
        deletes += 1; return jsonResponse(receipt);
      }
      throw new Error(`unexpected provider request: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const invocation = appCommand.parseAsync(['delete', 'post-pilot', '--tenant-id', COMPANY_TENANT_ID,
      '--confirm', 'post-pilot', '--non-interactive', '--format', 'json'], { from: 'user' });
    if (phase === 'success') {
      await invocation;
      expect(JSON.parse(outputSpy.mock.calls.map(call => String(call[0])).join(''))).toMatchObject({ runtimeTenantIds: targets });
    } else {
      await expect(invocation).rejects.toThrow('fixture-process-exit');
      expect(outputSpy).not.toHaveBeenCalled();
      expect(errorSpy.mock.calls.map(call => String(call[0])).join('')).toContain(
        phase === 'plan' ? 'invalid app deletion ownership plan' : 'verified app deletion receipt',
      );
    }
    expect({ identities, contexts, plans, deletes }).toEqual({ identities: 1, contexts: 1, plans: 1, deletes: expectedDeletes });
    expect(fetchMock).toHaveBeenCalledTimes(3 + expectedDeletes);
    exitSpy.mockRestore();
  });

  test('requires an exact app-key confirmation for non-interactive deletion', () => {
    expect(() => validateNonInteractiveAppDeleteConfirmation('post-pilot', 'PostPilot')).toThrow(
      'Non-interactive deletion requires --confirm post-pilot.',
    );
  });

  test('requires every app deletion environment exactly once', () => {
    expect(isCompleteAppDeletionEnvironmentSet(['preview', 'dev', 'test', 'prod'])).toBe(true);
    expect(isCompleteAppDeletionEnvironmentSet(['preview', 'dev', 'test'])).toBe(false);
    expect(isCompleteAppDeletionEnvironmentSet(['preview', 'dev', 'test', 'test'])).toBe(false);
    expect(isCompleteAppDeletionEnvironmentSet(['preview', 'dev', 'test', 'prod', 'other'])).toBe(false);
  });

  test('reports user-delegated app authorization without creating credentials or mutating state', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    await writeFile(join(env.dir, '.env.local'), [
      `BASE_URL_PUBLIC_API=${API_BASE}`,
      'ENTRA_CLIENT_ID=1c1927cb-646c-45c6-9ec8-7f2473f4679e',
    ].join('\n'));
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}` && method === 'GET') {
        return jsonResponse({
          id: COMPANY_TENANT_ID,
          displayName: 'Builder Workspace',
          slug: 'builder-workspace',
          isActive: true,
          roles: ['tenant-admin'],
          homeRegion: 'au',
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-boardapp',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'boardapp-og',
              displayName: 'BoardApp',
            },
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/authorized-apps`
        && method === 'GET'
      ) {
        return jsonResponse({
          authorizedApps: [{ appId: '1c1927cb-646c-45c6-9ec8-7f2473f4679e' }],
          authorizedAppsCount: 1,
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'auth',
      'status',
      'boardapp-og',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--client-id',
      '1c1927cb-646c-45c6-9ec8-7f2473f4679e',
      '--format',
      'json',
    ], { from: 'user' });

    const output = outputSpy.mock.calls.flat().join('');
    const result = JSON.parse(output) as {
      readOnly: boolean;
      tenantAuthorizedApps: { status: string };
      runtimeAuth: { mode: string; userDelegated: string; appOnlyIdentity: string };
    };
    expect(result).toMatchObject({
      readOnly: true,
      tenantAuthorizedApps: { status: 'authorized' },
      runtimeAuth: {
        mode: 'user-delegated',
        userDelegated: 'authorized',
        appOnlyIdentity: 'not-required',
      },
    });
    expect(fetchMock.mock.calls.every(([, init]) => requestMethod(init) === 'GET')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/authorized-apps`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('does not attribute an unrelated local runtime contract to the requested app client', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    await writeFile(join(env.dir, '.env.local'), [
      `BASE_URL_PUBLIC_API=${API_BASE}`,
      'ENTRA_CLIENT_ID=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'EAI_APP_KEY=another-app',
    ].join('\n'));
    await writeFile(join(env.dir, 'eai.runtime.json'), JSON.stringify({
      schemaVersion: 1,
      serviceIdentity: { required: true },
    }));
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}` && method === 'GET') {
        return jsonResponse({
          id: COMPANY_TENANT_ID,
          displayName: 'Builder Workspace',
          slug: 'builder-workspace',
          isActive: true,
          roles: ['tenant-admin'],
          homeRegion: 'au',
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-boardapp',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'boardapp-og',
              displayName: 'BoardApp',
            },
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/authorized-apps`
        && method === 'GET'
      ) {
        return jsonResponse({
          authorizedApps: [{ appId: '1c1927cb-646c-45c6-9ec8-7f2473f4679e' }],
          authorizedAppsCount: 1,
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'auth',
      'status',
      'boardapp-og',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--client-id',
      '1c1927cb-646c-45c6-9ec8-7f2473f4679e',
      '--format',
      'json',
    ], { from: 'user' });

    const output = outputSpy.mock.calls.flat().join('');
    const result = JSON.parse(output) as {
      entraRegistration: { status: string };
      tenantAuthorizedApps: { status: string };
      runtimeAuth: { mode: string; userDelegated: string; appOnlyIdentity: string; evidence: string };
    };
    expect(result).toMatchObject({
      entraRegistration: { status: 'not-observable' },
      tenantAuthorizedApps: { status: 'authorized' },
      runtimeAuth: {
        mode: 'not-observable',
        userDelegated: 'not-observable',
        appOnlyIdentity: 'not-observable',
      },
    });
    expect(result.runtimeAuth.evidence).toContain('do not match the requested app');
    expect(fetchMock.mock.calls.every(([, init]) => requestMethod(init) === 'GET')).toBe(true);
  });

  test('HP003 writes canonical and legacy app env keys when selecting an app', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);

    await appCommand.parseAsync([
      'select',
      'planning-portal',
      '--skip-validate',
      '--format',
      'json',
    ], { from: 'user' });

    const envFile = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(envFile).toContain('EAI_APP_KEY=planning-portal');
    expect(envFile).toContain('EAI_VERTICAL_KEY=planning-portal');
  });

  test('HP004 provisions app resources through the v4 app provisioning job', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
              displayName: 'Planning Portal',
            },
            version: 1,
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs`
        && method === 'POST'
      ) {
        return jsonResponse({
          tenantId: COMPANY_TENANT_ID,
          appKey: 'planning-portal',
          verticalKey: 'planning-portal',
          jobId: 'app-prov-123',
          status: 'ready',
          steps: [{
            key: 'identity',
            label: 'App identity',
            status: 'skipped',
            message: 'Skipped until an app URL or deployment config exists.',
          }],
          enrollment: {
            metadata: {
              appProvisioning: {
                storageBindingAllowList: {
                  postgresql: { aliases: ['tenant-postgres'] },
                  documentdb: { aliases: ['tenant-documentdb'] },
                  blob: { aliases: ['tenant-blob'] },
                  search: { aliases: ['tenant-search'] },
                },
              },
            },
          },
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'provision',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--select',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining(`/v4/data/resources/${COMPANY_TENANT_ID}/storage/provision`),
      expect.anything(),
    );
    const envFile = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(envFile).toContain('EAI_APP_KEY=planning-portal');
    expect(envFile).toContain('EAI_VERTICAL_KEY=planning-portal');
    expect(envFile).toContain(`EAI_TENANT_ID=${COMPANY_TENANT_ID}`);
    expect(envFile).toContain('EAI_STORAGE_TABLE_PREFIX=ompanytenant_planning_portal_');

    const storageContract = JSON.parse(
      await readFile(join(env.dir, '.eai', 'storage-bindings.json'), 'utf-8'),
    );
    expect(storageContract).toMatchObject({
      schemaVersion: 1,
      generatedBy: 'eai app provision',
      tenantId: COMPANY_TENANT_ID,
      appKey: 'planning-portal',
      aliases: {
        postgresql: ['tenant-postgres'],
      },
      storageNamePrefixes: {
        sql: 'ompanytenant_planning_portal_',
        blob: 'ompanytenant-planning-portal-',
      },
      source: {
        provisioningJobId: 'app-prov-123',
      },
    });
    const cliResult = JSON.parse(outputSpy.mock.calls.flat().join('')) as {
      provisioning: { steps: Array<{ key: string; message: string }> };
    };
    expect(cliResult.provisioning.steps.find((step) => step.key === 'identity')?.message).toBe(
      'Not applicable: this generic app uses user-delegated PublicAPI access.',
    );
  });

  test.each([false, true])('provision preserves the enrolled child runtime (dry-run=%s)', async (dryRun) => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const childId = 'runtime-child-tenant';
    const envPath = join(env.dir, '.env.local');
    await writeFile(envPath, `BASE_URL_PUBLIC_API=${API_BASE}\nEAI_PARENT_TENANT_ID=${COMPANY_TENANT_ID}\nEAI_TENANT_ID=${childId}\nEAI_APP_KEY=planning-portal\n`);
    const originalEnv = await readFile(envPath, 'utf-8');
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      if (url === `${API_BASE}/v4/identity/tenants`) return jsonResponse({ tenants: [{ id: COMPANY_TENANT_ID, roles: ['tenant-admin'] }] });
      if (url.includes(`/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)) {
        return jsonResponse({ docs: [{ id: 'app-1', data: { tenantId: COMPANY_TENANT_ID, verticalKey: 'planning-portal', childTenantId: childId } }] });
      }
      if (dryRun && url === `${API_BASE}/v4/data/resources/${childId}/storage/provision`) {
        expect(requestMethod(init)).toBe('POST');
        expect(new Headers(init?.headers).get('X-Tenant-Id')).toBe(childId);
        expect(JSON.parse(String(init?.body))).toMatchObject({ dry_run: true });
        return jsonResponse({ tenantId: childId, dryRun: true, results: [] });
      }
      if (!dryRun && url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs`) {
        expect(new Headers(init?.headers).get('X-Tenant-Id')).toBe(COMPANY_TENANT_ID);
        expect(JSON.parse(String(init?.body))).toEqual({ targetTenantId: childId });
        return jsonResponse({ tenantId: COMPANY_TENANT_ID, appKey: 'planning-portal', jobId: 'child-job', status: 'ready', enrollment: { childTenantId: childId } });
      }
      return jsonResponse({ message: `Unexpected request: ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
    await appCommand.parseAsync(['provision', 'planning-portal', '--tenant-id', COMPANY_TENANT_ID, '--select', '--format', 'json', ...(dryRun ? ['--dry-run'] : [])], { from: 'user' });
    const savedEnv = await readFile(envPath, 'utf-8');
    expect(savedEnv).toContain(`EAI_TENANT_ID=${childId}`);
    if (dryRun) expect(savedEnv).toBe(originalEnv);
    else {
      expect(savedEnv).toContain(`NEXT_PUBLIC_EAI_TENANT_ID=${childId}`);
      const contract = JSON.parse(await readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8'));
      expect(contract.tenantId).toBe(childId);
    }
    expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).includes(`/v4/data/resources/${COMPANY_TENANT_ID}/storage/provision`))).toBe(false);
  });

  function mockProvisioningJob(
    responseForRead: (read: number) => Record<string, unknown>,
    initialOverrides: Record<string, unknown> = {},
  ): ReturnType<typeof vi.fn> {
    let reads = 0;
    return vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);
      if (url === `${API_BASE}/v4/identity/tenants`) return jsonResponse({ tenants: [{ id: COMPANY_TENANT_ID, roles: ['tenant-admin'] }] });
      if (url.includes(`/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)) {
        return jsonResponse({ docs: [{ id: 'app-1', data: { tenantId: COMPANY_TENANT_ID, verticalKey: 'planning-portal', childTenantId: 'runtime-child' } }] });
      }
      const jobsUrl = `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs`;
      if (url === jobsUrl && method === 'POST') {
        expect(new Headers(init?.headers).get('X-Tenant-Id')).toBe(COMPANY_TENANT_ID);
        expect(JSON.parse(String(init?.body))).toEqual({ targetTenantId: 'runtime-child' });
        return jsonResponse({ ...appJobFixture('running'), ...initialOverrides }, 202);
      }
      if (url === `${jobsUrl}/app-prov-async?targetTenantId=runtime-child` && method === 'GET') {
        expect(new Headers(init?.headers).get('X-Tenant-Id')).toBe(COMPANY_TENANT_ID);
        expect(init?.body).toBeUndefined();
        return jsonResponse(responseForRead(++reads));
      }
      return jsonResponse({ message: `Unexpected request: ${method} ${url}` }, 500);
    });
  }

  function appJobFixture(status: string): Record<string, unknown> {
    return { tenantId: COMPANY_TENANT_ID, appKey: 'planning-portal', verticalKey: 'planning-portal',
      jobId: 'app-prov-async', status, steps: [{ key: 'storage', status }],
      enrollment: { tenantId: COMPANY_TENANT_ID, verticalKey: 'planning-portal', childTenantId: 'runtime-child',
        provisioningState: status, readiness: { status, ready: status === 'ready' } } };
  }

  const provisionArgs = ['provision', 'planning-portal', '--tenant-id', COMPANY_TENANT_ID, '--select', '--format', 'json'];

  test('provision polls only its exact asynchronous job and writes runtime files after ready readback', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const envPath = join(env.dir, '.env.local');
    const originalEnv = await readFile(envPath, 'utf-8');
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let readCount = 0;
    const fetchMock = mockProvisioningJob(read => { readCount = read; return appJobFixture(read === 1 ? 'running' : 'ready'); });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const execution = appCommand.parseAsync(provisionArgs, { from: 'user' });
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => requestMethod(init) === 'POST')).toBe(true));
    expect(await readFile(envPath, 'utf-8')).toBe(originalEnv);
    await expect(readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(readCount).toBe(1);
    expect(await readFile(envPath, 'utf-8')).toBe(originalEnv);
    await expect(readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    await vi.advanceTimersByTimeAsync(2_000);
    await execution;
    expect(readCount).toBe(2);
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'POST')).toHaveLength(1);
    expect(await readFile(envPath, 'utf-8')).toContain('EAI_TENANT_ID=runtime-child');
    const savedContract = JSON.parse(await readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8'));
    expect(savedContract).toMatchObject({ tenantId: 'runtime-child', source: { provisioningJobId: 'app-prov-async' } });
    const output = JSON.parse(outputSpy.mock.calls.flat().join(''));
    expect(output).toMatchObject({ tenantId: COMPANY_TENANT_ID, targetTenantId: 'runtime-child', provisioning: { status: 'ready', jobId: 'app-prov-async' } });
  });

  test.each(['failed', 'interrupted'])('provision exits nonzero for %s readback and preserves existing local configuration', async status => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const envPath = join(env.dir, '.env.local');
    const originalEnv = await readFile(envPath, 'utf-8');
    const contractPath = join(env.dir, '.eai/storage-bindings.json');
    await mkdir(join(env.dir, '.eai'), { recursive: true });
    await writeFile(contractPath, 'existing-local-contract\n');
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-exit'); });
    const fetchMock = mockProvisioningJob(() => ({ ...appJobFixture(status), retryable: status === 'interrupted',
      steps: [{ key: 'storage', status: 'failed', message: 'Private provider detail must not be exposed' }] }));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const rejected = expect(appCommand.parseAsync(provisionArgs, { from: 'user' })).rejects.toThrow('fixture-exit');
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => requestMethod(init) === 'POST')).toBe(true));
    await vi.advanceTimersByTimeAsync(2_000);
    await rejected;
    expect(exit).toHaveBeenCalledWith(1);
    expect(await readFile(envPath, 'utf-8')).toBe(originalEnv);
    expect(await readFile(contractPath, 'utf-8')).toBe('existing-local-contract\n');
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'POST')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([input]) => requestUrl(input).includes('/app-prov-async?'))).toHaveLength(1);
    const errorOutput = vi.mocked(console.error).mock.calls.flat().join('');
    expect(errorOutput).toContain(`is ${status} (failed steps: storage)`);
    expect(errorOutput).not.toContain('Private provider detail');
  });

  test('provision allows a healthy backend job to become ready after more than 300 seconds', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const envPath = join(env.dir, '.env.local');
    const originalEnv = await readFile(envPath, 'utf-8');
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-exit'); });
    vi.useFakeTimers();
    const readyAt = Date.now() + 600_000;
    const fetchMock = mockProvisioningJob(() => appJobFixture(Date.now() >= readyAt ? 'ready' : 'running'));
    vi.stubGlobal('fetch', fetchMock);
    const completion = appCommand.parseAsync(provisionArgs, { from: 'user' }).then(() => undefined, error => error);
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => requestMethod(init) === 'POST')).toBe(true));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await readFile(envPath, 'utf-8')).toBe(originalEnv);
    await expect(readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    await vi.advanceTimersByTimeAsync(302_000);
    expect(await completion).toBeUndefined();
    expect(JSON.parse(outputSpy.mock.calls.flat().join('')).provisioning.status).toBe('ready');
    expect(await readFile(envPath, 'utf-8')).toContain('EAI_TENANT_ID=runtime-child');
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'POST')).toHaveLength(1);
  });

  test.each([
    { jobId: 'different-job' }, { tenantId: 'different-company' }, { appKey: 'different-app' },
    { verticalKey: 'different-app' }, { enrollment: { childTenantId: 'different-runtime' } },
    { enrollment: {} },
  ])('provision rejects changed poll authority %j before writing local files', async mismatch => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const originalEnv = await readFile(join(env.dir, '.env.local'), 'utf-8');
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-exit'); });
    const fetchMock = mockProvisioningJob(() => ({ ...appJobFixture('ready'), ...mismatch }));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const rejected = expect(appCommand.parseAsync(provisionArgs, { from: 'user' })).rejects.toThrow('fixture-exit');
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => requestMethod(init) === 'POST')).toBe(true));
    await vi.advanceTimersByTimeAsync(2_000);
    await rejected;
    expect(exit).toHaveBeenCalledWith(1);
    expect(await readFile(join(env.dir, '.env.local'), 'utf-8')).toBe(originalEnv);
    await expect(readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'POST')).toHaveLength(1);
  });

  test('provision rejects an acknowledgement without explicit readiness or a pollable status', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const originalEnv = await readFile(join(env.dir, '.env.local'), 'utf-8');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-exit'); });
    const fetchMock = mockProvisioningJob(() => appJobFixture('ready'), { status: undefined });
    vi.stubGlobal('fetch', fetchMock);
    await expect(appCommand.parseAsync(provisionArgs, { from: 'user' })).rejects.toThrow('fixture-exit');
    expect(await readFile(join(env.dir, '.env.local'), 'utf-8')).toBe(originalEnv);
    await expect(readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).includes('/app-prov-async?'))).toBe(false);
  });

  test('provision stops after its bounded fake-clock deadline without changing local configuration or restarting the job', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const originalEnv = await readFile(join(env.dir, '.env.local'), 'utf-8');
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-exit'); });
    const fetchMock = mockProvisioningJob(() => appJobFixture('running'));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const rejected = expect(appCommand.parseAsync(provisionArgs, { from: 'user' })).rejects.toThrow('fixture-exit');
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => requestMethod(init) === 'POST')).toBe(true));
    const started = Date.now();
    await vi.advanceTimersByTimeAsync(900_000);
    await rejected;
    expect(Date.now() - started).toBe(900_000);
    expect(exit).toHaveBeenCalledWith(1);
    const errorOutput = vi.mocked(console.error).mock.calls.flat().join('');
    expect(errorOutput).toContain('Timed out after 900 seconds waiting for app provisioning job app-prov-async');
    expect(errorOutput).toContain('Remote provisioning may still be running.');
    expect(await readFile(join(env.dir, '.env.local'), 'utf-8')).toBe(originalEnv);
    await expect(readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'POST')).toHaveLength(1);
    const reads = fetchMock.mock.calls.filter(([input]) => requestUrl(input).includes('/app-prov-async?'));
    expect(reads.length).toBeGreaterThan(1);
    expect(reads.length).toBeLessThanOrEqual(450);
  });

  test('provision rejects a changed server runtime before overwriting local binding', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const envPath = join(env.dir, '.env.local');
    const originalEnv = await readFile(envPath, 'utf-8');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-exit'); });
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url === `${API_BASE}/v4/identity/tenants`) return jsonResponse({ tenants: [{ id: COMPANY_TENANT_ID, roles: ['tenant-admin'] }] });
      if (url.includes('/tenant-vertical-enrollment')) return jsonResponse({ docs: [{ data: { verticalKey: 'planning-portal', childTenantId: 'expected-runtime' } }] });
      return jsonResponse({ tenantId: COMPANY_TENANT_ID, enrollment: { childTenantId: 'unexpected-runtime' } });
    }));
    await expect(appCommand.parseAsync(['provision', 'planning-portal', '--tenant-id', COMPANY_TENANT_ID, '--select'], { from: 'user' })).rejects.toThrow('fixture-exit');
    expect(await readFile(envPath, 'utf-8')).toBe(originalEnv);
    await expect(readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('HP005 plans app storage readiness without running the provisioning job during dry-run', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
              displayName: 'Planning Portal',
            },
            version: 1,
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/storage/provision`
        && method === 'POST'
      ) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          backend: 'all',
          dry_run: true,
          rebuild_search: false,
        });
        return jsonResponse({
          tenantId: COMPANY_TENANT_ID,
          dryRun: true,
          results: [
            { objectType: 'vertical-product-config', backend: 'documentdb', status: 'planned' },
          ],
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'provision',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--dry-run',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/storage/provision`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/provisioning-jobs'),
      expect.anything(),
    );
  });

  test('HP004 registers an existing app repo as source-unknown under the company tenant', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
              displayName: 'Planning Portal',
            },
            version: 1,
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/register`
        && method === 'POST'
      ) {
        return jsonResponse({ status: 'registered', sourceMetadata: { sourceMode: 'source-unknown' } });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'connect-existing',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--repo',
      'enterpriseaigroup/planning-portal',
      '--commit',
      'abcdef1234567890',
      '--template-version',
      'eai.generated_app_config.v1',
      '--base-template-sha',
      '483c609cd974fa732c8ccb5ce37855911f881d76',
      '--schema-digest',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--validator-digest',
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/register`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          repoOwner: 'enterpriseaigroup',
          repoName: 'planning-portal',
          repoUrl: 'https://github.com/enterpriseaigroup/planning-portal',
          defaultBranch: 'main',
          workflowPath: '.github/workflows/eai-app.yml',
          ref: 'refs/heads/main',
          commitSha: 'abcdef1234567890',
          configPath: 'src/eai.config/index.ts',
          runtimePath: 'eai.runtime.json',
          sourceMode: 'source-unknown',
          schemaProvenance: {
            templateVersion: 'eai.generated_app_config.v1',
            baseTemplateSha: '483c609cd974fa732c8ccb5ce37855911f881d76',
            schemaDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            validatorDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          validationSummary: {
            status: 'registered_by_cli',
            appValidated: true,
          },
        }),
      }),
    );
  });

  test('HP005 adopts an already-running app as observed-only source-unknown state', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
            },
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/register`
        && method === 'POST'
      ) {
        return jsonResponse({
          status: 'registered',
          sourceMetadata: {
            sourceMode: 'source-unknown',
            adoptionMode: 'adopted-observed',
          },
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'adopt-observed',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--repo',
      'enterpriseaigroup/planning-portal',
      '--url',
      'https://planning.example.com',
      '--environment',
      'production',
      '--commit',
      'abcdef1234567890',
      '--deployment-id',
      'aca-revision-42',
      '--image-digest',
      'sha256:1234567890abcdef',
      '--config-hash',
      'sha256:feedface',
      '--observed-at',
      '2026-07-02T00:00:00.000Z',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/register`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          repoOwner: 'enterpriseaigroup',
          repoName: 'planning-portal',
          repoUrl: 'https://github.com/enterpriseaigroup/planning-portal',
          defaultBranch: 'main',
          workflowPath: '.github/workflows/eai-app.yml',
          ref: 'refs/heads/main',
          commitSha: 'abcdef1234567890',
          configPath: 'src/eai.config/index.ts',
          runtimePath: 'eai.runtime.json',
          sourceMode: 'source-unknown',
          validationSummary: {
            status: 'adopted_observed_by_cli',
            appValidated: true,
            destructiveOperationsBlocked: true,
          },
          adoptionMode: 'adopted-observed',
          observedDeployment: {
            environment: 'production',
            activeUrl: 'https://planning.example.com',
            status: 'adopted_observed',
            observedAt: '2026-07-02T00:00:00.000Z',
            deploymentId: 'aca-revision-42',
            imageDigest: 'sha256:1234567890abcdef',
            configHash: 'sha256:feedface',
          },
        }),
      }),
    );
  });

  test.each([false, true])('HP006 issues workflow setup with explicit no-code handover=%s', async handoverFromNoCode => {
    await seedLoggedInTenant();
    const commitSha = handoverFromNoCode ? 'a'.repeat(40) : 'abcdef1234567890';
    const configHash = handoverFromNoCode ? `sha256:${'b'.repeat(64)}` : 'sha256:config';
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
            },
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/workflow-setup`
        && method === 'POST'
      ) {
        return jsonResponse({
          status: 'issued',
          operationId: 'source-unknown-op',
          nonce: 'nonce-token',
          expiresAt: '2026-07-02T00:15:00.000Z',
          setup: {
            workflowPath: '.github/workflows/eai-app.yml',
            publicApiEvidencePath: '/v4/platform/tenants/company-tenant/apps/planning-portal/source-unknown/workflow-evidence',
          },
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'workflow-setup',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--environment',
      'preview',
      '--workflow',
      '.github/workflows/eai-app.yml',
      '--ref',
      'refs/heads/main',
      '--commit',
      commitSha,
      '--config-hash',
      configHash,
      ...(handoverFromNoCode ? ['--handover-from-no-code'] : []),
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/workflow-setup`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          environment: 'preview',
          workflowPath: '.github/workflows/eai-app.yml',
          ref: 'refs/heads/main',
          commitSha,
          configHash,
          ...(handoverFromNoCode ? { handoverIntent: 'no-code-to-cli' } : {}),
        }),
      }),
    );
    const authenticatedCalls = fetchMock.mock.calls.filter(([input]) => requestUrl(input).startsWith(API_BASE));
    expect(authenticatedCalls.length).toBeGreaterThan(0);
    expect(authenticatedCalls.filter(([, init]) => init?.redirect !== 'error')
      .map(([input]) => requestUrl(input))).toEqual([]);
  });

  test.each([
    { commit: undefined, configHash: `sha256:${'b'.repeat(64)}` },
    { commit: 'short-sha', configHash: `sha256:${'b'.repeat(64)}` },
    { commit: 'a'.repeat(40), configHash: undefined },
    { commit: 'a'.repeat(40), configHash: 'sha256:config' },
  ])('rejects handover without an exact commit/config binding: %j', options => {
    expect(() => buildSourceUnknownWorkflowSetupData({
      ...options,
      handoverFromNoCode: true,
    })).toThrow();
  });

  test('workflow setup stays unbound without explicit handover intent', () => {
    expect(buildSourceUnknownWorkflowSetupData({})).toEqual({
      environment: 'preview',
      workflowPath: '.github/workflows/eai-app.yml',
    });
  });

  test('HP007 submits source-unknown workflow evidence under the company tenant', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
            },
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/workflow-evidence`
        && method === 'POST'
      ) {
        return jsonResponse({
          status: 'accepted',
          sourceMetadata: {
            sourceMode: 'source-unknown',
            artifactDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const evidence = workflowEvidenceFixture();
    const evidencePath = join(env.dir, 'workflow-evidence.json');
    await writeFile(evidencePath, JSON.stringify(evidence));
    await appCommand.parseAsync([
      'workflow-evidence', 'planning-portal', '--tenant-id', COMPANY_TENANT_ID,
      '--evidence-file', evidencePath, '--github-oidc-token', 'github-oidc-token', '--format', 'json',
    ], { from: 'user' });

    const evidenceCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith('/workflow-evidence'));
    expect(evidenceCall).toBeDefined();
    expect(evidenceCall?.[1]?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer github-oidc-token' }));
    expect(JSON.parse(String(evidenceCall?.[1]?.body))).toEqual(evidence);
    expect(String(evidenceCall?.[1]?.body)).not.toContain('passed_by_cli');
    expect(String(evidenceCall?.[1]?.body)).not.toContain('oidcClaims');
    const authenticatedCalls = fetchMock.mock.calls.filter(([input]) => requestUrl(input).startsWith(API_BASE));
    expect(authenticatedCalls.length).toBeGreaterThan(0);
    expect(authenticatedCalls.filter(([, init]) => init?.redirect !== 'error')
      .map(([input]) => requestUrl(input))).toEqual([]);
  });

  test('HP008 requests source-unknown deployment handoff under the company tenant', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
            },
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/deploy`
        && method === 'POST'
      ) {
        return jsonResponse({
          status: 'handoff_pending',
          deploymentRequestId: 'source-unknown-deploy-1',
          requiresTenantInfra: true,
        }, 202);
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'deploy-source-unknown',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--operation-id',
      'source-unknown-op',
      '--environment',
      'preview',
      '--repo',
      'enterpriseaigroup/planning-portal',
      '--workflow',
      '.github/workflows/eai-app.yml',
      '--ref',
      'refs/heads/main',
      '--commit',
      'abcdef1234567890',
      '--workflow-run-id',
      '123456789',
      '--config-hash',
      'sha256:config',
      '--artifact-digest',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--image-digest',
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '--release-channel',
      'preview',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/deploy`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          operationId: 'source-unknown-op',
          environment: 'preview',
          repoOwner: 'enterpriseaigroup',
          repoName: 'planning-portal',
          workflowPath: '.github/workflows/eai-app.yml',
          ref: 'refs/heads/main',
          commitSha: 'abcdef1234567890',
          workflowRunId: '123456789',
          configHash: 'sha256:config',
          artifactDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          imageDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          deploymentTarget: {
            kind: 'tenantinfra',
            releaseChannel: 'preview',
          },
          validationSummary: {
            status: 'deployment_requested_by_cli',
            appValidated: true,
            requiresTenantInfra: true,
          },
        }),
      }),
    );
  });

  test('HP009 reads source-unknown deployment handoff status under the company tenant', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
            },
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/deployments/latest`
        && method === 'GET'
      ) {
        return jsonResponse({
          status: 'handoff_pending',
          deploymentRequestId: 'source-unknown-deploy-1',
          requiresTenantInfra: true,
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'deploy-source-unknown-status',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/deployments/latest`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  test('BC002 rejects incomplete schema provenance before registration', () => {
    expect(() =>
      buildSourceUnknownRegistrationData({
        repo: 'enterpriseaigroup/planning-portal',
        schemaDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    ).toThrow('Schema provenance requires --schema-digest and --validator-digest.');
  });

  test('BC003 rejects schema provenance without an approved source anchor', () => {
    expect(() =>
      buildSourceUnknownRegistrationData({
        repo: 'enterpriseaigroup/planning-portal',
        templateVersion: 'eai.generated_app_config.v1',
        schemaDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        validatorDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    ).toThrow('Schema provenance requires --base-template-sha, --approved-source-sha, or --approved-release.');
  });

  test.each([
    ['missing image archive', { imageArtifact: undefined }],
    ['missing run identity', { workflowRun: undefined }],
    ['invalid run attempt', { workflowRun: { id: '123', attempt: '0' } }],
    ['invalid artifact ID', { imageArtifact: { id: '-1', name: 'eai-generated-app-image', archiveDigest: `sha256:${'f'.repeat(64)}` } }],
    ['short commit', { commitSha: 'short' }],
    ['invalid config digest', { configHash: 'sha256:config' }],
    ['invalid environment', { environment: 'production' }],
    ['missing provenance', { schemaProvenance: undefined }],
    ['invented CLI pass', { validationSummary: { status: 'passed_by_cli' } }],
    ['lookup is not validation', { validationSummary: { status: 'passed', appValidated: true } }],
    ['untrusted OIDC claims', { oidcClaims: { repository: 'attacker/repo' } }],
    ['invalid workflow blob', { workflowBlobSha: 'not-a-git-blob' }],
    ['invalid collector digest', { collectorDigest: 'sha256:short' }],
    ['invalid source mode', { sourceMode: 'customer' }],
    ['invalid target tenant', { targetTenantId: '../other' }],
    ['managed evidence without target tenant', { sourceMode: 'eai-cli-generated' }],
  ])('BC004 rejects noncanonical evidence: %s', (_label, mutation) => {
    expect(() => buildSourceUnknownWorkflowEvidenceData({ ...workflowEvidenceFixture(), ...mutation })).toThrow();
  });

  test('preserves distinct canonical artifact, archive, and image digests without synthesizing proof', () => {
    const fixture = workflowEvidenceFixture();
    expect(buildSourceUnknownWorkflowEvidenceData(fixture)).toEqual(fixture);
  });

  test('preserves the explicit source-unknown collector mode without deriving authority', () => {
    const fixture = {
      ...workflowEvidenceFixture(),
      sourceMode: 'source-unknown',
      targetTenantId: 'runtime-child',
    };
    expect(buildSourceUnknownWorkflowEvidenceData(fixture)).toEqual(fixture);
  });

  test.each([
    { operationId: 'cli-managed-source-op', sourceMode: 'eai-cli-generated' },
    { operationId: 'source-unknown-op', sourceMode: 'eai-cli-generated' },
    { operationId: 'cli-managed-source-op', sourceMode: 'source-unknown' },
    { operationId: 'cli-managed-source-op' },
  ])('rejects managed CLI evidence on the legacy command before tenant context or network: %j', async binding => {
    const evidencePath = join(env.dir, 'managed-cli-workflow-evidence.json');
    await writeFile(evidencePath, JSON.stringify({
      ...workflowEvidenceFixture(),
      ...binding,
      targetTenantId: 'runtime-child',
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(appCommand.parseAsync([
      'workflow-evidence', 'planning-portal', '--tenant-id', COMPANY_TENANT_ID,
      '--evidence-file', evidencePath, '--github-oidc-token', 'github-oidc-token',
      '--format', 'json',
    ], { from: 'user' })).rejects.toThrow('process.exit unexpectedly called');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('source-unknown evidence only'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([undefined, 'source-unknown', 'eai-cli-generated'])(
    'rejects an actual CLI-managed operation on the legacy command before authentication: %s', async sourceMode => {
      const evidencePath = join(env.dir, 'canonical-managed-workflow-evidence.json');
      await writeFile(evidencePath, JSON.stringify({
        ...workflowEvidenceFixture(),
        operationId: `cli-managed-${'a'.repeat(32)}`,
        ...(sourceMode ? { sourceMode } : {}),
        targetTenantId: 'runtime-child',
      }));
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(appCommand.parseAsync([
        'workflow-evidence', 'planning-portal', '--tenant-id', COMPANY_TENANT_ID,
        '--evidence-file', evidencePath, '--github-oidc-token', 'github-oidc-token',
        '--format', 'json',
      ], { from: 'user' })).rejects.toThrow('process.exit unexpectedly called');
      expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/source-unknown (?:evidence only|namespace)/));
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test('rejects an unsafe workflow-evidence operation ID before tenant context or network access', async () => {
    await seedLoggedInTenant();
    const evidencePath = join(env.dir, 'unsafe-workflow-evidence.json');
    await writeFile(evidencePath, JSON.stringify({
      ...workflowEvidenceFixture(),
      operationId: '../other?operation=1',
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(appCommand.parseAsync([
      'workflow-evidence', 'planning-portal', '--tenant-id', COMPANY_TENANT_ID,
      '--evidence-file', evidencePath, '--github-oidc-token', 'github-oidc-token',
      '--format', 'json',
    ], { from: 'user' })).rejects.toThrow('process.exit unexpectedly called');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('operationId is missing or invalid'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects an unsafe deployment handoff operation ID before tenant context or network access', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(appCommand.parseAsync([
      'deploy-source-unknown', 'planning-portal', '--tenant-id', COMPANY_TENANT_ID,
      '--operation-id', '../other?operation=1', '--skip-validate', '--format', 'json',
    ], { from: 'user' })).rejects.toThrow('process.exit unexpectedly called');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('safe exact managed-deployment identifier'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ['connect-existing', ['--repo', 'enterprise/planning-portal']],
    ['adopt-observed', ['--repo', 'enterprise/planning-portal', '--url', 'https://planning.example.com']],
    ['workflow-setup', []],
    ['workflow-evidence', ['--evidence-file', 'unused-evidence.json']],
    ['deploy-source-unknown', ['--operation-id', 'source-unknown-op']],
    ['deploy-source-unknown-status', []],
  ])('rejects an untrusted managed origin before tenant traffic for %s', async (command, args) => {
    await seedLoggedInTenant();
    if (command === 'workflow-evidence') {
      await writeFile(join(env.dir, 'unused-evidence.json'), JSON.stringify(workflowEvidenceFixture()));
    }
    process.env.BASE_URL_PUBLIC_API = 'https://attacker.example.invalid/public';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(appCommand.parseAsync([
      command,
      'planning-portal',
      ...args,
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--skip-validate',
      '--format',
      'json',
    ], { from: 'user' })).rejects.toThrow('trusted EAI regional PublicAPI');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('BC005 rejects invalid deployment handoff artifact digest before request', () => {
    expect(() =>
      buildSourceUnknownDeploymentData({
        operationId: 'source-unknown-op',
        artifactDigest: 'sha256:not-a-real-digest',
      }),
    ).toThrow('--artifact-digest must be a sha256:<64 hex chars> digest.');
  });

  test('BC006 includes TenantInfra source metadata in deployment handoff payloads', () => {
    expect(
      buildSourceUnknownDeploymentData({
        operationId: 'source-unknown-op',
        environment: 'preview',
        repo: 'enterpriseaigroup/planning-portal',
        workflow: '.github/workflows/eai-app.yml',
        ref: 'refs/heads/main',
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        workflowRunId: '123456789',
        artifactDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        imageDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    ).toMatchObject({
      operationId: 'source-unknown-op',
      environment: 'preview',
      repoOwner: 'enterpriseaigroup',
      repoName: 'planning-portal',
      workflowPath: '.github/workflows/eai-app.yml',
      ref: 'refs/heads/main',
      commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
      workflowRunId: '123456789',
    });
  });

  test('BC001 keeps the legacy vertical alias working', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);

    await verticalCommand.parseAsync([
      'select',
      'planning-portal',
      '--skip-validate',
      '--format',
      'json',
    ], { from: 'user' });

    const envFile = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(envFile).toContain('EAI_APP_KEY=planning-portal');
    expect(envFile).toContain('EAI_VERTICAL_KEY=planning-portal');
  });

  test('HP002 creates an app for the active builder workspace when tier is omitted from tenant lookups', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/management` && method === 'GET') {
        return jsonResponse({
          id: COMPANY_TENANT_ID,
          displayName: 'Builder Workspace',
          slug: 'builder-workspace',
          parentTenant: PLATFORM_PARENT_ID,
          ultimateParent: PLATFORM_PARENT_ID,
        });
      }

      if (url === `${API_BASE}/v4/platform/tenants/${PLATFORM_PARENT_ID}/management` && method === 'GET') {
        return jsonResponse({
          id: PLATFORM_PARENT_ID,
          displayName: 'EAI Developers',
          slug: 'eai-developers',
          parentTenant: null,
          ultimateParent: PLATFORM_PARENT_ID,
        });
      }

      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps` && method === 'POST') {
        return jsonResponse({ app: { id: 'app-1', verticalKey: 'planning-portal' } }, 201);
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await verticalCommand.parseAsync([
      'create',
      'PlanningPortal',
      '--key',
      'planning-portal',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining(`/v4/platform/tenants/${PLATFORM_PARENT_ID}/apps`),
      expect.anything(),
    );
  });

  test('BP001 blocks app creation for a tenant outside the current tenant-admin memberships', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(verticalCommand.parseAsync([
      'create',
      'PlanningPortal',
      '--tenant-id',
      'other-tenant',
      '--key',
      'planning-portal',
      '--format',
      'json',
    ], { from: 'user' })).rejects.toThrow('Workspace "other-tenant" is not available');

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/apps'),
      expect.anything(),
    );
  });
});
