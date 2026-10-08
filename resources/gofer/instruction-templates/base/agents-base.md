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

This project uses Gofer for spec-driven development. Run `/eai` on Claude,
Copilot, Antigravity, Grok, or VS Code to start or continue the core pipeline
(Gofer Start -> research -> specify -> plan -> tasks -> implement -> validate).
Use `$eai` on Codex. Gofer routes internally through
`.specify/commands/*.md` contracts; validation is the
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

## Support after an unresolved EAI error

After an `eai` command fails, run `eai errors explain <code-or-reason> --format json`.
Follow its diagnostics, approval requirements, and fixes once. Stop at its retry limit.
If the command still fails, prepare a report with
`eai support --source harness --tool <current-tool> --format json`.
Use `codex`, `claude`, `vscode`, `grok`, or `antigravity` for `<current-tool>`.
This command previews the locally redacted bundle in a noninteractive harness.
Show the person the bundle summary and ask for explicit consent in the chat.
Only after they approve that bundle, repeat the command with `--yes --no-open` and give them the returned link.
If the bundle changes, show it again and ask for fresh consent. Never assume consent or run `--yes` automatically.
Keep secrets, tokens, raw logs, and local `.env` values out of the chat.
The CLI creates the draft; the AI never calls the support API itself.
Report content stays in the draft body. The Support link fragment carries only its id and token.
If sign-in is unavailable, give the person the plain Support page link returned by the CLI.
In the welcome reply, say: If anything fails, say "get help" or type `eai support`; I can prepare a report for you to approve.
If the person asks for help with a silent failure, start with the same report preview.
