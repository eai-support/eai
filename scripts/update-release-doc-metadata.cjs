#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = process.env.EAI_RELEASE_METADATA_ROOT
  ? path.resolve(process.env.EAI_RELEASE_METADATA_ROOT)
  : path.join(__dirname, '..');
const version = process.argv[2];
const releaseMessage = process.argv.slice(3).join(' ').trim();

if (!version || !releaseMessage) {
  console.error('Usage: node scripts/update-release-doc-metadata.cjs <version> "<release message>"');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
let sourceCommit = 'unknown';
try {
  sourceCommit = execSync('git rev-parse HEAD', {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  sourceCommit = 'unknown';
}

function updateFile(relativePath, transform) {
  const absolutePath = path.join(ROOT, relativePath);
  const original = fs.readFileSync(absolutePath, 'utf-8');
  fs.writeFileSync(absolutePath, transform(original), 'utf-8');
}

function updateExistingFile(relativePath, transform) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return false;
  }

  updateFile(relativePath, transform);
  return true;
}

function updateGeneratedHeader(markdown) {
  return markdown
    .replace(/generated_at:\s*".*?"/, `generated_at: "${new Date().toISOString()}"`)
    .replace(/source_commit:\s*".*?"/, `source_commit: "${sourceCommit}"`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertSection(markdown, heading, body, beforeHeading) {
  const section = `## ${heading}\n\n${body.trim()}\n`;
  const existing = new RegExp(
    `\\n## ${escapeRegExp(heading)}\\n[\\s\\S]*?(?=\\n## |\\s*$)`,
  );

  if (existing.test(markdown)) {
    return markdown.replace(existing, `\n${section}\n`);
  }

  if (beforeHeading && markdown.includes(`\n${beforeHeading}`)) {
    return markdown.replace(`\n${beforeHeading}`, `\n${section}\n${beforeHeading}`);
  }

  return `${markdown.trimEnd()}\n\n${section}\n`;
}

const currentReleaseBody = `
The current CLI release is **v${version}** (${today}): ${releaseMessage}.
`;

const releaseSnapshotBody = `
| Field | Value |
| --- | --- |
| Version | ${version} |
| Released | ${today} |
| Last Material Change | ${releaseMessage} |
| Source Commit | \`${sourceCommit}\` |
`;

updateFile('.tech-docs/start-here.md', (markdown) => (
  upsertSection(markdown, 'Current Release', currentReleaseBody, '## What The Pieces Do')
));

updateFile('.tech-docs/eai-cli.md', (markdown) => (
  upsertSection(markdown, 'Release Snapshot', releaseSnapshotBody, '## Common Workflow')
));

for (const generatedDocPath of [
  '.tech-docs/api-reference.md',
  '.tech-docs/configuration.md',
]) {
  updateExistingFile(generatedDocPath, updateGeneratedHeader);
}

console.log('✓ Updated release metadata in .tech-docs');
console.log(`  Version: ${version}`);
console.log(`  Date:    ${today}`);
console.log(`  Message: ${releaseMessage}`);
