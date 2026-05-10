---
name: gofer:zoom-out
description: Show how the current feature connects to broader system boundaries.
agent: copilot-workspace
tools:
  - Read
  - Grep
  - Glob
  - Bash
  - WebSearch
argument-hint: feature-name-or-description
gofer:
  workflowProfile: enterpriseai
  canonicalSource: .specify/commands/gofer_zoom_out.md
  canonicalChecksum: e42e56e75cff49c45d92540206747c189871f096d8573fb168d4987c8044119c
  metadataSource: scripts/generate-commands.ts
---


# Gofer Zoom Out

Expand the current feature into its surrounding system context and write the
result to `.specify/specs/{feature}/zoom-out-report.md`.

Use this helper when the feature needs broader architectural framing: upstream
dependencies, downstream consumers, or cross-cutting risks that are easy to
miss inside a narrow task view.

When you run this helper:

1. Read the approved feature-local artifacts and identify the current boundary
   being changed.
2. Map the upstream inputs, downstream consumers, and cross-cutting impacts that
   materially affect the feature.
3. Keep the output feature-local and architecture-focused.
4. Write the artifact only to
   `.specify/specs/{feature}/zoom-out-report.md`.
5. If the target file already exists, replace it and prepend a regeneration note
   such as `<!-- regenerated at [ISO timestamp] -->`.
6. Include the minimum provenance schema:
   - `GeneratedAt`
   - `SourceCommandId`
   - `SourceInputs`
   - `OverwriteNoticeWhenApplicable`

The generated zoom-out report must contain these sections:

- `## Provenance`
- `## Current Boundary`
- `## Upstream/Downstream`
- `## Cross-Cutting Impact`

Keep the content Gofer-owned. Do not copy upstream Matt Pocock skill text
verbatim.
