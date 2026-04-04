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

interface BatchDocumentSummary {
  document_id?: string;
  documentId?: string;
  filename?: string;
  status?: string;
}

interface BatchJobResponse {
  success?: boolean;
  status?: string;
  job_id?: string;
  jobId?: string;
  classificationPending?: boolean;
  processing_mode?: string;
  processingMode?: string;
  total_files?: number;
  totalFiles?: number;
  documents?: BatchDocumentSummary[];
  documentId?: string;
  recordId?: string;
  publicDocumentId?: string;
  classification?: {
    type?: string;
    confidence?: number;
    category?: string;
  };
}

async function readResponseError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `${response.status} ${response.statusText}`;
  }

  try {
    const payload = JSON.parse(text) as {
      error?: string;
      message?: string;
      details?: string | { message?: string };
    };
    const detail = typeof payload.details === 'string'
      ? payload.details
      : payload.details?.message;
    return [payload.error, payload.message, detail]
      .filter((value): value is string => Boolean(value))
      .join(': ');
  } catch {
    return text;
  }
}

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
    const context = await resolveActiveTenantContext({
      projectRoot: root,
      publicApiUrl,
      interactive: true,
    });
    const client = new PlatformAPIClient(context.publicApiUrl, context.activeTenant.id);
    const { basename } = await import('node:path');

    const spinner = ora(`Uploading ${basename(file)}...`).start();
    try {
      const res = await client.uploadDocument(file);

      if (!res.ok) {
        spinner.fail(await readResponseError(res));
        process.exit(1);
      }

      const data = await res.json() as BatchJobResponse;
      const jobId = data.jobId || data.job_id;
      const documentId = data.documents?.[0]?.documentId || data.documents?.[0]?.document_id;
      spinner.succeed(
        `Queued ${chalk.cyan(basename(file))} for upload${jobId ? ` (${chalk.dim(`job ${jobId}`)})` : ''}${documentId ? ` — ${chalk.dim(documentId)}` : ''}`,
      );
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
        spinner.fail(await readResponseError(res));
        process.exit(1);
      }

      const data = await res.json() as BatchJobResponse;
      const jobId = data.jobId || data.job_id;
      const documentId =
        data.documentId
        || data.recordId
        || data.publicDocumentId
        || data.documents?.[0]?.documentId
        || data.documents?.[0]?.document_id;

      if (data.classification?.type) {
        const confidence = typeof data.classification.confidence === 'number'
          ? ` ${chalk.dim(`(${Math.round(data.classification.confidence * 100)}%)`)}`
          : '';
        spinner.succeed(
          `Classified ${chalk.cyan(basename(file))} as ${chalk.cyan(data.classification.type)}${confidence}${documentId ? ` — ${chalk.dim(documentId)}` : ''}${jobId ? ` ${chalk.dim(`job ${jobId}`)}` : ''}`,
        );
        return;
      }

      spinner.succeed(
        `Queued ${chalk.cyan(basename(file))} for classification${jobId ? ` (${chalk.dim(`job ${jobId}`)})` : ''}${documentId ? ` — ${chalk.dim(documentId)}` : ''}`,
      );
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
