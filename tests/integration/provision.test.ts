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
const PROFILE_API_BASE = 'https://profile-test.example.test/public';
const DEV_PROFILE_API_BASE = 'https://profile-dev.example.test/public';

function setTestHome(dir: string): void {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
}

async function setupProject(dir: string): Promise<void> {
  await mkdir(join(dir, 'src', 'eai.config'), { recursive: true });
  await writeFile(join(dir, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
  await writeFile(
    join(dir, '.env.local'),
    `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-vertical\n`,
  );
}

async function storeTestTokens(dir: string): Promise<void> {
  setTestHome(dir);
  await storeTokens({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600000,
    upn: 'test@example.com',
    oid: 'test-oid',
    tenantId: 'test-tenant-id',
    tenantName: 'test-tenant',
    clientId: 'test-client-id',
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

    process.env.EAI_ACCESS_TOKEN = 'test-access-token';
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
        return HttpResponse.json({ client_id: 'cid-1', client_secret: 'secret-1', existing: false });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      vertical_name: 'my-vertical',
      redirect_uris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=cid-1');
    expect(content).toContain('ENTRA_CLIENT_SECRET=secret-1');
    expect(content).toContain('AUTH_URL=http://localhost:3000');
    expect(content).toContain('NEXTAUTH_URL=http://localhost:3000');
    expect(content).toContain('AUTH_TRUST_HOST=true');
    expect(content).toContain('NEXT_PUBLIC_APP_NAME=my-vertical');
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
          client_secret: 'secret-basepath',
          existing: false,
          redirectUris: ['http://localhost:3000/no-code-builder/api/auth/callback/microsoft-entra-id'],
        });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      vertical_name: 'no-code-builder',
      redirect_uris: ['http://localhost:3000/no-code-builder/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('AUTH_URL=http://localhost:3000/no-code-builder');
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
        });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      vertical_name: 'no-code-builder',
      redirect_uris: ['http://localhost:3000/no-code-builder/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('AUTH_URL=http://localhost:3000/no-code-builder');
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
          client_secret: 'secret-bad-url',
          existing: false,
          redirectUris: ['http://localhost:3000/no-code-builder/api/auth/callback/microsoft-entra-id'],
        });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      vertical_name: 'no-code-builder',
      redirect_uris: ['http://localhost:3000/no-code-builder/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('AUTH_URL=http://localhost:3000/no-code-builder');
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

  test('default profile provisions through the prod PublicAPI when no local API URL is configured', { timeout: 10000 }, async () => {
    await clearTokens();
    await storeTokens({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
      upn: 'test@example.com',
      oid: 'test-oid',
      tenantId: 'test-tenant-id',
      tenantName: 'test-tenant',
      clientId: 'test-client-id',
      activeTenantId: 'test-tenant-id',
      activeTenantName: 'Test Tenant',
      activeTenantSlug: 'test-tenant',
      publicApiUrl: API_BASE,
      membershipsCachedAt: Date.now(),
    });
    await writeFile(join(env.dir, '.env.local'), 'NEXT_PUBLIC_APP_NAME=my-vertical\n');

    let requestBody: unknown;
    let staleTokenApiHit = false;

    mockServer.server.use(
      http.post(`${DEFAULT_PUBLIC_API_URL}/v4/platform/provisioning/entra-apps`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ client_id: 'prod-client-id', client_secret: 'prod-secret', existing: false });
      }),
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () => {
        staleTokenApiHit = true;
        return HttpResponse.json({ detail: 'stale token URL used' }, { status: 500 });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      vertical_name: 'my-vertical',
      redirect_uris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });
    expect(staleTokenApiHit).toBe(false);

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=prod-client-id');
    expect(content).toContain('ENTRA_CLIENT_SECRET=prod-secret');
  });

  test('existing registration: preserves .env.local keys and confirms ENTRA_CLIENT_ID', { timeout: 10000 }, async () => {
    await writeFile(
      join(env.dir, '.env.local'),
      `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-vertical\nEXISTING_KEY=keep-me\n`,
    );

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, () =>
        HttpResponse.json({ client_id: 'cid-1', client_secret: null, existing: true }),
      ),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=cid-1');
    expect(content).toContain('EXISTING_KEY=keep-me');
  });

  test('force re-checks an existing local ENTRA_CLIENT_ID without expecting a new secret', { timeout: 10000 }, async () => {
    let requestBody: unknown;

    await writeFile(
      join(env.dir, '.env.local'),
      `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-vertical\nENTRA_CLIENT_ID=local-client\n`,
    );

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ client_id: 'remote-client', client_secret: null, existing: true });
      }),
    );

    await provisionCommand.parseAsync(['entra', '--force'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      vertical_name: 'my-vertical',
      redirect_uris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=remote-client');
  });

  test('rotate-secret writes a new ENTRA_CLIENT_SECRET without creating a new app', { timeout: 10000 }, async () => {
    let rotateBody: unknown;
    let createEndpointHit = false;

    await writeFile(
      join(env.dir, '.env.local'),
      `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-vertical\nENTRA_CLIENT_ID=client-1\n`,
    );

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/provisioning/entra-apps/client-1/rotate-secret`, async ({ request }) => {
        rotateBody = await request.json();
        return HttpResponse.json({
          client_id: 'client-1',
          client_secret: 'rotated-secret',
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
    expect(content).toContain('ENTRA_CLIENT_SECRET=rotated-secret');
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
    await storeTestTokens(env.dir);

    let requestBody: unknown;

    mockServer.server.use(
      http.post(`${PROFILE_API_BASE}/v4/platform/provisioning/entra-apps`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ client_id: 'profile-client-id', client_secret: 'profile-secret', existing: false });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      vertical_name: 'my-vertical',
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
    await storeTestTokens(env.dir);

    let requestBody: unknown;

    mockServer.server.use(
      http.post(`${DEV_PROFILE_API_BASE}/v4/platform/provisioning/entra-apps`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ client_id: 'dev-client-id', client_secret: 'dev-secret', existing: false });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      vertical_name: 'my-vertical',
      redirect_uris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });
  });

  test('tenant-context failures do not expose platform response details', { timeout: 10000 }, async () => {
    await storeTokens({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
      upn: 'test@example.com',
      oid: 'test-oid',
      tenantId: 'test-tenant-id',
      tenantName: 'test-tenant',
      clientId: 'test-client-id',
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
    ['missing client id', { client_secret: 'secret-without-client-id', existing: false }],
    ['empty client id', { client_id: '', client_secret: 'secret-with-empty-client-id', existing: false }],
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
