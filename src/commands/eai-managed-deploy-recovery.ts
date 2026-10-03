import { loadManagedDeployState, managedDeployStatePath, type ManagedDeployState } from "../lib/eai-managed-deploy.js";
import { createPrivateFileNoFollow, readPrivateFileNoFollow } from "../lib/eai-managed-deploy-filesystem.js";
import { prepareManagedDeployStateDirectory } from "../lib/eai-managed-deploy-state.js";
import { requireManagedPublicApiUrl } from "../lib/managed-public-api.js";
import { getActiveProfile } from "../lib/profile.js";
import { fail, NEW_SOURCE_OPERATION_ACTION } from "./eai-managed-deploy-contract.js";

/** SECURITY: retry credentials are pinned to the originating profile, actor, gateway and app scope. */
export interface ManagedRecoveryAuthority {
  schema: "eai.managed-recovery-authority.v1";
  operationId: string;
  tenantId: string;
  targetTenantId: string;
  appKey: string;
  publicApiUrl: string;
  actorId: string;
  profileName: string;
}

/** SECURITY: the first owner-only endpoint/actor/profile binding is immutable; legacy unbound retry files fail closed. */
export async function saveManagedRecoveryAuthority(authority: ManagedRecoveryAuthority): Promise<void> {
  const fields = ["schema", "operationId", "tenantId", "targetTenantId", "appKey", "publicApiUrl", "actorId", "profileName"] as const;
  if (authority.schema !== "eai.managed-recovery-authority.v1" || fields.some(field =>
    !Object.hasOwn(authority, field) || typeof authority[field] !== "string"
    || !authority[field].trim() || authority[field].length > 256)) {
    throw new Error("Managed deployment original recovery authority is incomplete or invalid.");
  }
  requireManagedPublicApiUrl(authority.publicApiUrl);
  const path = managedDeployStatePath(authority.operationId);
  await prepareManagedDeployStateDirectory();
  if (authority.profileName !== getActiveProfile()) {
    throw new Error("Managed deployment original recovery authority belongs to a different EAI profile.");
  }
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
  allowMissingCliSource = false,
): Promise<{ publicApiUrl: string; actorId?: string; state?: ManagedDeployState } | undefined> {
  let authority: ManagedRecoveryAuthority | ManagedDeployState;
  try {
    await prepareManagedDeployStateDirectory();
    authority = JSON.parse(await readPrivateFileNoFollow(managedDeployStatePath(operationId))) as ManagedRecoveryAuthority | ManagedDeployState;
  } catch (error) {
    if (allowMissingCliSource && operationId.startsWith("cli-managed-")
      && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    fail("RETRY_AUTHORITY_UNAVAILABLE", "Protected retry state with the original PublicAPI authority is unavailable.", NEW_SOURCE_OPERATION_ACTION);
  }
  if (authority.operationId !== operationId || authority.tenantId !== tenantId
    || authority.targetTenantId !== targetTenantId || authority.appKey !== appKey) {
    fail("RETRY_BINDING_MISMATCH", "Retry state does not match the requested tenant, target tenant, and app.", "Use the exact original tenant and app values.");
  }
  if (!Object.hasOwn(authority, "profileName") || typeof authority.profileName !== "string"
    || !authority.profileName.trim() || authority.profileName.length > 256
    || authority.profileName !== getActiveProfile()) {
    fail("RETRY_PROFILE_BINDING_MISMATCH", "Protected retry authority does not match the original EAI profile.", "Select the original EAI profile; unbound legacy state requires a new source operation.");
  }
  const publicApiUrl = requireManagedPublicApiUrl(authority.publicApiUrl);
  if (authority.schema === "eai.managed-recovery-authority.v1" && authority.actorId) {
    return { publicApiUrl, actorId: authority.actorId };
  }
  if (authority.schema === "eai.managed-deploy-state.v1") {
    const state = await loadManagedDeployState(operationId);
    if (state.tenantId !== tenantId || state.targetTenantId !== targetTenantId || state.appKey !== appKey
      || state.profileName !== authority.profileName
      || requireManagedPublicApiUrl(state.publicApiUrl) !== publicApiUrl) {
      fail("RETRY_BINDING_MISMATCH", "Retry authority changed during its bound read.", "Restore the original recovery authority before retrying.");
    }
    return { publicApiUrl, actorId: state.actorId, state };
  }
  fail("RETRY_AUTHORITY_UNAVAILABLE", "Protected retry authority has an invalid schema or actor.", NEW_SOURCE_OPERATION_ACTION);
}
