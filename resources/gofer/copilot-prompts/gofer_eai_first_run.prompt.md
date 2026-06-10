---
name: gofer:eai-first-run
description: Prepare a new machine or repo for the first EAI Gofer app build.
agent: copilot-workspace
tools:
  - Read
  - Grep
  - Glob
  - Bash
  - WebSearch
argument-hint: feature-name-or-description
gofer:
  workflowProfile: standard
  canonicalSource: .specify/commands/gofer_eai_first_run.md
  canonicalChecksum: 90358a4dbc388b3b3d5286cc55ef74c1be5e1371a188a4242959c87a0ec34974
  metadataSource: scripts/generate-commands.ts
---

## Token And Cost Policy
<!-- gofer:token-cost-policy:start -->

Before spawning agents, calling tools, or loading large files:

1. Treat `.specify/memory/gofer-model-policy.yaml` as the repo-owned source of truth for simple, medium, hard, and arbiter model routing. If it is missing, run `/gofer:bootstrap-workspace` before continuing.
2. Use the cheapest capable model first.
   - Claude: Haiku for scouting/extraction; Sonnet for normal implementation, synthesis, validation, and security; Opus for high-risk arbitration or release-critical failures.
   - Codex/OpenAI: GPT mini for simple coding; GPT nano only for locate/classify/summarize/mechanical work; GPT-5.3-Codex or flagship GPT for tool-heavy coding, architecture, and release-critical validation.
   - Gemini: Flash-Lite for cheap large-context scan/summarize; Flash for default research synthesis; Pro for large-context architecture or high-risk arbitration.
   - Copilot: prefer Auto for simple and default work; ask the user before choosing a paid/high-tier picker model for hard security, architecture, or release gates.
3. Keep raw tool output out of the main conversation context. Save stable findings to `.specify/specs/{feature}/context-bundle.md`, then work from summaries.
4. Use provider prompt/context caching only for stable, non-secret prefixes: Gofer scaffold, AGENTS/CLAUDE/Copilot instructions, constitution, repo map, stage contracts, and validation rubric.
5. Before continuing after large research, planning, implementation, or validation bursts, checkpoint the durable artifacts and compact/clear/resume context when the host supports it.
6. Escalate model tier only when a cheaper pass is low-confidence, contradictory, security-sensitive, or blocking release quality.
<!-- gofer:token-cost-policy:end -->


# EAI Gofer First Run

Use this command when the user is starting their first EAI Platform app, when
`#0_business_scenario` is unavailable in a new repository, or when an EAI app
build reaches the Gofer pipeline before the local machine, workspace, tenant, or
EAI app template is ready.

This command is intentionally allowed to run before `.specify/` exists.

## Non-Negotiables

- Ask before every install, admin action, browser login, destructive file
  change, or remote tenant/app change.
- Never print, store, or commit tokens, secrets, full `.env.local` values,
  private tenant payloads, or private platform topology.
- Prefer existing tools over reinstalling. Keep working Git, Node.js, npm, and
  EAI CLI installations.
- Do not scaffold over a non-empty repo silently.
- Use the EAI Platform app template first, Azure second, and non-EAI stacks only
  by explicit exception.
- In GitHub Codespaces, avoid `sudo` or host-level package installs unless the
  user explicitly approves. Prefer the prebuilt devcontainer and user-level npm.

## Step 1: Identify Host, OS, Shell, And Workspace

Detect and report:

- Host: Claude Code, Codex, GitHub Copilot, Gemini, VS Code, GitHub Codespaces,
  or unknown.
- OS: macOS, Linux, Windows, or Codespaces Linux.
- Shell: bash/zsh, PowerShell, cmd, or unknown.
- Workspace root: current folder, opened editor workspace, Codespace checkout,
  or a folder the user wants to create.

If no suitable folder is open, ask the user where the project should live. If
the host can create the folder, ask approval and create it. If not, give exact
click/command instructions and continue after the folder is open.

## Step 2: Check Developer Prerequisites

Run only safe read/check commands first:

| Tool    | POSIX check                       | PowerShell check                         |
| ------- | --------------------------------- | ---------------------------------------- |
| Git     | `git --version`                   | `git --version`                          |
| Node.js | `node --version`                  | `node --version`                         |
| npm     | `npm --version`                   | `npm --version`                          |
| EAI CLI | `eai --version`                   | `eai --version`                          |
| Registry | `npm config get @eai-tools:registry` | `npm config get @eai-tools:registry` |

If Git, Node.js, or npm is missing, ask before installing. Use the least
surprising platform path:

| Platform            | Preferred install path                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| macOS               | Use Homebrew if already installed; otherwise use the official Git/Node installer path.  |
| Linux               | Prefer existing devcontainer tools; otherwise detect `apt`, `dnf`, `yum`, or `zypper`. |
| Windows             | Prefer `winget`; fall back to the official Git for Windows and Node.js installers.      |
| GitHub Codespaces   | Prefer preinstalled tools and user-level npm; avoid host-level package installs.        |

For Windows, use PowerShell-safe syntax. Do not emit POSIX-only shell redirection
or assume Git Bash exists unless it was detected.

## Step 3: Install Or Update EAI CLI

If `eai` is missing, or if the user asks to update it, ask for approval and run:

```bash
npm config set @eai-tools:registry https://eai-tools.github.io/eai/registry/ --location=user
npm install -g @eai-tools/cli
eai --version
```

Use the same commands in PowerShell. Do not edit `.npmrc` by shell redirection.

If the scoped registry already equals
`https://eai-tools.github.io/eai/registry/`, do not rewrite it. If it points
somewhere else, show the current value and ask before changing it.

If `eai` is already installed, run:

```bash
eai update --check
```

If an update is available, explain the currently installed version versus the
latest available version and ask before running `eai update`.

If install fails, stop EAI app delivery and give the user the exact failed
command, the public setup link, and the account requirement. Continue only if
the user explicitly chooses a non-EAI path.

## Step 4: Discover EAI CLI Capabilities

Run:

```bash
eai --describe
```

Prefer commands and options advertised by the installed CLI over remembered
syntax. Use JSON only where the CLI advertises it. Record a safe summary in the
first-run report.

Specifically note whether the installed CLI advertises the commands needed for:

- app scaffolding via `eai init`
- tenant selection via `eai tenant select`
- app enrollment via `eai vertical`
- resource schema discovery via `eai resources schema`
- workflow readiness via `eai workflow readiness`
- project drift checks via `eai template check`
- Gofer drift checks via `eai gofer refresh --check`
- UI block discovery via `eai blocks`

## Step 5: Login, Tenant, And Account Readiness

Run:

```bash
eai whoami
eai tenant list --format json
```

If not logged in or the token is expired, ask before running:

```bash
eai login
```

After login, list tenants again. If more than one tenant is available, help the
user choose the correct one and run the advertised equivalent of:

```bash
eai tenant select <tenant-slug-or-id>
```

Require at least one usable tenant membership before EAI app delivery. Prefer a
tenant-admin/operator-capable role because app enrollment and provisioning are
tenant-scoped actions. If no tenant is available, tell the user they need an EAI
Platform account and tenant access before Gofer can build an app.

## Step 6: Confirm Project Folder And Name

Before `eai init`, ask whether the current folder/workspace is the right place.
If the user wants a new sibling or child folder, create it only after approval.

Ask for the project display name. If the user gives a plain-language name,
propose a lowercase kebab-case CLI name and confirm it before continuing.

Collect or confirm:

- App display name
- Lowercase kebab-case app/project name
- One-sentence business description
- Active tenant
- Whether starter defaults should be kept

## Step 7: Initialize The EAI App Template

Detect existing template markers before scaffolding:

- `src/eai.config/object-types.ts`
- `src/eai.config/register.ts`
- `.env.example`
- `.npmrc`
- `package.json`

If the repo already looks like an EAI app, run `eai verify` and continue with
the existing project. If the installed CLI advertises them, also run:

```bash
eai template check --format json
eai gofer refresh --check --format json
```

If `eai verify`, `eai template check`, or `eai doctor --check-updates`
returns `E001` or reports "Not in an EAI project", treat the repo as not yet
initialized from the EAI app template and explain that clearly.

If this is an empty or approved target folder, ask for final confirmation and
run the advertised equivalent of:

```bash
eai init <project-name> --skip-prompts --company-tenant <active-tenant-id>
```

If the CLI requires additional safe answers, gather them first. If the repo is
non-empty and not an EAI app, ask whether to initialize a new sibling EAI app
directory or stop.

## Step 8: Confirm Gofer Scaffold And Workspace Commands

After `eai init`, verify Gofer files exist:

- `.specify/.gofer-version`
- `.specify/commands#0_business_scenario.md`
- `.specify/templates/spec-template.md`
- `.specify/scripts/node/gofer-workspace-check.mjs`
- `.specify/memory/gofer-model-policy.yaml`
- `AGENTS.md` or the host-specific instruction file

If the Gofer scaffold is missing or stale, run `/gofer:bootstrap-workspace`
using the current host policy, then rerun:

```bash
node .specify/scripts/node/gofer-workspace-check.mjs --host auto --json
```

If the current host cannot run slash commands yet, use the installed plugin
bundle or downloaded public bundle as the bootstrap source described by
`/gofer:bootstrap-workspace`.

## Step 9: Open Or Attach The Created Project

Make sure the active host is working in the initialized EAI app folder:

- VS Code: open the folder in the current or a new VS Code window when `code`
  is available; otherwise give exact UI steps.
- Codex: show the absolute folder path and ask the user to open that folder as
  the active Codex workspace if the host cannot switch automatically.
- Claude Code: show the absolute folder path and ask the user to attach/open it
  if the host cannot switch automatically.
- Gemini/Copilot in VS Code: ensure the VS Code workspace is the initialized app
  folder before starting Gofer.
- GitHub Codespaces: keep the current Codespace workspace unless the project was
  created in a subfolder; then `cd` into it and report the path.

## Step 10: Write The First-Run Report

Write only to `.specify/logs/eai-first-run-report.md`. If `.specify/` does not
exist yet, create the report after `eai init` or after Gofer bootstrap.

If the target file already exists, replace it and prepend a regeneration note
such as `<!-- regenerated at [ISO timestamp] -->`.

Include the minimum provenance schema:

- `GeneratedAt`
- `SourceCommandId`
- `SourceInputs`
- `OverwriteNoticeWhenApplicable`

The generated first-run report must contain these sections:

- `## Provenance`
- `## Host And Platform`
- `## Workspace Root`
- `## Prerequisite Checks`
- `## EAI CLI`
- `## Login And Tenant`
- `## Template Initialization`
- `## Gofer Scaffold`
- `## Next Action`

Each section should include:

- Host, OS, shell, and workspace root
- Git, Node.js, npm, and EAI CLI versions
- EAI registry status
- EAI CLI release status from `eai update --check`
- EAI CLI capability source (`eai --describe` timestamp)
- EAI capability inventory for init, tenant, vertical, resources, workflow,
  template, Gofer-refresh, and blocks commands
- Login status without tokens
- Tenant readiness without private payloads
- Template readiness
- Template/Gofer drift status and any `E001` explanation
- Gofer scaffold readiness
- Project path
- Next action

## Step 11: Start The Pipeline

When the app folder, EAI CLI, login, tenant, EAI template, and Gofer scaffold are
ready, tell the user to start:

```text
#0_business_scenario <what you want to build>
```

If `#0_business_scenario` is still unknown after the plugin is installed and the
repo is bootstrapped, explain that the host has not loaded the Gofer plugin or
repo commands yet. Give the host-specific install/update command from the Gofer
README, then retry this command after the host reloads.
