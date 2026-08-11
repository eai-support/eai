/** Canonical Object Type identifier contract used by new CLI source artifacts. */

export const OBJECT_TYPE_ROUTING_CONTRACT_VERSION = 'eai.object-type-routing/v1';

const OBJECT_TYPE_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
const OBJECT_TYPE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_OBJECT_TYPE_SLUGS = new Set(['operations', 'query', 'search', 'storage']);
const SUPPORTED_LEGACY_IDENTIFIER_PAIRS = new Set([
  'GitHubConnection\u0000github-connection',
  'ObservabilityAISummary\u0000observability-aisummary',
  'OPAMeasure\u0000opameasure',
]);

export type ObjectTypeIdentifierErrorCode =
  | 'OBJECT_TYPE_NAME_NON_CANONICAL'
  | 'OBJECT_TYPE_SLUG_MISSING'
  | 'OBJECT_TYPE_SLUG_NON_CANONICAL'
  | 'OBJECT_TYPE_SLUG_DERIVATION_MISMATCH'
  | 'OBJECT_TYPE_LINK_TARGET_UNRESOLVED';

export class ObjectTypeIdentifierError extends Error {
  public constructor(
    public readonly code: ObjectTypeIdentifierErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ObjectTypeIdentifierError';
  }
}

export interface ObjectTypeIdentifierInput {
  readonly name: string;
  readonly slug?: string;
}

export interface ObjectTypeIdentifierPair {
  readonly contractVersion: typeof OBJECT_TYPE_ROUTING_CONTRACT_VERSION;
  readonly name: string;
  readonly slug: string;
}

export interface ObjectTypeIdentifierValidationOptions {
  /** Source manifests must declare the slug rather than relying on a default. */
  readonly requireExplicitSlug?: boolean;
}

/**
 * Derive the v1 transport slug from a display/model identifier.
 *
 * This intentionally normalizes only for derivation. New source manifests are
 * validated separately and may not use a normalized name or a reserved slug.
 */
export function deriveObjectTypeSlugV1(name: string): string {
  return name
    .replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\t\n\v\f\r ]+|_+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** Return whether a value is safe to use as an exact Object Type route slug. */
export function isCanonicalObjectTypeSlug(value: string): boolean {
  return (
    OBJECT_TYPE_SLUG_PATTERN.test(value) &&
    !RESERVED_OBJECT_TYPE_SLUGS.has(value)
  );
}

export function validateObjectTypeIdentifierPair(
  input: ObjectTypeIdentifierInput,
  options: ObjectTypeIdentifierValidationOptions = {},
): ObjectTypeIdentifierPair {
  if (!OBJECT_TYPE_NAME_PATTERN.test(input.name)) {
    throw new ObjectTypeIdentifierError(
      'OBJECT_TYPE_NAME_NON_CANONICAL',
      `Object Type name "${input.name}" must match ${OBJECT_TYPE_NAME_PATTERN.source}.`,
    );
  }

  if (input.slug === undefined || input.slug === '') {
    if (options.requireExplicitSlug || input.slug === '') {
      throw new ObjectTypeIdentifierError(
        'OBJECT_TYPE_SLUG_MISSING',
        `Object Type "${input.name}" must declare its canonical slug.`,
      );
    }
    return {
      contractVersion: OBJECT_TYPE_ROUTING_CONTRACT_VERSION,
      name: input.name,
      slug: deriveObjectTypeSlugV1(input.name),
    };
  }

  if (!isCanonicalObjectTypeSlug(input.slug)) {
    throw new ObjectTypeIdentifierError(
      'OBJECT_TYPE_SLUG_NON_CANONICAL',
      `Object Type slug "${input.slug}" must be a non-reserved canonical kebab-case slug.`,
    );
  }

  const expectedSlug = deriveObjectTypeSlugV1(input.name);
  const supportedLegacyPair = SUPPORTED_LEGACY_IDENTIFIER_PAIRS.has(
    `${input.name}\u0000${input.slug}`,
  );
  if (input.slug !== expectedSlug && !supportedLegacyPair) {
    throw new ObjectTypeIdentifierError(
      'OBJECT_TYPE_SLUG_DERIVATION_MISMATCH',
      `Object Type slug "${input.slug}" must equal the v1 derivation "${expectedSlug}" for "${input.name}".`,
    );
  }

  return {
    contractVersion: OBJECT_TYPE_ROUTING_CONTRACT_VERSION,
    name: input.name,
    slug: input.slug,
  };
}
