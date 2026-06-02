---
generated: true
generated_at: "2026-06-02T12:07:48.731Z"
source_commit: "b887fa31975d4723d5bc786d027b31cf5218a28e"
---
# EAI CLI — Changelog

The current stable CLI release is **2.9.5**. The public documentation, static
registry, and release-facing AI help surfaces are expected to track this version.

## Recent Changes Since Last Documentation Update

**Previous documented version**: 2.8.13
**Current stable version**: 2.9.5
**Current documentation refresh**: 2026-06-01 UTC
**Latest release tag**: v2.9.5, released 2026-05-31

### Changes in This Documentation Update

- Added release notes for v2.8.14, v2.8.15, and the full v2.9.x series.
- Updated the current stable version from 2.8.13 to 2.9.5.
- Moved v2.9.0 out of roadmap/future language because it has shipped.
- Refreshed public wording to application/app terminology while preserving compatibility identifiers where they are part of current CLI/API contracts.

---

## Version History

### [2.9.5] - 2026-05-31

**Features**:
- Resolved the PublicAPI base URL from the active tenant's home region.
- Added region-aware routing so users in different tenant homes can reach the correct PublicAPI endpoint without hard-coding a single public host.

**Impact**:
- Improves support for multi-region tenants.
- Reduces the chance of tenants in non-default regions accidentally targeting the wrong regional PublicAPI.

---

### [2.9.4] - 2026-05-31

**Features**:
- Aligned app creation with the company hierarchy.
- Improved app enrollment behavior so created apps attach to the correct company tenant context.

**Impact**:
- Better tenant isolation for app onboarding.
- Cleaner relationship between company tenants, child tenants, and app records.

---

### [2.9.3] - 2026-05-30

**Features**:
- Bundled eai-gofer v3.5.0 with the CLI.
- Completed the public PublicAPI v4 migration in the CLI.
- Refactored CLI calls to use native PublicAPI v4 routes rather than old v1/v3 vocabulary mapped onto v4 URLs.

**Impact**:
- New projects receive the current Gofer assets.
- CLI platform calls are aligned with the PublicAPI v4 surface.
- Reduces migration risk as older PublicAPI interfaces are deprecated.

---

### [2.9.2] - 2026-05-28

**Features**:
- Updated chat requests to use the `thread_id` contract.
- Aligned CLI chat behavior with the current PublicAPI/AICore chat session model.

**Impact**:
- More reliable continuation of chat conversations.
- Better compatibility with v4 chat orchestration.

---

### [2.9.1] - 2026-05-28

**Features**:
- Added AI runtime binding during workflow provisioning.
- Extended workflow provisioning so AI profile and chatbot runtime records can be created or linked with the workflow configuration.

**Impact**:
- Workflow setup can now prepare the runtime AI pieces required by app experiences.
- Reduces manual post-provisioning setup.

---

### [2.9.0] - 2026-05-27

**Features**:
- Added workflow provisioning commands.
- Introduced workflow config creation and app binding through `eai workflow provision`.
- Added readiness checks for tenant, plan, and workflow setup.

**Impact**:
- The CLI can bootstrap shared workflow configuration for application delivery.
- Provides a named home for workflow setup in the v4 PublicAPI era.

---

### [2.8.15] - 2026-05-26

**Bug Fixes**:
- Persisted the requested Entra redirect URI during provisioning.

**Impact**:
- Reduces mismatch between requested callback configuration and the app registration state.
- Improves reliability of browser sign-in after provisioning.

---

### [2.8.14] - 2026-05-26

**Bug Fixes**:
- Fixed Entra callback provisioning for projects that run behind a configured auth base path.

**Impact**:
- Sign-in callback URLs are generated correctly for apps mounted below a base path.
- Avoids broken auth flows for non-root app deployments.

---

### [2.8.13] - 2026-05-11

**Enhancements**:
- Improved profile-based tenant context management.
- Enhanced error messages for tenant selection failures.
- Refined Gofer asset refresh conflict detection.
- Added better documentation for `eai doctor --check-updates`.

**Bug Fixes**:
- Fixed tenant context persistence across profile switches.
- Resolved edge case in first-admin bootstrap validation.
- Corrected Gofer manifest hash comparison for modified files.

---

### [2.8.12] - 2026-05-11

**Features**:
- Added tenant app registration persistence spec in `.specify/`.
- Improved Entra app registration lifecycle management.
- Enhanced `eai provision entra` output formatting.

**Documentation**:
- Updated `.specify/` with tenant app registration workflow spec.
- Clarified Entra provisioning requirements in README.

---

### [2.8.11] - 2026-05-11

**Features**:
- Added tenant app registration persistence specification.
- Introduced structured approach to managing Entra app lifecycle.

**Internal**:
- Aligned `.specify/` specs with latest platform capabilities.

---

### [2.8.10] - 2026-05-11

**Bug Fixes**:
- Fixed legacy template provenance detection in `eai init`.
- Resolved template source resolution for older project structures.

**Improvements**:
- Better error messages when template provenance cannot be determined.

---

### [2.8.9] - 2026-05-11

**Documentation**:
- Highlighted update workflows in CLI help output.
- Added examples for `eai update`, `eai gofer refresh`, `eai template check`.
- Improved discoverability of maintenance commands.

**Help Text**:
- Enhanced CLI help footer with update workflow examples.
- Clarified when to use each update command.

---

### [2.8.8] - 2026-05-11

**Features**:
- Added template drift preview via `eai template check`.
- Allows developers to see template changes before manually copying.
- Shows which files are new vs. which require manual review.

**Infrastructure**:
- Moved all GitHub Actions workflows to Node.js 24.
- Updated `actions/setup-node` to v6.
- Set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` in workflow environments.

---

### [2.8.7] - 2026-05-11

**Improvements**:
- Made release-facing docs generation deterministic.
- Ensures consistent `llms.txt`, `llms-full.txt`, `cli-help.txt` output.
- Stable hashes for reproducible builds.

**Internal**:
- Refactored `scripts/generate-release-docs.cjs` for determinism.
- Sorted command output for consistent file generation.

---

### [2.8.6] - 2026-05-11

**Documentation**:
- Refreshed release docs and CLI help automation.
- Updated `docs-site/static/llms.txt` and `cli-help.txt`.
- Aligned with latest CLI command structure.

---

### [2.8.5] - 2026-05-11

**Improvements**:
- Aligned release docs and CLI help automation with static registry flow.
- Ensured `npm run docs:release-assets` generates correct metadata.
- Validated registry artifacts before deployment.

---

## Major Feature Additions

### PublicAPI v4 Native CLI Surface (v2.9.x series)
- **Feature**: CLI platform calls use named PublicAPI v4 routes for legitimate user workflows.
- **Commands affected**: tenant, user, chat, resources, docs, workflow, provisioning, and diagnostics commands.
- **Purpose**: Prepare the CLI for older v1/v3 PublicAPI interface deprecation.
- **Impact**: Public CLI behavior is now aligned with the v4 tenant/app/user OBO model.

### Regional PublicAPI Resolution (v2.9.5)
- **Feature**: Tenant home region determines which PublicAPI host the CLI targets.
- **Purpose**: Support public users whose tenant home is outside the default region.
- **Impact**: Reduces wrong-region failures and keeps public routing tenant-aware.

### Workflow Provisioning (v2.9.0 - v2.9.2)
- **Feature**: `eai workflow provision` and `eai workflow readiness`.
- **Purpose**: Bootstrap shared workflow configuration, app bindings, AI profile records, and chatbot runtime records.
- **Impact**: Makes app workflow setup repeatable from the CLI.

### Gofer v3.5.0 Bundle (v2.9.3)
- **Feature**: Updated bundled Gofer AI assets.
- **Purpose**: Keep `eai init` aligned with the current Gofer pipeline.
- **Impact**: New projects get the latest commands, agents, skills, templates, and workflow guidance.

### AI-Readable UI Blocks Bridge (v2.8.x series)
- **Feature**: `eai blocks` command for AI agents to discover and interact with UI components.
- **Commands**: `eai blocks list`, `eai blocks validate`.
- **Purpose**: Enable AI agents to scaffold UI using catalog metadata.
- **Impact**: Streamlines app UI development with AI assistance.

### Static npm Registry on GitHub Pages (v2.6.x series)
- **Feature**: Self-hosted npm registry at `https://eai-tools.github.io/eai/registry`.
- **Purpose**: Eliminate npmjs dependency and keep full control over distribution.
- **Impact**: Simplified release process with no external npm account required.

---

## Breaking Changes

### None in v2.9.x Series

The v2.9.x series maintains backward compatibility with v2.8.x. Stable
compatibility identifiers such as `eai vertical`, `--vertical`,
`EAI_VERTICAL_KEY`, `verticalKey`, `tenant-vertical-enrollment`,
`vertical-product-config`, and `blank-vertical-template` remain available while
the public documentation moves toward application/app terminology.

### Last Breaking Change: v2.6.0 (2026-04-15)
- Switched from npmjs to GitHub Pages static registry.
- Requires one-time registry configuration: `npm config set @eai-tools:registry https://eai-tools.github.io/eai/registry/ --location=user`.
- Old installations continue to work but will not receive updates until the scoped registry is configured.

---

## Deprecations

### No New Deprecations in v2.9.x

The v2.9.x work focused on PublicAPI v4 alignment, workflow provisioning, and
regional routing without removing existing CLI entry points.

### Deprecated in v2.7.0
- **Deprecated**: Passing tenant ID via `TENANT_ID` environment variable.
- **Replacement**: Use `eai tenant select` to establish tenant context.
- **Reason**: Membership-driven tenant selection is more secure and accurate.
- **Timeline**: Environment variable fallback is expected to be removed in v3.0.0.

### Supported Compatibility Names
- `eai vertical` remains the current command for app enrollment management.
- `--vertical`, `EAI_VERTICAL_KEY`, and `verticalKey` remain current contract names for workflow/app binding.
- Public documentation now describes these concepts as app/application concepts where possible.

---

## Known Issues

### Current (v2.9.5)

**Issue**: `eai env pull --include-secrets` requires Azure CLI authentication  
**Impact**: Medium — Users must run `az login` before pulling secrets  
**Workaround**: Authenticate with `az login`, or manually add secrets to `.env.local`  
**Status**: Working as designed. Azure CLI is the secure auth method.

**Issue**: `eai deploy trigger` fails if `GITHUB_TOKEN` is not set
**Impact**: Low — Only affects deployment automation  
**Workaround**: Set `GITHUB_TOKEN` in `.env.local` or use GitHub UI  
**Status**: Working as designed. A token is required for GitHub API access.

**Issue**: Update check may fail on networks with strict egress filtering  
**Impact**: Low — Update notifications will not appear, but CLI functions normally
**Workaround**: Check for updates manually via GitHub Releases or the static registry
**Status**: No fix planned. Silent failure is acceptable for background update checks.

---

## Architectural Changes

### Recent (v2.8.13 → v2.9.5)

**PublicAPI v4 Migration**:
- CLI platform calls now target PublicAPI v4 routes for user-facing workflows.
- Older v1/v3 client vocabulary was removed from public CLI call sites where v4 homes exist.
- Chat now uses the `thread_id` contract.

**Tenant-Scoped Regional Routing**:
- PublicAPI host selection can use the tenant home region.
- This supports multi-region public deployments while keeping tenant context central.

**Workflow Runtime Provisioning**:
- Workflow provisioning can create or bind shared workflow, AI profile, chatbot, and app binding records.
- Readiness checks help detect missing tenant/workflow setup before app implementation.

**Company/App Hierarchy Alignment**:
- App creation now respects company hierarchy and child company tenant context.
- App enrollment records are better aligned with the tenant model.

**Gofer Bundle Evolution**:
- Bundled Gofer assets updated to v3.5.0.
- `eai init` installs the current commands, agents, skills, and templates for supported AI terminals.

---

## Performance Improvements

### v2.9.x Series

**Regional Resolution**:
- Tenant-aware PublicAPI routing avoids unnecessary retries against the wrong regional host.

**Workflow Provisioning**:
- Bundles related workflow/runtime setup into repeatable CLI commands instead of requiring manual multi-step setup.

### v2.8.x Series

**Token Caching**:
- Reduced unnecessary token refreshes by validating `expiresAt` before API calls.
- Membership cache TTL prevents excessive `/v4/identity/tenants` calls.

**Update Check Throttling**:
- Update checks limited to once per 24 hours.
- Non-blocking background checks do not delay command execution.

**Gofer Refresh Optimization**:
- Hash-based change detection avoids full file comparisons.
- Only modified files are backed up, not entire repos.

---

## Security Updates

### v2.9.x Series

**PublicAPI v4 Alignment**:
- CLI user workflows now follow the current PublicAPI v4 OBO model.
- Tenant and app context are kept explicit in public workflow/app provisioning paths.

**Public Repository Hardening**:
- Public-facing documentation removes private dev/test profile examples and internal cloud-store defaults.
- CLI output redacts token/secret-like values before printing JSON output.
- GitHub CodeQL default setup and OpenSSF Scorecard are enabled for public trust signals.

### v2.8.x Series

**Supply Chain Hardening**:
- Enhanced npm dependency integrity checks.
- Validated package hashes before installation.
- Improved security posture for npm ecosystem risks.

**Token File Permissions**:
- Enforced restrictive file modes for local token files.
- Improved token storage isolation through profile-aware paths.

---

## Documentation Updates

### v2.9.5

**Technical Documentation**:
- Updated changelog through v2.9.5.
- Clarified PublicAPI v4, regional routing, workflow provisioning, and current compatibility identifiers.
- Removed stale roadmap language that treated v2.9.0 as unreleased.

**Public Release Surfaces**:
- Regenerated `llms.txt`, `llms-full.txt`, and `cli-help.txt`.
- Included the code-quality and patterns review pages in the release-facing AI documentation bundle.
- Static registry metadata and tarballs remain aligned with package version 2.9.5.

**GitHub Pages**:
- Published documentation site: `https://eai-tools.github.io/eai`.
- Changelog page: `https://eai-tools.github.io/eai/docs/changelog`.

---

## Migration Guides

### Migrating from v2.8.x to v2.9.x

**No Breaking Changes** — v2.9.x is intended to be backward compatible.

**Recommended Actions**:

1. **Update the CLI**
   ```bash
   npm config set @eai-tools:registry https://eai-tools.github.io/eai/registry/ --location=user
   npm install -g @eai-tools/cli
   eai --version
   ```

2. **Verify Tenant Context**
   ```bash
   eai login
   eai tenant select
   eai whoami
   ```

3. **Check PublicAPI Routing**
   ```bash
   eai verify
   eai doctor --check-updates
   ```

4. **Refresh Gofer Assets When Ready**
   ```bash
   eai gofer refresh --check
   eai gofer refresh
   ```

5. **Use Workflow Provisioning for App Workflows**
   ```bash
   eai workflow readiness
   eai workflow provision <workflow-key> --vertical <app-key>
   ```

---

### Migrating from v2.7.x to v2.8.x

**No Breaking Changes** — v2.8.x is fully backward compatible.

**Optional Enhancements**:

1. **Use Profile System** (if you have private profile settings):
   ```bash
   eai login --profile <name>
   eai --profile <name> tenant list
   ```

2. **Update Gofer Assets** (if using AI terminals):
   ```bash
   eai gofer refresh --check
   eai gofer refresh
   ```

3. **Check Template Drift**:
   ```bash
   eai template check
   ```

---

### Migrating from v2.6.x to v2.7.x

**Breaking Change**: Tenant selection mechanism changed.

**Before (v2.6.x)**:
```bash
echo "TENANT_ID=tenant-123" >> .env.local
eai resources list User
```

**After (v2.7.x)**:
```bash
eai login
eai tenant select
eai resources list User
```

**Migration Steps**:
1. Run `eai login` to authenticate.
2. Run `eai tenant select` and choose your tenant.
3. Remove `TENANT_ID` from `.env.local` when practical.

---

## Roadmap

### Planned for v2.10.x

- [ ] More first-class app/application command aliases alongside existing compatibility commands.
- [ ] Improved regional endpoint diagnostics in `eai verify`.
- [ ] Expanded workflow templates and readiness checks.
- [ ] Bulk resource import (`eai resources import --file data.json`).

### Planned for v3.0.0

- [ ] **Breaking**: Remove `TENANT_ID` environment variable support.
- [ ] **Breaking**: Consider replacing legacy vertical CLI vocabulary with app/application command aliases after migration.
- [ ] Plugin system for custom commands.
- [ ] Workspace support for multi-app repos.
- [ ] Built-in health monitoring dashboard.

---

## Contributors

- **EAI Tools Team** — Core development and maintenance.
- **Gofer Pipeline** — AI-assisted implementation, validation, and public documentation hygiene.
- **Renovate Bot** — Dependency updates and security patches.

---

## Feedback and Issues

Report bugs and feature requests at: [https://github.com/eai-tools/eai/issues](https://github.com/eai-tools/eai/issues)

Full documentation: [https://eai-tools.github.io/eai](https://eai-tools.github.io/eai)
