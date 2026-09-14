# EAI Service Pattern Reference

This public-safe matrix teaches eai-gofer how to choose platform services when
planning or implementing an EAI app. It is a compact companion to the runnable
patterns in `eai-app-template/docs/platform/eai-service-patterns.md`.

## Boundary Rules

- App browser code calls the local BFF at `/api/eai/...`.
- App streaming calls use `/api/eai/stream/...`.
- The CLI may call PublicAPI directly because `eai login` provides the user
  token.
- Prefer named template SDK hooks and named `eai` commands before custom calls.
- Use `eai publicapi` only for authorized PublicAPI V4 routes that do not yet
  have a named SDK or CLI command.
- Do not generate direct downstream database, blob, search, or platform secrets.

## Service Selection Matrix

| Need                 | App Pattern                                                                       | CLI Pattern                                                                                                                                                           | Notes                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Frontend composition | `src/eai.config` layout slots plus `src/eai.blocks.tsx` registry                  | `eai gofer refresh` installs this reference pack                                                                                                                      | Keep config data-only; callbacks belong in overrides.                                                                             |
| Data model           | Object Types in `src/eai.config/object-types.ts`                                  | `eai types validate`, `eai types seed`, `eai types diff`                                                                                                              | Object Types define ResourceAPI contracts.                                                                                        |
| Structured resources | `useResources(type)` / `client.resources`                                         | `eai resources list/get/create/update/delete/query`                                                                                                                   | Default for tenant business data.                                                                                                 |
| Resource actions     | `client.resources.executeAction(type, id, action)`                                | named resources command if available; otherwise `eai publicapi post /v4/data/resources/...`                                                                           | Actions enforce object-type rules.                                                                                                |
| Resource search      | local helper around `/v4/data/resources/{tenant}/search` if SDK support is absent | `eai resources storage doctor --format json`, then `eai resources search "query" --fulltext`; use `--hybrid` or `--vector` only when doctor reports those modes ready | V4 passive ResourceAPI search is a projection over canonical data. Fulltext can be usable before semantic search modes are ready. |
| Resource files       | local helper around resource file routes                                          | `eai resources file upload/get/delete`                                                                                                                                | Use when the file is attached to a typed ResourceAPI object property.                                                             |
| Documents | One `useDocuments().upload(file, context)` OR `classify([file], context)` | One `eai docs upload` OR `eai docs classify`, with authorized context | Queued ResourceAPI upload; follow the document lifecycle rules below. |
| Chat                 | `useChat(workflowId, stage).send/stream`                                          | `eai chat send`, `eai chat stream`                                                                                                                                    | Use v4 chat shape with `message`, `conversation_id`, and `params`.                                                                |
| Advanced PublicAPI   | BFF/server helper                                                                 | `eai publicapi <method> /v4/...`                                                                                                                                      | Use only when named SDK/CLI support is missing.                                                                                   |

## Document Lifecycle Rules

The #3453 standalone lifecycle is a candidate, not deployed capability or live
acceptance evidence. Before generating or enabling an upload, verify the
installed CLI/SDK supports the context contract and the target runtime supports
the configured lifecycle. Provision the business document/analysis schemas and
Admin Portal lifecycle binding first. Storage readiness and classifier
readiness are separate checks; a published classifier alone is not enough.

- Use one `POST /v4/data/documents/upload` for durable upload and queued
  classification, with `storage_target=resourceapi`. Browser callers use the
  local BFF `/api/eai/v4/data/documents/upload`; tokens stay server-side.
- For standalone documents, send both `verticalKey` and `workflowKey`. PublicAPI
  validates the authorised app/workflow and resolves optional
  `config.documentLifecycle` on the existing classifier-target
  `vertical-product-config` binding, never from the upload body.
- Allowed binding values are `planning-assist-v1`, `planning-assess-v1`, and
  `business-document-v1`. Omission preserves existing behaviour and does not
  erase a saved selection on reassociation. Unsupported values fail validation.
  Missing planning fields do not imply business mode.
- Preserve working DAISY/Assess requests, planning/case relationships, rules,
  stored records and in-flight jobs. Retain real authorised
  `planning_application_id`, `business_request_id` and applicable
  `assess_case_id` context (SDK: `planningApplicationId`, `businessRequestId`,
  `assessCaseId`). Never fabricate a planning application, business request,
  case or form submission for a standalone document. Optional real parents
  must be supported by the selected lifecycle and authorised.
- Call `classify([file], context)` for `processing_mode=classification`, OR
  `upload(file, context)` for full requested processing. Do not upload and then
  classify the same bytes again. The SDK supplies `storage_target=resourceapi`.
  Do not generate context-free legacy file classification or a fallback to it.
- Do not send lifecycle mappings, target collections, permissions, provider
  credentials or worker pins from the client. Missing schema, storage,
  service, app/workflow or classifier readiness must fail before upload-side
  writes, not fall back to legacy storage or an unscoped classifier.
- Retain the returned job/document IDs. Poll
  `GET /v4/data/documents/jobs/{job_id}` with authorised context and read back
  saved requested stages and provenance. Acknowledgement and provider success
  are not completed classification, extraction, rule validation or persistence.
  A polling timeout is incomplete; never re-upload automatically.
- Indexing is an optional derived stage only where supported and requested.
  Use authorised lifecycle file retrieval and cleanup. Invalidate stale work
  and clean only owned outputs according to retention, never shared parents.
- Direct `POST /v4/data/documents/classify-by-url` is analysis, not a durable
  queued upload/save/readback/cleanup replacement. New workflow-selected URL
  callers also supply the app/workflow pair. Preserve established unscoped
  DAISY/Assess classifier behaviour without making it a new business-app default.

Candidate example after provisioning and version checks, submitted once:

```tsx
const { classify } = useDocuments(tenantId);
const response = await classify([file], {
  verticalKey: appKey,
  workflowKey,
});
if (!response.ok) throw new Error("Document submission failed.");
const accepted = await response.json();
```

Retain the returned IDs and implement bounded status polling plus saved-result
readback before reporting success. The equivalent CLI submission is:

```bash
eai docs classify ./document.pdf --tenant-id <tenant-id> \
  --storage-target resourceapi --vertical-key <app-key> --workflow-key <workflow-key>
```

An authorised administrator selects the binding with
`eai classifier target <classifier-key> --app <app-key> --workflow <workflow-key>
--document-lifecycle business-document-v1` after schema/storage and published
classifier readiness checks. Verify this syntax with the installed command's
`--help`. `--document-lifecycle` is a target-administration option, not an upload
option.

Scope is document-use migration, not all v3 retirement. Existing-record
read/download/delete/status, old queued callbacks, reference files and real
form attachments remain compatibility obligations. Replacement, client and
tenant-setup proof must precede enforcement against approved new legacy
admissions. Track package/plugin/docs publication and installed adoption
separately from local source or generator checks; do not claim live acceptance.


## Storage Backend Rules

Keep Object Type identifiers in their correct layer. Configuration/model
`name` is PascalCase; the exact stored `slug` is the lowercase
kebab-case identifier used by relationship targets, runtime `target_type`,
resource commands, paths, and governed v4 fields. Resolve same-manifest model
name shorthand through the declared slug before publication. Never normalize
or rename a historical stored slug.

- `postgresql`: canonical structured resource storage.
- `documentdb`: document-model persistence when the data genuinely needs it.
- `blob`: large files or file-like resources behind API-mediated access.
- `search`: derived full-text/vector/hybrid projection, not the sole system of
  record for runtime writes. On the v4 passive ResourceAPI interface, treat
  full-text readiness separately from hybrid/vector readiness; semantic modes
  require `eai resources storage doctor` to report `capabilities.search.hybrid`
  or `capabilities.search.vector`. Do not apply this fallback rule to legacy
  v1/v3 or active ResourceAPI behavior.

Document RAG indexing is a documents service pattern (`eai docs index` or
`useDocuments().ragIndex(...)`), not a reason to create a search-only Object
Type.

Do not create standalone PublicAPI v4 blob-upload flows. If a user asks to
upload a file, first decide whether the file is a document workflow input or a
ResourceAPI file property. Ask which tenant, workflow/stage, document purpose,
Object Type, resource ID, and file property are involved before writing code.

## Config-Driven UI Rules

- Use the EAI App Template slot shape: `{ components: [...] }`.
- Register components before referencing them in config.
- Add store slices before adding `storeBindings`.
- Use JSON-safe `showWhen` conditions for visibility.
- Put functions, React nodes, auth handlers, router callbacks, analytics hooks,
  and render props in overrides.
- Validate component names and store paths before completion.
