import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/lib/auth.js', () => ({ getAccessToken: vi.fn(async () => '<fixture-access-token>') }));
vi.mock('../../src/lib/context.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/lib/context.js')>(), resolveCommandContext: vi.fn(),
}));

import { configureDocumentTypeCommand, analyzerIdForDocumentType, definitionDigestForReadback, parseDocumentTypeConfiguration } from '../../src/commands/document-type-config.js';
import { PlatformAPIClient } from '../../src/lib/api.js';
import { resolveCommandContext } from '../../src/lib/context.js';
import { ErrorCode } from '../../src/lib/error-codes.js';
import * as out from '../../src/lib/output.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const gateway = 'https://dev-api.au.myenterprise.ai/public';
const analyzerId = 'Analyser_qa_workspace_Quotation';
const manifest = {
  kind: 'eai.document-type.configuration', schemaVersion: 1, tenantId,
  code: 'Quotation', name: 'Quotation', description: 'Supplier quotation',
  fields: [
    { name: 'supplierName', description: 'Supplier organisation', type: 'string', method: 'extract' },
    { name: 'summary', description: 'One-sentence summary', type: 'string', method: 'generate' },
  ],
};
const definition = { description: 'Supplier quotation', baseAnalyzerId: 'prebuilt-document', fieldSchema: { fields: {
  supplierName: { type: 'string', method: 'extract', description: 'Supplier organisation' },
  summary: { type: 'string', method: 'generate', description: 'One-sentence summary' },
} }, figureOptions: { enableFigureAnalysis: false, enableFigureDescription: false, chartFormat: 'chartjs' } };
const digest = definitionDigestForReadback(definition);

describe('bounded document type configuration', () => {
  let directory: string;
  let file: string;
  let results: Record<string, unknown>[];
  let calls: Array<{ url: URL; init: RequestInit }>;
  let route: (url: URL, init: RequestInit) => Response;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.exitCode = 0;
    directory = await mkdtemp(join(tmpdir(), 'eai-doc-type-'));
    file = join(directory, 'configuration.json');
    await writeFile(file, JSON.stringify(manifest), { mode: 0o600 });
    for (const option of configureDocumentTypeCommand.options) configureDocumentTypeCommand.setOptionValue(option.attributeName(), option.defaultValue);
    vi.mocked(resolveCommandContext).mockResolvedValue({ tenantId, tenantSlug: 'qa-workspace', publicApiUrl: gateway,
      client: new PlatformAPIClient(gateway, tenantId) } as never);
    results = []; calls = [];
    vi.spyOn(out, 'json').mockImplementation(value => { results.push(value as Record<string, unknown>); });
    route = (url, init) => {
      if (url.pathname.endsWith(`/${analyzerId}/upsert`) && init.method === 'POST') {
        return Response.json({ analyzerId, status: 'created' });
      }
      if (url.pathname.endsWith(`/${analyzerId}`) && init.method === 'GET') {
        return Response.json({ analyzerId, definitionDigest: digest, definition });
      }
      if (url.pathname.endsWith('/runtime-document-types/Quotation') && init.method === 'PUT') {
        return Response.json({ success: true, documentType: { code: 'Quotation', name: 'Quotation' } });
      }
      return Response.json({ error: 'fixture route not found' }, { status: 404 });
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input)); const request = init ?? {};
      calls.push({ url, init: request }); return route(url, request);
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks(); process.exitCode = 0;
    await rm(directory, { recursive: true, force: true });
  });

  async function configure(): Promise<Record<string, unknown>> {
    await configureDocumentTypeCommand.parseAsync(['node', 'eai', '--file', file, '--tenant-id', tenantId, '--format', 'json']);
    return results.at(-1)!;
  }

  test('maps described fields to a tenant-owned analyzer and matching runtime rules', async () => {
    const result = await configure();
    expect(result).toMatchObject({ ok: true, status: 'configured', tenantId, code: 'Quotation', analyzerId, definitionDigest: digest, fieldCount: 2 });
    expect(calls.map(({ url, init }) => [url.pathname, init.method])).toEqual([
      [`/public/v4/data/documents/content-understanding/analyzers/${analyzerId}/upsert`, 'POST'],
      [`/public/v4/data/documents/content-understanding/analyzers/${analyzerId}`, 'GET'],
      ['/public/v4/data/documents/runtime-document-types/Quotation', 'PUT'],
    ]);
    expect(calls[1].url.searchParams.get('tenant_id')).toBe(tenantId);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ tenantId, schemaFields: manifest.fields });
    expect(JSON.parse(String(calls[2].init.body))).toMatchObject({ tenantId, code: 'Quotation', rules: [
      { fieldName: 'supplierName', type: 'STRING', method: 'EXTRACT', isActive: true },
      { fieldName: 'summary', type: 'STRING', method: 'GENERATE', isActive: true },
    ] });
  });

  test.each([ErrorCode.E001, ErrorCode.E101, ErrorCode.E104])('reports %s context failures in the JSON envelope before network access', async code => {
    vi.mocked(resolveCommandContext).mockImplementation(async options => {
      if (!options?.onError) throw new Error('missing context error callback');
      options.onError(code);
    });
    const result = await configure();
    expect(result).toMatchObject({ ok: false, phase: 'context', error: { code } });
    expect(calls).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });

  test('rejects provider failure inside HTTP 200 before runtime mutation', async () => {
    route = (url, init) => url.pathname.endsWith('/upsert') && init.method === 'POST'
      ? Response.json({ analyzerId, status: 'failed', error: 'private Azure text' })
      : Response.json({ error: 'unexpected call' }, { status: 500 });
    const result = await configure();
    expect(result).toMatchObject({ ok: false, phase: 'analyzer-upsert', error: { code: 'DOC_TYPE_ANALYZER_UPSERT_FAILED' } });
    expect(JSON.stringify(result)).not.toContain('private Azure text');
    expect(calls).toHaveLength(1);
    expect(process.exitCode).toBe(1);
  });

  test('rejects a mismatched optional upsert workspace identity', async () => {
    const normalRoute = route;
    route = (url, init) => url.pathname.endsWith('/upsert') && init.method === 'POST'
      ? Response.json({ analyzerId, status: 'created', tenantId: '22222222-2222-4222-8222-222222222222' })
      : normalRoute(url, init);
    const result = await configure();
    expect(result).toMatchObject({ ok: false, phase: 'analyzer-upsert', error: { code: 'DOC_TYPE_ANALYZER_UPSERT_FAILED' } });
    expect(calls).toHaveLength(1);
  });

  test('refuses mismatched analyzer readback before activating runtime rules', async () => {
    const normalRoute = route;
    route = (url, init) => init.method === 'GET'
      ? Response.json({ analyzerId, definitionDigest: digest, definition: { fieldSchema: { fields: {} } } })
      : normalRoute(url, init);
    const result = await configure();
    expect(result).toMatchObject({ ok: false, phase: 'analyzer-readback', error: { code: 'DOC_TYPE_ANALYZER_READBACK_MISMATCH' } });
    expect(calls).toHaveLength(2);
  });

  test('rejects a stale digest even when the reported fields match', async () => {
    const normalRoute = route;
    route = (url, init) => init.method === 'GET'
      ? Response.json({ analyzerId, definitionDigest: 'b'.repeat(64), definition })
      : normalRoute(url, init);
    const result = await configure();
    expect(result).toMatchObject({ ok: false, phase: 'analyzer-readback', error: { code: 'DOC_TYPE_ANALYZER_READBACK_MISMATCH' } });
    expect(calls).toHaveLength(2);
  });

  test.each([
    { tenantId: '22222222-2222-4222-8222-222222222222' },
    { tenant_id: '22222222-2222-4222-8222-222222222222' },
    { tenantId, tenant_id: '22222222-2222-4222-8222-222222222222' },
  ])('rejects a mismatched optional readback workspace identity: %j', async identity => {
    const normalRoute = route;
    route = (url, init) => init.method === 'GET'
      ? Response.json({ analyzerId, definitionDigest: digest, definition, ...identity })
      : normalRoute(url, init);
    const result = await configure();
    expect(result).toMatchObject({ ok: false, phase: 'analyzer-readback', error: { code: 'DOC_TYPE_ANALYZER_READBACK_MISMATCH' } });
    expect(calls).toHaveLength(2);
  });

  test('rejects an unexpected advanced field schema even with a valid digest', async () => {
    const normalRoute = route;
    const advancedDefinition = { ...definition, fieldSchema: { ...definition.fieldSchema, tableSchema: {} } };
    route = (url, init) => init.method === 'GET'
      ? Response.json({ analyzerId, definitionDigest: definitionDigestForReadback(advancedDefinition), definition: advancedDefinition })
      : normalRoute(url, init);
    const result = await configure();
    expect(result).toMatchObject({ ok: false, phase: 'analyzer-readback', error: { code: 'DOC_TYPE_ANALYZER_READBACK_MISMATCH' } });
    expect(calls).toHaveLength(2);
  });

  test('rejects a stale provider description even with a self-consistent digest', async () => {
    const normalRoute = route;
    const staleDefinition = { ...definition, description: 'Old supplier format' };
    route = (url, init) => init.method === 'GET'
      ? Response.json({ analyzerId, definitionDigest: definitionDigestForReadback(staleDefinition), definition: staleDefinition })
      : normalRoute(url, init);
    const result = await configure();
    expect(result).toMatchObject({ ok: false, phase: 'analyzer-readback', error: { code: 'DOC_TYPE_ANALYZER_READBACK_MISMATCH' } });
    expect(calls).toHaveLength(2);
  });

  test('rejects provider figure analysis even when its digest is self-consistent', async () => {
    const normalRoute = route;
    const figureDefinition = { ...definition, figureOptions: { ...definition.figureOptions, enableFigureAnalysis: true } };
    route = (url, init) => init.method === 'GET'
      ? Response.json({ analyzerId, definitionDigest: definitionDigestForReadback(figureDefinition), definition: figureDefinition })
      : normalRoute(url, init);
    const result = await configure();
    expect(result).toMatchObject({ ok: false, phase: 'analyzer-readback', error: { code: 'DOC_TYPE_ANALYZER_READBACK_MISMATCH' } });
    expect(calls).toHaveLength(2);
  });

  test('reports a partial runtime failure without pretending the analyzer was rolled back', async () => {
    const normalRoute = route;
    route = (url, init) => init.method === 'PUT'
      ? Response.json({ success: false }, { status: 502 }) : normalRoute(url, init);
    const result = await configure();
    expect(result).toMatchObject({ ok: false, phase: 'runtime-sync', analyzerId,
      error: { code: 'DOC_TYPE_RUNTIME_SYNC_FAILED' } });
  });

  test.each([
    { tenantId: '22222222-2222-4222-8222-222222222222', documentType: { code: 'Quotation', name: 'Quotation' } },
    { tenant_id: '22222222-2222-4222-8222-222222222222', documentType: { code: 'Quotation', name: 'Quotation' } },
    { documentType: { code: 'Quotation', name: 'Quotation', tenantId: '22222222-2222-4222-8222-222222222222' } },
    { documentType: { code: 'Quotation', name: 'Quotation', tenant_id: '22222222-2222-4222-8222-222222222222' } },
  ])('rejects an optional runtime workspace identity for another tenant: %j', async identity => {
    const normalRoute = route;
    route = (url, init) => init.method === 'PUT'
      ? Response.json({ success: true, ...identity }) : normalRoute(url, init);
    const result = await configure();
    expect(result).toMatchObject({ ok: false, phase: 'runtime-sync', error: { code: 'DOC_TYPE_RUNTIME_SYNC_FAILED' } });
    expect(calls).toHaveLength(3);
  });

  test('accepts matching optional runtime workspace identities', async () => {
    const normalRoute = route;
    route = (url, init) => init.method === 'PUT'
      ? Response.json({ success: true, tenantId, tenant_id: tenantId,
        documentType: { code: 'Quotation', name: 'Quotation', tenantId, tenant_id: tenantId } }) : normalRoute(url, init);
    expect(await configure()).toMatchObject({ ok: true, status: 'configured' });
  });

  test('includes the failed phase in text output', async () => {
    const normalRoute = route;
    const errorOutput = vi.spyOn(out, 'error').mockImplementation(() => undefined);
    route = (url, init) => init.method === 'PUT'
      ? Response.json({ success: false }, { status: 502 }) : normalRoute(url, init);
    await configureDocumentTypeCommand.parseAsync(['node', 'eai', '--file', file, '--tenant-id', tenantId, '--format', 'text']);
    expect(errorOutput).toHaveBeenCalledWith(expect.stringContaining('runtime-sync:'));
    expect(process.exitCode).toBe(1);
  });

  test('accepts integer rules while verifying the provider-normalized number field', async () => {
    const integerManifest = { ...manifest, fields: [{ name: 'quantity', description: 'Quantity ordered', type: 'integer', method: 'extract' }] };
    await writeFile(file, JSON.stringify(integerManifest));
    const integerDefinition = { description: integerManifest.description, baseAnalyzerId: 'prebuilt-document',
      fieldSchema: { fields: { quantity: { type: 'number', method: 'extract', description: 'Quantity ordered' } } }, figureOptions: {} };
    const normalRoute = route;
    route = (url, init) => init.method === 'GET'
      ? Response.json({ analyzerId, definitionDigest: definitionDigestForReadback(integerDefinition), definition: integerDefinition })
      : normalRoute(url, init);
    const result = await configure();
    expect(result).toMatchObject({ ok: true, status: 'configured', fieldCount: 1 });
    expect(JSON.parse(String(calls[2].init.body))).toMatchObject({ rules: [{ fieldName: 'quantity', type: 'INTEGER' }] });
  });

  test('validates bounds and rejects advanced or tenant-mismatched input before network access', async () => {
    expect(() => parseDocumentTypeConfiguration({ ...manifest, figureOptions: {} })).toThrow();
    expect(() => parseDocumentTypeConfiguration({ ...manifest, tenantId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' })).toThrow();
    expect(() => parseDocumentTypeConfiguration({ ...manifest, code: 'invoice-v1' })).toThrow();
    expect(() => parseDocumentTypeConfiguration({ ...manifest, code: 'invoice.v1' })).toThrow();
    expect(() => parseDocumentTypeConfiguration({ ...manifest, fields: [manifest.fields[0], { ...manifest.fields[0], name: 'SUPPLIERNAME' }] })).toThrow();
    expect(parseDocumentTypeConfiguration({ ...manifest, tenantId: 'aaaaaaaa-aaaa-aaaa-faaa-aaaaaaaaaaaa' }).tenantId)
      .toBe('aaaaaaaa-aaaa-aaaa-faaa-aaaaaaaaaaaa');
    await writeFile(file, JSON.stringify({ ...manifest, tenantId: '22222222-2222-4222-8222-222222222222' }));
    const result = await configure();
    expect(result).toMatchObject({ ok: false, phase: 'validation', error: { code: 'DOC_TYPE_TENANT_MISMATCH' } });
    expect(resolveCommandContext).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  test('uses the Admin Portal identifier algorithm for long tenant and type names', () => {
    const id = analyzerIdForDocumentType('very-long-tenant-slug-for-an-enterprise-workspace', 'Long_Document_Type');
    expect(id).toMatch(/^Analyser_[A-Za-z0-9_]+_[a-f0-9]{16}$/);
    expect(id).toHaveLength(64);
  });

  test('matches PublicAPI Python canonical digest for non-ASCII descriptions', () => {
    expect(definitionDigestForReadback({ description: 'Résumé', baseAnalyzerId: 'prebuilt-document',
      fieldSchema: { fields: { summary: { description: 'Résumé rapide', method: 'generate', type: 'string' } } },
      figureOptions: {} })).toBe('963a373c355ad973eee142dd67bf7d3085c232ef262aefc298a6b6c5695e2686');
  });
});
