/**
 * Shared utilities — consolidated from duplicate definitions across commands.
 */

/**
 * Convert an object type name (camelCase or snake_case) to a kebab-case slug.
 * Previously duplicated in: api.ts, types.ts, resources.ts
 */
export function toObjectTypeSlug(objectType: string): string {
  return objectType
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

/**
 * Type guard for plain objects.
 * Previously duplicated in: types.ts, resources.ts, verify.ts
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extract a message string from an unknown error.
 * Replaces inline `err instanceof Error ? err.message : String(err)` ternaries.
 */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const CHILD_TENANT_NAME_REQUIRED_MESSAGE =
  "A child company tenant name is required. Pass `--child-tenant <name>`.";

export function normalizeChildTenantDisplayNameOption(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(CHILD_TENANT_NAME_REQUIRED_MESSAGE);
  }
  return trimmed;
}
