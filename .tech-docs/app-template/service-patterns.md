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
| Data model           | Object Types in `src/eai.config/object-types.ts`                 | `eai types validate`, `eai types seed`, `eai types diff`                                    | Object Types define resource contracts.               |
| Structured resources | `useResources(type)` or `client.resources`                       | `eai resources list/get/create/update/delete/query`                                         | Default for tenant business data.                     |
| Resource actions     | `client.resources.executeAction(type, id, action)`               | named resources command if available; otherwise `eai publicapi post /v4/data/resources/...` | Actions enforce Object Type rules.                    |
| Resource search      | helper around PublicAPI resource search if SDK support is absent | `eai resources search "<query>" --mode hybrid`                                              | Search is a projection over canonical data.           |
| Resource files       | helper around resource file routes                               | `eai resources file upload/get/delete`                                                      | Use for file fields on typed resource objects.        |
| Upload documents | `useDocuments().upload(file, context)` | `eai docs upload <file> --planning-application-id <id>` | One queued upload; full processing must be supported by the configured lifecycle. |
| Classify documents | `useDocuments().classify(files, context)` | `eai docs classify <file> --vertical-key <app-key> --workflow-key <workflow-key>` | One queued ResourceAPI upload with authorised parent or paired app/workflow context. |
| Direct URL analysis | `useDocuments().classifyByUrl(url, { verticalKey, workflowKey })` | `eai publicapi post /v4/data/documents/classify-by-url` | Direct analysis, not durable upload or saved results. |
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

An Object Type has two identifiers: the PascalCase configuration/model `name`
and the exact lowercase kebab-case persisted/transport `slug`. Generated
`linkTypes[].targetObjectType`, runtime `target_type`, route parameters, and
governed query fields contain slugs, never model names. Same-manifest names are
authoring shorthand only and must be resolved before publishing. Existing
stored slugs are authoritative and must not be re-derived or renamed.

Use `useResources` or `client.resources` for app calls. Do not hand-write v4
resource paths or create a local slugifier.

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
const { classify, getJobStatus, getRecord } = useDocuments(tenantId);

const response = await classify([file], {
  verticalKey: "business-docs",
  workflowKey: "document-review",
});
const queued = await response.json();
const status = await (await getJobStatus(queued.jobId)).json();
// Poll this same job until terminal; do not upload the file again.
// On completion, read the retained document using its returned document_id.
// getRecord(documentId) returns persisted stages, not just queue acceptance.
```

The app/workflow must have a published classifier target with the configured
`business-document-v1` lifecycle and ready private storage. Existing DAISY and
Assess callers retain their authorised planning/case context. Classification
uploads once and returns a queued job, not an immediate analysis. Business
`full`/`rag` processing is rejected until that lifecycle supports indexing;
do not report a queued job or unsupported indexing as success.

Use resource file routes when the file is a property of a typed resource object.
Use document upload, classification, and RAG routes when the platform should
process the document content.

For workflow steps, AI-agent questions, and prompting guidance, see
[V4 Documents And Files](./documents-and-files.md).
