/**
 * Mock Server Setup
 *
 * Uses MSW (Mock Service Worker) to intercept and mock HTTP requests
 * during tests. Provides helpers for mocking PublicAPI endpoints.
 */

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export interface MockAPIResponse {
  status?: number;
  body?: unknown;
  delay?: number;
}

/**
 * Creates a mock HTTP server for testing
 */
export function createMockServer() {
  const handlers: ReturnType<typeof http.get | typeof http.post | typeof http.put | typeof http.delete | typeof http.patch>[] = [];

  const server = setupServer(...handlers);

  return {
    server,
    handlers,

    /**
     * Mock a GET request
     */
    mockGET(url: string, response: MockAPIResponse) {
      const handler = http.get(url, async () => {
        if (response.delay) {
          await new Promise(resolve => setTimeout(resolve, response.delay));
        }
        return HttpResponse.json(response.body, { status: response.status || 200 });
      });
      handlers.push(handler);
      server.use(handler);
    },

    /**
     * Mock a POST request
     */
    mockPOST(url: string, response: MockAPIResponse) {
      const handler = http.post(url, async () => {
        if (response.delay) {
          await new Promise(resolve => setTimeout(resolve, response.delay));
        }
        return HttpResponse.json(response.body, { status: response.status || 200 });
      });
      handlers.push(handler);
      server.use(handler);
    },

    /**
     * Mock a PUT request
     */
    mockPUT(url: string, response: MockAPIResponse) {
      const handler = http.put(url, async () => {
        if (response.delay) {
          await new Promise(resolve => setTimeout(resolve, response.delay));
        }
        return HttpResponse.json(response.body, { status: response.status || 200 });
      });
      handlers.push(handler);
      server.use(handler);
    },

    /**
     * Mock a PATCH request
     */
    mockPATCH(url: string, response: MockAPIResponse) {
      const handler = http.patch(url, async () => {
        if (response.delay) {
          await new Promise(resolve => setTimeout(resolve, response.delay));
        }
        return HttpResponse.json(response.body, { status: response.status || 200 });
      });
      handlers.push(handler);
      server.use(handler);
    },

    /**
     * Mock a DELETE request
     */
    mockDELETE(url: string, response: MockAPIResponse) {
      const handler = http.delete(url, async () => {
        if (response.delay) {
          await new Promise(resolve => setTimeout(resolve, response.delay));
        }
        return HttpResponse.json(response.body, { status: response.status || 200 });
      });
      handlers.push(handler);
      server.use(handler);
    },

    /**
     * Mock network error
     */
    mockNetworkError(url: string) {
      const handler = http.get(url, () => {
        return HttpResponse.error();
      });
      handlers.push(handler);
      server.use(handler);
    },

    /**
     * Clear all handlers
     */
    reset() {
      handlers.length = 0;
      server.resetHandlers();
    },

    /**
     * Start server
     */
    start() {
      server.listen({ onUnhandledRequest: 'bypass' });
    },

    /**
     * Stop server
     */
    stop() {
      server.close();
    },
  };
}

/**
 * PublicAPI mock helpers
 */
export class PublicAPIMock {
  constructor(private baseURL: string, private mockServer: ReturnType<typeof createMockServer>) {}

  /**
   * Mock health endpoint
   */
  mockHealth(healthy = true) {
    this.mockServer.mockGET(`${this.baseURL}/health`, {
      status: healthy ? 200 : 503,
      body: { status: healthy ? 'ok' : 'unhealthy' },
    });
  }

  /**
   * Mock object types list
   */
  mockObjectTypesList(types: Array<{ id: string; name: string; tenant: string }>) {
    this.mockServer.mockGET(`${this.baseURL}/object-types`, {
      body: { docs: types, totalDocs: types.length },
    });
  }

  /**
   * Mock object type creation
   */
  mockObjectTypeCreate(type: { id: string; name: string }) {
    this.mockServer.mockPOST(`${this.baseURL}/object-types`, {
      status: 201,
      body: { id: type.id, name: type.name },
    });
  }

  /**
   * Mock resources list
   */
  mockResourcesList(tenantId: string, objectType: string, resources: Array<{ id: string; data: unknown }>) {
    this.mockServer.mockGET(`${this.baseURL}/v3/resources/${tenantId}/${objectType}`, {
      body: {
        docs: resources,
        totalDocs: resources.length,
        page: 1,
        totalPages: Math.ceil(resources.length / 20),
      },
    });
  }

  /**
   * Mock resource get
   */
  mockResourceGet(tenantId: string, objectType: string, id: string, data: unknown) {
    this.mockServer.mockGET(`${this.baseURL}/v3/resources/${tenantId}/${objectType}/${id}`, {
      body: { id, data, created_at: new Date().toISOString(), version: 1 },
    });
  }

  /**
   * Mock resource create
   */
  mockResourceCreate(tenantId: string, objectType: string, id: string) {
    this.mockServer.mockPOST(`${this.baseURL}/v3/resources/${tenantId}/${objectType}`, {
      status: 201,
      body: { id },
    });
  }

  /**
   * Mock resource update
   */
  mockResourceUpdate(tenantId: string, objectType: string, id: string) {
    this.mockServer.mockPUT(`${this.baseURL}/v3/resources/${tenantId}/${objectType}/${id}`, {
      body: { id, updated: true },
    });
  }

  /**
   * Mock resource delete
   */
  mockResourceDelete(tenantId: string, objectType: string, id: string) {
    this.mockServer.mockDELETE(`${this.baseURL}/v3/resources/${tenantId}/${objectType}/${id}`, {
      status: 204,
      body: null,
    });
  }

  /**
   * Mock chat message
   */
  mockChatSend(tenantId: string, workflowId: string, stage: string, response: string) {
    this.mockServer.mockPOST(`${this.baseURL}/v3/chat/${tenantId}/${workflowId}/${stage}`, {
      body: { response, thread_id: 'test-thread-id', stage },
    });
  }

  /**
   * Mock error response
   */
  mockError(method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, status: number, error: string) {
    const mockMethod = `mock${method}` as keyof typeof this.mockServer;
    if (typeof this.mockServer[mockMethod] === 'function') {
      (this.mockServer[mockMethod] as (url: string, response: MockAPIResponse) => void)(`${this.baseURL}${url}`, {
        status,
        body: { error },
      });
    }
  }
}
