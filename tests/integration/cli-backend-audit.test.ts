import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { buildAudit } = require('../../scripts/audit-cli-backend.cjs');
const qa = require('../../scripts/cli-qa-foundation.cjs');
const schema = { command: 'eai', subcommands: [
  { command: 'verify', hasAction: true, subcommands: [{ command: 'calls' }] },
  { command: 'workspace', aliases: ['tenant'], subcommands: [{ command: 'list' }] },
  { command: 'types', subcommands: [{ command: 'define' }] },
] };
const commands = ['eai verify', 'eai verify calls', 'eai workspace list', 'eai types define'];
const decisions = commands.map(command => ({ command, crud: 'read', coverage: 'live', notes: 'fixture', cleanupMechanism: 'none', cleanupVerified: 'read only' }));
const candidate = { gitSha: 'candidate-sha', binarySha256: 'entry-sha', runtimeSha256: 'runtime-sha', version: '3.19.1' };

describe('CLI backend audit evidence', () => {
  test('inventories executable parents and alias paths, without treating the plan as proof', () => {
    const report = buildAudit({ schema, candidate }, decisions);
    expect(report.commands.map((row: { command: string }) => row.command)).toContain('eai verify');
    expect(report.commands.find((row: { command: string }) => row.command === 'eai workspace list').aliases).toContain('eai tenant list');
    expect(report.summary).toEqual({ passed: 0, failed: 0, blocked: 0, unsupported: 1, 'not-run': 3 });
    expect(report.backendCertified).toBe(false);
  });
  test('keeps index apply unsupported even when supplied evidence claims a success', () => {
    const indexSchema = { command: 'eai', subcommands: [{ command: 'resources', subcommands: [{ command: 'indexes-apply' }] }] };
    const indexDecisions = [{ command: 'eai resources indexes-apply', crud: 'create/update', coverage: 'unsupported', notes: 'No public apply contract.' }];
    const evidence = { candidate, commands: [{ command: 'eai resources indexes-apply', status: 'passed' }] };
    const report = buildAudit({ schema: indexSchema, candidate, evidence }, indexDecisions);
    expect(report.commands[0]).toMatchObject({
      status: 'unsupported', reason: expect.stringContaining('no public index-apply contract'),
    });
    expect(report.summary.passed).toBe(0);
  });
  test('rejects new commands with no explicit coverage decision', () => {
    expect(() => buildAudit({ schema, candidate }, decisions.slice(1))).toThrow('eai verify');
  });
  test('never passes unfinished executions and does not reuse another candidate evidence', () => {
    const evidence = { candidate, commands: [{ command: 'eai verify', status: 'running' }] };
    expect(buildAudit({ schema, candidate, evidence }, decisions).summary.passed).toBe(0);
    expect(() => buildAudit({ schema, candidate, evidence: { ...evidence, candidate: { ...candidate, binarySha256: 'other-build' } } }, decisions)).toThrow('exact CLI candidate');
    expect(() => buildAudit({ schema, candidate, evidence: { ...evidence, candidate: { ...candidate, runtimeSha256: 'other-libraries' } } }, decisions)).toThrow('exact CLI candidate');
  });
  test('does not pass a partial command contract even when its executed subset passed', () => {
    const evidence = { candidate, commands: [{ command: 'eai verify', status: 'passed', coverageComplete: false }] };
    expect(buildAudit({ schema, candidate, evidence }, decisions).summary.passed).toBe(0);
    const incomplete = { ...evidence, commands: [{ command: 'eai verify', status: 'incomplete' }] };
    expect(buildAudit({ schema, candidate, evidence: incomplete }, decisions).summary.passed).toBe(0);
  });
  test('requires exact deployed source parity and independent authorization evidence', () => {
    const evidence = { candidate, cleanupVerified: true, commands: commands.map(command => ({ command, status: 'passed' })) };
    const deployments = [{ mainSha: 'main', observedSha: 'older', parity: 'main' }];
    const report = buildAudit({ schema, candidate, evidence, deployments }, decisions);
    expect(report.parityComplete).toBe(false);
    expect(report.authorizationVerified).toBe(false);
    expect(report.backendCertified).toBe(false);
  });

  function completeContractModel() {
    // This models operator DTO validation, not an executed live capability receipt.
    const now = Date.now(), observedAt = new Date(now).toISOString(), publicApiUrl = 'https://dev-api.au.myenterprise.ai/public';
    const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
    const candidate = { gitSha: 'a'.repeat(40), binarySha256: 'b'.repeat(64), runtimeSha256: 'c'.repeat(64),
      version: '3.19.2', runtimeFileCount: 200, dirty: false };
    const actors = Object.fromEntries(Object.keys(qa.SLOTS).map((slot, index) => [slot, { oid: id(index + 1), profile: 'qa-' + slot }]));
    const tenantIds = { a: id(20), b: id(21) };
    const authorizationEvidence = { schemaVersion: 'eai.cli-authorization-evidence.v1', fixtureId: id(30),
      status: 'passed', qualification: 'normal-cli-profiles', qualified: true, environment: 'DEV', publicApiUrl,
      candidate, actors, tenantIds, foundationVerified: true, cleanupVerified: true, completedAt: observedAt,
      cases: qa.ROLE_CASES.map((name: string) => { const slot = name.split(':')[0], workspace = qa.SLOTS[slot][0];
        return { name, actorId: actors[slot].oid, profile: actors[slot].profile, status: 'passed',
          scopeTenantId: tenantIds[name.endsWith(':sibling-denied') ? (workspace === 'a' ? 'b' : 'a') : workspace as 'a' | 'b'],
          httpStatus: name.endsWith('-denied') ? 403 : 200 }; }) };
    const deployments = qa.SERVICES.map((service: string) => service === 'CIAM' ? { service, environment: 'DEV', publicApiUrl, observedAt,
      source: 'oidc-discovery', sourceReference: `https://qa.ciamlogin.com/${id(40)}/v2.0/.well-known/openid-configuration`,
      identity: { tenantId: id(40), clientId: id(41), verified: true, issuer: `https://qa.ciamlogin.com/${id(40)}/v2.0`,
        discoveryUrl: `https://qa.ciamlogin.com/${id(40)}/v2.0/.well-known/openid-configuration` } }
      : { service, environment: 'DEV', publicApiUrl, observedAt, mainObservedAt: observedAt, parity: 'main',
        mainSha: 'd'.repeat(40), observedSha: 'd'.repeat(40), source: 'image-label', sourceReference: 'https://example.invalid/revision/' + service,
        runtime: { sourceSha: 'd'.repeat(40), active: true, ready: true, revision: 'selected-revision', artifactDigest: 'sha256:' + 'e'.repeat(64) },
        selectedRelease: { sourceSha: 'd'.repeat(40), configured: true, status: 'succeeded', kind: 'container',
          deploymentId: 'selected-deployment', artifactDigest: 'sha256:' + 'e'.repeat(64) } });
    const buildReceipt = { schemaVersion: 'eai.cli-source-build.v1', status: 'passed', qualification: 'normal-build', qualified: true,
      candidate, sourceSha: candidate.gitSha, sourceSha256: 'f'.repeat(64), sourceFileCount: 1000,
      sourceFingerprintVersion: 'eai.cli-tracked-source-sha256.v1', sourceUnchanged: true, command: ['npm', 'run', 'build'],
      exitCode: 0, nodeVersion: 'v24.12.0', observedAt };
    const schema = { command: 'eai', subcommands: [{ command: 'workspace', aliases: ['tenant'],
      subcommands: [{ command: 'list', options: [{ name: '--format' }, { name: '--workspace,' }] }] }] };
    const decisions = [{ command: 'eai workspace list', crud: 'read', coverage: 'live', notes: 'fixture' }];
    const evidence = { candidate, environment: 'DEV', expectedPublicApi: publicApiUrl, cleanupVerified: true, authorizationEvidence,
      commands: [{ command: 'eai workspace list', status: 'passed', coverageComplete: true, assertions: ['exact inventory'], options: ['--format', '--workspace'] }],
      aliases: [{ alias: 'eai tenant list', command: 'eai workspace list', status: 'passed', coverageComplete: true, assertions: ['exact alias inventory'] }] };
    return { input: { schema, candidate, evidence, buildReceipt, deployments, now }, decisions };
  }

  test('joins build, role, selected deployment and normalized option contracts without claiming missing cycles', () => {
    const { input, decisions } = completeContractModel(), report = buildAudit(input, decisions);
    expect(report.candidateVerified).toBe(true); expect(report.parityComplete).toBe(true); expect(report.authorizationVerified).toBe(true);
    expect(report.optionCoverageComplete).toBe(true); expect(report.aliasCoverageComplete).toBe(true); expect(report.backendCertified).toBe(true);
    expect(report.fullCapabilityQualified).toBe(false);
  });

  test.each(['build', 'dirty', 'untracked-status', 'body-only-pass', 'assertions', 'option', 'actor', 'role-age', 'not-ready', 'workflow-head'])('%s cannot certify a backend', reason => {
    const { input, decisions } = completeContractModel();
    if (reason === 'build') input.buildReceipt.qualification = 'controlled-fixtures';
    if (reason === 'dirty') input.candidate.dirty = true;
    if (reason === 'untracked-status') Object.assign(input.candidate, { dirty: null });
    if (reason === 'body-only-pass') input.evidence.commands[0].coverageComplete = false;
    if (reason === 'assertions') input.evidence.commands[0].assertions = [];
    if (reason === 'option') input.evidence.commands[0].options = ['--format'];
    if (reason === 'actor') input.evidence.authorizationEvidence.cases[0].actorId = 'unrelated';
    if (reason === 'role-age') input.evidence.authorizationEvidence.completedAt = new Date(input.now - 3600001).toISOString();
    if (reason === 'not-ready') input.deployments[0].runtime.ready = false;
    if (reason === 'workflow-head') input.deployments[0].source = 'workflow-head';
    expect(buildAudit(input, decisions).backendCertified).toBe(false);
  });
  test.each(['failed', 'blocked', 'running'])('later successful alias receipts preserve an earlier %s observation', status => {
    const { input, decisions } = completeContractModel();
    input.evidence.aliases.unshift({ ...input.evidence.aliases[0], status });
    const report = buildAudit(input, decisions);
    expect(report.aliasCoverageComplete).toBe(false);
    expect(report.aliasEvidence[0].status).toBe(status === 'running' ? 'not-run' : status);
  });
});

describe('local dedicated tenant harness ownership', () => {
  const directories: string[] = [];
  afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

  function runFixture(mode: 'quota' | 'unrelated-create', api = 'http://localhost:8000') {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'eai-local-harness-test-')));
    directories.push(root);
    const bin = join(root, 'bin'); mkdirSync(bin, { mode: 0o700 });
    const profileRoot = join(root, '.eai'); mkdirSync(profileRoot, { mode: 0o700 });
    writeFileSync(join(profileRoot, 'config.json'), JSON.stringify({ profiles: { local: {
      publicApiUrl: 'http://localhost:8000', authTenantName: 'fixture', authTenantId: 'fixture', authClientId: 'fixture',
    } } }), { mode: 0o600 });
    const log = join(root, 'commands.jsonl');
    const mock = join(root, 'mock.cjs');
    writeFileSync(mock, `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.EAI_HARNESS_TEST_LOG, JSON.stringify(args) + '\\n');
if (args.includes('list')) {
  console.log(JSON.stringify({tenants:[{id:'parent-fixture',slug:'parent'},{id:'unrelated-fixture',slug:'coworker-workspace'}]}));
} else if (args.includes('create')) {
  if (process.env.EAI_HARNESS_TEST_MODE === 'quota') { console.error('TENANT_QUOTA_EXCEEDED'); process.exit(1); }
} else { console.error('Unexpected tenant/storage mutation'); process.exit(75); }
`);
    writeFileSync(join(bin, 'node'), `#!/usr/bin/env bash\nif [[ "\${1:-}" == */dist/index.js ]]; then exec '${process.execPath}' '${mock}' "$@"; fi\nexec '${process.execPath}' "$@"\n`, { mode: 0o700 });
    writeFileSync(join(bin, 'npm'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o700 });
    writeFileSync(join(bin, 'docker'), '#!/usr/bin/env bash\nif [[ "$*" == *SEARCH_DEFAULT_API_KEY* ]]; then echo fixture-search-key; exit 0; fi\nexit 77\n', { mode: 0o700 });
    const result = spawnSync('bash', [resolve('scripts/test-local-dedicated-tenant-lifecycle.sh')], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, HOME: root, USERPROFILE: root, PATH: `${bin}:${process.env.PATH}`,
        EAI_E2E_PROFILE: 'local', EAI_E2E_PUBLIC_API_URL: api, EAI_E2E_PARENT_TENANT_ID: 'parent-fixture',
        EAI_HARNESS_TEST_LOG: log, EAI_HARNESS_TEST_MODE: mode },
    });
    let calls: string[][] = [];
    try { calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { /* blocked before CLI calls */ }
    return { ...result, calls };
  }

  test('quota exhaustion never deletes other visible tenants or retries creation', () => {
    const result = runFixture('quota');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('TENANT_QUOTA_EXCEEDED');
    expect(result.calls.filter(args => args.includes('create'))).toHaveLength(1);
    expect(result.calls.filter(args => args.includes('delete'))).toHaveLength(0);
  });
  test('a concurrent unrelated workspace is never accepted as the run-owned child', () => {
    const result = runFixture('unrelated-create');
    expect(result.status).not.toBe(0);
    expect(result.calls.filter(args => args.includes('select') || args.includes('delete'))).toHaveLength(0);
  });
  test('rejects a deployed API before Docker or CLI mutation', () => {
    const result = runFixture('quota', 'https://dev-api.au.myenterprise.ai/public');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('HTTP loopback');
    expect(result.calls).toHaveLength(0);
  });
});
