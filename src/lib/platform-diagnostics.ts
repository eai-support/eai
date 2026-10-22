/** Product-safe diagnostics: never return upstream messages, bodies, URLs or credentials. */
import { isRecord } from './utils.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_CODES = new Set([
  'ENTRA_ROTATION_FAILED', 'QUERY_PLACEMENT_UNSUPPORTED', 'VALIDATION_ERROR',
  'AUTHENTICATION_REQUIRED', 'PERMISSION_DENIED', 'NOT_FOUND', 'RESOURCEAPI_UNAVAILABLE',
  'RESOURCEAPI_SCHEMA_PUBLICATION_CONFLICT', 'RESOURCEAPI_SCHEMA_PUBLICATION_UNVERIFIED',
  // Configurator app deletion ownership failures that PublicAPI forwards unchanged.
  'APP_OWNERSHIP_ENROLLMENT_OWNER_AMBIGUOUS', 'APP_OWNERSHIP_MANIFEST_CONFLICT', 'APP_OWNERSHIP_MANIFEST_INCOMPLETE',
  'APP_OWNERSHIP_MANIFEST_NOT_FOUND', 'APP_OWNERSHIP_OBJECT_TYPE_AMBIGUOUS', 'APP_OWNERSHIP_OBJECT_TYPE_INVALID',
  'APP_OWNERSHIP_OBJECT_TYPE_NOT_FOUND', 'APP_OWNERSHIP_SCOPE_AMBIGUOUS', 'APP_OWNERSHIP_SCOPE_CONCURRENT_CHANGE',
  'APP_OWNERSHIP_SCOPE_EXISTING_SCOPE_INVALID', 'APP_OWNERSHIP_SCOPE_FAILED', 'APP_OWNERSHIP_SCOPE_INSTALL_AMBIGUOUS',
  'APP_OWNERSHIP_SCOPE_INSTALL_CONFLICT', 'APP_OWNERSHIP_SCOPE_INSTALL_INCOMPLETE', 'APP_OWNERSHIP_SCOPE_INSTALL_NOT_FOUND',
  'APP_OWNERSHIP_SCOPE_INVALID_APP_KEY', 'APP_OWNERSHIP_SCOPE_INVALID_BODY', 'APP_OWNERSHIP_SCOPE_INVALID_OBJECT_TYPES',
  'APP_OWNERSHIP_SCOPE_OBJECT_TYPE_CONFLICT', 'APP_OWNERSHIP_SCOPE_OBJECT_TYPE_NOT_EXCLUSIVE',
  'APP_OWNERSHIP_STORAGE_ROUTE_INVALID', 'APP_DELETION_TARGET_TENANT_FORBIDDEN',
]);
const ROTATION_REASONS = new Set(['concurrency_conflict', 'throttled', 'registration_not_found',
  'provider_rejected', 'provider_unavailable', 'deadline_exceeded', 'outcome_unknown']);

/** Allowlisted rotation outcome; unknown issuance is never eligible for automatic retry. */
export interface SafeRotationFailure {
  readonly reason: string;
  readonly outcome: 'not_issued' | 'unknown';
  readonly retryable: boolean;
}

/** Safe HTTP/error/support metadata for product messages, excluding upstream text and credential values. */
export interface SafePlatformDiagnostics {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly supportReference?: string;
  readonly rotationFailure?: SafeRotationFailure;
}

/** UUID references and the legacy bounded req-* request identifiers are eligible for display. */
export function safeSupportReference(value: unknown): string | undefined {
  return typeof value === 'string' && (UUID.test(value) || /^req-[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) ? value : undefined;
}

/** Extract allowlisted metadata from bounded known envelope nesting, without echoing arbitrary values. */
export function safePlatformDiagnostics(status: number, payload: unknown, headers?: Headers): SafePlatformDiagnostics {
  const records: Record<string, unknown>[] = [];
  let level: unknown[] = [payload];
  for (let depth = 0; depth < 4 && records.length < 16; depth += 1) {
    const next: unknown[] = [];
    for (const value of level) {
      if (!isRecord(value) || records.length >= 16) continue;
      records.push(value);
      next.push(value.detail, value.error, value.details);
    }
    level = next;
  }
  const code = records.flatMap(value => [value.code, value.error]).find((value): value is string => typeof value === 'string' && ERROR_CODES.has(value));
  const requestId = safeSupportReference(headers?.get('x-request-id'))
    ?? safeSupportReference(headers?.get('x-correlation-id'))
    ?? records.map(value => safeSupportReference(value.requestId ?? value.request_id)).find(Boolean);
  const supportReference = records.map(value => safeSupportReference(value.supportReference ?? value.supportRef ?? value.ref)).find(Boolean);
  const rotation = code === 'ENTRA_ROTATION_FAILED' ? records.find(value => typeof value.reason === 'string'
    && ROTATION_REASONS.has(value.reason) && typeof value.outcome === 'string'
    && ['not_issued', 'unknown'].includes(value.outcome) && typeof value.retryable === 'boolean'
    && (value.outcome === 'unknown') === (value.reason === 'outcome_unknown')
    && !(value.outcome === 'unknown' && value.retryable)) : undefined;
  return { status, ...(code ? { code } : {}), ...(requestId ? { requestId } : {}),
    ...(supportReference ? { supportReference } : {}),
    ...(rotation ? { rotationFailure: { reason: rotation.reason as string, outcome: rotation.outcome as 'not_issued' | 'unknown',
      retryable: rotation.outcome === 'unknown' ? false : rotation.retryable as boolean } } : {}) };
}

/** Format static guidance plus validated diagnostic identifiers for a failed operation. */
export function formatSafePlatformFailure(operation: string, diagnostics: SafePlatformDiagnostics): string {
  return `${operation} failed (HTTP ${diagnostics.status})${diagnostics.code ? ` [${diagnostics.code}]` : ''}`
    + `${diagnostics.supportReference ? `; support reference ${diagnostics.supportReference}` : ''}`
    + `${diagnostics.requestId ? `; request ${diagnostics.requestId}` : ''}.`;
}
