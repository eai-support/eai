import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getAccessToken, getBrowserOpenCommand } from './auth.js';
import { PlatformAPIClient, type CliManagedGithubLinkSession, type CliManagedGithubLinkRequest } from './api.js';
import { ManagedSourceError, type CliManagedSourceBundle } from './eai-managed-source.js';

const exec = promisify(execFile);
const MANAGED_PORTAL_ORIGIN = /^https:\/\/(?:(?:dev|test)-admin-portal|admin-portal(?:\.(?:ca|eu))?)\.myenterprise\.ai$/;
const GITHUB_LINK_PATH = '/api/platform/generated-apps/github-user';

/** All browser and source operations must preserve this user-selected deployment scope. */
export interface CliManagedSourceScope {
  tenantId: string;
  appKey: string;
  targetTenantId: string;
  environment: CliManagedGithubLinkRequest['environment'];
  actorId: string;
}

/** The publisher owns repository identity and reports review separately from observed deployment readiness. */
export interface CliManagedSourceOperation extends CliManagedSourceScope {
  schemaVersion: 'eai.cli_managed_source_operation.v1';
  sourceMode: 'eai-cli-generated';
  operationId: string;
  status: 'accepted' | 'publishing' | 'pending_review' | 'deploying' | 'handoff_pending' | 'completed' | 'failed';
  githubLinkSessionId?: string;
  templateCommitSha: string;
  bundleSha256: string;
  configHash: string;
  verifiedGithubUser: NonNullable<CliManagedGithubLinkSession['verifiedGithubUser']>;
  repository: { owner: string; name: string; id?: number; nodeId?: string; defaultBranch?: string; private?: boolean };
  review?: { mergedSha?: string; pullRequestUrl?: string; [key: string]: unknown };
  deployment?: {
    requestId?: string; status?: string; liveUrl?: string; workflowRunId?: string; artifactDigest?: string; imageDigest?: string;
    runtimeIdentity?: { clientId?: string; principalId?: string };
    latestPointerVersion?: number; expectedLatestVersion?: number; requiresTenantInfra?: boolean;
    [key: string]: unknown;
  };
  error?: unknown;
  expiresAt: string;
  upload?: { url: string; ticket: string; expiresAt: string; sha256: string };
}

/** Compare server proof to the actual EAI token identity, never caller-supplied email text. */
export function validateCliGithubLinkSession(value: CliManagedGithubLinkSession, scope: CliManagedSourceScope, expectedSessionId?: string, allowExpiredVerifiedForUploadRetry = false): CliManagedGithubLinkSession {
  if (!value || value.schemaVersion !== 'eai.cli_managed_github_link_session.v1' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.sessionId)
    || (expectedSessionId && value.sessionId !== expectedSessionId)
    || !scope.actorId || value.actorId !== scope.actorId || value.tenantId !== scope.tenantId
    || value.appKey !== scope.appKey || value.targetTenantId !== scope.targetTenantId || value.environment !== scope.environment
    || !['pending', 'verified', 'expired', 'failed'].includes(value.status)) {
    throw new ManagedSourceError('GITHUB_LINK_BINDING_MISMATCH', 'GitHub linking response does not match the signed-in EAI actor, tenant, app and deployment scope.');
  }
  if (!Number.isFinite(Date.parse(value.expiresAt)) || (Date.parse(value.expiresAt) <= Date.now() && !(allowExpiredVerifiedForUploadRetry && value.status === 'verified')) || value.status === 'expired') {
    throw new ManagedSourceError('GITHUB_LINK_EXPIRED', 'The GitHub linking operation expired. Start the deployment again to obtain a new browser handoff.');
  }
  if (value.status === 'failed') throw new ManagedSourceError('GITHUB_LINK_FAILED', 'GitHub account linking failed. Start the deployment again and complete the verified browser handoff.');
  if (value.status === 'verified') {
    const user = value.verifiedGithubUser;
    if (!user || !Number.isSafeInteger(user.id) || user.id < 1 || typeof user.login !== 'string' || !/^[a-z\d][a-z\d-]{0,38}$/i.test(user.login)
      || typeof user.proofId !== 'string' || !user.proofId || user.actorId !== scope.actorId) {
      throw new ManagedSourceError('GITHUB_LINK_PROOF_INVALID', 'The platform has not returned a valid GitHub identity proof for this EAI actor.');
    }
  }
  cliManagedPortalOrigin(value);
  return value;
}

/** The authenticated linking response pins the Portal origin used for the later one-use upload. */
export function cliManagedPortalOrigin(session: CliManagedGithubLinkSession): string {
  let url: URL;
  try { url = new URL(session.browserUrl || ''); } catch { throw new ManagedSourceError('GITHUB_LINK_URL_INVALID', 'The platform did not return a valid GitHub linking browser URL.'); }
  const queryKeys = [...new Set([...url.searchParams.keys()])];
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
    || !MANAGED_PORTAL_ORIGIN.test(url.origin) || url.pathname !== GITHUB_LINK_PATH
    || queryKeys.length !== 1 || queryKeys[0] !== 'ticket'
    || url.searchParams.getAll('ticket').length !== 1 || !url.searchParams.get('ticket')) {
    throw new ManagedSourceError('GITHUB_LINK_URL_INVALID', 'GitHub linking requires an approved EAI Portal origin and exact one-use handoff URL.');
  }
  return url.origin;
}

async function responseSession(response: Response): Promise<CliManagedGithubLinkSession> {
  if (!response.ok) throw new ManagedSourceError('GITHUB_LINK_UNAVAILABLE', `GitHub identity verification is unavailable (${response.status}). Repair EAI sign-in, app access or the platform linking service before publishing.`);
  return await response.json() as CliManagedGithubLinkSession;
}

/** Browser linking carries no platform GitHub credential and never authorizes a client repository mutation. */
export async function verifyCliGithubIdentity(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  options: { sessionId?: string; interactive: boolean; timeoutMs: number },
  dependencies: { openBrowser?: (url: string) => Promise<void>; sleep?: (ms: number) => Promise<void> } = {},
): Promise<CliManagedGithubLinkSession> {
  if (!scope.actorId) throw new ManagedSourceError('EAI_ACTOR_REQUIRED', 'Sign in again with eai login so the platform can bind GitHub verification to your EAI identity.');
  let session = validateCliGithubLinkSession(await responseSession(options.sessionId
    ? await client.getCliManagedGithubLinkSession(scope.tenantId, scope.appKey, options.sessionId, scope.targetTenantId, scope.environment)
    : await client.createCliManagedGithubLinkSession(scope.tenantId, scope.appKey, {
      schemaVersion: 'eai.cli_managed_github_link.v1', targetTenantId: scope.targetTenantId,
      environment: scope.environment, idempotencyKey: randomUUID(),
    })), scope, options.sessionId);
  if (session.status === 'verified') return session;
  const url = new URL(session.browserUrl!);
  const nextAction = `Open ${url.href} to link or create your GitHub account, then rerun this command with --github-link-session ${session.sessionId}.`;
  if (!options.interactive) throw new ManagedSourceError('GITHUB_LINK_REQUIRED', nextAction);
  const openBrowser = dependencies.openBrowser || (async (browserUrl: string): Promise<void> => {
    const opener = getBrowserOpenCommand(browserUrl);
    await exec(opener.command, opener.args);
  });
  try { await openBrowser(url.href); } catch { throw new ManagedSourceError('GITHUB_LINK_BROWSER_REQUIRED', nextAction); }
  const sleep = dependencies.sleep || (async (ms: number): Promise<void> => { await new Promise(resolve => setTimeout(resolve, ms)); });
  const startedAt = Date.now();
  const deadline = startedAt + Math.min(options.timeoutMs, 10 * 60 * 1000);
  while (Date.now() < deadline) {
    const interval = Date.now() - startedAt < 30_000 ? 2_000 : 5_000;
    await sleep(Math.min(interval, deadline - Date.now()));
    session = validateCliGithubLinkSession(await responseSession(await client.getCliManagedGithubLinkSession(scope.tenantId, scope.appKey, session.sessionId, scope.targetTenantId, scope.environment)), scope, session.sessionId);
    if (session.status === 'verified') return session;
  }
  throw new ManagedSourceError('GITHUB_LINK_PENDING', nextAction);
}

/** Repeat submission of the same actor-scoped source snapshot cannot create duplicate bot publications. */
export function cliManagedSourceIdempotencyKey(scope: CliManagedSourceScope, bundleSha256: string): string {
  const digest = createHash('sha256').update(JSON.stringify(['eai-cli-managed-source-v1', scope.actorId, scope.tenantId, scope.appKey, scope.targetTenantId, scope.environment, bundleSha256])).digest();
  digest[6] = (digest[6] & 0x0f) | 0x80;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Every readback must retain the original actor, runtime scope and immutable source digest. */
export function validateCliManagedSourceOperation(value: CliManagedSourceOperation, scope: CliManagedSourceScope, expected?: { operationId?: string; templateCommitSha?: string; bundleSha256?: string; configHash?: string; githubLinkSessionId?: string }): CliManagedSourceOperation {
  if (!value || value.schemaVersion !== 'eai.cli_managed_source_operation.v1' || value.sourceMode !== 'eai-cli-generated'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(value.operationId) || (expected?.operationId && value.operationId !== expected.operationId)
    || value.actorId !== scope.actorId || !scope.actorId || value.tenantId !== scope.tenantId || value.appKey !== scope.appKey
    || value.targetTenantId !== scope.targetTenantId || value.environment !== scope.environment
    || !/^[a-f0-9]{40}$/.test(value.templateCommitSha) || !/^sha256:[a-f0-9]{64}$/.test(value.bundleSha256)
    || !/^sha256:[a-f0-9]{64}$/.test(value.configHash)
    || (expected?.templateCommitSha && value.templateCommitSha !== expected.templateCommitSha)
    || (expected?.bundleSha256 && value.bundleSha256 !== expected.bundleSha256)
    || (expected?.configHash && value.configHash !== expected.configHash)
    || (expected?.githubLinkSessionId && value.githubLinkSessionId !== expected.githubLinkSessionId)
    || !['accepted', 'publishing', 'pending_review', 'deploying', 'handoff_pending', 'completed', 'failed'].includes(value.status)
    || value.repository?.owner !== 'eai-generated-apps' || !/^[A-Za-z0-9_.-]+$/.test(value.repository?.name || '')
    || value.verifiedGithubUser?.actorId !== scope.actorId || !Number.isSafeInteger(value.verifiedGithubUser?.id) || value.verifiedGithubUser.id < 1
    || typeof value.verifiedGithubUser.proofId !== 'string' || !value.verifiedGithubUser.proofId) {
    throw new ManagedSourceError('MANAGED_SOURCE_BINDING_MISMATCH', 'Publication response does not match the authenticated actor, exact tenant/app/runtime scope and local-source snapshot.');
  }
  return value;
}

/** Publication status cannot prove deployment readiness; the unified operation route owns success. */
export function classifyCliManagedSourceOperation(operation: CliManagedSourceOperation): 'pending' | 'failed' | 'incomplete' {
  if (operation.status === 'failed') return 'failed';
  if (operation.status !== 'completed') return 'pending';
  return 'incomplete';
}

async function responseOperation(response: Response): Promise<CliManagedSourceOperation> {
  if (!response.ok) throw new ManagedSourceError('MANAGED_SOURCE_UNAVAILABLE', `Managed source operation is unavailable (${response.status}). Repair the platform operation or app-source access, then retry the exact operation.`);
  return await response.json() as CliManagedSourceOperation;
}

/** Prepare and submit only to the Portal origin authenticated during the same browser identity handoff. */
export async function submitCliManagedSource(client: PlatformAPIClient, scope: CliManagedSourceScope, link: CliManagedGithubLinkSession, bundle: CliManagedSourceBundle): Promise<CliManagedSourceOperation> {
  validateCliGithubLinkSession(link, scope);
  if (link.status !== 'verified') throw new ManagedSourceError('GITHUB_LINK_REQUIRED', 'Complete verified GitHub linking before source publication.');
  const expected = {
    templateCommitSha: bundle.templateCommitSha,
    bundleSha256: bundle.bundleSha256,
    configHash: bundle.configHash,
    githubLinkSessionId: link.sessionId,
  };
  const prepared = validateCliManagedSourceOperation(await responseOperation(await client.prepareCliManagedSource(scope.tenantId, scope.appKey, {
    schemaVersion: 'eai.cli_managed_source_preparation.v1', ...expected, fileCount: bundle.files.length,
    totalBytes: bundle.files.reduce((total, file) => total + file.size, 0),
    idempotencyKey: cliManagedSourceIdempotencyKey(scope, bundle.bundleSha256), githubLinkSessionId: link.sessionId,
    targetTenantId: scope.targetTenantId, environment: scope.environment,
  })), scope, expected);
  if (prepared.verifiedGithubUser.id !== link.verifiedGithubUser!.id) throw new ManagedSourceError('MANAGED_SOURCE_BINDING_MISMATCH', 'Publication is bound to a different verified GitHub account. No local source was uploaded.');
  if (prepared.status !== 'accepted' && prepared.status !== 'publishing') return prepared;
  return uploadCliManagedSource(client, scope, link, bundle, prepared);
}

/** Retry only the original actor-bound upload while its ticket remains valid. */
export async function resumeCliManagedSourceUpload(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  operation: CliManagedSourceOperation,
  bundle: CliManagedSourceBundle,
): Promise<CliManagedSourceOperation> {
  const prepared = validateCliManagedSourceOperation(operation, scope, {
    templateCommitSha: bundle.templateCommitSha,
    bundleSha256: bundle.bundleSha256,
    configHash: bundle.configHash,
  });
  if (!["accepted", "publishing"].includes(prepared.status) || !prepared.upload)
    return prepared;
  if (!prepared.githubLinkSessionId)
    throw new ManagedSourceError(
      "MANAGED_SOURCE_BINDING_MISMATCH",
      "The original verified GitHub link is missing from this operation. EAI must recover this upload.",
    );
  const link = validateCliGithubLinkSession(
    await responseSession(
      await client.getCliManagedGithubLinkSession(
        scope.tenantId,
        scope.appKey,
        prepared.githubLinkSessionId,
        scope.targetTenantId,
        scope.environment,
      ),
    ),
    scope,
    prepared.githubLinkSessionId,
    true,
  );
  if (
    link.status !== "verified" ||
    link.verifiedGithubUser?.id !== prepared.verifiedGithubUser.id
  )
    throw new ManagedSourceError(
      "MANAGED_SOURCE_BINDING_MISMATCH",
      "The original GitHub identity no longer matches this publication. No source was uploaded.",
    );
  return uploadCliManagedSource(client, scope, link, bundle, prepared);
}

async function uploadCliManagedSource(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  link: CliManagedGithubLinkSession,
  bundle: CliManagedSourceBundle,
  prepared: CliManagedSourceOperation,
): Promise<CliManagedSourceOperation> {
  const upload = prepared.upload;
  let url: URL;
  try {
    url = new URL(upload?.url || "");
  } catch {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_UPLOAD_INVALID",
      "The source operation has no valid upload authority. Resume or retry the same operation.",
    );
  }
  if (
    !upload ||
    url.origin !== cliManagedPortalOrigin(link) ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !==
      `/api/platform/generated-apps/cli-managed-source/uploads/${prepared.operationId}` ||
    !upload.ticket ||
    upload.sha256 !== bundle.bundleSha256 ||
    !Number.isFinite(Date.parse(upload.expiresAt)) ||
    Date.parse(upload.expiresAt) <= Date.now()
  ) {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_UPLOAD_INVALID",
      "The upload URL, expiry or digest is not bound to the verified platform operation. No source or token was sent.",
    );
  }
  const token = await getAccessToken();
  if (!token)
    throw new ManagedSourceError(
      "EAI_LOGIN_REQUIRED",
      "Sign in with eai login before submitting source.",
    );
  let response: Response;
  try {
    response = await fetch(url.href, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-EAI-Upload-Ticket": upload.ticket,
      },
      body: JSON.stringify({
        tenantId: scope.tenantId,
        appKey: scope.appKey,
        targetTenantId: scope.targetTenantId,
        environment: scope.environment,
        bundle,
      }),
    });
  } catch {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_UPLOAD_UNCERTAIN",
      `Source upload response was lost. Resume ${prepared.operationId}; do not create a second publication or use a customer GitHub token.`,
    );
  }
  if (!response.ok)
    throw new ManagedSourceError(
      "MANAGED_SOURCE_UPLOAD_FAILED",
      `Source upload returned ${response.status}. Resume ${prepared.operationId} to inspect its authoritative status before retrying.`,
    );
  return validateCliManagedSourceOperation(
    await responseOperation(
      await client.getCliManagedSourceOperation(
        scope.tenantId,
        scope.appKey,
        prepared.operationId,
        scope.targetTenantId,
        scope.environment,
      ),
    ),
    scope,
    {
      templateCommitSha: bundle.templateCommitSha,
      bundleSha256: bundle.bundleSha256,
      configHash: bundle.configHash,
      operationId: prepared.operationId,
      githubLinkSessionId: link.sessionId,
    },
  );
}

/** Poll one publication and return pending review distinctly from deployed readiness. */
export async function pollCliManagedSource(client: PlatformAPIClient, scope: CliManagedSourceScope, operationId: string, options: { wait: boolean; timeoutMs: number }, initial?: CliManagedSourceOperation, dependencies: { sleep?: (ms: number) => Promise<void> } = {}): Promise<CliManagedSourceOperation> {
  const startedAt = Date.now();
  const deadline = startedAt + options.timeoutMs;
  const sleep = dependencies.sleep || (async (ms: number): Promise<void> => { await new Promise(resolve => setTimeout(resolve, ms)); });
  let operation = initial && validateCliManagedSourceOperation(initial, scope, { operationId });
  const expected = {
    operationId,
    templateCommitSha: initial?.templateCommitSha,
    bundleSha256: initial?.bundleSha256,
    configHash: initial?.configHash,
    githubLinkSessionId: initial?.githubLinkSessionId,
  };
  while (true) {
    operation = operation || validateCliManagedSourceOperation(await responseOperation(await client.getCliManagedSourceOperation(scope.tenantId, scope.appKey, operationId, scope.targetTenantId, scope.environment)), scope, expected);
    expected.templateCommitSha = operation.templateCommitSha;
    expected.bundleSha256 = operation.bundleSha256;
    expected.configHash = operation.configHash;
    expected.githubLinkSessionId = operation.githubLinkSessionId;
    if (!options.wait || classifyCliManagedSourceOperation(operation) !== 'pending' || operation.status === 'pending_review' || Date.now() >= deadline) return operation;
    const interval = Date.now() - startedAt < 30_000 ? 2_000 : 5_000;
    await sleep(Math.max(0, Math.min(interval, deadline - Date.now())));
    operation = undefined;
  }
}
