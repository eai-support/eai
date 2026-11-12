import { PlatformAPIClient } from './api.js';
import { loadEnvFile } from './config.js';
import { isRecord } from './utils.js';

export const PROVISION_REQUIRED_FOR_TYPES = 'EAI_PROVISION_REQUIRED_FOR_TYPES';

export interface TypeSeedBinding {
  appKey: string;
  ownerTenantId: string;
  runtimeTenantId: string;
  appBound: boolean;
}

/** Project metadata supplies a binding hint; the regional platform corroborates it before writes. */
export async function resolveTypeSeedBinding(root: string, tenantKey: string, runtimeTenantId: string, explicitOwner?: string): Promise<TypeSeedBinding> {
  const env = await loadEnvFile(root);
  const appKey = env.EAI_APP_KEY || env.NEXT_PUBLIC_EAI_APP_KEY || tenantKey;
  const projectRuntime = env.EAI_TENANT_ID || env.NEXT_PUBLIC_EAI_TENANT_ID;
  const projectOwner = !projectRuntime || projectRuntime === runtimeTenantId ? env.EAI_PARENT_TENANT_ID : undefined;
  const ownerTenantId = explicitOwner || projectOwner || runtimeTenantId;
  if (![appKey, ownerTenantId, runtimeTenantId].every(value => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))) {
    throw new Error('App publication requires exact app and workspace identifiers.');
  }
  return { appKey, ownerTenantId, runtimeTenantId, appBound: Boolean(env.EAI_APP_KEY || env.NEXT_PUBLIC_EAI_APP_KEY || explicitOwner || projectOwner) };
}

export function typeSeedProvisionCommand(binding: TypeSeedBinding): string {
  return `eai app provision ${binding.appKey} --tenant-id ${binding.runtimeTenantId}${binding.ownerTenantId === binding.runtimeTenantId ? '' : ` --app-tenant-id ${binding.ownerTenantId}`} --select --format json`;
}

export class TypeSeedPreflightError extends Error {
  readonly code = PROVISION_REQUIRED_FOR_TYPES;
  constructor(readonly binding: TypeSeedBinding, reason: string) {
    super(`${PROVISION_REQUIRED_FOR_TYPES}: ${reason}\nRun ${typeSeedProvisionCommand(binding)}`);
    this.name = 'TypeSeedPreflightError';
  }
}

/** Read-only prerequisite check; never save/publish a manifest or provision storage here. */
export async function checkTypeSeedPreflight(client: PlatformAPIClient, binding: TypeSeedBinding): Promise<void> {
  const response = await client.getBoundAppProvisioningJobs(binding.appKey, binding.runtimeTenantId);
  if (response.status === 404 || response.status === 409) {
    throw new TypeSeedPreflightError(binding, 'App enrollment or provisioned resources are missing for this workspace.');
  }
  if (!response.ok) throw new Error(`App publication preflight failed (HTTP ${response.status}); no Object Types were written.`);
  const payload: unknown = await response.json();
  const enrollment = isRecord(payload) && isRecord(payload.enrollment) ? payload.enrollment : undefined;
  const metadata = enrollment && isRecord(enrollment.metadata) ? enrollment.metadata : {};
  const children = [enrollment?.childTenantId, metadata.childTenantId].filter(value => value !== undefined && value !== null);
  if (!isRecord(payload) || payload.tenantId !== binding.ownerTenantId || payload.appKey !== binding.appKey
    || !enrollment || (enrollment.tenantId !== undefined && enrollment.tenantId !== binding.ownerTenantId)
    || (enrollment.verticalKey !== undefined && enrollment.verticalKey !== binding.appKey)
    || children.some(value => value !== binding.runtimeTenantId)
    || (binding.ownerTenantId !== binding.runtimeTenantId && children.length === 0)) {
    throw new Error('App publication preflight did not match the exact owner, app, and runtime workspace; no Object Types were written.');
  }
  const readiness = isRecord(enrollment.readiness) ? enrollment.readiness : {};
  const provisioning = isRecord(metadata.appProvisioning) ? metadata.appProvisioning : {};
  if (enrollment.provisioningState !== 'ready' && readiness.ready !== true && readiness.status !== 'ready' && provisioning.status !== 'ready') {
    throw new TypeSeedPreflightError(binding, 'App resources must be provisioned before publishing Object Types.');
  }
}
