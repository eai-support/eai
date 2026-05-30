---
generated: true
generated_at: "2026-05-30T07:39:49.038Z"
source_commit: "eb36f91b2b8bb0eb07acce4e966cda6a8df6f46d"
---
# EAI CLI — Changelog

## Recent Changes Since Last Documentation Update

**Previous Documentation**: 2026-05-22 18:14 UTC (commit 793141a)  
**Current Documentation**: 2026-05-23 17:49 UTC (commit 3f2653e)  
**Current Version**: 2.8.13 (stable)

### Changes in This Update

#### Nightly Documentation Update (commit 3f2653e)
- Automated nightly `.tech-docs/` refresh
- Updated all technical documentation with latest repository state
- Synchronized documentation timestamps and commit references to current HEAD
- Validated all command modules, library structure, and dependency versions
- Repository remains stable at v2.8.13 with no functional changes

---

## Version History

### [2.8.13] - 2026-05-11

**Enhancements**:
- Improved profile-based tenant context management
- Enhanced error messages for tenant selection failures
- Refined Gofer asset refresh conflict detection
- Added better documentation for `eai doctor --check-updates`

**Bug Fixes**:
- Fixed tenant context persistence across profile switches
- Resolved edge case in first-admin bootstrap validation
- Corrected Gofer manifest hash comparison for modified files

---

### [2.8.12] - 2026-05-11

**Features**:
- Added tenant app registration persistence spec in `.specify/`
- Improved Entra app registration lifecycle management
- Enhanced `eai provision entra` output formatting

**Documentation**:
- Updated `.specify/` with tenant app registration workflow spec
- Clarified Entra provisioning requirements in README

---

### [2.8.11] - 2026-05-11

**Features**:
- Added tenant app registration persistence specification
- Introduced structured approach to managing Entra app lifecycle

**Internal**:
- Aligned `.specify/` specs with latest platform capabilities

---

### [2.8.10] - 2026-05-11

**Bug Fixes**:
- Fixed legacy template provenance detection in `eai init`
- Resolved template source resolution for older project structures

**Improvements**:
- Better error messages when template provenance cannot be determined

---

### [2.8.9] - 2026-05-11

**Documentation**:
- Highlighted update workflows in CLI help output
- Added examples for `eai update`, `eai gofer refresh`, `eai template check`
- Improved discoverability of maintenance commands

**Help Text**:
- Enhanced CLI help footer with update workflow examples
- Clarified when to use each update command

---

### [2.8.8] - 2026-05-11

**Features**:
- Added template drift preview via `eai template check`
- Allows developers to see template changes before manually copying
- Shows which files are new vs. which require manual review

**Infrastructure**:
- Moved all GitHub Actions workflows to Node.js 24
- Updated `actions/setup-node` to v6
- Set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` in workflow environments

---

### [2.8.7] - 2026-05-11

**Improvements**:
- Made release-facing docs generation deterministic
- Ensures consistent `llms.txt`, `llms-full.txt`, `cli-help.txt` output
- Stable hashes for reproducible builds

**Internal**:
- Refactored `scripts/generate-release-docs.cjs` for determinism
- Sorted command output for consistent file generation

---

### [2.8.6] - 2026-05-11

**Documentation**:
- Refreshed release docs and CLI help automation
- Updated `docs-site/static/llms.txt` and `cli-help.txt`
- Aligned with latest CLI command structure

---

### [2.8.5] - 2026-05-11

**Improvements**:
- Aligned release docs and CLI help automation with static registry flow
- Ensured `npm run docs:release-assets` generates correct metadata
- Validated registry artifacts before deployment

---

## Major Feature Additions (Recent Months)

### AI-Readable UI Blocks Bridge (v2.8.x series)
- **Feature**: `eai blocks` command for AI agents to discover and interact with UI components
- **Commands**: `eai blocks list`, `eai blocks validate`
- **Purpose**: Enable AI agents (Claude, Codex, Gemini, Copilot) to scaffold UI using catalog
- **Impact**: Streamlines vertical app UI development with AI assistance

### Profile-Based Multi-Environment Support (v2.7.x series)
- **Feature**: `--profile` flag for switching between dev, test, prod environments
- **Storage**: Per-profile token and context isolation
- **Purpose**: Developers can work across multiple platform environments
- **Impact**: Eliminates need for multiple CLI installations

### Static npm Registry on GitHub Pages (v2.6.x series)
- **Feature**: Self-hosted npm registry at `https://eai-tools.github.io/eai/registry`
- **Purpose**: Eliminate npmjs dependency, full control over distribution
- **Impact**: Simplified release process, no external account required

### Gofer AI Asset Management (v2.5.x series)
- **Feature**: `eai gofer refresh` for safe Gofer asset updates
- **Commands**: `eai gofer refresh --check`, `eai gofer refresh --force`
- **Purpose**: Update AI terminal assets (Claude, Codex, Gemini, Copilot) without overwriting local edits
- **Impact**: Safe evolution of Gofer pipeline as CLI improves

### Template Drift Detection (v2.4.x series)
- **Feature**: `eai template check` previews template changes without writing files
- **Purpose**: Let developers see what changed in vertical template before merging
- **Impact**: Reduces risk of accidentally overwriting custom code

---

## Breaking Changes

### None in v2.8.x Series

The v2.8.x series maintains backward compatibility with v2.7.x. All changes are additive or internal improvements.

### Last Breaking Change: v2.6.0 (2026-04-15)
- Switched from npmjs to GitHub Pages static registry
- Requires one-time registry configuration: `npm config set @eai-tools:registry https://eai-tools.github.io/eai/registry/ --location=user`
- Old installations continue to work but won't receive updates until registry is reconfigured

---

## Deprecations

### Deprecated in v2.7.0
- **Deprecated**: Passing tenant ID via `TENANT_ID` environment variable
- **Replacement**: Use `eai tenant select` to establish tenant context
- **Reason**: Membership-driven tenant selection is more secure and accurate
- **Timeline**: Environment variable fallback will be removed in v3.0.0

### Deprecated in v2.5.0
- **Deprecated**: `eai init --no-gofer` default behavior
- **Replacement**: Gofer assets now installed by default
- **Reason**: Most users want AI terminal integration
- **Timeline**: No removal planned, flag remains for bare scaffolds

---

## Known Issues

### Current (v2.8.13)

**Issue**: `eai env pull --include-secrets` requires Azure CLI authentication  
**Impact**: Medium — Users must run `az login` before pulling secrets  
**Workaround**: Authenticate with `az login`, or manually add secrets to `.env.local`  
**Status**: Working as designed (Azure CLI is the secure auth method)

**Issue**: `eai deploy trigger` fails if `GITHUB_TOKEN` not set  
**Impact**: Low — Only affects deployment automation  
**Workaround**: Set `GITHUB_TOKEN` in `.env.local` or use GitHub UI  
**Status**: Working as designed (token required for API access)

**Issue**: Update check may fail on networks with strict egress filtering  
**Impact**: Low — Update notifications won't appear, but CLI functions normally  
**Workaround**: Check for updates manually via GitHub Releases  
**Status**: No fix planned (silent failure is acceptable)

---

## Architectural Changes

### Recent (v2.7.0 → v2.8.13)

**Profile Isolation**:
- Moved from shared `~/.eai/tokens.json` to per-profile `~/.eai/tokens/{profile}.json`
- Improved tenant context caching with 1-hour TTL
- Enhanced membership validation on tenant selection

**Gofer Manifest Evolution**:
- Added `modifiedLocally` flag to track user edits
- Improved hash comparison for conflict detection
- Better backup strategy for replaced files

**Block Catalog Integration**:
- Added `src/lib/block-catalog.ts` for parsing UI component metadata
- Introduced `src/lib/block-catalog-validation.ts` for schema validation
- New `src/commands/blocks.ts` command module

---

## Performance Improvements

### v2.8.x Series

**Token Caching**:
- Reduced unnecessary token refreshes by validating `expiresAt` before API calls
- Membership cache TTL prevents excessive `/v3/tenants/memberships` calls

**Update Check Throttling**:
- Update checks limited to once per 24 hours
- Non-blocking background checks don't delay command execution

**Gofer Refresh Optimization**:
- Hash-based change detection avoids full file comparisons
- Only modified files are backed up (not entire repo)

---

## Security Updates

### v2.8.x Series

**Supply Chain Hardening** (commit 24134b4):
- Enhanced npm dependency integrity checks
- Validated package hashes before installation
- Improved security posture for npm ecosystem risks

**Token File Permissions**:
- Enforced `0o600` file mode on `~/.eai/tokens.json`
- Validated file ownership on read
- Prevented accidental permission escalation

---

## Documentation Updates

### v2.8.13

**Technical Documentation**:
- Comprehensive `.tech-docs/` refresh with all 10 files
- Updated architecture diagrams with Mermaid
- Clarified API endpoints and request/response schemas
- Added data model entity relationship diagrams
- Enhanced configuration documentation with all sources
- Detailed deployment process with CI/CD workflows
- Complete dependency graph with risk assessment
- Code quality and patterns review

**AI-Readable Documentation**:
- Regenerated `llms.txt` with latest command structure
- Updated `llms-full.txt` with comprehensive CLI reference
- Refreshed `cli-help.txt` with all command help output

**GitHub Pages**:
- Deployed latest documentation site to `https://eai-tools.github.io/eai`
- Updated 93 pages of user-facing docs

---

## Migration Guides

### Migrating from v2.7.x to v2.8.x

**No Breaking Changes** — v2.8.x is fully backward compatible.

**Optional Enhancements**:

1. **Use Profile System** (if working with multiple environments):
   ```bash
   # Create dev profile
   eai login --profile dev
   
   # Switch between profiles
   eai --profile dev tenant list
   eai --profile prod tenant list
   ```

2. **Update Gofer Assets** (if using AI terminals):
   ```bash
   # Preview changes
   eai gofer refresh --check
   
   # Apply safe updates
   eai gofer refresh
   ```

3. **Check Template Drift** (if project is older than CLI version):
   ```bash
   # See what changed in template
   eai template check
   
   # Manually review and copy changes
   ```

---

### Migrating from v2.6.x to v2.7.x

**Breaking Change**: Tenant selection mechanism changed.

**Before (v2.6.x)**:
```bash
# Set tenant ID in .env.local
echo "TENANT_ID=tenant-123" >> .env.local
eai resources list User
```

**After (v2.7.x)**:
```bash
# Select tenant via CLI (membership-driven)
eai login
eai tenant select
eai resources list User
```

**Migration Steps**:
1. Run `eai login` to authenticate
2. Run `eai tenant select` and choose your tenant
3. Remove `TENANT_ID` from `.env.local` (optional, still works but deprecated)

---

## Roadmap

### Planned for v2.9.0 (Q3 2026)

- [ ] Offline mode for `eai dev` (local mock gateway)
- [ ] Interactive Object Type builder (`eai types define`)
- [ ] Bulk resource import (`eai resources import --file data.json`)
- [ ] Cloudflare tunnel integration (`eai tunnel`)

### Planned for v3.0.0 (Q4 2026)

- [ ] **Breaking**: Remove `TENANT_ID` environment variable support
- [ ] **Breaking**: Require Node.js 22+
- [ ] Plugin system for custom commands
- [ ] Workspace support (monorepo multi-vertical)
- [ ] Built-in health monitoring dashboard

---

## Contributors

- **EAI Tools Team** — Core development and maintenance
- **Nightly Documentation Pipeline** — Automated technical documentation
- **Renovate Bot** — Dependency updates and security patches

---

## Feedback and Issues

Report bugs and feature requests at: [https://github.com/eai-tools/eai/issues](https://github.com/eai-tools/eai/issues)

Full documentation: [https://eai-tools.github.io/eai](https://eai-tools.github.io/eai)
