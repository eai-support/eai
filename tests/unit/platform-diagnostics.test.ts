import { describe, expect, test } from 'vitest';
import { formatSafePlatformFailure, safePlatformDiagnostics } from '../../src/lib/platform-diagnostics.js';

const supportReference = '9285486c-d8fd-44d9-98ed-c59511c0db38';
const requestId = 'd681b292-2bfd-4c50-a8ce-392f642b1816';

describe('product-safe platform diagnostics', () => {
  test('extracts nested published error metadata without exposing bodies or internal messages', () => {
    const diagnostics = safePlatformDiagnostics(503, { detail: { error: { code: 'ENTRA_ROTATION_FAILED',
      message: 'PRIVATE-SECRET /internal/route InternalService', details: { supportReference, reason: 'outcome_unknown', retryable: false, outcome: 'unknown' } } } },
    new Headers({ 'x-request-id': requestId }));
    expect(diagnostics).toEqual({ status: 503, code: 'ENTRA_ROTATION_FAILED', requestId, supportReference,
      rotationFailure: { reason: 'outcome_unknown', outcome: 'unknown', retryable: false } });
    const formatted = formatSafePlatformFailure('App inventory', diagnostics);
    expect(formatted).toContain(supportReference); expect(formatted).toContain(requestId); expect(formatted).toContain('HTTP 503');
    expect(formatted).not.toContain('PRIVATE'); expect(formatted).not.toContain('/internal'); expect(formatted).not.toContain('InternalService');
  });

  test('accepts the additive PublicAPI rotation wire contract', () => {
    expect(safePlatformDiagnostics(503, { error: 'ENTRA_ROTATION_FAILED', message: 'do not echo',
      details: { reason: 'throttled', retryable: true, outcome: 'not_issued', supportReference } }))
      .toEqual({ status: 503, code: 'ENTRA_ROTATION_FAILED', supportReference,
        rotationFailure: { reason: 'throttled', retryable: true, outcome: 'not_issued' } });
  });

  test('unknown enum values and untrusted identifiers cannot enter diagnostics', () => {
    const payload = { code: 'PRIVATE_SECRET', supportReference: 'https://internal/token?secret=PRIVATE', requestId: 'PRIVATE',
      detail: { code: 'ENTRA_ROTATION_FAILED', reason: 'PRIVATE', outcome: 'unknown', retryable: true } };
    expect(safePlatformDiagnostics(503, payload, new Headers({ 'x-request-id': 'PRIVATE\tHEADER' }))).toEqual({ status: 503, code: 'ENTRA_ROTATION_FAILED' });
  });

  test.each([
    { reason: 'outcome_unknown', outcome: 'not_issued', retryable: true },
    { reason: 'throttled', outcome: 'unknown', retryable: false },
    { reason: 'outcome_unknown', outcome: 'unknown', retryable: true },
  ])('crossed issuance semantics never grant no-credential-issued guidance (%j)', details => {
    expect(safePlatformDiagnostics(503, { error: 'ENTRA_ROTATION_FAILED', details: { ...details, supportReference } }))
      .toEqual({ status: 503, code: 'ENTRA_ROTATION_FAILED', supportReference });
  });

  // Configurator app deletion ownership codes, as PublicAPI forwards them in its flat { error, message } envelope.
  test.each([
    'APP_OWNERSHIP_ENROLLMENT_OWNER_AMBIGUOUS', 'APP_OWNERSHIP_MANIFEST_CONFLICT', 'APP_OWNERSHIP_MANIFEST_INCOMPLETE',
    'APP_OWNERSHIP_MANIFEST_NOT_FOUND', 'APP_OWNERSHIP_OBJECT_TYPE_AMBIGUOUS', 'APP_OWNERSHIP_OBJECT_TYPE_INVALID',
    'APP_OWNERSHIP_OBJECT_TYPE_NOT_FOUND', 'APP_OWNERSHIP_SCOPE_AMBIGUOUS', 'APP_OWNERSHIP_SCOPE_CONCURRENT_CHANGE',
    'APP_OWNERSHIP_SCOPE_EXISTING_SCOPE_INVALID', 'APP_OWNERSHIP_SCOPE_FAILED', 'APP_OWNERSHIP_SCOPE_INSTALL_AMBIGUOUS',
    'APP_OWNERSHIP_SCOPE_INSTALL_CONFLICT', 'APP_OWNERSHIP_SCOPE_INSTALL_INCOMPLETE', 'APP_OWNERSHIP_SCOPE_INSTALL_NOT_FOUND',
    'APP_OWNERSHIP_SCOPE_INVALID_APP_KEY', 'APP_OWNERSHIP_SCOPE_INVALID_BODY', 'APP_OWNERSHIP_SCOPE_INVALID_OBJECT_TYPES',
    'APP_OWNERSHIP_SCOPE_OBJECT_TYPE_CONFLICT', 'APP_OWNERSHIP_SCOPE_OBJECT_TYPE_NOT_EXCLUSIVE',
    'APP_OWNERSHIP_STORAGE_ROUTE_INVALID', 'APP_DELETION_TARGET_TENANT_FORBIDDEN',
  ])('allowlists app deletion ownership code %s without echoing the message', code => {
    expect(safePlatformDiagnostics(409, { error: code, message: 'PRIVATE upstream text' })).toEqual({ status: 409, code });
  });

  test('a bare app ownership prefix is not an allowlisted code', () => {
    expect(safePlatformDiagnostics(409, { error: 'APP_OWNERSHIP_SCOPE_' })).toEqual({ status: 409 });
  });

  test('native sign-in diagnostics accept only canonical details references and never provider text', () => {
    const diagnostics = safePlatformDiagnostics(409, { error: 'CIAM_USER_FLOW_CAPACITY_EXCEEDED',
      message: 'PRIVATE provider token', details: { registrationId: supportReference, supportReference: requestId,
        secret: 'PRIVATE', ref: 'req-unrelated' } });
    expect(diagnostics).toEqual({ status: 409, code: 'CIAM_USER_FLOW_CAPACITY_EXCEEDED', registrationId: supportReference, supportReference: requestId });
    expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE');
  });

  test.each([
    { status: 409, payload: { error: 'APP_IDENTITY_PROVIDER_UNCERTAIN', details: { registrationId: supportReference } } },
    { status: 409, payload: { error: 'APP_IDENTITY_PRIVATE_UNRECOGNIZED', details: { registrationId: supportReference } } },
    { status: 409, payload: { error: 'CIAM_USER_FLOW_CAPACITY_EXCEEDED', detail: { error: 'APP_LOCAL_SECRET_OUTCOME_UNKNOWN', details: { registrationId: supportReference } } } },
  ])('native identity code/reference require the actual unambiguous allowed envelope and status: %j', ({ status, payload }) => {
    expect(safePlatformDiagnostics(status, payload)).toEqual({ status });
  });

  test.each([null, 'PRIVATE', [], { error: null }, { detail: { detail: { detail: { detail: { code: 'ENTRA_ROTATION_FAILED' } } } } }])
    ('handles malformed or overly nested envelopes without echoing their content', payload => {
      expect(safePlatformDiagnostics(503, payload)).toEqual({ status: 503 });
    });
});
