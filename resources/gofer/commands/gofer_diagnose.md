---
name: gofer:diagnose
description: "Run a reproduce-minimize-instrument-fix loop for bugs and failing tests."
title: 'Gofer Diagnose'
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

# Gofer Diagnose

Run a structured reproduce-minimize-instrument-fix investigation and write the
results to `.specify/specs/{feature}/diagnose-report.md`.

Use this when an implementation, test, or integration is failing and you need a
portable, evidence-backed debugging record that stays inside the feature
directory.

When you run this helper:

1. Start from the actual failure evidence already present in the session:
   failing output, stack traces, logs, screenshots, or a concrete bug report.
2. Reproduce the failure as directly as possible.
3. Minimize the problem to the smallest reliable failing slice.
4. Instrument the likely fault boundaries to prove or disprove hypotheses.
5. Record the recommended fix path without inventing evidence.
6. Write the artifact only to
   `.specify/specs/{feature}/diagnose-report.md`.
7. If the target file already exists, replace it and prepend a regeneration note
   such as `<!-- regenerated at [ISO timestamp] -->`.
8. Include the minimum provenance schema:
   - `GeneratedAt`
   - `SourceCommandId`
   - `SourceInputs`
   - `OverwriteNoticeWhenApplicable`

The generated diagnose report must contain these sections:

- `## Provenance`
- `## Reproduce`
- `## Minimize`
- `## Instrument`
- `## Fix`

Keep the content Gofer-owned. Do not copy upstream Matt Pocock skill text
verbatim.
