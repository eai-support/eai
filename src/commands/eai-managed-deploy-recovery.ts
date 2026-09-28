import { loadManagedDeployState, managedDeployStatePath, type ManagedDeployState } from "../lib/eai-managed-deploy.js";
import { createPrivateFileNoFollow, readPrivateFileNoFollow } from "../lib/eai-managed-deploy-filesystem.js";
import { prepareManagedDeployStateDirectory } from "../lib/eai-managed-deploy-state.js";
import { requireManagedPublicApiUrl } from "../lib/managed-public-api.js";
import { fail, NEW_SOURCE_OPERATION_ACTION } from "./eai-managed-deploy-contract.js";

export interface ManagedRecoveryAuthority {
  schema: "eai.managed-recovery-authority.v1";
  operationId: string;
  tenantId: string;
  targetTenantId: string;
  appKey: string;
  publicApiUrl: string;
  actorId: string;
}

/** The first owner-only gateway/actor binding is immutable, including across repeated preparation. */
export async function saveManagedRecoveryAuthority(authority: ManagedRecoveryAuthority): Promise<void> {
  const fields = ["schema", "operationId", "tenantId", "targetTenantId", "appKey", "publicApiUrl", "actorId"] as const;
  if (authority.schema !== "eai.managed-recovery-authority.v1" || fields.some(field =>
    !Object.hasOwn(authority, field) || typeof authority[field] !== "string"
    || !authority[field].trim() || authority[field].length > 256)) {
    throw new Error("Managed deployment original recovery authority is incomplete or invalid.");
  }
  requireManagedPublicApiUrl(authority.publicApiUrl);
  const path = managedDeployStatePath(authority.operationId);
  await prepareManagedDeployStateDirectory();
  const retained = Object.fromEntries(fields.map(field => [field, authority[field]]));
  try {
    await createPrivateFileNoFollow(path, `${JSON.stringify(retained)}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const original: unknown = JSON.parse(await readPrivateFileNoFollow(path, 16 * 1024));
    if (!original || typeof original !== "object" || fields.some(field =>
      !Object.hasOwn(original, field) || (original as Record<string, unknown>)[field] !== authority[field])) {
      throw new Error("Managed deployment original recovery authority differs; it cannot be replaced.", { cause: error });
    }
  }
}

/** The original endpoint is read before authentication or source routing; an ID prefix is not authority. */
export async function loadManagedRetryAuthority(
  operationId: string, tenantId: string, targetTenantId: string, appKey: string,
): Promise<{ publicApiUrl: string; actorId?: string; state?: ManagedDeployState }> {
  let authority: ManagedRecoveryAuthority | ManagedDeployState;
  try {
    await prepareManagedDeployStateDirectory();
    authority = JSON.parse(await readPrivateFileNoFollow(managedDeployStatePath(operationId))) as ManagedRecoveryAuthority | ManagedDeployState;
  } catch {
    fail("RETRY_AUTHORITY_UNAVAILABLE", "Protected retry state with the original PublicAPI authority is unavailable.", NEW_SOURCE_OPERATION_ACTION);
  }
  if (authority.operationId !== operationId || authority.tenantId !== tenantId
    || authority.targetTenantId !== targetTenantId || authority.appKey !== appKey) {
    fail("RETRY_BINDING_MISMATCH", "Retry state does not match the requested tenant, target tenant, and app.", "Use the exact original tenant and app values.");
  }
  const publicApiUrl = requireManagedPublicApiUrl(authority.publicApiUrl);
  if (authority.schema === "eai.managed-recovery-authority.v1" && authority.actorId) {
    return { publicApiUrl, actorId: authority.actorId };
  }
  if (authority.schema === "eai.managed-deploy-state.v1") {
    const state = await loadManagedDeployState(operationId);
    if (state.tenantId !== tenantId || state.targetTenantId !== targetTenantId || state.appKey !== appKey
      || requireManagedPublicApiUrl(state.publicApiUrl) !== publicApiUrl) {
      fail("RETRY_BINDING_MISMATCH", "Retry authority changed during its bound read.", "Restore the original recovery authority before retrying.");
    }
    return { publicApiUrl, actorId: state.actorId, state };
  }
  fail("RETRY_AUTHORITY_UNAVAILABLE", "Protected retry authority has an invalid schema or actor.", NEW_SOURCE_OPERATION_ACTION);
}
