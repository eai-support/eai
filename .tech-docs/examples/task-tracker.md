---
generated: false
title: Build A Task Tracker
---

# Build A Task Tracker

This example creates a small task tracker using the EAI CLI, EAI App Template,
Object Types, and ResourceAPI hooks.

## 1. Scaffold

```bash
eai init task-tracker
cd task-tracker
npm install
```

## 2. Connect A Tenant

```bash
eai login
eai tenant list --format json
eai tenant select <tenant-slug>
eai whoami
```

## 3. Configure The Tenant

Create `src/eai.config/tenants/tracker.config.ts`:

```ts
import { defineConfig } from "@enterpriseaigroup/core/config/server";

export const trackerConfig = defineConfig({
  tenantId: "task-tracker",
  workflowId: "task-workflow",
  defaultEmail: "support@example.com",
  meta: {
    title: "Task Tracker",
    description: "AI-powered task management",
  },
  store: {
    user: { initialState: { name: null }, persist: true },
    tasks: {
      initialState: { items: [], isLoading: false, selectedId: null },
      persist: true,
    },
  },
  layout: {
    header: {
      components: [{ component: "Header", priority: 1 }],
    },
    middlePane: {
      components: [
        {
          component: "Dashboard",
          priority: 1,
          storeBindings: [
            { prop: "tasks", storePath: "tasks.items" },
            { prop: "isLoading", storePath: "tasks.isLoading" },
          ],
        },
      ],
    },
  },
});
```

Register it in `src/eai.config/index.ts`:

```ts
import templateConfig from "./default";
import { trackerConfig } from "./tenants/tracker.config";

export const tenantConfigs = {
  default: trackerConfig,
  template: templateConfig,
  "task-tracker": trackerConfig,
};
```

## 4. Define The Object Type

Add a `Task` object type in `src/eai.config/object-types.ts`:

```ts
export const objectTypes = {
  "task-tracker": [
    {
      name: "Task",
      slug: "task",
      displayName: "Task",
      description: "A trackable unit of work",
      storageBackend: "postgresql",
      status: "published",
      properties: [
        { name: "title", type: "text", required: true, indexed: true },
        { name: "description", type: "text", required: false },
        {
          name: "status",
          type: "select",
          required: true,
          defaultValue: "draft",
          options: [
            { label: "Draft", value: "draft" },
            { label: "In Progress", value: "in-progress" },
            { label: "Done", value: "done" },
          ],
        },
        {
          name: "priority",
          type: "select",
          required: true,
          defaultValue: "medium",
          options: [
            { label: "Low", value: "low" },
            { label: "Medium", value: "medium" },
            { label: "High", value: "high" },
          ],
        },
        { name: "dueDate", type: "date", required: false },
      ],
      linkTypes: [],
      actions: [
        {
          name: "start",
          displayName: "Start Work",
          requiredRole: "tenant-viewer",
          validationRules: { requiredStatus: "draft" },
          sideEffects: [
            { type: "set_field", field: "status", value: "in-progress" },
            { type: "set_timestamp", field: "startedAt" },
          ],
        },
        {
          name: "complete",
          displayName: "Mark Done",
          requiredRole: "tenant-viewer",
          validationRules: { requiredStatus: "in-progress" },
          sideEffects: [
            { type: "set_field", field: "status", value: "done" },
            { type: "set_timestamp", field: "completedAt" },
          ],
        },
      ],
    },
  ],
};
```

## 5. Publish And Verify

```bash
eai types validate
eai types diff --tenant-key task-tracker --tenant-id <tenant-id>
eai types seed --tenant-key task-tracker --tenant-id <tenant-id> --format json
eai resources schema --tenant-id <tenant-id> --format json
eai verify calls --tenant-id <tenant-id> --resource-type task
```

Do not continue until the diff is clean.

`Task` is the model name used in configuration and TypeScript. `task` is the
exact stored slug used by resource commands, routes, relationship targets, and
runtime requests. Do not derive a different slug at the call site.

## 6. Use The Resource Hook

```tsx
"use client";

import { useEffect, useState } from "react";
import { useResources } from "@/hooks/useResources";

interface TaskData {
  title: string;
  description?: string;
  status: string;
  priority: string;
  dueDate?: string;
}

export function TaskList() {
  const { list, create, update } = useResources<TaskData>("Task");
  const [tasks, setTasks] = useState<Array<{ id: string; data: TaskData }>>([]);

  useEffect(() => {
    list({ page: 1, limit: 50, sort: "-created_at" }).then((res) => {
      setTasks(res.docs);
    });
  }, [list]);

  async function addTask(title: string) {
    await create({ title, status: "draft", priority: "medium" });
    const refreshed = await list({ page: 1, limit: 50, sort: "-created_at" });
    setTasks(refreshed.docs);
  }

  async function startTask(task: { id: string; version: number }) {
    await update(task.id, { status: "in-progress" }, task.version);
  }

  return (
    <section>
      <button type="button" onClick={() => addTask("New task")}>
        Add task
      </button>
      {tasks.map((task) => (
        <article key={task.id}>{task.data.title}</article>
      ))}
    </section>
  );
}
```
