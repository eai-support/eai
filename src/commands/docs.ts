/**
 * eai docs — document management (upload, classify, index).
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile } from '../lib/config.js';
import { PlatformAPIClient } from '../lib/api.js';
import * as out from '../lib/output.js';

export const docsCommand = new Command('docs')
  .description('Document upload, classification, and indexing');

// ─── eai docs upload ─────────────────────────────────────────────────────

docsCommand
  .command('upload <file>')
  .description('Upload a document')
  .action(async (file) => {
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

      const data = await res.json();
      spinner.succeed(`Uploaded ${chalk.cyan(basename(file))}`);
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
    if (!root) { out.error('Not in an EAI project.'); process.exit(1); }

    const envVars = await loadEnvFile(root);
    const env = { ...envVars, ...process.env };
    const publicApiUrl = env.BASE_URL_PUBLIC_API;
    const tenantId = env.TENANT_DEFAULT_ID ||
      Object.keys(env).filter(k => k.startsWith('TENANT_') && k.endsWith('_ID')).map(k => env[k])[0];

    if (!publicApiUrl || !tenantId) {
      out.error('Missing config.'); process.exit(1);
    }

    const client = new PlatformAPIClient(publicApiUrl, tenantId);
    const { basename } = await import('node:path');

    const spinner = ora(`Classifying ${basename(file)}...`).start();
    try {
      const res = await client.classifyDocument(file);
      if (!res.ok) {
        spinner.fail(`${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const data = await res.json();
      spinner.succeed(`Classified ${chalk.cyan(basename(file))}`);
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
    if (!root) { out.error('Not in an EAI project.'); process.exit(1); }

    const envVars = await loadEnvFile(root);
    const env = { ...envVars, ...process.env };
    const publicApiUrl = env.BASE_URL_PUBLIC_API;
    const tenantId = env.TENANT_DEFAULT_ID ||
      Object.keys(env).filter(k => k.startsWith('TENANT_') && k.endsWith('_ID')).map(k => env[k])[0];

    if (!publicApiUrl || !tenantId) {
      out.error('Missing config.'); process.exit(1);
    }

    const client = new PlatformAPIClient(publicApiUrl, tenantId);

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
