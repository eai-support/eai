import { describe, expect, it } from 'vitest';

import {
  OBJECT_TYPE_ROUTING_CONTRACT_VERSION,
  ObjectTypeIdentifierError,
  deriveObjectTypeSlugV1,
  isCanonicalObjectTypeSlug,
  validateObjectTypeIdentifierPair,
} from '../../src/lib/object-type-identifiers.js';

const vectors = [
  ['FeedItem', 'feed-item', true],
  ['APIKey', 'api-key', true],
  ['HTTPFeedItem', 'http-feed-item', true],
  ['V2FeedItem', 'v2-feed-item', true],
  ['GitHubConnection', 'git-hub-connection', true],
  ['Sent_Post', 'sent-post', false],
  ['  Feed  Item  ', 'feed-item', false],
  ['Draft--Item', 'draft-item', false],
  ['operations', 'operations', false],
  ['', '', false],
  ['---', '', false],
] as const;

describe('Object Type identifier contract', () => {
  it('implements all ordered eai.object-type-routing/v1 vectors', () => {
    expect(OBJECT_TYPE_ROUTING_CONTRACT_VERSION).toBe('eai.object-type-routing/v1');

    for (const [input, output] of vectors) {
      expect(deriveObjectTypeSlugV1(input)).toBe(output);
    }
  });

  it('accepts valid names only with the exact derived slug', () => {
    for (const [name, slug, manifestNameValid] of vectors) {
      if (!manifestNameValid) continue;

      expect(validateObjectTypeIdentifierPair({ name, slug })).toEqual({
        contractVersion: 'eai.object-type-routing/v1',
        name,
        slug,
      });
      expect(validateObjectTypeIdentifierPair({ name })).toEqual({
        contractVersion: 'eai.object-type-routing/v1',
        name,
        slug,
      });
    }
  });

  it('accepts only non-reserved kebab-case transport slugs', () => {
    expect(isCanonicalObjectTypeSlug('opameasure')).toBe(true);
    expect(isCanonicalObjectTypeSlug('opa-measure')).toBe(true);
    expect(isCanonicalObjectTypeSlug('OPAMeasure')).toBe(false);
    expect(isCanonicalObjectTypeSlug('operations')).toBe(false);
  });

  it.each([
    ['GitHubConnection', 'github-connection'],
    ['ObservabilityAISummary', 'observability-aisummary'],
    ['OPAMeasure', 'opameasure'],
  ])('preserves the audited historical %s/%s pair', (name, slug) => {
    expect(
      validateObjectTypeIdentifierPair(
        { name, slug },
        { requireExplicitSlug: true },
      ),
    ).toEqual({
      contractVersion: OBJECT_TYPE_ROUTING_CONTRACT_VERSION,
      name,
      slug,
    });
  });

  it.each([
    [{ name: 'Sent_Post', slug: 'sent-post' }, 'OBJECT_TYPE_NAME_NON_CANONICAL'],
    [{ name: 'FeedItem', slug: '' }, 'OBJECT_TYPE_SLUG_MISSING'],
    [{ name: 'FeedItem', slug: 'FeedItem' }, 'OBJECT_TYPE_SLUG_NON_CANONICAL'],
    [{ name: 'FeedItem', slug: 'operations' }, 'OBJECT_TYPE_SLUG_NON_CANONICAL'],
    [{ name: 'FeedItem', slug: 'feeditem' }, 'OBJECT_TYPE_SLUG_DERIVATION_MISMATCH'],
    [{ name: 'BusinessCase', slug: 'businesscase' }, 'OBJECT_TYPE_SLUG_DERIVATION_MISMATCH'],
  ])('rejects invalid new source pair %#', (pair, code) => {
    expect(() => validateObjectTypeIdentifierPair(pair)).toThrow(ObjectTypeIdentifierError);

    try {
      validateObjectTypeIdentifierPair(pair);
    } catch (error) {
      expect(error).toMatchObject({ code });
    }
  });
});
