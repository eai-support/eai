---
generated: false
---
# PublicAPI V4 Coverage Matrix

This page compares the PublicAPI V4 route surface in `enterpriseaigroup/PublicAPI` with the commands and client methods exposed by `@eai-tools/cli`.

Audit source:

- PublicAPI route composition: `mid/PublicAPI/src/app/routers/v4/__init__.py`
- PublicAPI V4 route handlers and route adapters: `mid/PublicAPI/src/app/routers/v4/**`
- eai client/commands: `ops/eai-cli/src/lib/api.ts` and `ops/eai-cli/src/commands/**`

As of the local audit, PublicAPI V4 exposes 194 method/path route entries across these interface prefixes: `/v4/identity`, `/v4/platform`, `/v4/workflows`, `/v4/ai`, `/v4/data/resources`, `/v4/data/documents`, `/v4/geo`, `/v4/realtime`, `/v4/integrations`, `/v4/verticals/daisy`, and `/v4/webhooks`.

The CLI now has two layers of coverage:

1. Named commands for the workflows developers use most often.
2. `eai publicapi get|post|patch|put|delete <path>` for any authorized PublicAPI V4 route that does not yet have a named command.

`eai publicapi` only accepts `/v4/...` paths. It uses the same login, active tenant, bearer token, and PublicAPI authorization path as the named commands, so it does not bypass platform tenant policy.

Status meanings:

- **Covered**: eai has a user-facing command for the route family.
- **Partial**: eai covers the common developer path but not every PublicAPI operation in that route family.
- **Advanced covered**: PublicAPI V4 has no polished named command yet, but is reachable through `eai publicapi` for authorized users.
- **Not a normal CLI command**: the route is an inbound callback or server-to-server surface; eai may only need diagnostics or replay tooling.

## Coverage Table

| PublicAPI V4 interface | PublicAPI capability | Current eai orchestration | Status | Recommended eai direction |
|---|---|---|---|---|
| `/v4/identity` | Current user profile: `GET /me`, `GET /custom-user/me`, `PATCH /me/profile` | `eai whoami` is local-token focused; `eai publicapi` can call these routes directly. | Advanced covered | Add `eai identity me` and `eai identity profile update` for authenticated profile inspection/repair. |
| `/v4/identity` | Current user tenant memberships: `GET /tenants` | `eai tenant list`, `eai tenant select`, `eai tenant info` use this. | Covered | Keep as the main tenant-context source. |
| `/v4/identity` | Current user provisioning: `POST /me/provision` | `eai user provision-me` uses this. | Covered | Keep. |
| `/v4/identity` | Session routing: `POST /session/resolve` | Used internally during tenant context bootstrap, not exposed as a command. | Partial | Add a diagnostic-only command such as `eai verify session-route` if operators need to inspect resolved PublicAPI routing. |
| `/v4/identity` | Remove current user's tenant membership: `DELETE /tenants/{tenant_id}/membership` | `eai publicapi delete` can call this route; no friendly command exists. | Advanced covered | Add `eai tenant leave <tenant>` with confirmation and clear safety messaging. |
| `/v4/platform` | Tenant list/create/get-management/delete, child create, child bootstrap | `eai tenant list/create/info/delete/bootstrap-admin` covers the developer tenant lifecycle. | Partial | Add missing read helpers for children, dashboard, usage, management metadata, and audit when useful to tenant admins. |
| `/v4/platform` | Tenant administration: settings, limits, plan, billing, account actions, suspend, authorized apps | `eai publicapi` can call authorized V4 routes; no friendly tenant-admin command group exists yet. | Advanced covered | Add `eai tenant admin` subcommands gated by role: `settings`, `limits`, `plan`, `billing`, `authorized-apps`, `suspend`, `account-action`. |
| `/v4/platform` | Tenant members and roles: list members, invite member, update member role, remove member, list role definitions | `eai user invite` provisions a user by oid/email; `eai publicapi` covers the remaining authorized V4 routes. | Partial | Add `eai tenant members list/invite/remove/roles set` and `eai tenant roles list`. |
| `/v4/platform` | User lookup and membership contract: `GET /users/by-email`, `GET /users/{oid}/memberships`, `POST /tenants/{tenant_id}/users/{oid}/provision` | `eai user invite`, `eai user provision-me`, `eai verify calls` use these. | Covered | Keep. |
| `/v4/platform` | Entra app provisioning and secret rotation | `eai provision entra` covers create/confirm and rotate-secret. | Covered | Keep; expose data-plane authorization diagnostics clearly in command output. |
| `/v4/platform` | Capability catalog/current/evaluate | `PlatformAPIClient.evaluateCapability` exists, readiness checks consume capability outcomes, and `eai publicapi` covers catalog/current. | Partial | Add `eai capabilities catalog`, `eai capabilities current`, and `eai capabilities evaluate`. |
| `/v4/platform` | Vertical catalog and industry defaults | `eai publicapi` can call these routes; no discovery command exists. | Advanced covered | Add `eai catalog verticals` and `eai catalog industry-defaults` for scaffolding/app discovery. |
| `/v4/platform` | Tenant apps and app provisioning jobs | `eai vertical create` creates a tenant app. It does not list app provisioning jobs or app-scoped object-type manifests. | Partial | Add `eai vertical jobs list/get/create` and `eai vertical object-types manifest/publish`. |
| `/v4/platform` | Tenant seed-source pages, workflows, chatbot config, tenant data, tenant profile | `eai publicapi` can call authorized routes; no support-shaped command exists. | Advanced covered | Add read-only `eai tenant seed-source ...` diagnostics for support/admin users. |
| `/v4/platform` | Tenant resource metadata and audit logs | `eai publicapi` can call authorized routes; no support-shaped command exists. | Advanced covered | Add `eai tenant resource-metadata get/upsert` and `eai tenant audit-logs`. |
| `/v4/platform` | Tenant document checklist proxy | `eai publicapi` can call authorized routes; no document-checklist command exists. | Advanced covered | Add `eai tenant document-checklist get/set/delete` or fold into document checklist commands. |
| `/v4/platform` | Account signup and support contact | `eai publicapi` can call authorized routes; no onboarding/support command exists. | Advanced covered | Add `eai account signup` only if CLI onboarding owns this flow; add `eai support contact` if support intake should work from terminals. |
| `/v4/data/resources` | Object Types list/create/update and schema | `eai types seed/diff/pull`, `eai resources schema`, and `eai verify` cover these. | Partial | Add Object Type delete if tenant admins need CLI rollback; today delete is not exposed. |
| `/v4/data/resources` | Resource CRUD, query, aggregate, batch, search | `eai resources list/get/create/update/delete/query/aggregate/batch-create/batch-update/batch-delete/search` cover these. | Covered | Keep. |
| `/v4/data/resources` | Resource streaming list endpoint | `PlatformAPIClient.streamResources` exists; `eai publicapi` can also call this route. | Advanced covered | Add `eai resources stream <type>` for large scans or live cursor-style export. |
| `/v4/data/resources` | Resource actions endpoint | `PlatformAPIClient.executeResourceAction` exists; `eai publicapi` can also call this route. | Advanced covered | Add `eai resources action <type> <id> <action> --data ...`. |
| `/v4/data/resources` | Resource history | `PlatformAPIClient.getResourceHistory` exists; `eai publicapi` can also call this route. | Advanced covered | Add `eai resources history <type> <id>`. |
| `/v4/data/resources` | Resource links create/list/delete | `eai publicapi` can call authorized routes; no relationship command exists. | Advanced covered | Add `eai resources links list/add/remove` for relationship management. |
| `/v4/data/resources` | File property upload/download/delete/SAS | `eai resources file upload/get/delete` covers file content. SAS URL is not exposed. | Partial | Add `eai resources file sas` if direct temporary URL inspection is required. |
| `/v4/data/resources` | Storage status/doctor/provision/sync-schema | `eai resources storage status`, `eai resources storage doctor`, `eai provision storage`, `eai resources sync-schema`, and `eai resources doctor` cover these. | Covered | Keep. |
| `/v4/data/resources` | Storage bootstrap geo | `eai publicapi` can call this route; no storage command exists. | Advanced covered | Add `eai resources storage bootstrap-geo` or keep under future geo tooling. |
| `/v4/data/resources` | ResourceAPI health/readiness | `eai verify` checks gateway and selected data contracts, not the ResourceAPI health routes directly. | Partial | Add optional `eai verify resourceapi --deep` if operators need direct readiness evidence. |
| `/v4/data/documents` | Upload, classify, get record, RAG index | `eai docs upload`, `eai docs classify`, and `eai docs index` cover the common developer path. | Partial | Keep, but expand document lifecycle commands below. |
| `/v4/data/documents` | Checklist, send checklist email, download bundle, classify by URL, async job status, batch index | `eai publicapi` can call authorized routes; no document workflow command exists. | Advanced covered | Add `eai docs checklist`, `eai docs send-checklist`, `eai docs download`, `eai docs classify-url`, `eai docs job`, and batch index options. |
| `/v4/data/documents` | RAG deindex and purge | `eai publicapi` can call authorized routes; no strongly confirmed docs command exists. | Advanced covered | Add `eai docs deindex` and `eai docs purge-rag` with strong confirmation. |
| `/v4/data/documents` | Delete document record / delete document from business request | `eai publicapi` can call authorized routes; no document delete command exists. | Advanced covered | Add `eai docs delete` with tenant/business-request context. |
| `/v4/data/documents` | Review routes: by business request, single document with SAS, document configuration, analyze/reassign | `eai publicapi` can call authorized routes; no reviewer command exists. | Advanced covered | Add `eai docs review list/get/config/analyze` for reviewers and support. |
| `/v4/data/documents` | Document templates CRUD and path proxy | `eai publicapi` can call authorized routes; no templates command exists. | Advanced covered | Add `eai docs templates list/create/update/delete` if templates are meant to be managed by tenant admins. |
| `/v4/ai` | Chat send and stream | `eai chat send` and `eai chat stream` cover runtime chat. | Covered | Keep. |
| `/v4/ai` | Chat models, feedback, chat history | `eai publicapi` can call authorized routes; no friendly chat support command exists. | Advanced covered | Add `eai chat models`, `eai chat feedback`, and `eai chat history`. |
| `/v4/ai` | Context search and session context update | `eai publicapi` can call authorized routes; no AI context command exists. | Advanced covered | Add `eai ai context search` and `eai ai session-context update`. |
| `/v4/workflows` | Runtime workflow status and runtime binding request | `eai workflow status`, `eai workflow request`, and `eai workflow readiness` cover this. | Covered | Keep. |
| `/v4/workflows` | Business request CRUD, anonymous business requests, claim, handoff token, chat-history migration, business-request documents | `eai publicapi` can call authorized routes; no business-request command group exists. | Advanced covered | Add `eai business-request` command group: `list/create/get/update/delete/claim/handoff/migrate-chat-history/documents`. |
| `/v4/integrations` | Builder readiness | `eai workflow readiness` uses this. | Covered | Keep. |
| `/v4/integrations` | NSW planning/property/spatial integration calls | `eai publicapi` can call authorized routes; no NSW command group exists. | Advanced covered | Add `eai integrations nsw ...` commands or generated passthrough wrappers for each NSW route. |
| `/v4/geo` | Geo lookup, classification, overlays, planning controls, reports, parcel/flood/legislative document helpers | `eai publicapi` can call authorized routes; no geo command group exists. | Advanced covered | Add `eai geo ...` commands grouped by lookup/query/report. |
| `/v4/geo` | Tenant geo datasets and ingestion from GeoJSON, shapefile, dataset file, ResourceAPI resource | `eai publicapi` can call authorized routes; no geo dataset command group exists. | Advanced covered | Add `eai geo datasets list` and `eai geo ingest ...` commands. |
| `/v4/realtime` | WebSocket negotiation and DAISY alerts | `eai publicapi` can call authorized routes for diagnostics. | Advanced covered | Add `eai realtime negotiate` and `eai realtime alerts` for diagnostics, not normal app runtime. |
| `/v4/verticals/daisy` | DAISY state calls, streaming state calls, feedback email | `eai publicapi` can call authorized routes; no DAISY-specific command exists. | Advanced covered | Add `eai daisy ...` only if the CLI is expected to exercise vertical-specific runtime behavior; otherwise document as app/BFF-owned. |
| `/v4/webhooks` | Stripe webhook receiver | No command. | Not a normal CLI command | Do not expose as a normal user command. Consider `eai webhooks stripe replay/verify` only for controlled operator diagnostics. |

## Highest Priority Named Command Gaps

`eai publicapi` provides complete authorized V4 reachability. The next
implementation waves should turn the most common advanced routes into
product-shaped commands:

1. **Tenant administration parity**: members, roles, plan, billing, limits, settings, authorized apps, audit logs.
2. **Business request lifecycle**: list/create/get/update/delete/claim/handoff/documents.
3. **Document operations parity**: checklist, review, templates, delete, RAG deindex/purge, async job status.
4. **Resource advanced operations**: history, actions, links, file SAS, object type delete, geo storage bootstrap.
5. **Geo and NSW integrations**: read/query/report/ingest commands.
6. **AI support commands**: models, feedback, history, context search, session context update.
7. **Realtime diagnostics**: negotiate and alerts.

## Notes

- Some V4 PublicAPI routes are generic proxies to Configurator, AdminAPI, ResourceAPI, GeoService, or AICore. `eai publicapi` covers them for advanced use, but common workflows should still graduate into product-shaped commands so users do not need to know backend collection or service paths.
- Webhook receivers are part of PublicAPI but are not normal user-initiated workflows. They should be covered by diagnostics/replay tooling rather than everyday CLI orchestration.
- This matrix is an audit of PublicAPI capability. The API reference now includes both named commands and the advanced V4 command surface.
