/**
 * Platform API client for CLI — wraps PublicAPI calls with auth.
 *
 * Unlike the Platform SDK (which goes through the BFF proxy),
 * the CLI calls PublicAPI directly with a Bearer token from browser-based
 * authorization code flow with PKCE.
 */

import { getAccessToken } from './auth.js';

type PlatformBackend = 'payload' | 'admin' | 'mid';
type PlatformMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type ResourceWhere = Record<string, unknown>;

export interface ChildTenantBootstrapRequest {
  userOid: string;
  userEmail?: string;
}

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

export interface ParsedApiError {
  status: number;
  code?: string;
  message: string;
  bodyText?: string;
}

function toObjectTypeSlug(objectType: string): string {
  return objectType
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
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
        limit: options?.limit ?? 200,
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
  }): Promise<Response> {
    return this._route('payload', '/custom-tenants', 'POST', {
      displayName: data.name,
      name: data.name,
      slug: data.slug,
      parentTenant: data.parent,
      domain: data.domain,
    });
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
}
