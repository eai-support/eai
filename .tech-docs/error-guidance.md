---
title: Error Guidance
description: Public-safe EAI CLI error explanations and agent recovery commands.
---

# Error Guidance

This page lists the public-safe error guidance bundled with `@eai-tools/cli`
v3.4.1. The same catalog powers human stderr output, JSON output for AI
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
| `E242` | `tenant_authorization_incomplete` | Tenant data-plane authorization incomplete. |
| `E243` | `tenant_authorization_platform_error` | Tenant app authorization could not be completed because the platform returned a server error. |
| `E250` | `paid_upgrade_required` | Tenant plan does not allow this builder operation. |
| `E260` | `object_type_validation_failed` | Object Type validation failed. |
| `E270` | `object_type_not_published` | Object Type is not published for the active tenant. |
| `E280` | `workflow_operator_required` | Workflow runtime binding requires operator assistance. |

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
- `eai tenant bootstrap-admin --parent <parent-id> --child <child-id>` (changes state) — Bootstrap direct child tenant admin access when the user is authorized as the parent tenant admin. Only when the user is already an authorized parent tenant admin.

### Stop Conditions

- The user lacks the required tenant role. Retrying will not change authorization.

### Escalation Evidence

- signed-in email
- active tenant slug
- requested command
- request ID if present

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

