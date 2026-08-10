#!/usr/bin/env node

/**
 * Build npm alias packages from the canonical CLI package.
 *
 * The alias package intentionally contains the same compiled CLI artifact as
 * `@enterpriseai/cli`, rather than depending on it, so global bin linking is
 * predictable on Windows, macOS, and Linux.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC_ALIAS_DIR = path.join(ROOT, '.release', 'eai-cli-package');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

function copyRequiredPath(outDir, relativePath) {
  const source = path.join(ROOT, relativePath);
  const target = path.join(outDir, relativePath);

  if (!fs.existsSync(source)) {
    throw new Error(`Required release path is missing: ${relativePath}`);
  }

  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (currentSource) => !currentSource.includes(`${path.sep}node_modules${path.sep}`),
  });
}

function copyOptionalFile(outDir, relativePath) {
  const source = path.join(ROOT, relativePath);
  if (!fs.existsSync(source)) {
    return;
  }

  fs.copyFileSync(source, path.join(outDir, relativePath));
}

function aliasPackageJson(name, description, publishConfig = pkg.publishConfig) {
  return {
    name,
    version: pkg.version,
    description,
    type: pkg.type,
    bin: pkg.bin,
    files: pkg.files,
    keywords: [
      ...new Set([
        'eai',
        'eai-cli',
        ...(pkg.keywords || []),
      ]),
    ],
    author: pkg.author,
    license: pkg.license,
    repository: pkg.repository,
    homepage: pkg.homepage,
    bugs: pkg.bugs,
    publishConfig,
    engines: pkg.engines,
    dependencies: pkg.dependencies,
  };
}

function publicAliasReadme() {
  return `# eai-cli

Easy npm install alias for the EnterpriseAI CLI.

## Install

\`\`\`bash
npm install -g eai-cli
eai --version
\`\`\`

This package installs the same \`eai\` command as the canonical
\`@enterpriseai/cli\` package. Use either package name; both are published from the
same source repository and release tag.

## Trust Signals

- Source: https://github.com/eai-support/eai
- Documentation: https://eai-support.github.io/eai/
- License: Apache-2.0
- Runtime: Node.js 20 or newer
- Publishing: GitHub Actions trusted publishing with npm provenance
`;
}

function writeAliasPackage(outDir, packageJson, readme) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  copyRequiredPath(outDir, 'dist');
  copyRequiredPath(outDir, 'resources');
  copyOptionalFile(outDir, 'NOTICE');
  copyOptionalFile(outDir, 'LICENSE');

  fs.writeFileSync(
    path.join(outDir, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    'utf-8',
  );
  fs.writeFileSync(path.join(outDir, 'README.md'), readme, 'utf-8');
}

function main() {
  if (pkg.name !== '@enterpriseai/cli') {
    throw new Error(`Expected canonical package name @enterpriseai/cli, got ${pkg.name}`);
  }

  writeAliasPackage(
    PUBLIC_ALIAS_DIR,
    aliasPackageJson('eai-cli', 'Easy npm install alias for the EnterpriseAI CLI'),
    publicAliasReadme(),
  );

  console.log(`✓ Built eai-cli alias package at ${path.relative(ROOT, PUBLIC_ALIAS_DIR)}`);
}

main();
