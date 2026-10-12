import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { buildAudit, markdown } = require('../../scripts/audit-cli-backend.cjs');
const qa = require('../../scripts/cli-qa-foundation.cjs');
const schema = { command: 'eai', subcommands: [
  { command: 'verify', hasAction: true, subcommands: [{ command: 'calls' }] },
  { command: 'workspace', aliases: ['tenant'], subcommands: [{ command: 'list' }] },
  { command: 'types', subcommands: [{ command: 'define' }] },
] };
const commands = ['eai verify', 'eai verify calls', 'eai workspace list', 'eai types define'];
const decisions = commands.map(command => ({ command, crud: 'read', coverage: 'live', notes: 'fixture', cleanupMechanism: 'none', cleanupVerified: 'read only' }));
const candidate = { gitSha: 'a'.repeat(40), binarySha256: 'b'.repeat(64), runtimeSha256: 'c'.repeat(64),
  version: '3.19.1', runtimeFileCount: 200, dirty: false };
interface AuditAssertion { name: string; command: string; executionId: string; status: string; option?: string; alias?: string }

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
    const authorizationEvidence = { schemaVersion: 'eai.cli-authorization-evidence.v1', fixtureId: id(30), runId,
      status: 'passed', qualification: 'normal-cli-profiles', qualified: true, environment: 'DEV', publicApiUrl,
      candidate, actors, tenantIds, foundationVerified: true, cleanupVerified: true, localCleanupVerified: true, completedAt: observedAt,
      publishedFixture: ['a', 'b'].map((slot, index) => ({ tenantId: tenantIds[slot as 'a' | 'b'],
        definitionId: id(40 + index), objectType, nonceField: 'qaNonce', schemaVersion: 1,
        publicationStatus: 'published', propertyFingerprintSha256: 'a'.repeat(64) })),
      created, cleanup: created.map(row => ({ creatorSlot: row.creatorSlot, tenantId: row.tenantId, resourceId: row.resourceId,
        profile: actors[qa.SLOTS[row.creatorSlot][0] === 'a' ? 'adminA' : 'adminB'].profile,
        status: 'passed', deleteAcknowledged: true, absenceVerified: true, deleteHttpStatus: 200, absenceHttpStatus: 404 })), leftovers: [],
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
      exitCode: 0, nodeVersion: 'v24.12.0', observedAt };
    const schema = { command: 'eai', subcommands: [{ command: 'workspace', aliases: ['tenant'],
      subcommands: [{ command: 'list', options: [{ name: '--format' }, { name: '--workspace,' }] }] }] };
    const decisions = [{ command: 'eai workspace list', crud: 'read', coverage: 'live', notes: 'fixture' }];
    const executionId = id(90), aliasExecutionId = id(91);
    const assertions: AuditAssertion[] = [
      { name: 'exact inventory', command: 'eai workspace list', executionId, status: 'passed' },
      ...['--format', '--workspace'].map(option => ({ name: 'verified ' + option, command: 'eai workspace list', executionId, option, status: 'passed' })),
    ];
    const evidence = { candidate, environment: 'DEV', expectedPublicApi: publicApiUrl, cleanupVerified: true, authorizationEvidence,
      commands: [{ command: 'eai workspace list', executionId, status: 'passed', coverageComplete: true, assertions, options: ['--format', '--workspace'] }],
      aliases: [{ alias: 'eai tenant list', command: 'eai workspace list', executionId: aliasExecutionId, status: 'passed', coverageComplete: true,
        assertions: [{ name: 'exact alias inventory', command: 'eai workspace list', alias: 'eai tenant list',
          executionId: aliasExecutionId, status: 'passed' } as AuditAssertion] }] };
    return { input: { schema, candidate, evidence, buildReceipt, deployments, now }, decisions };
  }

  test('joins build, role, selected deployment and normalized option contracts without claiming missing cycles', () => {
    const { input, decisions } = completeContractModel(), report = buildAudit(input, decisions);
    expect(report.candidateVerified).toBe(true); expect(report.parityComplete).toBe(true); expect(report.authorizationVerified).toBe(true);
    expect(report.optionCoverageComplete).toBe(true); expect(report.aliasCoverageComplete).toBe(true); expect(report.backendCertified).toBe(true);
    expect(report.fullCapabilityQualified).toBe(false);
  });
  function addCompleteCycleModel(input: ReturnType<typeof completeContractModel>['input']) {
    // A synthetic consumer DTO model, never a live qualification observation.
    const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
    const authorization = input.evidence.authorizationEvidence;
    const cycleEvidence = { schemaVersion: 'eai.cli-permanent-cycles.v1', qualified: true, qualification: 'normal-cli-profiles', status: 'passed',
      fixtureId: authorization.fixtureId, environment: authorization.environment, publicApiUrl: authorization.publicApiUrl,
      candidate: input.candidate, actors: structuredClone(authorization.actors), tenantIds: structuredClone(authorization.tenantIds),
      completedAt: authorization.completedAt, cycles: Array.from({ length: 10 }, (_, index) => ({
        clientId: id(100 + index), tenantId: id(200 + index), appKey: 'eai-e2e-fixture-' + index, status: 'passed',
        enrollmentId: id(300 + index), recreatedEnrollmentId: id(400 + index), rotationDispatches: 1,
        credentialChanged: true, firstInventoryEmpty: true, recreatedSameKey: true, cleanupVerified: true,
        localProjectCleanupVerified: true, registrationAbsent: true, deletionVerified: true, appBuildVerified: true,
      })) };
    Object.assign(input.evidence, { cycleEvidence }); return cycleEvidence;
  }
  test('a complete matching fixture/workspace/actor model can qualify the combined consumer', () => {
    const { input, decisions } = completeContractModel(); addCompleteCycleModel(input);
    expect(buildAudit(input, decisions).fullCapabilityQualified).toBe(true);
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
    expect(qa.cyclesVerified(input.evidence, input.candidate, { environment: 'DEV', publicApiUrl: authorizationUrl(input), now: input.now })).toBe(true);
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

  function runFixture(mode: string, api = 'http://localhost:8000') {
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
`);
    writeFileSync(join(bin, 'node'), `#!/usr/bin/env bash\nif [[ "\${1:-}" == */dist/index.js ]]; then exec '${process.execPath}' '${mock}' "$@"; fi\nexec '${process.execPath}' "$@"\n`, { mode: 0o700 });
    writeFileSync(join(bin, 'npm'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o700 });
    writeFileSync(join(bin, 'docker'), '#!/usr/bin/env bash\nif [[ "$*" == *SEARCH_DEFAULT_API_KEY* ]]; then echo fixture-search-key; exit 0; fi\nexit 77\n', { mode: 0o700 });
    const result = spawnSync('bash', [resolve('scripts/test-local-dedicated-tenant-lifecycle.sh')], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, HOME: root, USERPROFILE: root, TMPDIR: root, PATH: `${bin}:${process.env.PATH}`,
        EAI_E2E_PROFILE: 'local', EAI_E2E_PUBLIC_API_URL: api, EAI_E2E_PARENT_TENANT_ID: 'parent-fixture',
        EAI_HARNESS_TEST_LOG: log, EAI_HARNESS_TEST_MODE: mode },
    });
    let calls: string[][] = [];
    try { calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { /* blocked before CLI calls */ }
    const journals = readdirSync(root).filter(name => name.startsWith('eai-local-e2e-creation-')).map(name => join(root, name, 'creation.json'));
    return { ...result, calls, journals };
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
      [resolve('dist/index.js'), '--profile', 'local', 'tenant', 'delete', '00000000-0000-4000-8000-000000000099',
        '--parent', 'parent-fixture', '--force', '--force-hard-purge', '--format', 'json'],
    ]);
    expect(result.journals).toHaveLength(1);
    expect(JSON.parse(readFileSync(result.journals[0], 'utf8'))).toMatchObject({ phase: 'verified',
      reconciliationVerified: true, acknowledgmentBound: true, cleanupAttempted: true,
      childTenantId: '00000000-0000-4000-8000-000000000099', cleanupVerified: true, hardPurgeVerified: true, absenceVerified: true });
    expect(result.calls.some(args => args.includes('/v4/platform/tenants/parent-fixture/children?limit=100&offset=0'))).toBe(true);
    expect(result.stdout).not.toContain('lifecycle E2E passed');
  });
  test.each(['parent-delete-failed', 'parent-delete-soft', 'parent-delete-wrong-id', 'parent-still-present',
    'parent-inventory-malformed', 'parent-inventory-overflow'])('%s cannot certify standalone child cleanup', mode => {
    const result = runFixture(mode); expect(result.status).not.toBe(0); expect(result.stdout).not.toContain('lifecycle E2E passed');
    expect(result.calls.filter(args => args.includes('delete'))).toHaveLength(1);
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
