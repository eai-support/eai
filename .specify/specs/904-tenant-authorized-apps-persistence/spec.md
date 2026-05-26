# Specification: Tenant Authorized Apps Persistence

Date: 2026-05-11

## User Story

As a tenant admin using `eai`, I want tenant creation and Entra app
provisioning to leave `tenants.authorizedApps[]` in the correct state so the
resulting tenant and app can authenticate against platform services without a
manual Configurator repair step.

## Acceptance Criteria

- AC-001: This feature treats `tenants.authorizedApps[]` as the mandatory
  runtime allowlist for app-token acceptance. No workflow record or alternate
  tenant record replaces this contract.
- AC-001a: The tenant CMS stores app-registration metadata in `tenant-data`
  using a dedicated dataType for platform-managed app registrations rather than
  overloading root-tenant `entra-config`.
- AC-002: Root tenant creation flows used by `eai` continue to create
  tenants through Configurator `/tenant-management`, so the tenant record
  includes the caller app's `azp` in `authorizedApps[]`.
- AC-003: Child tenant creation flows used by `eai` continue to create
  children through AdminAPI into Configurator `/tenant-management`, so the
  child tenant inherits the parent tenant's `authorizedApps[]`.
- AC-004: Entra app provisioning flows used by `eai` (`eai provision entra`
  and inline `eai init`) persist the provisioned or reconciled app `clientId`
  into `tenants.authorizedApps[]` before the CLI presents the app registration
  as ready for runtime use.
- AC-004a: The same provisioning flow upserts tenant-data app-registration
  metadata for the vertical, including `verticalName`, `clientId`,
  `appObjectId`, `redirectUris`, environment label, source command, and a cloud
  secret reference.
- AC-004b: `eai provision entra --force` rotates the secret through the
  platform route, persists the replacement secret to cloud config/Key Vault,
  and refreshes the tenant-data metadata record.
- AC-005: The provisioning API contract exposes the tenant-authorization
  outcome explicitly, and `eai` surfaces a clear success, repair, warning,
  or failure state based on that outcome rather than silently ignoring it.
- AC-005a: The provisioning API contract also exposes tenant-metadata upsert
  and cloud-secret persistence outcomes explicitly, and the CLI reports them in
  operator-friendly terms.
- AC-006: `eai` integration coverage includes:
  new registration success, existing-registration repair, and
  tenant-authorization warning/failure handling.
- AC-006a: `eai` integration coverage includes forced secret rotation and
  local secret hydration from the platform-managed cloud config label.
- AC-007: The feature is specified and tracked in
  `mod-tools/eai/.specify/specs/904-tenant-authorized-apps-persistence/`.
  No runtime code change is required in the `gofer` submodule for this work.

## Dependencies

- `mod-platform/Configurator` tenant creation and `authorizedApps[]` merge
  behavior.
- `mod-platform/Configurator` tenant-data collection and upsert helpers for the
  app-registration metadata document.
- `mod-platform/PublicAPI` `POST /v3/provision/entra-app` and
  `validate_azp_for_tenant(...)`.
- `mod-platform/AdminAPI` child-tenant creation proxy and app-registration
  provisioning plus secret rotation.
- `mod-tools/eai` provision and init command handling plus integration
  tests.

## Non-Goals

- Designing workflow-level auth metadata or workflow-owned app references.
- Replacing `tenants.authorizedApps[]` with `tenant-data[entra-config]`.
- Changing Gofer command generation, prompt generation, or pipeline runtime.
