/**
 * eai tenant — manage tenants on the platform.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile } from '../lib/config.js';
import { PlatformAPIClient } from '../lib/api.js';
import * as out from '../lib/output.js';

export const tenantCommand = new Command('tenant')
  .description('Manage tenants on the platform');

// ─── eai tenant list ──────────────────────────────────────────────────────

tenantCommand
  .command('list')
  .description('List tenants (scoped to parent)')
  .option('--parent <id>', 'Parent tenant ID')
  .option('--json', 'Output raw JSON', false)
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) { out.error('Not in an EAI project.'); process.exit(1); }

    const envVars = await loadEnvFile(root);
    const env = { ...envVars, ...process.env };
    const publicApiUrl = env.BASE_URL_PUBLIC_API;
    if (!publicApiUrl) { out.error('BASE_URL_PUBLIC_API not set.'); process.exit(1); }

    const client = new PlatformAPIClient(publicApiUrl, 'system');
    const spinner = ora('Fetching tenants...').start();

    try {
      const res = await client.listTenants(options.parent);
      if (!res.ok) {
        spinner.fail(`${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const data = await res.json() as { docs: Array<{ id: string; name: string; slug: string; domain?: string[] }> };
      spinner.succeed(`${data.docs.length} tenants`);

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      for (const tenant of data.docs) {
        console.log(`  ${chalk.cyan(tenant.slug || tenant.name)} ${chalk.dim(tenant.id)}`);
        if (tenant.domain?.length) {
          console.log(`    domains: ${tenant.domain.join(', ')}`);
        }
      }
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai tenant info <id> ─────────────────────────────────────────────────

tenantCommand
  .command('info <id>')
  .description('Show tenant details')
  .action(async (id) => {
    const root = await findProjectRoot();
    if (!root) { out.error('Not in an EAI project.'); process.exit(1); }

    const envVars = await loadEnvFile(root);
    const env = { ...envVars, ...process.env };
    const publicApiUrl = env.BASE_URL_PUBLIC_API;
    if (!publicApiUrl) { out.error('BASE_URL_PUBLIC_API not set.'); process.exit(1); }

    const client = new PlatformAPIClient(publicApiUrl, 'system');
    const spinner = ora('Fetching tenant...').start();

    try {
      const res = await client.getTenant(id);
      if (!res.ok) {
        spinner.fail(`${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const tenant = await res.json() as Record<string, unknown>;
      spinner.succeed(`Tenant: ${chalk.cyan(String(tenant.name))}`);
      console.log(JSON.stringify(tenant, null, 2));
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
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
  .option('--json', 'Output raw JSON', false)
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) { out.error('Not in an EAI project.'); process.exit(1); }

    const envVars = await loadEnvFile(root);
    const env = { ...envVars, ...process.env };
    const publicApiUrl = env.BASE_URL_PUBLIC_API;
    if (!publicApiUrl) { out.error('BASE_URL_PUBLIC_API not set.'); process.exit(1); }

    const client = new PlatformAPIClient(publicApiUrl, 'system');
    const spinner = ora(`Creating tenant "${options.name}"...`).start();

    try {
      const res = await client.createTenant({
        name: options.name,
        slug: options.slug,
        parent: options.parent,
        domain: options.domain?.split(',').map((d: string) => d.trim()),
      });

      if (!res.ok) {
        const body = await res.text();
        spinner.fail(`${res.status}: ${body}`);
        process.exit(1);
      }

      const tenant = await res.json() as Record<string, unknown>;
      spinner.succeed(`Created tenant ${chalk.cyan(String(tenant.slug))} (${chalk.dim(String(tenant.id))})`);

      if (options.json) {
        console.log(JSON.stringify(tenant, null, 2));
      }
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
