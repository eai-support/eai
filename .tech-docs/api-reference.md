---
generated: true
generated_at: "2026-05-23T18:05:52.673Z"
source_commit: "3f2653e8e0c12fcd8b9be770d495dbf8269079f1"
---
# EAI CLI — API Reference

## Overview

The EAI CLI provides 20 command groups covering scaffolding, authentication, tenant management, data operations, AI workflows, deployment, and diagnostics. All commands that interact with the platform use the **EAI Platform API v3** with Bearer token authentication.

**Base URL**: Configured via `BASE_URL_PUBLIC_API` environment variable or profile  
**Authentication**: `Authorization: Bearer {access_token}` (obtained via `eai login`)  
**Client Class**: `PlatformAPIClient` in `src/lib/api.ts`  
**Global Flags**: `--format <format>`, `--simple`, `--no-color`, `--color`, `--profile <name>`, `--describe`

---

## CLI Commands

### Scaffolding Commands

#### `eai init [name]`
Scaffold a new vertical application from the EAI vertical template.

**Options**:
- `[name]` — Project directory name (optional, prompts if omitted)
- `--from <source>` — Template source (repository URL or local path, default: CLI-bundled template)
- `--no-gofer` — Skip Gofer AI asset installation
- `--template <name>` — Template variant to use

**What it does**:
1. Clones template repository or copies local template
2. Installs Gofer AI assets (.claude, .agents, .gemini, .github, .specify)
3. Initializes git repository
4. Installs npm dependencies
5. Creates `.eai-manifest.json` for tracking managed files

**No API calls** — local operation only

---

#### `eai dev`
Start local development server with connectivity checks.

**Options**:
- `--port <port>` — Port number (default: 3000)
- `--host <host>` — Host binding (default: localhost)

**What it does**:
1. Validates project structure
2. Checks platform connectivity (if configured)
3. Starts Next.js dev server (or project-specific dev command)
4. Displays local URL and QR code

**No API calls** — local operation only

---

### Authentication Commands

#### `eai login`
Authenticate with Entra CIAM using browser-based PKCE flow.

**Options**:
- `--port <port>` — Localhost callback port (default: 3476)

**What it does**:
1. Generates PKCE `code_verifier` and `code_challenge`
2. Opens browser to Entra CIAM authorization endpoint
3. Listens on `http://localhost:3476/callback` for OAuth callback
4. Exchanges authorization code + code_verifier for tokens
5. Saves tokens to `~/.eai/tokens.json`

**Platform API Endpoints Used**:
- Entra CIAM: `POST /oauth2/v2.0/token` (token exchange)

---

#### `eai logout`
Clear stored authentication tokens.

**What it does**:
1. Deletes `~/.eai/tokens.json`
2. Clears tenant context

**No API calls**

---

#### `eai whoami`
Show authentication status and project context.

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Reads `~/.eai/tokens.json`
2. Reads `~/.eai/context.json`
3. Displays user info, active tenant, profile, token expiry

**Output** (text format):
```
✓ Logged in as user@example.com
→ Active tenant: acme-corp (tenant-id-123)
→ Profile: dev
→ Token expires: 2026-05-24T12:00:00Z
```

**No API calls**

---

### Tenant Commands

#### `eai tenant list`
List tenants where you are a `tenant-admin`.

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v3/tenants/memberships` — Fetch user's tenant memberships

---

#### `eai tenant select [tenant]`
Choose the active tenant for platform operations.

**Arguments**:
- `[tenant]` — Tenant ID or slug (optional, prompts if omitted)

**What it does**:
1. Fetches tenant memberships
2. Validates user has `tenant-admin` role
3. Saves selection to `~/.eai/context.json`

**Platform API Endpoints Used**:
- `GET /v3/tenants/memberships`

---

#### `eai tenant info <id>`
Show tenant details.

**Arguments**:
- `<id>` — Tenant ID or slug

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v3/tenants/{id}`

---

#### `eai tenant create`
Create a new tenant and verify usability.

**Options**:
- `--name <name>` — Tenant display name
- `--slug <slug>` — Tenant slug (URL-safe identifier)
- `--parent <id>` — Parent tenant ID (for child tenants)
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Creates tenant document
2. Attempts first-admin bootstrap (for child tenants)
3. Verifies direct `tenant-admin` membership
4. Auto-selects tenant if usable

**Platform API Endpoints Used**:
- `POST /v3/tenants` — Create tenant
- `POST /v3/tenants/{id}/bootstrap-first-admin` — Bootstrap admin (child tenants)
- `GET /v3/tenants/memberships` — Verify membership

---

### User Management Commands

#### `eai user invite --email <email>`
Add an existing user to a tenant.

**Options**:
- `--email <email>` — User email (required)
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--role <role>` — Role to assign (default: tenant-member)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v3/tenants/{tenant_id}/users/invite`

---

#### `eai user provision-me`
Provision yourself to a tenant.

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v3/tenants/{tenant_id}/users/provision`

---

#### `eai provision entra`
Create or confirm Entra app registration for the vertical.

**Options**:
- `--rotate-secret` — Rotate the existing app registration secret
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Calls AdminAPI to create/update Entra app registration
2. Writes client ID and secret to `.env.local`

**Platform API Endpoints Used**:
- `POST /admin/entra/provision`

---

### Environment Commands

#### `eai env pull`
Sync environment variables from Azure App Config and Key Vault.

**Options**:
- `--include-secrets` — Include secrets from Key Vault
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Fetches non-secret config from Azure App Configuration
2. Fetches secrets from Azure Key Vault (if `--include-secrets`)
3. Writes to `.env.local`

**Platform API Endpoints Used**:
- `GET /v3/config/environment` — Fetch environment variables
- `GET /v3/config/secrets` — Fetch secrets (if `--include-secrets`)

---

#### `eai env list`
Show current environment variables.

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Loads `.env.local`
2. Loads `eai.config.ts`
3. Merges with `process.env`
4. Displays final configuration (masks secrets)

**No API calls**

---

#### `eai env push`
Push local environment overrides to cloud (admin only).

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v3/config/environment` — Upload environment variables

---

### Object Type Commands

#### `eai types validate`
Validate Object Type definitions against platform schema rules.

**What it does**:
1. Reads `src/eai.config/object-types.ts`
2. Validates schemas locally
3. Reports validation errors

**No API calls** — local validation only

---

#### `eai types seed`
Push Object Types to platform and verify convergence.

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Reads `src/eai.config/object-types.ts`
2. Validates schemas locally
3. Posts types to platform (batch)
4. Fetches remote state to verify convergence

**Platform API Endpoints Used**:
- `POST /v3/object-types/batch` — Publish types
- `GET /v3/object-types` — Verify remote state

---

#### `eai types diff`
Compare local definitions with remote state.

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v3/object-types` — Fetch remote types

---

#### `eai types pull`
Download remote types to local TypeScript.

**Options**:
- `--output <path>` — Output file path (default: src/eai.config/object-types.ts)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v3/object-types` — Fetch remote types

---

### Resource Commands

#### `eai resources list <type>`
List resources of a specific Object Type.

**Arguments**:
- `<type>` — Object Type name

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--page <number>` — Page number (default: 1)
- `--limit <number>` — Items per page (default: 20, max: 100)
- `--sort <field>` — Sort field (prefix with `-` for descending)
- `--where[field][equals] <value>` — Filter by exact match
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v3/resources/{tenant_id}/{object_type}?page=1&limit=20&sort=...`

**Response Schema**:
```json
{
  "docs": [
    {
      "id": "uuid",
      "data": {},
      "version": 1,
      "created_at": "2026-05-23T12:00:00Z",
      "updated_at": "2026-05-23T12:00:00Z",
      "tenant": "tenant-id",
      "object_type": "ObjectTypeName"
    }
  ],
  "totalDocs": 100,
  "page": 1,
  "totalPages": 5,
  "limit": 20
}
```

---

#### `eai resources get <type> <id>`
Get a single resource.

**Arguments**:
- `<type>` — Object Type name
- `<id>` — Resource ID

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v3/resources/{tenant_id}/{object_type}/{id}`

---

#### `eai resources create <type>`
Create a resource.

**Arguments**:
- `<type>` — Object Type name

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--data <json>` — Resource data as JSON string
- `--file <path>` — Resource data from JSON file
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v3/resources/{tenant_id}/{object_type}`

**Request Body**:
```json
{
  "data": {
    "field1": "value1",
    "field2": 123
  }
}
```

---

#### `eai resources update <type> <id>`
Update a resource.

**Arguments**:
- `<type>` — Object Type name
- `<id>` — Resource ID

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--data <json>` — Resource data as JSON string
- `--file <path>` — Resource data from JSON file
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Fetches current resource to get version
2. Merges updates with existing data
3. Posts update with version for optimistic locking

**Platform API Endpoints Used**:
- `GET /v3/resources/{tenant_id}/{object_type}/{id}` — Fetch current version
- `PUT /v3/resources/{tenant_id}/{object_type}/{id}` — Update resource

---

#### `eai resources delete <type> <id>`
Delete a resource.

**Arguments**:
- `<type>` — Object Type name
- `<id>` — Resource ID

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--yes` — Skip confirmation prompt
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `DELETE /v3/resources/{tenant_id}/{object_type}/{id}`

---

#### `eai resources query`
Cross-type query with filters.

**Options**:
- `--types <types>` — Comma-separated Object Type names
- `--where <filter>` — Filter expression
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v3/resources/query` — Cross-type query

---

#### `eai resources schema`
Show published Object Types for tenant.

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant)
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v3/object-types?tenant_id={tenant_id}`

---

### AI Workflow Commands

#### `eai chat send <message>`
Send a single chat message.

**Arguments**:
- `<message>` — Chat message text

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v3/ai/chat` — Send chat message

---

#### `eai chat stream <message>`
Stream a conversation (SSE).

**Arguments**:
- `<message>` — Chat message text

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v3/ai/chat/stream` — Stream chat response

---

#### `eai workflow readiness [keys...]`
Check tenant access, plan metadata, and workflow readiness together.

**Arguments**:
- `[keys...]` — Workflow keys to check (optional)

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v3/ai/workflows/readiness?keys=...` — Check workflow readiness

---

#### `eai workflow status <key>`
Check whether an AI runtime workflow key is bound for the active tenant.

**Arguments**:
- `<key>` — Workflow key

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `GET /v3/ai/workflows/{key}/status` — Check workflow status

**Possible Statuses**:
- `available` — Workflow is ready to use
- `operator_required` — Manual operator binding needed
- `paid_upgrade_required` — Requires paid tier
- `rate_limited` — Rate limit exceeded
- `blocked` — Blocked for policy reasons
- `unsupported` — Not supported in this environment

---

#### `eai workflow request <key>`
Request operator-assisted workflow binding.

**Arguments**:
- `<key>` — Workflow key

**Options**:
- `--reason <reason>` — Reason for request
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v3/ai/workflows/{key}/request` — Request workflow binding

---

### Document Commands

#### `eai docs upload <file>`
Upload a document.

**Arguments**:
- `<file>` — File path

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v3/documents/upload` — Upload document (multipart/form-data)

---

#### `eai docs classify <file>`
Classify a document.

**Arguments**:
- `<file>` — File path

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v3/documents/classify` — Classify document

---

#### `eai docs index <id>`
Index a document for RAG.

**Arguments**:
- `<id>` — Document ID

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v3/documents/{id}/index` — Index document

---

### Deployment Commands

#### `eai deploy setup`
Generate deploy-demo.yml and GitHub secrets.

**Options**:
- `--repo <owner/name>` — GitHub repository (e.g., org/repo)
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Generates `.github/workflows/deploy-demo.yml`
2. Lists required GitHub secrets
3. Provides setup instructions

**No API calls** — generates local files only

---

#### `eai deploy trigger`
Trigger deployment workflow.

**Options**:
- `--workflow <name>` — Workflow file name (default: deploy-demo.yml)
- `--ref <ref>` — Git ref to deploy (default: main)
- `--format <format>` — Output format (text|json, default: text)

**GitHub API Endpoints Used**:
- `POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches` — Trigger workflow

---

#### `eai deploy status`
Check deployment status.

**Options**:
- `--run-id <id>` — Workflow run ID (default: latest)
- `--format <format>` — Output format (text|json, default: text)

**GitHub API Endpoints Used**:
- `GET /repos/{owner}/{repo}/actions/runs` — Fetch workflow runs

---

### Diagnostics Commands

#### `eai verify`
Run platform connectivity checks.

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant, read-only)
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Checks authentication status
2. Validates platform API connectivity
3. Verifies tenant membership
4. Tests Object Types endpoint
5. Tests Resources endpoint

**Platform API Endpoints Used**:
- `GET /v3/health` — Platform health check
- `GET /v3/tenants/memberships` — Verify membership
- `GET /v3/object-types` — Test types endpoint
- `GET /v3/resources/schema` — Test resources endpoint

---

#### `eai verify calls`
Audit platform API contracts used by the CLI.

**Options**:
- `--tenant-id <id>` — Target tenant (default: active tenant, read-only)
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Lists all API endpoints used by CLI
2. Tests each endpoint
3. Reports contract compatibility

---

#### `eai doctor`
Comprehensive diagnostics with fix suggestions.

**Options**:
- `--check-updates` — Check for CLI, Gofer, and template drift
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Runs all `verify` checks
2. Validates project structure
3. Checks dependencies
4. Checks for CLI updates
5. Checks for Gofer asset updates (if `--check-updates`)
6. Checks for template drift (if `--check-updates`)
7. Provides fix suggestions

---

### Maintenance Commands

#### `eai update`
Update the CLI to the latest version.

**Options**:
- `--check` — Check if update is available without installing
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Checks GitHub Releases API for latest version
2. Compares with installed version
3. Runs `npm install -g @eai-tools/cli@latest` (if update available)

**GitHub API Endpoints Used**:
- `GET /repos/{owner}/{repo}/releases/latest` — Check latest version

---

#### `eai gofer refresh`
Safely refresh Gofer-managed assets.

**Options**:
- `--check` — Preview changes without applying
- `--force` — Overwrite locally modified files (creates backups)
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Reads `.eai-manifest.json`
2. Compares installed Gofer assets with CLI bundle
3. Detects locally modified files (via hash comparison)
4. Updates safe files, backs up modified files
5. Updates manifest

**No API calls** — local operation only

---

#### `eai template check`
Preview vertical-template and UI drift.

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Compares local project with CLI-bundled template
2. Identifies new files in template
3. Identifies changed files (requires manual review)
4. Lists UI component drift

**No API calls** — local operation only

---

### Block Catalog Commands

#### `eai blocks list`
List available UI blocks.

**Options**:
- `--category <category>` — Filter by category (foundation|product|addon|demo)
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Reads block catalog from project or CLI bundle
2. Parses block metadata
3. Lists blocks with descriptions

**No API calls** — local operation only

---

#### `eai blocks validate`
Validate block catalog schema.

**Options**:
- `--format <format>` — Output format (text|json, default: text)

**What it does**:
1. Reads block catalog
2. Validates against schema
3. Reports validation errors

**No API calls** — local operation only

---

### Vertical Commands

#### `eai vertical create <name>`
Create a new vertical instance.

**Arguments**:
- `<name>` — Vertical display name

**Options**:
- `--template <name>` — Template variant
- `--format <format>` — Output format (text|json, default: text)

**Platform API Endpoints Used**:
- `POST /v3/verticals` — Create vertical

---

## Platform API Endpoints

### Authentication
- `POST /oauth2/v2.0/token` — Entra CIAM token exchange (external)

### Health
- `GET /v3/health` — Platform health check

### Tenants
- `GET /v3/tenants/memberships` — Fetch user's tenant memberships
- `GET /v3/tenants/{id}` — Get tenant details
- `POST /v3/tenants` — Create tenant
- `POST /v3/tenants/{id}/bootstrap-first-admin` — Bootstrap first admin

### Users
- `POST /v3/tenants/{tenant_id}/users/invite` — Invite user to tenant
- `POST /v3/tenants/{tenant_id}/users/provision` — Provision user

### Object Types
- `GET /v3/object-types` — List Object Types
- `POST /v3/object-types/batch` — Publish Object Types (batch)

### Resources
- `GET /v3/resources/{tenant_id}/{object_type}` — List resources
- `GET /v3/resources/{tenant_id}/{object_type}/{id}` — Get resource
- `POST /v3/resources/{tenant_id}/{object_type}` — Create resource
- `PUT /v3/resources/{tenant_id}/{object_type}/{id}` — Update resource
- `DELETE /v3/resources/{tenant_id}/{object_type}/{id}` — Delete resource
- `POST /v3/resources/query` — Cross-type query
- `GET /v3/resources/schema` — Get schema for tenant

### AI Workflows
- `POST /v3/ai/chat` — Send chat message
- `POST /v3/ai/chat/stream` — Stream chat response
- `GET /v3/ai/workflows/readiness` — Check workflow readiness
- `GET /v3/ai/workflows/{key}/status` — Check workflow status
- `POST /v3/ai/workflows/{key}/request` — Request workflow binding

### Documents
- `POST /v3/documents/upload` — Upload document
- `POST /v3/documents/classify` — Classify document
- `POST /v3/documents/{id}/index` — Index document for RAG

### Configuration
- `GET /v3/config/environment` — Fetch environment variables
- `GET /v3/config/secrets` — Fetch secrets
- `POST /v3/config/environment` — Upload environment variables

### Verticals
- `POST /v3/verticals` — Create vertical

### AdminAPI
- `POST /admin/entra/provision` — Provision Entra app registration

## Global Flags

All commands support these global flags:

| Flag | Type | Description |
|------|------|-------------|
| `--format <format>` | string | Output format: `text` (default), `json`, or `yaml` |
| `--simple` | boolean | Plain text output without colors or symbols (for screen readers) |
| `--no-color` | boolean | Disable colored output |
| `--color` | boolean | Force colored output (for testing) |
| `--profile <name>` | string | Use a named environment profile (e.g., dev, test) |
| `--describe` | boolean | Output JSON schema of command structure (for AI agents) |

## Error Codes

The CLI uses structured error codes for consistent error handling:

| Range | Category | Examples |
|-------|----------|----------|
| E001-E099 | Project errors | Not in EAI project, config missing, invalid structure |
| E100-E199 | Auth errors | Not logged in, token expired, invalid credentials |
| E200-E299 | Platform errors | API unreachable, resource not found, service unavailable |
| E300-E399 | Validation errors | Invalid schema, missing field, type mismatch |

All errors include:
- Error code (e.g., `E101`)
- Error message (e.g., "Not logged in")
- Suggestion (e.g., "Run `eai login` to authenticate")
- Exit code (non-zero)

## Machine-Readable Output

Commands that return structured data support `--format json` for automation:

```bash
# Get JSON output
eai resources list User --format json

# Parse with jq
eai tenant list --format json | jq '.tenants[] | .slug'

# Use in scripts
if eai verify --format json | jq -e '.healthy' > /dev/null; then
  echo "Platform is healthy"
fi
```

The `--describe` flag outputs the CLI command structure as JSON Schema, enabling AI agents and automation tools to discover capabilities at runtime:

```bash
eai --describe        # Describe all commands
eai types --describe  # Describe types subcommands
```
