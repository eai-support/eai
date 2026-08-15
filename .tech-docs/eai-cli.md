---
generated: false
title: EAI CLI
---

# EAI CLI

`eai` is the supported command-line interface for building and operating apps on
the EAI platform. It wraps authentication, tenant context, Object Types,
ResourceAPI data, document processing, chat workflows, deployment, diagnostics,
and gofer asset refresh.

## Release Snapshot

| Field | Value |
| --- | --- |
| Version | 3.15.1 |
| Released | 2026-08-15 |
| Last Material Change | Fix Windows npm launcher during app initialization |
| Source Commit | `02fd1a8f3c0d514158990b8888d3d1a96505a013` |


## Install

Recommended install:

```bash
npm install -g eai-cli
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

## Common Workflow

```bash
eai login
eai tenant list --format json
eai tenant select <tenant-slug>
eai whoami

eai types validate
eai types seed --tenant-key <tenant-key> --tenant-id <tenant-id> --format json
eai types diff --tenant-key <tenant-key> --tenant-id <tenant-id>
eai resources schema --tenant-id <tenant-id> --format json

eai dev
```

## Object Type Identifiers

Do not move every Object Type field to kebab-case. A definition keeps both a
PascalCase source/model `name`, such as `BoardAppUser`, and an explicit exact
transport/storage `slug`, such as `board-app-user`.

Generated and persisted `linkTypes[].targetObjectType`, runtime `target_type`,
path parameters, and other governed v4 fields contain slugs. The CLI accepts a
same-manifest PascalCase relationship target only as authoring shorthand and
resolves it through that target's declared slug before diff or seed. An
unresolved model name is an error; the CLI does not guess.

For existing Object Types, the exact stored slug is authoritative even when
today's derivation from the name would differ. Do not normalize or rename it.
App code should use `useResources` or `client.resources` so the SDK owns route
construction.

## Command Groups

| Command                                 | Purpose                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `eai init`                              | Scaffold an app from the EAI App Template.                                                |
| `eai start`                             | Detect or open a supported AI workspace for the current EAI app.                          |
| `eai login`, `eai logout`, `eai whoami` | Manage local authentication and inspect active context.                                   |
| `eai tenant`                            | List, select, create, inspect, and administer tenant context.                             |
| `eai types`                             | Validate, seed, diff, and pull Object Type definitions.                                   |
| `eai resources`                         | List, get, create, update, delete, query, aggregate, search, and manage ResourceAPI data. |
| `eai docs`                              | Upload, classify, and index documents for platform processing and RAG.                    |
| `eai chat`                              | Send or stream chat requests through configured AI workflows.                             |
| `eai publicapi`                         | Call authorized PublicAPI V4 routes when a named command does not exist yet.              |
| `eai runtime`                           | Validate the host-neutral `eai.runtime.json` app runtime contract.                        |
| `eai deploy`                            | Translate provider env/secrets and black-box doctor deployed EAI app runtimes.            |
| `eai gofer`                             | Install and refresh repo-local agent workflow assets.                                     |
| `eai template`                          | Check app-template and UI drift without writing files.                                    |
| `eai update`                            | Update the CLI, refresh safe Gofer-managed assets, and report app-template drift.         |
| `eai verify`, `eai doctor`              | Run connectivity, contract, update, and troubleshooting checks.                           |

## Output Modes

Use machine-readable output for automation:

```bash
eai tenant list --format json
eai resources schema --tenant-id <tenant-id> --format json
eai whoami --simple
eai doctor --no-color
```

## Named Commands Before Raw Routes

Prefer product-shaped commands before `eai publicapi`:

| Need                 | Preferred CLI                                            |
| -------------------- | -------------------------------------------------------- |
| Scaffold app         | `eai init <name>` or `eai init <name> --current-dir`     |
| Start AI workspace   | `eai start --check`, then `eai start`                    |
| Select tenant        | `eai tenant list`, `eai tenant select <slug>`            |
| Publish Object Types | `eai types validate`, `eai types seed`, `eai types diff` |
| Inspect schemas      | `eai resources schema --tenant-id <tenant-id>`           |
| Work with resources  | `eai resources list/get/create/update/delete/query`      |
| Search resources     | `eai resources search "<query>" --mode hybrid`           |
| Work with documents  | `eai docs upload`, `eai docs classify`, `eai docs index` |
| Attach resource files | `eai resources file upload/get/delete`                   |
| Use chat workflows   | `eai chat send`, `eai chat stream`                       |
| Advanced route       | `eai publicapi <method> /v4/...`                         |

## Related Reference

- [Configuration](./configuration.md)
- [API Reference](./api-reference.md)
- [Platform Service Patterns](./app-template/service-patterns.md)
- [V4 Documents And Files](./app-template/documents-and-files.md)
- [Examples](./examples/index.md)
