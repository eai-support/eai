import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function createFakeOpen(binDir: string): Promise<void> {
  const script = `#!/bin/sh
node -e '
const authUrl = new URL(process.argv[1]);
const redirect = new URL(authUrl.searchParams.get("redirect_uri"));
redirect.searchParams.set("code", "test-auth-code");
redirect.searchParams.set("state", authUrl.searchParams.get("state"));
fetch(redirect).then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
' "$1"
`;

  await writeFile(join(binDir, 'open'), script, { mode: 0o755 });
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

  test('browserLogin completes callback flow and stores tokens', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'eai-auth-home-'));
    const tempBin = await mkdtemp(join(tmpdir(), 'eai-auth-bin-'));
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;

    process.env.HOME = tempHome;
    process.env.PATH = `${tempBin}:${originalPath ?? ''}`;

    await createFakeOpen(tempBin);

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({
        access_token: createJwt({
          preferred_username: 'browser@example.com',
          oid: 'oid-123',
        }),
        refresh_token: 'refresh-token',
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
      'eaidevmyentepriseai',
      '50808ce0-f31b-4fd0-9861-74b83b8c112a',
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

    process.env.HOME = originalHome;
    process.env.PATH = originalPath;
    await rm(tempHome, { recursive: true, force: true });
    await rm(tempBin, { recursive: true, force: true });
  });

  test('browserLogin surfaces token exchange failures', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'eai-auth-home-'));
    const tempBin = await mkdtemp(join(tmpdir(), 'eai-auth-bin-'));
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;

    process.env.HOME = tempHome;
    process.env.PATH = `${tempBin}:${originalPath ?? ''}`;

    await createFakeOpen(tempBin);

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
      'eaidevmyentepriseai',
      '50808ce0-f31b-4fd0-9861-74b83b8c112a',
      'client-id-123',
      'openid profile email offline_access',
    )).rejects.toThrow('Token exchange failed: invalid_grant');

    await expect(readFile(join(tempHome, '.eai', 'tokens.json'), 'utf-8')).rejects.toThrow();

    process.env.HOME = originalHome;
    process.env.PATH = originalPath;
    await rm(tempHome, { recursive: true, force: true });
    await rm(tempBin, { recursive: true, force: true });
  });

  test('refresh flow includes the stored auth scope', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'eai-auth-home-'));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    const authScope = 'openid profile email offline_access api://97f59e40-0d86-4c6d-8ac6-80659fea1a4e/access_token';
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
        refresh_token: 'new-refresh-token',
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
      accessToken: 'expired-access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1000,
      tenantId: 'dffacd2b-7705-43f2-86ae-75d1ef003a71',
      tenantName: 'enterpriseaitestplatform',
      clientId: '861ad00a-aba1-47e4-baf2-3e3f6ef4a69e',
      authScope,
    });

    const nextToken = await getAccessToken();
    expect(nextToken).toBe(refreshedAccessToken);

    const stored = await loadTokens();
    expect(stored?.refreshToken).toBe('new-refresh-token');
    expect(stored?.authScope).toBe(authScope);

    process.env.HOME = originalHome;
    await rm(tempHome, { recursive: true, force: true });
  });
});
