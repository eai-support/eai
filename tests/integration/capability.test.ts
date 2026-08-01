import { describe, expect, test } from 'vitest';
import { capabilityCommand } from '../../src/commands/capability.js';

describe('eai capability command schema', () => {
  test('exposes discovery, status, governed setup guidance, and four-state doctor commands', () => {
    expect(capabilityCommand.commands.map((command) => command.name())).toEqual([
      'list',
      'status',
      'setup',
      'doctor',
    ]);
    expect(capabilityCommand.commands.find((command) => command.name() === 'setup')?.description())
      .toMatch(/without changing credentials/);
  });
});
