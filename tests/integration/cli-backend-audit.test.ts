import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { cycleOwnershipModel, cycleStepModel } from '../helpers/cli-qa-cycle-model.js';
import { buildCreateResourceOutput } from '../../src/commands/resources.js';

const require = createRequire(import.meta.url);
const { buildAudit, markdown } = require('../../scripts/audit-cli-backend.cjs');
const qa = require('../../scripts/cli-qa-foundation.cjs');
const canonicalExecutionModel = { ...require('../../scripts/cli-qa-build-receipt.cjs').canonicalBuildExecution(),
  exitCode: 0, executablesUnchanged: true };
const selectedGit = require('../../scripts/cli-qa-operational-env.cjs').installedGitExecution();
const gitExecutionModel = { ...selectedGit, executablesUnchanged: true, invocations: [
  ['rev-parse', '--show-toplevel'], ['rev-parse', '--verify', 'HEAD'], ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
  ['ls-files', '--stage', '-z']].map(args => [selectedGit.gitPath, ...args]) };
const schema = { command: 'eai', subcommands: [
  { command: 'verify', hasAction: true, subcommands: [{ command: 'calls' }] },
  { command: 'workspace', aliases: ['tenant'], subcommands: [{ command: 'list' }] },
  { command: 'types', subcommands: [{ command: 'define' }] },
] };
const commands = ['eai verify', 'eai verify calls', 'eai workspace list', 'eai types define'];
const decisions = commands.map(command => ({ command, crud: 'read', coverage: 'live', notes: 'fixture', cleanupMechanism: 'none', cleanupVerified: 'read only' }));
const candidate = { gitSha: 'a'.repeat(40), binarySha256: 'b'.repeat(64), runtimeSha256: 'c'.repeat(64),
  version: '3.19.1', runtimeFileCount: 200, dirty: false };
interface AuditAssertion { name: string; command: string; executionId: string; status: string; option?: string; alias?: string;
  environment?: string; publicApiUrl?: string; scopeTenantId?: string }

describe('CLI backend audit evidence', () => {
  test.each([
    { note: 'permission required', encoded: 'permission required' },
    { note: String.raw`C:\qa\|first | second`, encoded: String.raw`C:\\qa\\\|first \| second` },
    { note: String.raw`one\|two\\|three\end`, encoded: String.raw`one\\\|two\\\\\|three\\end` },
  ])('keeps prerequisite $note inside its original GFM table cell', ({ note, encoded }) => {
    const report = buildAudit({ schema, candidate }, decisions.map(row => ({ ...row, notes: note })));
    const rendered = markdown(report);
    const row = rendered.split('\n').find((line: string) => line.startsWith('| eai verify |'));
    expect(row).toBe(`| eai verify |  | read | not-run | PublicAPI, Authz, ResourceAPI, AICore | ${encoded} |`);
  });

  test('inventories executable parents and alias paths, without treating the plan as proof', () => {
    const report = buildAudit({ schema, candidate }, decisions);
    expect(report.commands.map((row: { command: string }) => row.command)).toContain('eai verify');
    expect(report.commands.find((row: { command: string }) => row.command === 'eai workspace list').aliases).toContain('eai tenant list');
    expect(report.summary).toEqual({ passed: 0, failed: 0, blocked: 0, incomplete: 0, unsupported: 1, 'not-run': 3 });
    expect(report.backendCertified).toBe(false);
  });
  test('keeps index apply unsupported even when supplied evidence claims a success', () => {
    const indexSchema = { command: 'eai', subcommands: [{ command: 'resources', subcommands: [{ command: 'indexes-apply' }] }] };
    const indexDecisions = [{ command: 'eai resources indexes-apply', crud: 'create/update', coverage: 'unsupported', notes: 'No public apply contract.' }];
    const evidence = { candidate, commands: [{ command: 'eai resources indexes-apply', status: 'passed' }] };
    const report = buildAudit({ schema: indexSchema, candidate, evidence }, indexDecisions);
    expect(report.commands[0]).toMatchObject({
      capability: 'unsupported', status: 'incomplete', actualExecutionStatus: 'incomplete',
      reason: expect.stringContaining('no public index-apply contract'),
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
  test.each(['running', 'incomplete'])('retains attempted %s observations separately from commands never run', status => {
    const evidence = { candidate, commands: [{ command: 'eai verify', status }] };
    const report = buildAudit({ schema, candidate, evidence }, decisions);
    expect(report.commands.find((row: { command: string }) => row.command === 'eai verify').status).toBe('incomplete');
    expect(report.commands.find((row: { command: string }) => row.command === 'eai verify calls').status).toBe('not-run');
    expect(report.summary.incomplete).toBe(1); expect(report.summary['not-run']).toBe(2);
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
    const runId = id(31), objectType = 'cli-qa-authorization-row';
    const created = ['adminA', 'builderA', 'adminB', 'builderB'].map((creatorSlot, index) => ({
      creatorSlot, creatorId: actors[creatorSlot].oid, tenantId: tenantIds[qa.SLOTS[creatorSlot][0] as 'a' | 'b'], resourceId: id(60 + index),
      nonce: `cli-qa-${runId}-${creatorSlot}-${id(80 + index)}`, idempotencyKey: id(70 + index),
      phase: 'absent', creationDispatched: true, acknowledgedBound: true, version: 1,
    }));
    const authorizationEvidence = { schemaVersion: 'eai.cli-authorization-evidence.v1', fixtureId: id(30), foundationParentTenantId: id(19), runId,
      status: 'passed', qualification: 'normal-cli-profiles', qualified: true, environment: 'DEV', publicApiUrl,
      candidate, actors, tenantIds, foundationVerified: true, cleanupVerified: true, localCleanupVerified: true, completedAt: observedAt,
      workspaceBindings: { a: { tenantId: tenantIds.a, parentTenantId: id(19) }, b: { tenantId: tenantIds.b, parentTenantId: id(19) } },
      publishedFixture: ['a', 'b'].map((slot, index) => ({ tenantId: tenantIds[slot as 'a' | 'b'],
        definitionId: id(40 + index), objectType, nonceField: 'qaNonce', schemaVersion: 1,
        publicationStatus: 'published', propertyFingerprintSha256: 'a'.repeat(64) })),
      created, cleanup: created.map(row => ({ creatorSlot: row.creatorSlot, tenantId: row.tenantId, resourceId: row.resourceId,
        profile: actors[qa.SLOTS[row.creatorSlot][0] === 'a' ? 'adminA' : 'adminB'].profile,
        status: 'passed', deleteAcknowledged: true, absenceVerified: true, deleteHttpStatus: 200, absenceHttpStatus: 404,
        deleteReceipt: { exitCode: 0, ok: true, status: 200,
          request: { method: 'DELETE', path: `/v4/data/resources/${row.tenantId}/${objectType}/${row.resourceId}`,
            tenantId: row.tenantId, publicApiUrl },
          body: { id: row.resourceId, deleted: true, deleted_at: observedAt } },
        absenceReceipt: { exitCode: 1, ok: false, status: 404,
          request: { method: 'GET', path: `/v4/data/resources/${row.tenantId}/${objectType}/${row.resourceId}`,
            tenantId: row.tenantId, publicApiUrl } } })), leftovers: [],
      cases: qa.ROLE_CASES.map((name: string) => { const slot = name.split(':')[0], workspace = qa.SLOTS[slot][0];
        const creator = name.endsWith(':sibling-denied') ? (workspace === 'a' ? 'adminB' : 'adminA')
          : slot === 'viewerA' ? 'adminA' : slot;
        return { name, actorId: actors[slot].oid, profile: actors[slot].profile, status: 'passed',
          resourceId: created.find(row => row.creatorSlot === creator)!.resourceId,
          scopeTenantId: tenantIds[name.endsWith(':sibling-denied') ? (workspace === 'a' ? 'b' : 'a') : workspace as 'a' | 'b'],
          httpStatus: name.endsWith('-denied') ? 403 : name.endsWith(':write') ? 201 : 200 }; }) };
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
      exitCode: 0, nodeVersion: process.version, observedAt, canonicalExecution: canonicalExecutionModel, gitExecution: gitExecutionModel,
      npmConfiguration: { user: 'empty-private', global: 'empty-private', project: 'absent', lifecycleNode: 'active-node-bin-first' } };
    const schema = { command: 'eai', subcommands: [{ command: 'workspace', aliases: ['tenant'],
      subcommands: [{ command: 'list', options: [{ name: '--format' }, { name: '--workspace,' }] }] }] };
    const decisions = [{ command: 'eai workspace list', crud: 'read', coverage: 'live', notes: 'fixture' }];
    const executionId = id(90), aliasExecutionId = id(91);
    const scope = { environment: 'DEV', publicApiUrl, scopeTenantId: tenantIds.a };
    const assertions: AuditAssertion[] = [
      { name: 'exact inventory', command: 'eai workspace list', executionId, status: 'passed', ...scope },
      ...['--format', '--workspace'].map(option => ({ name: 'verified ' + option, command: 'eai workspace list', executionId, option, status: 'passed', ...scope })),
    ];
    const evidence = { candidate, environment: 'DEV', expectedPublicApi: publicApiUrl, cleanupVerified: true, authorizationEvidence,
      commands: [{ command: 'eai workspace list', executionId, exitCode: 0, status: 'passed', coverageComplete: true, assertions, options: ['--format', '--workspace'], ...scope }],
      aliases: [{ alias: 'eai tenant list', command: 'eai workspace list', executionId: aliasExecutionId, exitCode: 0, status: 'passed', coverageComplete: true,
        assertions: [{ name: 'exact alias inventory', command: 'eai workspace list', alias: 'eai tenant list',
          executionId: aliasExecutionId, status: 'passed', ...scope } as AuditAssertion], ...scope }] };
    return { input: { schema, candidate, evidence, buildReceipt, deployments, now }, decisions };
  }

  test.each(['oid', 'profile'])('case-folded duplicate actor %s cannot certify independent normal roles', field => {
    const { input, decisions } = completeContractModel(), authorization = input.evidence.authorizationEvidence;
    const first = authorization.actors.adminA[field], second = authorization.actors.builderA[field];
    const normalized = field === 'oid' ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : 'same-normal-profile';
    const text = JSON.stringify(authorization).replaceAll(first, normalized).replaceAll(second, normalized.toUpperCase());
    input.evidence.authorizationEvidence = JSON.parse(text);
    const report = buildAudit(input, decisions);
    expect(report.authorizationVerified).toBe(false); expect(report.backendCertified).toBe(false);
  });
  test.each(['array', 'nested-array'])('a malformed %s actor OID refuses qualification without throwing', shape => {
    const { input, decisions } = completeContractModel(), actor = input.evidence.authorizationEvidence.actors.adminA;
    Object.assign(actor, { oid: shape === 'array' ? [actor.oid] : [[actor.oid]] });
    const report = buildAudit(input, decisions);
    expect(report.authorizationVerified).toBe(false); expect(report.backendCertified).toBe(false);
  });

  test('joins build, role, selected deployment and normalized option contracts without claiming missing cycles', () => {
    const { input, decisions } = completeContractModel(), report = buildAudit(input, decisions);
    expect(report.candidateVerified).toBe(true); expect(report.parityComplete).toBe(true); expect(report.authorizationVerified).toBe(true);
    expect(report.optionCoverageComplete).toBe(true); expect(report.aliasCoverageComplete).toBe(true); expect(report.backendCertified).toBe(true);
    expect(report.fullCapabilityQualified).toBe(false);
  });
  test('valid standalone authorization admits retained scopes without claiming ten completed cycles', () => {
    const { input, decisions } = completeContractModel(), report = buildAudit(input, decisions);
    expect(report.authorizationVerified).toBe(true); expect(report.foundationEvidenceBound).toBe(false);
    expect(report.commands[0].status).toBe('passed'); expect(report.aliasEvidence[0].status).toBe('passed');
    expect(report.optionCoverageComplete).toBe(true); expect(report.fullCapabilityQualified).toBe(false);
  });
  test.each([undefined, null, 1, 2, '0'])('supported command and alias exit %j never qualifies passing assertions', exitCode => {
    const { input, decisions } = completeContractModel();
    for (const row of [...input.evidence.commands, ...input.evidence.aliases]) Object.assign(row, { exitCode });
    const report = buildAudit(input, decisions);
    expect(report.commands[0].status).not.toBe('passed'); expect(report.aliasEvidence[0].status).not.toBe('passed');
    expect(report.optionCoverageComplete).toBe(false); expect(report.backendCertified).toBe(false);
  });
  test.each(['missing-root', 'invalid-root', 'root-a', 'root-case-a', 'missing-bindings', 'foreign-child', 'foreign-parent'])('standalone retained scopes require exact distinct root/child binding: %s', failure => {
    const { input, decisions } = completeContractModel(), auth = input.evidence.authorizationEvidence;
    if (failure === 'missing-root') Object.assign(auth, { foundationParentTenantId: undefined });
    if (failure === 'invalid-root') auth.foundationParentTenantId = 'unknown';
    if (failure === 'root-a') { auth.foundationParentTenantId = auth.tenantIds.a; for (const binding of Object.values(auth.workspaceBindings)) binding.parentTenantId = auth.foundationParentTenantId; }
    if (failure === 'root-case-a') {
      const original = auth.tenantIds.a, child = 'aaaaaaaa-0000-4000-8000-000000000020';
      Object.assign(auth, JSON.parse(JSON.stringify(auth).replaceAll(original, child)));
      auth.foundationParentTenantId = child.toUpperCase();
      for (const binding of Object.values(auth.workspaceBindings)) binding.parentTenantId = auth.foundationParentTenantId;
      for (const row of [...input.evidence.commands, ...input.evidence.aliases]) Object.assign(row, { scopeTenantId: child,
        assertions: row.assertions.map(assertion => ({ ...assertion, scopeTenantId: child })) });
    }
    if (failure === 'missing-bindings') Object.assign(auth, { workspaceBindings: undefined });
    if (failure === 'foreign-child') auth.workspaceBindings.a.tenantId = auth.tenantIds.b;
    if (failure === 'foreign-parent') auth.workspaceBindings.b.parentTenantId = auth.tenantIds.a;
    const report = buildAudit(input, decisions);
    expect(report.authorizationVerified).toBe(false); expect(report.commands[0].status).not.toBe('passed');
    expect(report.aliasCoverageComplete).toBe(false); expect(report.optionCoverageComplete).toBe(false);
  });
  function addCompleteCycleModel(input: ReturnType<typeof completeContractModel>['input']) {
    // A synthetic consumer DTO model, never a live qualification observation.
    const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
    const authorization = input.evidence.authorizationEvidence;
    const cycleEvidence = { schemaVersion: 'eai.cli-permanent-cycles.v1', qualified: true, qualification: 'normal-cli-profiles', status: 'passed',
      fixtureId: authorization.fixtureId, foundationParentTenantId: authorization.foundationParentTenantId,
      environment: authorization.environment, publicApiUrl: authorization.publicApiUrl,
      candidate: input.candidate, actors: structuredClone(authorization.actors), tenantIds: structuredClone(authorization.tenantIds),
      completedAt: authorization.completedAt, cycles: Array.from({ length: 10 }, (_, index) => ({
        environment: authorization.environment, publicApiUrl: authorization.publicApiUrl,
        clientId: id(100 + index), tenantId: id(200 + index), appKey: 'eai-e2e-fixture-' + index, status: 'passed',
        enrollmentId: id(300 + index), recreatedEnrollmentId: id(400 + index), rotationDispatches: 1,
        credentialChanged: true, firstInventoryEmpty: true, recreatedSameKey: true, cleanupVerified: true,
        localProjectCleanupVerified: true, registrationAbsent: true, deletionVerified: true, appBuildVerified: true,
      })) };
    const boundCycles = { ...cycleEvidence, cycles: cycleEvidence.cycles.map(cycle => ({ ...cycle, stepEvidence: cycleStepModel(cycle),
      ownershipEvidence: cycleOwnershipModel(cycle, cycleEvidence) })) };
    Object.assign(input.evidence, { cycleEvidence: boundCycles }); return boundCycles;
  }
  test('a complete matching fixture/workspace/actor model can qualify the combined consumer', () => {
    const { input, decisions } = completeContractModel(); addCompleteCycleModel(input);
    expect(buildAudit(input, decisions).fullCapabilityQualified).toBe(true);
  });
  test.each(['unverified-role', 'missing-role', 'foreign-fixture', 'foreign-workspace', 'foreign-actor'] as const)(
    'protected command, alias and option scopes refuse %s retained authorization', failure => {
      const { input, decisions } = completeContractModel(), cycles = addCompleteCycleModel(input);
      if (failure === 'unverified-role') input.evidence.authorizationEvidence.qualified = false;
      if (failure === 'missing-role') Object.assign(input.evidence, { authorizationEvidence: undefined });
      if (failure === 'foreign-fixture') cycles.fixtureId = '00000000-0000-4000-8000-000000000999';
      if (failure === 'foreign-workspace') cycles.tenantIds.b = '00000000-0000-4000-8000-000000000999';
      if (failure === 'foreign-actor') cycles.actors.builderA.oid = '00000000-0000-4000-8000-000000000999';
      const report = buildAudit(input, decisions);
      expect(report.commands[0].status).toBe('incomplete');
      expect(report.aliasEvidence[0].status).toBe('incomplete');
      expect(report.optionEvidence.every((row: { status: string }) => row.status === 'incomplete')).toBe(true);
      expect(report.backendCertified).toBe(false); expect(report.fullCapabilityQualified).toBe(false);
    });
  test('a cycle child cannot qualify protected scopes through an unverified role receipt', () => {
    const { input, decisions } = completeContractModel(), cycles = addCompleteCycleModel(input);
    input.evidence.authorizationEvidence.qualified = false;
    const scopeTenantId = cycles.cycles[0].tenantId;
    for (const receipt of [...input.evidence.commands, ...input.evidence.aliases]) {
      Object.assign(receipt, { scopeTenantId });
      for (const assertion of receipt.assertions) Object.assign(assertion, { scopeTenantId });
    }
    const report = buildAudit(input, decisions);
    expect(report.commands[0].status).toBe('incomplete');
    expect(report.aliasEvidence[0].status).toBe('incomplete');
    expect(report.optionCoverageComplete).toBe(false); expect(report.backendCertified).toBe(false);
  });
  test.each(['missing', 'creation-child', 'creation-parent', 'creation-reused', 'creation-exit', 'cleanup-child',
    'cleanup-parent', 'cleanup-status', 'cleanup-soft', 'cleanup-absence', 'foreign-fixture', 'foreign-root',
    'foreign-admin', 'retained-a', 'retained-b', 'retained-root'] as const)(
    'imported %s cycle ownership cannot qualify a protected child scope', failure => {
      const { input, decisions } = completeContractModel(), cycles = addCompleteCycleModel(input);
      const cycle = cycles.cycles[0], proof = cycle.ownershipEvidence;
      if (failure === 'missing') Object.assign(cycle, { ownershipEvidence: undefined });
      if (failure === 'creation-child') proof.creation.tenantId = '00000000-0000-4000-8000-000000000999';
      if (failure === 'creation-parent') proof.creation.parentTenantId = proof.tenantIds.b;
      if (failure === 'creation-reused') proof.creation.newChild = false;
      if (failure === 'creation-exit') proof.creation.exitCode = 1;
      if (failure === 'cleanup-child') proof.cleanup.tenantId = '00000000-0000-4000-8000-000000000999';
      if (failure === 'cleanup-parent') proof.cleanup.parentTenantId = proof.tenantIds.b;
      if (failure === 'cleanup-status') proof.cleanup.receiptStatus = 'accepted';
      if (failure === 'cleanup-soft') proof.cleanup.hardPurged = false;
      if (failure === 'cleanup-absence') proof.cleanup.absenceVerified = false;
      if (failure === 'foreign-fixture') proof.fixtureId = '00000000-0000-4000-8000-000000000999';
      if (failure === 'foreign-root') proof.foundationParentTenantId = '00000000-0000-4000-8000-000000000999';
      if (failure === 'foreign-admin') proof.actorId = input.evidence.authorizationEvidence.actors.builderA.oid;
      if (failure.startsWith('retained-')) {
        const tenantId = failure === 'retained-root' ? cycles.foundationParentTenantId : cycles.tenantIds[failure === 'retained-a' ? 'a' : 'b'];
        cycle.tenantId = tenantId; Object.assign(cycle, { stepEvidence: cycleStepModel(cycle), ownershipEvidence: cycleOwnershipModel(cycle, cycles) });
      }
      for (const receipt of [...input.evidence.commands, ...input.evidence.aliases]) {
        receipt.scopeTenantId = cycle.tenantId;
        for (const assertion of receipt.assertions) assertion.scopeTenantId = cycle.tenantId;
      }
      const report = buildAudit(input, decisions);
      expect(qa.cyclesVerified(input.evidence, input.candidate, { environment: 'DEV', publicApiUrl: input.evidence.expectedPublicApi, now: input.now })).toBe(false);
      // Retained a/b remain valid read scopes; they cannot count as new children.
      const retainedRead = ['retained-a', 'retained-b'].includes(failure);
      expect(report.commands[0].status).toBe(retainedRead ? 'passed' : 'incomplete');
      expect(report.aliasEvidence[0].status).toBe(retainedRead ? 'passed' : 'incomplete');
      expect(report.optionCoverageComplete).toBe(retainedRead); expect(report.fullCapabilityQualified).toBe(false);
    });
  test('complete synthetic imported ownership and step observations admit a distinct cycle child scope', () => {
    const { input, decisions } = completeContractModel(), cycles = addCompleteCycleModel(input), tenantId = cycles.cycles[0].tenantId;
    for (const receipt of [...input.evidence.commands, ...input.evidence.aliases]) {
      receipt.scopeTenantId = tenantId; for (const assertion of receipt.assertions) assertion.scopeTenantId = tenantId;
    }
    expect(buildAudit(input, decisions).fullCapabilityQualified).toBe(true);
  });
  test.each(['failed', 'blocked', 'passed'] as const)('a supported %s attempt in unsupported receipts cannot be discarded', status => {
    const { input, decisions } = completeContractModel();
    Object.assign(input.evidence, { unsupported: [{ ...input.evidence.commands[0], status }] });
    const report = buildAudit(input, decisions);
    expect(report.evidenceValidation.valid).toBe(false); expect(report.commands[0].status).not.toBe('passed');
    expect(report.commands[0].status).toBe(status === 'passed' ? 'incomplete' : status);
    expect(report.backendCertified).toBe(false); expect(report.fullCapabilityQualified).toBe(false);
  });
  test('an alias-scoped command receipt cannot replace the canonical invocation or its options', () => {
    const { input, decisions } = completeContractModel(), row = input.evidence.commands[0];
    Object.assign(row, { alias: 'eai tenant list' });
    for (const assertion of row.assertions) assertion.alias = 'eai tenant list';
    const report = buildAudit(input, decisions);
    expect(report.commands[0].status).not.toBe('passed'); expect(report.optionCoverageComplete).toBe(false);
    expect(report.aliasCoverageComplete).toBe(false); expect(report.backendCertified).toBe(false);
    expect(report.evidenceValidation).toMatchObject({ valid: false, malformedAttempts: [{ collection: 'commands', index: 0 }] });
  });
  test('separate canonical and alias receipts retain independent successful spelling evidence', () => {
    const { input, decisions } = completeContractModel(), report = buildAudit(input, decisions);
    expect(report.commands[0].status).toBe('passed'); expect(report.aliasCoverageComplete).toBe(true);
    expect(report.optionCoverageComplete).toBe(true); expect(report.backendCertified).toBe(true);
  });
  test.each(['missing', 'empty', 'unsupported', 'gateway', 'region'])('matching %s scopes cannot certify deployment, role or cycle evidence', scope => {
    const { input, decisions } = completeContractModel(), cycles = addCompleteCycleModel(input);
    const environment = scope === 'missing' ? undefined : scope === 'empty' ? '' : scope === 'unsupported' ? 'PROD' : 'DEV';
    const publicApiUrl = scope === 'missing' ? undefined : scope === 'empty' ? '' : scope === 'gateway'
      ? 'https://example.invalid/public' : scope === 'region' ? 'https://dev-api.eu.myenterprise.ai/public' : input.evidence.expectedPublicApi;
    Object.assign(input.evidence, { environment, expectedPublicApi: publicApiUrl });
    Object.assign(input.evidence.authorizationEvidence, { environment, publicApiUrl }); Object.assign(cycles, { environment, publicApiUrl });
    for (const cleanup of input.evidence.authorizationEvidence.cleanup) {
      cleanup.deleteReceipt.request.publicApiUrl = publicApiUrl; cleanup.absenceReceipt.request.publicApiUrl = publicApiUrl;
    }
    for (const cycle of cycles.cycles) Object.assign(cycle.ownershipEvidence, { environment, publicApiUrl });
    for (const receipt of [...input.evidence.commands, ...input.evidence.aliases]) {
      Object.assign(receipt, { environment, publicApiUrl });
      for (const assertion of receipt.assertions) Object.assign(assertion, { environment, publicApiUrl });
    }
    for (const row of input.deployments) Object.assign(row, { environment, publicApiUrl });
    const context = { environment, publicApiUrl, now: input.now };
    expect(qa.deploymentParity(input.deployments, context)).toBe(false);
    expect(qa.authorizationVerified(input.evidence, input.candidate, context)).toBe(false);
    expect(qa.cyclesVerified(input.evidence, input.candidate, context)).toBe(false);
    const report = buildAudit(input, decisions);
    expect(report.parityComplete).toBe(false); expect(report.authorizationVerified).toBe(false);
    expect(report.backendCertified).toBe(false); expect(report.fullCapabilityQualified).toBe(false);
  });
  test.each(['DEV:au', 'TEST:au', 'TEST:ca', 'TEST:eu'])('canonical %s scope preserves complete receipt qualification', value => {
    const { input, decisions } = completeContractModel(), cycles = addCompleteCycleModel(input);
    const [environment, region] = value.split(':'), publicApiUrl = qa.publicApi(environment, region);
    Object.assign(input.evidence, { environment, expectedPublicApi: publicApiUrl });
    Object.assign(input.evidence.authorizationEvidence, { environment, publicApiUrl }); Object.assign(cycles, { environment, publicApiUrl });
    for (const cleanup of input.evidence.authorizationEvidence.cleanup) {
      cleanup.deleteReceipt.request.publicApiUrl = publicApiUrl; cleanup.absenceReceipt.request.publicApiUrl = publicApiUrl;
    }
    for (const cycle of cycles.cycles) {
      for (const row of [cycle, cycle.stepEvidence, cycle.ownershipEvidence,
        ...cycle.stepEvidence.commands.flatMap(command => [command, ...command.assertions]),
        cycle.ownershipEvidence.creation.command, cycle.ownershipEvidence.creation.command.assertion,
        cycle.ownershipEvidence.cleanup.command, cycle.ownershipEvidence.cleanup.command.assertion]) Object.assign(row, { environment, publicApiUrl });
    }
    for (const receipt of [...input.evidence.commands, ...input.evidence.aliases]) {
      Object.assign(receipt, { environment, publicApiUrl });
      for (const assertion of receipt.assertions) Object.assign(assertion, { environment, publicApiUrl });
    }
    for (const row of input.deployments) Object.assign(row, { environment, publicApiUrl });
    expect(buildAudit(input, decisions).fullCapabilityQualified).toBe(true);
  });
  test.each([null, 42, [], 'unexpected'].map(caseRow => ({ caseRow })))('a malformed permission case $caseRow remains unqualified without dropping the inventory', ({ caseRow }) => {
    const { input, decisions } = completeContractModel(); Object.assign(input.evidence.authorizationEvidence.cases, { 0: caseRow });
    const context = { environment: 'DEV', publicApiUrl: input.evidence.expectedPublicApi, now: input.now };
    expect(qa.authorizationVerified(input.evidence, input.candidate, context)).toBe(false);
    const report = buildAudit(input, decisions); expect(report.commands[0].status).toBe('incomplete');
    expect(report.authorizationVerified).toBe(false); expect(report.backendCertified).toBe(false);
  });
  test.each(['dirty', 'version', 'runtimeFileCount'])('top-level evidence rejects a different candidate %s', field => {
    const { input, decisions } = completeContractModel();
    input.evidence.candidate = { ...input.evidence.candidate, [field]: field === 'dirty' ? true : field === 'version' ? '3.19.99' : 201 };
    expect(() => buildAudit(input, decisions)).toThrow('exact CLI candidate');
  });
  test.each(['dirty', 'version', 'runtimeFileCount'])('authorization evidence cannot reuse a different candidate %s', field => {
    const { input, decisions } = completeContractModel();
    input.evidence.authorizationEvidence.candidate = { ...input.candidate,
      [field]: field === 'dirty' ? true : field === 'version' ? '3.19.99' : 201 };
    const report = buildAudit(input, decisions); expect(report.authorizationVerified).toBe(false); expect(report.backendCertified).toBe(false);
  });
  test.each(['dirty', 'version', 'runtimeFileCount'])('cycle evidence cannot reuse a different candidate %s', field => {
    const { input, decisions } = completeContractModel(), cycles = addCompleteCycleModel(input);
    cycles.candidate = { ...input.candidate, [field]: field === 'dirty' ? true : field === 'version' ? '3.19.99' : 201 };
    expect(qa.cyclesVerified(input.evidence, input.candidate, { environment: 'DEV', publicApiUrl: input.evidence.expectedPublicApi, now: input.now })).toBe(false);
    expect(buildAudit(input, decisions).fullCapabilityQualified).toBe(false);
  });
  function unsupportedModel() {
    const command = 'eai types define', executionId = '00000000-0000-4000-8000-000000000777';
    return { schema: { command: 'eai', subcommands: [{ command: 'types', subcommands: [{ command: 'define' }] }] },
      evidence: { candidate, unsupported: [{ command, executionId, status: 'passed', coverageComplete: true,
        assertions: [{ name: 'refuses before auth/network', command, executionId, status: 'passed' }],
        exitCode: 1, authenticationBypassed: true, networkCalls: 0 }] },
      decisions: [{ command, crud: 'create', coverage: 'unsupported', notes: 'No public contract.' }] };
  }
  test('unsupported completion accepts a complete execution-bound denial observation', () => {
    const { schema, evidence, decisions } = unsupportedModel();
    expect(buildAudit({ schema, candidate, evidence }, decisions).unsupportedVerified).toBe(true);
  });
  test.each(['failed', 'blocked', 'running', 'incomplete'])('unsupported capability retains its attempted %s observation in the summary', status => {
    const { schema, evidence, decisions } = unsupportedModel(); evidence.unsupported[0].status = status;
    const report = buildAudit({ schema, candidate, evidence }, decisions);
    const outcome = ['running', 'incomplete'].includes(status) ? 'incomplete' : status;
    expect(report.commands[0].status).toBe(outcome); expect(report.summary[outcome]).toBe(1);
    expect(report.unsupportedVerified).toBe(false);
  });
  test('unsupported option coverage uses its qualifying unsupported execution and option-specific assertion', () => {
    const { schema, evidence, decisions } = unsupportedModel();
    Object.assign(schema.subcommands[0].subcommands[0], { options: [{ name: '--format' }] });
    Object.assign(evidence.unsupported[0], { options: ['--format'] });
    evidence.unsupported[0].assertions.push({ ...evidence.unsupported[0].assertions[0], name: 'exact format denial', option: '--format' } as any);
    const report = buildAudit({ schema, candidate, evidence }, decisions);
    expect(report.optionEvidence[0]).toMatchObject({ command: 'eai types define', option: '--format', status: 'passed' });
    expect(report.optionCoverageComplete).toBe(true); expect(report.unsupportedVerified).toBe(true);
  });
  test.each(['false', 1, {}, []].map(value => ({ value })))('authorization foundation flag $value cannot certify evidence', ({ value }) => {
    const { input, decisions } = completeContractModel(); Object.assign(input.evidence.authorizationEvidence, { foundationVerified: value });
    expect(buildAudit(input, decisions).authorizationVerified).toBe(false);
  });
  test.each(['', ' ', 'unsafe/profile', 'p'.repeat(101)])('authorization profile %j must satisfy the bounded normal-profile contract', profile => {
    const { input, decisions } = completeContractModel(), authorization = input.evidence.authorizationEvidence;
    authorization.actors.viewerA.profile = profile;
    for (const row of authorization.cases) if (row.name.startsWith('viewerA:')) row.profile = profile;
    expect(buildAudit(input, decisions).authorizationVerified).toBe(false);
  });
  test.each(['missing', 'foreign-environment', 'foreign-gateway', 'foreign-tenant', 'assertion-scope'])('protected execution with %s scope cannot borrow DEV role/deployment evidence', failure => {
    const { input, decisions } = completeContractModel(), row = input.evidence.commands[0];
    const scope = { environment: 'DEV', publicApiUrl: input.evidence.expectedPublicApi,
      scopeTenantId: input.evidence.authorizationEvidence.tenantIds.a };
    Object.assign(row, scope); for (const assertion of row.assertions) Object.assign(assertion, scope);
    if (failure === 'missing') Object.assign(row, { environment: undefined, publicApiUrl: undefined, scopeTenantId: undefined });
    if (failure === 'foreign-environment') Object.assign(row, { environment: 'TEST' });
    if (failure === 'foreign-gateway') Object.assign(row, { publicApiUrl: 'https://test-api.au.myenterprise.ai/public' });
    if (failure === 'foreign-tenant') Object.assign(row, { scopeTenantId: '00000000-0000-4000-8000-000000000999' });
    if (failure === 'assertion-scope') Object.assign(row.assertions[0], { environment: 'TEST' });
    const report = buildAudit(input, decisions); expect(report.commands[0].status).toBe('incomplete');
    expect(report.backendCertified).toBe(false);
  });
  test('an alias-scoped unsupported denial cannot qualify canonical unsupported completion', () => {
    const { schema, evidence, decisions } = unsupportedModel(), row = evidence.unsupported[0];
    Object.assign(row, { alias: 'eai unsupported alias' }); Object.assign(row.assertions[0], { alias: 'eai unsupported alias' });
    const report = buildAudit({ schema, candidate, evidence }, decisions);
    expect(report.unsupportedVerified).toBe(false);
    expect(report.evidenceValidation).toMatchObject({ valid: false, malformedAttempts: [{ collection: 'unsupported', index: 0 }] });
  });
  test.each(['bare', 'execution', 'complete', 'missing-assertions', 'malformed-assertion', 'failed-assertion', 'foreign-command', 'foreign-execution'])
    ('unsupported completion rejects a %s denial claim', failure => {
      const { schema, evidence, decisions } = unsupportedModel(), row = evidence.unsupported[0];
      if (failure === 'bare') { Object.assign(row, { executionId: undefined, coverageComplete: undefined, assertions: undefined }); }
      if (failure === 'execution') row.executionId = 'not-an-execution';
      if (failure === 'complete') row.coverageComplete = false;
      if (failure === 'missing-assertions') row.assertions = [];
      if (failure === 'malformed-assertion') Object.assign(row, { assertions: [null] });
      if (failure === 'failed-assertion') row.assertions[0].status = 'failed';
      if (failure === 'foreign-command') row.assertions[0].command = 'eai user list';
      if (failure === 'foreign-execution') row.assertions[0].executionId = '00000000-0000-4000-8000-000000000999';
      const report = buildAudit({ schema, candidate, evidence }, decisions);
      expect(report.unsupportedVerified).toBe(false); expect(report.fullCapabilityQualified).toBe(false);
    });
  test.each(['commands', 'aliases', 'unsupported'])('a null %s attempt is retained and cannot be hidden by a passing receipt', collection => {
    const { input, decisions } = completeContractModel(); addCompleteCycleModel(input);
    Object.assign(input.evidence, { [collection]: [null, ...(input.evidence[collection as 'commands'] || [])] });
    const report = buildAudit(input, decisions);
    expect(report.backendCertified).toBe(false); expect(report.fullCapabilityQualified).toBe(false);
    expect(report.evidenceValidation).toMatchObject({ valid: false,
      malformedAttempts: expect.arrayContaining([expect.objectContaining({ collection, index: 0 })]) });
  });
  test.each(['commands', 'aliases', 'unsupported'])('a non-array %s receipt collection stays non-qualifying', collection => {
    const { input, decisions } = completeContractModel(); Object.assign(input.evidence, { [collection]: { secret: 'synthetic-input-marker' } });
    const report = buildAudit(input, decisions);
    expect(report.backendCertified).toBe(false); expect(report.fullCapabilityQualified).toBe(false);
    expect(report.evidenceValidation.valid).toBe(false); expect(JSON.stringify(report)).not.toContain('synthetic-input-marker');
  });
  test.each(['failed', 'blocked'])('malformed attempts preserve a known %s scoped assertion outcome', status => {
    const { input, decisions } = completeContractModel(); input.evidence.commands[0].assertions[0].status = status;
    Object.assign(input.evidence, { commands: [...input.evidence.commands, null] });
    const report = buildAudit(input, decisions);
    expect(report.commands[0].status).toBe(status);
    expect(report.optionEvidence.find((row: any) => row.option === '--format').status).toBe(status);
    expect(report.backendCertified).toBe(false); expect(report.evidenceValidation.valid).toBe(false);
  });
  test('a created receipt attributed to another actor cannot qualify the permission consumer', () => {
    const { input, decisions } = completeContractModel(); input.evidence.authorizationEvidence.created[0].creatorId = '00000000-0000-4000-8000-000000000999';
    const report = buildAudit(input, decisions); expect(report.authorizationVerified).toBe(false); expect(report.backendCertified).toBe(false);
  });
  test.each(['deleteReceipt', 'absenceReceipt'])('an imported %s requires its exact observed cleanup envelope', receiptName => {
    const { input, decisions } = completeContractModel();
    delete (input.evidence.authorizationEvidence.cleanup[0] as Record<string, unknown>)[receiptName];
    const report = buildAudit(input, decisions);
    expect(report.authorizationVerified).toBe(false); expect(report.backendCertified).toBe(false);
  });
  test.each(['deleteReceipt', 'absenceReceipt'].flatMap(receiptName =>
    ['exit', 'ok', 'status', 'method', 'path', 'tenant', 'gateway', 'array'].map(failure => ({ receiptName, failure }))))
    ('an imported cleanup $receiptName $failure cannot be hidden by passing summary flags', ({ receiptName, failure }) => {
        const { input, decisions } = completeContractModel();
        const row = input.evidence.authorizationEvidence.cleanup[0] as Record<string, any>;
        const receipt = row[receiptName];
        if (failure === 'exit') receipt.exitCode = receiptName === 'deleteReceipt' ? 1 : 0;
        if (failure === 'ok') receipt.ok = !receipt.ok;
        if (failure === 'status') receipt.status = 503;
        if (failure === 'method') receipt.request.method = 'POST';
        if (failure === 'path') receipt.request.path += '-foreign';
        if (failure === 'tenant') receipt.request.tenantId = '00000000-0000-4000-8000-000000000999';
        if (failure === 'gateway') receipt.request.publicApiUrl = 'https://foreign.example.invalid/public';
        if (failure === 'array') row[receiptName] = [];
        const report = buildAudit(input, decisions);
        expect(report.authorizationVerified).toBe(false); expect(report.backendCertified).toBe(false);
    });
  test.each(['id', 'deleted', 'timestamp', 'missing-body', 'array-body', 'array-request'])
    ('an imported DELETE %s must prove the exact deleted owned row', failure => {
      const { input, decisions } = completeContractModel();
      const receipt = input.evidence.authorizationEvidence.cleanup[0].deleteReceipt as Record<string, any>;
      if (failure === 'id') receipt.body.id = '00000000-0000-4000-8000-000000000999';
      if (failure === 'deleted') receipt.body.deleted = false;
      if (failure === 'timestamp') receipt.body.deleted_at = 'not-a-timestamp';
      if (failure === 'missing-body') delete receipt.body;
      if (failure === 'array-body') receipt.body = [];
      if (failure === 'array-request') receipt.request = [];
      const report = buildAudit(input, decisions);
      expect(report.authorizationVerified).toBe(false); expect(report.backendCertified).toBe(false);
    });
  test.each([null, undefined].map(cycle => ({ cycle })))('a malformed retained cycle $cycle remains unqualified', ({ cycle }) => {
    const { input, decisions } = completeContractModel(), cycles = addCompleteCycleModel(input);
    Object.assign(cycles.cycles, { 0: cycle });
    const report = buildAudit(input, decisions); expect(report.fullCapabilityQualified).toBe(false);
    expect(qa.cyclesVerified(input.evidence, input.candidate, { environment: 'DEV', publicApiUrl: authorizationUrl(input), now: input.now })).toBe(false);
  });
  test.each(['failed', 'blocked', 'missing-status', 'missing-name', 'foreign-command', 'foreign-execution', 'legacy-string', 'null', 'foreign-alias'])('a %s assertion cannot certify its execution', failure => {
    const { input, decisions } = completeContractModel();
    if (failure === 'foreign-alias') input.evidence.aliases[0].assertions[0].alias = 'eai other list';
    else {
      const assertion = input.evidence.commands[0].assertions[0];
      if (failure === 'failed' || failure === 'blocked') assertion.status = failure;
      if (failure === 'missing-status') Object.assign(assertion, { status: undefined });
      if (failure === 'missing-name') assertion.name = '';
      if (failure === 'foreign-command') assertion.command = 'eai user list';
      if (failure === 'foreign-execution') assertion.executionId = '00000000-0000-4000-8000-000000000999';
      if (failure === 'legacy-string') Object.assign(input.evidence.commands[0], { assertions: ['named but unverified'] });
      if (failure === 'null') Object.assign(input.evidence.commands[0], { assertions: [null] });
    }
    const report = buildAudit(input, decisions);
    expect(report.fullCapabilityQualified).toBe(false);
    if (failure === 'foreign-alias') expect(report.aliasCoverageComplete).toBe(false);
    else { expect(report.backendCertified).toBe(false); expect(report.commands[0].status).not.toBe('passed'); }
  });
  test('one generic passing assertion cannot certify every listed option', () => {
    const { input, decisions } = completeContractModel();
    input.evidence.commands[0].assertions = input.evidence.commands[0].assertions.filter(row => row.option !== '--workspace');
    const report = buildAudit(input, decisions);
    expect(report.commands[0].status).toBe('passed'); expect(report.backendCertified).toBe(false);
    expect(report.optionEvidence.find((row: any) => row.option === '--format').status).toBe('passed');
    expect(report.optionEvidence.find((row: any) => row.option === '--workspace').status).toBe('incomplete');
  });
  test('a failed option assertion is retained without erasing another independently checked option', () => {
    const { input, decisions } = completeContractModel();
    input.evidence.commands[0].assertions.find(row => row.option === '--format')!.status = 'failed';
    const report = buildAudit(input, decisions);
    expect(report.commands[0].status).toBe('failed'); expect(report.backendCertified).toBe(false);
    expect(report.optionEvidence.find((row: any) => row.option === '--format').status).toBe('failed');
    expect(report.optionEvidence.find((row: any) => row.option === '--workspace').status).toBe('passed');
  });
  test.each(['published-missing', 'published-duplicate', 'published-tenant', 'published-fingerprint', 'published-draft',
    'created-missing', 'created-duplicate', 'created-tenant', 'created-unacknowledged', 'created-not-dispatched',
    'created-not-absent', 'created-duplicate-key', 'created-nonce', 'cleanup-missing', 'cleanup-id', 'cleanup-profile',
    'cleanup-no-delete', 'cleanup-no-absence', 'cleanup-wrong-status', 'leftovers', 'local-cleanup',
    'case-resource', 'viewer-resource', 'sibling-resource'])('contradictory %s receipts cannot qualify the permission consumer', failure => {
    const { input, decisions } = completeContractModel(), authorization = input.evidence.authorizationEvidence;
    if (failure === 'published-missing') authorization.publishedFixture = [];
    if (failure === 'published-duplicate') authorization.publishedFixture[1] = authorization.publishedFixture[0];
    if (failure === 'published-tenant') authorization.publishedFixture[0].tenantId = '00000000-0000-4000-8000-000000000999';
    if (failure === 'published-fingerprint') authorization.publishedFixture[1].propertyFingerprintSha256 = 'b'.repeat(64);
    if (failure === 'published-draft') authorization.publishedFixture[0].publicationStatus = 'draft';
    if (failure === 'created-missing') authorization.created = [];
    if (failure === 'created-duplicate') authorization.created[1] = authorization.created[0];
    if (failure === 'created-tenant') authorization.created[0].tenantId = authorization.tenantIds.b;
    if (failure === 'created-unacknowledged') authorization.created[0].acknowledgedBound = false;
    if (failure === 'created-not-dispatched') authorization.created[0].creationDispatched = false;
    if (failure === 'created-not-absent') authorization.created[0].phase = 'acknowledged';
    if (failure === 'created-duplicate-key') authorization.created[1].idempotencyKey = authorization.created[0].idempotencyKey;
    if (failure === 'created-nonce') authorization.created[0].nonce = 'foreign-run';
    if (failure === 'cleanup-missing') authorization.cleanup = [];
    if (failure === 'cleanup-id') authorization.cleanup[0].resourceId = authorization.created[1].resourceId;
    if (failure === 'cleanup-profile') authorization.cleanup[0].profile = authorization.actors.adminB.profile;
    if (failure === 'cleanup-no-delete') authorization.cleanup[0].deleteAcknowledged = false;
    if (failure === 'cleanup-no-absence') authorization.cleanup[0].absenceVerified = false;
    if (failure === 'cleanup-wrong-status') authorization.cleanup[0].absenceHttpStatus = 403;
    if (failure === 'leftovers') Object.assign(authorization, { leftovers: [{ resourceId: authorization.created[0].resourceId }] });
    if (failure === 'local-cleanup') authorization.localCleanupVerified = false;
    if (failure === 'case-resource') authorization.cases[0].resourceId = authorization.created[1].resourceId;
    if (failure === 'viewer-resource') authorization.cases.find((row: any) => row.name === 'viewerA:read')!.resourceId = authorization.created[1].resourceId;
    if (failure === 'sibling-resource') authorization.cases.find((row: any) => row.name === 'adminA:sibling-denied')!.resourceId = authorization.created[0].resourceId;
    const report = buildAudit(input, decisions);
    expect(report.authorizationVerified).toBe(false); expect(report.backendCertified).toBe(false);
  });
  test.each(['fixtureId', 'workspace-a', 'workspace-b', 'actor-oid', 'actor-profile', 'missing-context'])('separately valid %s cycle evidence cannot borrow another role foundation', field => {
    const { input, decisions } = completeContractModel(), cycle = addCompleteCycleModel(input);
    if (field === 'fixtureId') cycle.fixtureId = '00000000-0000-4000-8000-000000000999';
    if (field === 'workspace-a') cycle.tenantIds.a = '00000000-0000-4000-8000-000000000998';
    if (field === 'workspace-b') cycle.tenantIds.b = '00000000-0000-4000-8000-000000000997';
    if (field === 'actor-oid') cycle.actors.adminA.oid = '00000000-0000-4000-8000-000000000996';
    if (field === 'actor-profile') cycle.actors.adminA.profile = 'other-normal-profile';
    if (field === 'missing-context') Object.assign(cycle, { actors: undefined, tenantIds: undefined });
    expect(qa.authorizationVerified(input.evidence, input.candidate, { environment: 'DEV', publicApiUrl: authorizationUrl(input), now: input.now })).toBe(true);
    expect(qa.cyclesVerified(input.evidence, input.candidate, { environment: 'DEV', publicApiUrl: authorizationUrl(input), now: input.now })).toBe(false);
    expect(buildAudit(input, decisions).fullCapabilityQualified).toBe(false);
  });
  function authorizationUrl(input: ReturnType<typeof completeContractModel>['input']): string {
    return input.evidence.authorizationEvidence.publicApiUrl;
  }

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
    if (reason === 'dirty' || reason === 'untracked-status') expect(() => buildAudit(input, decisions)).toThrow('exact CLI candidate');
    else expect(buildAudit(input, decisions).backendCertified).toBe(false);
  });
  test.each(['failed', 'blocked', 'running'])('later successful alias receipts preserve an earlier %s observation', status => {
    const { input, decisions } = completeContractModel();
    input.evidence.aliases.unshift({ ...input.evidence.aliases[0], status });
    const report = buildAudit(input, decisions);
    expect(report.aliasCoverageComplete).toBe(false);
    expect(report.aliasEvidence[0].status).toBe(status === 'running' ? 'incomplete' : status);
  });
  test.each(['failed', 'blocked', 'running', 'incomplete'])('option success cannot mask a retained %s attempt for that option', status => {
    const { input, decisions } = completeContractModel();
    input.evidence.commands.push({ ...input.evidence.commands[0], status, options: ['--format'] });
    const report = buildAudit(input, decisions);
    expect(report.optionEvidence.find((row: { option: string }) => row.option === '--format').status)
      .toBe(['running', 'incomplete'].includes(status) ? 'incomplete' : status);
    expect(report.optionEvidence.find((row: { option: string }) => row.option === '--workspace').status).toBe('passed');
    expect(report.optionCoverageComplete).toBe(false);
  });
});

describe('private blocked audit attempts', () => {
  const directories: string[] = [];
  afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }); });
  test('schema subprocess excludes ambient injection, credentials and routing while retaining operational settings', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'eai-audit-schema-env-'))); directories.push(root);
    const output = join(root, 'audit'), cli = join(root, 'dist', 'index.js'), observation = join(root, 'child.json');
    const preload = join(root, 'preload.cjs'), injected = join(root, 'injected');
    mkdirSync(join(root, 'dist')); mkdirSync(join(root, 'resources'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '3.19.3' }));
    writeFileSync(preload, `if (process.argv[1] === ${JSON.stringify(cli)}) require('node:fs').writeFileSync(${JSON.stringify(injected)}, 'child-preload');\n`);
    writeFileSync(cli, `require('node:fs').writeFileSync(${JSON.stringify(observation)}, JSON.stringify({
      nodeOptions: !!process.env.NODE_OPTIONS, npm: !!process.env.NPM_TOKEN, github: !!process.env.GH_TOKEN,
      azure: !!process.env.AZURE_CLIENT_SECRET, route: !!process.env.BASE_URL_PUBLIC_API, profile: !!process.env.EAI_PROFILE,
      home: process.env.HOME, path: process.env.PATH, language: process.env.LANG }));
      console.log(JSON.stringify({command:'eai',subcommands:[{command:'verify'}]}));\n`);
    const env = { ...process.env, HOME: root, USERPROFILE: root, LANG: 'C.UTF-8', NODE_OPTIONS: '--require=' + preload,
      NPM_TOKEN: 'synthetic-npm', GH_TOKEN: 'synthetic-github', AZURE_CLIENT_SECRET: 'synthetic-azure',
      BASE_URL_PUBLIC_API: 'https://example.invalid/ambient', EAI_PROFILE: 'ambient-profile' };
    const result = spawnSync(process.execPath, [resolve('scripts/audit-cli-backend.cjs'), '--cli', cli, '--output', output], {
      encoding: 'utf8', timeout: 10000, env,
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(observation, 'utf8'))).toEqual({ nodeOptions: false, npm: false, github: false,
      azure: false, route: false, profile: false, home: root, path: process.env.PATH, language: 'C.UTF-8' });
    expect(() => statSync(injected)).toThrow();
    expect(qa.readPrivate(join(output, 'capabilities.json')).backendCertified).toBe(false);
  });
  test('a normal source inventory persists its matrix without claiming executed capability', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'eai-audit-inventory-'))); directories.push(root);
    const output = join(root, 'audit');
    const result = spawnSync(process.execPath, [resolve('scripts/audit-cli-backend.cjs'), '--cli', resolve('dist/index.js'), '--output', output], {
      encoding: 'utf8', timeout: 10000, env: { ...process.env, EAI_DISABLE_KV_AUTO_FETCH: '1' },
    });
    expect(result.status).toBe(0); const report = qa.readPrivate(join(output, 'capabilities.json'));
    expect(report.commands.length).toBeGreaterThan(100); expect(report.backendCertified).toBe(false); expect(report.fullCapabilityQualified).toBe(false);
    expect(report.evidenceValidation).toEqual({ valid: true, malformedAttempts: [] });
  });
  test.each(['candidate', 'evidence-missing', 'evidence-malformed', 'deployments-missing', 'deployments-malformed',
    'build-receipt-missing', 'build-receipt-malformed'])('retains sanitized %s failure in new private output', failure => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'eai-audit-blocked-'))); directories.push(root);
    const output = join(root, 'audit'), input = join(root, 'input.json');
    let cli = resolve('dist/index.js'); const args = ['--output', output];
    if (failure === 'candidate') {
      cli = join(root, 'broken-cli.cjs'); writeFileSync(cli, JSON.stringify('unused'));
      writeFileSync(cli, "console.log(JSON.stringify({command:'eai',subcommands:[{command:'verify'}]}));\n");
    } else {
      const flag = '--' + failure.replace(/-(missing|malformed)$/, ''); args.push(flag, input);
      if (failure.endsWith('malformed')) writeFileSync(input, '{synthetic-input-marker', { mode: 0o600 });
    }
    const result = spawnSync(process.execPath, [resolve('scripts/audit-cli-backend.cjs'), '--cli', cli, ...args], {
      encoding: 'utf8', timeout: 10000, env: { ...process.env, EAI_DISABLE_KV_AUTO_FETCH: '1' },
    });
    expect(result.status).toBe(1); const report = qa.readPrivate(join(output, 'capabilities.json'));
    expect(report).toMatchObject({ schemaVersion: 'eai.cli-backend-audit.v2', status: 'blocked',
      backendCertified: false, fullCapabilityQualified: false, cleanupVerified: false });
    expect(statSync(join(output, 'capabilities.json')).mode & 0o777).toBe(0o600);
    expect(statSync(join(output, 'capabilities.md')).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(report) + readFileSync(join(output, 'capabilities.md'), 'utf8') + result.stderr)
      .not.toContain('synthetic-input-marker');
  });
});

describe('local dedicated tenant harness ownership', () => {
  const directories: string[] = [];
  afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

  function resourceJournal() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'eai-local-resource-type-'))); directories.push(root);
    const path = join(root, 'creation.json'), id = '00000000-0000-4000-8000-000000000088';
    qa.writePrivate(path, { phase: 'verified', reconciliationVerified: true, acknowledgmentBound: true,
      childTenantId: '00000000-0000-4000-8000-000000000099', parentTenantId: 'parent-fixture',
      publicApiUrl: 'http://localhost:8000', resources: [], resourceCleanupUnverified: false });
    return { path, id, owner: require('../../scripts/cli-local-child-ownership.cjs') };
  }
  test.each(['missing', 'wrong'])('a %s acknowledged resource type cannot enter the ownership journal', failure => {
    const { path, id, owner } = resourceJournal(), type = 'tenant-pg-note';
    const body = { id, ...(failure === 'wrong' ? { type: 'tenant-search-note' } : {}) };
    expect(() => owner.resourceObservation(path, 'resource-created', type, id, body, 0)).toThrow('unverified');
    expect(qa.readPrivate(path).resources).toEqual([]);
    expect(qa.readPrivate(path).resourceCleanupUnverified).toBe(true);
  });
  test.each(['tenant-pg-note', 'tenant-document-note', 'tenant-blob-note', 'tenant-search-note'])
    ('the real create output for %s preserves its exact type before ownership', type => {
      const { path, id, owner } = resourceJournal();
      const body = buildCreateResourceOutput(type, { title: 'synthetic' }, { id, data: { title: 'synthetic' } });
      expect(() => owner.resourceObservation(path, 'resource-created', type, id, body, 0)).not.toThrow();
      expect(qa.readPrivate(path).resources).toEqual([expect.objectContaining({ type, id })]);
    });

  function runFixture(mode: string, api = 'http://localhost:8000', ambient: Record<string, string> = {}, operatorConfig?: string) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'eai-local-harness-test-')));
    directories.push(root);
    const bin = join(root, 'bin'); mkdirSync(bin, { mode: 0o700 });
    const profileRoot = join(root, '.eai'); mkdirSync(profileRoot, { mode: 0o700 });
    writeFileSync(join(profileRoot, 'config.json'), JSON.stringify({ profiles: { local: {
      publicApiUrl: 'http://localhost:8000', authTenantName: 'fixture', authTenantId: 'fixture', authClientId: 'fixture',
    } } }), { mode: 0o600 });
    const log = join(root, 'commands.jsonl'), envLog = join(root, 'environment.jsonl');
    if (operatorConfig) writeFileSync(join(root, '.npmrc'), operatorConfig, { mode: 0o600 });
    // Actual harness/helper bytes in a small owned source tree; no PATH build stub.
    const fixtureCli = join(root, 'owned-cli'), fixtureScripts = join(fixtureCli, 'scripts');
    mkdirSync(fixtureScripts, { recursive: true, mode: 0o700 }); mkdirSync(join(fixtureCli, 'dist', 'lib'), { recursive: true });
    for (const name of ['test-local-dedicated-tenant-lifecycle.sh', 'cli-local-child-ownership.cjs',
      'cli-qa-foundation.cjs', 'cli-qa-operational-env.cjs', 'cli-qa-npm-execution.cjs']) {
      writeFileSync(join(fixtureScripts, name), readFileSync(resolve('scripts', name)));
    }
    if (mode.startsWith('parent-cleanup-')) {
      // Seed only owned fixture IDs; the actual cleanup function remains byte-identical.
      const path = join(fixtureScripts, 'test-local-dedicated-tenant-lifecycle.sh');
      let fixtureSource = readFileSync(path, 'utf8');
      for (const key of ['PG_ID', 'DOCDB_ID', 'BLOB_ID', 'SEARCH_ID']) fixtureSource = fixtureSource.replace(`${key}=""`, `${key}="synthetic-owned-resource"`);
      writeFileSync(path, fixtureSource);
    }
    writeFileSync(join(fixtureCli, 'package.json'), JSON.stringify({ name: 'owned-bash-build-fixture', type: 'module',
      scripts: { build: 'node build.cjs' } }));
    writeFileSync(join(fixtureCli, 'build.cjs'), `require('node:fs').appendFileSync(${JSON.stringify(envLog)},JSON.stringify({source:'build',forbidden:Object.keys(process.env).filter(key=>/^(EAI_ACCESS_TOKEN|NODE_OPTIONS|NPM_TOKEN|GH_TOKEN|AZURE_CLIENT_SECRET|BASE_URL_PUBLIC_API)$/.test(key)),home:process.env.HOME})+'\\n');\n`);
    writeFileSync(join(fixtureCli, 'dist', 'index.js'), `import ${JSON.stringify(join(root, 'mock.cjs'))};\n`);
    writeFileSync(join(fixtureCli, 'dist', 'lib', 'profile.js'), `import fs from 'node:fs'; export const setActiveProfile = () => {}; export const captureProfileConfig = name => JSON.parse(fs.readFileSync(process.env.HOME+'/.eai/config.json','utf8')).profiles[name];\n`);
    writeFileSync(join(fixtureCli, 'dist', 'lib', 'auth.js'), `export const getAccessToken = async () => { globalThis.fetch = async () => ({ text: async () => JSON.stringify({ docs: ['TenantPgNote','TenantDocumentNote','TenantBlobNote','TenantSearchNote'].map(name => ({name})) }) }); return 'synthetic'; };\n`);
    const mock = join(root, 'mock.cjs');
    writeFileSync(mock, `const fs = require('node:fs');
const args = process.argv[1] === ${JSON.stringify(mock)} ? process.argv.slice(2) : [process.argv[1], ...process.argv.slice(2)];
fs.appendFileSync(${JSON.stringify(envLog)}, JSON.stringify({ source: 'cli', forbidden: Object.keys(process.env).filter(key =>
  /^(EAI_ACCESS_TOKEN|NODE_OPTIONS|NPM_TOKEN|GH_TOKEN|AZURE_CLIENT_SECRET|BASE_URL_PUBLIC_API)$/.test(key)),
  home: process.env.HOME, profile: args[args.indexOf('--profile')+1] }) + '\\n');
fs.appendFileSync(process.env.EAI_HARNESS_TEST_LOG, JSON.stringify(args) + '\\n');
const lifecycle = process.env.EAI_HARNESS_TEST_MODE.startsWith('parent-resource-') || process.env.EAI_HARNESS_TEST_MODE === 'parent-lifecycle-success';
const resourceId = '00000000-0000-4000-8000-000000000088';
if (lifecycle && args.includes('provision')) {
  console.log(JSON.stringify({results:['tenant-postgresql-base','tenant-documentdb-base','tenant-blob-base','tenant-search-base','tenant-platform-metadata'].map(objectType=>({objectType,status:'provisioned'}))}));
} else if (lifecycle && args.includes('types') && args.includes('seed')) {
  console.log(JSON.stringify({tenants:[{failed:0}]}));
} else if (lifecycle && args.includes('resources')) {
  const action = args[args.indexOf('resources')+1], type = args[args.indexOf('resources')+2];
  const mode = process.env.EAI_HARNESS_TEST_MODE;
  if (action === 'schema') console.log(JSON.stringify({objectTypes:['TenantPgNote','TenantDocumentNote','TenantBlobNote','TenantSearchNote'].map(name=>({name}))}));
  else if (action === 'create') console.log(JSON.stringify({type,id:resourceId}));
  else if (action === 'get' || action === 'update') console.log(JSON.stringify({data:{title:type === 'tenant-pg-note' ? 'pg note'+(action === 'update'?' updated':'') : type === 'tenant-document-note' ? 'doc note'+(action === 'update'?' updated':'') : type === 'tenant-blob-note' ? 'blob note'+(action === 'update'?' updated':'') : 'search note'+(action === 'update'?' updated':'')}}));
  else if (action === 'search') console.log(JSON.stringify({results:[{id:resourceId}]}));
  else if (action === 'delete') {
    if (mode === 'parent-resource-main-delete-failed') process.exit(75);
    console.log(JSON.stringify({type,id:mode === 'parent-resource-malformed-delete' ? 'foreign-id' : args[args.indexOf('delete')+2],deleted:true}));
  } else process.exit(76);
} else if (lifecycle && args.includes('publicapi') && args.includes('get') && args.some(value=>value.startsWith('/v4/data/resources/'))) {
  const path = args[args.indexOf('get')+1], tenantId = args[args.indexOf('--tenant-id')+1], mode = process.env.EAI_HARNESS_TEST_MODE;
  const status = mode === 'parent-resource-missing-absence' ? 200 : 404;
  console.log(JSON.stringify({ok:status===200,status,request:{method:'GET',path,tenantId:mode === 'parent-resource-absence-foreign' ? 'foreign-child' : tenantId,publicApiUrl:'http://localhost:8000'},body:status===404?{error:{code:'NOT_FOUND'}}:{id:resourceId}}));
  if (status === 404) process.exit(1);
} else if (args.includes('list')) {
  const tenants = [{id:'parent-fixture',slug:'parent'},{id:'unrelated-fixture',slug:'coworker-workspace'}];
  const acknowledgment = process.env.EAI_HARNESS_TEST_LOG + '.create';
  if ((process.env.EAI_HARNESS_TEST_MODE.startsWith('parent-') || process.env.EAI_HARNESS_TEST_MODE === 'ack-ambiguous') && fs.existsSync(acknowledgment)) {
    const created = JSON.parse(fs.readFileSync(acknowledgment, 'utf8'));
    tenants.push({id:'00000000-0000-4000-8000-000000000099',slug:created.slug,
      ...(process.env.EAI_HARNESS_TEST_MODE === 'parent-missing' ? {} : {parentId:process.env.EAI_HARNESS_TEST_MODE === 'parent-wrong' ? 'foreign-parent' : created.parent})});
    if (process.env.EAI_HARNESS_TEST_MODE === 'ack-ambiguous') tenants.push({id:'00000000-0000-4000-8000-000000000098',slug:created.slug,parentId:created.parent});
  }
  console.log(JSON.stringify({tenants}));
} else if (args.includes('create')) {
  if (process.env.EAI_HARNESS_TEST_MODE === 'quota') { console.error('TENANT_QUOTA_EXCEEDED'); process.exit(1); }
  fs.writeFileSync(process.env.EAI_HARNESS_TEST_LOG + '.create', JSON.stringify({slug:args[args.indexOf('--slug')+1],parent:args[args.indexOf('--parent')+1]}), {mode:0o600});
  console.log(JSON.stringify({tenant:{id:'00000000-0000-4000-8000-000000000099',slug:args[args.indexOf('--slug')+1],parentTenantId:args[args.indexOf('--parent')+1]}}));
} else if (process.env.EAI_HARNESS_TEST_MODE.startsWith('parent-') && args.includes('select')) {
  if (process.env.EAI_HARNESS_TEST_MODE === 'parent-cleanup-journal' && args.includes('00000000-0000-4000-8000-000000000099')) {
    const directory = fs.readdirSync(${JSON.stringify(root)}).find(name=>name.startsWith('eai-local-e2e-creation-'));
    const path = ${JSON.stringify(root)}+'/'+directory+'/creation.json', journal=JSON.parse(fs.readFileSync(path,'utf8'));
    journal.phase='unresolved';fs.writeFileSync(path,JSON.stringify(journal));
  }
  console.log(JSON.stringify({selected:true,id:args[args.indexOf('select')+1]}));
} else if (process.env.EAI_HARNESS_TEST_MODE.startsWith('parent-') && args.includes('delete')) {
  const mode = process.env.EAI_HARNESS_TEST_MODE, id = args[args.indexOf('delete')+1], parent = args[args.indexOf('--parent')+1];
  if (mode === 'parent-delete-failed') process.exit(75);
  fs.writeFileSync(process.env.EAI_HARNESS_TEST_LOG + '.delete', 'attempted');
  console.log(JSON.stringify({id:mode === 'parent-delete-wrong-id' ? 'foreign-child' : id,deleted:true,
    hardPurged:args.includes('--force-hard-purge') && mode !== 'parent-delete-soft',
    response:{id,status:mode === 'parent-delete-soft' ? 'deleted' : 'hard_purged',parentTenantId:parent}}));
} else if (args.includes('get') && args.some(value => value.includes('/children?'))) {
  const mode = process.env.EAI_HARNESS_TEST_MODE, path = args[args.indexOf('get')+1], tenantId = args[args.indexOf('--tenant-id')+1];
  const body = mode === 'parent-inventory-malformed' ? {items:[]} : mode === 'parent-inventory-overflow'
    ? Array.from({length:100}, (_,index) => ({id:'foreign-'+index})) : mode === 'parent-still-present'
      ? [{id:'00000000-0000-4000-8000-000000000099'}] : [];
  console.log(JSON.stringify({ok:true,status:200,request:{method:'GET',path,tenantId,publicApiUrl:'http://localhost:8000'},body}));
} else { console.error('Unexpected tenant/storage mutation'); process.exit(75); }
`.replaceAll('process.env.EAI_HARNESS_TEST_LOG', JSON.stringify(log)).replaceAll('process.env.EAI_HARNESS_TEST_MODE', JSON.stringify(mode)));
    // Controlled parse/stamp faults live only in owned fixture copies; runtime selection is real.
    const bashPath = join(fixtureScripts, 'test-local-dedicated-tenant-lifecycle.sh');
    if (mode === 'parent-parse-failed' || mode === 'parent-cleanup-cached') {
      const assignment = 'TENANT_ID="$(json_field "$CREATE_JSON" "data.tenant.doc?.id ?? data.tenant.id")"';
      writeFileSync(bashPath, readFileSync(bashPath, 'utf8').replace(assignment,
        mode === 'parent-parse-failed' ? 'TENANT_ID="$(false)"' : 'TENANT_ID="00000000-0000-4000-8000-000000000098"'));
    }
    if (mode === 'parent-cleanup-stamp') {
      const path = join(fixtureScripts, 'cli-local-child-ownership.cjs');
      writeFileSync(path, readFileSync(path, 'utf8').replace("if (mode === 'cleanup-attempted') {", "if (mode === 'cleanup-attempted') { throw new Error('Controlled stamp refusal');"));
    }
    // A trusted operator HOME installation points to the real current Node; foreign hints do not.
    const nodeVersion = process.version;
    const ownedNode = join(root, '.nvm', 'versions', 'node', nodeVersion, 'bin', 'node');
    mkdirSync(dirname(ownedNode), { recursive: true, mode: 0o700 }); symlinkSync(process.execPath, ownedNode);
    const nodeLog = join(root, 'path-node.log');
    const hintEnv: Record<string, string> = {};
    if (mode.startsWith('node-hint-')) {
      const hostile = mode === 'node-hint-traversal'
        ? join(root, '.nvm', 'versions', 'node') + '/' + nodeVersion + '/../../../injected/bin/node'
        : join(root, 'other-home', '.nvm', 'versions', 'node', nodeVersion, 'bin', 'node');
      mkdirSync(dirname(resolve(hostile)), { recursive: true, mode: 0o700 });
      writeFileSync(resolve(hostile), `#!/usr/bin/env bash\nprintf 'hint-intercepted\\n' >> '${nodeLog}'\nif [[ "\${1:-}" == '--version' ]]; then printf '${nodeVersion}\\n'; fi\nexit 0\n`, { mode: 0o700 });
      Object.assign(hintEnv, mode === 'node-hint-nvm' ? { npm_node_execpath: '', NVM_BIN: dirname(hostile) }
        : { npm_node_execpath: hostile, NVM_BIN: '' });
    }
    writeFileSync(join(bin, 'node'), mode === 'node-shadow'
      ? `#!/usr/bin/env bash\nprintf 'intercepted\\n' >> '${nodeLog}'\nexit 0\n`
      : `#!/usr/bin/env bash\nif [[ "\${1:-}" == */dist/index.js ]]; then exec '${process.execPath}' '${mock}' "$@"; fi\nexec '${process.execPath}' "$@"\n`, { mode: 0o700 });
    writeFileSync(join(bin, 'npm'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(envLog)},JSON.stringify({source:'build',forbidden:Object.keys(process.env).filter(key=>/^(EAI_ACCESS_TOKEN|NODE_OPTIONS|NPM_TOKEN|GH_TOKEN|AZURE_CLIENT_SECRET|BASE_URL_PUBLIC_API)$/.test(key)),home:process.env.HOME})+'\\n');\n`, { mode: 0o700 });
    const dockerLog = join(root, 'docker.log');
    writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${dockerLog}'\nif [[ "$*" == *SEARCH_DEFAULT_API_KEY* ]]; then echo fixture-search-key; exit 0; fi\nexit 77\n`, { mode: 0o700 });
    const result = spawnSync('bash', [join(fixtureScripts, 'test-local-dedicated-tenant-lifecycle.sh')], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, ...ambient, ...hintEnv, HOME: root, USERPROFILE: root, TMPDIR: root, PATH: `${bin}:${process.env.PATH}`,
        EAI_E2E_PROFILE: 'local', EAI_E2E_PUBLIC_API_URL: api, EAI_E2E_PARENT_TENANT_ID: 'parent-fixture',
        EAI_HARNESS_TEST_LOG: log, EAI_HARNESS_TEST_MODE: mode },
    });
    let calls: string[][] = [];
    try { calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { /* blocked before CLI calls */ }
    const journals = readdirSync(root).filter(name => name.startsWith('eai-local-e2e-creation-')).map(name => join(root, name, 'creation.json'));
    const environments = existsSync(envLog) ? readFileSync(envLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    const dockerCalls = existsSync(dockerLog) ? readFileSync(dockerLog, 'utf8').split('\n').filter(Boolean) : [];
    return { ...result, calls, journals, environments, dockerCalls, nodeIntercepted: existsSync(nodeLog), root, cliPath: join(fixtureCli, 'dist', 'index.js') };
  }

  test.each(['other-home', 'nvm', 'traversal'])('a hostile %s Node installation hint never runs before preflight', failure => {
    const result = runFixture('node-hint-' + failure, 'https://dev-api.au.myenterprise.ai/public');
    expect(result.nodeIntercepted).toBe(false); expect(result.stderr).toContain('HTTP loopback');
    expect(result.calls).toEqual([]); expect(result.dockerCalls).toEqual([]);
  });
  test('the standalone harness pins installed Node before loopback, profile, journal or build helpers', () => {
    const result = runFixture('node-shadow', 'https://dev-api.au.myenterprise.ai/public');
    expect(result.nodeIntercepted).toBe(false); expect(result.stderr).toContain('HTTP loopback');
    expect(result.calls).toEqual([]); expect(result.dockerCalls).toEqual([]);
  });
  test('a complete controlled local lifecycle retains four exact resource deletion and absence receipts', () => {
    const result = runFixture('parent-lifecycle-success');
    expect(result.status).toBe(0); expect(result.stdout).toContain('lifecycle E2E passed');
    const journal = qa.readPrivate(result.journals[0]);
    expect(journal.resources).toHaveLength(4); expect(journal.resourcesCleanupVerified).toBe(true);
    expect(journal.resources.every((row: any) => row.deleteAcknowledged === true && row.absenceVerified === true
      && row.deleteExitCode === 0 && row.absenceHttpStatus === 404)).toBe(true);
  });
  test.each(['missing-absence', 'malformed-delete', 'absence-foreign', 'main-delete-failed'])('resource %s remains unverified while owned child purge is still attempted', failure => {
    const result = runFixture('parent-resource-' + failure);
    expect(result.status).not.toBe(0); expect(result.stdout).not.toContain('lifecycle E2E passed');
    const journal = qa.readPrivate(result.journals[0]);
    expect(journal.resourcesCleanupVerified).toBe(false); expect(journal.cleanupVerified).toBe(false);
    expect(journal.hardPurgeVerified).toBe(true); expect(journal.absenceVerified).toBe(true);
    expect(result.calls.some(args => args.includes('tenant') && args.includes('delete') && args.includes('--force-hard-purge'))).toBe(true);
    if (failure === 'main-delete-failed') expect(result.calls.filter(args => args.includes('resources') && args.includes('delete')).length).toBeGreaterThan(0);
  });

  test('standalone CLI and build subprocesses ignore ambient credentials and routing', () => {
    const result = runFixture('quota', 'http://localhost:8000', { EAI_ACCESS_TOKEN: 'synthetic-foreign-token',
      NODE_OPTIONS: '--conditions=synthetic', NPM_TOKEN: 'synthetic-npm', GH_TOKEN: 'synthetic-gh',
      AZURE_CLIENT_SECRET: 'synthetic-azure', BASE_URL_PUBLIC_API: 'https://foreign.example.invalid' });
    expect(result.stderr).toContain('TENANT_QUOTA_EXCEEDED');
    expect(result.environments.some(row => row.source === 'build')).toBe(true);
    expect(result.environments.some(row => row.source === 'cli')).toBe(true);
    for (const row of result.environments) {
      expect(row.forbidden).toEqual([]); expect(row.home).toBe(result.root);
      if (row.source === 'cli') expect(row.profile).toBe('local');
    }
  });
  test('actual standalone Bash build isolates operator npm configuration while retaining the selected profile home', () => {
    const result = runFixture('quota', 'http://localhost:8000', {}, 'node-options=--conditions=synthetic-operator-config\n');
    expect(result.stderr).toContain('TENANT_QUOTA_EXCEEDED');
    const builds = result.environments.filter(row => row.source === 'build');
    expect(builds).toHaveLength(1); expect(builds[0].forbidden).toEqual([]); expect(builds[0].home).toBe(result.root);
    expect(result.calls.filter(args => args.includes('create'))).toHaveLength(1);
  });
  test.each(['journal', 'cached', 'stamp'])('cleanup %s failure refuses every remote resource/tenant/storage delete', failure => {
    const result = runFixture('parent-cleanup-' + failure);
    expect(result.status).not.toBe(0);
    expect(result.calls.filter(args => args.includes('delete'))).toEqual([]);
    expect(result.dockerCalls.filter(args => /DELETE FROM|DROP DATABASE|dropDatabase|python -/.test(args))).toEqual([]);
    expect(result.journals).toHaveLength(1); expect(qa.readPrivate(result.journals[0]).cleanupVerified).toBe(false);
  });

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
  test.each(['parent-wrong', 'parent-missing'] as const)('a new matching slug with %s cannot authorize select, provisioning or cleanup', mode => {
    const result = runFixture(mode);
    expect(result.status).not.toBe(0);
    expect(result.calls.filter(args => args.includes('create'))).toHaveLength(1);
    expect(result.calls.filter(args => args.includes('select') || args.includes('provision') || args.includes('delete'))).toHaveLength(0);
  });
  test('a unique newly visible matching child with its exact requested parent passes the ownership boundary', () => {
    const result = runFixture('parent-valid');
    // Actual reconciliation and selection succeed; the mock stops at provisioning.
    // Cleanup executes its real Bash/helper path without a real provider/network mutation.
    expect(result.status).not.toBe(0);
    expect(result.calls.some(args => args.includes('select') && args.includes('00000000-0000-4000-8000-000000000099'))).toBe(true);
    expect(result.calls.filter(args => args.includes('delete'))).toEqual([
      [result.cliPath, '--profile', 'local', 'tenant', 'delete', '00000000-0000-4000-8000-000000000099',
        '--parent', 'parent-fixture', '--force', '--force-hard-purge', '--format', 'json'],
    ]);
    expect(result.journals).toHaveLength(1);
    expect(JSON.parse(readFileSync(result.journals[0], 'utf8'))).toMatchObject({ phase: 'verified',
      reconciliationVerified: true, acknowledgmentBound: true, cleanupAttempted: true,
      childTenantId: '00000000-0000-4000-8000-000000000099', cleanupVerified: true, hardPurgeVerified: true, absenceVerified: true });
    expect(result.calls.some(args => args.includes('/v4/platform/tenants/parent-fixture/children?limit=100&offset=0'))).toBe(true);
    expect(result.stdout).not.toContain('lifecycle E2E passed');
  });
  test('an acknowledged reconciled child is purged from its journal when tenant ID parsing fails', () => {
    const result = runFixture('parent-parse-failed');
    expect(result.status).not.toBe(0); expect(result.calls.some(args => args.includes('provision'))).toBe(false);
    expect(result.calls.filter(args => args.includes('delete'))).toEqual([
      [result.cliPath, '--profile', 'local', 'tenant', 'delete', '00000000-0000-4000-8000-000000000099',
        '--parent', 'parent-fixture', '--force', '--force-hard-purge', '--format', 'json'],
    ]);
    expect(result.journals).toHaveLength(1);
    expect(JSON.parse(readFileSync(result.journals[0], 'utf8'))).toMatchObject({ phase: 'verified',
      reconciliationVerified: true, acknowledgmentBound: true, cleanupVerified: true, hardPurgeVerified: true, absenceVerified: true });
  });
  test.each(['parent-delete-failed', 'parent-delete-soft', 'parent-delete-wrong-id', 'parent-still-present',
    'parent-inventory-malformed', 'parent-inventory-overflow'])('%s cannot certify standalone child cleanup', mode => {
    const result = runFixture(mode); expect(result.status).not.toBe(0); expect(result.stdout).not.toContain('lifecycle E2E passed');
    expect(result.calls.filter(args => args.includes('delete'))).toHaveLength(1);
    expect(result.dockerCalls.filter(args => /DELETE FROM|DROP DATABASE|dropDatabase|python -/.test(args))).toEqual([]);
    expect(JSON.parse(readFileSync(result.journals[0], 'utf8'))).toMatchObject({ cleanupAttempted: true, cleanupVerified: false });
  });
  test.each(['ack-absent', 'ack-ambiguous'] as const)('retains an exact create acknowledgment when list reconciliation is %s without guessing cleanup', mode => {
    const result = runFixture(mode);
    expect(result.status).not.toBe(0); expect(result.calls.filter(args => args.includes('create'))).toHaveLength(1);
    expect(result.calls.filter(args => args.includes('select') || args.includes('provision') || args.includes('delete'))).toHaveLength(0);
    expect(result.journals).toHaveLength(1);
    const journal = JSON.parse(readFileSync(result.journals[0], 'utf8'));
    expect(journal).toMatchObject({ childTenantId: '00000000-0000-4000-8000-000000000099', parentTenantId: 'parent-fixture',
      creationExitCode: 0, acknowledgmentBound: true, phase: 'unresolved', cleanupAttempted: false });
    expect(statSync(result.journals[0]).mode & 0o777).toBe(0o600);
  });
  test('rejects a deployed API before Docker or CLI mutation', () => {
    const result = runFixture('quota', 'https://dev-api.au.myenterprise.ai/public');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('HTTP loopback');
    expect(result.calls).toHaveLength(0);
  });
});
