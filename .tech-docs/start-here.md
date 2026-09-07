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

The current CLI release is **v3.15.9** (2026-08-27): Require Node 24 and fix Windows update restart.


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

The check reads filesystem, package, signature, and application metadata only;
it never runs provider binaries. It does not read provider accounts or project
files. On first use, choose Google Antigravity, GitHub Copilot, Claude, Codex,
or Grok. EAI remembers the last
workspace whose launch request the operating system accepted. Starting it is
the user's confirmation that the selected provider may read the project and
use the user's provider account.

JSON automation defaults to the backwards-compatible `eai.ai-surfaces/v1`
contract. Consumers that use capability-aware launch details request v2 with
`eai start --check --format json --contract-version v2`.

For launch JSON, the legacy `launched` field is retained for EAI Setup 0.3.19
and has the same meaning as `dispatched`: the operating system accepted the
launch request. It does not prove provider startup, sign-in, or project access.
New consumers should read `dispatched`, `confirmed`, and `launchState`;
`confirmed` remains false until the provider itself supplies that evidence.

The prepared first conversation begins with the business outcome, explains EAI
capabilities as they become relevant, and pauses once for approval of the
business specification before implementation.

The v2 catalog is fixed at eleven choices in this order: six graphical
workspaces, then five command-line workspaces. Install or update them only from
the official [VS Code and Copilot](https://code.visualstudio.com/docs/setup/copilot),
[GitHub Copilot app](https://docs.github.com/en/copilot/get-started/quickstart-copilot-app),
[Google Antigravity](https://antigravity.google/download),
[Claude](https://claude.com/download),
[Codex](https://learn.chatgpt.com/docs/app), and
[Grok](https://docs.x.ai/grok-bot/get-started) pages.

Current handoff support, in catalog order:

| AI workspace | What `eai start` does | Remaining user action |
|---|---|---|
| GitHub Copilot in VS Code | Opens the project and starts the EAI prompt. It recognises both bundled and separately installed Copilot. | Sign in to GitHub if VS Code asks. |
| GitHub Copilot app | Uses `copilot app` from the project when that CLI capability is available; otherwise opens a signature- or immutable-artifact-verified app. | If the CLI capability is unavailable, choose the local project folder and use the repository EAI skill. |
| Google Antigravity 2.0 | Opens the verified current desktop app without treating an obsolete Antigravity 1.x package as a substitute. | Add the local project folder, then use the repository EAI skill. |
| Claude Desktop | Opens a Code session with the EAI prompt when its secure app link is available; otherwise opens Claude for a manual project choice. | Confirm or choose the project folder when Claude asks. |
| ChatGPT desktop (Codex) | On macOS, uses `codex app <folder>` when the installed Codex CLI has that reviewed capability. On Windows and Linux it opens the verified app without claiming an automatic folder handoff. | On Windows/Linux, or when only the app is available, choose the folder and use the repository EAI skill. |
| Grok Bot | Opens a verified macOS, Windows, or Linux cloud Bot client only; it does not claim a local-project handoff. | Use Grok Build for a local coding workspace. Portable Linux AppImages need a standards-compliant XDG registration and an exact catalogued artifact fingerprint. |
| GitHub Copilot CLI | Opens the project in an interactive session and sends the EAI prompt. | Sign in if the CLI asks. |
| Antigravity CLI (`agy`) | Starts an interactive session in the project. Its reviewed CLI contract does not currently include an initial-prompt argument. | Sign in if Antigravity asks, then ask it to use the repository EAI skill. |
| Claude Code | Starts in the project and sends the EAI prompt when the installed CLI advertises initial-prompt support. | Sign in if Claude asks; for an older CLI, enter the EAI request after it opens. |
| Codex CLI | Starts an interactive session in the project and sends the EAI prompt. | Sign in if Codex asks. |
| Grok Build | Starts in the project with the positional EAI prompt when the installed CLI advertises that interactive capability. | Sign in if Grok asks; for an older CLI, enter the EAI request after it opens. |

On Linux, signed native packages are accepted only when package ownership,
architecture, file integrity, the exact repository origin, and its pinned signing
key agree. Unsigned portable distributions must match an immutable
official-release size and SHA-256 and are revalidated immediately before
launch. Official Antigravity 2.0 and Grok Bot releases include Windows ARM64,
and their Linux downloads include ARM64. EAI still fails closed unless the
exact installed build matches its trusted signer, package, or immutable
artifact catalog; architecture availability alone is not proof of identity.

`eai start --check` confirms local software capability only. Provider account,
subscription, organization policy, and sign-in state are confirmed by the
provider when the workspace opens.

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
