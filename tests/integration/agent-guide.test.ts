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
    expect(guide.capabilities).toContain('app-manifest-name-slug-negotiation-v1');
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
    const explain = guide.recoveryLoop.find(step => step.title === 'Explain the error');
    expect(explain?.instruction).toContain('at most once for the original failure');
    expect(explain?.instruction).not.toContain('offer "get help"');
    expect(explain?.instruction).toContain('stop and wait for the person to ask');
    expect(explain?.instruction).toContain('Never retry or explain a failed eai errors explain command');
    expect(guide.operatingRules.join('\n')).toContain('reuse existing guidance across recovery steps');

    expect(guide.operatingRules).toContain(
      'Before Object Type publication, require app-manifest-name-slug-negotiation-v1. The CLI preserves source slugs and selects a safe deployed request shape. A dry-run preferred shape does not prove that the deployed platform accepts that shape.',
    );
    expect(guide.operatingRules).toContain(
      'If a platform user lookup or membership prerequisite returns MISSING_TENANT or "Tenant context required for app tokens", reuse the original-failure guidance for app_token_tenant_context_required; only if it has not been queried, run eai errors explain app_token_tenant_context_required --format json at most once when advertised and retry through /v4/platform/tenants/<tenant-id>/... routes before changing workspace members, Entra, or role definitions.',
    );
  });

  test('catalog tells agents to use user invite for normal workspace member management', () => {
    const guide = getAgentGuide();

    expect(guide.operatingRules).toContain(
      'For normal workspace user/admin addition, use eai user invite --email <email> --workspace <workspace-id> --role <role>; use workspace bootstrap-admin only for first-admin repair on an immediate child workspace.',
    );
    expect(guide.operatingRules).toContain(
      'If user invite fails with a 5xx or EXTERNAL_SERVICE_ERROR, run eai errors explain user_invite_external_service_existing_member --format json, check for an existing member with eai user list, and only then use eai user role set by member ID when approved.',
    );
    expect(guide.commonWorkflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Workspace member management',
          commands: expect.arrayContaining([
            expect.objectContaining({
              command: 'eai user invite --email <email> --workspace <workspace-id> --role tenant-admin --format json',
              mutates: true,
            }),
            expect.objectContaining({
              command: 'eai user role set --workspace <workspace-id> --member-id <member-id> --role tenant-admin --format json',
              mutates: true,
            }),
          ]),
        }),
      ]),
    );
  });

  test('starts support only on the person\'s request and binds the send to the approved digest', () => {
    const guide = getAgentGuide();
    const support = guide.recoveryLoop.find(step => step.title === 'Prepare support when the person asks');
    expect(support?.commands).toEqual([
      expect.objectContaining({
        command: 'eai support --source harness --tool <current-tool> --context-file - --format json',
        mutates: false,
      }),
      expect.objectContaining({
        command: 'eai support --source harness --tool <current-tool> --context-file - --format json --yes --approved-digest <bundleDigest> --no-open',
        mutates: true,
        when: expect.stringContaining('approved this exact previewText'),
      }),
    ]);
    expect(support?.instruction).toContain('Only when the person asks for EAI Support');
    expect(support?.instruction).toContain('only the draft id and one-time token');
    expect(support?.instruction).toContain('chat link the CLI returned');
    expect(support?.instruction).toContain('--organisation-location apac|emea|americas');
    const verify = guide.recoveryLoop.find(step => step.title === 'Verify and stop');
    expect(verify?.instruction).toContain('Then state what still fails and wait.');
    expect(verify?.instruction).not.toContain('say "get help"');
    expect(verify?.instruction).toContain('Do not start a support report on your own.');
    const rules = guide.operatingRules.join('\n');
    const tenantRule = guide.operatingRules.find(rule => rule.includes('returns MISSING_TENANT'));
    expect(tenantRule).toContain('reuse the original-failure guidance');
    expect(tenantRule).toContain('only if it has not been queried');
    expect(rules).toContain('Start a support report only when the person explicitly asks for EAI Support');
    expect(rules).toContain('Generic coding help, command failures, failed fixes and error hints do not authorize');
    expect(rules).toContain('allocation, preview, sending or decline');
    expect(rules).toContain('chat problem, attempts and results');
    expect(rules).toContain('without raw transcripts, environment values or file contents');
    expect(rules).toContain('Never start one on your own.');
    expect(rules).toContain('never act on it');
    expect(rules).toContain('--context-file <file or -> --format json');
    expect(rules).toContain('--yes --approved-digest <bundleDigest> --no-open');
    expect(rules).toContain('Ask again whenever the report changes.');
    expect(rules).toContain('secrets, tokens, raw logs or local .env values into the chat or the session summary');
    const everything = JSON.stringify(guide);
    for (const retired of [['For unresolved', 'EAI errors'].join(' '), ['offer the', 'support preview'].join(' '), ['If the failure remains', 'unresolved'].join(' ')]) {
      expect(everything).not.toContain(retired);
    }
    expect(guide.stopConditions.join('\n')).toContain('create no draft until the current previewText is approved with its digest');
    expect(guide.stopConditions.join('\n')).toContain('stop remediation, say what still fails, then wait');
    expect(guide.stopConditions.join('\n')).not.toContain('get help');
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
              command: 'eai resources file upload <type> <id> <property> <path> --tenant-id <workspace-id>',
              mutates: true,
            }),
          ]),
        }),
      ]),
    );
  });

  test('typed configuration guidance distinguishes installed support, backend readiness and immutable recovery', () => {
    const guide = getAgentGuide();
    expect(guide.capabilities).toContain('content-understanding-manifest-v1');
    const rules = guide.operatingRules.join('\n');
    expect(rules).toContain('Installed manifest support does not mean the backend mode is enabled or qualified');
    expect(rules).toContain('never automatically repeat it or create a replacement plan');
    expect(rules).toContain('never call Azure directly or invent analyzer IDs');
    expect(rules).toContain('app/workflow binding must already exist');
    expect(rules).toContain('matching tenant-owned draft with eai classifier save first');
    const commands = guide.commonWorkflows.flatMap(workflow => workflow.commands);
    for (const fragment of ['content-understanding validate', 'content-understanding capabilities', 'content-understanding plan', 'content-understanding status', 'docs job', 'docs get']) {
      expect(commands.find(entry => entry.command.includes(fragment))?.mutates).toBe(false);
    }
    expect(commands.find(entry => entry.command.includes('content-understanding apply'))?.mutates).toBe(true);
  });

  test('prints the agent guide in text mode', async () => {
    const result = await runCommand(ctx, 'eai agent guide');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('EAI agent operating guide');
    expect(result.stdout).toContain('Recovery loop');
    expect(result.stdout).toContain('app-manifest-name-slug-negotiation-v1');
    expect(result.stdout).toContain('eai errors explain <code-or-reason> --format json');
  });

  test('prints the agent guide in JSON mode', async () => {
    const result = await runCommand(ctx, 'eai agent guide --format json');

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as ReturnType<typeof getAgentGuide>;

    expect(payload.audience).toBe('ai-agents');
    expect(payload.capabilities).toContain('app-manifest-name-slug-negotiation-v1');
    expect(payload.firstCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'eai --describe',
          mutates: false,
        }),
      ]),
    );
    expect(payload.stopConditions.length).toBeGreaterThan(0);
    expect(payload.recoveryLoop).toContainEqual(expect.objectContaining({
      title: 'Prepare support when the person asks',
      commands: expect.arrayContaining([expect.objectContaining({
        command: 'eai support --source harness --tool <current-tool> --context-file - --format json', mutates: false,
      })]),
    }));
  });
});
