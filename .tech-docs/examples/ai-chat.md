---
generated: false
title: Add AI Chat
---

# Add AI Chat

This example adds streaming chat and document-backed RAG to an EAI App Template
project.

## 1. Confirm Tenant And Workflow

```bash
eai login
eai tenant select <tenant-slug>
eai workflow status <workflow-key> --tenant <tenant-id>
```

Use the workflow ID from the platform tenant configuration. Store runtime values
in local or deployment environment configuration, not in committed source.

## 2. Stream Chat From A Client Component

```tsx
"use client";

import { useState } from "react";
import { useChat } from "@/hooks/useChat";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function ChatPanel({
  workflowId,
  tenantId,
}: {
  workflowId: string;
  tenantId: string;
}) {
  const { stream } = useChat(workflowId, "chat", tenantId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId] = useState(() => crypto.randomUUID());

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message) return;

    setInput("");
    setMessages((current) => [...current, { role: "user", content: message }]);

    const reader = await stream({
      message,
      conversationId,
      params: {},
    });

    const decoder = new TextDecoder();
    let assistantText = "";
    const assistantIndex = messages.length + 1;

    setMessages((current) => [...current, { role: "assistant", content: "" }]);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      assistantText += decoder.decode(value, { stream: true });
      setMessages((current) =>
        current.map((item, index) =>
          index === assistantIndex ? { ...item, content: assistantText } : item,
        ),
      );
    }
  }

  return (
    <form onSubmit={handleSend}>
      <textarea
        value={input}
        onChange={(event) => setInput(event.target.value)}
      />
      <button type="submit">Send</button>
      {messages.map((message, index) => (
        <p key={index}>
          <strong>{message.role}:</strong> {message.content}
        </p>
      ))}
    </form>
  );
}
```

The hook calls the app BFF and stream route. Browser code should not call model
providers or PublicAPI directly.

## 3. Submit A Document For Classification

```tsx
"use client";

import { useState } from "react";
import { useDocuments } from "@/hooks/useDocuments";

export function DocumentUploader({ tenantId }: { tenantId: string }) {
  const { classify } = useDocuments(tenantId);
  const [status, setStatus] = useState("");

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus("Submitting");
    try {
      const response = await classify([file], {
        verticalKey: "business-docs",
        workflowKey: "document-review",
      });
      const queued = await response.json();
      setStatus(`Queued: ${queued.jobId}`);
    } catch {
      setStatus("Submission failed");
    }
  }

  return (
    <label>
      Classify business document
      <input type="file" onChange={handleUpload} />
      {status && <span>{status}</span>}
    </label>
  );
}
```

Use ResourceAPI file routes when a file is a property on a business resource.
Use document upload, classification, and RAG routes when the platform should
process document content.

This example requires a published classifier target for the named app/workflow
with the `business-document-v1` lifecycle and ready private storage. It submits
once. Poll the returned job with `getJobStatus`, then read persisted results
with `getRecord`; a queued job does not prove classification completed. The
business lifecycle currently supports classification and storage, not RAG
indexing. Keep DAISY/Assess planning context for their existing indexed flows.

## 4. Verify From The CLI

```bash
eai chat send "What can you help with?" --workflow <workflow-id> --stage chat
eai docs upload ./sample.pdf --planning-application-id <authorized-project-id>
eai docs classify ./sample.pdf --planning-application-id <authorized-project-id> --vertical-key <app-key> --workflow-key <workflow-key>
eai docs index <document-id>
```

If a named command does not exist for a route you need, use `eai publicapi` only
after confirming the route is an authorized PublicAPI V4 surface.
