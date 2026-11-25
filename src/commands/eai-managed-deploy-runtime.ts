import type {
  ManagedDeploymentOperationResponse,
  PlatformAPIClient,
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
      `Repair runtime identity provisioning, then run --retry ${state.operationId}; the accepted build is kept and no new workflow is needed.`,
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
