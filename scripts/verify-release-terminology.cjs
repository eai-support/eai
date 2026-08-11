#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const INTERNAL_TERM_PATTERN = /Configurator|ResourceAPI|AICore|PayloadCMS|OPA|Rego|HyPE|OBO/;
const RELEASE_SURFACE_ROOTS = ['src', 'README.md', 'AGENTS.md', 'CLAUDE.md'];
const RELEASE_SURFACE_EXTENSIONS = new Set(['.ts', '.md']);
const ALLOWED_OCCURRENCES = new Map([
  [
    'src/lib/object-type-identifiers.ts',
    new Set(["  'OPAMeasure\\u0000opameasure',"]),
  ],
]);

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

function isAllowedOccurrence(relativePath, line) {
  return ALLOWED_OCCURRENCES.get(normalizeRelativePath(relativePath))?.has(line) ?? false;
}

function inspectLine(relativePath, line, lineNumber) {
  if (!INTERNAL_TERM_PATTERN.test(line) || isAllowedOccurrence(relativePath, line)) {
    return undefined;
  }

  return `${normalizeRelativePath(relativePath)}:${lineNumber}:${line}`;
}

function collectFiles(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    return RELEASE_SURFACE_EXTENSIONS.has(path.extname(absolutePath))
      ? [relativePath]
      : [];
  }

  return fs
    .readdirSync(absolutePath, { withFileTypes: true })
    .filter((entry) => entry.name !== 'node_modules')
    .flatMap((entry) =>
      collectFiles(root, path.join(relativePath, entry.name)),
    );
}

function findInternalTerminologyLeaks(root) {
  return RELEASE_SURFACE_ROOTS.flatMap((surfaceRoot) =>
    collectFiles(root, surfaceRoot).flatMap((relativePath) => {
      const lines = fs.readFileSync(path.join(root, relativePath), 'utf8').split(/\r?\n/);
      return lines.flatMap((line, index) => {
        const finding = inspectLine(relativePath, line, index + 1);
        return finding === undefined ? [] : [finding];
      });
    }),
  );
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const leaks = findInternalTerminologyLeaks(root);
  if (leaks.length > 0) {
    process.stdout.write(`${leaks.join('\n')}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  findInternalTerminologyLeaks,
  inspectLine,
  isAllowedOccurrence,
};
