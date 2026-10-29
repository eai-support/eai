import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import { cleanupTestTokens, workingDirectoryIs } from '../helpers/setup-dsl.js';
import { clearTokens, storeTokens } from '../../src/lib/auth.js';
import { CREDITS_EXHAUSTED_NEXT_ACTION, creditsExhaustedNextAction } from '../../src/lib/credits-exhausted.js';
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

  // Canonical ResourceAPI offset envelopes, with observed app records replaced by owned fixtures.
  const canonicalEmptyInventory = { docs: [], totalDocs: 0, totalPages: 1, limit: 50, page: 1,
    hasPrevPage: false, hasNextPage: false, nextCursor: null };
  const canonicalInventory = { ...canonicalEmptyInventory, totalDocs: 1,
    docs: [{ id: 'fixture-app', data: { verticalKey: 'fixture-app', displayName: 'Owned inventory fixture' } }] };
  const canonicalMultiplePages = { ...canonicalInventory, limit: 1, totalDocs: 2, totalPages: 2, hasNextPage: true };

  test.each([
    { name: 'empty observed v4 envelope', payload: canonicalEmptyInventory },
    { name: 'nonempty observed v4 envelope', payload: canonicalInventory },
    { name: 'offset next page with a null cursor', payload: canonicalMultiplePages },
    { name: 'offset next page with an opaque cursor', payload: { ...canonicalMultiplePages, nextCursor: 'opaque-continuation' } },
    { name: 'exactly full terminal page', payload: { ...canonicalInventory, limit: 1 } },
    { name: 'canonical and complete consistent legacy metadata', payload: { ...emptyInventory, ...canonicalInventory } },
    { name: 'nonempty legacy inventory', payload: { ...emptyInventory, ...canonicalInventory, nextCursor: undefined } },
    { name: 'multiple-page legacy inventory', payload: { ...emptyInventory, ...canonicalMultiplePages, nextCursor: undefined, nextPage: 2 } },
  ])('app list accepts $name', async ({ payload }) => {
    await seedLoggedInTenant(); inventoryFetch(payload);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('Controlled inventory exit'); }) as never);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await appCommand.parseAsync(['list', '--tenant-id', COMPANY_TENANT_ID, '--limit', String(payload.limit), '--format', 'json'], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(args => String(args[0])).join(''))).toEqual({ tenantId: COMPANY_TENANT_ID, apps: payload.docs });
    expect(exit).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => requestMethod(init) === 'GET')).toBe(true);
  });

  test.each([
    { name: 'missing both pagination families', payload: { ...canonicalInventory, nextCursor: undefined } },
    { name: 'partial legacy paging counter', payload: { ...canonicalInventory, pagingCounter: 1 } },
    { name: 'partial legacy next page', payload: { ...canonicalInventory, nextPage: null } },
    { name: 'partial legacy previous page', payload: { ...canonicalInventory, prevPage: null } },
    { name: 'conflicting legacy counter', payload: { ...emptyInventory, ...canonicalInventory, pagingCounter: 2 } },
    { name: 'conflicting legacy next page', payload: { ...emptyInventory, ...canonicalInventory, nextPage: 2 } },
    { name: 'conflicting legacy previous page', payload: { ...emptyInventory, ...canonicalInventory, prevPage: 1 } },
    { name: 'later page instead of requested first page', payload: { ...canonicalInventory, page: 2, totalDocs: 2, totalPages: 2, limit: 1, hasPrevPage: true } },
    { name: 'empty beyond-end page instead of requested first page', payload: { ...canonicalEmptyInventory, page: 2, hasPrevPage: true } },
    { name: 'wrong previous-page flag', payload: { ...canonicalInventory, hasPrevPage: true } },
    { name: 'wrong next-page flag', payload: { ...canonicalInventory, hasNextPage: true } },
    { name: 'wrong total-page count', payload: { ...canonicalInventory, totalPages: 2 } },
    { name: 'zero canonical total pages', payload: { ...canonicalEmptyInventory, totalPages: 0 } },
    { name: 'wrong document count', payload: { ...canonicalInventory, totalDocs: 0 } },
    { name: 'missing first-page rows', payload: { ...canonicalInventory, docs: [] } },
    { name: 'excess first-page rows', payload: { ...canonicalMultiplePages, docs: [...canonicalInventory.docs, ...canonicalInventory.docs] } },
    { name: 'fractional count', payload: { ...canonicalInventory, totalDocs: 1.5 } },
    { name: 'unsafe count', payload: { ...canonicalInventory, totalDocs: Number.MAX_SAFE_INTEGER + 1 } },
    { name: 'negative count', payload: { ...canonicalInventory, totalDocs: -1 } },
    { name: 'zero limit', payload: { ...canonicalInventory, limit: 0 } },
    { name: 'string limit', payload: { ...canonicalInventory, limit: '50' } },
    { name: 'empty cursor', payload: { ...canonicalMultiplePages, nextCursor: '' } },
    { name: 'nonstring cursor', payload: { ...canonicalMultiplePages, nextCursor: false } },
    { name: 'cursor without a next page', payload: { ...canonicalInventory, nextCursor: 'opaque-continuation' } },
    { name: 'missing record identity', payload: { ...canonicalInventory, docs: [{ data: {} }] } },
    { name: 'empty record identity', payload: { ...canonicalInventory, docs: [{ id: '', data: {} }] } },
    { name: 'array record data', payload: { ...canonicalInventory, docs: [{ id: 'fixture-app', data: [] }] } },
    { name: 'null record data', payload: { ...canonicalInventory, docs: [{ id: 'fixture-app', data: null }] } },
  ])('app list rejects $name without changing workspace state', async ({ payload }) => {
    await seedLoggedInTenant(); inventoryFetch(payload);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('Controlled inventory exit'); }) as never);
    const errors = vi.spyOn(console, 'error');
    await expect(appCommand.parseAsync(['list', '--tenant-id', COMPANY_TENANT_ID, '--format', 'json'], { from: 'user' })).rejects.toThrow('Controlled inventory exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(errors.mock.calls.flat().join(' ')).toContain('invalid response');
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => requestMethod(init) === 'GET')).toBe(true);
  });

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

  test.each([
    ['child', 'success'],
    ['same-tenant', 'success'],
    ['legacy-default', 'success'],
    ['legacy-default-receipt-target', 'success'],
    ['plan-wrong-owner', 'plan'],
    ['plan-missing-owner', 'plan'],
    ['plan-wrong-child', 'plan'],
    ['plan-missing-child', 'plan'],
    ['plan-null-child', 'plan'],
    ['plan-child-absent-from-runtime', 'plan'],
    ['plan-legacy-explicit-child', 'plan'],
    ['default-plan-foreign-child', 'plan'],
    ['receipt-wrong-owner', 'receipt'],
    ['receipt-wrong-child', 'receipt'],
    ['receipt-missing-child', 'receipt'],
    ['receipt-wrong-ownership-hash', 'receipt'],
    ['receipt-missing-ownership-hash', 'receipt'],
    ['default-receipt-foreign-child', 'receipt'],
    ['default-receipt-downgrade', 'receipt'],
  ])('pins the requested app deletion owner and runtime: %s', async (scenario, phase) => {
    await seedLoggedInTenant();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
    const hash = 'a'.repeat(64);
    const explicit = !scenario.startsWith('legacy-default') && !scenario.startsWith('default-');
    const target = scenario === 'same-tenant' ? COMPANY_TENANT_ID : 'runtime-child';
    const plan: Record<string, unknown> = {
      tenantId: COMPANY_TENANT_ID, targetTenantId: target, appKey: 'post-pilot',
      confirmationRequired: 'post-pilot', ownershipManifestHash: hash,
      environments: ['preview', 'dev', 'test', 'prod'], cleanupContract: 'eai.app-scoped-cleanup.v2',
      runtimeTenantIds: target === COMPANY_TENANT_ID ? [COMPANY_TENANT_ID] : [target, COMPANY_TENANT_ID],
    };
    const receipt: Record<string, unknown> = {
      schemaVersion: 'eai.app-deletion-receipt.v1', operationId: 'appdel-operation-1',
      planHash: hash, ownershipManifestHash: hash, tenantId: COMPANY_TENANT_ID,
      targetTenantId: target, appKey: 'post-pilot', status: 'deleted', verified: true,
      runtimeTenantIds: [...plan.runtimeTenantIds as string[]],
    };
    if (scenario.startsWith('legacy-default')) {
      delete plan.targetTenantId; delete plan.cleanupContract; delete plan.runtimeTenantIds;
      delete receipt.targetTenantId; delete receipt.runtimeTenantIds;
      if (scenario === 'legacy-default-receipt-target') receipt.targetTenantId = COMPANY_TENANT_ID;
    }
    if (scenario === 'plan-wrong-owner') plan.tenantId = 'foreign-owner';
    if (scenario === 'plan-missing-owner') delete plan.tenantId;
    if (scenario === 'plan-wrong-child') plan.targetTenantId = 'foreign-child';
    if (scenario === 'plan-missing-child') delete plan.targetTenantId;
    if (scenario === 'plan-null-child') plan.targetTenantId = null;
    if (scenario === 'plan-child-absent-from-runtime') plan.runtimeTenantIds = ['foreign-child', COMPANY_TENANT_ID];
    if (scenario === 'plan-legacy-explicit-child') {
      delete plan.targetTenantId; delete plan.cleanupContract; delete plan.runtimeTenantIds;
    }
    if (scenario.startsWith('default-receipt')) {
      plan.targetTenantId = COMPANY_TENANT_ID; plan.runtimeTenantIds = [COMPANY_TENANT_ID];
      receipt.runtimeTenantIds = [COMPANY_TENANT_ID];
    }
    if (scenario === 'receipt-wrong-owner') receipt.tenantId = 'foreign-owner';
    if (scenario === 'receipt-wrong-child') receipt.targetTenantId = 'foreign-child';
    if (scenario === 'receipt-missing-child' || scenario === 'default-receipt-downgrade') delete receipt.targetTenantId;
    if (scenario === 'receipt-wrong-ownership-hash') receipt.ownershipManifestHash = 'b'.repeat(64);
    if (scenario === 'receipt-missing-ownership-hash') delete receipt.ownershipManifestHash;

    const planUrl = `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/post-pilot/deletion-plan${explicit ? `?targetTenantId=${target}` : ''}`;
    const deleteUrl = `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/post-pilot`;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input); const method = requestMethod(init);
      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') return jsonResponse({ tenants: [{
        id: COMPANY_TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace',
        isActive: true, roles: ['tenant-admin'],
      }] });
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/management` && method === 'GET') {
        return jsonResponse({ id: COMPANY_TENANT_ID, displayName: 'Builder Workspace', region: 'au' });
      }
      if (url === planUrl && method === 'GET') return jsonResponse(plan);
      if (url === deleteUrl && method === 'DELETE') return jsonResponse(receipt);
      throw new Error(`unexpected provider request: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const invocation = appCommand.parseAsync(['delete', 'post-pilot', '--tenant-id', COMPANY_TENANT_ID,
      ...(explicit ? ['--target-tenant-id', target] : []), '--confirm', 'post-pilot', '--non-interactive', '--format', 'json'], { from: 'user' });
    if (phase === 'success') {
      await invocation;
      expect(JSON.parse(output.mock.calls.map(call => String(call[0])).join(''))).toEqual(receipt);
    } else {
      await expect(invocation).rejects.toThrow('fixture-process-exit');
      expect(output).not.toHaveBeenCalled();
      expect(errors.mock.calls.flat().join(' ')).toContain(phase === 'plan'
        ? 'invalid app deletion ownership plan' : 'verified app deletion receipt');
    }
    expect(fetchMock).toHaveBeenCalledWith(planUrl, expect.objectContaining({
      method: 'GET', headers: expect.objectContaining({ 'X-Tenant-Id': COMPANY_TENANT_ID }),
    }));
    const deletes = fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'DELETE');
    expect(deletes).toHaveLength(phase === 'plan' ? 0 : 1);
    if (deletes.length) expect(deletes[0]).toEqual([deleteUrl, expect.objectContaining({
      method: 'DELETE', headers: expect.objectContaining({ 'X-Tenant-Id': COMPANY_TENANT_ID }),
      body: JSON.stringify({ confirmationAppKey: 'post-pilot', ownershipManifestHash: hash,
        environments: ['preview', 'dev', 'test', 'prod'], ...(explicit ? { targetTenantId: target } : {}) }),
    })]);
  });

  test.each(['', ' child', 'child ', '.', '..', 'child/other', 'child\nother'])
    ('rejects invalid app deletion target %j before any request', async target => {
      const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
      await expect(appCommand.parseAsync(['delete', 'post-pilot', '--tenant-id', COMPANY_TENANT_ID,
        '--target-tenant-id', target, '--confirm', 'post-pilot', '--non-interactive', '--format', 'json'], { from: 'user' }))
        .rejects.toThrow('fixture-process-exit');
      expect(fetchMock).not.toHaveBeenCalled();
    });

  // Configurator's ownership failures, forwarded by PublicAPI as a flat { error, message } body.
  const OWNERSHIP_FAILURE_MESSAGE = 'App deletion cannot proceed without an unambiguous ownership manifest.';
  const DELETION_REQUEST_ID = 'd681b292-2bfd-4c50-a8ce-392f642b1816';

  function appDeletionFailureFetch(
    failing: 'plan' | 'delete',
    transportFailure?: () => Promise<Response>,
  ): ReturnType<typeof vi.fn> {
    const failure = (status: number, code: string): Response => new Response(
      JSON.stringify({ error: code, message: OWNERSHIP_FAILURE_MESSAGE }),
      { status, headers: { 'Content-Type': 'application/json', 'x-request-id': DELETION_REQUEST_ID } },
    );
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input); const method = requestMethod(init);
      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') return jsonResponse({ tenants: [{
        id: COMPANY_TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'],
      }] });
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/management` && method === 'GET') {
        return jsonResponse({ id: COMPANY_TENANT_ID, displayName: 'Builder Workspace', region: 'au' });
      }
      if (url.endsWith('/apps/post-pilot/deletion-plan') && method === 'GET') {
        if (failing === 'plan') {
          return transportFailure ? transportFailure() : failure(409, 'APP_OWNERSHIP_ENROLLMENT_OWNER_AMBIGUOUS');
        }
        return jsonResponse({
          tenantId: COMPANY_TENANT_ID, appKey: 'post-pilot', confirmationRequired: 'post-pilot',
          ownershipManifestHash: 'a'.repeat(64), environments: ['preview', 'dev', 'test', 'prod'],
        });
      }
      if (url.endsWith('/apps/post-pilot') && method === 'DELETE') {
        return transportFailure ? transportFailure() : failure(403, 'APP_DELETION_TARGET_TENANT_FORBIDDEN');
      }
      throw new Error(`unexpected provider request: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  test.each([
    { failing: 'plan' as const, status: 409, serverCode: 'APP_OWNERSHIP_ENROLLMENT_OWNER_AMBIGUOUS', deletes: 0 },
    { failing: 'delete' as const, status: 403, serverCode: 'APP_DELETION_TARGET_TENANT_FORBIDDEN', deletes: 1 },
  ])('emits the JSON error envelope with HTTP status and server code when the $failing call fails', async ({ failing, status, serverCode, deletes }) => {
    await seedLoggedInTenant();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
    const fetchMock = appDeletionFailureFetch(failing);

    await expect(appCommand.parseAsync(['delete', 'post-pilot', '--tenant-id', COMPANY_TENANT_ID,
      '--confirm', 'post-pilot', '--non-interactive', '--format', 'json'], { from: 'user' })).rejects.toThrow('fixture-process-exit');

    expect(output).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toEqual({ error: {
      code: 'E203', message: `Platform API error: App deletion${failing === 'plan' ? ' plan' : ''} failed (HTTP ${status}) [${serverCode}]; request ${DELETION_REQUEST_ID}.`, suggestion: expect.any(String),
      exitCode: 1, status, serverCode, requestId: DELETION_REQUEST_ID,
    } });
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'DELETE')).toHaveLength(deletes);
  });

  test.each([
    { failing: 'plan' as const, status: 409, serverCode: 'APP_OWNERSHIP_ENROLLMENT_OWNER_AMBIGUOUS' },
    { failing: 'delete' as const, status: 403, serverCode: 'APP_DELETION_TARGET_TENANT_FORBIDDEN' },
  ])('shows the HTTP status and server code in text output when the $failing call fails', async ({ failing, status, serverCode }) => {
    await seedLoggedInTenant();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
    appDeletionFailureFetch(failing);

    await expect(appCommand.parseAsync(['delete', 'post-pilot', '--tenant-id', COMPANY_TENANT_ID,
      '--confirm', 'post-pilot', '--non-interactive'], { from: 'user' })).rejects.toThrow('fixture-process-exit');

    const text = errors.mock.calls.flat().join('\n');
    expect(text).toContain(`App deletion${failing === 'plan' ? ' plan' : ''} failed (HTTP ${status}) [${serverCode}]; request ${DELETION_REQUEST_ID}.`);
    expect(text).not.toContain(OWNERSHIP_FAILURE_MESSAGE);
    expect(text).toContain(`HTTP status: ${status}`);
    expect(text).toContain(`Server code: ${serverCode}`);
    expect(text).toContain(`Request ID: ${DELETION_REQUEST_ID}`);
    expect(() => JSON.parse(text)).toThrow();
  });

  test.each((['plan', 'delete'] as const).flatMap(failing =>
    (['plaintext', 'json', 'empty'] as const).flatMap(body =>
      (['json', 'text'] as const).map(format => ({ failing, body, format })),
    ),
  ))('omits opaque $body response messages from $failing failures in $format output', async ({ failing, body, format }) => {
    await seedLoggedInTenant();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
    const opaque = 'unclassified-provider-diagnostic-quartz-iris';
    const statusPhrase = 'Unclassified Quartz Iris Status';
    const status = failing === 'plan' ? 409 : 403;
    const serverCode = failing === 'plan' ? 'APP_OWNERSHIP_ENROLLMENT_OWNER_AMBIGUOUS' : 'APP_DELETION_TARGET_TENANT_FORBIDDEN';
    const fetchMock = appDeletionFailureFetch(failing, async () => new Response(
      body === 'json' ? JSON.stringify({ error: serverCode, message: opaque }) : body === 'plaintext' ? opaque : '',
      { status, statusText: statusPhrase, headers: {
        'Content-Type': body === 'json' ? 'application/json' : 'text/plain', 'x-request-id': DELETION_REQUEST_ID,
      } },
    ));

    await expect(appCommand.parseAsync(['delete', 'post-pilot', '--tenant-id', COMPANY_TENANT_ID,
      '--confirm', 'post-pilot', '--non-interactive', '--format', format], { from: 'user' }))
      .rejects.toThrow('fixture-process-exit');

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(output).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);
    const emitted = String(errors.mock.calls[0]?.[0]);
    expect(emitted).not.toContain(opaque);
    expect(emitted).not.toContain(statusPhrase);
    const message = `App deletion${failing === 'plan' ? ' plan' : ''} failed (HTTP ${status})`
      + `${body === 'json' ? ` [${serverCode}]` : ''}; request ${DELETION_REQUEST_ID}.`;
    if (format === 'json') {
      expect(JSON.parse(emitted)).toEqual({ error: {
        code: 'E203', message: `Platform API error: ${message}`, suggestion: expect.any(String), exitCode: 1,
        status, requestId: DELETION_REQUEST_ID, ...(body === 'json' ? { serverCode } : {}),
      } });
    } else {
      expect(emitted).toContain(message);
      expect(emitted).toContain('Error code: E203');
      expect(emitted).toContain(`HTTP status: ${status}`);
      expect(emitted).toContain(`Request ID: ${DELETION_REQUEST_ID}`);
      if (body === 'json') expect(emitted).toContain(`Server code: ${serverCode}`);
      else expect(emitted).not.toContain('Server code:');
    }
    expect(fetchMock.mock.calls.filter(([input]) => requestUrl(input).endsWith('/deletion-plan'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'DELETE')).toHaveLength(failing === 'plan' ? 0 : 1);
  });

  test.each((['plan', 'delete'] as const).flatMap(failing =>
    (['network', 'timeout', 'body'] as const).flatMap(failure =>
      (['json', 'text'] as const).map(format => ({ failing, failure, format })),
    ),
  ))('keeps $failing $failure failures safe in $format output without retrying deletion', async ({ failing, failure, format }) => {
    await seedLoggedInTenant();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
    const unsafe = 'sensitive-provider-text https://internal.example/?token=private-value';
    const fetchMock = appDeletionFailureFetch(failing, async () => {
      if (failure === 'network') throw new Error(unsafe);
      if (failure === 'timeout') throw new DOMException(unsafe, 'TimeoutError');
      return new Response(new ReadableStream({
        start(controller): void { controller.error(new Error(unsafe)); },
      }), { status: 200, headers: { 'x-request-id': DELETION_REQUEST_ID } });
    });

    await expect(appCommand.parseAsync(['delete', 'post-pilot', '--tenant-id', COMPANY_TENANT_ID,
      '--confirm', 'post-pilot', '--non-interactive', '--format', format], { from: 'user' }))
      .rejects.toThrow('fixture-process-exit');

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(output).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);
    const emitted = String(errors.mock.calls[0]?.[0]);
    const message = failing === 'plan'
      ? 'Could not prepare app deletion. No deletion request was sent.'
      : 'App deletion could not be verified. Check the app status before retrying.';
    if (format === 'json') {
      expect(JSON.parse(emitted)).toEqual({ error: {
        code: 'E203', message: `Platform API error: ${message}`, suggestion: expect.any(String), exitCode: 1,
        ...(failure === 'body' ? { status: 200, requestId: DELETION_REQUEST_ID } : {}),
      } });
    } else {
      expect(emitted).toContain(message);
      expect(emitted).toContain('Error code: E203');
      if (failure === 'body') {
        expect(emitted).toContain('HTTP status: 200');
        expect(emitted).toContain(`Request ID: ${DELETION_REQUEST_ID}`);
      } else {
        expect(emitted).not.toContain('HTTP status:');
      }
    }
    expect(emitted).not.toContain('sensitive-provider-text');
    expect(emitted).not.toContain('internal.example');
    expect(emitted).not.toContain('private-value');
    expect(fetchMock.mock.calls.filter(([input]) => requestUrl(input).endsWith('/deletion-plan'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'DELETE')).toHaveLength(failing === 'plan' ? 0 : 1);
  });

  test('keeps a non-HTTP app deletion failure in the JSON error envelope', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
    vi.stubGlobal('fetch', vi.fn());

    await expect(appCommand.parseAsync(['delete', 'post-pilot', '--tenant-id', COMPANY_TENANT_ID,
      '--target-tenant-id', '..', '--confirm', 'post-pilot', '--non-interactive', '--format', 'json'], { from: 'user' }))
      .rejects.toThrow('fixture-process-exit');

    expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toEqual({ error: expect.objectContaining({
      code: 'E305', message: 'Invalid input: --target-tenant-id must be a non-empty exact workspace identifier.', exitCode: 1,
    }) });
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
    responseForRead: (read: number) => Record<string, unknown> | Response,
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
        const result = responseForRead(++reads);
        return result instanceof Response ? result : jsonResponse(result);
      }
      return jsonResponse({ message: `Unexpected request: ${method} ${url}` }, 500);
    });
  }

  test.each([
    [502, 'EXTERNAL_SERVICE_ERROR'],
    [503, 'PASSIVE_SCHEMA_MISMATCH'],
  ])('provision --job-id retries only its exact initial HTTP %s dependency read', async (status, errorCode) => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const originalEnv = await readFile(join(env.dir, '.env.local'), 'utf-8');
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-exit'); });
    const fetchMock = mockProvisioningJob(read => read === 1
      ? jsonResponse({ detail: { error: errorCode } }, status as number)
      : appJobFixture('ready'));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const completion = appCommand.parseAsync(['provision', 'planning-portal', '--tenant-id', COMPANY_TENANT_ID,
      '--job-id', 'app-prov-async', '--format', 'json'], { from: 'user' }).then(() => undefined, error => error);
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([input]) =>
      requestUrl(input).includes('/provisioning-jobs/app-prov-async?'))).toHaveLength(1));
    expect(await readFile(join(env.dir, '.env.local'), 'utf-8')).toBe(originalEnv);
    await expect(readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await completion).toBeUndefined();
    const reads = fetchMock.mock.calls.filter(([input]) =>
      requestUrl(input).includes('/provisioning-jobs/app-prov-async?'));
    expect(reads).toHaveLength(2);
    expect(reads.every(([input, init]) => requestUrl(input).endsWith('/app-prov-async?targetTenantId=runtime-child')
      && requestMethod(init) === 'GET' && init?.body === undefined)).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'POST')).toHaveLength(0);
    expect(JSON.parse(outputSpy.mock.calls.flat().join('')).provisioning).toMatchObject({ status: 'ready', jobId: 'app-prov-async' });
    expect(JSON.parse(await readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).source)
      .toEqual({ provisioningJobId: 'app-prov-async' });
  });

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

  test.each([
    [502, 'EXTERNAL_SERVICE_ERROR'],
    [503, 'PASSIVE_SCHEMA_MISMATCH'],
  ])('provision keeps its acknowledged job during bounded HTTP %s dependency convergence', async (status, errorCode) => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const originalEnv = await readFile(join(env.dir, '.env.local'), 'utf-8');
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-exit'); });
    let readCount = 0;
    const fetchMock = mockProvisioningJob(read => {
      readCount = read;
      if (read === 1) return appJobFixture('running');
      if (read < 4) return jsonResponse({ detail: { error: errorCode,
        message: 'A platform dependency is temporarily unavailable' } }, status as number);
      return appJobFixture('ready');
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const completion = appCommand.parseAsync(provisionArgs, { from: 'user' }).then(() => undefined, error => error);
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => requestMethod(init) === 'POST')).toBe(true));
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await readFile(join(env.dir, '.env.local'), 'utf-8')).toBe(originalEnv);
    await expect(readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await completion).toBeUndefined();
    expect(readCount).toBe(4);
    const polls = fetchMock.mock.calls.filter(([input]) => requestUrl(input).includes('/provisioning-jobs/app-prov-async?'));
    expect(polls).toHaveLength(4);
    expect(polls.every(([input, init]) => requestUrl(input).endsWith('/app-prov-async?targetTenantId=runtime-child')
      && requestMethod(init) === 'GET' && init?.body === undefined)).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'POST')).toHaveLength(1);
    expect(JSON.parse(outputSpy.mock.calls.flat().join('')).provisioning).toMatchObject({ status: 'ready', jobId: 'app-prov-async' });
    expect(JSON.parse(await readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).source)
      .toEqual({ provisioningJobId: 'app-prov-async' });
  });

  test('provision stops after three consecutive dependency-read retries and keeps local files', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const originalEnv = await readFile(join(env.dir, '.env.local'), 'utf-8');
    const contractPath = join(env.dir, '.eai/storage-bindings.json');
    await mkdir(join(env.dir, '.eai'), { recursive: true });
    await writeFile(contractPath, 'existing-local-contract\n');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-exit'); });
    const fetchMock = mockProvisioningJob(() => jsonResponse({ detail: { error: 'EXTERNAL_SERVICE_ERROR' } }, 502));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const rejected = expect(appCommand.parseAsync(provisionArgs, { from: 'user' })).rejects.toThrow('fixture-exit');
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => requestMethod(init) === 'POST')).toBe(true));
    await vi.advanceTimersByTimeAsync(8_000);
    await rejected;
    expect(fetchMock.mock.calls.filter(([input]) => requestUrl(input).includes('/provisioning-jobs/app-prov-async?'))).toHaveLength(4);
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'POST')).toHaveLength(1);
    expect(await readFile(join(env.dir, '.env.local'), 'utf-8')).toBe(originalEnv);
    expect(await readFile(contractPath, 'utf-8')).toBe('existing-local-contract\n');
    const output = vi.mocked(console.error).mock.calls.flat().join('');
    expect(output).toContain('Could not read app provisioning job app-prov-async: 502');
    expect(output).toContain('Rerun with --job-id app-prov-async');
  });

  test('provision resets its consecutive dependency-read budget only after valid job readback', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-exit'); });
    const fetchMock = mockProvisioningJob(read => read === 4 || read === 8
      ? appJobFixture(read === 8 ? 'ready' : 'running')
      : jsonResponse({ detail: { error: 'EXTERNAL_SERVICE_ERROR' } }, 502));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const completion = appCommand.parseAsync(provisionArgs, { from: 'user' }).then(() => undefined, error => error);
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => requestMethod(init) === 'POST')).toBe(true));
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await completion).toBeUndefined();
    expect(JSON.parse(outputSpy.mock.calls.flat().join('')).provisioning.status).toBe('ready');
    expect(fetchMock.mock.calls.filter(([input]) => requestUrl(input).includes('/provisioning-jobs/app-prov-async?'))).toHaveLength(8);
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'POST')).toHaveLength(1);
  });

  test.each([
    { status: 'failed' },
    { status: 'interrupted' },
    { jobId: 'different-job' },
    { tenantId: 'different-company' },
    { appKey: 'different-app' },
    { enrollment: { childTenantId: 'different-runtime' } },
  ])('provision still rejects terminal or foreign readback after dependency retries (%j)', async overrides => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const originalEnv = await readFile(join(env.dir, '.env.local'), 'utf-8');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-exit'); });
    const fetchMock = mockProvisioningJob(read => read === 1
      ? jsonResponse({ detail: { error: 'EXTERNAL_SERVICE_ERROR' } }, 502)
      : { ...appJobFixture('ready'), ...overrides });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const rejected = expect(appCommand.parseAsync(provisionArgs, { from: 'user' })).rejects.toThrow('fixture-exit');
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => requestMethod(init) === 'POST')).toBe(true));
    await vi.advanceTimersByTimeAsync(4_000);
    await rejected;
    expect(fetchMock.mock.calls.filter(([input]) => requestUrl(input).includes('/provisioning-jobs/app-prov-async?'))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'POST')).toHaveLength(1);
    expect(await readFile(join(env.dir, '.env.local'), 'utf-8')).toBe(originalEnv);
    await expect(readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('provision retains its original deadline across temporary dependency errors', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const originalEnv = await readFile(join(env.dir, '.env.local'), 'utf-8');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-exit'); });
    const fetchMock = mockProvisioningJob(read => read % 2 === 0
      ? appJobFixture('running')
      : jsonResponse({ detail: { error: 'EXTERNAL_SERVICE_ERROR' } }, 502));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const rejected = expect(appCommand.parseAsync(provisionArgs, { from: 'user' })).rejects.toThrow('fixture-exit');
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => requestMethod(init) === 'POST')).toBe(true));
    const started = Date.now();
    await vi.advanceTimersByTimeAsync(900_000);
    await rejected;
    expect(Date.now() - started).toBe(900_000);
    expect(vi.mocked(console.error).mock.calls.flat().join('')).toContain('Timed out after 900 seconds waiting');
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'POST')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([input]) => requestUrl(input).includes('/provisioning-jobs/app-prov-async?')).length)
      .toBeLessThanOrEqual(450);
    expect(await readFile(join(env.dir, '.env.local'), 'utf-8')).toBe(originalEnv);
    await expect(readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test.each([
    new Response('not JSON', { status: 502, headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({ detail: { error: 'EXTERNAL_SERVICE_ERROR' } }), {
      status: 502, headers: { 'content-type': 'text/plain' },
    }),
  ])('provision does not retry a malformed dependency error body or media type', async response => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const originalEnv = await readFile(join(env.dir, '.env.local'), 'utf-8');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-exit'); });
    const fetchMock = mockProvisioningJob(() => response.clone());
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const rejected = expect(appCommand.parseAsync(provisionArgs, { from: 'user' })).rejects.toThrow('fixture-exit');
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => requestMethod(init) === 'POST')).toBe(true));
    await vi.advanceTimersByTimeAsync(2_000);
    await rejected;
    expect(fetchMock.mock.calls.filter(([input]) => requestUrl(input).includes('/provisioning-jobs/app-prov-async?'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'POST')).toHaveLength(1);
    expect(await readFile(join(env.dir, '.env.local'), 'utf-8')).toBe(originalEnv);
    await expect(readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test.each([
    [401, { detail: { error: 'EXTERNAL_SERVICE_ERROR' } }],
    [403, { detail: { error: 'EXTERNAL_SERVICE_ERROR' } }],
    [404, { detail: { error: 'APP_PROVISIONING_JOB_NOT_FOUND' } }],
    [409, { detail: { error: 'APP_PROVISIONING_JOB_CHANGED' } }],
    [422, { detail: { error: 'EXTERNAL_SERVICE_ERROR' } }],
    [500, { detail: { error: 'EXTERNAL_SERVICE_ERROR' } }],
    [502, { detail: { error: 'UNRECOGNIZED_ERROR' } }],
    [502, { message: 'EXTERNAL_SERVICE_ERROR' }],
    [503, { detail: { error: 'EXTERNAL_SERVICE_ERROR' } }],
    [504, { detail: { error: 'EXTERNAL_SERVICE_ERROR' } }],
    [502, { ...appJobFixture('failed'), detail: { error: 'EXTERNAL_SERVICE_ERROR' } }],
  ])('provision does not retry unqualified HTTP %s job reads (%j)', async (status, body) => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const originalEnv = await readFile(join(env.dir, '.env.local'), 'utf-8');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-exit'); });
    const fetchMock = mockProvisioningJob(() => jsonResponse(body, status as number));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const rejected = expect(appCommand.parseAsync(provisionArgs, { from: 'user' })).rejects.toThrow('fixture-exit');
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => requestMethod(init) === 'POST')).toBe(true));
    await vi.advanceTimersByTimeAsync(2_000);
    await rejected;
    expect(fetchMock.mock.calls.filter(([input]) => requestUrl(input).includes('/provisioning-jobs/app-prov-async?'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, init]) => requestMethod(init) === 'POST')).toHaveLength(1);
    expect(await readFile(join(env.dir, '.env.local'), 'utf-8')).toBe(originalEnv);
    await expect(readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
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

  test('provisions the parent-owned app for its runtime child only after the exact job is ready', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const childTenantId = 'child-tenant';
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);
      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({ tenants: [
          { id: COMPANY_TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'] },
          { id: childTenantId, displayName: 'App Runtime', slug: 'app-runtime', isActive: true, roles: ['tenant-admin'] },
        ] });
      }
      if (url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`) && method === 'GET') {
        return jsonResponse({ docs: [{ id: 'app-1', data: { tenantId: COMPANY_TENANT_ID, verticalKey: 'planning-portal' }, version: 1 }] });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs` && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toEqual({ targetTenantId: childTenantId });
        return jsonResponse({ tenantId: COMPANY_TENANT_ID, appKey: 'planning-portal', verticalKey: 'planning-portal',
          jobId: 'job-child-1', status: 'running', steps: [], enrollment: { childTenantId } });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs/job-child-1?targetTenantId=${childTenantId}` && method === 'GET') {
        return jsonResponse({ tenantId: COMPANY_TENANT_ID, appKey: 'planning-portal', jobId: 'job-child-1', status: 'ready',
          enrollment: { childTenantId, metadata: { appProvisioning: { storageBindingAllowList: { postgresql: { aliases: ['tenant-postgres'] } } } } },
        });
      }
      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync(['provision', 'planning-portal', '--tenant-id', childTenantId,
      '--app-tenant-id', COMPANY_TENANT_ID, '--select', '--format', 'json'], { from: 'user' });

    const storageContract = JSON.parse(await readFile(join(env.dir, '.eai', 'storage-bindings.json'), 'utf-8'));
    expect(storageContract).toMatchObject({ tenantId: childTenantId, appKey: 'planning-portal', source: { provisioningJobId: 'job-child-1' } });
    expect(storageContract.storageNamePrefixes.sql).toContain('childtenant_planning_portal_');
    const envFile = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(envFile).toContain(`EAI_TENANT_ID=${childTenantId}`);
    expect(envFile).toContain(`NEXT_PUBLIC_EAI_TENANT_ID=${childTenantId}`);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining(`/v4/platform/tenants/${childTenantId}/apps/planning-portal/provisioning-jobs`), expect.anything());
  });

  test('resumes the exact parent-owned job without posting another provisioning job', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const childTenantId = 'child-tenant';
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      if (url === `${API_BASE}/v4/identity/tenants`) {
        return jsonResponse({ tenants: [
          { id: COMPANY_TENANT_ID, displayName: 'Builder Workspace', isActive: true, roles: ['tenant-admin'] },
          { id: childTenantId, displayName: 'App Runtime', isActive: true, roles: ['tenant-admin'] },
        ] });
      }
      if (url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)) {
        return jsonResponse({ docs: [{ id: 'app-1', data: { tenantId: COMPANY_TENANT_ID, verticalKey: 'planning-portal' }, version: 1 }] });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs/job-child-1?targetTenantId=${childTenantId}`
        && requestMethod(init) === 'GET') {
        return jsonResponse({ tenantId: COMPANY_TENANT_ID, appKey: 'planning-portal', jobId: 'job-child-1', status: 'ready',
          enrollment: { metadata: { childTenantId, appProvisioning: { storageBindingAllowList: { postgresql: { aliases: ['tenant-postgres'] } } } } },
        });
      }
      return jsonResponse({ message: `Unexpected ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync(['provision', 'planning-portal', '--tenant-id', childTenantId,
      '--app-tenant-id', COMPANY_TENANT_ID, '--job-id', 'job-child-1', '--select', '--format', 'json'], { from: 'user' });

    expect(fetchMock.mock.calls.some(([url, init]) =>
      requestUrl(url).includes('/provisioning-jobs') && requestMethod(init) === 'POST')).toBe(false);
    expect(JSON.parse(await readFile(join(env.dir, '.eai', 'storage-bindings.json'), 'utf-8')))
      .toMatchObject({ tenantId: childTenantId, source: { provisioningJobId: 'job-child-1' } });
  });

  test('keeps polling the same bound job beyond three minutes before writing local bindings', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const childTenantId = 'child-tenant';
    let jobStartedAt = 0;
    let signalJobStarted!: () => void;
    const jobStarted = new Promise<void>((resolve) => { signalJobStarted = resolve; });
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      if (url === `${API_BASE}/v4/identity/tenants`) {
        return jsonResponse({ tenants: [
          { id: COMPANY_TENANT_ID, displayName: 'Builder Workspace', isActive: true, roles: ['tenant-admin'] },
          { id: childTenantId, displayName: 'App Runtime', isActive: true, roles: ['tenant-admin'] },
        ] });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs`
        && requestMethod(init) === 'POST') {
        jobStartedAt = Date.now();
        signalJobStarted();
        return jsonResponse({ tenantId: COMPANY_TENANT_ID, appKey: 'planning-portal', verticalKey: 'planning-portal',
          jobId: 'job-slow-1', status: 'running', steps: [], enrollment: { childTenantId } });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs/job-slow-1?targetTenantId=${childTenantId}`
        && requestMethod(init) === 'GET') {
        return jsonResponse({ tenantId: COMPANY_TENANT_ID, appKey: 'planning-portal', jobId: 'job-slow-1',
          status: Date.now() - jobStartedAt > 180_000 ? 'ready' : 'running',
          enrollment: { childTenantId },
        });
      }
      return jsonResponse({ message: `Unexpected ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    try {
      const provision = appCommand.parseAsync(['provision', 'planning-portal', '--tenant-id', childTenantId,
        '--app-tenant-id', COMPANY_TENANT_ID, '--skip-validate', '--format', 'json'], { from: 'user' });
      await jobStarted;
      await vi.advanceTimersByTimeAsync(182_000);
      await provision;
    } finally {
      vi.useRealTimers();
    }

    expect(fetchMock.mock.calls.filter(([url, init]) =>
      requestUrl(url).includes('/provisioning-jobs') && requestMethod(init) === 'POST')).toHaveLength(1);
    expect(JSON.parse(await readFile(join(env.dir, '.eai', 'storage-bindings.json'), 'utf-8')))
      .toMatchObject({ tenantId: childTenantId, source: { provisioningJobId: 'job-slow-1' } });
  }, 15_000);

  test.each([
    { binding: 'another runtime child', enrollment: { childTenantId: 'another-child' } },
    { binding: 'conflicting nested child', enrollment: { childTenantId: 'child-tenant', metadata: { childTenantId: 'another-child' } } },
  ])('rejects a ready parent job bound to $binding without local writes', async ({ enrollment }) => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const childTenantId = 'child-tenant';
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url === `${API_BASE}/v4/identity/tenants`) {
        return jsonResponse({ tenants: [
          { id: COMPANY_TENANT_ID, displayName: 'Builder Workspace', isActive: true, roles: ['tenant-admin'] },
          { id: childTenantId, displayName: 'App Runtime', isActive: true, roles: ['tenant-admin'] },
        ] });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs/job-child-1?targetTenantId=${childTenantId}`) {
        return jsonResponse({ tenantId: COMPANY_TENANT_ID, appKey: 'planning-portal', jobId: 'job-child-1', status: 'ready',
          enrollment,
        });
      }
      return jsonResponse({ message: `Unexpected ${url}` }, 500);
    }));

    await expect(appCommand.parseAsync(['provision', 'planning-portal', '--tenant-id', childTenantId,
      '--app-tenant-id', COMPANY_TENANT_ID, '--job-id', 'job-child-1', '--select', '--format', 'json'], { from: 'user' }))
      .rejects.toThrow('fixture-process-exit');
    await expect(readFile(join(env.dir, '.eai', 'storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(env.dir, '.env.local'), 'utf-8')).not.toContain('EAI_APP_KEY=');
  });

  test('does not write child bindings or selection when the exact provisioning job fails', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const childTenantId = 'child-tenant';
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);
      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({ tenants: [
          { id: COMPANY_TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'] },
          { id: childTenantId, displayName: 'App Runtime', slug: 'app-runtime', isActive: true, roles: ['tenant-admin'] },
        ] });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs` && method === 'POST') {
        return jsonResponse({ tenantId: COMPANY_TENANT_ID, appKey: 'planning-portal', verticalKey: 'planning-portal',
          jobId: 'job-child-2', status: 'running', steps: [], enrollment: { childTenantId } });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs/job-child-2?targetTenantId=${childTenantId}` && method === 'GET') {
        return jsonResponse({ tenantId: COMPANY_TENANT_ID, appKey: 'planning-portal', verticalKey: 'planning-portal',
          jobId: 'job-child-2', status: 'failed', steps: [], enrollment: { childTenantId } });
      }
      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(appCommand.parseAsync(['provision', 'planning-portal', '--tenant-id', childTenantId,
      '--app-tenant-id', COMPANY_TENANT_ID, '--skip-validate', '--select', '--format', 'json'], { from: 'user' }))
      .rejects.toThrow('fixture-process-exit');
    await expect(readFile(join(env.dir, '.eai', 'storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    const envFile = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(envFile).not.toContain('EAI_APP_KEY=');
    expect(envFile).not.toContain('EAI_TENANT_ID=');
  });

  test('keeps local selection untouched when the parent app job returns the original 404', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      if (url === `${API_BASE}/v4/identity/tenants`) {
        return jsonResponse({ tenants: [{ id: 'child-tenant', displayName: 'App Runtime', slug: 'app-runtime', isActive: true, roles: ['tenant-admin'] }] });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs` && requestMethod(init) === 'POST') {
        return jsonResponse({ message: 'App enrollment not found' }, 404);
      }
      return jsonResponse({ message: `Unexpected ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(appCommand.parseAsync(['provision', 'planning-portal', '--tenant-id', 'child-tenant',
      '--app-tenant-id', COMPANY_TENANT_ID, '--skip-validate', '--select', '--format', 'json'], { from: 'user' }))
      .rejects.toThrow('fixture-process-exit');
    await expect(readFile(join(env.dir, '.eai', 'storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(env.dir, '.env.local'), 'utf-8')).not.toContain('EAI_APP_KEY=');
  });

  test('rejects a backend-specific actual job instead of silently ignoring the requested backend', async () => {
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(appCommand.parseAsync(['provision', 'planning-portal', '--tenant-id', 'child-tenant',
      '--backend', 'postgresql', '--format', 'json'], { from: 'user' }))
      .rejects.toThrow('fixture-process-exit');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    { jobId: 'another-job' },
    { tenantId: 'another-parent' },
    { appKey: 'another-app' },
    { verticalKey: 'another-app' },
    { enrollment: undefined },
  ])('rejects a resumed parent job with changed authority %j without local writes or POST replay', async mismatch => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const childTenantId = 'child-tenant';
    const envPath = join(env.dir, '.env.local');
    const originalEnv = await readFile(envPath, 'utf-8');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
    const fetchMock = vi.fn<typeof fetch>(async (input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url === `${API_BASE}/v4/identity/tenants`) {
        return jsonResponse({ tenants: [{ id: childTenantId, roles: ['tenant-admin'] }] });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs/job-child-1?targetTenantId=${childTenantId}`) {
        return jsonResponse({ tenantId: COMPANY_TENANT_ID, appKey: 'planning-portal', verticalKey: 'planning-portal',
          jobId: 'job-child-1', status: 'ready', steps: [], enrollment: { metadata: { childTenantId } }, ...mismatch });
      }
      return jsonResponse({ message: `Unexpected ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(appCommand.parseAsync(['provision', 'planning-portal', '--tenant-id', childTenantId,
      '--app-tenant-id', COMPANY_TENANT_ID, '--job-id', 'job-child-1', '--skip-validate', '--select', '--format', 'json'], { from: 'user' }))
      .rejects.toThrow('fixture-process-exit');

    expect(await readFile(envPath, 'utf-8')).toBe(originalEnv);
    await expect(readFile(join(env.dir, '.eai/storage-bindings.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fetchMock.mock.calls.every(([, init]) => requestMethod(init) !== 'POST')).toBe(true);
  });

  test('rejects an explicit runtime that disagrees with the parent enrollment before storage planning', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const originalEnv = await readFile(join(env.dir, '.env.local'), 'utf-8');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fixture-process-exit'); });
    const fetchMock = vi.fn<typeof fetch>(async (input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url === `${API_BASE}/v4/identity/tenants`) return jsonResponse({ tenants: [{ id: 'child-tenant', roles: ['tenant-admin'] }] });
      if (url.includes(`/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)) {
        return jsonResponse({ docs: [{ data: { verticalKey: 'planning-portal', metadata: { childTenantId: 'another-child' } } }] });
      }
      return jsonResponse({ message: `Unexpected ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(appCommand.parseAsync(['provision', 'planning-portal', '--tenant-id', 'child-tenant',
      '--app-tenant-id', COMPANY_TENANT_ID, '--dry-run', '--select', '--format', 'json'], { from: 'user' }))
      .rejects.toThrow('fixture-process-exit');
    expect(fetchMock.mock.calls.every(([, init]) => requestMethod(init) !== 'POST')).toBe(true);
    expect(await readFile(join(env.dir, '.env.local'), 'utf-8')).toBe(originalEnv);
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

  describe('deploy-source-unknown refusal output (#3502)', () => {
    async function runDeploySourceUnknownRefused(status: number, body: unknown): Promise<string> {
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
          url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/deploy`
          && method === 'POST'
        ) {
          return typeof body === 'string'
            ? new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
            : jsonResponse(body, status);
        }
        return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(appCommand.parseAsync([
        'deploy-source-unknown', 'planning-portal', '--tenant-id', COMPANY_TENANT_ID,
        '--operation-id', 'source-unknown-op', '--skip-validate',
      ], { from: 'user' })).rejects.toThrow('process.exit unexpectedly called');

      expect(fetchMock).toHaveBeenCalledWith(
        `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/deploy`,
        expect.objectContaining({ method: 'POST' }),
      );
      return vi.mocked(console.error).mock.calls.map((call) => call.join(' ')).join('\n');
    }

    const creditsBody = {
      error: 'CREDITS_EXHAUSTED',
      message: 'This workspace has run out of credits.',
      billingWorkspaceId: 'billing-workspace-1',
      recovery: { portalPath: '/plan-and-billing' },
    };

    test.each([
      ['a top-level error code', creditsBody],
      ['an error code under detail', { detail: creditsBody }],
      ['a code with no message or recovery', { error: 'CREDITS_EXHAUSTED' }],
    ])('prints the shared credits sentence, not raw JSON, for a 402 CREDITS_EXHAUSTED with %s', async (_label, body) => {
      const printed = await runDeploySourceUnknownRefused(402, body);

      expect(printed).toContain(CREDITS_EXHAUSTED_NEXT_ACTION);
      expect(printed).toContain(creditsExhaustedNextAction(402, 'CREDITS_EXHAUSTED'));
      expect(printed).toContain('Plan and Billing');
      expect(printed).not.toContain('{');
      expect(printed).not.toContain('billing-workspace-1');
      expect(printed).not.toContain('portalPath');
    });

    test.each([
      ['a 402 with another error code', 402, { error: 'PLAN_LIMIT_REACHED', message: 'Plan limit reached for this workspace.' }, 'Plan limit reached for this workspace.'],
      ['a 402 with no error code', 402, { message: 'Payment required.' }, 'Payment required.'],
      ['a plain-text 402', 402, 'Payment required upstream.', 'Payment required upstream.'],
      ['a 500 that carries the credits code', 500, { error: 'CREDITS_EXHAUSTED', message: 'Something broke on the server.' }, 'Something broke on the server.'],
    ])('keeps the server message for %s', async (_label, status, body, message) => {
      const printed = await runDeploySourceUnknownRefused(status, body);

      expect(printed).toMatch(new RegExp(`${message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
      expect(printed).not.toContain('Plan and Billing');
      expect(printed).not.toContain('run out of credits');
      expect(printed).not.toContain('eai deploy doctor');
    });
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
