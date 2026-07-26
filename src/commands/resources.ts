/**
 * eai resources — CRUD operations on platform resources.
 */

import { Command } from 'commander';
import type { Ora } from 'ora';
import chalk from 'chalk';
import { PlatformAPIClient } from '../lib/api.js';
import { resolveCommandContext, normalizeFormat, makeSpinner } from '../lib/context.js';
import { isRecord, toObjectTypeSlug } from '../lib/utils.js';
import * as out from '../lib/output.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';
import { findGuidance } from '../lib/error-guidance/match.js';
import { formatGuidanceText } from '../lib/error-guidance/render.js';

interface SchemaTypeSummary {
  name: string;
  slug?: string;
  properties: unknown[];
  linkTypes: unknown[];
  actions: unknown[];
  status?: string;
  publishedAt?: string | null;
}

interface PublishedTypeMatch {
  requestedType: string;
  requestedSlug: string;
  publishedTypeNames: string[];
  matchedType?: SchemaTypeSummary;
}

interface StorageSearchCapabilities {
  fulltext?: boolean;
  hybrid?: boolean;
  vector?: boolean;
  recommendedMode?: string | null;
  reasonCode?: string | null;
  reasonMessage?: string | null;
}

interface StorageCapabilities {
  search?: StorageSearchCapabilities;
}

export function buildCreateResourceOutput(
  type: string,
  submittedData: Record<string, unknown>,
  created: unknown,
): Record<string, unknown> {
  const createdResource = isRecord(created) ? created : {};
  const id = typeof createdResource.id === 'string'
    ? createdResource.id
    : isRecord(createdResource.data) && typeof createdResource.data.id === 'string'
      ? createdResource.data.id
      : undefined;
  const createdData = isRecord(createdResource.data) ? createdResource.data : submittedData;

  return {
    type,
    ...createdResource,
    id,
    data: createdData,
  };
}

function extractPublishedSchemaTypes(payload: unknown): SchemaTypeSummary[] {
  if (!isRecord(payload)) {
    return [];
  }

  if (Array.isArray(payload.objectTypes)) {
    return payload.objectTypes
      .filter((value): value is SchemaTypeSummary => isRecord(value) && typeof value.name === 'string')
      .map((value) => ({
        name: value.name,
        slug: typeof value.slug === 'string' ? value.slug : undefined,
        properties: Array.isArray(value.properties) ? value.properties : [],
        linkTypes: Array.isArray(value.linkTypes) ? value.linkTypes : [],
        actions: Array.isArray(value.actions) ? value.actions : [],
      }));
  }

  if (Array.isArray(payload.object_types)) {
    return payload.object_types
      .filter((value): value is SchemaTypeSummary => isRecord(value) && typeof value.name === 'string')
      .map((value) => ({
        name: value.name,
        slug: typeof value.slug === 'string' ? value.slug : undefined,
        properties: Array.isArray(value.properties) ? value.properties : [],
        linkTypes: Array.isArray(value.linkTypes) ? value.linkTypes : [],
        actions: Array.isArray(value.actions) ? value.actions : [],
      }));
  }

  if (!Array.isArray(payload.docs)) {
    return [];
  }

  return payload.docs
    .filter((value): value is SchemaTypeSummary => {
      if (!isRecord(value) || typeof value.name !== 'string') {
        return false;
      }
      if (value.status === 'published') {
        return true;
      }
      return value.publishedAt !== null && value.publishedAt !== undefined;
    })
    .map((value) => ({
      name: value.name,
      slug: typeof value.slug === 'string' ? value.slug : undefined,
      properties: Array.isArray(value.properties) ? value.properties : [],
      linkTypes: Array.isArray(value.linkTypes) ? value.linkTypes : [],
      actions: Array.isArray(value.actions) ? value.actions : [],
      status: typeof value.status === 'string' ? value.status : undefined,
      publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : null,
    }));
}

function failCommand(spinner: Ora | null, message: string): void {
  if (spinner) {
    spinner.fail(message);
  } else {
    out.error(message);
  }
}

function succeedCommand(spinner: Ora | null, message: string): void {
  if (spinner) {
    spinner.succeed(message);
  } else {
    out.success(message);
  }
}

function extractErrorPayload(payload: unknown): {
  message?: string;
  code?: string;
  reasonCode?: string;
  serverCode?: string;
} {
  if (!isRecord(payload)) {
    return {};
  }

  const nested = [payload.error, payload.detail, payload];
  const result: {
    message?: string;
    code?: string;
    reasonCode?: string;
    serverCode?: string;
  } = {};

  for (const candidate of nested) {
    if (typeof candidate === 'string' && !result.message) {
      result.message = candidate;
      continue;
    }
    if (!isRecord(candidate)) {
      continue;
    }
    if (!result.message) {
      const message = candidate.message ?? candidate.detail ?? candidate.error;
      if (typeof message === 'string') {
        result.message = message;
      }
    }
    if (!result.code && typeof candidate.code === 'string') {
      result.code = candidate.code;
    }
    if (!result.reasonCode) {
      const reasonCode = candidate.reasonCode ?? candidate.reason_code ?? candidate.reason;
      if (typeof reasonCode === 'string') {
        result.reasonCode = reasonCode;
      }
    }
    if (!result.serverCode) {
      const serverCode = candidate.serverCode ?? candidate.server_code;
      if (typeof serverCode === 'string') {
        result.serverCode = serverCode;
      }
    }
  }

  return result;
}

function withGuidance(
  message: string,
  lookup: {
    operation?: string;
    status: number;
    code?: string;
    reasonCode?: string;
    serverCode?: string;
    message?: string;
  },
): string {
  const guidance = findGuidance(lookup);
  return guidance ? `${message}\n\n${formatGuidanceText(guidance)}` : message;
}

async function formatResponseError(res: Response, operation?: string): Promise<string> {
  const text = await res.text();
  if (!text) {
    return withGuidance(`${res.status} ${res.statusText}`, {
      operation,
      status: res.status,
      message: res.statusText,
    });
  }

  try {
    const payload = JSON.parse(text) as unknown;
    const errorPayload = extractErrorPayload(payload);
    const message = errorPayload.message;
    const base = `${res.status} ${res.statusText}${message ? ` — ${message}` : ''}`;
    return withGuidance(base, {
      operation,
      status: res.status,
      code: errorPayload.code,
      reasonCode: errorPayload.reasonCode,
      serverCode: errorPayload.serverCode,
      message: message || text.slice(0, 300),
    });
  } catch {
    const message = text.slice(0, 300);
    return withGuidance(`${res.status} ${res.statusText} — ${message}`, {
      operation,
      status: res.status,
      message,
    });
  }
}

function renderSearchCapabilities(capabilities?: StorageCapabilities): void {
  const search = capabilities?.search;
  if (!search) {
    return;
  }

  const modeState = (ready?: boolean): string => (
    ready ? chalk.green('ready') : chalk.yellow('unavailable')
  );
  out.info(
    `Search modes: fulltext ${modeState(search.fulltext)}, hybrid ${modeState(search.hybrid)}, vector ${modeState(search.vector)}`,
  );
  if (search.recommendedMode) {
    out.info(`Recommended search mode: ${chalk.cyan(search.recommendedMode)}`);
  }
  if (search.reasonMessage) {
    out.warn(search.reasonMessage);
  }
}

export function matchPublishedType(
  requestedType: string,
  schemaTypes: SchemaTypeSummary[],
): PublishedTypeMatch {
  const requestedSlug = toObjectTypeSlug(requestedType);
  const matchedType = schemaTypes.find((schemaType) => (
    schemaType.name === requestedType
    || schemaType.slug === requestedSlug
    || toObjectTypeSlug(schemaType.name) === requestedSlug
  ));

  return {
    requestedType,
    requestedSlug,
    matchedType,
    publishedTypeNames: schemaTypes.map((schemaType) => schemaType.name),
  };
}

export function buildMissingPublishedTypeMessage(match: PublishedTypeMatch): string {
  if (match.publishedTypeNames.length === 0) {
    return `No published object types were found for the active tenant. ${match.requestedType} cannot be listed until types are published remotely.`;
  }

  return `Object type "${match.requestedType}" is not published for the active tenant. Published types: ${match.publishedTypeNames.join(', ')}.`;
}

async function describeMissingPublishedType(
  client: PlatformAPIClient,
  requestedType: string,
): Promise<string | null> {
  const schemaResponse = await client.getPublishedObjectTypes();
  if (!schemaResponse.ok) {
    return null;
  }

  const schemaPayload = await schemaResponse.json();
  const match = matchPublishedType(requestedType, extractPublishedSchemaTypes(schemaPayload));
  if (match.matchedType) {
    return null;
  }

  return buildMissingPublishedTypeMessage(match);
}

export async function loadJsonInput(options: { data?: string; file?: string }, fieldHint = '--data or --file'): Promise<unknown> {
  if (options.data) {
    return JSON.parse(options.data);
  }
  if (options.file) {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(options.file, 'utf-8'));
  }
  throw new Error(`Missing ${fieldHint}`);
}

export function normalizeBatchCreateItems(payload: unknown): Array<{ data: Record<string, unknown> }> {
  if (Array.isArray(payload)) {
    return payload.map((item) => ({ data: item as Record<string, unknown> }));
  }
  if (isRecord(payload) && Array.isArray(payload.items)) {
    return payload.items.map((item) => (
      isRecord(item) && isRecord(item.data) ? { data: item.data } : { data: item as Record<string, unknown> }
    ));
  }
  if (isRecord(payload)) {
    return [{ data: payload }];
  }
  throw new Error('Batch create payload must be an object, array, or { items } wrapper');
}

export function normalizeBatchProjectionMode(value: unknown): 'deferred' | 'sync' {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : 'deferred';
  if (mode === 'deferred' || mode === 'sync') {
    return mode;
  }
  throw new Error('Projection mode must be "deferred" or "sync"');
}

export function normalizeBatchUpdateItems(payload: unknown): Array<{ id: string; data: Record<string, unknown>; version: number }> {
  const items = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.items)
      ? payload.items
      : null;
  if (!items) {
    throw new Error('Batch update payload must be an array or { items } wrapper');
  }
  return items.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !isRecord(item.data) || typeof item.version !== 'number') {
      throw new Error('Batch update items require { id, data, version }');
    }
    return {
      id: item.id,
      data: item.data,
      version: item.version,
    };
  });
}

export function normalizeBatchDeleteIds(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload.map((item) => (
      isRecord(item) && typeof item.id === 'string' ? item.id : String(item)
    ));
  }
  if (isRecord(payload) && Array.isArray(payload.ids)) {
    return payload.ids.map(String);
  }
  throw new Error('Batch delete payload must be an array of ids or { ids }');
}

export const resourcesCommand = new Command('resources')
  .description('CRUD operations on platform resources');

// ─── eai resources list <type> ─────────────────────────────────────────────

resourcesCommand
  .command('list <type>')
  .description('List resources of a given type')
  .option('--tenant-id <id>', 'Run the read-only query against a specific tenant')
  .option('--page <n>', 'Page number', '1')
  .option('--limit <n>', 'Items per page', '20')
  .option('--sort <field>', 'Sort field (prefix with - for descending)', '-created_at')
  .option('--where <json>', 'Structured where filter as JSON')
  .option('--cursor <cursor>', 'Opaque cursor from a previous response')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai resources list User
  $ eai resources list Project --limit 10
  $ eai resources list User --tenant-id 00000000-0000-4000-8000-000000000000
  $ eai resources list User --format json | jq '.resources[] | .id'
  `)
  .action(async (type, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });

    options.format = normalizeFormat(options);
    const spinner = makeSpinner(options.format, `Listing ${type}...`);
    try {
      const res = await ctx.client.listResources(type, {
        page: parseInt(options.page),
        limit: parseInt(options.limit),
        sort: options.sort,
        where: options.where ? JSON.parse(options.where) : undefined,
        cursor: options.cursor,
      });

      if (!res.ok) {
        let message = `Failed: ${res.status} ${res.statusText}`;
        if (res.status === 404) {
          const publishedTypeMessage = await describeMissingPublishedType(ctx.client, type);
          if (publishedTypeMessage) {
            message = publishedTypeMessage;
          }
        }
        failCommand(spinner, message);
        process.exit(1);
      }

      const data = await res.json() as {
        docs: Array<{ id: string; data: Record<string, unknown>; created_at: string; version: number }>;
        totalDocs: number;
        page: number;
        totalPages: number;
        nextCursor?: string | null;
      };

      if (options.format === 'json') {
        out.json({
          type,
          resources: data.docs,
          totalDocs: data.totalDocs,
          page: data.page,
          totalPages: data.totalPages,
          nextCursor: data.nextCursor ?? null,
        });
        return;
      }

      succeedCommand(spinner,`${data.totalDocs} total — page ${data.page}/${data.totalPages}`);

      if (data.docs.length === 0) {
        out.info('No resources found.');
        return;
      }

      for (const doc of data.docs) {
        const preview = Object.entries(doc.data)
          .slice(0, 3)
          .map(([k, v]) => `${k}=${chalk.dim(String(v).slice(0, 30))}`)
          .join(', ');
        out.info(`${chalk.cyan(doc.id)} — ${preview}`);
      }
      if (data.nextCursor) {
        out.dim(`nextCursor=${data.nextCursor}`);
      }
    } catch (err) {
      failCommand(spinner, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

resourcesCommand
  .command('batch-create <type>')
  .description('Create resources in bulk')
  .option('--tenant-id <id>', 'Run the mutation against a specific tenant')
  .option('--data <json>', 'Batch payload as JSON array or object')
  .option('--file <path>', 'Read batch payload from JSON file')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (type, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);

    try {
      const payload = await loadJsonInput(options);
      const items = normalizeBatchCreateItems(payload);
      const spinner = makeSpinner(options.format, `Batch creating ${type}...`);
      const res = await ctx.client.batchCreateResources(type, items);
      if (!res.ok) {
        failCommand(spinner, `${res.status} ${res.statusText}`);
        process.exit(1);
      }
      const data = await res.json();
      if (options.format === 'json') {
        out.json(data);
      } else {
        succeedCommand(spinner,`Batch create complete (${data.succeeded} succeeded, ${data.failed} failed)`);
      }
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

resourcesCommand
  .command('batch-import <type>')
  .description('Import resources through the high-throughput bulk path')
  .option('--tenant-id <id>', 'Run the mutation against a specific tenant')
  .option('--data <json>', 'Batch payload as JSON array or object')
  .option('--file <path>', 'Read batch payload from JSON file')
  .option('--projection-mode <mode>', 'Search projection mode (deferred|sync)', 'deferred')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (type, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);

    try {
      const payload = await loadJsonInput(options);
      const items = normalizeBatchCreateItems(payload);
      const projectionMode = normalizeBatchProjectionMode(options.projectionMode);
      const spinner = makeSpinner(options.format, `Batch importing ${type}...`);
      const res = await ctx.client.batchImportResources(type, items, { projectionMode });
      if (!res.ok) {
        failCommand(spinner, await formatResponseError(res, 'resources.batch.import'));
        process.exit(1);
      }
      const data = await res.json() as {
        succeeded?: number;
        failed?: number;
        projectionMode?: string;
        projectionDeferred?: boolean;
        historyCreated?: number;
        outboxEnqueued?: number;
      };
      if (options.format === 'json') {
        out.json(data);
      } else {
        const projection = data.projectionDeferred === true
          ? 'projection deferred'
          : `projection ${data.projectionMode ?? projectionMode}`;
        succeedCommand(
          spinner,
          `Batch import complete (${data.succeeded ?? 0} succeeded, ${data.failed ?? 0} failed, ${projection})`,
        );
      }
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

resourcesCommand
  .command('batch-update <type>')
  .description('Update resources in bulk')
  .option('--tenant-id <id>', 'Run the mutation against a specific tenant')
  .option('--data <json>', 'Batch payload as JSON array or object')
  .option('--file <path>', 'Read batch payload from JSON file')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (type, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);

    try {
      const payload = await loadJsonInput(options);
      const items = normalizeBatchUpdateItems(payload);
      const spinner = makeSpinner(options.format, `Batch updating ${type}...`);
      const res = await ctx.client.batchUpdateResources(type, items);
      if (!res.ok) {
        failCommand(spinner, `${res.status} ${res.statusText}`);
        process.exit(1);
      }
      const data = await res.json();
      if (options.format === 'json') {
        out.json(data);
      } else {
        succeedCommand(spinner,`Batch update complete (${data.succeeded} succeeded, ${data.failed} failed)`);
      }
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

resourcesCommand
  .command('batch-delete <type>')
  .description('Delete resources in bulk')
  .option('--tenant-id <id>', 'Run the mutation against a specific tenant')
  .option('--ids <csv>', 'Comma-separated ids to delete')
  .option('--data <json>', 'Batch payload as JSON array or object')
  .option('--file <path>', 'Read batch payload from JSON file')
  .option('--force', 'Accepted for parity with resources delete; batch delete is non-interactive', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (type, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);

    try {
      const ids = options.ids
        ? String(options.ids).split(',').map((value) => value.trim()).filter(Boolean)
        : normalizeBatchDeleteIds(await loadJsonInput(options));
      const spinner = makeSpinner(options.format, `Batch deleting ${type}...`);
      const res = await ctx.client.batchDeleteResources(type, ids);
      if (!res.ok) {
        failCommand(spinner, `${res.status} ${res.statusText}`);
        process.exit(1);
      }
      const data = await res.json();
      if (options.format === 'json') {
        out.json(data);
      } else {
        succeedCommand(spinner,`Batch delete complete (${data.succeeded} succeeded, ${data.failed} failed)`);
      }
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

resourcesCommand
  .command('aggregate <type>')
  .description('Run a server-side aggregate query')
  .option('--tenant-id <id>', 'Run the read-only query against a specific tenant')
  .requiredOption('--group-by <fields>', 'Comma-separated groupBy fields')
  .requiredOption('--metrics <json>', 'Aggregate metrics JSON')
  .option('--where <json>', 'Structured where filter as JSON')
  .option('--limit <n>', 'Max summary rows', '1000')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (type, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);

    try {
      const res = await ctx.client.aggregateResources(type, {
        groupBy: String(options.groupBy).split(',').map((value) => value.trim()).filter(Boolean),
        metrics: JSON.parse(options.metrics),
        where: options.where ? JSON.parse(options.where) : undefined,
        limit: parseInt(options.limit),
      });
      if (!res.ok) {
        failCommand(null, await formatResponseError(res, 'resources.aggregate'));
        process.exit(1);
      }
      const data = await res.json() as { rows: Array<Record<string, unknown>>; totalRows: number };
      if (options.format === 'json') {
        out.json(data);
      } else {
        out.success(`${data.totalRows} aggregate rows`);
        for (const row of data.rows.slice(0, 20)) {
          out.info(JSON.stringify(row));
        }
      }
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai resources get <type> <id> ────────────────────────────────────────

resourcesCommand
  .command('get <type> <id>')
  .description('Get a single resource')
  .option('--tenant-id <id>', 'Run the read-only query against a specific tenant')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (type, id, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });

    options.format = normalizeFormat(options);

    try {
      const res = await ctx.client.getResource(type, id);
      if (!res.ok) {
        out.error(`${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const data = await res.json();

      if (options.format === 'json') {
        out.json(data);
      } else {
        out.heading(`${type}: ${id}`);
      }
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai resources create <type> ──────────────────────────────────────────

resourcesCommand
  .command('create <type>')
  .description('Create a new resource')
  .option('--tenant-id <id>', 'Run the mutation against a specific tenant')
  .option('--data <json>', 'Resource data as JSON string')
  .option('--file <path>', 'Read data from JSON file')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai resources create Project --data '{"name":"Demo","description":"Test project"}'
  $ eai resources create User --file user.json
  $ eai resources create Project --tenant-id 00000000-0000-4000-8000-000000000000 --data '{"name":"Demo"}'
  $ eai resources create Project --data '{"name":"Demo"}' --format json
  `)
  .action(async (type, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });

    options.format = normalizeFormat(options);

    let data: Record<string, unknown>;
    if (options.data) {
      data = JSON.parse(options.data);
    } else if (options.file) {
      const { readFile } = await import('node:fs/promises');
      data = JSON.parse(await readFile(options.file, 'utf-8'));
    } else {
      exitWithError(ErrorCode.E303, { field: '--data or --file' }, options.format);
    }

    const spinner = makeSpinner(options.format, `Creating ${type}...`);
    try {
      const res = await ctx.client.createResource(type, data);
      if (!res.ok) {
        failCommand(spinner, `${res.status} ${res.statusText}`);
        const body = await res.text();
        out.error(body);
        process.exit(1);
      }

      const created = await res.json();

      const output = buildCreateResourceOutput(type, data, created);

      if (options.format === 'json') {
        out.json(output);
      } else {
        const createdId = typeof output.id === 'string' ? output.id : undefined;
        succeedCommand(spinner,`Created ${type} ${chalk.dim(createdId ?? '')}`);
      }
    } catch (err) {
      failCommand(spinner, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai resources update <type> <id> ────────────────────────────────────

resourcesCommand
  .command('update <type> <id>')
  .description('Update a resource')
  .option('--tenant-id <id>', 'Run the mutation against a specific tenant')
  .option('--data <json>', 'Updated data as JSON string')
  .option('--version <n>', 'Resource version (for optimistic locking)')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (type, id, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });

    options.format = normalizeFormat(options);

    if (!options.data) {
      exitWithError(ErrorCode.E303, { field: '--data' }, options.format);
    }

    const data = JSON.parse(options.data);
    let version = options.version ? parseInt(options.version) : undefined;

    // Auto-fetch version if not provided
    if (version === undefined) {
      const getRes = await ctx.client.getResource(type, id);
      if (getRes.ok) {
        const existing = await getRes.json() as { version: number };
        version = existing.version;
      } else {
        exitWithError(ErrorCode.E203, { details: 'Could not fetch current resource version. Use --version explicitly.' }, options.format);
      }
    }

    const spinner = makeSpinner(options.format, `Updating ${type} ${id}...`);
    try {
      const res = await ctx.client.updateResource(type, id, data, version!);
      if (!res.ok) {
        failCommand(spinner, await formatResponseError(res, 'resources.update'));
        process.exit(1);
      }

      if (options.format === 'json') {
        out.json({ type, id, data, version });
      } else {
        succeedCommand(spinner,`Updated ${type} ${chalk.dim(id)}`);
      }
    } catch (err) {
      failCommand(spinner, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai resources delete <type> <id> ────────────────────────────────────

resourcesCommand
  .command('delete <type> <id>')
  .description('Delete a resource')
  .option('--tenant-id <id>', 'Run the mutation against a specific tenant')
  .option('--force', 'Skip confirmation', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (type, id, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });

    options.format = normalizeFormat(options);

    if (!options.force) {
      const inquirer = await import('inquirer');
      const { confirm } = await inquirer.default.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Delete ${type} ${id}?`,
        default: false,
      }]);
      if (!confirm) {
        if (options.format === 'json') {
          out.json({ cancelled: true });
        } else {
          out.info('Cancelled.');
        }
        return;
      }
    }

    const spinner = makeSpinner(options.format, `Deleting ${type} ${id}...`);
    try {
      const res = await ctx.client.deleteResource(type, id);
      if (!res.ok) {
        failCommand(spinner, `${res.status} ${res.statusText}`);
        process.exit(1);
      }

      if (options.format === 'json') {
        out.json({ type, id, deleted: true });
      } else {
        succeedCommand(spinner,`Deleted ${type} ${chalk.dim(id)}`);
      }
    } catch (err) {
      failCommand(spinner, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai resources query ──────────────────────────────────────────────────

resourcesCommand
  .command('query')
  .description('Cross-type query')
  .option('--tenant-id <id>', 'Run the read-only query against a specific tenant')
  .requiredOption('--types <types>', 'Comma-separated object type names')
  .option('--where <json>', 'Filter conditions as JSON')
  .option('--limit <n>', 'Max results', '20')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });

    options.format = normalizeFormat(options);

    const objectTypes = options.types.split(',').map((t: string) => t.trim());
    const where = options.where ? JSON.parse(options.where) : undefined;

    const spinner = makeSpinner(options.format, `Querying ${objectTypes.join(', ')}...`);
    try {
      const res = await ctx.client.queryResources({
        object_types: objectTypes,
        where,
        limit: parseInt(options.limit),
      });

      if (!res.ok) {
        failCommand(spinner, `${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const data = await res.json();

      if (options.format === 'json') {
        out.json(data);
      } else {
        succeedCommand(spinner,'Query complete');
      }
    } catch (err) {
      failCommand(spinner, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai resources storage ────────────────────────────────────────────────

const storageCommand = resourcesCommand
  .command('storage')
  .description('Storage provisioning status and diagnostics');

storageCommand
  .command('status')
  .description('Show storage routing and provisioning status')
  .option('--tenant-id <id>', 'Run against a specific tenant')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);

    const spinner = makeSpinner(options.format, 'Fetching storage status...');
    const res = await ctx.client.getResourceStorageStatus();
    if (!res.ok) {
      failCommand(spinner, await formatResponseError(res, 'resources.storage.status'));
      process.exit(1);
    }

    const payload = await res.json() as {
      tenantId?: string;
      objectTypes?: Array<{
        objectType: string;
        backend: string;
        isReady?: boolean;
        issues?: string[];
        warnings?: string[];
        capabilities?: StorageCapabilities;
      }>;
    };
    if (options.format === 'json') {
      out.json(payload);
      return;
    }

    succeedCommand(spinner, `Storage status for tenant ${payload.tenantId || ctx.tenantId}`);
    for (const item of payload.objectTypes || []) {
      const status = item.isReady ? chalk.green('ready') : chalk.yellow('not ready');
      out.info(`${chalk.cyan(item.objectType)} ${chalk.dim(item.backend)} ${status}`);
      for (const issue of item.issues || []) {
        out.warn(`  ${issue}`);
      }
      for (const warning of item.warnings || []) {
        out.warn(`  warning: ${warning}`);
      }
      renderSearchCapabilities(item.capabilities);
    }
  });

storageCommand
  .command('doctor')
  .description('Run storage diagnostics')
  .option('--tenant-id <id>', 'Run against a specific tenant')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);

    const spinner = makeSpinner(options.format, 'Running storage doctor...');
    const res = await ctx.client.getResourceStorageDoctor();
    if (!res.ok) {
      failCommand(spinner, await formatResponseError(res, 'resources.storage.doctor'));
      process.exit(1);
    }

    const payload = await res.json() as {
      healthy?: boolean;
      checks?: Array<{
        objectType: string;
        backend: string;
        healthy: boolean;
        issues?: string[];
        warnings?: string[];
        capabilities?: StorageCapabilities;
      }>;
      capabilities?: StorageCapabilities;
    };
    if (options.format === 'json') {
      out.json(payload);
      return;
    }

    if (payload.healthy) {
      succeedCommand(spinner, 'Storage doctor passed');
    } else {
      failCommand(spinner, 'Storage doctor found issues');
    }
    for (const check of payload.checks || []) {
      const state = check.healthy ? chalk.green('healthy') : chalk.red('unhealthy');
      out.info(`${chalk.cyan(check.objectType)} ${chalk.dim(check.backend)} ${state}`);
      for (const issue of check.issues || []) {
        out.warn(`  ${issue}`);
      }
      for (const warning of check.warnings || []) {
        out.warn(`  warning: ${warning}`);
      }
    }
    renderSearchCapabilities(payload.capabilities);
    if (!payload.healthy) {
      process.exit(1);
    }
  });

// ─── eai resources search <query> ─────────────────────────────────────────

resourcesCommand
  .command('search <query>')
  .description('Search tenant resource projections')
  .option('--tenant-id <id>', 'Run against a specific tenant')
  .option('--types <types>', 'Comma-separated object type names')
  .option('--mode <mode>', 'Search mode: fulltext|hybrid|vector', 'hybrid')
  .option('--hybrid', 'Use hybrid full-text + vector search', false)
  .option('--vector', 'Use vector-only search', false)
  .option('--fulltext', 'Use full-text-only search', false)
  .option('--limit <n>', 'Max results', '10')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (query, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);

    const mode = options.vector ? 'vector' : options.fulltext ? 'fulltext' : options.hybrid ? 'hybrid' : options.mode;
    const objectTypes = options.types
      ? String(options.types).split(',').map((item) => item.trim()).filter(Boolean)
      : undefined;
    const spinner = makeSpinner(options.format, 'Searching resources...');
    const res = await ctx.client.searchResources({
      query,
      objectTypes,
      mode,
      limit: parseInt(options.limit),
      includePayload: true,
    });

    if (!res.ok) {
      failCommand(spinner, await formatResponseError(res, 'resources.search'));
      process.exit(1);
    }

    const payload = await res.json() as {
      indexName?: string;
      results?: Array<{ id: string; objectType: string; score?: number; content?: string }>;
    };
    if (options.format === 'json') {
      out.json(payload);
      return;
    }

    succeedCommand(spinner, `${payload.results?.length || 0} result(s) from ${payload.indexName || 'search'}`);
    for (const hit of payload.results || []) {
      out.info(`${chalk.cyan(hit.id)} ${chalk.dim(hit.objectType)} score=${hit.score ?? 'n/a'}`);
      if (hit.content) {
        out.dim(`  ${String(hit.content).slice(0, 160)}`);
      }
    }
  });

// ─── eai resources file ───────────────────────────────────────────────────

const fileCommand = resourcesCommand
  .command('file')
  .description('Upload, download, and delete files attached to typed resource object properties')
  .addHelpText('after', `
Use this when the file belongs to an existing typed resource. Use "eai docs"
when the file is a document to process, classify, or index for AI/RAG.
`);

fileCommand
  .command('upload <type> <id> <property> <path>')
  .description('Upload a file to a resource file property')
  .option('--tenant-id <id>', 'Run against a specific tenant')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (type, id, property, filePath, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);

    const spinner = makeSpinner(options.format, `Uploading ${filePath}...`);
    const res = await ctx.client.uploadResourceFile(type, id, property, filePath);
    if (!res.ok) {
      failCommand(spinner, await formatResponseError(res));
      process.exit(1);
    }

    const payload = await res.json() as {
      filename?: string;
      blobRef?: string;
    };
    if (options.format === 'json') {
      out.json(payload);
      return;
    }

    succeedCommand(spinner, `Uploaded ${payload.filename || filePath} to ${type}.${property}`);
    if (payload.blobRef) {
      out.info(`Blob: ${chalk.dim(payload.blobRef)}`);
    }
  });

fileCommand
  .command('get <type> <id> <property>')
  .description('Download a resource file property')
  .option('--tenant-id <id>', 'Run against a specific tenant')
  .option('--output <path>', 'Write to a specific file path')
  .action(async (type, id, property, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });

    const spinner = makeSpinner('text', `Downloading ${type}.${property}...`);
    const res = await ctx.client.downloadResourceFile(type, id, property);
    if (!res.ok) {
      failCommand(spinner, await formatResponseError(res));
      process.exit(1);
    }

    const { writeFile } = await import('node:fs/promises');
    const contentDisposition = res.headers.get('content-disposition') || '';
    const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    const outputPath = options.output || filenameMatch?.[1] || `${id}-${property}`;
    await writeFile(outputPath, Buffer.from(await res.arrayBuffer()));
    succeedCommand(spinner, `Downloaded to ${outputPath}`);
  });

fileCommand
  .command('delete <type> <id> <property>')
  .description('Delete a resource file property')
  .option('--tenant-id <id>', 'Run against a specific tenant')
  .option('--force', 'Skip confirmation', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (type, id, property, options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);

    if (!options.force) {
      const inquirer = await import('inquirer');
      const { confirm } = await inquirer.default.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Delete file ${type}.${property} on ${id}?`,
        default: false,
      }]);
      if (!confirm) {
        out.info('Cancelled.');
        return;
      }
    }

    const spinner = makeSpinner(options.format, `Deleting ${type}.${property} file...`);
    const res = await ctx.client.deleteResourceFile(type, id, property);
    if (!res.ok) {
      failCommand(spinner, await formatResponseError(res));
      process.exit(1);
    }

    const payload = await res.json();
    if (options.format === 'json') {
      out.json(payload);
      return;
    }

    succeedCommand(spinner, `Deleted file on ${type}.${property}`);
  });

// ─── eai resources schema ─────────────────────────────────────────────────

resourcesCommand
  .command('schema')
  .description('Show published Object Types for tenant')
  .option('--tenant-id <id>', 'Run the read-only query against a specific tenant')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });

    options.format = normalizeFormat(options);

    const spinner = makeSpinner(options.format, 'Fetching schema...');
    try {
      const res = await ctx.client.getSchema();
      if (!res.ok) {
        failCommand(spinner, `${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const payload = await res.json() as unknown;
      const types = extractPublishedSchemaTypes(payload);

      if (options.format === 'json') {
        out.json({ objectTypes: types, count: types.length });
      } else {
        succeedCommand(spinner,`${types.length} published types`);
        for (const t of types) {
          const slug = t.slug ? chalk.dim(` (${t.slug})`) : '';
          out.info(`${chalk.cyan(t.name)}${slug} — ${t.properties.length} properties, ${t.linkTypes.length} links`);
        }
      }
    } catch (err) {
      failCommand(spinner, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

resourcesCommand
  .command('performance-status')
  .description('Show tenant-scoped ResourceAPI schema and performance readiness')
  .option('--tenant-id <id>', 'Run the read-only query against a specific tenant')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);
    const spinner = makeSpinner(options.format, 'Fetching ResourceAPI performance status...');
    try {
      const response = await ctx.client.getResourceStorageSchemaStatus();
      if (!response.ok) {
        failCommand(spinner, `${response.status} ${response.statusText}`);
        process.exit(1);
      }
      const payload = await response.json() as Record<string, unknown>;
      if (options.format === 'json') {
        out.json({
          ...payload,
          rawSqlAllowed: false,
          tenantAdminOperations: ['read_status', 'plan_index_change'],
          systemAdminOperations: ['apply_index_change', 'force_cache_refresh'],
        });
        return;
      }
      const state = typeof payload.state === 'string' ? payload.state : 'unknown';
      const count = typeof payload.objectTypeCount === 'number' ? payload.objectTypeCount : 0;
      succeedCommand(spinner, `ResourceAPI schema ${state} — ${count} Object Types visible`);
      out.info('Tenant-admin: read status and request an index plan.');
      out.info('Platform-admin only: apply index changes and force cache refresh.');
      out.info('Raw SQL: disabled.');
    } catch (err) {
      failCommand(spinner, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

resourcesCommand
  .command('indexes-plan')
  .description('Plan validated ResourceAPI storage/index changes without applying them')
  .option('--tenant-id <id>', 'Run against a specific tenant')
  .option('--object-type <slug...>', 'Limit the plan to published Object Type slugs')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);
    const spinner = makeSpinner(options.format, 'Planning ResourceAPI indexes...');
    const response = await ctx.client.planResourceIndexes(options.objectType);
    if (!response.ok) { failCommand(spinner, `${response.status} ${response.statusText}`); process.exit(1); }
    const payload = await response.json();
    if (options.format === 'json') { out.json(payload); return; }
    succeedCommand(spinner, 'ResourceAPI index plan ready (dry run; no changes applied).');
  });

resourcesCommand
  .command('indexes-apply')
  .description('Apply validated ResourceAPI storage/index changes')
  .option('--tenant-id <id>', 'Run against a specific tenant')
  .option('--object-type <slug...>', 'Limit the apply to published Object Type slugs')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--confirm', 'Confirm the tenant-scoped apply', false)
  .action(async (options) => {
    if (!options.confirm) { throw new Error('Pass --confirm to apply validated ResourceAPI index changes.'); }
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);
    const spinner = makeSpinner(options.format, 'Applying ResourceAPI indexes...');
    const response = await ctx.client.applyResourceIndexes(options.objectType);
    if (!response.ok) { failCommand(spinner, `${response.status} ${response.statusText}`); process.exit(1); }
    const payload = await response.json();
    if (options.format === 'json') { out.json(payload); return; }
    succeedCommand(spinner, 'ResourceAPI index apply completed.');
  });

resourcesCommand
  .command('cache-refresh')
  .description('Force a ResourceAPI cache refresh (system-admin operation)')
  .option('--tenant-id <id>', 'Run against a specific tenant')
  .option('--object-type <slug...>', 'Limit the refresh to Object Type slugs')
  .requiredOption('--reason <reason>', 'Audited reason or change ticket')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);
    const spinner = makeSpinner(options.format, 'Refreshing ResourceAPI cache...');
    const response = await ctx.client.refreshResourceCache(options.objectType, options.reason);
    if (!response.ok) { failCommand(spinner, `${response.status} ${response.statusText}`); process.exit(1); }
    const payload = await response.json();
    if (options.format === 'json') { out.json(payload); return; }
    succeedCommand(spinner, 'ResourceAPI cache refresh completed.');
  });

resourcesCommand
  .command('sync-schema')
  .description('Provision or reconcile storage resources from published Object Type metadata')
  .option('--tenant-id <id>', 'Run against a specific tenant')
  .option('--backend <backend>', 'Limit to a backend (postgresql|documentdb|blob|search)')
  .option('--dry-run', 'Show the reconcile plan without mutating storage', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);

    const spinner = makeSpinner(options.format, 'Syncing storage schema...');
    try {
      const res = await ctx.client.syncStorageSchema({
        backend: options.backend,
        dryRun: Boolean(options.dryRun),
      });
      if (!res.ok) {
        failCommand(spinner, `${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const payload = await res.json() as {
        tenantId: string;
        dryRun: boolean;
        results: Array<{ objectType: string; backend: string; status: string; actions?: string[] }>;
      };

      if (options.format === 'json') {
        out.json(payload);
      } else {
        succeedCommand(spinner, `${payload.results.length} storage binding${payload.results.length === 1 ? '' : 's'} processed`);
        for (const result of payload.results) {
          const actions = result.actions?.length ? chalk.dim(` — ${result.actions.join(', ')}`) : '';
          out.info(`${chalk.cyan(result.objectType)} [${result.backend}] ${result.status}${actions}`);
        }
      }
    } catch (err) {
      failCommand(spinner, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

resourcesCommand
  .command('doctor')
  .description('Inspect storage readiness for the active tenant')
  .option('--tenant-id <id>', 'Run against a specific tenant')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
    options.format = normalizeFormat(options);

    const spinner = makeSpinner(options.format, 'Checking storage readiness...');
    try {
      const res = await ctx.client.getStorageDoctor();
      if (!res.ok) {
        failCommand(spinner, `${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const payload = await res.json() as {
        tenantId: string;
        healthy: boolean;
        checks: Array<{ objectType: string; backend: string; healthy: boolean; issues?: string[] }>;
      };

      if (options.format === 'json') {
        out.json(payload);
      } else {
        succeedCommand(spinner, payload.healthy ? 'Storage is healthy' : 'Storage requires attention');
        for (const check of payload.checks) {
          const status = check.healthy ? chalk.green('healthy') : chalk.yellow('needs-attention');
          const issues = check.issues?.length ? chalk.dim(` — ${check.issues.join('; ')}`) : '';
          out.info(`${chalk.cyan(check.objectType)} [${check.backend}] ${status}${issues}`);
        }
      }
    } catch (err) {
      failCommand(spinner, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
