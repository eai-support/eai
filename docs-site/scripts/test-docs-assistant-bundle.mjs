import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractDocsAssistantApiUrls } from "./assistantBundleConfig.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(scriptDir, "../build");
const expectedUrl = process.env.EAI_DOCS_EXPECTED_ASSISTANT_API_URL;
const forbiddenUrl = process.env.EAI_DOCS_FORBIDDEN_ASSISTANT_API_URL;

if (!expectedUrl) throw new Error("Set EAI_DOCS_EXPECTED_ASSISTANT_API_URL before checking the generated bundle.");

async function collectJavaScript(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJavaScript(file));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(file);
  }
  return files;
}

const bundles = await collectJavaScript(path.join(buildDir, "assets", "js"));
assert.ok(bundles.length > 0, "Docusaurus build did not produce JavaScript bundles.");
const contents = (await Promise.all(bundles.map((file) => readFile(file, "utf8")))).join("\n");
const configuredUrls = extractDocsAssistantApiUrls(contents);
assert.deepEqual(
  configuredUrls,
  [expectedUrl],
  `Expected exactly one serialized Docs assistant endpoint configuration: ${expectedUrl}`,
);
if (forbiddenUrl) assert.notEqual(expectedUrl, forbiddenUrl, "The configured assistant URL is forbidden.");

console.log(`Verified the configured assistant API URL in ${bundles.length} JavaScript bundles.`);
