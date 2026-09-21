import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, test, vi } from 'vitest';

const root = process.cwd();
const scriptPath = join(root, 'scripts', 'eai-full-e2e-smoke.cjs');
const cliPath = join(root, 'dist', 'index.js');
const { runOptionalDocumentSmoke, redact } = createRequire(import.meta.url)(scriptPath);

describe('opt-in document lifecycle caller (controlled, no network)', () => {
  const env = {
    EAI_E2E_DOCS: '1',
    EAI_E2E_DOCS_TENANT_ID: 'tenant-fixture',
    EAI_E2E_DOCS_VERTICAL_KEY: 'fixture-app',
    EAI_E2E_DOCS_WORKFLOW_KEY: 'fixture-workflow',
    EAI_E2E_DOCS_FILE: scriptPath,
    EAI_E2E_DOCS_EXPECTED_TYPE: 'fixture-type',
    EAI_E2E_DOCS_WAIT_MS: '5000',
    EAI_E2E_CLEANUP: '0',
  };
  const id = 'DOC/fixture';
  const jobId = 'job/fixture';
  const recordPath = `/v4/data/documents/records/${encodeURIComponent(id)}?storage_target=resourceapi&job_id=${encodeURIComponent(jobId)}`;
  const queued = { jobId, documents: [{ documentId: id }] };
  const job = {
    jobId, tenantId: env.EAI_E2E_DOCS_TENANT_ID, status: 'completed',
    documents: [{ documentId: id, storage: { status: 'completed' },
      classification: { status: 'completed', detectedType: 'fixture-type' }, rag: { status: 'skipped' } }],
  };
  const record = { documentId: id, resourceId: 'resource-fixture', storageTarget: 'resourceapi',
    processingStatus: 'complete', classification: { documentType: 'fixture-type' } };
  const receipt = { success: true, documentId: id, storageTarget: 'resourceapi', analysisCleanupComplete: true };
  const response = (body: unknown) => ({ status: 0, stdout: JSON.stringify({ ok: true, status: 200, body }), stderr: '' });
  const absent = { status: 1, stdout: JSON.stringify({ ok: false, status: 404 }), stderr: '' };
  function harness(responses: ReturnType<typeof response>[]) {
    let time = 0;
    const calls: string[][] = [];
    const eai = (args: string[], options: { allowFailure: boolean; timeout: number }) => {
      calls.push(args);
      expect(options.allowFailure).toBe(true);
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.timeout).toBeLessThanOrEqual(30000);
      expect(args.slice(args.indexOf('--tenant-id'), args.indexOf('--tenant-id') + 2)).toEqual(['--tenant-id', 'tenant-fixture']);
      expect(args.slice(args.indexOf('--format'), args.indexOf('--format') + 2)).toEqual(['--format', 'json']);
      const result = responses.shift();
      if (!result) throw new Error('Unexpected CLI call');
      return result;
    };
    return { calls, run: (config = env) => runOptionalDocumentSmoke(eai, config, {
      now: () => time, wait: (ms: number) => { time += ms; },
    }) };
  }

  test('disabled means no commands; prerequisites fail before submission', () => {
    const controlled = harness([]);
    expect(controlled.run({ ...env, EAI_E2E_DOCS: '0' })).toEqual({ skipped: true });
    for (const key of ['TENANT_ID', 'VERTICAL_KEY', 'WORKFLOW_KEY', 'FILE', 'EXPECTED_TYPE']) {
      expect(() => controlled.run({ ...env, [`EAI_E2E_DOCS_${key}`]: '' })).toThrow(`EAI_E2E_DOCS_${key}`);
    }
    for (const value of ['0', '-1', 'Infinity', '600001', '1.5']) {
      expect(() => controlled.run({ ...env, EAI_E2E_DOCS_WAIT_MS: value })).toThrow('EAI_E2E_DOCS_WAIT_MS');
    }
    expect(() => controlled.run({ ...env, EAI_E2E_DOCS_FILE: '/nonexistent-smoke-fixture' })).toThrow('does not exist');
    expect(controlled.calls).toEqual([]);
  });

  test('submits once with app/workflow context, polls same job, reads saved result, deletes and verifies despite general cleanup opt-out', () => {
    const controlled = harness([response(queued), response({ ...job, status: 'processing' }), response(job),
      response(record), response(receipt), absent]);
    expect(controlled.run()).toEqual({ jobId, documentIds: [id], cleanupVerified: true });
    expect(controlled.calls[0]).toEqual(['docs', 'classify', scriptPath, '--tenant-id', 'tenant-fixture',
      '--format', 'json', '--storage-target', 'resourceapi', '--vertical-key', 'fixture-app', '--workflow-key', 'fixture-workflow']);
    expect(controlled.calls.map((args) => args.slice(0, 3))).toEqual([
      ['docs', 'classify', scriptPath],
      ['publicapi', 'get', '/v4/data/documents/jobs/job%2Ffixture'],
      ['publicapi', 'get', '/v4/data/documents/jobs/job%2Ffixture'],
      ['publicapi', 'get', recordPath], ['publicapi', 'delete', recordPath], ['publicapi', 'get', recordPath],
    ]);
  });

  test('queue acceptance times out without resubmission and still cleans up', () => {
    const controlled = harness([response(queued), ...Array.from({ length: 3 }, () => response({ ...job, status: 'processing' })),
      response(receipt), absent]);
    expect(() => controlled.run()).toThrow('timed out after 5000ms');
    expect(controlled.calls.filter((args) => args[0] === 'docs')).toHaveLength(1);
    expect(controlled.calls.at(-2)?.slice(0, 3)).toEqual(['publicapi', 'delete', recordPath]);
  });

  test.each([
    ['failed', { ...job, status: 'failed' }, 'Document job failed'],
    ['partial failure', { ...job, status: 'completed_with_errors' }, 'Document job failed'],
    ['wrong tenant', { ...job, tenantId: 'other-tenant' }, 'identity or tenant mismatch'],
    ['wrong job', { ...job, jobId: 'other-job' }, 'identity or tenant mismatch'],
    ['wrong document', { ...job, documents: [{ ...job.documents[0], documentId: 'unowned' }] }, 'identity or tenant mismatch'],
    ['missing result', { ...job, documents: [{ ...job.documents[0], classification: { status: 'skipped' } }] }, 'missing the expected'],
  ])('rejects %s and only deletes submission-owned IDs', (_label, failedJob, message) => {
    const controlled = harness([response(queued), response(failedJob), response(receipt), absent]);
    expect(() => controlled.run()).toThrow(message);
    expect(controlled.calls.at(-2)?.slice(0, 3)).toEqual(['publicapi', 'delete', recordPath]);
  });

  test.each([
    { ...record, processingStatus: 'pending' },
    { ...record, documentId: 'other' },
    { ...record, classification: { documentType: 'wrong' } },
    { ...record, storageTarget: 'payload' },
  ])('requires persisted results, not just job completion: %j', (saved) => {
    const controlled = harness([response(queued), response(job), response(saved), response(receipt), absent]);
    expect(() => controlled.run()).toThrow('Persisted document');
    expect(controlled.calls.at(-2)?.[1]).toBe('delete');
  });

  test('missing IDs cannot silently pass or use generic id fields', () => {
    const controlled = harness([response({ id: 'not-a-document-id', jobId, documents: [] })]);
    expect(() => controlled.run()).toThrow(/IDs will not be inferred[\s\S]*Document leftovers/);
    expect(controlled.calls).toHaveLength(1);
  });

  test('missing job ID still cleans returned document using the optional-job contract', () => {
    const controlled = harness([response({ documents: queued.documents }), response(receipt), absent]);
    expect(() => controlled.run()).toThrow('explicit job ID');
    expect(controlled.calls[1][2]).toBe('/v4/data/documents/records/DOC%2Ffixture?storage_target=resourceapi');
  });

  test('cleanup failure preserves the original error and identifies leftovers', () => {
    const controlled = harness([response(queued), response({ ...job, status: 'failed' }),
      { status: 1, stdout: JSON.stringify({ ok: false, status: 403 }), stderr: '' }]);
    expect(() => controlled.run()).toThrow(/Document job failed[\s\S]*Document leftovers:[\s\S]*DOC\/fixture[\s\S]*job\/fixture/);
  });

  test.each([
    [response({ ...receipt, analysisCleanupComplete: false })],
    [response(receipt), response(record)],
    [response(receipt), { status: 1, stdout: JSON.stringify({ ok: false, status: 403 }), stderr: '' }],
  ])('cleanup requires complete receipt and verified absence', (...cleanupResponses) => {
    const controlled = harness([response(queued), response(job), response(record), ...cleanupResponses]);
    expect(() => controlled.run()).toThrow(/Document cleanup failed[\s\S]*Document leftovers/);
  });

  test('malformed polling output still triggers cleanup', () => {
    const controlled = harness([response(queued), { status: 1, stdout: 'not JSON', stderr: '' }, response(receipt), absent]);
    expect(() => controlled.run()).toThrow();
    expect(controlled.calls.at(-2)?.[1]).toBe('delete');
  });
});

describe('full e2e smoke traceability', () => {
  test('covers every public CLI leaf command from --describe', () => {
    const output = execFileSync(process.execPath, [
      scriptPath,
      '--check',
      '--cli',
      cliPath,
    ], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(output).toContain('Full e2e traceability covers');
    expect(output).toContain('CLI leaf commands');
  });

  test('generated plan documents option-level and alias coverage', () => {
    const output = execFileSync(process.execPath, [
      scriptPath,
      '--plan',
      '--cli',
      cliPath,
    ], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(output).toContain('Smoke calls / options');
    expect(output).toContain('Deferred options');
    expect(output).toContain('`eai vertical list`');
    expect(output).toContain('EAI_E2E_DOCS_EXPECTED_TYPE');
    expect(output).toContain('storage_target=resourceapi');
    expect(output).not.toContain('EAI_E2E_DOCS=1 eai docs upload');
    expect(output).not.toContain('EAI_E2E_DOCS=1 eai docs index');
  });

  test('redacts password-like values without executing live auth preflight', () => {
    const secret = 'super-secret-e2e-password';
    vi.stubEnv('EAI_E2E_TEST_PASSWORD', secret);
    try {
      const output = redact(`test profile is not authenticated: ${secret}`);
      expect(output).toContain('test profile is not authenticated');
      expect(output).toContain('[redacted]');
      expect(output).not.toContain(secret);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test('resource update smoke uses full replacement payloads for required fields', () => {
    const source = readFileSync(scriptPath, 'utf8');

    expect(source).toContain("title: 'postgres smoke updated'");
    expect(source).toContain("title: 'documentdb smoke updated'");
    expect(source).toContain('`batch smoke ${index + 1} updated`');
    expect(source).toContain("function: 'count'");
    expect(source).toContain('batchCreate.results');
  });

  test('live smoke executes opt-in invite, negative, and child cleanup paths', () => {
    const source = readFileSync(scriptPath, 'utf8');

    expect(source).toContain('EAI_E2E_INVITE_TEST_USER');
    expect(source).toContain("'user',");
    expect(source).toContain("'invite',");
    expect(source).toContain("'--role',");
    expect(source).toContain('EAI_E2E_NEGATIVE_TESTS');
    expect(source).toContain('expectEaiFailure');
    expect(source).toContain('tenant');
    expect(source).toContain('bootstrap-admin');
    expect(source).toContain('tenant');
    expect(source).toContain('delete');
  });
});
