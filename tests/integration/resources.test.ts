import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlatformAPIClient } from '../../src/lib/api.js';
import {
  buildMissingPublishedTypeMessage,
  matchPublishedType,
  normalizeBatchCreateItems,
  normalizeBatchDeleteIds,
  normalizeBatchUpdateItems,
} from '../../src/commands/resources.js';
import { buildVerticalEnrollmentData } from '../../src/commands/vertical.js';

vi.mock('../../src/lib/auth.js', () => ({
  getAccessToken: vi.fn(async () => undefined),
}));

describe('resource type diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
      'https://test-api.example.com/v4/data/resources/tenant-1/conversation-message?limit=5&cursor=cursor-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  test('creates root tenants through the public platform router', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new PlatformAPIClient('https://test-api.example.com', 'system');
    await client.createTenant({
      name: 'Root Tenant',
      slug: 'root-tenant',
      domain: ['root.example.com'],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://test-api.example.com/v4/platform/tenants',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          displayName: 'Root Tenant',
          name: 'Root Tenant',
          slug: 'root-tenant',
          domain: ['root.example.com'],
          usecase: 'generic',
        }),
      }),
    );
  });

  test('creates child tenants through the public platform child-tenant route', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new PlatformAPIClient('https://test-api.example.com', 'system');
    await client.createTenant({
      name: 'Child Tenant',
      slug: 'child-tenant',
      parent: 'parent-tenant',
      usecase: 'retail',
      industry: 'retail',
      starterTemplate: 'blank-vertical-template',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://test-api.example.com/v4/platform/tenants/parent-tenant/children',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          displayName: 'Child Tenant',
          slug: 'child-tenant',
          usecase: 'retail',
          industry: 'retail',
          starterTemplate: 'blank-vertical-template',
        }),
      }),
    );
  });

  test('builds dynamic vertical enrollment payloads without child tenant fields', () => {
    expect(buildVerticalEnrollmentData('TikTok V1', 'company-tenant', {
      template: 'blank-vertical-template',
      source: 'eai',
    })).toEqual({
      tenantId: 'company-tenant',
      verticalKey: 'tik-tok-v1',
      displayName: 'TikTok V1',
      status: 'pending',
      source: 'eai',
      templateKey: 'blank-vertical-template',
    });
  });

  test('creates tenant vertical enrollment through ResourceAPI resources route', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new PlatformAPIClient('https://test-api.example.com', 'company-tenant');
    await client.createResource('tenant-vertical-enrollment', {
      tenantId: 'company-tenant',
      verticalKey: 'tiktokv1',
      displayName: 'TikTok V1',
      status: 'pending',
      source: 'eai',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://test-api.example.com/v4/data/resources/company-tenant/tenant-vertical-enrollment',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          data: {
            tenantId: 'company-tenant',
            verticalKey: 'tiktokv1',
            displayName: 'TikTok V1',
            status: 'pending',
            source: 'eai',
          },
        }),
      }),
    );
  });

  test('provisions storage through the PublicAPI storage route', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new PlatformAPIClient('https://test-api.example.com', 'tenant-1');
    await client.provisionStorage({
      backend: 'mongodb',
      dryRun: true,
      rebuildSearch: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://test-api.example.com/v4/data/resources/tenant-1/storage/provision',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          backend: 'documentdb',
          dry_run: true,
          rebuild_search: true,
          provisioning_mode: 'dedicated-tenant-storage',
        }),
      }),
    );
  });

  test('provisions tenant vertical storage through the same ResourceAPI tenant storage route', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new PlatformAPIClient('https://test-api.example.com', 'company-tenant');
    await client.provisionStorage({
      backend: 'documentdb',
      dryRun: false,
      rebuildSearch: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://test-api.example.com/v4/data/resources/company-tenant/storage/provision',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          backend: 'documentdb',
          dry_run: false,
          rebuild_search: false,
          provisioning_mode: 'dedicated-tenant-storage',
        }),
      }),
    );
  });

  test('builds storage status and doctor URLs', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new PlatformAPIClient('https://test-api.example.com', 'tenant-1');
    await client.getResourceStorageStatus();
    await client.getResourceStorageDoctor();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://test-api.example.com/v4/data/resources/tenant-1/storage',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://test-api.example.com/v4/data/resources/tenant-1/storage/doctor',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('builds hybrid search requests with slug-normalized object types', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new PlatformAPIClient('https://test-api.example.com', 'tenant-1');
    await client.searchResources({
      query: 'quarterly forecast',
      objectTypes: ['CustomerProfile'],
      mode: 'hybrid',
      limit: 7,
      includePayload: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://test-api.example.com/v4/data/resources/tenant-1/search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          query: 'quarterly forecast',
          objectTypes: ['customer-profile'],
          mode: 'hybrid',
          limit: 7,
          includePayload: false,
        }),
      }),
    );
  });

  test('uploads resource files as isolated Blob-backed file properties', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'eai-resource-file-'));
    const filePath = join(tmp, 'source note.txt');
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await writeFile(filePath, 'file content');

      const client = new PlatformAPIClient('https://test-api.example.com', 'tenant-1');
      await client.uploadResourceFile('FileAsset', 'resource-1', 'attachment', filePath);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://test-api.example.com/v4/data/resources/tenant-1/file-asset/resource-1/files/attachment?filename=source%20note.txt',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/octet-stream',
          }),
        }),
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
