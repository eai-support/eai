#!/usr/bin/env node

import { createHash } from 'crypto';
import { constants } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import process from 'process';
import { credentialStatus, resolveApiKey } from './gofer-typesafe-credentials.mjs';

const POLICY_RELATIVE_PATH = path.join('.specify', 'config', 'typesafe-semantic-review.json');
const TYPE_SAFE_TOTAL_INPUT_LIMIT = 64 * 1024;
const TYPE_SAFE_STATE_QUESTION_LIMIT = 32 * 1024;
const TYPE_SAFE_SAFETY_RESERVE_BYTES = 4 * 1024;
const MAX_REVIEW_SOURCE_BYTES = 768 * 1024;
const MAX_REVIEW_PACKETS = 64;
const MAX_REVIEW_DURATION_MS = 120_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REVIEW_PACKET_CONTENT_BYTES = 4 * 1024;
const MAX_INLINE_REQUIREMENT_CONTEXT_BYTES = 4 * 1024;
const MAX_REFERENCE_INDEX_BYTES = 6 * 1024;
const MAX_GOAL_CONTEXT_BYTES = 4 * 1024;
const MAX_AGGREGATE_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_SINGLE_REQUEST_BODY_BYTES = TYPE_SAFE_TOTAL_INPUT_LIMIT;
const MAX_PROVIDER_ERROR_BYTES = 4 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;
const REQUESTED_MODEL = 'jev-latest';
const CHAT_SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g,
  /\bTYPESAFE_API_KEY\s*=\s*[^\s]+/gi,
  /\b(?:api[-_]?key|access[-_]?token|password|secret|token)\s*=\s*[^\s&]+/gi,
];
// A local artifact far larger than any real spec/plan/tasks file is treated
// as a hard error rather than hashed in full: this bounds worst-case memory
// use independent of the provider payload cap.
const MAX_ARTIFACT_READ_BYTES = 8 * 1024 * 1024;
const DELIVERY_ARTIFACTS = [
  'goal-ledger.json',
  'spec.md',
  'plan.md',
  'tasks.md',
  'decisions.md',
  'traceability.md',
  'test-spec.md',
  'change-manifest.json',
  'blast-radius-report.md',
];

function digest(value) { return createHash('sha256').update(value).digest('hex'); }
// O_NOFOLLOW is unavailable on Windows; the bitwise OR silently contributes
// nothing there rather than erroring, which would otherwise look like
// protection that isn't actually applied. lstat detects a symlink or
// junction cross-platform (including Windows) and is the actual protection;
// O_NOFOLLOW only closes the small remaining gap between that check and the
// open, on platforms that support it.
const noFollowFlag = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
async function assertNotSymlink(target) {
  const info = await fs.lstat(target).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (info?.isSymbolicLink()) throw new Error('Gofer path must not be a symbolic link.');
  return info;
}
async function openExistingNoFollow(target, flags) {
  await assertNotSymlink(target);
  return fs.open(target, flags | noFollowFlag);
}
// assertNoSymlinkComponents only walks descendants of root; it never checks
// root itself. A caller-supplied workspace that is a symlink (or missing, or
// not a directory) would otherwise sail through every confinement check
// below it. Matches workspace-bootstrap-lib.mjs's assertSafeWorkspaceRoot.
async function assertSafeWorkspaceRoot(workspaceRoot) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const rootStat = await fs.lstat(resolvedRoot).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!rootStat) throw new Error('Gofer workspace root does not exist.');
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Gofer workspace root must be a real directory, not a symbolic link.');
  }
  return resolvedRoot;
}
// The event name is used verbatim to build the receipt file path. It is
// checked against policy.events, but that list is itself external config
// (or attacker-influenced if the config is compromised) and is never
// restricted to a safe charset, so a value like "../../evil" would satisfy
// the membership check while still escaping receiptDir on join. Restrict to
// a safe charset before it ever reaches a path.
function assertSafeEventName(event) {
  if (!/^[A-Za-z0-9_-]+$/.test(event)) {
    throw new Error('Gofer TypeSafe event name contains unsupported characters.');
  }
}
// A lexical check alone does not stop a symlinked intermediate directory (or
// the feature directory itself) from redirecting reads/writes outside the
// workspace. Walk every component from the workspace root and reject any
// that is a symlink, matching this repository's other protected readers.
async function assertNoSymlinkComponents(root, relativeTarget) {
  const components = relativeTarget.split(path.sep).filter(Boolean);
  let currentPath = root;
  for (const component of components) {
    currentPath = path.join(currentPath, component);
    try {
      const status = await fs.lstat(currentPath);
      if (status.isSymbolicLink()) throw new Error('Gofer feature directory must not pass through a symbolic link.');
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}
// Reject any feature directory outside the workspace instead of trusting the
// caller: an escaping path would read arbitrary files, send their contents to
// the external provider, and write the receipt outside the workspace.
async function confined(workspace, value) {
  const target = path.resolve(workspace, value);
  const relative = path.relative(workspace, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Gofer feature directory must remain inside the workspace.');
  }
  await assertNoSymlinkComponents(workspace, relative);
  // A typo'd or nonexistent feature directory must fail closed here, not
  // silently produce an all-empty state that could earn a false "aligned"
  // verdict and then have the directory created out from under it by mkdir
  // when the receipt is written.
  const info = await fs.lstat(target).catch(() => null);
  if (!info || !info.isDirectory()) throw new Error('Gofer feature directory does not exist.');
  return target;
}
async function parseArgs(argv) {
  const args = { workspace: process.cwd(), featureDir: '', event: '', json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') { args.workspace = argv[++index] || args.workspace; }
    else if (arg === '--feature-dir') { args.featureDir = argv[++index] || ''; }
    else if (arg === '--event') { args.event = argv[++index] || ''; }
    else if (arg === '--json') { args.json = true; }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.featureDir || !args.event) throw new Error('--feature-dir and --event are required');
  assertSafeEventName(args.event);
  args.workspace = await assertSafeWorkspaceRoot(args.workspace); args.featureDir = await confined(args.workspace, args.featureDir); return args;
}
// The policy path is fixed, but a symlinked .specify/config directory or the
// policy file itself could still redirect this read outside the workspace,
// bypassing the same confinement invariant enforced for the feature
// directory and its artifacts. Apply the same no-follow protection.
async function readConfinedJson(workspace, relativePath) {
  await assertNoSymlinkComponents(workspace, relativePath);
  const target = path.join(workspace, relativePath);
  const handle = await openExistingNoFollow(target, constants.O_RDONLY);
  try { return JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
}
// Hash and retain the complete bounded text so the provider never judges an
// artifact prefix. The local read cap bounds memory. Open with O_NOFOLLOW so a
// same-account symlink swap cannot redirect the read. Missing artifacts stay
// distinct from empty files and fail closed before any provider request.
async function readArtifact(target) {
  let handle;
  try { handle = await openExistingNoFollow(target, constants.O_RDONLY); }
  catch (error) {
    if (error?.code === 'ENOENT') return { present: false, sha256: digest(''), sent: '' };
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Gofer feature artifact must be a regular file.');
    if (info.size > MAX_ARTIFACT_READ_BYTES) throw new Error('Gofer feature artifact exceeds the maximum readable size.');
    const hash = createHash('sha256');
    const contentChunks = [];
    let fullBytes = 0;
    // autoClose defaults to true, which would close the handle at EOF and
    // make the finally block's own close() below fail on an already-closed
    // handle. The finally block owns the close; the stream must not race it.
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      fullBytes += chunk.length;
      if (fullBytes > MAX_ARTIFACT_READ_BYTES) throw new Error('Gofer feature artifact exceeds the maximum readable size.');
      hash.update(chunk);
      contentChunks.push(chunk);
    }
    // Preserve an initial UTF-8 BOM as source content. TextDecoder strips it
    // by default, which would make a "complete" review omit real source bytes.
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(contentChunks));
    return { present: true, sha256: hash.digest('hex'), bytes: fullBytes, content, complete: true };
  } finally { await handle.close(); }
}
function normalizeAnswer(answer) { return String(answer || '').trim().toLowerCase(); }
function redactChatContext(value) {
  let redacted = String(value || '');
  for (const pattern of CHAT_SECRET_PATTERNS) redacted = redacted.replace(pattern, '[REDACTED]');
  return redacted;
}

const QUESTION_CHOICES = {
  goal_alignment: ['aligned', 'partial', 'conflict'],
  specification_currency: ['aligned', 'partial', 'conflict'],
  test_coverage: ['aligned', 'partial', 'conflict'],
  blast_radius: ['aligned', 'partial', 'conflict'],
  chat_readiness: ['ready', 'reconcile', 'ask_user'],
  required_action: ['continue', 'reconcile', 'ask_user'],
};

function buildQuestions(event) {
  return {
    goal_alignment: { type: 'choice', instructions: 'Does the current work remain aligned to the approved goal and specification?', criteria: { aligned: 'The work remains aligned.', partial: 'The work needs document reconciliation.', conflict: 'The work conflicts with approved direction.' } },
    specification_currency: { type: 'choice', instructions: 'Compare the supplied specification, plan, tasks, decisions, traceability, and change manifest. Are the stated implementation paths, completed-task status, commit evidence, and material changes internally consistent and current? Select partial only when you can identify a concrete missing or stale record.', criteria: { aligned: 'All supplied delivery records agree on the current implementation and no concrete stale or missing record is present.', partial: 'A concrete delivery record is missing, stale, or inconsistent and needs reconciliation.', conflict: 'The recorded implementation conflicts with the approved specification or decision.' } },
    test_coverage: { type: 'choice', instructions: 'Does the test specification map the changed behavior to executable owning-repository tests and any required eai-testing-dev release evidence?', criteria: { aligned: 'The changed behavior has complete executable coverage.', partial: 'The test evidence is incomplete or stale.', conflict: 'The test evidence contradicts the claimed behavior.' } },
    blast_radius: { type: 'choice', instructions: 'Does the change manifest and blast-radius report cover all affected interfaces, packages, release surfaces, dependencies, rollback paths, and external test contracts?', criteria: { aligned: 'The blast radius is complete and contained.', partial: 'The blast-radius evidence is incomplete or stale.', conflict: 'The reported blast radius conflicts with the changed surface.' } },
    ...(event === 'chat_readiness' ? { chat_readiness: { type: 'choice', instructions: 'Using the supplied chat context summary and the current goal, specification, plan, tasks, decisions, and approved edit scope, is this chat ready to deliver the requested outcome? Identify any concrete missing context or contradiction.', criteria: { ready: 'The request and constraints are clear, the approved feature records match the current request, and the next task and edit scope are defined.', reconcile: 'The chat context or feature records have a concrete gap or inconsistency that must be reconciled before code edits.', ask_user: 'A material business, security, cost, deployment, or destructive decision requires the user.' } } } : {}),
    required_action: { type: 'choice', instructions: 'Choose the action required by the evidence judgments. Select continue only when all are aligned; select reconcile when any is partial or evidence is missing; select ask_user only for a genuine conflict requiring a new business decision.', criteria: { continue: 'All evidence judgments are aligned.', reconcile: 'At least one evidence judgment is partial or missing.', ask_user: 'A conflict requires a material user decision.' } },
  };
}

// TypeSafe publishes token limits, not a tokenizer endpoint. Count the exact
// UTF-8 JSON representation as a conservative local upper bound and reserve
// 4 KiB for provider framing. This is not an exact token estimate.
export function measureTypeSafeInputBudget(state, questions) {
  const stateBytes = Buffer.byteLength(JSON.stringify(state), 'utf8');
  const questionEntries = Object.entries(questions || {});
  const questionBytes = questionEntries.map(([id, question]) => Buffer.byteLength(JSON.stringify({ [id]: question }), 'utf8'));
  const longestQuestionBytes = questionBytes.length ? Math.max(...questionBytes) : 0;
  const allQuestionsBytes = Buffer.byteLength(JSON.stringify(questions || {}), 'utf8');
  const statePlusLongestQuestionBytes = stateBytes + longestQuestionBytes;
  const statePlusAllQuestionsBytes = stateBytes + allQuestionsBytes;
  const safePairLimitBytes = TYPE_SAFE_STATE_QUESTION_LIMIT - TYPE_SAFE_SAFETY_RESERVE_BYTES;
  const safeTotalLimitBytes = TYPE_SAFE_TOTAL_INPUT_LIMIT - TYPE_SAFE_SAFETY_RESERVE_BYTES;
  return {
    basis: 'utf8_serialized_bytes_upper_bound_not_tokenizer',
    stateBytes,
    longestQuestionBytes,
    allQuestionsBytes,
    statePlusLongestQuestionBytes,
    statePlusAllQuestionsBytes,
    safetyReserveBytes: TYPE_SAFE_SAFETY_RESERVE_BYTES,
    publishedStateQuestionLimit: TYPE_SAFE_STATE_QUESTION_LIMIT,
    publishedTotalInputLimit: TYPE_SAFE_TOTAL_INPUT_LIMIT,
    safeStateQuestionLimitBytes: safePairLimitBytes,
    safeTotalInputLimitBytes: safeTotalLimitBytes,
    withinLimits: statePlusLongestQuestionBytes <= safePairLimitBytes && statePlusAllQuestionsBytes <= safeTotalLimitBytes,
  };
}

async function readBoundedResponseText(response, limit = MAX_PROVIDER_ERROR_BYTES) {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - bytes;
      if (value.length > remaining) {
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        bytes += Math.max(remaining, 0);
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      bytes += value.length;
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}

function safeToken(value, maxLength = 80) {
  return typeof value === 'string' && value.length <= maxLength && /^[A-Za-z0-9_.:-]+$/.test(value) ? value : null;
}

function safeLocation(value) {
  if (!Array.isArray(value)) return null;
  const segments = value.slice(0, 8).map((segment) => {
    if (Number.isInteger(segment) && segment >= 0) return String(segment);
    return safeToken(segment);
  });
  return segments.length && segments.every(Boolean) ? segments.join('.') : null;
}

function providerDiagnostics(response, bodyText, bodyTruncated) {
  const headers = response.headers;
  const requestId = safeToken(headers?.get?.('x-typesafe-request-id') || headers?.get?.('x-request-id') || headers?.get?.('request-id') || '', 128);
  const diagnostic = { httpStatus: response.status };
  if (requestId) diagnostic.requestId = requestId;
  if (bodyTruncated) {
    diagnostic.bodyTruncated = true;
    return diagnostic;
  }
  let payload;
  try { payload = JSON.parse(bodyText); } catch { return diagnostic; }
  const code = safeToken(payload?.code || payload?.type);
  if (code) diagnostic.code = code;
  const details = Array.isArray(payload?.detail) ? payload.detail : Array.isArray(payload?.errors) ? payload.errors : [];
  const validation = details.slice(0, 8).map((item) => ({
    ...(safeLocation(item?.loc) ? { location: safeLocation(item.loc) } : {}),
    ...(safeToken(item?.type) ? { type: safeToken(item.type) } : {}),
  })).filter((item) => item.location || item.type);
  if (validation.length) diagnostic.validation = validation;
  return diagnostic;
}

function normalizeProbabilities(answer, questionId) {
  if (!answer?.probabilities || typeof answer.probabilities !== 'object' || Array.isArray(answer.probabilities)) return null;
  const allowed = QUESTION_CHOICES[questionId] || [];
  const entries = Object.entries(answer.probabilities);
  if (entries.length !== allowed.length || allowed.some((choice) => !Object.hasOwn(answer.probabilities, choice))) return null;
  if (entries.some(([, probability]) => typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1)) return null;
  const total = entries.reduce((sum, [, probability]) => sum + probability, 0);
  return entries.length && Math.abs(total - 1) <= 0.02 ? Object.fromEntries(entries) : null;
}

function answerRecord(answer, questionId) {
  const probabilities = normalizeProbabilities(answer, questionId);
  const choice = typeof answer?.choice === 'string' && QUESTION_CHOICES[questionId]?.includes(answer.choice) ? answer.choice : null;
  const closestAlternative = probabilities
    ? Object.entries(probabilities).filter(([option]) => option !== choice).sort((left, right) => right[1] - left[1])[0]
    : null;
  return {
    choice,
    confidence: answer?.confidence ?? null,
    probabilities,
    closestAlternative: closestAlternative ? { choice: closestAlternative[0], probability: closestAlternative[1] } : null,
  };
}

function splitAtUtf8Boundaries(content, maxBytes) {
  if (!content) return [''];
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) || [content];
  const segments = [];
  let current = '';
  let currentBytes = 0;
  const flush = () => {
    if (!current) return;
    segments.push(current);
    current = '';
    currentBytes = 0;
  };
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (lineBytes <= maxBytes) {
      if (currentBytes + lineBytes > maxBytes) flush();
      current += line;
      currentBytes += lineBytes;
      continue;
    }
    flush();
    let part = '';
    let partBytes = 0;
    for (const character of line) {
      const characterBytes = Buffer.byteLength(character, 'utf8');
      if (partBytes + characterBytes > maxBytes) {
        segments.push(part);
        part = '';
        partBytes = 0;
      }
      part += character;
      partBytes += characterBytes;
    }
    if (part) segments.push(part);
  }
  flush();
  return segments;
}

function buildSourceManifest(sources) {
  return sources.map((source) => ({
    artifact: source.artifact,
    present: source.present,
    byteLength: source.byteLength,
    sha256: source.sha256,
  }));
}

function buildReferenceIndex(sources) {
  const references = new Map();
  const pattern = /\b(?:FR|NFR|SC)-\d+\b|\b(?:US|T|D)\d+\b/g;
  for (const source of sources) {
    for (const match of source.content.matchAll(pattern)) {
      const id = match[0];
      if (!references.has(id)) references.set(id, new Set());
      references.get(id).add(source.artifact);
    }
  }
  return [...references.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([id, artifacts]) => ({ id, artifacts: [...artifacts].sort() }));
}

function buildRequirementReferences(sources) {
  const references = [];
  const pattern = /\b(?:FR|NFR|SC)-\d+\b/g;
  for (const source of sources) {
    let previousCharacterOffset = 0;
    let previousByteOffset = 0;
    for (const match of source.content.matchAll(pattern)) {
      if (typeof match.index !== 'number') continue;
      const startByte = previousByteOffset + Buffer.byteLength(
        source.content.slice(previousCharacterOffset, match.index),
        'utf8',
      );
      const endByte = startByte + Buffer.byteLength(match[0], 'utf8');
      references.push({ id: match[0], artifact: source.artifact, startByte, endByte });
      previousCharacterOffset = match.index + match[0].length;
      previousByteOffset = endByte;
    }
  }
  return references;
}

function matchRequirementDefinition(line) {
  const boldRequirement = line.match(/^\s*(?:[-*]\s+)?\*\*((?:FR|NFR|SC)-\d+)(?:\s+\([^)]*\))?\*\*\s*(?::|[-—–])/);
  if (boldRequirement) return { id: boldRequirement[1], headingLevel: null };

  const headingRequirement = line.match(/^\s*(#{1,6})\s+(?:\*\*)?((?:FR|NFR|SC)-\d+)(?:\s+\([^)]*\))?(?:\*\*)?\s*(?::|[-—–])/);
  if (headingRequirement) return { id: headingRequirement[2], headingLevel: headingRequirement[1].length };

  const plainRequirement = line.match(/^\s*((?:FR|NFR|SC)-\d+)\s*(?::|[-—–])/);
  if (plainRequirement) return { id: plainRequirement[1], headingLevel: null };

  return null;
}

function extractReviewAnchors(sources) {
  const goalSource = sources.find((source) => source.artifact === 'goal-ledger.json');
  let ledger;
  try { ledger = JSON.parse((goalSource?.content || 'null').replace(/^\uFEFF/, '')); } catch { ledger = null; }
  const goals = Array.isArray(ledger?.goals)
    ? ledger.goals.filter((item) => typeof item?.goal === 'string' && item.goal.trim()).map((item) => ({ id: item.id || null, goal: item.goal }))
    : typeof ledger?.goal === 'string' && ledger.goal.trim() ? [{ id: ledger.id || null, goal: ledger.goal }] : [];
  if (!goals.length || Buffer.byteLength(JSON.stringify(goals), 'utf8') > MAX_GOAL_CONTEXT_BYTES) return null;

  const specification = sources.find((source) => source.artifact === 'spec.md')?.content || '';
  const lines = specification.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) || [];
  const requirements = new Map();
  let duplicateRequirementId = null;
  let currentId = null;
  let currentLines = [];
  let currentStartByte = 0;
  let currentEndByte = 0;
  let currentHeadingLevel = null;
  let sectionHeadingLevel = null;
  let byteOffset = 0;
  const saveCurrent = () => {
    if (currentId && currentLines.length) {
      if (requirements.has(currentId)) duplicateRequirementId ||= currentId;
      else requirements.set(currentId, {
        content: currentLines.join(''),
        startByte: currentStartByte,
        endByte: currentEndByte,
      });
    }
    currentId = null;
    currentLines = [];
    currentHeadingLevel = null;
  };
  for (const line of lines) {
    const lineStartByte = byteOffset;
    const lineEndByte = lineStartByte + Buffer.byteLength(line, 'utf8');
    const normalizedLine = line.replace(/^\uFEFF/, '');
    const requirement = matchRequirementDefinition(normalizedLine);
    if (requirement) {
      saveCurrent();
      if (requirements.has(requirement.id)) duplicateRequirementId ||= requirement.id;
      currentId = requirement.id;
      currentLines = [line];
      currentStartByte = lineStartByte;
      currentEndByte = lineEndByte;
      currentHeadingLevel = requirement.headingLevel ?? sectionHeadingLevel;
      if (requirement.headingLevel) sectionHeadingLevel = requirement.headingLevel;
      byteOffset = lineEndByte;
      continue;
    }
    const headingLevel = normalizedLine.match(/^\s*(#{1,6})\s+/)?.[1].length || null;
    if (headingLevel) {
      if (currentId && (currentHeadingLevel === null || headingLevel <= currentHeadingLevel)) saveCurrent();
      if (currentId) {
        currentLines.push(line);
        currentEndByte = lineEndByte;
        byteOffset = lineEndByte;
        continue;
      }
      sectionHeadingLevel = headingLevel;
    }
    if (currentId) {
      currentLines.push(line);
      currentEndByte = lineEndByte;
    }
    byteOffset = lineEndByte;
  }
  saveCurrent();
  if (duplicateRequirementId) return { ok: false, reason: 'duplicate_requirement_id' };
  return { ok: true, goals, requirements };
}

function requirementContextFragment(id, requirement, startByte, endByte) {
  const contentBytes = Buffer.from(requirement.content, 'utf8');
  const relativeStart = startByte - requirement.startByte;
  const relativeEnd = endByte - requirement.startByte;
  return {
    id,
    sourceRange: { artifact: 'spec.md', startByte, endByte },
    definitionRange: { artifact: 'spec.md', startByte: requirement.startByte, endByte: requirement.endByte },
    content: contentBytes.subarray(relativeStart, relativeEnd).toString('utf8'),
    contextMode: 'exact_source_range',
    definitionComplete: startByte === requirement.startByte && endByte === requirement.endByte,
  };
}

function packetState({ manifest, referenceIndex, requirementReferences, anchors, segments, packetIndex, packetCount, snapshotSha256 }) {
  const referencedIds = new Set();
  for (const segment of segments) {
    if (segment.artifact === 'spec.md') {
      for (const [id, requirement] of anchors.requirements) {
        if (segment.startByte < requirement.endByte && requirement.startByte < segment.endByte) referencedIds.add(id);
      }
    }
  }
  for (const reference of requirementReferences) {
    if (segments.some((segment) => segment.artifact === reference.artifact &&
        segment.startByte < reference.endByte && reference.startByte < segment.endByte)) {
      referencedIds.add(reference.id);
    }
  }
  const requirementContext = [];
  const requirementContextIssues = [];
  for (const id of [...referencedIds].sort()) {
    const requirement = anchors.requirements.get(id);
    if (!requirement) {
      requirementContext.push({ id, sourceRange: null, definitionRange: null, content: null, contextMode: 'definition_missing', definitionComplete: false });
      requirementContextIssues.push(`requirement_definition_missing:${id}`);
      continue;
    }
    const definitionRange = { artifact: 'spec.md', startByte: requirement.startByte, endByte: requirement.endByte };
    const specSegments = segments.filter((segment) => segment.artifact === 'spec.md' &&
      segment.startByte < requirement.endByte && requirement.startByte < segment.endByte);
    for (const segment of specSegments) {
      const startByte = Math.max(segment.startByte, requirement.startByte);
      const endByte = Math.min(segment.endByte, requirement.endByte);
      requirementContext.push(requirementContextFragment(id, requirement, startByte, endByte));
    }
    const hasReferenceOutsideDefinition = requirementReferences.some((reference) =>
      reference.id === id && (reference.artifact !== 'spec.md' ||
        reference.startByte < requirement.startByte || reference.endByte > requirement.endByte));
    if (hasReferenceOutsideDefinition) {
      const specRanges = specSegments.map((segment) => ({
        startByte: Math.max(segment.startByte, requirement.startByte),
        endByte: Math.min(segment.endByte, requirement.endByte),
      })).sort((left, right) => left.startByte - right.startByte);
      let coveredUntil = requirement.startByte;
      for (const range of specRanges) {
        if (range.startByte > coveredUntil) break;
        coveredUntil = Math.max(coveredUntil, range.endByte);
      }
      const completeInPacket = coveredUntil === requirement.endByte;
      if (!completeInPacket && Buffer.byteLength(requirement.content, 'utf8') <= MAX_INLINE_REQUIREMENT_CONTEXT_BYTES) {
        requirementContext.push(requirementContextFragment(id, requirement, requirement.startByte, requirement.endByte));
      } else if (!completeInPacket) {
        requirementContext.push({
          id,
          sourceRange: null,
          definitionRange,
          content: null,
          contextMode: 'linked_definition_range',
          definitionComplete: false,
        });
        requirementContextIssues.push(`requirement_context_exceeds_packet_budget:${id}`);
      }
    }
  }
  const requirementContextComplete = requirementContextIssues.length === 0;
  return {
    review: {
      mode: 'bounded_multi_pass',
      packetId: `P${String(packetIndex).padStart(3, '0')}`,
      packetIndex,
      packetCount,
      sourceSnapshotSha256: snapshotSha256,
      instruction: 'This request contains only the exact source ranges listed below, the exact approved goal statements, and requirement context linked to exact source byte ranges. Other ranges are reviewed in separate requests. Do not assume unseen content is aligned; use partial or reconcile when this packet and the structural index do not provide enough evidence.',
      continuity: 'separate_stateless_evaluation',
      requirementContextComplete,
      requirementContextIssues,
    },
    approved_goal_context: anchors.goals,
    requirement_context: requirementContext,
    artifact_index: manifest,
    reference_index: referenceIndex,
    segments: segments.map((segment) => ({
      artifact: segment.artifact,
      segmentId: segment.id,
      startByte: segment.startByte,
      endByte: segment.endByte,
      sha256: segment.sha256,
      content: segment.content,
    })),
  };
}

function createReviewSegments(sources) {
  const segments = [];
  const totalBytes = sources.reduce((sum, source) => sum + source.byteLength, 0);
  if (totalBytes > MAX_REVIEW_SOURCE_BYTES) return { ok: false, reason: 'segmentation_limits_exceeded', totalBytes };
  let sourceOrdinal = 0;
  for (const source of sources) {
    sourceOrdinal += 1;
    const parts = splitAtUtf8Boundaries(source.content, MAX_REVIEW_PACKET_CONTENT_BYTES);
    let startByte = 0;
    let partOrdinal = 0;
    for (const content of parts) {
      partOrdinal += 1;
      const byteLength = Buffer.byteLength(content, 'utf8');
      const bytes = Buffer.from(content, 'utf8');
      segments.push({
        id: `A${String(sourceOrdinal).padStart(2, '0')}-S${String(partOrdinal).padStart(3, '0')}`,
        artifact: source.artifact,
        startByte,
        endByte: startByte + byteLength,
        sha256: digest(bytes),
        content,
      });
      startByte += byteLength;
    }
    if (startByte !== source.byteLength) return { ok: false, reason: 'source_range_coverage_invalid', totalBytes };
  }
  return { ok: true, segments, totalBytes };
}

function verifySegmentCoverage(sources, segments) {
  const byArtifact = new Map(sources.map((source) => [source.artifact, []]));
  for (const segment of segments) {
    if (!byArtifact.has(segment.artifact)) return false;
    byArtifact.get(segment.artifact).push(segment);
  }
  for (const source of sources) {
    const ranges = byArtifact.get(source.artifact).sort((left, right) => left.startByte - right.startByte);
    if (!ranges.length) return false;
    let cursor = 0;
    for (const range of ranges) {
      if (range.startByte !== cursor || range.endByte < range.startByte ||
          digest(Buffer.from(range.content, 'utf8')) !== range.sha256) return false;
      cursor = range.endByte;
    }
    if (cursor !== source.byteLength) return false;
  }
  return true;
}

function buildMultiPassPlan(sources, questions) {
  const sourcePlan = createReviewSegments(sources);
  if (!sourcePlan.ok) return sourcePlan;
  const anchors = extractReviewAnchors(sources);
  if (!anchors) return { ok: false, reason: 'segmentation_limits_exceeded', totalBytes: sourcePlan.totalBytes };
  if (!anchors.ok) return { ok: false, reason: anchors.reason, totalBytes: sourcePlan.totalBytes };
  const manifest = buildSourceManifest(sources);
  const referenceIndex = buildReferenceIndex(sources);
  const requirementReferences = buildRequirementReferences(sources);
  if (Buffer.byteLength(JSON.stringify(referenceIndex), 'utf8') > MAX_REFERENCE_INDEX_BYTES) {
    return { ok: false, reason: 'segmentation_limits_exceeded', totalBytes: sourcePlan.totalBytes };
  }
  const snapshotSha256 = digest(JSON.stringify(manifest));
  const packets = [];
  let pending = [];
  const withinPacketBudget = (candidate, packetIndex) => measureTypeSafeInputBudget(
    packetState({ manifest, referenceIndex, requirementReferences, anchors, segments: candidate, packetIndex, packetCount: MAX_REVIEW_PACKETS, snapshotSha256 }),
    questions,
  ).withinLimits;
  for (const segment of sourcePlan.segments) {
    const candidate = [...pending, segment];
    if (withinPacketBudget(candidate, packets.length + 1)) {
      pending = candidate;
      continue;
    }
    if (!pending.length || packets.length + 1 >= MAX_REVIEW_PACKETS) {
      return { ok: false, reason: 'segmentation_limits_exceeded', totalBytes: sourcePlan.totalBytes };
    }
    packets.push(pending);
    pending = [segment];
    if (!withinPacketBudget(pending, packets.length + 1)) {
      return { ok: false, reason: 'segmentation_limits_exceeded', totalBytes: sourcePlan.totalBytes };
    }
  }
  if (pending.length) packets.push(pending);
  if (!packets.length || packets.length > MAX_REVIEW_PACKETS || !verifySegmentCoverage(sources, packets.flat())) {
    return { ok: false, reason: 'segmentation_limits_exceeded', totalBytes: sourcePlan.totalBytes };
  }
  const requests = packets.map((segments, index) => {
    const state = packetState({ manifest, referenceIndex, requirementReferences, anchors, segments, packetIndex: index + 1, packetCount: packets.length, snapshotSha256 });
    const body = JSON.stringify({ model: REQUESTED_MODEL, state, questions });
    const inputBudget = measureTypeSafeInputBudget(state, questions);
    return {
      id: state.review.packetId,
      index: index + 1,
      state,
      body,
      inputBudget,
      requestBytes: Buffer.byteLength(body, 'utf8'),
      contextComplete: state.review.requirementContextComplete,
      contextIssues: state.review.requirementContextIssues,
      sourceRanges: segments.map(({ artifact, startByte, endByte, sha256 }) => ({ artifact, startByte, endByte, sha256 })),
    };
  });
  const aggregateRequestBytes = requests.reduce((sum, request) => sum + request.requestBytes, 0);
  if (requests.some((request) => !request.inputBudget.withinLimits || request.requestBytes > MAX_SINGLE_REQUEST_BODY_BYTES) ||
      aggregateRequestBytes > MAX_AGGREGATE_REQUEST_BYTES) {
    return { ok: false, reason: 'segmentation_limits_exceeded', totalBytes: sourcePlan.totalBytes };
  }
  return {
    ok: true,
    requests,
    segmentCount: sourcePlan.segments.length,
    manifest,
    snapshotSha256,
    totalSourceBytes: sourcePlan.totalBytes,
    totalCoveredBytes: sourcePlan.totalBytes,
    aggregateRequestBytes,
    referenceCount: referenceIndex.length,
  };
}

function responseAnswerIds(event) {
  return ['goal_alignment', 'specification_currency', 'test_coverage', 'blast_radius', 'required_action',
    ...(event === 'chat_readiness' ? ['chat_readiness'] : [])];
}

function validateTypeSafeResponse(payload, event) {
  const issues = [];
  if (!safeToken(payload?.model, 80)) issues.push('model_missing_or_invalid');
  const usage = payload?.usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage) ||
      !Number.isSafeInteger(usage.input_tokens) || usage.input_tokens < 0 ||
      !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0) {
    issues.push('usage_missing_or_invalid');
  }
  const answers = payload?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    issues.push('answers_missing_or_invalid');
    return issues;
  }
  for (const id of responseAnswerIds(event)) {
    const answer = answers[id];
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
      issues.push(`answer_${id}_missing_or_invalid`);
      continue;
    }
    if (answer.type !== 'choice') issues.push(`answer_${id}_type_invalid`);
    if (typeof answer.choice !== 'string' || !QUESTION_CHOICES[id]?.includes(answer.choice)) {
      issues.push(`answer_${id}_choice_invalid`);
    }
    if (typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
      issues.push(`answer_${id}_confidence_invalid`);
    }
    const probabilities = normalizeProbabilities(answer, id);
    if (!probabilities) {
      issues.push(`answer_${id}_probabilities_invalid`);
    } else if (QUESTION_CHOICES[id]?.includes(answer.choice)) {
      const highestProbability = Math.max(...Object.values(probabilities));
      if (probabilities[answer.choice] < highestProbability - 0.02) issues.push(`answer_${id}_choice_not_highest_probability`);
    }
  }
  return issues;
}

function interpretTypeSafeResponse(payload, event, minimumConfidence) {
  const responseValidation = validateTypeSafeResponse(payload, event);
  const providerModel = safeToken(payload?.model, 80);
  const usage = payload?.usage && Number.isSafeInteger(payload.usage.input_tokens) && payload.usage.input_tokens >= 0 &&
    Number.isSafeInteger(payload.usage.output_tokens) && payload.usage.output_tokens >= 0
    ? { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens }
    : null;
  if (responseValidation.length) {
    return {
      status: 'unavailable',
      reason: 'invalid_response_schema',
      model: providerModel,
      usage,
      responseValidation: responseValidation.slice(0, 16),
    };
  }
  const answers = payload.answers && typeof payload.answers === 'object' ? payload.answers : {};
  const alignmentAnswer = answers.goal_alignment || {};
  const specificationAnswer = answers.specification_currency || {};
  const testAnswer = answers.test_coverage || {};
  const blastRadiusAnswer = answers.blast_radius || {};
  const actionAnswer = answers.required_action || {};
  const chatReadinessAnswer = answers.chat_readiness || {};
  const alignment = normalizeAnswer(alignmentAnswer.choice);
  const specification = normalizeAnswer(specificationAnswer.choice);
  const testCoverage = normalizeAnswer(testAnswer.choice);
  const blastRadius = normalizeAnswer(blastRadiusAnswer.choice);
  const action = normalizeAnswer(actionAnswer.choice);
  const chatReadiness = event === 'chat_readiness' ? normalizeAnswer(chatReadinessAnswer.choice) : '';
  const responseAnswers = [alignmentAnswer, specificationAnswer, testAnswer, blastRadiusAnswer, actionAnswer,
    ...(event === 'chat_readiness' ? [chatReadinessAnswer] : [])];
  const confidences = responseAnswers.map((answer) => {
    const value = Number(answer.confidence);
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
  });
  const confidence = Math.min(...confidences);
  const evidenceAlignments = [alignment, specification, testCoverage, blastRadius];
  const recognized = evidenceAlignments.every((value) => KNOWN_ALIGNMENTS.has(value)) && KNOWN_ACTIONS.has(action) &&
    (event !== 'chat_readiness' || KNOWN_CHAT_READINESS.has(chatReadiness));
  const status = evidenceAlignments.includes('conflict') || action === 'ask_user' || chatReadiness === 'ask_user' ? 'conflict'
    : !recognized || confidence < minimumConfidence || evidenceAlignments.includes('partial') || action === 'reconcile' || chatReadiness === 'reconcile' ? 'reconcile'
    : 'aligned';
  const answerIds = responseAnswerIds(event);
  const answerRecords = Object.fromEntries(answerIds.map((id) => [id, answerRecord(answers[id] || {}, id)]));
  const weakestIndex = confidences.indexOf(confidence);
  const weakestQuestionId = answerIds[weakestIndex] || null;
  return {
    status,
    reason: status === 'reconcile' ? (confidence < minimumConfidence ? 'confidence_below_minimum_or_evidence_needs_reconciliation' : 'evidence_needs_reconciliation') : null,
    model: providerModel,
    usage,
    confidence,
    answers: answerRecords,
    confidenceGate: {
      observed: confidence,
      belowMinimum: confidence < minimumConfidence,
      weakestQuestion: weakestQuestionId ? {
        id: weakestQuestionId,
        choice: answerRecords[weakestQuestionId].choice,
        confidence: answerRecords[weakestQuestionId].confidence,
        probabilities: answerRecords[weakestQuestionId].probabilities,
        closestAlternative: answerRecords[weakestQuestionId].closestAlternative,
      } : null,
    },
  };
}

async function requestTypeSafeEvaluation({ state, body, questions, event, minimumConfidence, fetchImpl, apiKey,
  timeoutMs = REQUEST_TIMEOUT_MS, timeoutReason = 'timeout' }) {
  let response;
  try {
    response = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: body || JSON.stringify({ model: REQUESTED_MODEL, state, questions }),
    });
  } catch (error) {
    return {
      requestAttempted: true,
      requestSent: null,
      status: 'unavailable',
      reason: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? timeoutReason : 'network_error',
    };
  }
  if (!response.ok) {
    const errorBody = await readBoundedResponseText(response);
    return {
      requestAttempted: true,
      requestSent: true,
      status: 'unavailable',
      reason: 'provider_http_error',
      providerError: providerDiagnostics(response, errorBody.text, errorBody.truncated),
    };
  }
  const responseBody = await readBoundedResponseText(response, MAX_PROVIDER_RESPONSE_BYTES);
  if (responseBody.truncated) {
    return { requestAttempted: true, requestSent: true, status: 'unavailable', reason: 'response_too_large' };
  }
  let payload;
  try { payload = JSON.parse(responseBody.text); } catch {
    return { requestAttempted: true, requestSent: true, status: 'unavailable', reason: 'invalid_response_body' };
  }
  return { requestAttempted: true, requestSent: true, ...interpretTypeSafeResponse(payload, event, minimumConfidence) };
}

function aggregatePacketResults(packetResults, minimumConfidence, event, plannedPacketCount = packetResults.length) {
  const conflict = packetResults.some((packet) => packet.status === 'conflict');
  const incomplete = packetResults.some((packet) => packet.status === 'unavailable');
  const reconcile = packetResults.some((packet) => packet.status === 'reconcile');
  const confidenceValues = packetResults.map((packet) => packet.confidence);
  const confidence = confidenceValues.length && confidenceValues.every(Number.isFinite) ? Math.min(...confidenceValues) : 0;
  const status = conflict ? 'conflict' : incomplete ? 'unavailable' : reconcile || confidence < minimumConfidence ? 'reconcile' : 'aligned';
  const answerIds = ['goal_alignment', 'specification_currency', 'test_coverage', 'blast_radius', 'required_action',
    ...(event === 'chat_readiness' ? ['chat_readiness'] : [])];
  const answers = {};
  for (const id of answerIds) {
    const entries = packetResults.map((packet) => ({ packetId: packet.id, ...(packet.answers?.[id] || {}) }))
      .filter((answer) => answer.choice !== undefined || answer.confidence !== undefined);
    const weakest = entries.sort((left, right) => (left.confidence ?? 0) - (right.confidence ?? 0))[0];
    const choices = [...new Set(entries.map((answer) => answer.choice).filter(Boolean))];
    answers[id] = weakest ? {
      ...weakest,
      choice: choices.length === 1 ? choices[0] : null,
      choices,
      confidence: entries.reduce((lowest, answer) => Math.min(lowest, Number.isFinite(answer.confidence) ? answer.confidence : 0), 1),
    } : { choice: null, confidence: 0, choices: [] };
  }
  const weakest = packetResults.flatMap((packet) => Object.entries(packet.answers || {}).map(([id, answer]) => ({
    id,
    packetId: packet.id,
    packetIndex: packet.index,
    ...answer,
  }))).sort((left, right) => (left.confidence ?? 0) - (right.confidence ?? 0))[0];
  const models = [...new Set(packetResults.map((packet) => packet.model).filter(Boolean))];
  const knownUsage = packetResults.map((packet) => packet.usage).filter(Boolean);
  const usageComplete = packetResults.length === plannedPacketCount &&
    knownUsage.length === plannedPacketCount && plannedPacketCount > 0;
  const usage = knownUsage.length ? {
    inputTokens: knownUsage.reduce((sum, value) => sum + value.inputTokens, 0),
    outputTokens: knownUsage.reduce((sum, value) => sum + value.outputTokens, 0),
  } : null;
  const gate = {
    minimum: minimumConfidence,
    observed: confidence,
    belowMinimum: confidence < minimumConfidence,
    weakestQuestion: weakest ? {
      id: weakest.id,
      packetId: weakest.packetId,
      packetIndex: weakest.packetIndex,
      choice: weakest.choice,
      confidence: weakest.confidence,
      probabilities: weakest.probabilities,
      closestAlternative: weakest.closestAlternative,
    } : null,
  };
  return { status, confidence, answers, confidenceGate: gate, models, model: models.length === 1 ? models[0] : null, usage, usageComplete };
}

async function saveReceipt(featureDir, event, receipt) {
  const receiptRelativeDir = path.join('evidence', 'semantic-review');
  await assertNoSymlinkComponents(featureDir, receiptRelativeDir);
  const receiptDir = path.join(featureDir, receiptRelativeDir);
  await fs.mkdir(receiptDir, { recursive: true });
  const receiptPath = path.join(receiptDir, `${event}.json`);
  await assertNotSymlink(receiptPath);
  let previous;
  try {
    const previousHandle = await openExistingNoFollow(receiptPath, constants.O_RDONLY);
    try { previous = await previousHandle.readFile('utf8'); } finally { await previousHandle.close(); }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (previous) {
    let previousVersion;
    try { previousVersion = JSON.parse(previous).schemaVersion; } catch {}
    if ([2, 3].includes(previousVersion)) {
      const archivePath = path.join(receiptDir, `${event}.v${previousVersion}.json`);
      await assertNotSymlink(archivePath);
      try {
        const archiveHandle = await fs.open(archivePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag, 0o600);
        try { await archiveHandle.writeFile(previous); } finally { await archiveHandle.close(); }
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const archiveHandle = await openExistingNoFollow(archivePath, constants.O_RDONLY);
        try {
          if ((await archiveHandle.readFile('utf8')) !== previous) {
            throw new Error(`A different version-${previousVersion} receipt archive already exists. Preserve it before writing a new review.`);
          }
        } finally { await archiveHandle.close(); }
      }
    }
  }
  const receiptHandle = await fs.open(receiptPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollowFlag, 0o600);
  try { await receiptHandle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`); } finally { await receiptHandle.close(); }
  return receipt;
}
// A response outside this set is unexpected (a provider bug, a new API
// version, a malformed payload) and must not be read as a silent pass.
const KNOWN_ALIGNMENTS = new Set(['aligned', 'partial', 'conflict']);
const KNOWN_ACTIONS = new Set(['continue', 'reconcile', 'ask_user']);
const KNOWN_CHAT_READINESS = new Set(['ready', 'reconcile', 'ask_user']);

export async function runSemanticReview({ workspace = process.cwd(), featureDir, event, fetchImpl = globalThis.fetch, env = process.env, keychain, chatContext, onDemand = false, now = Date.now } = {}) {
  assertSafeEventName(event);
  const resolvedWorkspace = await assertSafeWorkspaceRoot(workspace);
  featureDir = await confined(resolvedWorkspace, featureDir);
  const policy = await readConfinedJson(resolvedWorkspace, POLICY_RELATIVE_PATH);
  const credentials = await credentialStatus({ workspace, env, keychain });
  const globallyConnected = credentials.source === 'macos_keychain';
  if (!policy.enabled && !globallyConnected && !onDemand) return { status: 'disabled', event };
  // A syntactically valid but malformed enabled policy must not silently
  // bypass its own gate: `confidence < undefined` is always false in JS, so
  // a missing/non-numeric minimumConfidence would otherwise let any
  // confidence "pass" the threshold check regardless of its actual value.
  if (!Array.isArray(policy.events) || !policy.events.every((value) => typeof value === 'string') ||
      typeof policy.minimumConfidence !== 'number' || !Number.isFinite(policy.minimumConfidence) ||
      policy.minimumConfidence < 0 || policy.minimumConfidence > 1) {
    throw new Error('Gofer TypeSafe policy is enabled but malformed (events or minimumConfidence).');
  }
  if (!policy.events.includes(event)) return { status: onDemand ? 'not_enabled_for_event' : 'disabled', event };
  if (!credentials.configured) return { status: 'not_configured', event };
  if (event === 'chat_readiness' && !String(chatContext || '').trim()) {
    return { status: 'unavailable', event, reason: 'chat_context_missing' };
  }
  if (event !== 'chat_readiness' && chatContext !== undefined) {
    return { status: 'unavailable', event, reason: 'chat_context_not_allowed_for_event' };
  }
  const artifacts = await Promise.all(DELIVERY_ARTIFACTS.map(async (name) => [name, await readArtifact(path.join(featureDir, name))]));
  const missingArtifacts = artifacts.filter(([, info]) => !info.present).map(([name]) => name);
  const artifactHashes = Object.fromEntries(artifacts.map(([name, info]) => [name, info.sha256]));
  const artifactCoverage = Object.fromEntries(artifacts.map(([name, info]) => [name, {
    present: info.present,
    complete: Boolean(info.complete),
    sourceBytes: info.bytes ?? 0,
    sentBytes: 0,
    reviewedBytes: 0,
    reviewed: false,
  }]));
  const state = Object.fromEntries(artifacts.map(([name, info]) => [name, {
    present: info.present,
    complete: Boolean(info.complete),
    sha256: info.sha256,
    byteLength: info.bytes ?? 0,
    content: info.content,
  }]));
  const redactedChatContext = event === 'chat_readiness' ? redactChatContext(chatContext) : '';
  const chatContextSha256 = event === 'chat_readiness' ? digest(redactedChatContext) : null;
  const chatContextBytes = event === 'chat_readiness' ? Buffer.byteLength(redactedChatContext, 'utf8') : null;
  if (event === 'chat_readiness') {
    state.chat_context = {
      present: Boolean(redactedChatContext),
      complete: true,
      summaryOnly: true,
      sha256: chatContextSha256,
      byteLength: chatContextBytes,
      content: redactedChatContext,
    };
  }
  const questions = buildQuestions(event);
  const inputBudget = measureTypeSafeInputBudget(state, questions);
  const missingRequiredEvidence = missingArtifacts.length > 0;
  const baseReceipt = {
    schemaVersion: 4,
    provider: 'typesafe',
    event,
    status: 'unavailable',
    reason: null,
    reviewMode: inputBudget.withinLimits ? 'single_request' : 'bounded_multi_pass',
    requestAttempted: false,
    requestSent: false,
    requestedModel: REQUESTED_MODEL,
    model: null,
    models: [],
    usage: null,
    usageComplete: false,
    inputBudget,
    missingArtifacts,
    missingRequiredEvidence,
    policySha256: digest(JSON.stringify(policy)),
    artifacts: artifactHashes,
    artifactCoverage,
    ...(event === 'chat_readiness' ? { chatContextSha256, chatContextBytes } : {}),
    confidence: null,
    confidenceGate: {
      minimum: policy.minimumConfidence,
      observed: null,
      belowMinimum: null,
      weakestQuestion: null,
    },
    answers: {},
    providerError: null,
  };
  if (missingRequiredEvidence) {
    return saveReceipt(featureDir, event, {
      ...baseReceipt,
      status: 'reconcile',
      reason: 'required_artifacts_missing',
    });
  }

  const sources = artifacts.map(([name, info]) => ({
    artifact: name,
    present: info.present,
    byteLength: info.bytes ?? 0,
    sha256: info.sha256,
    content: info.content,
  }));
  if (event === 'chat_readiness') {
    sources.push({
      artifact: 'chat_context',
      present: true,
      byteLength: chatContextBytes,
      sha256: chatContextSha256,
      content: redactedChatContext,
    });
  }

  if (inputBudget.withinLimits) {
    const { apiKey } = await resolveApiKey({ workspace, env, keychain });
    const requestBody = JSON.stringify({ model: REQUESTED_MODEL, state, questions });
    const evaluation = await requestTypeSafeEvaluation({
      state, body: requestBody, questions, event, minimumConfidence: policy.minimumConfidence, fetchImpl, apiKey,
    });
    const sentBytes = evaluation.requestSent === true;
    const reviewed = ['aligned', 'reconcile', 'conflict'].includes(evaluation.status);
    const updatedCoverage = Object.fromEntries(artifacts.map(([name, info]) => [name, {
      ...artifactCoverage[name],
      sentBytes: evaluation.requestSent === null ? null : sentBytes ? info.bytes ?? 0 : 0,
      reviewedBytes: reviewed ? info.bytes ?? 0 : 0,
      reviewed,
    }]));
    return saveReceipt(featureDir, event, {
      ...baseReceipt,
      ...evaluation,
      status: evaluation.status,
      reason: evaluation.reason || null,
      requestAttempted: evaluation.requestAttempted,
      requestSent: evaluation.requestSent,
      models: evaluation.model ? [evaluation.model] : [],
      usageComplete: Boolean(evaluation.usage),
      artifactCoverage: updatedCoverage,
      confidenceGate: { minimum: policy.minimumConfidence, ...evaluation.confidenceGate },
    });
  }

  const plan = buildMultiPassPlan(sources, questions);
  if (!plan.ok) {
    return saveReceipt(featureDir, event, {
      ...baseReceipt,
      reason: plan.reason || 'segmentation_limits_exceeded',
      multiPass: {
        complete: false,
        packetCount: 0,
        completedPacketCount: 0,
        sourceBytes: plan.totalBytes ?? sources.reduce((sum, source) => sum + source.byteLength, 0),
        coveredBytes: 0,
        aggregateRequestBytes: 0,
        limits: { maxSourceBytes: MAX_REVIEW_SOURCE_BYTES, maxPackets: MAX_REVIEW_PACKETS, maxAggregateRequestBytes: MAX_AGGREGATE_REQUEST_BYTES, maxDurationMs: MAX_REVIEW_DURATION_MS },
        packets: [],
      },
    });
  }

  const plannedPackets = plan.requests.map((request) => ({
    id: request.id,
    sourceRanges: request.sourceRanges,
    requestBytes: request.requestBytes,
    inputBudget: request.inputBudget,
    contextComplete: request.contextComplete,
    contextIssues: request.contextIssues,
    status: 'pending',
    requestAttempted: false,
    requestSent: false,
  }));
  const { apiKey } = await resolveApiKey({ workspace, env, keychain });
  const reviewStartedAt = now();
  const reviewDeadlineAt = reviewStartedAt + MAX_REVIEW_DURATION_MS;
  const pendingReceipt = {
    ...baseReceipt,
    reason: 'review_in_progress',
    multiPass: {
      complete: false,
      packetCount: plan.requests.length,
      completedPacketCount: 0,
      sourceBytes: plan.totalSourceBytes,
      coveredBytes: 0,
      aggregateRequestBytes: plan.aggregateRequestBytes,
      snapshotSha256: plan.snapshotSha256,
      referenceCount: plan.referenceCount,
      crossPacketContinuity: 'none_each_packet_is_a_separate_evaluation',
      limits: { maxSourceBytes: MAX_REVIEW_SOURCE_BYTES, maxPackets: MAX_REVIEW_PACKETS, maxAggregateRequestBytes: MAX_AGGREGATE_REQUEST_BYTES, maxDurationMs: MAX_REVIEW_DURATION_MS },
      packets: plannedPackets,
    },
  };
  await saveReceipt(featureDir, event, pendingReceipt);

  const packetResults = [];
  let stopReason = null;
  for (const request of plan.requests) {
    const remainingMs = reviewDeadlineAt - now();
    if (remainingMs <= 0) {
      stopReason = 'review_deadline_exceeded';
      break;
    }
    const deadlineLimited = remainingMs <= REQUEST_TIMEOUT_MS;
    const evaluation = await requestTypeSafeEvaluation({
      state: request.state,
      body: request.body,
      questions,
      event,
      minimumConfidence: policy.minimumConfidence,
      fetchImpl,
      apiKey,
      timeoutMs: Math.min(REQUEST_TIMEOUT_MS, remainingMs),
      timeoutReason: deadlineLimited ? 'review_deadline_exceeded' : 'timeout',
    });
    const packetEvaluation = !request.contextComplete && evaluation.status === 'aligned'
      ? { ...evaluation, status: 'reconcile', reason: 'requirement_context_incomplete' }
      : evaluation;
    packetResults.push({
      id: request.id,
      index: request.index,
      sourceRanges: request.sourceRanges,
      requestBytes: request.requestBytes,
      inputBudget: request.inputBudget,
      contextComplete: request.contextComplete,
      contextIssues: request.contextIssues,
      ...packetEvaluation,
    });
    if (packetEvaluation.status === 'unavailable') {
      stopReason = packetEvaluation.reason || 'packet_review_failed';
      break;
    }
    if (now() >= reviewDeadlineAt) {
      packetResults[packetResults.length - 1] = {
        ...packetResults.at(-1),
        status: 'unavailable',
        reason: 'review_deadline_exceeded',
      };
      stopReason = 'review_deadline_exceeded';
      break;
    }
  }

  const snapshotStillCurrent = await Promise.all(artifacts.map(async ([name, original]) => {
    try {
      const current = await readArtifact(path.join(featureDir, name));
      return current.present && current.sha256 === original.sha256 && current.bytes === original.bytes;
    } catch { return false; }
  })).then((matches) => matches.every(Boolean));
  const reviewDurationMs = Math.max(0, now() - reviewStartedAt);
  const reviewDeadlineExceeded = reviewDurationMs >= MAX_REVIEW_DURATION_MS;
  if (reviewDeadlineExceeded) stopReason = 'review_deadline_exceeded';
  const allResponsesValid = packetResults.length === plan.requests.length &&
    packetResults.every((packet) => ['aligned', 'reconcile', 'conflict'].includes(packet.status));
  const requirementContextComplete = packetResults.length === plan.requests.length &&
    packetResults.every((packet) => packet.contextComplete);
  const reviewedSegments = new Set(packetResults.filter((packet) => ['aligned', 'reconcile', 'conflict'].includes(packet.status))
    .flatMap((packet) => packet.sourceRanges.map((range) => `${range.artifact}:${range.startByte}:${range.endByte}`)));
  const totalReviewedBytes = packetResults.filter((packet) => ['aligned', 'reconcile', 'conflict'].includes(packet.status))
    .flatMap((packet) => packet.sourceRanges).reduce((sum, range) => sum + (range.endByte - range.startByte), 0);
  const totalSentBytes = packetResults.filter((packet) => packet.requestSent === true)
    .flatMap((packet) => packet.sourceRanges).reduce((sum, range) => sum + (range.endByte - range.startByte), 0);
  const aggregate = aggregatePacketResults(packetResults, policy.minimumConfidence, event, plan.requests.length);
  const coverageComplete = allResponsesValid && snapshotStillCurrent && reviewedSegments.size === plan.segmentCount;
  let finalStatus = aggregate.status;
  let finalReason = aggregate.status === 'reconcile'
    ? (aggregate.confidence < policy.minimumConfidence ? 'confidence_below_minimum_or_evidence_needs_reconciliation' : 'evidence_needs_reconciliation')
    : aggregate.status === 'conflict' ? null : null;
  if (!snapshotStillCurrent) {
    finalStatus = 'unavailable';
    finalReason = 'source_changed_during_review';
  } else if (reviewDeadlineExceeded) {
    finalStatus = 'unavailable';
    finalReason = 'review_deadline_exceeded';
  } else if (!allResponsesValid) {
    finalStatus = 'unavailable';
    finalReason = stopReason || packetResults.at(-1)?.reason || 'packet_review_incomplete';
  } else if (!coverageComplete) {
    finalStatus = 'unavailable';
    finalReason = 'source_range_coverage_invalid';
  } else if (!requirementContextComplete) {
    if (finalStatus === 'aligned') finalStatus = 'reconcile';
    if (finalStatus === 'reconcile') finalReason = 'requirement_context_incomplete';
  }
  const updatedCoverage = Object.fromEntries(artifacts.map(([name]) => {
    const plannedRangeCount = plan.requests.flatMap((request) => request.sourceRanges).filter((range) => range.artifact === name).length;
    const reviewedRangeCount = packetResults.filter((packet) => ['aligned', 'reconcile', 'conflict'].includes(packet.status))
      .flatMap((packet) => packet.sourceRanges).filter((range) => range.artifact === name).length;
    const sentBytes = packetResults.some((packet) => packet.requestSent === null && packet.sourceRanges.some((range) => range.artifact === name))
      ? null
      : packetResults.filter((packet) => packet.requestSent === true).flatMap((packet) => packet.sourceRanges)
        .filter((range) => range.artifact === name).reduce((sum, range) => sum + range.endByte - range.startByte, 0);
    const reviewedBytes = packetResults.filter((packet) => ['aligned', 'reconcile', 'conflict'].includes(packet.status))
      .flatMap((packet) => packet.sourceRanges).filter((range) => range.artifact === name)
      .reduce((sum, range) => sum + range.endByte - range.startByte, 0);
    return [name, {
      ...artifactCoverage[name],
      sentBytes,
      reviewedBytes,
      reviewed: reviewedRangeCount === plannedRangeCount && plannedRangeCount > 0,
    }];
  }));
  const failedPacket = packetResults.find((packet) => packet.providerError);
  const requestAttempted = packetResults.some((packet) => packet.requestAttempted);
  const requestSent = packetResults.some((packet) => packet.requestSent === true) ? true
    : packetResults.some((packet) => packet.requestSent === null) ? null : false;
  return saveReceipt(featureDir, event, {
    ...baseReceipt,
    ...aggregate,
    status: finalStatus,
    reason: finalReason,
    reviewMode: 'bounded_multi_pass',
    requestAttempted,
    requestSent,
    requestCount: packetResults.length,
    artifactCoverage: updatedCoverage,
    confidenceGate: { ...aggregate.confidenceGate, minimum: policy.minimumConfidence },
    providerError: failedPacket?.providerError || null,
    multiPass: {
      complete: finalStatus !== 'unavailable' && coverageComplete && requirementContextComplete,
      packetCount: plan.requests.length,
      completedPacketCount: packetResults.filter((packet) => ['aligned', 'reconcile', 'conflict'].includes(packet.status)).length,
      sourceBytes: plan.totalSourceBytes,
      sentBytes: totalSentBytes,
      coveredBytes: totalReviewedBytes,
      aggregateRequestBytes: plan.aggregateRequestBytes,
      snapshotSha256: plan.snapshotSha256,
      referenceCount: plan.referenceCount,
      coverageComplete,
      requirementContextComplete,
      requirementContextIssues: [...new Set(packetResults.flatMap((packet) => packet.contextIssues || []))],
      crossPacketContinuity: 'none_each_packet_is_a_separate_evaluation',
      durationMs: reviewDurationMs,
      limits: { maxSourceBytes: MAX_REVIEW_SOURCE_BYTES, maxPackets: MAX_REVIEW_PACKETS, maxAggregateRequestBytes: MAX_AGGREGATE_REQUEST_BYTES, maxDurationMs: MAX_REVIEW_DURATION_MS },
      packets: plannedPackets.map((planned) => {
        const packet = packetResults.find((result) => result.id === planned.id);
        if (!packet) return {
          ...planned,
          reason: stopReason === 'review_deadline_exceeded'
            ? 'not_attempted_after_review_deadline'
            : 'not_attempted_after_prior_packet_failure',
          model: null,
          usage: null,
          confidence: null,
          confidenceGate: null,
          answers: {},
          providerError: null,
        };
        return {
          ...planned,
          status: packet.status,
          reason: packet.reason || null,
          requestAttempted: packet.requestAttempted,
          requestSent: packet.requestSent,
          model: packet.model || null,
          usage: packet.usage || null,
          confidence: packet.confidence ?? null,
          confidenceGate: packet.confidenceGate || null,
          answers: packet.answers || {},
          responseValidation: packet.responseValidation || null,
          providerError: packet.providerError || null,
        };
      }),
    },
  });
}
// A CI/automation caller must not read "exit 0" as a pass for anything other
// than a genuine alignment or an intentionally inactive review: reconcile,
// unavailable, and not_configured all mean the checkpoint was not verified.
export function exitCodeForStatus(status) {
  if (status === 'conflict') return 2;
  if (!['disabled', 'aligned'].includes(status)) return 3;
  return 0;
}
async function main() {
  const args = await parseArgs(process.argv.slice(2));
  const result = await runSemanticReview(args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCodeForStatus(result.status);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
