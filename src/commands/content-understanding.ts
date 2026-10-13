import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Command, Option } from 'commander';
import { resolveCommandContext, type CommandContext } from '../lib/context.js';
import { requireManagedPublicApiUrl } from '../lib/managed-public-api.js';
import { isRecord } from '../lib/utils.js';
import * as out from '../lib/output.js';
import {
  CANONICAL_TENANT_ID, ContentUnderstandingError, parseContentUnderstandingManifest,
  type ContentUnderstandingManifest,
} from '../lib/content-understanding-manifest.js';
import {
  parseContentUnderstandingCapabilities, parseContentUnderstandingOperation, parseContentUnderstandingPlan,
  readContentUnderstandingResponse, requireContentUnderstandingOperationId, requireWaitTimeout,
  type ContentUnderstandingOperation, type ContentUnderstandingPlanFile,
} from '../lib/content-understanding-client.js';

interface CuOptions {
  file?: string;
  tenantId?: string;
  plan?: string;
  operationId?: string;
  format?: string;
  wait?: boolean;
  timeout?: string;
}
interface ManifestInput { manifest: ContentUnderstandingManifest; manifestSha256: string }
interface CuOutput { ok: boolean; status?: number; body?: unknown; error?: { code: string; message: string; operationId?: string }; [key: string]: unknown }

async function readManifest(path?: string): Promise<ManifestInput> {
  if (!path) throw new ContentUnderstandingError('CU_INVALID_MANIFEST', '--file is required.');
  const bytes = await readFile(path);
  if (bytes.length > 1024 * 1024) throw new ContentUnderstandingError('CU_INVALID_MANIFEST', 'Manifest file exceeds the input size budget.');
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new ContentUnderstandingError('CU_INVALID_MANIFEST', 'Manifest file must contain valid JSON.'); }
  return { manifest: parseContentUnderstandingManifest(value), manifestSha256: createHash('sha256').update(bytes).digest('hex') };
}

function tenantId(options: CuOptions, manifest?: ContentUnderstandingManifest): string {
  if (typeof options.tenantId !== 'string' || !CANONICAL_TENANT_ID.test(options.tenantId) || options.tenantId === '00000000-0000-0000-0000-000000000000'
    || (manifest && manifest.tenantId !== options.tenantId)) {
    throw new ContentUnderstandingError('CU_TENANT_MISMATCH', '--tenant-id must be a canonical workspace UUID matching the manifest.');
  }
  return options.tenantId;
}
async function contextFor(id: string): Promise<CommandContext> {
  const context = await resolveCommandContext({ tenantId: id, interactive: false, forceRefresh: true,
    validatePublicApiUrl: requireManagedPublicApiUrl, pinPublicApiUrl: true });
  if (context.tenantId !== id) throw new ContentUnderstandingError('CU_TENANT_MISMATCH', 'Resolved workspace differs from the requested workspace.');
  return context;
}
function print(options: CuOptions, value: CuOutput | ContentUnderstandingPlanFile): void {
  if (options.format === 'json') out.json(value);
  else if (!value.ok) out.error(('error' in value ? value.error?.message : undefined) || 'Content Understanding request failed.');
  else if ('body' in value && isRecord(value.body)) {
    const body = value.body;
    if (body.$schema) { process.stdout.write(JSON.stringify(body, null, 2) + '\n'); return; }
    out.success(typeof body.status === 'string' ? `Content Understanding ${body.status}${typeof body.operationId === 'string' ? ` (${body.operationId})` : ''}`
      : 'ready' in body ? `Content Understanding ${body.ready === true ? 'ready' : 'not ready'}` : 'Content Understanding configuration valid');
  } else out.success('Content Understanding configuration valid');
  if (!value.ok) process.exitCode = 1;
}
function failure(error: unknown): CuOutput {
  const known = error instanceof ContentUnderstandingError;
  return { ok: false, ...(known && error.status ? { status: error.status } : {}),
    error: { code: known ? error.code : 'CU_REQUEST_FAILED', message: error instanceof Error ? error.message : 'Content Understanding request failed.',
      ...(known && error.operationId ? { operationId: error.operationId } : {}) } };
}
function action(handler: (options: CuOptions) => Promise<CuOutput | ContentUnderstandingPlanFile>): (options: CuOptions) => Promise<void> {
  return async options => { try { print(options, await handler(options)); } catch (error) { print(options, failure(error)); } };
}

async function capabilities(context: CommandContext, timeoutMs?: number): Promise<Record<string, unknown>> {
  return parseContentUnderstandingCapabilities(await readContentUnderstandingResponse(await context.client.getContentUnderstandingCapabilities(timeoutMs)), context.tenantId);
}

async function parsePlanFile(options: CuOptions, input: ManifestInput): Promise<ContentUnderstandingPlanFile> {
  if (!options.plan) throw new ContentUnderstandingError('CU_PLAN_MISMATCH', '--plan must name the unchanged saved JSON plan.');
  const bytes = await readFile(options.plan);
  if (bytes.length > 1024 * 1024) throw new ContentUnderstandingError('CU_PLAN_MISMATCH', 'Plan file exceeds the input size budget.');
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new ContentUnderstandingError('CU_PLAN_MISMATCH', 'Plan file must contain the original JSON plan output.'); }
  if (!isRecord(value) || value.ok !== true || value.kind !== 'eai.content-understanding.plan' || value.schemaVersion !== 1 || !isRecord(value.binding)
    || value.binding.tenantId !== input.manifest.tenantId || value.binding.bundleKey !== input.manifest.bundleKey
    || value.binding.manifestSha256 !== input.manifestSha256 || typeof value.binding.publicApiUrl !== 'string') {
    throw new ContentUnderstandingError('CU_PLAN_MISMATCH', 'Saved plan does not match the unchanged manifest file and workspace/bundle.');
  }
  const body = parseContentUnderstandingPlan(value.body, input.manifest.tenantId, input.manifest.bundleKey);
  return { ok: true, kind: 'eai.content-understanding.plan', schemaVersion: 1,
    binding: { tenantId: input.manifest.tenantId, bundleKey: input.manifest.bundleKey,
      publicApiUrl: value.binding.publicApiUrl, manifestSha256: input.manifestSha256 }, body };
}

function operationReadError(error: unknown, operationId: string): ContentUnderstandingError {
  return error instanceof ContentUnderstandingError
    ? new ContentUnderstandingError(error.code, error.message, operationId, error.status)
    : new ContentUnderstandingError('CU_OPERATION_READ_FAILED', 'Reading this operation failed. Keep its ID and inspect the original operation before resuming.', operationId);
}

async function waitForOperation(context: CommandContext, initial: ContentUnderstandingOperation, options: CuOptions,
  deadline: number, resume?: (operationId: string, timeoutMs: number) => Promise<ContentUnderstandingOperation>): Promise<CuOutput> {
  let operation = initial;
  try {
    while (options.wait && ['pending', 'running'].includes(operation.status) && Date.now() < deadline) {
      if (operation.nextAction === 'apply') {
        if (!resume) return { ok: false, body: operation, error: { code: 'CU_REQUIRES_APPLY',
          message: 'Provider work is ready; resume apply with the unchanged manifest, saved plan and this operation ID to publish or activate. Status remains read-only.', operationId: operation.operationId } };
        operation = await resume(initial.operationId, Math.max(1, deadline - Date.now()));
        if (!['pending', 'running'].includes(operation.status)) break;
      }
      await new Promise<void>(resolve => setTimeout(resolve, Math.min(2000, Math.max(0, deadline - Date.now()))));
      if (Date.now() >= deadline) break;
      operation = parseContentUnderstandingOperation(await readContentUnderstandingResponse(await context.client.getContentUnderstandingOperation(initial.operationId,
        Math.max(1, deadline - Date.now()))), context.tenantId, initial);
    }
  } catch (error) {
    const retained = operationReadError(error, initial.operationId);
    return { ...failure(retained), body: operation };
  }
  if (['failed', 'unknown', 'partial'].includes(operation.status)) return { ok: false, body: operation,
    error: { code: `CU_OPERATION_${operation.status.toUpperCase()}`, message: `Content Understanding operation is ${operation.status}; retain its ID and inspect its steps before resuming.`, operationId: operation.operationId } };
  if (operation.status === 'succeeded' && operation.currentReady !== true) return { ok: false, body: operation,
    error: { code: 'CU_CURRENT_READINESS_UNVERIFIED', message: 'Historical completion does not verify current workspace and provider readiness. Retain this operation ID and inspect current readback blockers before processing documents.', operationId: operation.operationId } };
  if (options.wait && operation.status !== 'succeeded') return { ok: false, body: operation,
    error: { code: 'CU_OPERATION_PENDING', message: 'Wait deadline reached. Use status for this operation; no replacement operation was submitted.', operationId: operation.operationId } };
  return { ok: true, status: operation.status === 'succeeded' ? 200 : 202, body: operation };
}

export const contentUnderstandingCommand = new Command('content-understanding')
  .description('Validate, plan and materialize bounded document analyzers through the selected workspace PublicAPI')
  .addHelpText('after', `
Harness workflow:
  eai content-understanding schema --format json
  eai content-understanding validate --file cu.json --format json
  eai content-understanding capabilities --tenant-id <workspace-id> --format json
  eai content-understanding plan --file cu.json --tenant-id <workspace-id> --format json > cu-plan.json
  eai content-understanding apply --file cu.json --plan cu-plan.json --tenant-id <workspace-id> --format json
  eai content-understanding status --operation-id <operation-id> --tenant-id <workspace-id> --format json

Your harness authors the manifest. The platform owns Azure credentials, approved models,
provider ownership and readiness. Typed mode must be enabled and qualified on that workspace.
Only document fields and flat classification are available. Graphs and segmentation are refused.
Before planning, prepare the existing app/workflow binding and matching tenant-owned
classifier draft with the existing setup and eai classifier save commands.
Keep the original manifest and plan for deliberate recovery after an unknown acknowledgement.
Status only reads existing operations; acceptance and pending work are not completion.
Succeeded historical work requires currentReady exactly true before document processing.
`);

function outputOptions(command: Command): Command {
  return command.addOption(new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'));
}
function workspaceOptions(command: Command): Command {
  return outputOptions(command.requiredOption('--tenant-id <id>', 'Exact owning workspace UUID'));
}
function waitOptions(command: Command): Command {
  return command.option('--wait', command.name() === 'apply' ? 'Wait for this exact operation; resume acknowledged remaining steps when requested' : 'Poll this exact operation without any mutation', false)
    .option('--timeout <seconds>', 'Wait deadline, 1 to 1800 seconds', '300');
}

outputOptions(contentUnderstandingCommand.command('schema').description('Print the local manifest JSON schema and semantic bounds'))
  .action(action(async () => {
    const schema = JSON.parse(await readFile(new URL('../../resources/content-understanding/manifest.schema.json', import.meta.url), 'utf8')) as unknown;
    return { ok: true, body: schema };
  }));
outputOptions(contentUnderstandingCommand.command('validate').description('Validate the complete manifest locally with no authentication or network access')
  .requiredOption('--file <path>', 'Declarative document configuration JSON'))
  .action(action(async options => { const input = await readManifest(options.file); return { ok: true, body: { valid: true, kind: input.manifest.kind,
    schemaVersion: input.manifest.schemaVersion, bundleKey: input.manifest.bundleKey, manifestSha256: input.manifestSha256,
    documentTypes: input.manifest.documentTypes.map(doc => doc.code) } }; }));
workspaceOptions(contentUnderstandingCommand.command('capabilities').description('Read actual selected-workspace typed mode, prerequisites and readiness'))
  .action(action(async options => ({ ok: true, body: await capabilities(await contextFor(tenantId(options))) })));
workspaceOptions(contentUnderstandingCommand.command('plan').description('Read prerequisites and return a scope-bound configuration plan; writes nothing')
  .requiredOption('--file <path>', 'Declarative document configuration JSON'))
  .action(action(async options => {
    const input = await readManifest(options.file), context = await contextFor(tenantId(options, input.manifest));
    const body = parseContentUnderstandingPlan(await readContentUnderstandingResponse(await context.client.planContentUnderstandingConfiguration(input.manifest)), context.tenantId, input.manifest.bundleKey);
    return { ok: true, kind: 'eai.content-understanding.plan', schemaVersion: 1,
      binding: { tenantId: context.tenantId, bundleKey: input.manifest.bundleKey,
        publicApiUrl: context.publicApiUrl, manifestSha256: input.manifestSha256 }, body };
  }));
waitOptions(workspaceOptions(contentUnderstandingCommand.command('apply').description('Apply or explicitly resume the unchanged saved plan after current capability checks')
  .requiredOption('--file <path>', 'Original declarative document configuration JSON')
  .requiredOption('--plan <path>', 'Original JSON output from the plan command')
  .option('--operation-id <id>', 'Resume this exact acknowledged operation')))
  .action(action(async options => {
    const timeout = requireWaitTimeout(options.timeout), input = await readManifest(options.file), id = tenantId(options, input.manifest);
    const plan = await parsePlanFile(options, input), requestedOperation = options.operationId === undefined ? undefined : requireContentUnderstandingOperationId(options.operationId);
    if (plan.body.ready !== true || plan.body.blockers.length > 0) throw new ContentUnderstandingError('CU_NOT_READY', 'Saved plan has unresolved prerequisites. Obtain a ready plan before applying.');
    const context = await contextFor(id);
    if (plan.binding.publicApiUrl !== context.publicApiUrl) throw new ContentUnderstandingError('CU_PLAN_MISMATCH', 'Selected PublicAPI gateway differs from the saved plan.');
    const available = await capabilities(context);
    if (available.enabled !== true || available.ready !== true) throw new ContentUnderstandingError('CU_NOT_READY', 'Typed configuration is not enabled and ready on this workspace.');
    // The backend checks actual versions/model bindings, or recovers the original durable operation before checking changed activation state.
    const deadline = Date.now() + timeout;
    let raw: Record<string, unknown>;
    try { raw = await readContentUnderstandingResponse(await context.client.applyContentUnderstandingConfiguration(input.manifest, plan.body.planDigest,
      plan.body.expectedVersions, requestedOperation, Math.max(1, deadline - Date.now()))); }
    catch (error) {
      if (error instanceof ContentUnderstandingError && error.status !== undefined) throw requestedOperation ? operationReadError(error, requestedOperation) : error;
      return { ok: false, binding: plan.binding, planDigest: plan.body.planDigest,
        error: { code: 'CU_APPLY_ACK_UNKNOWN', message: 'Apply acknowledgement is unknown. Keep the original manifest and plan; deliberately rerun that original apply to recover its durable operation. Do not create a replacement plan.',
          ...(requestedOperation ? { operationId: requestedOperation } : {}) } };
    }
    const operation = parseContentUnderstandingOperation(raw, id, { operationId: requestedOperation, bundleKey: input.manifest.bundleKey,
      definitionDigest: plan.body.definitionDigest });
    return waitForOperation(context, operation, options, deadline, async (operationId, timeoutMs) => {
      const current = await capabilities(context, timeoutMs);
      if (current.enabled !== true || current.ready !== true) throw new ContentUnderstandingError('CU_NOT_READY', 'Typed configuration is no longer enabled and ready; retain the existing operation.', operationId);
      try {
        return parseContentUnderstandingOperation(await readContentUnderstandingResponse(await context.client.applyContentUnderstandingConfiguration(input.manifest,
          plan.body.planDigest, plan.body.expectedVersions, operationId, Math.max(1, deadline - Date.now()))), id,
          { operationId, bundleKey: input.manifest.bundleKey, definitionDigest: plan.body.definitionDigest });
      } catch (error) {
        if (error instanceof ContentUnderstandingError && (error.status !== undefined || ['CU_OPERATION_MISMATCH', 'CU_OPERATION_INVALID'].includes(error.code))) throw error;
        throw new ContentUnderstandingError('CU_APPLY_ACK_UNKNOWN', 'Resume acknowledgement is unknown. Inspect this original operation before deliberately repeating the unchanged apply.', operationId);
      }
    });
  }));
waitOptions(workspaceOptions(contentUnderstandingCommand.command('status').description('Read or wait for an existing operation; dispatches no provider mutation')
  .requiredOption('--operation-id <id>', 'Exact acknowledged operation ID')))
  .action(action(async options => {
    const timeout = requireWaitTimeout(options.timeout), operationId = requireContentUnderstandingOperationId(options.operationId), context = await contextFor(tenantId(options));
    const deadline = Date.now() + timeout;
    let operation: ContentUnderstandingOperation;
    try { operation = parseContentUnderstandingOperation(await readContentUnderstandingResponse(await context.client.getContentUnderstandingOperation(operationId,
      Math.max(1, deadline - Date.now()))), context.tenantId, { operationId }); }
    catch (error) { throw operationReadError(error, operationId); }
    return waitForOperation(context, operation, options, deadline);
  }));
