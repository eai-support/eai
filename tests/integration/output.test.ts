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
});
