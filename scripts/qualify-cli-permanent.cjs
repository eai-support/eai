#!/usr/bin/env node
// Executes ten fresh owned lifecycles. This is an opt-in DEV/TEST qualification.
const { resolve, join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
const qa = require('./cli-qa-foundation.cjs');
const smoke = require('./eai-full-e2e-smoke.cjs');
const { sourceBuildVerified } = require('./cli-qa-build-receipt.cjs');
function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function candidateValid(candidate) {
  return /^[a-f0-9]{40}$/.test(candidate.gitSha || '') && /^[a-f0-9]{64}$/.test(candidate.binarySha256 || '')
    && /^[a-f0-9]{64}$/.test(candidate.runtimeSha256 || '') && candidate.dirty === false;
}
function cycleReceipt(report) {
  const rotation = report.rotationCycle || {}, deletion = report.deletionCycle || {};
  const registration = report.cleanup?.find(row => row.artifact === 'entra-registration');
  const rotations = (report.commands || []).filter(row => row.command === 'eai provision entra' && row.options?.includes('--rotate-secret'));
  const builds = (report.commands || []).filter(row => row.command === 'npm run build');
  return { appKey: report.created?.appKey, tenantId: rotation.tenantId, clientId: rotation.clientId,
    enrollmentId: deletion.enrollmentId, recreatedEnrollmentId: deletion.recreatedEnrollmentId,
    status: report.status, rotationDispatches: rotations.length === 1 && rotations[0].status === 'passed' ? rotation.commandDispatches : 0,
    credentialChanged: rotation.credentialChanged === true, firstInventoryEmpty: deletion.firstInventoryEmpty === true,
    recreatedSameKey: deletion.recreatedSameKey === true, deletionVerified: deletion.deletionVerified === true,
    appBuildVerified: builds.length === 1 && builds[0].status === 'passed' && builds[0].exitCode === 0
      && builds[0].scopeTenantId === report.created?.runtimeTenantId,
    registrationAbsent: registration?.status === 'passed' && registration.evidence?.registrationAbsenceVerified === true,
    cleanupVerified: report.cleanupVerified === true, summaryPath: report.summaryPath };
}
function cleanupPreflightVerified(preflight, foundation, deployments, now) {
  const age = now - Date.parse(preflight?.observedAt);
  return preflight?.schemaVersion === 'eai.cli-child-cleanup-preflight.v1'
    && preflight.publicApiUrl === foundation.publicApiUrl && preflight.parentTenantId === foundation.workspaces.a.id
    && preflight.actorId === foundation.actors.adminA.oid
    && preflight.childDeleteRoute === '/v4/platform/tenants/{parent}/children/{child}/delete'
    && preflight.childDeleteVerified === true && Number.isFinite(age) && age >= -60000 && age <= 3600000
    && preflight.publicApiGitSha === deployments.find(row => row.service === 'PublicAPI')?.observedSha
    && preflight.adminApiGitSha === deployments.find(row => row.service === 'AdminAPI')?.observedSha;
}
function ownedReportValid(report, foundation, candidate, preflight) {
  const created = report.created || {}, rotation = report.rotationCycle || {}, deletion = report.deletionCycle || {};
  const leaf = report.cleanup?.find(row => row.artifact === 'child-tenant');
  return report.candidate?.gitSha === candidate.gitSha && report.candidate?.binarySha256 === candidate.binarySha256
    && report.candidate?.runtimeSha256 === candidate.runtimeSha256 && report.profile === foundation.actors.adminA.profile
    && report.environment === foundation.environment && report.expectedPublicApi === foundation.publicApiUrl
    && report.preflight?.publicApiGitSha === preflight.publicApiGitSha && report.preflight?.adminApiGitSha === preflight.adminApiGitSha
    && report.preflight?.observedAt === preflight.observedAt && report.preflight?.childDeleteRoute === preflight.childDeleteRoute
    && report.parentTenantId === foundation.workspaces.a.id && created.childTenantId !== foundation.workspaces.a.id
    && created.runtimeTenantId === created.childTenantId && created.entraClientId === rotation.clientId
    && rotation.tenantId === created.childTenantId && deletion.tenantId === created.childTenantId
    && rotation.appKey === created.appKey && deletion.appKey === created.appKey
    && deletion.enrollmentId === created.enrollmentId && deletion.recreatedEnrollmentId === created.recreatedEnrollmentId
    && Array.isArray(report.leftovers) && report.leftovers.length === 0 && leaf?.status === 'passed'
    && leaf.evidence?.tenantId === created.childTenantId && leaf.evidence.parentTenantId === foundation.workspaces.a.id
    && leaf.evidence.hardPurged === true && leaf.evidence.absenceVerified === true;
}

/** Stop at the first unqualified lifecycle; each runner still performs its finally cleanup. */
function runQualification(options, dependencies = {}) {
  const now = dependencies.now || Date.now, candidateEvidence = dependencies.candidateEvidence || smoke.candidateEvidence;
  const runLive = dependencies.runLive || smoke.runLiveSmoke;
  return qa.withLease(options.foundationPath, () => {
    const foundation = qa.validateFoundation(qa.readPrivate(options.foundationPath));
    const deployments = qa.readPrivate(options.deploymentsPath);
    const candidate = candidateEvidence(options.cliPath);
    const output = resolve(options.output || join(require('node:os').tmpdir(), 'eai-cli-cycles-' + randomUUID(), 'summary.json'));
    requireCondition([options.foundationPath, options.deploymentsPath, options.cleanupPreflight, options.buildReceiptPath, options.cliPath]
      .filter(Boolean).every(path => resolve(path) !== output) && !existsSync(output),
    'Use a new private cycle output separate from every fixture, proof and CLI input.');
    const cycleEnv = { ...(dependencies.env || process.env) };
    for (const key of Object.keys(cycleEnv)) if (key.startsWith('EAI_E2E_')) delete cycleEnv[key];
    const report = { schemaVersion: 'eai.cli-permanent-cycles.v1', fixtureId: foundation.fixtureId,
      environment: foundation.environment, publicApiUrl: foundation.publicApiUrl, candidate,
      qualification: Object.keys(dependencies).some(key => !['env', 'log'].includes(key)) ? 'controlled-fixtures' : 'normal-cli-profiles',
      startedAt: new Date(now()).toISOString(), status: 'running', qualified: false, cycles: [] };
    const save = () => qa.writePrivate(output, report);
    let stage = 'preflight'; save();
    try {
      requireCondition(foundation.state === 'verified', 'Retained foundation has not been freshly prepared.');
      requireCondition(candidateValid(candidate), 'Use a clean, source-bound built CLI candidate.');
      requireCondition(options.buildReceiptPath && sourceBuildVerified(qa.readPrivate(options.buildReceiptPath), candidate, { now: now() }),
        'A fresh successful canonical source build receipt for this candidate is required.');
      requireCondition(qa.deploymentParity(deployments, { environment: foundation.environment,
        publicApiUrl: foundation.publicApiUrl, now: now() }), 'Complete fresh backend deployment parity is required.');
      const call = qa.cliCaller(options.cliPath, foundation, options.foundationPath + '.contexts', dependencies);
      qa.verifyIdentity(call, foundation.owner, foundation); qa.verifyWorkspaces(call, foundation); qa.verifyActors(call, foundation);
      requireCondition(options.cleanupPreflight, 'A fresh parent-authorized child cleanup observation is required.');
      const preflight = qa.readPrivate(options.cleanupPreflight);
      requireCondition(cleanupPreflightVerified(preflight, foundation, deployments, now()),
        'Cleanup observation is stale or differs from this actor, parent or selected deployed revisions.');
      for (let index = 0; index < 10; index++) {
        stage = 'cycle-' + (index + 1);
        requireCondition(qa.deploymentParity(deployments, { environment: foundation.environment,
          publicApiUrl: foundation.publicApiUrl, now: now() }), 'Deployment observations expired before this cycle.');
        const currentPreflight = qa.readPrivate(options.cleanupPreflight);
        requireCondition(cleanupPreflightVerified(currentPreflight, foundation, deployments, now()), 'Cleanup observation changed or expired before this cycle.');
        requireCondition(currentPreflight.observedAt === preflight.observedAt, 'Cleanup observation changed during qualification.');
        const current = candidateEvidence(options.cliPath);
        requireCondition(candidateValid(current) && current.gitSha === candidate.gitSha && current.runtimeSha256 === candidate.runtimeSha256
          && current.binarySha256 === candidate.binarySha256, 'CLI candidate changed during qualification.');
        requireCondition(sourceBuildVerified(qa.readPrivate(options.buildReceiptPath), current, { now: now() }), 'Source build receipt expired or changed before this cycle.');
        let result;
        try {
          result = runLive(options.cliPath, { ...dependencies, env: { ...cycleEnv,
            EAI_E2E_TEST_PROFILE: foundation.actors.adminA.profile, EAI_E2E_TEST_USERNAME: foundation.actors.adminA.email,
            EAI_E2E_TEST_USER_OID: foundation.actors.adminA.oid, EAI_E2E_PARENT_TENANT_ID: foundation.workspaces.a.id,
            EAI_E2E_EXPECTED_PUBLIC_API: foundation.publicApiUrl, EAI_E2E_CLEANUP_PREFLIGHT: options.cleanupPreflight,
            EAI_E2E_CHILD_HOME_REGION: foundation.region, EAI_E2E_BUILD: '1', EAI_E2E_PROVISION_ENTRA: '1', EAI_E2E_ROTATE_ENTRA_SECRET: '1',
            EAI_E2E_SYNC_SCHEMA_APPLY: '1', EAI_E2E_REQUIRE_FIRST_EMPTY: '1', EAI_E2E_RECREATE_AFTER_DELETE: '1' }, log: () => {} });
        } catch (error) {
          if (error.report) report.cycles.push(cycleReceipt({ ...error.report, summaryPath: error.summaryPath }));
          throw error;
        }
        const receipt = cycleReceipt(result); report.cycles.push(receipt); save();
        requireCondition(ownedReportValid(result, foundation, candidate, currentPreflight), 'Lifecycle evidence belongs to another candidate, actor, owned scope or deployed cleanup contract.');
        requireCondition(qa.cycleReceiptVerified(receipt), 'Lifecycle lacks rotation, first-read, recreation or cleanup proof.');
        const after = candidateEvidence(options.cliPath);
        requireCondition(candidateValid(after) && after.gitSha === candidate.gitSha && after.runtimeSha256 === candidate.runtimeSha256
          && after.binarySha256 === candidate.binarySha256, 'CLI candidate changed during the lifecycle.');
        requireCondition(sourceBuildVerified(qa.readPrivate(options.buildReceiptPath), after, { now: now() })
          && qa.deploymentParity(deployments, { environment: foundation.environment, publicApiUrl: foundation.publicApiUrl, now: now() }),
        'Build or deployment observations expired during the lifecycle.');
        const afterPreflight = qa.readPrivate(options.cleanupPreflight);
        requireCondition(cleanupPreflightVerified(afterPreflight, foundation, deployments, now())
          && afterPreflight.observedAt === preflight.observedAt, 'Cleanup observation changed or expired during the lifecycle.');
      }
      const structurallyVerified = report.cycles.every(qa.cycleReceiptVerified)
        && new Set(report.cycles.map(row => row.clientId.toLowerCase())).size === 10
        && new Set(report.cycles.map(row => row.tenantId.toLowerCase())).size === 10
        && new Set(report.cycles.map(row => row.appKey)).size === 10;
      requireCondition(structurallyVerified, 'Cycles reused a registration/app or lack exact fresh identity proof.');
      report.contractsVerified = true; report.qualified = report.qualification === 'normal-cli-profiles';
      report.status = 'passed';
    } catch (error) {
      report.qualified = false; report.status = stage === 'preflight' ? 'blocked' : 'failed'; report.stoppedAt = stage;
      report.reason = stage === 'preflight' ? 'Required source, fixture, identity or deployment proof is unavailable.'
        : 'An owned lifecycle did not qualify; inspect its private command and cleanup receipts.';
      save(); const failure = new Error('CLI qualification stopped. Private summary: ' + output); failure.report = report; throw failure;
    } finally { report.completedAt = new Date(now()).toISOString(); save(); }
    return { ...report, summaryPath: output };
  });
}
function main() {
  const args = process.argv.slice(2), argument = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  for (const flag of ['--foundation', '--deployments', '--cleanup-preflight', '--build-receipt', '--cli']) requireCondition(argument(flag), 'Qualification requires ' + flag + '.');
  const report = runQualification({ foundationPath: resolve(argument('--foundation')), deploymentsPath: resolve(argument('--deployments')),
    cleanupPreflight: resolve(argument('--cleanup-preflight')), buildReceiptPath: resolve(argument('--build-receipt')),
    cliPath: resolve(argument('--cli')), output: argument('--output') });
  console.log(JSON.stringify({ status: report.status, qualified: report.qualified, cycles: report.cycles.length, summaryPath: report.summaryPath }));
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { runQualification, cycleReceipt, candidateValid, ownedReportValid, cleanupPreflightVerified };
