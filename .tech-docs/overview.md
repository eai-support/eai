---
generated: "2026-03-11T17:36:00Z"
source_commit: "4d789698b3212952b667903d893918fc322fbc86"
---

# EAI CLI — Overview

## Service Identity

**Name**: `@eai-tools/cli` (eai)
**Version**: 0.1.4
**Purpose**: Enterprise AI Platform CLI for scaffolding, managing, and deploying vertical applications on the EAI platform.

## Description

The EAI CLI is a command-line tool that wraps the EAI Platform API, providing developers with simple commands to work with resources, object types, tenants, and AI workflows. It handles authentication via Entra CIAM device code flow, manages environment configuration, validates and seeds data models, and orchestrates deployments to Azure.

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

## Key Entry Points

| File | Purpose |
|------|---------|
| `src/index.ts` | Main CLI entry point; registers all commands |
| `src/commands/*.ts` | Individual command implementations (init, login, types, resources, etc.) |
| `src/lib/api.ts` | Platform API client with auth |
| `src/lib/auth.ts` | Entra CIAM authentication (device code flow) |
| `src/lib/config.ts` | Project config loader and TypeScript evaluator |
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
npm run build       # Compile TypeScript to dist/
npm run dev         # Watch mode (tsc --watch)
npm run typecheck   # Type check without emitting
npm run lint        # Run ESLint
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
```

## Team / Ownership

- **Project**: EAI Tools
- **Repository**: https://github.com/eai-tools/eai-cli
- **Homepage**: https://eai-tools.github.io/eai-cli
- **License**: MIT
- **Documentation**: 93-page documentation site covering getting started, guides, concepts, command reference, and 50 industry scenarios

## Core Workflows

1. **Scaffold & Initialize**: `eai init <name>` generates a new vertical app from a template
2. **Authenticate**: `eai login` performs device code flow and stores tokens locally
3. **Environment Sync**: `eai env pull` fetches config from Azure App Config + Key Vault
4. **Type Management**: `eai types validate`, `eai types seed`, `eai types diff` manage Object Types
5. **Resource CRUD**: `eai resources list/get/create/update/delete` interacts with platform data
6. **AI Workflows**: `eai chat send/stream` sends messages to AI workflows
7. **Deployment**: `eai deploy setup/trigger/status` orchestrates Azure deployments via GitHub Actions

## Architecture Philosophy

- **API-First**: Every command is a thin wrapper around platform API calls
- **Token Management**: Stores encrypted tokens in `~/.eai/tokens.json` with auto-refresh
- **Project Context**: Discovers project root by walking up to find `eai.config.ts` or `src/eai.config/`
- **TypeScript Evaluation**: Loads user-defined Object Types from TypeScript files by stripping types and evaluating as JS
- **Static Registry**: Self-hosted npm registry on GitHub Pages (no external npm publish required)

## Update Management

- Checks for updates in the background (24h cache)
- Displays update banner after command execution
- Users run `eai update` to upgrade to the latest version
- Update check is skipped in CI, when `NO_UPDATE_NOTIFIER=1`, or in non-TTY environments
