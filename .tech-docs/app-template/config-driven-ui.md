---
generated: false
title: Config-Driven UI
---

# Config-Driven UI

Use config-driven UI when an app needs tenant-specific layout, copy, feature
flags, store state, or service wiring without forking page code per tenant.

## Source Files

| File                        | Purpose                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `src/eai.config/default.ts` | Default tenant config, store slices, API paths, storage keys, and layout slots. |
| `src/eai.config/index.ts`   | Maps tenant keys to config objects.                                             |
| `src/eai.blocks.tsx`        | Registers app-local or package components that config can reference by name.    |
| `src/app/providers.tsx`     | Provides auth/session context and the EAI config runtime.                       |
| `src/hooks/useResources.ts` | ResourceAPI-backed business data access.                                        |
| `src/hooks/useDocuments.ts` | Document upload, classification, and RAG indexing access.                       |
| `src/hooks/useChat.ts`      | Streaming and non-streaming chat access.                                        |

## Construction Pattern

1. Put tenant-specific data in config: branding, feature flags, API endpoints,
   storage keys, initial store state, and layout slots.
2. Register renderable components in `src/eai.blocks.tsx`.
3. Reference components from config by their registered string name.
4. Bind store paths into component props with `storeBindings`.
5. Hide or show components with JSON-safe `showWhen` conditions.
6. Keep callbacks, React nodes, and live browser behavior in code-level
   overrides, not config.
7. Keep browser service calls behind template hooks and BFF routes.

## Component Config Shape

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
- `storeBindings` map store paths to component prop paths. Dot notation is
  supported on both sides.
- `showWhen` supports `equals`, `notEquals`, `exists`, and compound `and` or
  `or`.

## Slot Pattern

Use the template slot shape:

```ts
layout: {
  header: {
    className: 'bg-white border-b',
    components: [{ component: 'AppHeader', priority: 1 }],
  },
  middlePane: {
    className: 'flex-1 p-6',
    components: [
      { component: 'TaskSummary', priority: 1 },
      { component: 'TaskList', priority: 2 },
    ],
  },
  rightPane: {
    className: 'hidden w-80 border-l p-4 lg:block',
    components: [{ component: 'AssistantPanel', priority: 1 }],
  },
}
```

Do not generate stale array-only slots such as
`middlePane: [{ component: 'Dashboard' }]`.

## Store Slice Pattern

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

## Runtime Overrides

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

Use overrides for event handlers, auth actions, router callbacks, analytics
callbacks, render props, React nodes, and any other non-serializable value.
