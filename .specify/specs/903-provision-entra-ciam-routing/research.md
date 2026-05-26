# Research: Provision Entra CIAM Routing

Date: 2026-04-13

## Repositories Reviewed

- `eai`: profile selection, tenant context, and `eai provision entra`.
- `PublicAPI`: public provisioning route and environment config loading.
- `AdminAPI`: app registration service, auth validation, App Configuration loading.
- `ResourceAPI`: environment-owned CIAM configuration pattern; no app registration creation path.

## Current Flow

1. The CLI resolves `BASE_URL_PUBLIC_API` using active profile, local env, login metadata, then default URL.
2. The CLI posts provisioning data for the active tenant and vertical to the platform provisioning API.
3. PublicAPI exchanges the user token for an AdminAPI token, checks provisioning authorization, then calls AdminAPI.
4. AdminAPI creates or lists app registrations in Microsoft Graph using service-owned credentials.

## Findings

- The CLI already has the right abstraction for environment selection: named profiles.
- A client-provided `environment`, `ciamTenantId`, or similar field would be unsafe because it lets callers request a CIAM target.
- PublicAPI had a module-level AdminAPI URL fallback. That can become stale or point at localhost if routers are imported before App Configuration is loaded.
- AdminAPI used legacy `azure_dev_*` field names for Graph credentials. The values may work, but the naming hides that every deployment must load its own CIAM credentials.
- ResourceAPI does not create app registrations. It confirms the platform pattern that each service reads CIAM settings from its active environment.

## Decision

CIAM routing is a backend-owned environment decision:

- CLI profile selects only the platform API environment.
- PublicAPI resolves AdminAPI URL from env/App Configuration for the active deployment at request time.
- AdminAPI uses generic CIAM Graph settings loaded from the active deployment environment.
- Legacy `azure_dev_*` settings remain fallback-only during App Configuration migration.
- PublicAPI maps downstream failures to safe public provisioning errors.
- CLI maps public provisioning failures to stable support references without printing raw response details.

## Environment Contract

Required AdminAPI App Configuration keys, with `ADMIN_` prefix before loading:

- `ADMIN_ENTRA_CIAM_TENANT_ID`
- `ADMIN_ENTRA_CIAM_CLIENT_ID`
- `ADMIN_ENTRA_CIAM_CLIENT_SECRET`
- `ADMIN_OBO_CLIENT_ID`
- `ADMIN_OBO_TENANT_NAME`

Required PublicAPI App Configuration key:

- `ADMIN_API_URL`

Each deployment label (`prod`, `test`, `dev`) owns its own values.
