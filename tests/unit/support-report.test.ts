import { afterEach, describe, expect, test, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as auth from '../../src/lib/auth.js';
import { runSupport } from '../../src/commands/support.js';
import { createSupportDraft, SUPPORT_TIMEOUT_MS, type SupportBundle } from '../../src/lib/support-report.js';
import { setActiveProfile } from '../../src/lib/profile.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import {
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
      tenantId: 'fixture', tenantName: 'fixture', clientId: 'fixture',
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
      tenantId: 'fixture', tenantName: 'fixture', clientId: 'fixture',
    });
    const shown: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value: unknown) => { shown.push(String(value)); });
    const confirm = vi.fn(async () => {
      expect(shown.join('\n')).toContain('Redacted support report');
      expect(shown.join('\n')).toContain('eai-cli');
      expect(shown.join('\n')).not.toContain(SUPPORT_SESSION_TOKEN);
      return false;
    });
    await runSupport({ format: 'text', open: false }, { confirm, isInteractive: true });
    expect(confirm).toHaveBeenCalledOnce();
    expect(shown.join('\n')).toContain('No report was sent and no draft was created.');
    expect(server.requests).toHaveLength(0);
  });

  test.each([
    { label: 'default', timeoutMs: undefined, expectedDeadline: SUPPORT_TIMEOUT_MS },
    { label: 'custom', timeoutMs: 100, expectedDeadline: 100 },
  ])('cancels a stalled draft response at the $label deadline without an automatic retry', async ({ timeoutMs, expectedDeadline }) => {
    const deadline = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    let firstChunkRead!: () => void;
    const readingPartialBody = new Promise<void>(resolve => { firstChunkRead = resolve; });
    const nativeFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const response = await nativeFetch(input, init);
      if (response.body) {
        const getReader = response.body.getReader.bind(response.body);
        vi.spyOn(response.body, 'getReader').mockImplementation(() => {
          const reader = getReader();
          const read = reader.read.bind(reader);
          vi.spyOn(reader, 'read').mockImplementation(async () => {
            const chunk = await read();
            if (!chunk.done) firstChunkRead();
            return chunk;
          });
          return reader;
        });
      }
      return response;
    });
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
    const pending = createSupportDraft(server.origin, bundle, SUPPORT_SESSION_TOKEN, timeoutMs);
    const failure = expect(pending).rejects.toMatchObject({
      code: 'request_failed',
      message: expect.stringContaining('No retry was sent'),
    });
    // Control the deadline after real dispatch and partial response consumption,
    // so slow CI scheduling cannot expire it before the server observes the POST.
    await readingPartialBody;
    expect(timeoutSpy).toHaveBeenCalledExactlyOnceWith(expectedDeadline);
    expect(fetchSpy.mock.calls[0][1]?.signal).toBe(deadline.signal);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ method: 'POST', url: '/api/support/drafts',
      authorization: `Bearer ${SUPPORT_SESSION_TOKEN}`, body: bundle });
    deadline.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    await failure;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(server.requests).toHaveLength(1);
  });

  test('a deadline before transport dispatch fails safely without retrying or claiming a server create', async () => {
    const server = await startDraftServer();
    servers.push(server);
    const deadline = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }));
    const bundle: SupportBundle = {
      source: 'eai-cli', tool: { name: 'eai-cli', version: 'fixture' }, cli: {},
      cliVersion: 'fixture', service: 'eai-cli', category: 'technical',
      summary: 'Help with EAI CLI', description: 'The command failed after setup.', os: 'unknown', environment: 'local',
    };
    const pending = createSupportDraft(server.origin, bundle, SUPPORT_SESSION_TOKEN, 100);
    const failure = expect(pending).rejects.toMatchObject({ code: 'request_failed',
      message: expect.stringContaining('No retry was sent; a draft may have been created.') });
    expect(timeoutSpy).toHaveBeenCalledExactlyOnceWith(100);
    expect(fetchSpy.mock.calls[0][1]?.signal).toBe(deadline.signal);
    deadline.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    await failure;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(server.requests).toHaveLength(0);
  });
});
