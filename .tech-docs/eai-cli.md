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
| Version | 3.6.0 |
| Released | 2026-06-28 |
| Last Material Change | Add native app terminology commands |
| Source Commit | `ff5ebafc7ea71d02bf2a9084c849f14b0647ade0` |


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
| Use chat workflows   | `eai chat send`, `eai chat stream`                       |
| Advanced route       | `eai publicapi <method> /v4/...`                         |

## Related Reference

- [Configuration](./configuration.md)
- [API Reference](./api-reference.md)
- [Platform Service Patterns](./app-template/service-patterns.md)
- [Examples](./examples/index.md)
