/**
 * eai user — manage users on the platform.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { PlatformAPIClient } from '../lib/api.js';
import { resolveCommandContext } from '../lib/context.js';
import * as out from '../lib/output.js';

export const userCommand = new Command('user')
  .description('Manage users on the platform');

// ─── eai user invite ──────────────────────────────────────────────────────

userCommand
  .command('invite')
  .description('Invite or add a user to a tenant with a tenant role')
  .requiredOption('--email <email>', 'Email address of the user to add')
  .option('--tenant <id>', 'Tenant ID to add the user to (defaults to the active tenant)')
  .option('--role <role>', 'Tenant role to assign (tenant-viewer|tenant-staff|tenant-builder|tenant-admin)', 'tenant-viewer')
  .option('--first-name <name>', 'Optional first name for new invitations')
  .option('--last-name <name>', 'Optional last name for new invitations')
  .option('--message <message>', 'Optional invitation message')
  .option('--redirect-uri <uri>', 'Optional post-invite redirect URI')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .action(async (options) => {
    const ctx = await resolveCommandContext({ interactive: false });
    const tenantId = options.tenant || ctx.tenantId;
    const client = new PlatformAPIClient(ctx.publicApiUrl, tenantId);
    const jsonOutput = options.format === 'json';
    const inviteSpinner = jsonOutput
      ? null
      : ora(`Inviting ${options.email} to tenant ${tenantId} as ${options.role}...`).start();

    try {
      const inviteRes = await client.inviteTenantMember(tenantId, {
        email: options.email,
        role: options.role,
        firstName: options.firstName,
        lastName: options.lastName,
        message: options.message,
        redirectUri: options.redirectUri,
      });
      if (!inviteRes.ok) {
        const body = await inviteRes.text();
        inviteSpinner?.fail(`Invite failed: ${inviteRes.status}: ${body}`);
        if (jsonOutput) {
          out.json({
            ok: false,
            status: inviteRes.status,
            error: body,
            command: 'eai user invite',
            next: [
              'Confirm you are tenant-admin for the target tenant with `eai whoami`.',
              'Confirm the target tenant is selected with `eai tenant info <tenant-id> --format json`.',
              'Retry with an explicit role, for example `--role tenant-admin` or `--role tenant-viewer`.',
            ],
          });
        }
        process.exit(1);
      }

      const result = await inviteRes.json() as {
        email?: string;
        role?: string;
        status?: string;
        userId?: string;
        inviteMode?: string;
        message?: string;
      };
      if (jsonOutput) {
        out.json(result);
        return;
      }

      inviteSpinner?.succeed(
        `Invited ${chalk.cyan(result.email || options.email)} to tenant ${chalk.dim(tenantId)} as ${result.role || options.role}`,
      );
      if (result.message) {
        out.info(result.message);
      }
    } catch (err) {
      inviteSpinner?.fail(err instanceof Error ? err.message : String(err));
      if (jsonOutput) {
        out.json({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          command: 'eai user invite',
        });
      }
      process.exit(1);
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
