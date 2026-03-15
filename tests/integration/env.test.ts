/**
 * Env Command Integration Tests
 *
 * Tests for: eai env list, eai env pull, eai env push
 */

import { describe, test, beforeEach, afterEach } from 'vitest';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { createMockServer, PublicAPIMock } from '../helpers/mock-server.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import {
  workingDirectoryIs,
  projectHasEnvFile,
  projectHasValidObjectTypes,
  cleanupTestTokens,
} from '../helpers/setup-dsl.js';
import { runCommand } from '../helpers/action-dsl.js';
import { expectDisplayedMessage, expectCommandSucceeded } from '../helpers/assert-dsl.js';

describe('eai env', () => {
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

  test('TC024: List loaded environment variables', async () => {
    // TC024: List loaded environment variables
    // Traces to: Env-US2-AC1
    //
    // projectHasEnvFile({ BASE_URL_PUBLIC_API: 'https://api.example.com', TENANT_DEFAULT_ID: 'tenant-123' })
    //
    // runCommand('eai env list')
    //
    // expectDisplayedMessage('BASE_URL_PUBLIC_API')
    // expectDisplayedMessage('TENANT_DEFAULT_ID')

    workingDirectoryIs(ctx, env.dir);
    await projectHasValidObjectTypes(ctx, [
      { name: 'Test', displayName: 'Test' },
    ]);
    await projectHasEnvFile(ctx, {
      BASE_URL_PUBLIC_API: 'https://api.example.com',
      TENANT_DEFAULT_ID: 'tenant-123',
    });

    const result = await runCommand(ctx, 'eai env list');

    expectCommandSucceeded(result);
    expectDisplayedMessage(result, 'Environment (');
    expectDisplayedMessage(result, 'BASE_URL_PUBLIC_API');
  }, { timeout: 5000 });

  test('TC028: Pull requires EAI project', async () => {
    // TC028: Pull fails when not in EAI project
    // Traces to: Env-US1-ERR1
    //
    // notInEAIProject()
    //
    // runCommand('eai env pull')
    //
    // expectErrorMessage('Not in an EAI project')

    workingDirectoryIs(ctx, env.dir);

    const result = await runCommand(ctx, 'eai env pull');

    // Should detect not in EAI project
    expectDisplayedMessage(result, 'Not in an EAI project');
  }, { timeout: 5000 });
});
