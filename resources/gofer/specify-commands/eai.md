---
name: eai
description: "Start or continue EAI delivery, and prepare support reports with explicit human consent."
---

# EAI

Use this public entry point to start or continue EAI delivery.
Read `AGENTS.md` for project conventions. Keep numbered Gofer stages internal.
For app delivery, read and follow `.specify/commands/0_gofer_start.md`.
For an unresolved EAI error or a request to "get help", use the support flow below.

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
