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
- [x] Reject producer pin manifests that redirect either approved candidate to a noncanonical path (DTE-019, DTE-020, DTE-088).
- [x] Split the managed deployment library into focused modules under 300 lines without changing its public import path (DTE-086, DTE-087).
- [x] Require complete unified-operation source, revision, deployment, and doctor bindings before terminal success (DTE-032, DTE-035, DTE-036, DTE-080).
- [x] Read canonical workflow evidence through a bounded no-follow regular-file handle before authenticated submission (DTE-016, DTE-025).
- [x] Reject linked or non-directory ancestors in CLI and collector configuration hashing (DTE-018, DTE-020, DTE-095).
- [x] Update owned tests and traceability.
- [x] Rerun prescribed checks and record exact-head results after these changes.

## Exact-head evidence

- `npm run verify:managed-deploy-producer` passed for app-template candidate `f9b80a54cf0889b02514e958875e7343877e25e4` with exact workflow (`sha256:9a971ff5ba4d6fa1d73c6664d781b40f0b4b20bb809d62d1f808b0a0363e62e8`) and collector (`sha256:915ffbb98ba9c8aed2eaa823ae0b02701b859d805ec2157820bf7cb2085a4bec`) byte parity.
- `npm run build`, `npm run lint`, and `npm run typecheck` passed.
- Focused managed-deployment/API tests passed: 295 tests across eight files.
- `npm run test:eai-cli:ci` passed: 913 passed and one documented skip (914 total).
- `npm test` and `bash scripts/release-preflight.sh` passed: 1,028 passed and one documented skip (1,029 total), plus packed CLI, alias, and generated documentation checks.
- `npm run release:check` stopped at the intentional immutable producer-release gate because no template tag yet resolves to candidate `f9b80a54cf0889b02514e958875e7343877e25e4` (DTE-088).
