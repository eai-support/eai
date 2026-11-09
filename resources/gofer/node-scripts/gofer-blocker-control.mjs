#!/usr/bin/env node
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const FILE = 'blocker-register.json';
const MAX_EVIDENCE_BYTES = 16 * 1024 * 1024;
const CATEGORIES = ['decision', 'access', 'external', 'capability', 'solvable', 'unknown'];
const STATES = ['ready', 'waiting', 'blocked', 'resolved'];
const digest = value => createHash('sha256').update(value).digest('hex');
const material = value => typeof value === 'string' && value.trim().length > 0;
const key = value => {
  if (!material(value) || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(value)) throw new Error('A stable machine key is required');
  return value.toLowerCase();
};
const waits = category => ['decision', 'access', 'external', 'capability'].includes(category);

export function blockerIdentity(value) {
  return digest(JSON.stringify([key(value.goalKey), key(value.subjectKey), key(value.conditionKey)]));
}

async function readBounded(file) {
  const check = stat => {
    if (!stat.isFile()) throw new Error('Evidence must be a regular file');
    if (stat.size > MAX_EVIDENCE_BYTES) throw new Error('Evidence exceeds the 16 MiB limit');
  };
  // Inspect the opened descriptor; a pathname precheck can race with replacement.
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    check(await handle.stat());
    const chunks = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_EVIDENCE_BYTES - total + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) return Buffer.concat(chunks, total);
      total += bytesRead;
      // Bound the read itself, not only the initial size of a file that can grow.
      if (total > MAX_EVIDENCE_BYTES) throw new Error('Evidence exceeds the 16 MiB limit');
      chunks.push(chunk.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
}

async function readInside(root, relative) {
  if (!material(relative) || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Invalid evidence path');
  const resolved = await fs.realpath(path.resolve(root, relative));
  if (!resolved.startsWith(root + path.sep)) throw new Error('Evidence escapes the state directory');
  return readBounded(resolved);
}

function validateRegister(register) {
  if (register?.schemaVersion !== 1 || !register.blockers || typeof register.blockers !== 'object' || Array.isArray(register.blockers)) throw new Error('Invalid blocker register');
  for (const [id, b] of Object.entries(register.blockers)) {
    if (!b || blockerIdentity(b) !== id || !CATEGORIES.includes(b.category) || !STATES.includes(b.state) ||
        typeof b.asked !== 'boolean' || !Array.isArray(b.tasks) || b.tasks.some(t => !/^T\d+$/.test(t)) ||
        !Array.isArray(b.attempts) || !Array.isArray(b.history) || !Array.isArray(b.proofs) ||
        !Number.isInteger(b.epoch) || b.epoch < 0 || b.epoch > 1) throw new Error('Invalid blocker entry');
    const attempts = new Set();
    const approaches = new Set();
    for (const a of b.attempts) {
      if (!material(a.id) || attempts.has(a.id) || !material(a.approach) ||
          !Number.isInteger(a.epoch) || a.epoch < 0 || a.epoch > b.epoch ||
          !['pending', 'progress', 'no_progress', 'blocked'].includes(a.result)) throw new Error('Invalid attempt history');
      if (approaches.has(`${a.epoch}:${a.approach}`)) throw new Error('Repeated approach');
      attempts.add(a.id);
      approaches.add(`${a.epoch}:${a.approach}`);
    }
    if (b.attempts.length > 4 || [0, 1].some(epoch => b.attempts.filter(a => a.epoch === epoch).length > 2)) throw new Error('Invalid attempt budget');
    if (b.attempts.filter(a => a.result === 'pending').length > 1) throw new Error('Multiple pending attempts');
    if (b.state === 'resolved' && !b.proofs.some(p => p.kind === 'resolution')) throw new Error('Missing resolution evidence');
  }
  return register;
}

async function load(root) {
  try { return validateRegister(JSON.parse(await readInside(root, FILE))); }
  catch (error) {
    if (error.code === 'ENOENT') {
      // A dangling register link is invalid, not an empty register.
      try { await fs.lstat(path.join(root, FILE)); } catch (statError) { if (statError.code === 'ENOENT') return { schemaVersion: 1, blockers: {} }; }
    }
    throw error;
  }
}

async function checkProofs(root, blocker) {
  for (const proof of blocker.proofs) {
    if (!proof || !['change', 'resolution', 'diagnosis'].includes(proof.kind) || !material(proof.hash)) throw new Error('Invalid proof record');
    const raw = await readInside(root, proof.file);
    if (digest(raw) !== proof.hash) throw new Error('Blocker evidence changed or is missing');
    if (proof.kind === 'diagnosis') {
      const diagnosis = JSON.parse(raw);
      if (digest(await readInside(root, diagnosis.evidence)) !== diagnosis.sha256) throw new Error('Diagnosis output changed or is missing');
    }
  }
}

async function acceptProof(root, blocker, id, file, kind) {
  const raw = await readInside(root, file);
  const proof = JSON.parse(raw);
  const hash = digest(raw);
  if (proof.blockerId !== id || proof.kind !== kind || proof.result !== (kind === 'change' ? 'changed' : 'pass') ||
      !material(proof.source) || !material(proof.summary) || blocker.proofs.some(p => p.hash === hash || p.source === proof.source)) {
    throw new Error('New evidence for this blocker and action is required');
  }
  return { file, kind, hash, source: proof.source };
}

async function acceptDiagnosis(root, id, file) {
  const raw = await readInside(root, file);
  const proof = JSON.parse(raw);
  const age = Date.now() - Date.parse(proof.checkedAt);
  if (proof.blockerId !== id || proof.kind !== 'diagnosis' ||
      !['product', 'tooling', 'credential', 'environment', 'self-caused'].includes(proof.classification) ||
      !material(proof.command) || !material(proof.observed) || !material(proof.source) ||
      !material(proof.selfCauseCheck) || proof.selfCauseChecked !== true ||
      proof.authorizedRepairAvailable !== false || !material(proof.authorityCheck) ||
      !(material(proof.alternativeCheck) || material(proof.noSafeAlternativeReason)) ||
      !Number.isFinite(age) || age < -300000 || age > 86400000 ||
      digest(await readInside(root, proof.evidence)) !== proof.sha256) {
    throw new Error('Fresh diagnosis and authority evidence are required before technical escalation');
  }
  return { file, kind: 'diagnosis', hash: digest(raw), source: proof.source };
}

export async function inspectBlockers(stateDir, { taskId } = {}) {
  if (taskId !== undefined && !/^T\d+$/.test(taskId)) throw new Error('Invalid task ID');
  const root = await fs.realpath(stateDir);
  const register = await load(root);
  const active = [];
  for (const [id, blocker] of Object.entries(register.blockers)) {
    // Empty task scope means the blocker affects the whole feature.
    if (taskId && blocker.tasks.length && !blocker.tasks.includes(taskId)) continue;
    try { await checkProofs(root, blocker); }
    catch { active.push({ id, state: 'blocked', reason: 'evidence_invalid' }); continue; }
    if (blocker.state !== 'resolved') active.push({ id, state: blocker.state, category: blocker.category });
  }
  return { status: active.length ? 'blocked' : 'clear', blockers: active,
    registered: Object.keys(register.blockers).length,
    coverage: 'Recorded blockers only; does not discover unreported blockers or verify user consent.' };
}

export async function applyBlockerEvent(stateDir, event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('An event object is required');
  const root = await fs.realpath(stateDir);
  const lockPath = path.join(root, '.gofer-blocker.lock');
  const lock = await fs.open(lockPath, 'wx', 0o600);
  let temporary;
  try {
    const register = await load(root);
    const id = event.action === 'open' ? blockerIdentity(event) : event.blockerId;
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Blocker ID is required');
    let b = register.blockers[id];
    const response = { allowed: false, blockerId: id, decision: 'wait' };
    if (event.action === 'open') {
      if (!CATEGORIES.includes(event.category) || !material(event.owner) || !material(event.question) || !material(event.requiredChange) ||
          !Array.isArray(event.tasks) || event.tasks.some(t => !/^T\d+$/.test(t))) throw new Error('Blocker classification and scope are required');
      if (!b) {
        b = { goalKey: key(event.goalKey), subjectKey: key(event.subjectKey), conditionKey: key(event.conditionKey),
          category: event.category, needsDiagnosis: event.category !== 'decision', owner: event.owner, question: event.question, requiredChange: event.requiredChange,
          tasks: [...new Set(event.tasks)], state: waits(event.category) ? 'waiting' : 'ready', asked: false,
          attempts: [], proofs: [], history: [], epoch: 0 };
        register.blockers[id] = b;
        response.allowed = true;
        response.decision = b.state;
      } else {
        // Rewording or another surface cannot clear or narrow a known blocker.
        await checkProofs(root, b);
        b.tasks = b.tasks.length && event.tasks.length ? [...new Set([...b.tasks, ...event.tasks])] : [];
        response.decision = b.state === 'resolved' ? 'already_resolved' : 'already_registered';
      }
    } else {
      if (!b) throw new Error('Unknown blocker');
      await checkProofs(root, b);
      const pending = b.attempts.find(a => a.result === 'pending');
      if (event.action === 'ask') {
        if (!b.asked && !pending && b.state !== 'resolved') {
          // A business choice needs an answer, not a contrived failing command.
          if (b.category !== 'decision' || b.needsDiagnosis === true) b.proofs.push(await acceptDiagnosis(root, id, event.verification));
          b.asked = true;
          b.state = 'waiting';
          response.allowed = true;
          response.decision = 'ask_once';
          response.question = b.question;
          response.requiredChange = b.requiredChange;
          response.owner = b.owner;
        }
      } else if (event.action === 'attempt') {
        const approach = key(event.approachKey);
        const current = b.attempts.filter(a => a.epoch === b.epoch);
        if (b.state === 'ready' && !pending && !waits(b.category) && current.length < 2 && !current.some(a => a.approach === approach)) {
          const attempt = { id: randomUUID(), epoch: b.epoch, approach, result: 'pending' };
          b.attempts.push(attempt);
          response.allowed = true;
          response.decision = current.length ? 'recover_once' : 'investigate_once';
          response.attemptId = attempt.id;
        } else if (b.state === 'ready' && !pending) {
          b.state = 'blocked';
          response.decision = 'stop_no_new_approach_or_budget';
        }
      } else if (event.action === 'result') {
        if (!pending || event.attemptId !== pending.id || !['progress', 'no_progress', 'blocked'].includes(event.result) || !material(event.summary)) throw new Error('A result for the reserved attempt is required');
        pending.result = event.result;
        pending.summary = event.summary;
        b.state = event.result === 'blocked' || b.attempts.filter(a => a.epoch === b.epoch).length >= 2 ? 'blocked' : 'ready';
        response.allowed = true;
        response.decision = b.state;
      } else if (event.action === 'classify') {
        if (pending || b.state === 'resolved' || !CATEGORIES.includes(event.category)) throw new Error('Cannot change this classification');
        const previousCategory = b.category;
        b.category = event.category;
        b.needsDiagnosis = b.needsDiagnosis === true || previousCategory !== 'decision' || event.category !== 'decision';
        if (waits(b.category)) b.state = 'waiting';
        // Reclassification never resets attempts or clears a waiting decision.
        response.allowed = true;
        response.decision = b.state;
      } else if (event.action === 'resume' || event.action === 'resolve') {
        if (pending) throw new Error('Record the pending attempt result first');
        const isResume = event.action === 'resume';
        if (isResume && b.state === 'ready') throw new Error('Ready work does not need a fresh attempt budget');
        if (isResume && b.epoch >= 1) {
          response.decision = 'stop_resume_budget_exhausted';
        } else if (!isResume && b.state === 'resolved') {
          response.decision = 'already_resolved';
        } else {
          if (isResume && !['solvable', 'unknown'].includes(event.category)) throw new Error('Resume must identify work the AI can now attempt');
          const proof = await acceptProof(root, b, id, event.evidence, isResume ? 'change' : 'resolution');
          b.proofs.push(proof);
          b.state = isResume ? 'ready' : 'resolved';
          if (isResume) { b.epoch++; b.category = event.category; b.needsDiagnosis = true; }
          response.allowed = true;
          response.decision = b.state;
        }
      } else throw new Error('Unknown blocker action');
    }
    if (b.history.length >= 1000) throw new Error('Blocker history limit reached; review is required');
    b.history.push({ at: new Date().toISOString(), action: event.action, allowed: response.allowed, decision: response.decision });
    validateRegister(register);
    temporary = path.join(root, `.blocker-register-${randomUUID()}.tmp`);
    await fs.writeFile(temporary, JSON.stringify(register, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, path.join(root, FILE));
    temporary = undefined;
    return { ...response, state: b.state };
  } finally {
    if (temporary) await fs.unlink(temporary).catch(() => {});
    await lock.close();
    await fs.unlink(lockPath);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: gofer-blocker-control.mjs --state-dir <directory> [--event <private-json-file> | --task <T001>]'); return;
  }
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (!['--state-dir', '--event', '--task'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid arguments');
    values[args[i].slice(2)] = args[++i];
  }
  if (!values['state-dir'] || (values.event && values.task)) throw new Error('State directory and one action are required');
  const result = values.event
    ? await applyBlockerEvent(values['state-dir'], JSON.parse(await readBounded(await fs.realpath(values.event))))
    : await inspectBlockers(values['state-dir'], { taskId: values.task });
  console.log(JSON.stringify(result, null, 2));
  if (result.allowed === false || result.status === 'blocked') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Blocker check stopped. Check local inputs or an active writer; do not repeat work or bypass the check.'); process.exitCode = 1; });
}
