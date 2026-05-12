---
feature: "026-public-platform-builder-experience"
repo: "eai CLI"
status: implemented
created: "2026-05-12T00:00:00Z"
---

# Tasks

## Current PR Tasks

- [x] T001 Create repo-owned Feature 026 specification at `.specify/specs/026-public-platform-builder-experience/spec.md`.
- [x] T002 Add research and approved proposal artifacts.
- [x] T003 Add implementation plan, data model, quickstart, and traceability artifacts.
- [x] T004 Add Gofer validation artifact for the specification/bootstrap PR.
- [x] T005 Record the repo-local `.tech-docs/` regeneration and central
      `tech-docs` aggregation gate for follow-up implementation PRs.
- [x] T006 Add workflow readiness/status/request commands.
- [x] T007 Add PublicAPI client methods and status parsing for public builder readiness.
- [x] T008 Keep CLI help/output on the public side of the platform boundary.
- [x] T009 Add integration coverage for workflow command requests and parser behavior.

## Follow-Up Documentation Gate

Source-changing implementation PRs must update this repository's `.tech-docs/`
snapshot, pass generated-docs validation, and verify central Docusaurus
aggregation before release.

## Protected Boundaries

- Public-facing docs must not expose private platform internals.
- CLI output must not expose raw runtime workflow ids or private service instructions.
