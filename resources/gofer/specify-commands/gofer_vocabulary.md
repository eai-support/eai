---
name: gofer:vocabulary
description: "Extract domain terminology into a canonical feature glossary."
title: 'Gofer Vocabulary'
category: control
surfaces:
  - claude
  - claude-mirror
  - copilot
  - vscode
  - codex
  - gemini
  - github-prompts
  - agents-skills
  - system-skills
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
