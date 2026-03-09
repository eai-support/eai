/**
 * eai resources — CRUD operations on platform resources.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile } from '../lib/config.js';
import { PlatformAPIClient } from '../lib/api.js';
import * as out from '../lib/output.js';

function createClient(env: Record<string, string>): { client: PlatformAPIClient; tenantId: string } | null {
  const publicApiUrl = env.BASE_URL_PUBLIC_API;
  const tenantId = env.TENANT_DEFAULT_ID ||
    Object.keys(env).filter(k => k.startsWith('TENANT_') && k.endsWith('_ID')).map(k => env[k])[0];

  if (!publicApiUrl || !tenantId) return null;
  return { client: new PlatformAPIClient(publicApiUrl, tenantId), tenantId };
}

async function getEnv(): Promise<Record<string, string>> {
  const root = await findProjectRoot();
  if (!root) {
    out.error('Not in an EAI project.');
    process.exit(1);
  }
  const envVars = await loadEnvFile(root);
  return { ...envVars, ...process.env } as Record<string, string>;
}

export const resourcesCommand = new Command('resources')
  .description('CRUD operations on platform resources');

// ─── eai resources list <type> ─────────────────────────────────────────────

resourcesCommand
  .command('list <type>')
  .description('List resources of a given type')
  .option('--page <n>', 'Page number', '1')
  .option('--limit <n>', 'Items per page', '20')
  .option('--sort <field>', 'Sort field (prefix with - for descending)', '-created_at')
  .option('--json', 'Output raw JSON', false)
  .action(async (type, options) => {
    const env = await getEnv();
    const ctx = createClient(env);
    if (!ctx) { out.error('Missing BASE_URL_PUBLIC_API or tenant ID.'); process.exit(1); }

    const spinner = ora(`Listing ${type}...`).start();
    try {
      const res = await ctx.client.listResources(type, {
        page: parseInt(options.page),
        limit: parseInt(options.limit),
        sort: options.sort,
      });

      if (!res.ok) {
        spinner.fail(`Failed: ${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const data = await res.json() as {
        docs: Array<{ id: string; data: Record<string, unknown>; created_at: string; version: number }>;
        totalDocs: number;
        page: number;
        totalPages: number;
      };

      spinner.succeed(`${data.totalDocs} total — page ${data.page}/${data.totalPages}`);

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (data.docs.length === 0) {
        out.info('No resources found.');
        return;
      }

      for (const doc of data.docs) {
        const preview = Object.entries(doc.data)
          .slice(0, 3)
          .map(([k, v]) => `${k}=${chalk.dim(String(v).slice(0, 30))}`)
          .join(', ');
        console.log(`  ${chalk.dim(doc.id.slice(0, 8))} ${preview}`);
      }
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai resources get <type> <id> ────────────────────────────────────────

resourcesCommand
  .command('get <type> <id>')
  .description('Get a single resource')
  .option('--json', 'Output raw JSON', false)
  .action(async (type, id, options) => {
    const env = await getEnv();
    const ctx = createClient(env);
    if (!ctx) { out.error('Missing config.'); process.exit(1); }

    try {
      const res = await ctx.client.getResource(type, id);
      if (!res.ok) {
        out.error(`${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const data = await res.json();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(JSON.stringify(data, null, 2));
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
  .option('--data <json>', 'Resource data as JSON string')
  .option('--file <path>', 'Read data from JSON file')
  .action(async (type, options) => {
    const env = await getEnv();
    const ctx = createClient(env);
    if (!ctx) { out.error('Missing config.'); process.exit(1); }

    let data: Record<string, unknown>;
    if (options.data) {
      data = JSON.parse(options.data);
    } else if (options.file) {
      const { readFile } = await import('node:fs/promises');
      data = JSON.parse(await readFile(options.file, 'utf-8'));
    } else {
      out.error('Provide --data or --file');
      process.exit(1);
    }

    const spinner = ora(`Creating ${type}...`).start();
    try {
      const res = await ctx.client.createResource(type, data);
      if (!res.ok) {
        spinner.fail(`${res.status} ${res.statusText}`);
        const body = await res.text();
        out.error(body);
        process.exit(1);
      }

      const created = await res.json() as { id: string };
      spinner.succeed(`Created ${type} ${chalk.dim(created.id)}`);
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai resources update <type> <id> ────────────────────────────────────

resourcesCommand
  .command('update <type> <id>')
  .description('Update a resource')
  .option('--data <json>', 'Updated data as JSON string')
  .option('--version <n>', 'Resource version (for optimistic locking)')
  .action(async (type, id, options) => {
    const env = await getEnv();
    const ctx = createClient(env);
    if (!ctx) { out.error('Missing config.'); process.exit(1); }

    if (!options.data) {
      out.error('Provide --data with the updated fields');
      process.exit(1);
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
        out.error('Could not fetch current version. Use --version explicitly.');
        process.exit(1);
      }
    }

    const spinner = ora(`Updating ${type} ${id}...`).start();
    try {
      const res = await ctx.client.updateResource(type, id, data, version!);
      if (!res.ok) {
        spinner.fail(`${res.status} ${res.statusText}`);
        process.exit(1);
      }
      spinner.succeed(`Updated ${type} ${chalk.dim(id)}`);
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai resources delete <type> <id> ────────────────────────────────────

resourcesCommand
  .command('delete <type> <id>')
  .description('Delete a resource')
  .option('--force', 'Skip confirmation', false)
  .action(async (type, id, options) => {
    const env = await getEnv();
    const ctx = createClient(env);
    if (!ctx) { out.error('Missing config.'); process.exit(1); }

    if (!options.force) {
      const inquirer = await import('inquirer');
      const { confirm } = await inquirer.default.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Delete ${type} ${id}?`,
        default: false,
      }]);
      if (!confirm) {
        out.info('Cancelled.');
        return;
      }
    }

    const spinner = ora(`Deleting ${type} ${id}...`).start();
    try {
      const res = await ctx.client.deleteResource(type, id);
      if (!res.ok) {
        spinner.fail(`${res.status} ${res.statusText}`);
        process.exit(1);
      }
      spinner.succeed(`Deleted ${type} ${chalk.dim(id)}`);
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai resources query ──────────────────────────────────────────────────

resourcesCommand
  .command('query')
  .description('Cross-type query')
  .requiredOption('--types <types>', 'Comma-separated object type names')
  .option('--where <json>', 'Filter conditions as JSON')
  .option('--limit <n>', 'Max results', '20')
  .option('--json', 'Output raw JSON', false)
  .action(async (options) => {
    const env = await getEnv();
    const ctx = createClient(env);
    if (!ctx) { out.error('Missing config.'); process.exit(1); }

    const objectTypes = options.types.split(',').map((t: string) => t.trim());
    const where = options.where ? JSON.parse(options.where) : undefined;

    const spinner = ora(`Querying ${objectTypes.join(', ')}...`).start();
    try {
      const res = await ctx.client.queryResources({
        object_types: objectTypes,
        where,
        limit: parseInt(options.limit),
      });

      if (!res.ok) {
        spinner.fail(`${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const data = await res.json();
      spinner.succeed('Query complete');
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai resources schema ─────────────────────────────────────────────────

resourcesCommand
  .command('schema')
  .description('Show published Object Types for tenant')
  .action(async () => {
    const env = await getEnv();
    const ctx = createClient(env);
    if (!ctx) { out.error('Missing config.'); process.exit(1); }

    const spinner = ora('Fetching schema...').start();
    try {
      const res = await ctx.client.getSchema();
      if (!res.ok) {
        spinner.fail(`${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const schema = await res.json() as { objectTypes?: Array<{ name: string; properties: unknown[]; linkTypes: unknown[]; actions: unknown[] }> };
      const types = schema?.objectTypes || [];
      spinner.succeed(`${types.length} published types`);

      for (const t of types) {
        console.log(`  ${chalk.cyan(t.name)} — ${t.properties?.length || 0} props, ${t.linkTypes?.length || 0} links, ${t.actions?.length || 0} actions`);
      }
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
