import type { GeneratedOperationalRows } from './operational-read';

const FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const FORBIDDEN_FIELD = /password|secret|token|credential|api.?key|private|ssn|(?:authorization|url|uri|endpoint|key)$/i;
const RESERVED_FIELD = new Set(['id', '__proto__', 'prototype', 'constructor']);
const MAX_RESPONSE_BYTES = 128_000;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function safeScalar(value: unknown): boolean {
  return value === null || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.length <= 512);
}

/** Validate the exact server projection before the trusted parent displays text-only rows. */
export function isOperationalRowsResponse(
  value: unknown,
  digest: string,
  collection: string,
  maxRows: number,
  projectedFields: string[],
): value is GeneratedOperationalRows {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'acceptedArtifactDigest', 'fixtureCollection', 'rows',
  ]) || value.schemaVersion !== 'eai.generated_app_operational_rows.v1' ||
      value.acceptedArtifactDigest !== digest || value.fixtureCollection !== collection ||
      !Array.isArray(value.rows) || value.rows.length > maxRows ||
      !Array.isArray(projectedFields) || projectedFields.length < 1 || projectedFields.length > 16 ||
      new Set(projectedFields).size !== projectedFields.length ||
      projectedFields.some((field) => !FIELD_NAME.test(field) ||
        RESERVED_FIELD.has(field.toLowerCase()) || FORBIDDEN_FIELD.test(field)))
    return false;
  const keys = ['id', ...projectedFields];
  if (!value.rows.every((row: unknown) => record(row) && exactKeys(row, keys) &&
      typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 128 &&
      projectedFields.every((field) => safeScalar(row[field])))) return false;
  if (new Set(value.rows.map((row: { id: string }) => row.id)).size !== value.rows.length)
    return false;
  try {
    return new Blob([JSON.stringify(value)]).size <= MAX_RESPONSE_BYTES;
  } catch {
    return false;
  }
}
