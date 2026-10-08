import { open, realpath, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { executionRevision } from './gofer-verified-execution.mjs';

const LIMIT = 8 * 1024 * 1024;
const taskId = value => typeof value === 'string' && /^T\d+$/.test(value);
const text = value => typeof value === 'string' && value.length > 0;

async function readJournal(root) {
  const file = await open(path.join(root, 'verified-execution.jsonl'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > LIMIT) throw new Error('INVALID_RECOVERY_JOURNAL');
    const chunks = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, LIMIT - total + 1));
      const { bytesRead } = await file.read(buffer);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > LIMIT) throw new Error('RECOVERY_JOURNAL_LIMIT');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await file.close(); }
}

/** Read-only reconciliation. This never clears a journal or replays a side effect. */
export async function inspectExecutionRecovery({ featureDir, verifyReceipt, verifyCancellation, inspectWorkers, inspectLedger, timeoutMs = 2000 }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10000) throw new Error('INVALID_INSPECTION_LIMIT');
  let inspectionDeadline = Date.now() + timeoutMs;
  let inspectionTimedOut = false;
  const bounded = async callback => {
    if (inspectionTimedOut || Date.now() >= inspectionDeadline) throw new Error('INSPECTION_TIMEOUT');
    let timer;
    try { return await Promise.race([
      Promise.resolve().then(() => { if (inspectionTimedOut || Date.now() >= inspectionDeadline) throw new Error('INSPECTION_TIMEOUT'); return callback(); }),
      new Promise((_, reject) => { timer = setTimeout(() => { inspectionTimedOut = true; reject(new Error('INSPECTION_TIMEOUT')); }, Math.max(0, inspectionDeadline - Date.now())); }),
    ]); } finally { clearTimeout(timer); }
  };
  const root = await realpath(featureDir);
  const raw = await readJournal(root);
  const journalHash = createHash('sha256').update(raw).digest('hex');
  const report = { status: 'blocked', journalHash, resumeAllowed: false, replayAllowed: false,
    reusableTasks: [], restartableTasks: [], verifiedInputs: {}, uncertainTasks: [], callsConsumed: 0, attemptsConsumed: {}, reasons: [],
    coverage: 'Read-only reconciliation; trusted receipt and worker inspection are required. No automatic replay.' };
  const reasons = report.reasons;
  if (!raw.endsWith('\n')) { reasons.push('TRUNCATED_JOURNAL'); return report; }
  let events;
  try { events = raw.trimEnd().split('\n').map(line => JSON.parse(line)); }
  catch { reasons.push('INVALID_JOURNAL_JSON'); return report; }
  const first = events[0];
  if (events.length > 50000 || first?.event !== 'started' || first.schemaVersion !== 1 ||
      !text(first.revision) || !Number.isSafeInteger(first.maxCalls) || first.maxCalls <= 0 ||
      !Number.isFinite(first.deadlineMs) || !Number.isInteger(first.maxConcurrent) || first.maxConcurrent < 1 || first.maxConcurrent > 8 ||
      !Number.isSafeInteger(first.maxIterations) || first.maxIterations < 1 || !first.requiredChecks ||
      typeof first.requiredChecks !== 'object' || Array.isArray(first.requiredChecks) ||
      !Object.keys(first.requiredChecks).length || Object.keys(first.requiredChecks).length > 1000 || Object.entries(first.requiredChecks).some(([task, checks]) =>
        !taskId(task) || !Array.isArray(checks) || !checks.length || checks.length > 256 || checks.some(c => !text(c)) || new Set(checks).size !== checks.length)) {
    reasons.push('INVALID_RUN_HEADER'); return report;
  }
  inspectionDeadline = Math.min(inspectionDeadline, first.deadlineMs);
  report.run = { revision: first.revision, maxCalls: first.maxCalls, maxConcurrent: first.maxConcurrent,
    maxIterations: first.maxIterations, deadlineMs: first.deadlineMs, requiredChecks: first.requiredChecks,
    capabilityReceiptHash: first.capabilityReceiptHash, selectedModel: first.selectedModel,
    benchmarkReceipt: first.benchmarkReceipt, approvalReceipt: first.approvalReceipt };
  if (await executionRevision(root) !== first.revision) reasons.push('STALE_DIRECTION');
  if (Date.now() >= first.deadlineMs) reasons.push('DEADLINE_EXHAUSTED');
  const uncertain = new Set();
  const receipts = new Map();
  const latestChecks = new Map();
  const authorizations = [];
  const commits = [];
  const authorizedTasks = new Map();
  const commitAuthorities = new Map();
  const cancellations = new Map();
  const active = new Set();
  const methods = new Set(['reserve', 'lease', 'execute', 'inputRevision', 'check', 'verified']);
  const known = new Set(['started', 'resumed', 'attempt_reserved', 'call_reserved', 'lease_granted', 'ledger_authorized', 'check', 'commit_authorized', 'verified', 'repair_required', 'blocked', 'cancelled', 'cancel_reconciled', 'stale', 'finished']);
  let finished = false;
  for (const [index, event] of events.entries()) {
    if (!event || event.schemaVersion !== 1 || event.revision !== first.revision || !known.has(event.event) ||
        (index > 0 && event.event === 'started') || (finished && !['resumed', 'cancel_reconciled'].includes(event.event)) ||
        (!['started', 'finished', 'resumed'].includes(event.event) && !taskId(event.task))) {
      reasons.push('INVALID_JOURNAL_SEQUENCE'); break;
    }
    if (event.event === 'resumed') {
      const prefix = events.slice(0, index).map(record => `${JSON.stringify(record)}\n`).join('');
      const expectedHash = createHash('sha256').update(prefix).digest('hex');
      if (!receipts.size && !cancellations.size || event.previousJournalHash !== expectedHash ||
          event.callsConsumed !== report.callsConsumed ||
          JSON.stringify(event.attemptsConsumed) !== JSON.stringify(report.attemptsConsumed) ||
          [...uncertain].some(task => !receipts.has(task) && !cancellations.has(task))) {
        reasons.push('INVALID_RESUME_HISTORY'); break;
      }
      finished = false;
      continue;
    }
    if (event.event === 'cancel_reconciled') {
      const prefix = events.slice(0, index).map(record => `${JSON.stringify(record)}\n`).join('');
      const expectedHash = createHash('sha256').update(prefix).digest('hex');
      const prior = authorizedTasks.get(event.task);
      const cancelled = events.slice(0, index).reverse().find(record => record.task === event.task && record.event === 'cancelled');
      if (!prior || !cancelled || receipts.has(event.task) || cancellations.has(event.task) ||
          event.journalHash !== expectedHash || event.attempt !== report.attemptsConsumed[event.task] ||
          event.leaseId !== prior.leaseId || event.abandonedWorktreeReceipt !== prior.worktreeReceipt ||
          !text(event.replacementWorktreeReceipt) || event.replacementWorktreeReceipt === event.abandonedWorktreeReceipt ||
          !text(event.workerStopReceipt) || !text(event.receipt) || !text(event.inputRevision)) {
        reasons.push('INVALID_CANCELLATION_RECONCILIATION'); break;
      }
      cancellations.set(event.task, event);
      continue;
    }
    const verifiedRead = receipts.has(event.task) && event.event === 'call_reserved' && event.method === 'inputRevision';
    if (event.task && !verifiedRead) uncertain.add(event.task);
    if (event.task && (!Object.hasOwn(first.requiredChecks, event.task) || (receipts.has(event.task) && !verifiedRead))) {
      receipts.delete(event.task); reasons.push('INVALID_LATE_OR_UNKNOWN_TASK'); break;
    }
    if (event.event === 'attempt_reserved') {
      const expected = (report.attemptsConsumed[event.task] || 0) + 1;
      if (event.attempt !== expected || expected > first.maxIterations) { reasons.push('INVALID_ATTEMPT_HISTORY'); break; }
      report.attemptsConsumed[event.task] = expected;
      latestChecks.set(event.task, new Map());
      active.delete(event.task);
    }
    if (event.event === 'call_reserved') {
      if (event.call !== report.callsConsumed + 1 || !methods.has(event.method) ||
          event.call > first.maxCalls) { reasons.push('INVALID_CALL_HISTORY'); break; }
      report.callsConsumed = event.call;
      if (!report.attemptsConsumed[event.task]) { reasons.push('INVALID_CALL_WITHOUT_ATTEMPT'); break; }
      if (event.method === 'execute') active.add(event.task);
      if (active.size > first.maxConcurrent) { reasons.push('INVALID_CONCURRENCY_HISTORY'); break; }
    }
    if (event.event === 'lease_granted' && (!report.attemptsConsumed[event.task] || !text(event.leaseId) || !text(event.expiresAt))) {
      reasons.push('INVALID_LEASE_HISTORY'); break;
    }
    if (event.event === 'ledger_authorized') {
      if (!report.attemptsConsumed[event.task] || !text(event.leaseId) || !text(event.receipt) ||
          !text(event.capabilityReceiptHash)) { reasons.push('INVALID_LEDGER_AUTHORIZATION'); break; }
      authorizations.push({ taskId: event.task, leaseId: event.leaseId, receipt: event.receipt,
        capabilityReceiptHash: event.capabilityReceiptHash, worktreeReceipt: event.worktreeReceipt });
      authorizedTasks.set(event.task, event);
    }
    if (event.event === 'check') {
      if (!active.has(event.task) || event.attempt !== report.attemptsConsumed[event.task] ||
          !first.requiredChecks[event.task].includes(event.check)) { reasons.push('INVALID_CHECK_HISTORY'); break; }
      latestChecks.get(event.task).set(event.check, event);
    }
    if (event.event === 'verified') {
      if (!active.has(event.task) || !text(event.inputRevision) || !text(event.receipt) || receipts.has(event.task) ||
          !authorizedTasks.has(event.task) || commitAuthorities.get(event.task)?.inputRevision !== event.inputRevision ||
          first.requiredChecks[event.task].some(check => {
            const proof = latestChecks.get(event.task)?.get(check);
            return proof?.passed !== true || proof.inputRevision !== event.inputRevision || !text(proof.receipt);
          })) {
        reasons.push('INVALID_VERIFICATION_RECORD'); break;
      }
      receipts.set(event.task, event);
      active.delete(event.task);
    }
    if (event.event === 'commit_authorized') {
      const authority = authorizedTasks.get(event.task);
      if (!active.has(event.task) || !authority || !text(event.leaseId) ||
          !text(event.receipt) || !text(event.inputRevision) ||
          !text(event.capabilityReceiptHash) ||
          event.attempt !== authority.attempt || event.leaseId !== authority.leaseId ||
          event.capabilityReceiptHash !== authority.capabilityReceiptHash ||
          commitAuthorities.get(event.task)?.attempt === event.attempt ||
          first.requiredChecks[event.task].some(check => {
            const proof = latestChecks.get(event.task)?.get(check);
            return proof?.passed !== true || proof.inputRevision !== event.inputRevision || !text(proof.receipt);
          })) {
        reasons.push('INVALID_COMMIT_AUTHORIZATION'); break;
      }
      commits.push({ taskId: event.task, leaseId: event.leaseId, receipt: event.receipt,
        inputRevision: event.inputRevision, capabilityReceiptHash: event.capabilityReceiptHash });
      commitAuthorities.set(event.task, event);
    }
    if (['blocked', 'cancelled', 'stale', 'repair_required'].includes(event.event)) active.delete(event.task);
    if (event.event === 'finished') {
      finished = true;
      if (event.adapterCallsSettled === false) reasons.push('ADAPTER_CALLS_NOT_SETTLED');
    }
  }
  if (report.callsConsumed >= first.maxCalls) reasons.push('CALL_LIMIT_EXHAUSTED');
  if (reasons.some(reason => /^(INVALID|STALE)/.test(reason))) {
    report.uncertainTasks = [...uncertain]; return report;
  }
  if (uncertain.size === 1 && events.at(-1)?.event === 'finished' && events.at(-1)?.adapterCallsSettled === true) {
    const task = [...uncertain][0];
    const authority = authorizedTasks.get(task);
    const cancelled = events.findLast(event => event.task === task && event.event === 'cancelled');
    if (authority && cancelled && !cancellations.has(task) && !receipts.has(task) &&
        authority.attempt === report.attemptsConsumed[task] && text(authority.worktreeReceipt) &&
        text(authority.budgetReservation) && !commits.some(item => item.taskId === task && item.leaseId === authority.leaseId)) {
      report.pendingCancellation = { taskId: task, revision: first.revision, attempt: authority.attempt,
        leaseId: authority.leaseId, abandonedWorktreeReceipt: authority.worktreeReceipt,
        budgetReservation: authority.budgetReservation, capabilityReceiptHash: authority.capabilityReceiptHash,
        approvalReceipt: first.approvalReceipt };
    }
  }
  // A journal proves recorded actions, not whether a local or remote worker is gone.
  if (typeof inspectWorkers !== 'function') reasons.push('WORKER_INSPECTION_REQUIRED');
  else {
    try {
      const workers = await bounded(() => inspectWorkers({ revision: first.revision, journalHash,
        authorizations: structuredClone(authorizations) }));
      if (workers?.allStopped !== true || workers.revision !== first.revision ||
          workers.journalHash !== journalHash || !text(workers.receipt)) reasons.push('WORKERS_NOT_RECONCILED');
      else report.workerStopReceipt = workers.receipt;
    } catch { reasons.push('WORKER_INSPECTION_FAILED'); }
  }
  if (typeof verifyReceipt !== 'function') reasons.push('RECEIPT_VERIFIER_REQUIRED');
  if (cancellations.size && typeof verifyCancellation !== 'function') reasons.push('CANCELLATION_VERIFIER_REQUIRED');
  if (typeof inspectLedger !== 'function') reasons.push('LEDGER_INSPECTION_REQUIRED');
  else {
    try {
      const result = await bounded(() => inspectLedger({ revision: first.revision, journalHash,
        authorizations: structuredClone(authorizations), commits: structuredClone(commits) }));
      if (result?.allowed !== true || result.revision !== first.revision || result.journalHash !== journalHash) {
        reasons.push('LEDGER_NOT_RECONCILED');
      }
    } catch { reasons.push('LEDGER_INSPECTION_FAILED'); }
  }
  if (!reasons.length) {
    for (const [task, event] of receipts) {
      if (inspectionTimedOut || Date.now() >= inspectionDeadline) { reasons.push('INSPECTION_DEADLINE_EXHAUSTED'); break; }
      try {
        const result = await bounded(() => verifyReceipt({ taskId: task, revision: first.revision,
          inputRevision: event.inputRevision, receipt: event.receipt, journalHash }));
        if (result?.valid !== true || result.taskId !== task || result.revision !== first.revision ||
            result.inputRevision !== event.inputRevision || result.receipt !== event.receipt || result.journalHash !== journalHash) throw new Error('UNVERIFIED');
        report.reusableTasks.push(task); uncertain.delete(task);
        report.verifiedInputs[task] = event.inputRevision;
      } catch { reasons.push(`RECEIPT_NOT_VERIFIED:${task}`); }
    }
  }
  if (!reasons.length) {
    for (const [task, event] of cancellations) {
      if (inspectionTimedOut || Date.now() >= inspectionDeadline) { reasons.push('INSPECTION_DEADLINE_EXHAUSTED'); break; }
      try {
        const request = { taskId: task, revision: first.revision, leaseId: event.leaseId,
          attempt: event.attempt, journalHash: event.journalHash, receipt: event.receipt,
          workerStopReceipt: event.workerStopReceipt, abandonedWorktreeReceipt: event.abandonedWorktreeReceipt,
          replacementWorktreeReceipt: event.replacementWorktreeReceipt, inputRevision: event.inputRevision };
        const result = await bounded(() => verifyCancellation(structuredClone(request)));
        if (result?.valid !== true || Object.entries(request).some(([key, value]) => result[key] !== value)) throw new Error('UNVERIFIED');
        report.restartableTasks.push(task);
        uncertain.delete(task);
        report.replacementWorktreeReceipt = event.replacementWorktreeReceipt;
      } catch { reasons.push(`CANCELLATION_NOT_VERIFIED:${task}`); }
    }
  }
  // Detect new journal events or direction changes during asynchronous proof inspection.
  const directionStillMatches = await executionRevision(root) === first.revision;
  if (!directionStillMatches || createHash('sha256').update(await readJournal(root)).digest('hex') !== journalHash) {
    reasons.push('RECOVERY_INPUT_CHANGED');
    for (const task of report.reusableTasks) uncertain.add(task);
    report.reusableTasks = [];
    report.restartableTasks = [];
    report.verifiedInputs = {};
  }
  if (inspectionTimedOut || Date.now() >= inspectionDeadline) {
    reasons.push('INSPECTION_DEADLINE_EXHAUSTED');
    for (const task of report.reusableTasks) uncertain.add(task);
    report.reusableTasks = [];
    report.restartableTasks = [];
    report.verifiedInputs = {};
  }
  report.uncertainTasks = [...uncertain];
  if (uncertain.size) reasons.push('SIDE_EFFECT_RECONCILIATION_REQUIRED');
  if (!reasons.length) {
    report.status = 'reconciled';
    report.resumeAllowed = report.reusableTasks.length > 0 || report.restartableTasks.length > 0;
  }
  return report;
}

/** Retire one cancelled lease and journal a fresh-worktree restart boundary. */
export async function reconcileCancelledExecution({ featureDir, workspaceRoot, abandonedWorkspace,
  replacementWorkspace, worktreeRevision, replacementWorktreeReceipt, inputRevision,
  ledger, inspectWorkers, verifyReceipt, timeoutMs = 2000 } = {}) {
  if (!ledger || typeof ledger.reconcileCancelledLease !== 'function' ||
      typeof ledger.readCancellation !== 'function' || typeof ledger.inspectRecovery !== 'function' ||
      ![workspaceRoot, abandonedWorkspace,
        replacementWorkspace, worktreeRevision, replacementWorktreeReceipt, inputRevision].every(text)) {
    throw new Error('CANCELLATION_RECONCILIATION_INPUT_REQUIRED');
  }
  const root = await realpath(featureDir);
  const lock = await open(path.join(root, 'verified-execution.resume.lock'), 'wx', 0o600)
    .catch(() => { throw new Error('RESUME_LOCKED'); });
  try {
    const report = await inspectExecutionRecovery({ featureDir: root, inspectWorkers,
      inspectLedger: request => ledger.inspectRecovery(request),
      verifyReceipt, timeoutMs });
    if (report.status !== 'blocked' || !report.pendingCancellation ||
        report.reasons.length !== 1 || report.reasons[0] !== 'SIDE_EFFECT_RECONCILIATION_REQUIRED' ||
        !text(report.workerStopReceipt) || report.attemptsConsumed[report.pendingCancellation.taskId] >= report.run.maxIterations) {
      throw new Error('CANCELLATION_RECONCILIATION_REQUIRED');
    }
    const { inspectVerifiedWorktree } = await import('./gofer-native-adapter.mjs');
    const [oldWorktree, replacementWorktree] = await Promise.all([
      inspectVerifiedWorktree({ workspaceRoot, isolatedWorkspace: abandonedWorkspace,
        revision: worktreeRevision, receipt: report.pendingCancellation.abandonedWorktreeReceipt }),
      inspectVerifiedWorktree({ workspaceRoot, isolatedWorkspace: replacementWorkspace,
        revision: worktreeRevision, receipt: replacementWorktreeReceipt, requireClean: true }),
    ]);
    if (oldWorktree.valid !== true || replacementWorktree.valid !== true ||
        oldWorktree.isolatedWorkspace === replacementWorktree.isolatedWorkspace ||
        oldWorktree.receipt === replacementWorktree.receipt) throw new Error('REPLACEMENT_WORKTREE_UNVERIFIED');
    const request = { ...report.pendingCancellation, journalHash: report.journalHash,
      workerStopReceipt: report.workerStopReceipt, replacementWorktreeReceipt, inputRevision };
    const existing = await ledger.readCancellation(request);
    const result = existing.found === true && JSON.stringify(existing.request) === JSON.stringify(request)
      ? { allowed: true, receipt: existing.receipt }
      : await ledger.reconcileCancelledLease(request);
    if (result?.allowed !== true || !text(result.receipt)) throw new Error('LEDGER_CANCELLATION_DENIED');
    if (createHash('sha256').update(await readJournal(root)).digest('hex') !== report.journalHash) {
      throw new Error('RECOVERY_INPUT_CHANGED');
    }
    const event = { schemaVersion: 1, revision: report.run.revision, event: 'cancel_reconciled',
      task: request.taskId, attempt: request.attempt, leaseId: request.leaseId,
      journalHash: request.journalHash, workerStopReceipt: request.workerStopReceipt,
      abandonedWorktreeReceipt: request.abandonedWorktreeReceipt,
      replacementWorktreeReceipt: request.replacementWorktreeReceipt,
      inputRevision: request.inputRevision, receipt: result.receipt };
    const file = await open(path.join(root, 'verified-execution.jsonl'), constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
    try { await file.writeFile(`${JSON.stringify(event)}\n`); await file.sync(); } finally { await file.close(); }
    return { reconciled: true, taskId: request.taskId, receipt: result.receipt,
      replacementWorktreeReceipt, journalHash: request.journalHash };
  } finally { await lock.close(); await unlink(path.join(root, 'verified-execution.resume.lock')).catch(() => {}); }
}
