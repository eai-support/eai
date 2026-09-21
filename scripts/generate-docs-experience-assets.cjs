#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DOCS_DIR = path.join(ROOT, ".tech-docs");
const STATIC_DIR = path.join(ROOT, "docs-site", "static");
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const OUTPUTS = [
  "docs-search-index.json",
  "docs-capabilities.json",
];

function listMarkdownFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.join(prefix, entry.name);
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return listMarkdownFiles(absolute, relative);
      return entry.isFile() && entry.name.endsWith(".md") ? [relative] : [];
    })
    .sort();
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: markdown };

  const frontmatter = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    frontmatter[line.slice(0, separator).trim()] = line.slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
  return { frontmatter, body: markdown.slice(match[0].length) };
}

function toPlainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?(?:\[([^\]]*)\]\([^)]*\))/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[>*_~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function routeFor(relativePath) {
  const slug = relativePath.replace(/\.md$/, "").replace(/\\/g, "/");
  return `/docs/${slug === "examples/index" ? "examples" : slug}`;
}

function sectionFor(relativePath) {
  if (relativePath.startsWith("examples/")) return "Examples";
  if (relativePath.startsWith("app-template/")) return "App Template";
  if (relativePath === "api-reference.md") return "Reference";
  if (relativePath === "error-guidance.md") return "Support";
  return "Getting Started";
}

function descriptionFor(body, title) {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map(toPlainText)
    .filter((value) => value && value !== title && !value.startsWith("generated:"));
  return (paragraphs.find((value) => value.length > 40) || "EAI documentation.")
    .slice(0, 240);
}

function buildSearchIndex() {
  const items = listMarkdownFiles(DOCS_DIR).map((relativePath) => {
    const raw = fs.readFileSync(path.join(DOCS_DIR, relativePath), "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const title = frontmatter.title || body.match(/^#\s+(.+)$/m)?.[1] || relativePath;
    const content = toPlainText(body).slice(0, 12000);
    return {
      title,
      description: descriptionFor(body, title),
      route: routeFor(relativePath),
      section: sectionFor(relativePath),
      keywords: [...new Set(`${title} ${relativePath.replace(/[/.]/g, " ")} ${content}`
        .toLowerCase()
        .match(/[a-z0-9-]{3,}/g) || [])].slice(0, 80),
      content,
    };
  });

  return JSON.stringify({
    schemaVersion: 1,
    releaseVersion: PACKAGE.version,
    source: ".tech-docs",
    items,
  }, null, 2) + "\n";
}

function buildCapabilities() {
  return JSON.stringify({
    schemaVersion: 1,
    releaseVersion: PACKAGE.version,
    capabilities: {
      localSearch: true,
      sourceLinkedAssistant: true,
      requestBuilder: "generates commands only; does not execute requests",
      pageFeedback: "configurable outbound URL only",
      agentAssets: ["llms.txt", "llms-full.txt", "cli-help.txt", "error-guidance.json"],
    },
    limits: [
      "No third-party search provider is required.",
      "No model-backed assistant is included in the static site.",
      "No authenticated API playground is included in the static site.",
    ],
  }, null, 2) + "\n";
}

const expected = {
  "docs-search-index.json": buildSearchIndex(),
  "docs-capabilities.json": buildCapabilities(),
};
const check = process.argv.includes("--check");
let stale = false;

for (const filename of OUTPUTS) {
  const target = path.join(STATIC_DIR, filename);
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== expected[filename]) {
      console.error(`Stale generated documentation asset: ${path.relative(ROOT, target)}`);
      stale = true;
    }
  } else {
    fs.mkdirSync(STATIC_DIR, { recursive: true });
    fs.writeFileSync(target, expected[filename]);
    console.log(`Generated ${path.relative(ROOT, target)}`);
  }
}

if (stale) process.exitCode = 1;
