---
generated: false
title: Platform Service Patterns
---

# Platform Service Patterns

Use these patterns when choosing how an app, eai-gofer, or terminal automation
should call EAI platform capabilities.

## Boundary Rules

- Browser code calls the app BFF at `/api/eai/...`.
- Browser streaming calls use `/api/eai/stream/...`.
- App code should prefer template hooks before hand-written fetches.
- CLI automation may call platform services through authenticated `eai`
  commands.
- Use `eai publicapi` only for authorized PublicAPI V4 routes that do not yet
  have named SDK or CLI support.
- Do not generate direct downstream database, blob, search, model provider, or
  platform secrets.

## Service Selection Matrix

| Need                 | App Pattern                                                      | CLI Pattern                                                                                 | Notes                                                 |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Frontend composition | `src/eai.config` layout slots plus `src/eai.blocks.tsx` registry | `eai gofer refresh` installs guidance                                                       | Keep config data-only; callbacks belong in overrides. |
| Data model           | Object Types in `src/eai.config/object-types.ts`                 | `eai types validate`, `eai types seed`, `eai types diff`                                    | Object Types define ResourceAPI contracts.            |
| Structured resources | `useResources(type)` or `client.resources`                       | `eai resources list/get/create/update/delete/query`                                         | Default for tenant business data.                     |
| Resource actions     | `client.resources.executeAction(type, id, action)`               | named resources command if available; otherwise `eai publicapi post /v4/data/resources/...` | Actions enforce Object Type rules.                    |
| Resource search      | helper around PublicAPI resource search if SDK support is absent | `eai resources search "<query>" --mode hybrid`                                              | Search is a projection over canonical data.           |
| Resource files       | helper around resource file routes                               | `eai resources file upload/get/delete`                                                      | Use for file fields on ResourceAPI objects.           |
| Documents            | `useDocuments().upload/classify/ragIndex`                        | `eai docs upload`, `eai docs classify`, `eai docs index`                                    | Use for platform document processing and RAG.         |
| Chat                 | `useChat(workflowId, stage).send/stream`                         | `eai chat send`, `eai chat stream`                                                          | Use `message`, `conversation_id`, and `params`.       |
| Advanced PublicAPI   | BFF or server helper                                             | `eai publicapi <method> /v4/...`                                                            | Use only when named support is missing.               |

## Storage Backend Rules

- `postgresql`: canonical structured resource storage.
- `documentdb`: document-model persistence when the data genuinely needs it.
- `blob`: large files or file-like resources behind API-mediated access.
- `search`: derived full-text, vector, or hybrid projection, not the sole system
  of record for runtime writes.

Document RAG indexing is a documents service pattern (`useDocuments().ragIndex`
or `eai docs index`), not a reason to create a search-only Object Type.

## Chat Payload Pattern

```ts
await client.chat.send({
  workflowId,
  stage: "chat",
  message: "Summarise this application",
  conversationId,
  params: {},
  runtime_context: { applicationId },
});
```

The platform expects `message`, `conversation_id`, and `params`. Do not generate
legacy payloads such as `chat_input` for new apps.

## Resource Payload Pattern

```ts
const { list, create, update, executeAction } = useResources<ApplicationData>(
  "Application",
  tenantId,
);

const applications = await list({ limit: 20, sort: "-created_at" });
const created = await create({ applicantName: "Jane", status: "draft" });
await update(created.id, { status: "submitted" }, created.version);
await executeAction(created.id, "submit");
```

Updates require the current `version` for optimistic locking.

## Document Pattern

```ts
const { upload, classify, ragIndex } = useDocuments(tenantId);

const uploaded = await upload(file, {
  category: "supporting-document",
  application_id: applicationId,
});
const documentId = uploaded.documentId;

await classify([file]);
await ragIndex(documentId);
```

Use ResourceAPI file routes when the file is a property of a ResourceAPI object.
Use document upload, classification, and RAG routes when the platform should
process the document content.
