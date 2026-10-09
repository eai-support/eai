/** Complete, bounded and lossless exports of the published Object Type read contract. */
import { awaitManagedRequestDeadline, type PlatformAPIClient } from './api.js';
import { isRecord } from './utils.js';

/** Export bounds: pages per scan, aggregate response bytes and elapsed milliseconds shared by both scans. */
export interface ObjectTypeExportLimits {
  readonly maxPages: number;
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

/** Frozen maximum export budgets; callers may reduce each bound but cannot raise it. */
export const OBJECT_TYPE_EXPORT_LIMITS: Readonly<ObjectTypeExportLimits> = Object.freeze({
  maxPages: 1_000,
  maxBytes: 64 * 1024 * 1024,
  timeoutMs: 120_000,
});

interface ExportPage {
  docs: Record<string, unknown>[];
  totalDocs: number;
  totalPages: number;
}

class ExportBoundError extends Error {}

function invalidPage(): never {
  throw new Error('Object Type pull returned invalid or incomplete pagination metadata. Existing output is preserved.');
}

function parsePage(value: unknown, page: number, tenantId: string): ExportPage {
  if (!isRecord(value) || !Array.isArray(value.docs)) invalidPage();
  const totalDocs = value.totalDocs;
  const totalPages = value.totalPages;
  if (typeof totalDocs !== 'number' || !Number.isSafeInteger(totalDocs) || totalDocs < 0
    || typeof totalPages !== 'number' || !Number.isSafeInteger(totalPages)
    || value.limit !== 100 || value.page !== page || value.pagingCounter !== (page - 1) * 100 + 1) invalidPage();
  const empty = totalDocs === 0;
  if (empty ? page !== 1 || ![0, 1].includes(totalPages) : totalPages !== Math.ceil(totalDocs / 100) || page > totalPages) invalidPage();
  const hasNextPage = !empty && page < totalPages;
  if (value.hasPrevPage !== (page > 1) || value.hasNextPage !== hasNextPage
    || value.prevPage !== (page > 1 ? page - 1 : null)
    || value.nextPage !== (hasNextPage ? page + 1 : null)
    || value.docs.length !== Math.min(100, Math.max(0, totalDocs - (page - 1) * 100))) invalidPage();

  const docs: Record<string, unknown>[] = [];
  for (const doc of value.docs) {
    if (!isRecord(doc) || ['id', 'name', 'slug'].some(key => typeof doc[key] !== 'string' || !(doc[key] as string).trim())
      || ['properties', 'linkTypes', 'actions'].some(key => doc[key] !== undefined && doc[key] !== null && !Array.isArray(doc[key]))) {
      throw new Error('Object Type pull returned an invalid Object Type read document. Existing output is preserved.');
    }
    const tenant = typeof doc.tenant === 'string' ? doc.tenant
      : isRecord(doc.tenant) && typeof doc.tenant.id === 'string' ? doc.tenant.id : undefined;
    if ([tenant, doc.tenantId, doc.tenant_id].some(scope => typeof scope === 'string' && scope !== tenantId)) {
      throw new Error('Object Type pull returned a document outside the selected workspace. Existing output is preserved.');
    }
    docs.push(doc);
  }
  return { docs, totalDocs, totalPages };
}

function canonicalDocuments(docs: Record<string, unknown>[]): string {
  try {
    return JSON.stringify(docs, (_key, value: unknown) => isRecord(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
      : value);
  } catch {
    throw new Error('Object Type pull could not compare the complete export. Existing output is preserved.');
  }
}

/** Two complete scans detect observed drift; this API does not issue a transactional snapshot token. */
export async function readConsistentObjectTypes(
  client: Pick<PlatformAPIClient, 'getPublishedObjectTypes'>,
  tenantId: string,
  requestedLimits: Partial<ObjectTypeExportLimits> = {},
): Promise<Record<string, unknown>[]> {
  const limits = { ...OBJECT_TYPE_EXPORT_LIMITS, ...requestedLimits };
  for (const key of ['maxPages', 'maxBytes', 'timeoutMs'] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > OBJECT_TYPE_EXPORT_LIMITS[key]) {
      throw new Error('Object Type pull limits must be positive and cannot exceed the export bounds.');
    }
  }
  const start = performance.now();
  const signal = AbortSignal.timeout(limits.timeoutMs);
  let bytesRead = 0;

  const remaining = (): number => {
    const time = Math.floor(limits.timeoutMs - (performance.now() - start));
    if (signal.aborted || time < 1) throw new ExportBoundError('Object Type pull exceeded its deadline. Existing output is preserved.');
    return time;
  };

  const readBody = async (response: Response): Promise<unknown> => {
    if (!response.body) throw new Error('Object Type pull returned an invalid JSON response.');
    const declared = response.headers.get('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > limits.maxBytes - bytesRead) {
      void response.body.cancel().catch(() => {});
      throw new ExportBoundError('Object Type pull exceeded its response size bound. Existing output is preserved.');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let complete = false;
    try {
      for (;;) {
        remaining();
        const chunk = await awaitManagedRequestDeadline(signal, reader.read());
        if (chunk.done) { complete = true; break; }
        bytesRead += chunk.value.byteLength;
        if (bytesRead > limits.maxBytes) throw new ExportBoundError('Object Type pull exceeded its response size bound. Existing output is preserved.');
        chunks.push(chunk.value);
      }
    } catch (error) {
      // eslint-disable-next-line preserve-caught-error -- response-reader errors may contain credentials; retain no upstream cause.
      if (signal.aborted) throw new Error('Object Type pull exceeded its deadline. Existing output is preserved.');
      if (error instanceof ExportBoundError) throw error;
      // eslint-disable-next-line preserve-caught-error -- deliberately replace untrusted reader content with static guidance.
      throw new Error('Object Type pull could not read the complete response. Existing output is preserved.');
    } finally {
      if (!complete) void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
    catch { throw new Error('Object Type pull returned an invalid JSON response.'); }
  };

  const scan = async (): Promise<Record<string, unknown>[]> => {
    const docs: Record<string, unknown>[] = [];
    const ids = new Set<string>();
    let expected: ExportPage | undefined;
    for (let page = 1; page <= (expected ? Math.max(1, expected.totalPages) : 1); page += 1) {
      if (page > limits.maxPages) throw new Error('Object Type pull exceeded its page bound. Existing output is preserved.');
      let response: Response;
      try {
        response = await awaitManagedRequestDeadline(signal, client.getPublishedObjectTypes({ limit: 100, sort: 'id', page, timeoutMs: remaining() }));
      } catch {
        if (signal.aborted) throw new Error('Object Type pull exceeded its deadline. Existing output is preserved.');
        throw new Error('Object Type pull request failed.');
      }
      if (!response.ok) {
        if (response.body) void response.body.cancel().catch(() => {});
        throw new Error(`Object Type pull failed (HTTP ${response.status}).`);
      }
      const result = parsePage(await readBody(response), page, tenantId);
      if (result.totalPages > limits.maxPages) throw new Error('Object Type pull exceeded its page bound. Existing output is preserved.');
      if (expected && (result.totalDocs !== expected.totalDocs || result.totalPages !== expected.totalPages)) invalidPage();
      expected ??= result;
      for (const doc of result.docs) {
        const id = doc.id as string;
        if (ids.has(id)) throw new Error('Object Type pull returned repeated document IDs. Existing output is preserved.');
        ids.add(id);
        docs.push(doc);
      }
    }
    return docs;
  };

  const first = await scan();
  const second = await scan();
  if (canonicalDocuments(first) !== canonicalDocuments(second)) {
    throw new Error('Object Types changed during pull. Run the complete export again; existing output is preserved.');
  }
  remaining();
  return first;
}
