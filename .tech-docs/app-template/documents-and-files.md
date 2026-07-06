---
generated: false
title: V4 Documents And Files
---

# V4 Documents And Files

Use this guide when deciding how an EAI app, AI agent, or terminal workflow
should upload files, expose documents to AI, or attach files to business data.

## Decision Tree

| User goal | Correct v4 model | App pattern | CLI pattern |
| --- | --- | --- | --- |
| Upload a document so the platform can process, classify, or index it for AI | Document workflow | `useDocuments().upload`, `classify`, `ragIndex` | `eai docs upload`, `eai docs classify`, `eai docs index` |
| Attach a file to an existing business record | Resource file property | `useResources(type).uploadFile` | `eai resources file upload` |
| Store an arbitrary blob without a document or resource owner | Not a public v4 app pattern | Ask the user to choose document workflow or resource file property | No named command |

V4 files are not public free-form blob writes. A file belongs to either a
document workflow or a typed ResourceAPI resource property.

## Document Workflow

Use this path when the file itself is the subject of platform processing:
contracts, policies, evidence packs, supporting documents, reports, PDFs, Word
files, or knowledge sources.

Step goals:

1. Upload the file with tenant context.
2. Capture the returned job or document ID.
3. Classify the document when the app needs type or extraction hints.
4. Index the document for RAG when chat or workflow stages need to answer from
   the content.
5. Pass document IDs and business context into AI workflow calls. Do not give
   the browser direct blob credentials.

SDK example:

```tsx
const { upload, classify, ragIndex, getJobStatus } = useDocuments(tenantId);

const uploadResponse = await upload(file, {
  category: "supporting-document",
  application_id: applicationId,
});
const payload = await uploadResponse.json();
const documentId =
  payload.documentId ||
  payload.documents?.[0]?.documentId ||
  payload.documents?.[0]?.document_id;

await classify([file]);
await ragIndex({
  documentId,
  businessRequestId: applicationId,
  documentScope: "br",
});

if (payload.jobId) {
  await getJobStatus(payload.jobId);
}
```

CLI example:

```bash
eai docs upload ./supporting-document.pdf
eai docs classify ./supporting-document.pdf
eai docs index <document-id>
```

PublicAPI route:

```text
POST /v4/data/documents/upload
```

Use `eai publicapi get /v4/data/documents/jobs/<job-id>` for job status until a
named CLI job command exists.

## Resource File Property Workflow

Use this path when the file is an attachment to business data: inspection
photos, signed PDFs, audit evidence, generated reports, or files whose access
should follow a resource's permissions and lifecycle.

Step goals:

1. Define an Object Type with a `file` property.
2. Seed the Object Type.
3. Create or find the owning resource.
4. Upload the file to the resource file property.
5. Read, delete, or request short-lived access through the same resource route.

SDK example:

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

CLI example:

```bash
eai resources create ApplicationDocument \
  --tenant-id <tenant-id> \
  --data '{"title":"supporting-document.pdf","applicationId":"app-123"}'

eai resources file upload ApplicationDocument <resource-id> file ./supporting-document.pdf \
  --tenant-id <tenant-id>
```

PublicAPI route:

```text
POST /v4/data/resources/{tenantId}/{objectType}/{resourceId}/files/{propertyName}
```

## AI Workflow Access To Documents

AI workflows should receive platform context, not storage URLs. Pass:

- tenant ID;
- workflow ID and stage;
- document IDs or resource IDs;
- the user's goal as `message`;
- structured IDs and filters in `params` or `runtime_context`.

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

The prompt should ask for an outcome from indexed or attached content, not for a
blob path.

## Prompt Template For AI Agents

Ask these questions before choosing an API:

```text
1. Is the file a document to process with AI, or an attachment to a business record?
2. Should AI answer from the content, classify it, or keep it as evidence only?
3. Which tenant, workflow, and stage should use the document?
4. If this is an attachment, which Object Type, resource ID, and file property owns it?
5. What should happen when the user deletes the resource or document?
```

If the answer is document processing:

```text
Use the EAI document workflow: upload, optional classify, optional RAG index,
then pass document IDs into chat or workflow runtime context.
```

If the answer is resource attachment:

```text
Use ResourceAPI file properties: validate the Object Type file property, create
or find the resource, upload through the resource file route, and rely on
resource permissions for access.
```

If the answer is standalone blob upload:

```text
There is no public v4 app pattern for arbitrary blob writes. Ask whether the
user means a document workflow or a resource file property.
```

## Verification

```bash
eai whoami
eai resources schema --tenant-id <tenant-id> --format json
eai docs upload ./sample.pdf
eai docs index <document-id>
eai resources file upload <ObjectType> <resource-id> <property> ./sample.pdf --tenant-id <tenant-id>
```

Use named commands first. Use `eai publicapi <method> /v4/...` only when an
authorized v4 route has no named SDK or CLI command yet.
