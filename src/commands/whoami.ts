/**
 * eai whoami — show auth status and tenant info.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { loadTokens, isAuthenticated } from '../lib/auth.js';
import { findProjectRoot, loadEnvFile } from '../lib/config.js';
import { fetchTenantAdminMemberships, getStoredActiveTenant, resolvePublicApiUrl } from '../lib/tenant-context.js';
import { getActiveProfile } from '../lib/profile.js';
import * as out from '../lib/output.js';

export const whoamiCommand = new Command('whoami')
  .description('Show auth status and tenant info')
  .action(async () => {
    const tokens = await loadTokens();
    const authenticated = await isAuthenticated();

    const profileName = getActiveProfile();

    out.heading('Authentication');

    if (!tokens) {
      out.error('Not logged in. Run `eai login` to authenticate.');
      process.exit(1);
    }

    if (authenticated) {
      out.success(`Logged in as ${chalk.bold(tokens.upn || 'unknown user')}`);
    } else {
      out.warn(`Token expired. Run \`eai login\` to re-authenticate.`);
    }

    const activeTenant = getStoredActiveTenant(tokens);
    const publicApiUrl = await resolvePublicApiUrl();
    out.table([
      ['Profile', profileName === 'default' ? chalk.dim('default') : chalk.cyan(profileName)],
      ['Authority Tenant', tokens.tenantName],
      ['Authority Tenant ID', chalk.dim(tokens.tenantId)],
      ['Active Tenant', activeTenant ? activeTenant.displayName : chalk.dim('not selected')],
      ['Active Tenant ID', activeTenant ? chalk.dim(activeTenant.id) : chalk.dim('not selected')],
      ['PublicAPI', publicApiUrl],
      ['Expires', new Date(tokens.expiresAt).toLocaleString()],
      ['Status', authenticated ? chalk.green('Active') : chalk.red('Expired')],
    ]);

    if (!activeTenant) {
      out.info(`Run ${chalk.cyan('eai tenant select')} to choose the tenant to work with.`);
    } else {
      try {
        const memberships = await fetchTenantAdminMemberships(publicApiUrl);
        out.info(`Tenant-admin memberships: ${memberships.memberships.length}`);
      } catch {
        // whoami should still work even if the membership lookup fails
      }
    }

    // Show project context if in a vertical project
    const root = await findProjectRoot();
    if (root) {
      const env = await loadEnvFile(root);
      const appName = env.NEXT_PUBLIC_APP_NAME;
      if (appName) {
        out.blank();
        out.heading('Project');
        out.table([
          ['App Name', chalk.cyan(appName)],
        ]);
      }
    }
  });
