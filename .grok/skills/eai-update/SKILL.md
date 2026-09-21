---
name: eai-update
description: "Install or update EAI Gofer for this AI coding app."
---

# Eai Update

Version: 3.12.7
Host: Grok Build

## Update EAI Gofer

Use this command to install or update EAI Gofer for the current AI coding app. This command works without an EAI project, a Gofer scaffold, or EAI sign-in.

## Update Contract

1. Do not run workspace checks, `eai init`, `eai whoami`, or pipeline stages.
2. Use `grok` as the current semantic host.
3. Check the current host first:
   `node <plugin-root>/.specify/scripts/node/gofer-surface-update.mjs --action inspect --host grok --json`
4. If the plugin root is not known, identify the installed plugin bundle before you run the helper.
5. State whether EAI Gofer is installed and whether the host command is available.
6. Explain the planned user-level change and ask for approval before any install or update command.
7. After approval, run one of these commands from the bundled helper:
   - Install: `node <plugin-root>/.specify/scripts/node/gofer-surface-update.mjs --action install --host grok --execute --json`
   - Update: `node <plugin-root>/.specify/scripts/node/gofer-surface-update.mjs --action update --host grok --execute --json`
8. After an actual install or update, the helper archives stale Gofer command and skill entries. It adds a small managed always-on instruction for Claude, Codex, Copilot, Antigravity, and VS Code. For Grok, it verifies the installed plugin's `skills/eai/SKILL.md` always-on contract instead of inventing a separate global instruction file. It keeps the current `eai` and `eai-update` entries. For Codex, a clean official local marketplace on `main` fast-forwards safely. A dirty, non-main, or unrecognised local marketplace remains unchanged and reports that its plugin update is incomplete while it still refreshes the always-on instruction. If the Codex marketplace source is unknown, it stops without changes.
9. Run only the selected host by default. Use `--host all` only when the user explicitly asks to install or update every detected host.
10. Show the required reload step from the helper output. Do not claim the command is ready until the host reloads.

## Supported Hosts

- Claude Code: refresh the marketplace and plugin, then run `/reload-plugins`.
- Codex: refresh a confirmed Git marketplace and apply the plugin, then start a new task or restart Codex. A clean official local `main` checkout fast-forwards and applies the plugin. Other local checkouts keep their work unchanged, refresh the always-on instruction, and report what needs attention. An unknown source stops the update to protect local work.
- GitHub Copilot: refresh the marketplace and plugin, then restart the CLI session or start a new app chat.
- Google Antigravity: install or reinstall the repository plugin with `agy`, then start a new Antigravity session.
- Grok Build: install or update the repository plugin with `grok`, then start a new Grok Build session.
- VS Code: install or update `EnterpriseAI.gofer`, then run **Developer: Reload Window**.

## Limits

- This command updates user-level plugins and extensions. It archives known stale Gofer entries and replaces only Gofer's managed instruction section. It does not remove unrelated user files or host-managed plugin caches. It does not add the repo-owned `.specify/` scaffold.
- For a repository scaffold, use `/eai add or refresh the Gofer scaffold for this repo` after the host update.
- Gemini files remain only for legacy file-format compatibility. Gemini is not a current updater host.
- Keep the full Gofer delivery pipeline unchanged. This command only manages its host installation.

**Blocker Mediation**

- Before repeating a failed action or asking for missing input, read .specify/references/blocker-mediation.md and inspect the private blocker register with gofer-blocker-control.mjs. Reuse the same state directory and goal, subject and condition keys across stages, restarts and surfaces. Different wording, models or tools do not create a new blocker.
- Classify the cause first. Missing user decisions, access, external dependencies and unavailable capabilities require a recorded wait. Reserve an ask event before asking; ask once, explain the business impact and required change, then stop affected work. An unanswered question is not new evidence. Do not poll or rephrase it to keep running.
- Technical ask events require a fresh verification file under .specify/references/priority-outcome-protection.md: actual diagnosis, self-cause check and why no authorized repair is available. Business choices need no failed command. For feature tasks, use gofer-priority-check.mjs and the saved direction before switching work; this does not start delivery during maintenance or conversation.
- For AI-solvable or unknown causes, reserve each attempt before execution. Allow one investigation and one different recovery within existing tighter budgets. Record its result even when interrupted or unsuccessful. An unfinished reservation must not launch again. Do not reset the register, change keys or switch surfaces to obtain more attempts.
- Resume only after a real user answer or changed external evidence has been recorded and checked. The helper allows one evidence-backed resumption; exhausted limits need human review. Never invent approval or evidence. Successful model output and a running server do not resolve a blocker without the relevant check.
- Save the blocker, unfinished tasks and next action before stopping. Continue only approved tasks that do not depend on it. Keep the original goal; update specs, plans, tasks and validation for accepted direction changes, and reopen stale checks. Do not quietly drop requirements to make progress.
- Use node .specify/scripts/node/gofer-blocker-control.mjs --state-dir <private-state-directory> --event <private-event.json> before controlled actions; inspect with --state-dir alone, or add --task T001 for an independent task. A denied action, invalid record or missing helper means stop and explain the limitation, not bypass it. Use the installed plugin script path if no repo scaffold exists. Conversation-only work uses a private session state directory and does not require app setup or feature files.
- Strict loop validation checks every recorded feature blocker. Shared instructions guide native chats; this helper cannot intercept calls that a host sends directly. Do not claim native enforcement from package tests alone.
