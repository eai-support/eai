# Decisions

## 2026-09-25 owner approval

Implement all reviewed client hardening while preserving successful commands, source modes, status vocabulary, and ownership boundaries. Do not merge, release, deploy, activate, bill, or run destructive live tests.

## Producer pin before release

The template feature is not released. Record its exact candidate commit and content digests and enforce byte/schema parity now. Keep the final immutable release tag/commit explicitly unresolved until the producer is merged and released. Do not predict or reuse a version.

## Doctor compatibility

Keep URL-only black-box doctor behavior. Add optional deployment-operation bindings and a portable evidence-output option; managed deployment completion uses the stronger receipt.

## Explicit runtime tenant

The owner confirmed on 2026-09-25 that `--target-tenant-id` is mandatory on the initial command for both source modes as well as resume and retry. This prevents tenant inference and preserves same-tenant deployment by repeating the app-scope tenant value explicitly.

## Unified operation success

Use the additive unified operation response defined for Issue #3503. Terminal success requires root `sourceStatus` in `handoff_pending` or `completed`, active root and deployment status, `doctor.ready: true`, matching deployment and doctor identities, and a complete `sourceRevision` whose operation, source, tenant, application, environment, configuration, workflow, commit, artifact, image, repository, installation, and run fields match the root operation. Do not infer success from the TenantInfra projection alone.

## Local evidence and configuration paths

Treat caller-selected evidence as untrusted local input: open it without following the final link, prove the opened object is the same bounded regular file, and only then parse its canonical schema. For configuration hashing, reject a linked or non-directory component beneath the application root and recheck ancestors immediately before every no-follow file read; a lexical in-root path does not authorize a linked ancestor.
