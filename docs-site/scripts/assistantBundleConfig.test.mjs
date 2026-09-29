import assert from "node:assert/strict";
import test from "node:test";
import { extractDocsAssistantApiUrls } from "./assistantBundleConfig.mjs";

test("reads the configured assistant endpoint from the serialized site config", () => {
  const bundle = 'customFields:{documentationFeedbackUrl:"",docsAssistantApiUrl:"https://www.enterpriseaigroup.com/api/chat"}';

  assert.deepEqual(extractDocsAssistantApiUrls(bundle), ["https://www.enterpriseaigroup.com/api/chat"]);
});

test("does not mistake a fallback or source-code string for the configured endpoint", () => {
  const bundle = [
    'customFields:{docsAssistantApiUrl:"https://wrong.example/api/chat"}',
    'const fallback="https://www.enterpriseaigroup.com/api/chat"',
  ].join(";");

  assert.deepEqual(extractDocsAssistantApiUrls(bundle), ["https://wrong.example/api/chat"]);
});

test("fails endpoint verification when the site config has no assistant URL", () => {
  assert.deepEqual(extractDocsAssistantApiUrls('customFields:{documentationFeedbackUrl:""}'), []);
});
