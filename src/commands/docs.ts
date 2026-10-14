/**
 * eai docs — document management (upload, classify, index).
 */

import { Command, Option } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { parseApiError, validateDocumentUploadContext, type DocumentUploadContext } from '../lib/api.js';
import { makeSpinner, resolveCommandContext } from '../lib/context.js';
import * as out from '../lib/output.js';
import { isRecord } from '../lib/utils.js';
import { ContentUnderstandingError } from '../lib/content-understanding-manifest.js';
import { readContentUnderstandingResponse, requireWaitTimeout } from '../lib/content-understanding-client.js';

interface DocumentCommandOptions extends DocumentUploadContext {
  tenantId?: string;
  format?: string;
}

function addUploadOptions(command: Command): Command {
  return command
    .option('--tenant-id <id>', 'Use a specific workspace with the current user login')
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
  $ eai docs classify ./reports/contract.pdf --storage-target resourceapi --vertical-key business-docs --workflow-key review
  $ eai docs classify ./reports/site-plan.pdf --storage-target resourceapi --planning-application-id <projectId>
  $ eai docs upload ./reports/site-plan.pdf --storage-target resourceapi --planning-application-id <projectId>

Typical workflow:
  1. Configure and publish the app's document schemas and workflow classifier
  2. Run classify once to upload and queue analysis, or upload for full processing
  3. Poll the returned job ID and read the saved results; acceptance is not completion
     eai docs job <job-id> --tenant-id <workspace-id> --wait --format json
     eai docs get <document-id> --job-id <job-id> --tenant-id <workspace-id> --format json

Standalone documents require a business document lifecycle enabled on the
app/workflow binding. PublicAPI checks readiness and permissions before writing.
Do not invent a planning ID or repeat the upload when a job is still processing.

Use docs commands when the file is the subject of document processing or AI
context. Use "eai resources file" when the file is an attachment to a typed
resource object.
  `);

interface DocumentReadOptions extends DocumentCommandOptions {
  jobId?: string;
  wait?: boolean;
  timeout?: string;
}
function readIdentifier(value: string, label: string): string {
  if (!value || value === '.' || value === '..' || value.trim() !== value || value.length > 256 || /[\uD800-\uDFFF]/u.test(value) || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new ContentUnderstandingError('DOC_IDENTIFIER_INVALID', `${label} must be a nonempty bounded identifier.`);
  }
  return value;
}
function readFailure(error: unknown): Record<string, unknown> {
  return { ok: false, ...(error instanceof ContentUnderstandingError && error.status ? { status: error.status } : {}),
    error: { code: error instanceof ContentUnderstandingError ? error.code : 'DOC_REQUEST_FAILED',
      message: error instanceof Error ? error.message : 'Document read failed.' } };
}
function printRead(options: DocumentReadOptions, result: Record<string, unknown>): void {
  if (options.format === 'json') out.json(result);
  else if (result.ok !== true) out.error(isRecord(result.error) && typeof result.error.message === 'string' ? result.error.message : 'Document read failed.');
  else if (isRecord(result.body)) out.info(`Document ${String(result.body.status || result.body.processingStatus || 'record retrieved')}`);
  if (result.ok !== true) process.exitCode = 1;
}
/** Return the exact observed spelling only when all supplied aliases agree. */
function aliasedIdentifier(value: Record<string, unknown>, camel: string, snake: string): string | null | undefined {
  const supplied = [camel, snake].filter(key => Object.hasOwn(value, key)).map(key => value[key]);
  if (supplied.length === 0) return undefined;
  if (supplied.some(identifier => typeof identifier !== 'string' || identifier.length === 0)
    || supplied.some(identifier => identifier !== supplied[0])) return null;
  return supplied[0] as string;
}
function parseJob(value: Record<string, unknown>, jobId: string, tenantId: string): Record<string, unknown> {
  const observedTenant = aliasedIdentifier(value, 'tenantId', 'tenant_id');
  if (aliasedIdentifier(value, 'jobId', 'job_id') !== jobId || (observedTenant !== undefined && observedTenant !== tenantId) || typeof value.status !== 'string'
    || !['queued', 'processing', 'completed', 'completed_with_errors', 'failed'].includes(value.status)
    || !Array.isArray(value.documents) || value.documents.some(doc => !isRecord(doc) || typeof aliasedIdentifier(doc, 'documentId', 'document_id') !== 'string')) {
    throw new ContentUnderstandingError('DOC_JOB_MISMATCH', 'Document job does not match the requested job and workspace.');
  }
  return value;
}

docsCommand.command('job <jobId>').description('Read an accepted document job; optionally wait without repeating upload')
  .option('--tenant-id <id>', 'Exact owning workspace')
  .option('--wait', 'Poll this exact job only', false)
  .option('--timeout <seconds>', 'Wait deadline, 1 to 1800 seconds', '300')
  .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'))
  .action(async (jobId: string, options: DocumentReadOptions) => {
    try {
      readIdentifier(jobId, 'Job ID'); const timeout = requireWaitTimeout(options.timeout);
      const context = await resolveCommandContext({ tenantId: options.tenantId, interactive: false });
      const path = `/v4/data/documents/jobs/${encodeURIComponent(jobId)}`, deadline = Date.now() + timeout;
      let response = await context.client.getDocumentJob(jobId, Math.max(1, deadline - Date.now()));
      let job = parseJob(await readContentUnderstandingResponse(response), jobId, context.tenantId);
      const failedJob = () => ['failed', 'completed_with_errors'].includes(String(job.status))
        || (job.documents as Record<string, unknown>[]).some(doc => ['storage', 'classification', 'rag']
          .some(key => isRecord(doc[key]) && doc[key].status === 'failed'));
      const pendingStages = () => (job.documents as Record<string, unknown>[]).some(doc => ['storage', 'classification', 'rag']
        .some(key => isRecord(doc[key]) && (doc[key].status === 'pending' || doc[key].status === 'processing')));
      while (options.wait && !failedJob() && (job.status !== 'completed' || pendingStages()) && Date.now() < deadline) {
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(2000, Math.max(0, deadline - Date.now()))));
        if (Date.now() >= deadline) break;
        response = await context.client.getDocumentJob(jobId, Math.max(1, deadline - Date.now()));
        job = parseJob(await readContentUnderstandingResponse(response), jobId, context.tenantId);
      }
      const failed = failedJob();
      const pending = !failed && ((options.wait && job.status !== 'completed') || (job.status === 'completed' && pendingStages()));
      printRead(options, { ok: !failed && !pending, status: response.status, request: { method: 'GET', path,
        ...context.client.getRequestScope() }, body: job,
        ...(failed || pending ? { error: { code: failed ? 'DOC_JOB_FAILED' : 'DOC_JOB_PENDING',
          message: failed ? 'Document job failed or completed with errors; inspect its pipeline results.'
            : options.wait ? 'Wait deadline reached. Poll this job again; do not re-upload.'
              : 'Document job has incomplete pipeline results. Poll this job again; do not re-upload.', jobId } } : {}) });
    } catch (error) { printRead(options, { ...readFailure(error), jobId }); }
  });

docsCommand.command('get <documentId>').description('Read the persisted document and analysis result through PublicAPI')
  .option('--tenant-id <id>', 'Exact owning workspace')
  .option('--job-id <id>', 'Original accepted job ID for the document')
  .addOption(new Option('--storage-target <target>', 'Document storage target').choices(['resourceapi']).default('resourceapi'))
  .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'))
  .action(async (documentId: string, options: DocumentReadOptions) => {
    try {
      readIdentifier(documentId, 'Document ID'); if (options.jobId !== undefined) readIdentifier(options.jobId, 'Job ID');
      const context = await resolveCommandContext({ tenantId: options.tenantId, interactive: false });
      const params = new URLSearchParams({ storage_target: 'resourceapi', ...(options.jobId ? { job_id: options.jobId } : {}) });
      const path = `/v4/data/documents/records/${encodeURIComponent(documentId)}?${params}`;
      const response = await context.client.getDocumentRecord(documentId, options.jobId);
      const body = await readContentUnderstandingResponse(response);
      const observedTenant = aliasedIdentifier(body, 'tenantId', 'tenant_id'), observedJob = aliasedIdentifier(body, 'jobId', 'job_id');
      const untrackedJob = !options.jobId && ['jobId', 'job_id'].every(key => body[key] === undefined || body[key] === null);
      if (aliasedIdentifier(body, 'documentId', 'document_id') !== documentId || aliasedIdentifier(body, 'storageTarget', 'storage_target') !== 'resourceapi'
        || (observedTenant !== undefined && observedTenant !== context.tenantId)
        || (body.tenant !== undefined && body.tenant !== context.tenantId)
        || (observedJob === null && !untrackedJob) || (options.jobId && observedJob !== options.jobId)) {
        throw new ContentUnderstandingError('DOC_RECORD_MISMATCH', 'Document result does not match the requested document, job and workspace.');
      }
      const processingStatuses = [body.processingStatus,
        ...(body.machineAnalysis !== undefined ? [isRecord(body.machineAnalysis) ? body.machineAnalysis.processingStatus : undefined] : [])];
      const failed = processingStatuses.some(status => typeof status === 'string' && ['failed', 'completed_with_errors', 'partial_failure'].includes(status));
      const pending = !failed && processingStatuses.some(status => status !== 'complete' && status !== 'completed');
      printRead(options, { ok: !failed && !pending, status: response.status, request: { method: 'GET', path,
        ...context.client.getRequestScope() }, body,
        ...(failed || pending ? { error: { code: failed ? 'DOC_RECORD_FAILED' : 'DOC_RECORD_PENDING',
          message: failed ? 'Persisted document processing failed; inspect its analysis results.'
            : 'Persisted document processing is incomplete. Poll the original job and read this document again; do not re-upload.',
          documentId, ...(options.jobId ? { jobId: options.jobId } : {}) } } : {}) });
    } catch (error) { printRead(options, { ...readFailure(error), documentId, ...(options.jobId ? { jobId: options.jobId } : {}) }); }
  });

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
