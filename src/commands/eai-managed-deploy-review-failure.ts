import { cliManagedSourceMovePortalOrigin } from "../lib/eai-managed-source-link-client.js";
import type { CliManagedSourceScope } from "../lib/eai-managed-source-client-types.js";
import {
  recoverFailedCliManagedReview,
  type ManagedReviewFailureResult,
} from "../lib/eai-managed-source-review-failure-client.js";
import * as out from "../lib/output.js";
import {
  MANAGED_DEPLOY_ENVIRONMENTS,
  fail,
  type ManagedDeployExecutionContext,
} from "./eai-managed-deploy-contract.js";
import { readUnifiedExactOperation } from "./eai-managed-deploy-operation.js";

function publishAgainCommand(execution: ManagedDeployExecutionContext): string {
  const { appKey, targetTenantId, managedScope } = execution;
  return (
    `eai deploy app ${appKey} --target eai --tenant-id ${managedScope.tenantId} ` +
    `--target-tenant-id ${targetTenantId} --environment ${managedScope.environment} --source eai-managed`
  );
}

function printRecovery(
  execution: ManagedDeployExecutionContext,
  result: ManagedReviewFailureResult,
): void {
  const nextAction = `Fix the failing checks in your app, then publish again: ${publishAgainCommand(execution)}`;
  if (execution.format === "json") {
    out.json({
      ok: true,
      operationId: result.operationId,
      status: result.status,
      error: { code: "managed_review_checks_failed", failedChecks: result.failedChecks },
      nextAction,
    });
    return;
  }
  out.success(`EAI review for ${result.operationId} was closed because its required checks failed.`);
  for (const check of result.failedChecks) out.info(`${check.name}: ${check.conclusion} - ${check.htmlUrl}`);
  out.info(nextAction);
}

/** The Portal re-verifies the actor and GitHub; the CLI only selects the exact sealed operation. */
export async function recoverFailedManagedReview(
  execution: ManagedDeployExecutionContext,
  operationId: string,
  explicitEnvironment?: string,
): Promise<void> {
  const { client, context, managedScope, appKey, targetTenantId, spinner } = execution;
  const operation = await readUnifiedExactOperation(
    client, context.tenantId, targetTenantId, appKey, operationId,
  );
  if (operation.sourceMode !== "eai-cli-generated") {
    fail(
      "RECOVERY_SOURCE_MISMATCH",
      "Only EAI-maintained source reviews can be recovered this way.",
      "Fix the customer repository review in GitHub, then use --resume or --retry for its operation.",
    );
  }
  if (!MANAGED_DEPLOY_ENVIRONMENTS.has(operation.environment)) {
    fail(
      "SOURCE_OPERATION_ENVIRONMENT_INVALID",
      "The operation has no supported environment binding.",
      "Contact EAI support with the operation ID.",
    );
  }
  if (explicitEnvironment !== undefined && explicitEnvironment !== operation.environment) {
    fail(
      "RECOVERY_ENVIRONMENT_MISMATCH",
      "The requested environment conflicts with the sealed operation.",
      "Omit --environment or use the original operation's environment.",
    );
  }
  const scope: CliManagedSourceScope = {
    ...managedScope,
    environment: operation.environment as CliManagedSourceScope["environment"],
  };
  execution.managedScope = scope;
  spinner?.start("Checking the failed EAI review...");
  const result = await recoverFailedCliManagedReview(
    client,
    scope,
    operationId,
    cliManagedSourceMovePortalOrigin(context.publicApiUrl),
  );
  spinner?.stop();
  printRecovery(execution, result);
}
