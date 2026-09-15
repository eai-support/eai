---
name: eai-update
description: "Install or update EAI Gofer for this AI coding app."
---

# Eai Update

Version: 3.12.7

Use this skill to install or update the user-level EAI Gofer plugin or extension. It works before a repository has Gofer files.

1. Do not run a workspace check, `eai init`, `eai whoami`, or a delivery stage.
2. Use `.specify/scripts/node/gofer-surface-update.mjs` from this plugin bundle.
3. Check status first with `--action inspect --host <current-host> --json`.
4. Show the user the planned user-level install or update. Ask for approval before `--execute`.
5. Run `--action install` when Gofer is missing. Run `--action update` when it is installed.
6. After an actual install or update, the helper archives stale Gofer command and skill entries. It also adds a small managed always-on instruction to the selected host. It keeps the current `eai` and `eai-update` entries. A clean official Codex local marketplace on `main` fast-forwards safely. A dirty, non-main, or unrecognised local marketplace remains unchanged and reports that its plugin update is incomplete while it still refreshes the always-on instruction. An unknown Codex marketplace source stops the update without changes.
7. Update only the current host unless the user explicitly asks for `--host all`.
8. Complete the host reload step from the helper result before saying the update is ready.

Supported hosts are `claude`, `codex`, `copilot`, `gemini`, and `vscode`.

This command archives known stale Gofer entries and replaces only Gofer's managed instruction section. It does not remove unrelated user files or host-managed plugin caches. It does not create `.specify/`. After the host update, use `/eai add or refresh the Gofer scaffold for this repo` when a repository needs Gofer files.

**Blocker Mediation**

- Before repeating a failed action or asking for missing input, read .specify/references/blocker-mediation.md and inspect the private blocker register with gofer-blocker-control.mjs. Reuse the same state directory and goal, subject and condition keys across stages, restarts and surfaces. Different wording, models or tools do not create a new blocker.
- Classify the cause first. Missing user decisions, access, external dependencies and unavailable capabilities require a recorded wait. Reserve an ask event before asking; ask once, explain the business impact and required change, then stop affected work. An unanswered question is not new evidence. Do not poll or rephrase it to keep running.
- Technical ask events require a fresh verification file under .specify/references/priority-outcome-protection.md: actual diagnosis, self-cause check and why no authorized repair is available. Business choices need no failed command. For feature tasks, use gofer-priority-check.mjs and the saved direction before switching work; this does not start delivery during maintenance or conversation.
- For AI-solvable or unknown causes, reserve each attempt before execution. Allow one investigation and one different recovery within existing tighter budgets. Record its result even when interrupted or unsuccessful. An unfinished reservation must not launch again. Do not reset the register, change keys or switch surfaces to obtain more attempts.
- Resume only after a real user answer or changed external evidence has been recorded and checked. The helper allows one evidence-backed resumption; exhausted limits need human review. Never invent approval or evidence. Successful model output and a running server do not resolve a blocker without the relevant check.
- Save the blocker, unfinished tasks and next action before stopping. Continue only approved tasks that do not depend on it. Keep the original goal; update specs, plans, tasks and validation for accepted direction changes, and reopen stale checks. Do not quietly drop requirements to make progress.
- Use node .specify/scripts/node/gofer-blocker-control.mjs --state-dir <private-state-directory> --event <private-event.json> before controlled actions; inspect with --state-dir alone, or add --task T001 for an independent task. A denied action, invalid record or missing helper means stop and explain the limitation, not bypass it. Use the installed plugin script path if no repo scaffold exists. Conversation-only work uses a private session state directory and does not require app setup or feature files.
- Strict loop validation checks every recorded feature blocker. Shared instructions guide native chats; this helper cannot intercept calls that a host sends directly. Do not claim native enforcement from package tests alone.
