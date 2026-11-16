import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { PlatformAPIClient } from "./api.js";
import {
  isManagedPublicRequestTimeout,
  readManagedPublicResponseTextBounded,
} from "./api.js";
import { ManagedSourceError } from "./eai-managed-source.js";
import { CLI_MANAGED_SOURCE_OPERATION_ID } from "./eai-managed-identifiers.js";
import type { CliManagedSourceScope } from "./eai-managed-source-client-types.js";

/** Stable server code for a project whose template commit is not the environment's approved pin. */
export const TEMPLATE_VERSION_NOT_APPROVED = "TEMPLATE_VERSION_NOT_APPROVED";
export const TEMPLATE_MIGRATION_DOCS_URL =
  "https://eai-support.github.io/eai/docs/eai-app-template#move-an-existing-project-to-the-required-template";

const COMMIT = /^[a-f0-9]{40}$/;
const VERSION = /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/;
export const MAX_TEMPLATE_RESPONSE_BYTES = 8_192;
export const MAX_PROJECT_MANIFEST_BYTES = 64 * 1024;
const SOURCE_CONFLICT_GUIDANCE: Readonly<Record<string, string>> = {
  CLI_MANAGED_SOURCE_OPERATION_ACTIVE:
    "An earlier EAI-maintained publish for this app is still active. Check it with --resume <operation-id>; if its EAI review checks failed, run --recover-failed-review <operation-id>. Find the original operation ID in the earlier output or ~/.eai/managed-deployments.",
  CLI_MANAGED_SOURCE_PREDECESSOR_AMBIGUOUS:
    "More than one earlier failed EAI publish could be continued. Contact EAI support with the app key and original operation reference before publishing again.",
  CLI_MANAGED_REVIEW_FAILURE_LIMIT:
    "This app has reached the limit of failed EAI reviews that can be recovered automatically. Contact EAI support with the app key and original operation reference.",
};
const PUBLIC_SOURCE_CODES = new Set([TEMPLATE_VERSION_NOT_APPROVED, ...Object.keys(SOURCE_CONFLICT_GUIDANCE)]);
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
    return (
      require("../../resources/linked-sources.json") as {
        appTemplate?: { version?: string; commit?: string };
      }
    ).appTemplate;
  } catch {
    return undefined;
  }
}

/** One actionable failure for both the local preflight and the server's 409. */
export function templateVersionNotApprovedError(
  comparison: TemplatePinComparison,
  extraDetails: Record<string, unknown> = {},
): ManagedSourceError {
  const required = label(
    comparison.requiredTemplateCommitSha,
    comparison.requiredTemplateVersion,
  );
  const bundled = bundledTemplate();
  const cliAlreadyBundlesRequired =
    bundled?.commit === comparison.requiredTemplateCommitSha;
  const fix = `create a new project with eai create and move your app code into it, or commit an explicit template migration for this project (${TEMPLATE_MIGRATION_DOCS_URL}). Then retry eai deploy app.`;
  // INVARIANT: required pin may lag this CLI's bundle during staged regional rollouts, so never assume @latest bundles it.
  const bundledLabel =
    bundled?.commit && COMMIT.test(bundled.commit)
      ? ` (this CLI bundles ${label(bundled.commit, bundled.version)})`
      : "";
  const nextAction = cliAlreadyBundlesRequired
    ? `This CLI already bundles app template ${required}: ${fix}`
    : `Install an EAI CLI release that bundles app template ${required}${bundledLabel}, then ${fix}`;
  return new ManagedSourceError(
    TEMPLATE_VERSION_NOT_APPROVED,
    `Your project uses app template ${label(comparison.currentTemplateCommitSha, comparison.currentTemplateVersion)}; this environment requires ${required}.`,
    { nextAction, details: { ...comparison, ...extraDetails } },
  );
}

function serverCode(value: unknown): string | undefined {
  return typeof value === "string" && PUBLIC_SOURCE_CODES.has(value) ? value : undefined;
}

function templateVersion(value: unknown): string | undefined {
  return typeof value === "string" && VERSION.test(value) ? value : undefined;
}

function templateComparison(
  details: unknown,
): TemplatePinComparison | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details))
    return undefined;
  const {
    currentTemplateCommitSha,
    currentTemplateVersion,
    requiredTemplateCommitSha,
    requiredTemplateVersion,
  } = details as Record<string, unknown>;
  if (
    typeof currentTemplateCommitSha !== "string" ||
    !COMMIT.test(currentTemplateCommitSha) ||
    typeof requiredTemplateCommitSha !== "string" ||
    !COMMIT.test(requiredTemplateCommitSha)
  )
    return undefined;
  const currentVersion = templateVersion(currentTemplateVersion);
  const requiredVersion = templateVersion(requiredTemplateVersion);
  return {
    currentTemplateCommitSha,
    ...(currentVersion ? { currentTemplateVersion: currentVersion } : {}),
    requiredTemplateCommitSha,
    ...(requiredVersion ? { requiredTemplateVersion: requiredVersion } : {}),
  };
}

/**
 * Turn a rejected managed-source response into a readable error.
 * Stream-limits error bodies to 8 KiB before buffering, preserves managed deadlines, and never trusts unknown server codes.
 */
export async function managedSourceResponseError(
  response: Response,
  knownOperationId?: string,
): Promise<ManagedSourceError> {
  let body: unknown;
  try {
    const text = await readManagedPublicResponseTextBounded(
      response,
      MAX_TEMPLATE_RESPONSE_BYTES,
    );
    body = text !== undefined ? JSON.parse(text) : undefined;
  } catch (error) {
    if (isManagedPublicRequestTimeout(error)) throw error;
    body = undefined;
  }
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const detail = record.detail;
  const nested =
    detail && typeof detail === "object" && !Array.isArray(detail)
      ? (detail as Record<string, unknown>)
      : {};
  const code = serverCode(record.error) ?? serverCode(record.code) ?? serverCode(nested.error) ?? serverCode(nested.code);
  // Only the already-known local request identity is eligible; an error body cannot nominate another operation.
  const operationId = typeof knownOperationId === "string" && CLI_MANAGED_SOURCE_OPERATION_ID.test(knownOperationId)
    ? knownOperationId : undefined;
  const details = { httpStatus: response.status, ...(code ? { serverCode: code } : {}), ...(operationId ? { operationId } : {}) };
  if (code === TEMPLATE_VERSION_NOT_APPROVED) {
    const comparison = templateComparison(record.details ?? nested.details);
    if (comparison)
      return templateVersionNotApprovedError(comparison, {
        ...details,
      });
  }
  const guidance = response.status === 409 && code && Object.hasOwn(SOURCE_CONFLICT_GUIDANCE, code)
    ? SOURCE_CONFLICT_GUIDANCE[code] : undefined;
  const nextAction = operationId
    ? `Keep the original recovery receipt and inspect operation ${operationId} with --retry ${operationId}; do not start another publication while its outcome is unknown.`
    : "Check the earlier publish output and saved recovery receipt for an operation reference. Ask EAI support to confirm the outcome before starting another publication.";
  return new ManagedSourceError(
    guidance && code ? code : "MANAGED_SOURCE_UNAVAILABLE",
    guidance ?? `Managed source operation is unavailable (${response.status}${code ? ` ${code}` : ""}). Its remote outcome has not been confirmed.`,
    { nextAction, details },
  );
}

function sameOpenedManifest(expected: Stats, opened: Stats): boolean {
  const devMatches =
    expected.dev === 0 || opened.dev === 0 || opened.dev === expected.dev;
  if (expected.ino !== 0 && opened.ino !== 0) {
    return devMatches && opened.ino === expected.ino;
  }
  return (
    devMatches &&
    opened.size === expected.size &&
    opened.mtimeMs === expected.mtimeMs
  );
}

async function projectTemplatePin(
  root: string,
  fsCapabilities: { O_NOFOLLOW?: number } = constants,
): Promise<{ commit: string; version?: string } | undefined> {
  // SECURITY: reject symlinks via lstat + opened-file identity verification (for Windows where O_NOFOLLOW is 0) and cap reads at 64 KiB.
  let handle;
  try {
    const rootStats = await lstat(root);
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory())
      return undefined;
    const manifestPath = join(root, ".eai-manifest.json");
    const linkStats = await lstat(manifestPath);
    if (
      linkStats.isSymbolicLink() ||
      !linkStats.isFile() ||
      linkStats.size > MAX_PROJECT_MANIFEST_BYTES
    )
      return undefined;
    handle = await open(
      manifestPath,
      constants.O_RDONLY | (fsCapabilities.O_NOFOLLOW || 0),
    );
    const [handleStats, reboundStats] = await Promise.all([
      handle.stat(),
      lstat(manifestPath),
    ]);
    if (
      !handleStats.isFile() ||
      handleStats.size > MAX_PROJECT_MANIFEST_BYTES ||
      reboundStats.isSymbolicLink() ||
      !reboundStats.isFile() ||
      !sameOpenedManifest(linkStats, handleStats) ||
      !sameOpenedManifest(reboundStats, handleStats)
    )
      return undefined;
    const buffer = Buffer.alloc(MAX_PROJECT_MANIFEST_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_PROJECT_MANIFEST_BYTES) return undefined;
    const manifest = JSON.parse(
      buffer.subarray(0, length).toString("utf8"),
    ) as {
      template?: { commit?: unknown; version?: unknown };
    };
    const commit = manifest.template?.commit;
    const version = templateVersion(manifest.template?.version);
    if (typeof commit !== "string" || !COMMIT.test(commit)) return undefined;
    return {
      commit,
      ...(version ? { version } : {}),
    };
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function approvedTemplate(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  timeoutMs: number,
): Promise<{ commit: string; version?: string } | undefined> {
  try {
    const response = await client.getCliManagedTemplateRequirement(
      scope.tenantId,
      scope.appKey,
      scope.targetTenantId,
      scope.environment,
      timeoutMs,
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const text = await readManagedPublicResponseTextBounded(
      response,
      MAX_TEMPLATE_RESPONSE_BYTES,
    );
    if (text === undefined) return undefined;
    const value = JSON.parse(text) as Record<string, unknown>;
    const commit = value.requiredTemplateCommitSha;
    const version = templateVersion(value.requiredTemplateVersion);
    if (
      value.schemaVersion !== "eai.cli_managed_template_requirement.v1" ||
      value.tenantId !== scope.tenantId ||
      value.appKey !== scope.appKey ||
      typeof commit !== "string" ||
      !COMMIT.test(commit)
    )
      return undefined;
    return {
      commit,
      ...(version ? { version } : {}),
    };
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
  fsCapabilities: { O_NOFOLLOW?: number } = constants,
): Promise<void> {
  const current = await projectTemplatePin(root, fsCapabilities);
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
