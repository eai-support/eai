# Plan: CLI-Driven Tenant Auth Metadata Sync

Date: 2026-05-11

## Design Intent

When a user runs `eai` commands that create tenants or provision Entra app
registrations, the same platform call chain must also update the Configurator
CMS for that tenant. The user should not need a second manual Configurator or
Azure Portal step.

The CLI remains the entrypoint, but the persistence belongs in the platform
endpoints the CLI calls.

## Storage Model

### 1. Runtime Allowlist

Continue to use `tenants.authorizedApps[]` on the tenant record for runtime
authorization.

Purpose:

- PublicAPI token acceptance
- inherited app access for child tenants
- explicit proof that the app is allowed to act in the tenant

### 2. Tenant Metadata Record

Add a dedicated tenant-data record for platform-managed app registrations.

Recommended `dataType`:

- `app-registrations`

Reasoning:

- `entra-config` is already used for root-tenant branded login and single-app
  identity config.
- app registrations created by `eai-cli` are per-vertical operational assets,
  not the same concept as root-tenant login config.
- the CMS already supports record-per-type metadata with `upsertTenantData(...)`.

Recommended document shape:

```json
{
  "registrations": [
    {
      "key": "strategy-monitor",
      "provider": "entra-customer",
      "displayName": "eai-strategy-monitor",
      "clientId": "61d259bd-68b2-4608-b360-6591f3fa3673",
      "appObjectId": "graph-app-object-id",
      "redirectUris": [
        "http://localhost:3000/strategy-monitor/api/auth/callback/microsoft-entra-id"
      ],
      "scopes": ["openid", "profile", "email", "offline_access"],
      "environment": "dev",
      "status": "active",
      "authorizedAppsSynced": true,
      "authorizedAppsSyncedAt": "2026-05-11T12:34:56Z",
      "cloudConfig": {
        "label": "strategy-monitor",
        "keys": [
          "ENTRA_CLIENT_ID",
          "ENTRA_CLIENT_SECRET",
          "ENTRA_SCOPES",
          "ENTRA_REDIRECT_URIS",
          "ENTRA_ENVIRONMENT",
          "EAI_TENANT_ID"
        ],
        "secretKey": "ENTRA_CLIENT_SECRET"
      },
      "provisionedBy": "eai-cli",
      "lastProvisionedAt": "2026-05-11T12:34:56Z",
      "lastSecretRotatedAt": "2026-05-11T12:34:56Z"
    }
  ]
}
```

### 3. Secret Storage

Do not store plaintext client secrets in CMS.

Store the secret in platform-managed cloud config:

- Key Vault holds the secret value
- App Configuration label = vertical name
- App Config key = `ENTRA_CLIENT_SECRET`
- tenant-data stores the reference metadata needed for recovery

This keeps `eai env pull --include-secrets` compatible with the current
label-based retrieval model.

## Call Design

### A. Tenant Creation

Affected CLI calls:

- `eai tenant create`
- child-tenant creation inside `eai init`

Call behavior:

1. CLI calls the existing tenant-create endpoint.
2. Configurator writes or inherits `tenants.authorizedApps[]`.
3. Optional but recommended: seed an empty `app-registrations` tenant-data
   record for the new tenant.

Required outcome:

- newly created tenant is immediately ready for platform-managed app metadata.

### B. Entra Provisioning

Affected CLI calls:

- `eai provision entra`
- inline provisioning inside `eai init`

Call behavior:

1. CLI calls `PublicAPI POST /v3/provision/entra-app`.
2. PublicAPI creates, reuses, or rotates the app registration via AdminAPI.
3. PublicAPI synchronously updates `tenants.authorizedApps[]`.
4. PublicAPI synchronously upserts `tenant-data/app-registrations`.
5. PublicAPI synchronously writes the returned secret into App Config + Key
   Vault reference for the vertical label.
6. PublicAPI returns one combined response describing:
   - app registration details
   - tenant authorization outcome
   - tenant metadata upsert outcome
   - cloud secret persistence outcome
7. CLI patches `.env.local` from the response and can fall back to
   `eai env pull --include-secrets` using the same label if needed.

### C. Forced Recovery

`eai provision entra --force` should no longer mean "try the same idempotent
lookup again."

It should mean:

1. find the existing app registration
2. rotate the secret through the platform route
3. persist the new secret to cloud config
4. refresh tenant-data metadata timestamps
5. patch local `.env.local`

This is the path that fixes the example user journey where the app exists but
the local machine no longer has the secret.

## Service Ownership

### eai-cli

Owns:

- command UX
- operator messaging
- `--force` semantics
- local `.env.local` patching
- integration tests for the combined flow

Does not own:

- direct CMS writes
- direct Graph writes
- secret-of-record storage

### PublicAPI

Should own the orchestration boundary for CLI-triggered provisioning.

Owns:

- request validation
- tenant-admin authorization
- orchestration of AdminAPI + Configurator + cloud config writes
- combined response contract back to CLI

### AdminAPI

Owns:

- Graph app registration create/list/update/delete
- secret rotation

### Configurator

Owns:

- tenant record persistence (`authorizedApps[]`)
- tenant-data metadata persistence

## Failure Rules

- If app registration create/lookup fails: fail the whole command.
- If `authorizedApps[]` sync fails: fail the whole command.
- If tenant-data metadata upsert fails: fail the whole command.
- If secret persistence to cloud config fails on create or rotate: fail the
  whole command.
- Only local `.env.local` patching should be best-effort after the platform has
  already persisted the authoritative state.

This is stricter than the current best-effort tenant authorization side effect,
but it matches the user expectation that a successful CLI command leaves the
tenant fully usable.

## Implementation Notes

Configurator changes:

- add `app-registrations` to `TenantData` valid types and documentation
- reuse `upsertTenantData(...)`

PublicAPI changes:

- extend `POST /v3/provision/entra-app`
- make tenant CMS sync part of the success contract, not a warning-only side
  effect
- add response sections for metadata and cloud secret persistence

AdminAPI changes:

- expose enough app identity fields (`appObjectId`, `clientId`)
- use existing `rotate-secret` route for forced recovery
- add or reuse a cloud-config writer service if none exists yet

eai-cli changes:

- parse new response fields
- surface CMS sync status
- make `--force` invoke secret rotation behavior
- auto-hydrate from cloud config when the platform says the secret exists there
