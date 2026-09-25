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
- [x] Verify the eventual release tag against the canonical template remote before allowing a CLI release (DTE-019, DTE-088).
- [x] Reject a prepared publication that does not echo the exact browser-link session (DTE-009).
- [x] Count only the canonical authenticated readiness probe as authenticated readiness (DTE-036, DTE-080).
- [x] Update owned tests and traceability.
- [x] Run prescribed checks and record exact results.

## Exact-head evidence

- `npm run verify:managed-deploy-producer` passed for app-template candidate `fd588e83244d49fd7ed071ba5c163b298a825fb5` with exact workflow (`sha256:a61e943ab997ae3353054d3800f332f783869b7fadddbeeddf17c91d145536b8`) and collector (`sha256:b57d8a1b301812f12a6ba4874e4ed667959f160e41c58052e5f42544d4ef437d`) byte parity.
- `npm run build`, `npm run lint`, and `npm run typecheck` passed.
- Focused managed-deployment tests passed: 201 tests across seven files.
- `npm run test:eai-cli:ci` passed: 899 tests, one documented skip.
- `npm test` and `bash scripts/release-preflight.sh` passed: 1,014 tests, one documented skip, plus packed CLI and generated documentation checks.
- `npm run release:check` stopped at the intentional producer release gate because no immutable template release tag yet resolves to candidate `fd588e83244d49fd7ed071ba5c163b298a825fb5`.
- `npm test` passed: 1,009 tests, one documented skip.
- `bash scripts/release-preflight.sh` passed, including packed CLI and alias smoke checks.
- `npm run release:check` stops at the intentional immutable producer-release gate until app-template publishes a new tag for the exact candidate commit (DTE-088).
