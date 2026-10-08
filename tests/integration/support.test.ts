import { afterEach, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findGuidanceByCodeOrReason } from '../../src/lib/error-guidance/catalog.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import {
  runSupportCli,
  startDraftServer,
  SUPPORT_DRAFT_ID,
  SUPPORT_DRAFT_TOKEN,
  SUPPORT_SESSION_TOKEN,
  validDraftResponse,
  writeSupportSession,
  type DraftServer,
} from '../helpers/support-fixture.js';

interface SupportOutput {
  readonly ok: boolean;
  readonly status: string;
  readonly bundle?: Record<string, unknown>;
  readonly url?: string;
  readonly expiresAt?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

const contexts: TestEnvironment[] = [];
const servers: DraftServer[] = [];
const supportContextModule = new URL('../../dist/lib/support-context.js', import.meta.url).href;

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

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(contexts.splice(0).map(context => context.cleanup()));
});

describe('eai support draft handoff', () => {
  test('sends the contract bundle with the saved bearer after explicit consent and prints only the claim ticket in the link', async () => {
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

    const result = await runSupportCli(home.dir, [
      'support', '--format', 'json', '--yes', '--no-open',
      '--source', 'harness', '--tool', 'codex', '--tool-version', '1.2.3',
      '--command', 'eai types push --api-key command-private-fixture',
      '--error-code', 'not_logged_in', '--exit-code', '1',
      '--description', 'The command still fails. Bearer diagnostic-private-fixture. AccountKey=azure-private-fixture;',
    ], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout) as SupportOutput;
    expect(output).toMatchObject({ ok: true, status: 'created' });
    expect(server.requests).toHaveLength(1);
    const request = server.requests[0];
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/api/support/drafts');
    expect(request.authorization).toBe(`Bearer ${SUPPORT_SESSION_TOKEN}`);
    expect(request.contentType).toBe('application/json');
    expect(request.body).toMatchObject({
      source: 'harness', tool: { name: 'codex', version: '1.2.3' },
      cli: { exitCode: 1, errorCode: 'E101', reasonCode: 'not_logged_in' },
      service: 'eai-cli', category: 'technical', environment: 'prod',
      tenantId: 'project-workspace-fixture', tenantName: 'Project workspace',
      appId: 'app-key-fixture', appName: 'Project app',
    });
    expect(Object.keys(request.body).sort()).toEqual([
      'appId', 'appName', 'category', 'cli', 'cliVersion', 'description',
      'environment', 'error', 'os', 'service', 'source', 'summary', 'tenantId', 'tenantName', 'tool',
    ].sort());
    expect(Object.keys(request.body.cli as Record<string, unknown>).sort()).toEqual([
      'command', 'exitCode', 'errorCode', 'reasonCode',
    ].sort());
    expect(['macos', 'linux', 'windows', 'unknown']).toContain(request.body.os);
    expect(String(request.body.summary).length).toBeGreaterThanOrEqual(8);
    expect(String(request.body.summary).length).toBeLessThanOrEqual(180);
    expect(String(request.body.description).length).toBeLessThanOrEqual(6000);
    expect(request.body).toEqual(output.bundle);
    expect(request.body.error).toBe(findGuidanceByCodeOrReason('not_logged_in')!.title);
    expect(output.url).toBe(`${server.origin}/support#draft=${SUPPORT_DRAFT_ID}.${SUPPORT_DRAFT_TOKEN}`);
    const link = new URL(output.url!);
    expect(link.pathname).toBe('/support');
    expect(link.search).toBe('');
    expect(link.hash).toBe(`#draft=${SUPPORT_DRAFT_ID}.${SUPPORT_DRAFT_TOKEN}`);
    expect(Date.parse(output.expiresAt!)).toBeGreaterThan(Date.now());
    const displayed = result.stdout + result.stderr + JSON.stringify(request.body);
    for (const secret of [
      SUPPORT_SESSION_TOKEN, 'opaque-refresh-session-fixture',
      'command-private-fixture', 'diagnostic-private-fixture', 'azure-private-fixture',
      'unrelated-private-fixture',
    ]) expect(displayed).not.toContain(secret);
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
    const output = JSON.parse(result.stdout) as SupportOutput;
    expect(output).toMatchObject({ ok: true, status: 'consent_required' });
    expect(output.bundle).toMatchObject({ source: 'eai-cli', service: 'eai-cli' });
    expect(output.url).toBeUndefined();
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
    const result = await runSupportCli(home.dir, [
      'support', '--format', format, '--no-open', ...(send ? ['--yes'] : []),
      '--description', description,
    ], { EAI_WEBSITE_URL: server.origin, DATABASE_PASSWORD: processValue });

    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(projectValue);
    if (processValue) expect(result.stdout + result.stderr).not.toContain(processValue);
    expect(result.stdout).toContain('[redacted]');
    expect(server.requests).toHaveLength(send ? 1 : 0);
    if (send) {
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, status: 'created' });
      const posted = JSON.stringify(server.requests[0].body);
      expect(posted).not.toContain(projectValue);
      if (processValue) expect(posted).not.toContain(processValue);
    } else if (format === 'json') {
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, status: 'consent_required' });
    } else {
      expect(result.stdout).toContain('Show this bundle to the person and ask for consent.');
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
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, status: 'failed', error: { code: 'invalid_report' } });
    expect(server.requests).toHaveLength(0);
  });

  test('posts the trimmed description at the website minimum length', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const result = await runSupportCli(home.dir, [
      'support', '--format', 'json', '--yes', '--no-open', '--description', '   1234567890   ',
    ], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(0);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].body.description).toBe('1234567890');
    expect((JSON.parse(result.stdout) as SupportOutput).bundle?.description).toBe('1234567890');
  });

  test('supplies the required tool version field when the harness version is unknown', async () => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const result = await runSupportCli(home.dir, [
      'support', '--format', 'json', '--yes', '--no-open', '--tool', 'codex',
    ], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(0);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].body.tool).toEqual({ name: 'codex', version: '' });
  });

  test.each(['missing', 'expired', 'env-only'] as const)('prints the plain support page for a %s saved session and creates nothing', async (session) => {
    const home = await environment();
    const server = await fixture();
    if (session === 'expired') await writeSupportSession(home.dir, Date.now() - 60_000);
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--yes', '--no-open'], {
      EAI_WEBSITE_URL: server.origin,
      ...(session === 'env-only' ? { EAI_ACCESS_TOKEN: 'env-only-private-fixture' } : {}),
    });
    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout) as SupportOutput;
    expect(output).toMatchObject({ ok: true, status: 'signed_out', url: `${server.origin}/support` });
    expect(new URL(output.url!).hash).toBe('');
    expect(server.requests).toHaveLength(0);
    expect(result.stdout + result.stderr).not.toContain('env-only-private-fixture');
    expect(result.stdout + result.stderr).not.toContain(SUPPORT_SESSION_TOKEN);
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

  test('falls back to the plain page when the website rejects the saved session', async () => {
    const home = await environment();
    const server = await fixture(response => {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized', detail: 'server-private-fixture' }));
    });
    await writeSupportSession(home.dir);
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--yes', '--no-open'], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout) as SupportOutput;
    expect(output).toMatchObject({ ok: true, status: 'signed_out', url: `${server.origin}/support` });
    expect(server.requests).toHaveLength(1);
    expect(result.stdout + result.stderr).not.toContain('server-private-fixture');
    expect(result.stdout).not.toContain('#draft=');
  });

  test.each([400, 413, 429, 503])('returns a safe failure after HTTP %i without retrying or printing server content', async (status) => {
    const home = await environment();
    const server = await fixture(response => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'server-private-fixture', access_token: 'server-token-private-fixture' }));
    });
    await writeSupportSession(home.dir);
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--yes', '--no-open'], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(1);
    const output = JSON.parse(result.stdout) as SupportOutput;
    expect(output).toMatchObject({ ok: false, status: 'failed', error: { code: `http_${status}` } });
    expect(server.requests).toHaveLength(1);
    expect(result.stdout + result.stderr).not.toContain('server-private-fixture');
    expect(result.stdout + result.stderr).not.toContain('server-token-private-fixture');
    expect(result.stdout).not.toContain('#draft=');
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
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--yes', '--no-open'], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(1);
    const output = JSON.parse(result.stdout) as SupportOutput;
    expect(output).toMatchObject({ ok: false, status: 'failed', error: { code: 'invalid_response' } });
    expect(server.requests).toHaveLength(1);
    expect(result.stdout + result.stderr).not.toContain('private-fixture');
    expect(result.stdout).not.toContain('#draft=');
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
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--yes', '--no-open'], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(1);
    const output = JSON.parse(result.stdout) as SupportOutput;
    expect(output).toMatchObject({ ok: false, status: 'failed', error: { code: 'invalid_response' } });
    expect(server.requests).toHaveLength(1);
    expect(result.stdout + result.stderr).not.toContain('server-private-fixture');
  });

  test('refuses to follow website redirects or retry the draft create', async () => {
    const home = await environment();
    const server = await fixture((response, origin) => {
      response.writeHead(307, { location: `${origin}/redirect-target` });
      response.end();
    });
    await writeSupportSession(home.dir);
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--yes', '--no-open'], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, status: 'failed' });
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
  ])('rejects invalid report input %s before sending it', async (flag, value) => {
    const home = await environment();
    const server = await fixture();
    await writeSupportSession(home.dir);
    const result = await runSupportCli(home.dir, ['support', '--format', 'json', '--yes', '--no-open', flag, value], { EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, status: 'failed' });
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
    const output = JSON.parse(preview.stdout) as SupportOutput;
    expect(output.bundle?.cli).toMatchObject({
      command: 'eai types validate', exitCode: 1, errorCode: 'E001', reasonCode: 'not_in_eai_project',
    });
    expect(output.bundle?.occurredAt).toEqual(expect.any(String));
    expect(output.bundle?.error).toBe(findGuidanceByCodeOrReason('E001')!.title);
    const supportDirectory = join(home.dir, '.eai', 'support');
    const { readdir } = await import('node:fs/promises');
    const savedFiles = await readdir(supportDirectory);
    expect(savedFiles).toHaveLength(1);
    const saved = JSON.parse(await readFile(join(supportDirectory, savedFiles[0]), 'utf8'));
    expect(saved.command).toBe('eai types validate');
    expect(saved).not.toHaveProperty('message');
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
        command: 'eai verify', exitCode: 2, recordedAt: 'Oct 9 2026', message: diagnostic,
        ...(recognized ? { errorCode: 'E101', reasonCode: 'not_logged_in' } : {}),
      }), { mode: 0o600 });
    }
    const saved = JSON.parse(await readFile(cachePath, 'utf8')) as Record<string, unknown>;
    const server = await fixture();
    const result = await runSupportCli(projectB, [
      'support', '--format', format, '--no-open', ...(send ? ['--yes'] : []),
    ], { HOME: home.dir, USERPROFILE: home.dir, EAI_WEBSITE_URL: server.origin });
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.stdout).not.toContain('Provider returned');
    expect(server.requests).toHaveLength(send ? 1 : 0);
    const bundle = format === 'json'
      ? (JSON.parse(result.stdout) as SupportOutput).bundle!
      : JSON.parse(result.stdout.split('Redacted support report (review before sending):\n')[1]
        .split('\nShow this bundle to the person and ask for consent.')[0]) as Record<string, unknown>;
    expect(bundle.cli).toEqual({
      command: 'eai verify', exitCode: 2,
      ...(recognized ? { errorCode: 'E101', reasonCode: 'not_logged_in' } : {}),
    });
    expect(bundle.occurredAt).toBe(new Date(String(saved.recordedAt)).toISOString());
    if (recognized) expect(bundle.error).toBe(findGuidanceByCodeOrReason('E101')!.title);
    else expect(bundle.error).toBeUndefined();
    if (format === 'json') expect(JSON.parse(result.stdout)).toMatchObject({
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
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true, status: 'signed_out', url: 'https://www.enterpriseaigroup.com/support',
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
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, status: 'failed', error: { code: 'invalid_report' } });
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
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, status: 'signed_out', url: `${server.origin}/support` });
    expect(server.requests).toHaveLength(0);
  });
});
