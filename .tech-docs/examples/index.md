---
generated: false
title: Examples
---

# Examples

These examples show how the CLI, eai-gofer, and EAI App Template work together.

## Example Paths

| Example                                   | What It Shows                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| [Build a Task Tracker](./task-tracker.md) | Scaffold an app, define Object Types, publish them, and build ResourceAPI-backed pages. |
| [Add AI Chat](./ai-chat.md)               | Add streaming chat, document upload, and RAG indexing through template hooks.           |
| [Business Scenarios](/scenarios/)         | Browse industry-specific workflows before deciding what to build.                       |

## Standard Loop

Use this loop for most examples:

```bash
eai init <app-name>
cd <app-name>
npm install

eai login
eai tenant select <tenant-slug>
eai types validate
eai types seed --tenant-key <tenant-key> --tenant-id <tenant-id> --format json
eai types diff --tenant-key <tenant-key> --tenant-id <tenant-id>
eai resources schema --tenant-id <tenant-id> --format json
eai verify calls --tenant-id <tenant-id> --resource-type <resource-type>

eai dev
```

For agent-assisted delivery, run `eai gofer refresh --check` before planning and
keep the service-fit matrix updated as you choose ResourceAPI, documents, chat,
search, and PublicAPI patterns.
