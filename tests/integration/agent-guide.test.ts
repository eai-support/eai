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
    expect(guide.operatingRules).toContain(
      'If a platform user lookup or membership prerequisite returns MISSING_TENANT or "Tenant context required for app tokens", run eai errors explain app_token_tenant_context_required --format json and retry through /v4/platform/tenants/<tenant-id>/... routes before changing tenant members, Entra, or role definitions.',
    );
  });

  test('catalog tells agents to use user invite for normal tenant member management', () => {
    const guide = getAgentGuide();

    expect(guide.operatingRules).toContain(
      'For normal tenant user/admin addition, use eai user invite --email <email> --tenant <tenant-id> --role <role>; do not use tenant bootstrap-admin.',
    );
    expect(guide.operatingRules).toContain(
      'If user invite fails with a 5xx or EXTERNAL_SERVICE_ERROR, run eai errors explain user_invite_external_service_existing_member --format json, check for an existing member with eai user list, and only then use eai user role set by member ID when approved.',
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
            expect.objectContaining({
              command: 'eai user role set --tenant <tenant-id> --member-id <member-id> --role tenant-admin --format json',
              mutates: true,
            }),
          ]),
        }),
      ]),
    );
  });

  test('catalog tells agents how to choose document workflow versus resource files', () => {
    const guide = getAgentGuide();

    expect(guide.operatingRules).toContain(
      'For files, use eai docs when the file is a document to process, classify, index, or expose to AI context. Use eai resources file only when the file is attached to a typed resource object file property.',
    );
    expect(guide.operatingRules).toContain(
      'Do not invent standalone PublicAPI v4 blob-upload flows. Ask whether the user needs a document workflow or a resource file property.',
    );
    expect(guide.commonWorkflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Documents, files, and AI context',
          commands: expect.arrayContaining([
            expect.objectContaining({
              command: 'eai docs upload <file>',
              mutates: true,
            }),
            expect.objectContaining({
              command: 'eai resources file upload <type> <id> <property> <path> --tenant-id <tenant-id>',
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
