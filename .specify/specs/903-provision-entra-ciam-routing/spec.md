# Specification: Provision Entra CIAM Routing

Date: 2026-04-13

## User Story

As a developer running `eai provision entra`, I want the app registration created in the CIAM tenant for my active EAI platform environment so that production, test, and dev verticals authenticate against the correct identity boundary.

## Acceptance Criteria

- AC-001: With no active named profile, `eai provision entra` uses the production platform API URL, and platform services default to production environment labels when environment variables are absent.
- AC-002: With `--profile test`, `eai provision entra` uses the test profile platform API URL even when `.env.local` contains another API URL.
- AC-003: With `--profile dev`, `eai provision entra` uses the dev profile platform API URL even when `.env.local` contains another API URL.
- AC-004: The CLI does not send a CIAM tenant, CIAM environment, or Graph credential selector in the provisioning request.
- AC-005: PublicAPI resolves `ADMIN_API_URL` at request time from the active deployment environment.
- AC-006: PublicAPI returns safe provisioning errors and never relays raw AdminAPI, Graph, route, tenant, or implementation details.
- AC-007: AdminAPI creates and lists app registrations using generic environment-specific CIAM Graph settings.
- AC-008: Legacy `azure_dev_*` AdminAPI settings remain supported as fallbacks until environment App Configuration is migrated.
- AC-009: AdminAPI resets the app-registration service singleton after App Configuration loads, so the service cannot keep credentials from an earlier config state.
- AC-010: CLI help and documentation explain that profile selection targets the platform environment, while CIAM selection is platform-owned.

## Non-Goals

- Letting users select arbitrary CIAM tenants from the CLI.
- Deploying or changing Azure App Configuration values.
- Changing ResourceAPI behavior.
- Rotating secrets for existing app registrations.
