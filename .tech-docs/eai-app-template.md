---
generated: false
title: EAI App Template
---

# EAI App Template

The EAI App Template is the canonical public scaffold used by `eai init`. It is
a Next.js app template for tenant-scoped applications on the EAI platform.

## Quick Start

```bash
eai init my-app
cd my-app
npm install
cp .env.example .env.local
npm run dev
```

Then connect it to a tenant:

```bash
eai login
eai tenant list --format json
eai tenant select <tenant-slug>
eai whoami
eai types validate
eai types seed --tenant-key template --tenant-id <tenant-id> --format json
eai types diff --tenant-key template --tenant-id <tenant-id>
eai resources schema --tenant-id <tenant-id> --format json
```

## App Structure

| Path                             | Purpose                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `src/eai.config/default.ts`      | Default tenant config, store slices, API paths, storage keys, and layout slots. |
| `src/eai.config/index.ts`        | Tenant key to config registry.                                                  |
| `src/eai.config/object-types.ts` | Object Type definitions for ResourceAPI-backed data.                            |
| `src/eai.blocks.tsx`             | Component registry and app-local block extension point.                         |
| `src/hooks/useResources.ts`      | ResourceAPI-backed business data.                                               |
| `src/hooks/useDocuments.ts`      | Document upload, classification, and RAG indexing.                              |
| `src/hooks/useChat.ts`           | Streaming and non-streaming chat workflows.                                     |
| `src/app/providers.tsx`          | Auth/session providers and EAI config runtime.                                  |

## Platform Boundary

- Browser code calls the app BFF at `/api/eai/...`.
- Browser streaming calls use `/api/eai/stream/...`.
- Server helpers attach auth, tenant, and correlation headers.
- The browser never receives raw database, blob, search, PublicAPI, or model
  provider credentials.
- Prefer PublicAPI V4 routes; older route families are compatibility glue.

## Data Model

Object Types are the contract for tenant business data. Use `postgresql` for
most canonical structured resources unless another backend is clearly required.

| Backend      | Use For                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------- |
| `postgresql` | Structured business records, workflow status, joins, history, list/query/aggregate behavior. |
| `documentdb` | Resource types that genuinely need document-model persistence.                               |
| `blob`       | Large files or file-like resources behind API-managed metadata.                              |
| `search`     | Derived full-text, vector, or hybrid projections.                                            |

Search is not the system of record for mutable runtime data.

## UI Composition

The template uses config-driven UI:

1. Define store slices and layout slots in config.
2. Register components in `src/eai.blocks.tsx`.
3. Reference components from config by registered name.
4. Use `storeBindings` for data-driven props.
5. Use JSON-safe `showWhen` conditions for visibility.
6. Keep callbacks, router actions, auth actions, analytics hooks, and React
   nodes in code-level overrides.

See [Config-Driven UI](./app-template/config-driven-ui.md) for the full pattern.

## Service Hooks

| Need                    | App Pattern                    | CLI Verification                                         |
| ----------------------- | ------------------------------ | -------------------------------------------------------- |
| Tenant business records | `useResources('<ObjectType>')` | `eai resources list/get/create/update/delete/query`      |
| Documents and RAG       | `useDocuments()`               | `eai docs upload`, `eai docs classify`, `eai docs index` |
| AI chat                 | `useChat(workflowId, stage)`   | `eai chat send`, `eai chat stream`                       |
| Advanced route          | server helper or BFF route     | `eai publicapi <method> /v4/...`                         |

## Related Pages

- [Task Tracker Example](./examples/task-tracker.md)
- [AI Chat Example](./examples/ai-chat.md)
- [Platform Service Patterns](./app-template/service-patterns.md)
- [eai-gofer](./eai-gofer.md)
