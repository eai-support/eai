/**
 * Production composition root for verified local native execution. It does
 * not manufacture authority: callers must provide one durable ledger that
 * governs both graph dispatch and the host launch.
 */
import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { createVerifiedWorktree, inspectVerifiedWorktree, disposeVerifiedWorktree, createLedgerBoundCodexExecutor, startLocalCodexInvocation,
  inspectNativeWorkerEvidence, createNativeCancellationVerifier, createNativeBenchmarkCaptureVerifier } from './gofer-native-adapter.mjs';
import { createRuntimeLedger } from './gofer-runtime-ledger.mjs';
import { captureConfiguredHeldOutResultSnapshot } from './gofer-heldout-snapshot.mjs';
import { reconcileCancelledExecution } from './gofer-execution-recovery.mjs';
import { runVerifiedGraph } from './gofer-verified-execution.mjs';
import { inspectEaiLocalIsolation } from './gofer-local-isolation.mjs';
import { verifyCapabilityReceipt } from './gofer-host-capability.mjs';
import { resolveTrustedEvaluatorPublicKey } from './gofer-trusted-evaluator.mjs';
import { verifyTrustedBenchmarkEvidence } from './gofer-trusted-benchmark.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0;
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

export async function createVerifiedNativeRuntime({ workspaceRoot, host = 'codex',
  localIsolation = inspectEaiLocalIsolation,
  capabilityReceipt, requiredCapabilities, ledger,
  promptForRequest, adapter, baseRef } = {}) {
  if (!text(workspaceRoot) || host !== 'codex' || typeof localIsolation !== 'function' ||
      capabilityReceipt?.host !== host ||
      typeof ledger?.authorize !== 'function' || typeof ledger?.authorizeCommit !== 'function' ||
      typeof ledger?.authorizeNative !== 'function' || typeof promptForRequest !== 'function' ||
      typeof adapter?.bindWorkspace !== 'function') {
    throw new Error('VERIFIED_NATIVE_RUNTIME_CONFIGURATION_REQUIRED');
  }
  const capabilityPublicKey = await resolveTrustedEvaluatorPublicKey(capabilityReceipt, { workspaceRoot });
  if (!verifyCapabilityReceipt(capabilityReceipt, { publicKey: capabilityPublicKey,
    host, requiredCapabilities })) throw new Error('TRUSTED_CAPABILITY_RECEIPT_REQUIRED');
  const isolation = await createVerifiedWorktree({ workspaceRoot, host, localIsolation, baseRef });
  let boundAdapter;
  try {
    boundAdapter = await adapter.bindWorkspace(Object.freeze({ workspaceRoot: isolation.isolatedWorkspace,
      worktreeReceipt: isolation.receipt }));
    if (boundAdapter?.workspaceRoot !== isolation.isolatedWorkspace ||
        ['reserve', 'lease', 'inputRevision', 'check', 'verified'].some(method =>
          typeof boundAdapter?.[method] !== 'function')) throw new Error('NATIVE_ADAPTER_WORKSPACE_BINDING_REQUIRED');
  } catch (error) {
    await disposeVerifiedWorktree({ workspaceRoot: isolation.workspace,
      isolatedWorkspace: isolation.isolatedWorkspace, revision: isolation.revision,
      receipt: isolation.receipt }).catch(() => {});
    throw error;
  }
  let lifecycle = 'idle';
  return Object.freeze({
    isolation,
    async dispose() {
      if (lifecycle === 'disposed') return;
      if (lifecycle !== 'idle' && lifecycle !== 'verified') {
        throw new Error('NATIVE_RUNTIME_REQUIRES_RECOVERY_BEFORE_DISPOSAL');
      }
      const prior = lifecycle;
      lifecycle = 'disposing';
      try {
        await disposeVerifiedWorktree({ workspaceRoot: isolation.workspace,
          isolatedWorkspace: isolation.isolatedWorkspace, revision: isolation.revision,
          receipt: isolation.receipt });
        lifecycle = 'disposed';
      } catch (error) {
        lifecycle = prior;
        throw error;
      }
    },
    async run({ featureDir, checks, benchmarkEvidence, benchmarkAttestation, advisoryConstraints,
      approvalReceipt, maxCalls, maxConcurrent, deadlineMs, signal, recovery } = {}) {
      if (lifecycle !== 'idle') throw new Error('NATIVE_RUNTIME_NOT_AVAILABLE');
      lifecycle = 'running';
      let graphStarted = false;
      try {
        if (!text(featureDir)) throw new Error('NATIVE_EVIDENCE_DIRECTORY_REQUIRED');
        const controllerRoot = await realpath(featureDir);
        if (!inside(isolation.workspace, controllerRoot) || inside(isolation.isolatedWorkspace, controllerRoot)) {
          throw new Error('NATIVE_CONTROL_PLANE_OUTSIDE_SOURCE_WORKSPACE');
        }
        const worktree = await inspectVerifiedWorktree({ workspaceRoot: isolation.workspace,
          isolatedWorkspace: isolation.isolatedWorkspace, revision: isolation.revision,
          receipt: isolation.receipt, requireClean: true });
        if (!worktree.valid) throw new Error('NATIVE_WORKTREE_NOT_CLEAN');
        // The trusted journal stays outside the worker sandbox. The bound
        // adapter performs input reads, checks, and commits in the task worktree.
        const evidenceDirectory = path.join(controllerRoot, '.native-worker-evidence');
        const executor = createLedgerBoundCodexExecutor({ isolatedWorkspace: isolation.isolatedWorkspace,
          worktreeReceipt: isolation.receipt, expectedHead: isolation.revision,
          capabilityReceipt, capabilityPublicKey, requiredCapabilities,
          assertLedger: request => ledger.authorizeNative(request), promptForRequest,
          start: request => startLocalCodexInvocation({ ...request,
            command: isolation.nativeExecutable, evidenceDirectory }) });
        const trustedAdapter = Object.freeze({ ...boundAdapter, worktreeReceipt: isolation.receipt,
          execute: executor.execute });
        const trustedRecovery = recovery ? { ...recovery,
          inspectWorkers: request => inspectNativeWorkerEvidence({ ...request, evidenceDirectory }) } : undefined;
        graphStarted = true;
        const verifyBenchmark = request => verifyTrustedBenchmarkEvidence({ ...request,
          attestation: benchmarkAttestation, capabilityKeyId: capabilityReceipt.provenance.keyId,
          capabilityPublicKey,
          workspaceRoot: isolation.workspace });
        const result = await runVerifiedGraph({ featureDir: controllerRoot, workspaceRoot: isolation.isolatedWorkspace,
          checks, adapter: trustedAdapter,
          ledger, capabilityReceipt, capabilityPublicKey, requiredCapabilities, benchmarkEvidence, verifyBenchmark,
          advisoryConstraints, approvalReceipt, maxCalls, maxConcurrent, deadlineMs, signal, recovery: trustedRecovery });
        lifecycle = result.status === 'verified' && result.adapterCallsSettled ? 'verified' : 'recovery-required';
        return result;
      } catch (error) {
        lifecycle = graphStarted ? 'recovery-required' : 'idle';
        throw error;
      }
    },
  });
}

/** Reopen the dispatch ledger with native cancellation proof after a controller restart. */
export async function reconcileVerifiedNativeCancellation({ featureDir, ledgerPath, workspaceRoot,
  abandonedWorkspace, replacementWorkspace, worktreeRevision, replacementWorktreeReceipt,
  inputRevision, inspectInputRevision, verifyReceipt, timeoutMs } = {}) {
  if (![featureDir, ledgerPath, workspaceRoot, abandonedWorkspace, replacementWorkspace,
    worktreeRevision, replacementWorktreeReceipt, inputRevision].every(text) ||
    !path.isAbsolute(ledgerPath) || typeof inspectInputRevision !== 'function' ||
    typeof verifyReceipt !== 'function') throw new Error('NATIVE_RECOVERY_CONFIGURATION_REQUIRED');
  const evidenceDirectory = path.join(featureDir, '.native-worker-evidence');
  const verifyCancellation = createNativeCancellationVerifier({ workspaceRoot,
    abandonedWorkspace, replacementWorkspace, worktreeRevision,
    evidenceDirectory, inspectInputRevision });
  const ledger = await createRuntimeLedger({ ledgerPath, verifyCancellation });
  return reconcileCancelledExecution({ featureDir, workspaceRoot, abandonedWorkspace,
    replacementWorkspace, worktreeRevision, replacementWorktreeReceipt, inputRevision,
    ledger, verifyReceipt, timeoutMs,
    inspectWorkers: request => inspectNativeWorkerEvidence({ ...request, evidenceDirectory }) });
}

/** Reopen the dispatch ledger from the controller's source-side feature root.
 * Capture stays unavailable until that same ledger proves all native runs and
 * the controller-owned process evidence proves that every worker has stopped. */
export async function openVerifiedNativeBenchmarkCapture({ featureDir, ledgerPath, workspaceRoot } = {}) {
  if (![featureDir, ledgerPath, workspaceRoot].every(text) ||
      ![featureDir, ledgerPath, workspaceRoot].every(path.isAbsolute)) {
    throw new Error('NATIVE_BENCHMARK_CAPTURE_CONFIGURATION_REQUIRED');
  }
  const [workspace, controllerRoot, ledgerParent] = await Promise.all([
    realpath(workspaceRoot), realpath(featureDir), realpath(path.dirname(ledgerPath)),
  ]);
  if (!inside(workspace, controllerRoot) || controllerRoot === workspace ||
      !inside(controllerRoot, ledgerParent)) {
    throw new Error('NATIVE_BENCHMARK_CAPTURE_CONTROL_PLANE_REQUIRED');
  }
  const ledgerFile = path.join(ledgerParent, path.basename(ledgerPath));
  const info = await lstat(ledgerFile);
  if (!info.isFile() || info.nlink !== 1 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid()) ||
      (info.mode & 0o077) !== 0) {
    throw new Error('NATIVE_BENCHMARK_CAPTURE_LEDGER_REQUIRED');
  }
  const evidenceDirectory = path.join(controllerRoot, '.native-worker-evidence');
  const ledger = await createRuntimeLedger({ ledgerPath: ledgerFile,
    verifyBenchmarkCapture: createNativeBenchmarkCaptureVerifier({ evidenceDirectory }) });
  return Object.freeze({
    authorizeCapture: request => ledger.authorizeBenchmarkCapture(request),
    capture: captureAuthorization => captureConfiguredHeldOutResultSnapshot({ workspaceRoot: workspace,
      ledger, captureAuthorization }),
  });
}
