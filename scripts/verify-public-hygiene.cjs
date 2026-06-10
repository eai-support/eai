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
  ['plain', 'secret'],
  ['secret', 'token'],
  ['secret', 'client', 'value'],
  ['existing', 'secret'],
  ['super', 'secret', 'value'],
  ['secret', 'basepath'],
  ['secret', 'bad', 'url'],
  ['prod', 'secret'],
  ['profile', 'secret'],
  ['dev', 'secret'],
  ['rotated', 'secret'],
  ['secret', 'without', 'client', 'id'],
  ['secret', 'with', 'empty', 'client', 'id'],
  ['test', 'access', 'token'],
  ['test', 'refresh', 'token'],
  ['cached', 'token'],
  ['expired', 'access', 'token'],
  ['new', 'refresh', 'token'],
].map((parts) => parts.join('-')).concat([
  ['refresh', '123'].join(''),
  ['new', 'token'].join('_'),
]);

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

const INTERNAL_DOC_PATHS = [
  '.tech-docs/architecture.md',
  '.tech-docs/changelog.md',
  '.tech-docs/data-model.md',
  '.tech-docs/dependencies.md',
  '.tech-docs/deployment.md',
  '.tech-docs/documentation-surfaces.md',
  '.tech-docs/overview.md',
  '.tech-docs/publicapi-v4-coverage.md',
  '.tech-docs/review/code-quality.md',
  '.tech-docs/review/patterns.md',
];

const PUBLIC_SURFACE_FILES = [
  'docs-site/sidebars.js',
  'scripts/generate-release-docs.cjs',
  '.github/workflows/docs.yml',
  'docs-site/static/llms.txt',
  'docs-site/static/llms-full.txt',
];

const FORBIDDEN_PUBLIC_SURFACE_PATTERNS = [
  ['internal docs path', /\.tech-docs\/review\b/g],
  ['review route', /\breview\/(?:code-quality|patterns)\b/g],
  ['architecture route', /(?:docs\/architecture|architecture\.md|["']architecture["'])/g],
  ['data model route', /(?:docs\/data-model|data-model\.md|["']data-model["'])/g],
  ['dependency route', /(?:docs\/dependencies|dependencies\.md|["']dependencies["'])/g],
  ['deployment route', /(?:docs\/deployment|deployment\.md|["']deployment["'])/g],
  ['documentation surfaces route', /(?:docs\/documentation-surfaces|documentation-surfaces\.md|["']documentation-surfaces["'])/g],
  ['overview route', /(?:docs\/overview|overview\.md|["']overview["'])/g],
  ['coverage route', /(?:docs\/publicapi-v4-coverage|publicapi-v4-coverage\.md|["']publicapi-v4-coverage["'])/g],
  ['architecture title', /EAI CLI — Architecture/g],
  ['data model title', /EAI CLI — Data Model/g],
  ['dependency title', /EAI CLI — Dependencies/g],
  ['deployment title', /EAI CLI — Deployment/g],
  ['documentation surfaces title', /Documentation Surfaces/g],
  ['coverage title', /PublicAPI V4 Coverage Matrix/g],
  ['code quality review title', /Code Quality Review/g],
  ['patterns review title', /Patterns & Tech Debt/g],
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
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
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

const files = trackedFiles();

for (const internalPath of INTERNAL_DOC_PATHS) {
  if (fs.existsSync(path.join(ROOT, internalPath))) {
    findings.push({
      file: internalPath,
      line: 1,
      label: 'Internal generated documentation must not live in the public docs source',
    });
  }
}

for (const file of files) {
  if (
    INTERNAL_DOC_PATHS.includes(file) &&
    fs.existsSync(path.join(ROOT, file))
  ) {
    findings.push({
      file,
      line: 1,
      label: 'Internal generated documentation must not be tracked in the public repository',
    });
  }
}

for (const file of files) {
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

for (const file of PUBLIC_SURFACE_FILES) {
  const text = readTextFile(file);
  if (text === null) {
    continue;
  }

  for (const [label, pattern] of FORBIDDEN_PUBLIC_SURFACE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      findings.push({
        file,
        line: lineNumberForOffset(text, match.index),
        label: `Forbidden public docs exposure: ${label}`,
      });
    }
  }
}

if (findings.length > 0) {
  console.error('Public hygiene check failed. Remove private docs exposure and replace secret-looking literals with obvious placeholders.');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.label}`);
  }
  process.exit(1);
}

console.log('✓ Public hygiene check passed');
