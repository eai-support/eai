#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOC_PATH = path.join(ROOT, '.tech-docs', 'error-guidance.md');
const STATIC_PATH = path.join(ROOT, 'docs-site', 'static', 'error-guidance.json');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

function commandList(commands) {
  if (!commands.length) return 'None.';
  return commands.map((command) => {
    const safety = command.mutates ? 'changes state' : 'read-only';
    const when = command.when ? ` ${command.when}` : '';
    return `- \`${command.command}\` (${safety}) — ${command.purpose}${when}`;
  }).join('\n');
}

function buildMarkdown(entries) {
  const summaryRows = entries
    .map((entry) => `| \`${entry.code}\` | \`${entry.reasonCode}\` | ${entry.title} |`)
    .join('\n');

  const detailSections = entries.map((entry) => `## ${entry.code}: ${entry.title}

| Field | Value |
| --- | --- |
| Reason | \`${entry.reasonCode}\` |
| Category | \`${entry.category}\` |
| Severity | \`${entry.severity}\` |

### Why This Might Happen

${entry.why.map((item) => `- ${item}`).join('\n')}

### Diagnostics

${commandList(entry.diagnostics)}

### Fixes

${commandList(entry.fixes)}

### Stop Conditions

${entry.retry.stopWhen.map((item) => `- ${item}`).join('\n')}

### Escalation Evidence

${entry.escalation.include.map((item) => `- ${item}`).join('\n')}
`).join('\n');

  return `---
title: Error Guidance
description: Public-safe EAI CLI error explanations and agent recovery commands.
---

# Error Guidance

This page lists the public-safe error guidance bundled with \`@enterpriseai/cli\`
v${PKG.version}. The same catalog powers human stderr output, JSON output for AI
agents, and \`eai errors explain\`.

Agents should run read-only diagnostics first, run mutating fixes only when they
are explicitly listed, and stop when a stop condition matches.

## Summary

| Code | Reason | Title |
| --- | --- | --- |
${summaryRows}

${detailSections}
`;
}

function publicEntry(entry) {
  return {
    code: entry.code,
    reasonCode: entry.reasonCode,
    title: entry.title,
    category: entry.category,
    severity: entry.severity,
    appliesTo: entry.appliesTo,
    why: entry.why,
    evidenceToCheck: entry.evidenceToCheck,
    diagnostics: entry.diagnostics,
    fixes: entry.fixes,
    retry: entry.retry,
    escalation: entry.escalation,
    safety: entry.safety,
  };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const { listErrorGuidance } = await import('../dist/lib/error-guidance/catalog.js');
  const entries = listErrorGuidance();
  const markdown = buildMarkdown(entries);
  const json = `${JSON.stringify({
    schemaVersion: 1,
    package: '@enterpriseai/cli',
    version: PKG.version,
    generatedAt: 'release-generated',
    entries: entries.map(publicEntry),
  }, null, 2)}\n`;

  const outputs = [
    [DOC_PATH, markdown],
    [STATIC_PATH, json],
  ];

  let stale = false;
  for (const [file, contents] of outputs) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
    if (current !== contents) {
      stale = true;
      if (!checkOnly) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents, 'utf-8');
      }
    }
  }

  if (checkOnly && stale) {
    console.error('Error guidance docs are stale. Run node scripts/generate-error-guidance-docs.cjs');
    process.exit(1);
  }

  console.log(checkOnly ? '✓ Error guidance docs are up to date' : '✓ Generated error guidance docs');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
