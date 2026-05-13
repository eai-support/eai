---
feature: "026-public-platform-builder-experience"
repo: "eai CLI"
status: implemented
created: "2026-05-12T00:00:00Z"
---

# Implementation Plan

## Technical Context

This PR implements the public workflow readiness CLI surface and keeps the Gofer specification artifacts under `.specify/specs/026-public-platform-builder-experience/` aligned with the source changes.

## Current PR Scope

- Add `eai workflow readiness`, `eai workflow status`, and `eai workflow request` commands.
- Route all workflow readiness checks through PublicAPI only.
- Surface public-safe statuses and workflow refs without printing raw runtime workflow ids.
- Add integration tests for the new CLI/PublicAPI contract.

## File Structure

```text
.specify/specs/026-public-platform-builder-experience/
  proposal-review.md
  research.md
  spec.md
  plan.md
  data-model.md
  quickstart.md
  tasks.md
  traceability.md
  validation.md
```

## Implementation Roadmap

1. Bootstrap the Gofer artifacts in this PR.
2. Implement workflow readiness/status/request commands and API client parsers.
3. Add repo-specific tests for request URLs, JSON parsing, and CLI output.
4. Run CI and `$6_gofer_validate` after implementation reaches green.
5. Regenerate `.tech-docs/` for this repository after runtime implementation
   lands, then let the central `tech-docs` aggregation workflow publish the
   updated technical documentation into Docusaurus.

## Documentation Propagation Gate

Generated technical documentation for this repository is owned by `.tech-docs/`
and aggregated by the central `tech-docs` nightly/docs workflow. Follow-up
implementation PRs must refresh `.tech-docs/`, pass the generated-docs
validation contract, and verify central aggregation/build before release.

## Risk Assessment

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Public docs leak private details | Security/commercial exposure | Public/private validation scans and content review |
| Spec PR mistaken for runtime implementation | Delivery confusion | Validation explicitly scopes this PR as bootstrap only |
| Follow-up implementation loses traceability | Rework | Keep repo-owned plan/tasks/traceability artifacts |
