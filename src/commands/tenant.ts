/**
 * eai tenant — manage tenants on the platform.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot } from '../lib/config.js';
import { PlatformAPIClient } from '../lib/api.js';
import { loadTokens } from '../lib/auth.js';
import {
  fetchTenantAdminMemberships,
  filterTenantAdminEntries,
  getTenantRoles,
  normalizeTenantEntries,
  resolveActiveTenantContext,
  resolvePublicApiUrl,
  type TenantEntry,
} from '../lib/tenant-context.js';
import * as out from '../lib/output.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';

export { filterTenantAdminEntries, tenantEntryHasTenantAdminRole, type TenantEntry, type TenantRoleAssignment } from '../lib/tenant-context.js';

export function tenantMatchesParent(entry: TenantEntry, parentId: string): boolean {
  const parent = entry.tenant.parent;
  const resolvedParentId = typeof parent === 'string'
    ? parent
    : parent?.id ?? entry.tenant.parentId;
  return resolvedParentId === parentId || entry.tenant.id === parentId;
}

export interface TenantListZeroState {
  headline: string;
  tenantContext?: string;
  hint: string;
}

export function buildTenantListZeroState(tokens: {
  tenantName?: string;
  tenantId?: string;
}): TenantListZeroState {
  const zeroState: TenantListZeroState = {
    headline: 'No active tenant-admin memberships found for the current login.',
    hint: 'Use `eai whoami` to inspect the authenticated tenant context.',
  };

  if (tokens.tenantName || tokens.tenantId) {
    const tenantName = tokens.tenantName || 'current authenticated tenant';
    const tenantId = tokens.tenantId ? ` (${tokens.tenantId})` : '';
    zeroState.tenantContext = `Authenticated tenant context: ${tenantName}${tenantId}`;
  }

  return zeroState;
}

export const tenantCommand = new Command('tenant')
  .description('Manage tenants on the platform');

// ─── eai tenant list ──────────────────────────────────────────────────────

tenantCommand
  .command('list')
  .description('List active tenants where the current user is a tenant admin')
  .option('--parent <id>', 'Parent tenant ID')
  .option('--debug', 'Show debug diagnostics for tenant lookup', false)
  .option('--raw-user', 'Print raw membership payload in debug mode', false)
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
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);
    debug('Project root', root || '(none)');
    debug('Using Public API URL', publicApiUrl);

    const spinner = options.format === 'json' ? null : ora('Fetching tenants...').start();

    try {
      const membershipsResponse = await fetchTenantAdminMemberships(publicApiUrl);
      debug('Membership lookup status', 'ok');

      const payload = {
        tenants: membershipsResponse.memberships.map((membership) => ({
          tenant: {
            id: membership.id,
            displayName: membership.displayName,
            slug: membership.slug,
            domain: membership.domain,
            isActive: membership.isActive,
          },
          roles: membership.roles,
        })),
      } satisfies { tenants: TenantEntry[] };

      if (debugEnabled && options.rawUser) {
        debug('Raw membership payload', payload);
      }

      const tenantEntries = normalizeTenantEntries(payload);
      debug('Tenant entries before filtering', tenantEntries.length);
      const tenants = filterTenantAdminEntries(tenantEntries);
      debug('Tenant entries after tenant-admin filtering', tenants.length);

      // Filter by parent if requested
      const filtered = options.parent
        ? tenants.filter(t => tenantMatchesParent(t, options.parent))
        : tenants;
      debug('Tenant entries after filtering', filtered.length);

      if (options.format === 'json') {
        out.json({
          tenants: filtered.map((t) => ({
            ...t.tenant,
            roles: getTenantRoles(t),
            active: tokens.activeTenantId === t.tenant.id,
          })),
          count: filtered.length,
        });
        return;
      }

      const countLabel = `${filtered.length} tenant-admin membership${filtered.length !== 1 ? 's' : ''}`;
      spinner!.succeed(countLabel);

      if (filtered.length === 0) {
        const zeroState = buildTenantListZeroState(tokens);
        out.info(zeroState.headline);
        if (zeroState.tenantContext) {
          out.info(`Authenticated tenant context: ${chalk.cyan(tokens.tenantName || 'current authenticated tenant')}${tokens.tenantId ? chalk.dim(` (${tokens.tenantId})`) : ''}`);
        }
        out.info(`Use ${chalk.cyan('eai whoami')} to inspect the authenticated tenant context.`);
        return;
      }

      for (const entry of filtered) {
        const { tenant } = entry;
        const roleNames = getTenantRoles(entry);
        const roles = roleNames.length ? chalk.dim(` [${roleNames.join(', ')}]`) : '';
        const domain = tenant.domain ? chalk.dim(` (${tenant.domain})`) : '';
        const active = tokens.activeTenantId === tenant.id ? chalk.green(' (active)') : '';
        out.info(`${chalk.cyan(tenant.slug)} — ${tenant.displayName}${domain}${roles}${active}`);
      }
    } catch (err) {
      if (spinner) spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai tenant select ───────────────────────────────────────────────────

tenantCommand
  .command('select [tenant]')
  .description('Select the active tenant to work with')
  .action(async (tenant) => {
    const root = await findProjectRoot();
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);

    try {
      const context = await resolveActiveTenantContext({
        projectRoot: root || undefined,
        publicApiUrl,
        interactive: true,
        forcePrompt: !tenant,
        tenantId: tenant,
      });

      out.success(`Active tenant set to ${chalk.cyan(context.activeTenant.slug)} (${chalk.dim(context.activeTenant.id)})`);
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
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
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);

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
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);

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
