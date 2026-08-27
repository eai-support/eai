import { describe, expect, test } from 'vitest';
import { promptCommand } from '../../src/commands/prompt.js';

describe('eai prompt command schema', () => {
  test('exposes scoped CRUD plus logical app binding', () => {
    expect(promptCommand.commands.map((command) => command.name())).toEqual([
      'list', 'show', 'create', 'update', 'delete', 'use',
    ]);
    const create = promptCommand.commands.find((command) => command.name() === 'create');
    expect(create?.options.map((option) => option.long)).toContain('--scope');
    expect(create?.options.map((option) => option.long)).toEqual(expect.arrayContaining([
      '--app', '--workflow', '--stage', '--step',
    ]));
  });
});
