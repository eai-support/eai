import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { PlatformAPIClient } from './api.js';
import { inspectGeneratedDemoContinuation, readAcceptedObjectTypeDefinition } from './generated-demo-continuation.js';
import { assertPublishedReadOnlyObjectType } from './generated-demo-operational.js';
import { GeneratedResponseTooLargeError, readBoundedGeneratedResponse } from './generated-demo-bounded-response.js';

const MAX_IMPORT_BYTES = 1_000_000;
const MAX_ROWS = 100;
const CONFIG_PATH = 'src/eai.config/generated-operational.json';
const OPERATION_PATH = '.eai/generated-source-operation.json';
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SAFE_FIELD = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SENSITIVE_FIELD = /password|secret|token|credential|api.?key|private|ssn|(?:authorization|url|uri|endpoint|key)$/i;
const RESERVED_FIELD = new Set(['id', '__proto__', 'prototype', 'constructor']);

type JsonObject = Record<string, unknown>;
type FieldType = 'text' | 'number' | 'boolean';

export interface GeneratedDemoImportRequest {
  projectPath: string;
  filePath: string;
  tenantId: string;
  apply: boolean;
  client: PlatformAPIClient;
}

export interface GeneratedDemoImportReceipt {
  status: 'planned' | 'completed' | 'partial';
  tenantId: string;
  appKey: string;
  objectTypeSlug: string;
  fileDigest: string;
  rowCount: number;
  records: Array<{row: number; id: string; idempotencyKey: string}>;
  failure?: {row: number; status: number};
}

function record(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  throw new Error('Import data must contain finite JSON values only.');
}

function digest(bytes: string | Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function readLocal(root: string, path: string): Promise<Buffer> {
  if (!/^[A-Za-z0-9._/-]+$/.test(path) || path.startsWith('/') ||
    path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Operational source file path is unsafe.');
  }
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Operational source contains a symbolic link.');
  }
  const info = await lstat(current);
  if (!info.isFile() || info.size > MAX_IMPORT_BYTES) throw new Error('Operational source file is unsupported.');
  return readFile(current);
}

async function boundedJson(response: Response, name: string): Promise<JsonObject> {
  if (!response.ok) throw new Error(`${name} failed (HTTP ${response.status}).`);
  let body: string;
  try { body = await readBoundedGeneratedResponse(response, MAX_IMPORT_BYTES); }
  catch (error) {
    if (error instanceof GeneratedResponseTooLargeError) throw new Error(`${name} exceeded the response limit.`, {cause: error});
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new Error(`${name} returned invalid JSON.`); }
  if (!record(value)) throw new Error(`${name} returned an invalid contract.`);
  return value;
}

function csvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else cell += char;
    } else if (char === '"') {
      if (cell || closedQuote) throw new Error('CSV quote must start a field.');
      quoted = true;
    } else if (char === ',') { row.push(cell); cell = ''; closedQuote = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = ''; closedQuote = false;
    } else {
      if (closedQuote) throw new Error('CSV has text after a closing quote.');
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field.');
  if (cell || row.length || closedQuote) { row.push(cell); rows.push(row); }
  return rows;
}

export function parseBoundedImportRows(bytes: Buffer, name: string): JsonObject[] {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  let rows: unknown;
  if (name.toLowerCase().endsWith('.json')) {
    try { rows = JSON.parse(text); } catch { throw new Error('Import JSON is invalid.'); }
  } else if (name.toLowerCase().endsWith('.csv')) {
    const parsed = csvRows(text);
    const [header, ...data] = parsed;
    if (!header || header.length < 1 || new Set(header).size !== header.length ||
      header.some(field => !SAFE_FIELD.test(field) || RESERVED_FIELD.has(field.toLowerCase()) ||
        SENSITIVE_FIELD.test(field))) {
      throw new Error('CSV header is invalid or has duplicate fields.');
    }
    rows = data.map((values, index) => {
      if (values.length !== header.length) throw new Error(`CSV row ${index + 1} has the wrong field count.`);
      return Object.fromEntries(header.map((field, fieldIndex) => [field, values[fieldIndex]]));
    });
  } else throw new Error('Import file must be .json or .csv.');
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS || !rows.every(record)) {
    throw new Error('Import must contain 1 to 100 object rows.');
  }
  return rows;
}

function normalizeRows(
  rows: JsonObject[], fields: string[], properties: Map<string, {type: FieldType; required: boolean}>, csv: boolean,
): JsonObject[] {
  return rows.map((row, index) => {
    if (Object.keys(row).some(field => !fields.includes(field))) {
      throw new Error(`Import row ${index + 1} contains an unapproved field.`);
    }
    const data: JsonObject = {};
    for (const field of fields) {
      const property = properties.get(field);
      if (!property) throw new Error('Selected field type is not published.');
      let value = row[field];
      if (csv && typeof value === 'string') {
        const cell = value;
        if (!cell && !property.required) continue;
        if (property.type === 'number') value = cell.trim() ? Number(cell) : NaN;
        if (property.type === 'boolean') value = cell.toLowerCase() === 'true' ? true :
          cell.toLowerCase() === 'false' ? false : null;
      }
      if (value === undefined || value === null || value === '') {
        if (property.required) throw new Error(`Import row ${index + 1} omits required field ${field}.`);
        continue;
      }
      const valid = property.type === 'text'
        ? typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 2_000
        : property.type === 'number'
          ? typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000
          : typeof value === 'boolean';
      if (!valid) throw new Error(`Import row ${index + 1} has invalid ${field} data.`);
      data[field] = value;
    }
    return data;
  });
}

/** Import is explicit and uses ResourceAPI's deterministic create idempotency key for exact retries. */
export async function importGeneratedDemoData(request: GeneratedDemoImportRequest): Promise<GeneratedDemoImportReceipt> {
  const root = await realpath(resolve(request.projectPath));
  const inputPath = await realpath(resolve(request.filePath));
  const inputInfo = await lstat(inputPath);
  if (!inputInfo.isFile() || inputInfo.size > MAX_IMPORT_BYTES) throw new Error('Import file exceeds the 1 MB limit.');
  const input = await readFile(inputPath);
  const inspection = await inspectGeneratedDemoContinuation(root);
  const configBytes = await readLocal(root, CONFIG_PATH);
  const operationBytes = await readLocal(root, OPERATION_PATH);
  let config: unknown;
  let operation: unknown;
  try { config = JSON.parse(configBytes.toString('utf8')); operation = JSON.parse(operationBytes.toString('utf8')); }
  catch { throw new Error('Operational source contract is invalid.'); }
  if (!record(config) || !record(operation) || config.schemaVersion !== 'eai.generated_app_operational.v2' ||
    config.actionsMode !== 'selected-create' || !record(config.createBinding) ||
    !Array.isArray(config.readBindings) || config.readBindings.length !== 1 ||
    !record(config.readBindings[0]) ||
    config.createBinding.objectTypeSlug !== config.readBindings[0].objectTypeSlug ||
    config.tenantId !== request.tenantId || config.appKey !== inspection.appKey ||
    config.acceptedArtifactDigest !== inspection.acceptedArtifactDigest ||
    operation.appArtifactMode !== 'app-v2-operational' || operation.tenantId !== request.tenantId ||
    operation.appKey !== inspection.appKey || !Array.isArray(config.createBinding.fields)) {
    throw new Error('Import requires the selected-create source for this exact accepted app.');
  }
  const fields = config.createBinding.fields;
  if (fields.length < 1 || fields.length > 16 || new Set(fields).size !== fields.length ||
    fields.some((field: unknown) => typeof field !== 'string' || !SAFE_FIELD.test(field) ||
      RESERVED_FIELD.has(field.toLowerCase()) || SENSITIVE_FIELD.test(field))) {
    throw new Error('Selected-create field allowlist is invalid.');
  }
  const base = `/v4/platform/tenants/${encodeURIComponent(request.tenantId)}/apps/${encodeURIComponent(inspection.appKey)}`;
  const anchor = await boundedJson(await request.client.requestPublicApi(`${base}/source-anchor`, {
    params: {targetTenantId: request.tenantId},
  }), 'Signed operational source anchor');
  if (anchor.status !== 'completed' || anchor.appArtifactMode !== 'app-v2-operational' ||
    anchor.tenantId !== request.tenantId || anchor.appKey !== inspection.appKey ||
    `${anchor.repoOwner}/${anchor.repoName}` !== inspection.repository ||
    !DIGEST.test(String(anchor.integrityHash)) ||
    anchor.operationId !== operation.operationId ||
    anchor.acceptedArtifactDigest !== inspection.acceptedArtifactDigest ||
    !record(anchor.fileChecksums) || anchor.fileChecksums[CONFIG_PATH] !== digest(configBytes) ||
    anchor.fileChecksums[OPERATION_PATH] !== digest(operationBytes)) {
    throw new Error('Current signed source does not authorize this selected-create import.');
  }
  const manifest = await boundedJson(await request.client.requestPublicApi(`${base}/object-types/manifest`),
    'Published app Object Type manifest');
  const slug = String(config.createBinding.objectTypeSlug);
  assertPublishedReadOnlyObjectType(inspection, request.tenantId, slug, manifest);
  const accepted = await readAcceptedObjectTypeDefinition(root, inspection, slug);
  const published = Array.isArray(manifest.objectTypes)
    ? manifest.objectTypes.find((item: unknown) => record(item) && item.slug === slug) : null;
  if (!Array.isArray(accepted.properties) || !record(published) || !Array.isArray(published.properties)) {
    throw new Error('Selected-create Object Type fields are unavailable.');
  }
  const properties = new Map<string, {type: FieldType; required: boolean}>();
  for (const field of fields as string[]) {
    const proposed = accepted.properties.find((item: unknown) => record(item) && item.name === field);
    const current = published.properties.find((item: unknown) => record(item) && item.name === field);
    if (!record(proposed) || !record(current) || !['text', 'number', 'boolean'].includes(String(proposed.type)) ||
      proposed.type !== current.type || proposed.serverOnly || current.serverOnly ||
      !SAFE_FIELD.test(field) || RESERVED_FIELD.has(field.toLowerCase()) || SENSITIVE_FIELD.test(field)) {
      throw new Error(`Selected-create field changed or is unsafe: ${field}`);
    }
    properties.set(field, {type: proposed.type as FieldType, required: proposed.required === true || current.required === true});
  }
  for (const property of [...accepted.properties, ...published.properties]) {
    if (record(property) && property.required === true && !fields.includes(property.name)) {
      throw new Error('Selected-create import omits a required Object Type property.');
    }
  }
  const rows = normalizeRows(parseBoundedImportRows(input, inputPath), fields as string[], properties,
    inputPath.toLowerCase().endsWith('.csv'));
  const fileDigest = digest(input);
  const receipt: GeneratedDemoImportReceipt = {
    status: 'planned', tenantId: request.tenantId, appKey: inspection.appKey,
    objectTypeSlug: slug, fileDigest, rowCount: rows.length, records: [],
  };
  if (!request.apply) return receipt;
  const path = `${base}/generated-operational/create`;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const key = `ncb-import-v1:${digest(`${request.tenantId}:${slug}:${fileDigest}:${index}:${canonical(row)}`).slice(7)}`;
    let failureStatus = 502;
    try {
      const response = await request.client.requestPublicApi(path, {method: 'POST',
        body: {data: row, idempotencyKey: key}});
      failureStatus = response.status;
      const created = await boundedJson(response, `Import row ${index + 1}`);
      const createdData = created.data;
      if (typeof created.id !== 'string' || !UUID.test(created.id) || !record(createdData) ||
        Object.keys(createdData).length !== Object.keys(row).length ||
        Object.keys(row).some(field => canonical(createdData[field]) !== canonical(row[field]))) {
        throw new Error(`Import row ${index + 1} differs from its authoritative readback.`);
      }
      receipt.records.push({row: index + 1, id: created.id, idempotencyKey: key});
    } catch {
      receipt.status = 'partial'; receipt.failure = {row: index + 1, status: failureStatus};
      return receipt;
    }
  }
  receipt.status = 'completed';
  return receipt;
}
