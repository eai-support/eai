
# Gofer Plan Mode Toggle

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
