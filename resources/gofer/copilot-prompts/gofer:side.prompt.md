---
name: gofer:side
description: Open a side conversation in the active CLI without disturbing the main pipeline state; resumable.
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
  canonicalSource: .claude/commands/gofer:side.md
  canonicalChecksum: d6478b91e1238bf5b1ae5787230bafadc5dfa5a5dd3f2a1bcd85eeffdb9a8ae6
  metadataSource: scripts/generate-commands.ts
---


# Gofer Side Conversation

Open a side conversation in the active CLI without disturbing the main Gofer
pipeline state. Use this when you need to ask a quick clarifying question, run
an exploratory search, or test an idea without polluting the working stage
transcript or advancing the pipeline.

Side conversations are scoped to the active session and are fully resumable:
when you exit the side channel, the main pipeline context is restored exactly as
it was, including the current stage, feature directory, and any pending
auto-chain target. Memory writes inside the side channel are flagged so they are
not auto-promoted into pipeline artifacts.

Typical uses:

- Asking "what does this function do?" mid-implement without losing tasks state
- Comparing two design options before committing to one
- Running an unrelated `/gofer:research` query against the same codebase

To return to the main pipeline, exit the side channel; the next prompt resumes
the prior stage. Side-channel transcripts are saved under
`.specify/logs/side-channel/<timestamp>.jsonl` for later review.
