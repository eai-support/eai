#!/usr/bin/env node
/**
 * user-prompt-submit.mjs — Claude Code UserPromptSubmit hook
 *
 * Fires before every prompt is processed. Reads .specify/memory/local.json,
 * scores memories by keyword relevance to the prompt, and outputs
 * additionalContext via stdout for injection as a <system-reminder>.
 *
 * Also updates the bridge file with activity data.
 *
 * stdin:  JSON with { prompt, session_id, transcript_path }
 * stdout: JSON with { hookSpecificOutput: { hookEventName, additionalContext } }
 * Bridge: .specify/hooks/context-bridge.json
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MEMORY_PATH = join(PROJECT_DIR, '.specify', 'memory', 'local.json');
const BRIDGE_PATH = join(PROJECT_DIR, '.specify', 'hooks', 'context-bridge.json');
const DEBUG_LOG = join(PROJECT_DIR, '.specify', 'hooks', 'hook-debug.log');
const PERF_LOG = join(PROJECT_DIR, '.specify', 'hooks', 'hook-perf.jsonl');
const PERF_ENABLED = process.env.GOFER_PERF_LOG === '1' || process.env.GOFER_PERF_MODE === '1';
const MAX_MEMORIES = 5;
const MAX_CONTEXT_CHARS = 3000; // ~750 tokens

function debug(msg) {
  try {
    const ts = new Date().toISOString();
    appendFileSync(DEBUG_LOG, `[${ts}] [user-prompt-submit] ${msg}\n`);
  } catch { /* ignore */ }
}

function perf(operation, start, extra = {}) {
  if (!PERF_ENABLED) return;

  try {
    mkdirSync(dirname(PERF_LOG), { recursive: true });
    appendFileSync(
      PERF_LOG,
      `${JSON.stringify({
        hook: 'user-prompt-submit',
        operation,
        durationMs: Math.round((Date.now() - start) * 100) / 100,
        timestamp: new Date().toISOString(),
        ...extra,
      })}\n`
    );
  } catch {
    // Performance logging must never affect prompt handling.
  }
}

function readStdin() {
  try {
    const raw = readFileSync(0, 'utf-8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadMemories() {
  try {
    const raw = readFileSync(MEMORY_PATH, 'utf-8');
    const data = JSON.parse(raw);
    // Support both array format and { memories: [...] } format
    if (Array.isArray(data)) return data;
    if (data.memories && Array.isArray(data.memories)) return data.memories;
    return [];
  } catch {
    return [];
  }
}

function scoreMemory(memory, promptWords) {
  const text = (memory.content || memory.text || memory.summary || '').toLowerCase();
  const tags = (memory.tags || []).map(t => t.toLowerCase());
  let score = 0;

  for (const word of promptWords) {
    if (text.includes(word)) score += 1;
    if (tags.some(t => t.includes(word))) score += 2;
  }

  // Boost by priority if available
  const priority = memory.priority || 0;
  score += priority * 0.5;

  return score;
}

function selectRelevantMemories(memories, prompt) {
  if (!memories.length || !prompt) return memories.slice(0, MAX_MEMORIES);

  // Tokenize prompt into meaningful words (3+ chars)
  const promptWords = prompt
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length >= 3);

  if (!promptWords.length) return memories.slice(0, MAX_MEMORIES);

  const scored = memories
    .map(m => ({ memory: m, score: scoreMemory(m, promptWords) }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_MEMORIES).map(s => s.memory);
}

function formatMemoriesForContext(memories) {
  if (!memories.length) return '';

  const lines = ['Gofer Memory Context:'];
  let totalChars = lines[0].length;

  for (const m of memories) {
    const text = m.content || m.text || m.summary || '';
    if (!text) continue;

    const line = `- ${text}`;
    if (totalChars + line.length > MAX_CONTEXT_CHARS) break;
    lines.push(line);
    totalChars += line.length;
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

function stripRuntimeBridgeFields(value) {
  const copy = JSON.parse(JSON.stringify(value ?? {}));
  delete copy.timestamp;
  if (copy.session) {
    delete copy.session.lastActivity;
  }
  if (copy.lastPrompt) {
    delete copy.lastPrompt.timestamp;
  }
  return copy;
}

function bridgeEquivalent(left, right) {
  return JSON.stringify(stripRuntimeBridgeFields(left)) === JSON.stringify(stripRuntimeBridgeFields(right));
}

function atomicWriteIfChanged(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  try {
    const existing = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (bridgeEquivalent(existing, data)) {
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

function updateBridge(sessionId, prompt) {
  try {
    const start = Date.now();
    let existing = {};
    try {
      existing = JSON.parse(readFileSync(BRIDGE_PATH, 'utf-8'));
    } catch {
      // No existing bridge
    }

    const now = Date.now();
    const bridge = {
      ...existing,
      timestamp: now,
      sessionId: sessionId || existing.sessionId || '',
      session: {
        active: true,
        lastActivity: now,
      },
      // Capture prompt topic so agent-stop.mjs can use it for learning context
      lastPrompt: {
        topic: (prompt || '').substring(0, 200),
        timestamp: now,
      },
    };

    const written = atomicWriteIfChanged(BRIDGE_PATH, bridge);
    debug(`Bridge ${written ? 'updated' : 'unchanged'}: session=${bridge.sessionId}`);
    perf('bridge-write', start, { written });
  } catch (err) {
    debug(`Bridge write error: ${err.message}`);
  }
}

// Main
debug(`Hook fired. PROJECT_DIR=${PROJECT_DIR}`);

const input = readStdin();
debug(`stdin: session_id=${input.session_id}, prompt_length=${(input.prompt || '').length}`);

const prompt = input.prompt || '';
const sessionId = input.session_id || '';
const hookStart = Date.now();

// Update bridge with activity and prompt topic
updateBridge(sessionId, prompt);

// Load and score memories
const memories = loadMemories();
const relevant = selectRelevantMemories(memories, prompt);
const additionalContext = formatMemoriesForContext(relevant);
debug(`memories: loaded=${memories.length}, relevant=${relevant.length}, hasContext=${!!additionalContext}`);
perf('memory-select', hookStart, { loaded: memories.length, relevant: relevant.length });

// Output for Claude Code to inject
if (additionalContext) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
  };
  process.stdout.write(JSON.stringify(output));
}
perf('hook-total', hookStart, { sessionId: sessionId || undefined, hasContext: !!additionalContext });
