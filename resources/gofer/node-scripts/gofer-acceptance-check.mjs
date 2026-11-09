import { spawn } from 'node:child_process';
import { mkdir, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const positive = value => Number.isSafeInteger(value) && value > 0;
const text = value => typeof value === 'string' && value.trim().length > 0;

/** Commands must come from reviewed host configuration, never worker output. */
export function createAcceptanceChecker({ workspaceRoot, evidenceDir, commands,
  getInputRevision, verifyCleanup, timeoutMs = 60000, maxOutputBytes = 65536 }) {
  if (!path.isAbsolute(workspaceRoot) || !path.isAbsolute(evidenceDir) ||
      !positive(timeoutMs) || timeoutMs > 3600000 || !positive(maxOutputBytes) || maxOutputBytes > 1048576 ||
      typeof getInputRevision !== 'function' || !commands || Array.isArray(commands)) throw new Error('INVALID_CHECK_CONFIGURATION');
  const approved = structuredClone(commands);
  for (const [id, command] of Object.entries(approved)) {
    if (!text(id) || !command || !path.isAbsolute(command.program) || /\.(?:cmd|bat)$/i.test(command.program) ||
        !Array.isArray(command.args) || command.args.length > 1000 ||
        command.args.some(arg => typeof arg !== 'string' || arg.includes('\0') || arg.length > 65536)) throw new Error('INVALID_APPROVED_COMMAND');
  }
  return async function check(request) {
    const { taskId, revision, inputRevision, signal, check: checkId } = request;
    request = Object.freeze({ taskId, revision, inputRevision, signal, check: checkId });
    if (!/^T\d+$/.test(taskId) || !text(revision) || !text(inputRevision) || !Object.hasOwn(approved, checkId)) throw new Error('UNAPPROVED_CHECK');
    const command = approved[checkId];
    const readRevision = async () => {
      let timer;
      try { return await Promise.race([
        Promise.resolve().then(() => getInputRevision(request)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('INPUT_CHECK_TIMEOUT')), timeoutMs); }),
      ]); } finally { clearTimeout(timer); }
    };
    const cwd = await realpath(workspaceRoot);
    if (await readRevision() !== inputRevision) throw new Error('STALE_INPUT');
    await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
    const evidenceRoot = await realpath(evidenceDir);
    if (signal?.aborted) throw new Error('CANCELLED');
    const startedAt = new Date().toISOString();
    const result = await new Promise(resolve => {
      let child;
      let timer;
      let killTimer;
      let settlementTimer;
      let reason = null;
      let bytes = 0;
      const captured = Buffer.alloc(maxOutputBytes);
      let settled = false;
      const stop = cause => {
        if (reason) return;
        reason = cause;
        if (!child?.pid) return;
        if (process.platform === 'win32') {
          // Kill only the tree started by this check, never a port or process name.
          const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'], { shell: false, stdio: 'ignore', windowsHide: true });
          killer.on('error', () => { child.kill(); });
          killer.unref();
        } else {
          try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
          killTimer ??= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }, 250);
        }
        settlementTimer = setTimeout(() => {
          child.stdout.destroy(); child.stderr.destroy(); child.unref();
          finish(null, new Error('CLEANUP_UNVERIFIED'));
        }, 1000);
      };
      const cancel = () => stop('cancelled');
      const finish = (code, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // After the parent exits, still terminate any surviving local descendants.
        if (process.platform !== 'win32' && child?.pid) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Tree has exited. */ }
        }
        clearTimeout(killTimer);
        clearTimeout(settlementTimer);
        signal?.removeEventListener('abort', cancel);
        resolve({ executed: !!child?.pid, pid: child?.pid ?? null, exitCode: reason || error ? 1 : code ?? 1,
          reason: reason || (error ? 'spawn-failed' : code === 0 ? 'passed' : 'failed'),
          output: captured.toString('utf8', 0, bytes), capturedBytes: bytes });
      };
      if (signal?.aborted) { reason = 'cancelled'; finish(null); return; }
      // No shell, credential flags or inherited stdin. The reviewed process owns its side effects.
      child = spawn(command.program, command.args, { cwd, shell: false, detached: process.platform !== 'win32',
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const collect = data => {
        const remaining = Math.max(0, maxOutputBytes - bytes);
        const accepted = Math.min(data.length, remaining);
        if (accepted) { data.copy(captured, bytes, 0, accepted); bytes += accepted; }
        if (data.length > remaining) stop('output-limit');
      };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      child.on('error', error => finish(null, error));
      child.on('close', code => finish(code));
      signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => stop('timeout'), timeoutMs);
      if (signal?.aborted) cancel();
    });
    if (signal?.aborted) { result.exitCode = 1; result.reason = 'cancelled'; }
    try {
      if (await readRevision() !== inputRevision) { result.exitCode = 1; result.reason = 'stale-input'; }
    } catch { result.exitCode = 1; result.reason = 'input-unverifiable'; }
    // A closed parent does not prove detached descendants or remote work stopped.
    let cleanup;
    let cleanupTimer;
    try {
      cleanup = await Promise.race([
        Promise.resolve().then(() => verifyCleanup?.({ ...request, pid: result.pid, startedAt })),
        new Promise(resolve => { cleanupTimer = setTimeout(() => resolve(null), 1000); }),
      ]);
    } catch { cleanup = null; } finally { clearTimeout(cleanupTimer); }
    const cleanupVerified = cleanup?.allStopped === true && cleanup.pid === result.pid &&
      cleanup.startedAt === startedAt && text(cleanup.receipt);
    if (!cleanupVerified && result.exitCode === 0) { result.exitCode = 1; result.reason = 'cleanup-unverified'; }
    if (signal?.aborted) { result.exitCode = 1; result.reason = 'cancelled'; }
    const record = { schemaVersion: 1, taskId, revision, inputRevision, check: checkId,
      ...result, startedAt, finishedAt: new Date().toISOString(),
      cleanupVerified, cleanupReceipt: cleanupVerified ? cleanup.receipt : null,
      outputSha256: createHash('sha256').update(result.output).digest('hex'),
      command: { program: command.program, args: command.args }, evidenceKind: 'local-command', nativeModelProof: false };
    const receipt = path.join(evidenceRoot, `${taskId}-${randomUUID()}.json`);
    const file = await open(receipt, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(record, null, 2));
      await file.sync();
      // Cancellation can arrive while evidence is being persisted. Rewrite the
      // receipt so a successful result can never survive that cancellation.
      if (signal?.aborted) {
        record.exitCode = 1;
        record.reason = 'cancelled';
        const body = JSON.stringify(record, null, 2);
        await file.truncate(0);
        await file.write(body, 0, 'utf8');
        await file.truncate(Buffer.byteLength(body));
        await file.sync();
      }
    } finally { await file.close(); }
    // Keep raw command output in the private receipt, not in the model context.
    return { taskId, revision, inputRevision, check: checkId, executed: result.executed,
      exitCode: result.exitCode, reason: result.reason, receipt, cleanupVerified, evidenceKind: 'local-command', nativeModelProof: false };
  };
}
