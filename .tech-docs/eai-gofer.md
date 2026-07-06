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

For app or platform work, start with the Gofer Start workflow. The current
pipeline stages are:

| Stage               | Purpose                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `0_gofer_start`     | Confirm EAI readiness, frame the business goal, and route the pipeline.       |
| `1_gofer_research`  | Discover stakeholders, existing code, platform capabilities, and constraints. |
| `2_gofer_specify`   | Convert discovery into a feature specification and shared scope.              |
| `3_gofer_plan`      | Plan architecture, tests, rollback, service usage, and delivery sequencing.   |
| `4_gofer_tasks`     | Break the plan into implementation tasks.                                     |
| `5_gofer_implement` | Implement with tests and focused changes.                                     |
| `6_gofer_validate`  | Validate correctness, security, integration, tests, and release readiness.    |

Optional helpers include `0a_problem_validation`, `7_gofer_save`,
`7a_stakeholder_comms`, `8_gofer_branding`, `9_gofer_tests`, and
`10_gofer_cloud`.

## EAI App Delivery Rules

When gofer helps generate or modify an EAI app, it should:

1. Use `https://github.com/eai-tools/eai-app-template` as the canonical public
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
