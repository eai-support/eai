/**
 * Init Command Integration Tests
 *
 * Tests for: eai init [name] [--from <repo>] [--skip-prompts]
 */

import { describe, test, beforeEach, afterEach, expect } from 'vitest';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { createMockServer, PublicAPIMock } from '../helpers/mock-server.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import {
  workingDirectoryIs,
  gitIsInstalled,
  networkIsAvailable,
  directoryExists,
} from '../helpers/setup-dsl.js';
import { runCommand, respondToPrompt } from '../helpers/action-dsl.js';
import {
  expectCommandSucceeded,
  expectCommandFailed,
  expectDirectoryCreated,
  expectFileExists,
  expectFileContains,
  expectErrorMessage,
  expectSuccessMessage,
  expectNoPrompts,
  expectExitCode,
} from '../helpers/assert-dsl.js';

describe('eai init', () => {
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
    await env.cleanup();
  });

  test.skip('TC001: Initialize new vertical interactively (E2E - requires network)', async () => {
    // TC001: Initialize new vertical interactively
    // Traces to: Init-US1-AC1
    //
    // workingDirectoryIs('/tmp/test-projects')
    // gitIsInstalled()
    // networkIsAvailable()
    //
    // runCommand('eai init my-vertical')
    // respondToPrompt('Display Name', 'My Vertical')
    // respondToPrompt('Description', 'Test vertical app')
    // respondToPrompt('Tenant Structure', 'single')
    // respondToPrompt('Include AI Chat', 'yes')
    // respondToPrompt('Include Docs', 'yes')
    // respondToPrompt('Auth Provider', 'ciam')
    //
    // expectDirectoryCreated('my-vertical')
    // expectFileExists('my-vertical/package.json')
    // expectFileContains('my-vertical/package.json', '"name": "my-vertical"')
    // expectFileExists('my-vertical/.env.local')
    // expectFileExists('my-vertical/src/eai.config/object-types.ts')
    // expectSuccessMessage('Vertical "My Vertical" initialized')

    workingDirectoryIs(ctx, env.dir);
    gitIsInstalled(ctx);
    networkIsAvailable(ctx);

    respondToPrompt(ctx, 'Display Name', 'My Vertical');
    respondToPrompt(ctx, 'Description', 'Test vertical app');
    respondToPrompt(ctx, 'Tenant Structure', 'single');
    respondToPrompt(ctx, 'Include AI Chat', 'yes');
    respondToPrompt(ctx, 'Include Docs', 'yes');
    respondToPrompt(ctx, 'Auth Provider', 'ciam');

    const result = await runCommand(ctx, 'eai init my-vertical');

    await expectDirectoryCreated(ctx, 'my-vertical');
    await expectFileExists(ctx, 'my-vertical/package.json');
    await expectFileContains(ctx, 'my-vertical/package.json', '"name": "my-vertical"');
    await expectFileExists(ctx, 'my-vertical/.env.local');
    await expectFileExists(ctx, 'my-vertical/src/eai.config/object-types.ts');
    expectSuccessMessage(result, 'Vertical "My Vertical" initialized');
  });

  test.skip('TC002: Initialize with --skip-prompts flag (E2E - requires network)', async () => {
    // TC002: Initialize with --skip-prompts flag
    // Traces to: Init-US1-AC2
    //
    // workingDirectoryIs('/tmp/test-projects')
    //
    // runCommand('eai init quick-app --skip-prompts')
    //
    // expectDirectoryCreated('quick-app')
    // expectFileContains('quick-app/package.json', '"name": "quick-app"')
    // expectFileContains('quick-app/package.json', '"displayName": "Quick App"')
    // expectNoPrompts()

    workingDirectoryIs(ctx, env.dir);

    const result = await runCommand(ctx, 'eai init quick-app --skip-prompts');

    await expectDirectoryCreated(ctx, 'quick-app');
    await expectFileContains(ctx, 'quick-app/package.json', '"name": "quick-app"');
    expectNoPrompts(ctx);
    expectCommandSucceeded(result);
  });

  test.skip('TC004: Init fails when directory exists (E2E - requires network)', async () => {
    // TC004: Init fails when directory exists
    // Traces to: Init-US1-ERR1
    //
    // directoryExists('/tmp/test-projects/existing-app')
    //
    // runCommand('eai init existing-app')
    //
    // expectCommandFailed()
    // expectErrorMessage('Directory "existing-app" already exists')
    // expectExitCode(1)

    workingDirectoryIs(ctx, env.dir);
    await directoryExists(ctx, 'existing-app');

    const result = await runCommand(ctx, 'eai init existing-app');

    expectCommandFailed(result);
    expectErrorMessage(result, 'Directory "existing-app" already exists');
    expectExitCode(result, 1);
  });

  // Additional tests would follow the same pattern...
  // TC003: Initialize from custom template repository
  // TC005: Initialize fails when git not installed
  // TC006: Initialize multi-tenant structure
  // TC007: Initialize without AI chat
  // TC008: Generated object-types.ts is valid
  // TC009: Generated deployment workflow is valid
  // TC010: Init creates initial git commit
});
