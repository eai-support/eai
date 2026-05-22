---
generated: true
generated_at: "2026-05-22T18:14:18.901Z"
source_commit: "793141ab7e1e3af8073893f57a68009c7fd9900d"
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
| **Current Status** | Active development (v2.8.13 stable) |
| **Last Material Change** | Nightly automated documentation updates (2026-05-22) |

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
- **AI workflows** (chat streaming, document classification, RAG indexing, workflow readiness checks)
- **Environment synchronization** with Azure App Config and Key Vault
- **Deployment orchestration** to Azure App Service via GitHub Actions
- **AI-readable UI blocks** for vertical development with foundation, product, addon, and demo components

The CLI authenticates once with `eai login`, stores tokens in `~/.eai/tokens.json`, and uses tenant membership from the platform to establish working context via `eai tenant select`. Every command is a thin, typed wrapper around platform API endpoints with structured error codes (E001-E399) and machine-readable output formats (JSON, YAML, text).

## Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Language** | TypeScript (strict mode) | 5.9.3 |
| **Runtime** | Node.js | ≥20.0.0 |
| **CLI Framework** | Commander.js | 13.1.0 |
| **HTTP Client** | Native Fetch API | Built-in (Node.js) |
| **Module System** | ESM (ES Modules) | Node16 resolution |
| **UI/Output** | Chalk, Ora, Inquirer | 5.6.2, 8.2.0, 12.11.1 |
| **Config Loader** | dotenv | 16.6.1 |
| **Build Tool** | TypeScript Compiler (tsc) | 5.9.3 |
| **Package Manager** | npm | Standard |
| **Testing** | Vitest + MSW | 4.1.3, 2.12.10 |
| **Linter** | ESLint 10 + typescript-eslint | 10.0.3, 8.56.1 |

## Key Entry Points

| File | Purpose |
|------|---------|
| `src/index.ts` | Main CLI entry point; registers 20 command modules and global hooks |
| `src/commands/*.ts` | 20 command files: init, dev, login, whoami, user, provision, env, types, resources, tenant, vertical, blocks, chat, docs, deploy, verify, update, gofer, template, workflow |
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
| `src/lib/gofer-installer.ts` | Gofer AI terminal assets installer |
| `src/lib/gofer-refresh.ts` | Gofer manifest planning and apply logic |
| `src/lib/block-catalog.ts` | AI-readable UI block catalog loader and validator |
| `src/lib/project-manifest.ts` | Project manifest persistence |
| `dist/index.js` | Compiled entry point (bin: `eai`) |

## How to Run Locally

### Installation (Development)

```bash
git clone https://github.com/eai-tools/eai.git
cd eai
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
npm run release:check     # Release preflight validation
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

# List AI-readable UI blocks
node dist/index.js blocks list --readiness public-ready
```

## Team / Ownership

- **Organization**: EAI Tools
- **Repository**: [https://github.com/eai-tools/eai](https://github.com/eai-tools/eai)
- **Published Package**: `@eai-tools/cli`
- **Registry**: Self-hosted on GitHub Pages (`https://eai-tools.github.io/eai/registry`)
- **Homepage**: [https://eai-tools.github.io/eai](https://eai-tools.github.io/eai)
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
   `eai workflow readiness` — Checks tenant access, plan metadata, and AI runtime workflow readiness  
   `eai chat send/stream <message>` — Sends messages to AI workflows  
   `eai docs classify/index <file>` — Document processing and RAG indexing

10. **Deployment**  
    `eai deploy setup` → `eai deploy trigger` — Orchestrates Azure deployments via GitHub Actions

11. **UI Block Discovery**  
    `eai blocks list` — Lists AI-readable UI blocks from the shared platform block catalog  
    `eai blocks describe <id>` — Shows detailed block usage and examples

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
- **Gofer Pipeline Integration**: `.specify/` directory with full AI-assisted development workflow

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

## Documentation Surfaces

This repository maintains multiple documentation surfaces:

| Path | Purpose | Publishing Workflow | Nightly Managed |
|------|---------|---------------------|-----------------|
| `.tech-docs/` | Canonical generated technical snapshot (this document) | Central tech-docs nightly pipeline | **Yes** |
| `docs-site/` | Docusaurus documentation site (93 pages) | GitHub Actions (`docs.yml`) → GitHub Pages | No |
| Root `*.md` files | Developer guides (README, CODEBASE, AGENTS, CLAUDE) | Committed to repo, no build step | No |

The `docs-site/` directory contains a Docusaurus 3.6.3 site that builds to static HTML and deploys to GitHub Pages at [https://eai-tools.github.io/eai](https://github.com/eai-tools/eai). It is **not** managed by the nightly tech-docs pipeline.

## Current Status

- **Version**: 2.8.13 (stable)
- **Build Status**: Passing (CI workflow validates TypeCheck, Lint, Build, Tests)
- **Documentation**: Up-to-date (last generated 2026-05-22T18:12:28Z)
- **Source Commit**: `793141ab7e1e3af8073893f57a68009c7fd9900d`
- **Registry Status**: Published to GitHub Pages registry
- **Lines of Code**: ~15,600 TypeScript LOC (src/ directory)
