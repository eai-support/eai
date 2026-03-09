# eai — Enterprise AI Platform CLI

Scaffold, seed, deploy, and manage vertical applications on the EAI platform.

Every command wraps PublicAPI calls — developers never need to know about OBO tokens, OPA policies, single-table JSONB, or the orchestrator. They see **resources, types, tenants, and chat**.

## Install

```bash
npm install -g @eai-tools/cli
```

Or run from source:

```bash
git clone https://github.com/eai-tools/eai-cli.git
cd eai-cli
npm install
npm run build
npm link
```

## Quick Start

```bash
# 1. Create a new vertical
eai init my-vertical
cd my-vertical
npm install

# 2. Authenticate
eai login

# 3. Sync environment from cloud
eai env pull --include-secrets

# 4. Define your data model
#    Edit src/eai.config/object-types.ts

# 5. Validate and seed
eai types validate
eai types seed

# 6. Start developing
eai dev
```

## Commands

### Scaffolding

| Command | Description |
|---------|-------------|
| `eai init [name]` | Interactive scaffold from Vertical-Template |
| `eai dev` | Start local dev server with connectivity checks |

### Authentication

| Command | Description |
|---------|-------------|
| `eai login` | Authenticate with Entra CIAM (device code flow) |
| `eai logout` | Clear stored tokens |
| `eai whoami` | Show auth status and project context |

### Environment

| Command | Description |
|---------|-------------|
| `eai env pull` | Sync Azure App Config + Key Vault → `.env.local` |
| `eai env list` | Show current environment variables |
| `eai env push` | Push local overrides to cloud (admin) |

### Object Types

| Command | Description |
|---------|-------------|
| `eai types validate` | Check types against platform schema rules |
| `eai types seed` | Push Object Types to Configurator via PublicAPI |
| `eai types diff` | Compare local definitions with remote state |
| `eai types pull` | Download remote types to local TypeScript |

### Resources

| Command | Description |
|---------|-------------|
| `eai resources list <type>` | List resources (paginated) |
| `eai resources get <type> <id>` | Get a single resource |
| `eai resources create <type>` | Create with `--data` JSON or `--file` |
| `eai resources update <type> <id>` | Update (auto-fetches version) |
| `eai resources delete <type> <id>` | Delete (with confirmation) |
| `eai resources query` | Cross-type query with `--types` and `--where` |
| `eai resources schema` | Show published Object Types for tenant |

### Tenants

| Command | Description |
|---------|-------------|
| `eai tenant list` | List tenants (scoped to parent) |
| `eai tenant info <id>` | Show tenant details |
| `eai tenant create` | Create a new tenant |

### AI & Documents

| Command | Description |
|---------|-------------|
| `eai chat send <message>` | Send a single chat message |
| `eai chat stream <message>` | Stream a conversation (SSE) |
| `eai docs upload <file>` | Upload a document |
| `eai docs classify <file>` | Classify a document |
| `eai docs index <id>` | Index a document for RAG |

### Deployment

| Command | Description |
|---------|-------------|
| `eai deploy setup` | Generate deploy-demo.yml + GitHub secrets |
| `eai deploy trigger` | Trigger deployment workflow |
| `eai deploy status` | Check deployment status |

### Diagnostics

| Command | Description |
|---------|-------------|
| `eai verify` | Run platform connectivity checks |
| `eai doctor` | Comprehensive diagnostics with fix suggestions |

## Architecture

```
Developer Terminal                    EAI Platform
──────────────────                    ────────────
eai login ──────────────────────────→ Entra CIAM (device code flow)
eai env pull ───────────────────────→ Azure App Config + Key Vault
eai types seed ─────────────────────→ PublicAPI /v3/orchestrate → Configurator
eai resources list ─────────────────→ PublicAPI /v3/resources → ResourceAPI
eai chat stream ────────────────────→ PublicAPI /v3/chat/stream → AICore
eai docs classify ──────────────────→ PublicAPI /v3/documents → AICore
eai deploy trigger ─────────────────→ GitHub Actions → Azure App Service
```

The CLI authenticates via device code flow, stores tokens locally in `~/.eai/`, and calls PublicAPI directly with a Bearer token. All platform internals (OBO exchanges, OPA policies, JSONB storage, orchestrator routing) are abstracted away.

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm run typecheck    # Type check without emitting
```

## Documentation

- [Research & Design](docs/research.md) — 10 developer scenarios, competitive analysis, CLI design principles, IP protection strategy

## Roadmap

- [ ] `eai types define` — interactive Object Type builder
- [ ] `eai dev --offline` — local mock gateway for offline development
- [ ] Developer portal (Docusaurus) with guides and API reference
- [ ] `eai tunnel` — Cloudflare tunnel for webhook testing
- [ ] npm publish to `@eai-tools/cli`
