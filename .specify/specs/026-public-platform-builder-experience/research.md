---
feature: "026-public-platform-builder-experience"
repo: "eai CLI"
stage: research
created: "2026-05-12T00:00:00Z"
---

# Research

## Repository Role

eai CLI is responsible for Public command-line builder experience.

## Findings

- Strategy Monitor exposed a gap between what public builders need and what the current public platform surface explains or automates.
- Public developer workflows must use PublicAPI-backed commands, support documents, Gofer guidance, and generated template docs.
- Private implementation details belong in platform service repos and operator processes, not in public website pages, CLI help, generated app docs, or Gofer public-facing output.
- This PR adds the repository-owned Gofer artifacts needed before runtime implementation begins.

## Integration Evidence

- Coordinating feature pack: `.specify/specs/026-public-platform-builder-experience/` in tech-docs.
- Repo-owned spec: `.specify/specs/026-public-platform-builder-experience/spec.md`.
- Repo-owned plan and tasks: `.specify/specs/026-public-platform-builder-experience/plan.md` and `.specify/specs/026-public-platform-builder-experience/tasks.md`.

## Constraints

- No runtime behavior is changed by this PR.
- Follow-up implementation PRs must add real tests and rerun Gofer validation against code changes.
- Public-facing output must avoid private service names, cloud internals, privileged runbooks, and commercial enforcement internals.
