import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import { runCommand } from '../helpers/action-dsl.js';

describe('blocks command journey', () => {
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
    await env.cleanup();
  });

  test('HP001 lists built-in foundation and product block ids for app delivery', async () => {
    const result = await runCommand(ctx, 'eai blocks list --format json');

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.blocks.map((block: { id: string }) => block.id)).toContain('core.button');
    expect(payload.blocks.map((block: { id: string }) => block.id)).toContain('daisy.chatbot');
  });

  test('BP001 rejects unknown block ids with a helpful message', async () => {
    const result = await runCommand(ctx, 'eai blocks describe missing.block');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown block id "missing.block"');
  });
});
