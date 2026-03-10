/**
 * eai user — manage users on the platform.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile } from '../lib/config.js';
import { PlatformAPIClient } from '../lib/api.js';
import * as out from '../lib/output.js';

export const userCommand = new Command('user')
  .description('Manage users on the platform');

// ─── eai user invite ──────────────────────────────────────────────────────

userCommand
  .command('invite')
  .description('Invite a user to a tenant (creates CIAM account, adds to security group, assigns role)')
  .requiredOption('--email <email>', 'Email address to invite')
  .requiredOption('--tenant <id>', 'Tenant ID to invite the user to')
  .requiredOption('--first-name <name>', 'First name')
  .requiredOption('--last-name <name>', 'Last name')
  .option('--role <role>', 'Role to assign (default: tenant-viewer)', 'tenant-viewer')
  .option('--message <message>', 'Custom invitation message')
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) { out.error('Not in an EAI project.'); process.exit(1); }

    const envVars = await loadEnvFile(root);
    const env = { ...envVars, ...process.env };
    const publicApiUrl = env.BASE_URL_PUBLIC_API;
    if (!publicApiUrl) { out.error('BASE_URL_PUBLIC_API not set.'); process.exit(1); }

    const client = new PlatformAPIClient(publicApiUrl, 'system');
    const spinner = ora(`Inviting ${options.email}...`).start();

    try {
      const res = await client.inviteUserToTenant({
        email: options.email,
        firstName: options.firstName,
        lastName: options.lastName,
        currentTenantId: options.tenant,
        role: options.role,
        message: options.message,
      });

      if (!res.ok) {
        const body = await res.text();
        spinner.fail(`${res.status}: ${body}`);
        process.exit(1);
      }

      const result = await res.json() as { user?: { email?: string }; message?: string };
      spinner.succeed(
        `Invited ${chalk.cyan(options.email)} to tenant ${chalk.dim(options.tenant)}` +
        (options.role !== 'tenant-viewer' ? ` as ${chalk.yellow(options.role)}` : ''),
      );

      if (result.message) {
        console.log(`  ${chalk.dim(result.message)}`);
      }
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
