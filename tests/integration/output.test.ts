import { afterEach, describe, expect, test, vi } from 'vitest';
import * as out from '../../src/lib/output.js';

describe('output redaction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('redacts common secret shapes from text output', () => {
    const token = 'eyJaaaaaaaaaaa.bbbbbbbbbbb.ccccccccccc';
    const message = out.redactSensitiveText(
      `Authorization: Bearer ${token} EAI_ACCESS_TOKEN=plain-secret clientSecret: abc123`,
    );

    expect(message).not.toContain(token);
    expect(message).not.toContain('plain-secret');
    expect(message).not.toContain('abc123');
    expect(message).toContain('Bearer [redacted]');
    expect(message).toContain('EAI_ACCESS_TOKEN=[redacted]');
    expect(message).toContain('clientSecret: [redacted]');
  });

  test('redacts sensitive keys from JSON output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    out.json({
      tenantId: 'tenant-123',
      accessToken: 'secret-token',
      nested: {
        clientSecret: 'secret-client-value',
      },
    });

    const printed = String(log.mock.calls[0]?.[0] ?? '');
    expect(printed).toContain('"tenantId": "tenant-123"');
    expect(printed).not.toContain('secret-token');
    expect(printed).not.toContain('secret-client-value');
    expect(printed).toContain('"accessToken": "[redacted]"');
    expect(printed).toContain('"clientSecret": "[redacted]"');
  });
});
