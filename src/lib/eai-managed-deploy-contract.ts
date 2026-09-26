import { createHash } from 'node:crypto';

export const EAI_MANAGED_WORKFLOW_PATH = '.github/workflows/eai-app.yml';
export const EAI_MANAGED_EVIDENCE_SCRIPT_PATH = 'scripts/source-unknown-deployment-evidence.mjs';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REPOSITORY_PATTERN = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

/** Owner-only retry material bound to one server-issued source operation. */
export interface ManagedDeployState {
  schema: 'eai.managed-deploy-state.v1';
  tenantId: string;
  targetTenantId: string;
  appKey: string;
  operationId: string;
  nonce: string;
  repo: string;
  branch: string;
  ref: string;
  commitSha: string;
  workflowPath: string;
  configHash: string;
  environment: string;
  installationId: number;
  actorId?: string;
  githubLinkSessionId?: string;
  githubUserId?: number;
  githubLogin?: string;
  githubProofId?: string;
  publicApiUrl: string;
  dispatchStartedAt?: string;
  dispatchedAt?: string;
  githubRunId?: number;
}

/** Durable provider-dispatch reservation, bound to the complete one-time operation authority. */
export interface ManagedDispatchClaim {
  schema: 'eai.managed-dispatch-claim.v1';
  operationId: string;
  bindingSha256: string;
  nonceSha256: string;
  status: 'claimed' | 'dispatching' | 'accepted';
  claimedAt: string;
  updatedAt: string;
  githubRunId?: number;
}

/** Canonical files installed directly, already current, or staged beside local edits. */
export interface CanonicalInstallResult {
  changed: string[];
  unchanged: string[];
  pendingUpdates: string[];
}

/** Terminal classification used to decide whether exact-operation polling can stop. */
export type ManagedOperationState = 'pending' | 'succeeded' | 'failed';

/** Fields returned by the unified exact-operation route and its TenantInfra projection. */
export interface ManagedOperationProjection {
  tenantId?: unknown;
  appScopeTenantId?: unknown;
  targetTenantId?: unknown;
  appKey?: unknown;
  operationId?: unknown;
  environment?: unknown;
  sourceMode?: unknown;
  sourceStatus?: unknown;
  configHash?: unknown;
  status?: unknown;
  requiresTenantInfra?: unknown;
  deploymentId?: unknown;
  activeUrl?: unknown;
  latestPointerVersion?: unknown;
  expectedLatestVersion?: unknown;
  runtimeIdentity?: unknown;
  deployment?: unknown;
  doctor?: unknown;
  sourceRevision?: unknown;
  setup?: unknown;
}

/** Normalize supported GitHub HTTPS and SSH remotes to the exact owner/name binding. */
export function parseGitHubRepository(value: string): { owner: string; name: string; slug: string } {
  const normalized = value
    .trim()
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/^ssh:\/\/git@github\.com\//, '')
    .replace(/\.git$/, '');
  const match = REPOSITORY_PATTERN.exec(normalized);
  if (!match) throw new Error('Repository must use the exact owner/name form.');
  return { owner: match[1], name: match[2], slug: `${match[1]}/${match[2]}` };
}

/** Reject mutable or abbreviated Git revisions at the deployment authority boundary. */
export function requireCommitSha(value: string, label = 'Commit SHA'): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`${label} must be an exact 40 character lowercase Git commit SHA.`);
  }
  return normalized;
}

/** Require the canonical algorithm-qualified configuration digest. */
export function requireConfigHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error('Configuration hash must use sha256:<64 lowercase hex characters>.');
  }
  return normalized;
}

/** Restrict dispatch to one workflow file directly under the GitHub workflow directory. */
export function requireWorkflowPath(value: string): string {
  const normalized = value.trim();
  if (!/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(normalized)) {
    throw new Error('Workflow path must be a file directly under .github/workflows.');
  }
  return normalized;
}

/** Validate a branch before using it in a full Git ref or GitHub API path. */
export function requireBranch(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,253}[A-Za-z0-9])?$/.test(normalized)) {
    throw new Error('Branch is not a valid GitHub branch name.');
  }
  return normalized;
}

/** Normalize the exact positive GitHub App installation identifier. */
export function requireInstallationId(value: string | number): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new Error('GitHub App installation ID must be a positive integer.');
  }
  return normalized;
}

/** Never expose the one-time nonce in status; bind retries to this algorithm-qualified digest. */
export function managedDeployNonceSha256(nonce: string): string {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._~:-]{0,254}[A-Za-z0-9])?$/.test(nonce)) {
    throw new Error('Managed deployment nonce is malformed.');
  }
  return `sha256:${createHash('sha256').update(nonce).digest('hex')}`;
}
