/** Copy benchmark outputs into an owner-only, content-addressed local store.
 * Capture preserves bytes; it does not verify functionality or grant routing authority. */
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, opendir, realpath, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTrustedHeldOutCorpus } from './gofer-trusted-evaluator.mjs';

const denied = () => new Error('HELDOUT_SNAPSHOT_REQUIRED');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const safeName = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value);
const safeEntry = value => typeof value === 'string' &&
  /^(receipts|worktrees)\/[a-zA-Z0-9._/-]+$/.test(value) &&
  !value.split('/').some(part => part === '.' || part === '..' || !part);
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

async function ownerDirectory(directory, privateDirectory = true) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.uid !== process.getuid() ||
      (info.mode & (privateDirectory ? 0o077 : 0o022)) !== 0) throw denied();
}

async function sourceFile(filename, maxBytes = 2 * 1024 * 1024, minBytes = 1) {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1 ||
        (info.mode & 0o022) !== 0 || info.size < minBytes || info.size > maxBytes) throw denied();
    return await file.readFile();
  } finally { await file.close(); }
}

async function writeObject(objects, bytes) {
  const hash = sha(bytes);
  const filename = path.join(objects, hash);
  try {
    const file = await open(filename, constants.O_WRONLY | constants.O_CREAT |
      constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(bytes); await file.sync(); }
    finally { await file.close(); }
  } catch (error) {
    if (error.code !== 'EEXIST' || sha(await sourceFile(filename, 2 * 1024 * 1024, 0)) !== hash) throw error;
  }
  return hash;
}

async function collectWorktree(worktree, prefix, add) {
  const pending = [''];
  let fileCount = 0;
  let totalBytes = 0;
  while (pending.length) {
    const relative = pending.pop();
    const directory = path.join(worktree, relative);
    await ownerDirectory(directory, relative === '');
    const entries = await opendir(directory);
    for await (const entry of entries) {
      if (entry.name === '.git' && relative === '') continue;
      if (entry.name === '.' || entry.name === '..' || entry.name.includes('/') || entry.name.includes('\\')) throw denied();
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const filename = path.join(worktree, name);
      const info = await lstat(filename);
      if (info.isDirectory()) { pending.push(name); continue; }
      if (!info.isFile() || ++fileCount > 5000) throw denied();
      const bytes = await sourceFile(filename, 2 * 1024 * 1024, 0);
      totalBytes += bytes.length;
      if (totalBytes > 16 * 1024 * 1024) throw denied();
      await add(`${prefix}/${name}`, bytes);
    }
  }
}

/** Trusted-controller seam. A snapshot is diagnostic until separately rechecked
 * against the pinned corpus and signed by an isolated verifier identity. */
export async function captureHeldOutResultSnapshot({ corpusRoot, workspaceRoot, trustRoot,
  expectedCorpusHash, expectedCaseIds } = {}) {
  if (!['darwin', 'linux'].includes(process.platform) || typeof process.getuid !== 'function' ||
      ![corpusRoot, workspaceRoot, trustRoot].every(value => typeof value === 'string' && path.isAbsolute(value))) throw denied();
  let staging;
  try {
    const [corpus, workspace, trust, temporary] = await Promise.all([
      realpath(corpusRoot), realpath(workspaceRoot), realpath(trustRoot), realpath(os.tmpdir()),
    ]);
    if (inside(workspace, trust) || inside(trust, workspace) || !inside(trust, corpus)) throw denied();
    await ownerDirectory(trust);
    await ownerDirectory(corpus);
    const receipts = path.join(corpus, 'receipts');
    await ownerDirectory(receipts);
    const reportBytes = await sourceFile(path.join(receipts, 'benchmark-report.json'));
    const saved = JSON.parse(reportBytes.toString('utf8'));
    const runs = saved?.report?.runs;
    if (!Array.isArray(runs) || runs.length < 12 || runs.length > 3000 ||
        saved.report.repetitions !== 3 || !/^[a-f0-9]{64}$/.test(saved.corpusHash ?? '') ||
        (expectedCorpusHash && saved.corpusHash !== expectedCorpusHash)) throw denied();
    if (expectedCaseIds && (!Array.isArray(expectedCaseIds) ||
        runs.length !== expectedCaseIds.length * 3 ||
        new Set(runs.map(item => item?.caseId)).size !== expectedCaseIds.length ||
        runs.some(item => !expectedCaseIds.includes(item?.caseId)))) throw denied();
    const results = path.join(trust, 'results');
    await mkdir(results, { mode: 0o700, recursive: true });
    await ownerDirectory(results);
    staging = path.join(results, `.staging-${randomUUID()}`);
    await mkdir(staging, { mode: 0o700 });
    const objects = path.join(staging, 'objects');
    await mkdir(objects, { mode: 0o700 });
    const entries = [];
    const names = new Set();
    let capturedBytes = 0;
    const add = async (name, bytes) => {
      if (names.has(name)) throw denied();
      capturedBytes += bytes.length;
      if (capturedBytes > 128 * 1024 * 1024) throw denied();
      names.add(name);
      entries.push({ name, sha256: await writeObject(objects, bytes) });
    };
    await add('receipts/benchmark-report.json', reportBytes);
    const labels = new Set();
    const worktrees = new Set();
    for (const run of runs) {
      if (!safeName(run?.caseId) || ![1, 2, 3].includes(run?.run)) throw denied();
      const label = `${run.caseId}-${run.run}`;
      if (labels.has(label)) throw denied();
      labels.add(label);
      const executionBytes = await sourceFile(path.join(receipts, `${label}.execution.json`));
      const verificationBytes = await sourceFile(path.join(receipts, `${label}.verification.json`));
      const execution = JSON.parse(executionBytes.toString('utf8'));
      if (!path.isAbsolute(execution?.worktree ?? '')) throw denied();
      const worktree = await realpath(execution.worktree);
      if (!inside(temporary, worktree) || inside(workspace, worktree) || inside(trust, worktree) ||
          worktrees.has(worktree)) throw denied();
      worktrees.add(worktree);
      await ownerDirectory(worktree);
      await add(`receipts/${label}.execution.json`, executionBytes);
      await add(`receipts/${label}.verification.json`, verificationBytes);
      await collectWorktree(worktree, `worktrees/${label}`, add);
    }
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    const manifest = { schemaVersion: 1, authority: 'diagnostic-only',
      corpusHash: saved.corpusHash, reportSha256: sha(reportBytes), entries };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const snapshotId = sha(manifestBytes);
    const file = await open(path.join(staging, 'manifest.json'), constants.O_WRONLY |
      constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(manifestBytes); await file.sync(); }
    finally { await file.close(); }
    await rename(staging, path.join(results, snapshotId));
    staging = null;
    await inspectHeldOutResultSnapshot({ trustRoot: trust, workspaceRoot, snapshotId });
    return Object.freeze({ snapshotId, corpusHash: saved.corpusHash,
      reportSha256: manifest.reportSha256, fileCount: entries.length, authority: 'diagnostic-only' });
  } catch { throw denied(); }
  finally { if (staging) await rm(staging, { recursive: true, force: true }); }
}

/** Recheck the protected copy before a verifier may consume it. The digest
 * detects corruption; it is not a substitute for a separate signing key. */
export async function inspectHeldOutResultSnapshot({ trustRoot, workspaceRoot, snapshotId } = {}) {
  if (!/^[a-f0-9]{64}$/.test(snapshotId ?? '') ||
      ![trustRoot, workspaceRoot].every(value => typeof value === 'string' && path.isAbsolute(value))) throw denied();
  try {
    const [trust, workspace] = await Promise.all([realpath(trustRoot), realpath(workspaceRoot)]);
    if (inside(workspace, trust) || inside(trust, workspace)) throw denied();
    const results = path.join(trust, 'results');
    const folder = path.join(results, snapshotId);
    const objects = path.join(folder, 'objects');
    for (const directory of [trust, results, folder, objects]) await ownerDirectory(directory);
    const manifestBytes = await sourceFile(path.join(folder, 'manifest.json'), 4 * 1024 * 1024);
    if (sha(manifestBytes) !== snapshotId) throw denied();
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (manifest?.schemaVersion !== 1 || manifest.authority !== 'diagnostic-only' ||
        !/^[a-f0-9]{64}$/.test(manifest.corpusHash ?? '') ||
        !/^[a-f0-9]{64}$/.test(manifest.reportSha256 ?? '') ||
        !Array.isArray(manifest.entries) || manifest.entries.length < 37 ||
        manifest.entries.length > 15000) throw denied();
    const names = new Set();
    let totalBytes = 0;
    for (const entry of manifest.entries) {
      if (!safeEntry(entry?.name) || names.has(entry.name) ||
          !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) throw denied();
      names.add(entry.name);
      const bytes = await sourceFile(path.join(objects, entry.sha256), 2 * 1024 * 1024, 0);
      totalBytes += bytes.length;
      if (totalBytes > 128 * 1024 * 1024 || sha(bytes) !== entry.sha256) throw denied();
    }
    const report = manifest.entries.find(entry => entry.name === 'receipts/benchmark-report.json');
    if (report?.sha256 !== manifest.reportSha256) throw denied();
    return Object.freeze({ snapshotId, corpusHash: manifest.corpusHash,
      reportSha256: manifest.reportSha256, fileCount: manifest.entries.length,
      authority: 'diagnostic-only' });
  } catch { throw denied(); }
}

/** Materialize verified bytes outside the account trust root for the
 * read-only, offline verifier sandbox. The caller owns cleanup of `root`. */
export async function materializeHeldOutResultSnapshot({ trustRoot, workspaceRoot, snapshotId } = {}) {
  await inspectHeldOutResultSnapshot({ trustRoot, workspaceRoot, snapshotId });
  let root;
  try {
    const folder = path.join(await realpath(trustRoot), 'results', snapshotId);
    const manifestBytes = await sourceFile(path.join(folder, 'manifest.json'), 4 * 1024 * 1024);
    if (sha(manifestBytes) !== snapshotId) throw denied();
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    root = await mkdtemp(path.join(os.tmpdir(), 'gofer-heldout-recheck-'));
    for (const entry of manifest.entries) {
      if (!safeEntry(entry?.name) || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) throw denied();
      const bytes = await sourceFile(path.join(folder, 'objects', entry.sha256), 2 * 1024 * 1024, 0);
      if (sha(bytes) !== entry.sha256) throw denied();
      const filename = path.join(root, entry.name);
      if (!inside(root, filename)) throw denied();
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      const file = await open(filename, constants.O_WRONLY | constants.O_CREAT |
        constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(bytes); }
      finally { await file.close(); }
    }
    await inspectHeldOutResultSnapshot({ trustRoot, workspaceRoot, snapshotId });
    return Object.freeze({ root, snapshotId, corpusHash: manifest.corpusHash,
      reportSha256: manifest.reportSha256 });
  } catch {
    if (root) await rm(root, { recursive: true, force: true });
    throw denied();
  }
}

/** A trusted setup path may pin one captured result without signing it. */
export async function loadPinnedHeldOutSnapshot({ trustRoot, workspaceRoot, corpusHash } = {}) {
  if (!/^[a-f0-9]{64}$/.test(corpusHash ?? '') ||
      ![trustRoot, workspaceRoot].every(value => typeof value === 'string' && path.isAbsolute(value))) throw denied();
  try {
    const trust = await realpath(trustRoot);
    const workspace = await realpath(workspaceRoot);
    if (inside(workspace, trust) || inside(trust, workspace)) throw denied();
    await ownerDirectory(trust);
    const configPath = path.join(trust, 'heldout-results.json');
    const configInfo = await lstat(configPath);
    if (!configInfo.isFile() || configInfo.uid !== process.getuid() ||
        configInfo.nlink !== 1 || (configInfo.mode & 0o077) !== 0) throw denied();
    const config = JSON.parse((await sourceFile(configPath, 4096)).toString('utf8'));
    if (config?.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(config.snapshotId ?? '') ||
        config.corpusHash !== corpusHash) throw denied();
    const snapshot = await inspectHeldOutResultSnapshot({ trustRoot: trust, workspaceRoot, snapshotId: config.snapshotId });
    if (snapshot.corpusHash !== corpusHash) throw denied();
    return Object.freeze({ snapshotId: config.snapshotId, trustRoot: trust });
  } catch { throw denied(); }
}

/** The trusted controller must present a durable capture authorization.
 * The command-line surface has no way to inject one and stays fail-closed. */
export async function captureConfiguredHeldOutResultSnapshot({ workspaceRoot, ledger,
  captureAuthorization } = {}) {
  try {
    if (typeof ledger?.inspectBenchmarkCapture !== 'function' ||
        typeof ledger?.recordBenchmarkSnapshot !== 'function' ||
        !captureAuthorization?.receipt || !captureAuthorization?.workerStopReceipt ||
        !captureAuthorization?.revision || !captureAuthorization?.reportSha256) throw denied();
    const corpus = await loadTrustedHeldOutCorpus({ workspaceRoot });
    const reportSha256 = sha(await sourceFile(path.join(corpus.corpusRoot, 'receipts', 'benchmark-report.json')));
    if (captureAuthorization.corpusHash !== corpus.corpusHash ||
        captureAuthorization.reportSha256 !== reportSha256 ||
        (await ledger.inspectBenchmarkCapture(captureAuthorization))?.valid !== true) throw denied();
    const snapshot = await captureHeldOutResultSnapshot({ corpusRoot: corpus.corpusRoot, workspaceRoot,
      trustRoot: path.dirname(path.dirname(corpus.corpusRoot)), expectedCorpusHash: corpus.corpusHash,
      expectedCaseIds: corpus.cases.map(item => item.id) });
    if (snapshot.reportSha256 !== reportSha256) throw denied();
    const recorded = await ledger.recordBenchmarkSnapshot({ captureReceipt: captureAuthorization.receipt,
      corpusHash: corpus.corpusHash, reportSha256, snapshotId: snapshot.snapshotId });
    if (recorded?.allowed !== true || !recorded?.receipt) throw denied();
    return Object.freeze({ ...snapshot, ledgerCaptureReceipt: captureAuthorization.receipt,
      ledgerSnapshotReceipt: recorded.receipt });
  } catch { throw denied(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--workspace-root') {
    process.stderr.write('HELDOUT_SNAPSHOT_REQUIRED\n');
    process.exitCode = 1;
  } else {
    captureConfiguredHeldOutResultSnapshot({ workspaceRoot: process.argv[3] }).then(
      result => process.stdout.write(`${JSON.stringify(result)}\n`),
      () => { process.stderr.write('HELDOUT_SNAPSHOT_REQUIRED\n'); process.exitCode = 1; });
  }
}
