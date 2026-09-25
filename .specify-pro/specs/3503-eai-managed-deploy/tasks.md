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
- [x] Include `.test.*` and `.spec.*` governed files in both CLI and collector configuration hashing while excluding only the two generated outputs (DTE-018, DTE-095).
- [x] Bind every local publication file's no-follow descriptor to the inode that passed its initial metadata check (DTE-016).
- [x] Preserve the standard nested JSON error envelope and split command/source-client implementations below 300 lines behind existing public paths (DTE-086, DTE-087).
- [x] Sync app-template candidate `8a23ae44c5f8308e9a65e8251f8d9c89d0ab7794` and its exact workflow/collector bytes (DTE-019–DTE-021, DTE-088).
- [x] Reject unsafe legacy exact-operation path segments before URL construction (DTE-031–DTE-035).
- [x] Require the original regional PublicAPI URL in every loaded retry state (DTE-031, DTE-032, DTE-091).
- [x] Update owned tests and traceability for the final review findings.
- [x] Rerun prescribed checks and record exact-head results after these changes.

## Exact-head evidence

- `npm run verify:managed-deploy-producer` passed for app-template candidate `8a23ae44c5f8308e9a65e8251f8d9c89d0ab7794` with exact workflow (`sha256:9a971ff5ba4d6fa1d73c6664d781b40f0b4b20bb809d62d1f808b0a0363e62e8`) and collector (`sha256:36395105aa61363e74dfb6f7484ef0ad7dca881544386d056b07ae2a6db6f898`) byte parity.
- `npm run build`, `npm run lint`, and `npm run typecheck` passed.
- Focused managed-deployment and API tests passed: 247 tests across six files, including deterministic file-swap, unsafe legacy operation-path, and missing retry-endpoint rejection.
- `npm run test:eai-cli:ci` passed: 920 passed and one documented skip (921 total).
- `npm test` and `bash scripts/release-preflight.sh` passed: 1,035 passed and one documented skip (1,036 total), plus packed CLI, alias, and generated documentation checks.
- `npm run release:check` stopped at the intentional immutable producer-release gate because no template tag yet resolves to candidate `8a23ae44c5f8308e9a65e8251f8d9c89d0ab7794` (DTE-088).
