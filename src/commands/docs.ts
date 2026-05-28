/**
 * eai docs — document management (upload, classify, index).
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { resolveCommandContext, normalizeFormat, makeSpinner } from '../lib/context.js';
import * as out from '../lib/output.js';

interface ListDocumentsEnvelope {
  documents: Array<{
    id: string;
    filename: string;
    type: string;
    createdAt: string;
    status: string;
  }>;
  count: number;
  page: number;
  totalPages: number;
}

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
  `);

// ─── eai docs list ───────────────────────────────────────────────────────

docsCommand
  .command('list')
  .description('List documents in a tenant')
  .option('--tenant <id>', 'Tenant ID (defaults to the active tenant)')
  .option('--type <kbDocType>', 'Filter by document type')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .option('--limit <n>', 'Items per page', '50')
  .option('--page <n>', '1-indexed page number', '1')
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenant, interactive: !options.tenant });
    const format = normalizeFormat(options);
    const limit = Number.parseInt(options.limit, 10);
    const page = Number.parseInt(options.page, 10);
    if (!Number.isFinite(limit) || limit < 1) {
      out.error('--limit must be a positive integer.');
      process.exit(1);
    }
    if (!Number.isFinite(page) || page < 1) {
      out.error('--page must be a positive integer.');
      process.exit(1);
    }
    const offset = (page - 1) * limit;

    const spinner = makeSpinner(format, 'Listing documents...');
    const res = await ctx.client.listDocuments({
      tenantId: ctx.tenantId,
      limit,
      offset,
      type: options.type,
    });

    if (!res.ok) {
      spinner?.fail(await readResponseError(res));
      process.exit(1);
    }

    const envelope = await res.json() as ListDocumentsEnvelope;
    if (format === 'json') {
      out.json(envelope);
      return;
    }

    spinner?.succeed(`${envelope.count} document${envelope.count === 1 ? '' : 's'} (page ${envelope.page}/${envelope.totalPages})`);
    if (envelope.documents.length === 0) {
      out.info('No documents found.');
      return;
    }
    for (const d of envelope.documents) {
      out.info(`${chalk.cyan(d.filename)} · ${d.type} · ${chalk.dim(d.status)} · ${chalk.dim(d.id)}`);
    }
  });

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
