#!/usr/bin/env node

/**
 * Generate static npm registry metadata for GitHub Pages.
 *
 * Reads package.json, finds the npm pack tarball, computes integrity hashes,
 * and writes/updates the registry packument + copies the tarball into the
 * docs/public/registry/ directory structure.
 *
 * Usage: npm pack && node scripts/generate-registry.cjs
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REGISTRY_DIR = path.join(ROOT, 'docs', 'public', 'registry');
const SCOPE = '@eai-tools';
const BASE_URL = 'https://eai-tools.github.io/eai-cli/registry';

function main() {
  // 1. Read package.json
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const { name, version, description, bin, engines, dependencies } = pkg;

  if (name !== `${SCOPE}/cli`) {
    console.error(`✗ Expected package name "${SCOPE}/cli", got "${name}"`);
    process.exit(1);
  }

  console.log(`▸ Generating registry for ${name}@${version}`);

  // 2. Find the npm pack tarball
  const tarballName = findTarball(version);
  const tarballPath = path.join(ROOT, tarballName);
  const tarballData = fs.readFileSync(tarballPath);

  console.log(`  ✓ Found tarball: ${tarballName} (${tarballData.length} bytes)`);

  // 3. Compute hashes
  const shasum = crypto.createHash('sha1').update(tarballData).digest('hex');
  const sha512 = crypto.createHash('sha512').update(tarballData).digest('base64');
  const integrity = `sha512-${sha512}`;

  console.log(`  ✓ shasum:    ${shasum}`);
  console.log(`  ✓ integrity: ${integrity.slice(0, 30)}...`);

  // 4. Read existing packument (if any)
  const packumentPath = path.join(REGISTRY_DIR, SCOPE, 'cli');
  let packument;

  if (fs.existsSync(packumentPath)) {
    packument = JSON.parse(fs.readFileSync(packumentPath, 'utf-8'));
    console.log(`  ✓ Existing packument: ${Object.keys(packument.versions).length} version(s)`);
  } else {
    packument = {
      name,
      'dist-tags': {},
      versions: {},
    };
    console.log('  ✓ Creating new packument');
  }

  // 5. Build version entry
  const tarballUrl = `${BASE_URL}/-/${SCOPE}/cli-${version}.tgz`;
  const versionEntry = {
    name,
    version,
    description,
    bin,
    engines,
    dependencies,
    dist: {
      tarball: tarballUrl,
      shasum,
      integrity,
    },
  };

  // 6. Update packument
  const now = new Date().toISOString();
  packument.versions[version] = versionEntry;
  packument['dist-tags'].latest = version;
  packument.modified = now;

  // Track per-version publish times (standard npm packument convention)
  if (!packument.time) {
    packument.time = {};
  }
  if (!packument.time[version]) {
    packument.time[version] = now;
  }
  packument.time.modified = now;

  // 7. Write packument (extensionless file)
  fs.mkdirSync(path.dirname(packumentPath), { recursive: true });
  fs.writeFileSync(packumentPath, JSON.stringify(packument, null, 2) + '\n');
  console.log(`  ✓ Wrote packument: ${packumentPath}`);

  // 8. Copy tarball to registry
  const registryTarballDir = path.join(REGISTRY_DIR, '-', SCOPE);
  const registryTarballPath = path.join(registryTarballDir, `cli-${version}.tgz`);
  fs.mkdirSync(registryTarballDir, { recursive: true });
  fs.copyFileSync(tarballPath, registryTarballPath);
  console.log(`  ✓ Copied tarball: ${registryTarballPath}`);

  // 9. Generate version listing HTML
  generateVersionListing(packument);

  // Summary
  const versionCount = Object.keys(packument.versions).length;
  console.log('');
  console.log(`✓ Registry updated: ${name}@${version}`);
  console.log(`  Versions in registry: ${versionCount}`);
  console.log(`  Packument: docs/public/registry/${SCOPE}/cli`);
  console.log(`  Tarball:   docs/public/registry/-/${SCOPE}/cli-${version}.tgz`);
  console.log(`  Listing:   docs/public/registry/index.html`);
}

function generateVersionListing(packument) {
  const latest = packument['dist-tags'].latest;
  const versions = Object.keys(packument.versions)
    .sort((a, b) => {
      // Sort newest first using simple semver comparison
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
      }
      return 0;
    });

  const rows = versions.map(v => {
    const entry = packument.versions[v];
    const publishDate = (packument.time && packument.time[v])
      ? new Date(packument.time[v]).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : '—';
    const sha1 = entry.dist.shasum;
    const tarballUrl = entry.dist.tarball;
    const isLatest = v === latest;
    const badge = isLatest ? ' <span class="badge">latest</span>' : '';

    return `      <tr>
        <td><code>${v}</code>${badge}</td>
        <td>${publishDate}</td>
        <td><code title="${sha1}">${sha1.slice(0, 12)}…</code></td>
        <td><a href="${tarballUrl}" download>Download</a></td>
      </tr>`;
  }).join('\n');

  const html = `<!-- Generated by scripts/generate-registry.cjs — do not edit -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${packument.name} — Registry</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, Consolas, monospace;
      background: #0d1117;
      color: #c9d1d9;
      line-height: 1.6;
      padding: 2rem;
      max-width: 56rem;
      margin: 0 auto;
    }
    h1 { color: #58a6ff; font-size: 1.5rem; margin-bottom: 0.25rem; }
    .subtitle { color: #8b949e; font-size: 0.875rem; margin-bottom: 2rem; }
    h2 { color: #c9d1d9; font-size: 1.1rem; margin: 2rem 0 0.75rem; border-bottom: 1px solid #21262d; padding-bottom: 0.5rem; }
    pre {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 1rem;
      overflow-x: auto;
      font-size: 0.85rem;
      margin-bottom: 1.5rem;
    }
    code { font-family: inherit; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
    th { text-align: left; color: #8b949e; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.5rem 0.75rem; border-bottom: 1px solid #30363d; }
    td { padding: 0.6rem 0.75rem; border-bottom: 1px solid #21262d; font-size: 0.875rem; }
    tr:hover { background: #161b22; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .badge {
      display: inline-block;
      background: #238636;
      color: #fff;
      font-size: 0.7rem;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      margin-left: 0.5rem;
      vertical-align: middle;
      font-weight: 600;
    }
    .footer { color: #484f58; font-size: 0.75rem; margin-top: 3rem; border-top: 1px solid #21262d; padding-top: 1rem; }
  </style>
</head>
<body>
  <h1>${packument.name}</h1>
  <p class="subtitle">${packument.versions[latest].description}</p>

  <h2>Install</h2>
  <pre><code># 1. Configure the registry (one-time setup)
echo "@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry" >> ~/.npmrc

# 2. Install the CLI globally
npm install -g @eai-tools/cli</code></pre>

  <h2>Versions</h2>
  <table>
    <thead>
      <tr>
        <th>Version</th>
        <th>Published</th>
        <th>SHA-1</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <p class="footer">
    Static npm registry hosted on GitHub Pages.
    Generated ${new Date().toISOString().split('T')[0]}.
  </p>
</body>
</html>
`;

  const htmlPath = path.join(REGISTRY_DIR, 'index.html');
  fs.writeFileSync(htmlPath, html);
  console.log(`  ✓ Wrote version listing: ${htmlPath}`);
}

function findTarball(version) {
  const files = fs.readdirSync(ROOT);
  // npm pack for @eai-tools/cli produces eai-tools-cli-{version}.tgz
  const expected = `eai-tools-cli-${version}.tgz`;
  if (files.includes(expected)) {
    return expected;
  }
  // Fallback: find any matching tarball
  const match = files.find(f => f.endsWith('.tgz') && f.includes(version));
  if (match) {
    return match;
  }
  console.error(`✗ Tarball not found. Expected: ${expected}`);
  console.error('  Run "npm pack" first.');
  process.exit(1);
}

main();
