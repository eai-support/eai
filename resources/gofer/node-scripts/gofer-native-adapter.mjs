/** Native adapter primitives. They create real Git worktree isolation and
 * require a ledger authority record before a host integration can start work. */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { capabilityReceiptHash, verifyCapabilityReceipt } from './gofer-host-capability.mjs';
import { codexIsolatedPermissionArgs, verifyLocalIsolationReport } from './gofer-local-isolation.mjs';

const execFileAsync = promisify(execFile);
const text = value => typeof value === 'string' && value.trim().length > 0;
const QUALIFIED_LOCAL_ISOLATION = 'git-worktree+local-os-sandbox';
function processGroupAlive(processGroupId) {
  try { process.kill(-processGroupId, 0); return true; }
  catch (error) { return error?.code !== 'ESRCH'; }
}
const sameScope = (left, right) => Array.isArray(left) && Array.isArray(right) &&
  left.length === right.length && left.every((value, index) => value === right[index]);
const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'].includes(key)));

async function git(directory, args) {
  return execFileAsync('git', ['-C', directory, ...args], { encoding: 'utf8', env: gitEnvironment });
}

function safeScope(scope) {
  return text(scope) && !/(^\/|\\|\0|(^|\/)\.\.?(?:\/|$))/.test(scope);
}

function boundedCollector(limit = 1024 * 1024) {
  let value = '';
  return {
    add(chunk) { value = `${value}${chunk}`.slice(-limit); },
    value: () => value,
  };
}

function tokenUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const inputTokens = value.input_tokens ?? value.inputTokens;
  const cachedInputTokens = value.cached_input_tokens ?? value.cachedInputTokens ?? 0;
  const outputTokens = value.output_tokens ?? value.outputTokens;
  if (![inputTokens, cachedInputTokens, outputTokens].every(item => Number.isInteger(item) && item >= 0)) return null;
  return Object.freeze({ inputTokens, cachedInputTokens, outputTokens });
}

function extractTokenUsage(jsonl) {
  const findings = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    const direct = tokenUsage(value);
    if (direct) findings.push(direct);
    for (const item of Object.values(value)) visit(item);
  };
  for (const line of jsonl.split(/\r?\n/)) {
    try { visit(JSON.parse(line)); } catch { /* Non-JSON host diagnostics are not usage evidence. */ }
  }
  return findings.at(-1) ?? null;
}

/** The Codex host profile: what differs between hosts is only how a host is
 * launched, how its sandbox is described, and how its result is read. The
 * process-group evidence, Git baseline and scope checks are shared. */
export const CODEX_HOST = Object.freeze({
  name: 'codex',
  sandboxPolicy: workspace => codexIsolatedPermissionArgs(workspace),
  buildArgs: ({ sandboxPolicy, outputPath, modelId, prompt }) => ['--ask-for-approval', 'never', 'exec',
    '--ignore-user-config', ...sandboxPolicy.config.flatMap(value => ['-c', value]),
    '--json', '--output-last-message', outputPath, '--model', modelId, prompt],
  finalMessage: ({ outputPath }) => readFile(outputPath, 'utf8').catch(() => ''),
  extractUsage: stdoutText => extractTokenUsage(stdoutText),
});

/**
 * Start a real local host process in a pre-created isolated worktree. This
 * primitive deliberately has no fallback host or cloud mode. Its receipt is
 * only available after the child has exited, so a cancellation cannot be
 * reported as confirmed while the host still owns the worktree.
 */
export async function startLocalHostInvocation({ host, isolatedWorkspace, prompt, modelId,
  capabilityReceiptHash, allowedWriteScope, command, spawnProcess = spawn,
  receiptDirectory = tmpdir(), evidenceDirectory, objectiveRevision, leaseId,
  worktreeReceipt, expectedHead, signalProcessGroup = (pid, signal) => process.kill(-pid, signal),
  usageReporting = false, hostOptions = {} } = {}) {
  if (!/^[a-z]{3,16}$/.test(host?.name ?? '') || typeof host.sandboxPolicy !== 'function' ||
      typeof host.buildArgs !== 'function' || typeof host.finalMessage !== 'function' ||
      typeof host.extractUsage !== 'function') throw new Error('INVALID_NATIVE_HOST');
  if (!text(isolatedWorkspace) || !text(prompt) || !text(modelId) || !text(capabilityReceiptHash) ||
      !Array.isArray(allowedWriteScope) || !allowedWriteScope.length ||
      allowedWriteScope.some(scope => !safeScope(scope)) || !text(command) ||
      (evidenceDirectory && (![objectiveRevision, leaseId, worktreeReceipt].every(text)))) throw new Error('INVALID_NATIVE_REQUEST');
  const workspace = await realpath(isolatedWorkspace);
  const sandboxPolicy = host.sandboxPolicy(workspace, hostOptions);
  if (!sandboxPolicy) throw new Error('LOCAL_SANDBOX_REQUIRED');
  const outputRoot = await realpath(receiptDirectory);
  // A clean file-status result does not reveal a commit or a new branch made
  // by the worker. Capture both HEAD and shared refs before native execution.
  const gitBaseline = await Promise.all([
    git(workspace, ['rev-parse', 'HEAD']),
    git(workspace, ['for-each-ref', '--format=%(refname) %(objectname)']),
  ]).then(([head, refs]) => ({ head: head.stdout.trim(), refs: refs.stdout })).catch(() => null);
  if (expectedHead && gitBaseline?.head !== expectedHead) throw new Error('NATIVE_GIT_BASELINE_MISMATCH');
  let evidenceRoot;
  if (evidenceDirectory) {
    if (process.platform === 'win32') throw new Error('NATIVE_PROCESS_GROUP_UNAVAILABLE');
    const requested = path.join(await realpath(path.dirname(path.resolve(evidenceDirectory))),
      path.basename(evidenceDirectory));
    const requestedRelative = path.relative(workspace, requested);
    if (requestedRelative === '' || (!requestedRelative.startsWith('..') && !path.isAbsolute(requestedRelative))) {
      throw new Error('NATIVE_EVIDENCE_INSIDE_WORKTREE');
    }
    await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
    evidenceRoot = await realpath(evidenceDirectory);
    const relative = path.relative(workspace, evidenceRoot);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error('NATIVE_EVIDENCE_INSIDE_WORKTREE');
    }
  }
  const outputPath = path.join(outputRoot, `gofer-${host.name}-${randomUUID()}.md`);
  const args = host.buildArgs({ sandboxPolicy, outputPath, modelId, prompt, allowedWriteScope,
    workspace, hostOptions });
  const stdout = boundedCollector();
  const stderr = boundedCollector();
  let child;
  let exit = null;
  let cancelRequested = false;
  let fatal = null;
  let completion;
  const invocationId = `${host.name}-${randomUUID()}`;
  const evidencePath = evidenceRoot ? path.join(evidenceRoot, `native-worker-${invocationId}.jsonl`) : null;
  const receiptFor = async () => {
    const message = await host.finalMessage({ outputPath, stdout: stdout.value() });
    return createHash('sha256').update(JSON.stringify({ invocationId, capabilityReceiptHash, modelId,
      allowedWriteScope, exit, stdout: stdout.value(), stderr: stderr.value(), message })).digest('hex');
  };
  // A host may write a per-task policy file before it starts.
  await host.beforeStart?.({ workspace, sandboxPolicy, hostOptions });
  try {
    child = spawnProcess(command, args, { cwd: workspace, shell: false, detached: Boolean(evidenceRoot),
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      ...(typeof host.env === 'function' ? { env: host.env(process.env) } : {}) });
  } catch (error) {
    throw new Error(`NATIVE_HOST_START_FAILED:${error.message}`);
  }
  if (!child || typeof child.once !== 'function' || typeof child.kill !== 'function') throw new Error('NATIVE_HOST_START_FAILED');
  if (evidencePath && (!Number.isSafeInteger(child.pid) || child.pid <= 0)) {
    child.kill('SIGTERM');
    throw new Error('NATIVE_PROCESS_ID_REQUIRED');
  }
  const startEvidence = evidencePath ? (async () => {
    const file = await open(evidencePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await file.writeFile(`${JSON.stringify({ schemaVersion: 1, event: 'started', invocationId,
        objectiveRevision, leaseId, worktreeReceipt, capabilityReceiptHash, modelId,
        isolatedWorkspace: workspace, pid: child.pid, processGroupId: child.pid,
        at: new Date().toISOString() })}\n`);
      await file.sync();
    } finally { await file.close(); }
  })() : Promise.resolve();
  child.stdout?.on('data', chunk => stdout.add(chunk));
  child.stderr?.on('data', chunk => {
    stderr.add(chunk);
    // A sandbox that fails to apply must never be allowed to run unsandboxed.
    if (!fatal && host.fatalStderr?.test(String(chunk))) {
      fatal = 'NATIVE_HOST_SANDBOX_NOT_APPLIED';
      // A single group signal can miss a child that was starting at that moment,
      // so keep killing until the group is empty.
      (async () => {
        for (let attempt = 0; attempt < 30; attempt++) {
          try { if (evidencePath) signalProcessGroup(child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already gone */ }
          await new Promise(resolve => setTimeout(resolve, 50));
          if (evidencePath ? !processGroupAlive(child.pid) : exit !== null) return;
        }
      })();
    }
  });
  completion = new Promise((resolve, reject) => {
    child.once('error', error => reject(new Error(`NATIVE_HOST_START_FAILED:${error.message}`)));
    child.once('close', async (code, signal) => {
      exit = { code, signal };
      // The host has stopped: remove anything it needed from the worktree.
      try { await host.cleanup?.({ workspace, sandboxPolicy, hostOptions }); } catch { /* reported by the scope check */ }
      try {
        await startEvidence;
        if (evidencePath) {
          const file = await open(evidencePath, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
          try {
            await file.writeFile(`${JSON.stringify({ schemaVersion: 1, event: 'stopped', invocationId,
              pid: child.pid, processGroupId: child.pid, cancelled: cancelRequested, exit, receipt: await receiptFor(),
              at: new Date().toISOString() })}\n`);
            await file.sync();
          } finally { await file.close(); }
        }
        resolve();
      } catch (error) { reject(error); }
    });
  });
  await startEvidence.catch(error => {
    if (evidencePath) signalProcessGroup(child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
    throw new Error(`NATIVE_EVIDENCE_UNAVAILABLE:${error.message}`);
  });
  return Object.freeze({
    invocationId,
    evidencePath,
    async cancel() {
      if (exit !== null) throw new Error('CANCELLATION_ALREADY_EXITED');
      cancelRequested = true;
      if (exit === null) {
        try {
          if (evidencePath) signalProcessGroup(child.pid, 'SIGTERM');
          else if (child.kill('SIGTERM') === false) throw new Error('CANCELLATION_DELIVERY_REQUIRED');
        } catch { throw new Error('CANCELLATION_DELIVERY_REQUIRED'); }
      }
      await completion;
      if (evidencePath) {
        for (let attempt = 0; attempt < 20 && processGroupAlive(child.pid); attempt++) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (processGroupAlive(child.pid)) throw new Error('CANCELLATION_CONFIRMATION_REQUIRED');
      }
    },
    async inspect() {
      if (exit === null) return { invocationId, cancelled: false, receipt: null, state: 'running' };
      await completion;
      if (evidencePath && processGroupAlive(child.pid)) {
        return { invocationId, cancelled: false, receipt: null, state: 'unresolved' };
      }
      return { invocationId, cancelled: cancelRequested, receipt: await receiptFor(), state: 'exited', exit: { ...exit } };
    },
    async wait() {
      await completion;
      const receipt = await receiptFor();
      if (cancelRequested) {
        if (evidencePath && processGroupAlive(child.pid)) throw new Error('CANCELLATION_CONFIRMATION_REQUIRED');
        return { invocationId, capabilityReceiptHash, receipt, cancelled: true };
      }
      if (fatal) throw new Error(fatal);
      if (exit?.code !== 0) throw new Error(`NATIVE_HOST_EXIT:${exit?.code ?? 'signal'}`);
      host.assertSuccess?.(stdout.value(), stderr.value());
      if (!gitBaseline) throw new Error('NATIVE_GIT_BASELINE_REQUIRED');
      const [head, refs] = await Promise.all([
        git(workspace, ['rev-parse', 'HEAD']),
        git(workspace, ['for-each-ref', '--format=%(refname) %(objectname)']),
      ]);
      if (head.stdout.trim() !== gitBaseline.head || refs.stdout !== gitBaseline.refs) {
        throw new Error('NATIVE_UNAUTHORIZED_GIT_CHANGE');
      }
      await host.afterExit?.({ workspace, sandboxPolicy, hostOptions });
      const status = await git(workspace, ['-c', 'status.renames=false', 'status', '--porcelain=v1', '-z',
        '--untracked-files=all', '--ignored=matching']);
      const entries = status.stdout.split('\0').filter(Boolean);
      if (entries.some(entry => entry.length < 4 || entry[2] !== ' ')) throw new Error('NATIVE_STATUS_UNAVAILABLE');
      const changedFiles = [...new Set(entries.map(entry => entry.slice(3)))];
      if (changedFiles.some(file => !allowedWriteScope.some(scope => file === scope.replace(/\/$/, '') || file.startsWith(`${scope.replace(/\/$/, '')}/`)))) {
        throw new Error('NATIVE_SCOPE_VIOLATION');
      }
      return Object.freeze({ invocationId, capabilityReceiptHash, receipt, changedFiles,
        outputPath, isolation: QUALIFIED_LOCAL_ISOLATION,
        usage: usageReporting ? host.extractUsage(stdout.value()) : undefined });
    },
  });
}

/** Start a real local Codex process. Kept as the stable entry point. */
export function startLocalCodexInvocation(options = {}) {
  return startLocalHostInvocation({ ...options, host: CODEX_HOST, command: options.command ?? 'codex' });
}

/** A missing, incomplete, or still-running process never becomes a stop proof. */
export async function inspectNativeWorkerEvidence({ evidenceDirectory, revision, journalHash,
  authorizations, probeProcess = processGroupId => {
    if (process.platform === 'win32') return true;
    return processGroupAlive(processGroupId);
  } } = {}) {
  const denied = { allStopped: false, revision, journalHash, receipt: null };
  if (![evidenceDirectory, revision, journalHash].every(text) || !Array.isArray(authorizations) ||
      !authorizations.length || typeof probeProcess !== 'function') return denied;
  let root;
  try { root = await realpath(evidenceDirectory); } catch { return denied; }
  const names = await readdir(root);
  if (names.length > 1000 || names.some(name => !/^native-worker-(?:codex|claude|grok)-[0-9a-f-]+\.jsonl$/.test(name))) return denied;
  const records = [];
  for (const name of names) {
    const file = await open(path.join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
    if (!file) return denied;
    let raw;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 65536) return denied;
      raw = await file.readFile('utf8');
    } finally { await file.close(); }
    if (!raw.endsWith('\n')) return denied;
    let events;
    try { events = raw.trimEnd().split('\n').map(line => JSON.parse(line)); }
    catch { return denied; }
    if (events.length !== 2 || events[0]?.schemaVersion !== 1 || events[0].event !== 'started' ||
        events[1]?.schemaVersion !== 1 || events[1].event !== 'stopped' ||
        events[0].invocationId !== events[1].invocationId ||
        events[0].pid !== events[1].pid || !Number.isSafeInteger(events[0].pid) || events[0].pid <= 0 ||
        events[0].processGroupId !== events[0].pid || events[1].processGroupId !== events[0].pid ||
        !text(events[1].receipt) || events[0].objectiveRevision !== revision) return denied;
    if (await probeProcess(events[0].processGroupId) !== false) return denied;
    records.push({ started: events[0], stopped: events[1] });
  }
  if (!records.length || authorizations.some(authority =>
    !text(authority?.leaseId) || !text(authority?.worktreeReceipt) ||
    records.filter(record => record.started.leaseId === authority.leaseId &&
      record.started.capabilityReceiptHash === authority.capabilityReceiptHash &&
      record.started.worktreeReceipt === authority.worktreeReceipt &&
      (!authority.isolatedWorkspace || record.started.isolatedWorkspace === authority.isolatedWorkspace)).length !== 1)) return denied;
  const receipt = `worker-stop:${createHash('sha256').update(JSON.stringify({ revision, journalHash,
    records: records.map(record => ({ invocationId: record.started.invocationId,
      leaseId: record.started.leaseId, pid: record.started.pid,
      cancelled: record.stopped.cancelled, receipt: record.stopped.receipt }))
      .sort((left, right) => left.invocationId.localeCompare(right.invocationId)) })).digest('hex')}`;
  return { allStopped: true, revision, journalHash, receipt, workerCount: records.length,
    cancelledLeases: records.filter(record => record.stopped.cancelled === true).map(record => record.started.leaseId) };
}

/** Bind benchmark capture to the controller-owned worker evidence directory.
 * Workers cannot choose the directory or declare their own stopped state. */
export function createNativeBenchmarkCaptureVerifier({ evidenceDirectory } = {}) {
  if (!text(evidenceDirectory) || !path.isAbsolute(evidenceDirectory)) {
    throw new Error('BENCHMARK_CAPTURE_EVIDENCE_REQUIRED');
  }
  return request => inspectNativeWorkerEvidence({ evidenceDirectory,
    revision: request?.revision, journalHash: request?.journalHash,
    authorizations: request?.runs?.map(run => ({ leaseId: run.leaseId,
      capabilityReceiptHash: run.capabilityReceiptHash,
      worktreeReceipt: run.worktreeReceipt,
      isolatedWorkspace: run.isolatedWorkspace })) });
}

/**
 * Adapt the verified graph's `execute` seam to a real Codex invocation. The
 * caller supplies the durable ledger assertion; this adapter refuses to run
 * if it cannot reproduce the graph's just-issued authority receipt. This
 * prevents a caller from substituting a safe-looking local launcher after
 * the graph has authorised a different task, scope, lease, or approval.
 */
export function createLedgerBoundCodexExecutor({ isolatedWorkspace, worktreeReceipt, expectedHead, capabilityReceipt, capabilityPublicKey,
  requiredCapabilities, assertLedger, promptForRequest, start = startLocalCodexInvocation } = {}) {
  if (!text(isolatedWorkspace) || !text(worktreeReceipt) || !capabilityReceipt || !capabilityPublicKey ||
      typeof assertLedger !== 'function' || typeof promptForRequest !== 'function' || typeof start !== 'function') {
    throw new Error('NATIVE_EXECUTOR_CONFIGURATION_REQUIRED');
  }
  return Object.freeze({
    worktreeReceipt,
    async execute(request) {
      if (!request || !text(request.revision) || !text(request.taskId) || !text(request.ledgerAuthorityReceipt) ||
          !text(request.selectedModel) || !Array.isArray(request.allowedEditScope) ||
          request.worktreeReceipt !== worktreeReceipt) throw new Error('LEDGER_AUTHORITY_REQUIRED');
      const prompt = await promptForRequest(Object.freeze({ ...request }));
      if (!text(prompt)) throw new Error('NATIVE_PROMPT_REQUIRED');
      return invokeLedgerBoundNative({
        request: {
          objectiveRevision: request.revision,
          allowedWriteScope: request.allowedEditScope,
          leaseId: request.leaseId,
          budgetReservation: request.budgetReservation,
          approvalReceipt: request.approvalReceipt,
          worktreeReceipt,
          usageReporting: request.usageReporting === true,
        },
        capabilityReceipt,
        capabilityPublicKey,
        requiredCapabilities,
        assertLedger: async nativeRequest => {
          const authority = await assertLedger(Object.freeze({ ...request, ...nativeRequest }));
          if (authority?.receipt !== request.ledgerAuthorityReceipt) throw new Error('LEDGER_AUTHORITY_REQUIRED');
          return authority;
        },
        start: nativeRequest => start({ isolatedWorkspace, expectedHead, prompt, modelId: request.selectedModel,
          allowedWriteScope: request.allowedEditScope, ...nativeRequest }),
        signal: request.signal,
      });
    },
  });
}

export async function createVerifiedWorktree({ workspaceRoot, host, localIsolation, baseRef = 'HEAD', temporaryRoot = tmpdir() } = {}) {
  if (!text(workspaceRoot) || !text(baseRef) || baseRef.startsWith('-')) throw new Error('INVALID_ISOLATION_REQUEST');
  if (typeof localIsolation !== 'function') throw new Error('LOCAL_SANDBOX_REQUIRED');
  const workspace = await realpath(workspaceRoot);
  const temporary = await realpath(temporaryRoot);
  const relativeTemporary = path.relative(workspace, temporary);
  if (relativeTemporary === '' || (!relativeTemporary.startsWith('..') && !path.isAbsolute(relativeTemporary))) {
    throw new Error('ISOLATION_ROOT_INSIDE_WORKSPACE');
  }
  const repository = (await git(workspace, ['rev-parse', '--is-inside-work-tree'])).stdout.trim();
  if (repository !== 'true') throw new Error('WORKSPACE_IS_NOT_GIT');
  const destination = await mkdtemp(path.join(temporary, 'gofer-isolated-worktree-'));
  try {
    await git(workspace, ['worktree', 'add', '--detach', destination, baseRef]);
    const isolated = await realpath(destination);
    if (isolated === workspace) throw new Error('ISOLATION_PATH_REUSED');
    const [head, expected] = await Promise.all([
      git(isolated, ['rev-parse', 'HEAD']), git(workspace, ['rev-parse', baseRef]),
    ]);
    if (head.stdout.trim() !== expected.stdout.trim()) throw new Error('ISOLATION_REVISION_MISMATCH');
    const report = await localIsolation(Object.freeze({ host, workspaceRoot: isolated }));
    if (!verifyLocalIsolationReport(report, { host, workspaceRoot: isolated }) ||
        !text(report.nativeExecutable) || !path.isAbsolute(report.nativeExecutable)) {
      throw new Error('LOCAL_SANDBOX_REQUIRED');
    }
    const status = await git(isolated, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']);
    if (status.stdout.trim() !== '') throw new Error('ISOLATION_PREFLIGHT_CHANGED_WORKTREE');
    const receipt = worktreeReceipt(workspace, isolated, head.stdout.trim());
    return Object.freeze({ isolationClass: 'git-worktree+local-os-sandbox', workspace, isolatedWorkspace: isolated,
      nativeExecutable: report.nativeExecutable, revision: head.stdout.trim(), receipt });
  } catch (error) {
    await git(workspace, ['worktree', 'remove', '--force', destination]).catch(() => {});
    throw error;
  }
}

function worktreeReceipt(workspace, isolated, revision) {
  return `git-worktree:${createHash('sha256').update(JSON.stringify({ workspace, isolated, revision })).digest('hex')}`;
}

/** Recheck a worktree before it is named in a cancellation reconciliation. */
export async function inspectVerifiedWorktree({ workspaceRoot, isolatedWorkspace, revision, receipt, requireClean = false } = {}) {
  if (![workspaceRoot, isolatedWorkspace, revision, receipt].every(text)) return { valid: false };
  const workspace = await realpath(workspaceRoot);
  const isolated = await realpath(isolatedWorkspace);
  if (workspace === isolated || worktreeReceipt(workspace, isolated, revision) !== receipt) return { valid: false };
  const [head, listed, status] = await Promise.all([
    git(isolated, ['rev-parse', 'HEAD']),
    git(workspace, ['worktree', 'list', '--porcelain']),
    git(isolated, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']),
  ]);
  const comparablePath = value => process.platform === 'win32'
    ? path.normalize(value.trim()).toLowerCase() : path.normalize(value.trim());
  const registered = [...listed.stdout.matchAll(/^worktree (.+)$/gm)]
    .some(match => comparablePath(match[1]) === comparablePath(isolated));
  const clean = status.stdout.trim() === '';
  if (!registered || head.stdout.trim() !== revision || (requireClean && !clean)) return { valid: false };
  return Object.freeze({ valid: true, receipt, revision, isolatedWorkspace: isolated, clean,
    statusHash: createHash('sha256').update(status.stdout).digest('hex') });
}

/** Remove only a matching, clean task worktree after its controller has closed. */
export async function disposeVerifiedWorktree({ workspaceRoot, isolatedWorkspace, revision, receipt } = {}) {
  const inspection = await inspectVerifiedWorktree({ workspaceRoot, isolatedWorkspace,
    revision, receipt, requireClean: true });
  if (!inspection.valid) throw new Error('WORKTREE_DISPOSAL_REQUIRES_CLEAN_VERIFIED_STATE');
  await git(workspaceRoot, ['worktree', 'remove', isolatedWorkspace]);
}

/** Bind ledger cancellation authority to independently inspected local state. */
export function createNativeCancellationVerifier({ workspaceRoot, abandonedWorkspace,
  replacementWorkspace, worktreeRevision, evidenceDirectory, inspectInputRevision } = {}) {
  if (![workspaceRoot, abandonedWorkspace, replacementWorkspace, worktreeRevision, evidenceDirectory].every(text) ||
      typeof inspectInputRevision !== 'function') throw new Error('NATIVE_CANCELLATION_VERIFIER_CONFIGURATION_REQUIRED');
  return async request => {
    const denied = { valid: false };
    if (![request?.taskId, request?.revision, request?.leaseId, request?.journalHash,
      request?.workerStopReceipt, request?.abandonedWorktreeReceipt,
      request?.replacementWorktreeReceipt, request?.capabilityReceiptHash,
      request?.inputRevision].every(text)) return denied;
    try {
      const [oldWorktree, newWorktree, evidenceRoot] = await Promise.all([
        inspectVerifiedWorktree({ workspaceRoot, isolatedWorkspace: abandonedWorkspace,
          revision: worktreeRevision, receipt: request.abandonedWorktreeReceipt }),
        inspectVerifiedWorktree({ workspaceRoot, isolatedWorkspace: replacementWorkspace,
          revision: worktreeRevision, receipt: request.replacementWorktreeReceipt, requireClean: true }),
        realpath(evidenceDirectory),
      ]);
      if (!oldWorktree.valid || !newWorktree.valid ||
          oldWorktree.isolatedWorkspace === newWorktree.isolatedWorkspace ||
          oldWorktree.receipt === newWorktree.receipt) return denied;
      for (const worktree of [oldWorktree, newWorktree]) {
        const relative = path.relative(worktree.isolatedWorkspace, evidenceRoot);
        if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return denied;
      }
      const workers = await inspectNativeWorkerEvidence({ evidenceDirectory: evidenceRoot,
        revision: request.revision, journalHash: request.journalHash,
        authorizations: [{ leaseId: request.leaseId,
          capabilityReceiptHash: request.capabilityReceiptHash,
          worktreeReceipt: request.abandonedWorktreeReceipt,
          isolatedWorkspace: oldWorktree.isolatedWorkspace }] });
      if (!workers.allStopped || workers.receipt !== request.workerStopReceipt ||
          !workers.cancelledLeases.includes(request.leaseId)) return denied;
      const currentInput = await inspectInputRevision(Object.freeze({ taskId: request.taskId,
        revision: request.revision, isolatedWorkspace: newWorktree.isolatedWorkspace,
        worktreeReceipt: newWorktree.receipt }));
      if (currentInput !== request.inputRevision) return denied;
      return { ...request, valid: true };
    } catch { return denied; }
  };
}

/**
 * Execute only after a ledger service binds the exact objective revision,
 * scope, receipt hash, lease, budget and approval state. Cancellation must be
 * delivered and independently confirmed before an aborted invocation returns.
 */
export async function invokeLedgerBoundNative({ request, capabilityReceipt, capabilityPublicKey,
  requiredCapabilities, assertLedger, start, signal } = {}) {
  if (!request || !capabilityReceipt || typeof assertLedger !== 'function' || typeof start !== 'function' ||
      !text(request.objectiveRevision) || !Array.isArray(request.allowedWriteScope) || !text(request.leaseId) ||
      !text(request.budgetReservation) || !text(request.approvalReceipt)) throw new Error('LEDGER_AUTHORITY_REQUIRED');
  if (capabilityReceipt?.isolationClass !== QUALIFIED_LOCAL_ISOLATION ||
      !verifyCapabilityReceipt(capabilityReceipt, { publicKey: capabilityPublicKey,
        host: 'codex', requiredCapabilities })) {
    throw new Error('CAPABILITY_RECEIPT_REQUIRED');
  }
  const receiptHash = capabilityReceiptHash(capabilityReceipt);
  const authority = await assertLedger({ ...request, capabilityReceiptHash: receiptHash });
  if (authority?.allowed !== true || authority.objectiveRevision !== request.objectiveRevision ||
      authority.capabilityReceiptHash !== receiptHash || authority.leaseId !== request.leaseId ||
      authority.budgetReservation !== request.budgetReservation || authority.approvalReceipt !== request.approvalReceipt ||
      authority.worktreeReceipt !== request.worktreeReceipt ||
      !sameScope(authority.allowedWriteScope, request.allowedWriteScope) ||
      authority.isolation !== capabilityReceipt.isolationClass) {
    throw new Error('LEDGER_AUTHORITY_REQUIRED');
  }
  const invocation = await start(Object.freeze({ ...request, capabilityReceiptHash: receiptHash }));
  if (!text(invocation?.invocationId) || typeof invocation.wait !== 'function' || typeof invocation.cancel !== 'function' ||
      typeof invocation.inspect !== 'function') {
    if (typeof invocation?.cancel === 'function') await invocation.cancel();
    if (typeof invocation?.inspect === 'function') {
      const state = await invocation.inspect();
      if (state?.invocationId !== invocation.invocationId || state?.cancelled !== true || !text(state?.receipt)) {
        throw new Error('CANCELLATION_CONFIRMATION_REQUIRED');
      }
    } else if (invocation) {
      throw new Error('CANCELLATION_CONFIRMATION_REQUIRED');
    }
    throw new Error('NATIVE_INVOCATION_REQUIRED');
  }
  let cancelPromise;
  const cancel = () => {
    if (!cancelPromise) {
      cancelPromise = (async () => {
        await invocation.cancel();
        const state = await invocation.inspect();
        if (state?.invocationId !== invocation.invocationId || state?.cancelled !== true || !text(state?.receipt)) {
          throw new Error('CANCELLATION_CONFIRMATION_REQUIRED');
        }
      })();
    }
    return cancelPromise;
  };
  if (signal?.aborted) await cancel();
  const listener = () => { cancel().catch(() => {}); };
  signal?.addEventListener('abort', listener, { once: true });
  try {
    const result = await invocation.wait();
    if (signal?.aborted) await cancel();
    if (cancelPromise) {
      await cancelPromise;
      throw new Error('NATIVE_INVOCATION_CANCELLED');
    }
    if (result?.invocationId !== invocation.invocationId || result?.capabilityReceiptHash !== receiptHash || !text(result?.receipt)) {
      throw new Error('NATIVE_INVOCATION_UNVERIFIED');
    }
    return Object.freeze({ ...result, capabilityReceiptHash: receiptHash, isolation: authority.isolation });
  } finally {
    signal?.removeEventListener('abort', listener);
    if (cancelPromise) await cancelPromise;
  }
}
