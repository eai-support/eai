# eai — Enterprise AI Platform CLI

[![CI](https://github.com/eai-tools/eai/actions/workflows/ci.yml/badge.svg)](https://github.com/eai-tools/eai/actions/workflows/ci.yml)
[![CodeQL](https://github.com/eai-tools/eai/actions/workflows/codeql.yml/badge.svg)](https://github.com/eai-tools/eai/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/eai-tools/eai/badge)](https://securityscorecards.dev/viewer/?uri=github.com/eai-tools/eai)
[![Docs](https://github.com/eai-tools/eai/actions/workflows/docs.yml/badge.svg)](https://github.com/eai-tools/eai/actions/workflows/docs.yml)
[![License](https://img.shields.io/github/license/eai-tools/eai)](LICENSE)

Scaffold, seed, deploy, and manage vertical applications on the EAI platform.

Every command wraps platform API calls — developers work with **resources, types, tenants, and chat** using simple, intuitive commands.

## Public Repository

This repository is the public source for the EnterpriseAI CLI. The README is the
fast path for developers who want to install the tool, understand what it does,
and find the maintained documentation.

| Surface | URL | Purpose |
|---------|-----|---------|
| Source | https://github.com/eai-tools/eai | CLI source, issues, pull requests, and release tags |
| Documentation | https://eai-tools.github.io/eai/ | Docusaurus documentation, scenarios, and command reference |
| Static npm registry | https://eai-tools.github.io/eai/registry/ | GitHub Pages registry used by `npm install -g @eai-tools/cli` |
| Releases | https://github.com/eai-tools/eai/releases | Versioned GitHub releases and packaged tarballs |
| Security | [SECURITY.md](SECURITY.md) | Private vulnerability reporting and supported versions |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) | Public-safe contribution and release workflow |
| License | [Apache-2.0](LICENSE) | Open source license and patent grant |

Public-readiness rule for maintainers: everything committed here should be safe
for a public audience. Do not commit secrets, customer data, private tenant
details, local `.env` files, unpublished internal architecture notes, or
temporary build output.

Generated Gofer specs, memory files, logs, checkpoints, and local runtime state
are intentionally ignored. The committed `.specify` directory contains only the
reusable scripts and templates needed by `eai init` and `eai gofer refresh`.

## Install

Configure the scoped EAI registry once per user:

```bash
npm config set @eai-tools:registry https://eai-tools.github.io/eai/registry/ --location=user
```

Install or update the EnterpriseAI CLI:

```bash
npm install -g @eai-tools/cli
```

If you are validating the generated registry from a local checkout of this repo, install the tarball instead of the packument file:

```bash
npm install -g ./docs-site/static/registry/-/@eai-tools/cli-latest.tgz
```

`docs-site/static/registry/@eai-tools/cli` is the registry metadata file. It is not an installable package directory.

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
Claude commands and agents, Codex skills, Gemini commands, Copilot prompts and
CLI skills, and the `.specify` commands/scripts/templates/hooks required to run
the Gofer pipeline.
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
| `eai init [name]` | Interactive scaffold from the CLI-pinned public EAI vertical template with Gofer AI CLI assets |
| `eai dev` | Start local dev server with connectivity checks |

The bundled default template is versioned with the installed CLI. Use `--from`
to override it with a different repository or a local template path.

### Authentication

| Command | Description |
|---------|-------------|
| `eai login` | Authenticate with Entra CIAM (browser-based PKCE flow) |
| `eai logout` | Clear stored tokens |
| `eai whoami` | Show auth status and project context |
| `eai provision entra` | Create or confirm the vertical's Entra app registration in the CIAM for the active platform environment |
| `eai provision entra --rotate-secret` | Rotate the existing app registration secret and write the new value to `.env.local` |
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
| `eai workflow readiness [keys...]` | Check tenant access, plan metadata, and optional workflow readiness together |
| `eai workflow status <key>` | Check whether an AI runtime workflow key is bound for the active tenant |
| `eai workflow request <key>` | Request operator-assisted workflow binding when a workflow is not ready yet |
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
| `eai gofer refresh` | Safely refresh repo-local Gofer-managed assets with backups and conflict detection |
| `eai template check` | Preview vertical-template and UI drift without writing files |

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
eai workflow status ────────────────→ Platform API → AI runtime readiness
eai chat stream ────────────────────→ Platform API → AI Service
eai docs classify ──────────────────→ Platform API → AI Service
eai deploy trigger ─────────────────→ GitHub Actions → Azure App Service
```

The CLI authenticates via browser-based authorization code flow with PKCE, stores tokens locally in `~/.eai/`, persists the active working tenant from your tenant-admin memberships, and calls the platform API directly with a Bearer token. `.env.local` is still available for project runtime configuration, but tenant selection for CLI platform commands comes from `eai login` and `eai tenant select`.

Runtime workflow checks are intentionally public-safe. They tell you whether a workflow key is `available`, `operator_required`, `paid_upgrade_required`, `rate_limited`, `blocked`, `unsupported`, or not ready without exposing private platform topology. Use `eai workflow request <key>` when the platform reports `operator_required`.

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
| Codex CLI | `.agents/skills/` with a legacy `.system/skills/` mirror | Ask Codex to use the relevant Gofer skill |
| Gemini CLI | `.gemini/commands/gofer`, `.gemini/extension.json` | `/gofer:1_gofer_research` |
| GitHub Copilot | `.github/prompts`, `.github/instructions`, `.github/skills` | Use the Gofer prompt or matching local skill |

The shared workflow artifacts live under `.specify/`: commands, scripts,
templates, hooks, memory, logs, and generated feature specs. Runtime state is
added to `.gitignore`; command definitions and templates are committed with the
vertical.

### Updating an existing repo safely

`eai update` updates the installed CLI package only. It does **not** blindly
rewrite Gofer assets, template files, or UI components inside an existing
vertical repo.

Use these commands instead:

```bash
# See whether a newer CLI release exists
eai update --check

# See whether this repo's Gofer-managed files differ from the installed CLI bundle
eai doctor --check-updates

# Preview safe Gofer-managed asset updates for the current repo
eai gofer refresh --check

# Preview vertical-template and UI component drift before copying changes manually
eai template check

# Apply only the safe Gofer-managed file updates, with backups for replaced files
eai gofer refresh
```

Important boundaries:

- `eai gofer refresh` manages the Gofer-owned surfaces copied by `eai init`
  such as `.specify/`, `.claude/`, `.agents/skills/`, `.gemini/`, and
  generated Copilot Gofer files.
- It writes or updates `.eai-manifest.json` so future refreshes can detect
  local edits and avoid overwriting them accidentally.
- If a tracked managed file has local edits, refresh leaves it untouched unless
  you explicitly pass `--force`, and even then it backs the file up first.
- `eai template check` previews file-level drift against the current vertical
  template snapshot and highlights which files are new versus which need manual
  review, including likely UI paths under `src/app` and `src/components`.
- Template or UI component changes are **not** auto-merged into existing repos
  yet. Copy additions first, then diff/review existing files that `eai template
  check` marks for manual review.

## Development

```bash
git clone https://github.com/eai-tools/eai.git
cd eai
npm install
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm run typecheck    # Type check without emitting
npm run lint         # Run ESLint
```

## Documentation and GitHub Pages

The documentation site lives in `docs-site/` and renders the source content from
`.tech-docs/`, the scenario library, and the generated command/API reference.
GitHub Pages is the public deployment target for both the documentation site and
the static npm registry used by the install flow.

The `Deploy Docs` workflow builds `docs-site/` on `main` when documentation,
release-doc, registry, or LLM-help assets change. It uploads `docs-site/build`
with the official GitHub Pages artifact action and deploys it to the
`github-pages` environment.

Pages serves these public artifacts:

- `/docs/` and `/scenarios/` — documentation and scenario library
- `/registry/` — static npm registry metadata and tarballs
- `/llms.txt`, `/llms-full.txt`, and `/cli-help.txt` — release-facing AI/help
  surfaces generated from the current CLI

## Releasing

Releases are managed with `release.sh`. It validates the release candidate locally, bumps the version, refreshes the release-facing docs/help surfaces, regenerates the static registry artifacts, pushes `main` plus the annotated tag, waits for GitHub Actions to create the GitHub release, waits for the docs deployment that updates the static registry, and then verifies the public static registry exposes the new version.

```bash
./release.sh <patch|minor|major> "Release message"
```

Examples:

```bash
./release.sh patch "Fix auth token refresh bug"
./release.sh minor "Add bulk resource import command"
./release.sh major "New config format, breaking changes to types CLI"
```

### Release prerequisites

- Run from a clean `main` checkout
- `gh` must be installed and authenticated

### What `release.sh` validates before tagging

The script runs `npm run release:check`, which covers the main `$6_gofer_validate` style release gates:

1. Verifies you're on `main` with a clean working tree
2. Pulls latest and installs dependencies (`npm ci`)
3. Typecheck (`tsc --noEmit`)
4. Lint (`eslint`)
5. Build (`tsc`)
6. Test (`vitest run`)
7. Smoke tests — `eai --version`, `eai --help`, and the shipped command groups
8. Docs site build
9. Release-facing docs/help generation (`llms.txt`, `llms-full.txt`, `cli-help.txt`)
10. Registry artifact generation (`npm pack` + `generate-registry.cjs`)
11. Static-registry release metadata stays aligned with the documented install flow

### What happens after the local checks pass

1. `release.sh` bumps the requested semver level
2. It updates the visible `.tech-docs/` release metadata to the new version and release message
3. It regenerates `docs-site/static/registry/`, `docs-site/static/llms.txt`, `docs-site/static/llms-full.txt`, and `docs-site/static/cli-help.txt`
4. It commits the release, creates an annotated `vX.Y.Z` tag, and pushes `main --follow-tags`
5. The tag-triggered GitHub Actions `Release` workflow verifies the committed release docs/help surfaces before creating the GitHub release and attaching the packaged tarball
6. The `Deploy Docs` workflow publishes the matching static registry and release-doc bundle to GitHub Pages
7. `release.sh` waits for both workflows and verifies `https://eai-tools.github.io/eai/registry/@eai-tools/cli`

If the static registry does not converge to the new version, the script exits non-zero so the release is treated as incomplete.

The release path publishes the repository exactly as committed. Bundled Gofer and linked-source refreshes happen separately via `npm run sync:gofer` / `npm run sync:linked-sources` and should be committed before you cut a release instead of being fetched during publish time.

Before making or keeping the repository public, run a public-readiness check:

```bash
npm run release:check
git grep -n -E "SECRET|TOKEN|PASSWORD|PRIVATE KEY|CLIENT_SECRET|API_KEY|connection string|AccountKey|Bearer "
```

GitHub secret scanning and push protection should also be enabled for the
repository so accidental credential commits are blocked or alerted before they
become a public incident.

Helpful maintainer commands:

```bash
npm run docs:release-assets
npm run docs:release-assets:check
```

### Release channel policy

- **GitHub Pages static registry is the release channel**
- Configure the registry once with `npm config set @eai-tools:registry https://eai-tools.github.io/eai/registry/ --location=user`
- Install or update with `npm install -g @eai-tools/cli`, or use `eai update`

## Documentation

Full documentation: https://eai-tools.github.io/eai/

93 pages covering getting started, guides, concepts, command reference, 50 industry scenarios, and examples in 7 languages.

## Roadmap

- [ ] `eai types define` — interactive Object Type builder
- [ ] `eai dev --offline` — local mock gateway for offline development
- [ ] `eai tunnel` — Cloudflare tunnel for webhook testing
- [x] Static npm registry on GitHub Pages (`npm install -g @eai-tools/cli`)
