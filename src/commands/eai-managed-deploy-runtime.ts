import {
  isManagedPublicRequestTimeout,
  type ManagedDeploymentOperationResponse,
  type PlatformAPIClient,
} from "../lib/api.js";
import type { ManagedDeployState } from "../lib/eai-managed-deploy.js";
import { fail, requireApiSuccess } from "./eai-managed-deploy-contract.js";
import {
  isHeldForRuntime,
  pollExactOperation,
} from "./eai-managed-deploy-operation.js";

export async function prepareRuntime(
  client: PlatformAPIClient,
  state: ManagedDeployState,
): Promise<void> {
  let result: Record<string, unknown>;
  try {
    result = await requireApiSuccess(
      await client.bootstrapSourceUnknownRuntime(
        state.tenantId,
        state.appKey,
        state.environment,
        state.operationId,
        state.targetTenantId,
      ),
      "RUNTIME_BOOTSTRAP_FAILED",
      () =>
        `Repair runtime identity provisioning, then run --retry ${state.operationId}; the accepted build is kept and no new workflow is needed.`,
    );
  } catch (error) {
    if (!isManagedPublicRequestTimeout(error)) throw error;
    // The service keeps working after the client gives up, and a retry reuses what it finished.
    fail(
      "RUNTIME_BOOTSTRAP_TIMEOUT",
      "Runtime identity setup did not answer in time.",
      `Run --retry ${state.operationId} --wait; the accepted build is kept and the setup already started is reused.`,
    );
  }
  // PublicAPI names the runtime tenant `tenantId`; it sends no separate target field.
  if (
    result.status !== "configured" ||
    result.sourceOperationId !== state.operationId ||
    result.tenantId !== state.targetTenantId ||
    (result.targetTenantId !== undefined &&
      result.targetTenantId !== state.targetTenantId) ||
    result.appKey !== state.appKey ||
    result.environment !== state.environment
  ) {
    fail(
      "RUNTIME_BOOTSTRAP_BINDING_MISMATCH",
      "PublicAPI did not confirm configured runtime identity for the exact operation and target.",
      "Stop and inspect the PublicAPI runtime-bootstrap response; the deployment stays held until its runtime identity is confirmed.",
    );
  }
}

/**
 * The service refuses a runtime identity until build evidence is accepted, so it is set up
 * while following the dispatched operation, once the deployment is held for it.
 */
export async function pollCustomerSourceOperation(
  client: PlatformAPIClient,
  state: ManagedDeployState,
  wait: boolean,
  timeoutSeconds: number,
  confirmWriteAuthority?: () => Promise<void>,
): Promise<ManagedDeploymentOperationResponse> {
  let runtimePrepared = false;
  return pollExactOperation(
    client,
    state,
    wait,
    timeoutSeconds,
    "source-unknown",
    async (pending) => {
      if (!runtimePrepared && isHeldForRuntime(pending)) {
        await confirmWriteAuthority?.();
        await prepareRuntime(client, state);
        runtimePrepared = true;
      }
      return true;
    },
  );
}
