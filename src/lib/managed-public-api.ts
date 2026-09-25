const MANAGED_PUBLIC_API_PATTERN =
  /^https:\/\/(?:dev-api\.au|(?:test-api|api)\.(?:au|ca|eu))\.myenterprise\.ai\/public\/?$/;

/** Managed deployment credentials may only be sent to platform-owned regional gateways. */
export function requireManagedPublicApiUrl(value: string): string {
  if (!MANAGED_PUBLIC_API_PATTERN.test(value)) {
    throw new Error(
      'Managed deployment requires a trusted EAI regional PublicAPI HTTPS URL ending in /public.',
    );
  }
  return value.replace(/\/$/, '');
}
