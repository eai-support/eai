/**
 * Host-neutral execution kernel. Adapters are trusted application code, never
 * commands or capability declarations received from a worker or a document.
 */
import { constants } from 'node:fs';
import { open, readFile, realpath, lstat, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { reviewPriority } from './gofer-priority-check.mjs';
import { inspectBlockers } from './gofer-blocker-control.mjs';
import { capabilityReceiptHash, verifyCapabilityReceipt } from './gofer-host-capability.mjs';
import { selectCapabilityRoute } from './gofer-live-routing.mjs';
import { acquireLedgerLock } from './gofer-runtime-ledger.mjs';

const contractFiles = ['spec.md', 'plan.md', 'decisions.md', 'priority-plan.json', 'loop-contract.json'];
const MAX_CONTRACT_FILE_BYTES = 1024 * 1024;
const positive = value => Number.isSafeInteger(value) && value > 0;
const text = value => typeof value === 'string' && value.trim().length > 0;
function releaseResumeLock(lock) {
  try { lock.exec('ROLLBACK'); } finally { lock.close(); }
}

export async function executionRevision(featureDir) {
  return (await snapshot(featureDir)).revision;
}

async function snapshot(featureDir) {
  const hash = createHash('sha256');
  const files = {};
  for (const file of contractFiles) {
    files[file] = await readContractFile(featureDir, file);
    hash.update(file).update(files[file]);
  }
  return { files, revision: hash.digest('hex') };
}

async function readContractFile(featureDir, name) {
  const root = await realpath(featureDir);
  const target = path.join(root, name);
  // Resolve before opening. A different canonical path proves a supplied link.
  const canonical = await realpath(target);
  if (canonical !== target) throw new Error('UNSAFE_CONTRACT_FILE');
  // Do not follow a link introduced after canonical-path validation on POSIX.
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
  const file = await open(canonical, flags);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_CONTRACT_FILE_BYTES) throw new Error('UNSAFE_CONTRACT_FILE');
    return await file.readFile({ encoding: 'utf8' });
  } finally {
    await file.close();
  }
}

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

async function canonicalScopes(workspace, scopes) {
  const root = await realpath(workspace);
  return Promise.all(scopes.map(async scope => {
    const segments = scope.replace(/\/$/, '').split('/');
    let current = root;
    for (const segment of segments) {
      current = path.join(current, segment);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('SYMLINK_SCOPE_UNQUALIFIED'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return path.relative(root, current).split(path.sep).join('/');
  }));
}

export function validateWorkGraph(plan, checks) {
  if (![1, 2].includes(plan?.schemaVersion) || !text(plan.revision) || !plan.tasks ||
      !Array.isArray(plan.criticalPath) || !plan.criticalPath.length) throw new Error('INVALID_GRAPH');
  const ids = Object.keys(plan.tasks);
  if (!ids.length || ids.length > 1000 || new Set(plan.criticalPath).size !== plan.criticalPath.length ||
      plan.criticalPath.some(id => !ids.includes(id))) throw new Error('INVALID_GRAPH');
  let edgeCount = 0;
  let scopeCount = 0;
  for (const id of ids) {
    const task = plan.tasks[id];
    if (!/^T\d+$/.test(id) || !task || !Array.isArray(task.dependsOn) ||
        task.dependsOn.length > 256 || task.dependsOn.some(dep => !ids.includes(dep)) || !Array.isArray(task.allowedEditScope) ||
        task.allowedEditScope.length > 256 ||
        task.allowedEditScope.some(scope => !text(scope) || /(^\/|\/\/|\\|:|\0|[*?\[\]]|(^|\/)\.\.?($|\/))/.test(scope)) ||
        !Array.isArray(checks[id]) || !checks[id].length || checks[id].length > 256 || checks[id].some(c => !text(c) || c.length > 1024) ||
        new Set(checks[id]).size !== checks[id].length) throw new Error('INVALID_WORK_ORDER');
    edgeCount += task.dependsOn.length;
    scopeCount += task.allowedEditScope.length;
    if (edgeCount > 10000 || scopeCount > 10000) throw new Error('INVALID_WORK_ORDER');
  }
  const states = new Map(ids.map(id => [id, 0]));
  const visit = id => {
    const state = states.get(id);
    if (state === 1) throw new Error('CYCLIC_GRAPH');
    if (state === 2) return;
    states.set(id, 1);
    for (const dependency of plan.tasks[id].dependsOn) visit(dependency);
    states.set(id, 2);
  };
  ids.forEach(visit);
  return ids;
}

function overlaps(a, b) {
  // Conservative on case-insensitive hosts and on parent/child directory edits.
  return a.some(left => b.some(right => {
    const x = left.toLowerCase().replace(/\/$/, '');
    const y = right.toLowerCase().replace(/\/$/, '');
    return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
  }));
}

/**
 * Run a trusted adapter against the existing priority plan. Each required check
 * runs separately from worker output. This library does not provide a sandbox.
 * An existing journal is a reconciliation gate, not permission to replay work.
 */
export async function runVerifiedGraph({ featureDir, workspaceRoot, checks, adapter,
  ledger, capabilityReceipt, capabilityPublicKey, requiredCapabilities, benchmarkEvidence, verifyBenchmark,
  advisoryConstraints, approvalReceipt, maxCalls, maxConcurrent = 1, deadlineMs, signal, recovery,
  adapterDrainMs = 5000 }) {
  // Copy before any await: a caller or worker must not remove required checks.
  checks = freeze(structuredClone(checks));
  const journalName = 'verified-execution.jsonl';
  if (!positive(maxCalls) || !positive(maxConcurrent) || maxConcurrent > 8 ||
      !positive(adapterDrainMs) || adapterDrainMs > 10000 ||
      !Number.isFinite(deadlineMs) || deadlineMs <= Date.now()) throw new Error('FINITE_LIMITS_REQUIRED');
  if (!text(approvalReceipt)) throw new Error('APPROVAL_RECEIPT_REQUIRED');
  for (const method of ['execute', 'check', 'inputRevision', 'reserve', 'lease', 'verified']) {
    if (typeof adapter?.[method] !== 'function') throw new Error(`TRUSTED_ADAPTER_REQUIRED:${method}`);
  }
  if (capabilityReceipt?.isolationClass !== 'git-worktree+local-os-sandbox' ||
      typeof ledger?.authorize !== 'function' || typeof ledger?.authorizeCommit !== 'function' || !verifyCapabilityReceipt(capabilityReceipt, {
    publicKey: capabilityPublicKey, requiredCapabilities,
  })) throw new Error('LEDGER_CAPABILITY_AUTHORITY_REQUIRED');
  const route = await selectCapabilityRoute({ receipt: capabilityReceipt, publicKey: capabilityPublicKey,
    host: capabilityReceipt.host, requiredCapabilities, benchmarkEvidence, verifyBenchmark, advisoryConstraints });
  const root = await realpath(featureDir);
  const captured = await snapshot(root);
  const plan = freeze(JSON.parse(captured.files['priority-plan.json']));
  const loop = freeze(JSON.parse(captured.files['loop-contract.json']));
  if (!positive(loop.maxIterations)) throw new Error('FINITE_ATTEMPTS_REQUIRED');
  if (loop.budget?.maxModelSpendUsd != null) throw new Error('SPEND_RESERVATION_NOT_IMPLEMENTED');
  if (loop.budget?.maxWallClockMinutes != null) {
    if (!(loop.budget.maxWallClockMinutes > 0)) throw new Error('INVALID_DEADLINE');
    deadlineMs = Math.min(deadlineMs, Date.now() + loop.budget.maxWallClockMinutes * 60000);
  }
  const ids = validateWorkGraph(plan, checks);
  const initial = await reviewPriority(root);
  if (initial.status !== 'pass') throw new Error(`PRIORITY_BLOCKED:${initial.findings.join(',')}`);
  const revision = captured.revision;
  const receiptHash = capabilityReceiptHash(capabilityReceipt);
  if (await executionRevision(root) !== revision) throw new Error('STALE_DIRECTION');
  const tasksText = await readFile(path.join(root, 'tasks.md'), 'utf8');
  const previouslyComplete = new Set([...tasksText.matchAll(/^\s*-\s+\[[xX]\]\s+(?:\*\*)?(T\d+)\b/gm)].map(m => m[1]));
  const scopes = {};
  for (const id of ids) scopes[id] = await canonicalScopes(workspaceRoot, plan.tasks[id].allowedEditScope);
  let resumeReport;
  let resumeLock;
  const lockPath = path.join(root, 'verified-execution.resume.lock');
  if (recovery) {
    // The transaction excludes other controllers and the operating system
    // releases it if this controller exits before reconciliation finishes.
    resumeLock = await acquireLedgerLock(lockPath).catch(() => { throw new Error('RESUME_LOCKED'); });
    try {
      const { inspectExecutionRecovery } = await import('./gofer-execution-recovery.mjs');
      resumeReport = await inspectExecutionRecovery({ ...recovery, featureDir: root });
      const run = resumeReport.run;
      if (resumeReport.status !== 'reconciled' || !resumeReport.resumeAllowed ||
          resumeReport.uncertainTasks.length || !run ||
          run.revision !== revision || run.maxCalls !== maxCalls || run.maxConcurrent !== maxConcurrent ||
          run.maxIterations !== loop.maxIterations || deadlineMs !== run.deadlineMs ||
          run.capabilityReceiptHash !== receiptHash || run.selectedModel !== route.model.id ||
          run.benchmarkReceipt !== route.benchmarkReceipt || run.approvalReceipt !== approvalReceipt ||
          JSON.stringify(run.requiredChecks) !== JSON.stringify(checks) ||
          (resumeReport.restartableTasks.length > 0 &&
            (resumeReport.restartableTasks.length !== 1 ||
              resumeReport.replacementWorktreeReceipt !== adapter.worktreeReceipt)) ||
          previouslyComplete.size !== resumeReport.reusableTasks.length ||
          [...previouslyComplete].some(id => !resumeReport.reusableTasks.includes(id)) ||
          resumeReport.reusableTasks.length === ids.length) throw new Error('RESUME_RECONCILIATION_REQUIRED');
      for (const taskId of resumeReport.reusableTasks) {
        const input = await adapter.inputRevision({ taskId, revision,
          allowedEditScope: plan.tasks[taskId].allowedEditScope, requiredChecks: checks[taskId] });
        if (input !== resumeReport.verifiedInputs[taskId]) throw new Error('STALE_PREREQUISITE_EVIDENCE');
      }
    } catch (error) {
      releaseResumeLock(resumeLock);
      throw error;
    }
  } else if (previouslyComplete.size) throw new Error('BASELINE_EVIDENCE_RECONCILIATION_REQUIRED');
  const states = Object.fromEntries(ids.map(id => [id, resumeReport?.reusableTasks.includes(id) ? 'verified' : 'pending']));
  const attempts = Object.fromEntries(ids.map(id => [id, resumeReport?.attemptsConsumed[id] || 0]));
  const verifiedInputs = new Map(Object.entries(resumeReport?.verifiedInputs || {}));
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('CANCELLED'));
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('DEADLINE')), Math.min(deadlineMs - Date.now(), 2147483647));
  const file = await open(path.join(root, journalName), recovery ? constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW : 'wx', 0o600).catch(async error => {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    if (resumeLock) releaseResumeLock(resumeLock);
    throw new Error(error.code === 'EEXIST' ? 'RECONCILIATION_REQUIRED' : 'JOURNAL_UNAVAILABLE');
  });
  let calls = resumeReport?.callsConsumed || 0;
  let write = Promise.resolve();
  let checkpointWrite = Promise.resolve();
  let checkpointSequence = 0;
  const pendingAdapterCalls = new Set();
  let drainAttempted = false;
  async function drainAdapterCalls() {
    drainAttempted = true;
    if (!pendingAdapterCalls.size) return true;
    let drainTimer;
    const settled = await Promise.race([
      Promise.allSettled([...pendingAdapterCalls]).then(() => true),
      new Promise(resolve => { drainTimer = setTimeout(() => resolve(false), adapterDrainMs); }),
    ]);
    clearTimeout(drainTimer);
    return settled;
  }
  const record = event => {
    write = write.then(async () => { await file.writeFile(`${JSON.stringify({ schemaVersion: 1, revision, time: new Date().toISOString(), ...event })}\n`); await file.sync(); })
      .catch(() => { controller.abort(new Error('JOURNAL_FAILURE')); throw new Error('JOURNAL_FAILURE'); });
    return write;
  };
  const abortCheck = () => {
    if (Date.now() >= deadlineMs && !controller.signal.aborted) controller.abort(new Error('DEADLINE'));
    if (controller.signal.aborted) throw controller.signal.reason;
  };
  // The checkpoint contains only current graph state plus the latest delta.
  // It avoids replaying the entire append-only ledger during operator recovery.
  async function checkpoint(event, taskId = null) {
    // Serialize snapshots so concurrent tasks cannot race the replacement file.
    checkpointWrite = checkpointWrite.then(async () => {
      const payload = JSON.stringify({ schemaVersion: 1, revision, updatedAt: new Date().toISOString(),
        delta: { event, taskId }, states, attempts, calls,
        verifiedInputs: Object.fromEntries(verifiedInputs) });
      const target = path.join(root, 'verified-execution.checkpoint.json');
      const temporary = `${target}.${process.pid}.${++checkpointSequence}.tmp`;
      try {
        await writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temporary, target);
      } catch {
        controller.abort(new Error('CHECKPOINT_UNAVAILABLE'));
        throw controller.signal.reason;
      }
    });
    return checkpointWrite;
  }
  async function current() {
    abortCheck();
    if (await executionRevision(root) !== revision) {
      controller.abort(new Error('STALE_DIRECTION'));
      throw controller.signal.reason;
    }
    abortCheck();
  }
  async function invoke(method, request) {
    await current();
    const blockers = await inspectBlockers(root, { taskId: request.taskId });
    if (blockers.blockers.some(b => b.state !== 'ready')) throw new Error('RECORDED_BLOCKER_WAIT');
    if (calls >= maxCalls) throw new Error('CALL_LIMIT');
    // Reserve globally before yielding, so parallel calls cannot overdraw.
    calls++;
    await record({ event: 'call_reserved', task: request.taskId, method, call: calls });
    let listener;
    try {
      await current();
      const operation = Promise.resolve().then(() => { abortCheck(); return adapter[method]({ ...request, signal: controller.signal }); });
      const settled = operation.then(() => {}, () => {}).finally(() => pendingAdapterCalls.delete(settled));
      pendingAdapterCalls.add(settled);
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          listener = () => reject(controller.signal.reason);
          controller.signal.addEventListener('abort', listener, { once: true });
          if (controller.signal.aborted) listener();
        }),
      ]);
    } finally {
      if (listener) controller.signal.removeEventListener('abort', listener);
    }
  }
  async function runTask(taskId) {
    const task = plan.tasks[taskId];
    const dependencies = task.dependsOn.map(dependency => ({ taskId: dependency,
      inputRevision: verifiedInputs.get(dependency) ?? null }));
    if (dependencies.some(dependency => !text(dependency.inputRevision))) throw new Error('DEPENDENCY_INPUT_REQUIRED');
    const request = { taskId, revision, dependencies, allowedEditScope: task.allowedEditScope, requiredChecks: checks[taskId], approvalReceipt,
      ...(text(adapter.worktreeReceipt) ? { worktreeReceipt: adapter.worktreeReceipt } : {}),
      capabilityReceiptHash: receiptHash, selectedModel: route.model.id, benchmarkReceipt: route.benchmarkReceipt };
    let previousChecks = [];
    try {
      while (attempts[taskId] < loop.maxIterations) {
        await current();
        const blockers = await inspectBlockers(root, { taskId });
        if (blockers.blockers.some(b => b.state !== 'ready')) throw new Error('RECORDED_BLOCKER_WAIT');
        const priority = await reviewPriority(root, { task: taskId });
        if (priority.status !== 'pass') throw new Error('PRIORITY_BLOCKED');
        await canonicalScopes(workspaceRoot, task.allowedEditScope);
        const attempt = ++attempts[taskId];
        await record({ event: 'attempt_reserved', task: taskId, attempt });
        const reservation = await invoke('reserve', { ...request, attempt });
        if (reservation?.allowed !== true || !text(reservation.budgetReservation)) throw new Error('BLOCKER_OR_BUDGET_DENIED');
        const lease = await invoke('lease', { ...request, attempt });
        const leaseExpiry = Date.parse(lease?.expiresAt);
        if (!text(lease?.leaseId) || !Number.isFinite(leaseExpiry) || leaseExpiry <= Date.now()) {
          throw new Error('TASK_LEASE_REQUIRED');
        }
        await record({ event: 'lease_granted', task: taskId, attempt, leaseId: lease.leaseId, expiresAt: lease.expiresAt });
        const leasedRequest = { ...request, attempt, budgetReservation: reservation.budgetReservation,
          leaseId: lease.leaseId, leaseExpiresAt: lease.expiresAt };
        const authority = await ledger.authorize(leasedRequest);
        if (authority?.allowed !== true || authority.taskId !== taskId || authority.revision !== revision ||
            authority.attempt !== attempt || authority.capabilityReceiptHash !== receiptHash ||
            authority.budgetReservation !== reservation.budgetReservation || authority.leaseId !== lease.leaseId ||
            authority.worktreeReceipt !== request.worktreeReceipt ||
            authority.leaseExpiresAt !== lease.expiresAt || authority.allowedEditScope?.join('\0') !== request.allowedEditScope.join('\0') ||
            authority.requiredChecks?.join('\0') !== request.requiredChecks.join('\0') || authority.approvalReceipt !== approvalReceipt ||
            !text(authority.receipt)) throw new Error('LEDGER_AUTHORITY_REQUIRED');
        await record({ event: 'ledger_authorized', task: taskId, attempt, leaseId: lease.leaseId,
          budgetReservation: reservation.budgetReservation, receipt: authority.receipt, capabilityReceiptHash: receiptHash,
          worktreeReceipt: request.worktreeReceipt ?? null });
        states[taskId] = 'running';
        await checkpoint('running', taskId);
        // Repair sees measured failures, never just "try again" or prior reasoning.
        const result = await invoke('execute', { ...leasedRequest, ledgerAuthorityReceipt: authority.receipt,
          previousChecks: freeze(structuredClone(previousChecks)) });
        await current();
        if (!result || !Array.isArray(result.changedFiles) || result.changedFiles.some(f => !text(f))) throw new Error('INVALID_WORKER_RESULT');
        const scope = await reviewPriority(root, { task: taskId, changedFiles: result.changedFiles, workspaceRoot });
        if (scope.status !== 'pass') throw new Error('SCOPE_VIOLATION');
        const inputRevision = await invoke('inputRevision', request);
        if (!text(inputRevision)) throw new Error('INPUT_REVISION_REQUIRED');
        states[taskId] = 'awaiting-check';
        let passed = true;
        previousChecks = [];
        for (const check of checks[taskId]) {
          let evidence;
          try {
            evidence = await invoke('check', { ...leasedRequest, check, inputRevision });
          } catch {
            // A failed check can leave local or remote work in an unknown state.
            controller.abort(new Error('CHECK_RECONCILIATION_REQUIRED'));
            throw controller.signal.reason;
          }
          await current();
          const valid = evidence?.taskId === taskId && evidence.revision === revision &&
            evidence.inputRevision === inputRevision && evidence.check === check &&
            evidence.exitCode === 0 && evidence.executed === true && text(evidence.receipt);
          await record({ event: 'check', task: taskId, attempt, check, inputRevision,
            passed: valid, receipt: text(evidence?.receipt) ? evidence.receipt : null });
          if (evidence?.cleanupVerified === false) {
            controller.abort(new Error('CLEANUP_RECONCILIATION_REQUIRED'));
            throw controller.signal.reason;
          }
          previousChecks.push({ check, passed: valid, inputRevision,
            receipt: text(evidence?.receipt) ? evidence.receipt : null });
          passed &&= valid;
        }
        if (await invoke('inputRevision', request) !== inputRevision) throw new Error('STALE_INPUT');
        if (passed) {
          await current();
          const assertCurrent = async () => {
            await current();
            const blockers = await inspectBlockers(root, { taskId });
            if (blockers.blockers.some(b => b.state !== 'ready')) throw new Error('RECORDED_BLOCKER_WAIT');
            if (await invoke('inputRevision', request) !== inputRevision) throw new Error('STALE_INPUT');
            await current();
          };
          await assertCurrent();
          const commitAuthority = await ledger.authorizeCommit({ ...leasedRequest, inputRevision,
            validation: freeze(structuredClone(previousChecks)) });
          if (commitAuthority?.allowed !== true || commitAuthority.taskId !== taskId ||
              commitAuthority.revision !== revision || commitAuthority.inputRevision !== inputRevision ||
              commitAuthority.leaseId !== lease.leaseId || commitAuthority.capabilityReceiptHash !== receiptHash ||
              !text(commitAuthority.receipt)) throw new Error('LEDGER_COMMIT_AUTHORITY_REQUIRED');
          await record({ event: 'commit_authorized', task: taskId, attempt, leaseId: lease.leaseId,
            inputRevision, receipt: commitAuthority.receipt, capabilityReceiptHash: receiptHash });
          // The trusted adapter must compare-and-set, not unconditionally tick tasks.
          const commit = await invoke('verified', { ...leasedRequest, inputRevision,
            commitAuthorityReceipt: commitAuthority.receipt, assertCurrent });
          if (commit?.committed !== true || commit.taskId !== taskId || commit.revision !== revision ||
              commit.inputRevision !== inputRevision || !text(commit.receipt)) throw new Error('COMMIT_RECONCILIATION_REQUIRED');
          await assertCurrent();
          await current();
          states[taskId] = 'verified';
          verifiedInputs.set(taskId, inputRevision);
          await record({ event: 'verified', task: taskId, inputRevision, receipt: commit.receipt });
          await checkpoint('verified', taskId);
          return;
        }
        await record({ event: 'repair_required', task: taskId, attempt });
      }
      throw new Error('ATTEMPT_LIMIT');
    } catch (error) {
      const reason = controller.signal.aborted ? controller.signal.reason.message : error.message;
      states[taskId] = reason.startsWith('STALE') ? 'stale' : reason === 'CLEANUP_RECONCILIATION_REQUIRED' ? 'blocked' : controller.signal.aborted ? 'cancelled' : 'blocked';
      await record({ event: states[taskId], task: taskId, reason, reconciliationRequired: true }).catch(() => {});
      await checkpoint(states[taskId], taskId).catch(() => {});
    }
  }
  try {
    if (resumeReport) {
      const contents = await file.readFile('utf8');
      if (createHash('sha256').update(contents).digest('hex') !== resumeReport.journalHash) throw new Error('RECOVERY_INPUT_CHANGED');
      await record({ event: 'resumed', previousJournalHash: resumeReport.journalHash,
        callsConsumed: calls, attemptsConsumed: resumeReport.attemptsConsumed });
      await checkpoint('resumed');
    } else {
      await record({ event: 'started', maxCalls, maxConcurrent, maxIterations: loop.maxIterations, capabilityReceiptHash: receiptHash,
        selectedModel: route.model.id, benchmarkReceipt: route.benchmarkReceipt, approvalReceipt,
        requiredChecks: checks, deadlineMs, baselineTasks: [...previouslyComplete],
        worktreeReceipt: adapter.worktreeReceipt ?? null });
      await checkpoint('started');
    }
    const active = new Map();
    while (!controller.signal.aborted) {
      let scheduled = false;
      for (const id of ids) {
        if (active.size === maxConcurrent || states[id] !== 'pending') continue;
        if (!plan.tasks[id].dependsOn.every(dep => states[dep] === 'verified')) continue;
        if ([...active.keys()].some(other => overlaps(scopes[id], scopes[other]))) continue;
        for (const dependency of plan.tasks[id].dependsOn) {
          const expected = verifiedInputs.get(dependency);
          const currentInput = await invoke('inputRevision', {
            taskId: dependency,
            revision,
            allowedEditScope: plan.tasks[dependency].allowedEditScope,
            requiredChecks: checks[dependency],
          });
          if (currentInput !== expected) {
            controller.abort(new Error('STALE_PREREQUISITE_EVIDENCE'));
            break;
          }
        }
        if (controller.signal.aborted) break;
        if ((await reviewPriority(root, { task: id })).status !== 'pass') continue;
        active.set(id, runTask(id).then(() => id));
        scheduled = true;
      }
      if (active.size) {
        const completed = await Promise.race(active.values());
        active.delete(completed);
        continue;
      }
      if (!scheduled) break;
    }
    // Cancellation stops new scheduling, but active work may still be draining
    // its journal and checkpoint operations. Do not close the runtime ledger
    // or return while a sibling can still write into the feature directory.
    if (active.size) await Promise.allSettled([...active.values()]);
    // The abort race stops scheduling promptly, but a trusted adapter may
    // still be delivering cancellation. Give it a bounded drain window and
    // report when it has not settled; recovery must then inspect the worker.
    const adapterCallsSettled = await drainAdapterCalls();
    const verified = ids.filter(id => states[id] === 'verified');
    const status = !controller.signal.aborted && ids.every(id => states[id] === 'verified') ? 'verified' : 'incomplete';
    // Task verification is not the feature/release outcome gate.
    const result = { status, states, verified, calls, attempts, revision, cost: null, adapterCallsSettled,
      nativeQualification: 'not-established', featureComplete: false };
    await record({ event: 'finished', ...result });
    await checkpoint('finished');
    return result;
  } finally {
    controller.abort(new Error('RUN_CLOSED'));
    if (!drainAttempted) await drainAdapterCalls();
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    // A journal failure must still drain checkpoint writes before callers or
    // tests can remove the feature directory. Preserve the journal failure
    // while ensuring no asynchronous checkpoint writer survives teardown.
    try { await write; } finally {
      try { await checkpointWrite; } finally {
        await file.close();
        if (resumeLock) releaseResumeLock(resumeLock);
      }
    }
  }
}
