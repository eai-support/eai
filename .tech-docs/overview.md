---
generated: true
generated_at: "2026-05-30T07:39:49.032Z"
source_commit: "eb36f91b2b8bb0eb07acce4e966cda6a8df6f46d"
---
# EAI CLI — Overview

## Executive Summary

| Property | Value |
|----------|-------|
| **Service Name** | `@eai-tools/cli` (eai) |
| **Version** | 2.9.3 |
| **Primary Capability** | Developer CLI for scaffolding, managing, and deploying vertical applications on the EAI Platform |
| **Primary Users** | Enterprise AI application developers, DevOps engineers, and platform operators |
| **Data Sensitivity** | Low (CLI tool; stores encrypted auth tokens locally in `~/.eai/`; no persistent user data storage) |
| **Current Status** | Active development (v2.9.3 released 2026-05-30) |
| **Last Material Change** | v2.9.3: Bundle eai-gofer v3.5.0 (2026-05-30) |

## Service Identity

**Name**: `@eai-tools/cli` (eai)  
**Version**: 2.9.3  
**Purpose**: Command-line interface for the Enterprise AI Platform that wraps all platform API calls, providing developers with simple commands to scaffold projects, authenticate users, manage data models, perform CRUD operations, deploy to Azure, and integrate AI capabilities.

## Description

The EAI CLI is a TypeScript-based command-line tool that serves as the primary developer interface to the EAI Platform. It abstracts platform complexity by providing intuitive commands organized into functional groups:

- **Project Scaffolding**: Initialize new vertical applications with integrated Gofer AI terminal assets (Claude, Codex, Gemini, Copilot)
- **Authentication**: Browser-based PKCE flow via Entra CIAM with secure local token storage
- **Tenant Management**: Context-driven tenant selection based on user membership
- **Object Types**: Validate, seed, diff, and pull data model definitions
- **Resources**: Full CRUD operations with multi-tenant support and cross-type queries
- **AI Workflows**: Chat streaming, document classification, RAG indexing, and workflow readiness checks
- **Environment Sync**: Azure App Config and Key Vault integration
- **Deployment**: GitHub Actions orchestration to Azure App Service
- **Diagnostics**: Platform connectivity checks, health validation, and automated fix suggestions
- **Block Catalog**: AI-readable UI component catalog for vertical development with foundation, product, addon, and demo blocks

The CLI authenticates once with `eai login`, stores tokens in `~/.eai/tokens.json`, and uses platform membership to establish working context via `eai tenant select`. Every command is a thin, typed wrapper around platform API endpoints with structured error codes (E001-E399) and machine-readable output formats (JSON, YAML, text).

## Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Language** | TypeScript (strict mode) | 5.9.3 |
| **Runtime** | Node.js | ≥20.0.0 |
| **CLI Framework** | Commander.js | 13.1.0 |
| **HTTP Client** | Native Fetch API | Built-in (Node.js) |
| **Module System** | ESM (ES Modules) | Node16 resolution |
| **Testing** | Vitest | 4.1.3 |
| **Linting** | ESLint | 10.0.3 |
| **Package Manager** | npm | With scoped registry support |
| **Documentation** | Docusaurus | 3.9.2 |
| **Release Channel** | GitHub Pages Static Registry | N/A |

## Key Entry Points

### CLI Binary
- **Entry Point**: `dist/index.js`
- **Source**: `src/index.ts`
- **Description**: Commander.js program with global flags and command registration

### Command Modules
Located in `src/commands/`:
- `init.ts` - Project scaffolding from template
- `login.ts` - Entra CIAM authentication
- `tenant.ts` - Tenant context management
- `types.ts` - Object Type operations
- `resources.ts` - CRUD operations
- `chat.ts` - AI chat workflows
- `docs.ts` - Document operations
- `deploy.ts` - Deployment orchestration
- `verify.ts` - Platform diagnostics
- `gofer.ts` - AI asset refresh
- `template.ts` - Template drift checks
- `blocks.ts` - UI block catalog management

### Library Modules
Located in `src/lib/`:
- `api.ts` - Platform API client (fetch wrapper)
- `auth.ts` - Entra CIAM auth flow
- `config.ts` - Configuration loader (.env.local + eai.config.ts)
- `error-codes.ts` - Structured error system
- `output.ts` - TTY-aware output utilities
- `schema-builder.ts` - CLI introspection for AI agents
- `update-check.ts` - Version management
- `gofer-refresh.ts` - Gofer asset management
- `block-catalog.ts` - Block catalog parser
- `tenant-context.ts` - Tenant membership context

## How to Run Locally

### Installation
```bash
# Configure scoped registry (one-time setup)
npm config set @eai-tools:registry https://eai-tools.github.io/eai/registry/ --location=user

# Install globally
npm install -g @eai-tools/cli

# Verify installation
eai --version
```

### Development
```bash
# Clone repository
git clone https://github.com/eai-tools/eai.git
cd eai

# Install dependencies
npm install

# Build
npm run build

# Run from source
node dist/index.js --help

# Watch mode
npm run dev

# Run tests
npm test
```

### Basic Usage
```bash
# Create new project
eai init my-vertical
cd my-vertical
npm install

# Authenticate
eai login

# Select tenant
eai tenant select

# Pull environment
eai env pull --include-secrets

# Validate types
eai types validate

# Seed types
eai types seed

# Start dev server
eai dev
```

## Team/Ownership

**Team**: EAI Tools  
**Repository**: [https://github.com/eai-tools/eai](https://github.com/eai-tools/eai)  
**Documentation**: [https://eai-tools.github.io/eai](https://eai-tools.github.io/eai)  
**License**: MIT

As documented in `CLAUDE.md` and `AGENTS.md`:
- Workflow instructions follow plan-first, subagent-heavy, self-improving patterns
- Code style follows TypeScript strict mode with ESM, Commander.js patterns
- Release process managed via `./release.sh` with automated validation

## Critical Integrations

### Upstream Dependencies (Services Called)
1. **EAI Platform API** (`BASE_URL_PUBLIC_API`)
   - All resource operations (types, resources, tenants)
   - Authentication validation
   - AI workflow orchestration
   - Document processing

2. **Entra CIAM** (Microsoft Identity Platform)
   - Browser-based PKCE authentication
   - Token refresh flows
   - User identity validation

3. **Azure App Configuration**
   - Environment variable sync (`eai env pull`)
   - Configuration versioning
   - Feature flags

4. **Azure Key Vault**
   - Secret management (`eai env pull --include-secrets`)
   - Credential storage

5. **GitHub Releases API**
   - Update checks (`eai update --check`)
   - Version notifications

6. **GitHub Actions API**
   - Deployment triggers (`eai deploy trigger`)
   - Workflow status checks

### Downstream Dependents (Services Calling This)
- **Vertical Application Developers**: Primary users scaffolding and managing EAI applications
- **CI/CD Pipelines**: Automated deployment workflows using CLI commands
- **AI Terminal Tools**: Claude, Codex, Gemini, Copilot agents using CLI via Gofer pipeline

### External Service Dependencies
1. **GitHub Pages** - Static npm registry hosting at `https://eai-tools.github.io/eai/registry/`
2. **Azure App Service** - Target deployment environment
3. **npm Registry** - Fallback dependency resolution for npm packages

## Documentation Surfaces

The repository maintains multiple documentation surfaces:

### 1. Repository Root Documentation
- **Path**: Root `.md` files (`README.md`, `CLAUDE.md`, `AGENTS.md`, `CODEBASE.md`)
- **Purpose**: Developer onboarding, workflow instructions, codebase guide
- **Audience**: Contributors and AI agents
- **Publishing**: Committed to repository, no separate deployment
- **Nightly Pipeline**: Not covered (manually maintained)

### 2. Technical Documentation (`.tech-docs/`)
- **Path**: `.tech-docs/` directory
- **Purpose**: Comprehensive technical documentation generated for ops/architecture review
- **Audience**: Platform engineers, architects, AI documentation agents
- **Publishing**: Integrated into Docusaurus build, deployed to GitHub Pages
- **Nightly Pipeline**: **Covered** by central tech-docs automation workflow

### 3. Docusaurus Documentation Site
- **Path**: `docs-site/` directory
- **Purpose**: User-facing documentation (93 pages covering getting started, guides, concepts, command reference, 50 industry scenarios, examples in 7 languages)
- **Audience**: EAI CLI users and developers
- **Publishing**: Built via Docusaurus, deployed to GitHub Pages on push to `main`
- **Nightly Pipeline**: **Covered** by `.github/workflows/docs.yml` (triggered on `.tech-docs/**` and `docs-site/**` changes)

### 4. Release Artifacts
- **Path**: `docs-site/static/` directory
- **Purpose**: Machine-readable documentation and registry metadata
- **Artifacts**:
  - `llms.txt` - Concise AI-readable reference
  - `llms-full.txt` - Comprehensive AI-readable reference
  - `cli-help.txt` - Full CLI help output
  - `registry/` - npm registry packument and tarballs
- **Publishing**: Generated via `npm run docs:release-assets`, deployed with docs site
- **Nightly Pipeline**: **Covered** by release workflow regeneration

### 5. Gofer AI Pipeline Specs
- **Path**: `.specify/` directory
- **Purpose**: Gofer pipeline specifications, templates, and execution state
- **Audience**: AI agents (Claude, Codex, Gemini, Copilot)
- **Publishing**: Committed to repository, not deployed
- **Nightly Pipeline**: Not covered (workflow artifacts)

## Current Status

- Nightly-managed `.tech-docs/` content is present for this repository.
- Source commit: `3f2653e8e0c1`
- Additional repo-local docs surfaces detected: 1
