---
generated: true
generated_at: "2026-05-04T17:57:42Z"
source_commit: "1dc87b0302b65642cfa0a2f553c36679544eceb8"
---

# EAI CLI — Overview

## Executive Summary

| Property | Value |
|----------|-------|
| **Service Name** | `@eai-tools/cli` (eai) |
| **Version** | 2.7.0 |
| **Primary Capability** | CLI tool for scaffolding, managing, and deploying vertical applications on the EAI platform |
| **Primary Users** | Developers building enterprise AI vertical applications |
| **Data Sensitivity** | Low (CLI tool; handles encrypted tokens locally, no user data storage) |
| **Current Status** | Active development (latest: v2.7.0, 2026-05-04) |
| **Last Material Change** | v2.7.0: Entra provisioning now validates `signin_ready` state and warns when false (PR #32) |

## Service Identity

**Name**: `@eai-tools/cli` (eai)  
**Version**: 2.7.0  
**Purpose**: Enterprise AI Platform CLI for scaffolding, managing, and deploying vertical applications on the EAI platform.

## Description

The EAI CLI is a command-line tool that wraps the EAI Platform API, providing developers with simple commands to work with resources, object types, tenants, and AI workflows. It handles authentication via Entra CIAM browser-based PKCE flow, manages environment configuration, validates and seeds data models, and orchestrates deployments to Azure. The CLI authenticates once via `eai login`, stores tokens locally, and uses tenant membership to drive working context via `eai tenant select`.

## Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Language | TypeScript | 5.7.3 |
| Runtime | Node.js | ≥20.0.0 |
| CLI Framework | Commander.js | 13.1.0 |
| HTTP Client | Native Fetch API | Built-in |
| UI/Output | Chalk, Ora, Inquirer | 5.3.0, 8.1.1, 12.3.2 |
| Build Tool | TypeScript Compiler | 5.7.3 |
| Package Manager | npm | Standard |
| Module System | ESM (ES Modules) | Node16 |
| Testing | Vitest + MSW | 4.1.3, 2.6.0 |

## Key Entry Points

| File | Purpose |
|------|---------|
| `src/index.ts` | Main CLI entry point; registers all commands |
| `src/commands/*.ts` | 15 command files (init, dev, login, whoami, user, env, types, resources, tenant, chat, docs, deploy, verify, update, provision) |
| `src/lib/api.ts` | Platform API client with auth |
| `src/lib/auth.ts` | Entra CIAM authentication (browser PKCE flow) |
| `src/lib/tenant-context.ts` | Tenant membership and selection logic |
| `src/lib/config.ts` | Project config loader and TypeScript evaluator |
| `src/lib/error-codes.ts` | Structured error catalog (E001-E399) |
| `src/lib/profile.ts` | Profile management (dev, test, production) |
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
npm run build             # Compile TypeScript to dist/
npm run dev               # Watch mode (tsc --watch)
npm run typecheck         # Type check without emitting
npm run lint              # Run ESLint
npm test                  # Run Vitest tests
npm run test:e2e-local    # Local dedicated tenant lifecycle tests
npm run test:coverage     # Coverage report
```

### Running the CLI Locally

```bash
# After building
node dist/index.js --help

# Or link globally for testing
npm link
eai --help
```

### Testing a Command

```bash
# From within the project
node dist/index.js init test-vertical
node dist/index.js login
node dist/index.js whoami
node dist/index.js tenant list
```

## Team / Ownership

- **Project**: EAI Tools
- **Repository**: [https://github.com/eai-tools/eai-cli](https://github.com/eai-tools/eai-cli)
- **Homepage**: [https://eai-tools.github.io/eai-cli](https://eai-tools.github.io/eai-cli)
- **License**: MIT
- **Documentation**: 93-page documentation site covering getting started, guides, concepts, command reference, and 50 industry scenarios

## Core Workflows

1. **Scaffold & Initialize**: `eai init <name>` generates a new vertical app from a template with Gofer AI assets
2. **Authenticate**: `eai login` performs browser-based PKCE flow and stores tokens locally in `~/.eai/`
3. **Tenant Selection**: `eai tenant select` chooses active tenant from user's tenant-admin memberships
4. **Environment Sync**: `eai env pull` fetches config from Azure App Config + Key Vault
5. **Type Management**: `eai types validate`, `eai types seed`, `eai types diff` manage Object Types
6. **Resource CRUD**: `eai resources list/get/create/update/delete` interacts with platform data
7. **User Management**: `eai user invite`, `eai user provision-me` adds users to tenants
8. **AI Workflows**: `eai chat send/stream` sends messages to AI workflows; `eai docs classify/index` handles documents
9. **Entra Provisioning**: `eai provision entra` creates/confirms Entra app registration in CIAM
10. **Deployment**: `eai deploy setup/trigger/status` orchestrates Azure deployments via GitHub Actions

## Architecture Philosophy

- **API-First**: Every command is a thin wrapper around platform API calls
- **Token Management**: Stores encrypted tokens in `~/.eai/tokens.json` with auto-refresh
- **Membership-Driven Context**: Active tenant comes from login memberships, not `.env.local`
- **Profile-Based Environments**: `--profile dev|test|prod` switches between platform environments
- **Project Context**: Discovers project root by walking up to find `eai.config.ts` or `src/eai.config/`
- **TypeScript Evaluation**: Loads user-defined Object Types from TypeScript files by stripping types and evaluating as JS
- **Static Registry**: Self-hosted npm registry on GitHub Pages (no external npm publish required)
- **Structured Error Codes**: E001-E305 error catalog with suggestions

## Critical Integrations

| Integration | Purpose | Direction |
|-------------|---------|-----------|
| Entra CIAM | Authentication via browser-based PKCE flow | Outbound |
| EAI Platform API (v3) | Resource CRUD, type management, AI workflows | Outbound |
| Azure App Config | Environment configuration sync | Outbound |
| Azure Key Vault | Secrets management | Outbound |
| GitHub Actions | Deployment orchestration | Triggered |
| Azure App Service | Deployment target | Outbound |

## Recent Enhancements

### v2.7.0 (2026-05-04)

- **Entra Provisioning Validation** (PR #32): `eai provision entra` now checks `signin_ready` status from AdminAPI and warns + exits non-zero when false, preventing incomplete Entra app registrations from blocking authentication

### v2.6.0 (2026-05-02)

- **Tenant Context Fixes**: Fixed tenant context handling for CLI tenant operations (PR #29)
- **Local Tenant Lifecycle**: Added comprehensive local dedicated tenant lifecycle coverage with E2E tests
- **Child Tenant Bootstrap**: Improved first-admin bootstrap flow with usability verification
- **Membership Verification**: Enhanced membership confirmation before marking tenants as usable

## Update Management

- Checks for updates in the background (24h cache)
- Displays update banner after command execution
- Users run `eai update` to upgrade to the latest version
- Update check is skipped in CI, when `NO_UPDATE_NOTIFIER=1`, or in non-TTY environments

## Gofer AI Terminal Integration

Every `eai init` project includes Gofer AI assets for Claude, Codex, Gemini, and GitHub Copilot:

| CLI | Installed Surface | First Command |
|-----|-------------------|---------------|
| Claude CLI | `.claude/commands`, `.claude/agents`, `.claude/settings.json` hooks | `/0_business_scenario` |
| Codex CLI | `.system/skills/gofer`, `.agents/skills/gofer` | `$gofer/1_gofer_research` |
| Gemini CLI | `.gemini/commands/gofer`, `.gemini/extension.json` | `/gofer:1_gofer_research` |
| GitHub Copilot | `.github/prompts`, `.github/instructions`, `.github/skills` | Use Gofer prompt or local skill |

Shared workflow artifacts live under `.specify/` (commands, scripts, templates, hooks, memory, logs, specs). Use `eai init <name> --no-gofer` to skip Gofer installation.
