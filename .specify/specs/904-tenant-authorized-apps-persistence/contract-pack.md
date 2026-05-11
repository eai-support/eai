# Contract Pack: Tenant Authorized Apps Persistence

Date: 2026-05-11

## Actors

- Tenant admin running `eai-cli`
- `eai-cli` as the operator-facing command surface
- PublicAPI as orchestration boundary
- AdminAPI as Entra/Graph app-registration owner
- Configurator as tenant and tenant-data CMS owner
- Azure App Configuration and Key Vault as secret-of-record storage

## Object Types

- `tenants` record
  - authoritative runtime allowlist field: `authorizedApps[]`
- `tenant-data` record
  - new `dataType`: `app-registrations`
  - authoritative tenant metadata catalog for CLI-managed app registrations
- Entra app registration
  - authoritative external identity object in Microsoft Graph

## Workflows And Journeys

### Tenant Creation Journey

1. User runs `eai tenant create` or child-tenant creation inside `eai init`.
2. Platform creates tenant through Configurator tenant-management flow.
3. Platform seeds or inherits `authorizedApps[]`.
4. Platform optionally seeds empty `app-registrations` tenant-data for the new tenant.

### Entra Provisioning Journey

1. User runs `eai provision entra`.
2. CLI calls PublicAPI.
3. PublicAPI creates, reuses, or rotates the app via AdminAPI.
4. PublicAPI updates tenant runtime allowlist.
5. PublicAPI upserts tenant CMS metadata.
6. PublicAPI persists secret/config to cloud config.
7. CLI patches local env from authoritative platform state.

### Forced Recovery Journey

1. User runs `eai provision entra --force`.
2. Platform finds existing app registration.
3. Platform rotates secret through AdminAPI.
4. Platform writes new secret to cloud config.
5. Platform refreshes tenant metadata timestamps and status.
6. CLI hydrates `.env.local`.

## Permissions And Tenant Boundaries

- Only tenant admins may create child tenants and provision or rotate Entra app registrations.
- `authorizedApps[]` is tenant-scoped runtime authorization data and may be inherited from parent to child only through explicit tenant-creation logic.
- `tenant-data/app-registrations` is tenant-scoped metadata and must not leak across tenants except via intentional tenant creation seeding.
- Plaintext client secrets must never be persisted in tenant CMS JSON.

## APIs And Events

### CLI Entry Calls

- `POST /tenant-management`
- `POST /v1/tenants/{parent}/children`
- `POST /v3/provision/entra-app`

### Internal Platform Calls

- PublicAPI -> AdminAPI app registration create/list/rotate
- PublicAPI -> Configurator tenant lookup and `authorizedApps[]` sync
- PublicAPI -> Configurator tenant-data upsert for `app-registrations`
- PublicAPI and/or AdminAPI -> cloud config writer for App Config + Key Vault reference persistence

### Required Response Contract

`POST /v3/provision/entra-app` must return:

- app registration identifiers
- `tenant_authorization` outcome
- tenant metadata upsert outcome
- cloud secret persistence outcome
- sign-in completeness outcome

## State Authority And Ordered Write Flow

### Authoritative Stores

- Runtime app access: `tenants.authorizedApps[]`
- Tenant app metadata: `tenant-data/app-registrations`
- Secret-of-record: Key Vault via App Configuration reference
- Local developer convenience copy: `.env.local`

### Ordered Write Chain

1. Create or resolve app registration in Entra.
2. Confirm identifiers (`clientId`, `appObjectId`).
3. Sync `tenants.authorizedApps[]`.
4. Upsert `tenant-data/app-registrations`.
5. Persist `ENTRA_CLIENT_SECRET` and related config to cloud config.
6. Return success response to CLI.
7. Patch local `.env.local`.

### Failure Gates

- If step 1 fails: fail command.
- If step 3 fails: fail command.
- If step 4 fails: fail command.
- If step 5 fails: fail command.
- Step 7 may be retried locally because the authoritative state already exists.

## Deployment And Runtime

- App Config label should remain the vertical/app name so `eai env pull --include-secrets` can recover secrets consistently.
- Runtime auth acceptance continues to read `authorizedApps[]` through PublicAPI validation.
- Configurator tenant-data upsert should use existing `upsertTenantData(...)` semantics.
- `eai-cli` should treat local env as a mirror of platform-owned state, not the source of truth.

## Acceptance Tests

- New app registration writes `clientId` into `authorizedApps[]`.
- Existing app registration repair writes missing `clientId` into `authorizedApps[]`.
- Tenant-data `app-registrations` is created or updated on create, existing-app reuse, and forced rotation.
- Forced rotation returns a new secret and persists it to cloud config.
- `eai env pull --include-secrets` can recover `ENTRA_CLIENT_SECRET` using the vertical label after forced rotation.
- Child tenant creation preserves inherited runtime allowlist and can accept later app metadata writes.
- Provision command fails if runtime allowlist sync, tenant-data upsert, or cloud-secret persistence fails.
