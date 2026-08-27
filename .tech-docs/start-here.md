---
generated: false
title: Start Here
---

# Start Here

The EAI documentation site is the single public entry point for the EAI CLI,
eai-gofer, the EAI App Template, implementation examples, and the business
scenario library.

Use this page when you are starting a new app, connecting an existing app to the
platform, or trying to understand which part of the toolchain to use.

## Current Release

The current CLI release is **v3.15.8** (2026-08-25): Support current production Object Type seeding.


## What The Pieces Do

| Piece            | Use It For                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eai` CLI        | Install, authenticate, scaffold apps, manage tenants, publish Object Types, work with resources, documents, chat, deployment, and diagnostics.     |
| eai-gofer        | Install and refresh AI workflow assets that help coding agents research, specify, plan, implement, and validate EAI work.                          |
| EAI App Template | Start a Next.js app with platform auth, tenant config, Object Types, ResourceAPI hooks, document hooks, chat hooks, and config-driven UI patterns. |
| Scenario library | Browse business examples by industry before deciding what to build.                                                                                |

## Install The CLI

```bash
npm install -g eai-cli
eai --version
```

Canonical package install:

```bash
npm install -g @enterpriseai/cli
```

Static registry fallback:

```bash
npm install -g @enterpriseai/cli --@enterpriseai:registry=https://eai-support.github.io/eai/registry/
```

Persistent static fallback setup:

```bash
npm config set @enterpriseai:registry https://eai-support.github.io/eai/registry/ --location=user
npm install -g @enterpriseai/cli
```

## Create A New App

```bash
eai init task-tracker
cd task-tracker
npm install
```

`eai init` uses `https://github.com/eai-support/eai-app-template` by default and
installs gofer workflow assets unless you pass `--no-gofer`.
If you already created and entered a project folder, run `eai init`, enter the
kebab-case app name, and choose the current-folder option. Scripts can use
`eai init task-tracker --current-dir`. Current-folder init preserves unrelated
existing files and Git metadata, and updates files that are part of the
generated scaffold.

## Start In An AI Workspace

```bash
eai start --check
eai start
```

The check reads installed command and application metadata plus the selected
project's Git root and origin URL. It does not read provider accounts or source
files. On first use, choose GitHub Copilot,
Claude, Codex, or Grok; EAI remembers the last workspace that opens
successfully. Starting it confirms that the selected provider may read the
project and use the user's provider account.

The prepared first conversation begins with the business outcome, explains EAI
capabilities as they become relevant, and pauses once for approval of the
business specification before implementation.

Current handoff support:

| AI workspace | What `eai start` does | Remaining user action |
|---|---|---|
| GitHub Copilot in VS Code | Opens the project and starts the EAI prompt. It recognises both bundled and separately installed Copilot. | Sign in to GitHub if VS Code asks. |
| GitHub Copilot CLI | Opens the project in an interactive session and sends the EAI prompt. | Sign in if the CLI asks. |
| GitHub Copilot app | Prefers GitHub's installed app bridge so the exact local folder opens in a new session. On macOS, an explicitly authorised handoff verifies that Copilot's official confirmation names that exact folder, presses only its unique Allow button, and inserts the first EAI prompt into one verified empty Message field without pressing Send. If the local bridge is unavailable, a verified `github.com` origin can use GitHub's documented prompt link. Older, permission-blocked, or non-authorised connections keep the Copy first message fallback. | Click the installer workspace once, or use the standalone consent flag shown below. Review the prepared message, then press Send. If macOS asks for permission, allow EAI Setup when using the installer, or allow the app that launched `eai` when using Terminal. You can always use Copy first message instead. |
| Claude Desktop | Opens a Code session for the project with the EAI prompt ready when the installed app exposes its secure link; otherwise opens Claude for a manual project choice and prints the first message for copy/paste. | Confirm the folder when Claude asks, review the prompt, then press Send. |
| Claude Code | Starts an interactive session in the project and sends the EAI prompt. | Sign in if Claude asks. |
| Codex Desktop | Opens a new project chat with the EAI prompt ready when the installed app exposes its secure link; otherwise opens the desktop app and prints the first message for copy/paste. | Review the prepared prompt and press Send, or choose the folder manually on an older app. |
| Codex CLI | Starts an interactive session in the project and sends the EAI prompt. | Sign in if Codex asks. |
| Grok Build | Starts in the project with the EAI prompt. | Sign in if Grok asks. |

`eai start --check` confirms local software capability only. Provider account,
subscription, organization policy, and sign-in state are confirmed by the
provider when the workspace opens.

For the same bounded GitHub Copilot app handoff directly from Terminal, make
the prompt-insertion permission explicit:

```bash
eai start . --surface copilot-desktop --allow-copilot-prompt-insertion
```

Without that flag, EAI can still open the exact Copilot project and prints the
first message for copy/paste, but it will not press Copilot's Allow button or
fill the message box. This keeps older installer versions and automated callers
fail-closed.

## Connect To A Tenant

```bash
eai login
eai tenant list --format json
eai tenant select <tenant-slug>
eai whoami
```

Keep tenant IDs, secrets, endpoint URLs, and cloud credentials out of committed
files. The browser app should call its own BFF at `/api/eai/...`; it should not
receive raw downstream credentials.

## Publish And Verify The Data Model

Object Types are the platform contract for tenant-scoped resource data.
Keep the PascalCase source/model `name` separate from the exact lowercase
kebab-case persisted/transport `slug`. Relationship targets, runtime
`target_type`, resource command arguments, paths, and governed v4 fields use
the exact stored slug. Historical stored slugs are authoritative and are not
re-derived from names.

```bash
eai types validate
eai types diff --tenant-key <tenant-key> --tenant-id <tenant-id>
eai types seed --tenant-key <tenant-key> --tenant-id <tenant-id> --format json
eai resources schema --tenant-id <tenant-id> --format json
eai verify calls --tenant-id <tenant-id> --resource-type <object-type-slug>
```

Do not build app workflows on top of a tenant until `eai types diff` converges.

## Use eai-gofer In A Repo

```bash
eai gofer refresh --check
eai gofer refresh
```

Use gofer to keep agent instructions, plan templates, service-fit checklists,
and public-safe platform references aligned with the CLI and app template. In
the AI workspace, use the public `eai` skill; numbered delivery stages are
internal implementation details.

## Choose Your Next Page

- [EAI CLI](./eai-cli.md): commands and daily workflow.
- [eai-gofer](./eai-gofer.md): agent workflow assets and refresh behavior.
- [EAI App Template](./eai-app-template.md): app structure and extension points.
- [Examples](./examples/index.md): task tracker, chat, documents, and app patterns.
- [Scenarios](/scenarios/): business scenario library by industry.
