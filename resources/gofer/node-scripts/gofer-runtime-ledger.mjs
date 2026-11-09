/** Durable, append-only authority ledger for a single verified runtime. */
import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const text = value => typeof value === 'string' && value.trim().length > 0;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sameList = (left, right) => Array.isArray(left) && Array.isArray(right) &&
  left.length === right.length && left.every((value, index) => value === right[index]);

export async function acquireLedgerLock(lockPath) {
  let metadata = await lstat(lockPath).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!metadata) {
    const temporary = `${lockPath}.${randomUUID()}.init`;
    try {
      const initial = new DatabaseSync(temporary, { timeout: 0 });
      try { initial.exec('CREATE TABLE lock_identity (id INTEGER PRIMARY KEY)'); }
      finally { initial.close(); }
      await chmod(temporary, 0o600);
      try { await link(temporary, lockPath); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    } finally { await unlink(temporary).catch(() => {}); }
    metadata = await lstat(lockPath);
  }
  // A legacy, empty .lock file may still belong to an older live controller.
  // Do not reinterpret it as an unlocked database during an upgrade.
  if (!metadata.isFile() || metadata.size === 0 ||
      (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)) {
    throw new Error('LEDGER_LOCK_MIGRATION_REQUIRED');
  }
  let database;
  try {
    database = new DatabaseSync(lockPath, { timeout: 0 });
    database.exec('BEGIN IMMEDIATE');
    return database;
  } catch (error) {
    database?.close();
    throw new Error(/database is locked|SQLITE_BUSY/i.test(error.message) ? 'LEDGER_BUSY' : 'LEDGER_LOCK_UNAVAILABLE');
  }
}

export async function createRuntimeLedger({ ledgerPath, now = () => new Date(), verifyCancellation,
  verifyBenchmarkCapture } = {}) {
  if (!path.isAbsolute(ledgerPath)) throw new Error('LEDGER_PATH_REQUIRED');
  await mkdir(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
  const lockPath = `${ledgerPath}.lock`;
  const events = async () => (await readFile(ledgerPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  })).split('\n')
    .filter(Boolean).map(line => JSON.parse(line));
  const transact = async (event, evaluate) => {
    const lock = await acquireLedgerLock(lockPath);
    try {
      const history = await events();
      const result = await evaluate(history);
      if (result?.allowed !== true) return result;
      const record = { schemaVersion: 1, eventId: randomUUID(), at: now().toISOString(), ...event, ...result };
      const append = await open(ledgerPath, 'a', 0o600);
      try { await append.writeFile(`${JSON.stringify(record)}\n`); await append.sync(); } finally { await append.close(); }
      return result;
    } finally {
      try { lock.exec('ROLLBACK'); } finally { lock.close(); }
    }
  };
  const reservation = request => ({ taskId: request?.taskId, revision: request?.revision, attempt: request?.attempt,
    budgetReservation: `reservation:${digest(request).slice(0, 24)}` });
  return Object.freeze({
    reserve: request => transact({ type: 'reserve', request }, async history => text(request?.taskId) && text(request?.revision) &&
      Number.isSafeInteger(request?.attempt) && request.attempt > 0 &&
      !history.some(item => item.type === 'reserve' && item.taskId === request.taskId &&
        item.revision === request.revision && item.attempt >= request.attempt) &&
      !history.some(item => item.type === 'lease' && item.taskId === request.taskId &&
        !history.some(closed => closed.type === 'cancel-reconciled' && closed.leaseId === item.leaseId))
      ? { allowed: true, ...reservation(request) } : { allowed: false }),
    lease: request => transact({ type: 'lease', request }, async history => {
      const reserved = reservation(request);
      if (!history.some(item => item.type === 'reserve' && item.budgetReservation === reserved.budgetReservation) ||
          history.some(item => item.type === 'lease' && item.budgetReservation === reserved.budgetReservation)) return { allowed: false };
      if (history.some(item => item.type === 'lease' && item.taskId === request.taskId &&
          !history.some(closed => closed.type === 'cancel-reconciled' && closed.leaseId === item.leaseId))) return { allowed: false };
      return { allowed: true, taskId: request.taskId, revision: request.revision, attempt: request.attempt,
        budgetReservation: reserved.budgetReservation,
        leaseId: `lease:${randomUUID()}`, expiresAt: new Date(now().getTime() + 300000).toISOString() };
    }),
    authorize: request => transact({ type: 'authorize', request }, async history => {
      if (!text(request?.leaseId) || !text(request?.budgetReservation) || !text(request?.approvalReceipt) ||
          !Array.isArray(request?.dependencies)) return { allowed: false };
      const lease = history.find(item => item.type === 'lease' && item.leaseId === request.leaseId);
      const reserved = history.find(item => item.type === 'reserve' &&
        item.budgetReservation === request.budgetReservation);
      const replacement = history.filter(item => item.type === 'cancel-reconciled' &&
        item.taskId === request.taskId && item.revision === request.revision).at(-1);
      if (!lease || !reserved || lease.taskId !== request.taskId || lease.revision !== request.revision ||
          lease.attempt !== request.attempt || lease.budgetReservation !== request.budgetReservation ||
          reserved.taskId !== request.taskId || reserved.revision !== request.revision ||
          reserved.attempt !== request.attempt ||
          digest(reserved.request?.dependencies) !== digest(request.dependencies) ||
          reserved.request?.worktreeReceipt !== request.worktreeReceipt ||
          !sameList(reserved.request?.allowedEditScope, request.allowedEditScope) ||
          !sameList(reserved.request?.requiredChecks, request.requiredChecks) ||
          reserved.request?.capabilityReceiptHash !== request.capabilityReceiptHash ||
          reserved.request?.approvalReceipt !== request.approvalReceipt ||
          reserved.request?.selectedModel !== request.selectedModel ||
          reserved.request?.benchmarkReceipt !== request.benchmarkReceipt ||
          Date.parse(lease.expiresAt) <= now().getTime() ||
          (replacement && request.worktreeReceipt !== replacement.replacementWorktreeReceipt) ||
          history.some(item => item.leaseId === request.leaseId &&
            ['authorize', 'cancel-reconciled'].includes(item.type))) return { allowed: false };
      return { allowed: true, ...request, receipt: `authority:${digest(request).slice(0, 32)}` };
    }),
    authorizeNative: request => transact({ type: 'native-authorize', request }, async history => {
      const authority = history.find(item => item.type === 'authorize' && item.leaseId === request?.leaseId && item.receipt === request?.ledgerAuthorityReceipt);
      const lease = history.find(item => item.type === 'lease' && item.leaseId === request?.leaseId);
      if (!authority || !lease || Date.parse(lease.expiresAt) <= now().getTime() ||
          history.some(item => item.leaseId === request?.leaseId &&
            ['native-authorize', 'commit-authorize', 'cancel-reconciled'].includes(item.type)) ||
          authority.taskId !== request.taskId || authority.revision !== request.objectiveRevision ||
          authority.attempt !== request.attempt ||
          authority.budgetReservation !== request.budgetReservation || authority.approvalReceipt !== request.approvalReceipt ||
          authority.worktreeReceipt !== request.worktreeReceipt ||
          authority.capabilityReceiptHash !== request.capabilityReceiptHash || digest(authority.dependencies) !== digest(request.dependencies) ||
          authority.selectedModel !== request.selectedModel ||
          !sameList(authority.allowedEditScope, request.allowedWriteScope)) return { allowed: false };
      return { allowed: true, ...request, isolation: 'git-worktree+local-os-sandbox', receipt: authority.receipt };
    }),
    authorizeCommit: request => transact({ type: 'commit-authorize', request }, async history => {
      const authority = history.find(item => item.type === 'authorize' && item.leaseId === request?.leaseId);
      const lease = history.find(item => item.type === 'lease' && item.leaseId === request?.leaseId);
      const native = history.find(item => item.type === 'native-authorize' && item.leaseId === request?.leaseId);
      const requiredChecks = authority?.requiredChecks;
      const validation = request?.validation;
      if (!authority || !lease || !native || Date.parse(lease.expiresAt) <= now().getTime() ||
          history.some(item => item.leaseId === request?.leaseId &&
            ['commit-authorize', 'cancel-reconciled'].includes(item.type)) ||
          authority.taskId !== request.taskId || authority.revision !== request.revision ||
          authority.attempt !== request.attempt || authority.budgetReservation !== request.budgetReservation ||
          authority.approvalReceipt !== request.approvalReceipt || authority.capabilityReceiptHash !== request.capabilityReceiptHash ||
          authority.worktreeReceipt !== request.worktreeReceipt ||
          digest(authority.dependencies) !== digest(request.dependencies) || !text(request.inputRevision) ||
          !Array.isArray(requiredChecks) || !requiredChecks.length ||
          !Array.isArray(validation) || validation.length !== requiredChecks.length ||
          new Set(validation.map(item => item?.check)).size !== requiredChecks.length ||
          validation.some(item => !requiredChecks.includes(item?.check) || item?.passed !== true ||
            item?.inputRevision !== request.inputRevision || !text(item?.receipt))) return { allowed: false };
      return { allowed: true, taskId: request.taskId, revision: request.revision, inputRevision: request.inputRevision,
        leaseId: request.leaseId, capabilityReceiptHash: request.capabilityReceiptHash, receipt: `commit:${digest(request).slice(0, 32)}` };
    }),
    authorizeBenchmarkCapture: request => transact({ type: 'benchmark-capture-authorize', request }, async history => {
      const runs = request?.runs;
      if (typeof verifyBenchmarkCapture !== 'function' || !text(request?.revision) ||
          !text(request?.journalHash) || !text(request?.workerStopReceipt) ||
          !/^[a-f0-9]{64}$/.test(request?.corpusHash ?? '') ||
          !/^[a-f0-9]{64}$/.test(request?.reportSha256 ?? '') ||
          !Array.isArray(runs) || runs.length < 12 || runs.length > 3000 ||
          history.some(item => item.type === 'benchmark-capture-authorize' &&
            item.corpusHash === request.corpusHash && item.reportSha256 === request.reportSha256)) return { allowed: false };
      const cases = new Map();
      const leases = new Set();
      for (const run of runs) {
        if (!text(run?.caseId) || ![1, 2, 3].includes(run?.run) ||
            ![run.taskId, run.leaseId, run.worktreeReceipt, run.capabilityReceiptHash,
              run.ledgerAuthorityReceipt, run.budgetReservation, run.approvalReceipt,
              run.isolatedWorkspace].every(text) || leases.has(run.leaseId)) return { allowed: false };
        leases.add(run.leaseId);
        const repetitions = cases.get(run.caseId) ?? new Set();
        if (repetitions.has(run.run)) return { allowed: false };
        repetitions.add(run.run);
        cases.set(run.caseId, repetitions);
        const lease = history.find(item => item.type === 'lease' && item.leaseId === run.leaseId);
        const authority = history.find(item => item.type === 'authorize' && item.leaseId === run.leaseId &&
          item.receipt === run.ledgerAuthorityReceipt);
        const native = history.find(item => item.type === 'native-authorize' && item.leaseId === run.leaseId &&
          item.receipt === run.ledgerAuthorityReceipt);
        if (!lease || !authority || !native || lease.taskId !== run.taskId ||
            lease.revision !== request.revision || authority.taskId !== run.taskId ||
            authority.revision !== request.revision || authority.worktreeReceipt !== run.worktreeReceipt ||
            authority.capabilityReceiptHash !== run.capabilityReceiptHash ||
            authority.budgetReservation !== run.budgetReservation ||
            authority.approvalReceipt !== run.approvalReceipt ||
            native.worktreeReceipt !== run.worktreeReceipt ||
            native.capabilityReceiptHash !== run.capabilityReceiptHash ||
            native.isolation !== 'git-worktree+local-os-sandbox' ||
            history.some(item => item.type === 'cancel-reconciled' && item.leaseId === run.leaseId)) {
          return { allowed: false };
        }
      }
      if (cases.size < 4 || [...cases.values()].some(repetitions => repetitions.size !== 3)) return { allowed: false };
      const proof = await verifyBenchmarkCapture(structuredClone(request));
      if (proof?.allStopped !== true || proof.revision !== request.revision ||
          proof.journalHash !== request.journalHash || proof.workerCount !== runs.length ||
          proof.receipt !== request.workerStopReceipt ||
          !Array.isArray(proof.cancelledLeases) || proof.cancelledLeases.length !== 0) return { allowed: false };
      return { allowed: true, revision: request.revision, corpusHash: request.corpusHash,
        reportSha256: request.reportSha256, workerStopReceipt: request.workerStopReceipt,
        runs, receipt: `benchmark-capture:${digest(request).slice(0, 32)}` };
    }),
    inspectBenchmarkCapture: async request => {
      if (!text(request?.receipt) || !text(request?.revision) ||
          !/^[a-f0-9]{64}$/.test(request?.corpusHash ?? '') ||
          !/^[a-f0-9]{64}$/.test(request?.reportSha256 ?? '') ||
          !text(request?.workerStopReceipt)) return { valid: false };
      const history = await events();
      const record = history.find(item => item.type === 'benchmark-capture-authorize' &&
        item.receipt === request.receipt && item.revision === request.revision &&
        item.corpusHash === request.corpusHash && item.reportSha256 === request.reportSha256 &&
        item.workerStopReceipt === request.workerStopReceipt);
      return record ? { valid: true, receipt: record.receipt, runs: record.runs } : { valid: false };
    },
    recordBenchmarkSnapshot: request => transact({ type: 'benchmark-snapshot', request }, async history => {
      if (!text(request?.captureReceipt) || !/^[a-f0-9]{64}$/.test(request?.corpusHash ?? '') ||
          !/^[a-f0-9]{64}$/.test(request?.reportSha256 ?? '') ||
          !/^[a-f0-9]{64}$/.test(request?.snapshotId ?? '')) return { allowed: false };
      const capture = history.find(item => item.type === 'benchmark-capture-authorize' &&
        item.receipt === request.captureReceipt && item.corpusHash === request.corpusHash &&
        item.reportSha256 === request.reportSha256);
      if (!capture || history.some(item => item.type === 'benchmark-snapshot' &&
          item.captureReceipt === request.captureReceipt)) return { allowed: false };
      return { allowed: true, ...request, receipt: `benchmark-snapshot:${digest(request).slice(0, 32)}` };
    }),
    reconcileCancelledLease: request => transact({ type: 'cancel-reconciled', request }, async history => {
      if (typeof verifyCancellation !== 'function' || !text(request?.taskId) || !text(request?.revision) ||
          !Number.isSafeInteger(request?.attempt) || !text(request?.leaseId) || !text(request?.journalHash) ||
          !text(request?.workerStopReceipt) || !text(request?.abandonedWorktreeReceipt) ||
          !text(request?.replacementWorktreeReceipt) ||
          request.abandonedWorktreeReceipt === request.replacementWorktreeReceipt ||
          !text(request?.inputRevision) || !text(request?.approvalReceipt) ||
          !text(request?.capabilityReceiptHash) || !text(request?.budgetReservation)) return { allowed: false };
      const lease = history.find(item => item.type === 'lease' && item.leaseId === request.leaseId);
      const authority = history.find(item => item.type === 'authorize' && item.leaseId === request.leaseId);
      const native = history.find(item => item.type === 'native-authorize' && item.leaseId === request.leaseId);
      if (!lease || !authority || !native || lease.taskId !== request.taskId ||
          lease.revision !== request.revision || lease.attempt !== request.attempt ||
          authority.budgetReservation !== request.budgetReservation ||
          authority.approvalReceipt !== request.approvalReceipt ||
          authority.capabilityReceiptHash !== request.capabilityReceiptHash ||
          authority.worktreeReceipt !== request.abandonedWorktreeReceipt ||
          native.worktreeReceipt !== request.abandonedWorktreeReceipt ||
          history.some(item => item.leaseId === request.leaseId &&
            ['commit-authorize', 'cancel-reconciled'].includes(item.type))) return { allowed: false };
      const proof = await verifyCancellation(structuredClone(request));
      if (proof?.valid !== true || Object.entries(request).some(([key, value]) => proof[key] !== value)) return { allowed: false };
      return { allowed: true, ...request, receipt: `cancellation:${digest(request).slice(0, 32)}` };
    }),
    inspectCancellation: async request => {
      if (!text(request?.taskId) || !text(request?.revision) || !text(request?.leaseId) ||
          !text(request?.receipt) || !text(request?.journalHash)) return { valid: false };
      const history = await events();
      const valid = history.some(item => item.type === 'cancel-reconciled' &&
        item.taskId === request.taskId && item.revision === request.revision &&
        item.leaseId === request.leaseId && item.receipt === request.receipt &&
        item.journalHash === request.journalHash &&
        Object.entries(request).every(([key, value]) => key === 'receipt' || item.request?.[key] === value));
      return { valid, ...request };
    },
    readCancellation: async request => {
      if (!text(request?.taskId) || !text(request?.revision) || !text(request?.leaseId) ||
          !text(request?.journalHash)) return { found: false };
      const history = await events();
      const record = history.find(item => item.type === 'cancel-reconciled' &&
        item.taskId === request.taskId && item.revision === request.revision &&
        item.leaseId === request.leaseId && item.journalHash === request.journalHash);
      return record ? { found: true, receipt: record.receipt, request: record.request } : { found: false };
    },
    // Recovery is read-only. It proves that journaled execution facts came from
    // this ledger before a caller may consider any work reusable.
    inspectRecovery: async request => {
      if (!text(request?.revision) || !text(request?.journalHash) || !Array.isArray(request?.authorizations) ||
          !Array.isArray(request?.commits)) return { allowed: false };
      const history = await events();
      const authorized = request.authorizations.every(proof => text(proof?.taskId) && text(proof?.leaseId) &&
        text(proof?.receipt) && text(proof?.capabilityReceiptHash) && history.some(event =>
          event.type === 'authorize' && event.taskId === proof.taskId && event.revision === request.revision &&
          event.leaseId === proof.leaseId && event.receipt === proof.receipt &&
          event.capabilityReceiptHash === proof.capabilityReceiptHash));
      const committed = request.commits.every(proof => text(proof?.taskId) && text(proof?.leaseId) &&
        text(proof?.receipt) && text(proof?.inputRevision) && text(proof?.capabilityReceiptHash) && history.some(event =>
          event.type === 'commit-authorize' && event.taskId === proof.taskId && event.revision === request.revision &&
          event.leaseId === proof.leaseId && event.receipt === proof.receipt &&
          event.inputRevision === proof.inputRevision &&
          event.capabilityReceiptHash === proof.capabilityReceiptHash));
      return { allowed: authorized && committed, revision: request.revision, journalHash: request.journalHash };
    },
  });
}
