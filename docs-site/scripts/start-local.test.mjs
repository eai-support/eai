import test from "node:test";
import assert from "node:assert/strict";
import {
  localAssistantEnvironment,
  localDocsStartArgs,
} from "./start-local.mjs";

test("local Docusaurus preview uses the local Website API by default", () => {
  assert.equal(
    localAssistantEnvironment({ PATH: "/bin" }).EAI_DOCS_ASSISTANT_API_URL,
    "http://localhost:3000/api/chat",
  );
});

test("local Docusaurus preview preserves an explicit API override", () => {
  assert.equal(
    localAssistantEnvironment({
      EAI_DOCS_ASSISTANT_API_URL: "http://127.0.0.1:3001/api/chat",
    }).EAI_DOCS_ASSISTANT_API_URL,
    "http://127.0.0.1:3001/api/chat",
  );
});

test("starts Docusaurus away from the local Website API port by default", () => {
  assert.deepEqual(localDocsStartArgs([]), ["start", "--port", "3017"]);
  assert.deepEqual(localDocsStartArgs(["--no-open"]), [
    "start",
    "--no-open",
    "--port",
    "3017",
  ]);
});

test("preserves an explicitly selected Docusaurus port", () => {
  assert.deepEqual(localDocsStartArgs(["--port", "3020"]), [
    "start",
    "--port",
    "3020",
  ]);
  assert.deepEqual(localDocsStartArgs(["--port=3021"]), [
    "start",
    "--port=3021",
  ]);
});
