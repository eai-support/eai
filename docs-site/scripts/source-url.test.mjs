import test from "node:test";
import assert from "node:assert/strict";
import { sourceHref } from "../src/components/DocsAssistant/sourceUrl.mjs";

test("uses the canonical Website URL returned by the chat API", () => {
  assert.equal(
    sourceHref({ title: "EAI Gofer", url: "https://enterpriseaigroup.com/docs/eai/docs/eai-gofer" }),
    "https://www.enterpriseaigroup.com/docs/eai/docs/eai-gofer",
  );
});

test("keeps Website page citations on the canonical site", () => {
  assert.equal(
    sourceHref({ title: "About", url: "https://www.enterpriseaigroup.com/company/about" }),
    "https://www.enterpriseaigroup.com/company/about",
  );
});

test("maps a legacy exact Docs title to its Website docs route", () => {
  assert.equal(
    sourceHref({ title: "EAI CLI — API Reference" }, [
      { title: "EAI CLI — API Reference", route: "/docs/api-reference" },
    ]),
    "https://www.enterpriseaigroup.com/docs/eai/docs/api-reference",
  );
});

test("does not turn unsafe or external citations into guessed links", () => {
  const docs = [{ title: "EAI Gofer", route: "/docs/eai-gofer" }];
  for (const url of [
    "https://evil.example/docs/eai-gofer",
    "https://storage.example/blob/eai-gofer.pdf?sig=secret",
    "https://www.enterpriseaigroup.com/media/guide.pdf",
    "https://www.enterpriseaigroup.com/docs/../admin",
    "https://www.enterpriseaigroup.com/docs/eai-gofer?token=secret",
    "javascript:alert(1)",
  ]) {
    assert.equal(sourceHref({ title: "EAI Gofer", url }, docs), null, url);
  }
});

test("does not match a Docs page from a partial title", () => {
  assert.equal(
    sourceHref({ title: "EAI CLI" }, [{ title: "EAI CLI — API Reference", route: "/docs/api-reference" }]),
    null,
  );
});
