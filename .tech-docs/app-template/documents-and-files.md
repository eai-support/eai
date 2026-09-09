# V4 Documents And Files

This guide explains how an app should handle uploaded files, documents, and AI
workflows on the PublicAPI v4 surface.

## Choose The Right Model

| User goal | Use this model | App API | CLI |
| --- | --- | --- | --- |
| Upload a document so the platform can process, classify, or index it for AI | Document workflow | `useDocuments().upload`, `classify`, `ragIndex` | `eai docs upload`, `eai docs classify`, `eai docs index` |
| Attach a file to an existing business record | Resource file property | `useResources(type).uploadFile` | `eai resources file upload` |
| Store an arbitrary blob without a document or resource owner | Do not use as a public v4 app pattern | No public app-template helper | No named command |

V4 does not treat file upload as a free-form blob write. A file belongs to one
of two public app concepts:

- a document workflow when the file itself is the thing to process, classify, or
  make available to AI;
- a ResourceAPI file property when the file is an attachment on an existing
  typed resource.

## Document Workflow

Use document workflow routes when the user thinks of the file as a document:
contracts, policies, evidence packs, supporting documents, reports, PDFs, Word
files, and knowledge sources.

Both `upload(file, metadata?)` and `classify(files, metadata?)` use the same
queued multipart route:

```text
POST /v4/data/documents/upload
```

Submit the files **once**. `classify` sets `processing_mode=classification`,
which includes the configured classification and custom extraction stages.
`upload` defaults to `full`; an explicit `processingMode` selects
`classification`, `rag`, `full` or `store_only`. PublicAPI rejects modes the
configured lifecycle does not support before writing upload data. In the
business lifecycle candidate, `full` and `rag` are unsupported; use
`classification` for processing or `store_only` for storage. Do not add a
second upload or a separate indexing request to work around that restriction.

### Standalone Business Documents

```tsx
const { classify, getJobStatus } = useDocuments(tenantId);

const response = await classify(files, {
  verticalKey: "business-docs",
  workflowKey: "classify",
});
const admission = await response.json();
const statusResponse = await getJobStatus(admission.jobId);
const job = await statusResponse.json();
```

The app and workflow keys must identify an authorised, configured workflow.
They are not permission grants. PublicAPI selects the lifecycle from the
existing classifier binding's `config.documentLifecycle`, for example
`business-document-v1`; the client must not send that value or choose a
collection, Object Type, file property, owner, authority or classifier pin.
Business document/analysis schemas, storage readiness and classifier readiness
must be configured separately. A successful classifier publication alone does
not prove durable upload is ready.

An equivalent single-file request is
`upload(file, { verticalKey, workflowKey, processingMode: "classification" })`.
No planning application, case or form row should be invented for this workflow.
The SDK returns the original response, status and job payload without consuming
it. Job acceptance is not processing success: inspect the tracked stages and
read back the saved results. A status timeout is not a reason to upload again.

### Existing DAISY And Assess Context

```tsx
const { upload } = useDocuments(tenantId);

const response = await upload(file, {
  planningApplicationId: applicationId,
  assessCaseId: caseId, // Only when this is an Assess document.
  category: "supporting-document",
});
```

Use a real `planningApplicationId` or `businessRequestId`. Assess also supplies
its real `assessCaseId`. These existing contexts do not require standalone
app/workflow selection. PublicAPI remains responsible for checking ownership
and the relationship between the records. Existing string metadata using
`planning_application_id`, `business_request_id`, `assess_case_id` and
`processing_mode` is translated to the same request. `application_id` is not
an alias for planning scope.

Every upload sends exactly one `tenant_id` from the SDK client, one
`storage_target=resourceapi` and one `processing_mode`. Metadata cannot
override the tenant. Conflicting aliases, storage downgrades, blank scope,
incomplete app/workflow pairs, and unsupported metadata are rejected before
fetch. `classify` rejects a conflicting processing mode. Calling
`classify(files)` without context gives an actionable error; it never calls
the retired `/classify` endpoint.

Supported non-scope string metadata is limited to `category`, `source`,
`enrichment_level`, `context_data`, `tenant_slug`, `council_name`, `org_id`,
`document_id`, `conversation_id`, `workflow`, `source_service`,
`correlation_id` and the compatibility field `async_mode`. These fields do
not grant authority or select a lifecycle.

### Readback And Cleanup

Keep the exact `DOC-...` document number or resource UUID from the upload/job
response for retained access. Canonical hyphenated and compact hexadecimal UUIDs
are supported. Record helpers reject whitespace, URL syntax and path segments
before making a request; pass the ID itself, not a URL:

```tsx
const { getRecord, getContent, deleteRecord } = useDocuments(tenantId);

const recordResponse = await getRecord(documentId);
const record = await recordResponse.json();
const contentResponse = await getContent(documentId);
const originalFile = await contentResponse.blob();

// Only after the user requests deletion.
await deleteRecord(documentId);
```

These helpers use the PublicAPI-owner-confirmed contracts:

```text
GET    /v4/data/documents/records/{documentId}?storage_target=resourceapi
GET    /v4/data/documents/records/{documentId}/content?storage_target=resourceapi
DELETE /v4/data/documents/records/{documentId}?storage_target=resourceapi
```

They send `X-Tenant-Id` from the client. Each accepts optional `{ jobId }`,
encoded as `job_id`, only for lookup/cross-checking. It is not authority and is
not required for retained documents after the job tracker expires. PublicAPI
uses persisted ownership and lifecycle context, not a newly edited classifier
binding. Content is returned unchanged, and errors including incomplete cleanup
remain visible to the caller. The SDK does not directly delete files or analysis
rows and does not retry through another route.

The standalone lifecycle and business record/content support are coordinated
Issues2025#3453 candidate changes, not a claim of deployed or live-accepted
behaviour. Client tests validate request construction; backend and real-provider
qualification remain separate release gates.

### Direct URL Analysis

`classifyByUrl(url, { verticalKey, workflowKey })` remains direct analysis through
`POST /v4/data/documents/classify-by-url`. It is not queued upload, saved
document/analysis state or cleanup, and must not be used as a durable-workflow
workaround. Existing unscoped URL analysis remains available; explicitly
supplied classifier scope must contain both nonblank keys.

The CLI has corresponding `eai docs` commands. Check `eai docs --help` and the
installed command's help for supported context flags. CLI integration is owned
separately; do not assume a context-free upload is a supported business workflow.

## Resource File Property Workflow

Use resource file properties when the file is an attachment to business data:
inspection photos on an inspection record, signed PDFs on a contract record,
CSV evidence on an audit record, or files that should follow a resource's
permissions and lifecycle.

Step goals:

1. Define an Object Type with a `file` property.
2. Seed the Object Type.
3. Create or find the resource row.
4. Upload the file to that resource's file property.
5. Read, delete, or request a short-lived read URL through the same resource
   route when the user has access.

App code:

```tsx
const resources = useResources("ApplicationDocument", tenantId);

const document = await resources.create({
  title: file.name,
  applicationId,
  status: "uploaded",
});

await resources.uploadFile(document.id, "file", file, {
  filename: file.name,
  contentType: file.type || "application/octet-stream",
});

const fileStatus = await resources.getFileIndexStatus(document.id, "file");
```

CLI equivalent:

```bash
eai resources create ApplicationDocument \
  --tenant-id <tenant-id> \
  --data '{"title":"supporting-document.pdf","applicationId":"app-123"}'

eai resources file upload ApplicationDocument <resource-id> file ./supporting-document.pdf \
  --tenant-id <tenant-id>
```

The PublicAPI route behind this workflow is:

```text
POST /v4/data/resources/{tenantId}/{objectType}/{resourceId}/files/{propertyName}
```

## AI Workflow Access To Documents

AI workflows should not fetch raw blob storage directly from browser code. The
app should give the workflow stable platform context:

- `tenantId`
- `workflowId`
- `stage`
- `documentId` or `documentIds`
- related resource IDs such as `applicationId`, `caseId`, or `businessRequestId`
- user intent in the `message`
- structured values in `params` or `runtime_context`

Example:

```tsx
await client.chat.send({
  workflowId: "application-advisor",
  stage: "review",
  message: "Summarise the uploaded supporting documents and list missing evidence.",
  conversationId,
  params: {
    applicationId,
    documentIds: [documentId],
  },
  runtime_context: {
    applicationId,
    documentIds: [documentId],
  },
});
```

The workflow then uses the platform document/RAG context that has already been
indexed or attached to the resource. The prompt should ask for an outcome, not
for a storage URL.

## Prompt Templates For AI Agents

When an AI agent is building an app feature, it should ask the user these
questions before choosing an API:

```text
1. Is the uploaded file a document to process with AI, or an attachment to a business record?
2. Should AI answer from the file content, classify it, or just keep it as evidence?
3. Which tenant, workflow, and workflow stage should use the document?
4. If this is an attachment, which Object Type, resource ID, and file property owns it?
5. What should happen when the user deletes the resource or document?
```

When the file is a document:

```text
Use one queued EAI document upload with real parent context or paired standalone
app/workflow context. Track the job and read saved results. Only request stages
supported by the configured lifecycle. Pass document IDs into chat/workflow
context. Do not upload twice, invent a planning parent, call retired classify,
or create a standalone blob upload path.
```

When the file is a resource attachment:

```text
Use a ResourceAPI file property. Ensure the Object Type has a file property,
create or locate the resource, upload through the resource file route, and rely
on resource permissions for access.
```

When the request asks for standalone blob storage:

```text
There is no public v4 app-template pattern for arbitrary blob writes. Ask
whether this should be a document workflow or a resource file property, then
implement that public v4 model.
```

## Verification

Use these checks while developing:

```bash
eai whoami
eai resources schema --tenant-id <tenant-id> --format json
eai docs --help
eai resources file upload <ObjectType> <resource-id> <property> ./sample.pdf --tenant-id <tenant-id>
```

Use named commands first. Use `eai publicapi <method> /v4/...` only when an
authorized v4 route has no named SDK or CLI command yet.
