import { describe, expect, test } from 'vitest';
import {
  buildMissingPublishedTypeMessage,
  matchPublishedType,
} from '../../src/commands/resources.js';

describe('resource type diagnostics', () => {
  test('matches published type by slug-compatible name', () => {
    const match = matchPublishedType('ConversationMessage', [{
      name: 'conversation-message',
      slug: 'conversation-message',
      properties: [],
      linkTypes: [],
      actions: [],
    }]);

    expect(match.matchedType?.slug).toBe('conversation-message');
  });

  test('describes empty published schema clearly', () => {
    const message = buildMissingPublishedTypeMessage(matchPublishedType('ConversationMessage', []));

    expect(message).toContain('No published object types were found for the active tenant');
    expect(message).toContain('ConversationMessage');
  });

  test('describes mismatched requested type using published names', () => {
    const message = buildMissingPublishedTypeMessage(matchPublishedType('ConversationMessage', [{
      name: 'Application',
      slug: 'application',
      properties: [],
      linkTypes: [],
      actions: [],
    }]));

    expect(message).toContain('Object type "ConversationMessage" is not published');
    expect(message).toContain('Application');
  });
});
