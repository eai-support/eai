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
    const content = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(contentChunks));
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
  const requestId = safeToken(headers?.get?.('x-request-id') || headers?.get?.('request-id') || '', 128);
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
  const allowed = new Set(QUESTION_CHOICES[questionId] || []);
  const entries = Object.entries(answer.probabilities).filter(([choice, probability]) =>
    allowed.has(choice) && typeof probability === 'number' && Number.isFinite(probability) && probability >= 0 && probability <= 1
  );
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
    if (previousVersion === 2) {
      const archivePath = path.join(receiptDir, `${event}.v2.json`);
      await assertNotSymlink(archivePath);
      try {
        const archiveHandle = await fs.open(archivePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag, 0o600);
        try { await archiveHandle.writeFile(previous); } finally { await archiveHandle.close(); }
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const archiveHandle = await openExistingNoFollow(archivePath, constants.O_RDONLY);
        try {
          if ((await archiveHandle.readFile('utf8')) !== previous) {
            throw new Error('A different version-2 receipt archive already exists. Preserve it before writing a new review.');
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

export async function runSemanticReview({ workspace = process.cwd(), featureDir, event, fetchImpl = globalThis.fetch, env = process.env, keychain, chatContext, onDemand = false } = {}) {
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
    schemaVersion: 3,
    provider: 'typesafe',
    event,
    status: 'unavailable',
    reason: null,
    requestAttempted: false,
    requestSent: false,
    requestedModel: REQUESTED_MODEL,
    model: null,
    usage: null,
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
  if (!inputBudget.withinLimits) {
    return saveReceipt(featureDir, event, {
      ...baseReceipt,
      status: 'unavailable',
      reason: 'input_budget_exceeded',
    });
  }

  const { apiKey } = await resolveApiKey({ workspace, env, keychain });
  let response;
  try {
    baseReceipt.requestAttempted = true;
    response = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ model: REQUESTED_MODEL, state, questions }),
    });
  } catch (error) {
    return saveReceipt(featureDir, event, {
      ...baseReceipt,
      requestSent: null,
      reason: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network_error',
      artifactCoverage: Object.fromEntries(artifacts.map(([name]) => [name, { ...artifactCoverage[name], sentBytes: null }])),
    });
  }
  baseReceipt.requestSent = true;
  baseReceipt.artifactCoverage = Object.fromEntries(artifacts.map(([name, info]) => [name, {
    ...artifactCoverage[name],
    sentBytes: info.bytes ?? 0,
  }]));
  if (!response.ok) {
    const errorBody = await readBoundedResponseText(response);
    const providerError = providerDiagnostics(response, errorBody.text, errorBody.truncated);
    return saveReceipt(featureDir, event, {
      ...baseReceipt,
      requestSent: true,
      reason: 'provider_http_error',
      providerError,
    });
  }
  const responseBody = await readBoundedResponseText(response, MAX_PROVIDER_RESPONSE_BYTES);
  if (responseBody.truncated) {
    return saveReceipt(featureDir, event, { ...baseReceipt, reason: 'response_too_large' });
  }
  let payload;
  try { payload = JSON.parse(responseBody.text); } catch {
    return saveReceipt(featureDir, event, { ...baseReceipt, reason: 'invalid_response_body' });
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
  // An invalid or out-of-range confidence must count as zero, not be
  // dropped: dropping it would let one bad value be outweighed by the
  // other, and an out-of-range value (e.g. 2) would otherwise satisfy the
  // minimum-confidence check on a malformed response.
  const responseAnswers = [alignmentAnswer, specificationAnswer, testAnswer, blastRadiusAnswer, actionAnswer,
    ...(event === 'chat_readiness' ? [chatReadinessAnswer] : [])];
  const confidences = responseAnswers.map((answer) => {
    const value = Number(answer.confidence);
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
  });
  const confidence = Math.min(...confidences);
  // An answer outside the known choice set fails toward reconcile, not
  // toward a silent aligned pass: an unexpected label must not be read as
  // "everything is fine".
  const evidenceAlignments = [alignment, specification, testCoverage, blastRadius];
  const recognized = evidenceAlignments.every((value) => KNOWN_ALIGNMENTS.has(value)) && KNOWN_ACTIONS.has(action) &&
    (event !== 'chat_readiness' || KNOWN_CHAT_READINESS.has(chatReadiness));
  const status = evidenceAlignments.includes('conflict') || action === 'ask_user' || chatReadiness === 'ask_user' ? 'conflict'
    : !recognized || confidence < policy.minimumConfidence || evidenceAlignments.includes('partial') || action === 'reconcile' || chatReadiness === 'reconcile' ? 'reconcile'
    : 'aligned';
  const answerIds = ['goal_alignment', 'specification_currency', 'test_coverage', 'blast_radius', 'required_action',
    ...(event === 'chat_readiness' ? ['chat_readiness'] : [])];
  const answerRecords = Object.fromEntries(answerIds.map((id) => [id, answerRecord(answers[id] || {}, id)]));
  const weakestIndex = confidences.indexOf(confidence);
  const weakestQuestionId = answerIds[weakestIndex] || null;
  const weakestQuestion = weakestQuestionId ? answerRecords[weakestQuestionId] : null;
  const providerModel = safeToken(payload.model, 80);
  const usage = payload.usage && Number.isSafeInteger(payload.usage.input_tokens) && payload.usage.input_tokens >= 0 &&
    Number.isSafeInteger(payload.usage.output_tokens) && payload.usage.output_tokens >= 0
    ? { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens }
    : null;
  return saveReceipt(featureDir, event, {
    ...baseReceipt,
    status,
    reason: status === 'reconcile' ? (confidence < policy.minimumConfidence ? 'confidence_below_minimum_or_evidence_needs_reconciliation' : 'evidence_needs_reconciliation') : null,
    requestSent: true,
    model: providerModel,
    usage,
    confidence,
    confidenceGate: {
      minimum: policy.minimumConfidence,
      observed: confidence,
      belowMinimum: confidence < policy.minimumConfidence,
      weakestQuestion: weakestQuestionId ? {
        id: weakestQuestionId,
        choice: weakestQuestion.choice,
        confidence: weakestQuestion.confidence,
        probabilities: weakestQuestion.probabilities,
        closestAlternative: weakestQuestion.closestAlternative,
      } : null,
    },
    answers: answerRecords,
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
