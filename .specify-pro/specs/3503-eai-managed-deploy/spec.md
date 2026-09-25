# Issue #3503: canonical managed deployment client

## Approval and scope

The owner approved this hardening scope on 2026-09-25. The approval covers the reviewed security, identity, provenance, recovery, and evidence fixes while preserving the successful deployment journey. It does not authorize merge, release, deployment, activation, billing, or destructive live tests.

## Preserved user contract

- `eai deploy app <app-key> --target eai` remains canonical.
- `eai-managed` and `customer-owned` remain explicit source choices.
- EAI-maintained publication remains bot-owned; customers do not push to or merge in an EAI repository.
- Customer-owned source remains governed in the customer's repository.
- Existing successful status vocabulary and resume/retry commands remain supported.
- Gofer guides; the CLI and platform execute.

## Requirements

- **DTE-009, DTE-014:** bind the browser-linked numeric GitHub identity to the local `gh` actor that performs customer-owned repository actions.
- **DTE-016:** retain bounded, no-follow local publication and complete source digests.
- **DTE-018:** hash every governed configuration and runtime-provenance input, including nested files and the deployment contract.
- **DTE-019, DTE-020, DTE-021, DTE-088:** consume exact template candidate bytes now, validate workflow inputs and collector parity, and keep the immutable released tag/commit as a deferred release gate without predicting a version.
- **DTE-023, DTE-025:** consume the template's immutable supply-chain pins and credential isolation.
- **DTE-031 through DTE-035:** bind dispatch, resume, and retry to the exact operation, nonce, actor, tenant, source, workflow, artifact, and target; make dispatch recovery safe after a lost response or crash; never select a latest operation.
- **DTE-091:** allowlist every PublicAPI, browser-link, upload, and status origin before sending credentials and reject redirects across those authority boundaries.
- **DTE-036, DTE-061, DTE-080:** add portable, operation-bound doctor evidence while retaining the existing URL-only doctor command.
- **DTE-086, DTE-087:** integrate current `main` semantically and rerun repository-owned checks on the exact head.

## Acceptance

1. The embedded workflow and evidence collector match the approved template candidate byte-for-byte and declare every CLI dispatch input.
2. A wrong local GitHub actor, nonce, tenant, source, workflow, or target fails before mutation.
3. A crash or lost dispatch response resumes the same operation without duplicate dispatch or an endless poll-only state.
4. Managed PublicAPI and browser upload/status origins are allowlisted before credentials are sent, and redirects are rejected.
5. Doctor JSON can be written portably and binds readiness to the exact completed deployment operation.
6. Owned CLI tests and release metadata checks exercise these contracts.
