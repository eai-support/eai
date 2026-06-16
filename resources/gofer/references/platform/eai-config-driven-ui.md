# EAI Config-Driven UI Reference

Use this public-safe guide when eai-gofer is planning, generating, or modifying
an app based on `https://github.com/eai-tools/eai-app-template`.

## Source Files

| File                        | Purpose                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `src/eai.config/default.ts` | Default tenant config, store slices, API paths, storage keys, and layout slots. |
| `src/eai.config/index.ts`   | Tenant key to config registry.                                                  |
| `src/eai.blocks.tsx`        | Component registry and app-local block extension point.                         |
| `src/app/providers.tsx`     | Auth/session providers and EAI config runtime.                                  |
| `src/hooks/useResources.ts` | ResourceAPI-backed business data.                                               |
| `src/hooks/useDocuments.ts` | Document upload, classification, and RAG indexing.                              |
| `src/hooks/useChat.ts`      | Streaming and non-streaming chat workflows.                                     |

## Construction Rules

1. Keep tenant-specific values in config: branding, feature flags, API
   endpoints, storage keys, store slices, and layout slots.
2. Register renderable components before referencing them from config.
3. Reference components by their registered string name.
4. Use `storeBindings` to map global store paths into component props.
5. Use JSON-safe `showWhen` conditions for visibility.
6. Keep functions, React nodes, auth actions, analytics callbacks, router
   navigation, and render props in code-level overrides.
7. Keep browser service calls behind BFF routes and template hooks.

## Component Entry Shape

```ts
{
  component: 'TaskSummary',
  priority: 10,
  props: {
    title: 'Open tasks',
  },
  storeBindings: [
    { prop: 'tasks', storePath: 'tasks.items' },
    { prop: 'isLoading', storePath: 'tasks.isLoading' },
  ],
  showWhen: { path: 'user.isAuthenticated', equals: true },
}
```

Rules:

- `component` must match a registered component name.
- Lower `priority` renders first.
- `props` are static, tenant-configurable values.
- `storeBindings` support dot notation on both `prop` and `storePath`.
- `showWhen` supports `equals`, `notEquals`, `exists`, and compound `and`/`or`.

## Slot Shape

Use the template slot shape:

```ts
layout: {
  header: {
    components: [{ component: 'AppHeader', priority: 1 }],
  },
  middlePane: {
    components: [
      { component: 'TaskSummary', priority: 1 },
      { component: 'TaskList', priority: 2 },
    ],
  },
  rightPane: {
    components: [{ component: 'AssistantPanel', priority: 1 }],
  },
}
```

Do not generate stale array-only slots such as
`middlePane: [{ component: 'Dashboard' }]`.

## Store Slice Shape

```ts
store: {
  tasks: {
    initialState: {
      items: [],
      selectedId: null,
      isLoading: false,
    },
    persist: true,
  },
  ui: {
    initialState: { showWelcome: true },
    persist: false,
  },
}
```

Persist only tenant-safe UI or workflow state. Never place access tokens,
platform credentials, database connection details, blob credentials, search
credentials, or model provider credentials in config or store state.

## Runtime Override Boundary

Config is data-only. Use wrapper components for runtime behavior:

```tsx
const componentOverrides = {
  TaskList: {
    onSelectTask: (taskId: string) => setSelectedTaskId(taskId),
  },
  AssistantPanel: {
    onSendMessage: sendMessage,
  },
};
```

Put these values in overrides, not config:

- event handlers
- auth login/logout handlers
- router callbacks
- analytics callbacks
- render props
- React nodes
- non-serializable objects

## Service Pairing

The config-driven UI should pair with the service matrix:

| UI Need                                               | Service Pattern                                            |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| Tenant business records                               | `useResources('<ObjectType>')`                             |
| File upload, document classification, or RAG indexing | `useDocuments()`                                           |
| AI chat or workflow interaction                       | `useChat(workflowId, stage)`                               |
| Browser streaming                                     | `/api/eai/stream/...` through the app BFF                  |
| Advanced platform route                               | Server-side helper or `eai publicapi` for CLI verification |

Do not call downstream platform services, storage backends, search indexes, or
model providers directly from browser components.

## eai-gofer Validation Checklist

Before marking app UI work complete:

- Confirm each config component name exists in the registry or an app-local
  block extension.
- Confirm each `storeBindings[].storePath` is backed by a store slice or a
  documented runtime provider.
- Confirm each `showWhen.path` is backed by a store slice.
- Confirm callbacks and React nodes are in overrides, not config.
- Confirm service hooks match the selected capability: resources, documents,
  chat, or approved PublicAPI route.
- Confirm examples are public-safe and do not reference private docs,
  credentials, internal repository names, or organization-only implementation
  details.
