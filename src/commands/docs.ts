/**
 * eai docs — document management (upload, classify, index).
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { resolveCommandContext } from '../lib/context.js';

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
  .description('Document upload, classification, and indexing')
  .addHelpText('after', `
Examples:
  $ eai docs upload ./reports/contract.pdf
  $ eai docs classify ./reports/contract.pdf
  $ eai docs index <documentId>

Typical workflow:
  1. Upload a file
  2. Classify it if your platform uses document classification
  3. Index the document ID if you want it available to RAG or chat workflows

Use docs commands when the file is the subject of document processing or AI
context. Use "eai resources file" when the file is an attachment to a typed
ResourceAPI object.
  `);

// ─── eai docs upload ─────────────────────────────────────────────────────

docsCommand
  .command('upload <file>')
  .description('Upload a document')
  .action(async (file) => {
    const { client } = await resolveCommandContext();
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
    const { client } = await resolveCommandContext();
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
    const { client } = await resolveCommandContext();

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
