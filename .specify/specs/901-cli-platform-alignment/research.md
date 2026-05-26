# Research: CLI Platform Alignment

## Scope

Align `eai` with the current platform and application patterns visible in the checked-out submodules:

- `PublicAPI`
- `AdminAPI`
- `ResourceAPI`
- `Configurator`
- `com.enterpriseaigroup`

Also normalize `.specify/specs` so active Gofer artifacts describe the current codebase instead of superseded tenant-env behavior.

## Key Findings

### 1. Tenant membership resolution has moved to AdminAPI-style memberships

`com.enterpriseaigroup/src/lib/public-api-users.ts` resolves tenant access through:

- `POST /v3/orchestrate` with `target_backend: "admin"`
- `GET /v1/users/{oid}/memberships`

This is a better fit for `eai` than the older `payload:/custom-users/me` assumption because it matches the live application pattern and gives tenant membership data directly.

### 2. User lookup/provision flows are split across AdminAPI and PublicAPI

Current submodule behavior shows:

- `AdminAPI/src/api/routes/users.py`
  - `GET /v1/users/by-email`
  - `GET /v1/users/{oid}/memberships`
  - `POST /v1/users/{oid}/provision`
- `PublicAPI/src/app/routers/v3/users.py`
  - `POST /v3/users/provisionme`
  - `POST /v3/users/invite`

For the current CLI command semantics ("lookup an existing user by email, then add them to a tenant"), the correct alignment is:

- lookup via AdminAPI
- provision via AdminAPI
- keep `provision-me` on PublicAPI

### 3. Tenant context should be account-scoped, not `.env.local`-scoped

The current CLI already moved most platform commands to:

- `eai login`
- `eai tenant select`
- stored active tenant context in `~/.eai/tokens.json`

The remaining drift was in older routes and in commands that still behaved as if they required project-local environment state.

### 4. Completed Gofer feature folders were stale or duplicated

The active feature set had multiple completed or overlapping folders:

- `cli-first-party-auth`
- `cli-help-enhancement`
- `cli-tenant-types-workflow`
- `900-cli-tenant-types-workflow`

They no longer represent the full current CLI behavior. They should be archived, with one fresh active feature folder describing the merged platform-alignment state.

## Implementation Guidance

1. Prefer AdminAPI memberships and user lookup/provision routes in the CLI.
2. Use the current PublicAPI-exposed route surface only; do not preserve obsolete membership fallbacks in the CLI.
3. Keep tenant selection driven by stored login context, not tenant IDs in `.env.local`.
4. Update tests so they cover admin-style membership payloads and admin-style user lookup responses.
5. Archive completed historical specs after creating a merged current feature folder.
