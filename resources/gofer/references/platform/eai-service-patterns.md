# EAI Service Pattern Reference

This public-safe matrix teaches eai-gofer how to choose platform services when
planning or implementing an EAI app. It is a compact companion to the runnable
patterns in `eai-app-template/docs/platform/eai-service-patterns.md`.

## Boundary Rules

- App browser code calls the local BFF at `/api/eai/...`.
- App streaming calls use `/api/eai/stream/...`.
- Tenant app data-plane access is user-delegated access through the BFF. Do not
  add app-only `client_credentials` access for ordinary ResourceAPI reads,
  writes, files, or search.
- The CLI may call PublicAPI directly because `eai login` provides the user
  token.
- Prefer named template SDK hooks and named `eai` commands before custom calls.
- Use `eai publicapi` only for authorized PublicAPI V4 routes that do not yet
  have a named SDK or CLI command.
- Do not generate direct downstream database, blob, search, or platform secrets.

## Service Selection Matrix

| Need                  | App Pattern                                                                       | CLI Pattern                                                                                                                                                           | Notes                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend composition  | `src/eai.config` layout slots plus `src/eai.blocks.tsx` registry                  | `eai gofer refresh` installs this reference pack                                                                                                                      | Keep config data-only; callbacks belong in overrides.                                                                                                                              |
| Data model            | Object Types in `src/eai.config/object-types.ts`                                  | `eai app provision`, `eai types validate --tenant-key <key> --tenant-id <tenant-id>`, `eai types seed`, `eai types diff`                                              | Object Types define ResourceAPI contracts and must use app-owned storage bindings.                                                                                                 |
| Structured resources  | `useResources(type)` / `client.resources`                                         | `eai resources list/get/create/update/delete/query`                                                                                                                   | Default for tenant business data. For tenant-scoped calls, treat the path tenant as canonical and have the app BFF forward both `tenant` and `X-Tenant-Id` server-authoritatively. |
| Resource actions      | `client.resources.executeAction(type, id, action)`                                | named resources command if available; otherwise `eai publicapi post /v4/data/resources/...`                                                                           | Actions enforce object-type rules.                                                                                                                                                 |
| Resource search       | local helper around `/v4/data/resources/{tenant}/search` if SDK support is absent | `eai resources storage doctor --format json`, then `eai resources search "query" --fulltext`; use `--hybrid` or `--vector` only when doctor reports those modes ready | V4 passive ResourceAPI search is a projection over canonical data. Fulltext can be usable before semantic search modes are ready.                                                  |
| Resource files        | local helper around resource file routes                                          | `eai resources file upload/get/delete`                                                                                                                                | Use when the file is attached to a typed ResourceAPI object property.                                                                                                              |
| Documents             | `useDocuments().upload/classify/ragIndex`                                         | `eai docs upload`, `eai docs classify`, `eai docs index`                                                                                                              | Use when the file should be processed, classified, indexed, or exposed to AI/RAG context.                                                                                          |
| Content understanding | Document and media extraction behind the app BFF                                  | `eai docs classify`, `eai docs extract`, `eai docs summarize` when advertised                                                                                         | Use for classification, extraction, summarization, and evidence preparation before workflow or AI steps.                                                                           |
| Chat                  | `useChat(workflowId, stage).send/stream`                                          | `eai chat send`, `eai chat stream`                                                                                                                                    | Use v4 chat shape with `message`, `conversation_id`, and `params`.                                                                                                                 |
| AI services           | Template AI hooks and workflow-backed assistant steps                             | `eai agent guide --format json`, advertised `eai ai` or workflow commands                                                                                             | Prefer platform AI services for app behavior. Avoid direct provider keys in app code unless EAI documents that integration.                                                        |
| Workflows             | Workflow-backed tasks that can continue across user sessions                      | `eai workflow readiness --format json` and advertised workflow commands                                                                                               | Use for multi-step business processes, approvals, background work, and auditable state changes.                                                                                    |
| Goals and targets     | Goal/target records tied to resources and workflow outcomes                       | `eai workflow readiness --format json`, `eai resources schema --format json`, and advertised goal/target commands                                                     | Use when the app must track business outcomes, service levels, operating targets, or completion evidence.                                                                          |
| Advanced PublicAPI    | BFF/server helper                                                                 | `eai publicapi <method> /v4/...`                                                                                                                                      | Use only when named SDK/CLI support is missing.                                                                                                                                    |

## Storage Backend Rules

Keep Object Type identifiers in their correct layer. Configuration/model `name`
is PascalCase; the exact stored `slug` is the lowercase kebab-case identifier
used by relationship targets, runtime `target_type`, resource commands, paths,
and governed v4 fields. Resolve same-manifest model name shorthand through the
declared slug before publication. Never change historical stored slugs.

## Tenant-Scoped Resource Diagnostics

- For `/v4/data/resources/{tenantId}/...` requests, compare the same call in
  four header modes before concluding the tenant is unprovisioned: path tenant
  only, `tenant` only, `X-Tenant-Id` only, and both headers.
- If the same tenant-scoped endpoint flips between `200` and `503` based on
  headers, suspect a tenant-context contract mismatch before an install or
  schema failure.
- Inspect the app BFF or proxy code before escalating to a platform-only fault.
  The default app-template proxy should forward both tenant headers
  server-authoritatively for tenant-scoped PublicAPI calls.
- Treat `/v4/platform/tenants/{tenantId}/resource-metadata` and its
  `publishedObjectTypes` as operational state, not descriptive metadata only.
  Empty or stale published types can block `/storage` readiness even when the
  tenant and app exist.
- Use `eai resources storage doctor --tenant-id <tenant-id> --format json`
  alongside direct `/storage` checks so install, schema, and projection issues
  are evaluated from the tenant's public contract.

If work must continue after the user leaves the page, have the signed-in user
request a platform workflow/job and pass tenant, app, user, and purpose context
into that workflow. Do not give the tenant app a broad service identity for
normal data-plane access.

## Storage Backend Rules

Tenant app Object Types must use app-owned storage bindings. For PostgreSQL
types, use the `tenant-postgres` alias and table names that include the
tenant/app prefix validated by
`eai types validate --tenant-key <key> --tenant-id <tenant-id>`. Do not invent
storage aliases or generic table names; derive them from `eai app provision`,
`.eai/storage-bindings.json`, and the local Object Type helper.

- `postgresql`: default for relational, transactional, reporting, workflow
  state, audit, and structured tenant business data.
- `documentdb`: document-model persistence for flexible JSON documents, nested
  records, high-change schemas, and user-authored document state.
- `blob`: large files, binary content, exports, and file-like resources behind
  API-mediated access.
- `search`: derived full-text/vector/hybrid projection, not the sole system of
  record for runtime writes. On the v4 passive ResourceAPI interface, treat
  full-text readiness separately from hybrid/vector readiness; semantic modes
  require `eai resources storage doctor` to report `capabilities.search.hybrid`
  or `capabilities.search.vector`. Do not apply this fallback rule to legacy
  v1/v3 or active ResourceAPI behavior.
- `content understanding`: use the EAI document and content services before
  custom extraction code when the app must classify, extract, summarize, or
  prepare evidence from documents or media.
- `workflows`: use the EAI workflow layer for approvals, long-running work,
  service goals, operating targets, and cross-user process state.
- `AI services`: use platform AI hooks and workflow-backed agents first. Do not
  add direct provider keys, ad hoc LLM clients, or non-EAI AI services unless
  the platform lacks the capability and the exception is approved.

## Business Decision Rules

When Gofer plans an EAI app, it should make the normal platform choice on behalf
of the business user.

1. Use the simplest EAI Platform service that satisfies the requirement.
2. Record the choice and reason in `service-fit-matrix.md`.
3. Ask the user only when the choice affects cost, security, compliance,
   deployment, data residency, external systems, or material business scope.
4. If a capability appears missing, run live CLI discovery before recommending a
   non-EAI service.
5. If EAI does not expose the capability, use Azure second.
6. Use any other platform only with explicit exception evidence.

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
