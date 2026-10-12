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
      options: row.options || [], assertions: assertions.map(value => ({ name: value.name, phase: value.phase, status: value.status })) });
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
module.exports = { cycleStepEvidence, cycleStepsVerified };
