---
title: Error Guidance
description: Public-safe EAI CLI error explanations and agent recovery commands.
---

# Error Guidance

This page lists the public-safe error guidance bundled with `@enterpriseai/cli`
v3.15.3. The same catalog powers human stderr output, JSON output for AI
agents, and `eai errors explain`.

Agents should run read-only diagnostics first, run mutating fixes only when they
are explicitly listed, and stop when a stop condition matches.

## Summary

| Code | Reason | Title |
| --- | --- | --- |
| `E001` | `not_in_eai_project` | Not in an EAI project. |
| `E101` | `not_logged_in` | Not logged in. |
| `E102` | `access_token_expired` | Access token expired. |
| `E204` | `permission_denied` | Permission denied. |
| `E205` | `child_relation_invalid` | The supplied tenant is not an immediate child of the supplied parent. |
| `E245` | `user_invite_external_service_existing_member` | Tenant member invite failed, but an existing member role repair may be available. |
| `E246` | `app_token_tenant_context_required` | App-token platform user lookup is missing tenant context. |
| `E247` | `calling_application_not_authorized` | The application making this request is not authorized for the tenant. |
| `E242` | `tenant_authorization_incomplete` | Tenant data-plane authorization incomplete. |
| `E243` | `tenant_authorization_platform_error` | Tenant app authorization could not be completed because the platform returned a server error. |
| `E250` | `paid_upgrade_required` | Tenant plan does not allow this builder operation. |
| `E260` | `object_type_validation_failed` | Object Type validation failed. |
| `E270` | `object_type_not_published` | Object Type is not published for the active tenant. |
| `E275` | `resource_search_embedding_required` | Semantic resource search is not ready for this tenant. |
| `E276` | `resource_mutation_contract_invalid` | The PublicAPI v4 resource mutation contract is invalid. |
| `E280` | `workflow_operator_required` | Workflow runtime binding requires operator assistance. |
| `E244` | `tenant_data_install_no_match` | Tenant data/schema setup is not fully provisioned. |

## E001: Not in an EAI project.

| Field | Value |
| --- | --- |
| Reason | `not_in_eai_project` |
| Category | `project` |
| Severity | `error` |

### Why This Might Happen

- The current folder does not contain the project markers created by eai init.
- The command needs a project root so it can read local app configuration safely.
- You may be one directory above or below the generated app folder.

### Diagnostics

- `pwd` (read-only) — Confirm the current folder before changing anything.
- `eai verify` (read-only) — Check whether the current folder is an EAI project.
- `eai template check --format json` (read-only) — If this is an EAI project, inspect template drift without writing files.

### Fixes

- `cd <existing-eai-project>` (read-only) — Move into a folder that has already been initialized.
- `eai init <app-name>` (changes state) — Create a new EAI app project when this folder should become one.

### Stop Conditions

- The folder still has no EAI project markers after eai init or changing directory.

### Escalation Evidence

- command
- CLI version
- working directory shape without secrets

## E101: Not logged in.

| Field | Value |
| --- | --- |
| Reason | `not_logged_in` |
| Category | `authentication` |
| Severity | `error` |

### Why This Might Happen

- The CLI does not have a usable local sign-in token.
- The token may have expired or been created for a different local profile.
- The command needs a user session before it can resolve tenant access.

### Diagnostics

- `eai whoami` (read-only) — Show the current login and active tenant status.
- `eai tenant list --format json` (read-only) — Confirm tenant memberships after login succeeds. After eai login succeeds.

### Fixes

- `eai login` (changes state) — Authenticate with the EAI identity flow.
- `eai login --callback-port <port>` (changes state) — Use a fixed local callback port for Codespaces or locked-down environments. Use when the browser callback cannot reach the CLI.

### Stop Conditions

- The browser sign-in flow repeatedly fails with the same identity error.

### Escalation Evidence

- signed-in email
- CLI version
- active profile
- tenant list output without secrets

## E102: Access token expired.

| Field | Value |
| --- | --- |
| Reason | `access_token_expired` |
| Category | `authentication` |
| Severity | `error` |

### Why This Might Happen

- The saved user session is older than the identity provider allows.
- The CLI cannot refresh the session silently in this environment.
- The command needs a fresh user token before it can call tenant-scoped APIs.

### Diagnostics

- `eai whoami` (read-only) — Confirm the expired session and active profile.

### Fixes

- `eai login` (changes state) — Refresh the local user session.

### Stop Conditions

- A fresh login still returns an expired-token result.

### Escalation Evidence

- CLI version
- active profile
- token expiry time without token values

## E204: Permission denied.

| Field | Value |
| --- | --- |
| Reason | `permission_denied` |
| Category | `authorization` |
| Severity | `error` |

### Why This Might Happen

- The signed-in user can authenticate, but does not have the role required for this action.
- The active tenant may not be the tenant where the user has the needed role.
- The app or resource may require a tenant-admin or builder-level action.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user and active tenant.
- `eai tenant list --all --format json` (read-only) — List visible tenant memberships and roles.

### Fixes

- `eai tenant select <tenant>` (changes state) — Switch to a tenant where the user has the required role.
- `eai user invite --email <email> --tenant <tenant-id> --role tenant-admin` (changes state) — Add or refresh a user membership and assign a tenant role when you are already tenant-admin for that tenant. Use for normal "add this person as a tenant member/admin" requests.
- `eai user roles --tenant <tenant-id> --format json` (read-only) — List assignable tenant roles before choosing a role for an invite.
- `eai tenant bootstrap-admin --parent <parent-id> --child <child-id>` (changes state) — Repair first tenant-admin access for an immediate child tenant. Only when the target tenant is an immediate child of the supplied parent and does not already have usable tenant-admin access.

### Stop Conditions

- The user lacks the required tenant role. Retrying will not change authorization.

### Escalation Evidence

- signed-in email
- active tenant slug
- requested command
- request ID if present

## E205: The supplied tenant is not an immediate child of the supplied parent.

| Field | Value |
| --- | --- |
| Reason | `child_relation_invalid` |
| Category | `authorization` |
| Severity | `error` |

### Why This Might Happen

- The child-tenant bootstrap command is intentionally narrow.
- It only works when the parent ID is the direct parent of the child tenant.
- This error often appears when an agent uses bootstrap-admin for normal user addition instead of the tenant member invite flow.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user and active tenant.
- `eai tenant info <tenant-id> --format json` (read-only) — Inspect the target tenant before retrying a tenant relationship command.
- `eai user roles --tenant <tenant-id> --format json` (read-only) — List assignable roles when the intended task is adding or updating a user.

### Fixes

- `eai user invite --email <email> --tenant <tenant-id> --role tenant-admin` (changes state) — Add or update a user as tenant-admin on an existing tenant. Use when the goal is to add a person to a tenant or app context.
- `eai tenant bootstrap-admin --parent <direct-parent-id> --child <immediate-child-id>` (changes state) — Retry the child bootstrap repair with the direct parent and immediate child IDs. Use only for first-admin child tenant repair, not normal member management.

### Stop Conditions

- The supplied parent and child are not a direct parent-child pair.

### Escalation Evidence

- signed-in email
- active tenant slug
- target tenant slug
- requested command

## E245: Tenant member invite failed, but an existing member role repair may be available.

| Field | Value |
| --- | --- |
| Reason | `user_invite_external_service_existing_member` |
| Category | `external_service` |
| Severity | `error` |

### Why This Might Happen

- The invite/add flow reached an external identity or notification dependency that returned a server-side failure.
- The target person may already exist as a direct tenant member with a lower role, so retrying the same invite can fail without changing access.
- When a member record already exists, the supported recovery is to update that member through EAI CLI instead of editing data stores or cloud portals directly.
- Applications may cache tenant role claims in their Auth.js session or JWT, so the user may need to sign out and sign back in after a role change.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user, active tenant, and profile before changing membership.
- `eai user roles --tenant <tenant-id> --format json` (read-only) — Confirm the target role is assignable in this tenant.
- `eai user list --tenant <tenant-id> --search <email> --format json` (read-only) — Check whether the person already exists as a direct tenant member and capture the member ID.

### Fixes

- `eai user role set --tenant <tenant-id> --member-id <member-id> --role tenant-admin --format json` (changes state) — Update the existing direct member to tenant-admin through the approved EAI tenant-member role endpoint. Use only after eai user list confirms the existing member ID and the user approves the role change.
- `eai user invite --email <email> --tenant <tenant-id> --role <role> --format json` (changes state) — Retry the normal invite/add flow when no existing direct member is found and the failure was transient. Use only within the retry limit and after read-only diagnostics confirm the tenant and role.

### Stop Conditions

- The same external service error repeats after bounded retry.
- The existing member is found but role update is not approved by the user.
- The signed-in user is not allowed to change tenant membership.

### Escalation Evidence

- request ID
- HTTP status
- server code
- CLI version
- active tenant slug
- redacted command shape

## E246: App-token platform user lookup is missing tenant context.

| Field | Value |
| --- | --- |
| Reason | `app_token_tenant_context_required` |
| Category | `tenant_context` |
| Severity | `error` |

### Why This Might Happen

- The platform call authenticated, but the request did not carry the tenant context required for app-token user or membership operations.
- This is commonly seen as MISSING_TENANT or "Tenant context required for app tokens" on platform user lookup or membership prerequisite calls.
- Do not treat this as the first signal to edit tenant members, role definitions, Entra configuration, databases, or cloud portals.
- For platform automation app-token flows outside tenant app runtime, use the tenant-scoped platform routes instead of root user lookup routes.
- If the same route works in current main but fails in an environment, the deployed PublicAPI/AdminAPI may be behind the release that adds tenant-scoped routing hardening.

### Diagnostics

- `eai whoami` (read-only) — Confirm login, active tenant, profile, and PublicAPI context.
- `eai tenant list --format json` (read-only) — Confirm the target tenant is visible before retrying tenant-scoped calls.
- `eai publicapi get /v4/platform/tenants/<tenant-id>/users/by-email?email=<email>` (read-only) — Verify user lookup through the tenant-scoped platform route.
- `eai publicapi get /v4/platform/tenants/<tenant-id>/users/<oid>/memberships` (read-only) — Verify membership lookup through the tenant-scoped platform route.

### Fixes

- `eai tenant select <tenant>` (changes state) — Select the tenant that should provide app-token context.
- `Use /v4/platform/tenants/<tenant-id>/users/by-email?email=<email>` (read-only) — Replace root platform user lookup with the tenant-scoped V4 route in platform automation app-token flows.
- `Use /v4/platform/tenants/<tenant-id>/users/<oid>/memberships` (read-only) — Replace root platform membership lookup with the tenant-scoped V4 route in platform automation app-token flows.
- `Use /v4/platform/tenants/<tenant-id>/members and /v4/platform/tenants/<tenant-id>/role-definitions` (read-only) — Keep tenant member and role-definition reads on the tenant-scoped V4 surface.

### Stop Conditions

- The tenant-scoped route returns the same MISSING_TENANT result.
- The environment is running older PublicAPI/AdminAPI versions than the release with tenant-scoped platform routing hardening.

### Escalation Evidence

- CLI version
- redacted route shape
- HTTP status
- server code
- active tenant slug
- deployed PublicAPI/AdminAPI versions if visible

## E247: The application making this request is not authorized for the tenant.

| Field | Value |
| --- | --- |
| Reason | `calling_application_not_authorized` |
| Category | `app_provisioning` |
| Severity | `error` |

### Why This Might Happen

- The authorization decision applies to the client ID in the current CLI token.
- It does not evaluate a different tenant app client, even when provision-me was run while diagnosing that app.
- If the current user already has direct membership, provisioning is unnecessary.

### Diagnostics

- `eai whoami` (read-only) — Confirm the current CLI identity, active tenant, and calling client context.
- `eai app auth status <app-key> --tenant-id <tenant-id> --client-id <app-client-id> --format json` (read-only) — Inspect a different app client without changing tenant authorization.

### Fixes

- `Ask platform support to authorize the reported calling CLI client only if provision-me is required` (changes state) — Repair the caller-specific authorization without changing the target app or creating credentials.

### Stop Conditions

- Authorization state has not changed.

### Escalation Evidence

- request ID
- CLI version
- tenant ID
- callingApplication.clientId
- reason code

## E242: Tenant data-plane authorization incomplete.

| Field | Value |
| --- | --- |
| Reason | `tenant_authorization_incomplete` |
| Category | `app_provisioning` |
| Severity | `error` |

### Why This Might Happen

- The app registration exists, but the selected tenant has not completed app authorization.
- The active tenant may not be the tenant this app was provisioned for.
- The authorization retry may need to run again after sign-in wiring is refreshed.

### Diagnostics

- `eai whoami` (read-only) — Confirm login, active tenant, profile, and public API context.
- `eai tenant list --format json` (read-only) — Confirm the intended tenant is visible to the user.

### Fixes

- `eai tenant select <tenant>` (changes state) — Select the tenant that should own the app.
- `eai provision entra --force --debug` (changes state) — Refresh sign-in wiring and retry app authorization for the active tenant.
- `eai user provision-me` (changes state) — Create or refresh the current user membership after app authorization succeeds. Run only after provision entra no longer reports incomplete tenant authorization.

### Stop Conditions

- The same platform 5xx or authorization status remains after bounded retry.

### Escalation Evidence

- request ID
- CLI version
- active tenant slug
- command
- reason code

## E243: Tenant app authorization could not be completed because the platform returned a server error.

| Field | Value |
| --- | --- |
| Reason | `tenant_authorization_platform_error` |
| Category | `platform` |
| Severity | `error` |

### Why This Might Happen

- The CLI tried to authorize the app for the selected tenant, but the platform returned a server-side failure.
- This is usually not fixed by changing local files or repeatedly rotating app credentials.
- The safest next step is a bounded retry followed by escalation with the request evidence.

### Diagnostics

- `eai provision entra --force --debug` (changes state) — Retry once with product-safe diagnostics and request identifiers.
- `eai whoami` (read-only) — Confirm the active tenant and profile are still correct.

### Fixes

None.

### Stop Conditions

- The same 5xx status repeats after bounded retry.

### Escalation Evidence

- request ID
- HTTP status
- CLI version
- command
- active tenant slug

## E250: Tenant plan does not allow this builder operation.

| Field | Value |
| --- | --- |
| Reason | `paid_upgrade_required` |
| Category | `capability` |
| Severity | `error` |

### Why This Might Happen

- The tenant is reachable, but the requested builder operation is gated by the tenant plan.
- The CLI cannot self-upgrade a tenant plan.
- Read-only checks may still work while write/build actions are blocked.

### Diagnostics

- `eai workflow readiness --format json` (read-only) — Confirm whether builder operations are available for the active tenant.
- `eai whoami` (read-only) — Confirm the active tenant before asking an admin to change plan state.

### Fixes

None.

### Stop Conditions

- The readiness reason is paid_upgrade_required. Retrying does not activate the tenant plan.

### Escalation Evidence

- active tenant slug
- command
- readiness reason code

## E260: Object Type validation failed.

| Field | Value |
| --- | --- |
| Reason | `object_type_validation_failed` |
| Category | `schema` |
| Severity | `error` |

### Why This Might Happen

- At least one local Object Type definition does not match the schema rules enforced by the CLI or platform.
- Common causes include invalid default values, incomplete storage metadata, or missing required fields.
- Publishing cannot continue until the local definitions validate.

### Diagnostics

- `eai types validate` (read-only) — Validate local Object Types without publishing them.
- `eai types diff` (read-only) — Compare local definitions with published tenant state after validation passes.

### Fixes

- `eai types seed` (changes state) — Publish the corrected definitions after validation passes. Run only after eai types validate is clean.

### Stop Conditions

- The same validation issue is reported. Fix the local Object Type definition before retrying.

### Escalation Evidence

- Object Type name
- validation message
- CLI version

## E270: Object Type is not published for the active tenant.

| Field | Value |
| --- | --- |
| Reason | `object_type_not_published` |
| Category | `resource_data` |
| Severity | `error` |

### Why This Might Happen

- The resource command is asking for a type that is not available in the active tenant schema.
- The local Object Types may not have been published yet.
- The active tenant may not be the tenant where the Object Type was published.

### Diagnostics

- `eai resources schema --format json` (read-only) — List published Object Types visible to the active tenant.
- `eai types validate` (read-only) — Check local definitions before publishing.

### Fixes

- `eai types seed` (changes state) — Publish local Object Types to the active tenant.
- `eai tenant select <tenant>` (changes state) — Switch to the tenant where the Object Type was published. Use when the active tenant is wrong.

### Stop Conditions

- The type is still absent from eai resources schema after publishing and schema propagation.

### Escalation Evidence

- Object Type name
- active tenant slug
- CLI version
- types seed summary

## E275: Semantic resource search is not ready for this tenant.

| Field | Value |
| --- | --- |
| Reason | `resource_search_embedding_required` |
| Category | `resource_data` |
| Severity | `warning` |

### Why This Might Happen

- The v4 resource search endpoint can be available for full-text search while semantic search modes are still not ready.
- Hybrid and vector search need an additional semantic-search capability before the platform can create query embeddings.
- This is not fixed by retrying the same hybrid or vector search command; use full-text search or check readiness first.
- This guidance applies to eai resources commands using the public v4 resource surface.

### Diagnostics

- `eai resources storage doctor --format json` (read-only) — Check whether fulltext, hybrid, and vector search are ready for the active tenant.
- `eai resources schema --format json` (read-only) — Confirm the tenant has published Object Types to search.

### Fixes

- `eai resources search "<query>" --fulltext` (read-only) — Run a full-text search path that does not require semantic-search readiness. Use this when storage doctor reports fulltext ready but hybrid/vector unavailable.

### Stop Conditions

- The same hybrid or vector command still reports semantic-search readiness as unavailable.
- Full-text search also fails, which means the issue is broader than semantic-search readiness.

### Escalation Evidence

- active tenant slug
- search mode used
- storage doctor search capabilities
- CLI version

## E276: The PublicAPI v4 resource mutation contract is invalid.

| Field | Value |
| --- | --- |
| Reason | `resource_mutation_contract_invalid` |
| Category | `resource_data` |
| Severity | `error` |

### Why This Might Happen

- PublicAPI v4 intentionally rejects legacy flat resource bodies and PATCH updates.
- Create requires POST with {"data": {...}}.
- Update requires PUT with {"data": {...}, "version": n}, where n is the latest resource version.
- A resource action requires POST with {"params": {...}} and returns the new version for any follow-up update.

### Diagnostics

- `eai resources get <type> <id> --format json` (read-only) — Read the current resource and version before an update. Required for updates, especially after an action or another writer.

### Fixes

- `eai publicapi post /v4/data/resources/<tenant-id>/<type> --data '{"data":{...}}'` (changes state) — Create a resource using the strict v4 data envelope.
- `eai publicapi put /v4/data/resources/<tenant-id>/<type>/<id> --data '{"data":{...},"version":<current-version>}'` (changes state) — Update a resource with PUT and the latest optimistic-lock version.
- `eai publicapi post /v4/data/resources/<tenant-id>/<type>/<id>/actions/<action> --data '{"params":{...}}'` (changes state) — Execute a resource action with the strict params envelope.

### Stop Conditions

- The corrected method and body still return the same contract error.
- The update uses the latest version but returns a version conflict.

### Escalation Evidence

- command without secrets
- HTTP status
- server error code
- request ID

## E280: Workflow runtime binding requires operator assistance.

| Field | Value |
| --- | --- |
| Reason | `workflow_operator_required` |
| Category | `workflow` |
| Severity | `warning` |

### Why This Might Happen

- The tenant and workflow key are recognized, but an executable runtime binding is not available yet.
- Some workflow bindings require an operator-assisted request before chat or workflow execution can run.
- The CLI should request the binding only when readiness reports operator_required.

### Diagnostics

- `eai workflow readiness <workflow-key> --format json` (read-only) — Check tenant, plan, and workflow readiness.
- `eai workflow status <workflow-key> --format json` (read-only) — Check whether the workflow has an executable runtime binding.

### Fixes

- `eai workflow request <workflow-key> --reason "<reason>"` (changes state) — Request operator-assisted runtime binding for this tenant and workflow. Run only when readiness or status reports operator_required.

### Stop Conditions

- A workflow request is already queued or the status remains operator_required.

### Escalation Evidence

- workflow key
- request ID
- active tenant slug
- CLI version

## E244: Tenant data/schema setup is not fully provisioned.

| Field | Value |
| --- | --- |
| Reason | `tenant_data_install_no_match` |
| Category | `app_provisioning` |
| Severity | `error` |

### Why This Might Happen

- The platform could not resolve an active data/schema install for this tenant.
- This is a tenant setup issue, not a transient outage: the data/schema capability is reachable but has no active install registered for this tenant.
- Object Type publish (eai types seed) and schema reads cannot complete until the tenant setup is completed. Retrying does not create that setup.

### Diagnostics

- `eai whoami` (read-only) — Confirm the active tenant that failed to resolve a data/schema install.
- `eai verify` (read-only) — Confirm whether the data/schema service can resolve an install for this tenant.

### Fixes

None.

### Stop Conditions

- The response indicates no active tenant data/schema install. Retrying does not provision the tenant setup — it must be fixed by platform support.

### Escalation Evidence

- active tenant slug and id (eai whoami)
- the command that failed
- the request id from the error
- the reason code from the error response

