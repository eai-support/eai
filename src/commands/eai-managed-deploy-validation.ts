import {
  EAI_MANAGED_WORKFLOW_PATH,
  parseGitHubRepository,
  requireBranch,
  requireCommitSha,
  requireInstallationId,
  requireWorkflowPath,
} from "../lib/eai-managed-deploy.js";
import type { ManagedDeploymentOperationResponse } from "../lib/api.js";
import {
  isManagedScopeIdentifier,
  requireManagedDeploymentIdentifier,
} from "../lib/eai-managed-identifiers.js";
import {
  MANAGED_DEPLOY_ENVIRONMENTS,
  fail,
  isRecord,
  type ManagedDeployOptions,
} from "./eai-managed-deploy-contract.js";

export const RECOVERY_SOURCE_OPTIONS = [
  "repo", "installationId", "branch", "workflow", "commit", "githubLinkSession",
] as const;

/** Explicit recovery hints must agree with the server's independently sealed setup. */
export function requireRecoverySourceOptions(
  options: ManagedDeployOptions,
  supplied: ReadonlyArray<(typeof RECOVERY_SOURCE_OPTIONS)[number]>,
  operation: ManagedDeploymentOperationResponse,
): void {
  const setup = isRecord(operation.setup) ? operation.setup : {};
  const repo = isRecord(setup.repo) ? setup.repo : undefined;
  const expectedRepo = repo && typeof repo.owner === "string" && typeof repo.name === "string"
    ? `${repo.owner}/${repo.name}`.toLowerCase()
    : undefined;
  for (const option of supplied) {
    let expected: unknown;
    let actual: unknown;
    switch (option) {
      case "repo":
        expected = expectedRepo;
        actual = parseGitHubRepository(options.repo!).slug.toLowerCase();
        break;
      case "installationId":
        expected = setup.installationId === undefined ? undefined : String(setup.installationId);
        actual = String(requireInstallationId(options.installationId!));
        break;
      case "branch":
        expected = setup.ref;
        actual = `refs/heads/${requireBranch(options.branch)}`;
        break;
      case "workflow":
        expected = setup.workflowPath;
        actual = options.workflow;
        break;
      case "commit":
        expected = setup.commitSha;
        actual = requireCommitSha(options.commit!);
        break;
      case "githubLinkSession":
        expected = setup.githubLinkSessionId;
        actual = options.githubLinkSession;
        break;
    }
    if (typeof expected !== "string" || !expected || expected !== actual) {
      fail(
        "RECOVERY_OPTION_MISMATCH",
        `Explicit recovery option ${option} does not match the sealed operation setup.`,
        "Omit new-source options or use the exact values recorded by the original operation; recovery cannot change its source authority.",
      );
    }
  }
}

export interface ValidatedManagedDeployInput {
  appKey: string;
  targetTenantId: string;
  workflowPath: string;
  timeoutSeconds: number;
  resumeOperationId?: string;
  retryOperationId?: string;
}

/** Reject unsafe caller-controlled scope, recovery and repository identifiers before authentication or I/O. */
export function validateManagedDeployInput(
  appKeyValue: string,
  options: ManagedDeployOptions,
): ValidatedManagedDeployInput {
  if (options.target !== "eai") {
    fail(
      "HOSTING_TARGET_INVALID",
      "This command supports --target eai.",
      "Use the existing deploy commands for customer-owned hosting.",
    );
  }
  if (!isManagedScopeIdentifier(options.tenantId)) {
    fail(
      "TENANT_ID_INVALID",
      "--tenant-id must be a safe exact managed-deployment scope.",
      "Use the exact app-scope tenant shown by `eai tenant list --format json`.",
    );
  }
  if (options.resume && options.retry) {
    fail(
      "DEPLOY_MODE_CONFLICT",
      "--resume and --retry cannot be used together.",
      "Choose one exact operation action.",
    );
  }
  let resumeOperationId: string | undefined;
  let retryOperationId: string | undefined;
  try {
    resumeOperationId = options.resume === undefined
      ? undefined
      : requireManagedDeploymentIdentifier(options.resume, "--resume operation ID");
    retryOperationId = options.retry === undefined
      ? undefined
      : requireManagedDeploymentIdentifier(options.retry, "--retry operation ID");
  } catch (error) {
    fail(
      "SOURCE_OPERATION_ID_INVALID",
      error instanceof Error ? error.message : String(error),
      "Use the exact operation ID returned by the managed deployment command.",
    );
  }
  if (
    options.source &&
    !["eai-managed", "customer-owned"].includes(options.source)
  ) {
    fail(
      "SOURCE_CHOICE_INVALID",
      "Choose --source eai-managed or --source customer-owned.",
      "Use the source mode recorded by the exact operation.",
    );
  }
  if (
    options.source === "eai-managed" &&
    (options.repo ||
      options.installationId ||
      options.commit ||
      options.branch !== "main")
  ) {
    fail(
      "SOURCE_CHOICE_CONFLICT",
      "EAI derives the maintained repository, branch and merged commit.",
      "Omit --repo, --installation-id, --branch and --commit for EAI-maintained local source.",
    );
  }
  if (
    ((!options.resume && !options.retry) || options.source === "eai-managed") &&
    !MANAGED_DEPLOY_ENVIRONMENTS.has(options.environment)
  ) {
    fail(
      "DEPLOY_ENVIRONMENT_INVALID",
      "Managed deployment supports preview, dev, test, or prod.",
      "Choose a supported environment before registering the source operation.",
    );
  }
  if (options.repo) parseGitHubRepository(options.repo);
  const appKey = appKeyValue.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(appKey)) {
    fail(
      "APP_KEY_INVALID",
      "App key must use lowercase letters, numbers, dots, and hyphens.",
      "Use the exact app key shown by `eai app list --format json`.",
    );
  }
  const workflowPath = requireWorkflowPath(options.workflow);
  if (workflowPath !== EAI_MANAGED_WORKFLOW_PATH) {
    fail(
      "WORKFLOW_PATH_INVALID",
      `Managed deployment requires ${EAI_MANAGED_WORKFLOW_PATH}.`,
      "Remove --workflow or use the canonical path.",
    );
  }
  const timeoutSeconds = Number(options.timeout);
  if (
    !Number.isFinite(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > 7_200
  ) {
    fail(
      "DEPLOY_TIMEOUT_INVALID",
      "--timeout must be between 1 and 7200 seconds.",
      "Choose a bounded wait time and retry.",
    );
  }
  const targetTenantId = options.targetTenantId?.trim();
  if (!targetTenantId) {
    fail(
      "TARGET_TENANT_REQUIRED",
      "--target-tenant-id is required for every managed deployment, including same-tenant deployment.",
      "Pass the exact runtime tenant. For same-tenant deployment, repeat the --tenant-id value.",
    );
  }
  if (!isManagedScopeIdentifier(targetTenantId)) {
    fail(
      "TARGET_TENANT_INVALID",
      "--target-tenant-id must be a safe exact managed-deployment identifier.",
      "Use the exact runtime tenant ID without paths, query text, or delimiters.",
    );
  }
  return {
    appKey,
    targetTenantId,
    workflowPath,
    timeoutSeconds,
    resumeOperationId,
    retryOperationId,
  };
}
