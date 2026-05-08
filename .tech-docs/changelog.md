---
generated: true
generated_at: "2026-05-08T17:54:00Z"
source_commit: "825bd7f4db75d5f0be796914cc300b14969c2e74"
---

# EAI CLI — Changelog

## Recent Changes Since Last Documentation Update

**Previous Documentation**: 2026-05-04 17:57 UTC (commit 1dc87b0)  
**Current Documentation**: 2026-05-08 17:54 UTC (commit 825bd7f)  
**Version**: 2.7.0 → 2.8.3

---

## [2.8.3] - 2026-05-08

### Summary
Fixed Object Type storage metadata scaffolding for generated types. The `eai init` command now correctly scaffolds `storageMetadataStatus` field for Object Types.

### Fixed

- **Storage Metadata Status Scaffolding** (PR #35, commit ebee64d)
  - Fixed `eai init` to generate Object Types with correct `storageMetadataStatus` field
  - Generated types now include `storageMetadataStatus: 'draft'` by default
  - Published types require `storageMetadataStatus: 'ready'` with complete `storageBinding` config
  - Prevents validation errors when seeding types after init

### Related

- Validation rules for storage metadata documented in `src/commands/types.ts`
- Object Type storage binding validation in `validateObjectTypeStorageMetadata()`

---

## [2.8.2] - 2026-05-08

### Summary
Fixed generated Object Type storage metadata to align with platform validation rules.

### Fixed

- **Object Type Scaffold Storage Metadata** (PR #34, commit 323804c)
  - Aligned object type scaffolding with storage metadata validation rules
  - Fixed generated types to match platform requirements for `storageBackend`, `storageMetadataStatus`, and `storageBinding`
  - Ensured published types include complete storage configuration
  - Prevented seed failures due to invalid storage metadata

### Changed

- Object Type scaffolding in `eai init` now generates compliant storage metadata
- Validation messages improved for storage binding errors

---

## [2.8.1] - 2026-05-08

### Summary
Fixed production tenant lookup after CLI login. The CLI now correctly resolves production tenant context when using the default profile.

### Fixed

- **Production Tenant Lookup** (PR #33, commit 72ff1cd)
  - Fixed tenant context resolution for production environment
  - CLI login now correctly caches production tenant memberships
  - Resolved issue where `eai tenant select` would fail after fresh login to production
  - Improved error messages when tenant lookup fails

### Changed

- Tenant context resolution logic in `src/lib/tenant-context.ts`
- Improved debugging output for tenant membership fetch

---

## [2.7.0] - 2026-05-04

### Summary
Entra provisioning validation improvements. The `eai provision entra` command now validates the `signin_ready` status from AdminAPI and provides clear warnings when Entra app registration is incomplete.

### Added

- **Entra Provisioning Validation** (PR #32, commit 0621814)
  - `eai provision entra` now checks `signin_ready` field from AdminAPI `/v1/admin/auth/entra-app` response
  - Exits with non-zero status code when `signin_ready=false`
  - Displays warning message explaining that Entra app registration is incomplete or pending
  - Prevents silent failures where authentication would fail due to incomplete Entra configuration

### Fixed

- **Entra Provisioning Silent Failures**
  - Previously, `eai provision entra` would succeed even when Entra app registration was incomplete
  - Users would encounter authentication failures with no clear indication of the root cause
  - Now provides immediate feedback during provisioning phase

---

## [2.6.0] - 2026-05-02

### Summary
Tenant context fixes and local dedicated tenant lifecycle improvements. Enhanced child tenant bootstrap flow with usability verification.

### Added

- **Local Dedicated Tenant Lifecycle Coverage** (commit ae537b4)
  - Added comprehensive E2E tests for local dedicated tenant lifecycle
  - New test script: `npm run test:e2e-local` (bash `scripts/test-local-dedicated-tenant-lifecycle.sh`)
  - Tests cover tenant creation, bootstrap, membership verification, and usability checks

### Fixed

- **Tenant Context for CLI Operations** (PR #29, commit 5c10404)
  - Fixed tenant context handling for CLI tenant operations
  - Resolved issue where tenant context was not properly maintained during child tenant operations
  - Improved error messages when tenant context is invalid or missing

- **Child Tenant Bootstrap Redundancy** (commit 1d6057c)
  - Avoided redundant child tenant bootstrap calls
  - Added usability check to prevent repeated bootstrap attempts
  - Enhanced first-admin bootstrap flow to verify membership before marking as usable

### Changed

- **Tenant Lifecycle Truth** (commits 49b5ea5, ae537b4)
  - `eai tenant create` now distinguishes three states:
    - `created`: tenant document exists
    - `bootstrapped`: first-admin bootstrap called successfully
    - `usable`: direct `tenant-admin` membership confirmed
  - CLI only auto-selects new child tenants when `usable` is true
  - Improved error messages when bootstrap is blocked or membership confirmation fails

### Commits

- `06d9705` - Merge pull request #30 from eai-tools/codex/issue-2688-fix-tenant-context
- `49b5ea5` - Merge main into local tenant lifecycle branch
- `ae537b4` - Add local dedicated tenant lifecycle coverage
- `1d6057c` - Avoid redundant child tenant bootstrap
- `5c10404` - Fix tenant context for CLI tenant operations (#29)
- Previous docs commits (999edb6, cecc419, e555f2a, 31b52b6, 7c879a6)

---

## [2.6.0] - 2026-04-30

### Summary
This release refreshes the bundled Gofer payload to v3.1.0-1 and includes several infrastructure improvements.

### Changes
- **feat**: Refresh bundled Gofer payload to v3.1.0-1
- **chore**: Publish v2.6.0 to registry
- **chore**: Release v2.6.0

### Spec Implementation
- **Gofer Installation** (`.specify/specs/011-install-gofer`): COMPLETE (100/100 validation score)
- **CLI Platform Alignment** (`.specify/specs/901-cli-platform-alignment`): COMPLETE (100/100 validation score)
- **Provision Entra Diagnostics** (`.specify/specs/902-provision-entra-diagnostics`): COMPLETE (100/100 validation score)
- **Provision Entra CIAM Routing** (`.specify/specs/903-provision-entra-ciam-routing`): COMPLETE (100/100 validation score)

---

## [2.5.2] - 2026-04-29

### Changes
- **fix**: Validate object type defaults before seeding
- **chore**: Publish v2.5.2 to registry

---

## [2.5.1] - 2026-04-28

### Changes
- **fix**: Route provision storage to PublicAPI resources path

---

## [2.5.0] - 2026-04-28

### Changes
- **feat**: Refresh bundled Gofer payload to v3.0.1-1
- **fix**: Remove internal storage labels from CLI help
- **chore**: Publish v2.5.0 to registry

---

## [2.4.2] - 2026-04-28

### Changes
- **fix**: Respect `APP_BASE_PATH` when registering OAuth redirect URI

---

## [2.4.1] - 2026-04-XX

### Changes
- **fix**: Persist `ENTRA_TENANT_ID` and `ENTRA_TENANT_NAME` in provision entra

---

## [2.4.0] - 2026-04-XX

### Changes
- **feat**: Add provision entra debug mode
- **feat**: Persist scopes, redirect URIs, env, tenant ID
- **feat**: Show all user roles in tenant list
- **feat**: Add resource storage CLI dogfood commands
- **chore**: Publish v2.4.0 to registry

---

## [2.3.0] - 2026-04-XX

### Changes
- **feat**: Replace tenant-structure prompt with explicit tenant binding in `eai init`
- **chore**: Publish v2.3.0 to registry

---

## Major Changes Since v0.1.4 (March 2026)

### 🔐 Authentication & Authorization

#### Browser-Based PKCE Flow
- **Changed**: Authentication flow from device code to browser-based PKCE (RFC 7636)
- **Impact**: Faster login, no device code polling, localhost:8888 callback server
- **Files**: `src/lib/auth.ts`
- **Commands Affected**: `eai login`

#### Profile System
- **Added**: Multi-environment profile support (`--profile dev|test|prod`)
- **Added**: `EAI_PROFILE` environment variable
- **Added**: Per-profile token storage (`~/.eai/tokens/{profile}.json`)
- **Added**: Profile config in `~/.eai/config.json`
- **Impact**: Developers can switch between dev/test/prod without changing files
- **Files**: `src/lib/profile.ts`, `src/lib/auth.ts`
- **Commands Affected**: All commands (global `--profile` flag)

#### Tenant Context Management
- **Added**: Membership-driven tenant selection via `eai tenant select`
- **Added**: Tenant context cache (`~/.eai/tenant-context.json`)
- **Changed**: Tenant selection from `.env.local` vars to login-based memberships
- **Impact**: Active tenant comes from AdminAPI memberships, not environment variables
- **Files**: `src/lib/tenant-context.ts`, `src/lib/context.ts`
- **Commands Affected**: `eai tenant list/select`, all tenant-scoped commands

### 🛠️ New Commands

#### `eai provision entra`
- **Purpose**: Create or confirm Entra app registration in CIAM for the vertical
- **Features**: Profile-based CIAM routing, sanitized error handling, OAuth scope/redirect URI persistence
- **Spec**: `.specify/specs/902-provision-entra-diagnostics`, `.specify/specs/903-provision-entra-ciam-routing`
- **Files**: `src/commands/provision.ts`

#### `eai user invite`
- **Purpose**: Add existing user to tenant via tenant-admin provisioning flow
- **Features**: User lookup by email, role assignment
- **Files**: `src/commands/user.ts`

#### `eai user provision-me`
- **Purpose**: Self-provision to a tenant (when invited but not yet provisioned)
- **Files**: `src/commands/user.ts`

#### `eai tenant create`
- **Enhanced**: Now includes first-admin bootstrap and membership verification
- **Features**: Child tenant usability check, auto-selection only if truly usable
- **Spec**: `.specify/specs/901-cli-platform-alignment`
- **Files**: `src/commands/tenant.ts`

#### `eai verify calls`
- **Purpose**: Audit platform API contracts used by the CLI
- **Features**: Lists PublicAPI and AdminAPI routes the CLI actually calls
- **Files**: `src/commands/verify.ts`

#### Resource Storage Commands (Dogfood)
- **Added**: `eai resources storage-status`
- **Added**: `eai resources storage-doctor`
- **Added**: `eai resources provision-storage`
- **Purpose**: Manage object-specific storage backends

### 📚 Library Additions

#### Error Code System
- **Added**: Structured error catalog (E001-E399)
- **Categories**: Project (E001-E099), Auth (E100-E199), Platform (E200-E299), Validation (E300-E399)
- **Features**: Consistent error messages, exit codes, suggestions
- **Files**: `src/lib/error-codes.ts`
- **Usage**: `exitWithError(ErrorCode.E101)` → "Not logged in. Run `eai login` to authenticate."

#### Context Resolution
- **Added**: Unified context resolution for commands
- **Purpose**: Centralize project root, profile, auth, tenant discovery
- **Features**: Reduces boilerplate, consistent error handling
- **Files**: `src/lib/context.ts`
- **Usage**: `const ctx = await resolveCommandContext({ interactive: true })`

#### Cloud Environment Management
- **Added**: Azure App Config + Key Vault integration
- **Purpose**: Sync environment variables to `.env.local`
- **Files**: `src/lib/cloud-env.ts`

#### Azure CLI Integration
- **Added**: Azure CLI detection and token acquisition
- **Purpose**: Authenticate to Azure services for `eai env pull`
- **Files**: `src/lib/azure-cli.ts`

#### Schema Builder
- **Added**: `--describe` flag support for AI agents
- **Purpose**: Output JSON schema of CLI command structure
- **Features**: Enables AI tools to discover capabilities at runtime
- **Files**: `src/lib/schema-builder.ts`
- **Usage**: `eai --describe | jq '.commands[]'`

#### Object Type Defaults
- **Added**: Default property value utilities
- **Purpose**: Validate and apply default values for Object Type properties
- **Files**: `src/lib/object-type-defaults.ts`

### 🔄 Breaking Changes

#### Tenant Selection
- **Removed**: `TENANT_DEFAULT_ID` and `TENANT_{APP}_ID` from `.env.local` (deprecated)
- **Replacement**: Use `eai login` + `eai tenant select` (membership-driven)
- **Migration**: Existing projects still work (fallback to env vars with deprecation warning)

#### Authentication Flow
- **Removed**: Device code flow (no more user codes to type in browser)
- **Replacement**: Browser-based PKCE flow (localhost:8888 callback)
- **Migration**: Existing tokens remain valid; re-login uses new flow

### ✨ Enhancements

#### AdminAPI Integration
- **Added**: Direct AdminAPI routes for tenant/user management
- **Endpoints**: `/api/admin/tenants`, `/api/admin/users/lookup`, `/api/admin/current-user/tenant-memberships`, `/api/admin/tenants/{id}/bootstrap-admin`
- **Impact**: Membership resolution, user provisioning, tenant creation
- **Files**: `src/lib/api.ts`

#### Gofer Asset Installation
- **Enhanced**: `eai init` now installs Gofer AI CLI assets by default
- **Includes**: Claude commands/agents, Codex skills, Gemini commands, Copilot prompts
- **Escape Hatch**: `eai init <name> --no-gofer` to skip
- **Spec**: `.specify/specs/011-install-gofer` (COMPLETE)
- **Files**: `src/lib/gofer-installer.ts`

#### Output Formatting
- **Added**: `--simple` flag for screen-reader friendly output
- **Added**: `--no-color` / `--color` flags for color control
- **Enhanced**: `symbols` object (✓, ✗, ⚠, →, +, -, ~, =)
- **Files**: `src/lib/output.ts`

#### Test Coverage
- **Added**: Vitest + MSW for API mocking
- **Coverage**: Unit tests for core library modules
- **Files**: `tests/**/*.test.ts`, `vitest.config.ts`

### 📄 Documentation

#### Comprehensive Docs Site
- **Built With**: Astro + Starlight
- **Pages**: 93 pages covering getting started, guides, concepts, command reference, 50 industry scenarios
- **Location**: `docs/`
- **Published**: [https://eai-tools.github.io/eai-cli](https://eai-tools.github.io/eai-cli)

#### Gofer Pipeline Documentation
- **Added**: CLAUDE.md workflow instructions
- **Added**: AGENTS.md project conventions
- **Commands**: `/0_business_scenario` through `/8_gofer_resume`
- **Files**: `CLAUDE.md`, `AGENTS.md`

### 🐛 Bug Fixes

- Fixed token refresh race condition (5min buffer before expiry)
- Fixed TypeScript evaluation for Object Types with complex imports
- Fixed tenant bootstrap confirmation flow (membership verification)
- Fixed Entra provisioning error handling (sanitized backend details)
- Fixed profile isolation (per-profile tokens don't leak across environments)
- Fixed object type defaults validation before seeding
- Fixed provision storage routing to PublicAPI resources path
- Fixed OAuth redirect URI to respect `APP_BASE_PATH`
- Fixed Entra tenant ID and tenant name persistence in provision entra

### 🔒 Security

- Sanitized error messages in `eai provision entra` (no backend URL exposure)
- Added per-profile token encryption (AES-256-CBC)
- Enforced file mode `0o600` on token files
- Added IP leak scan to release pipeline
- Removed hardcoded tenant IDs from source

### 📦 Dependencies

**Added**:
- `vitest` 4.1.3 (testing framework)
- `msw` 2.6.0 (API mocking)
- `@vitest/ui` 4.1.3 (test UI)

**Updated**:
- `commander` ^12 → ^13.1.0
- `inquirer` ^11 → ^12.3.2
- `typescript` ^5.6 → ^5.7.3
- `eslint` ^9 → ^10.0.3
- `dotenv` ^16.4.7
- `chalk` ^5.3.0
- `ora` ^8.1.1

---

## Version History Summary

| Version | Date | Key Changes |
|---------|------|-------------|
| **2.6.0** | 2026-04-30 | Refresh Gofer payload to v3.1.0-1 |
| **2.5.2** | 2026-04-29 | Validate object type defaults before seeding |
| **2.5.1** | 2026-04-28 | Fix provision storage routing |
| **2.5.0** | 2026-04-28 | Refresh Gofer payload to v3.0.1-1, remove internal storage labels |
| **2.4.2** | 2026-04-28 | Fix OAuth redirect URI with APP_BASE_PATH |
| **2.4.1** | 2026-04-XX | Fix Entra tenant persistence |
| **2.4.0** | 2026-04-XX | Provision entra debug mode, storage commands, tenant roles |
| **2.3.0** | 2026-04-XX | Explicit tenant binding in eai init |
| **2.1.0** | 2026-03-XX | Tenant context cache added |
| **2.0.0** | 2026-03-XX | Profile-based token storage |
| **0.1.4** | 2026-03-11 | Last documented version (previous tech-docs snapshot) |

---

## Architectural Changes

### Authentication Architecture
- **Before**: Device code flow → `~/.eai/tokens.json` → Single environment
- **After**: Browser PKCE flow → `~/.eai/tokens/{profile}.json` → Multi-environment profiles

### Tenant Selection Architecture
- **Before**: `.env.local` (`TENANT_DEFAULT_ID`) → Manual management
- **After**: AdminAPI memberships → `eai tenant select` → Cached in `~/.eai/tenant-context.json`

### Error Handling Architecture
- **Before**: Inline error messages, inconsistent formats
- **After**: Structured error codes (E001-E399), catalog with suggestions

### Command Context Architecture
- **Before**: Each command discovers project root, loads config, creates API client
- **After**: Centralized `resolveCommandContext()` in `src/lib/context.ts`

---

## Migration Guide (0.1.4 → 2.6.0)

### For End Users

#### Step 1: Update CLI
```bash
npm install -g @eai-tools/cli@latest
eai --version  # Should show 2.6.0
```

#### Step 2: Re-Login (New PKCE Flow)
```bash
eai logout
eai login  # Opens browser for authentication
```

#### Step 3: Select Tenant (If Multi-Tenant User)
```bash
eai tenant list
eai tenant select
```

#### Step 4: Verify Setup
```bash
eai whoami
eai verify
```

### For Projects

#### Update `.env.local` (Optional but Recommended)
- Remove `TENANT_DEFAULT_ID` (deprecated, use `eai tenant select`)
- Remove `ENTRA_*` variables if using profiles (use `~/.eai/config.json` instead)

#### Update Scripts
- Replace `TENANT_ID` env var references with tenant selection
- Use `EAI_ACCESS_TOKEN` for CI/CD (headless authentication)

### For CI/CD Pipelines

**Before**:
```bash
export TENANT_ID=${{ secrets.TENANT_ID }}
eai types seed
```

**After**:
```bash
export EAI_ACCESS_TOKEN=${{ secrets.EAI_ACCESS_TOKEN }}
export NO_UPDATE_NOTIFIER=1
eai types seed
```

---

## Known Issues

- Profile switching requires re-login (by design for security)
- `eai tenant create` may require manual membership refresh if bootstrap is delayed
- Update checks may timeout in regions with GitHub Pages latency

---

## Upcoming Features (Roadmap)

- [ ] `eai types define` — Interactive Object Type builder
- [ ] `eai dev --offline` — Local mock gateway for offline development
- [ ] `eai tunnel` — Cloudflare tunnel for webhook testing
- [ ] CLI telemetry (opt-in, privacy-preserving)
- [ ] Automated blue-green deployments

---

## Contributors

This release includes contributions from the EAI Tools team and community feedback from the Gofer pipeline specifications process.

For detailed commit history: `git log 584ed1a..e555f2a`
