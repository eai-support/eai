---
generated: true
generated_at: "2026-05-17T17:49:18.918Z"
source_commit: "e2ebfae2a6f9d813ceecb56d6f0e6172a373778e"
---
# EAI CLI — Overview

## Executive Summary

| Property | Value |
|----------|-------|
| **Service Name** | `@eai-tools/cli` (eai) |
| **Version** | 2.8.13 |
| **Primary Capability** | Developer CLI for scaffolding, managing, and deploying vertical applications on the EAI Platform |
| **Primary Users** | Enterprise AI application developers and DevOps engineers |
| **Data Sensitivity** | Low (CLI tool; stores encrypted auth tokens locally in `~/.eai/`; no user data storage) |
| **Current Status** | Active development (v2.8.13 released 2026-05-12) |
| **Last Material Change** | v2.8.13: Add public platform builder workflow readiness and update guidance (2026-05-12) |

## Service Identity

**Name**: `@eai-tools/cli` (eai)  
**Version**: 2.8.13  
**Purpose**: Command-line interface for the Enterprise AI Platform that wraps all platform API calls, providing developers with simple commands to scaffold projects, authenticate users, manage data models, perform CRUD operations, and deploy applications to Azure.

## Description

The EAI CLI is a TypeScript-based command-line tool that serves as the primary developer interface to the EAI Platform. It abstracts away platform complexity by providing intuitive commands for:

- **Project scaffolding** with Gofer AI integration (Claude, Codex, Gemini, Copilot)
- **Authentication** via Entra CIAM browser-based PKCE flow
- **Tenant management** driven by membership context
- **Object Type management** (validate, seed, diff, pull)
- **Resource CRUD operations** with multi-tenant support
- **AI workflows** (chat streaming, document classification, RAG indexing)
- **Environment synchronization** with Azure App Config and Key Vault
- **Deployment orchestration** to Azure App Service via GitHub Actions

The CLI authenticates once with `eai login`, stores tokens in `~/.eai/tokens.json`, and uses tenant membership from the platform to establish working context via `eai tenant select`. Every command is a thin, typed wrapper around platform API endpoints with structured error codes (E001-E399) and machine-readable output formats (JSON, YAML, text).

## Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Language** | TypeScript (strict mode) | 5.7.3 |
| **Runtime** | Node.js | ≥20.0.0 |
| **CLI Framework** | Commander.js | 13.1.0 |
| **HTTP Client** | Native Fetch API | Built-in (Node.js) |
| **Module System** | ESM (ES Modules) | Node16 resolution |
| **UI/Output** | Chalk, Ora, Inquirer | 5.3.0, 8.1.1, 12.3.2 |
| **Config Loader** | dotenv | 16.4.7 |
| **Build Tool** | TypeScript Compiler (tsc) | 5.7.3 |
| **Package Manager** | npm | Standard |
| **Testing** | Vitest + MSW | 4.1.3, 2.6.0 |
| **Linter** | ESLint 10 + typescript-eslint | 10.0.3, 8.56.1 |

## Key Entry Points

| File | Purpose |
|------|---------|
| `src/index.ts` | Main CLI entry point; registers 19 command modules and global hooks |
| `src/commands/*.ts` | 19 command files: init, dev, login, whoami, user, provision, env, types, resources, tenant, vertical, chat, docs, deploy, verify, update, gofer, template, workflow |
| `src/lib/api.ts` | Platform API client with Bearer token auth and error handling |
| `src/lib/auth.ts` | Entra CIAM authentication (browser PKCE flow) and token storage |
| `src/lib/tenant-context.ts` | Tenant membership lookup and active tenant selection logic |
| `src/lib/profile.ts` | Environment profile management (dev, test, production) |
| `src/lib/config.ts` | Project config loader (dotenv + TypeScript evaluation) |
| `src/lib/context.ts` | Centralized context resolution (project root, profile, auth, tenant) |
| `src/lib/error-codes.ts` | Structured error catalog (E001-E399) with suggestions |
| `src/lib/output.ts` | Output utilities (colored symbols, TTY detection, simple mode) |
| `src/lib/schema-builder.ts` | CLI introspection for `--describe` flag (AI agent support) |
| `src/lib/update-check.ts` | Auto-update checker using the static EAI registry packument |
| `src/lib/cloud-env.ts` | Azure App Config and Key Vault integration |
| `src/lib/azure-cli.ts` | Azure CLI wrapper for cloud operations |
| `src/lib/gofer-installer.ts` | Gofer AI terminal assets installer |
| `src/lib/gofer-refresh.ts` | Gofer manifest planning and apply logic |
| `src/lib/project-manifest.ts` | Project manifest persistence |
| `src/lib/npm.ts` | NPM registry and package management utilities |
| `src/lib/object-type-defaults.ts` | Object Type scaffolding defaults |
| `src/lib/utils.ts` | Shared utility functions |
| `dist/index.js` | Compiled entry point (bin: `eai`) |

## How to Run Locally

### Installation (Development)

```bash
git clone https://github.com/eai-tools/eai-cli.git
cd eai-cli
npm install
npm run build
```

### Build Commands

```bash
npm run build             # Compile TypeScript → dist/
npm run dev               # Watch mode (tsc --watch)
npm run typecheck         # Type check without emitting
npm run lint              # Run ESLint
npm test                  # Run Vitest tests
npm run test:e2e-local    # E2E dedicated tenant lifecycle tests
npm run test:coverage     # Generate coverage report
```

### Running the CLI Locally

```bash
# After building
node dist/index.js --help

# Or link globally for testing
npm link
eai --help
```

### Testing Commands

```bash
# Scaffold a new vertical
node dist/index.js init test-vertical

# Authenticate with platform
node dist/index.js login

# Check auth status
node dist/index.js whoami

# List accessible tenants
node dist/index.js tenant list
```

## Team / Ownership

- **Organization**: EAI Tools
- **Repository**: [https://github.com/eai-tools/eai-cli](https://github.com/eai-tools/eai-cli)
- **Published Package**: `@eai-tools/cli`
- **Registry**: Self-hosted on GitHub Pages (`https://eai-tools.github.io/eai-cli/registry`)
- **Homepage**: [https://eai-tools.github.io/eai-cli](https://eai-tools.github.io/eai-cli)
- **License**: MIT
- **Documentation**: 93-page Docusaurus site with command reference, guides, and 50 industry scenarios

## Core Workflows

1. **Scaffold & Initialize**  
   `eai init <name>` — Generates new vertical from template with Gofer AI assets for Claude/Codex/Gemini/Copilot

2. **Authenticate**  
   `eai login` — Launches browser-based PKCE flow, stores tokens in `~/.eai/tokens.json`

3. **Tenant Selection**  
   `eai tenant select` — Chooses active tenant from user's `tenant-admin` memberships

4. **Entra Provisioning**  
   `eai provision entra` — Creates/confirms Entra app registration in CIAM for end-user authentication

5. **Environment Sync**  
   `eai env pull --include-secrets` — Fetches config from Azure App Config + Key Vault → `.env.local`

6. **Type Management**  
   `eai types validate` → `eai types seed` — Validates local Object Types against platform rules, then pushes to platform

7. **Resource CRUD**  
   `eai resources list/get/create/update/delete <type>` — Interacts with platform data via PublicAPI

8. **User Management**  
   `eai user invite --email <email>` — Adds users to tenants  
   `eai user provision-me` — Self-provision to active tenant

9. **AI Workflows**  
   `eai chat send/stream <message>` — Sends messages to AI workflows  
   `eai docs classify/index <file>` — Document processing and RAG indexing

10. **Deployment**  
    `eai deploy setup` → `eai deploy trigger` — Orchestrates Azure deployments via GitHub Actions

## Architecture Philosophy

- **API-First**: Every command is a thin wrapper around platform API v3 endpoints
- **Token Management**: Stores encrypted tokens locally with auto-refresh
- **Membership-Driven Context**: Active tenant comes from login memberships, not `.env.local`
- **Profile-Based Environments**: `--profile dev|test|prod` switches platform environments
- **Project Context Discovery**: Walks up directory tree to find `eai.config.ts` or `src/eai.config/`
- **TypeScript Evaluation**: Loads user-defined Object Types from TS files by stripping types and evaluating as JS
- **Static Registry**: Self-hosted npm registry on GitHub Pages (no external npm publish)
- **Structured Errors**: E001-E399 catalog with actionable suggestions
- **Machine-Readable Output**: `--format json|yaml|text` for automation; `--describe` for AI agents

## Critical Integrations

| Integration | Purpose | Direction | Auth Method |
|-------------|---------|-----------|-------------|
| **Entra CIAM** | User authentication via browser PKCE flow | Outbound | OAuth 2.0 Authorization Code + PKCE |
| **EAI Platform API (v3)** | Resource CRUD, type management, AI workflows | Outbound | Bearer token (JWT) |
| **Azure App Config** | Environment configuration sync | Outbound | Managed Identity / Service Principal |
| **Azure Key Vault** | Secrets retrieval | Outbound | Managed Identity / Service Principal |
| **GitHub Actions** | CI/CD deployment orchestration | Triggered by CLI | GitHub token |
| **Azure App Service** | Deployment target for vertical apps | Outbound (via GH Actions) | Service Principal |
| **AdminAPI** | Entra provisioning, tenant bootstrap | Outbound | Bearer token (JWT) |
| **ResourceAPI (MID)** | Multi-tenant resource queries | Outbound | Bearer token (JWT) |

## Recent Enhancements

### v2.8.13 (2026-05-12)
- **Add public platform builder workflow readiness and update guidance**

### v2.8.12 (2026-05-11)
- **Fix docs workflow Node 24 artifact action**

### v2.8.11 (2026-05-11)
- **Add tenant app registration persistence spec**

### v2.8.10 (2026-05-11)
- **Fix legacy template provenance detection**

### v2.8.9 (2026-05-11)
- **Highlight update workflows in CLI help**

### v2.8.8 (2026-05-11)
- **Add template drift preview and move workflows onto Node 24**

### v2.8.7 (2026-05-11)
- **Make release-facing docs generation deterministic**

### v2.8.6 (2026-05-11)
- **Refresh release docs and CLI help automation**

### v2.8.5 (2026-05-11)
- **Align release docs and CLI help automation with the static registry flow**

### v2.8.3 (2026-05-08)
- **Storage Metadata Status Fix** (PR #35): Fixed Object Type scaffolding to properly initialize `metadata.status` field for storage compliance

### v2.8.2 (2026-05-06)
- **Object Type Storage Metadata** (PR #34): Aligned Object Type scaffolding with platform storage metadata rules

### v2.8.1 (2026-05-05)
- **Production Tenant Lookup Fix** (PR #33): Fixed tenant lookup after CLI login in production environments

### v2.8.0 (2026-05-03)
- **Vertical Enrollment Management** (PR #31): Added tenant vertical enrollment commands
- **Entra Provisioning Warnings** (PR #32): Warn and exit non-zero when AdminAPI reports `signin_ready=false`

## Update Management

- **Background Checks**: Queries the static EAI registry packument every 24 hours (cached in `~/.eai/update-check.json`)
- **Update Banner**: Displays notification after command execution if newer version available
- **Manual Upgrade**: Users run `eai update` or `npm install -g @eai-tools/cli` after configuring the scoped EAI registry
- **Skip Conditions**: Update check skipped in CI, when `NO_UPDATE_NOTIFIER=1`, or in non-TTY environments

## Gofer AI Terminal Integration

Every `eai init` project includes Gofer AI assets for multi-terminal support:

| CLI | Installed Surface | First Command |
|-----|-------------------|---------------|
| **Claude CLI** | `.claude/commands`, `.claude/agents`, `.claude/settings.json` | `/0_business_scenario` |
| **Codex CLI** | `.system/skills/gofer`, `.agents/skills/gofer` | `$gofer/1_gofer_research` |
| **Gemini CLI** | `.gemini/commands/gofer`, `.gemini/extension.json` | `/gofer:1_gofer_research` |
| **GitHub Copilot** | `.github/prompts`, `.github/instructions`, `.github/skills` | Use Gofer prompt or skill |

**Shared Workflow**: `.specify/` directory contains commands, scripts, templates, hooks, memory, logs, and generated feature specs. Use `eai init <name> --no-gofer` to skip Gofer installation.

## Documentation Surfaces

This repository maintains multiple documentation surfaces:

| Path | Purpose | Publishing Workflow | Nightly Managed |
|------|---------|---------------------|-----------------|
| `.tech-docs/` | Canonical generated technical snapshot (this document) | Central tech-docs nightly pipeline | **Yes** |
| `docs-site/` | Docusaurus documentation site (93 pages) | GitHub Actions (`docs.yml`) → GitHub Pages | No |
| Root `*.md` files | Developer guides (README, CODEBASE, AGENTS, CLAUDE) | Committed to repo, no build step | No |

The `docs-site/` directory contains a Docusaurus 3.6.3 site that builds to static HTML and deploys to GitHub Pages at [https://eai-tools.github.io/eai-cli](https://eai-tools.github.io/eai-cli). It is **not** managed by the nightly tech-docs pipeline.

## Current Status

- **Version**: 2.8.13 (released 2026-05-12)
- **Build Status**: Passing (CI workflow validates TypeCheck, Lint, Build, Tests)
- **Documentation**: Up-to-date (last generated 2026-05-17T17:47:56Z)
- **Source Commit**: `e2ebfae2a6f9d813ceecb56d6f0e6172a373778e`
- **Registry Status**: Published to GitHub Pages registry
