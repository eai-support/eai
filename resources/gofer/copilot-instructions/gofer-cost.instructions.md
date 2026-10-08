---
applyTo: '**'
---

# Gofer Token And Cost Policy

Before running Gofer stages, spawning agents, or loading large files:

- Treat `.specify/memory/gofer-model-policy.yaml` as advisory policy. Choose the
  lowest-cost model qualified by a fresh signed host receipt and independent
  benchmark evidence. Do not select a model from a static name or price.
- Escalate only when a cheaper qualified pass is low-confidence, contradictory,
  security-sensitive, release-critical, or blocking quality.
- Keep raw search, build, and test output out of the main chat context. Write
  stable findings to `.specify/specs/{feature}/context-bundle.md` and continue
  from summaries.
- Prefer provider prompt/context caching for stable non-secret prefixes: Gofer
  scaffold, repository instructions, constitution, repo map, stage contracts,
  and validation rubric.
- After large research, planning, implementation, or validation bursts,
  checkpoint artifacts and compact/clear/resume context when the host supports
  it.
