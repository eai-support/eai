/**
 * eai tenant — manage tenants on the platform.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot } from '../lib/config.js';
import {
  PlatformAPIClient,
  parseApiError,
  type ChildTenantBootstrapResult,
  type ParsedApiError,
} from '../lib/api.js';
import { loadTokens } from '../lib/auth.js';
import {
  fetchTenantAdminMemberships,
  filterTenantAdminEntries,
  getTenantRoles,
  normalizeTenantEntries,
  refreshTenantUsabilityStatus,
  resolveActiveTenantContext,
  resolvePublicApiUrl,
  type TenantEntry,
  type TenantUsabilityStatus,
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

export interface TenantCreateOutcome {
  tenant: Record<string, unknown>;
  bootstrap?: ChildTenantBootstrapResult;
  bootstrapError?: ParsedApiError;
  usability: TenantUsabilityStatus;
}

export function extractCreatedTenantRecord(payload: Record<string, unknown>): Record<string, unknown> {
  const nestedDoc = payload.doc;
  if (nestedDoc && typeof nestedDoc === 'object' && !Array.isArray(nestedDoc)) {
    return nestedDoc as Record<string, unknown>;
  }

  return payload;
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

export function buildTenantCreateStatusMessages(outcome: TenantCreateOutcome): string[] {
  const messages: string[] = [];

  if (outcome.bootstrap) {
    if (outcome.bootstrap.status === 'bootstrapped') {
      messages.push('Bootstrap: first tenant admin was provisioned for the current login.');
    } else if (outcome.bootstrap.status === 'already-usable') {
      messages.push('Bootstrap: the current login already had direct tenant-admin on the child tenant.');
    }
  } else if (outcome.bootstrapError) {
    const prefix = outcome.bootstrapError.code ? `${outcome.bootstrapError.code}: ` : '';
    messages.push(`Bootstrap not confirmed: ${prefix}${outcome.bootstrapError.message}`);
  }

  if (outcome.usability.usable) {
    messages.push(
      outcome.usability.autoSelected
        ? 'Usable: direct tenant-admin confirmed and the new tenant was selected.'
        : 'Usable: direct tenant-admin confirmed.',
    );
  } else {
    messages.push('Usable: not yet confirmed. The tenant exists, but direct tenant-admin membership is not visible yet.');
  }

  return messages;
}

export const tenantCommand = new Command('tenant')
  .description('Manage tenants on the platform');

const tenantStorageCommand = new Command('storage')
  .description('Inspect tenant storage configuration');

tenantStorageCommand
  .command('list')
  .description('List published storage bindings and operational connections for the active tenant')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .action(async (options) => {
    const root = await findProjectRoot();
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);
    const context = await resolveActiveTenantContext({
      projectRoot: root || undefined,
      publicApiUrl,
      interactive: true,
    });

    const client = new PlatformAPIClient(publicApiUrl, context.activeTenant.id);
    const response = await client.getStorageStatus();
    if (!response.ok) {
      out.error(`Failed to fetch storage status: ${response.status} ${response.statusText}`);
      process.exit(1);
    }

    const payload = await response.json() as {
      objectTypes: Array<{ objectType: string; backend: string; metadataStatus: string; routeSource: string; isReady: boolean }>;
      connections: Array<{ storage_backend: string; endpoint?: string; database_name?: string; container_name?: string; index_name?: string }>;
    };

    if (options.format === 'json') {
      out.json(payload);
      return;
    }

    out.success(`${payload.objectTypes.length} object type${payload.objectTypes.length === 1 ? '' : 's'} with storage metadata`);
    for (const item of payload.objectTypes) {
      const readiness = item.isReady ? chalk.green('ready') : chalk.yellow('pending');
      out.info(`${chalk.cyan(item.objectType)} [${item.backend}] ${readiness} ${chalk.dim(`(${item.routeSource})`)}`);
    }

    if (payload.connections.length > 0) {
      out.blank();
      out.info(chalk.bold('Operational connections'));
      for (const connection of payload.connections) {
        const target = connection.index_name || connection.container_name || connection.database_name || connection.endpoint || 'configured';
        out.info(`${chalk.cyan(connection.storage_backend)} — ${chalk.dim(target)}`);
      }
    }
  });

tenantStorageCommand
  .command('verify')
  .description('Check tenant storage readiness across published Object Types')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .action(async (options) => {
    const root = await findProjectRoot();
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);
    const context = await resolveActiveTenantContext({
      projectRoot: root || undefined,
      publicApiUrl,
      interactive: true,
    });

    const client = new PlatformAPIClient(publicApiUrl, context.activeTenant.id);
    const response = await client.getStorageDoctor();
    if (!response.ok) {
      out.error(`Storage verification failed: ${response.status} ${response.statusText}`);
      process.exit(1);
    }

    const payload = await response.json() as {
      healthy: boolean;
      checks: Array<{ objectType: string; backend: string; healthy: boolean; issues?: string[] }>;
    };

    if (options.format === 'json') {
      out.json(payload);
      return;
    }

    out[payload.healthy ? 'success' : 'warn'](
      payload.healthy ? 'Tenant storage is healthy.' : 'Tenant storage needs attention.',
    );
    for (const check of payload.checks) {
      const status = check.healthy ? chalk.green('healthy') : chalk.yellow('needs-attention');
      const issues = check.issues?.length ? chalk.dim(` — ${check.issues.join('; ')}`) : '';
      out.info(`${chalk.cyan(check.objectType)} [${check.backend}] ${status}${issues}`);
    }
  });

tenantCommand.addCommand(tenantStorageCommand);

// ─── eai tenant list ──────────────────────────────────────────────────────

tenantCommand
  .command('list')
  .description('List tenants where the current user is a tenant-admin (default) or all roles with --all')
  .option('--parent <id>', 'Parent tenant ID')
  .option('--all', 'Include tenants where the user holds non-admin roles (e.g. tenant-viewer)', false)
  .option('--debug', 'Show debug diagnostics for tenant lookup', false)
  .option('--raw-user', 'Print raw membership payload in debug mode', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai tenant list
  $ eai tenant list --all              # include tenant-viewer / tenant-builder memberships
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
      const tenants = options.all
        ? tenantEntries.filter((entry) => entry.tenant?.isActive !== false)
        : filterTenantAdminEntries(tenantEntries);
      debug(
        options.all
          ? 'Tenant entries (all roles, active only)'
          : 'Tenant entries after tenant-admin filtering',
        tenants.length,
      );

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

      const countLabel = options.all
        ? `${filtered.length} membership${filtered.length !== 1 ? 's' : ''}`
        : `${filtered.length} tenant-admin membership${filtered.length !== 1 ? 's' : ''}`;
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
    const spinner = options.format === 'json' ? null : ora('Fetching tenant...').start();

    try {
      const memberships = await fetchTenantAdminMemberships(publicApiUrl);
      const tenant = memberships.memberships.find((entry) => (
        entry.id === id || entry.slug === id
      ));

      if (!tenant) {
        if (spinner) spinner.fail('404 Not Found');
        process.exit(1);
      }

      if (options.format === 'json') {
        out.json(tenant);
      } else {
        spinner!.succeed(`Tenant: ${chalk.cyan(tenant.displayName)}`);
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
    const spinner = options.format === 'json' ? null : ora(`Creating tenant "${options.name}"...`).start();

    try {
      const context = await resolveActiveTenantContext({
        projectRoot: root || undefined,
        publicApiUrl,
        interactive: true,
      });
      const client = new PlatformAPIClient(publicApiUrl, context.activeTenant.id);

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
      const createdTenant = extractCreatedTenantRecord(tenant);
      const tenantId = String(createdTenant.id || '');
      let bootstrap: ChildTenantBootstrapResult | undefined;
      let bootstrapError: ParsedApiError | undefined;
      let bootstrapped = false;
      const refreshStatus = async (bootstrappedFlag: boolean): Promise<{ status: TenantUsabilityStatus }> => {
        if (!tenantId) {
          return {
            status: {
              tenantId,
              created: true,
              bootstrapped: bootstrappedFlag,
              membershipConfirmed: false,
              adminConfirmed: false,
              usable: false,
              autoSelected: false,
            },
          };
        }

        try {
          return await refreshTenantUsabilityStatus(tenantId, {
            publicApiUrl,
            created: true,
            bootstrapped: bootstrappedFlag,
            autoSelect: Boolean(options.parent),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          bootstrapError ??= {
            status: 0,
            code: 'MEMBERSHIP_REFRESH_FAILED',
            message,
          };
          return {
            status: {
              tenantId,
              created: true,
              bootstrapped: bootstrappedFlag,
              membershipConfirmed: false,
              adminConfirmed: false,
              usable: false,
              autoSelected: false,
            },
          };
        }
      };

      let refreshed = await refreshStatus(bootstrapped);

      if (options.parent && tenantId && !refreshed.status.usable) {
        const tokens = await loadTokens();
        if (tokens?.oid) {
          const bootstrapResponse = await client.bootstrapChildTenantAdmin(options.parent, tenantId, {
            userOid: tokens.oid,
            userEmail: tokens.upn,
          });

          if (bootstrapResponse.ok) {
            bootstrap = await bootstrapResponse.json() as ChildTenantBootstrapResult;
            bootstrapped = bootstrap.status === 'bootstrapped' || bootstrap.status === 'already-usable';
          } else {
            bootstrapError = await parseApiError(bootstrapResponse);
          }
        } else {
          bootstrapError = {
            status: 0,
            code: 'OID_MISSING',
            message: 'The current login is missing an oid claim, so child bootstrap was not attempted.',
          };
        }

        refreshed = await refreshStatus(bootstrapped);
      }

      const outcome: TenantCreateOutcome = {
        tenant,
        bootstrap,
        bootstrapError,
        usability: refreshed.status,
      };

      if (options.format === 'json') {
        out.json({
          tenant,
          bootstrap: bootstrap || null,
          bootstrapError: bootstrapError || null,
          usability: outcome.usability,
        });
      } else {
        spinner!.succeed(
          `Created tenant ${chalk.cyan(String(createdTenant.slug || options.slug))} (${chalk.dim(String(createdTenant.id || tenantId))})`,
        );
        for (const message of buildTenantCreateStatusMessages(outcome)) {
          if (message.startsWith('Usable: not yet confirmed') || message.startsWith('Bootstrap not confirmed')) {
            out.warn(message);
          } else if (message.startsWith('Usable:')) {
            out.success(message);
          } else {
            out.info(message);
          }
        }
      }
    } catch (err) {
      if (spinner) spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
