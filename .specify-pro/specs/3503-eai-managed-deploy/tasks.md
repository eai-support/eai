# Tasks

- [x] Record 2026-09-25 approval and preserved user contract.
- [x] Merge current `main` without force-pushing.
- [x] Require the exact target tenant before any managed request (DTE-010–DTE-011).
- [x] Enforce browser-linked/local GitHub actor equality (DTE-009).
- [x] Hash complete governed source configuration and provenance in both modes, excluding only deterministic generated Object Type outputs (DTE-018, DTE-095).
- [x] Make dispatch claim and lost-response recovery idempotent (DTE-031–DTE-035).
- [x] Bind nonce and managed URL/origin allowlists on every path (DTE-032, DTE-091).
- [x] Add portable operation-bound doctor output (DTE-036, DTE-061, DTE-080).
- [x] Sync and verify template candidate bytes/schema; preserve deferred release gate (DTE-019–DTE-021, DTE-088).
- [x] Update owned tests and traceability.
- [x] Run prescribed checks and record exact results.

## Exact-head evidence

- `npm run verify:managed-deploy-producer` passed for app-template candidate `97277cb5278a5e30c59a57beea070e954e6864af`.
- `npm run build`, `npm run lint`, and `npm run typecheck` passed.
- Focused managed-deployment tests passed: 236 tests with one documented skip across six files.
- `npm run test:eai-cli:ci` passed: 894 tests, one documented skip.
- `npm test` passed: 1,009 tests, one documented skip.
- `bash scripts/release-preflight.sh` passed, including packed CLI and alias smoke checks.
- `npm run release:check` stops at the intentional immutable producer-release gate until app-template publishes a new tag for the exact candidate commit (DTE-088).
