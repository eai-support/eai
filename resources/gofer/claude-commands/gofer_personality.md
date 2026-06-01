
# Gofer Personality

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
