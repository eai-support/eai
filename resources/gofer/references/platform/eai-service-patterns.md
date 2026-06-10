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

| Need                 | App Pattern                                                                       | CLI Pattern                                                                                 | Notes                                                              |
| -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Frontend composition | `src/eai.config` layout slots plus `src/eai.blocks.tsx` registry                  | `eai gofer refresh` installs this reference pack                                            | Keep config data-only; callbacks belong in overrides.              |
| Data model           | Object Types in `src/eai.config/object-types.ts`                                  | `eai types validate`, `eai types seed`, `eai types diff`                                    | Object Types define ResourceAPI contracts.                         |
| Structured resources | `useResources(type)` / `client.resources`                                         | `eai resources list/get/create/update/delete/query`                                         | Default for tenant business data.                                  |
| Resource actions     | `client.resources.executeAction(type, id, action)`                                | named resources command if available; otherwise `eai publicapi post /v4/data/resources/...` | Actions enforce object-type rules.                                 |
| Resource search      | local helper around `/v4/data/resources/{tenant}/search` if SDK support is absent | `eai resources search "query" --mode hybrid`                                                | Search is a projection over canonical data.                        |
| Resource files       | local helper around resource file routes                                          | `eai resources file upload/get/delete`                                                      | Use for file fields on ResourceAPI objects.                        |
| Documents            | `useDocuments().upload/classify/ragIndex`                                         | `eai docs upload`, `eai docs classify`, `eai docs index`                                    | Use for platform document processing and RAG.                      |
| Chat                 | `useChat(workflowId, stage).send/stream`                                          | `eai chat send`, `eai chat stream`                                                          | Use v4 chat shape with `message`, `conversation_id`, and `params`. |
| Advanced PublicAPI   | BFF/server helper                                                                 | `eai publicapi <method> /v4/...`                                                            | Use only when named SDK/CLI support is missing.                    |

## Storage Backend Rules

- `postgresql`: canonical structured resource storage.
- `documentdb`: document-model persistence when the data genuinely needs it.
- `blob`: large files or file-like resources behind API-mediated access.
- `search`: derived full-text/vector/hybrid projection, not the sole system of
  record for runtime writes.

Document RAG indexing is a documents service pattern (`eai docs index` or
`useDocuments().ragIndex(...)`), not a reason to create a search-only Object
Type.

## Config-Driven UI Rules

- Use the EAI App Template slot shape: `{ components: [...] }`.
- Register components before referencing them in config.
- Add store slices before adding `storeBindings`.
- Use JSON-safe `showWhen` conditions for visibility.
- Put functions, React nodes, auth handlers, router callbacks, analytics hooks,
  and render props in overrides.
- Validate component names and store paths before completion.
