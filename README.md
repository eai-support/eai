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

If you are validating the generated registry from a local checkout of this repo, install the tarball instead of the packument file:

```bash
npm install -g ./docs/public/registry/-/@eai-tools/cli-latest.tgz
```

`docs/public/registry/@eai-tools/cli` is the registry metadata file. It is not an installable package directory.

## Quick Start

```bash
# 1. Create a new vertical
eai init my-vertical
cd my-vertical
npm install

# 2. Authenticate
eai login

# 3. Choose the tenant to work with
eai tenant select

# 4. Create child tenants only when you need them
#    `eai tenant create --parent <id>` now creates the tenant record,
#    attempts first-admin bootstrap for the current login, and only marks
#    the tenant usable after direct tenant-admin membership is confirmed.

# 5. Sync project environment if your app needs local config/secrets
eai env pull --include-secrets

# 6. Define your data model
#    Edit src/eai.config/object-types.ts

# 7. Validate and seed
eai types validate
eai types seed

# 8. Start developing
eai dev
```

`eai init` installs Gofer AI terminal assets by default. New vertical repos include
Claude commands and agents, Codex/Gemini skills, Copilot prompts and CLI skills,
and the `.specify` scripts/templates/hooks required to run the Gofer pipeline.
Use `eai init my-vertical --no-gofer` only when you need a bare scaffold.

## Global Flags

All commands support these global flags:

| Flag | Description |
|------|-------------|
| `--profile <name>` | Use a named environment profile (e.g. dev, test) |
| `--simple` | Plain text output without colors or symbols (for screen readers) |
| `--no-color` | Disable colored output |
| `--color` | Force colored output (for testing) |
| `--describe` | Output JSON schema of command structure (for AI agents) |
| `--format <format>` | Output format: `text` (default), `json`, or `yaml` |

## Commands

### Scaffolding

| Command | Description |
|---------|-------------|
| `eai init [name]` | Interactive scaffold from the public EAI vertical template with Gofer AI CLI assets |
| `eai dev` | Start local dev server with connectivity checks |

### Authentication

| Command | Description |
|---------|-------------|
| `eai login` | Authenticate with Entra CIAM (browser-based PKCE flow) |
| `eai logout` | Clear stored tokens |
| `eai whoami` | Show auth status and project context |
| `eai provision entra` | Create or confirm the vertical's Entra app registration in the CIAM for the active platform environment |
| `eai user invite --email <email>` | Add an existing user to the active tenant or an explicit tenant |
| `eai user provision-me` | Provision yourself to the active tenant or an explicit tenant |

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
| `eai types seed` | Push Object Types to platform and verify remote convergence |
| `eai types diff` | Compare local definitions with remote state |
| `eai types pull` | Download remote types to local TypeScript |

### Resources

| Command | Description |
|---------|-------------|
| `eai resources list <type>` | List resources (paginated, supports `--tenant-id`) |
| `eai resources get <type> <id>` | Get a single resource (supports `--tenant-id`) |
| `eai resources create <type>` | Create with `--data` JSON or `--file` |
| `eai resources update <type> <id>` | Update (auto-fetches version) |
| `eai resources delete <type> <id>` | Delete (with confirmation) |
| `eai resources query` | Cross-type query with `--types`, `--where`, and optional `--tenant-id` |
| `eai resources schema` | Show published Object Types for tenant (supports `--tenant-id`) |

### Tenants

| Command | Description |
|---------|-------------|
| `eai tenant list` | List active tenants where you are a `tenant-admin` |
| `eai tenant select [tenant]` | Choose the active tenant for platform operations |
| `eai tenant info <id>` | Show tenant details |
| `eai tenant create` | Create a new tenant and verify child usability truthfully |

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
| `eai verify` | Run platform connectivity checks (supports read-only `--tenant-id`) |
| `eai verify calls` | Audit platform API contracts used by the CLI (supports read-only `--tenant-id`) |
| `eai doctor` | Comprehensive diagnostics with fix suggestions |

## Tenant Lifecycle Truth

`eai tenant create` now distinguishes these states:

- `created`: the tenant document exists
- `bootstrapped`: the CLI successfully called the constrained first-admin bootstrap flow for a child tenant
- `usable`: a refreshed membership check confirmed the current login now holds direct `tenant-admin` on that tenant

For child tenants, the CLI only auto-selects the new tenant when `usable` is true. If bootstrap is blocked or downstream membership confirmation has not landed yet, the command leaves the active tenant unchanged and reports that explicitly.

The first-admin bootstrap path is intentionally narrow:

- the caller must already be `tenant-admin` on the direct parent tenant
- the target must be an immediate child of that parent
- the child must not already have a tenant admin
- parent child allowance is enforced from `limits.tenants`

## Architecture

```
Developer Terminal                    EAI Platform
──────────────────                    ────────────
eai login ──────────────────────────→ Entra CIAM (browser PKCE + localhost callback)
eai tenant select ──────────────────→ Current-user memberships → active tenant context
eai env pull ───────────────────────→ Azure App Config + Key Vault
eai types seed ─────────────────────→ Platform API → Type Registry
eai resources list ─────────────────→ Platform API → Data Service
eai chat stream ────────────────────→ Platform API → AI Service
eai docs classify ──────────────────→ Platform API → AI Service
eai deploy trigger ─────────────────→ GitHub Actions → Azure App Service
```

The CLI authenticates via browser-based authorization code flow with PKCE, stores tokens locally in `~/.eai/`, persists the active working tenant from your tenant-admin memberships, and calls the platform API directly with a Bearer token. `.env.local` is still available for project runtime configuration, but tenant selection for CLI platform commands comes from `eai login` and `eai tenant select`.

## Error Codes

The CLI uses structured error codes for consistent error handling:

- **E001-E099**: Project errors (not in EAI project, config missing)
- **E100-E199**: Auth errors (not logged in, token expired)
- **E200-E299**: Platform errors (API unreachable, resource not found)
- **E300-E399**: Validation errors (invalid schema, missing field)

Example error output:

```
✗ Not logged in

Run `eai login` to authenticate with the platform

Error code: E101
```

JSON format (for automation):

```json
{
  "error": {
    "code": "E101",
    "message": "Not logged in",
    "suggestion": "Run `eai login` to authenticate with the platform",
    "exitCode": 1
  }
}
```

## Machine-Readable Output

All commands that return structured data support `--format json` for automation:

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

## Gofer AI Terminal Assets

Every `eai init` project includes the repo-local Gofer assets needed by the AI
terminals used in this workspace:

| CLI | Installed surface | First command |
|-----|-------------------|---------------|
| Claude CLI | `.claude/commands`, `.claude/agents`, `.claude/settings.json` hooks | `/0_business_scenario` |
| Codex CLI | `.system/skills` and `.agents/skills` | `$0_business_scenario` |
| Gemini CLI | `.agents/skills` | `gemini skills list --all` |
| GitHub Copilot | `.github/prompts`, `.github/instructions`, `.github/skills` | Use the Gofer prompt or matching local skill |

The shared workflow artifacts live under `.specify/`: scripts, templates,
hooks, memory, logs, and generated feature specs. Runtime state is added to
`.gitignore`; command definitions and templates are committed with the vertical.

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
