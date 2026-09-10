import { describe, expect, test } from 'vitest';
import { integrationCommand } from '../../src/commands/integration.js';

describe('eai integration command schema', () => {
  test('allows sanitized reads, testing, and binding but no secret mutation', () => {
    expect(integrationCommand.commands.map((command) => command.name())).toEqual([
      'list',
      'show',
      'test',
      'use',
    ]);
    expect(integrationCommand.commands.map((command) => command.name())).not.toContain('set-secret');
  });
});
