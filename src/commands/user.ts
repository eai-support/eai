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
  .description('Add an existing user to a tenant (lookup by email, then provision)')
  .requiredOption('--email <email>', 'Email address of the user to add')
  .requiredOption('--tenant <id>', 'Tenant ID to add the user to')
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) { out.error('Not in an EAI project.'); process.exit(1); }

    const envVars = await loadEnvFile(root);
    const env = { ...envVars, ...process.env };
    const publicApiUrl = env.BASE_URL_PUBLIC_API;
    if (!publicApiUrl) { out.error('BASE_URL_PUBLIC_API not set.'); process.exit(1); }

    const client = new PlatformAPIClient(publicApiUrl, 'system');

    // Step 1: Look up user by email
    const lookupSpinner = ora(`Looking up ${options.email}...`).start();

    let lookupResult: { user: { id: string; email: string; username?: string } | null };
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

    if (!lookupResult.user) {
      lookupSpinner.fail(`User ${chalk.cyan(options.email)} not found.`);
      console.log();
      console.log(`  ${chalk.yellow('The user must sign up first.')} Direct them to your platform's signup page.`);
      console.log();
      console.log(`  Once they've signed up, re-run:`);
      console.log(`  ${chalk.dim(`eai user invite --email ${options.email} --tenant ${options.tenant}`)}`);
      process.exit(1);
    }

    const user = lookupResult.user;
    lookupSpinner.succeed(`Found user ${chalk.cyan(user.email)} (${chalk.dim(user.id)})`);

    // Step 2: Provision user to tenant
    const provisionSpinner = ora(`Adding ${user.email} to tenant ${options.tenant}...`).start();

    try {
      const provisionRes = await client.provisionUserToTenant(options.tenant, user.id);
      if (!provisionRes.ok) {
        const body = await provisionRes.text();
        provisionSpinner.fail(`Provisioning failed: ${provisionRes.status}: ${body}`);
        process.exit(1);
      }

      const result = await provisionRes.json() as { success?: boolean; message?: string };
      provisionSpinner.succeed(
        `Added ${chalk.cyan(user.email)} to tenant ${chalk.dim(options.tenant)}`,
      );

      if (result.message) {
        console.log(`  ${chalk.dim(result.message)}`);
      }
    } catch (err) {
      provisionSpinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
