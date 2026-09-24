import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { PlatformAPIClient, type SourceUnknownOperationResponse } from '../lib/api.js';
import { makeSpinner, normalizeFormat, resolveCommandContext } from '../lib/context.js';
import {
  EAI_MANAGED_WORKFLOW_PATH,
  assertManagedDeployStateMatchesOperation,
  buildManagedDeployConfigHash,
  claimManagedDeployDispatch,
  classifyManagedOperationStatus,
  installCanonicalManagedDeployFiles,
  loadManagedDeployState,
  parseGitHubRepository,
  requireBranch,
  requireCommitSha,
  requireInstallationId,
  requireManagedPublicApiUrl,
  requireWorkflowPath,
  saveManagedDeployState,
  type ManagedDeployState,
} from '../lib/eai-managed-deploy.js';
import * as out from '../lib/output.js';
import { buildCliManagedSourceBundle, chooseManagedDeploySource, ManagedSourceError, writeCliManagedSourceReceipt } from '../lib/eai-managed-source.js';
import { classifyCliManagedSourceOperation, pollCliManagedSource, submitCliManagedSource, verifyCliGithubIdentity, type CliManagedSourceOperation, type CliManagedSourceScope } from '../lib/eai-managed-source-client.js';

const exec = promisify(execFile);
const DEFAULT_TIMEOUT_SECONDS = 1_200;
const POLL_INTERVALS_MS = [2_000, 3_000, 5_000, 10_000] as const;
const MANAGED_DEPLOY_ENVIRONMENTS = new Set(['preview', 'dev', 'test', 'prod']);
const NEW_SOURCE_OPERATION_ACTION = 'Start a new EAI managed deployment with --repo and --installation-id, without --resume or --retry, to issue a fresh source operation and nonce.';

type ManagedDeployCommandRunner = (command: string, args: string[], cwd?: string) => Promise<string>;

interface ManagedDeployOptions {
  target: string;
  tenantId: string;
  targetTenantId?: string;
  repo?: string;
  source?: string;
  githubLinkSession?: string;
  installationId?: string;
  branch: string;
  workflow: string;
  environment: string;
  commit?: string;
  resume?: string;
  retry?: string;
  wait: boolean;
  timeout: string;
  format: string;
  json?: boolean;
}

interface GitHubRepoView {
  viewerPermission?: string;
  isArchived?: boolean;
}

class ManagedDeployFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly nextAction: string,
  ) {
    super(message);
  }
}

function fail(code: string, message: string, nextAction: string): never {
  throw new ManagedDeployFailure(code, message, nextAction);
}

async function run(command: string, args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await exec(command, args, { cwd });
    return stdout.trim();
  } catch (error) {
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr || '').trim()
      : '';
    throw new Error(stderr || (error instanceof Error ? error.message : String(error)), { cause: error });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return isRecord(value) ? value : { value };
  } catch {
    return { message: raw };
  }
}

function apiMessage(payload: Record<string, unknown>, fallback: string): string {
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.detail === 'string') return payload.detail;
  if (isRecord(payload.detail) && typeof payload.detail.message === 'string') return payload.detail.message;
  return fallback;
}

function repositoryNextAction(status: number, message: string, tenantId: string, repo: string): string {
  const normalized = message.toLowerCase();
  if (status === 401) return 'Run `eai login`, confirm the account with `eai whoami`, then retry.';
  if (status === 403 && normalized.includes('tenant')) {
    return `Select an account with access to tenant ${tenantId}, then run \`eai whoami\` and retry.`;
  }
  if (normalized.includes('github-connection') || normalized.includes('connection')) {
    return `Create or repair the tenant GitHub connection for ${repo}, then retry with its installation ID.`;
  }
  if (normalized.includes('installation')) {
    return `Install the EAI GitHub App for ${repo}, then retry with the exact installation ID.`;
  }
  if (status === 403) return 'Ask a tenant administrator for app-source permission, then retry.';
  return 'Use the returned request ID to inspect PublicAPI and AdminAPI, then retry the same command.';
}

async function requireApiSuccess(
  response: Response,
  code: string,
  nextAction: (payload: Record<string, unknown>, status: number) => string,
): Promise<Record<string, unknown>> {
  const payload = await responsePayload(response);
  if (!response.ok) {
    fail(code, apiMessage(payload, `${response.status} ${response.statusText}`), nextAction(payload, response.status));
  }
  return payload;
}

/** Authenticate first, then overlap the independent repository-policy and immutable-ref reads. */
export async function verifyGitHubAccess(
  repo: string,
  branch: string,
  expectedSha: string,
  runCommand: ManagedDeployCommandRunner = run,
): Promise<void> {
  try {
    await runCommand('gh', ['auth', 'status']);
  } catch (error) {
    fail('GITHUB_LOGIN_REQUIRED', String(error), 'Run `gh auth login`, then retry the same deploy command.');
  }

  const repository = parseGitHubRepository(repo);
  const repoViewPromise = runCommand(
    'gh',
    ['repo', 'view', repo, '--json', 'viewerPermission,isArchived'],
  ).then((value) => JSON.parse(value) as GitHubRepoView).catch((error: unknown) => {
    fail('GITHUB_REPOSITORY_UNAVAILABLE', String(error), `Confirm the signed-in GitHub account can read ${repo}.`);
  });
  const remoteShaPromise = runCommand('gh', [
    'api',
    `repos/${repository.owner}/${repository.name}/git/ref/heads/${encodeURIComponent(branch)}`,
  ]).then((value) => {
    const ref = JSON.parse(value) as { object?: { sha?: string } };
    return requireCommitSha(String(ref.object?.sha || ''), 'Remote branch SHA');
  }).catch((error: unknown) => {
    fail('GITHUB_BRANCH_UNAVAILABLE', String(error), `Push branch ${branch} to ${repo}, then retry.`);
  });
  const [repoView, remoteSha] = await Promise.all([repoViewPromise, remoteShaPromise]);

  if (repoView.isArchived) {
    fail('GITHUB_REPOSITORY_ARCHIVED', `${repo} is archived.`, 'Choose an active repository before deployment.');
  }
  if (!['ADMIN', 'MAINTAIN', 'WRITE'].includes(String(repoView.viewerPermission || '').toUpperCase())) {
    fail('GITHUB_WRITE_REQUIRED', `The GitHub account does not have write access to ${repo}.`, 'Ask a repository administrator for write access, then retry.');
  }
  if (remoteSha !== expectedSha) {
    fail(
      'GITHUB_SHA_MISMATCH',
      `Local HEAD ${expectedSha} does not match ${repo}@${branch} (${remoteSha}).`,
      `Push the exact local commit to ${branch}, or check out the remote commit, then retry.`,
    );
  }
}

/** Bound early exact-operation checks while retaining the 10-second steady-state ceiling. */
export function managedDeployPollDelayMs(pendingReadsAtStatus: number, remainingMs: number): number {
  const intervalIndex = Math.min(
    Math.max(0, Math.floor(pendingReadsAtStatus) - 1),
    POLL_INTERVALS_MS.length - 1,
  );
  return Math.max(0, Math.min(POLL_INTERVALS_MS[intervalIndex], remainingMs));
}

async function verifyLocalSource(
  root: string,
  repo: string,
  requestedBranch: string,
  requestedCommit?: string,
): Promise<{ branch: string; commitSha: string }> {
  let commitSha: string;
  let branch: string;
  let origin: string;
  try {
    [commitSha, branch, origin] = await Promise.all([
      run('git', ['rev-parse', 'HEAD'], root),
      run('git', ['branch', '--show-current'], root),
      run('git', ['remote', 'get-url', 'origin'], root),
    ]);
  } catch (error) {
    fail('GIT_REPOSITORY_REQUIRED', String(error), 'Run the command from a Git repository with an origin remote.');
  }
  commitSha = requireCommitSha(commitSha);
  branch = requireBranch(branch);
  const expectedBranch = requireBranch(requestedBranch);
  if (branch !== expectedBranch) {
    fail('GIT_BRANCH_MISMATCH', `Checked-out branch ${branch} does not match requested branch ${expectedBranch}.`, `Check out ${expectedBranch}, then retry.`);
  }
  if (requestedCommit && requireCommitSha(requestedCommit) !== commitSha) {
    fail('GIT_SHA_MISMATCH', `Checked-out commit ${commitSha} does not match --commit ${requestedCommit}.`, 'Check out the exact requested commit, then retry.');
  }
  if (parseGitHubRepository(origin).slug.toLowerCase() !== parseGitHubRepository(repo).slug.toLowerCase()) {
    fail('GIT_REMOTE_MISMATCH', `Origin ${origin} does not match --repo ${repo}.`, 'Use the repository bound to this project, or correct the origin remote.');
  }
  const changes = await run('git', ['status', '--porcelain', '--untracked-files=all'], root);
  if (changes) {
    fail('GIT_WORKTREE_DIRTY', 'The project has uncommitted files, so deployment cannot bind an immutable commit.', `Commit and push all intended files on ${branch}, then retry.`);
  }
  return { branch, commitSha };
}

async function dispatchWorkflow(state: ManagedDeployState, publicApiUrl: string, root: string): Promise<void> {
  const trustedPublicApiUrl = requireManagedPublicApiUrl(publicApiUrl);
  if (state.publicApiUrl && state.publicApiUrl !== trustedPublicApiUrl) {
    fail('RETRY_API_BINDING_MISMATCH', 'Retry profile differs from the original workflow endpoint.', 'Select the original EAI profile, then resume this exact operation.');
  }
  await verifyGitHubAccess(state.repo, state.branch, state.commitSha);
  if (state.dispatchedAt || state.dispatchStartedAt || !await claimManagedDeployDispatch(state)) return;
  // Persist before dispatch: a failed response may still mean GitHub accepted the run.
  state.dispatchStartedAt = new Date().toISOString();
  state.publicApiUrl = trustedPublicApiUrl;
  await saveManagedDeployState(state);
  try {
    await run('gh', [
      'workflow', 'run', state.workflowPath,
      '--repo', state.repo,
      '--ref', state.branch,
      '-f', `app_key=${state.appKey}`,
      '-f', `tenant_id=${state.tenantId}`,
      '-f', `operation_id=${state.operationId}`,
      '-f', `nonce=${state.nonce}`,
      '-f', `config_hash=${state.configHash}`,
      '-f', `commit_sha=${state.commitSha}`,
      '-f', `public_api_url=${trustedPublicApiUrl}`,
      '-f', `env=${state.environment}`,
    ], root);
  } catch (error) {
    fail(
      'GITHUB_WORKFLOW_DISPATCH_FAILED',
      String(error),
      `Dispatch acceptance is uncertain. Resume ${state.operationId} and inspect GitHub Actions. If no run was accepted, start a fresh source operation; retry will not reuse this nonce.`,
    );
  }
  state.dispatchedAt = new Date().toISOString();
  await saveManagedDeployState(state);
}

async function prepareRuntime(client: PlatformAPIClient, state: ManagedDeployState): Promise<void> {
  const result = await requireApiSuccess(
    await client.bootstrapSourceUnknownRuntime(
      state.tenantId, state.appKey, state.environment, state.operationId, state.targetTenantId,
    ),
    'RUNTIME_BOOTSTRAP_FAILED',
    () => `Repair runtime identity provisioning, then retry the exact operation ${state.operationId}; no workflow has been dispatched.`,
  );
  if (result.status !== 'configured' || result.sourceOperationId !== state.operationId
    || result.tenantId !== state.targetTenantId || result.appKey !== state.appKey
    || result.environment !== state.environment) {
    fail('RUNTIME_BOOTSTRAP_BINDING_MISMATCH', 'PublicAPI did not confirm configured runtime identity for the exact operation and target.', 'Stop and inspect the PublicAPI runtime-bootstrap response before dispatching.');
  }
}

async function readExactOperation(
  client: PlatformAPIClient,
  tenantId: string,
  targetTenantId: string,
  appKey: string,
  operationId: string,
): Promise<SourceUnknownOperationResponse> {
  const response = await client.getSourceUnknownOperation(tenantId, appKey, operationId, targetTenantId);
  const payload = await requireApiSuccess(
    response,
    'SOURCE_OPERATION_READ_FAILED',
    () => `Confirm ${operationId} belongs to tenant ${tenantId} and app ${appKey}, then retry with --resume.`,
  );
  if (payload.operationId !== operationId || payload.appKey !== appKey || payload.tenantId !== tenantId) {
    fail('SOURCE_OPERATION_BINDING_MISMATCH', 'PublicAPI returned an operation with a different tenant, app, or operation ID.', 'Stop and escalate with the PublicAPI request ID.');
  }
  const operation = payload as unknown as SourceUnknownOperationResponse;
  const operationTargetTenantId = operation.targetTenantId
    ?? (isRecord(operation.setup) && typeof operation.setup.targetTenantId === 'string'
      ? operation.setup.targetTenantId
      : undefined);
  if (operationTargetTenantId !== targetTenantId) {
    fail(
      'SOURCE_OPERATION_TARGET_MISMATCH',
      `PublicAPI returned target tenant ${operationTargetTenantId || '<missing>'} instead of ${targetTenantId}.`,
      'Use the exact target tenant recorded by the source operation; do not retry against another tenant.',
    );
  }
  return operation;
}

async function pollExactOperation(
  client: PlatformAPIClient,
  state: Pick<ManagedDeployState, 'tenantId' | 'targetTenantId' | 'appKey' | 'operationId'>,
  wait: boolean,
  timeoutSeconds: number,
): Promise<SourceUnknownOperationResponse> {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  let lastPendingStatus: string | undefined;
  let pendingReadsAtStatus = 0;
  for (;;) {
    const operation = await readExactOperation(
      client,
      state.tenantId,
      state.targetTenantId,
      state.appKey,
      state.operationId,
    );
    if ('commitSha' in state) {
      try {
        assertManagedDeployStateMatchesOperation(state as ManagedDeployState, operation);
      } catch (error) {
        fail('SOURCE_OPERATION_SOURCE_MISMATCH', error instanceof Error ? error.message : String(error), 'Stop and inspect the exact operation source binding; do not accept this runtime as the requested deployment.');
      }
    }
    const classification = classifyManagedOperationStatus(operation);
    if (!wait || classification !== 'pending') return operation;
    if (Date.now() >= deadline) {
      fail(
        'SOURCE_OPERATION_TIMEOUT',
        `Operation ${state.operationId} is still ${operation.status}.`,
        `Inspect the exact GitHub Actions run for commit ${'commitSha' in state ? String(state.commitSha) : '<stored commit>'}. Check OIDC, evidence callback, and TenantInfra logs, then resume ${state.operationId}.`,
      );
    }
    const pendingStatus = String(operation.status || 'unknown').toLowerCase();
    pendingReadsAtStatus = pendingStatus === lastPendingStatus ? pendingReadsAtStatus + 1 : 1;
    lastPendingStatus = pendingStatus;
    const delayMs = managedDeployPollDelayMs(pendingReadsAtStatus, deadline - Date.now());
    await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
  }
}

function hasAcceptedWorkflowEvidence(operation: SourceUnknownOperationResponse): boolean {
  return operation.evidence?.status === 'accepted' || operation.setup?.status === 'consumed';
}

function requiresNewSourceOperation(operation: SourceUnknownOperationResponse): boolean {
  return ['expired', 'revoked'].includes(operation.status.trim().toLowerCase())
    && !hasAcceptedWorkflowEvidence(operation);
}

function printOperation(
  format: string,
  operation: SourceUnknownOperationResponse,
  extra: Record<string, unknown> = {},
): void {
  const classification = classifyManagedOperationStatus(operation);
  const setup = isRecord(operation.setup) ? operation.setup : {};
  const repository = isRecord(setup.repo) ? setup.repo : {};
  const targetTenantId = operation.targetTenantId
    ?? (typeof setup.targetTenantId === 'string' ? setup.targetTenantId : undefined);
  const sourceBinding = {
    repository: typeof repository.owner === 'string' && typeof repository.name === 'string'
      ? `${repository.owner}/${repository.name}`
      : extra.repo,
    workflowPath: setup.workflowPath,
    ref: setup.ref ?? extra.ref,
    commitSha: setup.commitSha ?? extra.commitSha,
    configHash: operation.configHash ?? setup.configHash ?? extra.configHash,
  };
  const exactCommand = `eai deploy app ${operation.appKey} --target eai --tenant-id ${operation.tenantId}`
    + ` --target-tenant-id ${targetTenantId || '<target-tenant-id>'}`;
  const nextAction = requiresNewSourceOperation(operation)
    ? NEW_SOURCE_OPERATION_ACTION
    : classification === 'succeeded'
      ? `Run \`eai deploy doctor --url ${operation.activeUrl}\` against the deployed app.`
      : classification === 'failed'
        ? `Inspect the exact operation and workflow evidence, then run \`${exactCommand} --retry ${operation.operationId} --wait --format json\`.`
        : `Resume with \`${exactCommand} --resume ${operation.operationId} --wait --format json\`; status ${operation.status} is not a complete active TenantInfra projection.`;
  const result = {
    tenantId: operation.tenantId,
    targetTenantId,
    appKey: operation.appKey,
    operationId: operation.operationId,
    status: operation.status,
    classification,
    requiresTenantInfra: operation.requiresTenantInfra,
    deploymentId: operation.deploymentId,
    activeUrl: operation.activeUrl,
    latestPointerVersion: operation.latestPointerVersion,
    expectedLatestVersion: operation.expectedLatestVersion,
    runtimeIdentity: operation.runtimeIdentity,
    sourceBinding,
    nextAction,
    ...extra,
  };
  if (format === 'json') {
    out.json(result);
    return;
  }
  const statusMessage = `EAI managed deployment is ${chalk.cyan(operation.status)}.`;
  if (classification === 'succeeded') out.success(statusMessage);
  else if (classification === 'failed') out.error(statusMessage);
  else out.warn(statusMessage);
  out.info(`Operation: ${operation.operationId}`);
  out.info(`Target tenant: ${targetTenantId || '<missing>'}`);
  if (typeof sourceBinding.repository === 'string') out.info(`Source: ${sourceBinding.repository}@${String(sourceBinding.commitSha || '<missing>')}`);
  if (typeof operation.activeUrl === 'string') out.info(`URL: ${operation.activeUrl}`);
  out.info(nextAction);
}

function printFailure(format: string, error: unknown): void {
  const failure = error instanceof ManagedDeployFailure
    ? error
    : new ManagedDeployFailure(
      error instanceof ManagedSourceError ? error.code : 'EAI_MANAGED_DEPLOY_FAILED',
      error instanceof Error ? error.message : String(error),
      error instanceof ManagedSourceError ? error.message : 'Fix the reported problem, then retry the same exact command.',
    );
  if (format === 'json') {
    out.json({ error: failure.code, message: failure.message, nextAction: failure.nextAction });
  } else {
    out.error(`${failure.code}: ${failure.message}`);
    out.info(failure.nextAction);
  }
  process.exitCode = 1;
}

function printManagedSourceOperation(format: string, operation: CliManagedSourceOperation): void {
  const classification = classifyCliManagedSourceOperation(operation);
  const command = `eai deploy app ${operation.appKey} --target eai --tenant-id ${operation.tenantId} --target-tenant-id ${operation.targetTenantId} --environment ${operation.environment} --source eai-managed --resume ${operation.operationId} --format json`;
  const nextAction = classification === 'succeeded'
    ? `Run eai deploy doctor --url ${operation.deployment?.liveUrl} --format json and verify the readiness evidence.`
    : operation.status === 'pending_review'
      ? `EAI must complete the bot PR checks and merge before deployment. Resume the exact operation with: ${command}`
      : classification === 'failed' || classification === 'incomplete'
        ? `Ask EAI to repair the reported publication or missing deployment evidence. Read its exact status with: ${command}`
        : `Continue observing the exact platform operation with: ${command}`;
  const result = {
    tenantId: operation.tenantId, targetTenantId: operation.targetTenantId, appKey: operation.appKey,
    operationId: operation.operationId, source: 'eai-managed', sourceMode: operation.sourceMode,
    status: classification === 'succeeded' ? 'active' : operation.status, publicationStatus: operation.status, classification,
    templateCommitSha: operation.templateCommitSha, bundleSha256: operation.bundleSha256,
    sourceBinding: { repository: `${operation.repository.owner}/${operation.repository.name}`, commitSha: operation.review?.mergedSha },
    review: operation.review, deploymentId: operation.deployment?.requestId, activeUrl: operation.deployment?.liveUrl,
    runtimeIdentity: operation.deployment?.runtimeIdentity, requiresTenantInfra: operation.deployment?.requiresTenantInfra,
    latestPointerVersion: operation.deployment?.latestPointerVersion, expectedLatestVersion: operation.deployment?.expectedLatestVersion,
    nextAction,
  };
  if (format === 'json') out.json(result);
  else {
    out.info(`EAI-maintained publication ${operation.operationId}: ${result.status}`);
    if (result.activeUrl) out.info(`URL: ${result.activeUrl}`);
    out.info(nextAction);
  }
  if (classification === 'failed' || classification === 'incomplete') process.exitCode = 1;
}

export const eaiManagedDeployCommand = new Command('app')
  .description('Deploy local app source through EAI-maintained or customer-owned GitHub to TenantInfra')
  .argument('<app-key>', 'Existing EAI app key')
  .requiredOption('--target <target>', 'Hosting target (eai)')
  .requiredOption('--tenant-id <id>', 'Company tenant that owns the app enrollment')
  .option('--target-tenant-id <id>', 'Tenant that receives the deployed runtime')
  .option('--repo <owner/name>', 'Exact GitHub repository')
  .option('--source <source>', 'Source ownership (eai-managed|customer-owned); required without an interactive prompt')
  .option('--github-link-session <session-id>', 'Resume the exact EAI-account GitHub browser verification')
  .option('--installation-id <id>', 'Exact EAI GitHub App installation ID')
  .option('--branch <branch>', 'Exact branch to bind and dispatch', 'main')
  .option('--workflow <path>', 'Canonical EAI workflow path', EAI_MANAGED_WORKFLOW_PATH)
  .option('--environment <environment>', 'Deployment environment', 'preview')
  .option('--commit <sha>', 'Expected exact 40 character commit SHA')
  .option('--resume <operation-id>', 'Read and wait for one exact existing operation')
  .option('--retry <operation-id>', 'Retry evidence handoff, resume dispatched work, or start an undispatched operation')
  .option('--wait', 'Poll the exact operation until it reaches a terminal status', true)
  .option('--no-wait', 'Return after dispatch instead of polling the exact operation')
  .option('--timeout <seconds>', 'Maximum exact-operation polling time', String(DEFAULT_TIMEOUT_SECONDS))
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai deploy app planning-portal --target eai --tenant-id tenant-1 --source eai-managed
  $ eai deploy app planning-portal --target eai --tenant-id tenant-1 --source customer-owned --repo org/planning-portal --installation-id 12345
  $ eai deploy app planning-portal --target eai --tenant-id tenant-1 --target-tenant-id tenant-1 --environment preview --source eai-managed --resume cli-managed-source-abc123 --format json
  $ eai deploy app planning-portal --target eai --tenant-id tenant-1 --target-tenant-id tenant-1 --resume source-unknown-abc123 --wait --format json
  $ eai deploy app planning-portal --target eai --tenant-id tenant-1 --target-tenant-id tenant-1 --retry source-unknown-abc123 --wait
`)
  .action(async (appKeyValue: string, options: ManagedDeployOptions) => {
    const format = normalizeFormat(options);
    const spinner = makeSpinner(format, 'Preparing EAI managed deployment...');
    try {
      if (options.target !== 'eai') {
        fail('HOSTING_TARGET_INVALID', 'This command supports --target eai.', 'Use the existing deploy commands for customer-owned hosting.');
      }
      if (options.resume && options.retry) {
        fail('DEPLOY_MODE_CONFLICT', '--resume and --retry cannot be used together.', 'Choose one exact operation action.');
      }
      if (options.source && !['eai-managed', 'customer-owned'].includes(options.source)) {
        fail('SOURCE_CHOICE_INVALID', 'Choose --source eai-managed or --source customer-owned.', 'Use the source mode recorded by the exact operation.');
      }
      if (options.source === 'eai-managed' && (options.repo || options.installationId || options.commit || options.branch !== 'main')) {
        fail('SOURCE_CHOICE_CONFLICT', 'EAI derives the maintained repository, branch and merged commit.', 'Omit --repo, --installation-id, --branch and --commit for EAI-maintained local source.');
      }
      if ((!options.resume && !options.retry || options.source === 'eai-managed') && !MANAGED_DEPLOY_ENVIRONMENTS.has(options.environment)) {
        fail('DEPLOY_ENVIRONMENT_INVALID', 'Managed deployment supports preview, dev, test, or prod.', 'Choose a supported environment before registering the source operation.');
      }
      const appKey = appKeyValue.trim();
      if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(appKey)) {
        fail('APP_KEY_INVALID', 'App key must use lowercase letters, numbers, and hyphens.', 'Use the exact app key shown by `eai app list --format json`.');
      }
      const workflowPath = requireWorkflowPath(options.workflow);
      if (workflowPath !== EAI_MANAGED_WORKFLOW_PATH) {
        fail('WORKFLOW_PATH_INVALID', `Managed deployment requires ${EAI_MANAGED_WORKFLOW_PATH}.`, 'Remove --workflow or use the canonical path.');
      }
      const timeoutSeconds = Number(options.timeout);
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 7_200) {
        fail('DEPLOY_TIMEOUT_INVALID', '--timeout must be between 1 and 7200 seconds.', 'Choose a bounded wait time and retry.');
      }

      const context = await resolveCommandContext({ tenantId: options.tenantId, interactive: false, forceRefresh: true });
      if (context.tenantId !== options.tenantId) {
        fail('TENANT_ACCOUNT_MISMATCH', `Active tenant ${context.tenantId} does not match ${options.tenantId}.`, `Run \`eai tenant select ${options.tenantId}\`, then confirm with \`eai whoami\`.`);
      }
      if ((options.resume || options.retry) && !options.targetTenantId?.trim()) {
        fail(
          'TARGET_TENANT_REQUIRED',
          '--target-tenant-id is required when resuming or retrying an exact managed deployment.',
          'Use the target tenant recorded with the operation. For same-tenant deployment, repeat the --tenant-id value.',
        );
      }
      const targetTenantId = options.targetTenantId?.trim() || context.tenantId;
      const client = new PlatformAPIClient(context.publicApiUrl, context.tenantId);
      const managedScope: CliManagedSourceScope = {
        tenantId: context.tenantId, targetTenantId, appKey,
        environment: options.environment as CliManagedSourceScope['environment'], actorId: context.tokens.oid || '',
      };

      if (options.source === 'eai-managed' && (options.resume || options.retry)) {
        requireManagedPublicApiUrl(context.publicApiUrl);
        const operation = await pollCliManagedSource(client, managedScope, (options.resume || options.retry)!, { wait: options.wait, timeoutMs: timeoutSeconds * 1000 });
        spinner?.stop();
        printManagedSourceOperation(format, operation);
        return;
      }

      if (options.resume) {
        const operation = await pollExactOperation(client, {
          tenantId: context.tenantId,
          targetTenantId,
          appKey,
          operationId: options.resume,
        }, options.wait, timeoutSeconds);
        spinner?.stop();
        printOperation(format, operation);
        if (classifyManagedOperationStatus(operation) === 'failed') process.exitCode = 1;
        return;
      }

      if (options.retry) {
        const current = await readExactOperation(client, context.tenantId, targetTenantId, appKey, options.retry);
        if (classifyManagedOperationStatus(current) === 'succeeded') {
          spinner?.stop();
          printOperation(format, current);
          return;
        }
        if (hasAcceptedWorkflowEvidence(current)) {
          const environment = typeof current.environment === 'string' ? current.environment : '';
          if (!MANAGED_DEPLOY_ENVIRONMENTS.has(environment)) {
            fail(
              'SOURCE_OPERATION_ENVIRONMENT_INVALID',
              `Source operation ${options.retry} has no supported environment binding.`,
              'Do not retry this operation. Start a new EAI managed deployment so the server can issue an environment-bound source operation.',
            );
          }
          await requireApiSuccess(
            await client.requestSourceUnknownDeployment(context.tenantId, appKey, {
              operationId: options.retry,
              targetTenantId,
              environment,
            }),
            'DEPLOYMENT_HANDOFF_FAILED',
            () => `Repair the reported runtime or TenantInfra problem, then retry ${options.retry}; accepted build evidence will be reused.`,
          );
          const operation = await pollExactOperation(client, {
            tenantId: context.tenantId, targetTenantId, appKey, operationId: options.retry,
          }, options.wait, timeoutSeconds);
          spinner?.stop();
          printOperation(format, operation);
          if (classifyManagedOperationStatus(operation) === 'failed') process.exitCode = 1;
          return;
        }
        if (requiresNewSourceOperation(current)) {
          fail('SOURCE_OPERATION_INACTIVE', `Source operation ${current.operationId} is ${current.status} and cannot dispatch a workflow.`, NEW_SOURCE_OPERATION_ACTION);
        }
        const state = await loadManagedDeployState(options.retry);
        if (state.tenantId !== context.tenantId || state.targetTenantId !== targetTenantId || state.appKey !== appKey) {
          fail('RETRY_BINDING_MISMATCH', 'Retry state does not match the requested tenant, target tenant, and app.', 'Use the exact original tenant and app values.');
        }
        try {
          assertManagedDeployStateMatchesOperation(state, current);
        } catch (error) {
          fail(
            'RETRY_SERVER_BINDING_MISMATCH',
            error instanceof Error ? error.message : String(error),
            'Do not edit retry state. Resume the exact server operation, or start a new deployment from the intended immutable commit.',
          );
        }
        if (!MANAGED_DEPLOY_ENVIRONMENTS.has(state.environment)) {
          fail('SOURCE_OPERATION_ENVIRONMENT_INVALID', 'The stored operation has an unsupported environment.', NEW_SOURCE_OPERATION_ACTION);
        }
        if (state.dispatchedAt || state.dispatchStartedAt) {
          const operation = await pollExactOperation(client, state, options.wait, timeoutSeconds);
          spinner?.stop();
          printOperation(format, operation);
          if (classifyManagedOperationStatus(operation) === 'failed') process.exitCode = 1;
          return;
        }
        requireManagedPublicApiUrl(context.publicApiUrl);
        const source = await verifyLocalSource(context.root, state.repo, state.branch, state.commitSha);
        if (source.commitSha !== state.commitSha) {
          fail('RETRY_SHA_CHANGED', 'The current commit differs from the stored operation commit.', `Check out ${state.commitSha}, then retry the same operation.`);
        }
        await prepareRuntime(client, state);
        await dispatchWorkflow(state, context.publicApiUrl, context.root);
        const operation = await pollExactOperation(client, state, options.wait, timeoutSeconds);
        spinner?.stop();
        printOperation(format, operation, { repo: state.repo, ref: state.ref, commitSha: state.commitSha, configHash: state.configHash });
        if (classifyManagedOperationStatus(operation) === 'failed') process.exitCode = 1;
        return;
      }

      const publicApiUrl = requireManagedPublicApiUrl(context.publicApiUrl);
      spinner?.stop();
      const link = await verifyCliGithubIdentity(client, managedScope, {
        sessionId: options.githubLinkSession, interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY && format !== 'json'), timeoutMs: timeoutSeconds * 1000,
      });
      const sourceChoice = await chooseManagedDeploySource({ source: options.source, repo: options.repo, format });
      spinner?.start();
      if (sourceChoice === 'eai-managed') {
        if (options.repo || options.installationId || options.commit || options.branch !== 'main') {
          fail('SOURCE_CHOICE_CONFLICT', 'EAI derives the maintained repository, branch and merged commit.', 'Omit --repo, --installation-id, --branch and --commit for EAI-maintained local source.');
        }
        const { bundle } = await buildCliManagedSourceBundle(context.root);
        await writeCliManagedSourceReceipt(context.root, bundle);
        const submitted = await submitCliManagedSource(client, managedScope, link, bundle);
        const operation = await pollCliManagedSource(client, managedScope, submitted.operationId, { wait: options.wait, timeoutMs: timeoutSeconds * 1000 }, submitted);
        spinner?.stop();
        printManagedSourceOperation(format, operation);
        return;
      }
      if (!options.repo || !options.installationId) {
        fail('REPOSITORY_AUTHORITY_REQUIRED', '--repo and --installation-id are required for a new EAI deployment.', 'Connect the repository to the tenant, install the EAI GitHub App, then pass both exact values.');
      }
      const repository = parseGitHubRepository(options.repo);
      const installationId = requireInstallationId(options.installationId);
      const install = await installCanonicalManagedDeployFiles(context.root, workflowPath);
      if (install.changed.length > 0 || install.pendingUpdates.length > 0) {
        const installed = install.changed.length > 0 ? `Installed: ${install.changed.join(', ')}.` : '';
        const pending = install.pendingUpdates.length > 0
          ? ` Review candidates: ${install.pendingUpdates.join(', ')}.`
          : '';
        fail(
          'CANONICAL_WORKFLOW_UPDATE_REQUIRED',
          `${installed}${pending}`.trim(),
          'Review each candidate without losing local edits. Apply it to the canonical path, remove the candidate, then commit and push through the repository branch rules before retrying.',
        );
      }
      const source = await verifyLocalSource(context.root, repository.slug, options.branch, options.commit);
      await verifyGitHubAccess(repository.slug, source.branch, source.commitSha);
      const configHash = await buildManagedDeployConfigHash(context.root);
      const ref = `refs/heads/${source.branch}`;

      const registration = await requireApiSuccess(
        await client.registerSourceUnknownApp(context.tenantId, appKey, {
          repoOwner: repository.owner,
          repoName: repository.name,
          repoUrl: `https://github.com/${repository.slug}`,
          defaultBranch: source.branch,
          workflowPath,
          ref,
          commitSha: source.commitSha,
          configPath: 'src/eai.config',
          runtimePath: 'eai.runtime.json',
          sourceMode: 'source-unknown',
          adoptionMode: 'connect-existing',
          installationId,
          targetTenantId,
        }),
        'REPOSITORY_REGISTRATION_FAILED',
        (payload, status) => repositoryNextAction(status, apiMessage(payload, ''), context.tenantId, repository.slug),
      );
      void registration;

      const setup = await requireApiSuccess(
        await client.setupSourceUnknownWorkflow(context.tenantId, appKey, {
          environment: options.environment,
          workflowPath,
          ref,
          commitSha: source.commitSha,
          configHash,
          targetTenantId,
          deployOnSuccess: true,
        }),
        'WORKFLOW_SETUP_FAILED',
        () => 'Confirm the app enrollment, repository authority, exact commit, and target tenant binding, then retry.',
      );
      const operationId = typeof setup.operationId === 'string' ? setup.operationId : '';
      const nonce = typeof setup.nonce === 'string' ? setup.nonce : '';
      if (!operationId || !nonce) {
        fail('WORKFLOW_SETUP_INVALID', 'PublicAPI did not return an operation ID and one-time nonce.', 'Stop and inspect the PublicAPI/AdminAPI setup response.');
      }
      const state: ManagedDeployState = {
        schema: 'eai.managed-deploy-state.v1',
        tenantId: context.tenantId,
        targetTenantId,
        appKey,
        operationId,
        nonce,
        repo: repository.slug,
        branch: source.branch,
        ref,
        commitSha: source.commitSha,
        workflowPath,
        configHash,
        environment: options.environment,
        installationId,
        publicApiUrl,
      };
      await saveManagedDeployState(state);
      await prepareRuntime(client, state);
      await dispatchWorkflow(state, context.publicApiUrl, context.root);

      const operation = await pollExactOperation(client, state, options.wait, timeoutSeconds);
      spinner?.stop();
      printOperation(format, operation, {
        repo: state.repo,
        ref: state.ref,
        commitSha: state.commitSha,
        configHash: state.configHash,
      });
      if (classifyManagedOperationStatus(operation) === 'failed') process.exitCode = 1;
    } catch (error) {
      spinner?.fail('EAI managed deployment stopped');
      printFailure(format, error);
    }
  });
