import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { getAgentGuide } from '../../src/lib/agent-guide.js';
import { runCommand } from '../helpers/action-dsl.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import type { TestContext } from '../helpers/setup-dsl.js';

describe('agent guide', () => {
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

  test('catalog tells agents how to discover commands and recover errors', () => {
    const guide = getAgentGuide();

    expect(guide.firstCommands.map((entry) => entry.command)).toContain('eai --describe');
    expect(guide.recoveryLoop).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Explain the error',
          commands: expect.arrayContaining([
            expect.objectContaining({
              command: 'eai errors explain <code-or-reason> --format json',
              mutates: false,
            }),
          ]),
        }),
      ]),
    );
    expect(guide.operatingRules).toContain('When calling eai publicapi directly, only use /v4 paths.');
  });

  test('catalog tells agents to use user invite for normal tenant member management', () => {
    const guide = getAgentGuide();

    expect(guide.operatingRules).toContain(
      'For normal tenant user/admin addition, use eai user invite --email <email> --tenant <tenant-id> --role <role>; do not use tenant bootstrap-admin.',
    );
    expect(guide.commonWorkflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Tenant member management',
          commands: expect.arrayContaining([
            expect.objectContaining({
              command: 'eai user invite --email <email> --tenant <tenant-id> --role tenant-admin --format json',
              mutates: true,
            }),
          ]),
        }),
      ]),
    );
  });

  test('prints the agent guide in text mode', async () => {
    const result = await runCommand(ctx, 'eai agent guide');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('EAI agent operating guide');
    expect(result.stdout).toContain('Recovery loop');
    expect(result.stdout).toContain('eai errors explain <code-or-reason> --format json');
  });

  test('prints the agent guide in JSON mode', async () => {
    const result = await runCommand(ctx, 'eai agent guide --format json');

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as ReturnType<typeof getAgentGuide>;

    expect(payload.audience).toBe('ai-agents');
    expect(payload.firstCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'eai --describe',
          mutates: false,
        }),
      ]),
    );
    expect(payload.stopConditions.length).toBeGreaterThan(0);
  });
});
