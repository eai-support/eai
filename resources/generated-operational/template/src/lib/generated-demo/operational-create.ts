import type {
  GeneratedOperationalCreateConfig,
  GeneratedOperationalCreateField,
} from './operational-contract';
import { boundedOperationalJson, resolveOperationalPublicApi } from './operational-read';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OperationalCreateRejection extends Error {
  constructor(readonly status: 403 | 409 | 429) {
    super('Selected operational create was rejected');
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function submittedData(value: unknown, fields: GeneratedOperationalCreateField[]): Record<string, string | number | boolean> {
  if (!record(value) || Object.keys(value).length > fields.length) throw new Error('Invalid selected create data');
  const allowed = new Map(fields.map((field) => [field.name, field]));
  const data: Record<string, string | number | boolean> = Object.create(null);
  for (const [name, entry] of Object.entries(value)) {
    const field = allowed.get(name);
    if (!field) throw new Error('Unreviewed create field');
    if ((field.type === 'text' && (typeof entry !== 'string' || entry.length > 512 ||
          (field.required && entry.trim().length === 0))) ||
        (field.type === 'number' && (typeof entry !== 'number' || !Number.isFinite(entry))) ||
        (field.type === 'boolean' && typeof entry !== 'boolean'))
      throw new Error('Invalid selected create value');
    data[name] = entry as string | number | boolean;
  }
  if (fields.some((field) => field.required && !Object.hasOwn(data, field.name)))
    throw new Error('Required selected create value is missing');
  return data;
}

export interface GeneratedOperationalCreateInput {
  idempotencyKey: string;
  data: Record<string, string | number | boolean>;
}

/** No caller-supplied route, Object Type or field can widen the reviewed create binding. */
export function parseGeneratedOperationalCreateInput(
  value: unknown,
  fields: GeneratedOperationalCreateField[],
): GeneratedOperationalCreateInput {
  if (!record(value) || Object.keys(value).sort().join('|') !== 'data|idempotencyKey' ||
      typeof value.idempotencyKey !== 'string' || !UUID.test(value.idempotencyKey))
    throw new Error('Invalid selected create request');
  return { idempotencyKey: value.idempotencyKey, data: submittedData(value.data, fields) };
}

/** PublicAPI verifies the active source, actor quota, create and readback before returning an ID. */
export async function createGeneratedOperationalRecord(
  config: GeneratedOperationalCreateConfig,
  fields: GeneratedOperationalCreateField[],
  input: GeneratedOperationalCreateInput,
  accessToken: string,
  currentAppHost: string,
): Promise<{ id: string }> {
  const validated = parseGeneratedOperationalCreateInput(input, fields);
  const baseUrl = await resolveOperationalPublicApi(config, accessToken, currentAppHost);
  const path = `v4/platform/tenants/${encodeURIComponent(config.tenantId)}/apps/${encodeURIComponent(config.appKey)}/generated-operational/create`;
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    tenant: config.tenantId,
    'X-Tenant-Id': config.tenantId,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const response = await fetch(url, {
    method: 'POST', headers, cache: 'no-store', signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({ data: validated.data, idempotencyKey: validated.idempotencyKey }),
  });
  if (!response.ok) {
    if (response.status === 403 || response.status === 409 || response.status === 429)
      throw new OperationalCreateRejection(response.status);
    throw new Error(`Authorized create failed: ${response.status}`);
  }
  const created = await boundedOperationalJson(response);
  if (!record(created) || typeof created.id !== 'string' || !UUID.test(created.id) ||
      !record(created.data))
    throw new Error('Authorized create receipt did not match');
  const receiptData = created.data;
  if (Object.keys(receiptData).some((name) => !fields.some((field) => field.name === name)) ||
      Object.entries(validated.data).some(([name, value]) => receiptData[name] !== value))
    throw new Error('Authorized create receipt did not match');
  return { id: created.id };
}
