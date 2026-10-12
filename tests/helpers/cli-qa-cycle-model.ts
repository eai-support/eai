// Synthetic selected-step DTOs for consumer controls; never live qualification.
interface CycleIdentity {
  tenantId: string; clientId: string; appKey: string; enrollmentId: string; recreatedEnrollmentId: string;
}
export function cycleStepModel(identity: CycleIdentity) {
  const definitions = [
    ['eai provision entra', 'app-sign-in', 'rotation-changed-local-credential', 0],
    ['npm run build', 'build', 'consultant-app-build', 1],
    ['eai app delete', 'cleanup', 'app-deletion-receipt', 3],
    ['eai app list', 'cleanup', 'first-app-inventory-empty', 4],
    ['eai app create', 'cleanup', 'new-enrollment-same-key', 5],
    ['eai app list', 'cleanup', 'recreated-enrollment-visible', 6],
    ['eai app delete', 'cleanup', 'recreated-app-deletion-receipt', 7],
    ['eai app list', 'cleanup', 'recreated-app-first-inventory-empty', 8],
    ['eai publicapi delete', 'cleanup', 'entra-cleanup-receipt', 2],
  ] as const;
  return { schemaVersion: 'eai.cli-cycle-step-evidence.v1', ...identity,
    commands: definitions.map(([command, phase, name, sequence], index) => ({ command, phase, sequence, status: 'passed', exitCode: 0,
      scopeTenantId: identity.tenantId, options: index === 0 ? ['--rotate-secret'] : [], assertions: [{ name, phase, status: 'passed' }] })),
    registration: { status: 'passed', clientId: identity.clientId, tenantId: identity.tenantId,
      authorizationAbsent: true, registrationAbsent: true, registrationAbsenceVerified: true } };
}
