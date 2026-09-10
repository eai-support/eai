import { describe, expect, test } from 'vitest';
import { aiCommand } from '../../src/commands/ai.js';

describe('eai ai profile command schema', () => {
  test('exposes full typed CRUD plus logical app binding', () => {
    const profile = aiCommand.commands.find((command) => command.name() === 'profile');
    expect(profile?.commands.map((command) => command.name())).toEqual([
      'list', 'show', 'create', 'update', 'delete', 'use',
    ]);
  });
});
