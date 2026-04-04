# Tasks: CLI First-Party Browser Auth

## Runtime

- [x] Keep `eai login` on the built-in first-party public client ID.
- [x] Remove runtime reliance on `--client-id`.
- [x] Resolve auth storage paths dynamically from the current home directory.
- [x] Preserve encrypted token storage and refresh-token compatibility.

## Tests

- [x] Route integration tests through the local built CLI rather than a global
  `eai` binary.
- [x] Isolate auth token storage per test environment.
- [x] Add executable browser-login integration coverage.
- [x] Make the interactive `init` branch deterministic.
- [x] Update contract-audit tests to run without ambient auth state.

## Documentation and Traceability

- [x] Rewrite feature artifacts to describe browser PKCE instead of the legacy
  auth UX.
- [x] Update architecture, security, and glossary docs to remove stale auth
  descriptions.
- [x] Rerun validation after code and docs are aligned.
