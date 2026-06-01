---
name: gofer:tdd
description: "Guide a red-green-refactor loop tied to spec acceptance criteria."
title: 'Gofer TDD'
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

# Gofer TDD

## Token And Cost Policy
<!-- gofer:token-cost-policy:start -->

Before spawning agents, calling tools, or loading large files:

1. Treat `.specify/memory/gofer-model-policy.yaml` as the repo-owned source of truth for simple, medium, hard, and arbiter model routing. If it is missing, run `/gofer:bootstrap-workspace` before continuing.
2. Use the cheapest capable model first.
   - Claude: Haiku for scouting/extraction; Sonnet for normal implementation, synthesis, validation, and security; Opus for high-risk arbitration or release-critical failures.
   - Codex/OpenAI: GPT mini for simple coding; GPT nano only for locate/classify/summarize/mechanical work; GPT-5.3-Codex or flagship GPT for tool-heavy coding, architecture, and release-critical validation.
   - Gemini: Flash-Lite for cheap large-context scan/summarize; Flash for default research synthesis; Pro for large-context architecture or high-risk arbitration.
   - Copilot: prefer Auto for simple and default work; ask the user before choosing a paid/high-tier picker model for hard security, architecture, or release gates.
3. Keep raw tool output out of the main conversation context. Save stable findings to `.specify/specs/{feature}/context-bundle.md`, then work from summaries.
4. Use provider prompt/context caching only for stable, non-secret prefixes: Gofer scaffold, AGENTS/CLAUDE/Copilot instructions, constitution, repo map, stage contracts, and validation rubric.
5. Before continuing after large research, planning, implementation, or validation bursts, checkpoint the durable artifacts and compact/clear/resume context when the host supports it.
6. Escalate model tier only when a cheaper pass is low-confidence, contradictory, security-sensitive, or blocking release quality.
<!-- gofer:token-cost-policy:end -->

Guide a red-green-refactor loop for the active feature and write the cycle log
to `.specify/specs/{feature}/tdd-session.md`.

Use this helper when you want to work test-first inside the existing Gofer
implementation flow without replacing `/5_gofer_implement` or `/9_gofer_tests`.

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
