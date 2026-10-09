/**
 * eai chat — interactive chat with AI workflows.
 */

import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import { resolveCommandContext } from '../lib/context.js';
import * as out from '../lib/output.js';
import { safePlatformDiagnostics, formatSafePlatformFailure } from '../lib/platform-diagnostics.js';

class ChatStreamError extends Error {}

async function printChatStream(body: ReadableStream<Uint8Array>): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let eventType = '';

  const dispatchEvent = (): boolean => {
    if (dataLines.length === 0) {
      eventType = '';
      return false;
    }
    const data = dataLines.join('\n');
    dataLines = [];
    const declaredType = eventType;
    eventType = '';
    if (data === '[DONE]') {
      if (declaredType === 'error') throw new ChatStreamError('Chat stream failed. Retry the request or contact support.');
      return true;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      // Preserve legacy streams that send plain text data frames.
      if (declaredType === 'error') throw new ChatStreamError('Chat stream failed. Retry the request or contact support.');
      process.stdout.write(data);
      return false;
    }
    if (declaredType === 'error' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
      throw new ChatStreamError('Chat stream failed. Retry the request or contact support.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const event = parsed as Record<string, unknown>;
    const kind = event.type ?? event.event ?? declaredType;
    if (declaredType === 'error' || event.type === 'error' || event.event === 'error') {
      throw new ChatStreamError(formatSafePlatformFailure('Chat stream', safePlatformDiagnostics(502, {
        ...event, details: event.data,
      })));
    }
    if (kind === 'done') return true;
    if (kind === 'token') {
      if (typeof event.data !== 'string') throw new ChatStreamError('Chat stream returned an invalid token');
      process.stdout.write(event.data);
    } else if (typeof event.content === 'string') {
      process.stdout.write(event.content);
    } else if (typeof event.text === 'string') {
      process.stdout.write(event.text);
    }
    return false;
  };

  try {
    let complete = false;
    while (!complete) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      while (true) {
        const lineEnd = buffer.search(/[\r\n]/);
        if (lineEnd < 0) break;
        // A CR may be the first half of a CRLF split across network chunks.
        if (buffer[lineEnd] === '\r' && lineEnd === buffer.length - 1 && !done) break;
        const line = buffer.slice(0, lineEnd);
        const delimiterLength = buffer[lineEnd] === '\r' && buffer[lineEnd + 1] === '\n' ? 2 : 1;
        buffer = buffer.slice(lineEnd + delimiterLength);
        if (line === '') {
          complete = dispatchEvent();
          if (complete) break;
        } else {
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          const rawValue = colon < 0 ? '' : line.slice(colon + 1);
          const fieldValue = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
          if (field === 'data') dataLines.push(fieldValue);
          else if (field === 'event') eventType = fieldValue;
        }
      }
      if (done && !complete) throw new ChatStreamError('Chat stream ended before completion');
    }
  } catch (error) {
    if (error instanceof ChatStreamError) throw error;
    throw new ChatStreamError('Chat stream could not be completed. Retry the request or contact support.');
  } finally {
    // Stop the HTTP body even when a terminal frame arrives before EOF.
    try {
      await reader.cancel();
    } catch {
      // Keep the original stream/provider failure if the body is already errored.
    } finally {
      reader.releaseLock();
    }
  }
}

export const chatCommand = new Command('chat')
  .description('Chat with AI workflows');

// ─── eai chat send ────────────────────────────────────────────────────────

chatCommand
  .command('send')
  .description('Send a single chat message')
  .argument('<message>', 'Message to send')
  .requiredOption('--workflow <id>', 'Workflow ID')
  .option('--stage <stage>', 'Chat stage', 'chat')
  .option('--conversation-id <id>', 'Conversation ID (auto-generated if omitted)')
  .action(async (message, options) => {
    const { client } = await resolveCommandContext();
    const conversationId = options.conversationId || randomUUID();

    out.info(`Conversation: ${chalk.dim(conversationId)}`);
    out.blank();

    try {
      const res = await client.sendChat(
        options.workflow,
        options.stage,
        message,
        conversationId,
      );

      if (!res.ok) {
        out.error(`${res.status} ${res.statusText}`);
        const body = await res.text();
        out.error(body);
        process.exit(1);
      }

      const data = await res.json() as { response?: string; message?: string };
      out.success(data.response || data.message || 'Chat completed');
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai chat stream ─────────────────────────────────────────────────────

chatCommand
  .command('stream')
  .description('Stream a chat conversation (interactive)')
  .argument('<message>', 'Initial message')
  .requiredOption('--workflow <id>', 'Workflow ID')
  .option('--stage <stage>', 'Chat stage', 'chat')
  .option('--conversation-id <id>', 'Conversation ID (auto-generated if omitted)')
  .action(async (message, options) => {
    const { client } = await resolveCommandContext();
    const conversationId = options.conversationId || randomUUID();

    out.info(`Streaming conversation: ${chalk.dim(conversationId)}`);
    out.blank();

    try {
      const res = await client.streamChat(
        options.workflow,
        options.stage,
        message,
        conversationId,
      );

      if (!res.ok) {
        out.error(`${res.status} ${res.statusText}`);
        process.exit(1);
      }

      if (!res.body) {
        out.error('No response body');
        process.exit(1);
      }

      await printChatStream(res.body);
      out.blank();
      out.success('Stream complete');
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
