import { symlink, utimes, stat } from 'node:fs/promises';
import { afterEach, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findGuidanceByCodeOrReason } from '../../src/lib/error-guidance/catalog.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import {
  harnessContextFixture,
  regionRequiredResponder,
  runSupportCli,
  startDraftServer,
  SUPPORT_DRAFT_ID,
  SUPPORT_DRAFT_TOKEN,
  SUPPORT_SESSION_TOKEN,
  validDraftResponse,
  writeSupportSession,
  type DraftServer,
  type SupportCliInput,
} from '../helpers/support-fixture.js';

interface SupportOutput {
  readonly ok: boolean;
  readonly status: string;
  readonly bundle?: Record<string, unknown>;
  readonly previewText?: string;
  readonly bundleDigest?: string;
  readonly questions?: string[];
  readonly ignoredLastError?: { readonly recordedAt: string; readonly reason: string };
  readonly url?: string;
  readonly expiresAt?: string;
  readonly message?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

const contexts: TestEnvironment[] = [];
const servers: DraftServer[] = [];
const supportContextModule = new URL('../../dist/lib/support-context.js', import.meta.url).href;
const DIGEST = /^[0-9a-f]{64}$/;

async function environment(): Promise<TestEnvironment> {
  const context = await createTestEnvironment();
  contexts.push(context);
  return context;
}

async function fixture(...args: Parameters<typeof startDraftServer>): Promise<DraftServer> {
  const server = await startDraftServer(...args);
  servers.push(server);
  return server;
}

function parse(result: { stdout: string }): SupportOutput {
  return JSON.parse(result.stdout) as SupportOutput;
}

/** Runs the JSON preview, then the approval step bound to the previewed digest, as a harness would. */
async function previewThenApprove(home: string, args: readonly string[], env: Record<string, string>, input?: SupportCliInput): Promise<{ preview: SupportOutput; sent: Awaited<ReturnType<typeof runSupportCli>> }> {
  const previewRun = await runSupportCli(home, ['support', '--format', 'json', '--no-open', ...args], env, input);
  expect(previewRun.code, previewRun.stdout + previewRun.stderr).toBe(0);
  const preview = parse(previewRun);
  expect(preview).toMatchObject({ ok: true, status: 'consent_required' });
  expect(preview.bundleDigest).toMatch(DIGEST);
  const sent = await runSupportCli(home, ['support', '--format', 'json', '--no-open', '--yes', '--approved-digest', preview.bundleDigest!, ...args], env, input);
  return { preview, sent };
}

/** Text mode prints the digest after the report; approving with it is what a person at a terminal would copy. */
async function approveInTextMode(home: string, args: readonly string[], env: Record<string, string>): Promise<Awaited<ReturnType<typeof runSupportCli>>> {
  const preview = await runSupportCli(home, ['support', '--no-open', ...args], env);
  expect(preview.code, preview.stdout + preview.stderr).toBe(0);
  const digest = /Report digest: ([0-9a-f]{64})/.exec(preview.stdout)?.[1];
  expect(digest).toBeDefined();
  return runSupportCli(home, ['support', '--no-open', '--yes', '--approved-digest', digest!, ...args], env);
}

/** Points the CLI's temp folder inside the test home, so context files written beside the project are not treated as temporary. */
async function isolatedTemp(home: string): Promise<Record<string, string>> {
  const temp = join(home, 'tmp');
  await mkdir(temp, { recursive: true });
  return { TMPDIR: temp, TMP: temp, TEMP: temp };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(contexts.splice(0).map(context => context.cleanup()));
});

describe('eai support draft handoff', () => {
  test('redacts access keys in every free-form harness field before preview and the consented POST', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const credential = 'AWS_ACCESS_KEY_ID=aws-fixture access_key=opaque-fixture';
    const context = harnessContextFixture({
      request: credential, goal: credential, summary: credential, steps: [credential],
      commands: [{ command: credential, exitCode: 1, errorCode: 'access_key=opaque-fixture', reasonCode: credential }],
      errors: [{ code: credential, message: credential }], attemptedFixes: [credential],
      filesTouched: ['src/access_key=opaque-fixture.ts'],
    });
    const contextPath = join(home.dir, 'summary.json');
    await writeFile(contextPath, JSON.stringify(context));
    const { preview, sent } = await previewThenApprove(home.dir,
      ['--source', 'harness', '--tool', 'codex', '--context-file', contextPath], { EAI_WEBSITE_URL: server.origin });
    expect(sent.code, sent.stdout + sent.stderr).toBe(0);
    expect(parse(sent).status).toBe('created');
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].body).toEqual(preview.bundle);
    for (const text of [preview.previewText!, JSON.stringify(preview.bundle), JSON.stringify(server.requests[0].body), sent.stdout]) {
      expect(text).not.toContain('aws-fixture');
      expect(text).not.toContain('opaque-fixture');
      expect(text).toContain('[redacted]');
    }
  });

  test('previews the harness report with zero POSTs, then sends exactly the approved bundle with the saved bearer', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    await writeFile(join(home.dir, 'eai.config.ts'), 'export default {};\n');
    await writeFile(join(home.dir, '.env.local'), [
      'EAI_TENANT_ID=project-workspace-fixture',
      'EAI_TENANT_NAME=Project workspace',
      'EAI_APP_KEY=app-key-fixture',
      'NEXT_PUBLIC_APP_NAME=Project app',
      'DATABASE_PASSWORD=unrelated-private-fixture',
      '',
    ].join('\n'));
    const contextPath = join(home.dir, 'session-summary.json');
    await writeFile(contextPath, JSON.stringify(harnessContextFixture({
      summary: `Seed failed. Bearer summary-private-fixture; the env value unrelated-private-fixture leaked into ${home.dir}/src/eai.config/object-types.ts`,
    })));
    const args = [
      '--source', 'harness', '--tool', 'codex', '--tool-version', '1.2.3',
      '--command', 'eai types push --api-key command-private-fixture',
      '--error-code', 'not_logged_in', '--exit-code', '1', '--context-file', contextPath,
      '--description', 'The command still fails. Bearer diagnostic-private-fixture. AccountKey=azure-private-fixture;',
    ];
    const env = { EAI_WEBSITE_URL: server.origin, ...(await isolatedTemp(home.dir)) };
    const previewRun = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', ...args], env);
    expect(previewRun.code).toBe(0);
    const preview = parse(previewRun);
    expect(preview).toMatchObject({ ok: true, status: 'consent_required' });
    expect(preview.url).toBe(`${server.origin}/support?chat=open`);
    expect(preview.questions).toBeUndefined();
    expect(server.requests).toHaveLength(0);
    expect(preview.bundleDigest).toMatch(DIGEST);
    expect(preview.previewText!.trimEnd().endsWith(`Report digest: ${preview.bundleDigest}`)).toBe(true);
    expect(preview.previewText).toContain('Session summary from the AI assistant');
    expect(preview.previewText).toContain('Seed the Object Types for the new app');
    expect(preview.previewText).toContain('eai types seed');
    expect(preview.previewText).toContain('./src/eai.config/object-types.ts');
    expect(preview.bundle?.harness).toMatchObject({
      requestedByPerson: true, request: 'get help', truncated: false,
      filesTouched: ['src/eai.config/object-types.ts'],
    });
    expect(String((preview.bundle?.harness as Record<string, unknown>).summary)).toContain('./src/eai.config/object-types.ts');
    expect(preview.previewText).not.toContain(home.dir);

    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', '--yes', '--approved-digest', preview.bundleDigest!, ...args], env);
    expect(result.code).toBe(0);
    const output = parse(result);
    expect(output).toMatchObject({ ok: true, status: 'created' });
    expect(server.requests).toHaveLength(1);
    const request = server.requests[0];
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/api/support/drafts');
    expect(request.authorization).toBe(`Bearer ${SUPPORT_SESSION_TOKEN}`);
    expect(request.contentType).toBe('application/json');
    expect(request.body).toEqual(preview.bundle);
    expect(request.body).toEqual(output.bundle);
    expect(request.body).toMatchObject({
      source: 'harness', tool: { name: 'codex', version: '1.2.3' },
      cli: { exitCode: 1, errorCode: 'E101', reasonCode: 'not_logged_in' },
      service: 'eai-cli', category: 'technical', environment: 'prod',
      tenantId: 'project-workspace-fixture', tenantName: 'Project workspace',
      appId: 'app-key-fixture', appName: 'Project app',
    });
    expect(Object.keys(request.body).sort()).toEqual([
      'appId', 'appName', 'category', 'cli', 'cliVersion', 'description', 'environment', 'error', 'harness',
      'os', 'service', 'source', 'summary', 'tenantId', 'tenantName', 'tool',
    ].sort());
    expect(Object.keys(request.body.harness as Record<string, unknown>).sort()).toEqual([
      'attemptedFixes', 'commands', 'errors', 'filesTouched', 'goal', 'request', 'requestedByPerson', 'steps', 'summary', 'truncated',
    ].sort());
    expect(Buffer.byteLength(JSON.stringify(request.body.harness), 'utf8')).toBeLessThanOrEqual(32 * 1024);
    expect(request.body.error).toBe(findGuidanceByCodeOrReason('not_logged_in')!.title);
    expect(output.url).toBe(`${server.origin}/support#draft=${SUPPORT_DRAFT_ID}.${SUPPORT_DRAFT_TOKEN}`);
    const link = new URL(output.url!);
    expect(link.pathname).toBe('/support');
    expect(link.search).toBe('');
    expect(link.hash).toBe(`#draft=${SUPPORT_DRAFT_ID}.${SUPPORT_DRAFT_TOKEN}`);
    expect(Date.parse(output.expiresAt!)).toBeGreaterThan(Date.now());
    const displayed = previewRun.stdout + previewRun.stderr + result.stdout + result.stderr + JSON.stringify(request.body);
    for (const secret of [
      SUPPORT_SESSION_TOKEN, 'opaque-refresh-session-fixture', 'summary-private-fixture',
      'command-private-fixture', 'diagnostic-private-fixture', 'azure-private-fixture',
      'unrelated-private-fixture', home.dir,
    ]) expect(displayed).not.toContain(secret);
    await expect(access(contextPath)).resolves.toBeUndefined();
  });

  test('reads the session summary from stdin and keeps the previewed bundle identical to the POST', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const input = JSON.stringify(harnessContextFixture());
    const { preview, sent } = await previewThenApprove(home.dir, ['--tool', 'claude', '--context-file', '-'], { EAI_WEBSITE_URL: server.origin }, { input });
    expect(sent.code).toBe(0);
    expect(parse(sent)).toMatchObject({ ok: true, status: 'created' });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].body).toEqual(preview.bundle);
    expect(server.requests[0].body.harness).toEqual(harnessContextFixture());
    expect(server.requests[0].body.source).toBe('harness');
  });

  test('keeps preview context even in shared temp and outside the owned directory', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const env = { EAI_WEBSITE_URL: server.origin, ...(await isolatedTemp(home.dir)) };
    const temporary = join(env.TMPDIR, 'eai-session.json');
    const kept = join(home.dir, 'kept-session.json');
    await writeFile(temporary, JSON.stringify(harnessContextFixture()), { mode: 0o600 });
    await writeFile(kept, JSON.stringify(harnessContextFixture()), { mode: 0o600 });
    const fromTemp = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', '--tool', 'codex', '--context-file', temporary], env);
    expect(fromTemp.code).toBe(0);
    expect(parse(fromTemp)).toMatchObject({ ok: true, status: 'consent_required' });
    await expect(access(temporary)).resolves.toBeUndefined();
    const fromProject = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', '--tool', 'codex', '--context-file', kept], env);
    expect(fromProject.code).toBe(0);
    await expect(access(kept)).resolves.toBeUndefined();
    expect(server.requests).toHaveLength(0);
  });

  test.each([
    ['a missing digest', undefined],
    ['a wrong digest', createHash('sha256').update('another report').digest('hex')],
  ])('answers consent_stale and sends nothing for %s', async (_name, digest) => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const result = await runSupportCli(home.dir, [
      'support', '--format', 'json', '--no-open', '--yes', ...(digest ? ['--approved-digest', digest] : []), '--tool', 'codex',
    ], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(1);
    const output = parse(result);
    expect(output).toMatchObject({ ok: false, status: 'consent_stale' });
    expect(output.bundleDigest).toMatch(DIGEST);
    expect(output.previewText).toContain(`Report digest: ${output.bundleDigest}`);
    expect(output.url).toBe(`${server.origin}/support?chat=open`);
    expect(server.requests).toHaveLength(0);
    expect(result.stderr).toContain('Need help?');
  });

  test('noninteractive text --yes without the approved digest sends nothing', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const result = await runSupportCli(home.dir, ['support', '--no-open', '--yes'], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('rerun with --yes --approved-digest');
    expect(result.stdout).not.toContain('#draft=');
    expect(server.requests).toHaveLength(0);
  });

  test('a changed report invalidates the earlier approval', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const preview = parse(await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', '--tool', 'codex', '--description', 'First version of the report.'], { EAI_WEBSITE_URL: server.origin }));
    const result = await runSupportCli(home.dir, [
      'support', '--format', 'json', '--no-open', '--yes', '--approved-digest', preview.bundleDigest!, '--tool', 'codex', '--description', 'Second version of the report.',
    ], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(1);
    expect(parse(result)).toMatchObject({ ok: false, status: 'consent_stale' });
    expect(server.requests).toHaveLength(0);
  });

  test('previews the redacted JSON bundle without creating a draft before chat consent', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const result = await runSupportCli(home.dir, [
      'support', '--format', 'json', '--no-open',
      '--description', `The command failed with ${SUPPORT_SESSION_TOKEN}. API_KEY=preview-private-fixture`,
    ], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(0);
    const output = parse(result);
    expect(output).toMatchObject({ ok: true, status: 'consent_required' });
    expect(output.bundle).toMatchObject({ source: 'eai-cli', service: 'eai-cli' });
    expect(output.bundle).not.toHaveProperty('harness');
    expect(output.previewText).toContain('Source: eai-cli');
    expect(output.previewText!.trimEnd().endsWith(`Report digest: ${output.bundleDigest}`)).toBe(true);
    expect(output.url).toBe(`${server.origin}/support?chat=open`);
    expect(server.requests).toHaveLength(0);
    expect(result.stdout + result.stderr).not.toContain(SUPPORT_SESSION_TOKEN);
    expect(result.stdout + result.stderr).not.toContain('preview-private-fixture');
  });

  test.each([
    { overlap: 'populated', processValue: 'opaque-process-credential-fixture' },
    { overlap: 'empty', processValue: '' },
  ].flatMap(overlap => [
    { ...overlap, mode: 'JSON preview', format: 'json', send: false },
    { ...overlap, mode: 'text preview', format: 'text', send: false },
    { ...overlap, mode: 'POST', format: 'json', send: true },
  ]))('redacts shadowed project credentials in $mode with a $overlap process value', async ({ processValue, format, send }) => {
    const home = await environment();
    const server = await fixture();
    const projectValue = 'opaque-project-credential-fixture';
    await writeSupportSession(home.dir);
    await writeFile(join(home.dir, 'eai.config.ts'), 'export default {};\n');
    await writeFile(join(home.dir, '.env.local'), `DATABASE_PASSWORD=${projectValue}\n`);
    const description = `The provider rejected ${projectValue}${processValue ? ` and ${processValue}` : ''} during setup.`;
    const env = { EAI_WEBSITE_URL: server.origin, DATABASE_PASSWORD: processValue };
    const result = send
      ? (await previewThenApprove(home.dir, ['--description', description], env)).sent
      : await runSupportCli(home.dir, ['support', '--format', format, '--no-open', '--description', description], env);

    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(projectValue);
    if (processValue) expect(result.stdout + result.stderr).not.toContain(processValue);
    expect(result.stdout).toContain('[redacted]');
    expect(server.requests).toHaveLength(send ? 1 : 0);
    if (send) {
      expect(parse(result)).toMatchObject({ ok: true, status: 'created' });
      const posted = JSON.stringify(server.requests[0].body);
      expect(posted).not.toContain(projectValue);
      if (processValue) expect(posted).not.toContain(processValue);
    } else if (format === 'json') {
      expect(parse(result)).toMatchObject({ ok: true, status: 'consent_required' });
    } else {
      expect(result.stdout).toMatch(/Report digest: [0-9a-f]{64}/);
      expect(result.stdout).toContain('Show previewText to the person unchanged and ask whether to send it.');
    }
  });

  test.each(['         x', 'x         ', '\t\nx\t\n'])('rejects a trimmed short description %j before posting', async (description) => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const result = await runSupportCli(home.dir, [
      'support', '--format', 'json', '--yes', '--no-open', '--description', description,
    ], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(1);
    expect(parse(result)).toMatchObject({ ok: false, status: 'failed', error: { code: 'invalid_report' }, url: `${server.origin}/support?chat=open` });
    expect(server.requests).toHaveLength(0);
  });

  test('posts the trimmed description at the website minimum length', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const { sent } = await previewThenApprove(home.dir, ['--description', '   1234567890   '], { EAI_WEBSITE_URL: server.origin });
    expect(sent.code).toBe(0);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].body.description).toBe('1234567890');
    expect(parse(sent).bundle?.description).toBe('1234567890');
  });

  test('supplies the required tool version field when the harness version is unknown', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const { sent } = await previewThenApprove(home.dir, ['--tool', 'codex'], { EAI_WEBSITE_URL: server.origin });
    expect(sent.code).toBe(0);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].body.tool).toEqual({ name: 'codex', version: '' });
  });

  test.each(['missing', 'expired', 'env-only'] as const)('returns the chat link for a %s saved session in JSON and text mode and creates nothing', async (session) => {
    const home = await environment();
    const server = await fixture();
    if (session === 'expired') await writeSupportSession(home.dir, Date.now() - 60_000);
    const env = { EAI_WEBSITE_URL: server.origin, ...(session === 'env-only' ? { EAI_ACCESS_TOKEN: 'env-only-private-fixture' } : {}) };
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--yes', '--no-open'], env);
    expect(result.code).toBe(0);
    const output = parse(result);
    expect(output).toMatchObject({ ok: true, status: 'signed_out', url: `${server.origin}/support?chat=open` });
    expect(new URL(output.url!).search).toBe('?chat=open');
    expect(new URL(output.url!).hash).toBe('');
    expect(output.previewText).toContain(`Report digest: ${output.bundleDigest}`);
    const text = await runSupportCli(home.dir, ['support', '--no-open'], env);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain(`${server.origin}/support?chat=open`);
    expect(text.stdout).not.toContain('#draft=');
    expect(server.requests).toHaveLength(0);
    for (const shown of [result.stdout + result.stderr, text.stdout + text.stderr]) {
      expect(shown).not.toContain('env-only-private-fixture');
      expect(shown).not.toContain(SUPPORT_SESSION_TOKEN);
    }
  });

  test('declines a noninteractive text report without an explicit consent flag', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const result = await runSupportCli(home.dir, ['support', '--no-open'], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/consent|approv/i);
    expect(server.requests).toHaveLength(0);
  });

  test('falls back to the chat link in JSON and text mode when the website rejects the saved session', async () => {
    const home = await environment();
    const server = await fixture(response => {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized', detail: 'server-private-fixture' }));
    });
    await writeSupportSession(home.dir);
    const { sent } = await previewThenApprove(home.dir, [], { EAI_WEBSITE_URL: server.origin });
    expect(sent.code).toBe(0);
    expect(parse(sent)).toMatchObject({ ok: true, status: 'signed_out', url: `${server.origin}/support?chat=open` });
    expect(server.requests).toHaveLength(1);
    expect(sent.stdout + sent.stderr).not.toContain('server-private-fixture');
    expect(sent.stdout).not.toContain('#draft=');
    const text = await approveInTextMode(home.dir, [], { EAI_WEBSITE_URL: server.origin });
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('rejected the login session');
    expect(text.stdout).toContain(`${server.origin}/support?chat=open`);
  });

  test.each([400, 413, 429, 503])('returns a safe failure with the chat link after HTTP %i without retrying or printing server content', async (status) => {
    const home = await environment();
    const server = await fixture(response => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'server-private-fixture', access_token: 'server-token-private-fixture' }));
    });
    await writeSupportSession(home.dir);
    const { sent } = await previewThenApprove(home.dir, [], { EAI_WEBSITE_URL: server.origin });
    expect(sent.code).toBe(1);
    const output = parse(sent);
    expect(output).toMatchObject({ ok: false, status: 'failed', error: { code: `http_${status}` }, url: `${server.origin}/support?chat=open` });
    expect(server.requests).toHaveLength(1);
    expect(sent.stdout + sent.stderr).not.toContain('server-private-fixture');
    expect(sent.stdout + sent.stderr).not.toContain('server-token-private-fixture');
    expect(sent.stdout).not.toContain('#draft=');
    const text = await approveInTextMode(home.dir, [], { EAI_WEBSITE_URL: server.origin });
    expect(text.code).toBe(1);
    expect(text.stdout).toContain(`${server.origin}/support?chat=open`);
    expect(text.stdout + text.stderr).not.toContain('server-private-fixture');
  });

  test('reports region_required with the chat link and the organisation question when the website cannot place the report', async () => {
    const home = await environment();
    const server = await fixture(regionRequiredResponder);
    await writeSupportSession(home.dir);
    const { sent } = await previewThenApprove(home.dir, [], { EAI_WEBSITE_URL: server.origin });
    expect(sent.code).toBe(0);
    const output = parse(sent);
    expect(output).toMatchObject({ ok: true, status: 'region_required', url: `${server.origin}/support?chat=open`, questions: ['organisationLocation'] });
    expect(output.message).toContain('where the organisation is based');
    expect(sent.stdout).not.toContain('#draft=');
    expect(server.requests).toHaveLength(1);
    const text = await approveInTextMode(home.dir, [], { EAI_WEBSITE_URL: server.origin });
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('where the organisation is based');
    expect(text.stdout).toContain(`${server.origin}/support?chat=open`);
  });

  test('asks for the organisation location before approval when the session has no active workspace', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir, undefined, { activeTenantId: undefined, activeTenantName: undefined });
    const asked = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', '--tool', 'codex'], { EAI_WEBSITE_URL: server.origin });
    expect(asked.code).toBe(0);
    const question = parse(asked);
    expect(question).toMatchObject({ ok: true, status: 'consent_required', questions: ['organisationLocation'] });
    expect(question.message).toContain('Where is your organisation based?');
    expect(question.bundle).not.toHaveProperty('organisationLocation');
    // Approval without the answer never sends, even when the digest matches the preview.
    const forced = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', '--tool', 'codex', '--yes', '--approved-digest', question.bundleDigest!], { EAI_WEBSITE_URL: server.origin });
    expect(forced.code).toBe(0);
    expect(parse(forced)).toMatchObject({ ok: true, status: 'consent_required', questions: ['organisationLocation'] });
    expect(server.requests).toHaveLength(0);
    const answered = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', '--tool', 'codex', '--organisation-location', 'emea'], { EAI_WEBSITE_URL: server.origin });
    const preview = parse(answered);
    expect(preview).toMatchObject({ ok: true, status: 'consent_required' });
    expect(preview.questions).toBeUndefined();
    expect(preview.bundle?.organisationLocation).toBe('emea');
    expect(preview.previewText).toContain('Organisation location: emea');
    expect(preview.bundleDigest).not.toBe(question.bundleDigest);
    const sent = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', '--tool', 'codex', '--organisation-location', 'emea', '--yes', '--approved-digest', preview.bundleDigest!], { EAI_WEBSITE_URL: server.origin });
    expect(sent.code).toBe(0);
    expect(parse(sent)).toMatchObject({ ok: true, status: 'created' });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].body).toEqual(preview.bundle);
    expect(server.requests[0].body.organisationLocation).toBe('emea');
    const text = await runSupportCli(home.dir, ['support', '--no-open', '--tool', 'codex'], { EAI_WEBSITE_URL: server.origin });
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('Where is your organisation based?');
    expect(server.requests).toHaveLength(1);
  });

  test('does not ask for the organisation location when the session has an active workspace or the person is signed out', async () => {
    const home = await environment();
    const server = await fixture();
    const signedOut = parse(await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open'], { EAI_WEBSITE_URL: server.origin }));
    expect(signedOut.status).toBe('signed_out');
    expect(signedOut.questions).toBeUndefined();
    await writeSupportSession(home.dir);
    const withWorkspace = parse(await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open'], { EAI_WEBSITE_URL: server.origin }));
    expect(withWorkspace.status).toBe('consent_required');
    expect(withWorkspace.questions).toBeUndefined();
  });

  test.each([
    ['foreign origin', (origin: string) => ({ ...validDraftResponse(origin), redeemUrl: 'https://untrusted.invalid/support#draft=private-fixture' })],
    ['query report', (origin: string) => ({ ...validDraftResponse(origin), redeemUrl: `${origin}/support?description=private-fixture#draft=${SUPPORT_DRAFT_ID}.${SUPPORT_DRAFT_TOKEN}` })],
    ['extra fragment report', (origin: string) => ({ ...validDraftResponse(origin), redeemUrl: `${origin}/support#draft=${SUPPORT_DRAFT_ID}.${SUPPORT_DRAFT_TOKEN}&description=private-fixture` })],
    ['invalid token', (origin: string) => ({ ...validDraftResponse(origin), token: 'private-fixture' })],
    ['expired reply', (origin: string) => ({ ...validDraftResponse(origin), expiresAt: new Date(Date.now() - 60_000).toISOString() })],
  ])('rejects a %s handoff response', async (_name, responseBody) => {
    const home = await environment();
    const server = await fixture((response, origin) => {
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify(responseBody(origin)));
    });
    await writeSupportSession(home.dir);
    const { sent } = await previewThenApprove(home.dir, [], { EAI_WEBSITE_URL: server.origin });
    expect(sent.code).toBe(1);
    expect(parse(sent)).toMatchObject({ ok: false, status: 'failed', error: { code: 'invalid_response' } });
    expect(server.requests).toHaveLength(1);
    expect(sent.stdout + sent.stderr).not.toContain('private-fixture');
    expect(sent.stdout).not.toContain('#draft=');
  });

  test.each([
    ['plain text', 'text/plain', 'server-private-fixture'],
    ['malformed JSON', 'application/json', '{"secret":"server-private-fixture"'],
    ['oversized JSON', 'application/json', JSON.stringify({ detail: 'server-private-fixture'.repeat(1000) })],
  ])('rejects a %s 201 response without printing its content', async (_name, contentType, body) => {
    const home = await environment();
    const server = await fixture(response => {
      response.writeHead(201, { 'content-type': contentType });
      response.end(body);
    });
    await writeSupportSession(home.dir);
    const { sent } = await previewThenApprove(home.dir, [], { EAI_WEBSITE_URL: server.origin });
    expect(sent.code).toBe(1);
    expect(parse(sent)).toMatchObject({ ok: false, status: 'failed', error: { code: 'invalid_response' } });
    expect(server.requests).toHaveLength(1);
    expect(sent.stdout + sent.stderr).not.toContain('server-private-fixture');
  });

  test('refuses to follow website redirects or retry the draft create', async () => {
    const home = await environment();
    const server = await fixture((response, origin) => {
      response.writeHead(307, { location: `${origin}/redirect-target` });
      response.end();
    });
    await writeSupportSession(home.dir);
    const { sent } = await previewThenApprove(home.dir, [], { EAI_WEBSITE_URL: server.origin });
    expect(sent.code).toBe(1);
    expect(parse(sent)).toMatchObject({ ok: false, status: 'failed' });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].url).toBe('/api/support/drafts');
  });

  test.each([
    ['--error-code', 'not-in-catalog'],
    ['--exit-code', '2147483648'],
    ['--exit-code', '1.5'],
    ['--source', 'dashboard'],
    ['--description', 'short'],
    ['--tool', 'x'.repeat(81)],
    ['--organisation-location', 'mars'],
  ])('rejects invalid report input %s before sending it', async (flag, value) => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--yes', '--no-open', flag, value], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(1);
    expect(parse(result)).toMatchObject({ ok: false, status: 'failed', error: { code: 'invalid_report' } });
    expect(server.requests).toHaveLength(0);
  });

  test('requires the harness source for a context file', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const contextPath = join(home.dir, 'summary.json');
    await writeFile(contextPath, JSON.stringify(harnessContextFixture()));
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', '--context-file', contextPath], { EAI_WEBSITE_URL: server.origin, ...(await isolatedTemp(home.dir)) });
    await expect(access(contextPath)).resolves.toBeUndefined();
    expect(result.code).toBe(1);
    expect(parse(result)).toMatchObject({ ok: false, status: 'failed', error: { code: 'invalid_report' } });
    expect(server.requests).toHaveLength(0);
  });

  test.each([
    { name: 'missing file', code: 'context_unreadable', prepare: async (home: string) => join(home, 'missing-summary.json') },
    { name: 'directory', code: 'context_unreadable', prepare: async (home: string) => home },
    { name: 'oversized file', code: 'context_too_large', prepare: async (home: string) => {
      const file = join(home, 'oversized.json');
      await writeFile(file, JSON.stringify(harnessContextFixture({ summary: 'x'.repeat(65 * 1024) })));
      return file;
    } },
    { name: 'malformed JSON', code: 'context_invalid', prepare: async (home: string) => {
      const file = join(home, 'malformed.json');
      await writeFile(file, '{"requestedByPerson": true, "request": "get help"');
      return file;
    } },
    { name: 'JSON array', code: 'context_invalid', prepare: async (home: string) => {
      const file = join(home, 'array.json');
      await writeFile(file, '[]');
      return file;
    } },
  ])('fails safely with $code for a $name context file and sends nothing', async ({ code, prepare }) => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const path = await prepare(home.dir);
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', '--tool', 'codex', '--context-file', path], { EAI_WEBSITE_URL: server.origin, ...(await isolatedTemp(home.dir)) });
    expect(result.code).toBe(1);
    expect(parse(result)).toMatchObject({ ok: false, status: 'failed', error: { code }, url: `${server.origin}/support?chat=open` });
    expect(result.stdout).not.toContain(home.dir);
    expect(server.requests).toHaveLength(0);
  });

  test('rejects oversized stdin before parsing it', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', '--tool', 'codex', '--context-file', '-'], { EAI_WEBSITE_URL: server.origin }, { input: 'x'.repeat(64 * 1024 + 1) });
    expect(result.code).toBe(1);
    expect(parse(result)).toMatchObject({ ok: false, status: 'failed', error: { code: 'context_too_large' } });
    expect(server.requests).toHaveLength(0);
  });

  test('names invalid context fields without echoing their values', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const contextPath = join(home.dir, 'invalid.json');
    await writeFile(contextPath, JSON.stringify(harnessContextFixture({
      requestedByPerson: false,
      filesTouched: ['src/ok.ts', `${home.dir}/.env.local`],
      commands: [{ command: 'eai types seed', exitCode: 'one-private-value' }],
      unexpectedField: 'unexpected-private-value',
    })));
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', '--tool', 'codex', '--context-file', contextPath], { EAI_WEBSITE_URL: server.origin, ...(await isolatedTemp(home.dir)) });
    expect(result.code).toBe(1);
    const output = parse(result);
    expect(output).toMatchObject({ ok: false, status: 'failed', error: { code: 'context_invalid' } });
    expect(output.error!.message).toContain('requestedByPerson');
    expect(output.error!.message).toContain('filesTouched[1] (absolute path)');
    expect(output.error!.message).toContain('commands[0].exitCode');
    expect(output.error!.message).toContain('unexpectedField (unexpected)');
    expect(result.stdout).not.toContain('private-value');
    expect(result.stdout).not.toContain(home.dir);
    expect(server.requests).toHaveLength(0);
  });

  test('keeps the failed command and catalog identity across the error explanation into the preview', async () => {
    const home = await environment();
    const failure = await runSupportCli(home.dir, ['types', 'validate']);
    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain('eai support');
    await writeSupportSession(home.dir);
    const explanation = await runSupportCli(home.dir, ['errors', 'explain', 'E001', '--format', 'json']);
    expect(explanation.code).toBe(0);
    const preview = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open']);
    expect(preview.code).toBe(0);
    const output = parse(preview);
    expect(output.bundle?.cli).toMatchObject({
      command: 'eai types validate', exitCode: 1, errorCode: 'E001', reasonCode: 'not_in_eai_project',
    });
    expect(output.bundle?.occurredAt).toEqual(expect.any(String));
    expect(output.bundle?.error).toBe(findGuidanceByCodeOrReason('E001')!.title);
    expect(output.ignoredLastError).toBeUndefined();
    const supportDirectory = join(home.dir, '.eai', 'support');
    const { readdir } = await import('node:fs/promises');
    const savedFiles = (await readdir(supportDirectory)).filter(name => name !== 'context');
    expect(savedFiles).toHaveLength(1);
    const saved = JSON.parse(await readFile(join(supportDirectory, savedFiles[0]), 'utf8'));
    expect(saved.command).toBe('eai types validate');
    expect(saved).not.toHaveProperty('message');
  });

  test('leaves a saved error older than 24 hours out of the report and shows its time', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const profileHash = createHash('sha256').update('default').digest('hex').slice(0, 16);
    const recordedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await mkdir(join(home.dir, '.eai', 'support'), { recursive: true });
    await writeFile(join(home.dir, '.eai', 'support', `last-error-${profileHash}.json`), JSON.stringify({
      command: 'eai types seed', exitCode: 1, errorCode: 'E001', reasonCode: 'not_in_eai_project', recordedAt,
    }), { mode: 0o600 });
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open'], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(0);
    const output = parse(result);
    expect(output).toMatchObject({ ok: true, status: 'consent_required', ignoredLastError: { recordedAt, reason: 'expired' } });
    expect(output.bundle?.cli).toEqual({});
    expect(output.bundle?.occurredAt).toBeUndefined();
    expect(output.bundle?.error).toBeUndefined();
    const text = await runSupportCli(home.dir, ['support', '--no-open'], { EAI_WEBSITE_URL: server.origin });
    expect(text.stdout).toContain(`The error saved on ${recordedAt} is older than 24 hours and was left out.`);
  });

  test('--no-last-error skips a fresh saved error', async () => {
    const home = await environment();
    const server = await fixture();
    const failure = await runSupportCli(home.dir, ['types', 'validate']);
    expect(failure.code).toBe(1);
    await writeSupportSession(home.dir);
    const withContext = parse(await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open'], { EAI_WEBSITE_URL: server.origin }));
    expect(withContext.bundle?.cli).toMatchObject({ command: 'eai types validate' });
    const without = parse(await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', '--no-last-error'], { EAI_WEBSITE_URL: server.origin }));
    expect(without.bundle?.cli).toEqual({});
    expect(without.bundle?.occurredAt).toBeUndefined();
    expect(without.ignoredLastError).toBeUndefined();
  });

  test('no JSON error suggestion asks an agent to run eai support; the JSON envelope keeps its deployed key set', async () => {
    const home = await environment();
    const result = await runSupportCli(home.dir, ['blocks', 'describe', 'unknown-block-fixture', '--format', 'json']);
    expect(result.code).toBe(1);
    const envelope = JSON.parse(result.stderr) as { error: { suggestion: string; help: string } };
    expect(envelope.error.suggestion).not.toContain('eai support');
    expect(Object.keys(envelope.error).filter(key => key !== 'guidance').sort()).toEqual(['code', 'exitCode', 'message', 'suggestion']);
  });

  test.each([
    { cache: 'captured', recognized: true },
    { cache: 'captured', recognized: false },
    { cache: 'legacy', recognized: true },
    { cache: 'legacy', recognized: false },
  ].flatMap(context => [
    { ...context, mode: 'JSON preview', format: 'json', send: false },
    { ...context, mode: 'text preview', format: 'text', send: false },
    { ...context, mode: 'POST', format: 'json', send: true },
  ]))('excludes project A diagnostics from project B $mode with $cache cache and recognized identity $recognized', async ({ cache, recognized, format, send }) => {
    const home = await environment();
    const projectA = join(home.dir, 'project-a');
    const projectB = join(home.dir, 'project-b');
    await mkdir(projectA);
    await mkdir(projectB);
    const secret = 'opaque-project-a-credential-fixture';
    await writeFile(join(projectA, 'eai.config.ts'), 'export default {};\n');
    await writeFile(join(projectA, '.env.local'), `DATABASE_PASSWORD=${secret}\n`);
    await writeFile(join(projectB, 'eai.config.ts'), 'export default {};\n');
    await writeSupportSession(home.dir);
    const profileHash = createHash('sha256').update('default').digest('hex').slice(0, 16);
    const cachePath = join(home.dir, '.eai', 'support', `last-error-${profileHash}.json`);
    const diagnostic = `${recognized ? 'Error code: E101\nReason: not_logged_in\n' : ''}Provider returned ${secret} while connecting.`;
    const recordedAt = new Date(Date.now() - 60_000).toISOString();
    if (cache === 'captured') {
      const script = `
        import { installSupportErrorTracking, setSupportCommand } from ${JSON.stringify(supportContextModule)};
        installSupportErrorTracking(); setSupportCommand('eai verify');
        process.stderr.write(${JSON.stringify(diagnostic)}); process.exit(2);
      `;
      const failure = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: projectA, env: { ...process.env, HOME: home.dir, USERPROFILE: home.dir, EAI_PROFILE: 'default' },
        encoding: 'utf8', timeout: 10_000,
      });
      expect(failure.status).toBe(2);
    } else {
      await mkdir(join(home.dir, '.eai', 'support'), { recursive: true });
      await writeFile(cachePath, JSON.stringify({
        command: 'eai verify', exitCode: 2, recordedAt, message: diagnostic,
        ...(recognized ? { errorCode: 'E101', reasonCode: 'not_logged_in' } : {}),
      }), { mode: 0o600 });
    }
    const saved = JSON.parse(await readFile(cachePath, 'utf8')) as Record<string, unknown>;
    const server = await fixture();
    const env = { HOME: home.dir, USERPROFILE: home.dir, EAI_WEBSITE_URL: server.origin };
    const result = send
      ? (await previewThenApprove(projectB, [], env)).sent
      : await runSupportCli(projectB, ['support', '--format', format, '--no-open'], env);
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.stdout).not.toContain('Provider returned');
    expect(server.requests).toHaveLength(send ? 1 : 0);
    const bundle = format === 'json'
      ? parse(result).bundle!
      : JSON.parse(result.stdout.split('Redacted support report (review before sending):\n')[1]
        .split('\nReport digest:')[0]) as Record<string, unknown>;
    expect(bundle.cli).toEqual({
      command: 'eai verify', exitCode: 2,
      ...(recognized ? { errorCode: 'E101', reasonCode: 'not_logged_in' } : {}),
    });
    expect(bundle.occurredAt).toBe(new Date(String(saved.recordedAt)).toISOString());
    if (recognized) expect(bundle.error).toBe(findGuidanceByCodeOrReason('E101')!.title);
    else expect(bundle.error).toBeUndefined();
    if (format === 'json') expect(parse(result)).toMatchObject({
      ok: true, status: send ? 'created' : 'consent_required',
    });
    if (send) {
      expect(server.requests[0].authorization).toBe(`Bearer ${SUPPORT_SESSION_TOKEN}`);
      expect(server.requests[0].body).toEqual(bundle);
      expect(JSON.stringify(server.requests[0].body)).not.toContain(secret);
    }
    if (cache === 'captured') {
      expect(saved).not.toHaveProperty('message');
      expect(JSON.stringify(saved)).not.toContain(secret);
    }
  });

  test('rejects a website origin supplied by the project environment rather than the active user settings', async () => {
    const home = await environment();
    const untrustedServer = await fixture();
    await writeFile(join(home.dir, 'eai.config.ts'), 'export default {};\n');
    await writeFile(join(home.dir, '.env.local'), `EAI_WEBSITE_URL=${untrustedServer.origin}\n`);
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--yes', '--no-open']);
    expect(result.code).toBe(0);
    expect(parse(result)).toMatchObject({
      ok: true, status: 'signed_out', url: 'https://www.enterpriseaigroup.com/support?chat=open',
    });
    expect(untrustedServer.requests).toHaveLength(0);
  });

  test.each([
    '/nested-path', '/?description=private-fixture', '/#private-fixture',
  ])('rejects a configured website with %s before sending the report', async (suffix) => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--yes', '--no-open'], {
      EAI_WEBSITE_URL: `${server.origin}${suffix}`,
    });
    expect(result.code).toBe(1);
    expect(parse(result)).toMatchObject({ ok: false, status: 'failed', error: { code: 'invalid_report' } });
    expect(server.requests).toHaveLength(0);
    expect(result.stdout + result.stderr).not.toContain('private-fixture');
  });

  test('uses the explicitly configured website origin for the active named profile', async () => {
    const home = await environment();
    const server = await fixture();
    await mkdir(join(home.dir, '.eai'), { recursive: true });
    await writeFile(join(home.dir, '.eai', 'config.json'), JSON.stringify({
      profiles: {
        dev: {
          publicApiUrl: 'https://api.fixture.invalid',
          authTenantName: 'fixture', authTenantId: 'fixture', authClientId: 'fixture',
          websiteUrl: server.origin,
        },
      },
    }));
    const result = await runSupportCli(home.dir, ['--profile', 'dev', 'support', '--format', 'json', '--yes', '--no-open']);
    expect(result.code).toBe(0);
    expect(parse(result)).toMatchObject({ ok: true, status: 'signed_out', url: `${server.origin}/support?chat=open` });
    expect(server.requests).toHaveLength(0);
  });
});


describe('CLI-owned context file lifecycle', () => {
  test('keeps the real default-location preview, then deletes only after approved sending', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const directory = join(home.dir, '.eai', 'support', 'context');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const allocated = await runSupportCli(home.dir, ['support', '--create-context-file', '--format', 'json']);
    const file = JSON.parse(allocated.stdout).contextFile as string;
    expect(JSON.parse(allocated.stdout)).toMatchObject({ status: 'context_created', url: 'https://www.enterpriseaigroup.com/support?chat=open' });
    await writeFile(file, JSON.stringify(harnessContextFixture()), { mode: 0o600 });
    const args = ['--tool', 'codex', '--context-file', file];
    const env = { EAI_WEBSITE_URL: server.origin };
    const previewRun = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', ...args], env);
    const preview = parse(previewRun);
    expect(preview.status).toBe('consent_required');
    expect(preview.url).toBe(`${server.origin}/support?chat=open`);
    await expect(access(file)).resolves.toBeUndefined();
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    const sent = await runSupportCli(home.dir, ['support', '--format', 'json', '--no-open', '--yes', '--approved-digest', preview.bundleDigest!, ...args], env);
    expect(parse(sent).status).toBe('created');
    expect(server.requests[0].body).toEqual(preview.bundle);
    await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('purges stale owned files and preserves symlink targets and shared temp failures', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const directory = join(home.dir, '.eai', 'support', 'context');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const outside = join(home.dir, 'outside.json');
    const allocated = await runSupportCli(home.dir, ['support', '--create-context-file', '--format', 'json']);
    const stale = JSON.parse(allocated.stdout).contextFile as string;
    const unrelated = join(directory, 'unrelated.json');
    await writeFile(unrelated, JSON.stringify(harnessContextFixture()));
    await utimes(unrelated, new Date(0), new Date(0));
    const ownedAllocation = await runSupportCli(home.dir, ['support', '--create-context-file', '--format', 'json']);
    const owned = JSON.parse(ownedAllocation.stdout).contextFile as string;
    const alias = join(home.dir, 'alias.json');
    await writeFile(outside, JSON.stringify(harnessContextFixture()));
    await writeFile(stale, JSON.stringify(harnessContextFixture()));
    await writeFile(owned, JSON.stringify(harnessContextFixture()));
    await utimes(stale, new Date(0), new Date(0));
    await symlink(outside, join(directory, 'outside-link.json'));
    await symlink(owned, alias);
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--tool', 'codex', '--context-file', alias], { EAI_WEBSITE_URL: server.origin });
    expect(parse(result).status).toBe('consent_required');
    await expect(access(unrelated)).resolves.toBeUndefined();
    await expect(access(stale)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(outside)).resolves.toBeUndefined();
    await expect(access(owned)).resolves.toBeUndefined();
    await expect(access(alias)).resolves.toBeUndefined();
    const approved = await runSupportCli(home.dir, ['support', '--format', 'json', '--yes', '--approved-digest', parse(result).bundleDigest!, '--tool', 'codex', '--context-file', alias], { EAI_WEBSITE_URL: server.origin });
    expect(parse(approved).status).toBe('created');
    await expect(access(alias)).resolves.toBeUndefined();
    await expect(access(owned)).resolves.toBeUndefined();
    const oversized = join(home.dir, 'outside-large.json');
    await writeFile(oversized, 'x'.repeat(70 * 1024));
    const failed = await runSupportCli(home.dir, ['support', '--format', 'json', '--tool', 'codex', '--context-file', oversized], { EAI_WEBSITE_URL: server.origin });
    expect(parse(failed).status).toBe('failed');
    await expect(access(oversized)).resolves.toBeUndefined();
  });
});


describe('explicit local harness decline', () => {
  test('declines a preview immediately without posting and removes only its allocated file and marker', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const allocation = await runSupportCli(home.dir, ['support', '--create-context-file', '--format', 'json']);
    const file = JSON.parse(allocation.stdout).contextFile as string;
    await writeFile(file, JSON.stringify(harnessContextFixture()));
    const preview = await runSupportCli(home.dir, ['support', '--context-file', file, '--tool', 'codex', '--format', 'json'], { EAI_WEBSITE_URL: server.origin });
    expect(parse(preview).status).toBe('consent_required');
    const declined = await runSupportCli(home.dir, ['support', '--decline', '--context-file', file, '--format', 'json']);
    expect(declined.code).toBe(0);
    expect(parse(declined)).toMatchObject({ status: 'declined', url: 'https://www.enterpriseaigroup.com/support?chat=open' });
    expect(server.requests).toHaveLength(0);
    await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(`${file}.owner`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test.each(['untracked', 'outside', 'symlink'])('preserves %s files on explicit decline', async kind => {
    const home = await environment();
    const directory = join(home.dir, '.eai', 'support', 'context');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const target = join(home.dir, 'user-notes.json');
    await writeFile(target, JSON.stringify(harnessContextFixture()));
    const file = kind === 'outside' ? target : join(directory, 'user-notes.json');
    if (kind === 'symlink') await symlink(target, file);
    else if (kind === 'untracked') await writeFile(file, JSON.stringify(harnessContextFixture()));
    const declined = await runSupportCli(home.dir, ['support', '--decline', '--context-file', file, '--format', 'json']);
    expect(parse(declined).status).toBe('declined');
    await expect(access(file)).resolves.toBeUndefined();
    await expect(access(target)).resolves.toBeUndefined();
  });

  test('rejects simultaneous approval and decline without deleting the preview file', async () => {
    const home = await environment();
    const allocation = await runSupportCli(home.dir, ['support', '--create-context-file', '--format', 'json']);
    const file = JSON.parse(allocation.stdout).contextFile as string;
    const result = await runSupportCli(home.dir, ['support', '--yes', '--decline', '--context-file', file, '--format', 'json']);
    expect(result.code).toBe(1);
    expect(parse(result)).toMatchObject({ status: 'failed', error: { code: 'invalid_report' }, url: 'https://www.enterpriseaigroup.com/support?chat=open' });
    await expect(access(file)).resolves.toBeUndefined();
  });
});
