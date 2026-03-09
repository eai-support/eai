# eai — Enterprise AI Platform CLI

Scaffold, seed, deploy, and manage vertical applications on the EAI platform.

Every command wraps platform API calls — developers work with **resources, types, tenants, and chat** using simple, intuitive commands.

## Install

Configure npm to use the EAI registry:

```bash
echo "@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry" >> ~/.npmrc
```

Then install globally:

```bash
npm install -g @eai-tools/cli
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
| `eai types seed` | Push Object Types to platform via PublicAPI |
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
eai types seed ─────────────────────→ Platform API → Type Registry
eai resources list ─────────────────→ Platform API → Data Service
eai chat stream ────────────────────→ Platform API → AI Service
eai docs classify ──────────────────→ Platform API → AI Service
eai deploy trigger ─────────────────→ GitHub Actions → Azure App Service
```

The CLI authenticates via device code flow, stores tokens locally in `~/.eai/`, and calls the platform API directly with a Bearer token. All platform internals are abstracted away.

## Development

```bash
git clone https://github.com/eai-tools/eai-cli.git
cd eai-cli
npm install
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm run typecheck    # Type check without emitting
npm run lint         # Run ESLint
```

## Releasing

Releases are managed with `release.sh`, which runs a full validation pipeline before publishing.

```bash
./release.sh <patch|minor|major> "Release message"
```

Examples:

```bash
./release.sh patch "Fix auth token refresh bug"
./release.sh minor "Add bulk resource import command"
./release.sh major "New config format, breaking changes to types CLI"
```

The script runs these checks before releasing:

1. Verifies you're on `main` with a clean working tree
2. Pulls latest and installs dependencies (`npm ci`)
3. Typecheck (`tsc --noEmit`)
4. Lint (`eslint`)
5. Build (`tsc`)
6. Smoke tests — `eai --version`, `eai --help`, all 12 command groups present
7. Docs site build
8. Registry generation (`npm pack` + `generate-registry.cjs`)
9. IP leak scan (ensures no internal terms in source)

If all checks pass, it:

- Bumps the version in `package.json`
- Commits (including registry files), creates an annotated git tag, and pushes
- Creates a GitHub release with your message

## Documentation

Full documentation: https://eai-tools.github.io/eai-cli/

93 pages covering getting started, guides, concepts, command reference, 50 industry scenarios, and examples in 7 languages.

## Roadmap

- [ ] `eai types define` — interactive Object Type builder
- [ ] `eai dev --offline` — local mock gateway for offline development
- [ ] `eai tunnel` — Cloudflare tunnel for webhook testing
- [x] Static npm registry on GitHub Pages (`npm install -g @eai-tools/cli`)
