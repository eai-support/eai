---
name: gofer:vocabulary
description: Extract domain terminology into a canonical feature glossary.
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
  canonicalSource: .specify/commands/gofer_vocabulary.md
  canonicalChecksum: 8ebad3720bfefd6da61879221a06f41e9fc8a1626d7173483b2086f62c0302f3
  metadataSource: scripts/generate-commands.ts
---


# Gofer Vocabulary

Extract the feature's shared domain language into a canonical glossary and
write it to `.specify/specs/{feature}/glossary.md`.

Use this when research, specification, contracts, or implementation rely on
terms that need stable definitions across Claude, Copilot, Codex, and Gemini
surfaces.

When you run this helper:

1. Read the feature-local context that already exists (`research.md`, `spec.md`,
   `plan.md`, `contracts/`, `quickstart.md`) and ignore unrelated repository
   content.
2. Identify project-specific terms, acronyms, role names, workflow names, and
   overloaded words that need precise definitions.
3. Write the artifact only to `.specify/specs/{feature}/glossary.md`. Never
   write to repo root or any provider-specific surface directory.
4. If the target file already exists, replace it and prepend a regeneration note
   such as `<!-- regenerated at [ISO timestamp] -->`.
5. Include the minimum provenance schema:
   - `GeneratedAt`
   - `SourceCommandId`
   - `SourceInputs`
   - `OverwriteNoticeWhenApplicable`

The generated glossary must contain these sections:

- `## Provenance`
- `## Term Entries`
- `## Definitions`
- `## Source Artifacts`

Keep the content Gofer-owned and concise. Do not copy upstream Matt Pocock
skill text verbatim.
