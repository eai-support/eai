import type { ErrorGuidance } from './types.js';

export const typesProvisioningGuidance: ErrorGuidance = {
  code: 'E262',
  reasonCode: 'provision_required_for_types',
  title: 'App resources must be provisioned before publishing Object Types.',
  category: 'app_provisioning',
  severity: 'error',
  appliesTo: ['types.seed', 'types.seed.dry-run'],
  publicSafe: true,
  why: [
    'Publishing needs the exact app enrollment and ready resources in its runtime workspace.',
    'The app enrollment can belong to a company workspace while its resources belong to a child workspace.',
    'No direct Object Type write can replace missing app provisioning.',
  ],
  evidenceToCheck: ['App key, owning company workspace and runtime workspace printed by the seed preflight.', 'The exact recovery command returned by types seed.'],
  diagnostics: [
    { command: 'eai types seed --dry-run --format json', purpose: 'Read app enrollment and provisioning readiness without changing platform state.', mutates: false },
    { command: 'eai app list --tenant-id <owner-workspace-id> --format json', purpose: 'Confirm that the app is enrolled in the owning workspace.', mutates: false },
  ],
  fixes: [{ command: 'eai app provision <app-key> --tenant-id <runtime-workspace-id> --app-tenant-id <owner-workspace-id> --select --format json', purpose: 'Provision the exact enrollment and runtime binding shown by preflight; omit --app-tenant-id when both workspaces are the same.', mutates: true }],
  retry: { allowed: true, maxAttempts: 1, stopWhen: ['App provisioning is not ready or the enrollment/runtime binding does not match.'] },
  escalation: { audience: 'platform-support', neededWhen: ['Provisioning cannot complete for the verified app and runtime binding.'], include: ['app key', 'owning workspace ID', 'runtime workspace ID', 'CLI version', 'request ID if available'] },
  safety: { mutatesState: true, mayWriteSecrets: false, mayDeleteData: false, publicSafe: true },
  match: [
    { serverCode: 'EAI_PROVISION_REQUIRED_FOR_TYPES' },
    { messageIncludes: ['EAI_PROVISION_REQUIRED_FOR_TYPES'] },
    { status: 409, messageIncludes: ['App resources must be provisioned before publishing object types'] },
  ],
};
