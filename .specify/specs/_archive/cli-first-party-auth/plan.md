# Implementation Plan: CLI First-Party Browser Auth

## Goal

Bring the implementation, tests, and feature artifacts into agreement around
browser-based first-party auth with PKCE.

## Workstreams

### 1. Stabilize auth runtime behavior

- keep `login.ts` on the built-in public client
- make auth storage paths resolve dynamically from the current home directory
- preserve encrypted token persistence and refresh compatibility

### 2. Stabilize integration coverage

- route `eai` test commands through the local built CLI entrypoint
- isolate tokens under each test environment
- add explicit login coverage for browser callback success/failure
- make interactive init coverage deterministic without terminal-specific hacks

### 3. Align feature artifacts and docs

- rewrite `.specify/specs/cli-first-party-auth/` to describe browser PKCE
- remove stale device-flow language from architecture/security glossary docs

## Files

| File | Responsibility |
|---|---|
| `src/lib/auth.ts` | runtime token storage and PKCE browser auth |
| `tests/helpers/action-dsl.ts` | local CLI execution in tests |
| `tests/helpers/setup-dsl.ts` | isolated auth-state setup |
| `tests/integration/login.test.ts` | browser login coverage |
| `tests/integration/init.test.ts` | deterministic interactive branch coverage |
| `tests/integration/verify-calls.test.ts` | contract audit expectations and auth isolation |
| `.specify/specs/cli-first-party-auth/*` | feature traceability artifacts |
| `docs/src/content/docs/concepts/*.mdx` | public auth architecture/security docs |

## Verification Plan

1. `npm run build`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. rerun Gofer validation against `cli-first-party-auth`
