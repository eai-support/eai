import { describe, expect, test } from 'vitest';
import { contentCommand } from '../../src/commands/content.js';

describe('eai content command schema', () => {
  test('exposes read/select/bind operations without shared-content mutation', () => {
    const names = contentCommand.commands.map((command) => command.name());
    expect(names).toEqual([
      'document-template',
      'email-template',
      'knowledge-article',
      'policy',
      'document-type',
      'document-checklist',
      'requirement-group',
      'shared-asset',
    ]);

    for (const command of contentCommand.commands) {
      const operations = command.commands.map((item) => item.name());
      expect(operations).not.toContain('create');
      expect(operations).not.toContain('update');
      expect(operations).not.toContain('delete');
    }
    expect(contentCommand.commands.find((command) => command.name() === 'policy')?.commands.map((item) => item.name()))
      .toEqual(['list', 'show']);
    expect(contentCommand.commands.find((command) => command.name() === 'shared-asset')?.commands.map((item) => item.name()))
      .toEqual(['types', 'list', 'show', 'use']);
  });
});
