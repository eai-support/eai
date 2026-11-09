#!/usr/bin/env node

import { createHash, sign, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { requestTypeSafeEvaluation, sharedCredentialConfigured } from './gofer-typesafe-credentials.mjs';
import { loadActiveBenchmarkVerifierKey, resolveTrustedEvaluatorPublicKey,
  VERIFIER_EVALUATOR } from './gofer-trusted-evaluator.mjs';
import { promptHidden } from './gofer-tty-prompt.mjs';

const POLICY_PATH = path.join('.specify', 'config', 'typesafe-learning-review.json');
const STORE_PATH = path.join('.specify', 'memory', 'reviewed-learning');
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_RECORDS = 100_000;
const MAX_LESSON_BYTES = 8 * 1024;
const OFFICIAL_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const noFollowFlag = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
const sensitiveKey = /(authorization|api[-_]?key|secret|token|password|credential|cookie)/i;
const secretPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g,
  /\bTYPESAFE_API_KEY\s*=\s*[^\s]+/gi,
  /\b(?:api[-_]?key|access[-_]?token|password|secret|token)\s*=\s*[^\s&]+/gi,
];
const verifiedDirectories = new Map();
const REVIEW_LOCK_TTL_MS = 5 * 60 * 1000;

function sha256(value) {
  // This is a content-addressing digest, never a password derivation function.
  // lgtm[js/insufficient-password-hash]
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function canonical(value) {
  return JSON.stringify(stable(value));
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function credentialSourceLabel(value) {
  if (value === 'environment') return 'environment';
  if (value === 'project_secret_file') return 'project_secret_file';
  if (value === 'macos_keychain') return 'macos_keychain';
  return 'none';
}

function validTime(value) {
  const normalized = text(value);
  if (!normalized || Number.isNaN(Date.parse(normalized))) return '';
  return new Date(normalized).toISOString();
}

function truncateUtf8(value, maxBytes) {
  const input = Buffer.from(String(value), 'utf8');
  if (input.length <= maxBytes) return input.toString('utf8');
  let end = maxBytes;
  while (end > 0 && (input[end] & 0xc0) === 0x80) end -= 1;
  return input.subarray(0, end).toString('utf8');
}

function redactString(value, maxBytes) {
  let output = String(value);
  for (const pattern of secretPatterns) output = output.replace(pattern, '[REDACTED]');
  return truncateUtf8(output, maxBytes);
}

function redactValue(value, maxBytes, key = '', depth = 0) {
  if (depth > 8) return '[TRUNCATED_DEPTH]';
  if (sensitiveKey.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactString(value, maxBytes);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactValue(item, maxBytes, '', depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 100).map(([name, item]) => [
        redactString(name, 120),
        redactValue(item, maxBytes, name, depth + 1),
      ])
    );
  }
  return String(value ?? '');
}

async function safeWorkspace(workspace) {
  const root = path.resolve(workspace);
  const info = await fs.lstat(root).catch(() => null);
  if (!info || !info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('LEARNING_WORKSPACE_INVALID');
  }
  return root;
}

async function rejectSymlinkComponents(root, target) {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('LEARNING_PATH_OUTSIDE_WORKSPACE');
  }
  let current = root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const info = await fs.lstat(current).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!info) return;
    if (info.isSymbolicLink()) throw new Error('LEARNING_PATH_SYMLINK');
  }
}

async function confined(workspace, input, { exists = false, regular = false } = {}) {
  const root = await safeWorkspace(workspace);
  const target = path.resolve(root, input);
  await rejectSymlinkComponents(root, target);
  const info = await fs.lstat(target).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (exists && !info) throw new Error('LEARNING_PATH_MISSING');
  if (info?.isSymbolicLink()) throw new Error('LEARNING_PATH_SYMLINK');
  if (regular && info && !info.isFile()) throw new Error('LEARNING_PATH_NOT_FILE');
  return target;
}

async function holdDirectoryChain(root, target) {
  const relativeParent = path.relative(root, path.dirname(target));
  const directories = [root];
  let current = root;
  for (const component of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    directories.push(current);
  }
  const held = [];
  try {
    for (const directory of directories) {
      const handle = await fs.open(directory,
        constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollowFlag);
      const opened = await handle.stat();
      const currentInfo = await fs.lstat(directory);
      if (!opened.isDirectory() || currentInfo.isSymbolicLink() ||
          !sameIdentity(opened, currentInfo)) {
        await handle.close();
        throw new Error('LEARNING_STORE_PARENT_CHANGED');
      }
      held.push({ directory, handle, identity: opened });
    }
    return held;
  } catch (error) {
    await Promise.allSettled(held.map(({ handle }) => handle.close()));
    throw error;
  }
}

async function readBoundedFile(workspace, input, maxBytes = MAX_SOURCE_BYTES) {
  const root = await safeWorkspace(workspace);
  const target = await confined(root, input, { exists: true, regular: true });
  const held = await holdDirectoryChain(root, target);
  let handle;
  try {
    handle = await fs.open(target, constants.O_RDONLY | noFollowFlag);
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('LEARNING_STORE_INVALID');
    if (info.size > maxBytes) throw new Error('LEARNING_INPUT_TOO_LARGE');
    const chunks = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes - total + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) throw new Error('LEARNING_INPUT_TOO_LARGE');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const content = Buffer.concat(chunks, total).toString('utf8');
    for (const entry of held) {
      const current = await fs.lstat(entry.directory);
      if (current.isSymbolicLink() || !sameIdentity(entry.identity, current)) {
        throw new Error('LEARNING_STORE_PARENT_CHANGED');
      }
    }
    return { target, content };
  } finally {
    if (handle) await handle.close();
    await Promise.allSettled(held.map(({ handle: directoryHandle }) => directoryHandle.close()));
  }
}

async function ensureStore(workspace) {
  const root = await safeWorkspace(workspace);
  let current = root;
  for (const component of STORE_PATH.split(path.sep)) {
    const parentHandle = await fs.open(current,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollowFlag);
    try {
      const openedParent = await parentHandle.stat();
      const parentAfterOpen = await fs.lstat(current);
      if (!openedParent.isDirectory() || parentAfterOpen.isSymbolicLink() ||
          !sameIdentity(openedParent, parentAfterOpen)) {
        throw new Error('LEARNING_STORE_PARENT_CHANGED');
      }
      const next = path.join(current, component);
      await fs.mkdir(next, { mode: 0o700 }).catch((error) => {
        if (error?.code !== 'EEXIST') throw error;
      });
      const parentAfter = await fs.lstat(current);
      if (!sameIdentity(openedParent, parentAfter)) {
        throw new Error('LEARNING_STORE_PATH_INVALID');
      }
      // The parent remains open, and the child is opened no-follow then validated by identity.
      // codeql[js/file-system-race]
      const childHandle = await fs.open(next,
        constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollowFlag).catch((error) => {
        if (['ELOOP', 'ENOTDIR'].includes(error?.code)) throw new Error('LEARNING_PATH_SYMLINK');
        throw error;
      });
      try {
        const openedChild = await childHandle.stat();
        const child = await fs.lstat(next);
        if (!openedChild.isDirectory() || child.isSymbolicLink() ||
            !sameIdentity(child, openedChild)) {
          throw new Error('LEARNING_STORE_PATH_INVALID');
        }
        await childHandle.chmod(0o700);
        verifiedDirectories.set(next, { dev: openedChild.dev, ino: openedChild.ino });
      } finally {
        await childHandle.close();
      }
      current = next;
    } finally {
      await parentHandle.close();
    }
  }
  return current;
}

async function withPrivateDirectory(parent, name, action) {
  await verifyRememberedDirectory(parent);
  const parentHandle = await fs.open(parent,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollowFlag);
  const parentIdentity = await parentHandle.stat();
  const target = path.join(parent, name);
  try {
    await fs.mkdir(target, { mode: 0o700 }).catch((error) => {
      if (error?.code !== 'EEXIST') throw error;
    });
    await verifyRememberedDirectory(parent);
    const handle = await fs.open(target,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollowFlag).catch((error) => {
      if (['ELOOP', 'ENOTDIR'].includes(error?.code)) throw new Error('LEARNING_STORE_PATH_INVALID');
      throw error;
    });
    try {
      const opened = await handle.stat();
      const current = await fs.lstat(target);
      const currentParent = await fs.lstat(parent);
      if (!opened.isDirectory() || current.isSymbolicLink() || !sameIdentity(opened, current) ||
          currentParent.isSymbolicLink() || !sameIdentity(parentIdentity, currentParent)) {
        throw new Error('LEARNING_STORE_PATH_INVALID');
      }
      await handle.chmod(0o700);
      verifiedDirectories.set(target, { dev: opened.dev, ino: opened.ino });
      const result = await action(target);
      const [parentAfterAction, targetAfterAction] = await Promise.all([
        fs.lstat(parent),
        fs.lstat(target),
      ]);
      if (parentAfterAction.isSymbolicLink() || targetAfterAction.isSymbolicLink() ||
          !sameIdentity(parentIdentity, parentAfterAction) ||
          !sameIdentity(opened, targetAfterAction)) {
        throw new Error('LEARNING_STORE_PATH_INVALID');
      }
      return result;
    } finally {
      await handle.close();
    }
  } finally {
    await parentHandle.close();
  }
}

function sameIdentity(left, right) {
  if (left.dev === undefined || left.ino === undefined ||
      right.dev === undefined || right.ino === undefined) return true;
  return left.dev === right.dev && left.ino === right.ino;
}

async function withVerifiedParent(target, action) {
  const parent = path.dirname(target);
  const handle = await fs.open(parent,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollowFlag);
  const opened = await handle.stat();
  try {
    const current = await fs.lstat(parent);
    if (!opened.isDirectory() || current.isSymbolicLink() || !sameIdentity(opened, current)) {
      throw new Error('LEARNING_STORE_PARENT_CHANGED');
    }
    const expected = verifiedDirectories.get(parent);
    if (expected && !sameIdentity(expected, opened)) throw new Error('LEARNING_STORE_PARENT_CHANGED');
    const result = await action();
    const after = await fs.lstat(parent);
    if (after.isSymbolicLink() || !sameIdentity(opened, after)) {
      throw new Error('LEARNING_STORE_PARENT_CHANGED');
    }
    return result;
  } finally {
    await handle.close();
  }
}

async function verifyRememberedDirectory(target) {
  await withVerifiedParent(path.join(target, '.guard'), async () => undefined);
  const current = await fs.lstat(target);
  const expected = verifiedDirectories.get(target);
  if (current.isSymbolicLink() || !current.isDirectory() ||
      (expected && !sameIdentity(expected, current))) {
    throw new Error('LEARNING_STORE_PATH_INVALID');
  }
}

async function existingRegularFile(target) {
  const info = await fs.lstat(target).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (info && (info.isSymbolicLink() || !info.isFile())) {
    throw new Error('LEARNING_STORE_INVALID');
  }
  return info;
}

async function appendPrivate(target, value) {
  return withVerifiedParent(target, async () => {
    const beforeOpen = await existingRegularFile(target);
    const handle = await fs.open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | noFollowFlag,
      0o600
    );
    try {
      const info = await handle.stat();
      if (!info.isFile() || (beforeOpen && !sameIdentity(beforeOpen, info))) {
        throw new Error('LEARNING_STORE_INVALID');
      }
      await handle.writeFile(`${JSON.stringify(value)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  });
}

async function writePrivateExclusive(target, value) {
  return withVerifiedParent(target, async () => {
    let handle;
    try {
      await existingRegularFile(target);
      handle = await fs.open(
        target,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag,
        0o600
      );
      await handle.writeFile(value);
      await handle.sync();
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const beforeOpen = await existingRegularFile(target);
      const existingHandle = await fs.open(target, constants.O_RDONLY | noFollowFlag);
      try {
        const info = await existingHandle.stat();
        if (!info.isFile() || !beforeOpen || !sameIdentity(beforeOpen, info)) {
          throw new Error('LEARNING_STORE_INVALID');
        }
        const existing = await existingHandle.readFile('utf8');
        if (existing !== value) throw new Error('LEARNING_RECORD_COLLISION');
      } finally {
        await existingHandle.close();
      }
    } finally {
      if (handle) await handle.close();
    }
  });
}

async function readJsonLines(target) {
  return withVerifiedParent(target, async () => {
    const beforeOpen = await existingRegularFile(target);
    if (!beforeOpen) return [];
    const handle = await fs.open(target, constants.O_RDONLY | noFollowFlag).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!handle) return [];
    try {
      const info = await handle.stat();
      const current = await fs.lstat(target);
      if (!info.isFile() || current.isSymbolicLink() || !current.isFile() ||
          !sameIdentity(beforeOpen, info) || !sameIdentity(info, current) ||
          info.size > MAX_SOURCE_BYTES) throw new Error('LEARNING_STORE_INVALID');
      const lines = (await handle.readFile('utf8')).split('\n').filter(Boolean);
      if (lines.length > MAX_RECORDS) throw new Error('LEARNING_STORE_LIMIT');
      return lines.map((line) => JSON.parse(line));
    } finally {
      await handle.close();
    }
  });
}

function eventType(name) {
  if (['started', 'resumed', 'call_reserved', 'attempt_reserved', 'lease_granted'].includes(name)) return 'lifecycle';
  if (['ledger_authorized', 'commit_authorized', 'approval'].includes(name)) return 'approval';
  if (['check', 'verified'].includes(name)) return 'validation';
  if (['blocked', 'cancelled', 'stale', 'repair_required', 'failed', 'error'].includes(name)) return 'error';
  if (/command|shell/.test(name)) return 'command';
  if (/file|patch|write|edit/.test(name)) return 'file_change';
  if (/tool/.test(name)) return 'tool';
  if (/message|prompt|response/.test(name)) return 'message';
  return 'other';
}

function validateTrace(trace) {
  if (trace?.schemaVersion !== 1 || !/^trace_[a-f0-9]{32}$/.test(trace.traceId ?? '') ||
      !/^project_[a-f0-9]{24}$/.test(trace.projectId ?? '') || !text(trace.host) ||
      !text(trace.sessionId) || !text(trace.objective) || !validTime(trace.startedAt) ||
      !validTime(trace.endedAt) || !Array.isArray(trace.events) ||
      trace.events.length < 1 || trace.events.length > 100 ||
      !['host-event-export', 'verified-execution-journal'].includes(trace.source?.kind) ||
      !/^[a-f0-9]{64}$/.test(trace.source?.sha256 ?? '') ||
      Object.keys(trace.source ?? {}).sort().join(',') !== 'kind,sha256' ||
      !/^[a-f0-9]{64}$/.test(trace.traceHash ?? '')) {
    throw new Error('LEARNING_TRACE_INVALID');
  }
  for (const [index, event] of trace.events.entries()) {
    if (event.sequence !== index + 1 || !/^event_[a-f0-9]{24}$/.test(event.id ?? '') ||
        !validTime(event.time) || !text(event.name) || !text(event.type) ||
        !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) {
      throw new Error('LEARNING_TRACE_EVENT_INVALID');
    }
  }
  const { traceHash, ...withoutHash } = trace;
  if (sha256(canonical(withoutHash)) !== traceHash) throw new Error('LEARNING_TRACE_HASH_INVALID');
  return trace;
}

export function normalizeTrace({
  workspace,
  host,
  objective,
  sessionId,
  sourceKind = 'host-event-export',
  sourceContent,
  events,
  maxEvents = 100,
  maxTextBytes = 2000,
}) {
  if (!text(workspace) || !text(host) || !text(objective) || !text(sourceContent) ||
      !Array.isArray(events) || events.length < 1 || events.length > maxEvents ||
      !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 100 ||
      !Number.isSafeInteger(maxTextBytes) || maxTextBytes < 128 || maxTextBytes > 8192) {
    throw new Error('LEARNING_NORMALIZE_INVALID');
  }
  const sourceHash = sha256(sourceContent);
  const times = events.map((event) => validTime(event.time ?? event.timestamp ?? event.at)).filter(Boolean);
  if (times.length !== events.length) throw new Error('LEARNING_EVENT_TIME_REQUIRED');
  const projectId = `project_${sha256(path.resolve(workspace)).slice(0, 24)}`;
  const resolvedSession = truncateUtf8(text(sessionId) || sourceHash.slice(0, 32), 200);
  const normalizedEvents = events.map((event, index) => {
    const name = redactString(text(event.event ?? event.name ?? event.type) || 'event', 120);
    const data = redactValue(
      Object.fromEntries(Object.entries(event).filter(([key]) => !['time', 'timestamp', 'at', 'event', 'name', 'type'].includes(key))),
      maxTextBytes
    );
    const base = { sequence: index + 1, time: times[index], type: eventType(name), name, data };
    return { id: `event_${sha256(canonical({ sourceHash, ...base })).slice(0, 24)}`, ...base };
  });
  const core = {
    schemaVersion: 1,
    projectId,
    host: truncateUtf8(text(host), 64),
    sessionId: resolvedSession,
    objective: redactString(objective, 4000),
    startedAt: times[0],
    endedAt: times[times.length - 1],
    source: { kind: sourceKind, sha256: sourceHash },
    events: normalizedEvents,
  };
  const traceId = `trace_${sha256(canonical(core)).slice(0, 32)}`;
  const withoutHash = { schemaVersion: 1, traceId, ...core };
  return validateTrace({ ...withoutHash, traceHash: sha256(canonical(withoutHash)) });
}

export async function normalizeJournal({
  workspace = process.cwd(),
  input,
  host,
  objective,
  sessionId,
  sourceKind = 'verified-execution-journal',
}) {
  const root = await safeWorkspace(workspace);
  const { content } = await readBoundedFile(root, input);
  const lines = content.split('\n').filter(Boolean);
  if (!lines.length || lines.length > 100) throw new Error('LEARNING_EVENT_LIMIT');
  const events = lines.map((line) => JSON.parse(line));
  const trace = normalizeTrace({
    workspace: root,
    host,
    objective,
    sessionId,
    sourceKind,
    sourceContent: content,
    events,
  });
  const store = await ensureStore(root);
  const tracePath = await withPrivateDirectory(store, 'traces', async (traceDir) => {
    const target = path.join(traceDir, `${trace.traceId}.json`);
    await writePrivateExclusive(target, `${JSON.stringify(trace, null, 2)}\n`);
    return target;
  });
  return { trace, tracePath };
}

async function loadPolicy(workspace) {
  const { content } = await readBoundedFile(workspace, POLICY_PATH, 64 * 1024);
  const policy = JSON.parse(content);
  const thresholds = policy.thresholds;
  if (policy.schemaVersion !== 1 || policy.provider !== 'typesafe' ||
      policy.endpoint !== OFFICIAL_ENDPOINT || policy.model !== 'jev-latest' ||
      typeof policy.enabled !== 'boolean' || !Number.isSafeInteger(policy.timeoutMs) ||
      policy.timeoutMs < 1000 || policy.timeoutMs > 30_000 ||
      !Number.isSafeInteger(policy.maxEvents) || policy.maxEvents < 1 || policy.maxEvents > 100 ||
      !Number.isSafeInteger(policy.maxTextBytes) || policy.maxTextBytes < 128 || policy.maxTextBytes > 8192 ||
      !Number.isSafeInteger(policy.maxProjectionBytes) || policy.maxProjectionBytes < 4096 ||
      policy.maxProjectionBytes > 1024 * 1024 || !thresholds ||
      ['taskSuccess', 'reusableLesson', 'evidenceSupport'].some((key) =>
        typeof thresholds[key] !== 'number' || thresholds[key] < 0 || thresholds[key] > 1)) {
    throw new Error('LEARNING_POLICY_INVALID');
  }
  return policy;
}

function proposedLesson(value) {
  const title = truncateUtf8(text(value?.title), 200);
  const lesson = truncateUtf8(text(value?.lesson), MAX_LESSON_BYTES);
  const kind = truncateUtf8(text(value?.kind) || 'engineering-pattern', 80);
  if (!title || !lesson) throw new Error('LEARNING_LESSON_REQUIRED');
  return { title, lesson, kind };
}

export function buildEvaluationProjection(trace, proposal, policy) {
  validateTrace(trace);
  const boundedProposal = proposedLesson(proposal);
  const safeProposal = redactValue(boundedProposal, policy.maxTextBytes);
  const projection = {
    schemaVersion: 1,
    trace: {
      traceId: trace.traceId,
      projectId: trace.projectId,
      host: redactString(trace.host, 200),
      objective: redactString(trace.objective, policy.maxTextBytes),
      startedAt: trace.startedAt,
      endedAt: trace.endedAt,
      source: { kind: trace.source.kind, sha256: trace.source.sha256 },
      events: trace.events.slice(0, policy.maxEvents).map((event) => ({
        id: event.id,
        sequence: event.sequence,
        time: event.time,
        type: event.type,
        name: redactString(event.name, 200),
        data: redactValue(event.data, policy.maxTextBytes),
      })),
    },
    proposedMemory: safeProposal,
  };
  const serialized = canonical(projection);
  if (Buffer.byteLength(serialized, 'utf8') > policy.maxProjectionBytes) {
    throw new Error('LEARNING_PROJECTION_TOO_LARGE');
  }
  return { projection, projectionHash: sha256(serialized), proposal: safeProposal };
}

function probability(answer) {
  const direct = Number(answer?.noul ?? answer?.probability ?? answer?.score);
  if (Number.isFinite(direct) && direct >= 0 && direct <= 1) return direct;
  const choice = String(answer?.choice ?? '').toLowerCase();
  const confidence = Number(answer?.confidence);
  if (['yes', 'true'].includes(choice) && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1) {
    return confidence;
  }
  if (['no', 'false'].includes(choice) && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1) {
    return 1 - confidence;
  }
  return 0;
}

function answerMap(payload) {
  if (payload?.answers && typeof payload.answers === 'object') return payload.answers;
  if (payload?.questions && typeof payload.questions === 'object') return payload.questions;
  if (payload?.results && typeof payload.results === 'object') return payload.results;
  return {};
}

export async function evaluateTrace({
  workspace = process.cwd(),
  trace,
  proposal,
  dryRun = false,
  fetchImpl = globalThis.fetch,
  env = process.env,
  keychain,
}) {
  const root = await safeWorkspace(workspace);
  const policy = await loadPolicy(root);
  const expectedProjectId = `project_${sha256(root).slice(0, 24)}`;
  if (trace?.projectId !== expectedProjectId) throw new Error('LEARNING_TRACE_PROJECT_MISMATCH');
  const { projection, projectionHash, proposal: boundedProposal } =
    buildEvaluationProjection(trace, proposal, policy);
  const rubric = {
    task_success: {
      type: 'noul',
      instructions: 'Did this trace complete the stated engineering objective successfully?',
    },
    reusable_lesson: {
      type: 'noul',
      instructions: 'Is the proposed lesson reusable for a future engineering task?',
    },
    evidence_support: {
      type: 'noul',
      instructions: 'Is the proposed lesson supported by concrete evidence in this trace?',
    },
  };
  const rubricHash = sha256(canonical(rubric));
  if (dryRun) {
    return {
      status: 'dry_run',
      networkCalled: false,
      projectionHash,
      rubricHash,
      eventCount: projection.trace.events.length,
      projectionBytes: Buffer.byteLength(canonical(projection), 'utf8'),
    };
  }
  // Check Keychain metadata only. The secret stays outside this
  // content-addressing module and cannot enter a stored digest.
  const sharedConfigured =
    policy.enabled || env.GOFER_DISABLE_SHARED_CREDENTIALS === '1'
      ? false
      : await sharedCredentialConfigured({ keychain });
  if (!policy.enabled && !sharedConfigured) {
    return { status: 'disabled', networkCalled: false, projectionHash, rubricHash };
  }
  const providerResult = await requestTypeSafeEvaluation({
    workspace: root,
    env,
    fetchImpl,
    policy,
    projection,
    rubric,
    keychain,
  });
  if (providerResult.status !== 'received') {
    return { ...providerResult, projectionHash, rubricHash };
  }
  // Persist only a fixed label. Never carry provider credential data into
  // content-addressed evaluation or candidate records.
  const credentialSource = credentialSourceLabel(providerResult.credentialSource);
  const { payload } = providerResult;
  const answers = answerMap(payload);
  const probabilities = {
    taskSuccess: probability(answers.task_success),
    reusableLesson: probability(answers.reusable_lesson),
    evidenceSupport: probability(answers.evidence_support),
  };
  const passed =
    probabilities.taskSuccess >= policy.thresholds.taskSuccess &&
    probabilities.reusableLesson >= policy.thresholds.reusableLesson &&
    probabilities.evidenceSupport >= policy.thresholds.evidenceSupport;
  const evaluationSeed = {
    schemaVersion: 1,
    traceId: trace.traceId,
    traceHash: trace.traceHash,
    projectId: trace.projectId,
    proposal: boundedProposal,
    projectionHash,
    evaluator: { provider: policy.provider, model: policy.model,
      credentialSource },
    rubricHash,
    thresholds: policy.thresholds,
    probabilities,
    passed,
  };
  const evaluatedAt = new Date().toISOString();
  const evaluationCore = {
    ...evaluationSeed,
    evaluatedAt,
  };
  const evaluation = {
    evaluationId: `evaluation_${sha256(canonical(evaluationSeed)).slice(0, 32)}`,
    ...evaluationCore,
  };
  const store = await ensureStore(root);
  await appendPrivate(path.join(store, 'evaluations.jsonl'), evaluation);
  if (!passed) return { status: 'not_candidate', networkCalled: true, evaluation };
  const candidateSeed = {
    schemaVersion: 1,
    projectId: trace.projectId,
    traceId: trace.traceId,
    traceHash: trace.traceHash,
    evaluationId: evaluation.evaluationId,
    proposal: boundedProposal,
    evaluator: evaluation.evaluator,
    rubricHash,
    probabilities,
  };
  const candidate = {
    candidateId: `candidate_${sha256(canonical(candidateSeed)).slice(0, 32)}`,
    ...candidateSeed,
    createdAt: evaluatedAt,
    state: 'candidate',
  };
  const existing = await currentCandidates(store, root);
  if (!existing.has(candidate.candidateId)) {
    await appendPrivate(path.join(store, 'candidates.jsonl'), { action: 'created', ...candidate });
  }
  return { status: 'candidate', networkCalled: true, evaluation, candidate };
}

function reviewTransactionPayload(transaction) {
  const { approval, ...payload } = transaction;
  return payload;
}

function signReviewTransaction(transaction, privateKey, keyId) {
  const payload = reviewTransactionPayload(transaction);
  return {
    ...payload,
    approval: {
      algorithm: 'ed25519',
      evaluator: VERIFIER_EVALUATOR,
      keyId,
      value: sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64url'),
    },
  };
}

async function authenticReviewTransaction(transaction, workspace) {
  const approval = transaction?.approval;
  if (approval?.algorithm !== 'ed25519' || approval.evaluator !== VERIFIER_EVALUATOR ||
      !text(approval.keyId) || !/^[A-Za-z0-9_-]+$/.test(approval.value ?? '')) return false;
  try {
    const publicKey = await resolveTrustedEvaluatorPublicKey({
      host: 'codex',
      provenance: { evaluator: approval.evaluator, keyId: approval.keyId },
    }, { workspaceRoot: workspace });
    return verify(null, Buffer.from(canonical(reviewTransactionPayload(transaction))), publicKey,
      Buffer.from(approval.value, 'base64url'));
  } catch {
    return false;
  }
}

async function trustedReviewTransactions(store, workspace) {
  const transactions = await readJsonLines(path.join(store, 'review-transactions.jsonl'));
  const trusted = [];
  for (const transaction of transactions) {
    const grantsMemory = (transaction.memories ?? []).some((record) =>
      ['approved', 'superseded'].includes(record?.action));
    if (!grantsMemory || await authenticReviewTransaction(transaction, workspace)) trusted.push(transaction);
  }
  return trusted;
}

async function currentCandidates(store, workspace) {
  const records = await readJsonLines(path.join(store, 'candidates.jsonl'));
  const transactions = await trustedReviewTransactions(store, workspace);
  const state = new Map();
  for (const record of records) {
    if (record.action === 'created') state.set(record.candidateId, { ...record });
    else if (state.has(record.candidateId)) {
      state.set(record.candidateId, { ...state.get(record.candidateId), ...record });
    }
  }
  for (const transaction of transactions) {
    const record = transaction.candidate;
    if (record && state.has(record.candidateId)) {
      state.set(record.candidateId, { ...state.get(record.candidateId), ...record });
    }
  }
  return state;
}

async function currentMemories(store, workspace) {
  const records = await readJsonLines(path.join(store, 'memories.jsonl'));
  const transactions = await trustedReviewTransactions(store, workspace);
  const state = new Map();
  for (const record of records) {
    if (record.action === 'approved') state.set(record.memoryId, { ...record });
    else if (state.has(record.memoryId)) state.set(record.memoryId, { ...state.get(record.memoryId), ...record });
  }
  for (const transaction of transactions) {
    for (const record of transaction.memories ?? []) {
      if (record.action === 'approved') state.set(record.memoryId, { ...record });
      else if (state.has(record.memoryId)) state.set(record.memoryId, { ...state.get(record.memoryId), ...record });
    }
  }
  return state;
}

async function recoverReviewLock(lockPath, expectedIdentity) {
  const recoveryPath = `${lockPath}.recovery`;
  let recovery;
  try {
    recovery = await fs.open(recoveryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag, 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('LEARNING_REVIEW_IN_PROGRESS');
    throw error;
  }
  const recoveryIdentity = await recovery.stat();
  try {
    const current = await fs.lstat(lockPath).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!current || current.isSymbolicLink() || !sameIdentity(expectedIdentity, current)) {
      throw new Error('LEARNING_REVIEW_IN_PROGRESS');
    }
    await fs.unlink(lockPath);
  } finally {
    await recovery.close();
    const currentRecovery = await fs.lstat(recoveryPath).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (currentRecovery && !currentRecovery.isSymbolicLink() &&
        sameIdentity(recoveryIdentity, currentRecovery)) await fs.unlink(recoveryPath);
  }
}

async function withReviewLock(store, action) {
  const lockPath = path.join(store, 'review.lock');
  return withVerifiedParent(lockPath, async () => {
    let lock;
    try {
    lock = await fs.open(lockPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag, 0o600);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    const existing = await fs.open(lockPath, constants.O_RDONLY | noFollowFlag);
    let lockIdentity;
    let record;
    try {
      lockIdentity = await existing.stat();
      record = JSON.parse(await existing.readFile('utf8'));
    } catch {
      const current = await fs.lstat(lockPath);
      const incompleteExpired = lockIdentity &&
        Date.now() - lockIdentity.mtimeMs >= REVIEW_LOCK_TTL_MS &&
        !current.isSymbolicLink() && sameIdentity(lockIdentity, current);
      if (!incompleteExpired) throw new Error('LEARNING_REVIEW_IN_PROGRESS');
      await recoverReviewLock(lockPath, lockIdentity);
      return withReviewLock(store, action);
    } finally {
      await existing.close();
    }
    const expired = validTime(record?.expiresAt) && Date.parse(record.expiresAt) <= Date.now();
    let ownerAlive = true;
    if (Number.isSafeInteger(record?.pid) && record.pid > 0) {
      try { process.kill(record.pid, 0); } catch (ownerError) {
        ownerAlive = ownerError?.code !== 'ESRCH';
      }
    }
    const current = await fs.lstat(lockPath);
    if (!expired || ownerAlive || current.isSymbolicLink() || !sameIdentity(lockIdentity, current)) {
      throw new Error('LEARNING_REVIEW_IN_PROGRESS');
    }
    await recoverReviewLock(lockPath, lockIdentity);
    return withReviewLock(store, action);
    }
    const lockIdentity = await lock.stat();
    const createdAt = new Date();
    await lock.writeFile(JSON.stringify({
    schemaVersion: 1,
    pid: process.pid,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + REVIEW_LOCK_TTL_MS).toISOString(),
  }));
    await lock.sync();
    try {
      return await action();
    } finally {
      await lock.close();
      const current = await fs.lstat(lockPath).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
      if (current && !current.isSymbolicLink() && sameIdentity(lockIdentity, current)) {
        await fs.unlink(lockPath);
      }
    }
  });
}

export async function listCandidates({ workspace = process.cwd(), state } = {}) {
  const root = await safeWorkspace(workspace);
  const store = await ensureStore(root);
  return [...(await currentCandidates(store, root)).values()]
    .filter((candidate) => !state || candidate.state === state)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function reviewCandidate({
  workspace = process.cwd(),
  candidateId,
  decision,
  actor,
  reason,
  replacementMemoryId,
  now = () => new Date(),
}) {
  const root = await safeWorkspace(workspace);
  if (!/^candidate_[a-f0-9]{32}$/.test(candidateId ?? '') ||
      !['approve', 'reject', 'supersede'].includes(decision) || !text(actor) || !text(reason)) {
    throw new Error('LEARNING_REVIEW_INVALID');
  }
  let approvalAuthority;
  if (['approve', 'supersede'].includes(decision)) {
    try {
      approvalAuthority = await loadActiveBenchmarkVerifierKey({
        workspaceRoot: root,
        getPassphrase: () => promptHidden(
          `${decision === 'approve' ? 'Approve' : 'Supersede'} ${candidateId} — reviewer passphrase: `
        ),
      });
    } catch (error) {
      if (error?.message === 'TTY_REQUIRED' || error?.message === 'PASSPHRASE_REQUIRED') {
        throw new Error('LEARNING_HUMAN_APPROVAL_REQUIRED');
      }
      throw error;
    }
  }
  const store = await ensureStore(root);
  return withReviewLock(store, async () => {
    const candidates = await currentCandidates(store, root);
    const candidate = candidates.get(candidateId);
    if (!candidate) throw new Error('LEARNING_CANDIDATE_NOT_FOUND');
    const reviewedAt = now().toISOString();
    if (decision === 'approve') {
      if (candidate.state !== 'candidate') throw new Error('LEARNING_CANDIDATE_ALREADY_REVIEWED');
      const memoryCore = {
        schemaVersion: 1,
        candidateId,
        projectId: candidate.projectId,
        title: candidate.proposal.title,
        content: candidate.proposal.lesson,
        kind: candidate.proposal.kind,
        traceId: candidate.traceId,
        traceHash: candidate.traceHash,
        evaluationId: candidate.evaluationId,
        evaluator: candidate.evaluator,
        rubricHash: candidate.rubricHash,
        probabilities: candidate.probabilities,
        approvedAt: reviewedAt,
        approvedBy: redactString(actor, 200),
        approvalReason: redactString(reason, 1000),
      };
      const memory = {
        action: 'approved',
        memoryId: `memory_${sha256(canonical(memoryCore)).slice(0, 32)}`,
        ...memoryCore,
        state: 'approved',
      };
      const candidateUpdate = {
        action: 'reviewed',
        candidateId,
        state: 'approved',
        memoryId: memory.memoryId,
        reviewedAt,
        reviewedBy: redactString(actor, 200),
        reviewReason: redactString(reason, 1000),
      };
      const transaction = {
        action: 'review_transaction',
        transactionId: `review_${sha256(canonical({ candidateUpdate, memory })).slice(0, 32)}`,
        candidate: candidateUpdate,
        memories: [memory],
      };
      await appendPrivate(path.join(store, 'review-transactions.jsonl'),
        signReviewTransaction(transaction, approvalAuthority.privateKey, approvalAuthority.keyId));
      return { candidateId, state: 'approved', memory };
    }
    if (decision === 'reject') {
      if (candidate.state !== 'candidate') throw new Error('LEARNING_CANDIDATE_ALREADY_REVIEWED');
      const review = {
        action: 'reviewed',
        candidateId,
        state: 'rejected',
        reviewedAt,
        reviewedBy: redactString(actor, 200),
        reviewReason: redactString(reason, 1000),
      };
      await appendPrivate(path.join(store, 'review-transactions.jsonl'), {
        action: 'review_transaction',
        transactionId: `review_${sha256(canonical(review)).slice(0, 32)}`,
        candidate: review,
        memories: [],
      });
      return review;
    }
    if (candidate.state !== 'approved' || candidate.memoryId === replacementMemoryId ||
        !/^memory_[a-f0-9]{32}$/.test(replacementMemoryId ?? '')) {
      throw new Error('LEARNING_SUPERSEDE_INVALID');
    }
    const memories = await currentMemories(store, root);
    const current = memories.get(candidate.memoryId);
    const replacement = memories.get(replacementMemoryId);
    if (!current || !replacement || current.projectId !== replacement.projectId ||
        current.projectId !== candidate.projectId || replacement.state !== 'approved') {
      throw new Error('LEARNING_REPLACEMENT_INVALID');
    }
    const update = {
      action: 'superseded',
      memoryId: current.memoryId,
      state: 'superseded',
      supersededBy: replacementMemoryId,
      reviewedAt,
      reviewedBy: redactString(actor, 200),
      reviewReason: redactString(reason, 1000),
    };
    const candidateUpdate = {
      action: 'reviewed',
      candidateId,
      state: 'superseded',
      replacementMemoryId,
      reviewedAt,
      reviewedBy: update.reviewedBy,
      reviewReason: update.reviewReason,
    };
    const transaction = {
      action: 'review_transaction',
      transactionId: `review_${sha256(canonical({ candidateUpdate, update })).slice(0, 32)}`,
      candidate: candidateUpdate,
      memories: [update],
    };
    await appendPrivate(path.join(store, 'review-transactions.jsonl'),
      signReviewTransaction(transaction, approvalAuthority.privateKey, approvalAuthority.keyId));
    return update;
  });
}

function queryTerms(query) {
  return [...new Set(String(query).toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? [])].slice(0, 100);
}

export async function searchApprovedMemory({ workspace = process.cwd(), query, limit = 10 } = {}) {
  if (!text(query) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('LEARNING_SEARCH_INVALID');
  }
  const root = await safeWorkspace(workspace);
  const store = await ensureStore(root);
  const projectId = `project_${sha256(root).slice(0, 24)}`;
  const terms = queryTerms(query);
  return [...(await currentMemories(store, root)).values()]
    .filter((memory) => memory.projectId === projectId && memory.state === 'approved')
    .map((memory) => {
      const haystack = `${memory.title} ${memory.content} ${memory.kind}`.toLowerCase();
      const matches = terms.filter((term) => haystack.includes(term)).length;
      return { ...memory, relevance: terms.length ? matches / terms.length : 0 };
    })
    .filter((memory) => memory.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || String(b.approvedAt).localeCompare(String(a.approvedAt)))
    .slice(0, limit);
}

export async function recordMemoryOutcome({
  workspace = process.cwd(),
  memoryId,
  runId,
  outcome,
  note = '',
  now = () => new Date(),
}) {
  if (!/^memory_[a-f0-9]{32}$/.test(memoryId ?? '') || !text(runId) ||
      !['helped', 'neutral', 'harmed'].includes(outcome)) {
    throw new Error('LEARNING_FEEDBACK_INVALID');
  }
  const root = await safeWorkspace(workspace);
  const store = await ensureStore(root);
  return withReviewLock(store, async () => {
    const memory = (await currentMemories(store, root)).get(memoryId);
    if (!memory || memory.state !== 'approved') throw new Error('LEARNING_MEMORY_NOT_APPROVED');
    const feedbackCore = {
      schemaVersion: 1,
      memoryId,
      projectId: memory.projectId,
      runId: truncateUtf8(runId, 200),
      outcome,
      note: redactString(note, 1000),
    };
    const feedback = {
      ...feedbackCore,
      feedbackId: `feedback_${sha256(canonical(feedbackCore)).slice(0, 32)}`,
      recordedAt: now().toISOString(),
    };
    const existing = await readJsonLines(path.join(store, 'feedback.jsonl'));
    if (existing.some((item) => item.feedbackId === feedback.feedbackId)) return feedback;
    await appendPrivate(path.join(store, 'feedback.jsonl'), feedback);
    return feedback;
  });
}

export async function learningReport({ workspace = process.cwd() } = {}) {
  const root = await safeWorkspace(workspace);
  const store = await ensureStore(root);
  const projectId = `project_${sha256(root).slice(0, 24)}`;
  const candidates = [...(await currentCandidates(store, root)).values()].filter((item) => item.projectId === projectId);
  const memories = [...(await currentMemories(store, root)).values()].filter((item) => item.projectId === projectId);
  const feedback = (await readJsonLines(path.join(store, 'feedback.jsonl'))).filter((item) => item.projectId === projectId);
  const outcomes = Object.fromEntries(['helped', 'neutral', 'harmed'].map((name) => [
    name,
    feedback.filter((item) => item.outcome === name).length,
  ]));
  return {
    projectId,
    candidates: {
      total: candidates.length,
      pending: candidates.filter((item) => item.state === 'candidate').length,
      approved: candidates.filter((item) => item.state === 'approved').length,
      rejected: candidates.filter((item) => item.state === 'rejected').length,
      superseded: candidates.filter((item) => item.state === 'superseded').length,
    },
    memories: {
      approved: memories.filter((item) => item.state === 'approved').length,
      superseded: memories.filter((item) => item.state === 'superseded').length,
    },
    feedback: { total: feedback.length, ...outcomes },
  };
}

function parseArgs(argv) {
  const [action, ...rest] = argv;
  const flags = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const name = rest[index];
    if (!name.startsWith('--')) throw new Error('LEARNING_CLI_INVALID');
    if (name === '--dry-run') flags.set(name, true);
    else {
      const value = rest[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
      flags.set(name, value);
    }
  }
  return { action, flags };
}

async function main() {
  const { action, flags } = parseArgs(process.argv.slice(2));
  const workspace = flags.get('--workspace') ?? process.cwd();
  let result;
  if (action === 'normalize') {
    result = await normalizeJournal({
      workspace,
      input: flags.get('--input'),
      host: flags.get('--host'),
      objective: flags.get('--objective'),
      sessionId: flags.get('--session'),
      sourceKind: flags.get('--source-kind') ?? 'verified-execution-journal',
    });
    result = { traceId: result.trace.traceId, tracePath: result.tracePath };
  } else if (action === 'evaluate') {
    const traceFile = await readBoundedFile(workspace, flags.get('--trace'));
    const lessonFile = await readBoundedFile(workspace, flags.get('--lesson-file'), MAX_LESSON_BYTES);
    result = await evaluateTrace({
      workspace,
      trace: JSON.parse(traceFile.content),
      proposal: {
        title: flags.get('--title'),
        lesson: lessonFile.content,
        kind: flags.get('--kind'),
      },
      dryRun: flags.get('--dry-run') === true,
    });
  } else if (action === 'candidates') {
    result = await listCandidates({ workspace, state: flags.get('--state') });
  } else if (action === 'review') {
    const decision = flags.get('--decision');
    result = await reviewCandidate({
      workspace,
      candidateId: flags.get('--candidate'),
      decision,
      actor: flags.get('--actor'),
      reason: flags.get('--reason'),
      replacementMemoryId: flags.get('--replacement'),
    });
  } else if (action === 'search') {
    result = await searchApprovedMemory({
      workspace,
      query: flags.get('--query'),
      limit: flags.has('--limit') ? Number(flags.get('--limit')) : 10,
    });
  } else if (action === 'feedback') {
    result = await recordMemoryOutcome({
      workspace,
      memoryId: flags.get('--memory'),
      runId: flags.get('--run'),
      outcome: flags.get('--outcome'),
      note: flags.get('--note'),
    });
  } else if (action === 'report') {
    result = await learningReport({ workspace });
  } else {
    throw new Error('Usage: normalize | evaluate | candidates | review | search | feedback | report');
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direct) main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
