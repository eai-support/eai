# AGENTS.md

**Project**: {{projectName}} | **Language**: {{language}}{{frameworkLine}} |
**Package Manager**: {{packageManager}}

## Commands

{{commands}}

## Code Style

{{codeStyle}}

## Testing

{{testing}}

## Git Workflow

{{gitWorkflow}}

## Gofer Pipeline

This project uses Gofer for spec-driven development. Run `/eai` to start or
continue the core pipeline (Gofer Start -> research -> specify -> plan -> tasks
-> implement -> validate). Use `#eai` in Copilot-style prompts and `$eai` in
hosts that use dollar-prefixed skills. Gofer
routes internally through `.specify/commands/*.md` contracts; validation is the
terminal quality gate and includes the final engineering review loop. Before EAI
readiness, classify the request: app delivery continues directly, while clear
non-app work asks once before skipping EAI tenant/app setup. Artifacts in
`.specify/specs/{feature}/`.

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal
  code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer
  standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid
  introducing bugs.
