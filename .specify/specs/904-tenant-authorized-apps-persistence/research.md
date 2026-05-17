# Research: Tenant Authorized Apps Persistence

Date: 2026-05-11

## Repositories Reviewed

- `mod-tools/gofer`: pipeline and artifact-generation responsibilities.
- `mod-tools/eai`: tenant creation, `eai init`, and `eai provision entra`.
- `mod-platform/Configurator`: tenant persistence and `authorizedApps[]` merge rules.
- `mod-platform/AdminAPI`: child-tenant creation and Configurator proxying.
- `mod-platform/PublicAPI`: Entra provisioning and runtime `azp` validation.

## Current Flow

1. Root tenant creation from `eai` uses Configurator `POST /tenant-management`.
   Configurator merges three sources into `tenants.authorizedApps[]`:
   request-provided `authorizedApps`, inherited parent `authorizedApps`, and
   the caller app's `azp`.
2. Child tenant creation from `eai` uses AdminAPI
   `POST /v1/tenants/{parent}/children`, which calls
   `ConfiguratorService.create_tenant(...)` with `parent_tenant_id`.
   Configurator still creates the tenant through `/tenant-management`, so the
   child inherits the parent's `authorizedApps[]`.
3. `eai provision entra` and the inline Entra step inside `eai init` both call
   `PublicAPI POST /v3/provision/entra-app`.
4. PublicAPI provisions or reuses the app registration through AdminAPI, then
   calls `_authorize_app_on_tenant(...)` to append the returned `clientId` to
   `tenants.authorizedApps[]`.
5. Runtime acceptance of app-issued tokens happens against
   `tenants.authorizedApps[]` in `PublicAPI.validate_azp_for_tenant(...)`.
   This is the contract that matters for app access.

## Findings

- `tenants.authorizedApps[]` is the canonical runtime allowlist. It is the
  tenant-side record the platform checks when deciding whether an app token can
  operate inside a tenant.
- Tenant initialization and Entra provisioning solve different problems:
  tenant initialization seeds platform/provisioner access, while Entra
  provisioning adds the vertical app's own `clientId`.
- `tenant-data[entra-config]` exists in Configurator and can support richer
  tenant auth metadata, but it does not replace `authorizedApps[]` for runtime
  token acceptance.
- The Gofer submodule is not part of runtime provisioning. Its role here is
  only to host the workflow that produces the spec artifacts in the correct
  repository.
- PublicAPI already tests the post-provision `authorizedApps[]` side effect,
  including fresh-create, existing-app repair, race, and warning paths.
- `eai` currently consumes the provisioning response for `clientId`,
  `clientSecret`, scopes, redirect URIs, and environment metadata, but it does
  not currently surface the `tenant_authorization` summary back to the
  operator.

## Decision

The spec belongs in `mod-tools/eai`, but the behavior it describes spans
multiple services:

- `eai` owns the operator contract, tests, and messaging.
- `PublicAPI` owns the "provision app + persist to `authorizedApps[]`" API
  contract.
- `Configurator` owns the tenant record and merge semantics.
- `AdminAPI` remains a dependency for child-tenant creation and app-reg
  creation, not the source of truth for runtime tenant authorization.

## Recommended Scope

- Treat `tenants.authorizedApps[]` as the required persistence target for this
  feature.
- Keep the feature focused on two moments:
  root/child tenant creation and Entra app provisioning.
- Require `eai` to expose whether tenant authorization was actually
  confirmed after provisioning.

## Deferred Items

- Workflow-level storage such as `authAppKey` or workflow-specific auth
  metadata.
- Secret recovery and rotation behavior for existing registrations.
- Expanding `tenant-data[entra-config]` beyond the current runtime need.
- Any changes to Gofer command generation or pipeline runtime behavior.
