import { describe, expect, test, vi } from 'vitest';
import { readConsistentObjectTypes } from '../../src/lib/object-type-export.js';

const tenantId = 'owned-tenant';
const documents = (count: number): Record<string, unknown>[] => Array.from({ length: count }, (_, index) => ({
  id: `id-${String(index).padStart(4, '0')}`, name: `HistoricalName${index}`, slug: `legacy-aisummary-${index}`,
  tenant: tenantId, status: index % 2 ? 'draft' : 'published', platformMetadata: { retained: [index, null] },
}));

function page(docs: Record<string, unknown>[], requested: number, emptyPages = 1): Record<string, unknown> {
  const totalPages = docs.length ? Math.ceil(docs.length / 100) : emptyPages;
  return { docs: docs.slice((requested - 1) * 100, requested * 100), totalDocs: docs.length, totalPages,
    limit: 100, page: requested, pagingCounter: (requested - 1) * 100 + 1,
    hasPrevPage: requested > 1, hasNextPage: requested < totalPages, prevPage: requested > 1 ? requested - 1 : null,
    nextPage: requested < totalPages ? requested + 1 : null };
}

const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

describe('complete Object Type read exports', () => {
  test.each([1, 100, 200, 205])('exports all %i definitions over two complete scans', async count => {
    const docs = documents(count);
    const client = { getPublishedObjectTypes: vi.fn(async (options?: { page?: number }) => response(page(docs, options?.page ?? 1))) };
    expect(await readConsistentObjectTypes(client, tenantId)).toEqual(docs);
    expect(client.getPublishedObjectTypes.mock.calls.map(([options]) => options?.page))
      .toEqual([...Array.from({ length: Math.ceil(count / 100) }, (_, i) => i + 1), ...Array.from({ length: Math.ceil(count / 100) }, (_, i) => i + 1)]);
    for (const [options] of client.getPublishedObjectTypes.mock.calls) {
      expect(options).toMatchObject({ limit: 100, sort: 'id', timeoutMs: expect.any(Number) });
    }
  });

  test.each([0, 1])('accepts the legitimate empty collection totalPages=%i', async totalPages => {
    const client = { getPublishedObjectTypes: vi.fn(async () => response(page([], 1, totalPages))) };
    expect(await readConsistentObjectTypes(client, tenantId)).toEqual([]);
    expect(client.getPublishedObjectTypes).toHaveBeenCalledTimes(2);
  });

  test('treats the two legitimate empty representations as equivalent', async () => {
    const client = { getPublishedObjectTypes: vi.fn().mockResolvedValueOnce(response(page([], 1, 0))).mockResolvedValueOnce(response(page([], 1, 1))) };
    expect(await readConsistentObjectTypes(client, tenantId)).toEqual([]);
  });

  test('preserves legacy optional null/omitted arrays, unknown fields and exact identifiers', async () => {
    const docs = [{ id: 'legacy', name: 'LegacyAISummary', slug: 'legacy-aisummary', properties: null,
      linkTypes: null, unknown: { actions: null, precise: ['unchanged'] } }];
    const client = { getPublishedObjectTypes: async () => response(page(docs, 1)) };
    expect(await readConsistentObjectTypes(client, tenantId)).toEqual(docs);
    expect((await readConsistentObjectTypes(client, tenantId))[0]).not.toHaveProperty('actions');
  });

  test.each(['totalDocs', 'totalPages', 'page', 'pagingCounter', 'limit', 'hasPrevPage', 'hasNextPage', 'prevPage', 'nextPage'])
    ('rejects missing %s metadata', async field => {
      const payload = page(documents(1), 1); delete payload[field];
      await expect(readConsistentObjectTypes({ getPublishedObjectTypes: async () => response(payload) }, tenantId)).rejects.toThrow('pagination');
    });

  test.each([
    { totalDocs: -1 }, { totalDocs: 1.5 }, { totalPages: 2 }, { page: 2 }, { limit: 50 },
    { pagingCounter: 0 }, { prevPage: 0 }, { hasPrevPage: true }, { hasNextPage: 'false' }, { nextPage: 2 },
  ])('rejects inconsistent metadata %j', async invalid => {
    await expect(readConsistentObjectTypes({ getPublishedObjectTypes: async () => response({ ...page(documents(1), 1), ...invalid }) }, tenantId))
      .rejects.toThrow('pagination');
  });

  test('rejects a short nonterminal page', async () => {
    const payload = page(documents(205), 1); payload.docs = documents(99);
    await expect(readConsistentObjectTypes({ getPublishedObjectTypes: async () => response(payload) }, tenantId)).rejects.toThrow('pagination');
  });

  test('rejects an ignored page selector and repeated IDs without deduplicating', async () => {
    const docs = documents(205);
    const client = { getPublishedObjectTypes: async (options?: { page?: number }) => response({ ...page(docs, options?.page ?? 1), docs: docs.slice(0, 100) }) };
    await expect(readConsistentObjectTypes(client, tenantId)).rejects.toThrow('repeated document IDs');
  });

  test('rejects count changes within a scan', async () => {
    let calls = 0;
    const client = { getPublishedObjectTypes: async (options?: { page?: number }) => response(page(documents(++calls === 1 ? 205 : 206), options?.page ?? 1)) };
    await expect(readConsistentObjectTypes(client, tenantId)).rejects.toThrow('pagination');
  });

  test('detects a same-count change on the middle page of the second scan', async () => {
    const docs = documents(205); let calls = 0;
    const client = { getPublishedObjectTypes: async (options?: { page?: number }) => {
      calls += 1;
      const snapshot = structuredClone(docs);
      if (calls > 3) snapshot[150].platformMetadata = { retained: ['changed'] };
      return response(page(snapshot, options?.page ?? 1));
    } };
    await expect(readConsistentObjectTypes(client, tenantId)).rejects.toThrow('changed during pull');
  });

  test.each(['tenant', 'tenantId', 'tenant_id'])('rejects explicit foreign %s scope', async key => {
    const docs = [{ ...documents(1)[0], [key]: 'foreign-tenant' }];
    await expect(readConsistentObjectTypes({ getPublishedObjectTypes: async () => response(page(docs, 1)) }, tenantId)).rejects.toThrow('outside the selected workspace');
  });

  test('rejects foreign populated tenant relationships', async () => {
    const docs = [{ ...documents(1)[0], tenant: { id: 'foreign-tenant' } }];
    await expect(readConsistentObjectTypes({ getPublishedObjectTypes: async () => response(page(docs, 1)) }, tenantId)).rejects.toThrow('outside the selected workspace');
  });

  test('later-page outages remain failures', async () => {
    const client = { getPublishedObjectTypes: async (options?: { page?: number }) => options?.page === 2 ? response({ secret: 'do-not-print' }, 503) : response(page(documents(205), 1)) };
    await expect(readConsistentObjectTypes(client, tenantId)).rejects.toThrow('HTTP 503');
  });

  test('bounds pages and combined bytes across both scans', async () => {
    const docs = documents(205);
    await expect(readConsistentObjectTypes({ getPublishedObjectTypes: async () => response(page(docs, 1)) }, tenantId, { maxPages: 2 })).rejects.toThrow('page bound');
    const single = page(documents(1), 1);
    await expect(readConsistentObjectTypes({ getPublishedObjectTypes: async () => response(single) }, tenantId,
      { maxBytes: Buffer.byteLength(JSON.stringify(single)) + 10 })).rejects.toThrow('size bound');
  });

  test('bounds a request which ignores cancellation', async () => {
    const client = { getPublishedObjectTypes: async (): Promise<Response> => new Promise(() => {}) };
    await expect(readConsistentObjectTypes(client, tenantId, { timeoutMs: 15 })).rejects.toThrow('deadline');
  });

  test('bounds a stalled response body', async () => {
    const client = { getPublishedObjectTypes: async () => new Response(new ReadableStream({ pull: async () => new Promise(() => {}) })) };
    await expect(readConsistentObjectTypes(client, tenantId, { timeoutMs: 15 })).rejects.toThrow('deadline');
  });

  test('does not expose reader error text which imitates an internal error', async () => {
    const client = { getPublishedObjectTypes: async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('Object Type pull exceeded PRIVATE-SECRET')); } })) };
    let caught: unknown;
    try { await readConsistentObjectTypes(client, tenantId); } catch (error) { caught = error; }
    expect(String(caught)).toContain('could not read'); expect(String(caught)).not.toContain('PRIVATE-SECRET');
  });
});
