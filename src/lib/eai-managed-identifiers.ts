export const MANAGED_DEPLOYMENT_IDENTIFIER_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const MANAGED_SCOPE_IDENTIFIER_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Return true only for one bounded opaque managed-deployment path segment. */
export function isManagedDeploymentIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    MANAGED_DEPLOYMENT_IDENTIFIER_PATTERN.test(value)
  );
}

/** Require one exact bounded opaque managed-deployment operation ID. */
export function requireManagedDeploymentIdentifier(
  value: unknown,
  label: string,
): string {
  if (!isManagedDeploymentIdentifier(value)) {
    throw new Error(
      `${label} must be a safe exact managed-deployment identifier.`,
    );
  }
  return value;
}

/** Scope segments permit dots used by existing app keys and tenant slugs. */
export function isManagedScopeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" && MANAGED_SCOPE_IDENTIFIER_PATTERN.test(value)
  );
}

export function requireManagedScopeIdentifier(
  value: unknown,
  label: string,
): string {
  if (!isManagedScopeIdentifier(value)) {
    throw new Error(`${label} must be a safe exact managed-deployment scope.`);
  }
  return value;
}
