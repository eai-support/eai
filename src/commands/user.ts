/**
 * eai user — manage users on the platform.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { PlatformAPIClient } from '../lib/api.js';
import { resolveCommandContext, normalizeFormat, makeSpinner } from '../lib/context.js';
import * as out from '../lib/output.js';

interface ListUsersEnvelope {
  users: Array<{
    id: string;
    email: string;
    displayName: string;
    role: string;
    createdAt: string;
  }>;
  count: number;
  page: number;
  totalPages: number;
}

interface DeleteUserEnvelope {
  message: string;
  user_oid: string;
  tenant_id: string;
  removed: boolean;
}

interface ErrorEnvelope {
  error?: string;
  message?: string;
}

async function readJson<T>(response: Response): Promise<T | ErrorEnvelope> {
  const text = await response.text();
  if (!text) return {} as ErrorEnvelope;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { message: text };
  }
}

export const userCommand = new Command('user')
  .description('Manage users on the platform');

// ─── eai user invite ──────────────────────────────────────────────────────

userCommand
  .command('invite')
  .description('Add an existing user to a tenant using the tenant-admin provisioning flow')
  .requiredOption('--email <email>', 'Email address of the user to add')
  .option('--tenant <id>', 'Tenant ID to add the user to (defaults to the active tenant)')
  .action(async (options) => {
    const ctx = await resolveCommandContext({ interactive: false });
    const tenantId = options.tenant || ctx.tenantId;

    // Use 'system' scope for admin user lookup
    const client = new PlatformAPIClient(ctx.publicApiUrl, 'system');

    // Step 1: Look up user by email
    const lookupSpinner = ora(`Looking up ${options.email}...`).start();

    let lookupResult: { id?: string; email?: string; user?: { id?: string; email?: string; username?: string } | null };
    try {
      const lookupRes = await client.lookupUserByEmail(options.email);
      if (!lookupRes.ok) {
        const body = await lookupRes.text();
        lookupSpinner.fail(`Lookup failed: ${lookupRes.status}: ${body}`);
        process.exit(1);
      }
      lookupResult = await lookupRes.json() as typeof lookupResult;
    } catch (err) {
      lookupSpinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const resolvedUser = lookupResult.user?.id
      ? lookupResult.user
      : lookupResult.id
        ? { id: lookupResult.id, email: lookupResult.email || options.email }
        : null;

    if (!resolvedUser) {
      lookupSpinner.fail(`User ${chalk.cyan(options.email)} not found.`);
      process.exit(1);
    }

    const user = resolvedUser;
    const userEmail = user.email || options.email;
    lookupSpinner.succeed(`Found user ${chalk.cyan(userEmail)} (${chalk.dim(user.id)})`);

    // Step 2: Provision user to tenant
    const provisionSpinner = ora(`Adding ${userEmail} to tenant ${tenantId}...`).start();

    try {
      const provisionRes = await client.provisionUserToTenant(tenantId, user.id);
      if (!provisionRes.ok) {
        const body = await provisionRes.text();
        provisionSpinner.fail(`Provisioning failed: ${provisionRes.status}: ${body}`);
        process.exit(1);
      }

      const result = await provisionRes.json() as { success?: boolean; message?: string };
      provisionSpinner.succeed(
        `Added ${chalk.cyan(userEmail)} to tenant ${chalk.dim(tenantId)}`,
      );

      if (result.message) {
        out.info(result.message);
      }
    } catch (err) {
      provisionSpinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai user list ────────────────────────────────────────────────────────────

userCommand
  .command('list')
  .description('List users in a tenant')
  .option('--tenant <id>', 'Tenant ID (defaults to the active tenant)')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .option('--limit <n>', 'Items per page', '50')
  .option('--page <n>', '1-indexed page number', '1')
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenant, interactive: !options.tenant });
    const format = normalizeFormat(options);
    const limit = Number.parseInt(options.limit, 10);
    const page = Number.parseInt(options.page, 10);
    if (!Number.isFinite(limit) || limit < 1) {
      out.error('--limit must be a positive integer.');
      process.exit(1);
    }
    if (!Number.isFinite(page) || page < 1) {
      out.error('--page must be a positive integer.');
      process.exit(1);
    }
    const offset = (page - 1) * limit;

    const spinner = makeSpinner(format, 'Listing users...');
    const res = await ctx.client.listUsers({ tenantId: ctx.tenantId, limit, offset });
    const payload = await readJson<ListUsersEnvelope>(res);

    if (!res.ok) {
      spinner?.fail('Failed to list users');
      const errBody = payload as ErrorEnvelope;
      out.error(errBody.message ?? `${res.status} ${res.statusText}`);
      process.exit(1);
    }

    const envelope = payload as ListUsersEnvelope;
    if (format === 'json') {
      out.json(envelope);
      return;
    }

    spinner?.succeed(`${envelope.count} user${envelope.count === 1 ? '' : 's'} (page ${envelope.page}/${envelope.totalPages})`);
    if (envelope.users.length === 0) {
      out.info('No users found.');
      return;
    }
    for (const u of envelope.users) {
      out.info(`${chalk.cyan(u.email)} · ${u.displayName} · ${chalk.dim(u.role)} · ${chalk.dim(u.id)}`);
    }
  });

// ─── eai user delete ──────────────────────────────────────────────────────────

userCommand
  .command('delete <userId>')
  .description('Remove a user from a tenant (admin only)')
  .option('--tenant <id>', 'Tenant ID (defaults to the active tenant)')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .option('--force', 'Skip the interactive confirmation prompt', false)
  .action(async (userId: string, options) => {
    const targetId = userId.trim();
    if (!targetId) {
      out.error('userId is required.');
      process.exit(1);
    }

    const ctx = await resolveCommandContext({ tenantId: options.tenant, interactive: !options.tenant });
    const format = normalizeFormat(options);

    const callerOid = ctx.tokens.oid;
    if (callerOid && callerOid === targetId) {
      out.error('Cannot delete yourself. Use the self-deprovision endpoint /v3/users/me/tenants/{tenant_id}.');
      process.exit(1);
    }

    if (!options.force && format !== 'json' && process.stdout.isTTY) {
      const readline = await import('node:readline/promises');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`Remove user ${targetId} from tenant ${ctx.tenantId}? (y/N) `);
      rl.close();
      if (!/^y(es)?$/i.test(answer.trim())) {
        out.info('Aborted.');
        return;
      }
    }

    const spinner = makeSpinner(format, `Removing ${targetId} from tenant ${ctx.tenantId}...`);
    const res = await ctx.client.deleteUserFromTenant(ctx.tenantId, targetId);
    const payload = await readJson<DeleteUserEnvelope>(res);

    if (!res.ok) {
      spinner?.fail('Delete failed');
      const errBody = payload as ErrorEnvelope;
      out.error(errBody.message ?? `${res.status} ${res.statusText}`);
      process.exit(1);
    }

    const envelope = payload as DeleteUserEnvelope;
    if (format === 'json') {
      out.json(envelope);
      return;
    }

    if (envelope.removed) {
      spinner?.succeed(`Removed ${chalk.cyan(targetId)} from tenant ${chalk.dim(ctx.tenantId)}`);
    } else {
      spinner?.succeed('User was not a member; nothing changed.');
    }
  });

// ─── eai user provision-me ────────────────────────────────────────────────────

userCommand
  .command('provision-me')
  .description('Provision yourself to a tenant (for first-time setup)')
  .option('--tenant <id>', 'Tenant ID to provision yourself to (defaults to the active tenant)')
  .action(async (options) => {
    const ctx = await resolveCommandContext({ interactive: false });
    const tenantId = options.tenant || ctx.tenantId;
    const client = new PlatformAPIClient(ctx.publicApiUrl, tenantId);

    const provisionSpinner = ora(`Provisioning you to tenant ${tenantId}...`).start();

    try {
      const provisionRes = await client.provisionMe();
      if (!provisionRes.ok) {
        const body = await provisionRes.text();
        provisionSpinner.fail(`Provisioning failed: ${provisionRes.status}: ${body}`);
        process.exit(1);
      }

      const result = await provisionRes.json() as { success?: boolean; message?: string; user?: unknown };
      provisionSpinner.succeed(
        `Successfully provisioned to tenant ${chalk.cyan(tenantId)}`,
      );

      if (result.message) {
        out.info(result.message);
      }
    } catch (err) {
      provisionSpinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
