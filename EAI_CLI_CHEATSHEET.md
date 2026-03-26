# eai CLI — Cheat Sheet

## Installation & Update

```bash
npm install -g @eai-tools/cli          # Install
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
eai login                              # Authenticate (device code flow)
eai env pull                           # Sync cloud config → .env.local
eai types validate                     # Check Object Types
eai types seed                         # Push types to platform
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
eai login                              # Login (device code)
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
eai types seed                         # Push types to platform
eai types seed --dry-run               # Preview without changes
eai types seed --tenant-key myTenant   # Seed a specific tenant
eai types diff                         # Compare local vs remote types
eai types pull --tenant-id <id>        # Download remote types as TypeScript
```

**Validation checks:** PascalCase names, valid statuses, property types, select
options, link cardinality, action roles.

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
# List
eai resources list User                # List resources of type User
eai resources list User --limit 50     # Custom page size
eai resources list User --sort name    # Sort ascending by field
eai resources list User --sort -created_at  # Sort descending

# Get
eai resources get User <id>            # Fetch single resource

# Create
eai resources create User --data '{"name":"Alice"}'
eai resources create User --file user.json

# Update
eai resources update User <id> --data '{"name":"Bob"}'

# Delete
eai resources delete User <id>         # Prompts for confirmation
eai resources delete User <id> --force # Skip confirmation

# Query (cross-type)
eai resources query --types User,Project --where '{"status":"active"}' --limit 10

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
eai chat send "Follow-up" --workflow <id> --conversation <convId>
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
eai resources list User --format json | jq '.[].id'
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
| List resources | `eai resources list <Type>` |
| Health check | `eai verify` |
| Diagnose | `eai doctor` |
| Deploy | `eai deploy trigger` |
| Update CLI | `eai update` |
