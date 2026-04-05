/**
 * eai resources — CRUD operations on platform resources.
 */

import { Command } from 'commander';
import ora from 'ora';
import type { Ora } from 'ora';
import chalk from 'chalk';
import { findProjectRoot } from '../lib/config.js';
import { PlatformAPIClient } from '../lib/api.js';
import { resolveActiveTenantContext, resolvePublicApiUrl } from '../lib/tenant-context.js';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function toObjectTypeSlug(objectType: string): string {
  return objectType
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
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

async function createClient(options?: {
  tenantId?: string;
  interactive?: boolean;
}): Promise<{ client: PlatformAPIClient; tenantId: string }> {
  const root = await findProjectRoot();
  if (!root) {
    exitWithError(ErrorCode.E001);
  }

  const publicApiUrl = await resolvePublicApiUrl(root);
  const context = await resolveActiveTenantContext({
    projectRoot: root,
    publicApiUrl,
    interactive: options?.interactive ?? true,
    tenantId: options?.tenantId,
  });

  return {
    client: new PlatformAPIClient(context.publicApiUrl, context.activeTenant.id),
    tenantId: context.activeTenant.id,
  };
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
    const ctx = await createClient({ tenantId: options.tenantId, interactive: !options.tenantId });

    if (options.json) options.format = 'json';
    const spinner = options.format === 'json' ? null : ora(`Listing ${type}...`).start();
    try {
      const res = await ctx.client.listResources(type, {
        page: parseInt(options.page),
        limit: parseInt(options.limit),
        sort: options.sort,
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
      };

      if (options.format === 'json') {
        out.json({
          type,
          resources: data.docs,
          totalDocs: data.totalDocs,
          page: data.page,
          totalPages: data.totalPages
        });
        return;
      }

      spinner!.succeed(`${data.totalDocs} total — page ${data.page}/${data.totalPages}`);

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
    } catch (err) {
      failCommand(spinner, err instanceof Error ? err.message : String(err));
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
    const ctx = await createClient({ tenantId: options.tenantId, interactive: !options.tenantId });

    if (options.json) options.format = 'json';

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
    const ctx = await createClient({ tenantId: options.tenantId, interactive: !options.tenantId });

    if (options.json) options.format = 'json';

    let data: Record<string, unknown>;
    if (options.data) {
      data = JSON.parse(options.data);
    } else if (options.file) {
      const { readFile } = await import('node:fs/promises');
      data = JSON.parse(await readFile(options.file, 'utf-8'));
    } else {
      exitWithError(ErrorCode.E303, { field: '--data or --file' }, options.format);
    }

    const spinner = options.format === 'json' ? null : ora(`Creating ${type}...`).start();
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
        spinner!.succeed(`Created ${type} ${chalk.dim(created.id)}`);
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
    const ctx = await createClient({ tenantId: options.tenantId, interactive: !options.tenantId });

    if (options.json) options.format = 'json';

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

    const spinner = options.format === 'json' ? null : ora(`Updating ${type} ${id}...`).start();
    try {
      const res = await ctx.client.updateResource(type, id, data, version!);
      if (!res.ok) {
        failCommand(spinner, `${res.status} ${res.statusText}`);
        process.exit(1);
      }

      if (options.format === 'json') {
        out.json({ type, id, data, version });
      } else {
        spinner!.succeed(`Updated ${type} ${chalk.dim(id)}`);
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
    const ctx = await createClient({ tenantId: options.tenantId, interactive: !options.tenantId });

    if (options.json) options.format = 'json';

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

    const spinner = options.format === 'json' ? null : ora(`Deleting ${type} ${id}...`).start();
    try {
      const res = await ctx.client.deleteResource(type, id);
      if (!res.ok) {
        failCommand(spinner, `${res.status} ${res.statusText}`);
        process.exit(1);
      }

      if (options.format === 'json') {
        out.json({ type, id, deleted: true });
      } else {
        spinner!.succeed(`Deleted ${type} ${chalk.dim(id)}`);
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
    const ctx = await createClient({ tenantId: options.tenantId, interactive: !options.tenantId });

    if (options.json) options.format = 'json';

    const objectTypes = options.types.split(',').map((t: string) => t.trim());
    const where = options.where ? JSON.parse(options.where) : undefined;

    const spinner = options.format === 'json' ? null : ora(`Querying ${objectTypes.join(', ')}...`).start();
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
        spinner!.succeed('Query complete');
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
    const ctx = await createClient({ tenantId: options.tenantId, interactive: !options.tenantId });

    if (options.json) options.format = 'json';

    const spinner = options.format === 'json' ? null : ora('Fetching schema...').start();
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
        spinner!.succeed(`${types.length} published types`);
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
