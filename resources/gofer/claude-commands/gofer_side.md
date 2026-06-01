
# Gofer Side Conversation

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
