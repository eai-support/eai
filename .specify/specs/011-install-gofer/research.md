# Research: 011 - Install Gofer

Date: 2026-04-13

## Scope

Investigate the Gofer app assets and define what `eai init` must install into a newly scaffolded vertical repo so Claude CLI, Codex CLI, Gemini CLI, and GitHub Copilot can use the same Gofer workflow from the AI terminal.

## Findings

- The Gofer VS Code extension ships canonical assets under the Gofer repo resource tree: Claude commands, Claude agents, Copilot prompts, Copilot instructions, bash scripts, PowerShell scripts, Node scripts, hook scripts, instruction templates, and planning templates.
- `eai init` already owns the vertical scaffold boundary, so this is the correct integration point for copying AI workflow assets into the generated repo after the template is cloned and customized.
- Claude CLI expects repo-local `.claude/commands` and `.claude/agents` content.
- Codex and Gemini can consume local skill directories, so Gofer commands are converted into `SKILL.md` files under `.system/skills` and `.agents/skills`.
- GitHub Copilot can consume repo prompts and instructions from `.github/prompts` and `.github/instructions`. Copilot CLI skill names are safer as lower-case hyphenated names, so local skill mirrors are written under `.github/skills`.
- `.specify` remains the shared runtime folder for scripts, templates, hooks, specs, logs, and memory folders.
- The npm package must include the vendored Gofer resources, otherwise a globally installed `eai` binary cannot initialize them outside the source checkout.

## Decisions

- Install Gofer assets by default in `eai init`.
- Add `--no-gofer` for a bare vertical scaffold.
- Keep resource copying in `src/lib/gofer-installer.ts` so `src/commands/init.ts` stays focused on command flow.
- Vendor Gofer resources under `resources/gofer` and include `resources` in the package files list.
- Update CLI help, README, docs, tests, and static registry release metadata for version `2.0.5`.

