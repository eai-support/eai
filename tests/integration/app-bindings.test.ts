import { describe, expect, test } from 'vitest';
import { appCommand } from '../../src/commands/vertical.js';

describe('eai app bindings command schema', () => {
  test('exposes list, set, remove, and readiness validation', () => {
    const bindings = appCommand.commands.find((command) => command.name() === 'bindings');
    expect(bindings?.commands.map((command) => command.name())).toEqual([
      'list', 'set', 'remove', 'validate',
    ]);
  });
});
