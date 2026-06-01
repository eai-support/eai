---
applyTo: "**"
---

# Gofer Token And Cost Policy

Before running Gofer stages, spawning agents, or loading large files:

- Treat `.specify/memory/gofer-model-policy.yaml` as the repo-owned model policy. Use Copilot `Auto` for simple/default work unless the user explicitly chooses a specific model.
- Use the cheapest capable model first. Escalate only when a cheaper pass is low-confidence, contradictory, security-sensitive, release-critical, or blocking quality.
- Keep raw search, build, and test output out of the main chat context. Write stable findings to `.specify/specs/{feature}/context-bundle.md` and continue from summaries.
- Prefer provider prompt/context caching for stable non-secret prefixes: Gofer scaffold, repository instructions, constitution, repo map, stage contracts, and validation rubric.
- After large research, planning, implementation, or validation bursts, checkpoint artifacts and compact/clear/resume context when the host supports it.
