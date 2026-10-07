#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCHEMA_VERSION = 'eai.object-type-routing.phase-bundle/v1';
const PHASES = new Set(['P0', 'A0', 'P1', 'A1']);
const CALLER_GIT_CONTEXT_KEYS = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_WORK_TREE',
];

function usage() {
  return `Usage:
  object-type-routing-phase-bundle.mjs create --repository <path> --phase <P0|A0|P1|A1> --baseline <sha> --output <file> [--exclude <path>] [--json]
  object-type-routing-phase-bundle.mjs verify --bundle <file> [--reconstruct] [--json]
  object-type-routing-phase-bundle.mjs verify-set --manifest <file> [--reconstruct] [--json]`;
}

function parseArgs(argv) {
  const command = argv[0];
  const args = { command, excludes: [], json: false, reconstruct: false };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') args.json = true;
    else if (token === '--reconstruct') args.reconstruct = true;
    else if (token === '--exclude') args.excludes.push(argv[++index] ?? '');
    else if (token.startsWith('--')) args[token.slice(2)] = argv[++index] ?? '';
    else throw new Error(`Unexpected argument: ${token}`);
  }
  return args;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonicalize(value)), 'utf8');
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function without(object, key) {
  return Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
}

function isolatedGitEnvironment() {
  const environment = { ...process.env };
  for (const key of CALLER_GIT_CONTEXT_KEYS) delete environment[key];
  return environment;
}

function git(repository, args, options = {}) {
  return execFileSync('git', ['-C', repository, ...args], {
    encoding: options.encoding === 'buffer' ? null : (options.encoding ?? 'utf8'),
    env: isolatedGitEnvironment(),
    maxBuffer: 128 * 1024 * 1024,
  });
}

function normalizeRepositoryPath(value) {
  return value.split(path.sep).join('/');
}

function validateEntryPath(value) {
  if (!value || path.isAbsolute(value) || value.split('/').includes('..')) {
    throw new Error(`Unsafe bundle entry path: ${value}`);
  }
}

function parseBaselineTree(repository, baselineSha) {
  const output = git(repository, ['ls-tree', '-r', '-z', '--full-tree', baselineSha]);
  const entries = new Map();
  for (const row of output.split('\0')) {
    if (!row) continue;
    const match = /^(\d+)\s+(\w+)\s+([a-f0-9]+)\t([\s\S]+)$/.exec(row);
    if (!match) throw new Error(`Could not parse git tree row: ${row}`);
    const [, mode, kind, oid, file] = match;
    if (kind === 'blob') entries.set(file, { mode, oid });
  }
  return entries;
}

function listWorktreePaths(repository) {
  const output = git(repository, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  return output.split('\0').filter(Boolean);
}

async function currentEntry(repository, relativePath) {
  const absolutePath = path.join(repository, ...relativePath.split('/'));
  try {
    const handle = await open(
      absolutePath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    );
    try {
      const openedStat = await handle.stat();
      if (!openedStat.isFile()) {
        throw new Error(`Bundle entry changed type while being read: ${relativePath}`);
      }
      return {
        kind: 'file',
        mode: (openedStat.mode & 0o111) !== 0 ? '100755' : '100644',
        content: await handle.readFile(),
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error?.code === 'ELOOP') {
      return {
        kind: 'symlink',
        mode: '120000',
        content: Buffer.from(await readlink(absolutePath), 'utf8'),
      };
    }
    throw error;
  }
}

function isExcluded(relativePath, excludes) {
  return excludes.some((candidate) => {
    const normalized = normalizeRepositoryPath(candidate).replace(/^\.\//, '').replace(/\/$/, '');
    return normalized && (relativePath === normalized || relativePath.startsWith(`${normalized}/`));
  });
}

async function buildEntries(repository, baselineSha, excludes) {
  const baseline = parseBaselineTree(repository, baselineSha);
  const candidates = new Set([...baseline.keys(), ...listWorktreePaths(repository)]);
  const entries = [];

  for (const relativePath of [...candidates].sort()) {
    validateEntryPath(relativePath);
    if (isExcluded(relativePath, excludes)) continue;
    const previous = baseline.get(relativePath);
    const current = await currentEntry(repository, relativePath);

    if (!current) {
      if (!previous) continue;
      const entry = {
        path: relativePath,
        kind: 'deletion',
        mode: previous.mode,
        deleted: true,
        contentBase64: null,
        contentDigest: null,
      };
      entries.push({ ...entry, entryDigest: sha256(canonicalBytes(entry)) });
      continue;
    }

    let changed = !previous || previous.mode !== current.mode;
    if (previous && !changed) {
      const previousContent = git(repository, ['show', `${baselineSha}:${relativePath}`], { encoding: 'buffer' });
      changed = !Buffer.from(previousContent).equals(current.content);
    }
    if (!changed) continue;

    const entry = {
      path: relativePath,
      kind: current.kind,
      mode: current.mode,
      deleted: false,
      contentBase64: current.content.toString('base64'),
      contentDigest: sha256(current.content),
    };
    entries.push({ ...entry, entryDigest: sha256(canonicalBytes(entry)) });
  }
  return entries;
}

async function atomicWriteJson(outputPath, value) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, outputPath);
}

async function createBundle(args) {
  if (!args.repository || !args.phase || !args.baseline || !args.output) {
    throw new Error(`Missing create argument.\n${usage()}`);
  }
  if (!PHASES.has(args.phase)) throw new Error(`Unsupported phase: ${args.phase}`);
  const repository = await realpath(path.resolve(args.repository));
  const baselineSha = git(repository, ['rev-parse', '--verify', `${args.baseline}^{commit}`]).trim();
  const entries = await buildEntries(repository, baselineSha, args.excludes);
  const body = {
    schemaVersion: SCHEMA_VERSION,
    repository: normalizeRepositoryPath(args.repository),
    phase: args.phase,
    baselineSha,
    semantics: 'cumulative_from_baseline',
    entries,
  };
  const bundle = { ...body, rootDigest: sha256(canonicalBytes(body)) };
  await atomicWriteJson(path.resolve(args.output), bundle);
  return { valid: true, bundle: path.resolve(args.output), phase: args.phase, entryCount: entries.length, rootDigest: bundle.rootDigest };
}

function validateBundle(bundle) {
  const errors = [];
  if (bundle?.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (!PHASES.has(bundle?.phase)) errors.push('phase must be P0, A0, P1, or A1');
  if (bundle?.semantics !== 'cumulative_from_baseline') errors.push('semantics must be cumulative_from_baseline');
  if (!/^[a-f0-9]{40,64}$/.test(bundle?.baselineSha ?? '')) errors.push('baselineSha must be an immutable Git object ID');
  if (!Array.isArray(bundle?.entries)) errors.push('entries must be an array');
  else {
    const sortedPaths = bundle.entries.map((entry) => entry.path);
    if (JSON.stringify(sortedPaths) !== JSON.stringify([...sortedPaths].sort())) errors.push('entries must be path-sorted');
    if (new Set(sortedPaths).size !== sortedPaths.length) errors.push('entries must have unique paths');
    for (const entry of bundle.entries) {
      try { validateEntryPath(entry.path); } catch (error) { errors.push(error.message); }
      const expectedEntryDigest = sha256(canonicalBytes(without(entry, 'entryDigest')));
      if (entry.entryDigest !== expectedEntryDigest) errors.push(`entry digest mismatch: ${entry.path}`);
      if (entry.deleted) {
        if (entry.kind !== 'deletion' || entry.contentBase64 !== null || entry.contentDigest !== null) {
          errors.push(`invalid deletion entry: ${entry.path}`);
        }
      } else {
        const content = Buffer.from(entry.contentBase64 ?? '', 'base64');
        if (entry.contentDigest !== sha256(content)) errors.push(`content digest mismatch: ${entry.path}`);
      }
    }
  }
  const expectedRootDigest = sha256(canonicalBytes(without(bundle ?? {}, 'rootDigest')));
  if (bundle?.rootDigest !== expectedRootDigest) errors.push('root digest mismatch');
  return errors;
}

async function reconstructBundle(bundle) {
  const repository = path.resolve(bundle.repository);
  const root = await mkdtemp(path.join(tmpdir(), 'object-type-routing-phase-'));
  try {
    const archive = spawnSync('git', ['-C', repository, 'archive', bundle.baselineSha], {
      env: isolatedGitEnvironment(),
      maxBuffer: 128 * 1024 * 1024,
    });
    if (archive.status !== 0) throw new Error(archive.stderr?.toString() || 'git archive failed');
    const extracted = spawnSync('tar', ['-x', '-C', root], { input: archive.stdout, maxBuffer: 128 * 1024 * 1024 });
    if (extracted.status !== 0) throw new Error(extracted.stderr?.toString() || 'tar extraction failed');

    for (const entry of bundle.entries) {
      validateEntryPath(entry.path);
      const target = path.join(root, ...entry.path.split('/'));
      if (entry.deleted) {
        await rm(target, { recursive: true, force: true });
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      await rm(target, { recursive: true, force: true });
      const content = Buffer.from(entry.contentBase64, 'base64');
      if (entry.kind === 'symlink') await symlink(content.toString('utf8'), target);
      else {
        await writeFile(target, content);
        await chmod(target, entry.mode === '100755' ? 0o755 : 0o644);
      }
    }

    for (const entry of bundle.entries) {
      const current = await currentEntry(root, entry.path);
      if (entry.deleted && current !== null) throw new Error(`reconstruction retained deleted path: ${entry.path}`);
      if (!entry.deleted) {
        if (!current) throw new Error(`reconstruction omitted path: ${entry.path}`);
        if (current.mode !== entry.mode || current.kind !== entry.kind) throw new Error(`reconstruction metadata mismatch: ${entry.path}`);
        if (sha256(current.content) !== entry.contentDigest) throw new Error(`reconstruction content mismatch: ${entry.path}`);
      }
    }
    return true;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function verifyBundleFile(bundlePath, reconstruct) {
  const bundle = JSON.parse(await readFile(path.resolve(bundlePath), 'utf8'));
  const errors = validateBundle(bundle);
  let reconstructed = false;
  if (errors.length === 0 && reconstruct) {
    try {
      reconstructed = await reconstructBundle(bundle);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { valid: errors.length === 0, bundle: path.resolve(bundlePath), phase: bundle.phase, rootDigest: bundle.rootDigest, reconstructed, errors };
}

async function verifySet(args) {
  if (!args.manifest) throw new Error(`--manifest is required.\n${usage()}`);
  const manifestPath = path.resolve(args.manifest);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const members = Array.isArray(manifest.bundles)
    ? manifest.bundles
    : Object.values(manifest.bundles ?? {});
  const results = [];
  for (const member of members) {
    const memberPath = typeof member === 'string' ? member : member.path;
    const absolutePath = path.resolve(path.dirname(manifestPath), memberPath);
    const result = await verifyBundleFile(absolutePath, args.reconstruct);
    if (typeof member === 'object' && member.rootDigest && member.rootDigest !== result.rootDigest) {
      result.valid = false;
      result.errors.push('manifest rootDigest mismatch');
    }
    results.push(result);
  }
  return { valid: results.length > 0 && results.every((result) => result.valid), manifest: manifestPath, results };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  if (args.command === 'create') result = await createBundle(args);
  else if (args.command === 'verify') {
    if (!args.bundle) throw new Error(`--bundle is required.\n${usage()}`);
    result = await verifyBundleFile(args.bundle, args.reconstruct);
  } else if (args.command === 'verify-set') result = await verifySet(args);
  else throw new Error(usage());

  process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
  if (!result.valid) process.exitCode = 1;
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ valid: false, errors: [error instanceof Error ? error.message : String(error)] }, null, 2)}\n`);
  process.exitCode = 1;
});
