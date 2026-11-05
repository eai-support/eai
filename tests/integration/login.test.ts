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
        // The direct path only: the --company flow must not start here.
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

describe('eai login command: --company, --direct and the save prompt', () => {
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

  test.each([
    ['--direct', ['--direct']],
    ['plain eai login', []],
  ])('%s keeps today\'s direct sign-in with the ordinary app', async (_name, args) => {
    const auth = await import('../../src/lib/auth.js');
    const direct = vi.spyOn(auth, 'browserLogin').mockResolvedValue({
      accessToken: createJwt({ preferred_username: 'person@example.test' }), expiresAt: Date.now() + 600_000,
      tenantName: 'enterpriseaiplatform', tenantId: 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26', clientId: 'direct-client',
    });
    const company = vi.spyOn(auth, 'companyLogin');

    const { exitCode, output } = await runLogin(args);

    expect(exitCode).toBeUndefined();
    expect(direct).toHaveBeenCalledWith(
      'enterpriseaiplatform', 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26', 'd704bde5-fe36-44ff-9a26-221d53772dd0',
      expect.any(String), expect.any(Object),
    );
    expect(company).not.toHaveBeenCalled();
    expect(output).not.toContain('Save this login?');
  });

});
