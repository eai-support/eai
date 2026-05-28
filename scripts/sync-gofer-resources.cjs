#!/usr/bin/env node

/**
 * Sync bundled gofer assets from the canonical eai-tools/eai-gofer repository.
 *
 * The `eai init` command installs everything under `resources/gofer/` into a
 * user's workspace, so that directory must mirror the gofer release pinned in
 * `.gofer-version`.
 *
 * Newer Gofer releases still publish the extension-ready asset bundle under
 * `extension/resources/`, but they also keep additional repo-local surfaces
 * outside that tree (for example `.specify/commands` and Codex skills). This
 * script mirrors `extension/resources/` first, then overlays the extra
 * directories needed by eai so published bundles stay complete.
 *
 * Usage:
 *   node scripts/sync-gofer-resources.cjs            # use pinned .gofer-version
 *   node scripts/sync-gofer-resources.cjs v3.0.1     # override tag/ref
 *   GOFER_REF=main node scripts/sync-gofer-resources.cjs
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = 'https://github.com/eai-tools/eai-gofer.git';
const ROOT = path.resolve(__dirname, '..');
const PIN_FILE = path.join(ROOT, '.gofer-version');
const TARGET = path.join(ROOT, 'resources', 'gofer');
const BASE_RESOURCE_DIR = path.join('extension', 'resources');
const EXTRA_RESOURCE_MAPPINGS = [
  ['.specify/commands', 'commands'],
  ['.specify/memory', 'memory'],
  ['.specify/references', 'references'],
  ['.system/skills', 'system-skills'],
  ['.agents/skills', 'agents-skills'],
];

function readPinnedRef() {
  const override = process.argv[2] ?? process.env.GOFER_REF;
  if (override) {
    return override.trim();
  }

  if (!fs.existsSync(PIN_FILE)) {
    throw new Error(
      `Missing ${path.relative(ROOT, PIN_FILE)}. Create it with a gofer tag (e.g. "v2.0.10") or pass a ref argument.`,
    );
  }

  const pinned = fs.readFileSync(PIN_FILE, 'utf-8').trim();
  if (!pinned) {
    throw new Error(`${path.relative(ROOT, PIN_FILE)} is empty.`);
  }

  return pinned;
}

function run(cmd, args, options = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...options });
}

function cloneAtRef(ref, workdir) {
  try {
    run('git', ['clone', '--depth', '1', '--branch', ref, REPO, workdir]);
  } catch {
    run('git', ['clone', REPO, workdir]);
    run('git', ['-C', workdir, 'checkout', ref]);
  }
}

function resolvedSha(workdir) {
  return execFileSync('git', ['-C', workdir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
}

function resolvedDescribe(workdir) {
  return execFileSync('git', ['-C', workdir, 'describe', '--tags', '--always'], { encoding: 'utf-8' }).trim();
}

function mirror(sourceDir, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  copyDir(sourceDir, targetDir);
}

function copyDir(src, dst) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

function syncDir(workdir, sourceRelativeDir, targetRelativeDir) {
  const sourceDir = path.join(workdir, sourceRelativeDir);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    console.log(`▸ Skipping missing ${sourceRelativeDir}`);
    return;
  }

  const targetDir = path.join(TARGET, targetRelativeDir);
  fs.mkdirSync(targetDir, { recursive: true });
  copyDir(sourceDir, targetDir);
  console.log(`▸ Synced ${sourceRelativeDir} → ${path.relative(ROOT, targetDir)}`);
}

function writeSyncMetadata(sha, describe) {
  const metadata = {
    commit: sha,
    describe,
    synced_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  fs.writeFileSync(path.join(TARGET, '.gofer-version'), JSON.stringify(metadata, null, 2) + '\n');
}

function main() {
  const ref = readPinnedRef();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eai-gofer-sync-'));

  try {
    console.log(`▸ Syncing gofer resources from ${REPO} @ ${ref}`);
    cloneAtRef(ref, tmpDir);

    const sourceDir = path.join(tmpDir, BASE_RESOURCE_DIR);
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`gofer@${ref} is missing ${BASE_RESOURCE_DIR}/ — refusing to wipe target.`);
    }

    const sha = resolvedSha(tmpDir);
    const describe = resolvedDescribe(tmpDir);
    mirror(sourceDir, TARGET);
    for (const [sourceRelativeDir, targetRelativeDir] of EXTRA_RESOURCE_MAPPINGS) {
      syncDir(tmpDir, sourceRelativeDir, targetRelativeDir);
    }
    writeSyncMetadata(sha, describe);

    const fileCount = countFiles(TARGET);
    console.log(`▸ Mirrored ${fileCount} files into ${path.relative(ROOT, TARGET)}/`);
    console.log(`▸ gofer ref: ${describe} (${sha})`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function countFiles(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      total += countFiles(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      total += 1;
    }
  }
  return total;
}

try {
  main();
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
