---
generated: "2026-03-11T18:45:00Z"
source_commit: "584ed1afb8257ec89c81a6e0515007e9491fa008"
---

# EAI CLI — Changelog

## Overview

This changelog summarizes recent changes to the EAI CLI since the project's inception. This is the **initial documentation generation** — no previous `.tech-docs/` content exists.

---

## Recent Releases

### v0.1.4 — 2026-03-11

**Commit**: `150fe29` — Fix token refresh, external developer docs, and CLI enhancements

**Changes**:
- **Fix**: Token refresh logic improved with 5-minute expiry buffer
- **Docs**: External developer documentation added (93-page comprehensive guide)
- **Enhancement**: CLI command help text improvements
- **Registry**: Published to GitHub Pages static npm registry

**Breaking Changes**: None

**Migration**: No action required

---

### v0.1.3 — 2026-03-10

**Commit**: `ecc129e` — Add update notifications and `eai update` command

**Changes**:
- **Feature**: `eai update` command for self-update
- **Feature**: Background update check with 24-hour cache
- **Feature**: Update notification banner after command execution
- **Enhancement**: Respects `NO_UPDATE_NOTIFIER=1` and `CI` environment variables
- **Enhancement**: Registry fetch with 5-second timeout (non-blocking)

**Configuration Changes**:
- New cache file: `~/.eai/update-check.json`

**Breaking Changes**: None

---

### v0.1.2 — 2026-03-09

**Commit**: `d9e4931` — Rework user invite to lookup-then-provision flow with signup guidance

**Changes**:
- **Fix**: User invite reworked to lookup-then-provision pattern
- **Enhancement**: Signup guidance for new users
- **API**: User provisioning flow now checks if user exists first via email lookup
- **UX**: Improved error messages for user provisioning failures

**API Changes**:
- Added `lookupUserByEmail()` method to `PlatformAPIClient`
- Modified user provisioning flow

**Breaking Changes**: None

---

### v0.1.1 — 2026-03-08

**Commit**: `1329425` — Add user invite command for tenant user management

**Changes**:
- **Feature**: `eai user provision` command for adding users to tenants
- **Feature**: User email lookup and provisioning
- **Enhancement**: Tenant user management capabilities

**New Commands**:
- `eai user provision` — Provision user to tenant

**Breaking Changes**: None

---

### v0.1.0 — 2026-03-07 (Initial Release)

**Commit**: `b748c40` — Static npm registry on GitHub Pages

**Initial Features**:

**Scaffolding**:
- `eai init [name]` — Interactive scaffold from Vertical-Template
- `eai dev` — Start local dev server with connectivity checks

**Authentication**:
- `eai login` — Entra CIAM device code flow
- `eai logout` — Clear stored tokens
- `eai whoami` — Show auth status and project context

**Environment**:
- `eai env pull` — Sync Azure App Config + Key Vault → `.env.local`
- `eai env list` — Show current environment variables
- `eai env push` — Push local overrides to cloud (admin)

**Object Types**:
- `eai types validate` — Validate types against platform schema rules
- `eai types seed` — Push Object Types to platform
- `eai types diff` — Compare local vs remote state
- `eai types pull` — Download remote types to local TypeScript

**Resources**:
- `eai resources list <type>` — List resources (paginated)
- `eai resources get <type> <id>` — Get single resource
- `eai resources create <type>` — Create with `--data` or `--file`
- `eai resources update <type> <id>` — Update (auto-fetches version)
- `eai resources delete <type> <id>` — Delete (with confirmation)
- `eai resources query` — Cross-type query with `--types` and `--where`
- `eai resources schema` — Show published Object Types for tenant

**Tenants**:
- `eai tenant list` — List tenants (scoped to parent)
- `eai tenant info <id>` — Show tenant details
- `eai tenant create` — Create a new tenant

**AI & Documents**:
- `eai chat send <message>` — Send a single chat message
- `eai chat stream <message>` — Stream a conversation (SSE)
- `eai docs upload <file>` — Upload a document
- `eai docs classify <file>` — Classify a document
- `eai docs index <id>` — Index a document for RAG

**Deployment**:
- `eai deploy setup` — Generate deploy-demo.yml + GitHub secrets
- `eai deploy trigger` — Trigger deployment workflow
- `eai deploy status` — Check deployment status

**Diagnostics**:
- `eai verify` — Run platform connectivity checks
- `eai doctor` — Comprehensive diagnostics with fix suggestions

**Infrastructure**:
- Static npm registry on GitHub Pages
- GitHub Actions release workflow
- Automated version bumping and changelog generation
- Smoke tests in CI/CD pipeline

---

## Pre-Release Development (Prior to v0.1.0)

### Documentation Site — 2026-03-06

**Commit**: `efe6072` — CLI packaging, documentation site, and IP sanitization

**Changes**:
- Created 93-page documentation site
- Added getting started, guides, concepts, command reference
- Included 50 industry scenarios and examples in 7 languages
- IP sanitization script to remove internal references

### Project Migration — 2026-03-05

**Commit**: `6deb887` — Consolidate vertical specs + migrate to eai-tools org

**Changes**:
- Migrated from internal repo to `eai-tools/eai-cli` organization
- Consolidated vertical application specifications
- Unified project structure

---

## Architectural Changes

### v0.1.4

**Change**: Token refresh with expiry buffer

**Impact**: Reduces mid-request token expiration failures

**Before**: Tokens refreshed when expired
**After**: Tokens refreshed when <5min remaining

---

### v0.1.3

**Change**: Self-update mechanism

**Impact**: Users can update CLI without manually running `npm install -g`

**Before**: Manual `npm install -g @eai-tools/cli@latest`
**After**: `eai update` command

---

### v0.1.2

**Change**: User provisioning flow

**Impact**: Better error handling for user invites

**Before**: Direct provisioning (fails if user exists)
**After**: Lookup → provision (idempotent, better UX)

---

### v0.1.0

**Change**: Static npm registry on GitHub Pages

**Impact**: No dependency on npm.js for distribution

**Before**: Not published
**After**: Self-hosted registry at `https://eai-tools.github.io/eai-cli/registry`

---

## New Endpoints

### v0.1.2

- `GET /custom-users/by-email` — Lookup user by email

### v0.1.0 (Initial)

All Platform API v3 endpoints integrated:
- `/v3/resources/*` — Resource CRUD
- `/v3/chat/*` — AI chat
- `/v3/documents/*` — Document processing
- `/v3/auth/me` — User info
- `/v3/orchestrate` — Internal routing

---

## Breaking Changes

**None** — All releases have been backward compatible.

**Policy**: Breaking changes will trigger major version bump (e.g., `1.0.0`)

---

## Deprecated Features

**None** — No deprecated features as of v0.1.4.

---

## Security Fixes

### v0.1.4

- Token refresh logic hardened (prevent race conditions on concurrent CLI invocations)

### v0.1.0

- Encrypted token storage (AES-256-CBC) in `~/.eai/tokens.json`
- File permissions set to `0o600` (owner read/write only)

---

## Performance Improvements

### v0.1.3

- Update check cached for 24 hours (reduces registry fetches)
- 5-second timeout on update check (non-blocking)

### v0.1.0

- Native Fetch API (no external HTTP client dependency)
- Streaming chat support for real-time AI responses

---

## Documentation Updates

### v0.1.4

- External developer documentation site (93 pages)
- 50 industry scenarios added
- Examples in 7 languages (TypeScript, Python, Go, Rust, Java, C#, Ruby)

### v0.1.0

- Initial README with command reference
- Installation instructions
- Quick start guide

---

## Dependencies Added

### v0.1.0

**Production**:
- `commander@13.1.0` — CLI framework
- `chalk@5.3.0` — Terminal colors
- `ora@8.1.1` — Spinners
- `inquirer@12.3.2` — Prompts
- `dotenv@16.4.7` — Environment variable loading

**Dev**:
- `typescript@5.7.3` — TypeScript compiler
- `eslint@10.0.3` — Linting
- `@types/node@22.13.0` — Node.js types

---

## Known Issues

**None** — No open critical issues as of v0.1.4.

**Roadmap Items** (not bugs):
- `eai types define` — Interactive Object Type builder (planned)
- `eai dev --offline` — Local mock gateway for offline development (planned)
- `eai tunnel` — Cloudflare tunnel for webhook testing (planned)

---

## Migration Guides

### Upgrading from v0.1.3 to v0.1.4

**No action required** — Fully backward compatible.

**Optional**: Run `eai update` to test new self-update mechanism.

---

### Upgrading from v0.1.2 to v0.1.3

**No action required** — Fully backward compatible.

**New Feature**: `eai update` command available for future updates.

---

### Upgrading from v0.1.1 to v0.1.2

**No action required** — Fully backward compatible.

**Improvement**: User provisioning flow now more robust (idempotent).

---

### Upgrading from v0.1.0 to v0.1.1

**No action required** — Fully backward compatible.

**New Feature**: `eai user provision` command available.

---

## Comparison with Previous Documentation

**Not applicable** — This is the initial documentation generation. No previous `.tech-docs/` directory existed.

---

## Future Roadmap

Based on README and recent development:

**Planned Features**:
- Interactive Object Type builder (`eai types define`)
- Offline development mode (`eai dev --offline`)
- Cloudflare tunnel integration (`eai tunnel`)
- Additional deployment targets (AWS, GCP)
- Bulk resource import/export
- Schema migration tools

**Under Consideration**:
- Integration tests with mocked services
- Automated changelog generation from commit messages
- Plugin system for custom commands
- Multi-language CLI (i18n support)

---

## Change Statistics

**Total Releases**: 5 (v0.1.0 - v0.1.4)

**Total Commits** (last 20): 20

**Commands Added**: 33 (initial release) + 1 (v0.1.1) + 1 (v0.1.3) = 35 total

**Lines of Code** (estimated):
- TypeScript source: ~2,500 lines
- Documentation: 93 pages

**Files Changed** (since project inception):
- ~30 TypeScript files
- ~100 documentation files
- 3 GitHub Actions workflows

---

## Release Frequency

**Average**: 1 release per week (initial development phase)

**Expected**: Slowing to bi-weekly or monthly releases as project matures

---

## Contributors

**Team**: EAI Tools

**Repository**: https://github.com/eai-tools/eai-cli

**License**: MIT
