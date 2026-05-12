/**
 * Platform API client for CLI — wraps PublicAPI calls with auth.
 *
 * Unlike the Platform SDK (which goes through the BFF proxy),
 * the CLI calls PublicAPI directly with a Bearer token from browser-based
 * authorization code flow with PKCE.
 */

import { getAccessToken } from './auth.js';
import { toObjectTypeSlug } from './utils.js';

type PlatformBackend = 'payload' | 'admin' | 'mid';
type PlatformMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type ResourceWhere = Record<string, unknown>;

export interface ChildTenantBootstrapRequest {
  userOid: string;
  userEmail?: string;
}

export type TenantUsecase = 'council' | 'retail' | 'healthcare' | 'finance' | 'manufacturing' | 'generic';

export interface ChildTenantBootstrapResult {
  parentTenantId: string;
  childTenantId: string;
  userOid: string;
  membershipCreated: boolean;
  adminAssigned: boolean;
  usable: boolean;
  status: 'bootstrapped' | 'already-usable';
  reason?: string | null;
}

export interface CapabilityEvaluationRequest {
  tenantId: string;
  targetCapability: 'child-tenants' | 'ai-chat' | 'documents' | 'auth-b2b' | 'auth-dual';
  requestedOperation?: 'create' | 'enable' | 'configure' | 'inspect';
}

export interface CapabilityDecision {
  outcome: 'allow' | 'deny' | 'upgrade-required';
  reasonCode: string;
  reasonMessage: string;
  upgradeUrl?: string | null;
}

export type RuntimeWorkflowStatus =
  | 'available'
  | 'not_ready'
  | 'operator_required'
  | 'upgrade_required'
  | 'unsupported';

export interface RuntimeWorkflowStatusResult {
  workflowKey: string;
  tenantId: string | null;
  status: RuntimeWorkflowStatus;
  reasonCode: string;
  reasonMessage: string;
  runtimeWorkflowId: string | null;
  nextAction: string | null;
  checkedAt?: string | null;
}

export interface RuntimeWorkflowRequestResult {
  requestId: string;
  workflowKey: string;
  tenantId: string;
  status: RuntimeWorkflowStatus;
  reasonCode: string;
  reasonMessage: string;
  runtimeWorkflowId: string | null;
  nextAction: string | null;
}

export interface BuilderReadinessCheck {
  key: string;
  status: RuntimeWorkflowStatus;
  reasonCode: string;
  reasonMessage: string;
  nextAction: string | null;
}

export interface BuilderReadinessResult {
  tenantId: string;
  status: RuntimeWorkflowStatus;
  checks: BuilderReadinessCheck[];
  checkedAt?: string | null;
}

export interface RotateEntraSecretResult {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  expiresAt: string | null;
}

export interface ParsedApiError {
  status: number;
  code?: string;
  message: string;
  bodyText?: string;
}

export interface PlatformAPIRequestErrorOptions {
  operation: string;
  status: number;
  statusText: string;
  serverMessage?: string;
  serverCode?: string;
  requestId?: string;
  rawBody?: string;
}

function formatApiRequestErrorMessage(options: PlatformAPIRequestErrorOptions): string {
  return `${options.operation} failed`;
}

export class PlatformAPIRequestError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly statusText: string;
  readonly serverMessage?: string;
  readonly serverCode?: string;
  readonly requestId?: string;
  readonly rawBody?: string;

  constructor(options: PlatformAPIRequestErrorOptions) {
    super(formatApiRequestErrorMessage(options));
    this.name = 'PlatformAPIRequestError';
    this.operation = options.operation;
    this.status = options.status;
    this.statusText = options.statusText;
    this.serverMessage = options.serverMessage;
    this.serverCode = options.serverCode;
    this.requestId = options.requestId;
    this.rawBody = options.rawBody;
  }
}

/**
 * Best-effort extraction of server-provided diagnostic context from a failed
 * Response. Tolerates non-JSON bodies and FastAPI/Pydantic error envelopes
 * (``{detail: "..."}``, ``{detail: {message, code}}``, ``{errors: [...]}``).
 *
 * Always returns the raw text so ``--debug`` can show the full body, even
 * when no message field could be parsed.
 */
export async function extractServerErrorContext(res: Response): Promise<{
  serverMessage?: string;
  serverCode?: string;
  requestId?: string;
  rawBody: string;
}> {
  const requestId = res.headers.get('x-request-id') ?? res.headers.get('x-correlation-id') ?? undefined;
  const rawBody = await res.text().catch(() => '');
  if (!rawBody) {
    return { requestId, rawBody: '' };
  }

  try {
    const parsed = JSON.parse(rawBody) as {
      detail?: string | { message?: string; error?: string; code?: string };
      message?: string;
      error?: string;
      code?: string;
      errors?: { message?: string; code?: string }[];
    };
    let serverMessage: string | undefined;
    let serverCode: string | undefined;

    if (typeof parsed.detail === 'string') {
      serverMessage = parsed.detail;
    } else if (parsed.detail && typeof parsed.detail === 'object') {
      serverMessage = parsed.detail.message ?? parsed.detail.error;
      serverCode = parsed.detail.code;
    }
    if (!serverMessage) {
      serverMessage = parsed.message ?? parsed.error;
    }
    if (!serverMessage && Array.isArray(parsed.errors) && parsed.errors[0]?.message) {
      serverMessage = parsed.errors[0].message;
      serverCode = serverCode ?? parsed.errors[0].code;
    }
    serverCode = serverCode ?? parsed.code;

    return { serverMessage, serverCode, requestId, rawBody };
  } catch {
    return { requestId, rawBody };
  }
}

export function buildPayloadEqualsParams(
  filters: Record<string, string>,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = { ...(extras || {}) };
  for (const [field, value] of Object.entries(filters)) {
    params[`where[${field}][equals]`] = value;
  }
  return params;
}

export async function parseApiError(response: Response): Promise<ParsedApiError> {
  const bodyText = await response.text();

  if (!bodyText) {
    return {
      status: response.status,
      message: response.statusText || `HTTP ${response.status}`,
    };
  }

  try {
    const body = JSON.parse(bodyText) as {
      detail?: {
        error?: string;
        message?: string;
      } | string;
      error?: string;
      message?: string;
    };

    const detail = body.detail;
    if (detail && typeof detail === 'object') {
      return {
        status: response.status,
        code: detail.error,
        message: detail.message || response.statusText || `HTTP ${response.status}`,
        bodyText,
      };
    }

    return {
      status: response.status,
      code: typeof body.error === 'string' ? body.error : undefined,
      message: typeof body.message === 'string'
        ? body.message
        : typeof detail === 'string'
          ? detail
          : response.statusText || `HTTP ${response.status}`,
      bodyText,
    };
  } catch {
    return {
      status: response.status,
      message: bodyText,
      bodyText,
    };
  }
}

function readStringField(body: Record<string, unknown>, camelKey: string, snakeKey: string): string | null {
  const value = body[camelKey] ?? body[snakeKey];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readWorkflowStatus(value: unknown): RuntimeWorkflowStatus {
  if (
    value === 'available'
    || value === 'not_ready'
    || value === 'operator_required'
    || value === 'upgrade_required'
    || value === 'unsupported'
  ) {
    return value;
  }
  return 'operator_required';
}

function parseRuntimeWorkflowStatus(body: Record<string, unknown>): RuntimeWorkflowStatusResult {
  return {
    workflowKey: readStringField(body, 'workflowKey', 'workflow_key') ?? 'unknown',
    tenantId: readStringField(body, 'tenantId', 'tenant_id'),
    status: readWorkflowStatus(body.status),
    reasonCode: readStringField(body, 'reasonCode', 'reason_code') ?? 'runtime_workflow_status_unknown',
    reasonMessage: readStringField(body, 'reasonMessage', 'reason_message') ?? 'Runtime workflow status is unknown.',
    runtimeWorkflowId: readStringField(body, 'runtimeWorkflowId', 'runtime_workflow_id'),
    nextAction: readStringField(body, 'nextAction', 'next_action'),
    checkedAt: readStringField(body, 'checkedAt', 'checked_at'),
  };
}

function parseRuntimeWorkflowRequest(body: Record<string, unknown>): RuntimeWorkflowRequestResult {
  return {
    requestId: readStringField(body, 'requestId', 'request_id') ?? 'unknown',
    workflowKey: readStringField(body, 'workflowKey', 'workflow_key') ?? 'unknown',
    tenantId: readStringField(body, 'tenantId', 'tenant_id') ?? 'unknown',
    status: readWorkflowStatus(body.status),
    reasonCode: readStringField(body, 'reasonCode', 'reason_code') ?? 'runtime_workflow_requested',
    reasonMessage: readStringField(body, 'reasonMessage', 'reason_message') ?? 'Runtime workflow request submitted.',
    runtimeWorkflowId: readStringField(body, 'runtimeWorkflowId', 'runtime_workflow_id'),
    nextAction: readStringField(body, 'nextAction', 'next_action'),
  };
}

function parseBuilderReadiness(body: Record<string, unknown>): BuilderReadinessResult {
  const checks = Array.isArray(body.checks)
    ? body.checks.filter((check): check is Record<string, unknown> => Boolean(check) && typeof check === 'object')
    : [];

  return {
    tenantId: readStringField(body, 'tenantId', 'tenant_id') ?? 'unknown',
    status: readWorkflowStatus(body.status),
    checkedAt: readStringField(body, 'checkedAt', 'checked_at'),
    checks: checks.map((check) => ({
      key: readStringField(check, 'key', 'key') ?? 'unknown',
      status: readWorkflowStatus(check.status),
      reasonCode: readStringField(check, 'reasonCode', 'reason_code') ?? 'builder_check_unknown',
      reasonMessage: readStringField(check, 'reasonMessage', 'reason_message') ?? 'Builder check did not return detail.',
      nextAction: readStringField(check, 'nextAction', 'next_action'),
    })),
  };
}

export class PlatformAPIClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tenantId: string,
  ) {}

  private async headers(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      h['Authorization'] = `Bearer ${token}`;
    }
    if (this.tenantId && this.tenantId !== 'system') {
      h['X-Tenant-Id'] = this.tenantId;
    }
    return h;
  }

  // --------------- Internal routing ---------------

  /** @internal — do not use directly; use typed methods below. */
  private async _route(
    backend: PlatformBackend,
    endpoint: string,
    method: PlatformMethod = 'GET',
    body?: unknown,
    params?: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/orchestrate`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ target_backend: backend, endpoint, method, body, params }),
    });
  }

  // --------------- Resources ---------------

  async listResources(
    objectType: string,
    options?: {
      page?: number;
      limit?: number;
      sort?: string;
      where?: ResourceWhere;
      cursor?: string;
    },
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    const params = new URLSearchParams();
    if (options?.page) params.set('page', String(options.page));
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.sort) params.set('sort', options.sort);
    if (options?.where) params.set('where', JSON.stringify(options.where));
    if (options?.cursor) params.set('cursor', options.cursor);
    const qs = params.toString();
    const url = `${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}${qs ? `?${qs}` : ''}`;
    return fetch(url, { headers: await this.headers() });
  }

  async streamResources(
    objectType: string,
    options?: { limit?: number; sort?: string; where?: ResourceWhere; cursor?: string },
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.sort) params.set('sort', options.sort);
    if (options?.where) params.set('where', JSON.stringify(options.where));
    if (options?.cursor) params.set('cursor', options.cursor);
    const qs = params.toString();
    const url = `${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}/stream${qs ? `?${qs}` : ''}`;
    return fetch(url, { headers: await this.headers() });
  }

  async getResource(objectType: string, id: string): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(
      `${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}/${id}`,
      { headers: await this.headers() },
    );
  }

  async createResource(objectType: string, data: Record<string, unknown>): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ data }),
    });
  }

  async updateResource(
    objectType: string,
    id: string,
    data: Record<string, unknown>,
    version: number,
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}/${id}`, {
      method: 'PUT',
      headers: await this.headers(),
      body: JSON.stringify({ data, version }),
    });
  }

  async deleteResource(objectType: string, id: string): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}/${id}`, {
      method: 'DELETE',
      headers: await this.headers(),
    });
  }

  async batchCreateResources(
    objectType: string,
    items: Array<{ data: Record<string, unknown> }>,
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}/batch/create`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ items }),
    });
  }

  async batchUpdateResources(
    objectType: string,
    items: Array<{ id: string; data: Record<string, unknown>; version: number }>,
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}/batch/update`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ items }),
    });
  }

  async batchDeleteResources(objectType: string, ids: string[]): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}/batch/delete`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ ids }),
    });
  }

  async aggregateResources(
    objectType: string,
    request: {
      groupBy: string[];
      metrics: Record<string, unknown>;
      where?: ResourceWhere;
      limit?: number;
    },
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}/aggregate`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(request),
    });
  }

  async executeAction(
    objectType: string,
    id: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(
      `${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}/${id}/actions/${action}`,
      {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({ params: params || {} }),
      },
    );
  }

  async queryResources(query: {
    object_types: string[];
    where?: Record<string, unknown>;
    join?: unknown;
    limit?: number;
  }): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/query`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        ...query,
        object_types: query.object_types.map(toObjectTypeSlug),
      }),
    });
  }

  async getPublishedObjectTypes(options?: {
    name?: string;
    limit?: number;
    sort?: string;
  }): Promise<Response> {
    const filters: Record<string, string> = {
      tenant: this.tenantId,
    };
    if (options?.name) {
      filters.name = options.name;
    }

    return this.platformRequest(
      '/object-types',
      'GET',
      undefined,
      buildPayloadEqualsParams(filters, {
        limit: Math.min(options?.limit ?? 100, 100),
        sort: options?.sort ?? 'name',
      }),
    );
  }

  async getSchema(): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/resources/schema/${this.tenantId}`, {
      method: 'GET',
      headers: await this.headers(),
    });
  }

  async getStorageStatus(): Promise<Response> {
    return this.getResourceStorageStatus();
  }

  async getResourceStorageStatus(): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/storage`, {
      method: 'GET',
      headers: await this.headers(),
    });
  }

  async getStorageDoctor(): Promise<Response> {
    return this.getResourceStorageDoctor();
  }

  async getResourceStorageDoctor(): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/storage/doctor`, {
      method: 'GET',
      headers: await this.headers(),
    });
  }

  async provisionStorage(options: {
    backend?: string;
    dryRun?: boolean;
    rebuildSearch?: boolean;
    provisioningMode?: string;
  }): Promise<Response> {
    const backend = options.backend === 'mongodb' ? 'documentdb' : options.backend;
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/storage/provision`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        backend: backend || 'all',
        dry_run: Boolean(options.dryRun),
        rebuild_search: Boolean(options.rebuildSearch),
        provisioning_mode: options.provisioningMode ?? 'dedicated-tenant-storage',
      }),
    });
  }

  async syncStorageSchema(options?: {
    backend?: string;
    dryRun?: boolean;
  }): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/storage/sync-schema`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        backend: options?.backend,
        dry_run: options?.dryRun ?? false,
      }),
    });
  }

  async searchResources(request: {
    query: string;
    objectTypes?: string[];
    mode?: string;
    limit?: number;
    includePayload?: boolean;
  }): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/search`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        query: request.query,
        objectTypes: request.objectTypes?.map(toObjectTypeSlug),
        mode: request.mode || 'hybrid',
        limit: request.limit ?? 10,
        includePayload: request.includePayload ?? true,
      }),
    });
  }

  async uploadResourceFile(
    objectType: string,
    id: string,
    propertyName: string,
    filePath: string,
  ): Promise<Response> {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const normalizedObjectType = toObjectTypeSlug(objectType);
    const content = await readFile(filePath);
    const token = await getAccessToken();
    const h: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
    };
    if (token) {
      h.Authorization = `Bearer ${token}`;
    }

    const filename = encodeURIComponent(basename(filePath));
    return fetch(
      `${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}/${id}/files/${propertyName}?filename=${filename}`,
      {
        method: 'POST',
        headers: h,
        body: content,
      },
    );
  }

  async downloadResourceFile(
    objectType: string,
    id: string,
    propertyName: string,
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}/${id}/files/${propertyName}`, {
      method: 'GET',
      headers: await this.headers(),
    });
  }

  async deleteResourceFile(
    objectType: string,
    id: string,
    propertyName: string,
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}/${id}/files/${propertyName}`, {
      method: 'DELETE',
      headers: await this.headers(),
    });
  }

  async getHistory(objectType: string, id: string): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(
      `${this.baseUrl}/v3/resources/${this.tenantId}/${normalizedObjectType}/${id}/history`,
      { headers: await this.headers() },
    );
  }

  // --------------- Chat ---------------

  async sendChat(
    workflowId: string,
    stage: string,
    message: string,
    conversationId: string,
    params?: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(
      `${this.baseUrl}/v3/chat/${this.tenantId}/${workflowId}/${stage}`,
      {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({
          message,
          conversation_id: conversationId,
          params: params || {},
        }),
      },
    );
  }

  async streamChat(
    workflowId: string,
    stage: string,
    message: string,
    conversationId: string,
    params?: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(
      `${this.baseUrl}/v3/chat/stream/${this.tenantId}/${workflowId}/${stage}`,
      {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({
          message,
          conversation_id: conversationId,
          params: params || {},
        }),
      },
    );
  }

  // --------------- Builder / Workflows ---------------

  async getBuilderReadiness(options?: {
    tenantId?: string;
    workflowKeys?: string[];
  }): Promise<BuilderReadinessResult> {
    const params = new URLSearchParams();
    params.set('tenant_id', options?.tenantId || this.tenantId);
    for (const workflowKey of options?.workflowKeys || []) {
      params.append('workflow_keys', workflowKey);
    }

    const response = await fetch(`${this.baseUrl}/v3/builder/readiness?${params.toString()}`, {
      method: 'GET',
      headers: await this.headers(),
    });

    if (!response.ok) {
      const context = await extractServerErrorContext(response);
      throw new PlatformAPIRequestError({
        operation: 'Builder readiness check',
        status: response.status,
        statusText: response.statusText,
        ...context,
      });
    }

    return parseBuilderReadiness(await response.json() as Record<string, unknown>);
  }

  async getRuntimeWorkflowStatus(
    workflowKey: string,
    tenantId = this.tenantId,
  ): Promise<RuntimeWorkflowStatusResult> {
    const params = new URLSearchParams({ tenant_id: tenantId });
    const response = await fetch(
      `${this.baseUrl}/v3/workflows/runtime/${encodeURIComponent(workflowKey)}/status?${params.toString()}`,
      {
        method: 'GET',
        headers: await this.headers(),
      },
    );

    if (!response.ok) {
      const context = await extractServerErrorContext(response);
      throw new PlatformAPIRequestError({
        operation: `Runtime workflow status (${workflowKey})`,
        status: response.status,
        statusText: response.statusText,
        ...context,
      });
    }

    return parseRuntimeWorkflowStatus(await response.json() as Record<string, unknown>);
  }

  async requestRuntimeWorkflow(request: {
    tenantId?: string;
    workflowKey: string;
    displayName?: string;
    reason?: string;
  }): Promise<RuntimeWorkflowRequestResult> {
    const response = await fetch(`${this.baseUrl}/v3/workflows/runtime-requests`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        tenant_id: request.tenantId || this.tenantId,
        workflow_key: request.workflowKey,
        display_name: request.displayName,
        reason: request.reason,
      }),
    });

    if (!response.ok) {
      const context = await extractServerErrorContext(response);
      throw new PlatformAPIRequestError({
        operation: `Runtime workflow request (${request.workflowKey})`,
        status: response.status,
        statusText: response.statusText,
        ...context,
      });
    }

    return parseRuntimeWorkflowRequest(await response.json() as Record<string, unknown>);
  }

  // --------------- Documents ---------------

  private async uploadDocumentBatch(
    filePath: string,
    processingMode: 'full' | 'classification',
  ): Promise<Response> {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const content = await readFile(filePath);
    const form = new FormData();
    form.append('files', new Blob([content]), basename(filePath));
    form.append('tenant_id', this.tenantId);
    form.append('processing_mode', processingMode);

    const token = await getAccessToken();
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    h['X-Tenant-Id'] = this.tenantId;

    const endpoint = processingMode === 'classification'
      ? '/v3/documents/classify'
      : '/v3/documents/upload';

    return fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: h,
      body: form,
    });
  }

  async uploadDocument(filePath: string): Promise<Response> {
    return this.uploadDocumentBatch(filePath, 'full');
  }

  async classifyDocument(filePath: string): Promise<Response> {
    return this.uploadDocumentBatch(filePath, 'classification');
  }

  async getDocumentRecord(documentId: string): Promise<Response> {
    return this.platformRequest(`/custom-documents/${documentId}`, 'GET');
  }

  async indexDocument(documentId: string): Promise<Response> {
    const lookup = await this.getDocumentRecord(documentId);
    if (!lookup.ok) {
      return lookup;
    }

    const document = await lookup.json() as {
      id?: string;
      documentId?: string;
      title?: string;
      tenant?: string | { id?: string };
      businessRequest?: string | { id?: string };
      fileInfo?: {
        dataLakeUrl?: string;
      };
    };

    const storagePath = document.fileInfo?.dataLakeUrl;
    if (!storagePath) {
      return new Response(
        JSON.stringify({
          error: 'MISSING_STORAGE_PATH',
          message: 'The document does not have a dataLakeUrl/storage path and cannot be indexed.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const tenantId = typeof document.tenant === 'string'
      ? document.tenant
      : document.tenant?.id || this.tenantId;
    const businessRequestId = typeof document.businessRequest === 'string'
      ? document.businessRequest
      : document.businessRequest?.id;

    return fetch(`${this.baseUrl}/v3/documents/rag-index`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        documentId: document.documentId || document.id || documentId,
        storagePath,
        tenantId,
        businessRequestId,
        title: document.title,
      }),
    });
  }

  // --------------- Platform requests ---------------

  /** Route a request through the platform gateway. */
  async platformRequest(
    endpoint: string,
    method: PlatformMethod = 'GET',
    body?: unknown,
    params?: Record<string, unknown>,
  ): Promise<Response> {
    return this._route('payload', endpoint, method, body, params);
  }

  /** Route a request through the AdminAPI gateway. */
  async adminRequest(
    endpoint: string,
    method: PlatformMethod = 'GET',
    body?: unknown,
    params?: Record<string, unknown>,
  ): Promise<Response> {
    return this._route('admin', endpoint, method, body, params);
  }

  // --------------- Tenants ---------------

  async listTenants(parentId?: string): Promise<Response> {
    const params: Record<string, unknown> = { limit: 100 };
    if (parentId) {
      params['where[parentTenant][equals]'] = parentId;
    }
    return this._route('payload', '/custom-tenants', 'GET', undefined, params);
  }

  async getTenant(id: string): Promise<Response> {
    return this._route('payload', `/custom-tenants/${id}`);
  }

  async createTenant(data: {
    name: string;
    slug: string;
    parent?: string;
    domain?: string[];
    usecase?: TenantUsecase;
    industry?: string;
    starterTemplate?: string;
  }): Promise<Response> {
    if (data.parent) {
      return this.adminRequest(`/v1/tenants/${data.parent}/children`, 'POST', {
        displayName: data.name,
        slug: data.slug,
        usecase: data.usecase || 'generic',
        ...(data.industry ? { industry: data.industry } : {}),
        ...(data.starterTemplate ? { starterTemplate: data.starterTemplate } : {}),
      });
    }

    return this._route('payload', '/tenant-management', 'POST', {
      displayName: data.name,
      name: data.name,
      slug: data.slug,
      parentTenant: data.parent,
      domain: data.domain,
      usecase: data.usecase || 'generic',
      ...(data.industry ? { industry: data.industry } : {}),
      ...(data.starterTemplate ? { starterTemplate: data.starterTemplate } : {}),
    });
  }

  async deleteTenant(tenantId: string): Promise<Response> {
    return this.adminRequest(`/v1/accounts/${tenantId}/delete`, 'POST');
  }

  async bootstrapChildTenantAdmin(
    parentTenantId: string,
    childTenantId: string,
    body: ChildTenantBootstrapRequest,
  ): Promise<Response> {
    return this.adminRequest(
      `/v1/tenants/${parentTenantId}/children/${childTenantId}/bootstrap-admin`,
      'POST',
      body,
    );
  }

  async evaluateCapability(request: CapabilityEvaluationRequest): Promise<CapabilityDecision> {
    const response = await fetch(`${this.baseUrl}/v3/capabilities/evaluate`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        tenant_id: request.tenantId,
        target_capability: request.targetCapability,
        requested_operation: request.requestedOperation || 'inspect',
      }),
    });

    if (!response.ok) {
      const context = await extractServerErrorContext(response);
      throw new PlatformAPIRequestError({
        operation: `POST /v3/capabilities/evaluate (${request.targetCapability})`,
        status: response.status,
        statusText: response.statusText,
        serverMessage: context.serverMessage,
        serverCode: context.serverCode,
        requestId: context.requestId,
        rawBody: context.rawBody,
      });
    }

    return await response.json() as CapabilityDecision;
  }

  // --------------- Users ---------------

  async getUserMemberships(oid: string): Promise<Response> {
    return this.adminRequest(`/v1/users/${oid}/memberships`, 'GET');
  }

  async provisionMe(): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/users/provisionme`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ tenant_id: this.tenantId }),
    });
  }

  async lookupUserByEmail(email: string): Promise<Response> {
    return this.adminRequest(`/v1/users/by-email?email=${encodeURIComponent(email)}`, 'GET');
  }

  async listCurrentUserTenants(): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/users/me/tenants`, {
      method: 'GET',
      headers: await this.headers(),
    });
  }

  async provisionUserToTenant(tenantId: string, userOid?: string): Promise<Response> {
    if (userOid) {
      return this.adminRequest(`/v1/users/${userOid}/provision`, 'POST', {
        tenant_id: tenantId,
      });
    }

    const body: Record<string, string> = { tenant_id: tenantId };
    return fetch(`${this.baseUrl}/v3/users/provisionme`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
  }

  // --------------- Provisioning ---------------

  async provisionEntraApp(request: {
    tenantId: string;
    verticalName: string;
    redirectUris: string[];
    idempotent?: boolean;
  }): Promise<{
    clientId: string;
    clientSecret: string | null;
    existing: boolean;
    scopes: string[];
    redirectUris: string[];
    environment: string | null;
    tenantId: string | null;
    signinCompleteness: SigninCompletenessSummary | null;
  }> {
    const body = {
      tenant_id: request.tenantId,
      vertical_name: request.verticalName,
      redirect_uris: request.redirectUris,
      idempotent: request.idempotent ?? false,
    };

    const endpoint = '/v3/provision/entra-app';
    const url = `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const ctx = await extractServerErrorContext(res);
      throw new PlatformAPIRequestError({
        operation: 'Entra app provisioning',
        status: res.status,
        statusText: res.statusText,
        ...ctx,
      });
    }

    const data = await res.json() as {
      client_id?: string;
      client_secret?: string | null;
      clientId?: string;
      clientSecret?: string | null;
      existing?: boolean;
      scopes?: unknown;
      redirect_uris?: unknown;
      redirectUris?: unknown;
      environment?: unknown;
      tenant_id?: unknown;
      tenantId?: unknown;
      signin_completeness?: unknown;
      signinCompleteness?: unknown;
    };
    const clientId = data.clientId ?? data.client_id;

    if (typeof clientId !== 'string' || clientId.trim() === '') {
      throw new PlatformAPIRequestError({
        operation: 'Entra app provisioning',
        status: res.status,
        statusText: 'Invalid provisioning response',
      });
    }

    const toStringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];

    return {
      clientId,
      clientSecret: data.clientSecret ?? data.client_secret ?? null,
      existing: Boolean(data.existing),
      scopes: toStringArray(data.scopes),
      redirectUris: toStringArray(data.redirectUris ?? data.redirect_uris),
      environment: typeof data.environment === 'string' ? data.environment : null,
      tenantId: typeof (data.tenantId ?? data.tenant_id) === 'string'
        ? (data.tenantId ?? data.tenant_id) as string
        : null,
      signinCompleteness: parseSigninCompleteness(data.signinCompleteness ?? data.signin_completeness),
    };
  }

  async rotateEntraAppSecret(request: {
    tenantId: string;
    clientId: string;
  }): Promise<RotateEntraSecretResult> {
    const response = await fetch(
      `${this.baseUrl}/v3/provision/entra-app/${encodeURIComponent(request.clientId)}/rotate-secret`,
      {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({ tenant_id: request.tenantId }),
      },
    );

    if (!response.ok) {
      const context = await extractServerErrorContext(response);
      throw new PlatformAPIRequestError({
        operation: 'Entra app secret rotation',
        status: response.status,
        statusText: response.statusText,
        ...context,
      });
    }

    const data = await response.json() as Record<string, unknown>;
    const clientId = readStringField(data, 'clientId', 'client_id');
    const clientSecret = readStringField(data, 'clientSecret', 'client_secret');
    if (!clientId || !clientSecret) {
      throw new PlatformAPIRequestError({
        operation: 'Entra app secret rotation',
        status: response.status,
        statusText: 'Invalid secret rotation response',
      });
    }

    return {
      clientId,
      clientSecret,
      tenantId: readStringField(data, 'tenantId', 'tenant_id') ?? request.tenantId,
      expiresAt: readStringField(data, 'expiresAt', 'expires_at'),
    };
  }
}

/**
 * AdminAPI's per-step rollup of the post-provision sign-in wiring it
 * performed against MS Graph (requiredResourceAccess merge, admin consent,
 * preAuthorizedApplications). PublicAPI relays this verbatim. `signin_ready`
 * is True only when every step the user-session sign-in path depends on
 * landed; False is the silent-failure pattern that produces AADSTS650057
 * the moment a vertical's BFF proxy tries to call PublicAPI.
 */
export interface SigninCompletenessSummary {
  graphPermsAdded: boolean;
  publicapiPermsAdded: boolean;
  consentGranted: boolean;
  publicapiPreauthorized: boolean;
  signinReady: boolean;
  warnings: string[];
}

function parseSigninCompleteness(value: unknown): SigninCompletenessSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const v = value as Record<string, unknown>;
  const warnings = Array.isArray(v.warnings)
    ? v.warnings.filter((w): w is string => typeof w === 'string')
    : [];
  return {
    graphPermsAdded: Boolean(v.graph_perms_added ?? v.graphPermsAdded),
    publicapiPermsAdded: Boolean(v.publicapi_perms_added ?? v.publicapiPermsAdded),
    consentGranted: Boolean(v.consent_granted ?? v.consentGranted),
    publicapiPreauthorized: Boolean(v.publicapi_preauthorized ?? v.publicapiPreauthorized),
    // Older AdminAPI deployments don't emit `signin_ready`; derive it from
    // the four boolean steps so the CLI behaves identically once each step
    // is observably True/False.
    signinReady: typeof (v.signin_ready ?? v.signinReady) === 'boolean'
      ? Boolean(v.signin_ready ?? v.signinReady)
      : Boolean(
        v.graph_perms_added ?? v.graphPermsAdded
      )
        && Boolean(v.publicapi_perms_added ?? v.publicapiPermsAdded)
        && Boolean(v.consent_granted ?? v.consentGranted)
        && Boolean(v.publicapi_preauthorized ?? v.publicapiPreauthorized),
    warnings,
  };
}
