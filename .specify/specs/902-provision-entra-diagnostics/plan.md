# Plan: Provision Entra Diagnostics

Date: 2026-04-13

## Scope

Fix the CLI-side diagnosis for `eai provision entra` when the platform provisioning API returns `404`, `501`, or another non-OK response.

## Implementation Plan

1. Keep the provisioning request error sanitized at the API client boundary.
2. Add a typed API request error carrying only the operation and HTTP status metadata needed for safe mapping.
3. Throw that typed error from `PlatformAPIClient.provisionEntraApp`.
4. Update `src/commands/provision.ts` to render product-safe diagnostics for `404`, `501`, `403`, `409`, and generic failures.
5. Add integration coverage for `404` and `501` responses that contain sensitive backend content and assert that output does not leak it.
6. Update README and Starlight docs to document the endpoint and failure interpretation.

## Protected Boundaries

- Do not change platform service runtime behavior in this CLI patch.
- Do not rotate secrets for existing Entra app registrations.
- Do not change the existing idempotent request body shape.

## Verification

- `npx vitest run tests/integration/provision.test.ts`
- `npm run build`
- `npm run lint`
- `npm test`
- `npm --prefix docs run build`
