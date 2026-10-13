#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const FORBIDDEN_PUBLIC_TERMS = [
  ['Config', 'urator'].join(''),
  ['Payload', 'CMS'].join(''),
  ['O', 'PA'].join(''),
  ['Re', 'go'].join(''),
  ['AI', 'Core'].join(''),
  ['Hy', 'PE'].join(''),
  'api.ae.',
  'dev-api.',
  'test-api.',
];

function allStrings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(allStrings);
  }
  return [];
}

function validate(entries) {
  const issues = [];
  const codes = new Set();
  const reasons = new Set();

  for (const entry of entries) {
    if (codes.has(entry.code)) issues.push(`Duplicate code: ${entry.code}`);
    codes.add(entry.code);

    if (reasons.has(entry.reasonCode)) issues.push(`Duplicate reasonCode: ${entry.reasonCode}`);
    reasons.add(entry.reasonCode);

    if (!entry.publicSafe || !entry.safety?.publicSafe) {
      issues.push(`${entry.code} must be public safe`);
    }
    if (!entry.why?.length) {
      issues.push(`${entry.code} must explain why the error might happen`);
    }
    if (!entry.retry?.stopWhen?.length) {
      issues.push(`${entry.code} must include stop conditions`);
    }
    if (!entry.escalation?.include?.length) {
      issues.push(`${entry.code} must include escalation evidence`);
    }
    if (!(entry.diagnostics?.length || entry.fixes?.length)) {
      issues.push(`${entry.code} must include diagnostics or fixes`);
    }

    const text = allStrings(entry).join('\n');
    for (const term of FORBIDDEN_PUBLIC_TERMS) {
      if (text.includes(term)) {
        issues.push(`${entry.code} contains forbidden public term: ${term}`);
      }
    }
  }

  return issues;
}

// Harness instructions were rewritten so an AI acts only when the person asks for help.
// These retired phrases, assembled here so this file never matches itself, must not return in any tracked file.
const RETIRED_SUPPORT_PHRASES = [
  ['Support after', 'an unresolved EAI error'],
  ['If the command still fails,', 'prepare a report with'],
  ['If anything fails,', 'say'],
  ['For unresolved', 'EAI errors'],
  ['If the failure remains', 'unresolved'],
  ['offer the', 'support preview'],
].map((parts) => parts.join(' '));

const RETIRED_PHRASE_SKIP = [/\.(?:png|jpg|jpeg|gif|ico|woff2?|tgz|zip|pdf)$/i];

function listTrackedFiles(root) {
  return execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function findRetiredSupportPhrases(root, files = listTrackedFiles(root)) {
  const findings = [];
  for (const relativePath of files) {
    if (RETIRED_PHRASE_SKIP.some((pattern) => pattern.test(relativePath))) continue;
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
    const text = fs.readFileSync(absolutePath, 'utf8');
    for (const phrase of RETIRED_SUPPORT_PHRASES) {
      if (text.includes(phrase)) findings.push(`${relativePath}: "${phrase}"`);
    }
  }
  return findings;
}

async function main() {
  const { listErrorGuidance } = await import('../dist/lib/error-guidance/catalog.js');
  const entries = listErrorGuidance();
  const issues = validate(entries);
  if (issues.length > 0) {
    console.error('Error guidance validation failed:');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  const retired = findRetiredSupportPhrases(ROOT);
  if (retired.length > 0) {
    console.error('Retired support wording found in tracked files (help is offered only when the person asks):');
    for (const finding of retired) {
      console.error(`- ${finding}`);
    }
    process.exit(1);
  }

  console.log(`✓ Error guidance catalog is valid (${entries.length} entries)`);
  console.log('✓ No retired support wording in tracked files');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = { findRetiredSupportPhrases, RETIRED_SUPPORT_PHRASES };

