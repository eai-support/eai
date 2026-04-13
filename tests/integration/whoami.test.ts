/**
 * Whoami Command Integration Tests
 *
 * Tests for: eai whoami
 */

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

describe('eai whoami', () => {
  let env: TestEnvironment;
  let mockServer: ReturnType<typeof createMockServer>;
  let ctx: TestContext;
  let originalHome: string | undefined;
  let originalAccessToken: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
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
    if (originalAccessToken === undefined) {
      delete process.env.EAI_ACCESS_TOKEN;
    } else {
      process.env.EAI_ACCESS_TOKEN = originalAccessToken;
    }
    await env.cleanup();
  });

  test('TC016: Whoami shows current user info', { timeout: 5000 }, async () => {
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

  test('uses the resolved PublicAPI URL for membership lookup', { timeout: 5000 }, async () => {
    workingDirectoryIs(ctx, env.dir);
    await projectHasValidObjectTypes(ctx, [{ name: 'case', displayName: 'Case' }]);
    await projectHasEnvFile(ctx, { BASE_URL_PUBLIC_API: RESOLVED_API_BASE });
    process.env.HOME = env.dir;
    process.env.EAI_ACCESS_TOKEN = 'test-access-token';
    await storeTokens({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
      upn: 'test@example.com',
      oid: 'test-user-oid',
      tenantId: 'test-tenant',
      tenantName: 'test-tenant',
      clientId: 'test-client-id',
      activeTenantId: 'test-tenant',
      activeTenantName: 'test-tenant',
      activeTenantSlug: 'test-tenant',
      publicApiUrl: STORED_API_BASE,
    });

    let staleApiHit = false;
    let membershipRequestBody: unknown;

    mockServer.server.use(
      http.post(`${RESOLVED_API_BASE}/v3/orchestrate`, async ({ request }) => {
        membershipRequestBody = await request.json();
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
      http.post(`${STORED_API_BASE}/v3/orchestrate`, () => {
        staleApiHit = true;
        return HttpResponse.json({ detail: 'stale token URL used' }, { status: 500 });
      }),
    );

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await whoamiCommand.parseAsync([], { from: 'user' });

    expect(staleApiHit).toBe(false);
    expect(membershipRequestBody).toMatchObject({
      target_backend: 'admin',
      endpoint: '/v1/users/test-user-oid/memberships',
      method: 'GET',
    });
  });

  test('TC018: Whoami when not logged in', { timeout: 5000 }, async () => {
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
