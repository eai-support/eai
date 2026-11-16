import type { PlatformAPIClient } from './api.js';
import { formatSafePlatformFailure, safePlatformDiagnostics } from './platform-diagnostics.js';
import { isManagedScopeIdentifier } from './eai-managed-identifiers.js';
import { isRecord } from './utils.js';

export interface AppBinding {
  enrollmentId: string;
  enrollmentOwnerTenantId: string;
  runtimeTenantId: string;
  appKey: string;
  bindingStatus: 'resolved' | 'ambiguous';
  capabilities: Record<'read' | 'configure' | 'readiness' | 'source' | 'deploy' | 'delete' | 'manageObjectTypes', boolean>;
  [key: string]: unknown;
}

const CAPABILITIES = ['read', 'configure', 'readiness', 'source', 'deploy', 'delete', 'manageObjectTypes'] as const;

export function isAppBinding(value: unknown, runtimeTenantId: string): value is AppBinding {
  const capabilities = isRecord(value) && isRecord(value.capabilities) ? value.capabilities : {};
  return isRecord(value) && value.runtimeTenantId === runtimeTenantId
    && isManagedScopeIdentifier(value.enrollmentId) && isManagedScopeIdentifier(value.enrollmentOwnerTenantId)
    && isManagedScopeIdentifier(value.appKey) && (value.bindingStatus === 'resolved' || value.bindingStatus === 'ambiguous')
    && [value.version, value.bindingVersion].every(version => version === null || (Number.isSafeInteger(version) && Number(version) > 0))
    && isRecord(value.capabilities) && CAPABILITIES.every(name => typeof capabilities[name] === 'boolean');
}

/** The server resolves authorized lineage; the CLI never reads ancestor enrollment collections. */
export async function resolveAppBinding(
  client: PlatformAPIClient, appKey: string, runtimeTenantId: string, ownerPin?: string,
): Promise<AppBinding> {
  if (![appKey, runtimeTenantId, ...(ownerPin === undefined ? [] : [ownerPin])].every(isManagedScopeIdentifier)) {
    throw new Error('App binding requires exact app, runtime, and enrollment owner identifiers.');
  }
  const response = await client.getAppBinding(appKey, ownerPin);
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = undefined; }
  if (!response.ok) throw new Error(formatSafePlatformFailure('App binding', safePlatformDiagnostics(response.status, payload, response.headers)));
  if (!isAppBinding(payload, runtimeTenantId) || payload.appKey !== appKey || payload.bindingStatus !== 'resolved'
    || payload.capabilities.read !== true || (ownerPin !== undefined && payload.enrollmentOwnerTenantId !== ownerPin)) {
    throw new Error('App binding did not match the exact selected runtime, app, and enrollment owner. No app resources were changed.');
  }
  return payload;
}
