---
id: "cli-first-party-auth"
title: "CLI First-Party Browser Auth"
status: "draft"
created: "2026-04-04"
updated: "2026-04-04"
priority: "medium"
assignee: "engineer-agent"
---

# Feature Specification: CLI First-Party Browser Auth

## Summary

`eai login` must authenticate with Microsoft Entra CIAM using a built-in
first-party public client and OAuth 2.0 authorization code flow with PKCE. The
CLI must not require `ENTRA_CLIENT_ID` or expose a `--client-id` override.

## User Stories

### US-01: Login without per-project auth setup

As a CLI user, I can run `eai login` on a clean machine and complete sign-in in
my browser without editing `.env.local`.

Acceptance criteria:

- `eai login` starts browser-based sign-in with PKCE.
- The CLI uses the built-in first-party client ID.
- Automatic browser launch failure surfaces a manual authorize URL.
- Successful login stores tokens locally for later CLI commands.

### US-02: No client-ID override on the CLI surface

As a platform maintainer, I want the CLI auth surface to be centrally owned, so
users cannot pass arbitrary client IDs at runtime.

Acceptance criteria:

- `eai login --help` does not mention `--client-id`.
- Passing `--client-id` results in an unknown-option error.
- Login does not read `ENTRA_CLIENT_ID` from project config for CLI auth.

### US-03: Scaffolds omit CLI-only client ID requirements

As a new project owner, I want generated config to reflect the shipped auth
model, so I do not think a CLI client ID is required for `eai login`.

Acceptance criteria:

- `eai init` does not scaffold `ENTRA_CLIENT_ID` for CLI login purposes.
- `eai verify` and `eai dev` do not fail because `ENTRA_CLIENT_ID` is missing
  for the CLI.

### US-04: Verification and tests match production behavior

As a maintainer, I need validation artifacts and tests to describe the current
browser-PKCE flow so Gofer validation reflects reality.

Acceptance criteria:

- Feature artifacts under `.specify/specs/cli-first-party-auth/` describe
  browser PKCE, not device flow.
- Integration coverage exists for successful browser callback login.
- Contract-audit and auth-related tests are deterministic in parallel runs.

## Functional Requirements

### FR-01: Built-in first-party client

The CLI must use a hardcoded first-party public client ID for login.

### FR-02: Browser authorization code flow with PKCE

The auth library must:

- generate a PKCE verifier/challenge pair
- start a localhost callback server
- open the authorize URL in the browser
- validate callback state
- exchange the returned authorization code for tokens

### FR-03: Local encrypted token persistence

Stored tokens must remain encrypted on disk and continue to support refresh
token exchange.

### FR-04: No runtime client-ID override

`eai login` must not accept `--client-id` or require `ENTRA_CLIENT_ID` to
perform CLI login.

### FR-05: Supporting commands stay compatible

`eai init`, `eai verify`, and `eai dev` must not imply that CLI login depends
on project-scoped client-ID configuration.

### FR-06: Validation and docs stay aligned

Specs, plans, tasks, quickstarts, and public auth architecture docs must
describe browser PKCE and localhost callback behavior.

## Non-Functional Requirements

- No new runtime dependencies.
- Login must fail clearly when browser launch or token exchange fails.
- Tests must remain deterministic under Vitest parallel execution.
- Auth storage must resolve the home directory dynamically at runtime rather
  than only at module import time.

## Verification Targets

- `npm run build`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `node dist/index.js login --help`
- `node dist/index.js login --client-id abc123`
