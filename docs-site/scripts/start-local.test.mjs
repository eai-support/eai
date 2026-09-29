import test from "node:test";
import assert from "node:assert/strict";
import { localAssistantEnvironment } from "./start-local.mjs";

test("local Docusaurus preview uses the local Website API by default", () => {
  assert.equal(
    localAssistantEnvironment({ PATH: "/bin" }).EAI_DOCS_ASSISTANT_API_URL,
    "http://localhost:3000/api/chat",
  );
});

test("local Docusaurus preview preserves an explicit API override", () => {
  assert.equal(
    localAssistantEnvironment({ EAI_DOCS_ASSISTANT_API_URL: "http://127.0.0.1:3001/api/chat" })
      .EAI_DOCS_ASSISTANT_API_URL,
    "http://127.0.0.1:3001/api/chat",
  );
});
