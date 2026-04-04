/**
 * eai docs — document management (upload, classify, index).
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot } from '../lib/config.js';
import { PlatformAPIClient } from '../lib/api.js';
import { resolveActiveTenantContext, resolvePublicApiUrl } from '../lib/tenant-context.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';

export const docsCommand = new Command('docs')
  .description('Document upload, classification, and indexing');

// ─── eai docs upload ─────────────────────────────────────────────────────

docsCommand
  .command('upload <file>')
  .description('Upload a document')
  .action(async (file) => {
    const root = await findProjectRoot();
    if (!root) { exitWithError(ErrorCode.E001); }

    const publicApiUrl = await resolvePublicApiUrl(root);

    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const { getAccessToken } = await import('../lib/auth.js');

    const spinner = ora(`Uploading ${basename(file)}...`).start();
    try {
      const content = await readFile(file);
      const form = new FormData();
      form.append('file', new Blob([content]), basename(file));

      const token = await getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${publicApiUrl}/v3/documents/upload`, {
        method: 'POST',
        headers,
        body: form,
      });

      if (!res.ok) {
        spinner.fail(`${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const data = await res.json() as { id?: string; message?: string };
      spinner.succeed(`Uploaded ${chalk.cyan(basename(file))}${data.id ? ` (${chalk.dim(data.id)})` : ''}`);
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai docs classify ───────────────────────────────────────────────────

docsCommand
  .command('classify <file>')
  .description('Classify a document')
  .action(async (file) => {
    const root = await findProjectRoot();
    if (!root) { exitWithError(ErrorCode.E001); }

    const publicApiUrl = await resolvePublicApiUrl(root);
    const context = await resolveActiveTenantContext({
      projectRoot: root,
      publicApiUrl,
      interactive: true,
    });
    const client = new PlatformAPIClient(context.publicApiUrl, context.activeTenant.id);
    const { basename } = await import('node:path');

    const spinner = ora(`Classifying ${basename(file)}...`).start();
    try {
      const res = await client.classifyDocument(file);
      if (!res.ok) {
        spinner.fail(`${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const data = await res.json() as { category?: string; confidence?: number };
      spinner.succeed(`Classified ${chalk.cyan(basename(file))}${data.category ? ` as ${chalk.dim(data.category)}` : ''}`);
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai docs index ──────────────────────────────────────────────────────

docsCommand
  .command('index <documentId>')
  .description('Index a document for RAG')
  .action(async (documentId) => {
    const root = await findProjectRoot();
    if (!root) { exitWithError(ErrorCode.E001); }

    const publicApiUrl = await resolvePublicApiUrl(root);
    const context = await resolveActiveTenantContext({
      projectRoot: root,
      publicApiUrl,
      interactive: true,
    });
    const client = new PlatformAPIClient(context.publicApiUrl, context.activeTenant.id);

    const spinner = ora(`Indexing document ${documentId}...`).start();
    try {
      const res = await client.indexDocument(documentId);
      if (!res.ok) {
        spinner.fail(`${res.status} ${res.statusText}`);
        process.exit(1);
      }

      spinner.succeed(`Indexed document ${chalk.dim(documentId)} for RAG`);
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
