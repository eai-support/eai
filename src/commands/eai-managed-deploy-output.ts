import { PlatformAPIClient } from "../lib/api.js";
import { classifyManagedOperationStatus } from "../lib/eai-managed-deploy.js";
import { ManagedSourceError } from "../lib/eai-managed-source.js";
import {
  classifyCliManagedSourceOperation,
  type CliManagedSourceOperation,
  type CliManagedSourceScope,
} from "../lib/eai-managed-source-client.js";
import * as out from "../lib/output.js";
import {
  ManagedDeployFailure,
  fail,
  isRecord,
} from "./eai-managed-deploy-contract.js";
import {
  pollExactOperation,
  printOperation,
} from "./eai-managed-deploy-operation.js";

export function printFailure(format: string, error: unknown): void {
  const failure =
    error instanceof ManagedDeployFailure
      ? error
      : new ManagedDeployFailure(
          error instanceof ManagedSourceError
            ? error.code
            : "EAI_MANAGED_DEPLOY_FAILED",
          error instanceof Error ? error.message : String(error),
          error instanceof ManagedSourceError
            ? error.message
            : "Fix the reported problem, then retry the same exact command.",
        );
  if (format === "json") {
    out.json({
      ok: false,
      error: {
        code: failure.code,
        message: failure.message,
        nextAction: failure.nextAction,
      },
    });
  } else {
    out.error(`${failure.code}: ${failure.message}`);
    out.info(failure.nextAction);
  }
  process.exitCode = 1;
}

export function printManagedSourceOperation(
  format: string,
  operation: CliManagedSourceOperation,
): void {
  const classification = classifyCliManagedSourceOperation(operation);
  const command = `eai deploy app ${operation.appKey} --target eai --tenant-id ${operation.tenantId} --target-tenant-id ${operation.targetTenantId} --environment ${operation.environment} --source eai-managed --resume ${operation.operationId} --format json`;
  const nextAction =
    operation.status === "pending_review"
      ? `EAI must complete the bot PR checks and merge before deployment. Resume the exact operation with: ${command}`
      : classification === "failed" || classification === "incomplete"
        ? `Ask EAI to repair the reported publication or missing deployment evidence. Read its exact status with: ${command}`
        : `Continue observing the exact platform operation with: ${command}`;
  const result = {
    tenantId: operation.tenantId,
    targetTenantId: operation.targetTenantId,
    appKey: operation.appKey,
    operationId: operation.operationId,
    source: "eai-managed",
    sourceMode: operation.sourceMode,
    status: operation.status,
    publicationStatus: operation.status,
    classification,
    templateCommitSha: operation.templateCommitSha,
    bundleSha256: operation.bundleSha256,
    configHash: operation.configHash,
    sourceBinding: {
      repository: `${operation.repository.owner}/${operation.repository.name}`,
      commitSha: operation.review?.mergedSha,
    },
    review: operation.review,
    deploymentId: operation.deployment?.requestId,
    activeUrl: operation.deployment?.liveUrl,
    runtimeIdentity: operation.deployment?.runtimeIdentity,
    requiresTenantInfra: operation.deployment?.requiresTenantInfra,
    latestPointerVersion: operation.deployment?.latestPointerVersion,
    expectedLatestVersion: operation.deployment?.expectedLatestVersion,
    nextAction,
  };
  if (format === "json") out.json(result);
  else {
    out.info(
      `EAI-maintained publication ${operation.operationId}: ${result.status}`,
    );
    if (result.activeUrl) out.info(`URL: ${result.activeUrl}`);
    out.info(nextAction);
  }
  if (classification === "failed" || classification === "incomplete")
    process.exitCode = 1;
}

export async function printManagedSourceCompletion(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  publication: CliManagedSourceOperation,
  wait: boolean,
  timeoutSeconds: number,
  format: string,
): Promise<void> {
  if (publication.status !== "completed") {
    printManagedSourceOperation(format, publication);
    return;
  }
  const operation = await pollExactOperation(
    client,
    {
      tenantId: scope.tenantId,
      targetTenantId: scope.targetTenantId,
      appKey: scope.appKey,
      operationId: publication.operationId,
    },
    wait,
    timeoutSeconds,
    "eai-cli-generated",
  );
  const revision = isRecord(operation.sourceRevision)
    ? operation.sourceRevision
    : undefined;
  const mergedSha = publication.review?.mergedSha;
  if (
    operation.environment !== publication.environment ||
    operation.configHash !== publication.configHash ||
    (revision &&
      (revision.repoOwner !== publication.repository.owner ||
        revision.repoName !== publication.repository.name ||
        (typeof mergedSha === "string" && revision.commitSha !== mergedSha)))
  ) {
    fail(
      "MANAGED_SOURCE_BINDING_MISMATCH",
      "Unified deployment evidence does not match the exact EAI-maintained publication.",
      `Stop and inspect publication ${publication.operationId}; do not accept another source, environment, repository, commit, or configuration.`,
    );
  }
  printOperation(format, operation, {
    source: "eai-managed",
    publicationStatus: publication.status,
    templateCommitSha: publication.templateCommitSha,
    bundleSha256: publication.bundleSha256,
  });
  if (classifyManagedOperationStatus(operation) === "failed")
    process.exitCode = 1;
}
