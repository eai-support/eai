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
| Version | 3.8.3 |
| Released | 2026-07-30 |
| Last Material Change | Pin generated app template with multi-tab submission ownership |
| Source Commit | `315f54dae400e3ff2d79da5d37e4c73481e90fc9` |


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
npm install -g @enterpriseai/cli --@enterpriseai:registry=https://eai-tools.github.io/eai/registry/
```

Persistent static fallback setup:

```bash
npm config set @enterpriseai:registry https://eai-tools.github.io/eai/registry/ --location=user
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

## Command Groups

| Command                                 | Purpose                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `eai init`                              | Scaffold an app from the EAI App Template.                                                |
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
