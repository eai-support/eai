/** Recheck retained held-out runs outside the benchmark executor process.
 * This diagnostic cannot issue a trusted benchmark attestation. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHeldOutCorpus } from './gofer-heldout-corpus.mjs';
import { loadTrustedHeldOutCorpus } from './gofer-trusted-evaluator.mjs';
import { inspectHeldOutResultSnapshot, loadPinnedHeldOutSnapshot,
  materializeHeldOutResultSnapshot } from './gofer-heldout-snapshot.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const denied = () => new Error('HELDOUT_VERIFIER_REQUIRED');
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const safeName = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
const safeRelative = value => typeof value === 'string' && value.length > 0 &&
  !path.posix.isAbsolute(value) && !value.includes('\\') &&
  !value.split('/').some(segment => !segment || segment === '.' || segment === '..');
const safeScope = value => safeRelative(typeof value === 'string' ? value.replace(/\/$/, '') : value);
const allowed = (file, scopes) => scopes.some(scope =>
  file === scope.replace(/\/$/, '') || file.startsWith(scope.endsWith('/') ? scope : `${scope}/`));

async function readRegular(filePath, maxBytes) {
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size < 1 || info.size > maxBytes) throw denied();
    return await handle.readFile();
  } finally { await handle.close(); }
}

async function readJson(filePath, maxBytes = 2 * 1024 * 1024) {
  return JSON.parse((await readRegular(filePath, maxBytes)).toString('utf8'));
}

async function snapshot(worktree, input) {
  const sourceFiles = input?.files;
  const scopes = input?.allowedWriteScope;
  if (!sourceFiles || typeof sourceFiles !== 'object' || Array.isArray(sourceFiles) ||
      !Array.isArray(scopes) || !scopes.length || !scopes.every(safeScope) ||
      !Object.keys(sourceFiles).every(safeRelative) ||
      !Object.hasOwn(sourceFiles, 'verify.mjs') || allowed('verify.mjs', scopes)) throw denied();
  const found = new Map();
  const pending = [''];
  let totalBytes = 0;
  while (pending.length) {
    const relative = pending.pop();
    const directory = await opendir(path.join(worktree, relative));
    for await (const entry of directory) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (name === '.git') continue;
      if (!safeRelative(name)) throw denied();
      const entryPath = path.join(worktree, name);
      const info = await lstat(entryPath);
      if (info.isDirectory()) { pending.push(name); continue; }
      if (!info.isFile() || info.nlink !== 1 || found.size >= 5000) throw denied();
      const bytes = await readRegular(entryPath, 2 * 1024 * 1024);
      totalBytes += bytes.length;
      if (totalBytes > 16 * 1024 * 1024 ||
          (!Object.hasOwn(sourceFiles, name) && !allowed(name, scopes)) ||
          (Object.hasOwn(sourceFiles, name) && !allowed(name, scopes) &&
            bytes.toString('utf8') !== sourceFiles[name])) throw denied();
      found.set(name, sha(bytes));
    }
  }
  if (Object.keys(sourceFiles).some(name => !found.has(name) && !allowed(name, scopes))) throw denied();
  return sha(JSON.stringify([...found].sort(([left], [right]) => left.localeCompare(right))));
}

function runSandboxCheck(worktree) {
  if (inside('/Users', path.resolve(process.execPath))) throw denied();
  const profile = '(version 1) (allow default) (deny network*) (deny file-write*) '
    + '(deny file-read* (subpath "/Users") (subpath "/Volumes"))';
  const result = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, 'verify.mjs'], {
    cwd: worktree, encoding: 'utf8', timeout: 20000, maxBuffer: 65536,
    env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin', HOME: '/nonexistent', NODE_OPTIONS: '' },
  });
  if (result.error || result.signal || !Number.isInteger(result.status) ||
      /EPERM|operation not permitted|sandbox-exec:/i.test(result.stderr ?? '')) throw denied();
  return result.status === 0;
}

// Shared with the benchmark executor so both use the same sandbox and scope rules.
export { runSandboxCheck as runHeldOutSandboxCheck, snapshot as snapshotHeldOutWorktree };

/** The report and receipts may be mutable. Only the fresh sandbox result is
 * authoritative for this diagnostic; the output is never routing authority. */
export async function recheckHeldOutBenchmark({ corpusRoot, workspaceRoot,
  receiptsRoot, worktreesRoot } = {}) {
  if (process.platform !== 'darwin' || !path.isAbsolute(corpusRoot ?? '') ||
      !path.isAbsolute(workspaceRoot ?? '')) throw denied();
  try {
    const corpus = await loadHeldOutCorpus({ corpusRoot, workspaceRoot });
    const root = await realpath(corpusRoot);
    const workspace = await realpath(workspaceRoot);
    const temporary = await realpath(os.tmpdir());
    const receipts = receiptsRoot ? await realpath(receiptsRoot) : path.join(root, 'receipts');
    const saved = await readJson(path.join(receipts, 'benchmark-report.json'));
    const report = saved?.report;
    if (saved.corpusHash !== corpus.corpusHash || report?.schemaVersion !== 2 ||
        report.repetitions !== 3 || report.caseCount !== corpus.cases.length ||
        !Array.isArray(report.runs) || report.runs.length !== corpus.cases.length * 3 ||
        report.provenance?.corpusHash !== corpus.corpusHash) throw denied();
    const cases = new Map(corpus.cases.map(item => [item.id, item]));
    const seen = new Set();
    const worktrees = new Set();
    const executions = new Set();
    const verifications = new Set();
    const checks = [];
    let costUsd = 0;
    let durationMs = 0;
    for (const run of report.runs) {
      if (!safeName(run?.caseId) || ![1, 2, 3].includes(run.run) ||
          !cases.has(run.caseId) || seen.has(`${run.caseId}:${run.run}`)) throw denied();
      seen.add(`${run.caseId}:${run.run}`);
      const benchmarkCase = cases.get(run.caseId);
      if (run.modelId !== report.provenance?.modelId) throw denied();
      if (run.inputHash !== sha(JSON.stringify({ caseId: run.caseId, input: benchmarkCase.input }))) throw denied();
      const label = `${run.caseId}-${run.run}`;
      const execution = await readJson(path.join(receipts, `${label}.execution.json`));
      const verification = await readJson(path.join(receipts, `${label}.verification.json`));
      const { executionReceipt, ...payload } = execution;
      if (sha(JSON.stringify(payload)) !== executionReceipt || executionReceipt !== run.receipt ||
          execution.id !== run.caseId || execution.run !== run.run ||
          verification.caseId !== run.caseId || verification.run !== run.run ||
          verification.inputHash !== run.inputHash ||
          verification.executionReceipt !== run.receipt ||
          verification.receipt !== run.verifierReceipt ||
          verification.passed !== run.functionalVerified ||
          execution.native?.isolation !== 'git-worktree+local-os-sandbox') throw denied();
      if (!path.isAbsolute(execution.worktree ?? '')) throw denied();
      const worktree = await realpath(worktreesRoot ? path.join(worktreesRoot, label) : execution.worktree);
      const info = await lstat(worktree);
      if (!inside(temporary, worktree) || inside(workspace, worktree) || inside(root, worktree) ||
          !info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0 ||
          worktrees.has(worktree) || executions.has(executionReceipt) ||
          verifications.has(verification.receipt) ||
          !Number.isFinite(run.costUsd) || run.costUsd < 0 ||
          !Number.isFinite(run.durationMs) || run.durationMs < 0) throw denied();
      worktrees.add(worktree);
      executions.add(executionReceipt);
      verifications.add(verification.receipt);
      costUsd += run.costUsd;
      durationMs += run.durationMs;
      const before = await snapshot(worktree, benchmarkCase.input);
      const passed = runSandboxCheck(worktree);
      const after = await snapshot(worktree, benchmarkCase.input);
      if (before !== after || passed !== run.functionalVerified) throw denied();
      checks.push(Object.freeze({ caseId: run.caseId, run: run.run, passed,
        executionReceipt, verifierReceipt: verification.receipt, snapshotHash: after }));
    }
    const functionalPasses = checks.filter(item => item.passed).length;
    if (report.functionalPasses !== functionalPasses || report.functionalRuns !== checks.length ||
        report.status !== (functionalPasses === checks.length ? 'pass' : 'fail') ||
        Math.abs(report.reliability - functionalPasses / checks.length) > 1e-12 ||
        Math.abs(report.costUsd - costUsd) > 1e-9 || report.durationMs !== durationMs) throw denied();
    return Object.freeze({ schemaVersion: 1, authority: 'diagnostic-only',
      corpusHash: corpus.corpusHash, reportHash: sha(JSON.stringify(report)),
      checks: Object.freeze(checks), functionalPasses,
      functionalRuns: checks.length });
  } catch { throw denied(); }
}

/** Recheck only the captured bytes. The original worktrees may have changed
 * or disappeared; their retained receipt paths are never executed. */
export async function recheckHeldOutSnapshot({ corpusRoot, workspaceRoot, trustRoot, snapshotId } = {}) {
  let materialized;
  try {
    const before = await inspectHeldOutResultSnapshot({ trustRoot, workspaceRoot, snapshotId });
    const corpus = await loadHeldOutCorpus({ corpusRoot, workspaceRoot });
    if (before.corpusHash !== corpus.corpusHash) throw denied();
    materialized = await materializeHeldOutResultSnapshot({ trustRoot, workspaceRoot, snapshotId });
    const result = await recheckHeldOutBenchmark({ corpusRoot, workspaceRoot,
      receiptsRoot: path.join(materialized.root, 'receipts'),
      worktreesRoot: path.join(materialized.root, 'worktrees') });
    const after = await inspectHeldOutResultSnapshot({ trustRoot, workspaceRoot, snapshotId });
    if (before.reportSha256 !== after.reportSha256 || before.snapshotId !== after.snapshotId) throw denied();
    return Object.freeze({ ...result, snapshotId, source: 'protected-snapshot' });
  } catch { throw denied(); }
  finally { if (materialized) await rm(materialized.root, { recursive: true, force: true }); }
}

/** Production entrypoint: the account trust root chooses the corpus. */
export async function recheckConfiguredHeldOutBenchmark({ workspaceRoot } = {}) {
  try {
    const corpus = await loadTrustedHeldOutCorpus({ workspaceRoot });
    const trustRoot = path.dirname(path.dirname(corpus.corpusRoot));
    const snapshot = await loadPinnedHeldOutSnapshot({ trustRoot, workspaceRoot,
      corpusHash: corpus.corpusHash });
    return await recheckHeldOutSnapshot({ corpusRoot: corpus.corpusRoot, workspaceRoot,
      trustRoot, snapshotId: snapshot.snapshotId });
  } catch { throw denied(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workspaceFlag = process.argv.indexOf('--workspace-root');
  if (workspaceFlag !== 2 || process.argv.length !== 4) {
    process.stderr.write('HELDOUT_VERIFIER_REQUIRED\n');
    process.exitCode = 1;
  } else {
    recheckConfiguredHeldOutBenchmark({ workspaceRoot: process.argv[workspaceFlag + 1] }).then(
      result => process.stdout.write(`${JSON.stringify(result)}\n`),
      () => { process.stderr.write('HELDOUT_VERIFIER_REQUIRED\n'); process.exitCode = 1; });
  }
}
