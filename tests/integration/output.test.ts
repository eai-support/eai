import { afterEach, describe, expect, test, vi } from 'vitest';
import * as out from '../../src/lib/output.js';

describe('output redaction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('redacts common secret shapes from text output', () => {
    const token = ['eyJaaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].join('.');
    const accessTokenKey = 'EAI_ACCESS_' + 'TOKEN';
    const clientSecretKey = 'client' + 'Secret';
    const message = out.redactSensitiveText(
      `Authorization: Bearer ${token} ${accessTokenKey}=<fixture-env-token> ${clientSecretKey}: abc123`,
    );

    expect(message).not.toContain(token);
    expect(message).not.toContain('<fixture-env-token>');
    expect(message).not.toContain('abc123');
    expect(message).toContain('Bearer [redacted]');
    expect(message).toContain(`${accessTokenKey}=[redacted]`);
    expect(message).toContain(`${clientSecretKey}: [redacted]`);
  });

  test('redacts sensitive keys from JSON output', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    out.json({
      tenantId: 'tenant-123',
      accessToken: '<fixture-json-token>',
      nested: {
        clientSecret: '<fixture-json-client-secret>',
      },
    });

    const printed = String(write.mock.calls[0]?.[0] ?? '');
    expect(printed).toContain('"tenantId": "tenant-123"');
    expect(printed).not.toContain('<fixture-json-token>');
    expect(printed).not.toContain('<fixture-json-client-secret>');
    expect(printed).toContain('"accessToken": "[redacted]"');
    expect(printed).toContain('"clientSecret": "[redacted]"');
  });

  test.each(['tenant_deauthorization', 'tenantDeauthorization'])('preserves only safe %s booleans while retaining secret masking', key => {
    const summary = { removed: false, already_absent: true, clientSecret: '<fixture-hidden-summary-secret>', warning: 'Bearer fixture-private-token' };
    const input = { body: { [key]: summary, Authorization: 'Bearer fixture-private-token', tenant_authorization: { secret: '<fixture-hidden-summary-secret>' } } };
    const expected = { body: { [key]: { removed: false, already_absent: true }, Authorization: '[redacted]', tenant_authorization: '[redacted]' } };
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    out.json(input);
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toEqual(expected);
    expect(out.redactSensitiveDeep(input)).toEqual(expected);
  });

  test('preserves camel case receipt booleans without preserving extra upstream fields', () => {
    expect(out.redactSensitiveDeep({ tenantDeauthorization: { removed: true, alreadyAbsent: false, debug: '<fixture-private-content>' } }))
      .toEqual({ tenantDeauthorization: { removed: true, alreadyAbsent: false } });
  });

  test.each([
    '[redacted]', '{"removed":true,"already_absent":false}', null, [],
    { removed: '<fixture-hidden-summary-secret>', already_absent: false },
    { removed: true }, { removed: true, already_absent: true }, { removed: false, already_absent: false },
    { removed: false, already_absent: true, alreadyAbsent: false },
  ])('masks invalid authorization summaries instead of exposing arbitrary data: %j', summary => {
    const input = { tenant_deauthorization: summary };
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    out.json(input);
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toEqual({ tenant_deauthorization: '[redacted]' });
    expect(out.redactSensitiveDeep(input)).toEqual({ tenant_deauthorization: '[redacted]' });
  });
});
