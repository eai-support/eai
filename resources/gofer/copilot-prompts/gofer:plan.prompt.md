---
name: gofer:plan
description: Toggle plan mode in the active CLI session for the next user prompt; non-pipeline control command.
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
  canonicalSource: .claude/commands/gofer:plan.md
  canonicalChecksum: fd86cccc2fe623a6ef6041af7d16c311dce97bd52f7377f4c394e4ddcd43e129
  metadataSource: scripts/generate-commands.ts
---


# Gofer Plan Mode Toggle

When invoked, this command signals the host CLI to enter plan mode for the next
user prompt, requesting a structured plan instead of immediate execution. Use it
before complex changes to align on approach.

This control command is distinct from `/gofer:plan-stage`, which runs the full
plan stage of the Gofer pipeline (the `3_gofer_plan` source-of-truth file).
`gofer:plan` is a session-level toggle: it does not load Gofer specs, dispatch
planning subagents, or write `plan.md` artifacts. It simply asks the active CLI
host (Claude Code, Copilot CLI, or the VSCode extension) to surface its native
plan-mode UX so you can review the plan before any tools run.

The toggle is one-shot: it applies to the next prompt only, then auto-clears.
Re-invoke `gofer:plan` whenever you want plan-mode behavior again. If the host
CLI does not support plan mode, this command is a no-op and the next prompt
proceeds as normal.
