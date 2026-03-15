/**
 * Whoami Command Integration Tests
 *
 * Tests for: eai whoami
 */

import { describe, test, beforeEach, afterEach } from 'vitest';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { createMockServer, PublicAPIMock } from '../helpers/mock-server.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import { workingDirectoryIs, userIsLoggedIn, userIsNotLoggedIn, tokenExpired, cleanupTestTokens } from '../helpers/setup-dsl.js';
import { runCommand } from '../helpers/action-dsl.js';
import {
  expectCommandSucceeded,
  expectDisplayedMessage,
  expectInfoMessage,
} from '../helpers/assert-dsl.js';

describe('eai whoami', () => {
  let env: TestEnvironment;
  let mockServer: ReturnType<typeof createMockServer>;
  let ctx: TestContext;

  beforeEach(async () => {
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
    mockServer.stop();
    await cleanupTestTokens();
    await env.cleanup();
  });

  test('TC016: Whoami shows current user info', async () => {
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
  }, { timeout: 5000 });

  test('TC018: Whoami when not logged in', async () => {
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
  }, { timeout: 5000 });
});
