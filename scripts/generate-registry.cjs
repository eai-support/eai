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
  packument.versions[version] = versionEntry;
  packument['dist-tags'].latest = version;
  packument.modified = new Date().toISOString();

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

  // Summary
  const versionCount = Object.keys(packument.versions).length;
  console.log('');
  console.log(`✓ Registry updated: ${name}@${version}`);
  console.log(`  Versions in registry: ${versionCount}`);
  console.log(`  Packument: docs/public/registry/${SCOPE}/cli`);
  console.log(`  Tarball:   docs/public/registry/-/${SCOPE}/cli-${version}.tgz`);
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
