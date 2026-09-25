# Issue #3503: canonical managed deployment client

## Approval and scope

The owner approved this hardening scope on 2026-09-25. The approval covers the reviewed security, identity, provenance, recovery, and evidence fixes while preserving the successful deployment journey. It does not authorize merge, release, deployment, activation, billing, or destructive live tests.

Canonical amendment: https://github.com/enterpriseaigroup/Issues2025/issues/3503#issuecomment-5826177803

## Preserved user contract

- `eai deploy app <app-key> --target eai` remains canonical.
- Every initial, resume, and retry command supplies the exact `--target-tenant-id`; same-tenant deployments repeat `--tenant-id` explicitly.
- `eai-managed` and `customer-owned` remain explicit source choices.
- EAI-maintained publication remains bot-owned; customers do not push to or merge in an EAI repository.
- Customer-owned source remains governed in the customer's repository.
- Existing successful status vocabulary and resume/retry commands remain supported.
- Gofer guides; the CLI and platform execute.

## Requirements

- **DTE-009 through DTE-011, DTE-014:** require an explicit runtime tenant and bind the exact browser-link session plus numeric GitHub identity to the local `gh` actor that performs customer-owned repository actions.
- **DTE-016:** retain bounded, no-follow local publication and complete source digests.
- **DTE-018, DTE-095:** compute and submit one exact `configHash` through no-follow file handles over every governed configuration source and runtime-provenance input, including nested files and the deployment contract, for both source modes. Exclude only the two deterministic generated Object Type outputs, and reject links plus every nonregular filesystem entry, so the CLI and collector hash the same checked-out source manifest before and after generation.
- **DTE-019, DTE-020, DTE-021, DTE-088:** consume exact template candidate bytes now, validate workflow inputs and collector parity, and keep the immutable released tag/commit as a deferred release gate without predicting a version. The release gate must resolve the declared tag from the canonical template repository and prove that it names the exact reviewed candidate commit.
- **DTE-023, DTE-025:** consume the template's immutable supply-chain pins and credential isolation.
- **DTE-031 through DTE-035:** bind dispatch, resume, and retry to the exact operation, nonce, actor, tenant, source, workflow, artifact, and target; make dispatch recovery safe after a lost response or crash; never select a latest operation.
- **DTE-091:** enforce the regional PublicAPI allowlist at the authenticated client boundary for all managed and legacy source-unknown calls, allowlist every browser-link, upload, and status origin before sending credentials, and reject redirects across those authority boundaries.
- **DTE-036, DTE-061, DTE-080:** add portable, operation-bound doctor evidence while retaining the existing URL-only doctor command. Authenticated readiness requires the passing canonical `GET /api/eai/readiness` probe, not an unrelated authenticated smoke test. Evidence output must reject a link in every parent component before writing owner-only bytes.
- **DTE-086, DTE-087:** integrate current `main` semantically and rerun repository-owned checks on the exact head.

## Acceptance

1. The embedded workflow and evidence collector match the approved template candidate byte-for-byte and declare every CLI dispatch input; release remains blocked until a real canonical template tag resolves to that candidate commit.
2. A wrong browser-link session, local GitHub actor, nonce, tenant, source, workflow, or target fails before mutation.
3. A crash or lost dispatch response resumes the same operation without duplicate dispatch or an endless poll-only state.
4. Every managed PublicAPI route, including legacy source-unknown setup/deploy/status routes, and every browser upload/status origin is allowlisted before credentials are sent; redirects are rejected.
5. Doctor JSON can be written portably through a fully no-link parent path and binds readiness to the exact completed deployment operation; authenticated readiness passes only when the canonical readiness probe successfully uses its declared secret in a request header.
6. Owned CLI tests and release metadata checks exercise these contracts.
7. Help and consumer contracts expose the required initial `--source`, browser continuation `--github-link-session`, and exact `--target-tenant-id` controls.
8. Missing `--target-tenant-id` fails before identity, status, linking, upload, or repository requests in both source modes.
