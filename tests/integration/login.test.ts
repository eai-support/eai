import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import { runCommand } from '../helpers/action-dsl.js';

function createJwt(payload: Record<string, string>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
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

function mockBrowserLauncher(): void {
  vi.doMock('node:child_process', () => ({
    spawn: (_command: string, args: string[]) => {
      const child = new EventEmitter();

      queueMicrotask(async () => {
        try {
          const authUrl = new URL(args[args.length - 1]);
          const redirect = new URL(authUrl.searchParams.get('redirect_uri') || '');
          redirect.searchParams.set('code', 'test-auth-code');
          redirect.searchParams.set('state', authUrl.searchParams.get('state') || '');
          await completeBrowserCallback(redirect.toString());
          child.emit('close', 0);
        } catch (error) {
          child.emit('error', error);
        }
      });

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

  beforeEach(async () => {
    env = await createTestEnvironment();
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
    vi.doUnmock('node:child_process');
    await env.cleanup();
  });

  test('help output excludes --client-id', async () => {
    const result = await runCommand(ctx, 'eai login --help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Authenticate with Entra CIAM');
    expect(result.stdout).not.toContain('--client-id');
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
