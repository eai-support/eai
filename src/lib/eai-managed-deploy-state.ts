import { createHash } from 'node:crypto';
import { chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
  assertTrustedDirectory,
  createPrivateFileNoFollow,
  ensureDirectory,
  readPrivateFileNoFollow,
  writePrivateFileNoFollow,
} from './eai-managed-deploy-filesystem.js';
import { requireManagedPublicApiUrl } from './managed-public-api.js';

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

function validateManagedDeployState(state: ManagedDeployState): void {
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

async function prepareStateDirectory(baseDir?: string): Promise<void> {
  if (!baseDir) {
    await assertTrustedDirectory(homedir());
    await ensureDirectory(join(homedir(), '.eai'), 0o700);
  }
  const directory = baseDir ?? join(homedir(), '.eai', 'managed-deployments');
  await ensureDirectory(directory, 0o700);
  await chmod(directory, 0o700);
}

/** Persist retry authority with owner-only directory and file permissions. */
export async function saveManagedDeployState(state: ManagedDeployState, baseDir?: string): Promise<void> {
  validateManagedDeployState(state);
  const path = managedDeployStatePath(state.operationId, baseDir);
  await prepareStateDirectory(baseDir);
  await writePrivateFileNoFollow(path, `${JSON.stringify(state, null, 2)}\n`);
}

function managedDispatchBindingSha256(state: ManagedDeployState): string {
  return `sha256:${createHash('sha256').update(JSON.stringify([
    state.tenantId, state.targetTenantId, state.appKey, state.operationId,
    state.repo, state.ref, state.commitSha, state.workflowPath, state.configHash,
    state.environment, state.installationId, state.actorId, state.githubLinkSessionId,
    state.githubUserId, state.githubLogin, state.githubProofId,
  ])).digest('hex')}`;
}

/** A durable exclusive claim survives crashes and prevents concurrent reuse of the nonce. */
export async function claimManagedDeployDispatch(state: ManagedDeployState, baseDir?: string): Promise<boolean> {
  validateManagedDeployState(state);
  await prepareStateDirectory(baseDir);
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
  let claim: ManagedDispatchClaim;
  try {
    claim = JSON.parse(await readPrivateFileNoFollow(marker)) as ManagedDispatchClaim;
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
    || !Number.isFinite(Date.parse(claim.claimedAt)) || !Number.isFinite(Date.parse(claim.updatedAt))) {
    throw new Error('Managed deployment dispatch claim does not match the exact operation binding.');
  }
  return claim;
}

/** Atomically advance the crash-recovery claim after validating its complete binding. */
export async function recordManagedDeployDispatch(
  state: ManagedDeployState,
  status: ManagedDispatchClaim['status'],
  githubRunId?: number,
  baseDir?: string,
): Promise<ManagedDispatchClaim> {
  const marker = `${managedDeployStatePath(state.operationId, baseDir)}.dispatch`;
  const current = await readManagedDeployDispatchClaim(state, baseDir);
  if (status === 'claimed' || (current.status === 'accepted' && status !== 'accepted')) {
    throw new Error('Managed deployment dispatch claim cannot move backwards.');
  }
  if (githubRunId !== undefined && (!Number.isSafeInteger(githubRunId) || githubRunId < 1)) {
    throw new Error('GitHub workflow run ID must be a positive integer.');
  }
  const next: ManagedDispatchClaim = {
    ...current,
    status,
    updatedAt: new Date().toISOString(),
    ...(githubRunId !== undefined ? { githubRunId } : {}),
  };
  await writePrivateFileNoFollow(marker, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** Load only a state file whose immutable digest and operation identity remain valid. */
export async function loadManagedDeployState(operationId: string, baseDir?: string): Promise<ManagedDeployState> {
  const path = managedDeployStatePath(operationId, baseDir);
  await prepareStateDirectory(baseDir);
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
