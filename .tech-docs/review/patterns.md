---
generated: true
generated_at: "2026-06-01T09:00:09.000Z"
source_commit: "5a2b88a3a98c40d9b88476b34bd8fc66aa2d5037"
---
# EAI CLI — Patterns & Tech Debt

## Overview

This document reviews the design patterns, anti-patterns, and technical debt in
the EAI CLI codebase at `@eai-tools/cli` v2.9.5. It is public-facing, so it
avoids private environment details and focuses on patterns visible in the
repository.

The companion code-quality review covers scores and validation evidence. This
page focuses on how the code is shaped and where the next refactors should
reduce change cost.

## Current Shape

| Area | Current evidence | Pattern health |
| --- | ---: | --- |
| Command modules | 20 files in `src/commands/` | Strong command ownership |
| Shared library modules | 24 files in `src/lib/` | Good separation by concern |
| PublicAPI client | 1,279 lines in `src/lib/api.ts` | Useful facade, now too large |
| Largest commands | `verify.ts` 1,702 lines, `init.ts` 1,692 lines | Mature workflows, high change cost |
| Runtime dependencies | 5 production npm dependencies | Small and easy to audit |
| Integration tests | 23 integration test files | Good behavioral safety net |

## Positive Patterns

### 1. Command Module Pattern

**Location**: `src/commands/*.ts`

Each command group is a focused Commander.js module exported from its own file.
This keeps the CLI entrypoint small and makes command ownership easy to scan.

Current command groups:

- `init`, `dev`, `login`, `whoami`, `tenant`, `user`, `provision`
- `types`, `resources`, `chat`, `docs`, `workflow`
- `env`, `deploy`, `verify`, `update`
- `gofer`, `template`, `blocks`, `vertical`

**Why it works**:

- Commands are discoverable by filename.
- Help text lives close to command behavior.
- Integration tests can target user workflows without reaching into private
  helpers.

**Watch point**:

- The pattern is still good, but large command files should keep extracting
  workflow helpers as behavior grows.

### 2. Facade Pattern For PublicAPI

**Location**: `src/lib/api.ts`

`PlatformAPIClient` hides route paths, headers, request bodies, and response
translation behind typed methods. Commands can call a named method instead of
constructing raw URLs.

**Current v4 route families**:

- `/v4/platform`
- `/v4/identity`
- `/v4/data/resources`
- `/v4/data/documents`
- `/v4/workflows`
- `/v4/ai`
- `/v4/integrations`

**Why it works**:

- The v4 route constants make old API-version vocabulary easier to detect.
- The `tests/integration/no-v3-runtime.test.ts` guard prevents runtime source
  from calling `/v3/` routes.
- Shared server-error parsing preserves status, server code, message, request
  ID, and debug body context.

**Watch point**:

- At 1,279 lines, this facade is becoming a god module. The next healthy shape
  is a small shared request core plus separate clients for resources, identity,
  platform, workflows, AI, documents, and integrations.

### 3. Strategy Pattern For Context Resolution

**Locations**: `src/lib/config.ts`, `src/lib/tenant-context.ts`,
`src/lib/context.ts`

The CLI resolves project, tenant, and PublicAPI context through ordered
strategies instead of hard-coding one source.

Examples:

- Project discovery checks project config files and package metadata.
- PublicAPI resolution checks named profile override, project/process
  `BASE_URL_PUBLIC_API`, stored tenant home region, authenticated session
  routing, then the public default.
- Command context resolution centralizes active tenant and API URL discovery.

**Why it works**:

- Local app projects, public users, and organization-managed setups can share
  one CLI without embedding private defaults.
- Tenant-aware regional routing stays behind one boundary.

**Watch point**:

- Keep the order documented in public terms. Avoid exposing private profile
  examples or internal environment names.

### 4. Repository Pattern For Local State

**Locations**: `src/lib/auth.ts`, `src/lib/profile.ts`,
`src/lib/project-manifest.ts`

Local state is behind helper functions rather than being read and written
directly from commands.

Examples:

- Token storage is handled by the auth/profile layer.
- Profile settings are loaded through `profile.ts`.
- Gofer/template refresh state is tracked through `.eai-manifest.json` helpers.

**Why it works**:

- Commands do not need to know where tokens or manifests live.
- File modes and redaction rules can be improved centrally.
- Tests can mock behavior at module boundaries.

**Watch point**:

- Token refresh is still process-local. Cross-process coordination would make
  concurrent CLI usage safer.

### 5. Introspection Builder Pattern

**Location**: `src/lib/schema-builder.ts`

The `--describe` surface is built from the Commander.js command tree. This
lets tools and agents inspect commands, options, defaults, enum choices, and
subcommands without scraping human help output.

**Why it works**:

- The schema stays aligned with real command registration.
- Automation gets a stable JSON-oriented entrypoint.
- The implementation is small and isolated.

**Watch point**:

- Keep this schema backward compatible if external agents begin depending on
  it directly.

### 6. Output Adapter Pattern

**Location**: `src/lib/output.ts`

Output helpers centralize text formatting, JSON formatting, color behavior,
screen-reader-friendly simple mode, and sensitive-value redaction.

**Why it works**:

- Commands get consistent output behavior.
- Secret-like values are redacted before text or JSON output.
- Public trust is better because debug/output paths do not casually leak
  bearer tokens or JWT-looking strings.

**Watch point**:

- YAML output is intentionally not implemented. New docs and examples should
  describe supported output as text and JSON unless a command explicitly
  supports more.

### 7. Manifest-Backed Refresh Pattern

**Locations**: `src/lib/gofer-refresh.ts`, `src/lib/gofer-installer.ts`,
`src/lib/project-manifest.ts`

Gofer assets are refreshed by comparing manifests and file hashes rather than
blindly overwriting local work.

**Why it works**:

- `eai gofer refresh --check` gives a preview before writes.
- Modified managed files are detected.
- Forced replacements create backups before overwrite.

**Watch point**:

- The refresh options are still centered around a `force` flag. That is
  understandable at the command line, but internal helper APIs would be clearer
  with a named options shape such as `overwriteModified`.

## Anti-Patterns And Technical Debt

### 1. Oversized PublicAPI Facade

**Location**: `src/lib/api.ts`

**Issue**: `PlatformAPIClient` owns every v4 route family and has grown to
1,279 lines.

**Impact**: Medium/high. It is still functional, but route changes now require
reviewers to hold too much unrelated context.

**Recommendation**:

- Keep a shared request helper for headers, tracing, retries, redaction-safe
  debug output, and error parsing.
- Split domain clients by v4 route family:
  - `resources-client.ts`
  - `identity-client.ts`
  - `platform-client.ts`
  - `workflow-client.ts`
  - `ai-client.ts`
  - `documents-client.ts`
  - `integrations-client.ts`

### 2. Oversized Workflow Commands

**Locations**: `src/commands/verify.ts`, `src/commands/init.ts`,
`src/commands/types.ts`, `src/commands/resources.ts`

**Issue**: The largest command modules mix orchestration, validation, output,
and API calls.

**Impact**: Medium. These commands are important and well-tested, but future
changes will be slower and riskier unless helpers continue moving into
`src/lib/`.

**Recommendation**:

- Extract diagnostic checks from `verify.ts` into focused modules.
- Extract scaffold steps from `init.ts` into reusable workflow helpers.
- Keep command files responsible for command wiring and user-facing output.

### 3. Mixed Direct Fetch And Helper-Based Requests

**Location**: `src/lib/api.ts`

**Issue**: Some API methods use `publicRequest()`, while others still issue
direct `fetch()` calls.

**Impact**: Medium. This increases the chance that future retries, trace
headers, timeout behavior, or error translation are applied inconsistently.

**Recommendation**:

- Move all PublicAPI calls through one shared request path.
- Keep direct `fetch()` only where streaming behavior genuinely requires it,
  and document that exception near the method.

### 4. Compatibility Vocabulary Debt

**Locations**: `src/commands/vertical.ts`, workflow/app provisioning payloads,
tests, and compatibility command help

**Issue**: Current contracts still contain terms such as `vertical`,
`verticalKey`, and `tenant-vertical-enrollment`.

**Impact**: Medium for public docs; low for runtime correctness. These names
are compatibility contracts and should not be broken casually, but new public
wording should use application/app terminology.

**Recommendation**:

- Keep compatibility identifiers until a planned migration removes them.
- Prefer application/app wording in new docs, UI copy, and future command
  aliases.
- Add aliases before removing any existing command names.

### 5. Token Refresh Coordination

**Location**: `src/lib/auth.ts`

**Issue**: Token refresh is coordinated inside a single CLI process, but not
across multiple simultaneous CLI processes.

**Impact**: Low/medium. This is an edge case for normal users but can appear in
automation.

**Recommendation**:

- Add a lightweight file lock or cross-process guard around refresh writes.
- Keep refresh failure non-destructive; failed refresh should fall back to
  login guidance.

## Refactoring Roadmap

### Now

1. Keep public docs current with v2.9.5 and PublicAPI v4.
2. Add a release/public-readiness scanner for known private host patterns and
   stale doc markers.
3. Route all generated/public docs surfaces through the same source set.

### Next

1. Split `src/lib/api.ts` by v4 route family.
2. Extract `verify.ts` checks into small diagnostic modules.
3. Extract `init.ts` scaffold stages into workflow helpers.
4. Normalize direct fetch calls behind one request helper.

### Later

1. Add public app/application command aliases alongside compatibility commands.
2. Add cross-process token refresh coordination.
3. Add complexity or large-file reporting to CI so growth remains visible.

## Spec And Docs Alignment

The public repo currently has partial `.specify` assets but not the full Gofer
stage-command workspace. For public docs, the reliable source of truth is the
combination of:

- TypeScript source under `src/`
- Integration tests under `tests/integration/`
- Release docs under `.tech-docs/`
- Published Docusaurus pages under `docs-site/`
- Generated release assets under `docs-site/static/`

For this docs refresh, route-version alignment is additionally guarded by
`scripts/verify-api-reference.cjs`, which checks the review docs against
`src/lib/api.ts`.

## Conclusion

The CLI has strong patterns: command modules, shared library boundaries, a v4
PublicAPI facade, centralized output redaction, manifest-backed refreshes, and
runtime introspection for agents. The main technical debt is not a broken
architecture; it is scale pressure in the biggest modules.

The recommended direction is evolutionary: keep public behavior stable, split
large modules by current v4 boundaries, and keep generated documentation tied
to the same source files that reviewers and agents read.

**Overall Pattern Score: 8/10**.
