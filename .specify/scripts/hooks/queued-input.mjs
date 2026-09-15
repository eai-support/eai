#!/usr/bin/env node
/**
 * queued-input.mjs — Gofer queued-input hook (crash-resilient)
 *
 * When the user submits a prompt mid-stage, this hook captures the prompt as
 * a queued input that will be replayed as a "next-prompt suggestion" once the
 * current stage completes. This decouples user inputs from stage state
 * without losing context across crashes.
 *
 * Wire-up:
 *   - Default queue file: `<projectRoot>/.specify/state/queued-input.jsonl`
 *   - Each JSONL record:
 *       { id, timestamp, stage, prompt, payload, status }
 *     where `status ∈ {queued, replayed, crashed}`.
 *
 * Behaviour:
 *   1. On startup, scan the queue for `status=queued` or `status=crashed`
 *      records left over from a previous session and report:
 *        "<N> items pending replay"
 *      to stderr.
 *   2. Read JSON payload from stdin (best-effort).
 *   3. Append a new JSONL record with `status='queued'`.
 *   4. Log `queued: <total> items pending` to stderr (count of all non-empty
 *      lines, preserving the original public log shape).
 *   5. Exit 0.
 *
 * Public API (importable):
 *   - readQueue(queuePath): JSONL records as objects (best-effort lenient).
 *   - replayQueue(queuePath): returns and marks-replayed all `queued`/`crashed`
 *     records. Idempotent.
 *
 * Environment:
 *   GOFER_PROJECT_DIR   override project root (defaults to cwd)
 *   GOFER_QUEUE_FILE    override queue file path (used by tests)
 */

import {
  readFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STATUS_QUEUED = 'queued';
const STATUS_REPLAYED = 'replayed';
const STATUS_CRASHED = 'crashed';

function readStdin() {
  try {
    const raw = readFileSync(0, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    // Treat unparseable stdin as an empty payload — we still want to record
    // that *something* tried to enqueue.
    return {};
  }
}

export function resolveQueuePath() {
  if (process.env.GOFER_QUEUE_FILE) return process.env.GOFER_QUEUE_FILE;
  const root = process.env.GOFER_PROJECT_DIR || process.cwd();
  return join(root, '.specify', 'state', 'queued-input.jsonl');
}

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Read every JSONL record from the queue file. Lines that fail to parse are
 * skipped (logged to stderr but not fatal — we want to be resilient to a
 * partially-written line from a hard crash).
 *
 * @param {string} queuePath
 * @returns {Array<{ id: string, timestamp: string, stage: string|null, prompt: string|null, payload: object, status: string }>}
 */
export function readQueue(queuePath) {
  if (!existsSync(queuePath)) return [];
  const raw = readFileSync(queuePath, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed line (likely truncated by a crash mid-write).
    }
  }
  return out;
}

/**
 * Returns records that need replay (status=queued or status=crashed) and
 * rewrites the queue with their statuses flipped to `replayed`. Idempotent:
 * calling twice returns an empty array on the second call.
 *
 * @param {string} [queuePathOverride]
 */
export function replayQueue(queuePathOverride) {
  const queuePath = queuePathOverride || resolveQueuePath();
  const records = readQueue(queuePath);
  const pending = records.filter(
    (r) => r.status === STATUS_QUEUED || r.status === STATUS_CRASHED,
  );

  if (pending.length === 0) return [];

  // Flip pending records to replayed, preserving order and the rest unchanged.
  const updated = records.map((r) => {
    if (r.status === STATUS_QUEUED || r.status === STATUS_CRASHED) {
      return { ...r, status: STATUS_REPLAYED, replayedAt: new Date().toISOString() };
    }
    return r;
  });

  ensureDir(queuePath);
  writeFileSync(
    queuePath,
    updated.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );

  return pending;
}

function countLines(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    if (!raw) return 0;
    return raw.split('\n').filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

function countPending(filePath) {
  const records = readQueue(filePath);
  return records.filter(
    (r) => r.status === STATUS_QUEUED || r.status === STATUS_CRASHED,
  ).length;
}

function main() {
  const payload = readStdin();
  const queuePath = resolveQueuePath();
  ensureDir(queuePath);

  // Crash-recovery summary (T146): if there are leftover pending records from
  // a previous session, surface them on the very first hook invocation.
  const leftover = countPending(queuePath);
  if (leftover > 0) {
    process.stderr.write(`${leftover} items pending replay\n`);
  }

  const record = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    stage: payload.stage ?? null,
    prompt: payload.prompt ?? null,
    payload,
    status: STATUS_QUEUED,
  };

  appendFileSync(queuePath, JSON.stringify(record) + '\n', 'utf8');

  const pending = countLines(queuePath);
  process.stderr.write(`queued: ${pending} items pending\n`);

  process.exit(0);
}

// Only run main when executed directly (not when imported as a module).
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('queued-input.mjs') ||
    process.argv[1] === new URL(import.meta.url).pathname);

if (isMain) {
  main();
}
