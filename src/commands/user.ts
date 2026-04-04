/**
 * eai user — manage users on the platform.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot } from '../lib/config.js';
import { PlatformAPIClient } from '../lib/api.js';
import { resolveActiveTenantContext, resolvePublicApiUrl } from '../lib/tenant-context.js';
import * as out from '../lib/output.js';

export const userCommand = new Command('user')
  .description('Manage users on the platform');

// ─── eai user invite ──────────────────────────────────────────────────────

userCommand
  .command('invite')
  .description('Add an existing user to a tenant using the tenant-admin provisioning flow')
  .requiredOption('--email <email>', 'Email address of the user to add')
  .option('--tenant <id>', 'Tenant ID to add the user to (defaults to the active tenant)')
  .action(async (options) => {
    const root = await findProjectRoot();
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);
    const activeContext = await resolveActiveTenantContext({
      projectRoot: root || undefined,
      publicApiUrl,
      interactive: false,
    });
    const tenantId = options.tenant || activeContext.activeTenant.id;

    const client = new PlatformAPIClient(publicApiUrl, 'system');

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

// ─── eai user provision-me ────────────────────────────────────────────────────

userCommand
  .command('provision-me')
  .description('Provision yourself to a tenant (for first-time setup)')
  .option('--tenant <id>', 'Tenant ID to provision yourself to (defaults to the active tenant)')
  .action(async (options) => {
    const root = await findProjectRoot();
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);
    const activeContext = await resolveActiveTenantContext({
      projectRoot: root || undefined,
      publicApiUrl,
      interactive: false,
    });
    const tenantId = options.tenant || activeContext.activeTenant.id;
    const client = new PlatformAPIClient(publicApiUrl, tenantId);

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
