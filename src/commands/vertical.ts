/**
 * eai vertical — manage tenant app/product instances under the active company tenant.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolveCommandContext, normalizeFormat, makeSpinner } from '../lib/context.js';
import { PlatformAPIClient } from '../lib/api.js';
import { patchEnvFile } from '../lib/config.js';
import {
  errMsg,
  isRecord,
  normalizeChildTenantDisplayNameOption,
  normalizeChildTenantSlugOption,
  toObjectTypeSlug,
} from '../lib/utils.js';
import * as out from '../lib/output.js';

const VERTICAL_ENROLLMENT_TYPE = 'tenant-vertical-enrollment';
const DEFAULT_VERTICAL_SOURCE = ['eai', 'cli'].join('-');

export interface VerticalCreateOptions {
  key?: string;
  template?: string;
  source?: string;
  appUrl?: string;
  status?: string;
  parentTenant?: string;
  childTenant?: string;
  childTenantSlug?: string;
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
    throw new Error('App display name is required.');
  }
  if (!verticalKey) {
    throw new Error('App key is required.');
  }

  return {
    tenantId,
    verticalKey,
    displayName,
    status: options.status || 'pending',
    source: options.source || DEFAULT_VERTICAL_SOURCE,
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

function tenantRefId(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' && id ? id : null;
  }
  return null;
}

async function resolveMainCompanyTenantId(publicApiUrl: string, tenantId: string): Promise<string> {
  const client = new PlatformAPIClient(publicApiUrl, tenantId);
  const res = await client.getTenant(tenantId);
  if (!res.ok) {
    fail(`Could not resolve company tenant ${tenantId}: ${res.status} ${res.statusText}`);
  }
  const tenant = (await readResponsePayload(res)) as Record<string, unknown>;
  const parentId =
    (typeof tenant.parentTenantId === 'string' && tenant.parentTenantId) ||
    tenantRefId(tenant.parentTenant);
  const ultimateParentId =
    (typeof tenant.ultimateParentId === 'string' && tenant.ultimateParentId) ||
    tenantRefId(tenant.ultimateParent);
  return parentId ? ultimateParentId || parentId : tenantId;
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
    fail(`No app found for ${verticalKey}. Create it with \`eai vertical create\` first, or pass --skip-validate if the app is still being prepared.`);
  }
}

export const verticalCommand = new Command('vertical')
  .description('Manage apps under the active company tenant');

verticalCommand
  .command('list')
  .description('List apps for the active company tenant')
  .option('--tenant-id <id>', 'Run against a specific company tenant')
  .option('--limit <n>', 'Items per page', '50')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const format = normalizeFormat(options);
    const spinner = makeSpinner(format, 'Listing apps...');

    const res = await ctx.client.listResources(VERTICAL_ENROLLMENT_TYPE, {
      limit: Number.parseInt(options.limit, 10),
      sort: 'verticalKey',
    });
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      spinner?.fail('Failed to list apps');
      fail(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `${res.status} ${res.statusText}`);
    }

    const docs = extractDocs(payload);
    if (format === 'json') {
      out.json({ tenantId: ctx.tenantId, apps: docs });
      return;
    }

    spinner?.succeed(`${docs.length} app${docs.length === 1 ? '' : 's'} found`);
    if (docs.length === 0) {
      out.info('No apps found.');
      return;
    }
    for (const doc of docs) {
      const data = doc.data ?? {};
      out.info(`${chalk.cyan(String(data.verticalKey ?? doc.id ?? 'unknown'))} — ${String(data.displayName ?? 'Untitled')} (${String(data.status ?? 'unknown')})`);
    }
  });

verticalCommand
  .command('create <name>')
  .description('Create an app under a company tenant')
  .option('--tenant-id <id>', 'Main company tenant ID that owns this app')
  .option('--parent-tenant <id>', 'Immediate parent company tenant ID for the new child company')
  .option('--child-tenant <name>', 'Create or reuse a child company tenant display name')
  .option('--child-tenant-slug <slug>', 'Child company tenant key')
  .option('--key <key>', 'Stable app key (defaults to kebab-case name)')
  .option('--template <templateKey>', 'Optional vertical-catalog template key')
  .option('--source <source>', 'Creation source', DEFAULT_VERTICAL_SOURCE)
  .option('--app-url <url>', 'Optional app URL')
  .option('--status <status>', 'Initial lifecycle status', 'pending')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (name: string, options: VerticalCreateOptions & { tenantId?: string }) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const companyTenantId = await resolveMainCompanyTenantId(ctx.publicApiUrl, ctx.tenantId);
    const immediateParentTenantId =
      options.parentTenant?.trim() || (options.tenantId ? companyTenantId : ctx.tenantId);
    const format = normalizeFormat(options);
    const data = buildVerticalEnrollmentData(name, companyTenantId, options);
    let childTenantDisplayName: string | undefined;
    let childTenantSlug: string | undefined;
    try {
      childTenantDisplayName = normalizeChildTenantDisplayNameOption(options.childTenant);
      childTenantSlug = normalizeChildTenantSlugOption(options.childTenantSlug);
    } catch (err) {
      fail(errMsg(err));
    }
    const spinner = makeSpinner(format, `Creating ${data.verticalKey}...`);

    const client = new PlatformAPIClient(ctx.publicApiUrl, companyTenantId);
    const res = await client.createTenantApp(companyTenantId, {
      appDisplayName: String(data.displayName),
      verticalKey: String(data.verticalKey),
      ...(immediateParentTenantId !== companyTenantId ? { parentTenantId: immediateParentTenantId } : {}),
      ...(childTenantDisplayName ? { childTenantDisplayName } : {}),
      ...(childTenantSlug ? { childTenantSlug } : {}),
      ...(options.template ? { templateKey: options.template } : {}),
      source: options.source || DEFAULT_VERTICAL_SOURCE,
      ...(options.appUrl ? { appUrl: options.appUrl } : {}),
    });
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      spinner?.fail('Failed to create app');
      fail(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `${res.status} ${res.statusText}`);
    }

    if (format === 'json') {
      out.json({ tenantId: companyTenantId, appKey: data.verticalKey, request: data, response: payload });
      return;
    }

    spinner?.succeed(`Created app ${chalk.cyan(String(data.verticalKey))}`);
    out.info(`Main company tenant: ${chalk.cyan(companyTenantId)}`);
    if (immediateParentTenantId !== companyTenantId) {
      out.info(`Immediate parent company: ${chalk.cyan(immediateParentTenantId)}`);
    }
    if (isRecord(payload) && isRecord(payload.childTenant)) {
      out.info(`Child tenant: ${chalk.cyan(String(payload.childTenant.displayName ?? childTenantDisplayName))} · ${chalk.dim(String(payload.childTenant.id ?? ''))}`);
    } else {
      out.info(`App tenant: ${chalk.cyan(immediateParentTenantId)}`);
    }
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
      fail('App key is required.');
    }

    if (!options.skipValidate) {
      await validateVerticalEnrollment(verticalKey, ctx);
    }

    await patchEnvFile(ctx.root, { EAI_VERTICAL_KEY: verticalKey });

    if (format === 'json') {
      out.json({ tenantId: ctx.tenantId, verticalKey, env: 'EAI_VERTICAL_KEY' });
      return;
    }
    out.success(`Active app set to ${chalk.cyan(verticalKey)} in .env.local`);
  });

verticalCommand
  .command('provision <key>')
  .description('Prepare platform storage for an app')
  .option('--tenant-id <id>', 'Run against a specific company tenant')
  .option('--backend <backend>', 'postgresql|mongodb|documentdb|blob|search|all', 'all')
  .option('--dry-run', 'Plan actions without applying changes', false)
  .option('--rebuild-search', 'Request search projection rebuild after provisioning', false)
  .option('--skip-validate', 'Skip app lookup', false)
  .option('--select', 'Write EAI_VERTICAL_KEY after successful provisioning', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (key: string, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    const format = normalizeFormat(options);
    const verticalKey = key.trim();

    if (!verticalKey) {
      fail('App key is required.');
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
      spinner?.fail('Failed to prepare app storage');
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
    out.info(`App ${chalk.cyan(verticalKey)} is linked under the selected company tenant.`);
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
      out.success(`Active app set to ${chalk.cyan(verticalKey)} in .env.local`);
    }
  });
