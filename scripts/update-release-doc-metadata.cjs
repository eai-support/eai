#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const version = process.argv[2];
const releaseMessage = process.argv.slice(3).join(' ').trim();

if (!version || !releaseMessage) {
  console.error('Usage: node scripts/update-release-doc-metadata.cjs <version> "<release message>"');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
let sourceCommit = 'unknown';
try {
  sourceCommit = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
} catch {
  sourceCommit = 'unknown';
}

function updateFile(relativePath, transform) {
  const absolutePath = path.join(ROOT, relativePath);
  const original = fs.readFileSync(absolutePath, 'utf-8');
  fs.writeFileSync(absolutePath, transform(original), 'utf-8');
}

function updateGeneratedHeader(markdown) {
  return markdown
    .replace(/generated_at:\s*".*?"/, `generated_at: "${new Date().toISOString()}"`)
    .replace(/source_commit:\s*".*?"/, `source_commit: "${sourceCommit}"`);
}

updateFile('.tech-docs/overview.md', (markdown) => (
  (() => {
    let next = updateGeneratedHeader(markdown)
    .replace(/\| \*\*Version\*\* \| .*? \|/, `| **Version** | ${version} |`)
    .replace(/\| \*\*Current Status\*\* \| .*? \|/, `| **Current Status** | Active development (v${version} released ${today}) |`)
    .replace(/\| \*\*Last Material Change\*\* \| .*? \|/, `| **Last Material Change** | v${version}: ${releaseMessage} (${today}) |`)
    .replace(/\*\*Version\*\*: .*?\s{2}/, `**Version**: ${version}  `)
    .replace(/\| `src\/lib\/update-check\.ts` \| .*?\|/, '| `src/lib/update-check.ts` | Auto-update checker using the static EAI registry packument |')
    .replace(/- \*\*Background Checks\*\*: .*?\n/, '- **Background Checks**: Queries the static EAI registry packument every 24 hours (cached in `~/.eai/update-check.json`)\n')
    .replace(/- \*\*Manual Upgrade\*\*: .*?\n/, '- **Manual Upgrade**: Users run `eai update` or `npm install -g @eai-tools/cli` after configuring the scoped EAI registry\n')
    .replace(/- \*\*Version\*\*: .*?\n/, `- **Version**: ${version} (released ${today})\n`);

    if (!next.includes(`### v${version} (${today})`)) {
      next = next.replace(
        '## Recent Enhancements\n\n',
        `## Recent Enhancements\n\n### v${version} (${today})\n- **${releaseMessage}**\n\n`,
      );
    }

    return next;
  })()
));

updateFile('.tech-docs/dependencies.md', (markdown) => (
  updateGeneratedHeader(markdown)
    .replace(/CLI\[eai CLI v[\d.]+\]/, `CLI[eai CLI v${version}]`)
));

updateFile('.tech-docs/changelog.md', (markdown) => {
  const updated = updateGeneratedHeader(markdown)
    .replace(/\*\*Version\*\*: .*?\n/, `**Version**: ${version} (stable)\n`);

  if (updated.includes(`## [${version}] - ${today}`)) {
    return updated;
  }

  return updated.replace(
    '## Previous Updates\n\n---',
    `## [${version}] - ${today}\n\n- ${releaseMessage}\n\n## Previous Updates\n\n---`,
  );
});

updateFile('.tech-docs/architecture.md', (markdown) => (
  updateGeneratedHeader(markdown)
    .replace(
      /\| \*\*update-check\.ts\*\* \| `checkForUpdate`, `notifyIfUpdateAvailable` \| .*?\|/,
      '| **update-check.ts** | `checkForUpdate`, `notifyIfUpdateAvailable` | Static EAI registry integration for version checks |',
    )
    .replace(/Update checks cached for 24 hours in `~\/\.eai\/last-update-check`/, 'Update checks cached for 24 hours in `~/.eai/update-check.json`')
));

console.log('✓ Updated release metadata in .tech-docs');
console.log(`  Version: ${version}`);
console.log(`  Date:    ${today}`);
console.log(`  Message: ${releaseMessage}`);
