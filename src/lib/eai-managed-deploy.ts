import { createHash } from 'node:crypto';
import { access, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EAI_MANAGED_WORKFLOW_PATH = '.github/workflows/eai-app.yml';
export const EAI_MANAGED_EVIDENCE_SCRIPT_PATH = 'scripts/source-unknown-deployment-evidence.mjs';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REPOSITORY_PATTERN = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const CONFIG_PATHS = [
  'eai.runtime.json',
  'src/eai.config/default.ts',
  'src/eai.config/index.ts',
  'src/eai.config/object-types.json',
  'src/eai.config/object-types.provisioning.json',
  'src/eai.config/object-types.ts',
  'src/eai.config/register.ts',
] as const;

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
  dispatchedAt?: string;
}

/** Canonical files installed directly, already current, or staged beside local edits. */
export interface CanonicalInstallResult {
  changed: string[];
  unchanged: string[];
  pendingUpdates: string[];
}

/** Terminal classification used to decide whether exact-operation polling can stop. */
export type ManagedOperationState = 'pending' | 'succeeded' | 'failed';

/** TenantInfra fields that jointly prove an operation reached its active runtime. */
export interface ManagedOperationProjection {
  status?: unknown;
  requiresTenantInfra?: unknown;
  deploymentId?: unknown;
  activeUrl?: unknown;
  latestPointerVersion?: unknown;
  expectedLatestVersion?: unknown;
  runtimeIdentity?: unknown;
}

interface ExactManagedOperation extends ManagedOperationProjection {
  tenantId?: unknown;
  targetTenantId?: unknown;
  appKey?: unknown;
  operationId?: unknown;
  setup?: unknown;
}

/** Resolve packaged resources from both source and compiled CLI module locations. */
export function canonicalManagedDeployResourceRoot(): string {
  return fileURLToPath(new URL('../../resources/deploy/eai-app-template/', import.meta.url));
}

function isContained(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
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
  if (!match) {
    throw new Error('Repository must use the exact owner/name form.');
  }
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

async function fileMatches(left: string, right: string): Promise<boolean> {
  try {
    const [leftValue, rightValue] = await Promise.all([readFile(left), readFile(right)]);
    return leftValue.equals(rightValue);
  } catch {
    return false;
  }
}

async function writeAtomically(path: string, content: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.eai-${process.pid}.tmp`;
  await writeFile(temporaryPath, content, { mode: 0o644 });
  await rename(temporaryPath, path);
}

/** Install the reviewed workflow and evidence collector as one versioned pair. */
export async function installCanonicalManagedDeployFiles(
  projectRoot: string,
  workflowPath = EAI_MANAGED_WORKFLOW_PATH,
): Promise<CanonicalInstallResult> {
  const canonicalRoot = canonicalManagedDeployResourceRoot();
  const files = [
    { source: join(canonicalRoot, EAI_MANAGED_WORKFLOW_PATH), target: workflowPath },
    { source: join(canonicalRoot, EAI_MANAGED_EVIDENCE_SCRIPT_PATH), target: EAI_MANAGED_EVIDENCE_SCRIPT_PATH },
  ];
  const result: CanonicalInstallResult = { changed: [], unchanged: [], pendingUpdates: [] };

  for (const file of files) {
    const source = resolve(canonicalRoot, file.source);
    const target = resolve(projectRoot, file.target);
    if (!isContained(canonicalRoot, source) || !isContained(projectRoot, target)) {
      throw new Error('Canonical deployment file resolved outside its allowed root.');
    }
    if (await fileMatches(source, target)) {
      result.unchanged.push(file.target);
      continue;
    }
    let targetExists = true;
    try {
      await access(target);
    } catch {
      targetExists = false;
    }
    if (targetExists) {
      const candidate = `${target}.eai-update`;
      await writeAtomically(candidate, await readFile(source));
      result.pendingUpdates.push(`${file.target}.eai-update`);
    } else {
      await writeAtomically(target, await readFile(source));
      result.changed.push(file.target);
    }
  }
  return result;
}

/** Match the canonical workflow's ordered config hashing algorithm. */
export async function buildManagedDeployConfigHash(projectRoot: string): Promise<string> {
  const hash = createHash('sha256');
  let foundRuntime = false;
  for (const relativePath of [...CONFIG_PATHS].sort()) {
    const path = join(projectRoot, relativePath);
    try {
      const value = await readFile(path);
      hash.update(relativePath);
      hash.update('\0');
      hash.update(value);
      hash.update('\0');
      if (relativePath === 'eai.runtime.json') foundRuntime = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (!foundRuntime) {
    throw new Error('eai.runtime.json is required for EAI managed deployment.');
  }
  return `sha256:${hash.digest('hex')}`;
}

function isValidHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function hasCompleteRuntimeIdentity(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  return typeof identity.clientId === 'string' && identity.clientId.length > 0
    && typeof identity.principalId === 'string' && identity.principalId.length > 0;
}

/** Require the complete TenantInfra activation projection before reporting success. */
export function classifyManagedOperationStatus(value: unknown): ManagedOperationState {
  const operation = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as ManagedOperationProjection
    : undefined;
  const rawStatus = operation?.status ?? value;
  const status = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : '';
  if (['failed', 'failed-readiness', 'failure', 'rejected', 'rolled-back', 'disabled', 'cancelled', 'canceled', 'error', 'timed_out', 'expired', 'revoked'].includes(status)) return 'failed';
  if (status !== 'active' || !operation) return 'pending';
  const latestPointerVersion = operation.latestPointerVersion;
  const expectedLatestVersion = operation.expectedLatestVersion;
  if (
    operation.requiresTenantInfra !== false
    || typeof operation.deploymentId !== 'string'
    || operation.deploymentId.length === 0
    || !isValidHttpsUrl(operation.activeUrl)
    || !hasCompleteRuntimeIdentity(operation.runtimeIdentity)
    || !Number.isSafeInteger(latestPointerVersion)
    || !Number.isSafeInteger(expectedLatestVersion)
    || latestPointerVersion !== expectedLatestVersion
  ) return 'pending';
  return 'succeeded';
}

/** Reject local retry state that differs from the server-signed setup. */
export function assertManagedDeployStateMatchesOperation(
  state: ManagedDeployState,
  operation: ExactManagedOperation,
): void {
  const setup = operation.setup;
  if (typeof setup !== 'object' || setup === null || Array.isArray(setup)) {
    throw new Error('Exact operation does not contain a valid setup binding.');
  }
  const binding = setup as Record<string, unknown>;
  const repo = binding.repo;
  const repository = typeof repo === 'object' && repo !== null && !Array.isArray(repo)
    ? repo as Record<string, unknown>
    : {};
  const expected: Array<[string, unknown, unknown]> = [
    ['tenantId', operation.tenantId, state.tenantId],
    ['appKey', operation.appKey, state.appKey],
    ['operationId', operation.operationId, state.operationId],
    ['targetTenantId', binding.targetTenantId, state.targetTenantId],
    ['environment', binding.environment, state.environment],
    ['workflowPath', binding.workflowPath, state.workflowPath],
    ['ref', binding.ref, state.ref],
    ['commitSha', binding.commitSha, state.commitSha],
    ['configHash', binding.configHash, state.configHash],
    ['repoOwner', repository.owner, parseGitHubRepository(state.repo).owner],
    ['repoName', repository.name, parseGitHubRepository(state.repo).name],
    ['deployOnSuccess', binding.deployOnSuccess, true],
  ];
  const mismatch = expected.find(([, serverValue, localValue]) => serverValue !== localValue);
  if (mismatch) {
    throw new Error(`Retry state does not match the server setup field ${mismatch[0]}.`);
  }
}

/** Keep the one-time nonce outside the application repository. */
export function managedDeployStatePath(
  operationId: string,
  baseDir = join(homedir(), '.eai', 'managed-deployments'),
): string {
  if (!/^source-unknown-[A-Za-z0-9_-]+$/.test(operationId)) {
    throw new Error('Operation ID is not a valid source-unknown operation ID.');
  }
  return join(baseDir, `${operationId}.json`);
}

/** Persist retry authority with owner-only directory and file permissions. */
export async function saveManagedDeployState(state: ManagedDeployState, baseDir?: string): Promise<void> {
  requireCommitSha(state.commitSha);
  requireConfigHash(state.configHash);
  const path = managedDeployStatePath(state.operationId, baseDir);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}

/** Load only a state file whose immutable digest and operation identity remain valid. */
export async function loadManagedDeployState(operationId: string, baseDir?: string): Promise<ManagedDeployState> {
  const path = managedDeployStatePath(operationId, baseDir);
  try {
    await access(path);
  } catch {
    throw new Error(`No local retry state exists for ${operationId}. Resume can still read status, but retry needs the original nonce.`);
  }
  const parsed = JSON.parse(await readFile(path, 'utf8')) as ManagedDeployState;
  if (parsed.schema !== 'eai.managed-deploy-state.v1' || parsed.operationId !== operationId) {
    throw new Error(`Local retry state for ${operationId} is invalid.`);
  }
  requireCommitSha(parsed.commitSha);
  requireConfigHash(parsed.configHash);
  return parsed;
}
