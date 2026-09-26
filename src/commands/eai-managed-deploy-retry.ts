import {
  assertManagedDeployStateMatchesOperation,
  classifyManagedOperationStatus,
  loadManagedDeployState,
  type ManagedDeployState,
} from "../lib/eai-managed-deploy.js";
import { PlatformAPIClient } from "../lib/api.js";
import {
  MANAGED_DEPLOY_ENVIRONMENTS,
  NEW_SOURCE_OPERATION_ACTION,
  fail,
  requireApiSuccess,
  type ManagedDeployExecutionContext,
} from "./eai-managed-deploy-contract.js";
import {
  dispatchWorkflow,
  verifyLocalSource,
} from "./eai-managed-deploy-github.js";
import {
  hasAcceptedWorkflowEvidence,
  pollExactOperation,
  prepareRuntime,
  printOperation,
  readExactOperation,
  requiresNewSourceOperation,
} from "./eai-managed-deploy-operation.js";

export async function loadCustomerRetryAuthority(
  operationId: string,
  tenantId: string,
  targetTenantId: string,
  appKey: string,
): Promise<ManagedDeployState> {
  let state: ManagedDeployState;
  try {
    state = await loadManagedDeployState(operationId);
  } catch {
    fail(
      "RETRY_AUTHORITY_UNAVAILABLE",
      "Protected retry state with the original PublicAPI authority is unavailable.",
      NEW_SOURCE_OPERATION_ACTION,
    );
  }
  if (
    state.tenantId !== tenantId ||
    state.targetTenantId !== targetTenantId ||
    state.appKey !== appKey
  ) {
    fail(
      "RETRY_BINDING_MISMATCH",
      "Retry state does not match the requested tenant, target tenant, and app.",
      "Use the exact original tenant and app values.",
    );
  }
  return state;
}

export async function resumeCustomerSource(
  execution: ManagedDeployExecutionContext,
  operationId: string,
): Promise<void> {
  const {
    client,
    context,
    targetTenantId,
    appKey,
    options,
    timeoutSeconds,
    spinner,
    format,
  } = execution;
  const operation = await pollExactOperation(
    client,
    {
      tenantId: context.tenantId,
      targetTenantId,
      appKey,
      operationId,
    },
    options.wait,
    timeoutSeconds,
  );
  spinner?.stop();
  printOperation(format, operation);
  if (classifyManagedOperationStatus(operation) === "failed")
    process.exitCode = 1;
}

export async function retryCustomerSource(
  execution: ManagedDeployExecutionContext,
  operationId: string,
): Promise<void> {
  const {
    context,
    targetTenantId,
    appKey,
    options,
    timeoutSeconds,
    spinner,
    format,
  } = execution;
  const state = execution.retryState ?? await loadCustomerRetryAuthority(
    operationId,
    context.tenantId,
    targetTenantId,
    appKey,
  );
  if (
    !state.actorId ||
    !state.githubLinkSessionId ||
    !state.githubUserId ||
    !state.githubLogin ||
    !state.githubProofId
  ) {
    fail(
      "RETRY_ACTOR_BINDING_MISSING",
      "Retry state predates the required EAI and GitHub actor proof.",
      NEW_SOURCE_OPERATION_ACTION,
    );
  }
  if (state.actorId !== context.tokens.oid) {
    fail(
      "RETRY_ACTOR_MISMATCH",
      "The signed-in EAI actor does not own this retry authority.",
      "Sign in as the original EAI actor, then retry the exact operation.",
    );
  }
  const retryClient = new PlatformAPIClient(state.publicApiUrl, state.tenantId);
  const current = await readExactOperation(
    retryClient,
    context.tenantId,
    targetTenantId,
    appKey,
    operationId,
  );
  if (classifyManagedOperationStatus(current) === "succeeded") {
    spinner?.stop();
    printOperation(format, current);
    return;
  }
  if (hasAcceptedWorkflowEvidence(current)) {
    const environment =
      typeof current.environment === "string" ? current.environment : "";
    if (!MANAGED_DEPLOY_ENVIRONMENTS.has(environment)) {
      fail(
        "SOURCE_OPERATION_ENVIRONMENT_INVALID",
        `Source operation ${operationId} has no supported environment binding.`,
        "Do not retry this operation. Start a new EAI managed deployment so the server can issue an environment-bound source operation.",
      );
    }
    await requireApiSuccess(
      await retryClient.requestSourceUnknownDeployment(context.tenantId, appKey, {
        operationId,
        targetTenantId,
        environment,
      }),
      "DEPLOYMENT_HANDOFF_FAILED",
      () =>
        `Repair the reported runtime or TenantInfra problem, then retry ${operationId}; accepted build evidence will be reused.`,
    );
    const operation = await pollExactOperation(
      retryClient,
      { tenantId: context.tenantId, targetTenantId, appKey, operationId },
      options.wait,
      timeoutSeconds,
    );
    spinner?.stop();
    printOperation(format, operation);
    if (classifyManagedOperationStatus(operation) === "failed")
      process.exitCode = 1;
    return;
  }
  if (requiresNewSourceOperation(current)) {
    fail(
      "SOURCE_OPERATION_INACTIVE",
      `Source operation ${current.operationId} is ${current.sourceStatus} and cannot dispatch a workflow.`,
      NEW_SOURCE_OPERATION_ACTION,
    );
  }
  try {
    assertManagedDeployStateMatchesOperation(state, current);
  } catch (error) {
    fail(
      "RETRY_SERVER_BINDING_MISMATCH",
      error instanceof Error ? error.message : String(error),
      "Do not edit retry state. Resume the exact server operation, or start a new deployment from the intended immutable commit.",
    );
  }
  if (!MANAGED_DEPLOY_ENVIRONMENTS.has(state.environment)) {
    fail(
      "SOURCE_OPERATION_ENVIRONMENT_INVALID",
      "The stored operation has an unsupported environment.",
      NEW_SOURCE_OPERATION_ACTION,
    );
  }
  const wasDispatched = Boolean(state.dispatchedAt);
  if (!wasDispatched) {
    const source = await verifyLocalSource(
      context.root,
      state.repo,
      state.branch,
      state.commitSha,
    );
    if (source.commitSha !== state.commitSha) {
      fail(
        "RETRY_SHA_CHANGED",
        "The current commit differs from the stored operation commit.",
        `Check out ${state.commitSha}, then retry the same operation.`,
      );
    }
    await prepareRuntime(retryClient, state);
    await dispatchWorkflow(state, state.publicApiUrl, context.root);
  }
  const operation = await pollExactOperation(
    retryClient,
    state,
    options.wait,
    timeoutSeconds,
  );
  spinner?.stop();
  printOperation(
    format,
    operation,
    wasDispatched
      ? {}
      : {
          repo: state.repo,
          ref: state.ref,
          commitSha: state.commitSha,
          configHash: state.configHash,
        },
  );
  if (classifyManagedOperationStatus(operation) === "failed")
    process.exitCode = 1;
}
