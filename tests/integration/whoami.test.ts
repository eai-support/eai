/**
 * Whoami Command Integration Tests
 *
 * Tests for: eai whoami
 */

import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { createMockServer, PublicAPIMock } from '../helpers/mock-server.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import {
  workingDirectoryIs,
  userIsLoggedIn,
  userIsNotLoggedIn,
  cleanupTestTokens,
  projectHasEnvFile,
  projectHasValidObjectTypes,
} from '../helpers/setup-dsl.js';
import { runCommand } from '../helpers/action-dsl.js';
import {
  expectCommandSucceeded,
  expectDisplayedMessage,
} from '../helpers/assert-dsl.js';
import { storeTokens, clearTokens } from '../../src/lib/auth.js';
import { whoamiCommand } from '../../src/commands/whoami.js';

const STORED_API_BASE = 'https://test-api.example.com';
const RESOLVED_API_BASE = 'https://current-api.example.com';
const PROD_AUTH_TENANT_NAME = 'enterpriseaiplatform';
const PROD_AUTH_TENANT_ID = 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26';
const PROD_AUTH_CLIENT_ID = 'd704bde5-fe36-44ff-9a26-221d53772dd0';

async function writeEncryptedTokenFile(
  homeDir: string,
  relativePath: string,
  tokens: Record<string, unknown>,
): Promise<void> {
  const key = createHash('sha256').update(`eai-${homeDir}-token-store`).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(JSON.stringify(tokens), 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  const target = join(homeDir, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${iv.toString('hex')}:${encrypted}`, { encoding: 'utf-8', mode: 0o600 });
}

async function writeStoredTokens(
  homeDir: string,
  relativePath: string,
  email: string,
): Promise<void> {
  await writeEncryptedTokenFile(homeDir, relativePath, {
    accessToken: '<fixture-access-token>',
    refreshToken: '<fixture-refresh-token>',
    expiresAt: Date.now() + 3600000,
    upn: email,
    oid: 'test-user-oid',
    tenantId: PROD_AUTH_TENANT_ID,
    tenantName: PROD_AUTH_TENANT_NAME,
    clientId: PROD_AUTH_CLIENT_ID,
  });
}

describe('eai whoami', () => {
  let env: TestEnvironment;
  let mockServer: ReturnType<typeof createMockServer>;
  let ctx: TestContext;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalAccessToken: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalAccessToken = process.env.EAI_ACCESS_TOKEN;
    env = await createTestEnvironment();
    mockServer = createMockServer();
    mockServer.start();

    ctx = {
      workingDir: env.dir,
      mockAPI: new PublicAPIMock('https://test-api.example.com', mockServer),
      env: {},
      prompts: [],
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    mockServer.stop();
    await cleanupTestTokens(ctx);
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

  test('TC016: Whoami shows current user info', { timeout: 15000 }, async () => {
    // TC016: Whoami displays current user info
    // Traces to: Auth-US3-AC1
    //
    // userIsLoggedIn({ email: 'dev@company.com', tenant: 'my-tenant' })
    // tokenNotExpired()
    //
    // runCommand('eai whoami')
    //
    // expectDisplayedMessage('Logged in as: dev@company.com')
    // expectDisplayedMessage('Tenant: my-tenant')

    workingDirectoryIs(ctx, env.dir);
    await userIsLoggedIn(ctx, { email: 'test@example.com', tenant: 'test-tenant' });

    const result = await runCommand(ctx, 'eai whoami');

    expectCommandSucceeded(result);
    expectDisplayedMessage(result, 'test@example.com');
  });

  test('uses the resolved PublicAPI URL for membership lookup', { timeout: 15000 }, async () => {
    workingDirectoryIs(ctx, env.dir);
    await projectHasValidObjectTypes(ctx, [{ name: 'case', displayName: 'Case' }]);
    await projectHasEnvFile(ctx, { BASE_URL_PUBLIC_API: RESOLVED_API_BASE });
    process.env.HOME = env.dir;
    process.env.USERPROFILE = env.dir;
    process.env.EAI_ACCESS_TOKEN = '<fixture-access-token>';
    await storeTokens({
      accessToken: '<fixture-access-token>',
      refreshToken: '<fixture-refresh-token>',
      expiresAt: Date.now() + 3600000,
      upn: 'test@example.com',
      oid: 'test-user-oid',
      tenantId: PROD_AUTH_TENANT_ID,
      tenantName: PROD_AUTH_TENANT_NAME,
      clientId: PROD_AUTH_CLIENT_ID,
      activeTenantId: 'test-tenant',
      activeTenantName: 'test-tenant',
      activeTenantSlug: 'test-tenant',
      publicApiUrl: STORED_API_BASE,
    });

    let staleApiHit = false;
    let membershipRequestHeaders: Record<string, string> | undefined;

    mockServer.server.use(
      http.get(`${RESOLVED_API_BASE}/v4/identity/tenants`, async ({ request }) => {
        membershipRequestHeaders = Object.fromEntries(request.headers.entries());
        return HttpResponse.json({
          tenants: [
            {
              id: 'test-tenant',
              displayName: 'Test Tenant',
              slug: 'test-tenant',
              isActive: true,
              roles: ['tenant-admin'],
            },
          ],
        });
      }),
      http.get(`${STORED_API_BASE}/v4/identity/tenants`, () => {
        staleApiHit = true;
        return HttpResponse.json({ detail: 'stale token URL used' }, { status: 500 });
      }),
    );

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await whoamiCommand.parseAsync([], { from: 'user' });

    expect(staleApiHit).toBe(false);
    expect(membershipRequestHeaders?.authorization).toBe('Bearer <fixture-access-token>');
  });

  test('plain commands ignore persisted activeProfile and profiles require explicit opt-in', { timeout: 15000 }, async () => {
    workingDirectoryIs(ctx, env.dir);
    ctx.env.HOME = env.dir;
    ctx.env.USERPROFILE = env.dir;

    await mkdir(join(env.dir, '.eai'), { recursive: true });
    await writeFile(
      join(env.dir, '.eai', 'config.json'),
      JSON.stringify({
        activeProfile: 'test',
        profiles: {
          test: {
            publicApiUrl: 'https://test-api.example.com/public',
            authTenantName: PROD_AUTH_TENANT_NAME,
            authTenantId: PROD_AUTH_TENANT_ID,
            authClientId: PROD_AUTH_CLIENT_ID,
            authScope: 'openid profile email offline_access api://test-publicapi/access_token',
          },
        },
      }, null, 2),
    );
    await writeStoredTokens(env.dir, '.eai/tokens.json', 'default-prod@example.com');
    await writeStoredTokens(env.dir, '.eai/tokens/test.json', 'profile-test@example.com');

    const plain = await runCommand(ctx, 'eai whoami');
    expectCommandSucceeded(plain);
    expectDisplayedMessage(plain, 'default-prod@example.com');
    expect(plain.stdout).not.toContain('profile-test@example.com');
    expectDisplayedMessage(plain, 'Profile');
    expectDisplayedMessage(plain, 'default');

    const profiled = await runCommand(ctx, 'eai --profile test whoami');
    expectCommandSucceeded(profiled);
    expectDisplayedMessage(profiled, 'profile-test@example.com');
    expectDisplayedMessage(profiled, 'test');
  });

  test('TC018: Whoami when not logged in', { timeout: 15000 }, async () => {
    // TC018: Whoami when not logged in
    // Traces to: Auth-US3-ERR1
    //
    // userIsNotLoggedIn()
    //
    // runCommand('eai whoami')
    //
    // expectInfoMessage('Not logged in')

    workingDirectoryIs(ctx, env.dir);
    await userIsNotLoggedIn(ctx);

    const result = await runCommand(ctx, 'eai whoami');

    // CLI outputs: "✗ Not logged in. Run `eai login` to authenticate."
    expectDisplayedMessage(result, 'Not logged in');
  });
});
