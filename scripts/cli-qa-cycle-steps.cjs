// Selected lifecycle proof, separate from complete CLI command/option coverage.
const STEPS = [
  ['eai provision entra', 'app-sign-in', 'rotation-changed-local-credential'],
  ['npm run build', 'build', 'consultant-app-build'],
  ['eai app delete', 'cleanup', 'app-deletion-receipt'],
  ['eai app list', 'cleanup', 'first-app-inventory-empty'],
  ['eai app create', 'cleanup', 'new-enrollment-same-key'],
  ['eai app list', 'cleanup', 'recreated-enrollment-visible'],
  ['eai app delete', 'cleanup', 'recreated-app-deletion-receipt'],
  ['eai app list', 'cleanup', 'recreated-app-first-inventory-empty'],
  ['eai publicapi delete', 'cleanup', 'entra-cleanup-receipt'],
];
const SCHEMA = 'eai.cli-cycle-step-evidence.v1';
function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }
/** Preserve the actual selected command/guard observations, never project booleans as proof. */
function cycleStepEvidence(report) {
  if (!Array.isArray(report.commands) || !Array.isArray(report.assertions) || !Array.isArray(report.cleanup)) return null;
  const commands = [];
  for (const [command, phase, name] of STEPS) {
    const rows = report.commands.filter(row => row?.command === command && row.phase === phase
      && Array.isArray(row.assertions) && row.assertions.includes(name));
    const assertions = report.assertions.filter(row => row?.name === name && row.phase === phase);
    if (rows.length !== 1 || assertions.length !== 1) return null;
    const row = rows[0];
    commands.push({ command, phase, sequence: report.commands.indexOf(row), status: row.status, exitCode: row.exitCode, scopeTenantId: row.scopeTenantId,
      options: row.options || [], npmExecution: row.npmExecution,
      assertions: assertions.map(value => ({ name: value.name, phase: value.phase, status: value.status })) });
  }
  const counts = [['eai provision entra', 'app-sign-in', 1, '--rotate-secret'], ['npm run build', 'build', 1],
    ['eai app delete', 'cleanup', 2], ['eai app list', 'cleanup', 3], ['eai app create', 'cleanup', 1]];
  if (!counts.every(([command, phase, count, option]) => report.commands.filter(row => row?.command === command && row.phase === phase
    && (!option || row.options?.includes(option))).length === count)) return null;
  const registrations = report.cleanup.filter(row => row?.artifact === 'entra-registration');
  if (registrations.length !== 1) return null;
  const registration = registrations[0];
  return { schemaVersion: SCHEMA, tenantId: report.created?.runtimeTenantId, clientId: report.created?.entraClientId,
    appKey: report.created?.appKey, enrollmentId: report.created?.enrollmentId, recreatedEnrollmentId: report.created?.recreatedEnrollmentId,
    commands, registration: { status: registration.status, clientId: registration.evidence?.clientId,
      tenantId: registration.evidence?.tenantId, authorizationAbsent: registration.evidence?.authorizationAbsent,
      registrationAbsent: registration.evidence?.registrationAbsent, registrationAbsenceVerified: registration.evidence?.registrationAbsenceVerified } };
}
/** Recheck serialized selected-step receipts independently in every cycle consumer. */
function cycleStepsVerified(value, cycle) {
  if (!record(value) || value.schemaVersion !== SCHEMA || !record(cycle)
    || !['tenantId', 'clientId', 'appKey', 'enrollmentId', 'recreatedEnrollmentId'].every(key =>
      typeof value[key] === 'string' && value[key].length > 0 && value[key] === cycle[key])
    || !Array.isArray(value.commands) || value.commands.length !== STEPS.length) return false;
  if (!STEPS.every(([command, phase, name], index) => {
    const row = value.commands[index];
    return record(row) && row.command === command && row.phase === phase && row.status === 'passed' && row.exitCode === 0
      && Number.isSafeInteger(row.sequence) && row.sequence >= 0
      && row.scopeTenantId === cycle.tenantId && Array.isArray(row.options) && row.options.every(option => typeof option === 'string')
      && (index !== 0 || row.options.includes('--rotate-secret')) && Array.isArray(row.assertions) && row.assertions.length === 1
      && (command !== 'npm run build' || require('./cli-qa-npm-execution.cjs').appNpmExecutionVerified(row.npmExecution, 'build'))
      && record(row.assertions[0]) && row.assertions[0].name === name && row.assertions[0].phase === phase && row.assertions[0].status === 'passed';
  })) return false;
  const order = [0, 1, 8, 2, 3, 4, 5, 6, 7];
  if (!order.every((index, position) => position === 0
    || value.commands[order[position - 1]].sequence < value.commands[index].sequence)) return false;
  const registration = value.registration;
  return record(registration) && registration.status === 'passed' && registration.clientId === cycle.clientId
    && registration.tenantId === cycle.tenantId && registration.authorizationAbsent === true
    && registration.registrationAbsent === true && registration.registrationAbsenceVerified === true;
}
/** Project actual child creation and parent-authorized purge observations. */
function cycleOwnershipEvidence(report) {
  if (!record(report) || !Array.isArray(report.commands) || !Array.isArray(report.assertions)
    || !Array.isArray(report.cleanup) || !record(report.created?.childCreation)) return null;
  function selected(command, phase, name) {
    const rows = report.commands.filter(row => row?.command === command && row.phase === phase
      && row.scopeTenantId === report.parentTenantId && row.assertions?.includes(name));
    const guards = report.assertions.filter(row => row?.name === name && row.phase === phase);
    if (rows.length !== 1 || guards.length !== 1) return null;
    const row = rows[0], guard = guards[0];
    return { command, phase, sequence: report.commands.indexOf(row), status: row.status, exitCode: row.exitCode,
      scopeTenantId: row.scopeTenantId, options: row.options || [],
      assertion: { name: guard.name, phase: guard.phase, status: guard.status } };
  }
  const leaves = report.cleanup.filter(row => row?.artifact === 'child-tenant');
  if (leaves.length !== 1 || !record(leaves[0].evidence)) return null;
  const creation = report.created.childCreation, leaf = leaves[0];
  return { schemaVersion: 'eai.cli-cycle-ownership.v1', fixtureId: report.fixtureId,
    foundationParentTenantId: report.foundationParentTenantId,
    tenantIds: { a: report.tenantIds?.a, b: report.tenantIds?.b },
    environment: report.environment, publicApiUrl: report.expectedPublicApi,
    actorId: report.actors?.adminA?.oid, profile: report.profile,
    tenantId: report.created.childTenantId, parentTenantId: report.parentTenantId,
    creation: { tenantId: creation.tenantId, parentTenantId: creation.parentTenantId, slug: creation.slug,
      newChild: creation.newChild, exitCode: creation.exitCode,
      command: selected('eai workspace create', 'isolation', 'created-child-ownership') },
    cleanup: { status: leaf.status, tenantId: leaf.evidence.tenantId, parentTenantId: leaf.evidence.parentTenantId,
      deleted: leaf.evidence.deleted, hardPurged: leaf.evidence.hardPurged, receiptStatus: leaf.evidence.receiptStatus,
      absenceVerified: leaf.evidence.absenceVerified, absenceMethod: leaf.evidence.absenceMethod,
      command: selected('eai workspace delete', 'cleanup', 'child-hard-purge-receipt') } };
}
/** Imported receipts must independently match the retained fixture and exact leaf. */
function cycleOwnershipVerified(value, cycle, foundation) {
  const uuid = input => typeof input === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input);
  if (!record(value) || value.schemaVersion !== 'eai.cli-cycle-ownership.v1' || !record(cycle)
    || !uuid(value.fixtureId) || !uuid(value.foundationParentTenantId) || !record(value.tenantIds)
    || !uuid(value.tenantIds.a) || !uuid(value.tenantIds.b)
    || new Set([value.foundationParentTenantId, value.tenantIds.a, value.tenantIds.b].map(id => id.toLowerCase())).size !== 3
    || !uuid(value.actorId) || typeof value.profile !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(value.profile)
    || !['DEV', 'TEST'].includes(value.environment) || typeof value.publicApiUrl !== 'string'
    || !uuid(value.tenantId) || value.tenantId !== cycle.tenantId || value.parentTenantId !== value.tenantIds.a
    || [value.foundationParentTenantId, value.tenantIds.a, value.tenantIds.b]
      .some(id => id.toLowerCase() === value.tenantId.toLowerCase())) return false;
  if (foundation !== undefined && (!record(foundation) || value.fixtureId !== foundation.fixtureId
    || value.foundationParentTenantId !== foundation.foundationParentTenantId
    || value.environment !== foundation.environment || value.publicApiUrl !== foundation.publicApiUrl
    || value.tenantIds.a !== foundation.tenantIds?.a || value.tenantIds.b !== foundation.tenantIds?.b
    || value.actorId !== foundation.actors?.adminA?.oid || value.profile !== foundation.actors?.adminA?.profile)) return false;
  const creation = value.creation, cleanup = value.cleanup;
  if (!record(creation) || creation.tenantId !== cycle.tenantId || creation.parentTenantId !== value.parentTenantId
    || creation.slug !== cycle.appKey || creation.newChild !== true || creation.exitCode !== 0
    || !record(cleanup) || cleanup.status !== 'passed' || cleanup.tenantId !== cycle.tenantId
    || cleanup.parentTenantId !== value.parentTenantId || cleanup.deleted !== true || cleanup.hardPurged !== true
    || cleanup.receiptStatus !== 'hard_purged' || cleanup.absenceVerified !== true
    || cleanup.absenceMethod !== 'complete-parent-children-inventory') return false;
  function commandVerified(row, command, phase, assertion, option) {
    return record(row) && row.command === command && row.phase === phase && row.status === 'passed' && row.exitCode === 0
      && row.scopeTenantId === value.parentTenantId && Number.isSafeInteger(row.sequence) && row.sequence >= 0
      && Array.isArray(row.options) && row.options.every(item => typeof item === 'string')
      && row.options.includes('--parent') && (!option || row.options.includes(option))
      && record(row.assertion) && row.assertion.name === assertion && row.assertion.phase === phase && row.assertion.status === 'passed';
  }
  const steps = cycle.stepEvidence?.commands;
  return Array.isArray(steps) && steps.length === STEPS.length && steps.every(row => Number.isSafeInteger(row?.sequence))
    && commandVerified(creation.command, 'eai workspace create', 'isolation', 'created-child-ownership')
    && commandVerified(cleanup.command, 'eai workspace delete', 'cleanup', 'child-hard-purge-receipt', '--force-hard-purge')
    && creation.command.sequence < Math.min(...steps.map(row => row.sequence))
    && cleanup.command.sequence > Math.max(...steps.map(row => row.sequence));
}
module.exports = { cycleStepEvidence, cycleStepsVerified, cycleOwnershipEvidence, cycleOwnershipVerified };
