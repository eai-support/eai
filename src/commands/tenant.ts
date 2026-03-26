/**
 * eai tenant — manage tenants on the platform.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile } from '../lib/config.js';

const DEFAULT_API_URL = 'https://dev-api.myenterprise.ai/public';

function resolveApiUrl(env: Record<string, string | undefined>): string {
  return env.BASE_URL_PUBLIC_API || DEFAULT_API_URL;
}
import { PlatformAPIClient } from '../lib/api.js';
import * as out from '../lib/output.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';

export const tenantCommand = new Command('tenant')
  .description('Manage tenants on the platform');

// ─── eai tenant list ──────────────────────────────────────────────────────

tenantCommand
  .command('list')
  .description('List tenants (scoped to parent)')
  .option('--parent <id>', 'Parent tenant ID')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai tenant list
  $ eai tenant list --format json | jq '.tenants[] | .name'
  `)
  .action(async (options) => {
    if (options.json) options.format = 'json';

    const root = await findProjectRoot();
    const envVars = root ? await loadEnvFile(root) : {};
    const env = { ...envVars, ...process.env };
    const publicApiUrl = resolveApiUrl(env);

    const client = new PlatformAPIClient(publicApiUrl, 'system');
    const spinner = options.format === 'json' ? null : ora('Fetching tenants...').start();

    try {
      const res = await client.listTenants(options.parent);
      if (!res.ok) {
        if (spinner) spinner.fail(`${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const data = await res.json() as { docs: Array<{ id: string; name: string; slug: string; domain?: string[] }> };

      if (options.format === 'json') {
        out.json({ tenants: data.docs, count: data.docs.length });
        return;
      }

      spinner!.succeed(`${data.docs.length} tenants`);

      for (const tenant of data.docs) {
        const domains = tenant.domain?.length ? chalk.dim(` [${tenant.domain.join(', ')}]`) : '';
        out.info(`${chalk.cyan(tenant.slug)} — ${tenant.name}${domains}`);
      }
    } catch (err) {
      if (spinner) spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai tenant info <id> ─────────────────────────────────────────────────

tenantCommand
  .command('info <id>')
  .description('Show tenant details')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (id, options) => {
    if (options.json) options.format = 'json';

    const root = await findProjectRoot();
    const envVars = root ? await loadEnvFile(root) : {};
    const env = { ...envVars, ...process.env };
    const publicApiUrl = resolveApiUrl(env);

    const client = new PlatformAPIClient(publicApiUrl, 'system');
    const spinner = options.format === 'json' ? null : ora('Fetching tenant...').start();

    try {
      const res = await client.getTenant(id);
      if (!res.ok) {
        if (spinner) spinner.fail(`${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const tenant = await res.json() as Record<string, unknown>;

      if (options.format === 'json') {
        out.json(tenant);
      } else {
        spinner!.succeed(`Tenant: ${chalk.cyan(String(tenant.name))}`);
      }
    } catch (err) {
      if (spinner) spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai tenant create ───────────────────────────────────────────────────

tenantCommand
  .command('create')
  .description('Create a new tenant')
  .requiredOption('--name <name>', 'Tenant name')
  .requiredOption('--slug <slug>', 'Tenant slug (kebab-case)')
  .option('--parent <id>', 'Parent tenant ID')
  .option('--domain <domains>', 'Comma-separated domain list')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (options) => {
    if (options.json) options.format = 'json';

    const root = await findProjectRoot();
    const envVars = root ? await loadEnvFile(root) : {};
    const env = { ...envVars, ...process.env };
    const publicApiUrl = resolveApiUrl(env);

    const client = new PlatformAPIClient(publicApiUrl, 'system');
    const spinner = options.format === 'json' ? null : ora(`Creating tenant "${options.name}"...`).start();

    try {
      const res = await client.createTenant({
        name: options.name,
        slug: options.slug,
        parent: options.parent,
        domain: options.domain?.split(',').map((d: string) => d.trim()),
      });

      if (!res.ok) {
        const body = await res.text();
        if (spinner) spinner.fail(`${res.status}: ${body}`);
        process.exit(1);
      }

      const tenant = await res.json() as Record<string, unknown>;

      if (options.format === 'json') {
        out.json(tenant);
      } else {
        spinner!.succeed(`Created tenant ${chalk.cyan(String(tenant.slug))} (${chalk.dim(String(tenant.id))})`);
      }
    } catch (err) {
      if (spinner) spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
