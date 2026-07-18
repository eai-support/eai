---
generated: true
generated_at: "2026-07-18T00:43:35.547Z"
source_commit: "2a8bdd374117db29258268d3fa9545eb19b88a49"
---
# EAI CLI — API Reference

## Overview

The EAI CLI groups its commands into scaffolding, authentication, tenant and user management, environment/config, Object Types, resource data operations, AI chat and workflow provisioning, document processing, deployment, block-catalog inspection, app management, advanced PublicAPI V4 access, and diagnostics. All commands that interact with the platform use the **EAI Platform API v4** (PublicAPI) with Bearer token authentication.

The v4 surface is grouped by domain prefix:

| Prefix | Domain |
|--------|--------|
| `/v4/platform` | Tenants, users, capabilities, Entra app provisioning |
| `/v4/identity` | Current-user identity, membership, self-provision |
| `/v4/data/resources` | Object Types, resource CRUD, query, aggregate, search, storage |
| `/v4/data/documents` | Document upload, classification, RAG indexing |
| `/v4/ai` | Chat (scoped by tenant / workflow / stage) |
| `/v4/workflows` | Runtime workflow status and binding requests |
| `/v4/integrations` | Builder readiness |
| `/v4/geo` | Geospatial lookup, reports, and dataset ingestion |
| `/v4/realtime` | Realtime negotiation and alerts |
| `/v4/webhooks` | Controlled inbound webhook surfaces |

- **Base URL**: Configured via `BASE_URL_PUBLIC_API` environment variable or profile
- **Authentication**: `Authorization: Bearer {access_token}` (obtained via `eai login`)
**Global Flags**: `--simple`, `--no-color`, `--color`, `--profile <name>`, `--describe`, `-V`

> **Note on `eai env`:** `env pull` and `env push` are configuration-plane operations. They do not call PublicAPI and may require organization-specific cloud access.

---

## CLI Commands

### Scaffolding Commands

#### `eai init`
Scaffold a new application from the EAI app template.

**Options**:
- `--from <source>` — Template source: GitHub repo URL or local path (default: `https://github.com/eai-tools/eai-app-template.git`)
- `--skip-prompts` — Use defaults without interactive prompts
- `--current-dir` — Scaffold into the current directory instead of creating `./<name>`
- `--company-tenant <id>` — Main company tenant ID that owns this app
- `--tenant <id>` — Deprecated alias for `--company-tenant`
- `--parent-tenant <id>` — Immediate parent company tenant ID for the new child company
- `--child-tenant <name>` — Create or reuse a child company tenant (display name) for the app runtime boundary
- `--create-child-tenant` — Prompt for a child company tenant instead of using the selected company tenant
- `--no-gofer` — Skip installing Gofer AI CLI assets
- `--package-profile <profile>` — Package profile for block-catalog discovery: `external`, `internal`, or `hybrid` (default: `external`)

**What it does**:
1. Clones template repository or copies local template
2. Installs Gofer AI assets (unless `--no-gofer`)
3. Initializes git repository and installs npm dependencies
4. Records the company/child tenant boundary and package profile in the project manifest

By default, `eai init my-app` creates a new `./my-app` folder. Interactive init
can scaffold into the current folder when selected, and automation can use
`eai init my-app --current-dir`. Current-folder init preserves unrelated
existing files and Git metadata, and updates files that are part of the
generated scaffold.

**API calls** — when authenticated, `eai init` creates or binds the app under
the selected company tenant and evaluates the tenant capabilities used by the
generated scaffold.

---

#### `eai dev`
Start the local development server with connectivity checks.

**Options**:
- `--port <port>` — Port number (default: 3000)
- `--turbo` / `--no-turbo` — Use Turbopack (default: enabled)
- `--skip-checks` — Skip platform connectivity checks

**No API calls** — local operation only

---

### Authentication Commands

#### `eai login`
Authenticate with Entra CIAM using a browser-based PKCE flow.

**Options**:
- `--tenant-name <name>` — CIAM tenant name
- `--tenant-id <id>` — CIAM tenant ID
- `--scope <scopes>` — OAuth scopes
- `--callback-port <port>` — localhost port to listen on for the callback server

**What it does**:
1. Generates PKCE `code_verifier` / `code_challenge`
2. Opens the browser to the Entra CIAM authorization endpoint and listens on a localhost callback, using a fixed port when `--callback-port` is supplied
3. Exchanges the authorization code for tokens and saves them to `~/.eai/tokens.json`

**External endpoint**: Entra CIAM `POST /oauth2/v2.0/token` (token exchange) — not a platform API call

---

#### `eai logout`
Clear stored authentication tokens (deletes `~/.eai/tokens.json` and clears tenant context).

**No API calls**

---

#### `eai whoami`
Show authentication status, active tenant, profile, and token expiry from local state.

**No API calls**

---

### Tenant Commands

#### `eai tenant list`
List tenants where the current user is a `tenant-admin` (default), or all roles with `--all`.

**Options**:
- `--parent <id>` — Parent tenant ID
- `--all` — Include tenants where the user holds non-admin roles
- `--debug` — Show debug diagnostics for tenant lookup
- `--raw-user` — Print the raw membership payload in debug mode
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v4/identity/tenants` — fetch the current user's tenant memberships

---

#### `eai tenant select [tenant]`
Choose the active tenant for platform operations (interactive if `[tenant]` is omitted).

**Arguments**:
- `[tenant]` — Tenant ID or slug (optional)

**Platform API Endpoints Used**:
- `GET /v4/identity/tenants` — resolve memberships for selection

---

#### `eai tenant info <id>`
Show tenant details.

**Arguments**:
- `<id>` — Tenant ID or slug

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v4/identity/tenants` — resolves the tenant from the membership list

---

#### `eai tenant create`
Create a new tenant and bootstrap admin access.

**Options**:
- `--name <name>` — Tenant display name (required)
- `--slug <slug>` — Tenant slug, kebab-case (required)
- `--parent <id>` — Parent tenant ID (creates a child tenant)
- `--domain <domains>` — Comma-separated domain list
- `--usecase <usecase>` — `council|retail|healthcare|finance|manufacturing|generic` (default: `generic`)
- `--industry <industry>` — Signup/onboarding industry segment
- `--starter-template <key>` — Starter application template key (default: `blank-vertical-template`)
- `--home-region <region>` — Tenant home region (`au|ca|eu`); required with `--allow-root`, optional child override with `--parent`
- `--allow-root` — Allow root tenant creation for administrative backfills
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Creates a child tenant under `--parent`, or a root tenant when `--allow-root` is set
2. Bootstraps the current user as `tenant-admin` on the new child tenant
3. Polls membership to confirm the tenant is usable, then auto-selects it
4. For child tenants, sends the parent home region by default or the explicit `--home-region` override
5. For root tenants, requires an explicit `--home-region` because there is no parent tenant to inherit from

**Platform API Endpoints Used**:
- `POST /v4/platform/tenants/{parentId}/children` — create child tenant (when `--parent` is given)
- `POST /v4/platform/tenants` — create root tenant (requires `--allow-root`)
- `POST /v4/platform/tenants/{parentId}/children/{childId}/bootstrap-admin` — bootstrap current user as admin
- `GET /v4/identity/tenants` — verify usable membership

---

#### `eai tenant delete <id>`
Soft-delete a tenant.

**Arguments**:
- `<id>` — Tenant ID

**Options**:
- `--force` — Skip confirmation
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v4/platform/tenants/{tenantId}/delete`

---

### User Management Commands

#### `eai user invite`
Invite or provision a user into a tenant via the V4 tenant member-invite flow.
Use this when a tenant admin needs to add a member or promote a trusted user to
`tenant-admin`.

**Options**:
- `--email <email>` — Email of the user to add
- `--tenant <id>` — Target tenant (default: active tenant)
- `--role <role>` — Target base role (default: `tenant-viewer`; supported base roles are `tenant-viewer`, `tenant-staff`, `tenant-builder`, `tenant-admin`)
- `--role-definition-id <id>` — Assign a specific tenant role definition instead of a base role
- `--first-name <name>` — Optional first name for invite/provisioning context
- `--last-name <name>` — Optional last name for invite/provisioning context
- `--message <message>` — Optional invite message
- `--redirect-uri <uri>` — Optional post-acceptance redirect URI
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v4/platform/tenants/{tenantId}/members/invite` — invite or provision the tenant member with the requested role

---

#### `eai user list`
List members in the active tenant or an explicit tenant.

**Options**:
- `--tenant <id>` — Target tenant (default: active tenant)
- `--search <query>` — Search by email or name
- `--page <number>` — Page number (default: 1)
- `--limit <number>` — Page size (default: 25)
- `--sort <field>` — Sort field (default: email)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v4/platform/tenants/{tenantId}/members` — list tenant members

---

#### `eai user roles`
List role definitions available for tenant member invitation.

**Options**:
- `--tenant <id>` — Target tenant (default: active tenant)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v4/platform/tenants/{tenantId}/role-definitions` — list assignable tenant role definitions

---

#### `eai user role set`
Assign a tenant member role. Email-based role assignment uses the V4 invite/add
flow so agents can handle "user already exists", "user is new to this tenant",
and "user needs a tenant-admin role" with one command.

**Options**:
- `--email <email>` — Add or update a user by email through the invite/add flow
- `--member-id <id>` — Existing tenant member/user ID for the direct role update endpoint
- `--tenant <id>` — Target tenant (default: active tenant)
- `--role <role>` — Role to assign. Email-based updates support `tenant-viewer`, `tenant-staff`, `tenant-builder`, and `tenant-admin`; member-id updates support the platform role update contract.
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v4/platform/tenants/{tenantId}/members/invite` — email-based add/update with a role
- `PATCH /v4/platform/tenants/{tenantId}/members/{memberId}/roles` — direct member-id role update

---

**Agent rule**: for normal user addition or tenant-admin assignment, use
`eai user invite --email <email> --tenant <tenant-id> --role <role>`.
`eai tenant bootstrap-admin` is only for first-admin repair on an immediate child
tenant.

---

#### `eai user provision-me`
Provision yourself to a tenant (first-time setup).

**Options**:
- `--tenant <id>` — Target tenant (default: active tenant)

**Platform API Endpoints Used**:
- `POST /v4/identity/me/provision`

---

#### `eai provision entra`
Create or confirm an Entra app registration for end-user auth (Auth.js).

**Options**:
- `--force` — Re-check the remote app registration even if `ENTRA_CLIENT_ID` already exists locally
- `--rotate-secret` — Rotate the existing secret and write the new value to `.env.local`
- `--deauthorize` — Remove tenant authorization and delete the app registration for cleanup; requires `--force`
- `--client-id <id>` — Client ID to deauthorize; defaults to `ENTRA_CLIENT_ID` in `.env.local`
- `--keep-registration` — Remove tenant authorization without deleting the app registration
- `--debug` — Print product-safe diagnostics and request identifiers on failure

**What it does**:
1. Creates/confirms the Entra app registration on the platform
2. Writes the client ID (and secret) to `.env.local`
3. With `--deauthorize --force`, removes tenant authorization, deletes the app registration, and removes local `ENTRA_CLIENT_ID`/`ENTRA_CLIENT_SECRET`

**Platform API Endpoints Used**:
- `POST /v4/platform/provisioning/entra-apps` — create/confirm app registration
- `POST /v4/platform/provisioning/entra-apps/{clientId}/rotate-secret` — rotate secret (with `--rotate-secret`)
- `DELETE /v4/platform/provisioning/entra-apps/{clientId}` — deauthorize/delete app registration (with `--deauthorize --force`)

---

#### `eai provision storage`
Provision platform storage backends for the active tenant.

**Options**:
- `--tenant-id <id>` — Provision for a specific tenant
- `--backend <backend>` — `postgresql|mongodb|documentdb|blob|search|all` (default: `all`; `mongodb` is normalized to `documentdb`)
- `--dry-run` — Plan actions without applying changes
- `--rebuild-search` — Request a search projection rebuild after provisioning
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v4/data/resources/{tenantId}/storage/provision`

---

### Environment Commands

> `env pull` / `env push` use the configured cloud configuration and secret stores directly. They are **not** platform API calls.

#### `eai env pull`
Sync cloud config into the local `.env.local`.

**Options**:
- `--env <environment>` — Environment profile, such as `dev`, `test`, or `prod` (default: `dev`)
- `--label <label>` — Configuration label (defaults to the app name)
- `--include-secrets` — Resolve secret references when authorized

**What it does**:
1. Reads non-secret config from the organization cloud configuration store
2. Resolves secret references when `--include-secrets` is set
3. Writes the merged values to `.env.local`

**No platform API calls** — configuration plane only

---

#### `eai env list`
Show current environment variables (secrets masked by default).

**Options**:
- `--show-secrets` — Show secret values
- `--format <format>` — Output format (text|json, default: text)

**No API calls** — reads local `.env.local` and `eai.config.ts`

---

#### `eai env push`
Push local config overrides to the cloud (admin).

**Options**:
- `--label <label>` — Configuration label
- `--key <key>` — Push a single key

**What it does**: Writes values to the configured cloud configuration store.

**No platform API calls** — configuration plane only

---

### Object Type Commands

#### `eai types validate`
Validate Object Type definitions in `src/eai.config/object-types.ts` against platform schema rules, locally.

**No API calls** — local validation only

---

#### `eai types seed`
Push Object Types to the platform and verify convergence.

**Options**:
- `--env <environment>` — Target environment (default: `dev`)
- `--tenant-key <key>` — Specific tenant key from `object-types.ts`
- `--tenant-id <id>` — Override the resolved tenant ID (use with `--tenant-key`)
- `--dry-run` — Show what would be seeded without making changes
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v4/data/resources/object-types` — fetch existing types for diffing
- `POST /v4/data/resources/object-types` — create a new type
- `PATCH /v4/data/resources/object-types/{objectTypeId}` — update an existing type

---

#### `eai types diff`
Compare local definitions with remote state.

**Options**:
- `--tenant-key <key>` — Specific tenant key from `object-types.ts`
- `--tenant-id <id>` — Override the resolved tenant ID (use with `--tenant-key`)

**Platform API Endpoints Used**:
- `GET /v4/data/resources/object-types`

---

#### `eai types pull`
Download remote types to local TypeScript.

**Options**:
- `--tenant-id <id>` — Platform tenant ID
- `--output <path>` — Output file path (default: `src/eai.config/object-types.generated.ts`)

**Platform API Endpoints Used**:
- `GET /v4/data/resources/object-types`

---

### Resource Commands

All resource routes are tenant-scoped: the active tenant (or `--tenant-id`) is part of the path.

#### `eai resources list <type>`
List resources of a specific Object Type.

**Arguments**:
- `<type>` — Object Type name

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--page <number>` — Page number (default: 1)
- `--limit <number>` — Items per page (default: 20)
- `--sort <field>` — Sort field; prefix with `-` for descending (default: `-created_at`)
- `--where <json>` — Structured where filter as JSON
- `--cursor <cursor>` — Opaque cursor from a previous response
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v4/data/resources/{tenantId}/{objectType}`

---

#### `eai resources get <type> <id>`
Get a single resource.

**Arguments**: `<type>`, `<id>`

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v4/data/resources/{tenantId}/{objectType}/{id}`

---

#### `eai resources create <type>`
Create a resource.

**Arguments**: `<type>`

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--data <json>` — Resource data as a JSON string
- `--file <path>` — Resource data from a JSON file
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v4/data/resources/{tenantId}/{objectType}`

---

#### `eai resources update <type> <id>`
Update a resource with optimistic locking.

**Arguments**: `<type>`, `<id>`

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--data <json>` — Updated data as a JSON string
- `--version <number>` — Resource version (auto-fetched if omitted)
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Auto-fetches the current resource for its version when `--version` is not supplied
2. Sends the update with `{ data, version }` for optimistic locking

**Platform API Endpoints Used**:
- `GET /v4/data/resources/{tenantId}/{objectType}/{id}` — fetch current version
- `PUT /v4/data/resources/{tenantId}/{objectType}/{id}` — update

---

#### `eai resources delete <type> <id>`
Delete a resource.

**Arguments**: `<type>`, `<id>`

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--force` — Skip confirmation
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `DELETE /v4/data/resources/{tenantId}/{objectType}/{id}`

---

#### `eai resources query`
Cross-type query with filters.

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--types <types>` — Comma-separated Object Type names (required)
- `--where <json>` — Filter conditions as JSON
- `--limit <number>` — Max results (default: 20)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v4/data/resources/{tenantId}/query`

---

#### `eai resources aggregate <type>`
Run a server-side aggregate query.

**Arguments**: `<type>`

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--group-by <fields>` — Comma-separated groupBy fields (required)
- `--metrics <json>` — Aggregate metrics as JSON (required)
- `--where <json>` — Structured where filter as JSON
- `--limit <number>` — Max summary rows (default: 1000)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v4/data/resources/{tenantId}/{objectType}/aggregate`

---

#### `eai resources search <query>`
Search tenant resource projections.

**Arguments**: `<query>`

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--types <types>` — Comma-separated Object Type names
- `--mode <mode>` — `fulltext|hybrid|vector` (default: `hybrid`)
- `--hybrid` / `--vector` / `--fulltext` — Shorthands that override `--mode`
- `--limit <number>` — Max results (default: 10)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v4/data/resources/{tenantId}/search`

---

#### `eai resources schema`
Show the published Object Types for a tenant.

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v4/data/resources/schema/{tenantId}`

---

#### `eai resources batch-create <type>` · `batch-update <type>` · `batch-delete <type>`
Bulk resource operations.

**Arguments**: `<type>`

**Options** (all three):
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--data <json>` — Batch payload as a JSON array or object
- `--file <path>` — Read the batch payload from a JSON file
- `--format <format>` — Output format (text|json, default: text)

**`batch-delete` also accepts**:
- `--ids <csv>` — Comma-separated IDs to delete

**Payload notes**:
- `batch-create` accepts a raw array (items become `{ data: item }`), a `{ items: [...] }` wrapper, or a single object
- `batch-update` items must be `{ id, data, version }`

**Platform API Endpoints Used**:
- `POST /v4/data/resources/{tenantId}/{objectType}/batch/create`
- `POST /v4/data/resources/{tenantId}/{objectType}/batch/update`
- `POST /v4/data/resources/{tenantId}/{objectType}/batch/delete`

---

#### `eai resources file upload <type> <id> <property> <path>` · `file get` · `file delete`
Manage binary file properties on a resource.

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--output <path>` — (`file get`) write to a specific path
- `--force` — (`file delete`) skip confirmation
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v4/data/resources/{tenantId}/{objectType}/{id}/files/{propertyName}?filename=...` — upload (`application/octet-stream`)
- `GET /v4/data/resources/{tenantId}/{objectType}/{id}/files/{propertyName}` — download
- `DELETE /v4/data/resources/{tenantId}/{objectType}/{id}/files/{propertyName}` — delete

---

#### `eai resources storage status` · `storage doctor` · `doctor` · `sync-schema`
Inspect and reconcile tenant storage.

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--backend <backend>` — (`sync-schema`) limit to `postgresql|documentdb|blob|search`
- `--dry-run` — (`sync-schema`) show the reconcile plan without mutating storage
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v4/data/resources/{tenantId}/storage` — storage routing/provisioning status (`storage status`)
- `GET /v4/data/resources/{tenantId}/storage/doctor` — diagnostics (`storage doctor`, `doctor`)
- `POST /v4/data/resources/{tenantId}/storage/sync-schema` — reconcile storage from Object Type metadata (`sync-schema`)

---

### AI Chat Commands

Chat is scoped by **tenant / workflow / stage**. The tenant comes from the active context; `--workflow` is required; `--stage` defaults to `chat`. A `conversation_id` (from `--conversation-id`, or an auto-generated UUID) is sent in the request body.

#### `eai chat send <message>`
Send a single chat message.

**Arguments**: `<message>`

**Options**:
- `--workflow <id>` — Workflow ID (required)
- `--stage <stage>` — Chat stage (default: `chat`)
- `--conversation-id <id>` — Conversation ID (auto-generated UUID if omitted)

**Platform API Endpoints Used**:
- `POST /v4/ai/chat/{tenantId}/{workflowId}/{stage}` — body `{ message, conversation_id, params }`

---

#### `eai chat stream <message>`
Stream a chat response over SSE.

**Arguments**: `<message>`

**Options**:
- `--workflow <id>` — Workflow ID (required)
- `--stage <stage>` — Chat stage (default: `chat`)
- `--conversation-id <id>` — Conversation ID (auto-generated UUID if omitted)

**Platform API Endpoints Used**:
- `POST /v4/ai/chat/stream/{tenantId}/{workflowId}/{stage}` — SSE; terminated by a `data: [DONE]` sentinel

---

### Workflow Commands

#### `eai workflow provision <workflow-key>`
Provision a usecase-agnostic workflow config and bind it to a tenant app. Optionally creates the AI runtime records.

**Arguments**: `<workflow-key>`

**Key options**:
- `--app <key>` — Tenant app key that consumes this workflow (required)
- `--vertical <key>` — Deprecated compatibility alias for `--app`
- `--tenant <id>` — Tenant to provision against (default: active tenant)
- `--display-name <name>` — Workflow display name
- `--usecase <usecase>` — Workflow usecase namespace (default: `generic`)
- `--scope-key <scopeKey>` — Explicit workflow scope key (defaults to `<usecase>:<workflow-key>`)
- `--stage <stage>` — Stage id, optionally `id:Display Name` (repeatable)
- `--stage-env <KEY=stage-id>` — Env mapping (repeatable)
- `--stage-prompt <stage=prompt>` — Prompt content for a stage (repeatable)
- `--workflow-env-key <key>` — Env key for the workflow id
- `--bind-ai-runtime` — Also create `shared-ai-profile` and `shared-chatbot-config` records
- `--ai-provider <integrationKey>` — Tenant integration key for the AI provider
- `--ai-model <model>` — AI model/deployment name
- `--ai-profile-key <key>` — Reusable `shared-ai-profile` key
- `--status <status>` — `active` or `draft` (default: `active`)
- `--write-local-env` — Patch `.env.local` with generated env values
- `--write-app-config` — Write generated env values to the configured cloud configuration store
- `--env <environment>` / `--label <label>` — Cloud configuration target (default env: `dev`)
- `--format <format>` — Output format (text|json, default: text)

**What it does** (upsert pattern — list, then create or update):
1. Upserts a `shared-workflow-config` resource record
2. Upserts a `vertical-product-config` binding record
3. With `--bind-ai-runtime`, also upserts `shared-ai-profile` and `shared-chatbot-config` records
4. With `--write-app-config`, writes env values to the cloud configuration store (not PublicAPI)

**Platform API Endpoints Used**:
- `GET` then `POST`/`PUT` `/v4/data/resources/{tenantId}/shared-workflow-config`
- `GET` then `POST`/`PUT` `/v4/data/resources/{tenantId}/vertical-product-config`
- (with `--bind-ai-runtime`) the same list/create/update routes for `shared-ai-profile` and `shared-chatbot-config`

---

#### `eai workflow readiness [workflow-keys...]`
Check tenant, plan, and workflow readiness for building an app.

**Arguments**: `[workflow-keys...]` (optional)

**Options**:
- `--tenant <id>` — Tenant to check (default: active tenant)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v4/integrations/builder/readiness?tenant_id=...&workflow_keys=...`

---

#### `eai workflow status <workflow-key>`
Check whether a workflow key has an executable runtime binding.

**Arguments**: `<workflow-key>`

**Options**:
- `--tenant <id>` — Tenant to check (default: active tenant)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v4/workflows/runtime/{workflowKey}/status?tenant_id=...`

**Possible statuses**: `available`, `operator_required`, `paid_upgrade_required`, `rate_limited`, `blocked`, `unsupported`

---

#### `eai workflow request <workflow-key>`
Request an operator-assisted runtime workflow binding.

**Arguments**: `<workflow-key>`

**Options**:
- `--tenant <id>` — Tenant to request for (default: active tenant)
- `--display-name <name>` — Human-readable workflow display name
- `--reason <reason>` — Short reason for the platform operator
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v4/workflows/runtime-requests` — body `{ tenant_id, workflow_key, display_name, reason }`

---

### Document Commands

#### `eai docs upload <file>`
Upload a document.

**Arguments**: `<file>`

**Platform API Endpoints Used**:
- `POST /v4/data/documents/upload` — `multipart/form-data` (`files`, `tenant_id`, `processing_mode=full`)

---

#### `eai docs classify <file>`
Classify a document.

**Arguments**: `<file>`

**Platform API Endpoints Used**:
- `POST /v4/data/documents/classify` — `multipart/form-data` (`files`, `tenant_id`, `processing_mode=classification`)

---

#### `eai docs index <id>`
Index a document for RAG (two-step).

**Arguments**: `<id>` — Document ID

**Platform API Endpoints Used**:
- `GET /v4/data/documents/records/{documentId}` — fetch the record to resolve its storage path
- `POST /v4/data/documents/rag-index` — submit the indexing job

---

### Advanced PublicAPI V4 Commands

Use named commands first for normal workflows. The `publicapi` command is the
advanced V4-only access layer for authorized users and operators when a route
family does not yet have a polished command.

#### `eai publicapi get <path>` · `post <path>` · `patch <path>` · `put <path>` · `delete <path>`
Call an authorized PublicAPI V4 path using the current login and active tenant
context.

**Arguments**:
- `<path>` — PublicAPI path. It must start with `/v4/`.

**Options**:
- `--tenant-id <tenantId>` — Use a specific tenant instead of the active tenant
- `--data <json>` — JSON request body
- `--file <path>` — Read JSON request body from a file
- `--param <key=value>` — Query parameter; repeat for multiple values
- `--include-headers` — Include response headers in JSON output
- `--format <format>` / `--json` — Output format

**Examples**:
```bash
eai publicapi get /v4/identity/me --format json
eai publicapi get /v4/platform/capabilities/catalog --format json
eai publicapi post /v4/geo/resolve-location --data '{"query":"Copenhagen"}'
eai publicapi patch /v4/identity/me/profile --file profile.json
```

**Platform API Endpoints Used**:
- Any authorized route under `/v4/identity`
- Any authorized route under `/v4/platform`
- Any authorized route under `/v4/workflows`
- Any authorized route under `/v4/ai`
- Any authorized route under `/v4/data/resources`
- Any authorized route under `/v4/data/documents`
- Any authorized route under `/v4/geo`
- Any authorized route under `/v4/realtime`
- Any authorized route under `/v4/integrations`
- Any authorized route under `/v4/verticals/daisy`
- Any authorized route under `/v4/webhooks`

The command does not bypass authorization. PublicAPI still validates the bearer
token, tenant context, route policy, and platform tenant authorization for the
called interface.

---

### Deployment Commands

#### `eai deploy setup`
Generate the deployment workflow and configure GitHub secrets.

**Options**:
- `--repo <owner/name>` — GitHub repository

**GitHub API**: configures repository secrets. No platform API calls.

---

#### `eai deploy trigger`
Trigger the deployment workflow.

**Options**:
- `--repo <owner/name>` — GitHub repository
- `--branch <branch>` — Branch to deploy (default: `main`)
- `--workflow <filename>` — Workflow file (default: `deploy-demo.yml`)
- `--format <format>` — Output format (text|json, default: text)

**GitHub API**: `POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches`

---

#### `eai deploy status`
Check deployment status.

**Options**:
- `--repo <owner/name>` — GitHub repository
- `--format <format>` — Output format (text|json, default: text)

**GitHub API**: `GET /repos/{owner}/{repo}/actions/runs`

---

### Block Catalog Commands

All `blocks` commands read the local block-catalog manifests — **no API calls**.

#### `eai blocks list`
List available UI blocks.

**Options**:
- `--lane <lane>` — Filter by package lane: `foundation|product|addon|dev`
- `--coupling <coupling>` — `external-safe|external-with-adapter|internal-only`
- `--readiness <readiness>` — `public-ready|preview|internal|blocked`
- `--package-profile <profile>` — `external|internal|hybrid`
- `--custom` — Show only custom extension blocks
- `--group-by <field>` — `lane|package|coupling|profile|readiness` (default: `lane`)
- `--format <format>` — Output format (text|json, default: text)

#### `eai blocks describe <block-id>`
Describe a block by its stable block id.

**Options**: `--format <format>` (text|json, default: text)

#### `eai blocks readiness`
Summarize public readiness and package-profile compatibility.

**Options**:
- `--package-profile <profile>` — Evaluate compatibility for `external|internal|hybrid`
- `--format <format>` — Output format (text|json, default: text)

#### `eai blocks schema`
Print the public EAI block manifest schema summary.

**Options**: `--format <format>` (json|text, default: json)

#### `eai blocks validate`
Validate the installed block catalog, or a manifest JSON file.

**Options**:
- `--file <path>` — Validate a manifest JSON file instead of the installed catalog
- `--strict` — Treat warnings as failures
- `--format <format>` — Output format (text|json, default: text)

---

### App Commands (`eai app`)

`eai vertical ...` remains available as a compatibility alias during the migration window.

#### `eai app list`
List apps for the active company tenant.

**Options**:
- `--tenant-id <id>` — Target company tenant
- `--limit <number>` — Items per page (default: 50)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v4/data/resources/{tenantId}/tenant-vertical-enrollment`

---

#### `eai app create <name>`
Create an app under a company tenant.

**Arguments**: `<name>`

**Options**:
- `--tenant-id <id>` — Main company tenant ID that owns this app
- `--parent-tenant <id>` — Immediate parent company tenant ID for the new child company
- `--child-tenant <name>` — Create or reuse a child company tenant (display name)
- `--child-tenant-slug <slug>` — Child company tenant key
- `--key <key>` — Stable app key (defaults to kebab-case of `<name>`)
- `--template <templateKey>` — Optional app-catalog template key
- `--source <source>` — Creation source (default: `eai-cli`)
- `--app-url <url>` — Optional app URL
- `--status <status>` — Initial lifecycle status (default: `pending`)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v4/platform/tenants/{companyTenantId}/apps`

---

#### `eai app select <key>`
Set `EAI_APP_KEY` in the current project `.env.local`. The CLI also writes `EAI_VERTICAL_KEY` for compatibility with existing projects.

**Arguments**: `<key>`

**Options**:
- `--tenant-id <id>` — Validate against a specific company tenant
- `--skip-validate` — Skip the remote lookup before writing `.env.local`
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used** (unless `--skip-validate`):
- `GET /v4/data/resources/{tenantId}/tenant-vertical-enrollment` — validate the key exists

---

#### `eai app provision <key>`
Prepare platform storage for an app.

**Arguments**: `<key>`

**Options**:
- `--tenant-id <id>` — Target company tenant
- `--backend <backend>` — `postgresql|mongodb|documentdb|blob|search|all` (default: `all`)
- `--dry-run` — Plan actions without applying changes
- `--rebuild-search` — Request a search projection rebuild after provisioning
- `--skip-validate` — Skip the app lookup
- `--select` — Write `EAI_APP_KEY` and compatibility `EAI_VERTICAL_KEY` after successful provisioning
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v4/data/resources/{tenantId}/tenant-vertical-enrollment` — validation (unless `--skip-validate`)
- `POST /v4/data/resources/{tenantId}/storage/provision`

---

### Diagnostics Commands

#### `eai verify`
Run read-only platform connectivity checks.

**Options**:
- `--tenant-id <id>` — Run checks against a specific tenant (read-only)

**Platform API Endpoints Used**:
- `GET /health` — PublicAPI gateway health
- `GET /v4/data/resources/object-types` — platform reachability
- `GET /v4/data/resources/schema/{tenantId}` — data-service reachability

---

#### `eai verify storage`
Verify storage status and doctor contracts.

**Options**:
- `--tenant-id <id>` — Tenant to verify
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v4/data/resources/{tenantId}/storage`
- `GET /v4/data/resources/{tenantId}/storage/doctor`

---

#### `eai verify calls`
Audit the platform API contracts used by the CLI. All checks are read-only unless `--include-chat` is passed.

**Options**:
- `--tenant-id <id>` — Tenant for read-only resource/schema checks
- `--resource-type <type>` — Resource type to probe with list/query/get checks
- `--resource-id <id>` — Specific resource ID to fetch during the audit
- `--workflow <id>` — Workflow ID for the chat smoke test
- `--stage <stage>` — Chat stage when `--include-chat` is enabled (default: `chat`)
- `--tenant-record <id>` — Tenant record ID for tenant-info lookup
- `--user-email <email>` — Email for the user-lookup contract check
- `--include-chat` — Execute a non-streaming chat request (creates a conversation)
- `--chat-message <message>` — Message to send when probing chat
- `--format <format>` — Output format (text|json, default: text)

**Endpoints probed** (subset, depending on flags): `GET /health`, `GET /v4/platform/tenants/{tenantId}/users/{oid}/memberships`, `GET /v4/data/resources/object-types`, `GET /v4/data/resources/schema/{tenantId}`, `GET|POST /v4/data/resources/{tenantId}/...`, `GET /v4/platform/tenants/{tenantId}/users/by-email`, `POST /v4/ai/chat/{tenantId}/{workflowId}/{stage}` (with `--include-chat`)

---

#### `eai doctor`
Comprehensive diagnostics with fix suggestions.

**Options**:
- `--fix` — Attempt to fix issues automatically
- `--check-updates` — Report CLI release status plus Gofer/template drift

**API calls**: local checks only; optionally reads npmjs and the EAI static
registry fallback for the update check.

---

### Maintenance Commands

#### `eai update`
Check for and install CLI updates from npmjs, with the EAI static registry as a
fallback, then maintain
safe repo-local project assets when the command is run inside an EAI project.

**Options**:
- `--check` — Only check for CLI, Gofer, and app-template status without installing or writing files
- `--no-project-refresh` — Skip Gofer/app-template maintenance for the current project

**Primary update channel**: npmjs package `eai-cli` or `@enterpriseai/cli`.
**Static fallback channel**: `https://eai-tools.github.io/eai/registry/@enterpriseai/cli`.

Recommended install:

```bash
npm install -g eai-cli
```

Canonical package install:

```bash
npm install -g @enterpriseai/cli
```

Static registry fallback:

```bash
npm install -g @enterpriseai/cli --@enterpriseai:registry=https://eai-tools.github.io/eai/registry/
```

Persistent static fallback setup:

```bash
npm config set @enterpriseai:registry https://eai-tools.github.io/eai/registry/ --location=user
npm install -g @enterpriseai/cli
```

No platform API calls.

**Project maintenance**:
- Normal `eai update` refreshes safe Gofer-managed files with the same backups
  and conflict detection as `eai gofer refresh`.
- App-template and UI files are not auto-merged. The CLI reports drift and
  points to `eai template check` for manual review.
- Interactive update prompts are suppressed for CI, non-TTY, `--describe`,
  `--format json`, and `--json`.

---

#### `eai gofer refresh`
Safely refresh Gofer-managed assets in the current project.

**Options**:
- `--check` — Show the refresh plan without writing files
- `--force` — Overwrite conflicting managed files after backing them up
- `--format <format>` — Output format (text|json, default: text)

**No API calls** — local file diff and copy from the latest public `eai-gofer`
release when available, falling back to bundled Gofer assets

---

#### `eai template check`
Preview file-level app-template / UI drift without writing to the repo.

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**No API calls** — local diff against the bundled template snapshot

---

## Platform API Endpoints

### Authentication (external)
- `POST /oauth2/v2.0/token` — Entra CIAM token exchange

### Health
- `GET /health` — PublicAPI gateway health

### Platform — Tenants
- `POST /v4/platform/tenants` — Create root tenant
- `POST /v4/platform/tenants/{parentId}/children` — Create child tenant
- `POST /v4/platform/tenants/{parentId}/children/{childId}/bootstrap-admin` — Bootstrap admin on a child tenant
- `POST /v4/platform/tenants/{tenantId}/delete` — Soft-delete tenant
- `POST /v4/platform/tenants/{companyTenantId}/apps` — Create app enrollment

### Platform — Users & Capabilities
- `GET /v4/platform/tenants/{tenantId}/users/by-email` — Look up a user by email in a tenant context
- `GET /v4/platform/tenants/{tenantId}/users/{oid}/memberships` — User memberships in a tenant context
- `POST /v4/platform/tenants/{tenantId}/users/{oid}/provision` — Provision a user into a tenant
- `POST /v4/platform/tenants/{tenantId}/members/invite` — Invite or provision a tenant member with a role
- `GET /v4/platform/tenants/{tenantId}/members` — List tenant members
- `GET /v4/platform/tenants/{tenantId}/role-definitions` — List assignable tenant role definitions
- `PATCH /v4/platform/tenants/{tenantId}/members/{memberId}/roles` — Update a tenant member role
- `POST /v4/platform/capabilities/evaluate` — Evaluate a capability decision

### Platform — Provisioning (Entra)
- `POST /v4/platform/provisioning/entra-apps` — Create/confirm an Entra app registration
- `POST /v4/platform/provisioning/entra-apps/{clientId}/rotate-secret` — Rotate the app secret

### Identity
- `GET /v4/identity/tenants` — Current user's tenant memberships
- `POST /v4/identity/me/provision` — Self-provision the current user

### Data — Object Types
- `GET /v4/data/resources/object-types` — List Object Types
- `POST /v4/data/resources/object-types` — Create an Object Type
- `PATCH /v4/data/resources/object-types/{objectTypeId}` — Update an Object Type
- `GET /v4/data/resources/schema/{tenantId}` — Published schema for a tenant

### Data — Resources
- `GET /v4/data/resources/{tenantId}/{objectType}` — List resources
- `GET /v4/data/resources/{tenantId}/{objectType}/{id}` — Get a resource
- `POST /v4/data/resources/{tenantId}/{objectType}` — Create a resource
- `PUT /v4/data/resources/{tenantId}/{objectType}/{id}` — Update a resource
- `DELETE /v4/data/resources/{tenantId}/{objectType}/{id}` — Delete a resource
- `POST /v4/data/resources/{tenantId}/query` — Cross-type query
- `POST /v4/data/resources/{tenantId}/{objectType}/aggregate` — Aggregate query
- `POST /v4/data/resources/{tenantId}/search` — Search projections
- `POST /v4/data/resources/{tenantId}/{objectType}/batch/{create|update|delete}` — Bulk operations
- `GET /v4/data/resources/{tenantId}/{objectType}/{id}/history` — Resource history *(client method; not yet exposed as a CLI subcommand)*
- `POST /v4/data/resources/{tenantId}/{objectType}/{id}/actions/{action}` — Execute a resource action *(client method; not yet exposed as a CLI subcommand)*
- `POST|GET|DELETE /v4/data/resources/{tenantId}/{objectType}/{id}/files/{propertyName}` — File property upload/download/delete

### Data — Storage
- `GET /v4/data/resources/{tenantId}/storage` — Storage status
- `GET /v4/data/resources/{tenantId}/storage/doctor` — Storage diagnostics
- `POST /v4/data/resources/{tenantId}/storage/provision` — Provision storage
- `POST /v4/data/resources/{tenantId}/storage/sync-schema` — Reconcile storage from Object Type metadata

### Data — Documents
- `POST /v4/data/documents/upload` — Upload a document
- `POST /v4/data/documents/classify` — Classify a document
- `GET /v4/data/documents/records/{documentId}` — Fetch a document record
- `POST /v4/data/documents/rag-index` — Index a document for RAG

### AI
- `POST /v4/ai/chat/{tenantId}/{workflowId}/{stage}` — Send a chat message
- `POST /v4/ai/chat/stream/{tenantId}/{workflowId}/{stage}` — Stream a chat response (SSE)

### Workflows
- `GET /v4/workflows/runtime/{workflowKey}/status` — Runtime workflow status
- `POST /v4/workflows/runtime-requests` — Request an operator-assisted binding

### Integrations
- `GET /v4/integrations/builder/readiness` — Builder readiness check

### Advanced V4 Route Families
- `GET|POST|PATCH|PUT|DELETE /v4/geo/...` — Geospatial lookup, reports, and dataset operations through `eai publicapi`
- `GET|POST /v4/realtime/...` — Realtime negotiation and alert diagnostics through `eai publicapi`
- `POST /v4/webhooks/...` — Controlled webhook ingress; use only where the caller is authorized and the route is intended for manual diagnostics or replay

### GitHub (deploy commands)
- `POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches` — Trigger a workflow
- `GET /repos/{owner}/{repo}/actions/runs` — Fetch workflow runs

> **Configuration plane (not PublicAPI):** `eai env pull` / `eai env push` use the configured cloud configuration and secret stores directly.

## Global Flags

These flags are available on the root `eai` command:

| Flag | Type | Description |
|------|------|-------------|
| `-V` | boolean | Output the version number |
| `--simple` | boolean | Plain text output without colors or symbols (for screen readers) |
| `--no-color` | boolean | Disable colored output |
| `--color` | boolean | Force colored output |
| `--profile <name>` | string | Use a locally configured private profile |
| `--describe` | boolean | Output a JSON schema of the command structure (for AI agents) |

Most data-returning subcommands additionally accept `--format <format>` (`text` default, or `json`). A legacy `--json` boolean is accepted on many commands but is deprecated in favor of `--format json`.

## Error Codes

The CLI uses structured error codes for consistent error handling. Each error carries a code, a message, an actionable suggestion, and a non-zero exit code. Messages with `{placeholder}` tokens are interpolated from command context.

### Project Errors (E001–E006)

| Code | Message | Suggestion |
|------|---------|------------|
| `E001` | Not in an EAI project | Run `eai init`, or navigate to an existing EAI project directory |
| `E002` | `{var}` environment variable not set | Set `{var}` in your environment or project config. Tenant selection comes from `eai login` / `eai tenant select`, not tenant IDs in `.env.local` |
| `E003` | Configuration file not found: `{file}` | Ensure `{file}` exists. Run `eai init` if this is a new project |
| `E004` | Object Types file not found or invalid | Create `src/eai.config/object-types.ts` |
| `E005` | Invalid project structure | Run `eai verify` to check your setup |
| `E006` | Failed to load configuration: `{details}` | Check `.env.local` and `eai.config.ts` for syntax errors |

### Authentication Errors (E101–E104)

| Code | Message | Suggestion |
|------|---------|------------|
| `E101` | Not logged in | Run `eai login` |
| `E102` | Access token expired | Run `eai login` to refresh |
| `E103` | Invalid credentials | Verify your credentials and try `eai login` again |
| `E104` | Authentication failed: `{details}` | Contact your administrator or try `eai login` again |

### Platform Errors (E201–E205)

| Code | Message | Suggestion |
|------|---------|------------|
| `E201` | Platform API unreachable: `{url}` | Check your network and verify `BASE_URL_PUBLIC_API` |
| `E202` | `{resource}` not found | Verify the `{resource}` ID or name |
| `E203` | Platform API error: `{details}` | Check the details above; contact support if it persists |
| `E204` | Permission denied | You lack permission for this action; contact your administrator |
| `E205` | Resource conflict: `{details}` | The resource already exists or conflicts with existing data |

### Validation Errors (E301–E305)

| Code | Message | Suggestion |
|------|---------|------------|
| `E301` | Invalid schema: `{details}` | Fix the schema errors listed above |
| `E302` | Validation failed: `{details}` | Correct the validation errors and try again |
| `E303` | Required field missing: `{field}` | Provide a value for `{field}` |
| `E304` | Invalid format: `{details}` | Valid formats are: `{validFormats}` |
| `E305` | Invalid input: `{details}` | Check your input and try again |

### JSON error envelope

When a command is run with `--format json`, errors are emitted as:

```json
{
  "error": {
    "code": "E302",
    "message": "Validation failed: name must be PascalCase",
    "suggestion": "Correct the validation errors and try again",
    "exitCode": 1
  }
}
```

## Machine-Readable Output

Most data-returning commands that advertise `--format <format>` support
`--format json` for automation. Check `eai --describe` or command help before
scripting a subcommand; status-only commands such as `eai whoami` and quick
`eai verify` are plain text today.

```bash
# Get JSON output
eai resources list User --format json

# Parse with jq
eai tenant list --format json | jq '.tenants[].slug'

# Use in scripts
if eai verify calls --format json | jq -e '.summary.failed == 0' > /dev/null; then
  echo "Platform contracts are healthy"
fi
```

The `--describe` flag outputs the CLI command structure as JSON, enabling AI agents and automation to discover capabilities at runtime:

```bash
eai --describe        # Describe all commands
eai types --describe  # Describe the types subcommands
```
