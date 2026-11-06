import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import { runCommand } from '../helpers/action-dsl.js';

function createJwt(payload: Record<string, string>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

const EXAMPLE_AUTH_TENANT_NAME = 'example-ciam';
const EXAMPLE_AUTH_TENANT_ID = '00000000-0000-4000-8000-000000000001';
const EXAMPLE_PUBLIC_API_SCOPE = 'api://00000000-0000-4000-8000-000000000002/.default';
const EXAMPLE_CLI_CLIENT_ID = '00000000-0000-4000-8000-000000000003';

const DEV_DIRECTORY = '50808ce0-f31b-4fd0-9861-74b83b8c112a';
const DEV_DIRECTORY_NAME = 'fixture-dev';
const DEV_PORTAL = 'https://dev-admin-portal.myenterprise.ai';
const PROD_PORTAL = 'https://admin-portal.myenterprise.ai';
const FIXTURE_SCOPE = `openid profile email offline_access ${EXAMPLE_PUBLIC_API_SCOPE}`;
const FIXTURE_COMPANY_CLIENT_ID = '00000000-0000-4000-8000-0000000000c1';
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** A browser-like GET; `headers.host` overrides the Host header for DNS-rebinding probes. */
async function httpGet(url: string, headers: Record<string, string> = {}): Promise<HttpResult> {
  const { request } = await import('node:http');

  return new Promise<HttpResult>((resolve, reject) => {
    const req = request(url, { method: 'GET', headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** What the Portal's 302 after the email form would send the browser to (lane D's side of the contract). */
function portalRouteUrl(portalUrl: URL, values: Record<string, string>): string {
  const route = new URL(`http://localhost:${portalUrl.searchParams.get('port')}/eai/route`);
  route.searchParams.set('state', portalUrl.searchParams.get('state') || '');
  for (const [key, value] of Object.entries(values)) route.searchParams.set(key, value);
  return route.toString();
}

/** What External ID's 302 back to the CLI would look like for an authorize request. */
function authorizeCallbackUrl(authorizeUrl: URL, values: Record<string, string> = {}): string {
  const callback = new URL(authorizeUrl.searchParams.get('redirect_uri') || '');
  callback.searchParams.set('code', 'fixture-auth-code');
  callback.searchParams.set('state', authorizeUrl.searchParams.get('state') || '');
  for (const [key, value] of Object.entries(values)) callback.searchParams.set(key, value);
  return callback.toString();
}

function tokenResponse(claims: Record<string, string>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({
    access_token: createJwt(claims),
    refresh_token: '<fixture-refresh-token>',
    expires_in: 3600,
    token_type: 'Bearer',
    ...extra,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function expectHardenedHeaders(result: HttpResult): void {
  expect(result.headers['cache-control']).toBe('no-store');
  expect(result.headers['referrer-policy']).toBe('no-referrer');
}

function useDevDirectoryEnv(): void {
  vi.stubEnv('EAI_AUTH_TENANT_NAME', DEV_DIRECTORY_NAME);
  vi.stubEnv('EAI_AUTH_TENANT_ID', DEV_DIRECTORY);
  vi.stubEnv('EAI_AUTH_SCOPE', FIXTURE_SCOPE);
  vi.stubEnv('EAI_CLI_CLIENT_ID', EXAMPLE_CLI_CLIENT_ID);
  vi.stubEnv('EAI_CLI_COMPANY_CLIENT_ID', FIXTURE_COMPANY_CLIENT_ID);
}

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

async function completeBrowserCallback(url: string): Promise<void> {
  const { get } = await import('node:http');

  await new Promise<void>((resolve, reject) => {
    const request = get(url, (response) => {
      response.resume();
      response.on('end', resolve);
    });
    request.on('error', reject);
  });
}

function mockBrowserLauncher(
  completeRedirect?: (authUrl: URL) => Promise<void>,
): void {
  vi.doMock('node:child_process', () => ({
    spawn: (_command: string, args: string[]) => {
      const child = new EventEmitter();

      queueMicrotask(async () => {
        try {
          const authUrl = new URL(args[args.length - 1]);
          if (completeRedirect) {
            await completeRedirect(authUrl);
          } else {
            const redirect = new URL(authUrl.searchParams.get('redirect_uri') || '');
            redirect.searchParams.set('code', 'test-auth-code');
            redirect.searchParams.set('state', authUrl.searchParams.get('state') || '');
            await completeBrowserCallback(redirect.toString());
          }
          child.emit('close', 0);
        } catch (error) {
          child.emit('error', error);
        }
      });

      return child;
    },
  }));
}

function mockBrowserLauncherFailure(): void {
  vi.doMock('node:child_process', () => ({
    spawn: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', 1));
      return child;
    },
  }));
}

function setTestHome(path: string): () => void {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = path;
  process.env.USERPROFILE = path;

  return () => {
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
  };
}

describe('eai login', () => {
  let env: TestEnvironment;
  let ctx: TestContext;
  let restoreTestHome: () => void;

  beforeEach(async () => {
    env = await createTestEnvironment();
    restoreTestHome = setTestHome(env.dir);
    ctx = {
      workingDir: env.dir,
      mockAPI: {} as TestContext['mockAPI'],
      env: {},
      prompts: [],
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.doUnmock('node:child_process');
    await env.cleanup();
    restoreTestHome();
  });

  test('help output excludes --client-id', async () => {
    const result = await runCommand(ctx, 'eai login --help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Authenticate with Entra CIAM');
    expect(result.stdout).toContain('sign-in directory');
    expect(result.stdout).toContain('--callback-port');
    expect(result.stdout).toContain('--switch-account');
    expect(result.stdout).toContain('--company');
    expect(result.stdout).toContain('--direct');
    expect(result.stdout).toContain('Admin Portal');
    expect(result.stdout).toContain('EAI_LOGIN_VIA_PORTAL=false');
    expect(result.stdout).toContain('both the Portal step and the sign-in callback');
    expect(result.stdout).not.toContain('--client-id');
    expect(result.stdout).not.toContain('--redirect-uri');
    expect(result.stdout).not.toContain('ENTRA_CLIENT_ID');
  });

  test('unknown --client-id option is rejected', async () => {
    const result = await runCommand(ctx, 'eai login --client-id abc123');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown option '--client-id'");
  });

  test('getBrowserOpenCommand preserves query params on supported platforms', async () => {
    vi.resetModules();
    const { getBrowserOpenCommand } = await import('../../src/lib/auth.js');
    const authUrl = 'https://example.ciamlogin.com/tenant/oauth2/v2.0/authorize?client_id=test-client&scope=openid+profile+email+offline_access&state=test-state';

    expect(getBrowserOpenCommand(authUrl, 'darwin')).toEqual({
      command: 'open',
      args: [authUrl],
    });
    expect(getBrowserOpenCommand(authUrl, 'linux')).toEqual({
      command: 'xdg-open',
      args: [authUrl],
    });
    expect(getBrowserOpenCommand(authUrl, 'win32')).toEqual({
      command: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', authUrl],
    });
  });

  test('default production auth scope includes PublicAPI audience', async () => {
    vi.resetModules();
    const { DEFAULT_PROD_AUTH_SCOPE, PROD_PUBLIC_API_SCOPE } = await import('../../src/lib/profile.js');

    expect(DEFAULT_PROD_AUTH_SCOPE).toContain('openid profile email offline_access');
    expect(DEFAULT_PROD_AUTH_SCOPE).toContain(PROD_PUBLIC_API_SCOPE);
    expect(PROD_PUBLIC_API_SCOPE).toBe('api://833fc5ab-f1c9-4c60-b344-64e366f241cc/access_token');
  });

  test('default profile resolves auth target from explicit CLI env overrides', async () => {
    process.env.EAI_AUTH_TENANT_NAME = EXAMPLE_AUTH_TENANT_NAME;
    process.env.EAI_AUTH_TENANT_ID = EXAMPLE_AUTH_TENANT_ID;
    process.env.EAI_AUTH_SCOPE = `openid profile email offline_access ${EXAMPLE_PUBLIC_API_SCOPE}`;
    process.env.EAI_CLI_CLIENT_ID = EXAMPLE_CLI_CLIENT_ID;

    vi.resetModules();
    const { resolveAuthConfig, validateResolvedAuthConfig } = await import('../../src/lib/auth.js');

    const config = await resolveAuthConfig();
    expect(config.tenantName).toBe(EXAMPLE_AUTH_TENANT_NAME);
    expect(config.tenantId).toBe(EXAMPLE_AUTH_TENANT_ID);
    expect(config.clientId).toBe(EXAMPLE_CLI_CLIENT_ID);
    expect(config.authScope).toBe(`openid profile email offline_access ${EXAMPLE_PUBLIC_API_SCOPE}`);
    expect(validateResolvedAuthConfig(config)).toBeNull();

    delete process.env.EAI_AUTH_TENANT_NAME;
    delete process.env.EAI_AUTH_TENANT_ID;
    delete process.env.EAI_AUTH_SCOPE;
    delete process.env.EAI_CLI_CLIENT_ID;
  });

  test('default profile flags explicit non-prod auth overrides without a CLI client ID', async () => {
    process.env.EAI_AUTH_TENANT_NAME = EXAMPLE_AUTH_TENANT_NAME;
    process.env.EAI_AUTH_TENANT_ID = EXAMPLE_AUTH_TENANT_ID;
    process.env.EAI_AUTH_SCOPE = `openid profile email offline_access ${EXAMPLE_PUBLIC_API_SCOPE}`;

    vi.resetModules();
    const { resolveAuthConfig, validateResolvedAuthConfig } = await import('../../src/lib/auth.js');

    const config = await resolveAuthConfig();
    expect(validateResolvedAuthConfig(config)).toContain('EAI_CLI_CLIENT_ID');

    delete process.env.EAI_AUTH_TENANT_NAME;
    delete process.env.EAI_AUTH_TENANT_ID;
    delete process.env.EAI_AUTH_SCOPE;
  });

  test('default profile ignores app .env.local auth runtime keys', async () => {
    await writeFile(
      join(env.dir, '.env.local'),
      [
        'ENTRA_TENANT_NAME=app-runtime-tenant',
        'ENTRA_TENANT_ID=11111111-1111-4111-8111-111111111111',
        'ENTRA_SCOPES="email offline_access openid profile"',
        'PUBLIC_API_SCOPE=api://app-runtime-publicapi/access_token',
        'BASE_URL_PUBLIC_API=https://test-api.example.com/public',
        '',
      ].join('\n'),
    );

    vi.resetModules();
    const [
      { resolveAuthConfig, validateResolvedAuthConfig },
      { DEFAULT_PROD_AUTH_CLIENT_ID, DEFAULT_PROD_AUTH_SCOPE, DEFAULT_PROD_AUTH_TENANT_ID, DEFAULT_PROD_AUTH_TENANT_NAME },
    ] = await Promise.all([
      import('../../src/lib/auth.js'),
      import('../../src/lib/profile.js'),
    ]);

    const config = await resolveAuthConfig(env.dir);
    expect(config.tenantName).toBe(DEFAULT_PROD_AUTH_TENANT_NAME);
    expect(config.tenantId).toBe(DEFAULT_PROD_AUTH_TENANT_ID);
    expect(config.clientId).toBe(DEFAULT_PROD_AUTH_CLIENT_ID);
    expect(config.authScope).toBe(DEFAULT_PROD_AUTH_SCOPE);
    expect(validateResolvedAuthConfig(config)).toBeNull();
  });

  test('browserLogin completes callback flow and stores tokens', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'eai-auth-home-'));
    const restoreHome = setTestHome(tempHome);

    mockBrowserLauncher();

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({
        access_token: createJwt({
          preferred_username: 'browser@example.com',
          oid: 'oid-123',
        }),
        refresh_token: '<fixture-refresh-token>',
        expires_in: 3600,
        token_type: 'Bearer',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    vi.resetModules();
    const { browserLogin, loadTokens, storeTokens } = await import('../../src/lib/auth.js');

    const tokens = await browserLogin(
      'profile-dev-tenant',
      'dev-tenant-id',
      'client-id-123',
      'openid profile email offline_access',
    );

    expect(tokens.upn).toBe('browser@example.com');
    expect(tokens.oid).toBe('oid-123');
    expect(tokens.clientId).toBe('client-id-123');

    // browserLogin no longer stores tokens — caller is responsible (matches login.ts flow)
    await storeTokens(tokens);
    const stored = await loadTokens();
    expect(stored?.upn).toBe('browser@example.com');
    await access(join(tempHome, '.eai', 'tokens.json'));

    restoreHome();
    await rm(tempHome, { recursive: true, force: true });
  });

  test('browserLogin falls back to email when preferred_username is absent', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'eai-auth-home-'));
    const restoreHome = setTestHome(tempHome);

    mockBrowserLauncher();

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({
        access_token: createJwt({
          email: 'fallback@example.com',
          name: 'Fallback User',
          oid: 'oid-456',
        }),
        refresh_token: '<fixture-refresh-token>',
        expires_in: 3600,
        token_type: 'Bearer',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    vi.resetModules();
    const { browserLogin } = await import('../../src/lib/auth.js');

    const tokens = await browserLogin(
      'profile-dev-tenant',
      'dev-tenant-id',
      'client-id-123',
      'openid profile email offline_access api://publicapi/access_token',
    );

    expect(tokens.upn).toBe('fallback@example.com');
    expect(tokens.oid).toBe('oid-456');

    restoreHome();
    await rm(tempHome, { recursive: true, force: true });
  });

  test('browserLogin asks for an account choice only when told to switch accounts', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'eai-auth-home-'));
    const restoreHome = setTestHome(tempHome);
    const prompts: Array<string | null> = [];

    mockBrowserLauncher(async (authUrl) => {
      prompts.push(authUrl.searchParams.get('prompt'));
      const redirect = new URL(authUrl.searchParams.get('redirect_uri') || '');
      redirect.searchParams.set('code', 'test-auth-code');
      redirect.searchParams.set('state', authUrl.searchParams.get('state') || '');
      await completeBrowserCallback(redirect.toString());
    });

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({
        access_token: createJwt({ preferred_username: 'browser@example.com', oid: 'oid-123' }),
        refresh_token: '<fixture-refresh-token>',
        expires_in: 3600,
        token_type: 'Bearer',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    vi.resetModules();
    const { browserLogin } = await import('../../src/lib/auth.js');
    const scope = 'openid profile email offline_access';

    await browserLogin('profile-dev-tenant', 'dev-tenant-id', 'client-id-123', scope);
    await browserLogin('profile-dev-tenant', 'dev-tenant-id', 'client-id-123', scope, { prompt: 'select_account' });

    expect(prompts).toEqual([null, 'select_account']);

    restoreHome();
    await rm(tempHome, { recursive: true, force: true });
  });

  test('eai login --direct --switch-account maps the flag to the account picker and --direct alone does not', async () => {
    const received: Array<{ prompt?: string; callbackPort?: number }> = [];
    vi.doMock('../../src/lib/auth.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/lib/auth.js')>('../../src/lib/auth.js');
      return {
        ...actual,
        browserLogin: vi.fn(async (tenantName: string, tenantId: string, clientId: string, _scope: string, options: { prompt?: string; callbackPort?: number } = {}) => {
          received.push({ prompt: options.prompt, callbackPort: options.callbackPort });
          return {
            accessToken: createJwt({ preferred_username: 'browser@example.com', oid: 'oid-123' }),
            refreshToken: '<fixture-refresh-token>',
            expiresAt: Date.now() + 3_600_000,
            tenantId,
            tenantName,
            clientId,
            upn: 'browser@example.com',
            oid: 'oid-123',
          };
        }),
        storeTokens: vi.fn(async () => undefined),
        // The direct path only: the Portal and --company flows must not start here.
        portalLogin: vi.fn(async () => { throw new Error('Portal sign-in must not run in this test'); }),
        companyLogin: vi.fn(async () => { throw new Error('Company sign-in must not run in this test'); }),
      };
    });
    vi.doMock('../../src/lib/profile.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/lib/profile.js')>('../../src/lib/profile.js');
      return { ...actual, assertActiveProfileApiCoherence: vi.fn(async () => undefined) };
    });
    vi.doMock('../../src/lib/tenant-context.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/lib/tenant-context.js')>('../../src/lib/tenant-context.js');
      return {
        ...actual,
        resolvePublicApiUrl: vi.fn(async () => 'https://test-api.example.com'),
        resolveActiveTenantContext: vi.fn(async () => ({ activeTenant: { displayName: 'Tenant 123', slug: 'tenant-123' }, publicApiEnvSync: null })),
        buildPublicApiEnvSyncNotice: vi.fn(() => null),
      };
    });

    try {
      // A fresh command per case: commander keeps parsed option values on the instance.
      for (const args of [['--direct', '--switch-account'], ['--direct'], ['--direct', '--switch-account', '--callback-port', '3478']]) {
        vi.resetModules();
        const { loginCommand } = await import('../../src/commands/login.js');
        await loginCommand.parseAsync(args, { from: 'user' });
      }
      expect(received).toEqual([
        { prompt: 'select_account', callbackPort: undefined },
        { prompt: undefined, callbackPort: undefined },
        { prompt: 'select_account', callbackPort: 3478 },
      ]);
    } finally {
      vi.doUnmock('../../src/lib/auth.js');
      vi.doUnmock('../../src/lib/profile.js');
      vi.doUnmock('../../src/lib/tenant-context.js');
    }
  });

  test('browserLogin supports fixed localhost callback ports', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'eai-auth-home-'));
    const restoreHome = setTestHome(tempHome);
    const callbackPort = 3477;

    mockBrowserLauncher(async (authUrl) => {
      expect(authUrl.searchParams.get('redirect_uri')).toBe(`http://localhost:${callbackPort}`);

      const redirect = new URL(`http://localhost:${callbackPort}`);
      redirect.searchParams.set('code', 'test-auth-code');
      redirect.searchParams.set('state', authUrl.searchParams.get('state') || '');
      await completeBrowserCallback(redirect.toString());
    });

    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      expect(init?.body).toBeInstanceOf(URLSearchParams);
      const body = init?.body as URLSearchParams;
      expect(body.get('redirect_uri')).toBe(`http://localhost:${callbackPort}`);

      return new Response(JSON.stringify({
        access_token: createJwt({
          preferred_username: 'browser@example.com',
          oid: 'oid-123',
        }),
        refresh_token: '<fixture-refresh-token>',
        expires_in: 3600,
        token_type: 'Bearer',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    vi.resetModules();
    const { browserLogin } = await import('../../src/lib/auth.js');

    const tokens = await browserLogin(
      'profile-dev-tenant',
      'dev-tenant-id',
      'client-id-123',
      'openid profile email offline_access',
      {
        callbackPort,
      },
    );

    expect(tokens.upn).toBe('browser@example.com');
    expect(tokens.oid).toBe('oid-123');

    restoreHome();
    await rm(tempHome, { recursive: true, force: true });
  });

  test('browserLogin waits for manual callback when remote browser opening fails', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'eai-auth-home-'));
    const restoreHome = setTestHome(tempHome);
    const callbackPort = 3476;
    let displayedAuthorizeUrl = '';

    mockBrowserLauncherFailure();

    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      expect(init?.body).toBeInstanceOf(URLSearchParams);
      const body = init?.body as URLSearchParams;
      expect(body.get('redirect_uri')).toBe(`http://localhost:${callbackPort}`);

      return new Response(JSON.stringify({
        access_token: createJwt({
          preferred_username: 'browser@example.com',
          oid: 'oid-123',
        }),
        refresh_token: '<fixture-refresh-token>',
        expires_in: 3600,
        token_type: 'Bearer',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    vi.resetModules();
    const { browserLogin } = await import('../../src/lib/auth.js');

    const tokens = await browserLogin(
      'profile-dev-tenant',
      'dev-tenant-id',
      'client-id-123',
      'openid profile email offline_access',
      {
        callbackPort,
        onAuthorizeUrl: (url) => {
          displayedAuthorizeUrl = url;
          const authUrl = new URL(url);
          const redirect = new URL(authUrl.searchParams.get('redirect_uri') || '');
          redirect.searchParams.set('code', 'test-auth-code');
          redirect.searchParams.set('state', authUrl.searchParams.get('state') || '');
          setTimeout(() => {
            void completeBrowserCallback(redirect.toString());
          }, 0);
        },
      },
    );

    expect(displayedAuthorizeUrl).toContain('/oauth2/v2.0/authorize');
    expect(tokens.upn).toBe('browser@example.com');
    expect(tokens.oid).toBe('oid-123');

    restoreHome();
    await rm(tempHome, { recursive: true, force: true });
  });

  test('browserLogin surfaces token exchange failures', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'eai-auth-home-'));
    const restoreHome = setTestHome(tempHome);

    mockBrowserLauncher();

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({
        error: 'invalid_grant',
        error_description: 'Authorization code was rejected',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    vi.resetModules();
    const { browserLogin } = await import('../../src/lib/auth.js');

    await expect(browserLogin(
      'profile-dev-tenant',
      'dev-tenant-id',
      'client-id-123',
      'openid profile email offline_access',
    )).rejects.toThrow('Token exchange failed: invalid_grant');

    await expect(readFile(join(tempHome, '.eai', 'tokens.json'), 'utf-8')).rejects.toThrow();

    restoreHome();
    await rm(tempHome, { recursive: true, force: true });
  });

  test('browserLogin rejects invalid callback ports', async () => {
    vi.resetModules();
    const { browserLogin } = await import('../../src/lib/auth.js');

    await expect(browserLogin(
      'profile-dev-tenant',
      'dev-tenant-id',
      'client-id-123',
      'openid profile email offline_access',
      {
        callbackPort: 0,
      },
    )).rejects.toThrow('Callback port must be an integer between 1 and 65535.');
  });

  test('refresh flow includes the stored auth scope', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'eai-auth-home-'));
    const restoreHome = setTestHome(tempHome);

    const authScope = 'openid profile email offline_access api://profile-test-api/access_token';
    const refreshedAccessToken = createJwt({
      preferred_username: 'browser@example.com',
      oid: 'oid-123',
    });

    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      expect(init?.body).toBeInstanceOf(URLSearchParams);
      const body = init?.body as URLSearchParams;
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('scope')).toBe(authScope);

      return new Response(JSON.stringify({
        access_token: refreshedAccessToken,
        refresh_token: '<fixture-updated-refresh-value>',
        expires_in: 3600,
        token_type: 'Bearer',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    vi.resetModules();
    const { storeTokens, getAccessToken, loadTokens } = await import('../../src/lib/auth.js');

    await storeTokens({
      accessToken: '<fixture-expired-access-value>',
      refreshToken: '<fixture-refresh-token>',
      expiresAt: Date.now() - 1000,
      tenantId: 'test-tenant-id',
      tenantName: 'profile-test-tenant',
      clientId: 'test-client-id',
      authScope,
    });

    const nextToken = await getAccessToken();
    expect(nextToken).toBe(refreshedAccessToken);

    const stored = await loadTokens();
    expect(stored?.refreshToken).toBe('<fixture-updated-refresh-value>');
    expect(stored?.authScope).toBe(authScope);

    restoreHome();
    await rm(tempHome, { recursive: true, force: true });
  });
});

describe('eai login --company and the hardened callback server', () => {
  let env: TestEnvironment;
  let restoreTestHome: () => void;

  beforeEach(async () => {
    env = await createTestEnvironment();
    restoreTestHome = setTestHome(env.dir);
    for (const key of ['EAI_AUTH_TENANT_NAME', 'EAI_AUTH_TENANT_ID', 'EAI_AUTH_SCOPE', 'EAI_PUBLIC_API_SCOPE',
      'EAI_CLI_CLIENT_ID', 'EAI_AUTH_CLIENT_ID', 'EAI_CLI_COMPANY_CLIENT_ID', 'EAI_LOGIN_VIA_PORTAL']) vi.stubEnv(key, undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.doUnmock('node:child_process');
    await env.cleanup();
    restoreTestHome();
  });

  test('--company opens the company app with PKCE S256 and prompt=login, and no Portal or hints', async () => {
    let authorizeUrl: URL | undefined;
    mockBrowserLauncher(async (url) => {
      authorizeUrl = url;
      await completeBrowserCallback(authorizeCallbackUrl(url));
    });
    const tokenFetch = vi.fn(async (_url: unknown, _init?: RequestInit) => tokenResponse({
      email: 'student@school.example.test', preferred_username: 'student@school.example.test', oid: 'oid-company',
    }));
    vi.stubGlobal('fetch', tokenFetch);

    vi.resetModules();
    const { companyLogin } = await import('../../src/lib/auth.js');
    const result = await companyLogin(DEV_DIRECTORY_NAME, DEV_DIRECTORY, FIXTURE_COMPANY_CLIENT_ID, FIXTURE_SCOPE);

    expect(`${authorizeUrl?.origin}${authorizeUrl?.pathname}`)
      .toBe(`https://${DEV_DIRECTORY_NAME}.ciamlogin.com/${DEV_DIRECTORY}/oauth2/v2.0/authorize`);
    const params = authorizeUrl!.searchParams;
    expect(params.get('client_id')).toBe(FIXTURE_COMPANY_CLIENT_ID);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('response_mode')).toBe('query');
    expect(params.get('scope')).toBe(FIXTURE_SCOPE);
    expect(params.get('prompt')).toBe('login');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('state')).toMatch(BASE64URL_43);
    expect(params.get('code_challenge')).toMatch(BASE64URL_43);
    expect(params.has('login_hint')).toBe(false);
    expect(params.has('domain_hint')).toBe(false);

    expect(tokenFetch).toHaveBeenCalledTimes(1);
    const body = tokenFetch.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get('client_id')).toBe(FIXTURE_COMPANY_CLIENT_ID);
    expect(pkceChallenge(body.get('code_verifier') || '')).toBe(params.get('code_challenge'));
    expect(body.get('redirect_uri')).toBe(params.get('redirect_uri'));

    expect(result.tokens.clientId).toBe(FIXTURE_COMPANY_CLIENT_ID);
    expect(result.tokens.oid).toBe('oid-company');
    expect(result.signedInEmail).toBe('student@school.example.test');
    expect(result.typedEmail).toBeUndefined();
  });

  test('the email check reads the ID token when the access token has no email claim', async () => {
    mockBrowserLauncher(async (url) => completeBrowserCallback(authorizeCallbackUrl(url)));
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse(
      { preferred_username: 'display-name@example.test', oid: 'oid-company' },
      { id_token: createJwt({ email: 'student@school.example.test' }) },
    )));

    vi.resetModules();
    const { companyLogin } = await import('../../src/lib/auth.js');
    const result = await companyLogin(DEV_DIRECTORY_NAME, DEV_DIRECTORY, FIXTURE_COMPANY_CLIENT_ID, FIXTURE_SCOPE);

    expect(result.signedInEmail).toBe('student@school.example.test');
    // The ID token is only read, never stored.
    expect(JSON.stringify(result.tokens)).not.toContain(createJwt({ email: 'student@school.example.test' }));
  });

  test('the stored company client is the one refresh uses', async () => {
    const refreshed = createJwt({ email: 'student@school.example.test', oid: 'oid-company' });
    const refreshFetch = vi.fn(async (_url: unknown, _init?: RequestInit) => tokenResponse({ email: 'student@school.example.test' }));
    refreshFetch.mockImplementationOnce(async () => new Response(JSON.stringify({
      access_token: refreshed, refresh_token: '<fixture-updated-refresh-value>', expires_in: 3600, token_type: 'Bearer',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', refreshFetch);

    vi.resetModules();
    const { getAccessToken, storeTokens } = await import('../../src/lib/auth.js');
    await storeTokens({
      accessToken: '<fixture-expired-access-value>',
      refreshToken: '<fixture-refresh-token>',
      expiresAt: Date.now() - 1000,
      tenantId: DEV_DIRECTORY,
      tenantName: DEV_DIRECTORY_NAME,
      clientId: FIXTURE_COMPANY_CLIENT_ID,
      authScope: FIXTURE_SCOPE,
    });

    expect(await getAccessToken()).toBe(refreshed);
    const body = refreshFetch.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('client_id')).toBe(FIXTURE_COMPANY_CLIENT_ID);
  });

  test('a bad Host, a wrong or missing state, an error without the state and other paths get refused, and the wait continues', async () => {
    const responses: HttpResult[] = [];
    mockBrowserLauncher(async (url) => {
      const callback = new URL(authorizeCallbackUrl(url));
      const port = callback.port;
      const withState = (state: string | null, extra: Record<string, string> = {}): string => {
        const probe = new URL(`http://localhost:${port}/`);
        if (state !== null) probe.searchParams.set('state', state);
        for (const [key, value] of Object.entries(extra)) probe.searchParams.set(key, value);
        return probe.toString();
      };
      responses.push(await httpGet(callback.toString(), { host: `attacker.example.test:${port}` }));
      responses.push(await httpGet(callback.toString(), { host: `127.0.0.1:${port}` }));
      responses.push(await httpGet(withState('not-the-auth-state', { code: 'stolen-code' })));
      responses.push(await httpGet(withState(null, { code: 'stolen-code' })));
      responses.push(await httpGet(withState(null, { error: 'access_denied' })));
      responses.push(await httpGet(withState('not-the-auth-state', { error: 'access_denied' })));
      responses.push(await httpGet(`http://localhost:${port}/favicon.ico`));
      responses.push(await httpGet(callback.toString()));
    });
    const tokenFetch = vi.fn(async () => tokenResponse({ email: 'student@school.example.test' }));
    vi.stubGlobal('fetch', tokenFetch);

    vi.resetModules();
    const { companyLogin } = await import('../../src/lib/auth.js');
    const result = await companyLogin(DEV_DIRECTORY_NAME, DEV_DIRECTORY, FIXTURE_COMPANY_CLIENT_ID, FIXTURE_SCOPE);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400, 400, 404, 200]);
    for (const response of responses) expectHardenedHeaders(response);
    expect(responses[2].body).toContain("doesn't match the CLI that started it");
    expect(tokenFetch).toHaveBeenCalledTimes(1);
    expect(result.tokens.clientId).toBe(FIXTURE_COMPANY_CLIENT_ID);
  });

  test('an error callback with the matching state ends the sign-in', async () => {
    mockBrowserLauncher(async (url) => {
      const callback = new URL(authorizeCallbackUrl(url));
      callback.searchParams.delete('code');
      callback.searchParams.set('error', 'access_denied');
      callback.searchParams.set('error_description', 'The user cancelled');
      expectHardenedHeaders(await httpGet(callback.toString()));
    });
    const tokenFetch = vi.fn();
    vi.stubGlobal('fetch', tokenFetch);

    vi.resetModules();
    const { companyLogin } = await import('../../src/lib/auth.js');

    await expect(companyLogin(DEV_DIRECTORY_NAME, DEV_DIRECTORY, FIXTURE_COMPANY_CLIENT_ID, FIXTURE_SCOPE))
      .rejects.toThrow('Authorization failed: access_denied');
    expect(tokenFetch).not.toHaveBeenCalled();
  });

  test('--company works on a fixed --callback-port (Codespaces)', async () => {
    const callbackPort = 3481;
    mockBrowserLauncher(async (url) => {
      expect(url.searchParams.get('redirect_uri')).toBe(`http://localhost:${callbackPort}`);
      await completeBrowserCallback(authorizeCallbackUrl(url));
    });
    const tokenFetch = vi.fn(async (_url: unknown, _init?: RequestInit) => tokenResponse({ email: 'student@school.example.test' }));
    vi.stubGlobal('fetch', tokenFetch);

    vi.resetModules();
    const { companyLogin } = await import('../../src/lib/auth.js');
    const result = await companyLogin(DEV_DIRECTORY_NAME, DEV_DIRECTORY, FIXTURE_COMPANY_CLIENT_ID, FIXTURE_SCOPE, { callbackPort });

    expect((tokenFetch.mock.calls[0][1]?.body as URLSearchParams).get('redirect_uri')).toBe(`http://localhost:${callbackPort}`);
    expect(result.tokens.clientId).toBe(FIXTURE_COMPANY_CLIENT_ID);
  });

  test('the direct path keeps its authorize request and the hardened callback', async () => {
    let authorizeUrl: URL | undefined;
    const responses: HttpResult[] = [];
    mockBrowserLauncher(async (url) => {
      authorizeUrl = url;
      const callback = new URL(authorizeCallbackUrl(url));
      responses.push(await httpGet(callback.toString(), { host: `attacker.example.test:${callback.port}` }));
      responses.push(await httpGet(callback.toString()));
    });
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse({ preferred_username: 'browser@example.com' })));

    vi.resetModules();
    const { browserLogin } = await import('../../src/lib/auth.js');
    const tokens = await browserLogin(DEV_DIRECTORY_NAME, DEV_DIRECTORY, EXAMPLE_CLI_CLIENT_ID, FIXTURE_SCOPE);

    expect([...authorizeUrl!.searchParams.keys()]).toEqual([
      'client_id', 'response_type', 'redirect_uri', 'response_mode', 'scope', 'state', 'code_challenge', 'code_challenge_method',
    ]);
    expect(responses.map((response) => response.status)).toEqual([400, 200]);
    expect(tokens.clientId).toBe(EXAMPLE_CLI_CLIENT_ID);
  });
});

describe('eai login through the Admin Portal', () => {
  let env: TestEnvironment;
  let restoreTestHome: () => void;

  beforeEach(async () => {
    env = await createTestEnvironment();
    restoreTestHome = setTestHome(env.dir);
    for (const key of ['EAI_AUTH_TENANT_NAME', 'EAI_AUTH_TENANT_ID', 'EAI_AUTH_SCOPE', 'EAI_PUBLIC_API_SCOPE',
      'EAI_CLI_CLIENT_ID', 'EAI_AUTH_CLIENT_ID', 'EAI_CLI_COMPANY_CLIENT_ID', 'EAI_LOGIN_VIA_PORTAL']) vi.stubEnv(key, undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.doUnmock('node:child_process');
    await env.cleanup();
    restoreTestHome();
  });

  async function portalSignIn(
    browse: (portalUrl: URL) => Promise<void>,
    options: { companyClientId?: string; callbackPort?: number; timeoutMs?: number } = {},
  ): Promise<{ result: import('../../src/lib/auth.js').SignInResult; printed: string[] }> {
    mockBrowserLauncher(browse);
    vi.resetModules();
    const { portalLogin } = await import('../../src/lib/auth.js');
    const printed: string[] = [];
    const result = await portalLogin(DEV_DIRECTORY_NAME, DEV_DIRECTORY, FIXTURE_SCOPE, {
      portalUrl: DEV_PORTAL,
      standardClientId: EXAMPLE_CLI_CLIENT_ID,
      companyClientId: 'companyClientId' in options ? options.companyClientId : FIXTURE_COMPANY_CLIENT_ID,
      callbackPort: options.callbackPort,
      timeoutMs: options.timeoutMs,
      onPortalUrl: (url) => printed.push(url),
    });
    return { result, printed };
  }

  test('an ordinary email routes to the ordinary app with login_hint and prompt=login', async () => {
    let opened: URL | undefined;
    let route: HttpResult | undefined;
    const tokenFetch = vi.fn(async (_url: unknown, _init?: RequestInit) => tokenResponse({ email: 'person@example.test' }));
    vi.stubGlobal('fetch', tokenFetch);

    const { result, printed } = await portalSignIn(async (portalUrl) => {
      opened = portalUrl;
      route = await httpGet(portalRouteUrl(portalUrl, { kind: 'standard', login_hint: 'person@example.test' }));
      await completeBrowserCallback(authorizeCallbackUrl(new URL(route.headers.location || '')));
    });

    expect(`${opened?.origin}${opened?.pathname}`).toBe(`${DEV_PORTAL}/login/cli`);
    expect(printed).toEqual([opened?.toString()]);
    const port = opened!.searchParams.get('port');
    const routeState = opened!.searchParams.get('state');
    expect(port).toMatch(/^[1-9][0-9]*$/);
    expect(routeState).toMatch(BASE64URL_43);

    expect(route?.status).toBe(302);
    expectHardenedHeaders(route!);
    const authorize = new URL(route!.headers.location || '');
    expect(`${authorize.origin}${authorize.pathname}`)
      .toBe(`https://${DEV_DIRECTORY_NAME}.ciamlogin.com/${DEV_DIRECTORY}/oauth2/v2.0/authorize`);
    expect(authorize.searchParams.get('client_id')).toBe(EXAMPLE_CLI_CLIENT_ID);
    expect(authorize.searchParams.get('response_type')).toBe('code');
    expect(authorize.searchParams.get('redirect_uri')).toBe(`http://localhost:${port}`);
    expect(authorize.searchParams.get('response_mode')).toBe('query');
    expect(authorize.searchParams.get('scope')).toBe(FIXTURE_SCOPE);
    expect(authorize.searchParams.get('state')).toMatch(BASE64URL_43);
    expect(authorize.searchParams.get('state')).not.toBe(routeState);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('login_hint')).toBe('person@example.test');
    expect(authorize.searchParams.get('prompt')).toBe('login');
    expect(authorize.searchParams.has('domain_hint')).toBe(false);

    const body = tokenFetch.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get('client_id')).toBe(EXAMPLE_CLI_CLIENT_ID);
    expect(pkceChallenge(body.get('code_verifier') || '')).toBe(authorize.searchParams.get('code_challenge'));
    expect(result.tokens.clientId).toBe(EXAMPLE_CLI_CLIENT_ID);
    expect(result.typedEmail).toBe('person@example.test');
    expect(result.signedInEmail).toBe('person@example.test');
  });

  test('a company route uses the company app and adds domain_hint', async () => {
    let authorize: URL | undefined;
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse({ email: 'student@school.example.test' })));

    const { result } = await portalSignIn(async (portalUrl) => {
      const route = await httpGet(portalRouteUrl(portalUrl, {
        kind: 'company', login_hint: 'student@school.example.test', domain_hint: 'school.example.test',
      }));
      authorize = new URL(route.headers.location || '');
      await completeBrowserCallback(authorizeCallbackUrl(authorize));
    });

    expect(authorize?.searchParams.get('client_id')).toBe(FIXTURE_COMPANY_CLIENT_ID);
    expect(authorize?.searchParams.get('domain_hint')).toBe('school.example.test');
    expect(authorize?.searchParams.get('login_hint')).toBe('student@school.example.test');
    expect(authorize?.searchParams.get('prompt')).toBe('login');
    expect(result.tokens.clientId).toBe(FIXTURE_COMPANY_CLIENT_ID);
  });

  test('/eai/route checks Host, state, kind and hints with 400 and keeps waiting; a callback before routing is refused', async () => {
    const statuses: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse({ email: 'person@example.test' })));

    await portalSignIn(async (portalUrl) => {
      const port = portalUrl.searchParams.get('port');
      const good = { kind: 'standard', login_hint: 'person@example.test' };
      const probes: Array<[string, Record<string, string>]> = [
        [portalRouteUrl(portalUrl, good), { host: `attacker.example.test:${port}` }],
        [portalRouteUrl(portalUrl, { ...good, state: 'x'.repeat(43) }), {}],
        [portalRouteUrl(portalUrl, { ...good, kind: 'tenant-admin' }), {}],
        [portalRouteUrl(portalUrl, { ...good, login_hint: 'not-an-email' }), {}],
        [portalRouteUrl(portalUrl, { kind: 'company', login_hint: 'student@school.example.test', domain_hint: 'bad hint' }), {}],
        [`http://localhost:${port}/?code=early-code&state=${portalUrl.searchParams.get('state')}`, {}],
      ];
      for (const [url, headers] of probes) {
        const response = await httpGet(url, headers);
        expectHardenedHeaders(response);
        statuses.push(response.status);
      }
      const route = await httpGet(portalRouteUrl(portalUrl, good));
      statuses.push(route.status);
      await completeBrowserCallback(authorizeCallbackUrl(new URL(route.headers.location || '')));
    });

    expect(statuses).toEqual([400, 400, 400, 400, 400, 400, 302]);
  });

  test('a later route with the same route state replaces the auth state and PKCE (a re-route after a typo)', async () => {
    const tokenFetch = vi.fn(async (_url: unknown, _init?: RequestInit) => tokenResponse({ email: 'student@school.example.test' }));
    vi.stubGlobal('fetch', tokenFetch);
    let first: URL | undefined;
    let second: URL | undefined;
    let staleCallback: HttpResult | undefined;

    const { result } = await portalSignIn(async (portalUrl) => {
      first = new URL((await httpGet(portalRouteUrl(portalUrl, {
        kind: 'standard', login_hint: 'student@school.exmaple.test',
      }))).headers.location || '');
      second = new URL((await httpGet(portalRouteUrl(portalUrl, {
        kind: 'company', login_hint: 'student@school.example.test', domain_hint: 'school.example.test',
      }))).headers.location || '');
      staleCallback = await httpGet(authorizeCallbackUrl(first));
      await completeBrowserCallback(authorizeCallbackUrl(second));
    });

    expect(first?.searchParams.get('state')).not.toBe(second?.searchParams.get('state'));
    expect(first?.searchParams.get('code_challenge')).not.toBe(second?.searchParams.get('code_challenge'));
    expect(staleCallback?.status).toBe(400);
    expect(tokenFetch).toHaveBeenCalledTimes(1);
    const body = tokenFetch.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get('client_id')).toBe(FIXTURE_COMPANY_CLIENT_ID);
    expect(pkceChallenge(body.get('code_verifier') || '')).toBe(second?.searchParams.get('code_challenge'));
    expect(result.tokens.clientId).toBe(FIXTURE_COMPANY_CLIENT_ID);
    expect(result.typedEmail).toBe('student@school.example.test');
  });

  test('a company route without a company app for the directory shows an error page and fails', async () => {
    let page: HttpResult | undefined;
    const tokenFetch = vi.fn();
    vi.stubGlobal('fetch', tokenFetch);

    await expect(portalSignIn(async (portalUrl) => {
      page = await httpGet(portalRouteUrl(portalUrl, {
        kind: 'company', login_hint: 'student@school.example.test', domain_hint: 'school.example.test',
      }));
    }, { companyClientId: undefined })).rejects.toThrow("Company sign-in isn't set up for this environment yet.");

    expect(page?.body).toContain("Company sign-in isn't set up for this environment yet.");
    expectHardenedHeaders(page!);
    expect(tokenFetch).not.toHaveBeenCalled();
  });

  test('on timeout it points to --company and --direct, after printing the Portal link', async () => {
    vi.stubGlobal('fetch', vi.fn());
    let printedUrl = '';

    mockBrowserLauncher(async () => undefined);
    vi.resetModules();
    const { portalLogin } = await import('../../src/lib/auth.js');
    await expect(portalLogin(DEV_DIRECTORY_NAME, DEV_DIRECTORY, FIXTURE_SCOPE, {
      portalUrl: DEV_PORTAL,
      standardClientId: EXAMPLE_CLI_CLIENT_ID,
      companyClientId: FIXTURE_COMPANY_CLIENT_ID,
      timeoutMs: 50,
      onPortalUrl: (url) => { printedUrl = url; },
    })).rejects.toThrow(
      "Couldn't finish the Portal sign-in. Try `eai login --company` (school or company accounts) or `eai login --direct`.",
    );
    expect(printedUrl).toContain(`${DEV_PORTAL}/login/cli?port=`);
  });

  test('a fixed --callback-port is used for both hops', async () => {
    const callbackPort = 3482;
    let opened: URL | undefined;
    let authorize: URL | undefined;
    const tokenFetch = vi.fn(async (_url: unknown, _init?: RequestInit) => tokenResponse({ email: 'person@example.test' }));
    vi.stubGlobal('fetch', tokenFetch);

    await portalSignIn(async (portalUrl) => {
      opened = portalUrl;
      authorize = new URL((await httpGet(portalRouteUrl(portalUrl, {
        kind: 'standard', login_hint: 'person@example.test',
      }))).headers.location || '');
      await completeBrowserCallback(authorizeCallbackUrl(authorize));
    }, { callbackPort });

    expect(opened?.searchParams.get('port')).toBe(String(callbackPort));
    expect(authorize?.searchParams.get('redirect_uri')).toBe(`http://localhost:${callbackPort}`);
    expect((tokenFetch.mock.calls[0][1]?.body as URLSearchParams).get('redirect_uri')).toBe(`http://localhost:${callbackPort}`);
  });

  test('the Portal path keeps waiting when the browser cannot open, since the link is printed', async () => {
    mockBrowserLauncherFailure();
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse({ email: 'person@example.test' })));
    vi.resetModules();
    const { portalLogin } = await import('../../src/lib/auth.js');

    const result = await portalLogin(DEV_DIRECTORY_NAME, DEV_DIRECTORY, FIXTURE_SCOPE, {
      portalUrl: DEV_PORTAL,
      standardClientId: EXAMPLE_CLI_CLIENT_ID,
      onPortalUrl: (url) => {
        setTimeout(() => {
          void (async () => {
            const route = await httpGet(portalRouteUrl(new URL(url), { kind: 'standard', login_hint: 'person@example.test' }));
            await completeBrowserCallback(authorizeCallbackUrl(new URL(route.headers.location || '')));
          })();
        }, 0);
      },
    });
    expect(result.tokens.clientId).toBe(EXAMPLE_CLI_CLIENT_ID);
  });
});

describe('eai login command: Portal, --company, --direct and the save prompt', () => {
  let env: TestEnvironment;
  let restoreTestHome: () => void;

  beforeEach(async () => {
    env = await createTestEnvironment();
    restoreTestHome = setTestHome(env.dir);
    for (const key of ['EAI_AUTH_TENANT_NAME', 'EAI_AUTH_TENANT_ID', 'EAI_AUTH_SCOPE', 'EAI_PUBLIC_API_SCOPE',
      'EAI_CLI_CLIENT_ID', 'EAI_AUTH_CLIENT_ID', 'EAI_CLI_COMPANY_CLIENT_ID', 'EAI_LOGIN_VIA_PORTAL',
      'BASE_URL_PUBLIC_API', 'ROUTING_BOOTSTRAP_PUBLIC_API_URL', 'EAI_ACCESS_TOKEN']) vi.stubEnv(key, undefined);
    vi.resetModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.doUnmock('node:child_process');
    await env.cleanup();
    restoreTestHome();
  });

  /** Runs the mounted login command in-process; workspace discovery is stubbed so only sign-in is exercised. */
  async function runLogin(args: string[], answers: { interactive?: boolean; answer?: boolean } = {}): Promise<{
    exitCode?: number;
    output: string;
    auth: typeof import('../../src/lib/auth.js');
    asked: string[];
  }> {
    const lines: string[] = [];
    const capture = (...parts: unknown[]): void => { lines.push(parts.map(String).join(' ')); };
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    vi.spyOn(process, 'cwd').mockReturnValue(env.dir);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new ExitCalled(code ?? 0); }) as never);

    const auth = await import('../../src/lib/auth.js');
    const companySignIn = await import('../../src/lib/company-sign-in.js');
    const tenantContext = await import('../../src/lib/tenant-context.js');
    vi.spyOn(tenantContext, 'resolvePublicApiUrl').mockRejectedValue(new Error('fixture: workspace lookup skipped'));
    vi.spyOn(companySignIn, 'canPromptInTerminal').mockReturnValue(answers.interactive ?? false);
    const asked: string[] = [];
    vi.spyOn(companySignIn, 'askYesNo').mockImplementation(async (question: string) => {
      asked.push(question);
      return answers.answer ?? false;
    });

    const { loginCommand } = await import('../../src/commands/login.js');
    const root = new Command('eai');
    root.exitOverride();
    root.addCommand(loginCommand);
    let exitCode: number | undefined;
    try {
      await root.parseAsync(['login', ...args], { from: 'user' });
    } catch (error) {
      if (!(error instanceof ExitCalled)) throw error;
      exitCode = error.code;
    }
    return { exitCode, output: lines.join('\n'), auth, asked };
  }

  function mockPortalBrowser(values: Record<string, string>): { opened: URL[] } {
    const seen = { opened: [] as URL[] };
    mockBrowserLauncher(async (portalUrl) => {
      seen.opened.push(portalUrl);
      const route = await httpGet(portalRouteUrl(portalUrl, values));
      await completeBrowserCallback(authorizeCallbackUrl(new URL(route.headers.location || '')));
    });
    return seen;
  }

  test('--company without a company app for this environment exits 1 before opening a browser', async () => {
    const ctx: TestContext = {
      workingDir: env.dir,
      mockAPI: {} as TestContext['mockAPI'],
      env: {
        HOME: env.dir, USERPROFILE: env.dir, EAI_PROFILE: '', EAI_CLI_COMPANY_CLIENT_ID: '', EAI_AUTH_TENANT_NAME: '',
        EAI_AUTH_TENANT_ID: '', EAI_AUTH_SCOPE: '', EAI_PUBLIC_API_SCOPE: '', EAI_CLI_CLIENT_ID: '', EAI_AUTH_CLIENT_ID: '',
      },
      prompts: [],
    };
    const result = await runCommand(ctx, 'eai login --company');

    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Company sign-in isn't set up for this environment yet.");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('Opening');
  });

  describe('with the PROD company app constant pinned (stubbed)', () => {
    const PINNED_PROD_COMPANY_CLIENT = '00000000-0000-4000-8000-0000000000d1';
    const PROD_DIRECTORY = 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26';

    beforeEach(() => {
      vi.doMock('../../src/lib/profile.js', async (original) => ({
        ...await original<typeof import('../../src/lib/profile.js')>(),
        DEFAULT_PROD_AUTH_COMPANY_CLIENT_ID: PINNED_PROD_COMPANY_CLIENT,
      }));
      vi.resetModules();
    });

    afterEach(() => {
      vi.doUnmock('../../src/lib/profile.js');
    });

    async function stubCompanyLogin(): Promise<ReturnType<typeof vi.spyOn>> {
      const auth = await import('../../src/lib/auth.js');
      return vi.spyOn(auth, 'companyLogin').mockImplementation(async (tenantName, tenantId, clientId) => ({
        tokens: {
          accessToken: createJwt({ email: 'student@school.example.test' }), expiresAt: Date.now() + 600_000,
          tenantName, tenantId, clientId,
        },
        signedInEmail: 'student@school.example.test',
      }));
    }

    test('--company with the default PROD scope uses the pinned PROD company app', async () => {
      const company = await stubCompanyLogin();

      const { exitCode } = await runLogin(['--company']);

      expect(exitCode).toBeUndefined();
      expect(company).toHaveBeenCalledWith('enterpriseaiplatform', PROD_DIRECTORY, PINNED_PROD_COMPANY_CLIENT,
        expect.any(String), expect.any(Object));
    });

    test('--company with an overridden --scope does not use the PROD company app', async () => {
      const company = await stubCompanyLogin();

      const { exitCode, output } = await runLogin(['--company', '--scope', 'openid profile email offline_access']);

      expect(exitCode).toBe(1);
      expect(output).toContain("Company sign-in isn't set up for this environment yet.");
      expect(company).not.toHaveBeenCalled();
    });

    test('--company with an overridden --scope still uses an explicit EAI_CLI_COMPANY_CLIENT_ID', async () => {
      vi.stubEnv('EAI_CLI_COMPANY_CLIENT_ID', FIXTURE_COMPANY_CLIENT_ID);
      const company = await stubCompanyLogin();

      const { exitCode } = await runLogin(['--company', '--scope', 'openid profile email offline_access']);

      expect(exitCode).toBeUndefined();
      expect(company).toHaveBeenCalledWith('enterpriseaiplatform', PROD_DIRECTORY, FIXTURE_COMPANY_CLIENT_ID,
        'openid profile email offline_access', expect.any(Object));
    });

    test('--tenant-* flags still turn the PROD company app off', async () => {
      const company = await stubCompanyLogin();

      const { exitCode, output } = await runLogin(['--company', '--tenant-name', 'enterpriseaiplatform', '--tenant-id', PROD_DIRECTORY]);

      expect(exitCode).toBe(1);
      expect(output).toContain("Company sign-in isn't set up for this environment yet.");
      expect(company).not.toHaveBeenCalled();
    });

    test('the Portal path offers the PROD company app only for the default PROD scope', async () => {
      const auth = await import('../../src/lib/auth.js');
      const portal = vi.spyOn(auth, 'portalLogin').mockImplementation(async (tenantName, tenantId) => ({
        tokens: {
          accessToken: createJwt({ email: 'person@example.test' }), expiresAt: Date.now() + 600_000,
          tenantName, tenantId, clientId: 'd704bde5-fe36-44ff-9a26-221d53772dd0',
        },
        signedInEmail: 'person@example.test',
        typedEmail: 'person@example.test',
      }));

      await runLogin([]);
      await runLogin(['--scope', 'openid profile email offline_access']);

      expect(portal).toHaveBeenCalledTimes(2);
      expect(portal.mock.calls[0][3]).toMatchObject({ companyClientId: PINNED_PROD_COMPANY_CLIENT });
      expect(portal.mock.calls[1][3]).toMatchObject({ companyClientId: undefined });
    });
  });

  test('--company and --direct together are refused', async () => {
    const { exitCode, output } = await runLogin(['--company', '--direct']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Use either --company or --direct');
  });

  test('--company with no terminal saves with the default yes and stores the company client', async () => {
    useDevDirectoryEnv();
    mockBrowserLauncher(async (url) => {
      expect(url.searchParams.get('client_id')).toBe(FIXTURE_COMPANY_CLIENT_ID);
      expect(url.searchParams.get('prompt')).toBe('login');
      await completeBrowserCallback(authorizeCallbackUrl(url));
    });
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse({
      email: 'student@school.example.test', aud: EXAMPLE_PUBLIC_API_SCOPE.replace('/.default', ''),
    })));

    const { exitCode, output, auth, asked } = await runLogin(['--company']);

    expect(exitCode).toBeUndefined();
    expect(asked).toEqual([]);
    expect(output).toContain('Signed in as student@school.example.test. Save this login? [Y/n]');
    expect(output).toContain('using the default: yes');
    expect((await auth.loadTokens())?.clientId).toBe(FIXTURE_COMPANY_CLIENT_ID);
    // The stored-login check accepted the company client, so workspace discovery ran next.
    expect(output).toContain('fixture: workspace lookup skipped');
    expect(output).not.toContain('Stored CLI login does not match');
  });

  test('--company answered n discards the tokens and exits 1', async () => {
    useDevDirectoryEnv();
    mockBrowserLauncher(async (url) => completeBrowserCallback(authorizeCallbackUrl(url)));
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse({ email: 'someone-else@school.example.test' })));

    const { exitCode, output, auth, asked } = await runLogin(['--company'], { interactive: true, answer: false });

    expect(exitCode).toBe(1);
    expect(asked).toEqual(['Signed in as someone-else@school.example.test. Save this login? [Y/n]']);
    expect(output).toContain('Login not saved');
    expect(await auth.loadTokens()).toBeNull();
  });

  test('plain eai login opens the directory\'s AU Portal and saves a matching email without asking', async () => {
    useDevDirectoryEnv();
    const browser = mockPortalBrowser({ kind: 'company', login_hint: 'student@school.example.test', domain_hint: 'school.example.test' });
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse({ email: 'Student@School.Example.Test' })));

    const { exitCode, output, auth, asked } = await runLogin([]);

    expect(exitCode).toBeUndefined();
    expect(browser.opened.map((url) => `${url.origin}${url.pathname}`)).toEqual([`${DEV_PORTAL}/login/cli`]);
    expect(output).toContain(browser.opened[0].toString());
    expect(asked).toEqual([]);
    expect(output).not.toContain('Save this login?');
    expect((await auth.loadTokens())?.clientId).toBe(FIXTURE_COMPANY_CLIENT_ID);
  });

  test('a different signed-in email asks with default no; with no terminal the login is not saved', async () => {
    useDevDirectoryEnv();
    mockPortalBrowser({ kind: 'standard', login_hint: 'person@example.test' });
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse({ email: 'other@example.test' })));

    const { exitCode, output, auth } = await runLogin([]);

    expect(exitCode).toBe(1);
    expect(output).toContain('You signed in as other@example.test, but typed person@example.test. Save this login? [y/N]');
    expect(output).toContain('using the default: no');
    expect(await auth.loadTokens()).toBeNull();
  });

  test('a different signed-in email answered y is saved', async () => {
    useDevDirectoryEnv();
    mockPortalBrowser({ kind: 'standard', login_hint: 'person@example.test' });
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse({ email: 'person.alias@example.test' })));

    const { exitCode, auth, asked } = await runLogin([], { interactive: true, answer: true });

    expect(exitCode).toBeUndefined();
    expect(asked).toEqual(['You signed in as person.alias@example.test, but typed person@example.test. Save this login? [y/N]']);
    expect((await auth.loadTokens())?.clientId).toBe(EXAMPLE_CLI_CLIENT_ID);
  });

  test('a missing email claim asks even when preferred_username matches the typed email', async () => {
    useDevDirectoryEnv();
    mockPortalBrowser({ kind: 'standard', login_hint: 'person@example.test' });
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse({ preferred_username: 'person@example.test' })));

    const { exitCode, auth, asked } = await runLogin([], { interactive: true, answer: false });

    expect(exitCode).toBe(1);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('but typed person@example.test. Save this login? [y/N]');
    expect(await auth.loadTokens()).toBeNull();
  });

  test.each([
    ['--direct', ['--direct'], {}],
    ['EAI_LOGIN_VIA_PORTAL=false', [], { EAI_LOGIN_VIA_PORTAL: 'false' }],
  ])('%s keeps today\'s direct sign-in with the ordinary app', async (_name, args, extraEnv) => {
    for (const [key, value] of Object.entries(extraEnv)) vi.stubEnv(key, value);
    const auth = await import('../../src/lib/auth.js');
    const direct = vi.spyOn(auth, 'browserLogin').mockResolvedValue({
      accessToken: createJwt({ preferred_username: 'person@example.test' }), expiresAt: Date.now() + 600_000,
      tenantName: 'enterpriseaiplatform', tenantId: 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26', clientId: 'direct-client',
    });
    const portal = vi.spyOn(auth, 'portalLogin');
    const company = vi.spyOn(auth, 'companyLogin');

    const { exitCode, output } = await runLogin(args);

    expect(exitCode).toBeUndefined();
    expect(direct).toHaveBeenCalledWith(
      'enterpriseaiplatform', 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26', 'd704bde5-fe36-44ff-9a26-221d53772dd0',
      expect.any(String), expect.any(Object),
    );
    expect(portal).not.toHaveBeenCalled();
    expect(company).not.toHaveBeenCalled();
    expect(output).not.toContain(PROD_PORTAL);
    expect(output).not.toContain('Save this login?');
  });

  test('--switch-account without --direct keeps the Portal path, which always sends prompt=login', async () => {
    const auth = await import('../../src/lib/auth.js');
    const direct = vi.spyOn(auth, 'browserLogin');
    const portal = vi.spyOn(auth, 'portalLogin').mockResolvedValue({
      tokens: {
        accessToken: createJwt({ email: 'person@example.test' }), expiresAt: Date.now() + 600_000,
        tenantName: 'enterpriseaiplatform', tenantId: 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26',
        clientId: 'd704bde5-fe36-44ff-9a26-221d53772dd0',
      },
      signedInEmail: 'person@example.test',
      typedEmail: 'person@example.test',
    });

    const { exitCode } = await runLogin(['--switch-account']);

    expect(exitCode).toBeUndefined();
    expect(portal).toHaveBeenCalledTimes(1);
    expect(portal.mock.calls[0][3]).not.toHaveProperty('prompt');
    expect(direct).not.toHaveBeenCalled();
  });

  test('a directory with no known Portal uses the direct flow with an info line', async () => {
    const auth = await import('../../src/lib/auth.js');
    const direct = vi.spyOn(auth, 'browserLogin').mockResolvedValue({
      accessToken: createJwt({ preferred_username: 'person@example.test' }), expiresAt: Date.now() + 600_000,
      tenantName: 'custom-directory', tenantId: '11111111-1111-4111-8111-111111111111', clientId: 'direct-client',
    });
    const portal = vi.spyOn(auth, 'portalLogin');

    const { exitCode, output } = await runLogin(['--tenant-name', 'custom-directory', '--tenant-id', '11111111-1111-4111-8111-111111111111']);

    expect(exitCode).toBeUndefined();
    expect(direct).toHaveBeenCalledWith('custom-directory', '11111111-1111-4111-8111-111111111111', expect.any(String),
      expect.any(String), expect.any(Object));
    expect(portal).not.toHaveBeenCalled();
    expect(output).toContain('No Admin Portal sign-in page is known for this sign-in directory');
  });

  test('plain eai login for the PROD directory goes to the PROD Portal', async () => {
    const auth = await import('../../src/lib/auth.js');
    const portal = vi.spyOn(auth, 'portalLogin').mockResolvedValue({
      tokens: {
        accessToken: createJwt({ email: 'person@example.test' }), expiresAt: Date.now() + 600_000,
        tenantName: 'enterpriseaiplatform', tenantId: 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26',
        clientId: 'd704bde5-fe36-44ff-9a26-221d53772dd0',
      },
      signedInEmail: 'person@example.test',
      typedEmail: 'person@example.test',
    });

    const { exitCode } = await runLogin([]);

    expect(exitCode).toBeUndefined();
    expect(portal).toHaveBeenCalledWith('enterpriseaiplatform', 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26', expect.any(String),
      expect.objectContaining({
        portalUrl: PROD_PORTAL,
        standardClientId: 'd704bde5-fe36-44ff-9a26-221d53772dd0',
        // The PROD company app is not pinned yet, so the company route has no client.
        companyClientId: undefined,
      }));
  });
});
