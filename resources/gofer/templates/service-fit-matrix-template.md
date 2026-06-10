---
feature: "{{feature-name}}"
created: "{{ISO-timestamp}}"
workflowProfile: enterpriseai
status: draft
---

# Service Fit Matrix: {{feature-name}}

## Package And Coupling Fit

| Field                   | Decision                                                 | Evidence   |
| ----------------------- | -------------------------------------------------------- | ---------- |
| Profile choice          | External / Internal / Hybrid                             | {{source}} |
| Package lane            | {{public-package-internal-app-hybrid-adapter-app-local}} | {{source}} |
| Coupling status         | {{daisy-coupled-daisy-decoupled-hybrid-adapter}}         | {{source}} |
| Public-readiness target | {{required-deferred-not-applicable}}                     | {{source}} |

| Capability  | User Need | Evidence Source    | Status                                 | Selected Direction | Notes     |
| ----------- | --------- | ------------------ | -------------------------------------- | ------------------ | --------- |
| {{service}} | {{need}}  | {{command-or-doc}} | Accessible / Purchasable / Unavailable | {{decision}}       | {{notes}} |

## EAI Service Pattern Checklist

| Need                                             | Preferred Pattern                                                               | Evidence To Capture                                                                                 | Do Not Do                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Frontend composition                             | Config slots in `src/eai.config` plus registered blocks in `src/eai.blocks.tsx` | Component names, slot shape, store bindings, showWhen paths, override boundary                      | Put callbacks or React nodes inside config                                   |
| Tenant data model or business records            | ResourceAPI object type through `eai types` and generated config                | Object type name, fields, roles, actions, events, and CLI output                                    | Invent ad hoc frontend-only schemas for tenant records                       |
| Document upload, extraction, or RAG source files | `useDocuments` in apps and `eai docs` from CLI                                  | Document type, storage backend, processing status, chunking/index evidence                          | Write browser clients directly to Blob Storage or Azure AI services          |
| Chat or AI workflow                              | `useChat` in apps and `eai chat` from CLI                                       | Conversation ID, persona/context, tool or retrieval needs, streaming/non-streaming decision         | Call provider LLM APIs directly from app code                                |
| Search over tenant resources                     | ResourceAPI/PublicAPI search over object types                                  | Query shape, filters, tenant scope, indexes involved                                                | Query Azure AI Search directly from apps unless a platform route requires it |
| Unsupported or advanced API route                | `eai publicapi` against an authorized V4 endpoint                               | Route, payload, auth scope, and reason no named CLI/SDK helper exists                               | Bypass PublicAPI for normal product traffic                                  |
| Storage backend choice                           | ResourceAPI storage type: `postgresql`, `documentdb`, `blob`, or `search`       | Selected backend and reason: relational, flexible JSON, binary document, semantic/search projection | Treat storage as an app-owned implementation detail                          |
