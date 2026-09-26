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
- [x] Sync app-template candidate `e401ac1003b5143c8a1f33cc084138f1301340bb` and its exact workflow/collector bytes (DTE-019–DTE-021, DTE-088).
- [x] Reject unsafe legacy exact-operation path segments before URL construction (DTE-031–DTE-035).
- [x] Require the original regional PublicAPI URL in every loaded retry state (DTE-031, DTE-032, DTE-091).
- [x] Update owned tests and traceability for the final review findings.
- [x] Rerun prescribed checks and record exact-head results after these changes.
- [x] Verify canonical remote workflow and collector bytes at the resolved release tag commit (DTE-019–DTE-021, DTE-088).
- [x] Require exact platform-sealed `workflowBlobSha` and `collectorDigest` source revision identity (DTE-019–DTE-021, DTE-032, DTE-080).
- [x] Revalidate governed configuration and bounded source opened inodes against the contained path before reading (DTE-016, DTE-018, DTE-095).
- [x] Write doctor evidence and local recovery receipts through a confined opened regular-file descriptor (DTE-016, DTE-036, DTE-061, DTE-080).
- [x] Rerun prescribed checks and record exact-head results after the final trusted-producer and path-race fixes.

## Exact-head evidence

- `npm run verify:managed-deploy-producer` passed for app-template candidate `e401ac1003b5143c8a1f33cc084138f1301340bb` with exact workflow (`sha256:aad4908a902a99f2b2ab6a60c73ed4418c8d7e49a91bc27be4d59a9f6effd582`) and collector (`sha256:45dff7374bdce9a57cf2baaa567c18cdcb1fc872f57f3d2950f484837754861a`) byte parity.
- `npm run build`, `npm run lint`, and `npm run typecheck` passed.
- Focused managed-deployment and API tests passed: 251 tests across six files, including deterministic parent/file-swap, unsafe legacy operation-path, missing retry-endpoint, and producer-identity rejection.
- `npm run test:eai-cli:ci` passed: 925 passed and one documented skip (926 total).
- `npm test` and `bash scripts/release-preflight.sh` passed: 1,039 passed and one documented skip (1,040 total), plus packed CLI, alias, and generated documentation checks.
- `npm run release:check` stopped at the intentional immutable producer-release gate because no template tag yet resolves to candidate `e401ac1003b5143c8a1f33cc084138f1301340bb` (DTE-088).
