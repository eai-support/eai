#!/usr/bin/env node
/**
 * agent-stop.mjs — Claude Code Stop hook
 *
 * Fires when Claude finishes a turn. Updates the bridge file to reflect
 * that the agent has stopped processing (idle state).
 *
 * Also extracts learnings from the conversation transcript and writes
 * them to .specify/memory/local.json for deterministic memory injection.
 *
 * stdin:  JSON with { session_id, transcript_path, stop_hook_active }
 * stdout: (none)
 * Bridge: .specify/hooks/context-bridge.json
 * Memory: .specify/memory/local.json
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const BRIDGE_PATH = join(PROJECT_DIR, '.specify', 'hooks', 'context-bridge.json');
const MEMORY_PATH = join(PROJECT_DIR, '.specify', 'memory', 'local.json');
const DEBUG_LOG = join(PROJECT_DIR, '.specify', 'hooks', 'hook-debug.log');
const TAIL_BYTES = 50 * 1024; // 50KB to capture enough conversation

// Learning extraction limits
const MAX_NEW_MEMORIES_PER_TURN = 3;
const MAX_TOTAL_MEMORIES = 200;
const MAX_MEMORY_CONTENT_CHARS = 500;
const DEDUP_OVERLAP_THRESHOLD = 0.7; // 70% word overlap = duplicate

const CATEGORY_TAGS = {
  decision: ['#decision'],
  preference: ['#preference'],
  error_resolution: ['#error-fix'],
  file_knowledge: ['#files'],
  pattern: ['#pattern'],
};

const CATEGORY_TYPES = {
  decision: 'decision',
  preference: 'semantic',
  error_resolution: 'procedural',
  file_knowledge: 'semantic',
  pattern: 'procedural',
};

const CATEGORY_CONFIDENCE = {
  decision: 85,
  preference: 100,
  error_resolution: 80,
  file_knowledge: 70,
  pattern: 75,
};

const LOW_SIGNAL_PATTERNS = [
  /\b(?:100\/100|pass(?:ed)?|all tests passed|feature complete|done|completed|finished)\b/i,
  /\b(?:let me know|i can|we can|if you want|happy to|next step)\b/i,
  /\b(?:this turn|in this session|today|just now)\b/i,
  /^\s*(?:understood|noted|sounds good|great|okay)\b/i,
];

function debug(msg) {
  try {
    const ts = new Date().toISOString();
    appendFileSync(DEBUG_LOG, `[${ts}] [agent-stop] ${msg}\n`);
  } catch { /* ignore */ }
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

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type === 'assistant' && entry.message?.usage) {
        const usage = entry.message.usage;
        return {
          inputTokens: usage.input_tokens || 0,
          cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
          cacheReadInputTokens: usage.cache_read_input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          model: entry.message?.model || '',
        };
      }
    } catch {
      // Skip
    }
  }

  return null;
}

function getContextLimit(model) {
  return 200000; // All current Claude models
}

function writeBridge(data) {
  try {
    mkdirSync(dirname(BRIDGE_PATH), { recursive: true });
    const tmpPath = BRIDGE_PATH + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    renameSync(tmpPath, BRIDGE_PATH);
  } catch {
    // Silently fail
  }
}

// ============================================================================
// Learning Extraction
// ============================================================================

/**
 * Extract conversation messages (both human and assistant) from transcript.
 * Returns array of { role: 'human'|'assistant', content: string }
 */
function extractConversation(transcriptPath) {
  if (!transcriptPath) return [];

  const tail = tailRead(transcriptPath, TAIL_BYTES);
  if (!tail) return [];

  const lines = tail.split('\n').filter(Boolean);
  const messages = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'human' || entry.type === 'assistant') {
        const content = extractContentText(entry);
        if (content) {
          messages.push({ role: entry.type, content });
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return messages;
}

/**
 * Extract text content from a transcript entry.
 * Handles both string content and array-of-blocks content.
 */
function extractContentText(entry) {
  const msg = entry.message || entry;
  const content = msg.content;

  if (!content) return '';
  if (typeof content === 'string') return content;

  // Array of content blocks (Claude API format)
  if (Array.isArray(content)) {
    return content
      .filter(block => block.type === 'text')
      .map(block => block.text || '')
      .join('\n');
  }

  return '';
}

/**
 * Pattern-based extraction of learnings from conversation messages.
 */
function extractLearnings(messages, sessionId) {
  const learnings = [];
  const now = Date.now();
  const seen = new Set();

  for (const msg of messages) {
    const text = msg.content;
    if (!text || text.length < 20) continue;

    // Extract decisions
    const decisions = extractDecisions(text);
    for (const d of decisions) {
      pushLearning(learnings, seen, d, 'decision', sessionId, now);
    }

    // Extract preferences (primarily from human messages)
    if (msg.role === 'human') {
      const prefs = extractPreferences(text);
      for (const p of prefs) {
        pushLearning(learnings, seen, p, 'preference', sessionId, now);
      }
    }

    // Extract error resolutions (primarily from assistant messages)
    if (msg.role === 'assistant') {
      const fixes = extractErrorResolutions(text);
      for (const f of fixes) {
        pushLearning(learnings, seen, f, 'error_resolution', sessionId, now);
      }

      // Extract file knowledge from assistant messages
      const fileKnowledge = extractFileKnowledge(text);
      for (const fk of fileKnowledge) {
        pushLearning(learnings, seen, fk, 'file_knowledge', sessionId, now);
      }
    }

    // Extract patterns from either role
    const patterns = extractPatterns(text);
    for (const p of patterns) {
      pushLearning(learnings, seen, p, 'pattern', sessionId, now);
    }
  }

  // Limit to top N learnings (prefer decisions and preferences)
  return learnings.slice(0, MAX_NEW_MEMORIES_PER_TURN);
}

function makeMemory(content, category, tags, sessionId, now) {
  return {
    id: randomUUID(),
    category,
    tags,
    scope: 'local',
    content: content.substring(0, MAX_MEMORY_CONTENT_CHARS),
    created: now,
    lastUsed: now,
    usedCount: 0,
    learnedFrom: `session:${sessionId || 'unknown'}`,
    type: CATEGORY_TYPES[category],
    confidence: CATEGORY_CONFIDENCE[category],
  };
}

function normalizeLearningText(text) {
  return text.replace(/\s+/g, ' ').replace(/^[\s\-*#>]+/, '').trim();
}

function hasMinimumDistinctWords(text, minimum = 6) {
  const uniqueWords = new Set(text.toLowerCase().split(/\W+/).filter(w => w.length >= 3));
  return uniqueWords.size >= minimum;
}

function isLowSignal(text) {
  return LOW_SIGNAL_PATTERNS.some((pattern) => pattern.test(text));
}

function isDurableLearning(text, category) {
  if (!text || text.length < 25 || text.length > MAX_MEMORY_CONTENT_CHARS) {
    return false;
  }

  const minimumDistinctWords = {
    decision: 5,
    preference: 4,
    error_resolution: 5,
    file_knowledge: 6,
    pattern: 6,
  };

  if (
    isLowSignal(text) ||
    !hasMinimumDistinctWords(text, minimumDistinctWords[category] || 6)
  ) {
    return false;
  }

  switch (category) {
    case 'decision':
      return /\b(?:use|using|switch|choose|chosen|opted|plan|approach)\b/i.test(text);
    case 'preference':
      return /\b(?:prefer|always|never|must|should|please|want)\b/i.test(text);
    case 'error_resolution':
      return /\b(?:fixed|resolved|root cause|caused by|due to|missing|added|removed|updated|changed)\b/i.test(text);
    case 'file_knowledge':
      return /(?:\.\/|src\/|extension\/|language-server\/|tests\/|\.specify\/)\S+\.(?:ts|tsx|js|jsx|mjs|json|md|yaml|yml)/.test(text) &&
        /\b(?:handles|manages|provides|responsible for|defines|implements|registers|wires|contains|lives in|located in)\b/i.test(text);
    case 'pattern':
      return /\b(?:pattern|architecture|responsible for|handles|manages|provides|workflow)\b/i.test(text);
    default:
      return true;
  }
}

function pushLearning(learnings, seen, content, category, sessionId, now) {
  const normalized = normalizeLearningText(content);
  if (!isDurableLearning(normalized, category)) {
    return;
  }

  const dedupeKey = `${category}:${normalized.toLowerCase()}`;
  if (seen.has(dedupeKey)) {
    return;
  }

  seen.add(dedupeKey);
  learnings.push(makeMemory(normalized, category, CATEGORY_TAGS[category] || [], sessionId, now));
}

/**
 * Extract decision statements from text.
 */
function extractDecisions(text) {
  const results = [];
  const patterns = [
    /(?:decided to|let's use|going with|chose to|choosing|will use|opted for|switching to)\s+(.{10,120})/gi,
    /(?:instead of)\s+(\S+).{0,60}(?:,?\s*(?:we(?:'ll)?|I(?:'ll)?)\s+(?:use|go with|chose))\s+(.{5,80})/gi,
    /(?:the approach is|the plan is|we(?:'re| are) going to)\s+(.{10,120})/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const sentence = extractSurroundingSentence(text, match.index, match[0].length);
      if (sentence && sentence.length >= 20 && sentence.length <= MAX_MEMORY_CONTENT_CHARS) {
        results.push(sentence);
      }
    }
  }

  return results;
}

/**
 * Extract user preference statements from text.
 */
function extractPreferences(text) {
  const results = [];
  const patterns = [
    /(?:I prefer|always use|don't use|never use|convention is|standard is|please use|make sure to|I want)\s+(.{10,120})/gi,
    /(?:should always|should never|must always|must never)\s+(.{10,120})/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const sentence = extractSurroundingSentence(text, match.index, match[0].length);
      if (sentence && sentence.length >= 15 && sentence.length <= MAX_MEMORY_CONTENT_CHARS) {
        results.push(sentence);
      }
    }
  }

  return results;
}

/**
 * Extract error resolution patterns from text.
 */
function extractErrorResolutions(text) {
  const results = [];
  const patterns = [
    /(?:fixed by|resolved by|the (?:issue|problem|bug) was|root cause (?:is|was)|the fix (?:is|was))\s+(.{10,150})/gi,
    /(?:error|bug|issue)(?:\s+\S+){0,3}\s+(?:because|due to|caused by)\s+(.{10,120})/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const sentence = extractSurroundingSentence(text, match.index, match[0].length);
      if (sentence && sentence.length >= 20 && sentence.length <= MAX_MEMORY_CONTENT_CHARS) {
        results.push(sentence);
      }
    }
  }

  return results;
}

/**
 * Extract file/path knowledge from text.
 * Looks for file paths mentioned alongside descriptive context.
 */
function extractFileKnowledge(text) {
  const results = [];
  // Match file paths like src/foo/bar.ts, ./config.ts, extension/src/something.ts
  const pathPattern = /(?:^|\s)((?:\.\/|src\/|extension\/|language-server\/|tests\/|\.specify\/)\S+\.(?:ts|js|mjs|json|md|yaml|yml))/gm;

  let match;
  while ((match = pathPattern.exec(text)) !== null) {
    const filePath = match[1];
    const sentence = extractSurroundingSentence(text, match.index, match[0].length);
    // Only keep if there's meaningful context beyond just the path
    if (sentence && sentence.length > filePath.length + 20 && sentence.length <= MAX_MEMORY_CONTENT_CHARS) {
      results.push(sentence);
    }
  }

  // Limit file knowledge to 2 per turn to avoid noise
  return results.slice(0, 2);
}

/**
 * Extract architectural/coding patterns from text.
 */
function extractPatterns(text) {
  const results = [];
  const patterns = [
    /(?:the pattern is|this follows|consistent with|architecture:|approach:)\s+(.{10,150})/gi,
    /(?:component|module|service|class)\s+(\S+)\s+(?:handles|manages|provides|is responsible for)\s+(.{10,100})/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const sentence = extractSurroundingSentence(text, match.index, match[0].length);
      if (sentence && sentence.length >= 20 && sentence.length <= MAX_MEMORY_CONTENT_CHARS) {
        results.push(sentence);
      }
    }
  }

  return results;
}

/**
 * Extract the sentence surrounding a match position.
 * Returns the sentence containing the match, trimmed to reasonable length.
 */
function extractSurroundingSentence(text, matchStart, matchLength) {
  // Find sentence boundaries (. ! ? or newline)
  let sentenceStart = matchStart;
  for (let i = matchStart - 1; i >= Math.max(0, matchStart - 200); i--) {
    if (text[i] === '.' || text[i] === '!' || text[i] === '?' || text[i] === '\n') {
      sentenceStart = i + 1;
      break;
    }
    if (i === Math.max(0, matchStart - 200)) {
      sentenceStart = i;
    }
  }

  let sentenceEnd = matchStart + matchLength;
  for (let i = sentenceEnd; i < Math.min(text.length, sentenceEnd + 200); i++) {
    if (text[i] === '.' || text[i] === '!' || text[i] === '?' || text[i] === '\n') {
      sentenceEnd = i + 1;
      break;
    }
    if (i === Math.min(text.length, sentenceEnd + 200) - 1) {
      sentenceEnd = i + 1;
    }
  }

  return text.substring(sentenceStart, sentenceEnd).trim();
}

/**
 * Load existing memories from local.json.
 */
function loadExistingMemories() {
  try {
    const raw = readFileSync(MEMORY_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (data.memories && Array.isArray(data.memories)) return data.memories;
    return [];
  } catch {
    return [];
  }
}

/**
 * Calculate word overlap ratio between two strings.
 * Returns 0-1 where 1 means identical word sets.
 */
function wordOverlap(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length >= 3));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length >= 3));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }

  return overlap / Math.min(wordsA.size, wordsB.size);
}

/**
 * Deduplicate new memories against existing ones.
 * If >70% word overlap, update the existing memory's lastUsed instead of adding a duplicate.
 */
function deduplicateMemories(newMemories, existingMemories) {
  const unique = [];

  for (const newMem of newMemories) {
    let isDuplicate = false;

    for (const existing of existingMemories) {
      if (wordOverlap(newMem.content, existing.content) >= DEDUP_OVERLAP_THRESHOLD) {
        // Update existing memory's usage instead of adding duplicate
        existing.lastUsed = Date.now();
        existing.usedCount = (existing.usedCount || 0) + 1;
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      unique.push(newMem);
    }
  }

  return unique;
}

/**
 * Prune memories to max count, removing oldest unused first.
 */
function pruneMemories(memories, maxCount) {
  if (memories.length <= maxCount) return memories;

  // Sort by lastUsed (most recent first), then by usedCount (most used first)
  const sorted = [...memories].sort((a, b) => {
    const lastUsedDiff = (b.lastUsed || 0) - (a.lastUsed || 0);
    if (lastUsedDiff !== 0) return lastUsedDiff;
    return (b.usedCount || 0) - (a.usedCount || 0);
  });

  return sorted.slice(0, maxCount);
}

/**
 * Write memories to local.json using StoredMemories format.
 * Atomic write with tmp file + rename.
 */
function writeMemories(memories) {
  try {
    mkdirSync(dirname(MEMORY_PATH), { recursive: true });
    const data = {
      version: 1,
      memories,
    };
    const tmpPath = MEMORY_PATH + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    renameSync(tmpPath, MEMORY_PATH);
    debug(`Memories written: count=${memories.length}`);
  } catch (err) {
    debug(`Memory write error: ${err.message}`);
  }
}

// ============================================================================
// Main
// ============================================================================

debug(`Hook fired. PROJECT_DIR=${PROJECT_DIR}`);

const input = readStdin();
const sessionId = input.session_id || '';
const transcriptPath = input.transcript_path || '';

debug(`stdin: session_id=${sessionId}, has_transcript=${!!transcriptPath}`);

let existing = {};
try {
  existing = JSON.parse(readFileSync(BRIDGE_PATH, 'utf-8'));
} catch {
  // No existing bridge
}

// Get latest usage for accurate context data
const usage = extractLatestUsage(transcriptPath);
const now = Date.now();

const bridge = {
  ...existing,
  timestamp: now,
  sessionId: sessionId || existing.sessionId || '',
  session: {
    active: true, // Session still exists, just idle
    lastActivity: now,
  },
};

// Update context data if we have fresh usage
if (usage) {
  const totalContext =
    usage.inputTokens +
    usage.cacheCreationInputTokens +
    usage.cacheReadInputTokens;
  const limit = getContextLimit(usage.model);

  bridge.model = usage.model;
  bridge.context = {
    totalContextTokens: totalContext,
    inputTokens: usage.inputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    outputTokens: usage.outputTokens,
    contextLimit: limit,
    utilizationPercent: (totalContext / limit) * 100,
  };
}

// Clear lastToolUse since agent stopped
bridge.lastToolUse = existing.lastToolUse || null;

writeBridge(bridge);

// ============================================================================
// Learning Extraction — read conversation and extract memories
// ============================================================================

try {
  const messages = extractConversation(transcriptPath);
  debug(`Conversation extracted: ${messages.length} messages`);

  if (messages.length > 0) {
    const learnings = extractLearnings(messages, sessionId);
    debug(`Learnings extracted: ${learnings.length}`);

    if (learnings.length > 0) {
      const existingMemories = loadExistingMemories();
      const deduped = deduplicateMemories(learnings, existingMemories);
      debug(`After dedup: ${deduped.length} new, ${existingMemories.length} existing`);

      if (deduped.length > 0) {
        const merged = pruneMemories([...existingMemories, ...deduped], MAX_TOTAL_MEMORIES);
        writeMemories(merged);
        debug(`Memories saved: ${merged.length} total (${deduped.length} new)`);
      } else if (existingMemories.length > 0) {
        // Still write back to persist any lastUsed/usedCount updates from dedup
        writeMemories(existingMemories);
        debug(`Memories updated (dedup hits): ${existingMemories.length} total`);
      }
    }
  }
} catch (err) {
  debug(`Learning extraction error: ${err.message}`);
  // Non-critical — don't let learning extraction break the hook
}
