---
artifact: eai-preflight
feature: "{{feature_id}}"
status: "{{ready|blocked|deferred|not_applicable}}"
created: "{{iso_timestamp}}"
updated: "{{iso_timestamp}}"
---

# EAI App Delivery Preflight

## Summary

| Field | Status | Evidence |
| ----- | ------ | -------- |
| EAI app delivery applies | {{yes|no}} | {{classification evidence}} |
| CLI installed | {{ready|missing|failed}} | {{command -v eai, eai --version}} |
| CLI release status | {{current|upgrade_required|blocked}} | {{eai update --check}} |
| CLI capabilities discovered | {{ready|blocked}} | {{eai --describe timestamp}} |
| Logged in | {{ready|login_required|account_required}} | {{eai whoami summary, no tokens}} |
| Tenant ready | {{ready|tenant_required|operator_required}} | {{tenant role category, no private payloads}} |
| Template ready | {{ready|template_required|deferred}} | {{template markers or eai verify result}} |
| Drift readiness | {{ready|drift_detected|not_applicable}} | {{eai template check / eai gofer refresh --check}} |
| App enrollment ready | {{ready|confirmation_required|blocked|deferred}} | {{vertical list/create/select summary}} |
| Resource provisioning | {{not_started|in_progress|ready|blocked|deferred}} | {{eai vertical provision, entra, and storage-health evidence}} |
| Object-type publish | {{not_started|in_progress|ready|blocked|deferred}} | {{eai types validate/seed/diff evidence}} |
| Schema and storage health | {{not_started|in_progress|ready|blocked|deferred}} | {{resource schema, storage status/doctor, verify storage evidence}} |
| Workflow readiness | {{ready|blocked|deferred}} | {{eai workflow readiness evidence}} |
| Block catalog ready | {{ready|blocked|deferred}} | {{blocks list/readiness/describe summary}} |
| App stack policy | {{ready|exception_required|blocked}} | {{EAI Platform including app template first, Azure second, or approved exception}} |

## Safe Public Sources Used

- EAI CLI overview: https://eai-tools.github.io/eai/docs/overview
- EAI API reference: https://eai-tools.github.io/eai/docs/api-reference
- EAI static registry: https://eai-tools.github.io/eai/registry/
- EAI scenario library: https://eai-tools.github.io/eai/scenarios
- EAI app template: https://github.com/eai-tools/eai-app-template

## Commands Run

| Purpose | Command | Result |
| ------- | ------- | ------ |
| Install check | `command -v eai` | {{result}} |
| Version check | `eai --version` | {{result}} |
| Release check | `eai update --check` | {{result}} |
| Capability discovery | `eai --describe` | {{result}} |
| Login check | `eai whoami` | {{result}} |
| Tenant check | `eai tenant list --format json` | {{result}} |
| Project check | `eai verify` | {{result_or_not_run}} |
| Template drift check | `eai template check --format json` | {{result_or_not_run}} |
| Gofer drift check | `eai gofer refresh --check --format json` | {{result_or_not_run}} |
| App enrollment check | `eai vertical list --format json` | {{result_or_not_run}} |
| App selection | `eai vertical select <key> --format json` | {{result_or_not_run}} |
| App resource provisioning | `eai vertical provision <key> --tenant-id <tenant-id> --select --format json` | {{result_or_not_run}} |
| Entra provisioning | `eai provision entra` | {{result_or_not_run}} |
| Environment pull | `eai env pull` | {{result_or_not_run}} |
| Object-type validation | `eai types validate` | {{result_or_not_run}} |
| Object-type publish | `eai types seed --tenant-key <key> --tenant-id <tenant-id> --format json` | {{result_or_not_run}} |
| Object-type convergence | `eai types diff --tenant-key <key> --tenant-id <tenant-id>` | {{result_or_not_run}} |
| Resource schema | `eai resources schema --tenant-id <tenant-id> --format json` | {{result_or_not_run}} |
| Storage status | `eai resources storage status --tenant-id <tenant-id> --format json` | {{result_or_not_run}} |
| Storage doctor | `eai resources storage doctor --tenant-id <tenant-id> --format json` | {{result_or_not_run}} |
| Storage verify | `eai verify storage --tenant-id <tenant-id>` | {{result_or_not_run}} |
| Resource call verify | `eai verify calls --tenant-id <tenant-id> --resource-type <resource-type>` | {{result_or_not_run}} |
| Workflow readiness check | `eai workflow readiness --format json` | {{result_or_not_run}} |
| Block catalog check | `eai blocks list --format json` | {{result_or_not_run}} |
| Block readiness check | `eai blocks readiness --package-profile {{profile}} --format json` | {{result_or_not_run}} |

## Template Markers

| Marker | Present |
| ------ | ------- |
| `src/eai.config/object-types.ts` | {{yes|no}} |
| `src/eai.config/register.ts` | {{yes|no}} |
| `.env.example` | {{yes|no}} |
| `.npmrc` | {{yes|no}} |
| `package.json` | {{yes|no}} |

## Decisions

| Decision | Value | Rationale |
| -------- | ----- | --------- |
| Initialize template | {{yes|no|deferred}} | {{reason}} |
| App directory | {{current_repo|new_sibling|existing_eai_app}} | {{reason}} |
| Company tenant | {{selected|blocked|deferred}} | {{safe label only}} |
| Child tenant boundary | {{none|required|deferred}} | {{reason}} |
| Package profile | {{external|internal|hybrid|deferred}} | {{reason}} |
| App enrollment | {{existing|create_confirmed|confirmation_required|blocked|deferred}} | {{reason}} |
| App stack | {{eai_platform_azure|approved_exception|blocked}} | {{reason}} |

## Execution Order And Gate Tracking

| Field | Value |
| ----- | ----- |
| Planned execution order | {{template_init -> dependency_install -> login -> tenant_select -> vertical_list_or_create -> vertical_select -> vertical_provision -> entra_provision -> env_pull_if_needed -> types_validate -> types_seed -> types_diff -> resources_schema -> storage_status_doctor_verify -> verify_calls -> preview_or_dev}} |
| Last completed gate | {{safe_status_label}} |
| Blocked gate | {{safe_status_label_or_none}} |
| Next recovery command | {{command_or_none}} |
| Preview/doc URL readiness | {{not_ready|ready|deferred}} |
| Repo-owned fallback references | {{.specify/references/platform/eai-repo-contract.md + eai-error-catalog.yaml}} |

## App Stack Policy

For app delivery, Gofer builds on EAI Platform first, including the EAI app
template, and Azure second. Use the EAI app template, CLI, PublicAPI, object
types, workflows, block catalog, ResourceAPI/resource schema, tenant/app
enrollment, provisioning, diagnostics, and Azure-compatible
deployment/supporting services before any non-EAI exception. Record Firebase,
Supabase, Vercel primary runtime, AWS, GCP, bespoke backend, unmanaged database,
or unrelated SaaS usage only as an approved integration/migration/exception with
rationale, owner, expiry, and validation evidence.

## Next Action

{{continue_discovery|install_eai|login_required|tenant_access_required|initialize_template|confirm_app_enrollment|stop_non_eai}}

## Recovery Rules

- If `eai types seed` fails with an app-resources/provisioning error, return to
  `eai vertical provision <key> --tenant-id <tenant-id> --select --format json`
  and keep `Object-type publish` blocked.
- If `eai resources schema`, storage endpoints, app endpoints, or preview URLs
  return `503` or equivalent readiness failures, run
  `eai resources storage status --tenant-id <tenant-id> --format json`,
  `eai resources storage doctor --tenant-id <tenant-id> --format json`, and
  `eai verify storage --tenant-id <tenant-id>` before claiming schema or
  preview readiness.
- Do not claim provisioning, seeding, schema readiness, or preview readiness as
  equivalent states. Record each gate separately.

## Privacy Guardrail

Do not record access tokens, refresh tokens, secrets, full `.env.local` values,
private tenant payloads, or private platform topology in this artifact.
