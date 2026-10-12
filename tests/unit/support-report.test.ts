import { afterEach, describe, expect, test, vi } from 'vitest';
import { access, mkdir, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as auth from '../../src/lib/auth.js';
import { runSupport } from '../../src/commands/support.js';
import { createSupportDraft, type SupportBundle } from '../../src/lib/support-report.js';
import {
  bundleDigest,
  canonicalJson,
  createHarnessContextFile,
  discardOwnedHarnessContext,
  purgeStaleHarnessContexts,
  fitHarnessContext,
  HARNESS_BLOCK_MAX_BYTES,
  harnessBlockBytes,
  pathAliases,
  redactHarnessContext,
  renderSupportPreview,
  SupportContextError,
  validateHarnessContext,
  type HarnessContext,
} from '../../src/lib/support-harness.js';
import { setActiveProfile } from '../../src/lib/profile.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import {
  harnessContextFixture,
  startDraftServer,
  SUPPORT_SESSION_TOKEN,
  type DraftServer,
} from '../helpers/support-fixture.js';
import {
  redactSupportBundle,
  redactSupportText,
} from '../../src/lib/support-redaction.js';

const contexts: TestEnvironment[] = [];
const servers: DraftServer[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = 0;
  setActiveProfile('default');
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(contexts.splice(0).map(context => context.cleanup()));
});

describe('local support report redaction', () => {
  test.each([
    ['Bearer bearer-fixture-secret', 'bearer-fixture-secret'],
    ['Basic basic-fixture-secret', 'basic-fixture-secret'],
    ['access_token=access-fixture-secret', 'access-fixture-secret'],
    ['refreshToken: refresh-fixture-secret', 'refresh-fixture-secret'],
    ['password="password fixture secret"', 'password fixture secret'],
    ['api_key=api-fixture-secret', 'api-fixture-secret'],
    ['AccountKey=storage-fixture-secret;', 'storage-fixture-secret'],
    ['--token command-fixture-secret', 'command-fixture-secret'],
    ['https://account:credential-fixture-secret@example.invalid', 'credential-fixture-secret'],
    ['https://example.invalid?sig=sas-fixture-secret&x=1', 'sas-fixture-secret'],
    ['https://example.invalid/support#draft=id.fragment-fixture-secret', 'fragment-fixture-secret'],
    ['ghp_' + 'githubFixtureSecret123', 'githubFixtureSecret123'],
    ['github' + '_pat_' + 'githubFineGrainedFixtureSecret123', 'githubFineGrainedFixtureSecret123'],
    ['sk-' + 'openaiFixtureSecret123', 'openaiFixtureSecret123'],
    ['eyJfixture.fixturePayload.fixtureSignature', 'fixturePayload'],
    [['-----BEGIN RSA ', 'PRIVATE KEY-----\nprivate-fixture-secret\n-----END RSA ', 'PRIVATE KEY-----'].join(''), 'private-fixture-secret'],
  ])('removes credential pattern %s', (input, secret) => {
    const redacted = redactSupportText(`Before ${input} after`);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain('Before');
    expect(redacted).toContain('after');
  });

  test('redacts the exact saved session values even without a recognizable token pattern', () => {
    const report = redactSupportText('Error includes opaque-session-fixture and opaque-refresh-fixture', [
      'opaque-session-fixture', 'opaque-refresh-fixture', '',
    ]);
    expect(report).not.toContain('opaque-session-fixture');
    expect(report).not.toContain('opaque-refresh-fixture');
    expect(report).toContain('Error includes');
  });

  test.each([
    '--api_key', '--connection-string', '--account-key', '--authorization', '--cookie',
  ])('removes whitespace-separated credential flag %s', (flag) => {
    const report = redactSupportText(`eai command ${flag} "flag-private-fixture" --format json`);
    expect(report).not.toContain('flag-private-fixture');
    expect(report).toContain('--format json');
  });

  test.each(['api_key', 'accessToken', 'password'])('redacts escaped quoted JSON value for %s', (key) => {
    const diagnostic = JSON.stringify({ [key]: 'prefix"json-private-fixture', status: 'failed' });
    const report = redactSupportText(diagnostic);
    expect(report).not.toContain('json-private-fixture');
    expect(report).toContain('failed');
  });

  test('redacts nested secrets without losing report metadata or changing the input', () => {
    const input = {
      cli: { command: 'eai types push', exitCode: 1, errorCode: 'E001' },
      details: [
        { accessToken: 'opaque-session-fixture', description: 'API_KEY=nested-fixture-secret' },
        null,
        0,
      ],
      flags: { consent: false },
    };
    const report = redactSupportBundle(input);
    expect(JSON.stringify(report)).not.toContain('opaque-session-fixture');
    expect(JSON.stringify(report)).not.toContain('nested-fixture-secret');
    expect(report.cli).toEqual(input.cli);
    expect(report.details.slice(1)).toEqual([null, 0]);
    expect(report.flags).toEqual({ consent: false });
    expect(input.details[0]).toEqual({
      accessToken: 'opaque-session-fixture', description: 'API_KEY=nested-fixture-secret',
    });
  });

  test('keeps catalog identity and normal diagnostic text intact', () => {
    const diagnostic = 'E101 not_logged_in: eai login then eai whoami. Linux 6.1, exit 1.';
    expect(redactSupportText(diagnostic)).toBe(diagnostic);
  });

  test('removes terminal escape sequences and control characters before preview', () => {
    const redacted = redactSupportText('\u001b[31mE101\u001b[0m\u0000\u0007\nnext diagnostic');
    expect(redacted).toBe('E101\nnext diagnostic');
  });
});

describe('harness session summary schema', () => {
  test('accepts the contract shape and normalizes timestamps', () => {
    const context = validateHarnessContext(harnessContextFixture({
      commands: [{ command: 'eai types seed', exitCode: 1, at: 'Mon, 12 Oct 2026 01:02:03 GMT' }],
      errors: [{ message: 'Not in an EAI project directory' }],
    }));
    expect(context).toMatchObject({ requestedByPerson: true, request: 'get help', truncated: false });
    expect(context.commands).toEqual([{ command: 'eai types seed', exitCode: 1, at: '2026-10-12T01:02:03.000Z' }]);
    expect(context.errors).toEqual([{ message: 'Not in an EAI project directory' }]);
  });

  test('defaults missing lists to empty and a missing truncated flag to false', () => {
    const context = validateHarnessContext({ requestedByPerson: true, request: 'get help', goal: 'Seed types', summary: 'Seeding fails with E001.' });
    expect(context).toEqual({
      requestedByPerson: true, request: 'get help', goal: 'Seed types', summary: 'Seeding fails with E001.',
      steps: [], commands: [], errors: [], attemptedFixes: [], filesTouched: [], truncated: false,
    });
  });

  test.each<[string, Record<string, unknown>, string]>([
    ['requestedByPerson false', { requestedByPerson: false }, 'requestedByPerson'],
    ['requestedByPerson missing', { requestedByPerson: undefined }, 'requestedByPerson'],
    ['request empty', { request: '   ' }, 'request'],
    ['request missing', { request: undefined }, 'request'],
    ['request too long', { request: 'x'.repeat(501) }, 'request'],
    ['request wrong type', { request: 42 }, 'request'],
    ['goal too long', { goal: 'x'.repeat(1001) }, 'goal'],
    ['summary too long', { summary: 'x'.repeat(4001) }, 'summary'],
    ['steps not a list', { steps: 'step' }, 'steps'],
    ['steps too many', { steps: Array.from({ length: 51 }, () => 'step') }, 'steps'],
    ['step too long', { steps: ['ok', 'x'.repeat(501)] }, 'steps[1]'],
    ['commands too many', { commands: Array.from({ length: 51 }, () => ({ command: 'eai verify', exitCode: 1 })) }, 'commands'],
    ['command not an object', { commands: ['eai verify'] }, 'commands[0]'],
    ['command text missing', { commands: [{ exitCode: 1 }] }, 'commands[0].command'],
    ['command exit code not an integer', { commands: [{ command: 'eai verify', exitCode: 1.5 }] }, 'commands[0].exitCode'],
    ['command exit code out of range', { commands: [{ command: 'eai verify', exitCode: 2147483648 }] }, 'commands[0].exitCode'],
    ['command error code too long', { commands: [{ command: 'eai verify', exitCode: 1, errorCode: 'x'.repeat(41) }] }, 'commands[0].errorCode'],
    ['command reason code too long', { commands: [{ command: 'eai verify', exitCode: 1, reasonCode: 'x'.repeat(81) }] }, 'commands[0].reasonCode'],
    ['command time invalid', { commands: [{ command: 'eai verify', exitCode: 1, at: 'yesterday' }] }, 'commands[0].at'],
    ['command unknown key', { commands: [{ command: 'eai verify', exitCode: 1, stdout: 'raw output' }] }, 'commands[0].stdout (unexpected)'],
    ['errors too many', { errors: Array.from({ length: 51 }, () => ({ message: 'failed' })) }, 'errors'],
    ['error message missing', { errors: [{ code: 'E001' }] }, 'errors[0].message'],
    ['error message too long', { errors: [{ message: 'x'.repeat(1001) }] }, 'errors[0].message'],
    ['error code too long', { errors: [{ code: 'x'.repeat(81), message: 'failed' }] }, 'errors[0].code'],
    ['error time too long', { errors: [{ message: 'failed', at: `2026-10-12T01:02:03.000Z${' '.repeat(20)}` }] }, 'errors[0].at'],
    ['attempted fixes too many', { attemptedFixes: Array.from({ length: 21 }, () => 'fix') }, 'attemptedFixes'],
    ['attempted fix too long', { attemptedFixes: ['x'.repeat(501)] }, 'attemptedFixes[0]'],
    ['files too many', { filesTouched: Array.from({ length: 101 }, (_, index) => `src/file-${index}.ts`) }, 'filesTouched'],
    ['file too long', { filesTouched: [`src/${'x'.repeat(260)}.ts`] }, 'filesTouched[0]'],
    ['file absolute posix', { filesTouched: ['/Users/person/app/src/index.ts'] }, 'filesTouched[0] (absolute path)'],
    ['file absolute windows', { filesTouched: ['C:\\Users\\person\\app\\src\\index.ts'] }, 'filesTouched[0] (absolute path)'],
    ['file unc path', { filesTouched: ['\\\\server\\share\\index.ts'] }, 'filesTouched[0] (absolute path)'],
    ['file home relative', { filesTouched: ['~/app/src/index.ts'] }, 'filesTouched[0] (absolute path)'],
    ['truncated wrong type', { truncated: 'yes' }, 'truncated'],
    ['unknown top-level key', { transcript: 'raw transcript text' }, 'transcript (unexpected)'],
  ])('rejects %s and names only the field', (_name, overrides, field) => {
    let caught: unknown;
    try {
      validateHarnessContext(harnessContextFixture(overrides));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SupportContextError);
    const error = caught as SupportContextError;
    expect(error.code).toBe('context_invalid');
    expect(error.message).toContain(field);
    expect(error.message).not.toContain('raw transcript text');
    expect(error.message).not.toContain('raw output');
    expect(error.message).not.toContain('/Users/person');
  });

  test.each([null, [], 'summary', 42])('rejects a non-object context %j', (value) => {
    expect(() => validateHarnessContext(value)).toThrow(SupportContextError);
  });

  test('redacts credentials and hides the home directory and project root in every text field', () => {
    const home = '/Users/person';
    const projectRoot = '/Users/person/apps/demo';
    const secret = 'opaque-session-credential-fixture';
    const text = (label: string): string => `${label} ${secret} Bearer bearer-fixture-secret ${projectRoot}/src/index.ts and ${home}/.eai/config.json`;
    const context = validateHarnessContext(harnessContextFixture({
      request: text('request'), goal: text('goal'), summary: text('summary'), steps: [text('step')],
      commands: [{ command: text('command'), exitCode: 1, errorCode: `E001 ${secret}`, reasonCode: `reason ${secret}` }],
      errors: [{ code: `code ${secret}`, message: text('message') }],
      attemptedFixes: [text('fix')], filesTouched: [`src/${secret}.ts`],
    }));
    const redacted = redactHarnessContext(context, { sensitiveValues: [secret], homes: [home], projectRoots: [projectRoot] });
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('bearer-fixture-secret');
    expect(serialized).not.toContain(home);
    expect(redacted.request).toContain('./src/index.ts');
    expect(redacted.request).toContain('~/.eai/config.json');
    for (const value of [redacted.goal, redacted.summary, redacted.steps[0], redacted.commands[0].command, redacted.errors[0].message, redacted.attemptedFixes[0]]) {
      expect(value).toContain('[redacted]');
      expect(value).toContain('./src/index.ts');
      expect(value).toContain('~/.eai/config.json');
    }
    expect(redacted.commands[0].errorCode).toBe('E001 [redacted]');
    expect(redacted.commands[0].reasonCode).toBe('reason [redacted]');
    expect(redacted.errors[0].code).toBe('code [redacted]');
    expect(redacted.filesTouched[0]).toBe('src/[redacted].ts');
    expect(redacted.requestedByPerson).toBe(true);
  });

  test('keeps every field within its limit after redaction lengthens a value', () => {
    const context = validateHarnessContext(harnessContextFixture({ request: `${'r'.repeat(495)} ab` }));
    const redacted = redactHarnessContext(context, { sensitiveValues: ['ab'], homes: ['/Users/person'], projectRoots: [] });
    expect(redacted.request.length).toBeLessThanOrEqual(500);
    expect(redacted.request).toContain('[redacted]'.slice(0, 500 - 496));
  });

  test('drops the oldest steps, then commands, then errors until the block fits, and marks it truncated', () => {
    const base: HarnessContext = {
      requestedByPerson: true, request: 'get help', goal: 'goal', summary: 's'.repeat(4000),
      steps: [], commands: [], errors: [], attemptedFixes: Array.from({ length: 20 }, () => 'f'.repeat(500)), filesTouched: [], truncated: false,
    };
    const steps = Array.from({ length: 50 }, (_, index) => `step ${index} ${'y'.repeat(480)}`);
    const commands = Array.from({ length: 50 }, (_, index) => ({ command: `command ${index} ${'y'.repeat(480)}`, exitCode: index }));
    const errors = Array.from({ length: 50 }, (_, index) => ({ code: `E${index}`, message: `error ${index} ${'z'.repeat(980)}` }));
    const oldestKept = (values: ReadonlyArray<{ readonly text: string }>, label: string, total: number): void => {
      expect(values.length).toBeGreaterThan(0);
      expect(values.length).toBeLessThan(total);
      expect(values[0].text.startsWith(`${label} ${total - values.length} `)).toBe(true);
      expect(values.at(-1)?.text.startsWith(`${label} ${total - 1} `)).toBe(true);
    };

    const stepsOnly = fitHarnessContext({ ...base, steps, commands: commands.slice(0, 1), errors: errors.slice(0, 1) });
    expect(harnessBlockBytes({ ...base, steps, commands: commands.slice(0, 1), errors: errors.slice(0, 1) })).toBeGreaterThan(HARNESS_BLOCK_MAX_BYTES);
    expect(harnessBlockBytes(stepsOnly)).toBeLessThanOrEqual(HARNESS_BLOCK_MAX_BYTES);
    expect(stepsOnly.truncated).toBe(true);
    oldestKept(stepsOnly.steps.map(text => ({ text })), 'step', 50);
    expect(stepsOnly.commands).toEqual(commands.slice(0, 1));
    expect(stepsOnly.errors).toEqual(errors.slice(0, 1));

    const thenCommands = fitHarnessContext({ ...base, steps, commands, errors: errors.slice(0, 1) });
    expect(harnessBlockBytes(thenCommands)).toBeLessThanOrEqual(HARNESS_BLOCK_MAX_BYTES);
    expect(thenCommands.steps).toEqual([]);
    oldestKept(thenCommands.commands.map(({ command }) => ({ text: command })), 'command', 50);
    expect(thenCommands.errors).toEqual(errors.slice(0, 1));
    expect(thenCommands.truncated).toBe(true);

    const thenErrors = fitHarnessContext({ ...base, steps: steps.slice(0, 1), commands, errors });
    expect(harnessBlockBytes(thenErrors)).toBeLessThanOrEqual(HARNESS_BLOCK_MAX_BYTES);
    expect(thenErrors.steps).toEqual([]);
    expect(thenErrors.commands).toEqual([]);
    oldestKept(thenErrors.errors.map(({ message }) => ({ text: message })), 'error', 50);
    expect(thenErrors.truncated).toBe(true);
    expect(thenErrors.attemptedFixes).toEqual(base.attemptedFixes);
    expect(thenErrors.summary).toBe(base.summary);
  });

  test('leaves a fitting block untouched and fails closed when nothing droppable remains', () => {
    const small = validateHarnessContext(harnessContextFixture());
    expect(fitHarnessContext(small)).toEqual(small);
    const immovable: HarnessContext = {
      ...small, steps: [], commands: [], errors: [], summary: 's'.repeat(4000),
      attemptedFixes: Array.from({ length: 20 }, () => 'f'.repeat(500)),
      filesTouched: Array.from({ length: 100 }, (_, index) => `src/${String(index).padStart(3, '0')}/${'p'.repeat(250)}`),
    };
    expect(() => fitHarnessContext(immovable)).toThrow(expect.objectContaining({ code: 'context_too_large' }));
  });

  test('digests are stable across key order and ignore undefined values', () => {
    const left = { source: 'harness', cli: { exitCode: 1, command: 'eai verify' }, steps: ['a', 'b'], missing: undefined };
    const right = { steps: ['a', 'b'], cli: { command: 'eai verify', exitCode: 1 }, source: 'harness' };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(bundleDigest(left)).toBe(bundleDigest(right));
    expect(bundleDigest(left)).toMatch(/^[0-9a-f]{64}$/);
    expect(bundleDigest({ ...right, steps: ['b', 'a'] })).not.toBe(bundleDigest(right));
    expect(bundleDigest({ ...right, source: 'eai-cli' })).not.toBe(bundleDigest(right));
  });

  test('renders every bundle field as plain text and ends with the digest', () => {
    const bundle = {
      source: 'harness', tool: { name: 'codex', version: '' }, cli: { command: 'eai verify', exitCode: 2 },
      description: 'line one\nline two', organisationLocation: 'apac',
      harness: { requestedByPerson: true, steps: ['first', 'second'], commands: [{ command: 'eai verify', exitCode: 2 }], errors: [], truncated: false },
    };
    const digest = bundleDigest(bundle);
    const preview = renderSupportPreview(bundle, digest);
    const lines = preview.split('\n');
    expect(lines[0]).toContain('EAI support report (redacted)');
    expect(lines.at(-1)).toBe(`Report digest: ${digest}`);
    expect(preview).toContain('Source: harness');
    expect(preview).toContain('Reporting tool:\n  Name: codex\n  Version: ');
    expect(preview).toContain('Description:\n  line one\n  line two');
    expect(preview).toContain('Organisation location: apac');
    expect(preview).toContain('Requested by the person: yes');
    expect(preview).toContain('Steps:\n    1. first\n    2. second');
    expect(preview).toContain('Commands run:\n    1.\n      Command: eai verify\n      Exit code: 2');
    expect(preview).toContain('Errors seen: none');
    expect(preview).toContain('Truncated to fit: no');
  });
});

describe('support consent and request limits', () => {
  test.each(['opaque-process-credential-fixture', ''])('redacts shadowed project credentials before interactive consent with process value %j', async (processValue) => {
    const home = await createTestEnvironment();
    contexts.push(home);
    const server = await startDraftServer();
    servers.push(server);
    const projectValue = 'opaque-project-credential-fixture';
    await writeFile(join(home.dir, 'eai.config.ts'), 'export default {};\n');
    await writeFile(join(home.dir, '.env.local'), `DATABASE_PASSWORD=${projectValue}\n`);
    vi.stubEnv('HOME', home.dir);
    vi.stubEnv('EAI_WEBSITE_URL', server.origin);
    vi.stubEnv('DATABASE_PASSWORD', processValue);
    vi.spyOn(process, 'cwd').mockReturnValue(home.dir);
    vi.spyOn(auth, 'loadTokens').mockResolvedValue({
      accessToken: SUPPORT_SESSION_TOKEN, expiresAt: Date.now() + 60_000,
      tenantId: 'fixture', tenantName: 'fixture', clientId: 'fixture', activeTenantId: 'workspace-fixture',
    });
    const shown: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value: unknown) => { shown.push(String(value)); });
    let previewAtConsent = '';
    const confirm = vi.fn(async () => {
      previewAtConsent = shown.join('\n');
      return false;
    });

    await runSupport({ format: 'text', open: false, description: `The provider rejected ${projectValue} during setup.` }, {
      confirm, isInteractive: true,
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(previewAtConsent).toContain('[redacted]');
    expect(previewAtConsent).toMatch(/Report digest: [0-9a-f]{64}/);
    expect(previewAtConsent).not.toContain(projectValue);
    expect(shown.join('\n')).not.toContain(projectValue);
    expect(server.requests).toHaveLength(0);
  });

  test('shows the report before asking for consent and sends nothing after the person refuses', async () => {
    const home = await createTestEnvironment();
    contexts.push(home);
    const server = await startDraftServer();
    servers.push(server);
    vi.stubEnv('HOME', home.dir);
    vi.stubEnv('EAI_WEBSITE_URL', server.origin);
    vi.spyOn(process, 'cwd').mockReturnValue(home.dir);
    vi.spyOn(auth, 'loadTokens').mockResolvedValue({
      accessToken: SUPPORT_SESSION_TOKEN, expiresAt: Date.now() + 60_000,
      tenantId: 'fixture', tenantName: 'fixture', clientId: 'fixture', activeTenantId: 'workspace-fixture',
    });
    const shown: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value: unknown) => { shown.push(String(value)); });
    const confirm = vi.fn(async () => {
      expect(shown.join('\n')).toContain('Redacted support report');
      expect(shown.join('\n')).toContain('harness');
      expect(shown.join('\n')).not.toContain(SUPPORT_SESSION_TOKEN);
      return false;
    });
    const directory = join(home.dir, '.eai', 'support', 'context');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const contextFile = createHarnessContextFile();
    await writeFile(contextFile, JSON.stringify(harnessContextFixture()), { mode: 0o600 });
    await runSupport({ format: 'text', open: false, source: 'harness', contextFile }, { confirm, isInteractive: true });
    await expect(access(contextFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(confirm).toHaveBeenCalledOnce();
    expect(shown.join('\n')).toContain('No report was sent and no draft was created.');
    expect(server.requests).toHaveLength(0);
  });

  test('asks where the organisation is based before showing the report and asking for consent when the session has no active workspace', async () => {
    const home = await createTestEnvironment();
    contexts.push(home);
    const server = await startDraftServer();
    servers.push(server);
    vi.stubEnv('HOME', home.dir);
    vi.stubEnv('EAI_WEBSITE_URL', server.origin);
    vi.spyOn(process, 'cwd').mockReturnValue(home.dir);
    vi.spyOn(auth, 'loadTokens').mockResolvedValue({
      accessToken: SUPPORT_SESSION_TOKEN, expiresAt: Date.now() + 60_000,
      tenantId: 'fixture', tenantName: 'fixture', clientId: 'fixture',
    });
    const shown: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value: unknown) => { shown.push(String(value)); });
    const order: string[] = [];
    const chooseOrganisationLocation = vi.fn(async () => {
      order.push('location');
      expect(shown.join('\n')).not.toContain('Redacted support report');
      return 'americas' as const;
    });
    const confirm = vi.fn(async () => {
      order.push('consent');
      expect(shown.join('\n')).toContain('"organisationLocation": "americas"');
      return true;
    });
    await runSupport({ format: 'text', open: false }, { confirm, chooseOrganisationLocation, isInteractive: true });
    expect(order).toEqual(['location', 'consent']);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].body.organisationLocation).toBe('americas');
    expect(shown.join('\n')).toContain('#draft=');
  });

  test('interactive --yes with a mismatched digest sends nothing', async () => {
    const home = await createTestEnvironment();
    contexts.push(home);
    const server = await startDraftServer();
    servers.push(server);
    vi.stubEnv('HOME', home.dir);
    vi.stubEnv('EAI_WEBSITE_URL', server.origin);
    vi.spyOn(process, 'cwd').mockReturnValue(home.dir);
    vi.spyOn(auth, 'loadTokens').mockResolvedValue({
      accessToken: SUPPORT_SESSION_TOKEN, expiresAt: Date.now() + 60_000,
      tenantId: 'fixture', tenantName: 'fixture', clientId: 'fixture', activeTenantId: 'workspace-fixture',
    });
    const shown: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value: unknown) => { shown.push(String(value)); });
    const confirm = vi.fn(async () => true);
    await runSupport({ format: 'text', open: false, yes: true, approvedDigest: 'f'.repeat(64) }, { confirm, isInteractive: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(server.requests).toHaveLength(0);
    expect(shown.join('\n')).toContain('The report changed since it was approved.');
    expect(process.exitCode).toBe(1);
  });

  test('cancels a stalled draft create at the deadline without an automatic retry', async () => {
    const server = await startDraftServer(response => {
      response.writeHead(201, { 'content-type': 'application/json' });
      response.flushHeaders();
      response.write('{"id":');
    });
    servers.push(server);
    const bundle: SupportBundle = {
      source: 'eai-cli', tool: { name: 'eai-cli', version: 'fixture' }, cli: {},
      cliVersion: 'fixture', service: 'eai-cli', category: 'technical',
      summary: 'Help with EAI CLI', description: 'The command failed after setup.', os: 'unknown', environment: 'local',
    };
    await expect(createSupportDraft(server.origin, bundle, SUPPORT_SESSION_TOKEN, 100)).rejects.toMatchObject({
      code: 'request_failed',
      message: expect.stringContaining('No retry was sent'),
    });
    expect(server.requests).toHaveLength(1);
  });

  test('maps the website region_required rejection to a safe error without reading other 400 bodies as codes', async () => {
    const regionServer = await startDraftServer(response => {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'region_required' }));
    });
    servers.push(regionServer);
    const otherServer = await startDraftServer(response => {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid_draft', detail: 'server-private-fixture' }));
    });
    servers.push(otherServer);
    const bundle: SupportBundle = {
      source: 'eai-cli', tool: { name: 'eai-cli', version: 'fixture' }, cli: {},
      cliVersion: 'fixture', service: 'eai-cli', category: 'technical',
      summary: 'Help with EAI CLI', description: 'The command failed after setup.', os: 'unknown', environment: 'local',
    };
    await expect(createSupportDraft(regionServer.origin, bundle, SUPPORT_SESSION_TOKEN)).rejects.toMatchObject({ code: 'region_required' });
    const other = await createSupportDraft(otherServer.origin, bundle, SUPPORT_SESSION_TOKEN).catch((error: unknown) => error);
    expect(other).toMatchObject({ code: 'http_400' });
    expect(String((other as Error).message)).not.toContain('server-private-fixture');
  });
});


describe('support path safety', () => {
  test.each(['../.env', 'src/../.env', 'src\\..\\.env', 'file://local/path', 'https://example.test/path', 'C:relative'])('rejects escaping or URL filesTouched: %s', file => {
    expect(() => validateHarnessContext({ ...harnessContextFixture(), filesTouched: [file] })).toThrow(SupportContextError);
  });

  test('redacts both Windows separators while preserving sibling path prefixes', () => {
    const input = validateHarnessContext({ ...harnessContextFixture(), summary: 'C:/Users/alex/project/src C:\\Users\\alex\\project\\src C:/Users/alexander/src' });
    const safe = redactHarnessContext(input, { sensitiveValues: [], homes: ['C:\\Users\\alex'], projectRoots: ['C:\\Users\\alex\\project'] });
    expect(safe.summary).toContain('./src');
    expect(safe.summary).toContain('.\\src');
    expect(safe.summary).toContain('C:/Users/alexander/src');
    expect(safe.summary).not.toContain('C:/Users/alex/project');
    expect(safe.summary).not.toContain('C:\\Users\\alex\\project');
  });
});


test('hides the shell PWD alias of a project reached through a symlink', async () => {
  const environment = await createTestEnvironment();
  contexts.push(environment);
  const project = join(environment.dir, 'project');
  const alias = join(environment.dir, 'shell-alias');
  await mkdir(project);
  await symlink(project, alias);
  vi.stubEnv('PWD', alias);
  const roots = pathAliases(project);
  expect(roots).toContain(alias);
  const context = validateHarnessContext({ ...harnessContextFixture(), summary: `${alias}/src/index.ts` });
  expect(redactHarnessContext(context, { sensitiveValues: [], homes: [], projectRoots: roots }).summary).toBe('./src/index.ts');
});


describe('support context ownership and closing path delimiters', () => {
  test('preserves unrelated regular files inside the private directory during cleanup and stale purge', async () => {
    const home = await createTestEnvironment();
    contexts.push(home);
    vi.stubEnv('HOME', home.dir);
    const directory = join(home.dir, '.eai', 'support', 'context');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const unrelated = join(directory, 'unrelated.json');
    await writeFile(unrelated, JSON.stringify(harnessContextFixture()));
    await utimes(unrelated, new Date(0), new Date(0));
    discardOwnedHarnessContext(unrelated);
    purgeStaleHarnessContexts();
    await expect(access(unrelated)).resolves.toBeUndefined();
  });

  test.each([']', '}', '>', '?'])('hides closed home/project prefixes in every text field for %s without hiding sibling paths', delimiter => {
    const text = `/h${delimiter} /p${delimiter} /home /project`;
    const context: HarnessContext = {
      requestedByPerson: true, request: text, goal: text, summary: text, steps: [text],
      commands: [{ command: text, exitCode: 1, errorCode: text, reasonCode: text }],
      errors: [{ code: text, message: text }], attemptedFixes: [text], filesTouched: [text], truncated: false,
    };
    const safe = redactHarnessContext(context, { sensitiveValues: [], homes: ['/h'], projectRoots: ['/p'] });
    const fields = [safe.request, safe.goal, safe.summary, ...safe.steps, safe.commands[0].command,
      safe.commands[0].errorCode, safe.commands[0].reasonCode, safe.errors[0].code, safe.errors[0].message,
      ...safe.attemptedFixes, ...safe.filesTouched];
    for (const field of fields) expect(field).toBe(`~${delimiter} .${delimiter} /home /project`);
  });
});


test('ownership markers do not authorize replacement files or symlinks', async () => {
  const home = await createTestEnvironment();
  contexts.push(home);
  vi.stubEnv('HOME', home.dir);
  const file = createHarnessContextFile();
  const { rename, stat } = await import('node:fs/promises');
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  await rename(file, `${file}.original`);
  await writeFile(file, 'unrelated');
  discardOwnedHarnessContext(file);
  await expect(access(file)).resolves.toBeUndefined();
  const link = createHarnessContextFile();
  const { unlink } = await import('node:fs/promises');
  await unlink(link);
  await symlink(file, link);
  discardOwnedHarnessContext(link);
  await expect(access(link)).resolves.toBeUndefined();
});


test.each([false, true])('preserves an untracked private-directory file after an interactive send decision %s', async consent => {
  const home = await createTestEnvironment();
  contexts.push(home);
  const server = await startDraftServer();
  servers.push(server);
  vi.stubEnv('HOME', home.dir);
  vi.stubEnv('EAI_WEBSITE_URL', server.origin);
  vi.spyOn(process, 'cwd').mockReturnValue(home.dir);
  vi.spyOn(auth, 'loadTokens').mockResolvedValue({ accessToken: SUPPORT_SESSION_TOKEN,
    expiresAt: Date.now() + 60_000, tenantId: 'fixture', tenantName: 'fixture', clientId: 'fixture', activeTenantId: 'workspace-fixture' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const directory = join(home.dir, '.eai', 'support', 'context');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const contextFile = join(directory, 'user-notes.json');
  await writeFile(contextFile, JSON.stringify(harnessContextFixture()));
  await runSupport({ format: 'text', open: false, source: 'harness', contextFile }, { confirm: async () => consent, isInteractive: true });
  expect(server.requests).toHaveLength(consent ? 1 : 0);
  await expect(access(contextFile)).resolves.toBeUndefined();
});

test('allocates context without loading authentication or posting a report', async () => {
  const home = await createTestEnvironment();
  contexts.push(home);
  vi.stubEnv('HOME', home.dir);
  const loadTokens = vi.spyOn(auth, 'loadTokens').mockRejectedValue(new Error('auth must not run'));
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSupport({ createContextFile: true, format: 'json' });
  expect(loadTokens).not.toHaveBeenCalled();
  const output = JSON.parse(String(write.mock.calls[0][0])) as { contextFile: string; status: string; url: string };
  expect(output.status).toBe('context_created');
  expect(output.url).toBe('https://www.enterpriseaigroup.com/support?chat=open');
  await expect(access(output.contextFile)).resolves.toBeUndefined();
  await expect(access(`${output.contextFile}.owner`)).resolves.toBeUndefined();
  discardOwnedHarnessContext(output.contextFile);
  await expect(access(output.contextFile)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(`${output.contextFile}.owner`)).rejects.toMatchObject({ code: 'ENOENT' });
});


test('explicit decline cleans an allocated context without loading authentication', async () => {
  const home = await createTestEnvironment();
  contexts.push(home);
  vi.stubEnv('HOME', home.dir);
  const loadTokens = vi.spyOn(auth, 'loadTokens').mockRejectedValue(new Error('auth must not run'));
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const contextFile = createHarnessContextFile();
  await runSupport({ decline: true, contextFile, format: 'json' });
  expect(loadTokens).not.toHaveBeenCalled();
  expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({ status: 'declined', url: 'https://www.enterpriseaigroup.com/support?chat=open' });
  await expect(access(contextFile)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(`${contextFile}.owner`)).rejects.toMatchObject({ code: 'ENOENT' });
});


describe('local support actions use the trusted configured website', () => {
  test.each(['default', 'environment', 'named-profile'] as const)('%s origin applies without authentication or network', async setting => {
    const home = await createTestEnvironment();
    contexts.push(home);
    vi.stubEnv('HOME', home.dir);
    vi.stubEnv('EAI_WEBSITE_URL', setting === 'environment' ? 'https://support-env.fixture.invalid' : '');
    if (setting === 'named-profile') {
      setActiveProfile('fixture');
      await mkdir(join(home.dir, '.eai'), { recursive: true });
      await writeFile(join(home.dir, '.eai', 'config.json'), JSON.stringify({ profiles: { fixture: {
        publicApiUrl: 'https://api.fixture.invalid', authTenantName: 'fixture', authTenantId: 'fixture',
        authClientId: 'fixture', websiteUrl: 'https://support-profile.fixture.invalid',
      } } }));
    }
    const expected = setting === 'default' ? 'https://www.enterpriseaigroup.com'
      : setting === 'environment' ? 'https://support-env.fixture.invalid' : 'https://support-profile.fixture.invalid';
    const loadTokens = vi.spyOn(auth, 'loadTokens').mockRejectedValue(new Error('auth must not run'));
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not run'));
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runSupport({ createContextFile: true, format: 'json' });
    const allocated = JSON.parse(String(write.mock.calls[0][0])) as { contextFile: string; url: string; status: string };
    expect(allocated).toMatchObject({ status: 'context_created', url: `${expected}/support?chat=open` });
    await expect(access(allocated.contextFile)).resolves.toBeUndefined();
    write.mockClear();
    await runSupport({ decline: true, contextFile: allocated.contextFile, format: 'json' });
    expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({ status: 'declined', url: `${expected}/support?chat=open` });
    await expect(access(allocated.contextFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(`${allocated.contextFile}.owner`)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(loadTokens).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});


test.each(['environment', 'named-profile'] as const)('explicit decline resolves %s origin and cleans locally', async setting => {
  const home = await createTestEnvironment();
  contexts.push(home);
  vi.stubEnv('HOME', home.dir);
  vi.stubEnv('EAI_WEBSITE_URL', setting === 'environment' ? 'https://decline-env.fixture.invalid' : '');
  if (setting === 'named-profile') {
    setActiveProfile('fixture');
    await mkdir(join(home.dir, '.eai'), { recursive: true });
    await writeFile(join(home.dir, '.eai', 'config.json'), JSON.stringify({ profiles: { fixture: {
      publicApiUrl: 'https://api.fixture.invalid', authTenantName: 'fixture', authTenantId: 'fixture',
      authClientId: 'fixture', websiteUrl: 'https://decline-profile.fixture.invalid',
    } } }));
  }
  const file = createHarnessContextFile();
  const loadTokens = vi.spyOn(auth, 'loadTokens').mockRejectedValue(new Error('auth must not run'));
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not run'));
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSupport({ decline: true, contextFile: file, format: 'json' });
  expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({ status: 'declined',
    url: `https://decline-${setting === 'environment' ? 'env' : 'profile'}.fixture.invalid/support?chat=open` });
  await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(`${file}.owner`)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(loadTokens).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
