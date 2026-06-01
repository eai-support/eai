#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const HIGH_CONFIDENCE_PATTERNS = [
  ['GitHub token', /gh[pousr]_[A-Za-z0-9_]{20,}/g],
  ['GitHub fine-grained token', /github_pat_[A-Za-z0-9_]+/g],
  ['OpenAI API key', /\bsk-[A-Za-z0-9]{20,}\b/g],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['AWS access key id', /AKIA[0-9A-Z]{16}/g],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g],
  ['JWT-like literal', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
];

const FORBIDDEN_FIXTURE_LITERALS = [
  'plain-secret',
  'secret-token',
  'secret-client-value',
  'existing-secret',
  'super-secret-value',
  'secret-basepath',
  'secret-bad-url',
  'prod-secret',
  'profile-secret',
  'dev-secret',
  'rotated-secret',
  'secret-without-client-id',
  'secret-with-empty-client-id',
  'test-access-token',
  'test-refresh-token',
  'cached-token',
  'expired-access-token',
  'new-refresh-token',
  'refresh123',
  'new_token',
];

const SKIP_PATHS = [
  /^docs-site\/build\//,
  /^node_modules\//,
  /^docs-site\/node_modules\//,
  /^coverage\//,
  /^dist\//,
  /\.tgz$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.ico$/,
  /\.woff2?$/,
];

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT });
  return output.toString('utf8').split('\0').filter(Boolean);
}

function shouldSkip(file) {
  return SKIP_PATHS.some((pattern) => pattern.test(file));
}

function readTextFile(file) {
  const absolutePath = path.join(ROOT, file);
  const buffer = fs.readFileSync(absolutePath);
  if (buffer.includes(0)) {
    return null;
  }
  return buffer.toString('utf8');
}

function lineNumberForOffset(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

const findings = [];

for (const file of trackedFiles()) {
  if (shouldSkip(file)) {
    continue;
  }

  const text = readTextFile(file);
  if (text === null) {
    continue;
  }

  for (const [label, pattern] of HIGH_CONFIDENCE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      findings.push({
        file,
        line: lineNumberForOffset(text, match.index),
        label,
      });
    }
  }

  for (const literal of FORBIDDEN_FIXTURE_LITERALS) {
    let index = text.indexOf(literal);
    while (index !== -1) {
      findings.push({
        file,
        line: lineNumberForOffset(text, index),
        label: `Forbidden secret-like fixture literal: ${literal}`,
      });
      index = text.indexOf(literal, index + literal.length);
    }
  }
}

if (findings.length > 0) {
  console.error('Public hygiene check failed. Replace secret-looking literals with obvious placeholders.');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.label}`);
  }
  process.exit(1);
}

console.log('✓ Public hygiene check passed');
