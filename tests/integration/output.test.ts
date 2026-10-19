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

  test.each([
    { name: 'controlled authorization', key: 'Authori\u001bzation' },
    { name: 'styled authorization', key: '\u001b[36mAuthorization\u001b[39m' },
    { name: 'controlled general credential', key: 'clientSe\u0000cret' },
    { name: 'styled general credential', key: 'clientSe\u001b[36mcret\u001b[39m' },
  ])('controlled credential keys are masked in JSON: $name', ({ key }) => {
    const input = {
      nested: [{ [key]: 'opaque-structured-canary' }],
      ['authori\u0000zationReadiness']: { status: 'ready' },
      tenant_deauthorization: { removed: true, already_absent: false, debug: 'omit' },
    };
    const expected = {
      ...input,
      nested: [{ [key]: '[redacted]' }],
      tenant_deauthorization: { removed: true, already_absent: false },
    };
    expect(out.redactSensitiveDeep(input)).toEqual(expected);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    out.json(input);
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toEqual(expected);
  });

  test.each([
    { name: 'secret', message: 'clientSe\u0000cret=opaque-text-canary status=ready' },
    { name: 'token', message: 'accessTo\u007fken: opaque-text-canary status=ready' },
    { name: 'password', message: 'pass\rword="opaque-text-canary with spaces" status=ready' },
    { name: 'styled secret', message: 'clientSe\u001b[36mcret=opaque-text-canary\u001b[39m status=ready' },
    { name: 'API key flag', message: '--api_\u0000key "opaque-text-canary with spaces" --format json status=ready' },
  ])('controlled credential text is normalized before general-key matching: $name', ({ message }) => {
    const clean = out.redactSensitiveText(message);
    expect(clean).toContain('[redacted]');
    expect(clean).toContain('status=ready');
    expect(clean).not.toContain('opaque-text-canary');
    expect(clean).not.toContain('with spaces');
    expect(out.redactSensitiveText(clean)).toBe(clean);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    out.json({ authorizationReadiness: { message } });
    expect(JSON.parse(String(write.mock.calls[0]?.[0])))
      .toEqual({ authorizationReadiness: { message: clean } });
  });

  test.each([
    'Authorization: opaque-header-fixture',
    'headers.authorization=opaque-header-fixture',
    'Proxy-Authorization: opaque-header-fixture',
    'x-ms-authorization-auxiliary=opaque-header-fixture',
    'authorizationCode="opaque-header-fixture with spaces"',
    '--authorization "opaque-header-fixture with spaces" --format json',
    '--authorization-header=\'opaque-header-fixture with spaces\'',
    'Authorization: Bearer opaque-header-fixture',
    'Authorization: Basic abc',
    '\u001b[36mAuthorization\u001b[39m: "opaque-header-fixture with spaces"',
    'Autho\u001b[36mrization: opaque-header-fixture\u001b[39m',
    'Autho\u001b]8;;https://example.invalid\u0007rization: opaque-header-fixture',
    'Autho\u001b]8;;https://example.invalid\u001b\\rization: "opaque-header-fixture with spaces"',
  ])('redacts authorization credentials from text and JSON strings: %s', message => {
    const redacted = out.redactSensitiveText(message);
    expect(redacted).toContain('[redacted]');
    expect(redacted).not.toContain('opaque-header-fixture');
    expect(redacted).not.toContain('with spaces');
    expect(redacted).not.toContain('Basic abc');
    expect(out.redactSensitiveText(redacted)).toBe(redacted);
    const input = { authorizationReadiness: { message }, resourceAuthorization: [message] };
    const expected = { authorizationReadiness: { message: redacted }, resourceAuthorization: [redacted] };
    expect(out.redactSensitiveDeep(input)).toEqual(expected);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    out.json(input);
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toEqual(expected);
  });

  test('preserves authorization diagnostics and ANSI styling while masking styled credential values', () => {
    const diagnostic = '\u001b[36mauthorizationReadiness=ready resourceAuthorization=tenant-owned\u001b[39m';
    expect(out.redactSensitiveText(diagnostic)).toBe(diagnostic);
    expect(out.redactSensitiveText('\u001b[36mAuthorization: \u001b[31mopaque-header-fixture\u001b[39m'))
      .toBe('\u001b[36mAuthorization: \u001b[31m[redacted]\u001b[39m');
    expect(out.redactSensitiveText('\u001b]8;;https://example.invalid\u0007authorizationReadiness=ready\u001b]8;;\u0007'))
      .toBe('authorizationReadiness=ready');
  });

  test.each([
    { name: 'NUL', control: '\u0000' },
    { name: 'CR', control: '\r' },
    { name: 'DEL', control: '\u007f' },
  ])('unsafe control $name cannot disguise authorization in text or JSON', ({ control }) => {
    const message = `Authori${control}zation: 'opaque-control-canary' status=ready`;
    const expected = 'Authorization: [redacted] status=ready';
    expect(out.redactSensitiveText(message)).toBe(expected);
    const diagnostic = `authori${control}zationReadiness=ready\tresourceAuthorization=tenant-owned\nstatus=ready`;
    expect(out.redactSensitiveText(diagnostic))
      .toBe('authorizationReadiness=ready\tresourceAuthorization=tenant-owned\nstatus=ready');
    const input = { authorizationReadiness: { message } };
    expect(out.redactSensitiveDeep(input)).toEqual({ authorizationReadiness: { message: expected } });
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    out.json(input);
    expect(JSON.parse(String(write.mock.calls[0]?.[0])))
      .toEqual({ authorizationReadiness: { message: expected } });
  });

  test.each([
    { name: 'NUL', control: '\u0000' },
    { name: 'CR', control: '\r' },
    { name: 'DEL', control: '\u007f' },
  ])('unsafe control $name cannot disguise a credential table label', ({ control }) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    out.table([[`Authori${control}zation`, 'opaque-table-control-canary'], ['authorizationReadiness', 'ready']]);
    const printed = log.mock.calls.flat().join('\n');
    expect(printed).not.toContain('opaque-table-control-canary');
    expect(printed).toContain('Authorization');
    expect(printed).toContain('[redacted]');
    expect(printed).toContain('authorizationReadiness');
    expect(printed).toContain('ready');
  });

  test.each([
    { name: 'plain authorization', label: 'Authorization :' },
    { name: 'styled authorization', label: '\u001b[36mAuthorization\u001b[39m :' },
    { name: 'padded proxy authorization', label: '  Proxy-Authorization \t:  ' },
  ])('redacts credential table labels with space before a colon: $name', ({ label }) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    out.table([
      [label, 'opaque-spaced-table-canary'],
      ['authorizationReadiness :', 'ready'],
      ['resourceAuthorization :', 'tenant-owned'],
    ]);
    const printed = log.mock.calls.flat().join('\n');
    expect(printed).not.toContain('opaque-spaced-table-canary');
    expect(printed).toContain('[redacted]');
    expect(printed).toContain(label);
    expect(printed).toContain('authorizationReadiness :');
    expect(printed).toContain('ready');
    expect(printed).toContain('resourceAuthorization :');
    expect(printed).toContain('tenant-owned');
  });

  test('redacts authorization credentials through error, info and table output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    out.error('Authorization: opaque-error-fixture');
    out.info('--authorization "opaque-info-fixture with spaces"');
    out.table([
      ['\u001b[36mAuthorization\u001b[39m', 'opaque-table-fixture'],
      ['resourceAuthorization', 'tenant-owned'],
      ['details', 'headers.authorization="opaque-details-fixture with spaces"'],
    ]);
    const printed = [...log.mock.calls, ...error.mock.calls].flat().join('\n');
    for (const secret of ['opaque-error-fixture', 'opaque-info-fixture', 'opaque-table-fixture', 'opaque-details-fixture', 'with spaces']) {
      expect(printed).not.toContain(secret);
    }
    expect(printed).toContain('resourceAuthorization');
    expect(printed).toContain('tenant-owned');
    expect(printed).toContain('\u001b[36mAuthorization\u001b[39m');
  });

  test('keeps authorization diagnostics readable while credential headers, tokens and secrets stay redacted', () => {
    const input = {
      schemaStatus: { authorizationReadiness: { status: 'ready', checkedAt: '2026-10-16T06:55:50Z' } },
      record: { metadata: { resourceAuthorization: { mode: 'tenant-owned', ownerAppKey: 'cu-trust-review' } } },
      headers: {
        Authorization: 'opaque-auth-header-fixture',
        'Proxy-Authorization': 'opaque-proxy-header-fixture',
        'x-ms-authorization-auxiliary': 'opaque-aux-header-fixture',
      },
      authorizationCode: 'opaque-auth-code-fixture',
      accessToken: 'opaque-access-token-fixture',
      clientSecret: 'opaque-client-secret-fixture',
      note: 'Authorization: Bearer opaque-bearer-fixture-123',
    };
    const expected = {
      schemaStatus: input.schemaStatus,
      record: input.record,
      headers: { Authorization: '[redacted]', 'Proxy-Authorization': '[redacted]', 'x-ms-authorization-auxiliary': '[redacted]' },
      authorizationCode: '[redacted]',
      accessToken: '[redacted]',
      clientSecret: '[redacted]',
      note: 'Authorization: Bearer [redacted]',
    };
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    out.json(input);
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toEqual(expected);
    expect(out.redactSensitiveDeep(input)).toEqual(expected);
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
