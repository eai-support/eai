---
generated: true
generated_at: "2026-09-21T22:03:01.864Z"
source_commit: "8bc76a23ee69066b54726e8040fa51cadde58e6b"
---
# Documentation Changelog

## 2026-09-21

- Generated the canonical architecture, overview, data-model, dependencies,
  deployment, and review documentation from commit
  `8bc76a23ee69066b54726e8040fa51cadde58e6b`.
- Reconciled the documentation model with the current CLI entry point,
  PublicAPI v4 allow-list, PKCE authentication, profile state, object-type
  contracts, and GitHub Actions workflows.
- Recorded that the repository owns no database or active `.specify/specs/`
  feature manifest; remote platform schemas are documented as external
  contracts rather than guessed physical tables.

## Baseline comparison

Existing `.tech-docs/` pages already documented the CLI, configuration, API
reference, app template, Gofer, errors, and examples. Those pages remain in
place. This update adds the required service-level architecture and operations
views without retiring existing material or altering `.tech-docs/legacy-src/`.

## 2026-09-18 baseline

The existing `start-here.md` records CLI version `3.16.0` and a material
template change: scaffolding is pinned to published releases rather than the
latest template branch. The release workflow and package manifest remain the
authoritative version and publication sources.
