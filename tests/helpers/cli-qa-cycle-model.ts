// Synthetic selected-step DTOs for consumer controls; never live qualification.
import { createRequire } from 'node:module';
const npm = createRequire(import.meta.url)('../../scripts/cli-qa-npm-execution.cjs');
const appNpmModel = { schemaVersion: 'eai.cli-app-npm-execution.v1', script: 'build', qualification: 'normal-execution',
  canonicalExecution: { ...npm.canonicalBuildExecution(), exitCode: 0, executablesUnchanged: true },
  npmConfiguration: { user: 'empty-private', global: 'empty-private', project: 'absent', lifecycleNode: 'active-node-bin-first' } };
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
    commands: definitions.map(([command, phase, name, sequence], index) => ({ command, phase, sequence: sequence + 1, status: 'passed', exitCode: 0,
      scopeTenantId: identity.tenantId, options: index === 0 ? ['--rotate-secret'] : [],
      npmExecution: index === 1 ? structuredClone(appNpmModel) : undefined, assertions: [{ name, phase, status: 'passed' }] })),
    registration: { status: 'passed', clientId: identity.clientId, tenantId: identity.tenantId,
      authorizationAbsent: true, registrationAbsent: true, registrationAbsenceVerified: true } };
}

interface CycleFoundation {
  fixtureId: string; foundationParentTenantId: string; environment: string; publicApiUrl: string;
  tenantIds: { a: string; b: string }; actors: Record<string, { oid: string; profile: string }>;
}
// Explicit synthetic ownership DTO model; never an actual server observation.
export function cycleOwnershipModel(identity: CycleIdentity, foundation: CycleFoundation) {
  const parentTenantId = foundation.tenantIds.a;
  const command = (name: string, phase: string, sequence: number, assertion: string, options: string[]) => ({
    command: name, phase, sequence, status: 'passed', exitCode: 0, scopeTenantId: parentTenantId, options,
    assertion: { name: assertion, phase, status: 'passed' },
  });
  return { schemaVersion: 'eai.cli-cycle-ownership.v1', fixtureId: foundation.fixtureId,
    foundationParentTenantId: foundation.foundationParentTenantId, tenantIds: { ...foundation.tenantIds },
    environment: foundation.environment, publicApiUrl: foundation.publicApiUrl,
    actorId: foundation.actors.adminA.oid, profile: foundation.actors.adminA.profile,
    tenantId: identity.tenantId, parentTenantId,
    creation: { tenantId: identity.tenantId, parentTenantId, slug: identity.appKey, newChild: true, exitCode: 0,
      command: command('eai workspace create', 'isolation', 0, 'created-child-ownership', ['--parent']) },
    cleanup: { status: 'passed', tenantId: identity.tenantId, parentTenantId, deleted: true, hardPurged: true,
      receiptStatus: 'hard_purged', absenceVerified: true, absenceMethod: 'complete-parent-children-inventory',
      command: command('eai workspace delete', 'cleanup', 10, 'child-hard-purge-receipt', ['--parent', '--force-hard-purge']) } };
}
