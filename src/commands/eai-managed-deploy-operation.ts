import chalk from "chalk";
import {
  PlatformAPIClient,
  type ManagedDeploymentOperationResponse,
} from "../lib/api.js";
import {
  assertManagedDeployStateMatchesOperation,
  classifyManagedOperationStatus,
  type ManagedDeployState,
} from "../lib/eai-managed-deploy.js";
import * as out from "../lib/output.js";
import {
  NEW_SOURCE_OPERATION_ACTION,
  fail,
  isRecord,
  requireApiSuccess,
} from "./eai-managed-deploy-contract.js";
import { managedDeployPollDelayMs } from "./eai-managed-deploy-github.js";

export async function prepareRuntime(
  client: PlatformAPIClient,
  state: ManagedDeployState,
): Promise<void> {
  const result = await requireApiSuccess(
    await client.bootstrapSourceUnknownRuntime(
      state.tenantId,
      state.appKey,
      state.environment,
      state.operationId,
      state.targetTenantId,
    ),
    "RUNTIME_BOOTSTRAP_FAILED",
    () =>
      `Repair runtime identity provisioning, then retry the exact operation ${state.operationId}; no workflow has been dispatched.`,
  );
  if (
    result.status !== "configured" ||
    result.sourceOperationId !== state.operationId ||
    result.tenantId !== state.tenantId ||
    result.targetTenantId !== state.targetTenantId ||
    result.appKey !== state.appKey ||
    result.environment !== state.environment
  ) {
    fail(
      "RUNTIME_BOOTSTRAP_BINDING_MISMATCH",
      "PublicAPI did not confirm configured runtime identity for the exact operation and target.",
      "Stop and inspect the PublicAPI runtime-bootstrap response before dispatching.",
    );
  }
}

export async function readExactOperation(
  client: PlatformAPIClient,
  tenantId: string,
  targetTenantId: string,
  appKey: string,
  operationId: string,
  expectedSourceMode: ManagedDeploymentOperationResponse["sourceMode"] = "source-unknown",
): Promise<ManagedDeploymentOperationResponse> {
  const response = await client.getManagedDeploymentOperation(
    tenantId,
    appKey,
    operationId,
    targetTenantId,
  );
  const payload = await requireApiSuccess(
    response,
    "SOURCE_OPERATION_READ_FAILED",
    () =>
      `Confirm ${operationId} belongs to tenant ${tenantId} and app ${appKey}, then retry with --resume.`,
  );
  if (
    payload.operationId !== operationId ||
    payload.appKey !== appKey ||
    payload.appScopeTenantId !== tenantId ||
    payload.sourceMode !== expectedSourceMode
  ) {
    fail(
      "SOURCE_OPERATION_BINDING_MISMATCH",
      "PublicAPI returned an operation with a different source, tenant, app, or operation ID.",
      "Stop and escalate with the PublicAPI request ID.",
    );
  }
  if (payload.targetTenantId !== targetTenantId) {
    fail(
      "SOURCE_OPERATION_TARGET_MISMATCH",
      `PublicAPI returned target tenant ${String(payload.targetTenantId || "<missing>")} instead of ${targetTenantId}.`,
      "Use the exact target tenant recorded by the source operation; do not retry against another tenant.",
    );
  }
  return payload as unknown as ManagedDeploymentOperationResponse;
}

export async function pollExactOperation(
  client: PlatformAPIClient,
  state: Pick<
    ManagedDeployState,
    "tenantId" | "targetTenantId" | "appKey" | "operationId"
  >,
  wait: boolean,
  timeoutSeconds: number,
  expectedSourceMode: ManagedDeploymentOperationResponse["sourceMode"] = "source-unknown",
): Promise<ManagedDeploymentOperationResponse> {
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
      expectedSourceMode,
    );
    if ("commitSha" in state) {
      try {
        assertManagedDeployStateMatchesOperation(
          state as ManagedDeployState,
          operation,
        );
      } catch (error) {
        fail(
          "SOURCE_OPERATION_SOURCE_MISMATCH",
          error instanceof Error ? error.message : String(error),
          "Stop and inspect the exact operation source binding; do not accept this runtime as the requested deployment.",
        );
      }
    }
    const classification = classifyManagedOperationStatus(operation);
    if (!wait || classification !== "pending") return operation;
    if (Date.now() >= deadline) {
      fail(
        "SOURCE_OPERATION_TIMEOUT",
        `Operation ${state.operationId} is still ${operation.status}.`,
        `Inspect the exact GitHub Actions run for commit ${"commitSha" in state ? String(state.commitSha) : "<stored commit>"}. Check OIDC, evidence callback, and TenantInfra logs, then resume ${state.operationId}.`,
      );
    }
    const pendingStatus = String(operation.status || "unknown").toLowerCase();
    pendingReadsAtStatus =
      pendingStatus === lastPendingStatus ? pendingReadsAtStatus + 1 : 1;
    lastPendingStatus = pendingStatus;
    const delayMs = managedDeployPollDelayMs(
      pendingReadsAtStatus,
      deadline - Date.now(),
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
  }
}

export function hasAcceptedWorkflowEvidence(
  operation: ManagedDeploymentOperationResponse,
): boolean {
  return (
    ["handoff_pending", "completed"].includes(operation.sourceStatus) ||
    operation.evidence?.status === "accepted" ||
    operation.setup?.status === "consumed"
  );
}

export function requiresNewSourceOperation(
  operation: ManagedDeploymentOperationResponse,
): boolean {
  const sourceStatus =
    typeof operation.sourceStatus === "string"
      ? operation.sourceStatus.trim().toLowerCase()
      : "";
  return (
    ["expired", "revoked"].includes(sourceStatus) &&
    !hasAcceptedWorkflowEvidence(operation)
  );
}

export function printOperation(
  format: string,
  operation: ManagedDeploymentOperationResponse,
  extra: Record<string, unknown> = {},
): void {
  const classification = classifyManagedOperationStatus(operation);
  const setup = isRecord(operation.setup) ? operation.setup : {};
  const repository = isRecord(setup.repo) ? setup.repo : {};
  const revision: Record<string, unknown> = isRecord(operation.sourceRevision)
    ? (operation.sourceRevision as unknown as Record<string, unknown>)
    : {};
  const targetTenantId = operation.targetTenantId;
  const revisionRepository =
    typeof revision.repoOwner === "string" &&
    typeof revision.repoName === "string"
      ? `${revision.repoOwner}/${revision.repoName}`
      : undefined;
  const sourceBinding = {
    repository:
      revisionRepository ??
      (typeof repository.owner === "string" &&
      typeof repository.name === "string"
        ? `${repository.owner}/${repository.name}`
        : extra.repo),
    workflowPath: revision.workflowPath ?? setup.workflowPath,
    ref: revision.branchRef ?? setup.ref ?? extra.ref,
    commitSha: revision.commitSha ?? setup.commitSha ?? extra.commitSha,
    configHash:
      revision.configHash ??
      operation.configHash ??
      setup.configHash ??
      extra.configHash,
    workflowRunId: revision.workflowRunId,
    artifactDigest: revision.artifactDigest,
    imageDigest: revision.imageDigest,
  };
  const sourceOption =
    operation.sourceMode === "eai-cli-generated" ? " --source eai-managed" : "";
  const exactCommand =
    `eai deploy app ${operation.appKey} --target eai --tenant-id ${operation.appScopeTenantId}` +
    ` --target-tenant-id ${targetTenantId || "<target-tenant-id>"}${sourceOption}`;
  const nextAction = requiresNewSourceOperation(operation)
    ? NEW_SOURCE_OPERATION_ACTION
    : classification === "succeeded"
      ? `Run \`eai deploy doctor --operation-id ${operation.operationId} --app-key ${operation.appKey} --tenant-id ${operation.appScopeTenantId} --target-tenant-id ${targetTenantId} --evidence-out .eai/deploy-doctor.json --format json\`.`
      : classification === "failed"
        ? `Inspect the exact operation and workflow evidence, then run \`${exactCommand} --retry ${operation.operationId} --wait --format json\`.`
        : `Resume with \`${exactCommand} --resume ${operation.operationId} --wait --format json\`; source ${operation.sourceStatus} and deployment ${operation.status} do not yet have complete exact evidence.`;
  const result = {
    tenantId: operation.appScopeTenantId,
    targetTenantId,
    appKey: operation.appKey,
    operationId: operation.operationId,
    source:
      operation.sourceMode === "eai-cli-generated"
        ? "eai-managed"
        : "customer-owned",
    sourceMode: operation.sourceMode,
    status: operation.status,
    sourceStatus: operation.sourceStatus,
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
  if (format === "json") {
    out.json(result);
    return;
  }
  const statusMessage = `EAI managed deployment is ${chalk.cyan(operation.status)}.`;
  if (classification === "succeeded") out.success(statusMessage);
  else if (classification === "failed") out.error(statusMessage);
  else out.warn(statusMessage);
  out.info(`Operation: ${operation.operationId}`);
  out.info(`Target tenant: ${targetTenantId || "<missing>"}`);
  if (typeof sourceBinding.repository === "string")
    out.info(
      `Source: ${sourceBinding.repository}@${String(sourceBinding.commitSha || "<missing>")}`,
    );
  if (typeof operation.activeUrl === "string")
    out.info(`URL: ${operation.activeUrl}`);
  out.info(nextAction);
}
