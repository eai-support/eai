/**
 * Integration tests for eai provision entra
 *
 * Tests the happy path, existing registration path, and HTTP error paths.
 * Uses MSW to intercept HTTP calls and in-process command invocation.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMockServer } from '../helpers/mock-server.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { storeTokens, clearTokens } from '../../src/lib/auth.js';
import { provisionCommand } from '../../src/commands/provision.js';
import { getActiveProfile, setActiveProfile } from '../../src/lib/profile.js';
import { DEFAULT_PUBLIC_API_URL } from '../../src/lib/tenant-context.js';

const API_BASE = 'https://test-api.example.com';
const EU_API_BASE = 'https://api.eu.myenterprise.ai/public';
const PROFILE_API_BASE = 'https://profile-test.example.test/public';
const DEV_PROFILE_API_BASE = 'https://profile-dev.example.test/public';
const PROD_AUTH_TENANT_NAME = 'enterpriseaiplatform';
const PROD_AUTH_TENANT_ID = 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26';
const PROD_AUTH_CLIENT_ID = 'd704bde5-fe36-44ff-9a26-221d53772dd0';
const EXAMPLE_AUTH_TENANT_NAME = 'example-ciam';
const EXAMPLE_AUTH_TENANT_ID = '00000000-0000-4000-8000-000000000001';
const EXAMPLE_PUBLIC_API_SCOPE = 'api://00000000-0000-4000-8000-000000000002/.default';
const EXAMPLE_CLI_CLIENT_ID = '00000000-0000-4000-8000-000000000003';
const TENANT_AUTH_ADDED = {
  tenant_authorization: {
    added: true,
    already_authorized: false,
    warning: null,
  },
};
const TENANT_AUTH_EXISTING = {
  tenant_authorization: {
    added: false,
    already_authorized: true,
    warning: null,
  },
};

function createJwt(payload: Record<string, string>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

function setTestHome(dir: string): void {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
}

async function setupProject(dir: string): Promise<void> {
  await mkdir(join(dir, 'src', 'eai.config'), { recursive: true });
  await writeFile(join(dir, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
  await writeFile(
    join(dir, '.env.local'),
    `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-app\n`,
  );
}

async function storeTestTokens(
  dir: string,
  overrides?: Partial<Parameters<typeof storeTokens>[0]>,
): Promise<void> {
  setTestHome(dir);
  await storeTokens({
    accessToken: overrides?.accessToken ?? '<fixture-access-token>',
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
    ...overrides,
  });
}

function joinedConsoleOutput(...spies: Array<{ mock: { calls: unknown[][] } }>): string {
  return spies.flatMap((spy) => spy.mock.calls.flat()).join(' ');
}

function expectNoProvisionInternals(output: string): void {
  expect(output).not.toContain(API_BASE);
  expect(output).not.toContain('/v4/platform/provisioning/entra-apps');
  expect(output).not.toContain('POST ');
  expect(output).not.toContain('PublicAPI');
  expect(output).not.toContain('AdminAPI');
  expect(output).not.toContain('tenant_not_found');
  expect(output).not.toContain('test-tenant-id');
  expect(output).not.toContain('Tenant test-tenant-id was not found');
  expect(output).not.toContain('not implemented');
}

describe('eai provision entra', () => {
  let env: TestEnvironment;
  let mockServer: ReturnType<typeof createMockServer>;
  let originalCwd: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalAccessToken: string | undefined;
  let originalProfile: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalAccessToken = process.env.EAI_ACCESS_TOKEN;
    originalProfile = getActiveProfile();

    env = await createTestEnvironment();
    mockServer = createMockServer();
    mockServer.start();

    process.env.EAI_ACCESS_TOKEN = '<fixture-access-token>';
    await storeTestTokens(env.dir);
    await setupProject(env.dir);
    process.chdir(env.dir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    mockServer.stop();
    await clearTokens();
    setActiveProfile(originalProfile);
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

  test('happy path: writes ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET to .env.local', { timeout: 10000 }, async () => {
    let requestBody: unknown;

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({
          client_id: 'cid-1',
          client_secret: '<fixture-client-secret>',
          existing: false,
          ...TENANT_AUTH_ADDED,
        });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      app_name: 'my-app',
      redirect_uris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=cid-1');
    expect(content).toContain('ENTRA_CLIENT_SECRET=<fixture-client-secret>');
    expect(content).toContain('AUTH_URL=http://localhost:3000');
    expect(content).toContain('NEXTAUTH_URL=http://localhost:3000');
    expect(content).toContain('AUTH_TRUST_HOST=true');
    expect(content).toContain('NEXT_PUBLIC_APP_NAME=my-app');
  });

  test('--redirect-uri registers deployed callbacks alongside the local one', { timeout: 10000 }, async () => {
    let requestBody: unknown;
    const deployed = 'https://abc.com/api/auth/callback/microsoft-entra-id';

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({
          client_id: 'cid-1',
          client_secret: '<fixture-client-secret>',
          existing: false,
          ...TENANT_AUTH_ADDED,
        });
      }),
    );

    await provisionCommand.parseAsync(['entra', '--redirect-uri', deployed], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      app_name: 'my-app',
      redirect_uris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id', deployed],
      idempotent: true,
    });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain(
      `ENTRA_REDIRECT_URIS=http://localhost:3000/api/auth/callback/microsoft-entra-id ${deployed}`,
    );
  });

  test('HP001 provision entra basePath projects register and persist matching Auth.js URLs', { timeout: 10000 }, async () => {
    await writeFile(
      join(env.dir, '.env.local'),
      [
        `BASE_URL_PUBLIC_API=${API_BASE}`,
        'NEXT_PUBLIC_APP_NAME=no-code-builder',
        'APP_BASE_PATH=/no-code-builder',
        'NEXTAUTH_URL=http://localhost:3000',
        '',
      ].join('\n'),
    );

    let requestBody: unknown;

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({
          client_id: 'cid-basepath',
          client_secret: '<fixture-basepath-credential>',
          existing: false,
          redirectUris: ['http://localhost:3000/no-code-builder/api/auth/callback/microsoft-entra-id'],
          ...TENANT_AUTH_ADDED,
        });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      app_name: 'no-code-builder',
      redirect_uris: ['http://localhost:3000/no-code-builder/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('AUTH_URL=http://localhost:3000/no-code-builder/api/auth');
    expect(content).toContain('NEXTAUTH_URL=http://localhost:3000/no-code-builder');
    expect(content).toContain('ENTRA_REDIRECT_URIS=http://localhost:3000/no-code-builder/api/auth/callback/microsoft-entra-id');
  });

  test('HP002 provision entra persists requested callback when platform response contains stale defaults', { timeout: 10000 }, async () => {
    await writeFile(
      join(env.dir, '.env.local'),
      [
        `BASE_URL_PUBLIC_API=${API_BASE}`,
        'NEXT_PUBLIC_APP_NAME=no-code-builder',
        'APP_BASE_PATH=/no-code-builder',
        'AUTH_URL=http://localhost:3000/no-code-builder',
        'ENTRA_CLIENT_SECRET=<fixture-existing-credential>',
        'ENTRA_REDIRECT_URIS=http://localhost:3000/api/auth/callback/microsoft-entra-id',
        '',
      ].join('\n'),
    );

    let requestBody: unknown;

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({
          client_id: 'cid-stale-response',
          client_secret: null,
          existing: true,
          redirectUris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
          ...TENANT_AUTH_EXISTING,
        });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      app_name: 'no-code-builder',
      redirect_uris: ['http://localhost:3000/no-code-builder/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('AUTH_URL=http://localhost:3000/no-code-builder/api/auth');
    expect(content).toContain('NEXTAUTH_URL=http://localhost:3000/no-code-builder');
    expect(content).toContain('ENTRA_REDIRECT_URIS=http://localhost:3000/no-code-builder/api/auth/callback/microsoft-entra-id');
  });

  test('BP001 provision entra falls back to localhost basePath when Auth.js URL is malformed', { timeout: 10000 }, async () => {
    await writeFile(
      join(env.dir, '.env.local'),
      [
        `BASE_URL_PUBLIC_API=${API_BASE}`,
        'NEXT_PUBLIC_APP_NAME=no-code-builder',
        'APP_BASE_PATH=/no-code-builder',
        'NEXTAUTH_URL=not-a-url',
        '',
      ].join('\n'),
    );

    let requestBody: unknown;

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({
          client_id: 'cid-bad-url',
          client_secret: '<fixture-bad-url-credential>',
          existing: false,
          redirectUris: ['http://localhost:3000/no-code-builder/api/auth/callback/microsoft-entra-id'],
          ...TENANT_AUTH_ADDED,
        });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      app_name: 'no-code-builder',
      redirect_uris: ['http://localhost:3000/no-code-builder/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('AUTH_URL=http://localhost:3000/no-code-builder/api/auth');
    expect(content).toContain('NEXTAUTH_URL=http://localhost:3000/no-code-builder');
  });

  test('storage provisioning dogfoods the PublicAPI provision route', { timeout: 10000 }, async () => {
    let requestBody: unknown;

    mockServer.server.use(
      http.post(`${API_BASE}/v4/data/resources/test-tenant-id/storage/provision`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({
          tenantId: 'test-tenant-id',
          dryRun: true,
          results: [
            {
              objectType: 'Customer',
              backend: 'documentdb',
              status: 'planned',
              actions: ['create_collection'],
            },
          ],
        });
      }),
    );

    await provisionCommand.parseAsync([
      'storage',
      '--backend',
      'mongodb',
      '--dry-run',
      '--rebuild-search',
      '--format',
      'json',
    ], { from: 'user' });

    expect(requestBody).toEqual({
      backend: 'documentdb',
      dry_run: true,
      rebuild_search: true,
      provisioning_mode: 'dedicated-tenant-storage',
    });
  });

  test('resourceapi bundle provisioning uses the PublicAPI v4 passive route', { timeout: 10000 }, async () => {
    let requestBody: unknown;

    mockServer.server.use(
      http.get(`${API_BASE}/v4/identity/tenants`, async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer <fixture-access-token>');
        return HttpResponse.json({
          tenants: [
            {
              id: 'test-tenant-id',
              displayName: 'Test Tenant',
              slug: 'test-tenant',
              isActive: true,
              roles: ['tenant-admin'],
              isTenantAdmin: true,
              homeRegion: 'au',
              hqCountryCode: 'AU',
            },
          ],
        });
      }),
      http.post(
        `${DEFAULT_PUBLIC_API_URL}/v4/platform/tenants/test-tenant-id/resourceapi/passive-bundle`,
        async ({ request }) => {
          expect(request.headers.get('authorization')).toBe('Bearer <fixture-access-token>');
          requestBody = await request.json();
          return HttpResponse.json({
            tenantId: 'test-tenant-id',
            installId: 'install-1',
            objectTypeCount: 2,
            storageBackends: ['documentdb', 'search'],
            bundle: { tenantId: 'test-tenant-id' },
            applyResult: { results: [] },
          });
        },
      ),
    );

    await provisionCommand.parseAsync([
      'resourceapi-bundle',
      '--tenant-id',
      'test-tenant-id',
      '--install-id',
      'install-1',
      '--product',
      'daisy-assist',
      '--schema-version',
      '42',
      '--apply',
      '--dry-run',
      '--backend',
      'all',
      '--rebuild-search',
      '--format',
      'json',
    ], { from: 'user' });

    expect(requestBody).toEqual({
      installId: 'install-1',
      productKey: 'daisy-assist',
      schemaVersion: '42',
      apply: true,
      dryRun: true,
      backend: 'all',
      rebuildSearch: true,
    });
  });

  test('resourceapi refresh uses the PublicAPI v4 super-admin repair route', { timeout: 10000 }, async () => {
    let requestBody: unknown;

    mockServer.server.use(
      http.get(`${API_BASE}/v4/identity/tenants`, async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer <fixture-access-token>');
        return HttpResponse.json({
          tenants: [
            {
              id: 'test-tenant-id',
              displayName: 'Test Tenant',
              slug: 'test-tenant',
              isActive: true,
              roles: ['tenant-admin'],
              isTenantAdmin: true,
              homeRegion: 'au',
              hqCountryCode: 'AU',
            },
          ],
        });
      }),
      http.post(
        `${DEFAULT_PUBLIC_API_URL}/v4/platform/tenants/test-tenant-id/resourceapi/passive-refresh`,
        async ({ request }) => {
          expect(request.headers.get('authorization')).toBe('Bearer <fixture-access-token>');
          requestBody = await request.json();
          return HttpResponse.json({
            tenantId: 'test-tenant-id',
            installId: 'install-1',
            schemaHash: 'snapshot-hash',
            objectTypeCount: 2,
            storageBackends: ['documentdb', 'search'],
            verified: true,
            installRegistryUpdated: true,
            currentDiff: { missingObjectTypes: ['tenant-common-config'] },
            verifyDiff: { missingObjectTypes: [], schemaHashMatches: true },
          });
        },
      ),
    );

    await provisionCommand.parseAsync([
      'resourceapi-refresh',
      '--tenant-id',
      'test-tenant-id',
      '--install-id',
      'install-1',
      '--product',
      'daisy-assist',
      '--schema-version',
      '42',
      '--apply',
      '--dry-run',
      '--backend',
      'all',
      '--rebuild-search',
      '--force-overwrite',
      '--reason',
      'Repair passive schema drift',
      '--format',
      'json',
    ], { from: 'user' });

    expect(requestBody).toEqual({
      installId: 'install-1',
      productKey: 'daisy-assist',
      schemaVersion: '42',
      apply: true,
      dryRun: true,
      backend: 'all',
      rebuildSearch: true,
      forceOverwrite: true,
      verify: true,
      updateInstallRegistry: true,
      reason: 'Repair passive schema drift',
    });
  });

  test('resourceapi refresh posts to the selected tenant regional PublicAPI URL', { timeout: 10000 }, async () => {
    let staleRegionHit = false;
    let regionalRequestBody: unknown;

    mockServer.server.use(
      http.get(`${API_BASE}/v4/identity/tenants`, async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer <fixture-access-token>');
        return HttpResponse.json({
          tenants: [
            {
              id: 'tenant-eu',
              displayName: 'EU Tenant',
              slug: 'eu-tenant',
              isActive: true,
              roles: ['tenant-admin'],
              isTenantAdmin: true,
              homeRegion: 'eu',
              hqCountryCode: 'DK',
            },
          ],
        });
      }),
      http.post(`${API_BASE}/v4/platform/tenants/tenant-eu/resourceapi/passive-refresh`, async () => {
        staleRegionHit = true;
        return HttpResponse.json({ ok: true });
      }),
      http.post(`${EU_API_BASE}/v4/platform/tenants/tenant-eu/resourceapi/passive-refresh`, async ({ request }) => {
        regionalRequestBody = await request.json();
        return HttpResponse.json({
          tenantId: 'tenant-eu',
          installId: 'install-1',
          schemaHash: 'snapshot-hash',
          objectTypeCount: 2,
          storageBackends: ['documentdb', 'search'],
          verified: true,
          installRegistryUpdated: true,
          currentDiff: { missingObjectTypes: [] },
          verifyDiff: { missingObjectTypes: [], schemaHashMatches: true },
        });
      }),
    );

    await provisionCommand.parseAsync([
      'resourceapi-refresh',
      '--tenant-id',
      'tenant-eu',
      '--install-id',
      'install-1',
      '--apply',
      '--dry-run',
      '--format',
      'json',
    ], { from: 'user' });

    expect(staleRegionHit).toBe(false);
    expect(regionalRequestBody).toEqual(expect.objectContaining({
      installId: 'install-1',
      apply: true,
      dryRun: true,
    }));
  });

  test('resourceapi bundle with schema and apply still mutates through PublicAPI v4', { timeout: 10000 }, async () => {
    let requestBody: unknown;
    await writeFile(
      join(env.dir, 'smoke-object-types.json'),
      JSON.stringify({
        objectTypes: [
          { slug: 'planning-application', status: 'published', storageBackend: 'mongo' },
          { slug: 'draft-only', status: 'draft', storageBackend: 'postgresql' },
        ],
      }),
    );

    mockServer.server.use(
      http.get(`${API_BASE}/v4/identity/tenants`, async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer <fixture-access-token>');
        return HttpResponse.json({
          tenants: [
            {
              id: 'test-tenant-id',
              displayName: 'Test Tenant',
              slug: 'test-tenant',
              isActive: true,
              roles: ['tenant-admin'],
              isTenantAdmin: true,
              homeRegion: 'au',
              hqCountryCode: 'AU',
            },
          ],
        });
      }),
      http.post(`${DEFAULT_PUBLIC_API_URL}/v4/platform/tenants/test-tenant-id/resourceapi/passive-bundle`, async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer <fixture-access-token>');
        requestBody = await request.json();
        return HttpResponse.json({
          tenantId: 'test-tenant-id',
          installId: 'install-1',
          objectTypeCount: 1,
          storageBackends: ['documentdb'],
          bundle: { tenantId: 'test-tenant-id', objectTypes: ['planning-application'] },
          applyResult: { results: [{ operation: 'apply', status: 'planned' }] },
        });
      }),
    );

    await provisionCommand.parseAsync([
      'resourceapi-bundle',
      '--schema',
      'smoke-object-types.json',
      '--tenant-id',
      'test-tenant-id',
      '--install-id',
      'install-1',
      '--apply',
      '--dry-run',
      '--backend',
      'all',
      '--rebuild-search',
      '--product',
      'daisy-assist',
      '--schema-version',
      '42',
      '--format',
      'json',
    ], { from: 'user' });

    expect(requestBody).toEqual({
      installId: 'install-1',
      productKey: 'daisy-assist',
      schemaVersion: '42',
      apply: true,
      dryRun: true,
      backend: 'all',
      rebuildSearch: true,
      objectTypes: ['planning-application'],
    });
  });

  test('resourceapi bundle posts to the selected tenant regional PublicAPI URL', { timeout: 10000 }, async () => {
    let staleRegionHit = false;
    let regionalRequestBody: unknown;

    mockServer.server.use(
      http.get(`${API_BASE}/v4/identity/tenants`, async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer <fixture-access-token>');
        return HttpResponse.json({
          tenants: [
            {
              id: 'tenant-eu',
              displayName: 'EU Tenant',
              slug: 'eu-tenant',
              isActive: true,
              roles: ['tenant-admin'],
              isTenantAdmin: true,
              homeRegion: 'eu',
              hqCountryCode: 'DK',
            },
          ],
        });
      }),
      http.post(`${API_BASE}/v4/platform/tenants/tenant-eu/resourceapi/passive-bundle`, async () => {
        staleRegionHit = true;
        return HttpResponse.json({ ok: true });
      }),
      http.post(`${EU_API_BASE}/v4/platform/tenants/tenant-eu/resourceapi/passive-bundle`, async ({ request }) => {
        regionalRequestBody = await request.json();
        return HttpResponse.json({
          tenantId: 'tenant-eu',
          installId: 'install-1',
          objectTypeCount: 1,
          storageBackends: ['documentdb'],
          bundle: { tenantId: 'tenant-eu' },
          applyResult: { results: [] },
        });
      }),
    );

    await provisionCommand.parseAsync([
      'resourceapi-bundle',
      '--tenant-id',
      'tenant-eu',
      '--install-id',
      'install-1',
      '--apply',
      '--dry-run',
      '--format',
      'json',
    ], { from: 'user' });

    expect(staleRegionHit).toBe(false);
    expect(regionalRequestBody).toEqual(expect.objectContaining({
      installId: 'install-1',
      apply: true,
      dryRun: true,
    }));
  });

  test('default profile provisions through the prod PublicAPI when no local API URL is configured', { timeout: 10000 }, async () => {
    await clearTokens();
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
    await writeFile(join(env.dir, '.env.local'), 'NEXT_PUBLIC_APP_NAME=my-app\n');

    let requestBody: unknown;
    let staleTokenApiHit = false;

    mockServer.server.use(
      http.post(`${DEFAULT_PUBLIC_API_URL}/v4/platform/provisioning/entra-apps`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({
          client_id: 'prod-client-id',
          client_secret: '<fixture-prod-credential>',
          existing: false,
          ...TENANT_AUTH_ADDED,
        });
      }),
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () => {
        staleTokenApiHit = true;
        return HttpResponse.json({ detail: 'stale token URL used' }, { status: 500 });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      app_name: 'my-app',
      redirect_uris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });
    expect(staleTokenApiHit).toBe(false);

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=prod-client-id');
    expect(content).toContain('ENTRA_CLIENT_SECRET=<fixture-prod-credential>');
  });

  test('existing registration: preserves .env.local keys and confirms ENTRA_CLIENT_ID when a local secret is already present', { timeout: 10000 }, async () => {
    await writeFile(
      join(env.dir, '.env.local'),
      `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-app\nENTRA_CLIENT_SECRET=<fixture-existing-credential>\nEXISTING_KEY=keep-me\n`,
    );

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () =>
        HttpResponse.json({
          client_id: 'cid-1',
          client_secret: null,
          existing: true,
          ...TENANT_AUTH_EXISTING,
        }),
      ),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=cid-1');
    expect(content).toContain('ENTRA_CLIENT_SECRET=<fixture-existing-credential>');
    expect(content).toContain('EXISTING_KEY=keep-me');
  });

  test('existing registration without a usable local secret exits with a rotate-secret instruction', { timeout: 10000 }, async () => {
    await writeFile(
      join(env.dir, '.env.local'),
      `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-app\nENTRA_CLIENT_SECRET=empty\n`,
    );

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () =>
        HttpResponse.json({
          client_id: 'cid-1',
          client_secret: null,
          existing: true,
          ...TENANT_AUTH_EXISTING,
        }),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra', '--force'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = joinedConsoleOutput(errSpy, logSpy);
    expect(output).toContain('No usable ENTRA_CLIENT_SECRET is available locally');
    expect(output).toContain('eai provision entra --rotate-secret');
  });

  test('placeholder ENTRA_CLIENT_ID values do not short-circuit provisioning', { timeout: 10000 }, async () => {
    let requestBody: unknown;

    await writeFile(
      join(env.dir, '.env.local'),
      `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-app\nENTRA_CLIENT_ID=empty\nENTRA_CLIENT_SECRET=empty\n`,
    );

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({
          client_id: 'fresh-client-id',
          client_secret: '<fixture-fresh-secret>',
          existing: false,
          ...TENANT_AUTH_ADDED,
        });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      app_name: 'my-app',
      redirect_uris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=fresh-client-id');
    expect(content).toContain('ENTRA_CLIENT_SECRET=<fixture-fresh-secret>');
  });

  test('tenant authorization warning exits before reporting provisioning as usable', { timeout: 10000 }, async () => {
    await writeFile(
      join(env.dir, '.env.local'),
      `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-app\nENTRA_CLIENT_SECRET=<fixture-existing-credential>\n`,
    );

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () =>
        HttpResponse.json({
          client_id: 'cid-tenant-blocked',
          client_secret: null,
          existing: true,
          tenant_authorization: {
            added: false,
            already_authorized: false,
            warning: 'tenant_authorize_status_404',
          },
        }),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra', '--force'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = joinedConsoleOutput(errSpy, warnSpy);
    expect(output).toContain('Tenant data-plane authorization incomplete');
    expect(output).toContain('tenant_authorize_status_404');
  });

  test('force re-checks an existing local ENTRA_CLIENT_ID without expecting a new secret', { timeout: 10000 }, async () => {
    let requestBody: unknown;

    await writeFile(
      join(env.dir, '.env.local'),
      `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-app\nENTRA_CLIENT_ID=local-client\nENTRA_CLIENT_SECRET=<fixture-existing-credential>\n`,
    );

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({
          client_id: 'local-client',
          client_secret: null,
          existing: true,
          ...TENANT_AUTH_EXISTING,
        });
      }),
    );

    await provisionCommand.parseAsync(['entra', '--force'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      app_name: 'my-app',
      redirect_uris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
      existing_client_id: 'local-client',
      idempotent: true,
    });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=local-client');
  });

  test('refuses to overwrite a local ENTRA_CLIENT_ID with a different platform registration', { timeout: 10000 }, async () => {
    await writeFile(
      join(env.dir, '.env.local'),
      `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-app\nENTRA_CLIENT_ID=local-client\nENTRA_CLIENT_SECRET=<fixture-existing-credential>\n`,
    );

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () =>
        HttpResponse.json({
          client_id: 'different-client',
          client_secret: '<fixture-new-secret>',
          existing: false,
          ...TENANT_AUTH_ADDED,
        }),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra', '--force'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = joinedConsoleOutput(errSpy, logSpy);
    expect(output).toContain('Platform returned a different Entra client id');
    expect(output).toContain('local-client');
    expect(output).toContain('different-client');

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=local-client');
    expect(content).toContain('ENTRA_CLIENT_SECRET=<fixture-existing-credential>');
    expect(content).not.toContain('different-client');
    expect(content).not.toContain('<fixture-new-secret>');
  });

  test('rotate-secret writes a new ENTRA_CLIENT_SECRET without creating a new app', { timeout: 10000 }, async () => {
    let rotateBody: unknown;
    let createEndpointHit = false;

    await writeFile(
      join(env.dir, '.env.local'),
      `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-app\nENTRA_CLIENT_ID=client-1\n`,
    );

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps/client-1/rotate-secret`, async ({ request }) => {
        rotateBody = await request.json();
        return HttpResponse.json({
          client_id: 'client-1',
          client_secret: '<fixture-rotated-credential>',
          tenant_id: 'test-tenant-id',
          expires_at: '2026-12-31T00:00:00Z',
        });
      }),
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () => {
        createEndpointHit = true;
        return HttpResponse.json({ detail: 'should not create' }, { status: 500 });
      }),
    );

    await provisionCommand.parseAsync(['entra', '--rotate-secret'], { from: 'user' });

    expect(rotateBody).toEqual({ tenant_id: 'test-tenant-id' });
    expect(createEndpointHit).toBe(false);

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=client-1');
    expect(content).toContain('ENTRA_CLIENT_SECRET=<fixture-rotated-credential>');
  });

  test('deauthorize refuses to clean up without explicit force', { timeout: 10000 }, async () => {
    await writeFile(
      join(env.dir, '.env.local'),
      `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-app\nENTRA_CLIENT_ID=client-1\nENTRA_CLIENT_SECRET=<fixture-existing-credential>\n`,
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra', '--deauthorize'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = joinedConsoleOutput(errSpy, logSpy);
    expect(output).toContain('Refusing to deauthorize without explicit confirmation');
    expect(output).toContain('eai provision entra --deauthorize --force');
  });

  test('deauthorize deletes the app registration and removes local Entra credentials', { timeout: 10000 }, async () => {
    let deleteBody: unknown;
    let createEndpointHit = false;

    await writeFile(
      join(env.dir, '.env.local'),
      [
        `BASE_URL_PUBLIC_API=${API_BASE}`,
        'NEXT_PUBLIC_APP_NAME=my-app',
        'ENTRA_CLIENT_ID=client-1',
        'ENTRA_CLIENT_SECRET=<fixture-existing-credential>',
        'EXISTING_KEY=keep-me',
        '',
      ].join('\n'),
    );

    mockServer.server.use(
      http.delete(`${API_BASE}/v4/platform/provisioning/entra-apps/client-1`, async ({ request }) => {
        deleteBody = await request.json();
        return HttpResponse.json({
          client_id: 'client-1',
          tenant_id: 'test-tenant-id',
          tenant_deauthorization: {
            removed: true,
            already_absent: false,
          },
          app_registration_found: true,
          app_registration_deleted: true,
        });
      }),
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () => {
        createEndpointHit = true;
        return HttpResponse.json({ detail: 'should not create' }, { status: 500 });
      }),
    );

    await provisionCommand.parseAsync(['entra', '--deauthorize', '--force'], { from: 'user' });

    expect(deleteBody).toEqual({
      tenant_id: 'test-tenant-id',
      delete_registration: true,
    });
    expect(createEndpointHit).toBe(false);

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).not.toContain('ENTRA_CLIENT_ID=');
    expect(content).not.toContain('ENTRA_CLIENT_SECRET=');
    expect(content).toContain('EXISTING_KEY=keep-me');
  });

  test('deauthorize keeps local credentials when explicit client id differs from project env', { timeout: 10000 }, async () => {
    await writeFile(
      join(env.dir, '.env.local'),
      [
        `BASE_URL_PUBLIC_API=${API_BASE}`,
        'NEXT_PUBLIC_APP_NAME=my-app',
        'ENTRA_CLIENT_ID=local-client',
        'ENTRA_CLIENT_SECRET=<fixture-existing-credential>',
        '',
      ].join('\n'),
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockServer.server.use(
      http.delete(`${API_BASE}/v4/platform/provisioning/entra-apps/other-client`, () => HttpResponse.json({
        client_id: 'other-client',
        tenant_id: 'test-tenant-id',
        tenant_deauthorization: {
          removed: true,
          already_absent: false,
        },
        app_registration_found: true,
        app_registration_deleted: true,
      })),
    );

    await provisionCommand.parseAsync(['entra', '--deauthorize', '--client-id', 'other-client', '--force'], { from: 'user' });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=local-client');
    expect(content).toContain('ENTRA_CLIENT_SECRET=<fixture-existing-credential>');
    expect(joinedConsoleOutput(warnSpy)).toContain('leaving .env.local unchanged');
  });

  test('named profile API URL overrides local env when provisioning', { timeout: 10000 }, async () => {
    setActiveProfile('test');
    await mkdir(join(env.dir, '.eai'), { recursive: true });
    await writeFile(
      join(env.dir, '.eai', 'config.json'),
      JSON.stringify({
        profiles: {
          test: {
            publicApiUrl: PROFILE_API_BASE,
            authTenantName: 'profile-test-tenant',
            authTenantId: 'test-ciam-tenant-id',
            authClientId: 'test-cli-client-id',
          },
        },
      }, null, 2),
    );
    await storeTestTokens(env.dir, {
      tenantName: 'profile-test-tenant',
      tenantId: 'test-ciam-tenant-id',
      clientId: 'test-cli-client-id',
    });

    let requestBody: unknown;

    mockServer.server.use(
      http.post(`${PROFILE_API_BASE}/v4/platform/provisioning/entra-apps`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({
          client_id: 'profile-client-id',
          client_secret: '<fixture-profile-credential>',
          existing: false,
          ...TENANT_AUTH_ADDED,
        });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      app_name: 'my-app',
      redirect_uris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });
  });

  test('dev profile provisions through the dev PublicAPI and ignores local env API URL', { timeout: 10000 }, async () => {
    setActiveProfile('dev');
    await mkdir(join(env.dir, '.eai'), { recursive: true });
    await writeFile(
      join(env.dir, '.eai', 'config.json'),
      JSON.stringify({
        profiles: {
          dev: {
            publicApiUrl: DEV_PROFILE_API_BASE,
            authTenantName: 'profile-dev-tenant',
            authTenantId: 'dev-ciam-tenant-id',
            authClientId: 'dev-cli-client-id',
          },
        },
      }, null, 2),
    );
    await storeTestTokens(env.dir, {
      tenantName: 'profile-dev-tenant',
      tenantId: 'dev-ciam-tenant-id',
      clientId: 'dev-cli-client-id',
    });

    let requestBody: unknown;

    mockServer.server.use(
      http.post(`${DEV_PROFILE_API_BASE}/v4/platform/provisioning/entra-apps`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({
          client_id: 'dev-client-id',
          client_secret: '<fixture-dev-credential>',
          existing: false,
          ...TENANT_AUTH_ADDED,
        });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      app_name: 'my-app',
      redirect_uris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });
  });

  test('tenant-context failures do not expose platform response details', { timeout: 10000 }, async () => {
    await storeTokens({
      accessToken: '<fixture-access-token>',
      refreshToken: '<fixture-refresh-token>',
      expiresAt: Date.now() + 3600000,
      upn: 'test@example.com',
      oid: 'test-oid',
      tenantId: PROD_AUTH_TENANT_ID,
      tenantName: PROD_AUTH_TENANT_NAME,
      clientId: PROD_AUTH_CLIENT_ID,
      publicApiUrl: API_BASE,
    });

    mockServer.server.use(
      http.get(`${API_BASE}/v4/identity/tenants`, () =>
        HttpResponse.json(
          { detail: 'Identity tenant membership lookup failed for tenant test-tenant-id' },
          { status: 500 },
        ),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = joinedConsoleOutput(errSpy, logSpy);
    expect(output).toContain('Failed to resolve active tenant.');
    expectNoProvisionInternals(output);
    expect(output).not.toContain('tenant membership lookup failed');
  });

  test('auth-config mismatch exits before tenant resolution with a re-login instruction', { timeout: 10000 }, async () => {
    await storeTokens({
      accessToken: createJwt({
        aud: '833fc5ab-f1c9-4c60-b344-64e366f241cc',
        preferred_username: 'test@example.com',
        oid: 'test-oid',
      }),
      refreshToken: '<fixture-refresh-token>',
      expiresAt: Date.now() + 3600000,
      upn: 'test@example.com',
      oid: 'test-oid',
      tenantId: 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26',
      tenantName: 'enterpriseaiplatform',
      clientId: 'd704bde5-fe36-44ff-9a26-221d53772dd0',
    });

    await writeFile(
      join(env.dir, '.env.local'),
      [
        `BASE_URL_PUBLIC_API=${API_BASE}`,
        'NEXT_PUBLIC_APP_NAME=my-app',
        `ENTRA_TENANT_NAME=${EXAMPLE_AUTH_TENANT_NAME}`,
        `ENTRA_TENANT_ID=${EXAMPLE_AUTH_TENANT_ID}`,
        `ENTRA_SCOPES=openid profile email offline_access ${EXAMPLE_PUBLIC_API_SCOPE}`,
        '',
      ].join('\n'),
    );
    process.env.EAI_CLI_CLIENT_ID = EXAMPLE_CLI_CLIENT_ID;

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = joinedConsoleOutput(errSpy, logSpy);
    expect(output).toContain('Stored CLI login does not match the active auth configuration');
    expect(output).toContain('Run `eai login` again');

    delete process.env.EAI_CLI_CLIENT_ID;
  });

  test('HTTP 403: exits with code 1 and reports permission denied', { timeout: 10000 }, async () => {
    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () =>
        HttpResponse.json({ error: 'forbidden' }, { status: 403 }),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('Permission denied');
  });

  test('HTTP 409: exits with code 1 and reports quota exceeded', { timeout: 10000 }, async () => {
    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () =>
        HttpResponse.json({ error: 'conflict' }, { status: 409 }),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('maximum number of app registrations');
  });

  test('HTTP 404: exits with code 1 and reports product-safe diagnostics', { timeout: 10000 }, async () => {
    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () =>
        HttpResponse.json(
          { error: { code: 'tenant_not_found', message: 'Tenant test-tenant-id was not found' } },
          { status: 404 },
        ),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = joinedConsoleOutput(errSpy, logSpy);
    expect(output).toContain('Entra provisioning is not available');
    expect(output).toContain('EAI-PROVISION-UNAVAILABLE');
    expect(output).toContain('Manual fallback');
    expectNoProvisionInternals(output);
  });

  test('HTTP 404 with --debug reports support-safe request diagnostics', { timeout: 10000 }, async () => {
    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () =>
        HttpResponse.json(
          { error: { code: 'tenant_not_found', message: 'Tenant test-tenant-id was not found' } },
          { status: 404, headers: { 'x-request-id': 'req-404' } },
        ),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra', '--debug'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = joinedConsoleOutput(errSpy, logSpy);
    expect(output).toContain('Entra provisioning is not available');
    expect(output).toContain('Request ID: req-404');
    expect(output).toContain('HTTP status: 404');
    expect(output).not.toContain('Server code');
    expectNoProvisionInternals(output);
  });

  test('HTTP 501: exits with code 1 and does not expose implementation details', { timeout: 10000 }, async () => {
    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () =>
        HttpResponse.text('not implemented', { status: 501 }),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = joinedConsoleOutput(errSpy, logSpy);
    expect(output).toContain('Entra provisioning is not available');
    expect(output).toContain('EAI-PROVISION-UNAVAILABLE');
    expectNoProvisionInternals(output);
  });

  test.each([
    ['missing client id', { client_secret: '<fixture-missing-client-credential>', existing: false }],
    ['empty client id', { client_id: '', client_secret: '<fixture-empty-client-credential>', existing: false }],
  ])('malformed success response with %s exits safely without writing credentials', async (_case, responseBody) => {
    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () =>
        HttpResponse.json(responseBody),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = joinedConsoleOutput(errSpy, logSpy);
    expect(output).toContain('Entra provisioning failed.');
    expectNoProvisionInternals(output);

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).not.toContain('ENTRA_CLIENT_ID=');
    expect(content).not.toContain('ENTRA_CLIENT_SECRET=');
  }, 10000);
});
