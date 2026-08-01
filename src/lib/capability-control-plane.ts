import {
  PlatformAPIClient,
  PlatformAPIRequestError,
  type PlatformMethod,
} from './api.js';
import { isRecord } from './utils.js';

/** Determines whether setup is shared, runtime-only, or governed in Admin Portal. */
export type CapabilitySetupMode =
  | 'portal_only'
  | 'portal_setup_cli_consume'
  | 'shared_setup'
  | 'runtime_only';

/** CLI-safe logical asset kinds; wire requests map these to backing Object Types. */
export type CapabilityAssetKind = 'integration' | 'ai-profile' | 'prompt' | 'workflow';

/** Read-only content domains backed by tenant Advanced Settings records. */
export type CapabilityContentDomain =
  | 'document-templates'
  | 'email-templates'
  | 'knowledge-articles'
  | 'policies'
  | 'document-types'
  | 'document-checklists'
  | 'requirement-groups';

/** Normalized PublicAPI capability definition used by discovery and setup guidance. */
export interface CapabilityDefinition extends Record<string, unknown> {
  key: string;
  displayName?: string;
  setupMode?: CapabilitySetupMode;
  portalRoute?: string;
  cliOperations?: string[];
}

/** The four readiness states stay independent so diagnostics do not hide blockers. */
export interface TenantCapabilityConnection extends Record<string, unknown> {
  capabilityKey: string;
  entitled: boolean;
  configured: boolean;
  bound: boolean;
  runtimeReady: boolean;
}

/** Stores logical aliases and natural keys only; tenant record IDs are not accepted. */
export interface AppCapabilityBindingRequest {
  bindingKey: string;
  capabilityKey: string;
  assetKind: CapabilityAssetKind;
  assetKey: string;
  environment?: string;
}

/** Natural-key binding request for Portal-managed shared content. */
export interface ContentCapabilityBindingRequest {
  bindingKey: string;
  capabilityKey: string;
  assetType: string;
  assetKey: string;
  environment?: string;
}

/** Canonical source-controlled manifest accepted by PublicAPI validation. */
export interface AppCapabilityRequirements {
  schemaVersion: 'eai.app_capabilities.v1';
  appKey: string;
  requirements: Array<{
    alias: string;
    capability: string;
    required: boolean;
    description: string;
    compatibleProviders?: string[];
    compatibleAssetTypes?: string[];
  }>;
}

/** Reports whether typed provisioning created or version-updated a tenant asset. */
export interface CapabilityAssetUpsertResult {
  action: 'created' | 'updated';
  item: unknown;
}

/** Minimal PublicAPI transport contract used for deterministic client tests. */
export interface CapabilityControlPlaneTransport {
  requestPublicApi(
    path: string,
    options?: { method?: PlatformMethod; body?: unknown; params?: Record<string, unknown> },
  ): Promise<Response>;
}

const SENSITIVE_FIELD = /(?:api[-_]?key|secret|password|credential|connection[-_]?string|(?:access|refresh|oauth|bearer|id)[-_]?token|token$)/i;
const SAFE_REFERENCE_FIELD = /(?:ref|reference|name)$/i;

function isSensitiveField(key: string): boolean {
  return SENSITIVE_FIELD.test(key);
}

function isSafeReferenceField(key: string): boolean {
  return isSensitiveField(key) && SAFE_REFERENCE_FIELD.test(key);
}

function segment(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return encodeURIComponent(normalized);
}

function requiredValue(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function readServerDetail(payload: unknown): { message?: string; code?: string } {
  if (!isRecord(payload)) return {};
  if (typeof payload.detail === 'string') return { message: payload.detail };
  if (isRecord(payload.detail)) {
    return {
      message: typeof payload.detail.message === 'string' ? payload.detail.message : undefined,
      code: typeof payload.detail.code === 'string' ? payload.detail.code : undefined,
    };
  }
  return {
    message: typeof payload.message === 'string' ? payload.message : undefined,
    code: typeof payload.code === 'string' ? payload.code : undefined,
  };
}

async function readJson(response: Response, operation: string): Promise<unknown> {
  const rawBody = await response.text();
  let payload: unknown = {};
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = { message: rawBody };
    }
  }

  if (!response.ok) {
    const detail = readServerDetail(payload);
    throw new PlatformAPIRequestError({
      operation,
      status: response.status,
      statusText: response.statusText,
      serverMessage: detail.message,
      serverCode: detail.code,
      requestId: response.headers.get('x-request-id') ?? undefined,
      rawBody,
    });
  }
  return payload;
}

function unwrapItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const field of ['items', 'connections', 'definitions', 'profiles', 'prompts', 'workflows', 'integrations', 'bindings']) {
    if (Array.isArray(payload[field])) return payload[field];
  }
  return [];
}

function readBoolean(record: Record<string, unknown>, camel: string, snake: string): boolean {
  return record[camel] === true || record[snake] === true;
}

function normalizeDefinition(value: unknown): CapabilityDefinition | null {
  if (!isRecord(value)) return null;
  const key = value.key ?? value.capabilityKey ?? value.capability_key;
  if (typeof key !== 'string' || !key.trim()) return null;
  return {
    ...value,
    key,
    displayName: typeof value.displayName === 'string'
      ? value.displayName
      : typeof value.display_name === 'string' ? value.display_name : undefined,
    setupMode: typeof value.setupMode === 'string'
      ? value.setupMode as CapabilitySetupMode
      : typeof value.setup_mode === 'string' ? value.setup_mode as CapabilitySetupMode : undefined,
    portalRoute: typeof value.portalRoute === 'string'
      ? value.portalRoute
      : typeof value.portal_route === 'string' ? value.portal_route : undefined,
    cliOperations: Array.isArray(value.cliOperations)
      ? value.cliOperations.filter((item): item is string => typeof item === 'string')
      : Array.isArray(value.cli_operations)
        ? value.cli_operations.filter((item): item is string => typeof item === 'string')
        : undefined,
  };
}

function normalizeConnection(value: unknown): TenantCapabilityConnection | null {
  if (!isRecord(value)) return null;
  const key = value.capabilityKey ?? value.capability_key ?? value.key;
  if (typeof key !== 'string' || !key.trim()) return null;
  return {
    ...value,
    capabilityKey: key,
    entitled: readBoolean(value, 'entitled', 'entitled'),
    configured: readBoolean(value, 'configured', 'configured'),
    bound: readBoolean(value, 'bound', 'bound'),
    runtimeReady: readBoolean(value, 'runtimeReady', 'runtime_ready'),
  };
}

/**
 * Remove credential-shaped fields from CLI output even if an upstream service
 * accidentally violates the control-plane redaction contract.
 */
export function sanitizeControlPlaneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeControlPlaneValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    isSensitiveField(key) && !isSafeReferenceField(key)
      ? '[REDACTED]'
      : sanitizeControlPlaneValue(item),
  ]));
}

/** Reject credential material before a typed CLI request can leave the machine. */
export function assertNoSecretMaterial(value: unknown, path = 'data'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretMaterial(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveField(key) && !isSafeReferenceField(key)) {
      throw new Error(`${path}.${key} is secret material. Configure credentials in Admin Portal and pass only a safe integration reference.`);
    }
    assertNoSecretMaterial(item, `${path}.${key}`);
  }
}

/** Render safe server diagnostics without exposing raw response bodies. */
export function formatControlPlaneError(error: unknown): string {
  if (!(error instanceof PlatformAPIRequestError)) {
    return error instanceof Error ? error.message : String(error);
  }
  const message = error.serverMessage || error.message;
  const code = error.serverCode ? ` (${error.serverCode})` : '';
  const requestId = error.requestId ? ` Request ID: ${error.requestId}.` : '';
  return `${message}${code}.${requestId}`.replace('..', '.');
}

/** Parse typed extension fields while rejecting credentials before any API call. */
export function parseControlPlaneObject(raw: string | undefined, label: string): Record<string, unknown> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be a valid JSON object.`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  assertNoSecretMaterial(parsed, label);
  return parsed;
}

/** Tenant-scoped typed client for capability discovery, assets, tests, and bindings. */
export class CapabilityControlPlaneClient {
  constructor(
    private readonly transport: CapabilityControlPlaneTransport,
    private readonly tenantId: string,
  ) {}

  private tenantPath(suffix: string): string {
    return `/v4/platform/tenants/${segment(this.tenantId, 'Tenant id')}${suffix}`;
  }

  private async request(path: string, operation: string, options?: {
    method?: PlatformMethod;
    body?: unknown;
    params?: Record<string, unknown>;
  }): Promise<unknown> {
    return readJson(await this.transport.requestPublicApi(path, options), operation);
  }

  async listDefinitions(): Promise<CapabilityDefinition[]> {
    const payload = await this.request('/v4/platform/capability-definitions', 'List capability definitions');
    return unwrapItems(payload).map(normalizeDefinition).filter((item): item is CapabilityDefinition => item !== null);
  }

  async getDefinition(key: string): Promise<CapabilityDefinition | null> {
    const normalizedKey = key.trim();
    return (await this.listDefinitions()).find((definition) => definition.key === normalizedKey) ?? null;
  }

  async listConnections(): Promise<TenantCapabilityConnection[]> {
    const payload = await this.request(this.tenantPath('/capability-connections'), 'List capability connections');
    return unwrapItems(payload).map(normalizeConnection).filter((item): item is TenantCapabilityConnection => item !== null);
  }

  async getConnection(key: string): Promise<TenantCapabilityConnection> {
    const payload = await this.request(
      this.tenantPath(`/capability-connections/${segment(key, 'Capability key')}`),
      'Get capability connection',
    );
    const connection = normalizeConnection(isRecord(payload) && isRecord(payload.connection) ? payload.connection : payload);
    if (!connection) throw new Error(`Capability connection ${key} returned an invalid response.`);
    return connection;
  }

  private assetCollection(kind: CapabilityAssetKind): string {
    switch (kind) {
      case 'ai-profile': return '/ai/profiles';
      case 'prompt': return '/ai/prompts';
      case 'workflow': return '/workflows';
      case 'integration': return '/integrations';
    }
  }

  async listAssets(kind: CapabilityAssetKind): Promise<unknown> {
    return this.request(this.tenantPath(this.assetCollection(kind)), `List ${kind} assets`);
  }

  async getAsset(kind: CapabilityAssetKind, key: string): Promise<unknown> {
    return this.request(
      this.tenantPath(`${this.assetCollection(kind)}/${segment(key, `${kind} key`)}`),
      `Get ${kind} asset`,
    );
  }

  async createAsset(kind: Exclude<CapabilityAssetKind, 'integration'>, body: Record<string, unknown>): Promise<unknown> {
    assertNoSecretMaterial(body);
    return this.request(this.tenantPath(this.assetCollection(kind)), `Create ${kind} asset`, {
      method: 'POST',
      body: { data: body },
    });
  }

  async updateAsset(
    kind: Exclude<CapabilityAssetKind, 'integration'>,
    key: string,
    body: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<unknown> {
    assertNoSecretMaterial(body);
    let version = expectedVersion ?? null;
    if (version === null) {
      const current = await this.getAsset(kind, key);
      const currentRecord = isRecord(current) && isRecord(current.item) ? current.item : current;
      version = isRecord(currentRecord) && typeof currentRecord.version === 'number'
        ? currentRecord.version
        : null;
    }
    if (version === null) {
      throw new Error(`${kind} ${key} did not include a version required for safe update.`);
    }
    return this.request(
      this.tenantPath(`${this.assetCollection(kind)}/${segment(key, `${kind} key`)}`),
      `Update ${kind} asset`,
      { method: 'PATCH', body: { data: body, version } },
    );
  }

  async upsertAsset(
    kind: Exclude<CapabilityAssetKind, 'integration'>,
    key: string,
    body: Record<string, unknown>,
  ): Promise<CapabilityAssetUpsertResult> {
    try {
      const current = await this.getAsset(kind, key);
      const currentRecord = isRecord(current) && isRecord(current.item) ? current.item : current;
      const version = isRecord(currentRecord) && typeof currentRecord.version === 'number'
        ? currentRecord.version
        : null;
      if (version === null) {
        throw new Error(`${kind} ${key} did not include a version required for safe update.`);
      }
      return {
        action: 'updated',
        item: await this.updateAsset(kind, key, body, version),
      };
    } catch (error) {
      if (!(error instanceof PlatformAPIRequestError) || error.status !== 404) throw error;
      return {
        action: 'created',
        item: await this.createAsset(kind, body),
      };
    }
  }

  async deleteAsset(kind: Exclude<CapabilityAssetKind, 'integration'>, key: string): Promise<unknown> {
    return this.request(
      this.tenantPath(`${this.assetCollection(kind)}/${segment(key, `${kind} key`)}`),
      `Delete ${kind} asset`,
      { method: 'DELETE' },
    );
  }

  async testIntegration(key: string): Promise<unknown> {
    return this.request(
      this.tenantPath(`/integrations/${segment(key, 'Integration key')}/test`),
      'Test integration',
      { method: 'POST' },
    );
  }

  async listContent(domain: CapabilityContentDomain): Promise<unknown> {
    return this.request(this.tenantPath(`/content/${domain}`), `List ${domain}`);
  }

  async getContent(domain: CapabilityContentDomain, key: string): Promise<unknown> {
    return this.request(
      this.tenantPath(`/content/${domain}/${segment(key, `${domain} key`)}`),
      `Get ${domain}`,
    );
  }

  async listSharedAssetTypes(): Promise<unknown> {
    return this.request(this.tenantPath('/content/shared-asset-types'), 'List shared asset types');
  }

  async listSharedAssets(assetType: string): Promise<unknown> {
    return this.request(this.tenantPath('/content/shared-assets'), 'List shared assets', {
      params: { assetType: requiredValue(assetType, 'Shared asset type') },
    });
  }

  async getSharedAsset(assetType: string, assetKey: string): Promise<unknown> {
    return this.request(
      this.tenantPath(`/content/shared-assets/${segment(assetKey, 'Shared asset key')}`),
      'Get shared asset',
      { params: { assetType: requiredValue(assetType, 'Shared asset type') } },
    );
  }

  async listBindings(appKey: string): Promise<unknown> {
    return this.request(this.bindingPath(appKey), 'List app capability bindings');
  }

  async setBinding(appKey: string, binding: AppCapabilityBindingRequest): Promise<unknown> {
    return this.setAssetBinding(appKey, {
      bindingKey: binding.bindingKey,
      capabilityKey: binding.capabilityKey,
      assetType: {
        integration: 'tenant-integration-source',
        'ai-profile': 'shared-ai-profile',
        prompt: 'shared-chatbot-config',
        workflow: 'shared-workflow-config',
      }[binding.assetKind],
      assetKey: binding.assetKey,
      ...(binding.environment ? { environment: binding.environment } : {}),
    });
  }

  async setAssetBinding(appKey: string, binding: ContentCapabilityBindingRequest): Promise<unknown> {
    assertNoSecretMaterial(binding);
    const input = {
      bindingKey: binding.bindingKey,
      logicalAlias: binding.bindingKey,
      capabilityKey: binding.capabilityKey,
      assetType: binding.assetType,
      assetKey: binding.assetKey,
      environment: binding.environment ?? 'default',
    };
    return this.request(this.bindingPath(appKey), 'Set app capability binding', {
      method: 'PUT',
      body: { bindings: [input] },
    });
  }

  async removeBinding(appKey: string, bindingKey: string): Promise<unknown> {
    return this.request(`${this.bindingPath(appKey)}/${segment(bindingKey, 'Binding key')}`, 'Remove app capability binding', { method: 'DELETE' });
  }

  async validateBindings(appKey: string, capabilityRequirements?: AppCapabilityRequirements): Promise<unknown> {
    if (capabilityRequirements) assertNoSecretMaterial(capabilityRequirements);
    return this.request(`${this.bindingPath(appKey)}/validate`, 'Validate app capability bindings', {
      method: 'POST',
      body: capabilityRequirements ? { capabilityRequirements } : {},
    });
  }

  private bindingPath(appKey: string): string {
    return this.tenantPath(`/apps/${segment(appKey, 'App key')}/capability-bindings`);
  }
}

/** Bind the typed control-plane client to an authenticated CLI tenant context. */
export function createCapabilityControlPlaneClient(
  client: PlatformAPIClient,
  tenantId: string,
): CapabilityControlPlaneClient {
  return new CapabilityControlPlaneClient(client, tenantId);
}
