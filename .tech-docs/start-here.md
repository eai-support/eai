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

The current CLI release is **v3.6.0** (2026-06-28): Add native app terminology commands.


## What The Pieces Do

| Piece            | Use It For                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eai` CLI        | Install, authenticate, scaffold apps, manage tenants, publish Object Types, work with resources, documents, chat, deployment, and diagnostics.     |
| eai-gofer        | Install and refresh AI workflow assets that help coding agents research, specify, plan, implement, and validate EAI work.                          |
| EAI App Template | Start a Next.js app with platform auth, tenant config, Object Types, ResourceAPI hooks, document hooks, chat hooks, and config-driven UI patterns. |
| Scenario library | Browse business examples by industry before deciding what to build.                                                                                |

## Install The CLI

```bash
npm config set @eai-tools:registry https://eai-tools.github.io/eai/registry/ --location=user
npm install -g @eai-tools/cli
eai --version
```

## Create A New App

```bash
eai init task-tracker
cd task-tracker
npm install
```

`eai init` uses `https://github.com/eai-tools/eai-app-template` by default and
installs gofer workflow assets unless you pass `--no-gofer`.
If you already created and entered a project folder, run `eai init`, enter the
kebab-case app name, and choose the current-folder option. Scripts can use
`eai init task-tracker --current-dir`. Current-folder init preserves unrelated
existing files and Git metadata, and updates files that are part of the
generated scaffold.

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

```bash
eai types validate
eai types seed --tenant-key <tenant-key> --tenant-id <tenant-id> --format json
eai types diff --tenant-key <tenant-key> --tenant-id <tenant-id>
eai resources schema --tenant-id <tenant-id> --format json
eai verify calls --tenant-id <tenant-id> --resource-type <resource-type>
```

Do not build app workflows on top of a tenant until `eai types diff` converges.

## Use eai-gofer In A Repo

```bash
eai gofer refresh --check
eai gofer refresh
```

Use gofer to keep agent instructions, plan templates, service-fit checklists,
and public-safe platform references aligned with the CLI and app template.

## Choose Your Next Page

- [EAI CLI](./eai-cli.md): commands and daily workflow.
- [eai-gofer](./eai-gofer.md): agent workflow assets and refresh behavior.
- [EAI App Template](./eai-app-template.md): app structure and extension points.
- [Examples](./examples/index.md): task tracker, chat, documents, and app patterns.
- [Scenarios](/scenarios/): business scenario library by industry.
