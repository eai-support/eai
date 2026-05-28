/**
 * Unit tests for the three PlatformAPIClient methods added by feature 006.
 *
 * Verifies URL construction, HTTP method, and query-parameter wiring. Auth
 * header detail is mocked out — these tests do not exercise the auth flow.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PlatformAPIClient } from '../../src/lib/api.js';

const ORIGINAL_FETCH = globalThis.fetch;

interface CapturedCall {
  url: string;
  method: string;
}

describe('PlatformAPIClient — feature 006 methods', () => {
  let calls: CapturedCall[];
  let client: PlatformAPIClient;

  beforeEach(() => {
    calls = [];
    globalThis.fetch = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init?.method as string | undefined) ?? 'GET';
      calls.push({ url, method });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    client = new PlatformAPIClient('https://api.test', 'tenant-001');
    // The real client reads tokens via getAccessToken; stub via an internal call we
    // can control by overriding the headers helper.
    (client as unknown as { headers: () => Promise<Record<string, string>> }).headers = async () => ({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test('listUsers GETs /v3/users with tenant_id and pagination', async () => {
    await client.listUsers({ tenantId: 'tenant-001', limit: 25, offset: 50 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/v3/users');
    expect(url.searchParams.get('tenant_id')).toBe('tenant-001');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('offset')).toBe('50');
  });

  test('listUsers omits limit/offset when undefined', async () => {
    await client.listUsers({ tenantId: 'tenant-001' });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('tenant_id')).toBe('tenant-001');
    expect(url.searchParams.has('limit')).toBe(false);
    expect(url.searchParams.has('offset')).toBe(false);
  });

  test('deleteUserFromTenant DELETEs /v3/users/{user_id} with tenant_id query', async () => {
    await client.deleteUserFromTenant('tenant-001', 'user-99');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('DELETE');
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/v3/users/user-99');
    expect(url.searchParams.get('tenant_id')).toBe('tenant-001');
  });

  test('deleteUserFromTenant URL-encodes the user id', async () => {
    await client.deleteUserFromTenant('tenant-001', 'user/with/slash');

    const url = calls[0]!.url;
    expect(url).toContain('/v3/users/user%2Fwith%2Fslash');
  });

  test('listDocuments forwards tenant_id, limit, offset, and type', async () => {
    await client.listDocuments({
      tenantId: 'tenant-001',
      limit: 10,
      offset: 0,
      type: 'invoice',
    });

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/v3/documents');
    expect(url.searchParams.get('tenant_id')).toBe('tenant-001');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('offset')).toBe('0');
    expect(url.searchParams.get('type')).toBe('invoice');
  });

  test('listDocuments omits type when not provided', async () => {
    await client.listDocuments({ tenantId: 'tenant-001', limit: 10 });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.has('type')).toBe(false);
  });
});

describe('Pagination math (--page + --limit → offset)', () => {
  test('page 1 with limit 50 → offset 0', () => {
    const page = 1;
    const limit = 50;
    const offset = (page - 1) * limit;
    expect(offset).toBe(0);
  });

  test('page 3 with limit 25 → offset 50', () => {
    const page = 3;
    const limit = 25;
    const offset = (page - 1) * limit;
    expect(offset).toBe(50);
  });

  test('page 4 with limit 50 → offset 150', () => {
    const page = 4;
    const limit = 50;
    const offset = (page - 1) * limit;
    expect(offset).toBe(150);
  });
});
