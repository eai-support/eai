#!/usr/bin/env node
/**
 * Production entrypoint for the verified native runtime. Composes the real
 * capability issuer, the real append-only ledger, and `createVerifiedNativeRuntime`
 * to run one bounded, ledger-authorized native task in an isolated worktree.
 *
 * This is deliberately the only command that calls `createVerifiedNativeRuntime`
 * outside of a test. It fails closed with TRUSTED_EVALUATOR_REQUIRED when no
 * local trust identity is registered — that is expected until the account
 * trust store is provisioned; it is not a sign the wiring is missing.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'process';
import { createVerifiedNativeRuntime } from './gofer-native-runtime.mjs';
import { createVerifiedWorktree, disposeVerifiedWorktree } from './gofer-native-adapter.mjs';
import { createRuntimeLedger } from './gofer-runtime-ledger.mjs';
import { issueLocalCapabilityReceipt } from './gofer-local-capability-issuer.mjs';
import { inspectEaiLocalIsolation } from './gofer-local-isolation.mjs';

const SMOKE_TASK_ID = 'T001';
const SMOKE_CHECK_NAME = 'smoke-file-check';
const SMOKE_FILE_NAME = 'NATIVE_SMOKE_PROOF.md';
const SMOKE_FILE_CONTENT = 'native wiring smoke test passed.\n';
const noFollowFlag = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;

function parseArgs(argv) {
  const args = { workspace: '', featureDir: '', capabilityReceipt: '', benchmark: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') args.workspace = argv[++index] || '';
    else if (arg === '--feature-dir') args.featureDir = argv[++index] || '';
    else if (arg === '--capability-receipt') args.capabilityReceipt = argv[++index] || '';
    else if (arg === '--benchmark') args.benchmark = argv[++index] || '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!path.isAbsolute(args.workspace)) throw new Error('--workspace <absolute-path> is required');
  // A receipt and a signed benchmark only make sense together.
  if (Boolean(args.capabilityReceipt) !== Boolean(args.benchmark) ||
      [args.capabilityReceipt, args.benchmark].some(value => value && !path.isAbsolute(value))) {
    throw new Error('--capability-receipt and --benchmark need absolute paths and must be given together');
  }
  return args;
}

async function readJsonFile(filename) {
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error('JSON input must be a regular file under 1 MiB');
    return JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
}

export function gitHead(workspaceRoot) {
  return execFileSync('git', ['-C', workspaceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

async function confinedFeatureDirectory(workspace, requested) {
  const root = await fs.realpath(workspace);
  const target = path.resolve(requested || path.join(root, '.specify', 'specs', 'native-runtime-smoke'));
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('FEATURE_DIRECTORY_OUTSIDE_WORKSPACE');
  }
  let current = root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const info = await fs.lstat(current).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!info) break;
    if (info.isSymbolicLink()) throw new Error('FEATURE_DIRECTORY_SYMLINK');
  }
  return target;
}

/** Build the minimal set of controller documents `reviewPriority` requires,
 * describing exactly one bounded, inert smoke task. Kept in the controller's
 * source-side feature directory, never the isolated task worktree (D029). */
export async function prepareSmokeFeature(featureDir, revision) {
  await fs.mkdir(featureDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(featureDir, 'spec.md'),
    '# Native Runtime Smoke Task\n\n' +
    '- FR-001: Create one fixed-content proof file and change nothing else.\n', { mode: 0o600 });
  await fs.writeFile(path.join(featureDir, 'decisions.md'),
    '## D001 - Run one bounded native smoke task\n\n' +
    'The user approved wiring the verified native runtime into a real command ' +
    'and running one bounded, inert smoke task to prove the dispatch path.\n', { mode: 0o600 });
  await fs.writeFile(path.join(featureDir, 'plan.md'),
    '# Plan\n\nRun one bounded native task in a verified local worktree.\n', { mode: 0o600 });
  await fs.writeFile(path.join(featureDir, 'loop-contract.json'), `${JSON.stringify({
    schemaVersion: 1, requirePriorityPlan: true, loopId: 'native-runtime-smoke',
    profile: 'standard', objective: 'Prove the verified native runtime dispatches one real task end to end.',
    entryStage: '0_gofer_start', maxIterations: 2, budget: {}, evalCommands: [],
    successCriteria: [], stopConditions: [],
    humanEscalation: { maxFailedIterations: 1, owner: 'Gofer maintainers', escalateWhen: ['native host authority is unavailable'] },
  }, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(featureDir, 'tasks.md'),
    `- [ ] **${SMOKE_TASK_ID}** Create ${SMOKE_FILE_NAME} with fixed content.\n`, { mode: 0o600 });
  await fs.writeFile(path.join(featureDir, 'traceability.md'),
    '| Requirement | Task |\n| --- | --- |\n' +
    `| FR-001 | ${SMOKE_TASK_ID} |\n`, { mode: 0o600 });
  const plan = {
    schemaVersion: 2,
    revision,
    objective: 'Prove the verified native runtime dispatches one real task end to end.',
    lastInstruction: { id: 'D001', text: 'The user approved wiring the verified native runtime into a real command and running one bounded, inert smoke task to prove the dispatch path.' },
    decisionPolicy: { mode: 'goal-led', askOnlyFor: ['goal-change', 'irreversible-action', 'missing-authority'] },
    criticalPath: [SMOKE_TASK_ID],
    tasks: { [SMOKE_TASK_ID]: { dependsOn: [], allowedEditScope: [SMOKE_FILE_NAME] } },
    outcome: {
      id: 'OUTCOME-SMOKE-001',
      statement: 'A native host performs one scoped, ledger-governed smoke task in verified isolation.',
      requirements: ['FR-001'],
      target: { environment: 'local-native-host', revision },
      receipt: 'evidence/outcome.json',
    },
  };
  await fs.writeFile(path.join(featureDir, 'priority-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
}

/** The worker-facing adapter. `reserve`/`lease` delegate straight to the same
 * ledger the graph engine authorizes and commits against; `check`/`verified`
 * inspect the isolated worktree directly rather than trusting worker claims. */
export function createSmokeAdapter({ ledger }) {
  return {
    bindWorkspace({ workspaceRoot }) {
      return {
        workspaceRoot,
        reserve: request => ledger.reserve(request),
        lease: request => ledger.lease(request),
        async inputRevision() { return gitHead(workspaceRoot); },
        async check({ taskId, revision, inputRevision, check }) {
          const target = path.join(workspaceRoot, SMOKE_FILE_NAME);
          const actual = await fs.readFile(target, 'utf8').catch(() => null);
          const executed = true;
          const exitCode = actual === SMOKE_FILE_CONTENT ? 0 : 1;
          return { taskId, revision, inputRevision, check, exitCode, executed,
            receipt: createHash('sha256').update(`${taskId}:${inputRevision}:${actual ?? ''}`).digest('hex') };
        },
        async verified({ taskId, revision, inputRevision }) {
          const target = path.join(workspaceRoot, SMOKE_FILE_NAME);
          const actual = await fs.readFile(target, 'utf8').catch(() => null);
          if (actual !== SMOKE_FILE_CONTENT) throw new Error('SMOKE_TASK_OUTPUT_MISMATCH');
          return { committed: true, taskId, revision, inputRevision,
            receipt: createHash('sha256').update(`verified:${taskId}:${inputRevision}`).digest('hex') };
        },
      };
    },
  };
}

/** Capability issuance needs an already-isolated worktree to probe, but the
 * receipt itself attests host/model capability, not a specific worktree's
 * identity. Issue it against a disposable probe worktree, exactly like the
 * live capability diagnostic already recorded for this feature, then reuse
 * the receipt for the separate, real task worktree below. */
async function issueDisposableCapabilityReceipt(workspace, host) {
  const probe = await createVerifiedWorktree({ workspaceRoot: workspace, host,
    localIsolation: inspectEaiLocalIsolation });
  try {
    return await issueLocalCapabilityReceipt({ workspaceRoot: probe.isolatedWorkspace });
  } finally {
    await disposeVerifiedWorktree({ workspaceRoot: probe.workspace,
      isolatedWorkspace: probe.isolatedWorkspace, revision: probe.revision,
      receipt: probe.receipt }).catch(() => {});
  }
}

/** `capabilityReceipt` and `benchmark` ({ evidence, attestation }) may be supplied
 * together to route by a signed independent benchmark. Without them the runner
 * issues its own receipt and the routing gate correctly refuses to route. */
export async function runVerifiedSmokeTask({ workspace, featureDir, host = 'codex',
  capabilityReceipt: suppliedReceipt, benchmark }) {
  const revision = gitHead(workspace);
  const resolvedFeatureDir = await confinedFeatureDirectory(workspace, featureDir);
  // Complete every path-based controller write before any native worker can
  // start. The worker receives only its isolated worktree and cannot reach the
  // controller feature directory.
  await prepareSmokeFeature(resolvedFeatureDir, revision);
  // Bind every controller-side read and write to the same canonical directory.
  // This prevents a caller-controlled symlink from redirecting evidence after
  // the runtime has validated its feature root.
  const controllerFeatureDir = await fs.realpath(resolvedFeatureDir);
  const capabilityReceipt = suppliedReceipt ?? await issueDisposableCapabilityReceipt(workspace, host);
  const ledger = await createRuntimeLedger({ ledgerPath: path.join(controllerFeatureDir, 'runtime-ledger.jsonl') });
  const runtime = await createVerifiedNativeRuntime({
    workspaceRoot: workspace,
    host,
    localIsolation: inspectEaiLocalIsolation,
    capabilityReceipt,
    requiredCapabilities: { isolationClass: 'git-worktree+local-os-sandbox' },
    ledger,
    promptForRequest: async () => `Create a file named ${SMOKE_FILE_NAME} in the repository root ` +
      `containing exactly this one line: "${SMOKE_FILE_CONTENT.trim()}". Make no other change.`,
    adapter: createSmokeAdapter({ ledger }),
  });
  // Create and retain the final evidence file descriptor before dispatch.
  // Retirement writes through this descriptor and never resolves a path that
  // a concurrent process could replace after the worker starts.
  const evidenceSink = await openEvidenceSink(controllerFeatureDir);
  let result;
  try {
    result = await runtime.run({
      featureDir: controllerFeatureDir,
      checks: { [SMOKE_TASK_ID]: [SMOKE_CHECK_NAME] },
      approvalReceipt: 'local-smoke-approval',
      benchmarkEvidence: benchmark?.evidence,
      benchmarkAttestation: benchmark?.attestation,
      maxCalls: 12,
      maxConcurrent: 1,
      deadlineMs: Date.now() + 300_000,
    });
  } catch (error) {
    await evidenceSink.close().catch(() => {});
    // A failed run keeps its worktree for recovery; say where it is instead of hiding it.
    await runtime.dispose().catch(disposeError => process.stderr.write(
      `Worktree kept at ${runtime.isolation.isolatedWorkspace}: ${disposeError.message}\n`));
    throw error;
  }
  // A verified run must not leave a worktree behind, so disposal errors surface.
  if (result.status !== 'verified' || result.adapterCallsSettled !== true) {
    await evidenceSink.close().catch(() => {});
    const location = runtime.isolation.isolatedWorkspace;
    process.stderr.write(`Worktree kept at ${location}: native task requires recovery\n`);
    throw new Error(`NATIVE_RUNTIME_REQUIRES_RECOVERY:${location}`);
  }
  try {
    await retireVerifiedOutput({ isolatedWorkspace: runtime.isolation.isolatedWorkspace,
      evidenceSink });
    await evidenceSink.close();
    await runtime.dispose();
  } catch (error) {
    await evidenceSink.close().catch(() => {});
    process.stderr.write(
      `Worktree kept at ${runtime.isolation.isolatedWorkspace}: ${error.message}\n`);
    throw error;
  }
  return result;
}

function sameIdentity(left, right) {
  if (left.dev === undefined || left.ino === undefined ||
      right.dev === undefined || right.ino === undefined) return true;
  return left.dev === right.dev && left.ino === right.ino;
}

async function openEvidenceSink(featureDirectory) {
  const evidenceDirectory = path.join(featureDirectory, 'evidence');
  const featureHandle = await fs.open(featureDirectory,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollowFlag);
  let evidenceHandle;
  try {
    const featureIdentity = await featureHandle.stat();
    const featureAfterOpen = await fs.lstat(featureDirectory);
    if (!featureIdentity.isDirectory() || featureAfterOpen.isSymbolicLink() ||
        !sameIdentity(featureIdentity, featureAfterOpen)) {
      throw new Error('CONTROLLER_FEATURE_DIRECTORY_CHANGED');
    }
    // Exclusive creation rejects every pre-existing path, including a symlink.
    await fs.mkdir(evidenceDirectory, { mode: 0o700 });
    evidenceHandle = await fs.open(evidenceDirectory,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollowFlag);
    const evidenceIdentity = await evidenceHandle.stat();
    const [featureAfterCreate, evidenceAfterOpen] = await Promise.all([
      fs.lstat(featureDirectory), fs.lstat(evidenceDirectory),
    ]);
    if (!evidenceIdentity.isDirectory() || evidenceAfterOpen.isSymbolicLink() ||
        !sameIdentity(evidenceIdentity, evidenceAfterOpen) ||
        !sameIdentity(featureIdentity, featureAfterCreate)) {
      throw new Error('CONTROLLER_EVIDENCE_DIRECTORY_CHANGED');
    }
    const evidencePath = path.join(evidenceDirectory, SMOKE_FILE_NAME);
    const sink = await fs.open(evidencePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag, 0o600);
    const [featureAfterSinkOpen, evidenceAfterSinkOpen] = await Promise.all([
      fs.lstat(featureDirectory), fs.lstat(evidenceDirectory),
    ]);
    if (!sameIdentity(featureIdentity, featureAfterSinkOpen) ||
        !sameIdentity(evidenceIdentity, evidenceAfterSinkOpen)) {
      await sink.close();
      throw new Error('CONTROLLER_EVIDENCE_DIRECTORY_CHANGED');
    }
    return sink;
  } finally {
    await evidenceHandle?.close();
    await featureHandle.close();
  }
}

/** Keep the verified proof file as controller evidence, then remove it from the task
 * worktree so the strict clean-state disposal check stays unchanged. */
async function retireVerifiedOutput({ isolatedWorkspace, evidenceSink }) {
  const source = path.join(isolatedWorkspace, SMOKE_FILE_NAME);
  const sourceHandle = await fs.open(source, constants.O_RDONLY | noFollowFlag);
  let actual;
  try {
    const sourceInfo = await sourceHandle.stat();
    if (!sourceInfo.isFile()) throw new Error('SMOKE_TASK_OUTPUT_INVALID');
    actual = await sourceHandle.readFile('utf8');
  } finally { await sourceHandle.close(); }
  if (actual !== SMOKE_FILE_CONTENT) throw new Error('SMOKE_TASK_OUTPUT_MISMATCH');
  const sinkInfo = await evidenceSink.stat();
  if (!sinkInfo.isFile()) throw new Error('CONTROLLER_EVIDENCE_FILE_INVALID');
  await evidenceSink.writeFile(actual);
  await evidenceSink.sync();
  await fs.rm(source);
}

async function main(argv) {
  const args = parseArgs(argv);
  const capabilityReceipt = args.capabilityReceipt ? await readJsonFile(args.capabilityReceipt) : undefined;
  const benchmark = args.benchmark ? await readJsonFile(args.benchmark) : undefined;
  const result = await runVerifiedSmokeTask({ workspace: args.workspace,
    featureDir: args.featureDir || undefined, capabilityReceipt, benchmark });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
