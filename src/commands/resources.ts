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
    return payload.map(String);
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
  $ eai resources list User --tenant-id 50808ce0-f31b-4fd0-9861-74b83b8c112a
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
        out.error(`${res.status} ${res.statusText}`);
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
  $ eai resources create Project --tenant-id 50808ce0-f31b-4fd0-9861-74b83b8c112a --data '{"name":"Demo"}'
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

      const created = await res.json() as { id: string };

      if (options.format === 'json') {
        out.json({ type, id: created.id, data });
      } else {
        succeedCommand(spinner,`Created ${type} ${chalk.dim(created.id)}`);
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
        failCommand(spinner, `${res.status} ${res.statusText}`);
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
