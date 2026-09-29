import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  managedDeployNonceSha256,
  parseGitHubRepository,
  requireBranch,
  requireCommitSha,
  requireConfigHash,
  requireInstallationId,
  requireWorkflowPath,
  type ManagedDeployState,
  type ManagedDispatchClaim,
} from './eai-managed-deploy-contract.js';
import {
  assertDirectoryIdentities,
  assertTrustedDirectory,
  createPrivateFileNoFollow,
  ensureDirectory,
  managedFileOpenFlags,
  snapshotNoLinkDirectoryPath,
  readPrivateFileNoFollow,
  updatePrivateFileNoFollow,
} from './eai-managed-deploy-filesystem.js';
import { isManagedDeploymentIdentifier } from './eai-managed-identifiers.js';
import { requireManagedPublicApiUrl } from './managed-public-api.js';
import { getActiveProfile } from './profile.js';

/** Keep the one-time nonce outside the application repository. */
export function managedDeployStatePath(
  operationId: string,
  baseDir = join(homedir(), '.eai', 'managed-deployments'),
): string {
  if (!isManagedDeploymentIdentifier(operationId)) {
    throw new Error('Operation ID is not a valid managed operation ID.');
  }
  return join(baseDir, `${operationId}.json`);
}

function validateManagedDeployState(state: ManagedDeployState): void {
  if (!Object.hasOwn(state, 'profileName') || typeof state.profileName !== 'string'
    || !state.profileName.trim() || state.profileName.length > 256 || state.profileName !== getActiveProfile()) {
    throw new Error('Managed deployment original operation authority is missing or differs from the original EAI profile.');
  }
  requireCommitSha(state.commitSha);
  requireConfigHash(state.configHash);
  requireBranch(state.branch);
  requireWorkflowPath(state.workflowPath);
  requireInstallationId(state.installationId);
  parseGitHubRepository(state.repo);
  managedDeployNonceSha256(state.nonce);
  if (!state.actorId || !/^[A-Za-z0-9._:@-]{1,256}$/.test(state.actorId)
    || !state.githubLinkSessionId || !/^[A-Za-z0-9_-]{1,128}$/.test(state.githubLinkSessionId)
    || !Number.isSafeInteger(state.githubUserId) || Number(state.githubUserId) < 1
    || !state.githubLogin || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(state.githubLogin)
    || !state.githubProofId || !/^[A-Za-z0-9._:-]{1,256}$/.test(state.githubProofId)) {
    throw new Error('Managed deployment state is missing its exact EAI and GitHub actor binding.');
  }
  if (!state.publicApiUrl) {
    throw new Error('Managed deployment retry state is missing its original PublicAPI URL; start a new deployment.');
  }
  requireManagedPublicApiUrl(state.publicApiUrl);
}

/** Reject shared writable ancestors before creating or securing recovery authority. */
export async function prepareManagedDeployStateDirectory(baseDir?: string): Promise<void> {
  const directory = baseDir ?? join(homedir(), '.eai', 'managed-deployments');
  if (!isAbsolute(directory) || resolve(directory) !== directory) {
    throw new Error('Managed deployment refused an untrusted directory path.');
  }
  const parents = await snapshotNoLinkDirectoryPath(baseDir ? dirname(directory) : homedir());
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  for (const parent of parents) {
    const status = await lstat(parent.systemAliasTarget?.path ?? parent.path);
    // A root-owned sticky temporary parent cannot rename another user's private child.
    const systemTemporaryParent = status.uid === 0 && (status.mode & 0o1000) !== 0;
    if (process.platform !== 'win32' && (
      (status.uid !== 0 && uid !== null && status.uid !== uid)
      || ((status.mode & 0o022) !== 0 && !systemTemporaryParent)
    )) {
      throw new Error('Managed deployment refused an untrusted directory ancestor.');
    }
  }
  await assertDirectoryIdentities(parents);
  if (!baseDir) {
    await assertTrustedDirectory(homedir());
    await ensureDirectory(join(homedir(), '.eai'), 0o700);
    parents.push(...await snapshotNoLinkDirectoryPath(dirname(directory)));
  }
  await ensureDirectory(directory, 0o700);
  const handle = await open(directory, constants.O_RDONLY | managedFileOpenFlags());
  try {
    await assertDirectoryIdentities(parents);
    await assertTrustedDirectory(directory);
    const [opened, current] = await Promise.all([handle.stat(), lstat(directory)]);
    if (!opened.isDirectory() || opened.dev !== current.dev || opened.ino !== current.ino) {
      throw new Error('Managed deployment recovery directory changed before permission update.');
    }
    if ((opened.mode & 0o777) !== 0o700) await handle.chmod(0o700);
    await assertDirectoryIdentities(parents);
  } finally {
    await handle.close();
  }
}

/** Preserve the original authority and monotonically merge progress under an exclusive local guard. */
export async function saveManagedDeployState(state: ManagedDeployState, baseDir?: string): Promise<void> {
  validateManagedDeployState(state);
  const fields = ['schema', 'tenantId', 'targetTenantId', 'appKey', 'operationId', 'nonce', 'repo', 'branch',
    'ref', 'commitSha', 'workflowPath', 'configHash', 'environment', 'installationId', 'actorId',
    'githubLinkSessionId', 'githubUserId', 'githubLogin', 'githubProofId', 'publicApiUrl', 'profileName'] as const;
  if (state.schema !== 'eai.managed-deploy-state.v1' || fields.some(field => !Object.hasOwn(state, field))) {
    throw new Error('Managed deployment state is missing its original operation authority.');
  }
  if (state.githubRunId !== undefined && (!Number.isSafeInteger(state.githubRunId) || state.githubRunId < 1)) {
    throw new Error('GitHub workflow run ID must be a positive integer.');
  }
  const path = managedDeployStatePath(state.operationId, baseDir);
  await prepareManagedDeployStateDirectory(baseDir);
  try {
    await createPrivateFileNoFollow(path, `${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const result = await updatePrivateFileNoFollow(path, content => {
      const current = JSON.parse(content) as ManagedDeployState;
      validateManagedDeployState(current);
      if (fields.some(field => !Object.hasOwn(current, field) || current[field] !== state[field])) {
        throw new Error('Managed deployment state differs from its original operation authority.');
      }
      if (current.githubRunId !== undefined && (!Number.isSafeInteger(current.githubRunId) || current.githubRunId < 1
        || (state.githubRunId !== undefined && current.githubRunId !== state.githubRunId))) {
        throw new Error('Managed deployment state already binds a different or invalid GitHub workflow run ID.');
      }
      const progress = {
        dispatchStartedAt: current.dispatchStartedAt ?? state.dispatchStartedAt,
        dispatchedAt: current.dispatchedAt ?? state.dispatchedAt,
        githubRunId: current.githubRunId ?? state.githubRunId,
      };
      if (Object.entries(progress).every(([field, value]) => current[field as keyof ManagedDeployState] === value)) return content;
      return `${JSON.stringify({ ...current, ...progress }, null, 2)}\n`;
    });
    Object.assign(state, JSON.parse(result) as ManagedDeployState);
  }
}

function managedDispatchBindingSha256(state: ManagedDeployState): string {
  return `sha256:${createHash('sha256').update(JSON.stringify([
    state.tenantId, state.targetTenantId, state.appKey, state.operationId,
    state.repo, state.ref, state.commitSha, state.workflowPath, state.configHash,
    state.environment, state.installationId, state.actorId, state.githubLinkSessionId,
    requireManagedPublicApiUrl(state.publicApiUrl), state.profileName,
    state.githubUserId, state.githubLogin, state.githubProofId,
  ])).digest('hex')}`;
}

/** A durable exclusive claim survives crashes and prevents concurrent reuse of the nonce. */
export async function claimManagedDeployDispatch(state: ManagedDeployState, baseDir?: string): Promise<boolean> {
  validateManagedDeployState(state);
  await prepareManagedDeployStateDirectory(baseDir);
  const marker = `${managedDeployStatePath(state.operationId, baseDir)}.dispatch`;
  const now = new Date().toISOString();
  const claim: ManagedDispatchClaim = {
    schema: 'eai.managed-dispatch-claim.v1',
    operationId: state.operationId,
    bindingSha256: managedDispatchBindingSha256(state),
    nonceSha256: managedDeployNonceSha256(state.nonce),
    status: 'dispatching',
    claimedAt: now,
    updatedAt: now,
  };
  try {
    await createPrivateFileNoFollow(marker, `${JSON.stringify(claim, null, 2)}\n`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let lastError: unknown;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      try {
        await readManagedDeployDispatchClaim(state, baseDir);
        return false;
      } catch (readError) {
        lastError = readError;
        await delay(10);
      }
    }
    throw lastError;
  }
}

/** Read and authenticate a prior claim before using it for crash recovery. */
export async function readManagedDeployDispatchClaim(
  state: ManagedDeployState,
  baseDir?: string,
): Promise<ManagedDispatchClaim> {
  validateManagedDeployState(state);
  const marker = `${managedDeployStatePath(state.operationId, baseDir)}.dispatch`;
  return parseManagedDeployDispatchClaim(state, await readPrivateFileNoFollow(marker));
}

function parseManagedDeployDispatchClaim(state: ManagedDeployState, content: string): ManagedDispatchClaim {
  let claim: ManagedDispatchClaim;
  try {
    claim = JSON.parse(content) as ManagedDispatchClaim;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Managed deployment dispatch claim is not valid JSON.', { cause: error });
    }
    throw error;
  }
  if (claim.schema !== 'eai.managed-dispatch-claim.v1' || claim.operationId !== state.operationId
    || claim.bindingSha256 !== managedDispatchBindingSha256(state)
    || claim.nonceSha256 !== managedDeployNonceSha256(state.nonce)
    || !['claimed', 'dispatching', 'accepted'].includes(claim.status)
    || (claim.githubRunId !== undefined && (!Number.isSafeInteger(claim.githubRunId) || claim.githubRunId < 1))
    || !Number.isFinite(Date.parse(claim.claimedAt)) || !Number.isFinite(Date.parse(claim.updatedAt))) {
    throw new Error('Managed deployment dispatch claim does not match the exact operation binding.');
  }
  return claim;
}

/** Hold the exact local guard across read/write; accepted status and an observed run ID cannot regress. */
export async function recordManagedDeployDispatch(
  state: ManagedDeployState,
  status: ManagedDispatchClaim['status'],
  githubRunId?: number,
  baseDir?: string,
): Promise<ManagedDispatchClaim> {
  validateManagedDeployState(state);
  const marker = `${managedDeployStatePath(state.operationId, baseDir)}.dispatch`;
  if (githubRunId !== undefined && (!Number.isSafeInteger(githubRunId) || githubRunId < 1)) {
    throw new Error('GitHub workflow run ID must be a positive integer.');
  }
  const result = await updatePrivateFileNoFollow(marker, content => {
    const current = parseManagedDeployDispatchClaim(state, content);
    if (!['dispatching', 'accepted'].includes(status) || (current.status === 'accepted' && status !== 'accepted')) {
      throw new Error('Managed deployment dispatch claim cannot move backwards.');
    }
    if (current.githubRunId !== undefined && githubRunId !== undefined && current.githubRunId !== githubRunId) {
      throw new Error('Managed deployment dispatch claim already binds a different GitHub workflow run ID.');
    }
    if (current.status === status && (githubRunId === undefined || current.githubRunId === githubRunId)) return content;
    return `${JSON.stringify({
      ...current, status, updatedAt: new Date().toISOString(),
      ...(githubRunId !== undefined ? { githubRunId } : {}),
    }, null, 2)}\n`;
  });
  return JSON.parse(result) as ManagedDispatchClaim;
}

/** Load only a state file whose immutable digest and operation identity remain valid. */
export async function loadManagedDeployState(operationId: string, baseDir?: string): Promise<ManagedDeployState> {
  const path = managedDeployStatePath(operationId, baseDir);
  await prepareManagedDeployStateDirectory(baseDir);
  let parsed: ManagedDeployState;
  try {
    parsed = JSON.parse(await readPrivateFileNoFollow(path)) as ManagedDeployState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`No local retry state exists for ${operationId}. Resume can still read status, but retry needs the original nonce.`, { cause: error });
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Local retry state for ${operationId} is not valid JSON.`, { cause: error });
    }
    throw error;
  }
  if (parsed.schema !== 'eai.managed-deploy-state.v1' || parsed.operationId !== operationId) {
    throw new Error(`Local retry state for ${operationId} is invalid.`);
  }
  validateManagedDeployState(parsed);
  return parsed;
}
