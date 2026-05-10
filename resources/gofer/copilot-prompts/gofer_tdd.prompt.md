---
name: gofer:tdd
description: Guide a red-green-refactor loop tied to spec acceptance criteria.
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
  canonicalSource: .specify/commands/gofer_tdd.md
  canonicalChecksum: c6792a024bb9514eafd9fe08018e160be2fcce5d14d52c7fe12ac7b55d694255
  metadataSource: scripts/generate-commands.ts
---


# Gofer TDD

Guide a red-green-refactor loop for the active feature and write the cycle log
to `.specify/specs/{feature}/tdd-session.md`.

Use this helper when you want to work test-first inside the existing Gofer
implementation flow without replacing `#5_gofer_implement` or `#9_gofer_tests`.

When you run this helper:

1. Read the feature acceptance criteria and the current task scope before
   proposing test changes.
2. Define the smallest failing test that proves the next slice of behavior is
   missing.
3. Keep the cycle explicit: red, green, then refactor.
4. Record only feature-local artifacts and paths.
5. Write the artifact only to `.specify/specs/{feature}/tdd-session.md`.
6. If the target file already exists, replace it and prepend a regeneration note
   such as `<!-- regenerated at [ISO timestamp] -->`.
7. Include the minimum provenance schema:
   - `GeneratedAt`
   - `SourceCommandId`
   - `SourceInputs`
   - `OverwriteNoticeWhenApplicable`

The generated TDD session must contain these sections:

- `## Provenance`
- `## Acceptance Criteria Linkage`
- `## Red`
- `## Green`
- `## Refactor`

Keep the content Gofer-owned. Do not copy upstream Matt Pocock skill text
verbatim.
