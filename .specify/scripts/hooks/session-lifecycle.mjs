#!/usr/bin/env node
/**
 * session-lifecycle.mjs — Claude Code SessionStart / SessionEnd hook
 *
 * Shared script, mode determined by CLI argument:
 *   node session-lifecycle.mjs start
 *   node session-lifecycle.mjs end
 *
 * start: Writes bridge with session.active: true
 * end:   Writes bridge with session.active: false
 *
 * stdin:  JSON with { session_id, transcript_path }
 * stdout: (none)
 * Bridge: .specify/hooks/context-bridge.json
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const BRIDGE_PATH = join(PROJECT_DIR, '.specify', 'hooks', 'context-bridge.json');

const mode = process.argv[2] || 'start'; // 'start' or 'end'

function readStdin() {
  try {
    const chunks = [];
    try {
      let bytesRead;
      while ((bytesRead = readFileSync(0, { length: 4096 })) && bytesRead.length > 0) {
        chunks.push(Buffer.from(bytesRead));
      }
    } catch {
      // EOF
    }
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
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

// Main
const input = readStdin();
const sessionId = input.session_id || '';
const now = Date.now();

if (mode === 'start') {
  const bridge = {
    timestamp: now,
    sessionId,
    model: '',
    context: null,
    lastToolUse: null,
    session: {
      active: true,
      lastActivity: now,
      startedAt: now,
    },
  };
  writeBridge(bridge);
} else {
  // end
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(BRIDGE_PATH, 'utf-8'));
  } catch {
    // No existing bridge
  }

  const bridge = {
    ...existing,
    timestamp: now,
    sessionId: sessionId || existing.sessionId || '',
    session: {
      active: false,
      lastActivity: now,
      endedAt: now,
    },
  };
  writeBridge(bridge);
}
