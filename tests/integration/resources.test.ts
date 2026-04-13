import { afterEach, describe, expect, test, vi } from 'vitest';
import { PlatformAPIClient } from '../../src/lib/api.js';
import {
  buildMissingPublishedTypeMessage,
  matchPublishedType,
  normalizeBatchCreateItems,
  normalizeBatchDeleteIds,
  normalizeBatchUpdateItems,
} from '../../src/commands/resources.js';

vi.mock('../../src/lib/auth.js', () => ({
  getAccessToken: vi.fn(async () => undefined),
}));

describe('resource type diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('matches published type by slug-compatible name', () => {
    const match = matchPublishedType('ConversationMessage', [{
      name: 'conversation-message',
      slug: 'conversation-message',
      properties: [],
      linkTypes: [],
      actions: [],
    }]);

    expect(match.matchedType?.slug).toBe('conversation-message');
  });

  test('describes empty published schema clearly', () => {
    const message = buildMissingPublishedTypeMessage(matchPublishedType('ConversationMessage', []));

    expect(message).toContain('No published object types were found for the active tenant');
    expect(message).toContain('ConversationMessage');
  });

  test('describes mismatched requested type using published names', () => {
    const message = buildMissingPublishedTypeMessage(matchPublishedType('ConversationMessage', [{
      name: 'Application',
      slug: 'application',
      properties: [],
      linkTypes: [],
      actions: [],
    }]));

    expect(message).toContain('Object type "ConversationMessage" is not published');
    expect(message).toContain('Application');
  });

  test('normalizes batch create payloads from arrays and single objects', () => {
    expect(normalizeBatchCreateItems([{ id: '1' }])).toEqual([{ data: { id: '1' } }]);
    expect(normalizeBatchCreateItems({ id: '2' })).toEqual([{ data: { id: '2' } }]);
  });

  test('normalizes batch update payloads from items wrapper', () => {
    expect(normalizeBatchUpdateItems({
      items: [
        { id: '123', data: { status: 'submitted' }, version: 2 },
      ],
    })).toEqual([
      { id: '123', data: { status: 'submitted' }, version: 2 },
    ]);
  });

  test('normalizes batch delete payload ids', () => {
    expect(normalizeBatchDeleteIds({ ids: [123, '456'] })).toEqual(['123', '456']);
  });

  test('builds cursor-aware list URLs for resource reads', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new PlatformAPIClient('https://test-api.example.com', 'tenant-1');
    await client.listResources('ConversationMessage', {
      limit: 5,
      cursor: 'cursor-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://test-api.example.com/v3/resources/tenant-1/conversation-message?limit=5&cursor=cursor-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  test('creates root tenants through payload custom-tenants', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new PlatformAPIClient('https://test-api.example.com', 'system');
    await client.createTenant({
      name: 'Root Tenant',
      slug: 'root-tenant',
      domain: ['root.example.com'],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://test-api.example.com/v3/orchestrate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          target_backend: 'payload',
          endpoint: '/custom-tenants',
          method: 'POST',
          body: {
            displayName: 'Root Tenant',
            name: 'Root Tenant',
            slug: 'root-tenant',
            parentTenant: undefined,
            domain: ['root.example.com'],
          },
          params: undefined,
        }),
      }),
    );
  });

  test('creates child tenants through the admin child-tenant route', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new PlatformAPIClient('https://test-api.example.com', 'system');
    await client.createTenant({
      name: 'Child Tenant',
      slug: 'child-tenant',
      parent: 'parent-tenant',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://test-api.example.com/v3/orchestrate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          target_backend: 'admin',
          endpoint: '/v1/tenants/parent-tenant/children',
          method: 'POST',
          body: {
            displayName: 'Child Tenant',
            slug: 'child-tenant',
            usecase: 'generic',
          },
          params: undefined,
        }),
      }),
    );
  });
});
