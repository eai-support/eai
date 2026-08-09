#!/usr/bin/env node

/**
 * Sync bundled gofer assets from the canonical eai-support/eai-gofer repository.
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
 *   GOFER_SOURCE_DIR=../gofer node scripts/sync-gofer-resources.cjs
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = 'https://github.com/eai-support/eai-gofer.git';
const ROOT = path.resolve(__dirname, '..');
const PIN_FILE = path.join(ROOT, '.gofer-version');
const TARGET = path.join(ROOT, 'resources', 'gofer');
const BASE_RESOURCE_DIR = path.join('extension', 'resources');
const EXTRA_RESOURCE_MAPPINGS = [
  ['.specify/config', 'config'],
  ['.specify/contracts', 'contracts'],
  ['.specify/commands', 'commands'],
  ['.specify/memory', 'memory'],
  ['.specify/references', 'references'],
  ['.specify/schemas', 'schemas'],
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

function hasUncommittedChanges(workdir) {
  return execFileSync('git', ['-C', workdir, 'status', '--short'], { encoding: 'utf-8' }).trim().length > 0;
}

function mirror(workdir, sourceRelativeDir, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  return copyTrackedFiles(workdir, sourceRelativeDir, targetDir);
}

function listTrackedFiles(workdir, sourceRelativeDir) {
  // Local feature validation must be able to mirror newly generated files
  // before a commit exists; clean tagged sources produce the same list.
  const output = execFileSync(
    'git',
    [
      '-C',
      workdir,
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      sourceRelativeDir,
    ],
    { encoding: 'utf-8' },
  );
  return output.split('\0').filter(Boolean);
}

function copyTrackedFiles(workdir, sourceRelativeDir, targetDir) {
  const files = listTrackedFiles(workdir, sourceRelativeDir);
  for (const relativeFile of files) {
    const from = path.join(workdir, relativeFile);
    const to = path.join(targetDir, path.relative(sourceRelativeDir, relativeFile));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  return files.length;
}

function syncDir(workdir, sourceRelativeDir, targetRelativeDir) {
  const sourceDir = path.join(workdir, sourceRelativeDir);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    console.log(`▸ Skipping missing ${sourceRelativeDir}`);
    return;
  }

  const targetDir = path.join(TARGET, targetRelativeDir);
  fs.mkdirSync(targetDir, { recursive: true });
  copyTrackedFiles(workdir, sourceRelativeDir, targetDir);
  console.log(`▸ Synced ${sourceRelativeDir} → ${path.relative(ROOT, targetDir)}`);
}

function writeSyncMetadata({ sha, describe, source, dirty }) {
  const metadata = {
    commit: sha,
    describe,
    source,
    dirty,
    synced_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  fs.writeFileSync(path.join(TARGET, '.gofer-version'), JSON.stringify(metadata, null, 2) + '\n');
}

function syncFromCheckout(workdir, source) {
  const sourceDir = path.join(workdir, BASE_RESOURCE_DIR);
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`gofer source ${workdir} is missing ${BASE_RESOURCE_DIR}/ — refusing to wipe target.`);
  }

  const sha = resolvedSha(workdir);
  const describe = resolvedDescribe(workdir);
  const dirty = hasUncommittedChanges(workdir);
  mirror(workdir, BASE_RESOURCE_DIR, TARGET);
  for (const [sourceRelativeDir, targetRelativeDir] of EXTRA_RESOURCE_MAPPINGS) {
    syncDir(workdir, sourceRelativeDir, targetRelativeDir);
  }
  writeSyncMetadata({ sha, describe, source, dirty });

  const fileCount = countFiles(TARGET);
  console.log(`▸ Mirrored ${fileCount} files into ${path.relative(ROOT, TARGET)}/`);
  console.log(`▸ gofer ref: ${describe} (${sha})${dirty ? ' with local modifications' : ''}`);
}

function main() {
  const localSource = process.env.GOFER_SOURCE_DIR;
  if (localSource) {
    const workdir = path.resolve(ROOT, localSource);
    console.log(`▸ Syncing gofer resources from local checkout ${workdir}`);
    syncFromCheckout(workdir, 'local-checkout');
    return;
  }

  const ref = readPinnedRef();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eai-gofer-sync-'));
  try {
    console.log(`▸ Syncing gofer resources from ${REPO} @ ${ref}`);
    cloneAtRef(ref, tmpDir);
    syncFromCheckout(tmpDir, `${REPO}@${ref}`);
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
