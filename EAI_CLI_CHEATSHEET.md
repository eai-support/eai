# eai CLI — Cheat Sheet

## Installation & Update

```bash
npm install -g eai-cli                 # Recommended install
npm install -g @enterpriseai/cli          # Canonical package
npm install -g @enterpriseai/cli --@enterpriseai:registry=https://eai-support.github.io/eai/registry/  # Static fallback
eai update                             # Update to latest
eai update --check                     # Check without installing
```

---

## Global Flags

| Flag | Description |
|------|-------------|
| `--simple` | Plain text output (no colours/symbols) |
| `--no-color` | Disable ANSI colour codes |
| `--describe` | Output full CLI structure as JSON (useful for AI tooling) |

---

## Common Workflows

### First-time setup

```bash
eai init my-app                        # Scaffold new vertical
cd my-app
eai login                              # Authenticate (browser PKCE flow)
eai env pull                           # Sync cloud config → .env.local
eai types validate                     # Check Object Types
eai types diff                         # Preview local vs published types
eai types seed                         # Push types to platform
eai resources schema                   # Verify published exact slugs
eai dev                                # Start dev server (port 3000)
```

### Daily development

```bash
eai whoami                             # Check auth + project context
eai verify                             # Quick connectivity check
eai doctor                             # Diagnose + get fix suggestions
eai types validate && eai types seed   # Update types on platform
eai dev --port 3001                    # Dev server on custom port
```

### Deploy

```bash
eai deploy setup --repo org/repo       # First-time: create workflow + secrets guide
eai deploy trigger                     # Trigger GitHub Actions
eai deploy trigger --branch staging    # Deploy a specific branch
eai deploy status                      # Last 5 deployment runs
```

---

## Auth

```bash
eai login                              # Login (browser sign-in)
eai logout                             # Clear stored tokens
eai whoami                             # Show current user + token expiry
```

---

## Environment Config

```bash
eai env pull                           # Pull cloud config → .env.local
eai env pull --include-secrets         # Also resolve Key Vault references
eai env list                           # Show current vars (secrets masked)
eai env list --show-secrets            # Show all secret values
eai env list --format json             # JSON output
eai env push                           # Push .env.local → Azure App Config
eai env push --key MY_VAR              # Push a single key
```

---

## Object Types

```bash
eai types validate                     # Validate local type definitions
eai types diff                         # Compare local vs remote types
eai types seed                         # Push types to platform
eai types seed --dry-run               # Preview without changes
eai types seed --tenant-key myTenant   # Seed a specific tenant
eai types pull --tenant-id <id>        # Download remote types as TypeScript
```

**Identifier rule:** keep the PascalCase model `name` and the exact lowercase
kebab-case stored `slug` as separate fields. Generated or persisted
`linkTypes[].targetObjectType`, runtime `target_type`, resource command
arguments, paths, and governed v4 fields use the exact stored slug. A
same-manifest model name is relationship shorthand only and must resolve
through its declared slug before publication. Historical stored slugs are
authoritative; never re-derive or rename them.

**Validation checks:** PascalCase names, explicit exact slugs, relationship
targets, valid statuses, property types, select options, link cardinality, and
action roles.

---

## Tenants

```bash
eai tenant list                        # List tenants
eai tenant info <id>                   # Show tenant details
eai tenant create \
  --name "My Tenant" \
  --slug my-tenant \
  --parent <parentId>                  # Create tenant
```

---

## Users

```bash
eai user invite --email user@co.com --tenant <id>   # Invite user to tenant
eai user provision-me --tenant <id>                 # Add yourself to tenant
```

---

## Resources (CRUD)

```bash
# Use exact published Object Type slugs, never PascalCase model names.
# List
eai resources list board-app-user                # List BoardAppUser resources
eai resources list board-app-user --limit 50     # Custom page size
eai resources list board-app-user --sort name    # Sort ascending by field
eai resources list board-app-user --sort -created_at  # Sort descending

# Get
eai resources get board-app-user <id>            # Fetch single resource

# Create
eai resources create board-app-user --data '{"name":"Alice"}'
eai resources create board-app-user --file user.json

# Update
eai resources update board-app-user <id> --data '{"name":"Bob"}'

# Delete
eai resources delete board-app-user <id>         # Prompts for confirmation
eai resources delete board-app-user <id> --force # Skip confirmation

# Query (cross-type)
eai resources query --types board-app-user,board-app-project --where '{"status":"active"}' --limit 10

# Schema
eai resources schema                   # Show published types for tenant
```

---

## Chat / AI Workflows

```bash
# Single message
eai chat send "Summarise this project" --workflow <id>

# Streaming (real-time SSE)
eai chat stream "Tell me about X" --workflow <id>

# Continue a conversation
eai chat send "Follow-up" --workflow <id> --conversation-id <conversationId>
```

---

## Documents

```bash
eai docs upload ./report.pdf           # Upload document
eai docs classify ./report.pdf         # Classify + confidence score
eai docs index <documentId>            # Index for RAG
```

---

## Health Checks

```bash
eai verify                             # Connectivity checks (non-destructive)
eai doctor                             # Full health check + fix suggestions
eai doctor --fix                       # Attempt auto-fix (where available)
```

**`verify` checks:** PublicAPI reachable, auth status, platform + data services.

**`doctor` checks:** .env.local exists, required vars, auth, Object Types,
deploy workflow, node_modules, platform SDK.

---

## JSON Output (Scripting / Automation)

Every command with data output supports `--format json`:

```bash
eai resources list board-app-user --format json | jq '.[].id'
eai tenant list --format json
eai types seed --format json
eai deploy status --format json
eai --describe                         # Full CLI schema as JSON
```

---

## init Options

```bash
eai init my-app                               # Interactive prompts
eai init my-app --skip-prompts                # Use all defaults
eai init my-app --from https://github.com/org/template.git  # Custom template
```

**Interactive prompts cover:** display name, description, tenant structure
(`single` / `dual` / `multi`), AI chat, document management, auth provider
(`ciam` / `b2b` / `dual`).

---

## dev Server Options

```bash
eai dev                                # Port 3000, Turbopack on
eai dev --port 3001                    # Custom port
eai dev --no-turbo                     # Disable Turbopack
eai dev --skip-checks                  # Skip pre-flight connectivity checks
```

---

## Quick Reference Card

| Goal | Command |
|------|---------|
| Login | `eai login` |
| Check auth | `eai whoami` |
| Sync config | `eai env pull` |
| Publish types | `eai types seed` |
| Start dev | `eai dev` |
| List resources | `eai resources list <object-type-slug>` |
| Health check | `eai verify` |
| Diagnose | `eai doctor` |
| Deploy | `eai deploy trigger` |
| Update CLI | `eai update` |
