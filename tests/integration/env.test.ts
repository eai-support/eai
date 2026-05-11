/**
 * Env Command Integration Tests
 *
 * Tests for: eai env list, eai env pull, eai env push
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { patchEnvFile } from '../../src/lib/config.js';
import { getAzureCliInvocation } from '../../src/lib/azure-cli.js';
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
    await cleanupTestTokens(ctx);
    await env.cleanup();
  });

  test('TC024: List loaded environment variables', { timeout: 10000 }, async () => {
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
  });

  test('patchEnvFile merges new keys without overwriting existing ones', async () => {
    await projectHasEnvFile(ctx, {
      AUTH_SECRET: 'existing-secret',
      OTHER_KEY: 'keep-me',
    });

    await patchEnvFile(env.dir, { NEW_KEY: 'new-value' });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('AUTH_SECRET=existing-secret');
    expect(content).toContain('OTHER_KEY=keep-me');
    expect(content).toContain('NEW_KEY=new-value');
  });

  test('TC028: Pull requires EAI project', { timeout: 10000 }, async () => {
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
  });
});

describe('getAzureCliInvocation', () => {
  test('uses az directly on macOS and Linux', () => {
    expect(getAzureCliInvocation(['group', 'list'], 'darwin')).toEqual({
      file: 'az',
      args: ['group', 'list'],
    });
    expect(getAzureCliInvocation(['group', 'list'], 'linux')).toEqual({
      file: 'az',
      args: ['group', 'list'],
    });
  });

  test('uses cmd.exe on Windows', () => {
    expect(getAzureCliInvocation(['group', 'list'], 'win32')).toEqual({
      file: 'cmd.exe',
      args: ['/c', 'az', 'group', 'list'],
    });
  });
});
