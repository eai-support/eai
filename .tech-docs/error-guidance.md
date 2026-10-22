---
title: Error Guidance
description: Public-safe EAI CLI error explanations and agent recovery commands.
---

# Error Guidance

This page lists the public-safe error guidance bundled with `@enterpriseai/cli`
v3.20.7. The same catalog powers human stderr output, JSON output for AI
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
| `E205` | `child_relation_invalid` | The supplied workspace is not an immediate child of the supplied parent. |
| `E245` | `user_invite_external_service_existing_member` | workspace member invite failed, but an existing member role repair may be available. |
| `E246` | `app_token_tenant_context_required` | App-token platform user lookup is missing workspace context. |
| `E247` | `calling_application_not_authorized` | The application making this request is not authorized for the workspace. |
| `E242` | `tenant_authorization_incomplete` | Workspace data access authorization is incomplete. |
| `E243` | `tenant_authorization_platform_error` | workspace app authorization could not be completed because the platform returned a server error. |
| `E250` | `paid_upgrade_required` | workspace plan does not allow this builder operation. |
| `E260` | `object_type_validation_failed` | Object Type validation failed. |
| `E261` | `app_manifest_validation_failed` | The app Object Type manifest request did not match the deployed platform contract. |
| `E270` | `object_type_not_published` | Object Type is not published for the active workspace. |
| `E275` | `resource_search_embedding_required` | Semantic resource search is not ready for this workspace. |
| `E276` | `resource_mutation_contract_invalid` | The PublicAPI v4 resource mutation contract is invalid. |
| `E280` | `workflow_operator_required` | Workflow runtime binding requires operator assistance. |
| `E244` | `tenant_data_install_no_match` | workspace data/schema setup is not fully provisioned. |
| `E251` | `subscription_inactive` | The workspace subscription is not active, so new capabilities cannot be provisioned. |
| `E252` | `capability_not_in_plan` | This capability is not included in the workspace plan. |
| `E253` | `tenant_limit_reached` | The parent workspace has reached its child workspace limit. |
| `E254` | `tenant_limit_unconfigured` | The plan has no valid child workspace limit configured. |
| `E255` | `capability_unavailable` | This capability is not available for the workspace. |
| `E256` | `child_capacity_unavailable` | Child workspace capacity could not be confirmed. |
| `E257` | `no_subscription` | The workspace has no active subscription for this billing action. |
| `E258` | `workspace_plan_billing_unavailable` | Workspace billing could not be verified, so the plan was not changed. |
| `E290` | `app_ownership_manifest_not_found` | No app ownership record was found for this app in the selected workspace. |
| `E291` | `app_deletion_target_tenant_forbidden` | You do not have workspace admin access to the workspace targeted for app deletion. |
| `E292` | `app_ownership_manifest_unresolved` | The platform cannot prove a single, complete ownership manifest for this app. |
| `E293` | `app_ownership_scope_request_invalid` | The app ownership registration request is invalid. |
| `E294` | `app_ownership_scope_unsafe` | The platform cannot safely register ownership of this app. |
| `E295` | `app_ownership_scope_concurrent_change` | The app ownership record changed while it was being updated. |
| `E296` | `app_ownership_scope_failed` | App ownership registration failed unexpectedly. |

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
- The command needs a user session before it can resolve workspace access.

### Diagnostics

- `eai whoami` (read-only) — Show the current login and active workspace status.
- `eai workspace list --format json` (read-only) — Confirm workspace memberships after login succeeds. After eai login succeeds.

### Fixes

- `eai login` (changes state) — Authenticate with the EAI identity flow.
- `eai login --callback-port <port>` (changes state) — Use a fixed local callback port for Codespaces or locked-down environments. Use when the browser callback cannot reach the CLI.

### Stop Conditions

- The browser sign-in flow repeatedly fails with the same identity error.

### Escalation Evidence

- signed-in email
- CLI version
- active profile
- workspace list output without secrets

## E102: Access token expired.

| Field | Value |
| --- | --- |
| Reason | `access_token_expired` |
| Category | `authentication` |
| Severity | `error` |

### Why This Might Happen

- The saved user session is older than the identity provider allows.
- The CLI cannot refresh the session silently in this environment.
- The command needs a fresh user token before it can call workspace-scoped APIs.

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
- The active workspace may not be the workspace where the user has the needed role.
- The app or resource may require workspace admin or builder access.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user and active workspace.
- `eai workspace list --all --format json` (read-only) — List visible workspace memberships and roles.

### Fixes

- `eai workspace select <workspace>` (changes state) — Switch to a workspace where the user has the required role.
- `eai user invite --email <email> --workspace <workspace-id> --role tenant-admin` (changes state) — Add or refresh a user membership and assign a workspace role when you already have workspace admin access. Use for normal "add this person as a workspace member/admin" requests.
- `eai user roles --workspace <workspace-id> --format json` (read-only) — List assignable workspace roles before choosing a role for an invite.
- `eai workspace bootstrap-admin --parent <parent-id> --child <child-id>` (changes state) — Repair workspace admin access for an immediate child workspace. Only when the target workspace is an immediate child of the supplied parent and does not already have usable workspace admin access.

### Stop Conditions

- The user lacks the required workspace role. Retrying will not change authorization.

### Escalation Evidence

- signed-in email
- active workspace slug
- requested command
- request ID if present

## E205: The supplied workspace is not an immediate child of the supplied parent.

| Field | Value |
| --- | --- |
| Reason | `child_relation_invalid` |
| Category | `authorization` |
| Severity | `error` |

### Why This Might Happen

- The child-workspace bootstrap command is intentionally narrow.
- It only works when the parent ID is the direct parent of the child workspace.
- This error often appears when an agent uses bootstrap-admin for normal user addition instead of the workspace member invite flow.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user and active workspace.
- `eai workspace info <workspace-id> --format json` (read-only) — Inspect the target workspace before retrying a workspace relationship command.
- `eai user roles --workspace <workspace-id> --format json` (read-only) — List assignable roles when the intended task is adding or updating a user.

### Fixes

- `eai user invite --email <email> --workspace <workspace-id> --role tenant-admin` (changes state) — Add or update a user as a workspace admin. Use when the goal is to add a person to a workspace or app context.
- `eai workspace bootstrap-admin --parent <direct-parent-id> --child <immediate-child-id>` (changes state) — Retry the child bootstrap repair with the direct parent and immediate child IDs. Use only for first-admin child workspace repair, not normal member management.

### Stop Conditions

- The supplied parent and child are not a direct parent-child pair.

### Escalation Evidence

- signed-in email
- active workspace slug
- target workspace slug
- requested command

## E245: workspace member invite failed, but an existing member role repair may be available.

| Field | Value |
| --- | --- |
| Reason | `user_invite_external_service_existing_member` |
| Category | `external_service` |
| Severity | `error` |

### Why This Might Happen

- The invite/add flow reached an external identity or notification dependency that returned a server-side failure.
- The target person may already exist as a direct workspace member with a lower role, so retrying the same invite can fail without changing access.
- When a member record already exists, the supported recovery is to update that member through EAI CLI instead of editing data stores or cloud portals directly.
- Applications may cache workspace role claims in their Auth.js session or JWT, so the user may need to sign out and sign back in after a role change.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user, active workspace, and profile before changing membership.
- `eai user roles --workspace <workspace-id> --format json` (read-only) — Confirm the target role is assignable in this workspace.
- `eai user list --workspace <workspace-id> --search <email> --format json` (read-only) — Check whether the person already exists as a direct workspace member and capture the member ID.

### Fixes

- `eai user role set --workspace <workspace-id> --member-id <member-id> --role tenant-admin --format json` (changes state) — Update the direct workspace member role through the approved EAI endpoint. Use only after eai user list confirms the existing member ID and the user approves the role change.
- `eai user invite --email <email> --workspace <workspace-id> --role <role> --format json` (changes state) — Retry the normal invite/add flow when no existing direct member is found and the failure was transient. Use only within the retry limit and after read-only diagnostics confirm the workspace and role.

### Stop Conditions

- The same external service error repeats after bounded retry.
- The existing member is found but role update is not approved by the user.
- The signed-in user is not allowed to change workspace membership.

### Escalation Evidence

- request ID
- HTTP status
- server code
- CLI version
- active workspace slug
- redacted command shape

## E246: App-token platform user lookup is missing workspace context.

| Field | Value |
| --- | --- |
| Reason | `app_token_tenant_context_required` |
| Category | `tenant_context` |
| Severity | `error` |

### Why This Might Happen

- The platform call authenticated, but the request did not carry the workspace context required for app-token user or membership operations.
- This is commonly seen as MISSING_TENANT or "Tenant context required for app tokens" on platform user lookup or membership prerequisite calls.
- Do not treat this as the first signal to edit workspace members, role definitions, Entra configuration, databases, or cloud portals.
- For platform automation app-token flows outside workspace app runtime, use the workspace-scoped platform routes instead of root user lookup routes.
- If the same route works in current main but fails in an environment, the deployed PublicAPI/AdminAPI may be behind the release that adds workspace-scoped routing hardening.

### Diagnostics

- `eai whoami` (read-only) — Confirm login, active workspace, profile, and PublicAPI context.
- `eai workspace list --format json` (read-only) — Confirm the target workspace is visible before retrying workspace-scoped calls.
- `eai publicapi get /v4/platform/tenants/<tenant-id>/users/by-email?email=<email>` (read-only) — Verify user lookup through the workspace-scoped platform route.
- `eai publicapi get /v4/platform/tenants/<tenant-id>/users/<oid>/memberships` (read-only) — Verify membership lookup through the workspace-scoped platform route.

### Fixes

- `eai workspace select <workspace>` (changes state) — Select the workspace that should provide app-token context.
- `Use /v4/platform/tenants/<tenant-id>/users/by-email?email=<email>` (read-only) — Replace root platform user lookup with the workspace-scoped V4 route in platform automation app-token flows.
- `Use /v4/platform/tenants/<tenant-id>/users/<oid>/memberships` (read-only) — Replace root platform membership lookup with the workspace-scoped V4 route in platform automation app-token flows.
- `Use /v4/platform/tenants/<tenant-id>/members and /v4/platform/tenants/<tenant-id>/role-definitions` (read-only) — Keep workspace member and role-definition reads on the workspace-scoped V4 surface.

### Stop Conditions

- The workspace-scoped route returns the same MISSING_TENANT result.
- The environment is running older PublicAPI/AdminAPI versions than the release with workspace-scoped platform routing hardening.

### Escalation Evidence

- CLI version
- redacted route shape
- HTTP status
- server code
- active workspace slug
- deployed PublicAPI/AdminAPI versions if visible

## E247: The application making this request is not authorized for the workspace.

| Field | Value |
| --- | --- |
| Reason | `calling_application_not_authorized` |
| Category | `app_provisioning` |
| Severity | `error` |

### Why This Might Happen

- The authorization decision applies to the client ID in the current CLI token.
- It does not evaluate a different workspace app client, even when provision-me was run while diagnosing that app.
- If the current user already has direct membership, provisioning is unnecessary.

### Diagnostics

- `eai whoami` (read-only) — Confirm the current CLI identity, active workspace, and calling client context.
- `eai app auth status <app-key> --tenant-id <tenant-id> --client-id <app-client-id> --format json` (read-only) — Inspect a different app client without changing workspace authorization.

### Fixes

- `Ask platform support to authorize the reported calling CLI client only if provision-me is required` (changes state) — Repair the caller-specific authorization without changing the target app or creating credentials.

### Stop Conditions

- Authorization state has not changed.

### Escalation Evidence

- request ID
- CLI version
- workspace ID
- callingApplication.clientId
- reason code

## E242: Workspace data access authorization is incomplete.

| Field | Value |
| --- | --- |
| Reason | `tenant_authorization_incomplete` |
| Category | `app_provisioning` |
| Severity | `error` |

### Why This Might Happen

- The app registration exists, but the selected workspace has not completed app authorization.
- The active workspace may not be the workspace this app was provisioned for.
- The authorization retry may need to run again after sign-in wiring is refreshed.

### Diagnostics

- `eai whoami` (read-only) — Confirm login, active workspace, profile, and public API context.
- `eai workspace list --format json` (read-only) — Confirm the intended workspace is visible to the user.

### Fixes

- `eai workspace select <workspace>` (changes state) — Select the workspace that should own the app.
- `eai provision entra --force --debug` (changes state) — Refresh sign-in wiring and retry app authorization for the active workspace.
- `eai user provision-me` (changes state) — Create or refresh the current user membership after app authorization succeeds. Run only after provision entra no longer reports incomplete workspace authorization.

### Stop Conditions

- The same platform 5xx or authorization status remains after bounded retry.

### Escalation Evidence

- request ID
- CLI version
- active workspace slug
- command
- reason code

## E243: workspace app authorization could not be completed because the platform returned a server error.

| Field | Value |
| --- | --- |
| Reason | `tenant_authorization_platform_error` |
| Category | `platform` |
| Severity | `error` |

### Why This Might Happen

- The CLI tried to authorize the app for the selected workspace, but the platform returned a server-side failure.
- This is usually not fixed by changing local files or repeatedly rotating app credentials.
- The safest next step is a bounded retry followed by escalation with the request evidence.

### Diagnostics

- `eai provision entra --force --debug` (changes state) — Retry once with product-safe diagnostics and request identifiers.
- `eai whoami` (read-only) — Confirm the active workspace and profile are still correct.

### Fixes

None.

### Stop Conditions

- The same 5xx status repeats after bounded retry.

### Escalation Evidence

- request ID
- HTTP status
- CLI version
- command
- active workspace slug

## E250: workspace plan does not allow this builder operation.

| Field | Value |
| --- | --- |
| Reason | `paid_upgrade_required` |
| Category | `capability` |
| Severity | `error` |

### Why This Might Happen

- The workspace is reachable, but the requested builder operation is gated by the workspace plan.
- The CLI cannot self-upgrade a workspace plan.
- Read-only checks may still work while write/build actions are blocked.

### Diagnostics

- `eai workflow readiness --format json` (read-only) — Confirm whether builder operations are available for the active workspace.
- `eai whoami` (read-only) — Confirm the active workspace before asking an admin to change plan state.

### Fixes

None.

### Stop Conditions

- The readiness reason is paid_upgrade_required. Retrying does not activate the workspace plan.

### Escalation Evidence

- active workspace slug
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
- `eai types diff` (read-only) — Compare local definitions with published workspace state after validation passes.

### Fixes

- `eai types seed` (changes state) — Publish the corrected definitions after validation passes. Run only after eai types validate is clean.

### Stop Conditions

- The same validation issue is reported. Fix the local Object Type definition before retrying.

### Escalation Evidence

- Object Type name
- validation message
- CLI version

## E261: The app Object Type manifest request did not match the deployed platform contract.

| Field | Value |
| --- | --- |
| Reason | `app_manifest_validation_failed` |
| Category | `schema` |
| Severity | `error` |

### Why This Might Happen

- The source Object Type schema is not the app-manifest HTTP request schema.
- Some deployed platform releases derive the transport slug from the validated model name. Other releases accept the explicit source slug.
- The CLI stops instead of using name derivation when that would change an established stored slug.
- The current CLI supports both request shapes. A repeated failure can indicate an older CLI or a separate field validation error.

### Diagnostics

- `eai update --check` (read-only) — Check whether the installed CLI includes app-manifest compatibility support.
- `eai types validate --tenant-key <key> --tenant-id <workspace-id>` (read-only) — Validate source names, slugs, relationships, and storage metadata without publishing.
- `eai types seed --tenant-key <key> --tenant-id <workspace-id> --dry-run --format json` (read-only) — Confirm the CLI can load the intended workspace scope without changing platform state.

### Fixes

- `eai update` (changes state) — Install the CLI release that negotiates the deployed app-manifest request shape. Run when eai update --check reports an older CLI.
- `eai types seed --tenant-key <key> --tenant-id <workspace-id> --format json` (changes state) — Publish once through the maintained compatibility adapter. Run after update and local validation succeed.

### Stop Conditions

- The current CLI reports that both supported app-manifest request shapes failed.
- The CLI reports that the deployed platform needs explicit slug support to preserve an established stored slug.

### Escalation Evidence

- CLI version
- app key
- workspace ID
- Object Type names only
- request IDs for both rejected requests

## E270: Object Type is not published for the active workspace.

| Field | Value |
| --- | --- |
| Reason | `object_type_not_published` |
| Category | `resource_data` |
| Severity | `error` |

### Why This Might Happen

- The resource command is asking for a type that is not available in the active workspace schema.
- The local Object Types may not have been published yet.
- The active workspace may not be the workspace where the Object Type was published.

### Diagnostics

- `eai resources schema --format json` (read-only) — List published Object Types visible to the active workspace.
- `eai types validate` (read-only) — Check local definitions before publishing.

### Fixes

- `eai types seed` (changes state) — Publish local Object Types to the active workspace.
- `eai workspace select <workspace>` (changes state) — Switch to the workspace where the Object Type was published. Use when the active workspace is wrong.

### Stop Conditions

- The type is still absent from eai resources schema after publishing and schema propagation.

### Escalation Evidence

- Object Type name
- active workspace slug
- CLI version
- types seed summary

## E275: Semantic resource search is not ready for this workspace.

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

- `eai resources storage doctor --format json` (read-only) — Check whether fulltext, hybrid, and vector search are ready for the active workspace.
- `eai resources schema --format json` (read-only) — Confirm the workspace has published Object Types to search.

### Fixes

- `eai resources search "<query>" --fulltext` (read-only) — Run a full-text search path that does not require semantic-search readiness. Use this when storage doctor reports fulltext ready but hybrid/vector unavailable.

### Stop Conditions

- The same hybrid or vector command still reports semantic-search readiness as unavailable.
- Full-text search also fails, which means the issue is broader than semantic-search readiness.

### Escalation Evidence

- active workspace slug
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

- The workspace and workflow key are recognized, but an executable runtime binding is not available yet.
- Some workflow bindings require an operator-assisted request before chat or workflow execution can run.
- The CLI should request the binding only when readiness reports operator_required.

### Diagnostics

- `eai workflow readiness <workflow-key> --format json` (read-only) — Check workspace, plan, and workflow readiness.
- `eai workflow status <workflow-key> --format json` (read-only) — Check whether the workflow has an executable runtime binding.

### Fixes

- `eai workflow request <workflow-key> --reason "<reason>"` (changes state) — Request operator-assisted runtime binding for this workspace and workflow. Run only when readiness or status reports operator_required.

### Stop Conditions

- A workflow request is already queued or the status remains operator_required.

### Escalation Evidence

- workflow key
- request ID
- active workspace slug
- CLI version

## E244: workspace data/schema setup is not fully provisioned.

| Field | Value |
| --- | --- |
| Reason | `tenant_data_install_no_match` |
| Category | `app_provisioning` |
| Severity | `error` |

### Why This Might Happen

- The platform could not resolve an active data/schema install for this workspace.
- This is a workspace setup issue, not a transient outage: the data/schema capability is reachable but has no active install registered for this workspace.
- Object Type publish (eai types seed) and schema reads cannot complete until the workspace setup is completed. Retrying does not create that setup.

### Diagnostics

- `eai whoami` (read-only) — Confirm the active workspace that failed to resolve a data/schema install.
- `eai verify` (read-only) — Confirm whether the data/schema service can resolve an install for this workspace.

### Fixes

None.

### Stop Conditions

- The response indicates no active workspace data/schema install. Retrying does not provision the workspace setup — it must be fixed by platform support.

### Escalation Evidence

- active workspace slug and id (eai whoami)
- the command that failed
- the request id from the error
- the reason code from the error response

## E251: The workspace subscription is not active, so new capabilities cannot be provisioned.

| Field | Value |
| --- | --- |
| Reason | `subscription_inactive` |
| Category | `capability` |
| Severity | `error` |

### Why This Might Happen

- The platform checks the workspace subscription status before it allows a capability to be provisioned or enabled.
- Only an active or trialing subscription passes that check; any other status is refused.
- For child workspace creation the check applies to the parent workspace, not the new child.
- The CLI cannot renew or change a subscription, so retrying the same command does not change the result.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user and active workspace.
- `eai workspace list --all --format json` (read-only) — Confirm which workspace was the parent or target of the failed command.

### Fixes

- `Ask a workspace admin to restore an active subscription for the workspace` (read-only) — Billing is managed outside the CLI; the capability check passes again once the subscription is active.

### Stop Conditions

- The code is SUBSCRIPTION_INACTIVE. Retrying does not change the subscription status.

### Escalation Evidence

- active workspace slug
- parent workspace ID if creating a child
- command
- request ID if present

## E252: This capability is not included in the workspace plan.

| Field | Value |
| --- | --- |
| Reason | `capability_not_in_plan` |
| Category | `capability` |
| Severity | `error` |

### Why This Might Happen

- The subscription is active, but the workspace plan does not include the feature or add-on the command needs.
- This is a plan limit, not a permissions problem: the signed-in user may already be a workspace admin.
- Creating a child workspace also reports this code when the plan defines no valid child workspace limit.
- The CLI cannot change a workspace plan. If the response includes an upgrade link, a workspace admin can follow it.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user and active workspace.
- `eai workspace list --all --format json` (read-only) — Confirm which workspace the failed command ran against.

### Fixes

- `Ask a workspace admin to add the capability to the workspace plan` (read-only) — Plan changes are made outside the CLI; the command can run once the plan includes the capability.

### Stop Conditions

- The code is CAPABILITY_NOT_IN_PLAN. Retrying does not change the workspace plan.

### Escalation Evidence

- active workspace slug
- capability or command
- request ID if present

## E253: The parent workspace has reached its child workspace limit.

| Field | Value |
| --- | --- |
| Reason | `tenant_limit_reached` |
| Category | `capability` |
| Severity | `error` |

### Why This Might Happen

- The workspace plan sets how many child workspaces a parent may have, and the parent has used that allowance.
- The platform checks usage before the new child workspace is created.
- The child workspace create request reports this as TENANT_QUOTA_EXCEEDED; the capability check reports it as tenant_limit_reached.
- Retrying does not free capacity. A workspace admin must remove an unused child workspace or change the plan.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user and active workspace.
- `eai workspace list --all --format json` (read-only) — List workspaces under the parent to find any that are no longer needed.

### Fixes

- `Ask a workspace admin to remove an unused child workspace or raise the child workspace limit` (read-only) — The limit comes from the workspace plan and is changed outside this command.

### Stop Conditions

- The code is TENANT_QUOTA_EXCEEDED or tenant_limit_reached. Retrying does not change the limit or usage.

### Escalation Evidence

- parent workspace ID
- active workspace slug
- command
- request ID if present

## E254: The plan has no valid child workspace limit configured.

| Field | Value |
| --- | --- |
| Reason | `tenant_limit_unconfigured` |
| Category | `capability` |
| Severity | `error` |

### Why This Might Happen

- Creating a child workspace requires the parent plan to define a numeric child workspace limit of zero or more.
- This plan has no such limit, or the stored value is not a valid number, so the platform refuses to create a child rather than allow unlimited children.
- Platform-level administrator accounts see this code directly; other accounts see capability_not_in_plan for the same condition.
- The CLI cannot set a plan limit, so the plan configuration must be corrected by platform support.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user and active workspace.

### Fixes

None.

### Stop Conditions

- The code is TENANT_LIMIT_UNCONFIGURED. Retrying does not configure the plan limit.

### Escalation Evidence

- parent workspace ID
- active workspace slug
- command
- request ID if present

## E255: This capability is not available for the workspace.

| Field | Value |
| --- | --- |
| Reason | `capability_unavailable` |
| Category | `capability` |
| Severity | `error` |

### Why This Might Happen

- The capability check found no rule that allows this capability for the workspace and operation, so it returned its default denial.
- This differs from capability_not_in_plan, which names a plan gap, and tenant_admin_required, which names a missing role.
- The cause cannot be told from this code alone, so confirm the active workspace and the command first.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user and active workspace.
- `eai workspace list --all --format json` (read-only) — Confirm the intended workspace is visible to the user.

### Fixes

- `eai workspace select <workspace>` (changes state) — Select the workspace the capability should be used in. Run only when the active workspace is not the one you intended.

### Stop Conditions

- The intended workspace is selected and the code is still CAPABILITY_UNAVAILABLE.

### Escalation Evidence

- active workspace slug
- capability or command
- CLI version
- request ID if present

## E256: Child workspace capacity could not be confirmed.

| Field | Value |
| --- | --- |
| Reason | `child_capacity_unavailable` |
| Category | `platform` |
| Severity | `error` |

### Why This Might Happen

- Before creating a child workspace the platform asks the capability check whether the parent has room for another child.
- That check returned no usable answer, so the platform refused the request instead of guessing.
- This is not a plan limit; a plan limit is reported as TENANT_QUOTA_EXCEEDED.
- The check can fail transiently, so one bounded retry is reasonable.

### Diagnostics

- `eai whoami` (read-only) — Confirm the active workspace and profile are still correct.

### Fixes

- `eai workspace create --name <name> --slug <slug> --parent <parent-id>` (changes state) — Repeat the child workspace creation once. Run after the backoff in the retry policy; stop if the same code returns.

### Stop Conditions

- CHILD_CAPACITY_UNAVAILABLE repeats after bounded retry.

### Escalation Evidence

- request ID
- HTTP status
- CLI version
- parent workspace ID
- command

## E257: The workspace has no active subscription for this billing action.

| Field | Value |
| --- | --- |
| Reason | `no_subscription` |
| Category | `capability` |
| Severity | `error` |

### Why This Might Happen

- A billing action such as updating, reducing, or cancelling a subscription needs an active subscription recorded for the workspace, and none was found.
- The workspace may never have subscribed, or its subscription may already have ended.
- The CLI cannot create or change a subscription, so retrying the same request does not change the result.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user and active workspace.

### Fixes

- `Ask a workspace admin to confirm the workspace subscription status` (read-only) — Billing is managed outside the CLI; a workspace admin can confirm whether a subscription exists.

### Stop Conditions

- The code is NO_SUBSCRIPTION. Retrying does not create a subscription.

### Escalation Evidence

- active workspace slug
- billing action attempted
- request ID if present

## E258: Workspace billing could not be verified, so the plan was not changed.

| Field | Value |
| --- | --- |
| Reason | `workspace_plan_billing_unavailable` |
| Category | `external_service` |
| Severity | `error` |

### Why This Might Happen

- Before changing a workspace plan the platform confirms the workspace billing records with the billing provider.
- That confirmation failed or returned data that did not match, so the platform stopped and left the plan unchanged.
- The failure can be transient, so one or two bounded retries are reasonable.

### Diagnostics

- `eai whoami` (read-only) — Confirm the active workspace and profile are still correct.

### Fixes

None.

### Stop Conditions

- WORKSPACE_PLAN_BILLING_UNAVAILABLE repeats after bounded retry.

### Escalation Evidence

- request ID
- HTTP status
- CLI version
- active workspace slug
- plan action attempted

## E290: No app ownership record was found for this app in the selected workspace.

| Field | Value |
| --- | --- |
| Reason | `app_ownership_manifest_not_found` |
| Category | `app_provisioning` |
| Severity | `error` |

### Why This Might Happen

- App deletion first reads an ownership manifest that lists everything the app owns, and the platform found no ownership registration for this app key under the selected workspace.
- The app key or the workspace may be wrong, the app may be enrolled in a different workspace, or the app and its platform-owned metadata may already have been deleted.
- The request that returns this code deletes nothing.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user and active workspace.
- `eai app list --tenant-id <owning-workspace-id> --format json` (read-only) — List the apps enrolled in the owning workspace and confirm the exact app key.

### Fixes

- `eai app delete <app-key> --tenant-id <owning-workspace-id>` (changes state) — Plan and confirm the deletion from the workspace that owns the app enrollment. Run only after eai app list shows the app under that workspace.

### Stop Conditions

- The app key is not listed for the owning workspace, or the app was already deleted.

### Escalation Evidence

- app key
- owning workspace ID
- target workspace ID if used
- CLI version
- request ID if present

## E291: You do not have workspace admin access to the workspace targeted for app deletion.

| Field | Value |
| --- | --- |
| Reason | `app_deletion_target_tenant_forbidden` |
| Category | `authorization` |
| Severity | `error` |

### Why This Might Happen

- eai app delete --target-tenant-id deletes an app from a runtime child workspace owned by the app enrollment workspace given by --tenant-id.
- The platform requires the target to be the --tenant-id workspace itself, or a workspace where the signed-in user is a workspace admin.
- You also need workspace admin access to the --tenant-id workspace. The request that returns this code deletes nothing.

### Diagnostics

- `eai whoami` (read-only) — Confirm which account the CLI is using.
- `eai workspace list --all --format json` (read-only) — Check whether the account is a workspace admin of both the owning and the target workspace.

### Fixes

- `eai app delete <app-key> --tenant-id <owning-workspace-id> --target-tenant-id <runtime-child-id>` (changes state) — Run the deletion with the owning workspace as --tenant-id and the runtime child as the target. Use an account that is a workspace admin of both workspaces.
- `Ask a workspace admin of the target workspace to grant your account workspace admin access` (read-only) — A workspace admin must update the membership before the target can be deleted from.

### Stop Conditions

- The account is not a workspace admin of the target workspace. Retrying does not change authorization.

### Escalation Evidence

- signed-in email
- owning workspace ID
- target workspace ID
- CLI version
- request ID if present

## E292: The platform cannot prove a single, complete ownership manifest for this app.

| Field | Value |
| --- | --- |
| Reason | `app_ownership_manifest_unresolved` |
| Category | `app_provisioning` |
| Severity | `error` |

### Why This Might Happen

- App deletion proceeds only when the platform can list everything the app owns without ambiguity, so it never deletes data it cannot prove belongs to this app.
- APP_OWNERSHIP_MANIFEST_INCOMPLETE: a record needed to build the manifest is missing a required identifier.
- APP_OWNERSHIP_MANIFEST_CONFLICT: two records for the same install disagree about which apps and Object Types it owns.
- APP_OWNERSHIP_ENROLLMENT_OWNER_AMBIGUOUS: the install that owns the app enrollment could not be narrowed to exactly one.
- APP_OWNERSHIP_OBJECT_TYPE_AMBIGUOUS, APP_OWNERSHIP_OBJECT_TYPE_NOT_FOUND and APP_OWNERSHIP_OBJECT_TYPE_INVALID: an Object Type the manifest relies on has several matches, cannot be found, or is not shaped as expected.
- APP_OWNERSHIP_STORAGE_ROUTE_INVALID: the app enrollment Object Type has no complete storage binding.
- These are platform data problems, so changing local files or repeating eai app delete does not fix them.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user and active workspace.
- `eai app list --tenant-id <owning-workspace-id> --format json` (read-only) — Confirm the app is enrolled in the workspace you are deleting from.

### Fixes

None.

### Stop Conditions

- Any of these ownership codes is returned. The ownership data must be repaired by platform support before deletion can be planned.

### Escalation Evidence

- app key
- owning workspace ID
- target workspace ID if used
- the exact code
- CLI version
- request ID if present

## E293: The app ownership registration request is invalid.

| Field | Value |
| --- | --- |
| Reason | `app_ownership_scope_request_invalid` |
| Category | `app_provisioning` |
| Severity | `error` |

### Why This Might Happen

- When an app is created or provisioned the platform registers which Object Types the app owns. This request was rejected before any ownership was recorded.
- APP_OWNERSHIP_SCOPE_INVALID_APP_KEY: the app key is not a lowercase identifier of letters, digits and hyphens that starts and ends with a letter or digit.
- APP_OWNERSHIP_SCOPE_INVALID_OBJECT_TYPES: the Object Type list is not a list, or contains a slug that is not a lowercase identifier.
- APP_OWNERSHIP_SCOPE_INVALID_BODY: the request is missing the Object Type list or carries other fields.
- Well-formed input is normally checked before this step, so check the app key and Object Type slugs first and confirm the CLI is current.

### Diagnostics

- `eai update --check` (read-only) — Confirm the installed CLI is current.
- `eai app list --format json` (read-only) — Confirm the app key exactly as it is enrolled.

### Fixes

- `eai update` (changes state) — Install the current CLI before one retry of the failed command. Run when eai update --check reports a newer version.

### Stop Conditions

- The same code is returned after the app key and Object Type slugs are canonical and the CLI is current.

### Escalation Evidence

- app key
- Object Type slugs
- CLI version
- command
- request ID if present

## E294: The platform cannot safely register ownership of this app.

| Field | Value |
| --- | --- |
| Reason | `app_ownership_scope_unsafe` |
| Category | `app_provisioning` |
| Severity | `error` |

### Why This Might Happen

- When an app is created or provisioned the platform adds the app and its Object Types to the workspace install record. It refuses when it cannot prove the addition is safe, so it never claims data that belongs to another app.
- APP_OWNERSHIP_SCOPE_INSTALL_NOT_FOUND: the workspace has no active data/schema install to register against. This is a workspace setup gap, like tenant_data_install_no_match.
- APP_OWNERSHIP_SCOPE_INSTALL_INCOMPLETE, APP_OWNERSHIP_SCOPE_INSTALL_AMBIGUOUS and APP_OWNERSHIP_SCOPE_INSTALL_CONFLICT: the workspace install record is missing required identity fields, appears more than once, or disagrees with its stored copy.
- APP_OWNERSHIP_SCOPE_AMBIGUOUS and APP_OWNERSHIP_SCOPE_EXISTING_SCOPE_INVALID: an install already holds more than one scope for this app key, or a scope without a valid app key.
- APP_OWNERSHIP_SCOPE_OBJECT_TYPE_NOT_EXCLUSIVE: a requested Object Type is not published as a workspace-owned type, or does not match exactly one definition.
- APP_OWNERSHIP_SCOPE_OBJECT_TYPE_CONFLICT: a requested Object Type is already owned by a different app in the same workspace.
- Retrying does not change any of these results.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user and active workspace.
- `eai verify` (read-only) — Confirm whether the data/schema service can resolve an install for this workspace.
- `eai types diff` (read-only) — Compare local Object Types with the published workspace state.

### Fixes

None.

### Stop Conditions

- Any of these ownership codes is returned. Retrying does not change the stored install or Object Type state.

### Escalation Evidence

- app key
- workspace ID
- the exact code
- CLI version
- command
- request ID if present

## E295: The app ownership record changed while it was being updated.

| Field | Value |
| --- | --- |
| Reason | `app_ownership_scope_concurrent_change` |
| Category | `app_provisioning` |
| Severity | `warning` |

### Why This Might Happen

- The platform checks that the workspace install record is unchanged before it writes, so two changes cannot overwrite each other, and another change landed between the read and the write.
- The ownership registration is idempotent, so repeating the same request once the competing change finishes is safe.
- Creating or provisioning more than one app in the same workspace at the same time can cause this.

### Diagnostics

- `eai whoami` (read-only) — Confirm the signed-in user and active workspace.

### Fixes

- `Re-run the command that returned this code` (changes state) — The ownership registration is idempotent, so a repeat after the competing change finishes is safe. Wait for other app work in the workspace to finish first.

### Stop Conditions

- APP_OWNERSHIP_SCOPE_CONCURRENT_CHANGE repeats after bounded retry.

### Escalation Evidence

- app key
- workspace ID
- command
- CLI version
- request ID if present

## E296: App ownership registration failed unexpectedly.

| Field | Value |
| --- | --- |
| Reason | `app_ownership_scope_failed` |
| Category | `platform` |
| Severity | `error` |

### Why This Might Happen

- The platform returned a server-side failure while registering which Object Types the app owns, and it did not identify a more specific cause.
- Problems with the request itself return their own codes, so this points at the platform rather than at the app key or Object Types you supplied.
- Registration only adds ownership and never removes it, so one later bounded retry is safe.

### Diagnostics

- `eai whoami` (read-only) — Confirm the active workspace and profile are still correct.

### Fixes

None.

### Stop Conditions

- APP_OWNERSHIP_SCOPE_FAILED repeats after bounded retry.

### Escalation Evidence

- request ID
- HTTP status
- app key
- workspace ID
- CLI version
- command
