import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';

const cliEntry = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const contextModule = new URL('../../dist/lib/support-context.js', import.meta.url).href;
const errorModule = new URL('../../dist/lib/error-codes.js', import.meta.url).href;
const outputModule = new URL('../../dist/lib/output.js', import.meta.url).href;

describe('support context from failing commands', () => {
  let environment: TestEnvironment;

  beforeEach(async () => { environment = await createTestEnvironment(); });
  afterEach(async () => { await environment.cleanup(); });

  function run(args: string[], extraEnv: Record<string, string> = {}): ReturnType<typeof spawnSync> {
    return spawnSync(process.execPath, args, {
      cwd: environment.dir,
      env: {
        ...process.env,
        HOME: environment.dir,
        USERPROFILE: environment.dir,
        EAI_ACCESS_TOKEN: '',
        EAI_PROFILE: '',
        EAI_NO_UPDATE_CHECK: '1',
        ...extraEnv,
      },
      encoding: 'utf8',
      timeout: 10000,
    });
  }

  function contextPath(profile = 'default'): string {
    const profileHash = createHash('sha256').update(profile).digest('hex').slice(0, 16);
    return join(environment.dir, '.eai', 'support', `last-error-${profileHash}.json`);
  }

  async function readContext(profile?: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(contextPath(profile), 'utf8')) as Record<string, unknown>;
  }

  test('a direct process.exit error offers support and stores only command names', async () => {
    const result = run([cliEntry, 'whoami']);

    expect(result.status).toBe(1);
    expect(String(result.stderr)).toContain('Run eai support to prepare a report for your approval.');
    expect(await readContext()).toMatchObject({
      command: 'eai whoami', exitCode: 1, errorCode: 'E101', reasonCode: 'not_logged_in',
    });
    expect((await stat(contextPath())).mode & 0o777).toBe(0o600);
  });

  test('structured catalog errors retain code and reason and locally redact credentials', async () => {
    const secret = 'fixture-env-credential-for-context';
    const script = `
      import { installSupportErrorTracking, setSupportCommand } from ${JSON.stringify(contextModule)};
      import { exitWithError, ErrorCode } from ${JSON.stringify(errorModule)};
      installSupportErrorTracking();
      setSupportCommand('eai types seed');
      exitWithError(ErrorCode.E001, { token: process.env.EAI_ACCESS_TOKEN }, 'json');
    `;
    const result = run(['--input-type=module', '-e', script], { EAI_ACCESS_TOKEN: secret });

    expect(result.status).toBe(1);
    const context = await readContext();
    expect(context).toMatchObject({
      command: 'eai types seed', errorCode: 'E001', reasonCode: 'not_in_eai_project', exitCode: 1,
    });
    expect(JSON.stringify(context)).not.toContain(secret);
    expect(String(result.stderr)).not.toContain(secret);
  });

  test('JSON output errors use catalog guidance without changing the output envelope', async () => {
    const secret = 'fixture-opaque-token-value';
    const script = `
      import { installSupportErrorTracking, setSupportCommand } from ${JSON.stringify(contextModule)};
      import { json } from ${JSON.stringify(outputModule)};
      installSupportErrorTracking();
      setSupportCommand('eai resources create');
      json({ ok: false, error: { message: process.env.EAI_ACCESS_TOKEN }, guidance: { code: 'E101', reasonCode: 'not_logged_in' } });
      process.exitCode = 1;
    `;
    const result = run(['--input-type=module', '-e', script], { EAI_ACCESS_TOKEN: secret });

    expect(result.status).toBe(1);
    expect(JSON.parse(String(result.stdout))).toMatchObject({ ok: false, guidance: { code: 'E101' } });
    expect(await readContext()).toMatchObject({
      command: 'eai resources create', errorCode: 'E101', reasonCode: 'not_logged_in',
    });
    expect(JSON.stringify(await readContext())).not.toContain(secret);
  });

  test('stderr guidance and errors without output are captured on nonzero exits', async () => {
    const script = `
      import { installSupportErrorTracking, setSupportCommand } from ${JSON.stringify(contextModule)};
      installSupportErrorTracking();
      setSupportCommand('eai provision entra');
      console.error('Bearer fixture-raw-secret Error code: E242\\nReason: tenant_authorization_incomplete');
      process.exit(2);
    `;
    const result = run(['--input-type=module', '-e', script]);

    expect(result.status).toBe(2);
    expect(await readContext()).toMatchObject({
      command: 'eai provision entra', errorCode: 'E242', reasonCode: 'tenant_authorization_incomplete', exitCode: 2,
    });
    expect(JSON.stringify(await readContext())).not.toContain('fixture-raw-secret');
  });

  test('credentials split over stderr writes are redacted before persistence', async () => {
    const script = `
      import { installSupportErrorTracking, setSupportCommand } from ${JSON.stringify(contextModule)};
      installSupportErrorTracking(); setSupportCommand('eai provision entra');
      process.stderr.write('Authorization: Bea');
      process.stderr.write('rer fixture-split-bearer-value');
      process.stderr.write('\\nclientSecret=fixture-split-');
      process.stderr.write('password-value');
      process.exit(1);
    `;
    const result = run(['--input-type=module', '-e', script]);

    expect(result.status).toBe(1);
    const saved = JSON.stringify(await readContext());
    expect(saved).not.toContain('fixture-split-bearer-value');
    expect(saved).not.toContain('password-value');
    expect(saved).toContain('[redacted]');
  });

  test('fragmented structured stderr errors keep one parseable document with the support offer', async () => {
    const script = `
      import { installSupportErrorTracking, setSupportCommand } from ${JSON.stringify(contextModule)};
      import { formatErrorJSON, ErrorCode } from ${JSON.stringify(errorModule)};
      installSupportErrorTracking(); setSupportCommand('eai blocks describe');
      const document = JSON.stringify(formatErrorJSON(ErrorCode.E305));
      process.stderr.write(document.slice(0, 30));
      process.stderr.write(document.slice(30));
      process.exit(1);
    `;
    const result = run(['--input-type=module', '-e', script]);

    expect(result.status).toBe(1);
    const payload = JSON.parse(String(result.stderr));
    expect(payload.error).toMatchObject({ code: 'E305', exitCode: 1 });
    expect(payload.error.suggestion).toContain('Run eai support');
    expect(Object.keys(payload)).toEqual(['error']);
    expect(Object.keys(payload.error).sort()).toEqual(['code', 'exitCode', 'message', 'suggestion']);
  });

  test.each([
    { error: { code: 'DENIED', message: 'Bearer fixture-response-secret', suggestion: 'Ask an admin.' }, requestId: 'request-fixture' },
    { error: 'DENIED', detail: 'clientSecret=fixture-response-secret', requestId: 'request-fixture' },
    { code: 'DENIED', message: 'Bearer fixture-response-secret', requestId: 'request-fixture' },
  ])('raw workspace JSON failures preserve their fields and show support without leaking credentials', async (body) => {
    const script = `
      import { installSupportErrorTracking, setSupportCommand, formatSupportErrorBody } from ${JSON.stringify(contextModule)};
      installSupportErrorTracking(); setSupportCommand('eai workspace create');
      process.stderr.write(formatSupportErrorBody(${JSON.stringify(JSON.stringify(body))}));
      process.exit(1);
    `;
    const result = run(['--input-type=module', '-e', script]);

    expect(result.status).toBe(1);
    const payload = JSON.parse(String(result.stderr));
    expect(payload.requestId).toBe('request-fixture');
    expect(payload.error?.code ?? payload.error ?? payload.code).toBe('DENIED');
    expect(payload.error?.suggestion ?? payload.suggestion).toContain('Run eai support');
    expect(String(result.stderr)).not.toContain('fixture-response-secret');
  });

  test('support, error explanations and successful commands preserve the original failure', async () => {
    const original = { command: 'eai types seed', exitCode: 1, errorCode: 'E001', recordedAt: new Date().toISOString() };
    await mkdir(join(environment.dir, '.eai', 'support'), { recursive: true });
    await writeFile(contextPath(), JSON.stringify(original), { mode: 0o600 });

    const explanation = run([cliEntry, 'errors', 'explain', 'unknown-entry', '--format', 'json']);
    expect(explanation.status).toBe(1);
    expect(await readContext()).toEqual(original);

    const explanationParseFailure = run([cliEntry, 'errors', 'explain', '--unknown-option']);
    expect(explanationParseFailure.status).toBe(1);
    expect(await readContext()).toEqual(original);

    const supportParseFailure = run([cliEntry, 'support', '--unknown-option']);
    expect(supportParseFailure.status).toBe(1);
    expect(await readContext()).toEqual(original);

    const supportFailure = run(['--input-type=module', '-e', `
      import { installSupportErrorTracking, setSupportCommand } from ${JSON.stringify(contextModule)};
      installSupportErrorTracking(); setSupportCommand('eai support'); process.exit(1);
    `]);
    expect(supportFailure.status).toBe(1);
    expect(await readContext()).toEqual(original);

    const success = run([cliEntry, 'errors', 'list', '--format', 'json']);
    expect(success.status).toBe(0);
    expect(await readContext()).toEqual(original);
  });

  test('contexts are isolated by profile and writes leave no temporary files', async () => {
    const defaultResult = run([cliEntry, 'whoami']);
    const privateResult = run([cliEntry, '--profile', 'private', 'whoami']);

    expect(defaultResult.status).toBe(1);
    expect(privateResult.status).toBe(1);
    expect(await readContext('default')).toMatchObject({ command: 'eai whoami' });
    expect(await readContext('private')).toMatchObject({ command: 'eai whoami' });
    expect(await readdir(join(environment.dir, '.eai', 'support'))).toHaveLength(2);
  });

  test('Commander failures also offer support without recording raw option values', async () => {
    const result = run([cliEntry, 'whoami', '--password=fixture-not-for-report']);

    expect(result.status).toBe(1);
    expect(String(result.stderr)).toContain('Run eai support');
    expect(JSON.stringify(await readContext())).not.toContain('fixture-not-for-report');
  });

  test('parse failures store the matched command in the selected profile', async () => {
    const result = run([cliEntry, '--profile', 'private', 'whoami', '--unknown-option']);

    expect(result.status).toBe(1);
    expect(await readContext('private')).toMatchObject({ command: 'eai whoami' });
    expect(await readdir(join(environment.dir, '.eai', 'support'))).toHaveLength(1);
  });

  test('saved dates become contract-safe ISO values and unrelated cached fields are dropped', async () => {
    await mkdir(join(environment.dir, '.eai', 'support'), { recursive: true });
    await writeFile(contextPath(), JSON.stringify({
      command: 'eai types validate', exitCode: 1, errorCode: 'E001',
      recordedAt: 'Oct 9 2026', accessToken: 'fixture-not-in-context',
      message: 'Bearer fixture-stored-bearer',
    }));
    const result = run(['--input-type=module', '-e', `
      import { readSupportContext } from ${JSON.stringify(contextModule)};
      console.log(JSON.stringify(readSupportContext()));
    `]);

    expect(result.status).toBe(0);
    expect(JSON.parse(String(result.stdout))).toMatchObject({
      command: 'eai types validate', recordedAt: new Date('Oct 9 2026').toISOString(),
      errorCode: 'E001', reasonCode: 'not_in_eai_project',
    });
    expect(String(result.stdout)).not.toContain('fixture-not-in-context');
    expect(String(result.stdout)).not.toContain('fixture-stored-bearer');
  });
});
