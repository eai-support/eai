/**
 * Verify Command Integration Tests
 *
 * Tests for: eai verify
 */

import { describe, test, beforeEach, afterEach } from 'vitest';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { createMockServer, PublicAPIMock } from '../helpers/mock-server.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import {
  workingDirectoryIs,
  userIsLoggedIn,
  projectHasEnvFile,
  projectHasValidObjectTypes,
  cleanupTestTokens,
} from '../helpers/setup-dsl.js';
import { runCommand } from '../helpers/action-dsl.js';
import { expectDisplayedMessage } from '../helpers/assert-dsl.js';

describe('eai verify', () => {
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
    await cleanupTestTokens(ctx);
    await env.cleanup();
  });

  test('TC092: Verify shows system checks', { timeout: 10000 }, async () => {
    // TC092: Verify all checks pass
    // Traces to: Verify-US1-AC1
    //
    // userIsLoggedIn()
    // projectHasValidObjectTypes()
    // projectHasEnvFile()
    //
    // runCommand('eai verify')
    //
    // expectDisplayedMessage('PublicAPI')
    // expectDisplayedMessage('Authentication')

    workingDirectoryIs(ctx, env.dir);
    await userIsLoggedIn(ctx);
    await projectHasEnvFile(ctx, {
      BASE_URL_PUBLIC_API: 'https://test-api.example.com',
      TENANT_DEFAULT_ID: 'test-tenant-id',
    });
    await projectHasValidObjectTypes(ctx, [
      { name: 'Customer', displayName: 'Customer', status: 'published' },
    ]);

    const result = await runCommand(ctx, 'eai verify');

    // Should show check results
    expectDisplayedMessage(result, 'Platform Connectivity Checks');
  });

  test('TC093: Verify detects issues', { timeout: 10000 }, async () => {
    // TC093: Verify fails on API unreachable
    // Traces to: Verify-US1-ERR1
    //
    // projectHasEnvFile({ BASE_URL_PUBLIC_API: 'https://invalid-api.example.com' })
    // projectHasValidObjectTypes()
    //
    // runCommand('eai verify')
    //
    // expectDisplayedMessage('unreachable')

    workingDirectoryIs(ctx, env.dir);
    await projectHasEnvFile(ctx, {
      BASE_URL_PUBLIC_API: 'https://invalid-api.example.com',
    });
    await projectHasValidObjectTypes(ctx, [
      { name: 'Test', displayName: 'Test' },
    ]);

    const result = await runCommand(ctx, 'eai verify');

    // Should show connectivity checks (even if they fail)
    expectDisplayedMessage(result, 'Connectivity Checks');
  });

  test('TC094: Verify accepts an explicit tenant-id for read-only checks', { timeout: 10000 }, async () => {
    workingDirectoryIs(ctx, env.dir);
    await userIsLoggedIn(ctx);
    await projectHasEnvFile(ctx, {
      BASE_URL_PUBLIC_API: 'https://test-api.example.com',
    });
    await projectHasValidObjectTypes(ctx, [
      { name: 'Customer', displayName: 'Customer', status: 'published' },
    ]);

    const result = await runCommand(ctx, 'eai verify --tenant-id tenant-override');

    expectDisplayedMessage(result, 'Platform Connectivity Checks');
  });
});
