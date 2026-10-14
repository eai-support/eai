import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Command, Option } from 'commander';
import { resolveCommandContext } from '../lib/context.js';
import { requireManagedPublicApiUrl } from '../lib/managed-public-api.js';
import { errorCatalog } from '../lib/error-codes.js';
import { isRecord } from '../lib/utils.js';
import * as out from '../lib/output.js';

const KIND = 'eai.document-type.configuration';
const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The Admin Portal maps punctuation to underscores in analyzer IDs. Allow only
// characters that survive that mapping so distinct codes cannot share one ID.
const CODE = /^[A-Za-z0-9][A-Za-z0-9_]{0,63}$/;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FIELD_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'date', 'time']);
const METHODS = new Set(['extract', 'generate']);

interface Field {
  name: string;
  description: string;
  type: string;
  method: string;
}

interface Manifest {
  kind: typeof KIND;
  schemaVersion: 1;
  tenantId: string;
  code: string;
  name: string;
  description: string;
  fields: Field[];
}

interface ConfigureOptions {
  file: string;
  tenantId: string;
  format: 'text' | 'json';
}

class ConfigurationError extends Error {
  constructor(readonly code: string, message: string, readonly phase: string = 'validation', readonly status?: number) {
    super(message);
  }
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function responseTenantMatches(body: Record<string, unknown>, tenantId: string): boolean {
  return ['tenantId', 'tenant_id'].every(key => !Object.prototype.hasOwnProperty.call(body, key) || body[key] === tenantId);
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max;
}

export function parseDocumentTypeConfiguration(value: unknown): Manifest {
  if (!isRecord(value) || !exactKeys(value, ['kind', 'schemaVersion', 'tenantId', 'code', 'name', 'description', 'fields'])
    || value.kind !== KIND || value.schemaVersion !== 1 || typeof value.tenantId !== 'string' || !TENANT_ID.test(value.tenantId)
    || value.tenantId === '00000000-0000-0000-0000-000000000000'
    || typeof value.code !== 'string' || !CODE.test(value.code)
    || !boundedText(value.name, 128) || !boundedText(value.description, 1000)
    || !Array.isArray(value.fields) || value.fields.length < 1 || value.fields.length > 32) {
    throw new ConfigurationError('DOC_TYPE_CONFIGURATION_INVALID', 'Configuration requires a lowercase canonical workspace UUID, document code, name, description and 1–32 supported fields.');
  }
  const fields: Field[] = [];
  const names = new Set<string>();
  for (const field of value.fields) {
    if (!isRecord(field) || !exactKeys(field, ['name', 'description', 'type', 'method'])
      || typeof field.name !== 'string' || !FIELD_NAME.test(field.name)
      || !boundedText(field.description, 500) || typeof field.type !== 'string' || !FIELD_TYPES.has(field.type)
      || typeof field.method !== 'string' || !METHODS.has(field.method) || names.has(field.name.toLowerCase())) {
      throw new ConfigurationError('DOC_TYPE_CONFIGURATION_INVALID', 'Each field needs a unique name, bounded description, supported scalar type and extract/generate method.');
    }
    names.add(field.name.toLowerCase());
    fields.push({ name: field.name, description: field.description, type: field.type, method: field.method });
  }
  return { kind: KIND, schemaVersion: 1, tenantId: value.tenantId, code: value.code,
    name: value.name, description: value.description, fields };
}

async function readManifest(path: string): Promise<Manifest> {
  let bytes: Buffer;
  try { bytes = await readFile(path); }
  catch { throw new ConfigurationError('DOC_TYPE_CONFIGURATION_INVALID', 'Configuration file could not be read.'); }
  if (bytes.length > 65536) throw new ConfigurationError('DOC_TYPE_CONFIGURATION_INVALID', 'Configuration file exceeds 64 KiB.');
  try {
    return parseDocumentTypeConfiguration(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)) as unknown);
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError('DOC_TYPE_CONFIGURATION_INVALID', 'Configuration file must contain UTF-8 JSON.');
  }
}

/** Match the Admin Portal's deterministic, bounded provider identifier. */
export function analyzerIdForDocumentType(tenantSlug: string, code: string): string {
  const normalized = `Analyser_${tenantSlug}_${code}`.replace(/[^A-Za-z0-9_]/g, '_');
  if (normalized.length <= 64) return normalized;
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return `${normalized.slice(0, 47)}_${digest}`;
}

function sortedJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedJsonValue(value[key])]));
  return value;
}

/** PublicAPI hashes its safe readback with Python json.dumps(sort_keys=True, separators=(',', ':')). */
export function definitionDigestForReadback(definition: Record<string, unknown>): string {
  const canonical = JSON.stringify(sortedJsonValue(definition)).replace(/[\u007f-\uffff]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return createHash('sha256').update(canonical).digest('hex');
}

async function jsonBody(response: Response, phase: string): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new ConfigurationError('DOC_TYPE_RESPONSE_INVALID', 'Platform returned a non-JSON response.', phase, response.status); }
  if (!isRecord(value)) throw new ConfigurationError('DOC_TYPE_RESPONSE_INVALID', 'Platform returned an invalid response.', phase, response.status);
  return value;
}

function requireProviderFields(body: Record<string, unknown>, tenantId: string, analyzerId: string, description: string, fields: Field[]): string {
  const definition = body.definition;
  const schema = isRecord(definition) ? definition.fieldSchema : undefined;
  const observed = isRecord(schema) ? schema.fields : undefined;
  const digest = body.definitionDigest;
  if (!responseTenantMatches(body, tenantId) || body.analyzerId !== analyzerId
    || !isRecord(schema) || Object.keys(schema).length !== 1 || !exactKeys(schema, ['fields'])
    || !isRecord(observed) || Object.keys(observed).length !== fields.length
    || typeof digest !== 'string' || !/^[a-f0-9]{64}$/i.test(digest)
    || !isRecord(definition) || Object.keys(definition).length !== 4
    || !exactKeys(definition, ['description', 'baseAnalyzerId', 'fieldSchema', 'figureOptions'])
    || definition.description !== description || definition.baseAnalyzerId !== 'prebuilt-document'
    || !isRecord(definition.figureOptions)
    || Object.keys(definition.figureOptions).some(key => !['enableFigureAnalysis', 'enableFigureDescription', 'chartFormat'].includes(key))
    || (definition.figureOptions.enableFigureAnalysis !== undefined && definition.figureOptions.enableFigureAnalysis !== false)
    || (definition.figureOptions.enableFigureDescription !== undefined && definition.figureOptions.enableFigureDescription !== false)
    || (definition.figureOptions.chartFormat !== undefined && definition.figureOptions.chartFormat !== 'chartjs')
    || fields.some(field => {
      const actual = observed[field.name];
      return !isRecord(actual) || actual.type !== (field.type === 'integer' ? 'number' : field.type)
        || actual.method !== field.method || actual.description !== field.description
        || (actual.required !== undefined && actual.required !== false)
        || Object.keys(actual).some(key => !['type', 'method', 'description', 'required'].includes(key));
    }) || digest.toLowerCase() !== definitionDigestForReadback(definition)) {
    throw new ConfigurationError('DOC_TYPE_ANALYZER_READBACK_MISMATCH', 'Analyzer readback does not match the requested fields. Runtime rules were not changed.', 'analyzer-readback');
  }
  return digest;
}

export const configureDocumentTypeCommand = new Command('configure-type')
  .description('Configure bounded tenant-owned document fields for an existing classifier workflow')
  .requiredOption('--file <path>', 'Document type configuration JSON')
  .requiredOption('--tenant-id <id>', 'Exact owning workspace UUID, matching the file')
  .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'))
  .addHelpText('after', `\nUse a JSON file with kind "${KIND}", schemaVersion 1, tenantId, code, name, description,
and 1–32 fields with name, description, scalar type and extract/generate method.
Codes use letters, numbers and underscores only; punctuation could collide in provider IDs.
Use a lowercase canonical workspace UUID in the file and --tenant-id.
Example:
  {"kind":"${KIND}","schemaVersion":1,"tenantId":"<workspace-id>",
   "code":"Quotation","name":"Quotation","description":"Supplier quotation",
   "fields":[{"name":"supplierName","description":"Supplier organisation", "type":"string","method":"extract"},
             {"name":"summary","description":"One-sentence summary", "type":"string","method":"generate"}]}
Run inside an initialized EAI project with an explicit --profile for the intended environment.
The command verifies the tenant-owned analyzer before syncing runtime rules.
It does not publish a classifier, bind an app/workflow, enable typed CU v2, or upload a document.
On partial failure, retain the same file and retry only after inspecting the reported phase.
`)
  .action(async (options: ConfigureOptions) => {
    let phase = 'validation';
    let analyzerId: string | undefined;
    try {
      const manifest = await readManifest(options.file);
      if (options.tenantId !== manifest.tenantId) throw new ConfigurationError('DOC_TYPE_TENANT_MISMATCH', '--tenant-id must match the configuration tenantId.');
      phase = 'context';
      const context = await resolveCommandContext({ tenantId: manifest.tenantId, interactive: false, forceRefresh: true,
        validatePublicApiUrl: requireManagedPublicApiUrl, pinPublicApiUrl: true,
        onError: (code, message) => { throw new ConfigurationError(code, message ?? errorCatalog[code].message, phase); } });
      if (context.tenantId !== manifest.tenantId || !boundedText(context.tenantSlug, 128)) {
        throw new ConfigurationError('DOC_TYPE_TENANT_MISMATCH', 'Resolved workspace does not match the requested configuration.');
      }
      analyzerId = analyzerIdForDocumentType(context.tenantSlug, manifest.code);
      const analyzerPath = `/v4/data/documents/content-understanding/analyzers/${encodeURIComponent(analyzerId)}`;
      phase = 'analyzer-upsert';
      const upsert = await context.client.requestPublicApi(`${analyzerPath}/upsert`, { method: 'POST', body: {
        tenantId: manifest.tenantId, description: manifest.description, schemaFields: manifest.fields,
      } });
      const upsertBody = await jsonBody(upsert, phase);
      if (!upsert.ok || !responseTenantMatches(upsertBody, manifest.tenantId)
        || upsertBody.analyzerId !== analyzerId || !['created', 'updated'].includes(String(upsertBody.status))) {
        throw new ConfigurationError('DOC_TYPE_ANALYZER_UPSERT_FAILED', 'Analyzer creation or update did not complete. Runtime rules were not changed.', phase, upsert.status);
      }
      phase = 'analyzer-readback';
      const readback = await context.client.requestPublicApi(analyzerPath, { method: 'GET', params: { tenant_id: manifest.tenantId } });
      if (!readback.ok) throw new ConfigurationError('DOC_TYPE_ANALYZER_READBACK_FAILED', 'Analyzer readback failed. Runtime rules were not changed.', phase, readback.status);
      const definitionDigest = requireProviderFields(await jsonBody(readback, phase), manifest.tenantId, analyzerId, manifest.description, manifest.fields);
      phase = 'runtime-sync';
      const runtime = await context.client.requestPublicApi(`/v4/data/documents/runtime-document-types/${encodeURIComponent(manifest.code)}`, {
        method: 'PUT', body: { tenantId: manifest.tenantId, name: manifest.name, code: manifest.code,
          description: manifest.description, isActive: true,
          rules: manifest.fields.map(field => ({ fieldName: field.name, fieldDescription: field.description,
            type: field.type.toUpperCase(), method: field.method.toUpperCase(), isActive: true })) },
      });
      const runtimeBody = await jsonBody(runtime, phase);
      const documentType = runtimeBody.documentType;
      if (!runtime.ok || runtimeBody.success !== true || !responseTenantMatches(runtimeBody, manifest.tenantId)
        || !isRecord(documentType) || !responseTenantMatches(documentType, manifest.tenantId)
        || documentType.code !== manifest.code || documentType.name !== manifest.name) {
        throw new ConfigurationError('DOC_TYPE_RUNTIME_SYNC_FAILED', 'Runtime document rules were not confirmed. The analyzer may exist; inspect and retry the same file.', phase, runtime.status);
      }
      const result = { ok: true, status: 'configured', tenantId: manifest.tenantId, code: manifest.code,
        analyzerId, definitionDigest, fieldCount: manifest.fields.length };
      if (options.format === 'json') out.json(result);
      else out.success(`Document type ${manifest.code} configured with ${manifest.fields.length} fields.`);
    } catch (error) {
      const known = error instanceof ConfigurationError ? error : new ConfigurationError('DOC_TYPE_CONFIGURATION_FAILED',
        'Document type configuration did not complete. Inspect the current phase before retrying the same file.', phase);
      const result = { ok: false, phase: known.phase, ...(known.status ? { status: known.status } : {}),
        ...(analyzerId ? { analyzerId } : {}), error: { code: known.code, message: known.message } };
      if (options.format === 'json') out.json(result);
      else out.error(`${known.phase}: ${known.message}`);
      process.exitCode = 1;
    }
  });
