/**
 * eai chat — interactive chat with AI workflows.
 */

import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile } from '../lib/config.js';
import { PlatformAPIClient } from '../lib/api.js';
import * as out from '../lib/output.js';

export const chatCommand = new Command('chat')
  .description('Chat with AI workflows');

// ─── eai chat send ────────────────────────────────────────────────────────

chatCommand
  .command('send')
  .description('Send a single chat message')
  .argument('<message>', 'Message to send')
  .requiredOption('--workflow <id>', 'Workflow ID')
  .option('--stage <stage>', 'Chat stage', 'chat')
  .option('--conversation <id>', 'Conversation ID (auto-generated if omitted)')
  .action(async (message, options) => {
    const root = await findProjectRoot();
    if (!root) { out.error('Not in an EAI project.'); process.exit(1); }

    const envVars = await loadEnvFile(root);
    const env = { ...envVars, ...process.env };
    const publicApiUrl = env.BASE_URL_PUBLIC_API;
    const tenantId = env.TENANT_DEFAULT_ID ||
      Object.keys(env).filter(k => k.startsWith('TENANT_') && k.endsWith('_ID')).map(k => env[k])[0];

    if (!publicApiUrl || !tenantId) {
      out.error('Missing BASE_URL_PUBLIC_API or tenant ID.');
      process.exit(1);
    }

    const client = new PlatformAPIClient(publicApiUrl, tenantId);
    const conversationId = options.conversation || randomUUID();

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

      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
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
  .option('--conversation <id>', 'Conversation ID (auto-generated if omitted)')
  .action(async (message, options) => {
    const root = await findProjectRoot();
    if (!root) { out.error('Not in an EAI project.'); process.exit(1); }

    const envVars = await loadEnvFile(root);
    const env = { ...envVars, ...process.env };
    const publicApiUrl = env.BASE_URL_PUBLIC_API;
    const tenantId = env.TENANT_DEFAULT_ID ||
      Object.keys(env).filter(k => k.startsWith('TENANT_') && k.endsWith('_ID')).map(k => env[k])[0];

    if (!publicApiUrl || !tenantId) {
      out.error('Missing BASE_URL_PUBLIC_API or tenant ID.');
      process.exit(1);
    }

    const client = new PlatformAPIClient(publicApiUrl, tenantId);
    const conversationId = options.conversation || randomUUID();

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

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              out.blank();
              out.success('Stream complete');
              return;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                process.stdout.write(parsed.content);
              } else if (parsed.text) {
                process.stdout.write(parsed.text);
              }
            } catch {
              // Non-JSON data event, print raw
              process.stdout.write(data);
            }
          }
        }
      }

      out.blank();
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
