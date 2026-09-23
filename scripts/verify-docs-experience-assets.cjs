#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const staticDirectory = path.join(__dirname, "..", "docs-site", "static");
const search = JSON.parse(fs.readFileSync(path.join(staticDirectory, "docs-search-index.json"), "utf8"));
const capabilities = JSON.parse(fs.readFileSync(path.join(staticDirectory, "docs-capabilities.json"), "utf8"));
const requestBuilder = fs.readFileSync(path.join(__dirname, "..", "docs-site", "src", "components", "RequestBuilder", "index.js"), "utf8");
const installerDownload = fs.readFileSync(path.join(__dirname, "..", "docs-site", "src", "components", "InstallerDownload", "index.js"), "utf8");

if (search.schemaVersion !== 1 || search.items.length < 10) {
  throw new Error("The documentation search index is incomplete.");
}
for (const route of ["/docs/start-here", "/docs/installer-setup", "/docs/manual-and-managed-setup", "/docs/eai-cli", "/docs/api-reference"]) {
  if (!search.items.some((item) => item.route === route)) {
    throw new Error(`The documentation search index is missing ${route}.`);
  }
}
if (capabilities.schemaVersion !== 1 || !capabilities.capabilities.localSearch) {
  throw new Error("The documentation capabilities manifest is incomplete.");
}
if (requestBuilder.includes("\\n+  -H") || requestBuilder.includes("\\n+  --data")) {
  throw new Error("The request builder must not emit invalid '+' prefixes in generated curl commands.");
}
if (!installerDownload.includes("getHighEntropyValues") || !installerDownload.includes("Download now") || !installerDownload.includes("Download a different version")) {
  throw new Error("The installer guide must detect a supported computer and keep alternate packages secondary.");
}

console.log(`Verified ${search.items.length} public documentation search records.`);
