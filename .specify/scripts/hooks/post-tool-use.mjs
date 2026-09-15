#!/usr/bin/env node
/**
 * post-tool-use.mjs — Claude Code PostToolUse hook
 *
 * Fires on every tool call. Extracts tool_input and tool_response from the
 * hook payload (when available) and writes per-observation files for the
 * VS Code extension to consume. Also reads transcript JSONL for token usage
 * metadata and writes context-bridge.json.
 *
 * stdin: JSON with { tool_name, session_id, transcript_path, tool_input?, tool_response?, tool_use_id? }
 * stdout: (none — PostToolUse hooks don't produce output)
 * Bridge: .specify/hooks/context-bridge-{sessionId}.json (per-session)
 * Legacy: .specify/hooks/context-bridge.json (backward compat)
 * Observations: .specify/hooks/observations/{uuid}.json
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const HOOKS_DIR = join(PROJECT_DIR, '.specify', 'hooks');
const BRIDGE_PATH = join(HOOKS_DIR, 'context-bridge.json');
const OBSERVATIONS_DIR = join(PROJECT_DIR, '.specify', 'hooks', 'observations');
const DEBUG_LOG = join(PROJECT_DIR, '.specify', 'hooks', 'hook-debug.log');
const PERF_LOG = join(PROJECT_DIR, '.specify', 'hooks', 'hook-perf.jsonl');
const PERF_ENABLED = process.env.GOFER_PERF_LOG === '1' || process.env.GOFER_PERF_MODE === '1';
const TAIL_BYTES = 20 * 1024; // Read last 20KB of transcript
const MAX_OBSERVATION_BYTES = 10240; // 10KB cap per observation

function debug(msg) {
  try {
    const ts = new Date().toISOString();
    appendFileSync(DEBUG_LOG, `[${ts}] [post-tool-use] ${msg}\n`);
  } catch { /* ignore */ }
}

function perf(operation, start, extra = {}) {
  if (!PERF_ENABLED) return;

  try {
    mkdirSync(dirname(PERF_LOG), { recursive: true });
    const durationMs = Math.round((Date.now() - start) * 100) / 100;
    appendFileSync(
      PERF_LOG,
      `${JSON.stringify({
        hook: 'post-tool-use',
        operation,
        durationMs,
        timestamp: new Date().toISOString(),
        ...extra,
      })}\n`
    );
  } catch {
    // Performance logging must never affect hook behavior.
  }
}

// Model context limits (tokens)
const MODEL_LIMITS = {
  'claude-opus-4-8': 1000000,
  'claude-opus-4-7': 1000000,
  'claude-opus-4-6': 1000000,
  'claude-opus-4-5': 200000,
  'claude-sonnet-4-6': 1000000,
  'claude-sonnet-4-5': 200000,
  'claude-sonnet-4-5-20250514': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-haiku-4-5': 200000,
  'claude-haiku-3-5-20241022': 200000,
};

function getContextLimit(model) {
  if (!model) return 200000;
  for (const [key, limit] of Object.entries(MODEL_LIMITS)) {
    if (model.includes(key) || key.includes(model)) return limit;
  }
  return 200000;
}

function readStdin() {
  try {
    const raw = readFileSync(0, 'utf-8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function tailRead(filePath, bytes) {
  try {
    const fd = readFileSync(filePath);
    const start = Math.max(0, fd.length - bytes);
    return fd.subarray(start).toString('utf-8');
  } catch {
    return '';
  }
}

function extractLatestUsage(transcriptPath) {
  if (!transcriptPath) return null;

  const tail = tailRead(transcriptPath, TAIL_BYTES);
  if (!tail) return null;

  const lines = tail.split('\n').filter(Boolean);

  // Walk backward to find last assistant message with usage
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type === 'assistant' && entry.message?.usage) {
        const usage = entry.message.usage;
        const model = entry.message?.model || '';
        return {
          inputTokens: usage.input_tokens || 0,
          cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
          cacheReadInputTokens: usage.cache_read_input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          model,
          timestamp: entry.timestamp || new Date().toISOString(),
        };
      }
    } catch {
      // Skip malformed lines
    }
  }

  return null;
}

/**
 * Serialize tool_response to a string, truncating to maxBytes if needed.
 * Returns { content: string, truncated: boolean }
 */
function serializeToolResponse(toolResponse, maxBytes = MAX_OBSERVATION_BYTES) {
  let content;
  if (typeof toolResponse === 'string') {
    content = toolResponse;
  } else {
    try {
      content = JSON.stringify(toolResponse);
    } catch {
      content = String(toolResponse);
    }
  }

  if (content.length > maxBytes) {
    return {
      content: content.slice(0, maxBytes) + '\n[truncated at 10KB]',
      truncated: true,
    };
  }

  return { content, truncated: false };
}

/**
 * Write observation content to a per-observation file using atomic write.
 * Returns the observation ID on success, null on failure.
 */
function writeObservation(id, toolName, toolInput, toolResponse) {
  try {
    mkdirSync(OBSERVATIONS_DIR, { recursive: true });

    const serialized = serializeToolResponse(toolResponse);
    const observation = {
      id,
      toolName,
      toolInput: toolInput || {},
      toolResponse: serialized.content,
      timestamp: new Date().toISOString(),
      truncated: serialized.truncated,
    };

    const filePath = join(OBSERVATIONS_DIR, `${id}.json`);
    const tmpPath = filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(observation, null, 2));
    renameSync(tmpPath, filePath);

    debug(`Observation written: id=${id}, tool=${toolName}, size=${serialized.content.length}, truncated=${serialized.truncated}`);
    return id;
  } catch (err) {
    debug(`Observation write error: ${err.message}`);
    return null;
  }
}

function stripRuntimeBridgeFields(value) {
  const copy = JSON.parse(JSON.stringify(value ?? {}));
  delete copy.timestamp;
  if (copy.session) {
    delete copy.session.lastActivity;
  }
  if (copy.lastToolUse) {
    delete copy.lastToolUse.timestamp;
  }
  return copy;
}

function bridgeEquivalent(left, right) {
  return JSON.stringify(stripRuntimeBridgeFields(left)) === JSON.stringify(stripRuntimeBridgeFields(right));
}

function atomicWriteIfChanged(filePath, data, equivalent = (left, right) => JSON.stringify(left) === JSON.stringify(right)) {
  mkdirSync(dirname(filePath), { recursive: true });
  try {
    const existing = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (equivalent(existing, data)) {
      return false;
    }
  } catch {
    // Missing or invalid existing data should be replaced.
  }

  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  renameSync(tmpPath, filePath);
  return true;
}

function writeBridge(data) {
  try {
    const start = Date.now();
    let writes = 0;

    // Write per-session bridge file if sessionId is present
    if (data.sessionId) {
      // Sanitize sessionId to prevent path traversal
      const safeSessionId = data.sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
      const perSessionPath = join(HOOKS_DIR, `context-bridge-${safeSessionId}.json`);
      if (atomicWriteIfChanged(perSessionPath, data, bridgeEquivalent)) {
        writes += 1;
        debug(`Per-session bridge written: session=${data.sessionId}, path=${perSessionPath}`);
      } else {
        debug(`Per-session bridge unchanged: session=${data.sessionId}, path=${perSessionPath}`);
      }
    }

    // Always write legacy bridge file for backward compat
    if (atomicWriteIfChanged(BRIDGE_PATH, data, bridgeEquivalent)) {
      writes += 1;
      debug(`Legacy bridge written: session=${data.sessionId}, tool=${data.lastToolUse?.toolName}, obsId=${data.lastToolUse?.observationId || 'none'}`);
    } else {
      debug(`Legacy bridge unchanged: session=${data.sessionId}, tool=${data.lastToolUse?.toolName}, obsId=${data.lastToolUse?.observationId || 'none'}`);
    }
    perf('bridge-write', start, { writes });
  } catch (err) {
    debug(`Bridge write error: ${err.message}`);
    process.stderr.write(`[post-tool-use] bridge write error: ${err.message}\n`);
  }
}

function readExistingBridge() {
  try {
    return JSON.parse(readFileSync(BRIDGE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

// Main
debug(`Hook fired. PROJECT_DIR=${PROJECT_DIR}`);

const input = readStdin();
debug(`stdin: ${JSON.stringify({ session_id: input.session_id, tool_name: input.tool_name, has_transcript: !!input.transcript_path, has_tool_input: !!input.tool_input, has_tool_response: !!input.tool_response })}`);

const sessionId = input.session_id || '';
const toolName = input.tool_name || '';
const transcriptPath = input.transcript_path || '';
const toolInput = input.tool_input || undefined;
const toolResponse = input.tool_response || undefined;

const usage = extractLatestUsage(transcriptPath);
debug(`usage: ${usage ? `inputTokens=${usage.inputTokens}, cache=${usage.cacheReadInputTokens}` : 'null'}`);

// Write observation file if tool_response is available (new Claude Code payload)
let observationId;
if (toolResponse) {
  const observationStart = Date.now();
  observationId = randomUUID();
  writeObservation(observationId, toolName, toolInput, toolResponse);
  perf('observation-write', observationStart, { written: true });
}

const existing = readExistingBridge();
const now = Date.now();

const lastToolUse = {
  toolName,
  timestamp: now,
};

// Add observation pointer if observation was written
if (observationId) {
  lastToolUse.observationId = observationId;
}
if (toolInput) {
  lastToolUse.toolInput = toolInput;
}

const bridge = {
  timestamp: now,
  sessionId,
  model: usage?.model || existing.model || '',
  context: usage
    ? {
        totalContextTokens:
          usage.inputTokens +
          usage.cacheCreationInputTokens +
          usage.cacheReadInputTokens,
        inputTokens: usage.inputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        outputTokens: usage.outputTokens,
        contextLimit: getContextLimit(usage.model),
        utilizationPercent:
          ((usage.inputTokens +
            usage.cacheCreationInputTokens +
            usage.cacheReadInputTokens) /
            getContextLimit(usage.model)) *
          100,
      }
    : existing.context || null,
  lastToolUse,
  session: {
    active: true,
    lastActivity: now,
  },
};

writeBridge(bridge);
perf('hook-total', now, { sessionId: sessionId || undefined, toolName: toolName || undefined });
