#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const staticDirectory = path.join(__dirname, "..", "docs-site", "static");
const search = JSON.parse(fs.readFileSync(path.join(staticDirectory, "docs-search-index.json"), "utf8"));
const capabilities = JSON.parse(fs.readFileSync(path.join(staticDirectory, "docs-capabilities.json"), "utf8"));

if (search.schemaVersion !== 1 || search.items.length < 10) {
  throw new Error("The documentation search index is incomplete.");
}
for (const title of ["Start Here", "EAI CLI", "EAI CLI — API Reference"]) {
  if (!search.items.some((item) => item.title === title)) {
    throw new Error(`The documentation search index is missing ${title}.`);
  }
}
if (capabilities.schemaVersion !== 1 || !capabilities.capabilities.localSearch) {
  throw new Error("The documentation capabilities manifest is incomplete.");
}

console.log(`Verified ${search.items.length} public documentation search records.`);
