/**
 * Platform API client for CLI — wraps PublicAPI calls with auth.
 *
 * Unlike the Platform SDK (which goes through the BFF proxy),
 * the CLI calls PublicAPI directly with a Bearer token from device code flow.
 */

import { getAccessToken } from './auth.js';

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
  private async _route(backend: string, endpoint: string, method = 'GET', body?: unknown, params?: Record<string, unknown>): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/orchestrate`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ target_backend: backend, endpoint, method, body, params }),
    });
  }

  // --------------- Resources ---------------

  async listResources(
    objectType: string,
    options?: { page?: number; limit?: number; sort?: string },
  ): Promise<Response> {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', String(options.page));
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.sort) params.set('sort', options.sort);
    const qs = params.toString();
    const url = `${this.baseUrl}/v3/resources/${this.tenantId}/${objectType}${qs ? `?${qs}` : ''}`;
    return fetch(url, { headers: await this.headers() });
  }

  async getResource(objectType: string, id: string): Promise<Response> {
    return fetch(
      `${this.baseUrl}/v3/resources/${this.tenantId}/${objectType}/${id}`,
      { headers: await this.headers() },
    );
  }

  async createResource(objectType: string, data: Record<string, unknown>): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/${objectType}`, {
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
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/${objectType}/${id}`, {
      method: 'PUT',
      headers: await this.headers(),
      body: JSON.stringify({ data, version }),
    });
  }

  async deleteResource(objectType: string, id: string): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/${objectType}/${id}`, {
      method: 'DELETE',
      headers: await this.headers(),
    });
  }

  async executeAction(
    objectType: string,
    id: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(
      `${this.baseUrl}/v3/resources/${this.tenantId}/${objectType}/${id}/actions/${action}`,
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
      body: JSON.stringify(query),
    });
  }

  async getSchema(): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/resources/schema/${this.tenantId}`, {
      headers: await this.headers(),
    });
  }

  async getHistory(objectType: string, id: string): Promise<Response> {
    return fetch(
      `${this.baseUrl}/v3/resources/${this.tenantId}/${objectType}/${id}/history`,
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

  async classifyDocument(filePath: string): Promise<Response> {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const content = await readFile(filePath);
    const form = new FormData();
    form.append('files', new Blob([content]), basename(filePath));

    const token = await getAccessToken();
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;

    return fetch(`${this.baseUrl}/v3/documents/classify`, {
      method: 'POST',
      headers: h,
      body: form,
    });
  }

  async indexDocument(documentId: string): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/documents/rag-index`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ document_id: documentId }),
    });
  }

  // --------------- Platform requests ---------------

  /** Route a request through the platform gateway. */
  async platformRequest(endpoint: string, method = 'GET', body?: unknown, params?: Record<string, unknown>): Promise<Response> {
    return this._route('payload', endpoint, method, body, params);
  }

  // --------------- Tenants ---------------

  async listTenants(parentId?: string): Promise<Response> {
    const params: Record<string, unknown> = { limit: 100 };
    if (parentId) {
      params.where = { parent: { equals: parentId } };
    }
    return this._route('payload', '/tenants', 'GET', undefined, params);
  }

  async getTenant(id: string): Promise<Response> {
    return this._route('payload', `/tenants/${id}`);
  }

  async createTenant(data: {
    name: string;
    slug: string;
    parent?: string;
    domain?: string[];
  }): Promise<Response> {
    return this._route('payload', '/tenants', 'POST', data);
  }

  // --------------- Users ---------------

  async provisionMe(): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/users/provisionme`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ tenant_id: this.tenantId }),
    });
  }

  async getCurrentUser(): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/auth/me`, {
      headers: await this.headers(),
    });
  }
}
