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

  test.each([null, 'PRIVATE', [], { error: null }, { detail: { detail: { detail: { detail: { code: 'ENTRA_ROTATION_FAILED' } } } } }])
    ('handles malformed or overly nested envelopes without echoing their content', payload => {
      expect(safePlatformDiagnostics(503, payload)).toEqual({ status: 503 });
    });
});
