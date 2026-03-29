/**
 * eai tenant — manage tenants on the platform.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile } from '../lib/config.js';
import { PlatformAPIClient } from '../lib/api.js';
import { loadTokens } from '../lib/auth.js';
import * as out from '../lib/output.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';

const DEFAULT_API_URL = 'https://dev-api.myenterprise.ai/public';

function resolveApiUrl(env: Record<string, string | undefined>): string {
  return env.BASE_URL_PUBLIC_API || DEFAULT_API_URL;
}

export const tenantCommand = new Command('tenant')
  .description('Manage tenants on the platform');

// ─── eai tenant list ──────────────────────────────────────────────────────

tenantCommand
  .command('list')
  .description('List tenants (scoped to parent)')
  .option('--parent <id>', 'Parent tenant ID')
  .option('--debug', 'Show debug diagnostics for tenant lookup', false)
  .option('--raw-user', 'Print raw current-user payload in debug mode', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai tenant list
  $ eai tenant list --debug
  $ eai tenant list --debug --raw-user
  $ eai tenant list --format json | jq '.tenants[] | .name'
  `)
  .action(async (options) => {
    if (options.json) options.format = 'json';
    const debugEnabled = Boolean(options.debug);
    const debug = (message: string, data?: unknown): void => {
      if (!debugEnabled) return;
      if (data === undefined) {
        console.error(`[debug] ${message}`);
        return;
      }
      const value = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      console.error(`[debug] ${message}: ${value}`);
    };

    const tokens = await loadTokens();
    if (!tokens?.oid) { exitWithError(ErrorCode.E101); return; }
    debug('Authenticated token loaded', {
      oid: tokens.oid,
      upn: tokens.upn,
      expiresAt: new Date(tokens.expiresAt).toISOString(),
    });

    const root = await findProjectRoot();
    const envVars = root ? await loadEnvFile(root) : {};
    const env = { ...envVars, ...process.env };
    const publicApiUrl = resolveApiUrl(env);
    debug('Project root', root || '(none)');
    debug('Using Public API URL', publicApiUrl);

    const client = new PlatformAPIClient(publicApiUrl, 'system');
    const spinner = options.format === 'json' ? null : ora('Fetching tenants...').start();

    try {
      const res = await client.getCurrentUser(tokens.oid);
      debug('Current user endpoint status', `${res.status} ${res.statusText}`);
      if (!res.ok) {
        if (spinner) spinner.fail(`${res.status} ${res.statusText}`);
        process.exit(1);
      }

      interface TenantEntry {
        tenant: { id: string; displayName: string; slug: string; domain?: string; isActive: boolean };
        roleAssignments: Array<{ baseRole: string; displayName: string }>;
      }
      interface UserTenantPayload {
        tenants?: TenantEntry[];
        user?: {
          id?: string;
          email?: string;
          username?: string;
          tenants?: TenantEntry[];
        };
      }
      const payload = await res.json() as UserTenantPayload;
      debug('Current user response keys', Object.keys(payload as Record<string, unknown>));
      if (payload.user) {
        debug('Current user summary', {
          id: payload.user.id,
          email: payload.user.email,
          username: payload.user.username,
        });
      }
      if (debugEnabled && options.rawUser) {
        debug('Raw current user payload', payload);
      }

      const tenantEntries = payload.tenants ?? payload.user?.tenants ?? [];
      debug('Tenant entries before filtering', tenantEntries.length);
      const tenants = tenantEntries.filter(t => t.tenant?.isActive !== false);

      // Filter by parent if requested
      const filtered = options.parent
        ? tenants.filter(t => t.tenant.id === options.parent)
        : tenants;
      debug('Tenant entries after filtering', filtered.length);

      if (options.format === 'json') {
        out.json({ tenants: filtered.map(t => ({ ...t.tenant, roles: t.roleAssignments.map(r => r.baseRole) })), count: filtered.length });
        return;
      }

      spinner!.succeed(`${filtered.length} tenant${filtered.length !== 1 ? 's' : ''}`);

      for (const entry of filtered) {
        const { tenant, roleAssignments } = entry;
        const roles = roleAssignments.length ? chalk.dim(` [${roleAssignments.map(r => r.baseRole).join(', ')}]`) : '';
        const domain = tenant.domain ? chalk.dim(` (${tenant.domain})`) : '';
        out.info(`${chalk.cyan(tenant.slug)} — ${tenant.displayName}${domain}${roles}`);
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
