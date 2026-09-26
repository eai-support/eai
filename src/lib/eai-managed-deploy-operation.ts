import {
  EAI_MANAGED_WORKFLOW_PATH,
  managedDeployNonceSha256,
  parseGitHubRepository,
  requireBranch,
  type ManagedDeployState,
  type ManagedOperationProjection,
  type ManagedOperationState,
} from './eai-managed-deploy-contract.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REPOSITORY_PART_PATTERN = /^[A-Za-z0-9_.-]+$/;
const FAILED_STATUSES = new Set([
  'failed', 'failed-readiness', 'failure', 'rejected', 'rolled-back', 'disabled',
  'cancelled', 'canceled', 'error', 'timed_out', 'expired', 'revoked',
]);
const ACCEPTED_SOURCE_STATUSES = new Set(['handoff_pending', 'completed']);
const SOURCE_MODES = new Set(['source-unknown', 'eai-cli-generated']);
const ENVIRONMENTS = new Set(['preview', 'dev', 'test', 'prod']);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function exactText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function positiveId(value: unknown): boolean {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0;
  return typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
}

function statusOf(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidHttpsUrl(value: unknown): value is string {
  if (!exactText(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isValidBranch(value: unknown): value is string {
  if (!exactText(value)) return false;
  try {
    return requireBranch(value) === value;
  } catch {
    return false;
  }
}

function hasCompleteRuntimeIdentity(value: unknown): boolean {
  const identity = record(value);
  return Boolean(identity && exactText(identity.clientId) && exactText(identity.principalId));
}

function hasCompleteSourceRevision(operation: ManagedOperationProjection): boolean {
  const revision = record(operation.sourceRevision);
  if (!revision
    || !exactText(operation.operationId)
    || !exactText(operation.appScopeTenantId)
    || !exactText(operation.targetTenantId)
    || !exactText(operation.appKey)
    || !exactText(operation.environment)
    || !SOURCE_MODES.has(String(operation.sourceMode))
    || !ENVIRONMENTS.has(operation.environment)
    || typeof operation.configHash !== 'string'
    || !SHA256_PATTERN.test(operation.configHash)) return false;

  if (operation.tenantId !== undefined && operation.tenantId !== operation.appScopeTenantId) return false;
  if (revision.operationId !== operation.operationId
    || revision.sourceMode !== operation.sourceMode
    || revision.appScopeTenantId !== operation.appScopeTenantId
    || revision.targetTenantId !== operation.targetTenantId
    || revision.configHash !== operation.configHash) return false;
  if (revision.sourceOperationId !== undefined && !exactText(revision.sourceOperationId)) return false;

  if (!exactText(revision.repoOwner) || !REPOSITORY_PART_PATTERN.test(revision.repoOwner)
    || !exactText(revision.repoName) || !REPOSITORY_PART_PATTERN.test(revision.repoName)
    || !positiveId(revision.repositoryId)
    || !positiveId(revision.installationId)
    || !exactText(revision.branchRef)
    || !isValidBranch(revision.workflowHeadBranch)
    || revision.branchRef !== `refs/heads/${revision.workflowHeadBranch}`
    || revision.workflowPath !== EAI_MANAGED_WORKFLOW_PATH
    || typeof revision.sourceCommitSha !== 'string'
    || !SHA_PATTERN.test(revision.sourceCommitSha)
    || typeof revision.commitSha !== 'string'
    || !SHA_PATTERN.test(revision.commitSha)
    || typeof revision.workflowBlobSha !== 'string'
    || !SHA_PATTERN.test(revision.workflowBlobSha)
    || typeof revision.collectorDigest !== 'string'
    || !SHA256_PATTERN.test(revision.collectorDigest)
    || !positiveId(revision.workflowRunId)) return false;

  if (operation.sourceMode === 'eai-cli-generated') {
    if (typeof revision.reviewHeadSha !== 'string' || !SHA_PATTERN.test(revision.reviewHeadSha)) return false;
  } else if (revision.reviewHeadSha !== undefined
    && (typeof revision.reviewHeadSha !== 'string' || !SHA_PATTERN.test(revision.reviewHeadSha))) return false;

  const imageArtifact = record(revision.imageArtifact);
  if (typeof revision.artifactDigest !== 'string' || !SHA256_PATTERN.test(revision.artifactDigest)
    || typeof revision.imageDigest !== 'string' || !SHA256_PATTERN.test(revision.imageDigest)
    || !imageArtifact
    || !positiveId(imageArtifact.id)
    || imageArtifact.name !== 'eai-generated-app-image'
    || typeof imageArtifact.archiveDigest !== 'string'
    || !SHA256_PATTERN.test(imageArtifact.archiveDigest)) return false;
  return new Set([
    revision.artifactDigest,
    revision.imageDigest,
    imageArtifact.archiveDigest,
  ]).size === 3;
}

function hasCompleteDeploymentDoctor(operation: ManagedOperationProjection): boolean {
  const deployment = record(operation.deployment);
  const doctor = record(operation.doctor);
  const scope = record(doctor?.scope);
  if (!deployment || !doctor || !scope || !exactText(deployment.deploymentId)) return false;
  if (deployment.status !== 'active'
    || doctor.deploymentId !== deployment.deploymentId
    || doctor.status !== deployment.status
    || doctor.ready !== true
    || scope.tenantId !== operation.targetTenantId
    || scope.appKey !== operation.appKey
    || scope.environment !== operation.environment) return false;

  const latestPointerVersion = operation.latestPointerVersion;
  const expectedLatestVersion = operation.expectedLatestVersion;
  return operation.requiresTenantInfra === false
    && operation.deploymentId === deployment.deploymentId
    && isValidHttpsUrl(operation.activeUrl)
    && hasCompleteRuntimeIdentity(operation.runtimeIdentity)
    && Number.isSafeInteger(latestPointerVersion)
    && Number.isSafeInteger(expectedLatestVersion)
    && Number(latestPointerVersion) >= 0
    && Number(expectedLatestVersion) >= 0
    && latestPointerVersion === expectedLatestVersion;
}

/** Require exact accepted source evidence, active deployment, and operation-bound doctor proof. */
export function classifyManagedOperationStatus(value: unknown): ManagedOperationState {
  const operation = record(value) as ManagedOperationProjection | undefined;
  const rootStatus = statusOf(operation?.status ?? value);
  const nestedStatuses = operation
    ? [operation.sourceStatus, record(operation.deployment)?.status, record(operation.doctor)?.status]
    : [];
  if ([rootStatus, ...nestedStatuses.map(statusOf)].some(status => FAILED_STATUSES.has(status))) {
    return 'failed';
  }
  if (!operation || rootStatus !== 'active'
    || !ACCEPTED_SOURCE_STATUSES.has(statusOf(operation.sourceStatus))
    || !hasCompleteSourceRevision(operation)
    || !hasCompleteDeploymentDoctor(operation)) return 'pending';
  return 'succeeded';
}

/** Reject local retry state that differs from the server-signed setup. */
export function assertManagedDeployStateMatchesOperation(
  state: ManagedDeployState,
  operation: ManagedOperationProjection,
): void {
  const binding = record(operation.setup);
  if (!binding) throw new Error('Exact operation does not contain a valid setup binding.');
  const repository = record(binding.repo) ?? {};
  const expected: Array<[string, unknown, unknown]> = [
    ['appScopeTenantId', operation.appScopeTenantId, state.tenantId],
    ['appKey', operation.appKey, state.appKey],
    ['operationId', operation.operationId, state.operationId],
    ['targetTenantId', binding.targetTenantId, state.targetTenantId],
    ['environment', binding.environment, state.environment],
    ['workflowPath', binding.workflowPath, state.workflowPath],
    ['ref', binding.ref, state.ref],
    ['commitSha', binding.commitSha, state.commitSha],
    ['configHash', binding.configHash, state.configHash],
    ['nonceSha256', binding.nonceSha256, managedDeployNonceSha256(state.nonce)],
    ['actorId', binding.actorId, state.actorId],
    ['githubLinkSessionId', binding.githubLinkSessionId, state.githubLinkSessionId],
    ['repoOwner', repository.owner, parseGitHubRepository(state.repo).owner],
    ['repoName', repository.name, parseGitHubRepository(state.repo).name],
    ['deployOnSuccess', binding.deployOnSuccess, true],
  ];
  const mismatch = expected.find(([, serverValue, localValue]) => serverValue !== localValue);
  if (mismatch) throw new Error(`Retry state does not match the server setup field ${mismatch[0]}.`);
}
