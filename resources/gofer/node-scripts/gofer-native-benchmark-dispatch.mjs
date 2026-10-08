/**
 * Native dispatch for held-out benchmark cases. Each case runs through the same
 * ledger-bound Codex executor as production tasks: reserve, lease, authorize,
 * native authorize, local OS sandbox, scope and git checks.
 *
 * A benchmark cannot use the normal routing gate, because that gate needs the
 * benchmark result these runs produce. Authority here comes from a dedicated
 * ledger, an explicit user approval receipt, a fixed model, and a hard spend
 * cap. The bootstrap benchmark receipt used here cannot satisfy
 * `verifyTrustedBenchmarkEvidence`, so it never becomes routing authority.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { capabilityReceiptHash } from './gofer-host-capability.mjs';
import { createLedgerBoundCodexExecutor, startLocalCodexInvocation } from './gofer-native-adapter.mjs';
import { createRuntimeLedger } from './gofer-runtime-ledger.mjs';

const run = promisify(execFile);
const text = value => typeof value === 'string' && value.trim().length > 0;
const rate = value => Number.isFinite(value) && value >= 0;
const sha = value => createHash('sha256').update(value).digest('hex');
const denied = code => new Error(code);
const ISOLATION = 'git-worktree+local-os-sandbox';
const gitEnvironment = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !key.startsWith('GIT_') || key.startsWith('GIT_CONFIG_')));

async function git(directory, args) {
  return run('git', ['-C', directory, '-c', 'user.name=gofer-benchmark',
    '-c', 'user.email=benchmark@gofer.invalid', '-c', 'commit.gpgsign=false', ...args],
  { encoding: 'utf8', env: gitEnvironment, timeout: 30000 });
}

/** List-price cost from reported token usage. Cached input is charged at its
 * own rate only when one is given; otherwise at the full input rate. */
export function priceUsage(usage, rateCard) {
  if (![usage?.inputTokens, usage?.cachedInputTokens, usage?.outputTokens]
    .every(value => Number.isInteger(value) && value >= 0) ||
      usage.cachedInputTokens > usage.inputTokens ||
      !rate(rateCard?.inputUsdPerMillion) || !rate(rateCard?.outputUsdPerMillion) ||
      (rateCard.cachedInputUsdPerMillion !== undefined && !rate(rateCard.cachedInputUsdPerMillion))) {
    throw denied('BENCHMARK_USAGE_REQUIRED');
  }
  const cachedRate = rateCard.cachedInputUsdPerMillion ?? rateCard.inputUsdPerMillion;
  const uncached = usage.inputTokens - usage.cachedInputTokens;
  return (uncached * rateCard.inputUsdPerMillion + usage.cachedInputTokens * cachedRate +
    usage.outputTokens * rateCard.outputUsdPerMillion) / 1_000_000;
}

/** One cap shared by every dispatcher of a benchmark, workers and reviewers. */
export function createSpendCap(maxTotalCostUsd) {
  if (!(maxTotalCostUsd > 0)) throw denied('NATIVE_BENCHMARK_DISPATCH_REQUIRED');
  return { spentUsd: 0, maxTotalCostUsd };
}

/**
 * `command` must be the pinned, absolute native executable, never a PATH
 * lookup. `maxRunCostUsd` bounds one run; `maxTotalCostUsd` bounds the whole
 * benchmark and is checked before every launch. A run that cannot be metered,
 * or that times out, is charged at `maxRunCostUsd` so the cap cannot be beaten.
 */
export async function createNativeBenchmarkDispatch({ ledgerPath, capabilityReceipt,
  capabilityPublicKey, requiredCapabilities, modelId, approvalReceipt, command, rateCard,
  maxRunCostUsd, spend, taskPrefix = 'benchmark', scratchRoot = os.tmpdir(), timeoutMs = 600_000,
  start = startLocalCodexInvocation, createLedger = createRuntimeLedger } = {}) {
  if (!text(ledgerPath) || !path.isAbsolute(ledgerPath) || !text(modelId) ||
      !text(approvalReceipt) || !text(command) || !path.isAbsolute(command) ||
      capabilityReceipt?.host !== 'codex' || capabilityReceipt.isolationClass !== ISOLATION ||
      !Array.isArray(capabilityReceipt.models) || !capabilityReceipt.models.some(model => model?.id === modelId) ||
      !capabilityPublicKey || !rate(rateCard?.inputUsdPerMillion) ||
      !rate(rateCard?.outputUsdPerMillion) || !(maxRunCostUsd > 0) ||
      !(spend?.maxTotalCostUsd >= maxRunCostUsd) || !/^[a-z]{3,16}$/.test(taskPrefix) ||
      !text(scratchRoot) || !path.isAbsolute(scratchRoot) || !Number.isFinite(spend.spentUsd) || !Number.isInteger(timeoutMs) || timeoutMs < 1 ||
      typeof start !== 'function') throw denied('NATIVE_BENCHMARK_DISPATCH_REQUIRED');
  const ledger = await createLedger({ ledgerPath });
  const receiptHash = capabilityReceiptHash(capabilityReceipt);

  return async function dispatchCase({ caseId, run: runNumber, prompt, allowedWriteScope, worktree }) {
    if (!text(caseId) || !Number.isInteger(runNumber) || !text(prompt) || !text(worktree) ||
        !path.isAbsolute(worktree) || !Array.isArray(allowedWriteScope) ||
        !allowedWriteScope.length) throw denied('NATIVE_BENCHMARK_DISPATCH_REQUIRED');
    // Checked before any process starts, so the cap cannot be exceeded.
    if (spend.spentUsd + maxRunCostUsd > spend.maxTotalCostUsd) throw denied('BENCHMARK_SPEND_CAP_REACHED');

    // The qualified sandbox needs a linked worktree whose shared git store lies
    // outside the workspace. Build a scratch base repository from the prepared
    // files, then check the case out into `worktree` as a linked worktree.
    const base = await realpath(await mkdtemp(path.join(scratchRoot, 'gofer-benchmark-base-')));
    try {
      await cp(worktree, base, { recursive: true });
      await git(base, ['init', '-q', '-b', 'main']);
      await git(base, ['add', '-A']);
      await git(base, ['commit', '-q', '-m', 'baseline']);
      const head = (await git(base, ['rev-parse', 'HEAD'])).stdout.trim();
      for (const name of await readdir(worktree)) {
        await rm(path.join(worktree, name), { recursive: true, force: true });
      }
      await git(base, ['worktree', 'add', '-q', '--detach', worktree, head]);

      const worktreeReceipt = sha(JSON.stringify({ worktree, head }));
      const taskId = `${taskPrefix}:${caseId}:${runNumber}`;
      const task = { taskId, revision: head, attempt: 1, dependencies: [],
        worktreeReceipt, allowedEditScope: [...allowedWriteScope],
        requiredChecks: ['protected-verify'], capabilityReceiptHash: receiptHash,
        approvalReceipt, selectedModel: modelId,
        benchmarkReceipt: `bootstrap-${taskPrefix}:${sha(approvalReceipt).slice(0, 24)}` };
      const reserved = await ledger.reserve(task);
      const leased = reserved?.allowed === true ? await ledger.lease(task) : null;
      if (leased?.allowed !== true) throw denied('NATIVE_BENCHMARK_LEDGER_DENIED');
      const authority = await ledger.authorize({ ...task, leaseId: leased.leaseId,
        budgetReservation: leased.budgetReservation });
      if (authority?.allowed !== true) throw denied('NATIVE_BENCHMARK_LEDGER_DENIED');

      let launched = false;
      const executor = createLedgerBoundCodexExecutor({ isolatedWorkspace: worktree,
        worktreeReceipt, expectedHead: head, capabilityReceipt, capabilityPublicKey,
        requiredCapabilities, assertLedger: request => ledger.authorizeNative(request),
        promptForRequest: () => prompt,
        start: request => { launched = true; return start({ ...request, command }); } });
      const startedAt = Date.now();
      let result;
      try {
        result = await executor.execute({ revision: head, taskId, attempt: 1, dependencies: [],
          ledgerAuthorityReceipt: authority.receipt, selectedModel: modelId,
          allowedEditScope: [...allowedWriteScope], worktreeReceipt, leaseId: leased.leaseId,
          budgetReservation: leased.budgetReservation, approvalReceipt, usageReporting: true,
          signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        // An unmetered or interrupted run is charged in full.
        if (launched) spend.spentUsd += maxRunCostUsd;
        throw error;
      }
      let costUsd;
      try { costUsd = priceUsage(result.usage, rateCard); }
      catch (error) { spend.spentUsd += maxRunCostUsd; throw error; }
      spend.spentUsd += costUsd;
      if (costUsd > maxRunCostUsd) throw denied('BENCHMARK_RUN_COST_EXCEEDED');
      return { modelId, costUsd, durationMs: Date.now() - startedAt, isolation: result.isolation,
        receipt: result.receipt };
    } finally { await rm(base, { recursive: true, force: true }); }
  };
}
