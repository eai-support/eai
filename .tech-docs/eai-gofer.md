---
generated: false
title: eai-gofer
---

# eai-gofer

eai-gofer is the repo-local agent workflow pack installed and refreshed by the
EAI CLI. It gives coding agents consistent instructions, templates, references,
and validation checklists for EAI delivery work.

## What It Installs

`eai gofer refresh` manages public-safe files such as:

- `.specify/commands/*`
- `.specify/templates/*`
- `.specify/references/platform/*`
- `.github/prompts/*`
- `.github/copilot-instructions.md`
- `.eai-manifest.json`

The manifest records managed files so refreshes can detect local edits instead
of blindly overwriting them.

## Refresh Workflow

```bash
eai gofer refresh --check
eai gofer refresh
```

Use `--check` before committing to see what would change. Use `--force` only
when you intentionally want managed files overwritten after review.

## Gofer Start Pipeline

Start the project with `eai start`, then use the public `eai` skill in the AI
workspace. The agent begins with the business outcome, researches the existing
system, writes a testable business specification, and asks for approval once.
After approval it plans, builds, tests, and validates the work unless a material
business, security, cost, deployment, or destructive decision needs approval.

The numbered Gofer stage files remain available as internal execution
contracts. Users and AI agents do not need to select or understand them.

## EAI App Delivery Rules

When gofer helps generate or modify an EAI app, it should:

1. Use `https://github.com/eai-support/eai-app-template` as the canonical public
   scaffold.
2. Inspect `src/eai.config`, `src/eai.blocks.tsx`, `src/hooks`, and the
   platform service docs before inventing calls.
3. Use Object Types for tenant business data.
4. Use `useResources` for ResourceAPI-backed data.
5. Use `useDocuments` for upload, classification, and RAG indexing.
6. Use `useChat` for AI workflow calls.
7. Keep browser calls behind `/api/eai/...` or `/api/eai/stream/...`.
8. Keep callbacks and React nodes out of config and in runtime overrides.
9. Record unsupported capabilities as blocked instead of inventing code paths.

## Service-Fit Evidence

For app work, gofer plans should capture:

- selected Object Types and storage backend
- component registry and config slots
- store bindings and `showWhen` rules
- ResourceAPI, document, chat, search, and PublicAPI choices
- commands used to verify tenant state
- risks, rollback, and validation evidence

## Related Pages

- [EAI App Template](./eai-app-template.md)
- [Platform Service Patterns](./app-template/service-patterns.md)
- [Config-Driven UI](./app-template/config-driven-ui.md)
- [Scenario Library](/scenarios/)
