---
generated: true
generated_at: "2026-06-01T08:48:50.000Z"
source_commit: "302da4e9a1a3771338ace8dcfa025026db313887"
---
# EAI CLI — Code Quality Review

## Overview

This document reviews the EAI CLI codebase at `@eai-tools/cli` v2.9.5. It is
written for a public repository audience, so it avoids private environment
names, tenant-specific values, and internal infrastructure details.

The review is based on the current TypeScript source, package manifest,
Docusaurus documentation surface, integration tests, and Gofer workspace
preflight evidence.

## Gofer Validation Note

The public repo contains part of the Gofer scaffold, but the full stage-command
workspace is not present. In particular, the local preflight found these
missing pieces:

- `.specify/commands/0_business_scenario.md`
- `.specify/scripts/node/parse-stage-command.mjs`
- `.specify/specs/`
- `.specify/memory/`

Because this is a docs-only public-repo cleanup, this review used a fast Gofer
validation lane rather than bootstrapping private/internal Gofer structure into
the public repository:

1. Compare the live docs page with the current source.
2. Recompute source, test, dependency, and route-version evidence.
3. Refresh the public-facing review document.
4. Run focused docs, build, lint, typecheck, and test validation.
5. Confirm blast radius is limited to documentation.

## Current Codebase Snapshot

| Metric | Current value | Assessment |
| --- | ---: | --- |
| Package version | `2.9.5` | Current public release line |
| TypeScript source files | 45 | Healthy for a focused CLI |
| Command modules | 20 | Clear command-level ownership |
| Library modules | 24 | Good separation of shared behavior |
| Integration test files | 23 | Strong behavior coverage for CLI workflows |
| Total test/support files | 35 | Appropriate for release-facing CLI tooling |
| Production dependencies | 5 | Small runtime dependency footprint |
| Development dependencies | 8 | Reasonable for TypeScript, linting, and Vitest |

Largest files by line count:

| File | Lines | Review note |
| --- | ---: | --- |
| `src/commands/verify.ts` | 1,702 | Broad diagnostic command; good candidate for helper extraction |
| `src/commands/init.ts` | 1,692 | Large scaffolding workflow; should continue moving reusable logic into libraries |
| `src/lib/api.ts` | 1,279 | Central PublicAPI client; should be split by API surface as v4 grows |
| `src/commands/types.ts` | 1,234 | Data-model command surface is mature but dense |
| `src/commands/resources.ts` | 1,055 | Resource workflows are feature-rich; keep extracting format/validation helpers |

## Readability: 8/10

### Strengths

- Command modules still follow a predictable Commander.js pattern: declare the
  command, parse options, validate prerequisites, call the API/client helper,
  and format the result.
- Shared concerns are separated into `src/lib/` modules for API calls, auth,
  tenant context, output formatting, cloud configuration, Gofer integration,
  update checks, and error codes.
- Most public behavior is discoverable from command help, integration tests,
  and focused helper names.
- Output helpers centralize redaction and TTY-aware formatting, which keeps
  command code more consistent.
- TypeScript strict mode remains the main readability guard: data shapes are
  explicit, and unsafe `unknown` handling is usually narrowed before use.

### Areas To Improve

- `verify.ts`, `init.ts`, and `api.ts` are now large enough that local changes
  require more context than they should. Split by concern before adding more
  diagnostics, scaffolding branches, or PublicAPI v4 routes.
- Some compatibility language remains in command names and payload fields, such
  as `vertical`, `verticalKey`, and `tenant-vertical-enrollment`. These are
  current contract names rather than preferred public wording, but new docs and
  user-facing copy should prefer `application` and `app`.
- `src/lib/api.ts` uses clean v4 path constants, but the class still owns many
  unrelated API groups. Splitting it into resource, identity, platform,
  workflow, AI, document, and integration clients would make the v4 surface
  easier to review.

## Correctness: 9/10

### Strengths

- Runtime PublicAPI calls are v4-native. The client defines v4 path groups such
  as `/v4/platform`, `/v4/identity`, `/v4/data/resources`, `/v4/data/documents`,
  `/v4/workflows`, `/v4/ai`, and `/v4/integrations`.
- `tests/integration/no-v3-runtime.test.ts` guards against reintroducing
  `/v3/` routes in runtime source files.
- Tenant context is explicit. Commands resolve a tenant from authenticated
  membership data, stored active-tenant metadata, or an explicit command
  option.
- Authentication uses browser-based authorization code flow with PKCE and
  stores local tokens through the auth/profile layer.
- API error parsing preserves status, server code, server message, request ID,
  and raw response text for debug paths.
- Integration tests exercise resource CRUD, workflow/provisioning flows,
  tenant behavior, login, verification, document classification, and v4 route
  guards.

### Areas To Improve

- Several methods in `src/lib/api.ts` still issue direct `fetch()` calls rather
  than going through one shared request helper. Consolidating request behavior
  would make headers, retries, tracing, and error translation harder to forget.
- Token refresh is still process-local. Multiple CLI processes can refresh at
  the same time; file locking or a small cross-process refresh guard would make
  this more robust.
- File-path handling is mostly local-user tooling, not a server-side boundary,
  but commands that read user-supplied files should continue moving toward
  explicit path normalization and clearer error messages.

## Security And Public Readiness: 9/10

### Strengths

- Public documentation no longer needs private profile examples, environment
  hostnames, or tenant-specific infrastructure details.
- The default PublicAPI URL in source is the public Australia endpoint:
  `https://api.au.myenterprise.ai/public`.
- Private profile support remains in code for organization-managed setups, but
  it is intentionally not promoted in public docs.
- Output redaction covers bearer tokens, JWT-looking values, and common
  sensitive assignments before printing text or JSON.
- Cloud configuration commands require an explicit app-configuration store
  environment variable. They do not embed private store names in source.
- Runtime dependencies are deliberately small: `chalk`, `commander`, `dotenv`,
  `inquirer`, and `ora`.

### Areas To Improve

- Keep scanning docs, tests, fixtures, release assets, and GitHub Actions for
  accidental private environment references before every public release.
- Avoid documenting local profile internals beyond the minimum needed for user
  safety. The profile file exists, but public docs should describe supported
  CLI behavior rather than internal environment-switching details.
- Consider a release check that fails if public docs contain known private
  host patterns or unsupported environment names.

## Performance: 8/10

### Strengths

- The CLI has a small runtime dependency set and low startup overhead.
- Update checks are non-blocking, skipped in CI/non-TTY contexts, and cached in
  `~/.eai/update-check.json` for 24 hours.
- Tenant membership data and active tenant selection avoid prompting on every
  command once the user has selected a tenant.
- Resource APIs support pagination, cursors, streaming endpoints, batch
  create/update/delete, aggregate queries, and cross-type query endpoints.

### Areas To Improve

- Add retry/backoff for transient network failures where commands call
  PublicAPI. This should be shared request behavior, not copied into each
  command.
- Parallelize independent readiness checks in diagnostic flows where the user
  experience benefits and the APIs can handle it.
- Keep large response handling paginated or streaming by default. Avoid adding
  commands that load unbounded result sets into memory.

## Maintainability: 7/10

The repo is healthy, but maintainability is the main area to watch. The command
surface has grown faster than the internal API-client shape.

Recommended next refactors:

1. Split `src/lib/api.ts` by v4 public interface group.
2. Extract `verify.ts` diagnostics into focused check modules.
3. Extract `init.ts` scaffolding steps into reusable workflow helpers.
4. Add a shared PublicAPI request helper with retry, tracing, redaction-safe
   debug output, and consistent error translation.
5. Keep compatibility command names stable until a deliberate migration plan
   removes them, but make all new public wording application/app-oriented.

## Test And Validation Expectations

For docs-only changes to this page, the expected validation set is:

- `npm run docs:release-assets:check`
- `npm --prefix docs-site run build`
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `git diff --check`
- Search checks for stale version labels, old update-cache filenames, private
  hostnames, and old environment examples

For code changes that touch CLI behavior, add or update integration tests near
the affected command. For API-contract changes, update the route guard and
PublicAPI-facing tests in the same PR.

## Key Recommendations

### High Priority

1. Split the PublicAPI client by v4 route family so route ownership stays clear
   as more interfaces move to v4.
2. Extract the largest command files before adding more user workflows.
3. Add a docs/public-readiness scanner to release checks so private environment
   details cannot drift back into public pages.

### Medium Priority

4. Add shared retry/backoff for transient PublicAPI failures.
5. Add cross-process coordination for token refresh.
6. Continue replacing new public-facing "vertical" wording with
   application/app language while preserving compatibility where needed.

### Low Priority

7. Consider coverage thresholds once the test suite stabilizes around v4.
8. Add a lightweight complexity report to keep future large-file growth visible.

## Conclusion

Overall code quality is strong for a public TypeScript CLI. The strongest
signals are strict typing, a small dependency footprint, secure auth patterns,
v4 PublicAPI route guards, redacted output helpers, and broad integration tests.

The main risk is not correctness today; it is future change cost. The CLI is
ready to be public-facing, but the next engineering pass should reduce the size
of the largest command modules and split the v4 API client before the route
surface grows again.

**Overall Code Quality: 8.5/10**.
