/**
 * eai docs — document management (upload, classify, index).
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { parseApiError, validateDocumentUploadContext, type DocumentUploadContext } from '../lib/api.js';
import { makeSpinner, resolveCommandContext } from '../lib/context.js';
import * as out from '../lib/output.js';

interface DocumentCommandOptions extends DocumentUploadContext {
  tenantId?: string;
  format?: string;
}

function addUploadOptions(command: Command): Command {
  return command
    .option('--tenant-id <id>', 'Use a specific tenant with the current user login')
    .option('--storage-target <target>', 'Curate storage target (resourceapi); requires app/workflow or project context')
    .option('--business-request-id <id>', 'Existing authorized Curate business request')
    .option('--planning-application-id <id>', 'Existing authorized Curate planning-application resource')
    .option('--vertical-key <key>', 'App key for the published workflow classifier')
    .option('--workflow-key <key>', 'Workflow key for the published classifier; requires --vertical-key')
    .option('--format <format>', 'Output format (text|json)', 'text');
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

export async function readResponseError(response: Response): Promise<string> {
  const parsed = await parseApiError(response);
  return [parsed.code, parsed.message]
    .filter((value): value is string => Boolean(value))
    .join(': ');
}

export const docsCommand = new Command('docs')
  .description('Document upload, classification, and indexing')
  .addHelpText('after', `
Examples:
  $ eai docs classify ./reports/contract.pdf --vertical-key business-docs --workflow-key review
  $ eai docs classify ./reports/site-plan.pdf --planning-application-id <projectId>
  $ eai docs upload ./reports/site-plan.pdf --planning-application-id <projectId>

Typical workflow:
  1. Configure and publish the app's document schemas and workflow classifier
  2. Run classify once to upload and queue analysis, or upload for full processing
  3. Poll the returned job ID and read the saved results; acceptance is not completion

Standalone documents require a business document lifecycle enabled on the
app/workflow binding. PublicAPI checks readiness and permissions before writing.
Do not invent a planning ID or repeat the upload when a job is still processing.

Use docs commands when the file is the subject of document processing or AI
context. Use "eai resources file" when the file is an attachment to a typed
resource object.
  `);

// ─── eai docs upload ─────────────────────────────────────────────────────

addUploadOptions(docsCommand
  .command('upload <file>')
  .description('Upload a document'))
  .action(async (file: string, options: DocumentCommandOptions) => {
    const { basename } = await import('node:path');
    const spinner = makeSpinner(options.format || 'text', `Uploading ${basename(file)}...`);
    try {
      validateDocumentUploadContext(options);
      const { client } = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
      const res = await client.uploadDocument(file, options);

      if (!res.ok) {
        if (options.format === 'json') {
          out.json({ ok: false, status: res.status, error: { message: await readResponseError(res) } });
          process.exitCode = 1;
          return;
        }
        throw new Error(await readResponseError(res));
      }

      const data = await res.json() as BatchJobResponse;
      if (options.format === 'json') {
        out.json({ ok: true, status: res.status, body: data });
        return;
      }
      const jobId = data.jobId || data.job_id;
      const documentId = data.documents?.[0]?.documentId || data.documents?.[0]?.document_id;
      const message = `Queued ${chalk.cyan(basename(file))} for upload${jobId ? ` (${chalk.dim(`job ${jobId}`)})` : ''}${documentId ? ` — ${chalk.dim(documentId)}` : ''}`;
      if (spinner) spinner.succeed(message);
      else out.success(message);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (options.format === 'json') out.json({ ok: false, error: { message } });
      else if (spinner) spinner.fail(message);
      else out.error(message);
      process.exitCode = 1;
    }
  });

// ─── eai docs classify ───────────────────────────────────────────────────

addUploadOptions(docsCommand
  .command('classify <file>')
  .description('Classify a document'))
  .action(async (file: string, options: DocumentCommandOptions) => {
    const { basename } = await import('node:path');
    const spinner = makeSpinner(options.format || 'text', `Classifying ${basename(file)}...`);
    try {
      validateDocumentUploadContext(options);
      const { client } = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
      const res = await client.classifyDocument(file, options);
      if (!res.ok) {
        if (options.format === 'json') {
          out.json({ ok: false, status: res.status, error: { message: await readResponseError(res) } });
          process.exitCode = 1;
          return;
        }
        throw new Error(await readResponseError(res));
      }

      const data = await res.json() as BatchJobResponse;
      if (options.format === 'json') {
        out.json({ ok: true, status: res.status, body: data });
        return;
      }
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
        const message = `Classified ${chalk.cyan(basename(file))} as ${chalk.cyan(data.classification.type)}${confidence}${documentId ? ` — ${chalk.dim(documentId)}` : ''}${jobId ? ` ${chalk.dim(`job ${jobId}`)}` : ''}`;
        if (spinner) spinner.succeed(message);
        else out.success(message);
        return;
      }

      const message = `Queued ${chalk.cyan(basename(file))} for classification${jobId ? ` (${chalk.dim(`job ${jobId}`)})` : ''}${documentId ? ` — ${chalk.dim(documentId)}` : ''}`;
      if (spinner) spinner.succeed(message);
      else out.success(message);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (options.format === 'json') out.json({ ok: false, error: { message } });
      else if (spinner) spinner.fail(message);
      else out.error(message);
      process.exitCode = 1;
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
        spinner.fail(await readResponseError(res));
        process.exit(1);
      }

      spinner.succeed(`Indexed document ${chalk.dim(documentId)} for RAG`);
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
