import {
  EAI_MANAGED_WORKFLOW_PATH,
  requireWorkflowPath,
} from "../lib/eai-managed-deploy.js";
import {
  MANAGED_DEPLOY_ENVIRONMENTS,
  fail,
  type ManagedDeployOptions,
} from "./eai-managed-deploy-contract.js";

export interface ValidatedManagedDeployInput {
  appKey: string;
  targetTenantId: string;
  workflowPath: string;
  timeoutSeconds: number;
}

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
  if (options.resume && options.retry) {
    fail(
      "DEPLOY_MODE_CONFLICT",
      "--resume and --retry cannot be used together.",
      "Choose one exact operation action.",
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
  const appKey = appKeyValue.trim();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(appKey)) {
    fail(
      "APP_KEY_INVALID",
      "App key must use lowercase letters, numbers, and hyphens.",
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
  return { appKey, targetTenantId, workflowPath, timeoutSeconds };
}
