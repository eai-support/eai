# eai — Enterprise AI Platform CLI

[![CI](https://github.com/eai-tools/eai/actions/workflows/ci.yml/badge.svg)](https://github.com/eai-tools/eai/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/eai-tools/eai/badge)](https://securityscorecards.dev/viewer/?uri=github.com/eai-tools/eai)
[![Docs](https://github.com/eai-tools/eai/actions/workflows/docs.yml/badge.svg)](https://github.com/eai-tools/eai/actions/workflows/docs.yml)
[![License](https://img.shields.io/github/license/eai-tools/eai)](LICENSE)

Scaffold, seed, deploy, and manage applications on the EAI platform.

Every command wraps platform API calls — developers work with **resources, types, tenants, chat, and authorized PublicAPI V4 interfaces** using simple, intuitive commands.

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
# 1. Create a new app
eai init my-app
cd my-app
npm install

# 2. Authenticate
eai login

# 3. Choose the tenant to work with
eai tenant select

# 4. Create child tenants only when you need them
#    `eai tenant create --parent <id>` now creates the tenant record,
#    attempts first-admin bootstrap for the current login, and only marks
#    the tenant usable after direct tenant-admin membership is confirmed.
#    The child home region defaults to the parent region; pass
#    `--home-region au|ca|eu` when the child must use another region.

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

`eai init` installs Gofer AI terminal assets by default. New app repos include
Claude commands and agents, Codex skills, Gemini commands, Copilot prompts and
CLI skills, and the `.specify` commands/scripts/templates/hooks required to run
the Gofer pipeline.
Use `eai init my-app --no-gofer` only when you need a bare scaffold.

By default, `eai init my-app` creates a new `./my-app` folder. If you already
created and entered a project folder, run `eai init`, enter the app name, and
answer yes when asked to use the current folder. For automation, pass
`--current-dir` with the kebab-case app name. Current-folder init preserves
unrelated existing files and Git metadata, and updates files that are part of
the generated scaffold.

## Global Flags

All commands support these global flags:

| Flag | Description |
|------|-------------|
| `--profile <name>` | Use a locally configured private profile |
| `--simple` | Plain text output without colors or symbols (for screen readers) |
| `--no-color` | Disable colored output |
| `--color` | Force colored output (for testing) |
| `--describe` | Output JSON schema of command structure (for AI agents) |
| `--format <format>` | Output format: `text` (default), `json`, or `yaml` |

## Commands

### Scaffolding

| Command | Description |
|---------|-------------|
| `eai init [name]` | Interactive scaffold from the CLI-pinned public EAI application template with Gofer AI CLI assets |
| `eai dev` | Start local dev server with connectivity checks |

The bundled default template is pinned to the latest `eai-app-template` `main`
commit captured when this CLI release was cut. Use `--from` to override it with
a different repository or a local template path.

### Authentication

| Command | Description |
|---------|-------------|
| `eai login` | Authenticate with Entra CIAM (browser-based PKCE flow with localhost callback) |
| `eai logout` | Clear stored tokens |
| `eai whoami` | Show auth status and project context |
| `eai provision entra` | Create or confirm the app's Entra app registration in the CIAM for the active platform environment |
| `eai provision entra --rotate-secret` | Rotate the existing app registration secret and write the new value to `.env.local` |
| `eai provision entra --deauthorize --force` | Remove tenant authorization, delete the app registration, and remove local Entra credentials |
| `eai user invite --email <email>` | Add an existing user to the active tenant or an explicit tenant |
| `eai user provision-me` | Provision yourself to the active tenant or an explicit tenant |

Codespaces and other remote dev environments can keep the standard localhost
callback by forwarding a fixed callback port from the Codespace to your local
machine:

```bash
# Local machine, keep this running in a separate terminal
gh codespace ports forward -c <codespace-name> 3476:3476

# Codespace terminal
eai login --callback-port 3476
```

`eai login --callback-port <port>` still uses `http://localhost:<port>` for the
OAuth callback; it just pins the port instead of choosing a random one. That
keeps the public Entra app registration unchanged while allowing your local
machine to tunnel the callback into the Codespace.

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
| `eai tenant bootstrap-admin --parent <id> --child <id>` | Repair first child-tenant admin access when the parent admin should be able to administer an existing child |

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

### PublicAPI V4

| Command | Description |
|---------|-------------|
| `eai publicapi get <path>` | Call an authorized PublicAPI V4 GET route |
| `eai publicapi post <path>` | Call an authorized PublicAPI V4 POST route with optional `--data` or `--file` JSON |
| `eai publicapi patch <path>` | Call an authorized PublicAPI V4 PATCH route |
| `eai publicapi put <path>` | Call an authorized PublicAPI V4 PUT route |
| `eai publicapi delete <path>` | Call an authorized PublicAPI V4 DELETE route |

Use named commands first for normal workflows. `eai publicapi` is the advanced
V4-only surface for route families that do not yet have a polished command,
such as geo, realtime, platform administration, integrations, or DAISY-specific
diagnostics. It still uses your current login and tenant context, and PublicAPI
still enforces platform tenant authorization.

### Deployment

| Command | Description |
|---------|-------------|
| `eai runtime validate` | Validate the provider-neutral EAI app runtime contract |
| `eai deploy env --provider <provider>` | Translate the runtime contract into provider env/secret requirements |
| `eai deploy setup` | Generate deploy-demo.yml + GitHub secrets |
| `eai deploy trigger` | Trigger deployment workflow |
| `eai deploy status` | Check deployment status |
| `eai deploy doctor --url <deployed-url>` | Black-box check health, Auth.js, runtime config, smoke tests, and BFF readiness |

The runtime contract lives in `eai.runtime.json`. It declares required
environment variable names, required secrets, health/runtime endpoints, Auth.js
callback path, tenant/workflow key patterns, optional app-only service identity,
and post-deploy smoke tests. It is host-neutral: Vercel, Docker, AWS, Azure,
Kubernetes, VM-style hosts, and internal demo environments should translate the
same contract into their provider-specific env and secret setup.

`eai deploy doctor` deliberately does more than `/health`. A deployment can have
`/health` returning 200 and still fail because Auth.js providers are missing,
the Entra callback URL is wrong, tenant/workflow config is empty, service
identity is absent for anonymous server-side platform calls, PublicAPI rejects
authorization, or the app runtime is throwing errors.

### Diagnostics

| Command | Description |
|---------|-------------|
| `eai verify` | Run platform connectivity checks (supports read-only `--tenant-id`) |
| `eai verify calls` | Audit platform API contracts used by the CLI (supports read-only `--tenant-id`) |
| `eai doctor` | Comprehensive diagnostics with fix suggestions |
| `eai gofer refresh` | Safely refresh repo-local Gofer-managed assets with backups and conflict detection |
| `eai template check` | Preview app-template and UI drift without writing files |

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

For existing child tenants that were created before the bootstrap completed, a parent tenant admin can run:

```bash
eai tenant bootstrap-admin --parent <parent-tenant-id> --child <child-tenant-id>
```

By default this bootstraps the current login. To repair another known parent member, pass `--user-oid <entra-user-oid>` and optionally `--user-email <email>`.

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
eai runtime validate ────────────────→ eai.runtime.json → local contract evidence
eai deploy env ──────────────────────→ eai.runtime.json → provider env/secret checklist
eai deploy doctor ───────────────────→ deployed app URL → black-box runtime checks
eai deploy trigger ─────────────────→ GitHub Actions → deployment workflow
```

The CLI authenticates via browser-based authorization code flow with PKCE, stores tokens locally in `~/.eai/`, persists the active working tenant from your tenant-admin memberships, and calls the platform API directly with a Bearer token. `.env.local` is still available for project runtime configuration, but tenant selection for CLI platform commands comes from `eai login` and `eai tenant select`.

Runtime workflow checks are intentionally public-safe. They tell you whether a workflow key is `available`, `operator_required`, `paid_upgrade_required`, `rate_limited`, `blocked`, `unsupported`, or not ready without exposing private platform topology. Use `eai workflow request <key>` when the platform reports `operator_required`.

## Error Guidance

The CLI uses structured error guidance for consistent human and AI-agent recovery:

- **E001-E099**: Project errors (not in EAI project, config missing)
- **E100-E199**: Auth errors (not logged in, token expired)
- **E200-E299**: Platform errors (API unreachable, resource not found)
- **E300-E399**: Validation errors (invalid schema, missing field)

Error output explains why the error may have happened, what read-only diagnostics
to run first, what mutating `eai` commands can fix it, and when to stop retrying.

```
✗ Not logged in.

Why this might happen:
- The CLI does not have a usable local sign-in token.
- The token may have expired or been created for a different local profile.

Try next:
1. eai whoami [read-only]
   Show the current login and active tenant status.
2. eai login [changes state]
   Authenticate with the EAI identity flow.

Error code: E101
Reason: not_logged_in
```

JSON output keeps the legacy `suggestion` field and adds structured guidance for
AI agents:

```json
{
  "error": {
    "code": "E101",
    "message": "Not logged in",
    "suggestion": "Run `eai login` to authenticate with the platform",
    "guidance": {
      "reasonCode": "not_logged_in",
      "why": ["The CLI does not have a usable local sign-in token."],
      "diagnostics": [{ "command": "eai whoami", "mutates": false }],
      "fixes": [{ "command": "eai login", "mutates": true }]
    },
    "exitCode": 1
  }
}
```

Use `eai errors explain <code-or-reason>` for the release-aligned explanation:

```bash
eai errors explain E101
eai errors explain tenant_authorization_incomplete --format json
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
eai tenant list --format json | jq '.tenants[] | .slug'

# Use in scripts
if eai verify calls --format json | jq -e '.summary.failed == 0' > /dev/null; then
  echo "Platform contracts are healthy"
fi
```

The `--describe` flag outputs the CLI command structure as JSON Schema, enabling AI agents and automation tools to discover capabilities at runtime:

```bash
eai --describe        # Describe all commands
eai types --describe  # Describe types subcommands
```

For AI agents that need to use `eai` without extra instructions, start with the
built-in operating guide:

```bash
eai agent guide --format json
```

The same guide is embedded in `eai --describe` as `agentGuide`. It tells agents
to prefer structured output, run read-only diagnostics before fixes, call
`eai errors explain <code-or-reason> --format json` after failures, use named
commands before raw `publicapi` calls, and stop when retry or escalation
conditions match.

To test whether a weak agent can discover that behavior without EAI-specific
prompt instructions, run the built-in discovery eval:

```bash
npm run build
npm run eval:agent-discovery -- --json
```

The default `regex-small` agent is intentionally limited: it starts from generic
help/describe output, parses visible error codes or reason codes, and only runs
commands it discovers from the CLI output. Use `--agent-command <cmd>` to plug
in a real model runner that accepts the eval JSON turn on stdin and returns a
JSON decision.

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
app.

### Updating an existing repo safely

`eai update` keeps the local EAI toolchain current. It checks the installed CLI
against the public static registry, installs the newer CLI when available, then
refreshes safe Gofer-managed files in the current EAI project. It does **not**
blindly rewrite template files or UI components inside an existing app repo.

Use these commands for the full maintenance loop:

```bash
# See whether a newer CLI release, Gofer refresh, or template review is available
eai update --check

# Same report through the broader doctor command
eai doctor --check-updates

# Preview safe Gofer-managed asset updates for the current repo
eai gofer refresh --check

# Apply safe Gofer-managed file updates, with backups and conflict detection
eai gofer refresh

# Preview app-template and UI component drift before copying changes manually
eai template check
```

Important boundaries:

- `eai update --check` is read-only. `eai update` may write only
  Gofer-managed files in an EAI project.
- `eai gofer refresh` prefers the latest public `eai-gofer` release at runtime,
  so Gofer asset updates do not require a new `eai` CLI release. If the latest
  release cannot be reached or prepared, it falls back to the bundled snapshot.
- `eai gofer refresh` manages the Gofer-owned surfaces copied by `eai init`
  such as `.specify/`, `.claude/`, `.agents/skills/`, `.gemini/`, and
  generated Copilot Gofer files.
- It writes or updates `.eai-manifest.json` so future refreshes can detect
  local edits and avoid overwriting them accidentally.
- If a tracked managed file has local edits, refresh leaves it untouched unless
  you explicitly pass `--force`, and even then it backs the file up first.
- `eai template check` previews file-level drift against the app-template
  `main` snapshot pinned in the installed CLI release and highlights which
  files are new versus which need manual review, including likely UI paths under
  `src/app` and `src/components`.
- Template or UI component changes are **not** auto-merged into existing repos
  yet. Copy additions first, then diff/review existing files that `eai template
  check` marks for manual review.
- During normal interactive CLI use, if the CLI has already cached that a newer
  release is available, it can ask whether to run `eai update` immediately.
  That prompt is suppressed for CI, non-TTY, `--describe`, `--format json`, and
  `--json` output.

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
   - Focused SRP CLI evidence also runs as `npm run test:eai-cli:ci` in
     GitHub Actions check `ci/eai-cli-tests`
7. Smoke tests — `eai --version`, `eai --help`, and the shipped command groups
8. Docs site build
9. Release-facing docs/help generation (`llms.txt`, `llms-full.txt`, `cli-help.txt`)
10. Registry artifact generation (`npm pack` + `generate-registry.cjs`)
11. Static-registry release metadata stays aligned with the documented install flow
12. Full e2e smoke traceability stays aligned with `eai --describe`

### Optional live full e2e smoke

`release:check` always validates the full command/CRUD traceability table in
[`.tech-docs/full-e2e-smoke-traceability.md`](.tech-docs/full-e2e-smoke-traceability.md).
The destructive live suite is opt-in because it creates a disposable app,
publishes Object Types, provisions storage, and CRUDs PostgreSQL, DocumentDB,
Blob-backed file, and Search-indexed resources in a dedicated test tenant.

Use a dedicated test user and tenant. Do not paste the password into a chat or
commit it to the repo; store it in your shell only for the run, or in GitHub
Actions secrets.

```bash
export EAI_RELEASE_FULL_E2E_SMOKE=1
export EAI_E2E_TEST_PROFILE=test
export EAI_E2E_TEST_USERNAME='<dedicated-test-user-email>'
export EAI_E2E_PARENT_TENANT_ID='<dedicated-test-tenant-id>'

# Authenticate the profile before the run:
eai --profile "$EAI_E2E_TEST_PROFILE" login

# Or provide a secure bootstrap command that leaves whoami working:
export EAI_E2E_AUTH_COMMAND='<secure-auth-bootstrap-command>'

npm run smoke:eai-full:live
```

If an external bootstrap command needs a password, pass it through an
environment secret such as `EAI_E2E_TEST_PASSWORD`. The smoke runner redacts
password-like values from failures and does not print or persist the password.

### What happens after the local checks pass

1. `release.sh` bumps the requested semver level
2. It updates the visible `.tech-docs/` release metadata to the new version and release message
3. It regenerates `docs-site/static/registry/`, `docs-site/static/llms.txt`, `docs-site/static/llms-full.txt`, and `docs-site/static/cli-help.txt`
4. It commits the release, creates an annotated `vX.Y.Z` tag, and pushes `main --follow-tags`
5. The tag-triggered GitHub Actions `Release` workflow verifies the committed release docs/help surfaces before creating the GitHub release and attaching the packaged tarball
6. The `Deploy Docs` workflow publishes the matching static registry and release-doc bundle to GitHub Pages
7. `release.sh` waits for both workflows and verifies `https://eai-tools.github.io/eai/registry/@eai-tools/cli`

If the static registry does not converge to the new version, the script exits non-zero so the release is treated as incomplete.

The EAI CLI is also part of SRP release evidence. Repo-local CLI behavior is
owned here through `ci/eai-cli-tests`; deployed read-only CLI schema, error,
auth, and preview canaries live in `enterpriseaigroup/eai-testing-dev` under the
`eai-cli` cross-service surface. Keep prod CLI canaries read-only; preview
lifecycle checks must stay explicit and cleanup-backed.

The release path publishes the repository exactly as committed. Bundled Gofer and linked-source refreshes happen separately via `npm run sync:gofer` / `npm run sync:linked-sources` and should be committed before you cut a release. At runtime, `eai gofer refresh` still checks the public latest `eai-gofer` release and falls back to that bundled snapshot when offline.

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
