import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { PlatformAPIClient } from './api.js';
import { readManagedPublicResponseText } from './api.js';
import { ManagedSourceError } from './eai-managed-source.js';
import type { CliManagedSourceScope } from './eai-managed-source-client-types.js';

/** Stable server code for a project whose template commit is not the environment's approved pin. */
export const TEMPLATE_VERSION_NOT_APPROVED = 'TEMPLATE_VERSION_NOT_APPROVED';
export const TEMPLATE_MIGRATION_DOCS_URL =
  'https://eai-support.github.io/eai/docs/eai-app-template#move-an-existing-project-to-the-required-template';

const COMMIT = /^[a-f0-9]{40}$/;
const VERSION = /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const MAX_ERROR_BODY_CHARS = 8_192;
const MAX_SERVER_MESSAGE_CHARS = 240;
const require = createRequire(import.meta.url);

/** The exact pins compared by AdminAPI; versions are display labels only. */
export interface TemplatePinComparison {
  currentTemplateCommitSha: string;
  currentTemplateVersion?: string;
  requiredTemplateCommitSha: string;
  requiredTemplateVersion?: string;
}

function label(commit: string, version?: string): string {
  return version ? `${version} (${commit.slice(0, 7)})` : commit.slice(0, 7);
}

function bundledTemplate(): { version?: string; commit?: string } | undefined {
  try {
    return (require('../../resources/linked-sources.json') as { appTemplate?: { version?: string; commit?: string } }).appTemplate;
  } catch {
    return undefined;
  }
}

/** One actionable failure for both the local preflight and the server's 409. */
export function templateVersionNotApprovedError(
  comparison: TemplatePinComparison,
  extraDetails: Record<string, unknown> = {},
): ManagedSourceError {
  const required = label(comparison.requiredTemplateCommitSha, comparison.requiredTemplateVersion);
  const bundled = bundledTemplate();
  const cliAlreadyBundlesRequired = bundled?.commit === comparison.requiredTemplateCommitSha;
  const fix = `create a new project with eai create and move your app code into it, or commit an explicit template migration for this project (${TEMPLATE_MIGRATION_DOCS_URL}). Then retry eai deploy app.`;
  const nextAction = cliAlreadyBundlesRequired
    ? `This CLI already bundles app template ${required}: ${fix}`
    : `Update the CLI with npm install -g eai-cli@latest so it bundles app template ${required}, then ${fix}`;
  return new ManagedSourceError(
    TEMPLATE_VERSION_NOT_APPROVED,
    `Your project uses app template ${label(comparison.currentTemplateCommitSha, comparison.currentTemplateVersion)}; this environment requires ${required}.`,
    { nextAction, details: { ...comparison, ...extraDetails } },
  );
}

function readableServerText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Cc covers C0, DEL and C1 (e.g. U+009B CSI); Cf covers bidi overrides and zero-width characters.
  const text = value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > MAX_SERVER_MESSAGE_CHARS ? `${text.slice(0, MAX_SERVER_MESSAGE_CHARS - 1)}…` : text;
}

function serverCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,79}$/.test(value) ? value : undefined;
}

function templateComparison(details: unknown): TemplatePinComparison | undefined {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const { currentTemplateCommitSha, requiredTemplateCommitSha, requiredTemplateVersion } = details as Record<string, unknown>;
  if (typeof currentTemplateCommitSha !== 'string' || !COMMIT.test(currentTemplateCommitSha)
    || typeof requiredTemplateCommitSha !== 'string' || !COMMIT.test(requiredTemplateCommitSha)) return undefined;
  return {
    currentTemplateCommitSha,
    requiredTemplateCommitSha,
    ...(typeof requiredTemplateVersion === 'string' && VERSION.test(requiredTemplateVersion) ? { requiredTemplateVersion } : {}),
  };
}

/**
 * Turn a rejected managed-source response into a readable error.
 * Supports `{error,message,details}` and FastAPI `{detail}` shapes; unknown codes are shown, never trusted.
 */
export async function managedSourceResponseError(response: Response): Promise<ManagedSourceError> {
  let body: unknown;
  try {
    const text = await readManagedPublicResponseText(response);
    body = text.length <= MAX_ERROR_BODY_CHARS ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const detail = record.detail;
  const nested = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail as Record<string, unknown> : {};
  const code = serverCode(record.error) ?? serverCode(nested.error);
  if (code === TEMPLATE_VERSION_NOT_APPROVED) {
    const comparison = templateComparison(record.details ?? nested.details);
    if (comparison) return templateVersionNotApprovedError(comparison, { httpStatus: response.status });
  }
  const message = readableServerText(record.message) ?? readableServerText(nested.message) ?? readableServerText(detail);
  return new ManagedSourceError(
    'MANAGED_SOURCE_UNAVAILABLE',
    `Managed source operation is unavailable (${response.status}${code ? ` ${code}` : ''})${message ? `: ${message}` : '.'} Repair the platform operation or app-source access, then retry the exact operation.`,
    { details: { httpStatus: response.status, ...(code ? { serverCode: code } : {}) } },
  );
}

async function projectTemplatePin(root: string): Promise<{ commit: string; version?: string } | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(root, '.eai-manifest.json'), 'utf8')) as { template?: { commit?: unknown; version?: unknown } };
    const commit = manifest.template?.commit;
    const version = manifest.template?.version;
    if (typeof commit !== 'string' || !COMMIT.test(commit)) return undefined;
    return { commit, ...(typeof version === 'string' && VERSION.test(version) ? { version } : {}) };
  } catch {
    return undefined;
  }
}

async function approvedTemplate(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  timeoutMs: number,
): Promise<{ commit: string; version?: string } | undefined> {
  try {
    const response = await client.getCliManagedTemplateRequirement(scope.tenantId, scope.appKey, scope.targetTenantId, timeoutMs);
    if (!response.ok) return undefined;
    const value = JSON.parse(await readManagedPublicResponseText(response)) as Record<string, unknown>;
    const commit = value.requiredTemplateCommitSha;
    const version = value.requiredTemplateVersion;
    if (value.schemaVersion !== 'eai.cli_managed_template_requirement.v1'
      || value.tenantId !== scope.tenantId || value.appKey !== scope.appKey
      || typeof commit !== 'string' || !COMMIT.test(commit)) return undefined;
    return { commit, ...(typeof version === 'string' && VERSION.test(version) ? { version } : {}) };
  } catch {
    return undefined;
  }
}

/**
 * Stop an outdated project before the GitHub link step.
 * Fails open: an unreachable, older or unverifiable platform leaves admission to the server.
 */
export async function assertProjectTemplateApproved(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  root: string,
  timeoutMs: number,
): Promise<void> {
  const current = await projectTemplatePin(root);
  if (!current) return;
  const required = await approvedTemplate(client, scope, timeoutMs);
  if (!required || required.commit === current.commit) return;
  throw templateVersionNotApprovedError({
    currentTemplateCommitSha: current.commit,
    ...(current.version ? { currentTemplateVersion: current.version } : {}),
    requiredTemplateCommitSha: required.commit,
    ...(required.version ? { requiredTemplateVersion: required.version } : {}),
  });
}
