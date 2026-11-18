/** Product-safe diagnostics: never return upstream messages, bodies, URLs or credentials. */
import { isRecord } from './utils.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface AppSigninFailureGuidance { readonly message: string; readonly nextAction: string }
const APP_SIGNIN_FAILURES = {
  APP_SIGNIN_NOT_CONFIGURED: { message: 'App sign-in is not configured for this environment.', nextAction: 'Ask support to configure sign-in, then retry the same scoped setup. Preserve the app and local credentials.' },
  APP_SIGNIN_CALLBACKS_INVALID: { message: 'The sign-in callback URLs are invalid.', nextAction: 'Correct the callback URLs and retry the same scoped setup without rotating a credential.' },
  APP_SIGNIN_BINDING_MISMATCH: { message: 'The current app binding changed.', nextAction: 'Refresh the exact runtime, enrollment owner, enrollment and app binding before another setup request. Preserve existing credentials.' },
  APP_SIGNIN_BINDING_NOT_FOUND: { message: 'The selected app binding is unavailable.', nextAction: 'Refresh the exact current app binding and workspace access. Do not create a replacement registration to recover this request.' },
  APP_IDENTITY_REGISTRATION_UNVERIFIED: { message: 'The saved sign-in registration could not be verified.', nextAction: 'Keep the app and local credentials unchanged. Ask support to inspect the saved registration before another provider change.' },
  APP_IDENTITY_PROVIDER_UNCERTAIN: { message: 'The sign-in provider outcome is uncertain.', nextAction: 'Preserve the saved operation and local credentials. Ask support to read that same operation before creating, changing or deleting a registration.' },
  APP_IDENTITY_CONFIGURATION_INCOMPLETE: { message: 'App sign-in configuration is incomplete.', nextAction: 'Repair configuration and resume the same scoped setup, preserving its registration and credential. Do not rotate a secret to repair configuration.' },
  CIAM_USER_FLOW_CAPACITY_EXCEEDED: { message: 'The configured sign-in user flow is at capacity (50 KB).', nextAction: 'Ask the platform team to review positively owned stale mappings for this exact flow or configure another supported flow. Preserve the registration and local credential; retry the same scoped setup without rotating after capacity is repaired. Do not clear the shared Login flow.' },
  APP_LOCAL_SECRET_OUTCOME_UNKNOWN: { message: 'Local credential issuance is uncertain.', nextAction: 'Preserve the private local journal and existing settings. Inspect the saved operation before requesting another credential; no automatic reissue is safe.' },
  APP_LOCAL_SECRET_ALREADY_ISSUED: { message: 'A local credential was already issued.', nextAction: 'Recover the original private local journal first. If recovery is unavailable, explicit --create-local-secret --reissue-local-secret requires the fresh native credential receipt.' },
  APP_LOCAL_SECRET_REISSUE_CONFLICT: { message: 'The current credential key changed.', nextAction: 'Refresh the pinned native receipt before explicit reissue. Preserve the current local credential and journal; never guess the expected credential key.' },
  APP_IDENTITY_OWNERSHIP_REQUIRED: { message: 'The current app binding is required for sign-in setup.', nextAction: 'Refresh the exact runtime, enrollment owner, enrollment and app binding. Names and local client IDs cannot establish registration ownership.' },
} satisfies Record<string, AppSigninFailureGuidance>;

/** Exact public identity codes select compiled guidance; upstream messages never become instructions. */
export function appSigninFailureGuidance(code: string | undefined): AppSigninFailureGuidance | undefined {
  return code !== undefined && Object.hasOwn(APP_SIGNIN_FAILURES, code)
    ? APP_SIGNIN_FAILURES[code as keyof typeof APP_SIGNIN_FAILURES] : undefined;
}

/** Native identity references must already be canonical UUID bytes; never normalize or invent them. */
export function safeRegistrationReference(value: unknown): string | undefined {
  return typeof value === 'string' && CANONICAL_UUID.test(value) ? value : undefined;
}

function nativeSigninFailure(status: number, payload: unknown): { code: string; registrationId?: string; supportReference?: string } | undefined {
  if (!isRecord(payload)) return undefined;
  const nested = isRecord(payload.detail);
  if (nested && ['error', 'code', 'details'].some(key => Object.hasOwn(payload, key))) return undefined;
  const envelope = nested ? payload.detail as Record<string, unknown> : payload;
  const code = envelope.error;
  if (typeof code !== 'string' || !appSigninFailureGuidance(code)) return undefined;
  const statuses = code === 'APP_IDENTITY_PROVIDER_UNCERTAIN' || code === 'APP_LOCAL_SECRET_OUTCOME_UNKNOWN' ? [503]
    : code === 'APP_SIGNIN_NOT_CONFIGURED' || code === 'APP_SIGNIN_CALLBACKS_INVALID' ? [422, 409]
      : code === 'APP_IDENTITY_CONFIGURATION_INCOMPLETE' || code === 'APP_IDENTITY_REGISTRATION_UNVERIFIED' ? [409, 503] : [409];
  if (!statuses.includes(status)) return undefined;
  const details = isRecord(envelope.details) ? envelope.details : {};
  const registrationId = safeRegistrationReference(details.registrationId);
  const supportReference = safeRegistrationReference(details.supportReference);
  return { code, ...(registrationId ? { registrationId } : {}), ...(supportReference ? { supportReference } : {}) };
}
const ERROR_CODES = new Set([
  'ENTRA_ROTATION_FAILED', 'QUERY_PLACEMENT_UNSUPPORTED', 'VALIDATION_ERROR',
  'AUTHENTICATION_REQUIRED', 'PERMISSION_DENIED', 'NOT_FOUND', 'RESOURCEAPI_UNAVAILABLE',
  'RESOURCEAPI_SCHEMA_PUBLICATION_CONFLICT', 'RESOURCEAPI_SCHEMA_PUBLICATION_UNVERIFIED',
  'APP_BINDING_NOT_FOUND', 'APP_ENROLLMENT_AMBIGUOUS', 'APP_BINDING_OWNER_MISMATCH',
  'APP_ENROLLMENT_INCOMPLETE', 'APP_BINDING_LINEAGE_UNAVAILABLE',
  'APP_REGISTRATION_CLEANUP_OWNERSHIP_REQUIRED',
  'TENANT_QUOTA_EXCEEDED',
  // App deletion ownership failures forwarded unchanged by the platform API.
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
  readonly registrationId?: string;
  readonly rotationFailure?: SafeRotationFailure;
}

/** UUID references and the legacy bounded req-* request identifiers are eligible for display. */
export function safeSupportReference(value: unknown): string | undefined {
  return typeof value === 'string' && (UUID.test(value) || /^req-[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) ? value : undefined;
}

/** Extract allowlisted metadata from bounded known envelope nesting, without echoing arbitrary values. */
export function safePlatformDiagnostics(status: number, payload: unknown, headers?: Headers): SafePlatformDiagnostics {
  const native = nativeSigninFailure(status, payload);
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
  const code = native?.code ?? records.flatMap(value => [value.code, value.error]).find((value): value is string => typeof value === 'string' && ERROR_CODES.has(value));
  const requestId = safeSupportReference(headers?.get('x-request-id'))
    ?? safeSupportReference(headers?.get('x-correlation-id'))
    ?? records.map(value => safeSupportReference(value.requestId ?? value.request_id)).find(Boolean);
  const supportReference = native ? native.supportReference : records.map(value => safeSupportReference(value.supportReference ?? value.supportRef ?? value.ref)).find(Boolean);
  const rotation = code === 'ENTRA_ROTATION_FAILED' ? records.find(value => typeof value.reason === 'string'
    && ROTATION_REASONS.has(value.reason) && typeof value.outcome === 'string'
    && ['not_issued', 'unknown'].includes(value.outcome) && typeof value.retryable === 'boolean'
    && (value.outcome === 'unknown') === (value.reason === 'outcome_unknown')
    && !(value.outcome === 'unknown' && value.retryable)) : undefined;
  return { status, ...(code ? { code } : {}), ...(requestId ? { requestId } : {}),
    ...(supportReference ? { supportReference } : {}),
    ...(native?.registrationId ? { registrationId: native.registrationId } : {}),
    ...(rotation ? { rotationFailure: { reason: rotation.reason as string, outcome: rotation.outcome as 'not_issued' | 'unknown',
      retryable: rotation.outcome === 'unknown' ? false : rotation.retryable as boolean } } : {}) };
}

/** Format static guidance plus validated diagnostic identifiers for a failed operation. */
export function formatSafePlatformFailure(operation: string, diagnostics: SafePlatformDiagnostics): string {
  return `${operation} failed (HTTP ${diagnostics.status})${diagnostics.code ? ` [${diagnostics.code}]` : ''}`
    + `${diagnostics.supportReference ? `; support reference ${diagnostics.supportReference}` : ''}`
    + `${diagnostics.requestId ? `; request ${diagnostics.requestId}` : ''}.`;
}
