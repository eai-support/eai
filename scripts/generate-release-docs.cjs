#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, '.tech-docs');
const STATIC_DIR = path.join(ROOT, 'docs-site', 'static');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const VERSION = PKG.version;
const REGISTRY_SETUP = 'npm config set @eai-tools:registry https://eai-tools.github.io/eai/registry/ --location=user';
const INSTALL_CMD = 'npm install -g @eai-tools/cli';
const DOC_ORDER = [
  'overview.md',
  'architecture.md',
  'configuration.md',
  'api-reference.md',
  'publicapi-v4-coverage.md',
  'data-model.md',
  'dependencies.md',
  'deployment.md',
  'changelog.md',
  'documentation-surfaces.md',
  'review/code-quality.md',
  'review/patterns.md',
];
const HELP_COMMANDS = [
  { label: 'eai --help', args: ['dist/index.js', '--help'] },
  { label: 'eai update --help', args: ['dist/index.js', 'update', '--help'] },
  { label: 'eai doctor --help', args: ['dist/index.js', 'doctor', '--help'] },
  { label: 'eai gofer --help', args: ['dist/index.js', 'gofer', '--help'] },
  { label: 'eai gofer refresh --help', args: ['dist/index.js', 'gofer', 'refresh', '--help'] },
  { label: 'eai template --help', args: ['dist/index.js', 'template', '--help'] },
  { label: 'eai template check --help', args: ['dist/index.js', 'template', 'check', '--help'] },
];
const OUTPUTS = [
  { path: path.join(STATIC_DIR, 'llms.txt'), build: buildLlmsIndex },
  { path: path.join(STATIC_DIR, 'llms-full.txt'), build: buildLlmsFull },
  { path: path.join(STATIC_DIR, 'cli-help.txt'), build: buildCliHelp },
];

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, body: markdown.trim() };
  }

  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    frontmatter[key] = value;
  }

  return {
    frontmatter,
    body: markdown.slice(match[0].length).trim(),
  };
}

function readDoc(filename) {
  const absolutePath = path.join(DOCS_DIR, filename);
  const raw = fs.readFileSync(absolutePath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(raw);
  const heading = body.match(/^#\s+(.+)$/m)?.[1];
  return {
    filename,
    slug: filename.replace(/\.md$/, ''),
    title: frontmatter.title || heading || filename.replace(/\.md$/, ''),
    body,
  };
}

function readAllDocs() {
  return DOC_ORDER
    .filter((filename) => fs.existsSync(path.join(DOCS_DIR, filename)))
    .map(readDoc);
}

function readHelpSnapshots() {
  return HELP_COMMANDS.map(({ label, args }) => ({
    label,
    output: execFileSync('node', args, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
  }));
}

function buildCliHelp(context) {
  const sections = context.helpSnapshots.map(({ label, output }) => (
`${label}
${'='.repeat(label.length)}

${output}`
  )).join('\n\n---\n\n');

  return `# EAI CLI Help Snapshot
Version: ${context.version}

Install / update the CLI:
${REGISTRY_SETUP}
${INSTALL_CMD}

${sections}
`;
}

function buildLlmsIndex(context) {
  const docsList = context.docs.map((doc) => (
`- [${doc.title}](/eai/docs/${doc.slug})`
  )).join('\n');

  return `# EAI CLI Documentation

> Release-aligned documentation surfaces for \`@eai-tools/cli\` v${context.version}.

## Install

\`\`\`bash
${REGISTRY_SETUP}
${INSTALL_CMD}
\`\`\`

## Key Commands

- \`eai update\` updates the installed CLI package only.
- \`eai doctor --check-updates\` reports CLI, Gofer, and template drift.
- \`eai gofer refresh --check\` previews safe Gofer-managed file updates in an existing repo.

## Documentation

${docsList}

## Help & AI Bundles

- [cli-help.txt](/eai/cli-help.txt): Current CLI help snapshots used for release validation
- [llms-full.txt](/eai/llms-full.txt): Full release-aligned documentation bundle for AI agents
- [Registry](/eai/registry/): Static EAI package registry on GitHub Pages
`;
}

function buildLlmsFull(context) {
  const helpSections = context.helpSnapshots.map(({ label, output }) => (
`## ${label}

\`\`\`text
${output}
\`\`\``
  )).join('\n\n');

  const docsSections = context.docs.map((doc) => (
`---

# ${doc.title}

${doc.body.trim()}`
  )).join('\n\n');

  return `# EAI CLI — Full Documentation
> Release-aligned documentation bundle for \`@eai-tools/cli\` v${context.version}.
> Generated from \`.tech-docs/\` plus current CLI help output.

## Install

\`\`\`bash
${REGISTRY_SETUP}
${INSTALL_CMD}
\`\`\`

## Update & Refresh Model

- \`eai update\` reinstalls the latest CLI from the scoped EAI registry.
- \`eai gofer refresh\` updates Gofer-managed assets without blindly overwriting local work.
- \`eai template check\` previews app-template and UI drift without writing files.
- Template and UI drift are reported by \`eai doctor --check-updates\` and still require manual review.

# CLI Help

${helpSections}

${docsSections}
`;
}

function buildContext() {
  return {
    version: VERSION,
    docs: readAllDocs(),
    helpSnapshots: readHelpSnapshots(),
  };
}

function writeOutputs(context, checkOnly) {
  let hasDiff = false;

  for (const output of OUTPUTS) {
    const contents = `${output.build(context).trim()}\n`;
    const current = fs.existsSync(output.path) ? fs.readFileSync(output.path, 'utf-8') : '';
    if (current !== contents) {
      hasDiff = true;
      if (!checkOnly) {
        fs.mkdirSync(path.dirname(output.path), { recursive: true });
        fs.writeFileSync(output.path, contents, 'utf-8');
      }
    }
  }

  if (checkOnly && hasDiff) {
    console.error('Release-facing docs are stale. Run node scripts/generate-release-docs.cjs');
    process.exit(1);
  }
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const context = buildContext();
  writeOutputs(context, checkOnly);

  if (checkOnly) {
    console.log('✓ Release-facing docs surfaces are up to date');
    return;
  }

  console.log('✓ Generated release-facing docs surfaces');
  for (const output of OUTPUTS) {
    console.log(`  - ${path.relative(ROOT, output.path)}`);
  }
}

main();
