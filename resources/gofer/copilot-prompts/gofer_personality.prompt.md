---
name: gofer:personality
description: Set the assistant personality for this Gofer session: friendly, pragmatic, or none (default).
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
  canonicalSource: .specify/commands/gofer_personality.md
  canonicalChecksum: a4550e37f65b7f9140226caf4a3507bc9db6959038714f0cc984975278be2e79
  metadataSource: scripts/generate-commands.ts
---


# Gofer Personality

Set the assistant personality for the current Gofer session. The chosen preset
adjusts tone and verbosity without changing the technical content, artifacts, or
pipeline behavior of any stage.

Available presets:

- `friendly` — warmer, more conversational. Uses encouraging language and brief
  context-setting before action. Good for pairing sessions and demos.
- `pragmatic` — terse, no-nonsense, status-first. Skips pleasantries and reports
  outcomes in short bullets. Good for tight feedback loops and experienced
  operators who want signal density.
- `none` — default. Neutral, professional tone. No personality overlay; this is
  what the underlying CLI ships with.

The personality applies until cleared (`/gofer:personality none`) or the session
ends. It is a session-local setting and is not persisted across restarts. All
Gofer source-of-truth bodies, validation rubrics, and artifact templates are
unaffected — the only thing that changes is the phrasing of conversational
responses outside artifact files.
