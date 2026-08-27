---
name: gofer:eai-first-run
description: "Prepare a new machine or repo for the first EAI Gofer app build."
title: "EAI First Run"
category: control
surfaces:
  - claude
  - claude-mirror
  - copilot
  - vscode
  - codex
  - gemini
  - github-prompts
  - agents-skills
  - system-skills
aliases: [gofer:first-run, gofer:eai-setup]
---

# EAI Gofer First Run

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

## Business-Friendly Progress Contract
<!-- gofer:business-progress:start -->

Default user-facing updates must be concise, business-level, and easy to scan.
Keep the technical work rigorous in artifacts, tests, logs, and code, but do
not lead with implementation jargon unless the user asks for it.

Use ASD-STE100 Simplified Technical English as the target writing standard for
all Gofer-authored chat, documents, commands, summaries, PR notes, error
guidance, and validation artifacts. ASD-STE100 is copyright and a trademark of
ASD; do not bundle the protected ASD dictionary and do not claim ASD
certification.

1. Explain progress as what is being connected, changed, checked, or fixed and
   why it matters to the business outcome.
2. Use the running build map: create or update
   `.specify/specs/{feature}/build-map.md` from
   `.specify/templates/build-map-template.md` for application delivery, and
   refer to its plain-language areas in progress updates.
3. When there is a problem, translate it into business impact, current status,
   next action, and what input or approval is needed. Keep raw stack traces,
   command logs, IDs, and acronyms out of chat unless asked.
4. If the user asks for technical depth, provide it on request and point to the
   durable artifact that contains the evidence.
5. Prefer a compact update shape:
   - `Working on`: the build-map area or stakeholder outcome
   - `Why it matters`: user/business impact
   - `Status`: done, checking, fixing, blocked, or needs decision
6. Use one action per instruction.
7. Keep instructions to 20 words or fewer where possible.
8. Use active voice unless the actor is unknown or not important.
9. Use simple verb forms: simple present, simple past, simple future,
   infinitive, or imperative.
10. Define acronyms on first use and use approved project terms.
11. Avoid idioms, marketing adjectives, vague praise, and hedging.
12. Use vertical lists for complex information and one topic per paragraph.
13. For errors, state what happened, why it matters, what to do next, and the
    exact safe command when one exists.
14. Do not remove technical validation, security checks, EAI preflights, tests,
   or loop evidence. This contract changes presentation, not engineering
   standards.
15. Before each user-facing reply, check that it leads with the business effect,
    uses concise simple language, and includes only useful technical detail.
16. If any check fails, rewrite the reply before sending it.
<!-- gofer:business-progress:end -->

Use this internal setup contract when the user is starting their first EAI
Platform app, when `/gofer` or `/eai` is unavailable in a new repository,
or when an EAI app build reaches the Gofer pipeline before the local machine,
workspace, tenant, or EAI app template is ready.

This command is intentionally allowed to run before `.specify/` exists.

## App Preview Runner Contract
<!-- gofer:app-preview-runner:start -->

For EAI app delivery, every UI preview must use the repo runner when it exists.

1. Use `./run.sh dev 3001` on macOS, Linux, and GitHub Codespaces.
2. Use `run.bat dev 3001` on Windows.
3. Use a different port only when the feature notes record the reason.
4. The runner must stop any process on the selected port before it restarts the app.
5. Do not use direct `npm run dev`, `next dev`, or package-manager preview commands when `run.sh`, `run.bat`, or `run.ps1` exists.
6. After every UI-facing change, run:
   - `node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "./run.sh dev 3001" --open auto --screenshot --change "<change summary>"`
7. On Windows, use:
   - `node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "run.bat dev 3001" --open auto --screenshot --change "<change summary>"`
8. If the runner is missing in an EAI app template repo, refresh the template before preview work continues.
<!-- gofer:app-preview-runner:end -->

## Non-Negotiables

- Ask before every install, admin action, browser login, destructive file
  change, or remote tenant/app change.
- Never print, store, or commit tokens, secrets, full `.env.local` values,
  private tenant payloads, or private platform topology.
- Prefer existing tools over reinstalling. Keep working Git, Node.js, npm, and
  EAI CLI installations.
- Do not scaffold over a non-empty repo silently.
- Do not start app research, specification, planning, tasks, or source changes
  until the EAI app-template readiness check passes.
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
| Registry | `npm config get @enterpriseai:registry` | `npm config get @enterpriseai:registry` |

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
npm install -g eai-cli
# If npmjs is unavailable:
npm install -g @enterpriseai/cli --@enterpriseai:registry=https://eai-support.github.io/eai/registry/
eai --version
```

Use the same commands in PowerShell. Do not edit `.npmrc` by shell redirection.

Use the static fallback command only when npmjs is unavailable. If `npm config get @enterpriseai:registry` already equals
`https://eai-support.github.io/eai/registry/`, do not rewrite it. If it points
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

Do not invent, guess, or complete EAI CLI commands from memory.

Run:

```bash
eai --describe
```

If advertised, also run:

```bash
eai agent guide --format json
```

For EAI app delivery that will publish Object Types, inspect the JSON guide and
require `capabilities` to contain
`app-manifest-name-slug-negotiation-v1`. `eai update --check` reporting
`current` does not prove the deployed receiver accepts the new request shape.
If the capability is absent, record `upgrade_required`, block Object Type
seed/publish and deployed-readiness claims, and ask before updating the CLI.
Local discovery and correct source authoring may continue, but do not hand-build
an app-manifest request.

Prefer commands and options advertised by the installed CLI over remembered
syntax. Before suggesting or running a specific `eai ...` command, verify its
command path and flags with command-specific `--help` or the equivalent help
path advertised by the CLI.

If the installed CLI does not list a command, do not run it. Tell the user that
this EAI CLI version does not expose the command, then choose a safe listed
command or ask the user to update EAI CLI.

Use JSON only where the CLI advertises it. Record a safe summary in the
first-run report.

When any later `eai` command fails, use the CLI's error guidance before
inventing a workaround:

```bash
eai errors explain <code-or-reason> --format json
```

If `eai errors explain` is unavailable, use the installed Gofer fallback catalog
at `.specify/references/platform/eai-error-catalog.yaml` once the repo exists,
or report that live EAI guidance is unavailable and stop before mutating
tenant/app state. Always run read-only diagnostics before mutating fixes.

For tenant member/admin operations, if `eai user invite` fails with
`EXTERNAL_SERVICE_ERROR`, a 5xx response, or
`user_invite_external_service_existing_member`, check for an existing direct
member with:

```bash
eai user list --tenant <tenant-id> --search <email> --format json
```

Use role repair only after the existing member ID is verified and the user
approves the role change:

```bash
eai user role set --tenant <tenant-id> --member-id <member-id> --role tenant-admin --format json
```

Then verify the read-back and tell the affected app user to sign out and sign
back in because Auth.js session or JWT role data may be cached.

If platform user lookup or membership prerequisite calls fail with
`MISSING_TENANT`, `app_token_tenant_context_required`, or "Tenant context
required for app tokens", do not start by changing tenant members, role
definitions, Entra configuration, databases, or cloud portals. Run:

```bash
eai errors explain app_token_tenant_context_required --format json
eai whoami
eai tenant list --format json
```

Then retry through tenant-scoped V4 platform routes:

```text
/v4/platform/tenants/<tenant-id>/users/by-email?email=<email>
/v4/platform/tenants/<tenant-id>/users/<oid>/memberships
/v4/platform/tenants/<tenant-id>/members
/v4/platform/tenants/<tenant-id>/role-definitions
```

If those still fail, escalate with redacted route shape, HTTP status, server
code, CLI version, active tenant slug, and deployed PublicAPI/AdminAPI versions
if visible.

Specifically note whether the installed CLI advertises the commands needed for:

- app scaffolding via `eai init`
- tenant selection via `eai tenant select`
- app enrollment via `eai app`
- resource schema discovery via `eai resources schema`
- workflow readiness via `eai workflow readiness`
- Entra app registration and redirect URI provisioning via `eai provision entra`
- project drift checks via `eai template check`
- Gofer drift checks via `eai gofer refresh --check`
- UI block discovery via `eai blocks`
- AI-agent guidance via `eai agent guide`
- error recovery guidance via `eai errors explain`

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

Use the deterministic app-template gate when it exists:

```bash
node .specify/scripts/node/eai-app-template-readiness.mjs --root . --json
```

The gate requires the `.eai-manifest.json` provenance written by `eai init`
and the supported EAI app-template contract:

- `.eai-manifest.json`
- `eai.runtime.json`
- `src/eai.config/object-types.ts`
- `src/eai.config/register.ts`
- `.env.example`
- `.npmrc`
- `package.json`

Do not treat copied marker files, a partial scaffold, or a custom template as
proof that `eai init` completed. A missing checker or any status other than
`ready` blocks app delivery.

If the gate returns `ready`, run:

```bash
eai verify
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

After `eai init` succeeds, enter the created app folder and rerun:

```bash
node .specify/scripts/node/eai-app-template-readiness.mjs --root . --json
eai verify
eai template check --format json
```

Continue only when the readiness status is `ready`. Record the safe status in
`eai-preflight.md`; do not copy manifest values into the artifact.

## Step 8: Recover Known Entra Redirect Mismatches

If the user provides a browser sign-in error, auth callback log, or deployment
log containing `AADSTS50011`, "reply URL specified in the request does not
match", "redirect URI", `redirect_uri`, or
`/api/auth/callback/microsoft-entra-id`, treat it as an EAI identity
provisioning recovery before giving manual Azure Portal instructions.

Do this sequence:

```bash
eai whoami
eai tenant list --format json
```

If the active tenant is missing or wrong, help the user choose the right tenant
and run the advertised equivalent of:

```bash
eai tenant select <tenant-slug-or-id>
```

Use the failing browser log to confirm the callback route in the active session,
for example:

```text
https://<host>/api/auth/callback/microsoft-entra-id
```

Record only the redacted route pattern and recovery status in Gofer artifacts.
Keep the full callback URI in the terminal/session or user-approved local notes
only.

Ask before changing tenant-scoped identity configuration, then run the
advertised equivalent of:

```bash
eai provision entra --force --redirect-uri <confirmed-callback-uri>
```

Use `--debug` only when the user explicitly approves it, and redact private
hostnames, tenant IDs, client IDs, tokens, and raw debug output before writing
any report.

After the command succeeds, retry the sign-in flow and confirm the authorize
request uses the same registered `redirect_uri`. If the mismatch persists,
check whether `AUTH_ENTRA_CLIENT_ID` or `ENTRA_CLIENT_ID` points to a different
app registration than the one EAI provisioned. Never record client secrets,
tokens, or `.env.local` values in the first-run report.

## Step 9: Confirm Gofer Scaffold And Workspace Commands

After `eai init`, verify Gofer files exist:

- `.specify/.gofer-version`
- `.specify/commands/0_gofer_start.md`
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

## Step 9: Start The Created Project In An AI Workspace

Prefer the provider-neutral EAI handoff:

```bash
eai start --check
eai start
```

The detection command is read-only. The final start action is the user's
approval for the selected AI provider to read the project and use the provider
account. If no supported surface is installed, explain why one is needed and
offer the official provider choices returned by `eai start --check`.

If `eai start` is unavailable, use the host-specific fallback below.

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
- `## Workspace Root`
- `## Environment Check`
- `## EAI CLI`
- `## Tenant And Login`
- `## Template Readiness`
- `## Drift And Recovery`
- `## Next Action`

Each section should include:

- Host, OS, shell, workspace root, and prerequisite tool versions
- Git, Node.js, npm, and EAI CLI versions
- EAI registry status
- EAI CLI release status from `eai update --check`
- EAI CLI capability source (`eai --describe` timestamp)
- Object Type seed adapter capability from `eai agent guide --format json`
- EAI capability inventory for init, tenant, app, resources, workflow,
  template, Gofer-refresh, and blocks commands
- Login status without tokens
- Tenant readiness without private payloads
- Template readiness
- Template/Gofer drift status, the next recovery command, and any `E001`
  explanation
- Gofer scaffold readiness and project path
- Next action

## Step 11: Start The Pipeline

When the app folder, EAI CLI, login, tenant, EAI template, and Gofer scaffold are
ready, tell the user to start:

```text
/gofer <what you want to build>
```

Use `/eai`, `#gofer`, `#eai`, `$gofer`, or `$eai` where that
syntax fits the host. If `/gofer` or `/eai` is still unknown after the
plugin is installed and the repo is bootstrapped, explain that the host has not
loaded the Gofer plugin or repo commands yet. Give the host-specific
install/update command from the Gofer README, then retry after the host reloads.

## Local Settings Cleanup Contract
<!-- gofer:local-settings-cleanup:start -->

After any Gofer install, update, release refresh, or workspace bootstrap:

1. Archive stale Gofer command and skill entries before continuing.
2. Prefer the repo helper:
   - `node .specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json`
3. If the repo helper is missing, use the stable plugin bundle helper:
   - macOS/Linux: `node ~/plugins/eai-gofer/.specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json`
   - Windows: `node %USERPROFILE%\plugins\eai-gofer\.specify\scripts\node\gofer-local-settings-cleanup.mjs --workspace . --apply --json`
4. This cleanup covers old Claude, Codex, Copilot, Gemini, Grok, VS Code, desktop, and CLI command surfaces.
5. Do not remove the current public `eai` entrypoint.
6. Ask the user to refresh or restart the host command picker only after cleanup completes.
<!-- gofer:local-settings-cleanup:end -->