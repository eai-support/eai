/**
 * Run the pinned held-out corpus and write receipts in the layout the
 * verifier, snapshot, and signer read. The executor holds no signing key and
 * grants no authority. Dispatch and independent review are injected: a real
 * native dispatch and a real reviewer must be supplied by the trusted caller,
 * so this module cannot fabricate either.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { capabilityReceiptHash } from './gofer-host-capability.mjs';
import { runBenchmark } from './gofer-benchmark.mjs';
import { loadTrustedHeldOutCorpus } from './gofer-trusted-evaluator.mjs';
import { runHeldOutSandboxCheck, snapshotHeldOutWorktree } from './gofer-heldout-verifier.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0;
const sha = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => sha(JSON.stringify(value));
const denied = () => new Error('BENCHMARK_EXECUTOR_REQUIRED');
const ISOLATION = 'git-worktree+local-os-sandbox';
const safeRelative = value => typeof value === 'string' && value.length > 0 &&
  !path.posix.isAbsolute(value) && !value.includes('\\') &&
  !value.split('/').some(part => !part || part === '.' || part === '..');

async function writePrivate(filename, content) {
  const file = await open(filename, constants.O_WRONLY | constants.O_CREAT |
    constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
}

async function materialize(worktree, files) {
  for (const [name, content] of Object.entries(files)) {
    if (!safeRelative(name) || typeof content !== 'string') throw denied();
    const target = path.join(worktree, name);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writePrivate(target, content);
  }
}

/**
 * `dispatchCase({ caseId, run, prompt, allowedWriteScope, worktree })` runs the
 * model against one prepared worktree and returns
 * `{ modelId, costUsd, durationMs, isolation }`. `review({ caseId, run,
 * inputHash, executionReceipt, passed, prompt, worktree, baselineFiles })`
 * returns `{ receipt, approved }` from a party other than the executor. A
 * rejected review fails the case even when the protected check passed. `trustRoot` exists for isolated tests only.
 */
export async function runHeldOutBenchmark({ workspaceRoot, trustRoot, capabilityReceipt,
  modelId, harnessId, dispatchCase, review } = {}) {
  let worktreesRoot;
  try {
    if (!text(workspaceRoot) || !path.isAbsolute(workspaceRoot) || !text(modelId) ||
        !text(harnessId) || capabilityReceipt?.host !== 'codex' ||
        typeof dispatchCase !== 'function' || typeof review !== 'function') throw denied();
    const corpus = await loadTrustedHeldOutCorpus({ workspaceRoot, trustRoot });
    const receipts = path.join(corpus.corpusRoot, 'receipts');
    await mkdir(receipts, { mode: 0o700 });
    worktreesRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gofer-heldout-run-')));
    const receiptHash = capabilityReceiptHash(capabilityReceipt);
    const cases = new Map(corpus.cases.map(item => [item.id, item]));

    const report = await runBenchmark({
      cases: corpus.cases,
      repetitions: 3,
      provenance: { harnessId, modelId, corpusHash: corpus.corpusHash,
        capabilityReceiptHash: receiptHash },
      async execute({ id, run }) {
        const input = cases.get(id).input;
        const worktree = path.join(worktreesRoot, `${id}-${run}`);
        await mkdir(worktree, { mode: 0o700 });
        await materialize(worktree, input.files);
        const result = await dispatchCase({ caseId: id, run, prompt: input.prompt,
          allowedWriteScope: [...input.allowedWriteScope], worktree });
        if (result?.modelId !== modelId || result.isolation !== ISOLATION ||
            !Number.isFinite(result.costUsd) || result.costUsd < 0 ||
            !Number.isFinite(result.durationMs) || result.durationMs < 0) throw denied();
        const payload = { id, run, worktree, native: { isolation: ISOLATION } };
        const receipt = jsonHash(payload);
        await writePrivate(path.join(receipts, `${id}-${run}.execution.json`),
          JSON.stringify({ ...payload, executionReceipt: receipt }));
        return { modelId, costUsd: result.costUsd, durationMs: result.durationMs, receipt };
      },
      async verify({ caseId, run, inputHash, execution }) {
        const input = cases.get(caseId).input;
        const worktree = path.join(worktreesRoot, `${caseId}-${run}`);
        // A worker that touched anything outside its scope fails the case.
        let passed = false;
        let failureClassification = 'none';
        try {
          const before = await snapshotHeldOutWorktree(worktree, input);
          passed = runHeldOutSandboxCheck(worktree);
          const after = await snapshotHeldOutWorktree(worktree, input);
          if (before !== after) { passed = false; failureClassification = 'check-mutated-worktree'; }
          else if (!passed) failureClassification = 'functional-check-failed';
        } catch { passed = false; failureClassification = 'scope-violation'; }
        const reviewed = await review({ caseId, run, inputHash,
          executionReceipt: execution.receipt, passed, prompt: input.prompt, worktree,
          baselineFiles: { ...input.files } });
        if (!/^[a-f0-9]{64}$/.test(reviewed?.receipt ?? '') ||
            typeof reviewed.approved !== 'boolean') throw denied();
        if (passed && !reviewed.approved) { passed = false; failureClassification = 'review-rejected'; }
        // The verification receipt binds the final verdict, review included.
        const receipt = jsonHash({ caseId, run, inputHash, executionReceipt: execution.receipt,
          passed, kind: 'verification' });
        await writePrivate(path.join(receipts, `${caseId}-${run}.verification.json`),
          JSON.stringify({ caseId, run, inputHash, executionReceipt: execution.receipt,
            receipt, passed }));
        return { caseId, run, inputHash, executionReceipt: execution.receipt, passed, receipt,
          verifierId: 'gofer-heldout-sandbox-check', failureClassification,
          reviewReceipt: reviewed.receipt };
      },
    });
    await writePrivate(path.join(receipts, 'benchmark-report.json'),
      JSON.stringify({ corpusHash: corpus.corpusHash, report }));
    const leftover = worktreesRoot;
    worktreesRoot = undefined;
    return Object.freeze({ report, corpusHash: corpus.corpusHash, corpusRoot: corpus.corpusRoot,
      worktreesRoot: leftover });
  } catch { throw denied(); }
  finally { if (worktreesRoot) await rm(worktreesRoot, { recursive: true, force: true }); }
}
