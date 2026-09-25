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
- [x] Enforce the regional allowlist at the managed PublicAPI client boundary, including legacy source-unknown calls (DTE-091).
- [x] Reject linked ancestors for doctor evidence output (DTE-036, DTE-061, DTE-080).
- [x] Reject every nonregular governed configuration entry in both the CLI and embedded collector (DTE-018, DTE-095).
- [x] Update owned tests and traceability.
- [x] Run prescribed checks and record exact results.

## Exact-head evidence

- `npm run verify:managed-deploy-producer` passed for app-template candidate `1d44646e9fddaaf39c9b8c975b1dbf8557e543d5` with exact workflow (`sha256:a61e943ab997ae3353054d3800f332f783869b7fadddbeeddf17c91d145536b8`) and collector (`sha256:0f11d25c6d55b26c596950368905fb2adc7d74a4486551b3f405b9a870178406`) byte parity.
- `npm run build`, `npm run lint`, and `npm run typecheck` passed.
- Focused managed-deployment/API tests passed: 255 tests across eight files.
- `npm run test:eai-cli:ci` passed: 902 tests, one documented skip.
- `npm test` and `bash scripts/release-preflight.sh` passed: 1,017 tests, one documented skip, plus packed CLI, alias, and generated documentation checks.
- `npm run release:check` stopped at the intentional immutable producer-release gate because no template tag yet resolves to candidate `1d44646e9fddaaf39c9b8c975b1dbf8557e543d5` (DTE-088).
