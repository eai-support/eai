/**
 * eai vertical — manage tenant app/product instances under the active company tenant.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolveCommandContext, normalizeFormat, makeSpinner } from '../lib/context.js';
import { patchEnvFile } from '../lib/config.js';
import { isRecord, toObjectTypeSlug } from '../lib/utils.js';
import * as out from '../lib/output.js';

const VERTICAL_ENROLLMENT_TYPE = 'tenant-vertical-enrollment';

export interface VerticalCreateOptions {
  key?: string;
  template?: string;
  source?: string;
  appUrl?: string;
  status?: string;
  format?: string;
  json?: boolean;
}

export function buildVerticalEnrollmentData(
  name: string,
  tenantId: string,
  options: VerticalCreateOptions,
): Record<string, unknown> {
  const displayName = name.trim();
  const verticalKey = (options.key || toObjectTypeSlug(displayName)).trim();

  if (!displayName) {
    throw new Error('Vertical display name is required.');
  }
  if (!verticalKey) {
    throw new Error('Vertical key is required.');
  }

  return {
    tenantId,
    verticalKey,
    displayName,
    status: options.status || 'pending',
    source: options.source || 'eai-cli',
    ...(options.template ? { templateKey: options.template } : {}),
    ...(options.appUrl ? { appUrl: options.appUrl } : {}),
  };
}

function extractDocs(payload: unknown): Array<{ id?: string; data?: Record<string, unknown>; version?: number }> {
  if (!isRecord(payload)) return [];
  const docs = Array.isArray(payload.docs) ? payload.docs : Array.isArray(payload.items) ? payload.items : [];
  return docs.filter(isRecord).map((doc) => ({
    id: typeof doc.id === 'string' ? doc.id : undefined,
    data: isRecord(doc.data) ? doc.data : undefined,
    version: typeof doc.version === 'number' ? doc.version : undefined,
  }));
}

async function readResponsePayload(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function fail(message: string): never {
  out.error(message);
  process.exit(1);
}

async function validateVerticalEnrollment(
  verticalKey: string,
  ctx: Awaited<ReturnType<typeof resolveCommandContext>>,
): Promise<void> {
  const res = await ctx.client.listResources(VERTICAL_ENROLLMENT_TYPE, {
    limit: 1,
    where: { verticalKey },
  });
  if (!res.ok) {
    fail(`Could not validate ${verticalKey}: ${res.status} ${res.statusText}`);
  }
  const docs = extractDocs(await readResponsePayload(res));
  if (docs.length === 0) {
    fail(`No tenant vertical enrollment found for ${verticalKey}. Create it with \`eai vertical create\` first, or pass --skip-validate if the platform is still publishing the Object Type.`);
  }
}

export const verticalCommand = new Command('vertical')
  .description('Manage dynamic vertical/app instances under the active company tenant');

verticalCommand
  .command('list')
  .description('List vertical/app instances for the active company tenant')
  .option('--tenant-id <id>', 'Run against a specific company tenant')
  .option('--limit <n>', 'Items per page', '50')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const format = normalizeFormat(options);
    const spinner = makeSpinner(format, 'Listing tenant verticals...');

    const res = await ctx.client.listResources(VERTICAL_ENROLLMENT_TYPE, {
      limit: Number.parseInt(options.limit, 10),
      sort: 'verticalKey',
    });
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      spinner?.fail('Failed to list tenant verticals');
      fail(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `${res.status} ${res.statusText}`);
    }

    const docs = extractDocs(payload);
    if (format === 'json') {
      out.json({ tenantId: ctx.tenantId, objectType: VERTICAL_ENROLLMENT_TYPE, verticals: docs });
      return;
    }

    spinner?.succeed(`${docs.length} vertical/app instance${docs.length === 1 ? '' : 's'} found`);
    if (docs.length === 0) {
      out.info('No tenant vertical enrollments found.');
      return;
    }
    for (const doc of docs) {
      const data = doc.data ?? {};
      out.info(`${chalk.cyan(String(data.verticalKey ?? doc.id ?? 'unknown'))} — ${String(data.displayName ?? 'Untitled')} (${String(data.status ?? 'unknown')})`);
    }
  });

verticalCommand
  .command('create <name>')
  .description('Create a dynamic vertical/app instance under the active company tenant')
  .option('--tenant-id <id>', 'Run against a specific company tenant')
  .option('--key <key>', 'Stable vertical/app key (defaults to kebab-case name)')
  .option('--template <templateKey>', 'Optional vertical-catalog template key')
  .option('--source <source>', 'Creation source', 'eai-cli')
  .option('--app-url <url>', 'Optional app URL')
  .option('--status <status>', 'Initial lifecycle status', 'pending')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (name: string, options: VerticalCreateOptions & { tenantId?: string }) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const format = normalizeFormat(options);
    const data = buildVerticalEnrollmentData(name, ctx.tenantId, options);
    const spinner = makeSpinner(format, `Creating ${data.verticalKey}...`);

    const res = await ctx.client.createResource(VERTICAL_ENROLLMENT_TYPE, data);
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      spinner?.fail('Failed to create tenant vertical');
      fail(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `${res.status} ${res.statusText}`);
    }

    if (format === 'json') {
      out.json({ tenantId: ctx.tenantId, objectType: VERTICAL_ENROLLMENT_TYPE, request: data, response: payload });
      return;
    }

    spinner?.succeed(`Created tenant vertical ${chalk.cyan(String(data.verticalKey))}`);
    out.info('This is a tenant app/product instance, not a child tenant.');
  });

verticalCommand
  .command('select <key>')
  .description('Set EAI_VERTICAL_KEY in the current project .env.local')
  .option('--tenant-id <id>', 'Validate against a specific company tenant')
  .option('--skip-validate', 'Skip remote lookup before writing .env.local', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (key: string, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const format = normalizeFormat(options);
    const verticalKey = key.trim();

    if (!verticalKey) {
      fail('Vertical key is required.');
    }

    if (!options.skipValidate) {
      await validateVerticalEnrollment(verticalKey, ctx);
    }

    await patchEnvFile(ctx.root, { EAI_VERTICAL_KEY: verticalKey });

    if (format === 'json') {
      out.json({ tenantId: ctx.tenantId, verticalKey, env: 'EAI_VERTICAL_KEY' });
      return;
    }
    out.success(`Active vertical/app set to ${chalk.cyan(verticalKey)} in .env.local`);
  });

verticalCommand
  .command('provision <key>')
  .description('Provision storage needed by a tenant vertical/app instance')
  .option('--tenant-id <id>', 'Run against a specific company tenant')
  .option('--backend <backend>', 'postgresql|mongodb|documentdb|blob|search|all', 'all')
  .option('--dry-run', 'Plan actions without applying changes', false)
  .option('--rebuild-search', 'Request search projection rebuild after provisioning', false)
  .option('--skip-validate', 'Skip tenant-vertical-enrollment lookup', false)
  .option('--select', 'Write EAI_VERTICAL_KEY after successful provisioning', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (key: string, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const format = normalizeFormat(options);
    const verticalKey = key.trim();

    if (!verticalKey) {
      fail('Vertical key is required.');
    }

    if (!options.skipValidate) {
      await validateVerticalEnrollment(verticalKey, ctx);
    }

    const spinner = makeSpinner(
      format,
      `${options.dryRun ? 'Planning' : 'Provisioning'} storage for ${verticalKey}...`,
    );
    const res = await ctx.client.provisionStorage({
      backend: options.backend,
      dryRun: Boolean(options.dryRun),
      rebuildSearch: Boolean(options.rebuildSearch),
    });
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      spinner?.fail('Failed to provision tenant vertical storage');
      fail(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `${res.status} ${res.statusText}`);
    }

    if (options.select) {
      await patchEnvFile(ctx.root, { EAI_VERTICAL_KEY: verticalKey });
    }

    if (format === 'json') {
      out.json({
        tenantId: ctx.tenantId,
        verticalKey,
        selected: Boolean(options.select),
        storage: payload,
      });
      return;
    }

    spinner?.succeed(options.dryRun ? 'Storage plan complete' : 'Storage provisioning complete');
    out.info(`Vertical/app ${chalk.cyan(verticalKey)} remains a tenant enrollment, not a child tenant.`);
    if (isRecord(payload) && Array.isArray(payload.results)) {
      for (const result of payload.results.filter(isRecord)) {
        const objectType = typeof result.objectType === 'string' ? result.objectType : 'unknown';
        const backend = typeof result.backend === 'string' ? result.backend : 'unknown';
        const status = typeof result.status === 'string' ? result.status : 'unknown';
        const actions = Array.isArray(result.actions) ? result.actions.map(String) : [];
        out.info(`${chalk.cyan(objectType)} ${chalk.dim(backend)} ${status}`);
        for (const action of actions) {
          out.dim(`  ${action}`);
        }
      }
    }
    if (options.select) {
      out.success(`Active vertical/app set to ${chalk.cyan(verticalKey)} in .env.local`);
    }
  });
