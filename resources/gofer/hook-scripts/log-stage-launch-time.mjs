#!/usr/bin/env node
/**
 * log-stage-launch-time.mjs — Gofer launch-latency hook
 *
 * Captures the latency between hook invocation and stage launch, then appends
 * a JSONL record to `.specify/logs/stage-launch-time.jsonl`.
 *
 * This is used to compare numbered (`/3_gofer_plan`) vs namespaced
 * (`/gofer:plan-stage`) launch paths so we can detect any performance
 * regression introduced by the alias indirection.
 *
 * Inputs (env or argv):
 *   GOFER_STAGE  / argv[2]      — stage name (e.g. `3_gofer_plan`)
 *   GOFER_MODE   / argv[3]      — 'numbered' | 'namespaced'
 *
 * Optional:
 *   GOFER_LOG_FILE              — override log file path (used by tests)
 *   GOFER_PROJECT_DIR           — override project root (defaults to cwd)
 *
 * Output (one JSONL line per invocation):
 *   { stage, mode, timestamp, latency_ms }
 *
 * Exits 0 on success, 0 even on missing inputs (logs are advisory).
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const T0 = process.hrtime.bigint();

function resolveLogPath() {
  if (process.env.GOFER_LOG_FILE) return process.env.GOFER_LOG_FILE;
  const root = process.env.GOFER_PROJECT_DIR || process.cwd();
  return join(root, '.specify', 'logs', 'stage-launch-time.jsonl');
}

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function resolveStage() {
  return process.env.GOFER_STAGE || process.argv[2] || 'unknown';
}

function resolveMode() {
  const raw = process.env.GOFER_MODE || process.argv[3] || 'numbered';
  // Normalize: only 'numbered' and 'namespaced' are valid; anything else
  // is recorded as-is so we can spot bad call sites.
  return raw;
}

function main() {
  const stage = resolveStage();
  const mode = resolveMode();
  const logPath = resolveLogPath();
  ensureDir(logPath);

  // hrtime difference, converted to milliseconds.
  const T1 = process.hrtime.bigint();
  const latencyNs = Number(T1 - T0);
  const latency_ms = latencyNs / 1_000_000;

  const record = {
    stage,
    mode,
    timestamp: new Date().toISOString(),
    latency_ms,
  };

  appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8');
  process.exit(0);
}

main();
