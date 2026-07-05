/**
 * eai app — manage tenant app/product instances under the active company tenant.
 *
 * The platform data contract still stores app enrollment in legacy
 * tenant-vertical-* object types. Keep the wire/data names stable here while
 * making the public CLI vocabulary App-first.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolveCommandContext, normalizeFormat, makeSpinner } from '../lib/context.js';
import {
  PlatformAPIClient,
  type SourceUnknownAppRegistrationRequest,
  type SourceUnknownDeploymentRequest,
  type SourceUnknownSchemaProvenance,
  type SourceUnknownWorkflowEvidenceRequest,
  type SourceUnknownWorkflowSetupRequest,
} from '../lib/api.js';
import {
  resolveActiveTenantContext,
  resolveMainCompanyTenantId,
  resolvePublicApiUrl,
} from '../lib/tenant-context.js';
import { findProjectRoot, patchEnvFile } from '../lib/config.js';
import {
  errMsg,
  isRecord,
  normalizeChildTenantDisplayNameOption,
  normalizeChildTenantSlugOption,
  toObjectTypeSlug,
} from '../lib/utils.js';
import * as out from '../lib/output.js';

const VERTICAL_ENROLLMENT_TYPE = 'tenant-vertical-enrollment';
const DEFAULT_VERTICAL_SOURCE = ['eai', 'cli'].join('-');
const APP_KEY_ENV = 'EAI_APP_KEY';
const LEGACY_VERTICAL_KEY_ENV = 'EAI_VERTICAL_KEY';
const DEFAULT_SOURCE_UNKNOWN_GITHUB_OIDC_AUDIENCE = 'api://enterprise-ai-publicapi/source-unknown';

export interface VerticalCreateOptions {
  key?: string;
  template?: string;
  source?: string;
  appUrl?: string;
  status?: string;
  parentTenant?: string;
  childTenant?: string;
  childTenantSlug?: string;
  format?: string;
  json?: boolean;
}

/**
 * Options for binding a tenant app to an existing GitHub repository while
 * keeping source ownership outside the generated-source export pipeline.
 */
export interface AppConnectExistingOptions {
  tenantId?: string;
  repo: string;
  repoUrl?: string;
  branch?: string;
  workflow?: string;
  ref?: string;
  commit?: string;
  config?: string;
  runtime?: string;
  templateVersion?: string;
  baseTemplateSha?: string;
  approvedSourceSha?: string;
  approvedRelease?: string;
  schemaDigest?: string;
  validatorDigest?: string;
  skipValidate?: boolean;
  format?: string;
  json?: boolean;
}

export interface AppAdoptObservedOptions extends AppConnectExistingOptions {
  url: string;
  environment?: string;
  deploymentId?: string;
  imageDigest?: string;
  configHash?: string;
  observedAt?: string;
}

export interface AppWorkflowSetupOptions {
  tenantId?: string;
  environment?: string;
  workflow?: string;
  ref?: string;
  commit?: string;
  configHash?: string;
  skipValidate?: boolean;
  format?: string;
  json?: boolean;
}

export interface AppWorkflowEvidenceOptions extends AppConnectExistingOptions {
  operationId: string;
  nonce: string;
  environment?: string;
  configHash: string;
  artifactDigest: string;
  imageDigest: string;
  workflowRunId?: string;
  workflowRunAttempt?: string;
  githubOidcToken?: string;
  githubOidcAudience?: string;
}

export interface AppDeploySourceUnknownOptions {
  tenantId?: string;
  operationId: string;
  environment?: string;
  repo?: string;
  workflow?: string;
  ref?: string;
  commit?: string;
  workflowRunId?: string;
  configHash?: string;
  artifactDigest?: string;
  imageDigest?: string;
  targetKind?: string;
  releaseChannel?: string;
  skipValidate?: boolean;
  format?: string;
  json?: boolean;
}

export interface AppDeploySourceUnknownStatusOptions {
  tenantId?: string;
  skipValidate?: boolean;
  format?: string;
  json?: boolean;
}

export function buildVerticalEnrollmentData(
  name: string,
  tenantId: string,
  options: VerticalCreateOptions,
): Record<string, unknown> {
  const displayName = name.trim();
  const verticalKey = (options.key || toObjectTypeSlug(displayName)).trim();

  if (!displayName) {
    throw new Error('App display name is required.');
  }
  if (!verticalKey) {
    throw new Error('App key is required.');
  }

  return {
    tenantId,
    verticalKey,
    displayName,
    status: options.status || 'pending',
    source: options.source || DEFAULT_VERTICAL_SOURCE,
    ...(options.template ? { templateKey: options.template } : {}),
    ...(options.appUrl ? { appUrl: options.appUrl } : {}),
  };
}

/**
 * Parse the GitHub repository identifier accepted by Admin Portal export jobs.
 */
export function parseRepositorySlug(repo: string): { owner: string; name: string } {
  const normalized = repo
    .trim()
    .replace(/^git@github\.com:/, '')
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/\.git$/, '');
  const [owner, name, extra] = normalized.split('/');
  if (!owner || !name || extra) {
    throw new Error('Repository must be in owner/name form.');
  }
  return { owner, name };
}

function defaultRepoUrl(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}`;
}

function normaliseOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function assertSha256Digest(value: string, field: string): void {
  if (!/^sha256:[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a sha256:<64 hex chars> digest.`);
  }
}

function assertGitCommitSha(value: string, field: string): void {
  if (!/^[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${field} must be a 40 character git commit SHA.`);
  }
}

function buildSchemaProvenance(
  options: AppConnectExistingOptions,
): SourceUnknownSchemaProvenance | undefined {
  const schemaDigest = normaliseOptionalString(options.schemaDigest);
  const validatorDigest = normaliseOptionalString(options.validatorDigest);
  const templateVersion = normaliseOptionalString(options.templateVersion);
  const baseTemplateSha = normaliseOptionalString(options.baseTemplateSha);
  const approvedSourceSha = normaliseOptionalString(options.approvedSourceSha);
  const approvedReleaseId = normaliseOptionalString(options.approvedRelease);
  const hasAny =
    schemaDigest ||
    validatorDigest ||
    templateVersion ||
    baseTemplateSha ||
    approvedSourceSha ||
    approvedReleaseId;

  if (!hasAny) return undefined;
  if (!schemaDigest || !validatorDigest) {
    throw new Error('Schema provenance requires --schema-digest and --validator-digest.');
  }
  if (!templateVersion) {
    throw new Error('Schema provenance requires --template-version.');
  }
  if (!baseTemplateSha && !approvedSourceSha && !approvedReleaseId) {
    throw new Error('Schema provenance requires --base-template-sha, --approved-source-sha, or --approved-release.');
  }
  assertSha256Digest(schemaDigest, '--schema-digest');
  assertSha256Digest(validatorDigest, '--validator-digest');
  if (baseTemplateSha) assertGitCommitSha(baseTemplateSha, '--base-template-sha');
  if (approvedSourceSha) assertGitCommitSha(approvedSourceSha, '--approved-source-sha');

  return {
    templateVersion,
    ...(baseTemplateSha ? { baseTemplateSha } : {}),
    ...(approvedSourceSha ? { approvedSourceSha } : {}),
    ...(approvedReleaseId ? { approvedReleaseId } : {}),
    schemaDigest,
    validatorDigest,
  };
}

/**
 * Build the PublicAPI payload used to store source-unknown app repo metadata.
 */
export function buildSourceUnknownRegistrationData(
  options: AppConnectExistingOptions,
): SourceUnknownAppRegistrationRequest {
  const repo = parseRepositorySlug(options.repo);
  const defaultBranch = (options.branch || 'main').trim();
  if (!defaultBranch) {
    throw new Error('Default branch is required.');
  }
  const schemaProvenance = buildSchemaProvenance(options);

  return {
    repoOwner: repo.owner,
    repoName: repo.name,
    repoUrl: options.repoUrl?.trim() || defaultRepoUrl(repo.owner, repo.name),
    defaultBranch,
    workflowPath: options.workflow?.trim() || '.github/workflows/eai-app.yml',
    ref: options.ref?.trim() || `refs/heads/${defaultBranch}`,
    ...(options.commit?.trim() ? { commitSha: options.commit.trim() } : {}),
    configPath: options.config?.trim() || 'src/eai.config/index.ts',
    runtimePath: options.runtime?.trim() || 'src/eai.runtime.ts',
    sourceMode: 'source-unknown',
    ...(schemaProvenance ? { schemaProvenance } : {}),
    validationSummary: {
      status: 'registered_by_cli',
      appValidated: !options.skipValidate,
    },
  };
}

export function buildSourceUnknownAdoptObservedData(
  options: AppAdoptObservedOptions,
): SourceUnknownAppRegistrationRequest {
  const registration = buildSourceUnknownRegistrationData(options);
  const activeUrl = options.url.trim();
  const environment = (options.environment || 'production').trim();
  if (!activeUrl) {
    throw new Error('Observed app URL is required.');
  }
  try {
    new URL(activeUrl);
  } catch {
    throw new Error('Observed app URL must be an absolute URL.');
  }
  if (!environment) {
    throw new Error('Observed environment is required.');
  }

  return {
    ...registration,
    adoptionMode: 'adopted-observed',
    observedDeployment: {
      environment,
      activeUrl,
      status: 'adopted_observed',
      observedAt: options.observedAt?.trim() || new Date().toISOString(),
      ...(options.deploymentId?.trim() ? { deploymentId: options.deploymentId.trim() } : {}),
      ...(options.imageDigest?.trim() ? { imageDigest: options.imageDigest.trim() } : {}),
      ...(options.configHash?.trim() ? { configHash: options.configHash.trim() } : {}),
    },
    validationSummary: {
      status: 'adopted_observed_by_cli',
      appValidated: !options.skipValidate,
      destructiveOperationsBlocked: true,
    },
  };
}

export function buildSourceUnknownWorkflowSetupData(
  options: AppWorkflowSetupOptions,
): SourceUnknownWorkflowSetupRequest {
  const environment = (options.environment || 'preview').trim();
  if (!environment) {
    throw new Error('Workflow setup environment is required.');
  }
  return {
    environment,
    workflowPath: options.workflow?.trim() || '.github/workflows/eai-app.yml',
    ...(options.ref?.trim() ? { ref: options.ref.trim() } : {}),
    ...(options.commit?.trim() ? { commitSha: options.commit.trim() } : {}),
    ...(options.configHash?.trim() ? { configHash: options.configHash.trim() } : {}),
  };
}

export function buildSourceUnknownWorkflowEvidenceData(
  options: AppWorkflowEvidenceOptions,
): SourceUnknownWorkflowEvidenceRequest {
  const repo = parseRepositorySlug(options.repo);
  const operationId = options.operationId?.trim();
  const nonce = options.nonce?.trim();
  const environment = (options.environment || 'preview').trim();
  const defaultBranch = (options.branch || 'main').trim();
  const workflowPath = options.workflow?.trim() || '.github/workflows/eai-app.yml';
  const ref = options.ref?.trim() || `refs/heads/${defaultBranch}`;
  const commitSha = options.commit?.trim();
  const configHash = options.configHash?.trim();
  const artifactDigest = options.artifactDigest?.trim();
  const imageDigest = options.imageDigest?.trim();
  if (!operationId) throw new Error('Workflow evidence operation ID is required.');
  if (!nonce) throw new Error('Workflow evidence nonce is required.');
  if (!environment) throw new Error('Workflow evidence environment is required.');
  if (!defaultBranch) throw new Error('Default branch is required.');
  if (!commitSha) throw new Error('Workflow evidence commit SHA is required.');
  if (!configHash) throw new Error('Workflow evidence config hash is required.');
  if (!artifactDigest) throw new Error('Workflow evidence artifact digest is required.');
  if (!imageDigest) throw new Error('Workflow evidence image digest is required.');
  assertSha256Digest(artifactDigest, '--artifact-digest');
  assertSha256Digest(imageDigest, '--image-digest');
  const schemaProvenance = buildSchemaProvenance(options);
  if (!schemaProvenance) {
    throw new Error('Workflow evidence requires schema provenance: provide --template-version, --schema-digest, --validator-digest, and an approved source anchor.');
  }
  const workflowRun: Record<string, unknown> = {};
  if (options.workflowRunId?.trim()) workflowRun.id = options.workflowRunId.trim();
  if (options.workflowRunAttempt?.trim()) {
    const attempt = Number(options.workflowRunAttempt.trim());
    workflowRun.attempt = Number.isFinite(attempt) ? attempt : options.workflowRunAttempt.trim();
  }

  return {
    operationId,
    nonce,
    environment,
    workflowPath,
    ref,
    commitSha,
    configHash,
    artifactDigest,
    imageDigest,
    schemaProvenance,
    ...(Object.keys(workflowRun).length > 0 ? { workflowRun } : {}),
    oidcClaims: {
      repository: `${repo.owner}/${repo.name}`,
      ref,
      sha: commitSha,
      workflow_ref: `${repo.owner}/${repo.name}/${workflowPath}@${ref}`,
      ...(workflowRun.id ? { run_id: String(workflowRun.id) } : {}),
      ...(workflowRun.attempt ? { run_attempt: String(workflowRun.attempt) } : {}),
    },
    validationSummary: {
      status: 'passed_by_cli',
      appValidated: !options.skipValidate,
    },
  };
}

export function buildSourceUnknownDeploymentData(
  options: AppDeploySourceUnknownOptions,
): SourceUnknownDeploymentRequest {
  const operationId = options.operationId?.trim();
  const environment = (options.environment || 'preview').trim();
  const repo = options.repo?.trim() ? parseRepositorySlug(options.repo) : undefined;
  const workflowRunId = normaliseOptionalString(options.workflowRunId);
  const artifactDigest = options.artifactDigest?.trim();
  const imageDigest = options.imageDigest?.trim();

  if (!operationId) throw new Error('Deployment handoff operation ID is required.');
  if (!environment) throw new Error('Deployment handoff environment is required.');
  if (artifactDigest) assertSha256Digest(artifactDigest, '--artifact-digest');
  if (imageDigest) assertSha256Digest(imageDigest, '--image-digest');

  const deploymentTarget: Record<string, unknown> = {};
  const targetKind = normaliseOptionalString(options.targetKind);
  const releaseChannel = normaliseOptionalString(options.releaseChannel);
  if (targetKind) deploymentTarget.kind = targetKind;
  if (releaseChannel) deploymentTarget.releaseChannel = releaseChannel;

  return {
    operationId,
    environment,
    ...(repo ? { repoOwner: repo.owner, repoName: repo.name } : {}),
    ...(options.workflow?.trim() ? { workflowPath: options.workflow.trim() } : {}),
    ...(options.ref?.trim() ? { ref: options.ref.trim() } : {}),
    ...(options.commit?.trim() ? { commitSha: options.commit.trim() } : {}),
    ...(workflowRunId ? { workflowRunId } : {}),
    ...(options.configHash?.trim() ? { configHash: options.configHash.trim() } : {}),
    ...(artifactDigest ? { artifactDigest } : {}),
    ...(imageDigest ? { imageDigest } : {}),
    ...(Object.keys(deploymentTarget).length > 0 ? { deploymentTarget } : {}),
    validationSummary: {
      status: 'deployment_requested_by_cli',
      appValidated: !options.skipValidate,
      requiresTenantInfra: true,
    },
  };
}

async function resolveGitHubOidcToken(options: AppWorkflowEvidenceOptions): Promise<string> {
  const explicitToken = normaliseOptionalString(options.githubOidcToken);
  if (explicitToken) return explicitToken;

  const envToken = normaliseOptionalString(process.env.GITHUB_ID_TOKEN);
  if (envToken) return envToken;

  const requestUrl = normaliseOptionalString(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  const requestToken = normaliseOptionalString(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  if (!requestUrl || !requestToken) {
    throw new Error('Workflow evidence requires --github-oidc-token or GitHub Actions OIDC request environment variables.');
  }

  const audience = normaliseOptionalString(options.githubOidcAudience) || DEFAULT_SOURCE_UNKNOWN_GITHUB_OIDC_AUDIENCE;
  const separator = requestUrl.includes('?') ? '&' : '?';
  const response = await fetch(`${requestUrl}${separator}audience=${encodeURIComponent(audience)}`, {
    headers: { Authorization: `Bearer ${requestToken}` },
  });
  if (!response.ok) {
    throw new Error(`GitHub OIDC token request failed: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json() as unknown;
  if (!isRecord(payload) || typeof payload.value !== 'string' || !payload.value.trim()) {
    throw new Error('GitHub OIDC token response did not include a token value.');
  }
  return payload.value.trim();
}

function extractDocs(payload: unknown): Array<{ id?: string; data?: Record<string, unknown>; version?: number }> {
  if (!isRecord(payload)) return [];
  const docs = Array.isArray(payload.docs) ? payload.docs : Array.isArray(payload.items) ? payload.items : [];
  return docs.filter(isRecord).map((doc) => ({
    id: typeof doc.id === 'string' ? doc.id : undefined,
    data: isRecord(doc.data) ? doc.data : undefined,
    version: typeof doc.version === 'number' ? doc.version : undefined,
  }));
}

async function readResponsePayload(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function fail(message: string): never {
  out.error(message);
  process.exit(1);
}

async function resolveAppManagementContext(options?: {
  tenantId?: string;
  interactive?: boolean;
}) {
  const root = await findProjectRoot();
  const publicApiUrl = await resolvePublicApiUrl(root ?? undefined);
  const context = await resolveActiveTenantContext({
    projectRoot: root ?? undefined,
    publicApiUrl,
    tenantId: options?.tenantId,
    interactive: options?.interactive,
  });

  return {
    publicApiUrl: context.publicApiUrl,
    tenantId: context.activeTenant.id,
  };
}

async function validateVerticalEnrollment(
  verticalKey: string,
  client: Pick<PlatformAPIClient, 'listResources'>,
): Promise<void> {
  const res = await client.listResources(VERTICAL_ENROLLMENT_TYPE, {
    limit: 1,
    where: { verticalKey },
  });
  if (!res.ok) {
    fail(`Could not validate ${verticalKey}: ${res.status} ${res.statusText}`);
  }
  const docs = extractDocs(await readResponsePayload(res));
  if (docs.length === 0) {
    fail(`No app found for ${verticalKey}. Create it with \`eai app create\` first, or pass --skip-validate if the app is still being prepared.`);
  }
}

export const appCommand = new Command('app')
  .alias('vertical')
  .description('Manage apps under the active company tenant');

export const verticalCommand = appCommand;

verticalCommand
  .command('list')
  .description('List apps for the active company tenant')
  .option('--tenant-id <id>', 'Run against a specific company tenant')
  .option('--limit <n>', 'Items per page', '50')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (options) => {
    const ctx = await resolveAppManagementContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const companyTenantId = options.tenantId
      ? ctx.tenantId
      : await resolveMainCompanyTenantId(ctx.publicApiUrl, ctx.tenantId);
    const client = new PlatformAPIClient(ctx.publicApiUrl, companyTenantId);
    const format = normalizeFormat(options);
    const spinner = makeSpinner(format, 'Listing apps...');

    const res = await client.listResources(VERTICAL_ENROLLMENT_TYPE, {
      limit: Number.parseInt(options.limit, 10),
      sort: 'verticalKey',
    });
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      spinner?.fail('Failed to list apps');
      fail(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `${res.status} ${res.statusText}`);
    }

    const docs = extractDocs(payload);
    if (format === 'json') {
      out.json({ tenantId: companyTenantId, apps: docs });
      return;
    }

    spinner?.succeed(`${docs.length} app${docs.length === 1 ? '' : 's'} found`);
    if (docs.length === 0) {
      out.info('No apps found.');
      return;
    }
    for (const doc of docs) {
      const data = doc.data ?? {};
      out.info(`${chalk.cyan(String(data.verticalKey ?? doc.id ?? 'unknown'))} — ${String(data.displayName ?? 'Untitled')} (${String(data.status ?? 'unknown')})`);
    }
  });

verticalCommand
  .command('create <name>')
  .description('Create an app under a company tenant')
  .option('--tenant-id <id>', 'Main company tenant ID that owns this app')
  .option('--parent-tenant <id>', 'Immediate parent company tenant ID for the new child company')
  .option('--child-tenant <name>', 'Create or reuse a child company tenant display name')
  .option('--child-tenant-slug <slug>', 'Child company tenant key')
  .option('--key <key>', 'Stable app key (defaults to kebab-case name)')
  .option('--template <templateKey>', 'Optional app-catalog template key')
  .option('--source <source>', 'Creation source', DEFAULT_VERTICAL_SOURCE)
  .option('--app-url <url>', 'Optional app URL')
  .option('--status <status>', 'Initial lifecycle status', 'pending')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (name: string, options: VerticalCreateOptions & { tenantId?: string }) => {
    const ctx = await resolveAppManagementContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const companyTenantId = options.tenantId
      ? ctx.tenantId
      : await resolveMainCompanyTenantId(ctx.publicApiUrl, ctx.tenantId);
    const immediateParentTenantId =
      options.parentTenant?.trim() || (options.tenantId ? companyTenantId : ctx.tenantId);
    const format = normalizeFormat(options);
    const data = buildVerticalEnrollmentData(name, companyTenantId, options);
    let childTenantDisplayName: string | undefined;
    let childTenantSlug: string | undefined;
    try {
      childTenantDisplayName = normalizeChildTenantDisplayNameOption(options.childTenant);
      childTenantSlug = normalizeChildTenantSlugOption(options.childTenantSlug);
    } catch (err) {
      fail(errMsg(err));
    }
    const spinner = makeSpinner(format, `Creating ${data.verticalKey}...`);

    const client = new PlatformAPIClient(ctx.publicApiUrl, companyTenantId);
    const res = await client.createTenantApp(companyTenantId, {
      appDisplayName: String(data.displayName),
      verticalKey: String(data.verticalKey),
      ...(immediateParentTenantId !== companyTenantId ? { parentTenantId: immediateParentTenantId } : {}),
      ...(childTenantDisplayName ? { childTenantDisplayName } : {}),
      ...(childTenantSlug ? { childTenantSlug } : {}),
      ...(options.template ? { templateKey: options.template } : {}),
      source: options.source || DEFAULT_VERTICAL_SOURCE,
      ...(options.appUrl ? { appUrl: options.appUrl } : {}),
    });
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      spinner?.fail('Failed to create app');
      fail(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `${res.status} ${res.statusText}`);
    }

    if (format === 'json') {
      out.json({ tenantId: companyTenantId, appKey: data.verticalKey, request: data, response: payload });
      return;
    }

    spinner?.succeed(`Created app ${chalk.cyan(String(data.verticalKey))}`);
    out.info(`Main company tenant: ${chalk.cyan(companyTenantId)}`);
    if (immediateParentTenantId !== companyTenantId) {
      out.info(`Immediate parent company: ${chalk.cyan(immediateParentTenantId)}`);
    }
    if (isRecord(payload) && isRecord(payload.childTenant)) {
      out.info(`Child tenant: ${chalk.cyan(String(payload.childTenant.displayName ?? childTenantDisplayName))} · ${chalk.dim(String(payload.childTenant.id ?? ''))}`);
    } else {
      out.info(`App tenant: ${chalk.cyan(immediateParentTenantId)}`);
    }
  });

verticalCommand
  .command('connect-existing <key>')
  .description('Register an existing app repository for managed deployment')
  .requiredOption('--repo <owner/repo>', 'GitHub repository to connect')
  .option('--tenant-id <id>', 'Run against a specific company tenant')
  .option('--repo-url <url>', 'Repository URL when it differs from https://github.com/owner/repo')
  .option('--branch <branch>', 'Default branch', 'main')
  .option('--workflow <path>', 'GitHub Actions workflow path', '.github/workflows/eai-app.yml')
  .option('--ref <ref>', 'Approved git ref (defaults to refs/heads/<branch>)')
  .option('--commit <sha>', 'Current commit SHA to bind')
  .option('--config <path>', 'eai.config path', 'src/eai.config/index.ts')
  .option('--runtime <path>', 'eai.runtime path', 'src/eai.runtime.ts')
  .option('--template-version <version>', 'Approved schema/template version')
  .option('--base-template-sha <sha>', 'Base eai-app-template commit SHA when known')
  .option('--approved-source-sha <sha>', 'Approved source commit SHA for non-template apps')
  .option('--approved-release <id>', 'Approved schema/validator release identifier')
  .option('--schema-digest <digest>', 'Approved schema digest in sha256:<hex> form')
  .option('--validator-digest <digest>', 'Approved validator digest in sha256:<hex> form')
  .option('--skip-validate', 'Skip app lookup', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (key: string, options: AppConnectExistingOptions) => {
    const ctx = await resolveAppManagementContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const companyTenantId = options.tenantId
      ? ctx.tenantId
      : await resolveMainCompanyTenantId(ctx.publicApiUrl, ctx.tenantId);
    const client = new PlatformAPIClient(ctx.publicApiUrl, companyTenantId);
    const format = normalizeFormat(options);
    const appKey = key.trim();

    if (!appKey) {
      fail('App key is required.');
    }

    let registration: SourceUnknownAppRegistrationRequest;
    try {
      registration = buildSourceUnknownRegistrationData(options);
    } catch (err) {
      fail(errMsg(err));
    }

    if (!options.skipValidate) {
      await validateVerticalEnrollment(appKey, client);
    }

    const spinner = makeSpinner(format, `Connecting ${appKey} to ${registration.repoOwner}/${registration.repoName}...`);
    const res = await client.registerSourceUnknownApp(companyTenantId, appKey, registration);
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      spinner?.fail('Failed to connect existing app repository');
      fail(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `${res.status} ${res.statusText}`);
    }

    if (format === 'json') {
      out.json({
        tenantId: companyTenantId,
        appKey,
        sourceMode: 'source-unknown',
        repository: {
          owner: registration.repoOwner,
          name: registration.repoName,
          url: registration.repoUrl,
        },
        request: registration,
        response: payload,
      });
      return;
    }

    spinner?.succeed(`Connected existing repository for ${chalk.cyan(appKey)}`);
    out.info(`Repository: ${chalk.cyan(`${registration.repoOwner}/${registration.repoName}`)}`);
    out.info(`Branch: ${chalk.cyan(String(registration.defaultBranch))} · Ref: ${chalk.dim(String(registration.ref))}`);
    out.info(`Workflow: ${chalk.cyan(String(registration.workflowPath))}`);
  });

verticalCommand
  .command('adopt-observed <key>')
  .description('Import an already-running app as read-only observed infrastructure')
  .requiredOption('--repo <owner/repo>', 'GitHub repository to connect')
  .requiredOption('--url <url>', 'Currently active observed app URL')
  .option('--tenant-id <id>', 'Run against a specific company tenant')
  .option('--repo-url <url>', 'Repository URL when it differs from https://github.com/owner/repo')
  .option('--environment <environment>', 'Observed deployment environment', 'production')
  .option('--branch <branch>', 'Default branch', 'main')
  .option('--workflow <path>', 'GitHub Actions workflow path', '.github/workflows/eai-app.yml')
  .option('--ref <ref>', 'Approved git ref (defaults to refs/heads/<branch>)')
  .option('--commit <sha>', 'Current commit SHA to bind')
  .option('--config <path>', 'eai.config path', 'src/eai.config/index.ts')
  .option('--runtime <path>', 'eai.runtime path', 'src/eai.runtime.ts')
  .option('--template-version <version>', 'Approved schema/template version')
  .option('--base-template-sha <sha>', 'Base eai-app-template commit SHA when known')
  .option('--approved-source-sha <sha>', 'Approved source commit SHA for non-template apps')
  .option('--approved-release <id>', 'Approved schema/validator release identifier')
  .option('--schema-digest <digest>', 'Approved schema digest in sha256:<hex> form')
  .option('--validator-digest <digest>', 'Approved validator digest in sha256:<hex> form')
  .option('--deployment-id <id>', 'Observed deployment identifier')
  .option('--image-digest <digest>', 'Observed immutable image digest')
  .option('--config-hash <hash>', 'Observed config hash')
  .option('--observed-at <iso>', 'Observation timestamp')
  .option('--skip-validate', 'Skip app lookup', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (key: string, options: AppAdoptObservedOptions) => {
    const ctx = await resolveAppManagementContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const companyTenantId = options.tenantId
      ? ctx.tenantId
      : await resolveMainCompanyTenantId(ctx.publicApiUrl, ctx.tenantId);
    const client = new PlatformAPIClient(ctx.publicApiUrl, companyTenantId);
    const format = normalizeFormat(options);
    const appKey = key.trim();

    if (!appKey) {
      fail('App key is required.');
    }

    let registration: SourceUnknownAppRegistrationRequest;
    try {
      registration = buildSourceUnknownAdoptObservedData(options);
    } catch (err) {
      fail(errMsg(err));
    }

    if (!options.skipValidate) {
      await validateVerticalEnrollment(appKey, client);
    }

    const spinner = makeSpinner(format, `Adopting observed app ${appKey} from ${registration.repoOwner}/${registration.repoName}...`);
    const res = await client.registerSourceUnknownApp(companyTenantId, appKey, registration);
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      spinner?.fail('Failed to adopt observed app');
      fail(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `${res.status} ${res.statusText}`);
    }

    if (format === 'json') {
      out.json({
        tenantId: companyTenantId,
        appKey,
        sourceMode: 'source-unknown',
        adoptionMode: 'adopted-observed',
        repository: {
          owner: registration.repoOwner,
          name: registration.repoName,
          url: registration.repoUrl,
        },
        observedDeployment: registration.observedDeployment,
        request: registration,
        response: payload,
      });
      return;
    }

    spinner?.succeed(`Adopted observed app ${chalk.cyan(appKey)}`);
    out.info(`Repository: ${chalk.cyan(`${registration.repoOwner}/${registration.repoName}`)}`);
    out.info(`Observed URL: ${chalk.cyan(String(registration.observedDeployment?.activeUrl))}`);
    out.info('Destructive operations remain blocked until a managed redeploy verifies control.');
  });

verticalCommand
  .command('workflow-setup <key>')
  .description('Issue source-unknown workflow setup operation and nonce')
  .option('--tenant-id <id>', 'Run against a specific company tenant')
  .option('--environment <environment>', 'Deployment environment to bind', 'preview')
  .option('--workflow <path>', 'GitHub Actions workflow path', '.github/workflows/eai-app.yml')
  .option('--ref <ref>', 'Approved git ref')
  .option('--commit <sha>', 'Current commit SHA to bind')
  .option('--config-hash <hash>', 'Validated config hash to bind')
  .option('--skip-validate', 'Skip app lookup', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (key: string, options: AppWorkflowSetupOptions) => {
    const ctx = await resolveAppManagementContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const companyTenantId = options.tenantId
      ? ctx.tenantId
      : await resolveMainCompanyTenantId(ctx.publicApiUrl, ctx.tenantId);
    const client = new PlatformAPIClient(ctx.publicApiUrl, companyTenantId);
    const format = normalizeFormat(options);
    const appKey = key.trim();

    if (!appKey) {
      fail('App key is required.');
    }

    let setupRequest: SourceUnknownWorkflowSetupRequest;
    try {
      setupRequest = buildSourceUnknownWorkflowSetupData(options);
    } catch (err) {
      fail(errMsg(err));
    }

    if (!options.skipValidate) {
      await validateVerticalEnrollment(appKey, client);
    }

    const spinner = makeSpinner(format, `Issuing workflow setup for ${appKey}...`);
    const res = await client.setupSourceUnknownWorkflow(companyTenantId, appKey, setupRequest);
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      spinner?.fail('Failed to issue source-unknown workflow setup');
      fail(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `${res.status} ${res.statusText}`);
    }

    if (format === 'json') {
      out.json({
        tenantId: companyTenantId,
        appKey,
        sourceMode: 'source-unknown',
        request: setupRequest,
        response: payload,
      });
      return;
    }

    spinner?.succeed(`Issued workflow setup for ${chalk.cyan(appKey)}`);
    if (isRecord(payload)) {
      const operationId = typeof payload.operationId === 'string' ? payload.operationId : '<unknown>';
      const nonce = typeof payload.nonce === 'string' ? payload.nonce : '<returned in JSON response>';
      const expiresAt = typeof payload.expiresAt === 'string' ? payload.expiresAt : '<unknown>';
      const setup = isRecord(payload.setup) ? payload.setup : {};
      const workflowPath = typeof setup.workflowPath === 'string' ? setup.workflowPath : setupRequest.workflowPath;
      const evidencePath = typeof setup.publicApiEvidencePath === 'string' ? setup.publicApiEvidencePath : undefined;
      out.info(`Operation: ${chalk.cyan(operationId)}`);
      out.info(`Nonce: ${chalk.cyan(nonce)} ${chalk.dim('(displayed once)')}`);
      out.info(`Expires: ${chalk.cyan(expiresAt)}`);
      out.info(`Workflow: ${chalk.cyan(String(workflowPath))}`);
      if (evidencePath) {
        out.info(`Evidence endpoint: ${chalk.cyan(evidencePath)}`);
      }
    }
  });

verticalCommand
  .command('workflow-evidence <key>')
  .description('Submit source-unknown workflow evidence for a setup operation')
  .requiredOption('--repo <owner/repo>', 'GitHub repository submitting evidence')
  .requiredOption('--operation-id <id>', 'Source-unknown workflow setup operation ID')
  .requiredOption('--nonce <nonce>', 'One-time setup nonce')
  .requiredOption('--commit <sha>', 'Workflow commit SHA')
  .requiredOption('--config-hash <hash>', 'Validated config hash')
  .requiredOption('--artifact-digest <digest>', 'Workflow artifact digest in sha256:<hex> form')
  .requiredOption('--image-digest <digest>', 'Immutable image digest in sha256:<hex> form')
  .option('--tenant-id <id>', 'Run against a specific company tenant')
  .option('--environment <environment>', 'Deployment environment to bind', 'preview')
  .option('--branch <branch>', 'Default branch', 'main')
  .option('--workflow <path>', 'GitHub Actions workflow path', '.github/workflows/eai-app.yml')
  .option('--ref <ref>', 'Approved git ref (defaults to refs/heads/<branch>)')
  .option('--template-version <version>', 'Approved schema/template version')
  .option('--base-template-sha <sha>', 'Base eai-app-template commit SHA when known')
  .option('--approved-source-sha <sha>', 'Approved source commit SHA for non-template apps')
  .option('--approved-release <id>', 'Approved schema/validator release identifier')
  .option('--schema-digest <digest>', 'Approved schema digest in sha256:<hex> form')
  .option('--validator-digest <digest>', 'Approved validator digest in sha256:<hex> form')
  .option('--workflow-run-id <id>', 'GitHub Actions run ID')
  .option('--workflow-run-attempt <n>', 'GitHub Actions run attempt')
  .option('--github-oidc-token <token>', 'GitHub Actions OIDC token for workflow evidence submission')
  .option(
    '--github-oidc-audience <audience>',
    'GitHub Actions OIDC audience',
    DEFAULT_SOURCE_UNKNOWN_GITHUB_OIDC_AUDIENCE,
  )
  .option('--skip-validate', 'Skip app lookup', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (key: string, options: AppWorkflowEvidenceOptions) => {
    const ctx = await resolveAppManagementContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const companyTenantId = options.tenantId
      ? ctx.tenantId
      : await resolveMainCompanyTenantId(ctx.publicApiUrl, ctx.tenantId);
    const client = new PlatformAPIClient(ctx.publicApiUrl, companyTenantId);
    const format = normalizeFormat(options);
    const appKey = key.trim();

    if (!appKey) {
      fail('App key is required.');
    }

    let evidenceRequest: SourceUnknownWorkflowEvidenceRequest;
    try {
      evidenceRequest = buildSourceUnknownWorkflowEvidenceData(options);
    } catch (err) {
      fail(errMsg(err));
    }

    if (!options.skipValidate) {
      await validateVerticalEnrollment(appKey, client);
    }

    let githubOidcToken: string;
    try {
      githubOidcToken = await resolveGitHubOidcToken(options);
    } catch (err) {
      fail(errMsg(err));
    }

    const spinner = makeSpinner(format, `Submitting workflow evidence for ${appKey}...`);
    const res = await client.submitSourceUnknownWorkflowEvidence(companyTenantId, appKey, evidenceRequest, githubOidcToken);
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      spinner?.fail('Failed to submit source-unknown workflow evidence');
      fail(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `${res.status} ${res.statusText}`);
    }

    if (format === 'json') {
      out.json({
        tenantId: companyTenantId,
        appKey,
        sourceMode: 'source-unknown',
        request: evidenceRequest,
        response: payload,
      });
      return;
    }

    spinner?.succeed(`Submitted workflow evidence for ${chalk.cyan(appKey)}`);
    out.info(`Operation: ${chalk.cyan(evidenceRequest.operationId)}`);
    out.info(`Artifact: ${chalk.cyan(evidenceRequest.artifactDigest)}`);
    out.info(`Image: ${chalk.cyan(evidenceRequest.imageDigest)}`);
  });

verticalCommand
  .command('deploy-source-unknown <key>')
  .description('Request a TenantInfra deployment handoff for a source-unknown app')
  .requiredOption('--operation-id <id>', 'Accepted source-unknown workflow evidence operation ID')
  .option('--tenant-id <id>', 'Run against a specific company tenant')
  .option('--environment <environment>', 'Deployment environment to bind', 'preview')
  .option('--repo <owner/name>', 'GitHub repository that produced the deployment evidence')
  .option('--workflow <path>', 'GitHub Actions workflow path')
  .option('--ref <ref>', 'Approved git ref')
  .option('--commit <sha>', 'Workflow commit SHA')
  .option('--workflow-run-id <id>', 'GitHub Actions workflow run ID')
  .option('--config-hash <hash>', 'Validated config hash')
  .option('--artifact-digest <digest>', 'Workflow artifact digest in sha256:<hex> form')
  .option('--image-digest <digest>', 'Immutable image digest in sha256:<hex> form')
  .option('--target-kind <kind>', 'Deployment backend target kind', 'tenantinfra')
  .option('--release-channel <channel>', 'Release channel to request', 'preview')
  .option('--skip-validate', 'Skip app lookup', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (key: string, options: AppDeploySourceUnknownOptions) => {
    const ctx = await resolveAppManagementContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const companyTenantId = options.tenantId
      ? ctx.tenantId
      : await resolveMainCompanyTenantId(ctx.publicApiUrl, ctx.tenantId);
    const client = new PlatformAPIClient(ctx.publicApiUrl, companyTenantId);
    const format = normalizeFormat(options);
    const appKey = key.trim();

    if (!appKey) {
      fail('App key is required.');
    }

    let deploymentRequest: SourceUnknownDeploymentRequest;
    try {
      deploymentRequest = buildSourceUnknownDeploymentData(options);
    } catch (err) {
      fail(errMsg(err));
    }

    if (!options.skipValidate) {
      await validateVerticalEnrollment(appKey, client);
    }

    const spinner = makeSpinner(format, `Requesting source-unknown deployment handoff for ${appKey}...`);
    const res = await client.requestSourceUnknownDeployment(companyTenantId, appKey, deploymentRequest);
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      spinner?.fail('Failed to request source-unknown deployment handoff');
      fail(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `${res.status} ${res.statusText}`);
    }

    if (format === 'json') {
      out.json({
        tenantId: companyTenantId,
        appKey,
        sourceMode: 'source-unknown',
        request: deploymentRequest,
        response: payload,
      });
      return;
    }

    spinner?.succeed(`Recorded deployment handoff for ${chalk.cyan(appKey)}`);
    if (isRecord(payload)) {
      const status = typeof payload.status === 'string' ? payload.status : 'unknown';
      const requestId = typeof payload.deploymentRequestId === 'string' ? payload.deploymentRequestId : '<unknown>';
      const requiresTenantInfra = payload.requiresTenantInfra === true ? 'required' : 'not required';
      out.info(`Status: ${chalk.cyan(status)}`);
      out.info(`Request: ${chalk.cyan(requestId)}`);
      out.info(`TenantInfra: ${chalk.cyan(requiresTenantInfra)}`);
    }
  });

verticalCommand
  .command('deploy-source-unknown-status <key>')
  .description('Read the latest source-unknown deployment handoff status')
  .option('--tenant-id <id>', 'Run against a specific company tenant')
  .option('--skip-validate', 'Skip app lookup', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (key: string, options: AppDeploySourceUnknownStatusOptions) => {
    const ctx = await resolveAppManagementContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const companyTenantId = options.tenantId
      ? ctx.tenantId
      : await resolveMainCompanyTenantId(ctx.publicApiUrl, ctx.tenantId);
    const client = new PlatformAPIClient(ctx.publicApiUrl, companyTenantId);
    const format = normalizeFormat(options);
    const appKey = key.trim();

    if (!appKey) {
      fail('App key is required.');
    }

    if (!options.skipValidate) {
      await validateVerticalEnrollment(appKey, client);
    }

    const spinner = makeSpinner(format, `Reading source-unknown deployment handoff status for ${appKey}...`);
    const res = await client.getLatestSourceUnknownDeployment(companyTenantId, appKey);
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      spinner?.fail('Failed to read source-unknown deployment handoff status');
      fail(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `${res.status} ${res.statusText}`);
    }

    if (format === 'json') {
      out.json({
        tenantId: companyTenantId,
        appKey,
        sourceMode: 'source-unknown',
        response: payload,
      });
      return;
    }

    spinner?.succeed(`Read deployment handoff status for ${chalk.cyan(appKey)}`);
    if (isRecord(payload)) {
      const status = typeof payload.status === 'string' ? payload.status : 'unknown';
      const requestId = typeof payload.deploymentRequestId === 'string' ? payload.deploymentRequestId : '<none>';
      const requiresTenantInfra = payload.requiresTenantInfra === true ? 'required' : 'not required';
      out.info(`Status: ${chalk.cyan(status)}`);
      out.info(`Request: ${chalk.cyan(requestId)}`);
      out.info(`TenantInfra: ${chalk.cyan(requiresTenantInfra)}`);
    }
  });

verticalCommand
  .command('select <key>')
  .description('Set EAI_APP_KEY in the current project .env.local')
  .option('--tenant-id <id>', 'Validate against a specific company tenant')
  .option('--skip-validate', 'Skip remote lookup before writing .env.local', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (key: string, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const format = normalizeFormat(options);
    const verticalKey = key.trim();

    if (!verticalKey) {
      fail('App key is required.');
    }

    if (!options.skipValidate) {
      await validateVerticalEnrollment(verticalKey, ctx.client);
    }

    await patchEnvFile(ctx.root, {
      [APP_KEY_ENV]: verticalKey,
      [LEGACY_VERTICAL_KEY_ENV]: verticalKey,
    });

    if (format === 'json') {
      out.json({
        tenantId: ctx.tenantId,
        appKey: verticalKey,
        verticalKey,
        env: APP_KEY_ENV,
        legacyEnv: LEGACY_VERTICAL_KEY_ENV,
      });
      return;
    }
    out.success(`Active app set to ${chalk.cyan(verticalKey)} in .env.local`);
  });

verticalCommand
  .command('provision <key>')
  .description('Run the platform app provisioning job')
  .option('--tenant-id <id>', 'Run against a specific company tenant')
  .option('--backend <backend>', 'postgresql|mongodb|documentdb|blob|search|all', 'all')
  .option('--dry-run', 'Plan actions without applying changes', false)
  .option('--rebuild-search', 'Request search projection rebuild after provisioning', false)
  .option('--skip-validate', 'Skip app lookup', false)
  .option('--select', 'Write EAI_APP_KEY after successful provisioning', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (key: string, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const format = normalizeFormat(options);
    const verticalKey = key.trim();

    if (!verticalKey) {
      fail('App key is required.');
    }

    if (!options.skipValidate) {
      await validateVerticalEnrollment(verticalKey, ctx.client);
    }

    const spinner = makeSpinner(
      format,
      options.dryRun
        ? `Planning app storage readiness for ${verticalKey}...`
        : `Provisioning app ${verticalKey}...`,
    );
    const res = options.dryRun
      ? await ctx.client.provisionStorage({
        backend: options.backend,
        dryRun: true,
        rebuildSearch: Boolean(options.rebuildSearch),
      })
      : await ctx.client.createAppProvisioningJob(verticalKey);
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      spinner?.fail('Failed to prepare app storage');
      fail(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `${res.status} ${res.statusText}`);
    }

    if (options.select) {
      await patchEnvFile(ctx.root, {
        [APP_KEY_ENV]: verticalKey,
        [LEGACY_VERTICAL_KEY_ENV]: verticalKey,
      });
    }

    if (format === 'json') {
      out.json({
        tenantId: ctx.tenantId,
        appKey: verticalKey,
        verticalKey,
        selected: Boolean(options.select),
        ...(options.dryRun ? { dryRun: true, storagePlan: payload } : { provisioning: payload }),
      });
      return;
    }

    spinner?.succeed(options.dryRun ? 'App storage readiness plan complete' : 'App provisioning complete');
    out.info(`App ${chalk.cyan(verticalKey)} is linked under the selected company tenant.`);
    if (isRecord(payload) && Array.isArray(payload.results)) {
      for (const result of payload.results.filter(isRecord)) {
        const objectType = typeof result.objectType === 'string' ? result.objectType : 'unknown';
        const backend = typeof result.backend === 'string' ? result.backend : 'unknown';
        const status = typeof result.status === 'string' ? result.status : 'unknown';
        const actions = Array.isArray(result.actions) ? result.actions.map(String) : [];
        out.info(`${chalk.cyan(objectType)} ${chalk.dim(backend)} ${status}`);
        for (const action of actions) {
          out.dim(`  ${action}`);
        }
      }
    }
    if (options.select) {
      out.success(`Active app set to ${chalk.cyan(verticalKey)} in .env.local`);
    }
  });
