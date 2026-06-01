/**
 * eai login — authenticate with Entra CIAM via browser auth (PKCE).
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { browserLogin, clearTokens, storeTokens } from '../lib/auth.js';
import { resolveActiveTenantContext, resolvePublicApiUrl } from '../lib/tenant-context.js';
import { getActiveProfile, loadProfileConfig, saveActiveProfileToConfig, DEFAULT_PROD_AUTH_SCOPE } from '../lib/profile.js';
import * as out from '../lib/output.js';

// Production CIAM defaults — hardcoded so `eai login` works without config files
const PROD_TENANT_NAME = 'enterpriseaiplatform';
const PROD_TENANT_ID = 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26';
const PROD_CLIENT_ID = 'd704bde5-fe36-44ff-9a26-221d53772dd0';
const DEFAULT_SCOPE = DEFAULT_PROD_AUTH_SCOPE;

export const loginCommand = new Command('login')
  .description('Authenticate with Entra CIAM')
  .option('--tenant-name <name>', 'CIAM tenant name')
  .option('--tenant-id <id>', 'CIAM tenant ID')
  .option('--scope <scope>', 'OAuth scopes')
  .addHelpText('after', `
Examples:
  $ eai login
  $ eai login --tenant-name myorg --tenant-id 12345678-abcd-efgh-ijkl-123456789012
  $ eai --profile dev login
  $ eai whoami

What happens next:
  - The CLI opens your browser to sign you in.
  - If you only have one tenant-admin membership, it becomes active automatically.
  - If you have more than one, run 'eai tenant select' to choose the tenant to work with.
  `)
  .action(async (options) => {
    const profile = getActiveProfile();
    const profileConfig = await loadProfileConfig(profile);

    // Resolve auth config: command flags → profile config → prod defaults
    const tenantName = options.tenantName || profileConfig?.authTenantName || PROD_TENANT_NAME;
    const tenantId = options.tenantId || profileConfig?.authTenantId || PROD_TENANT_ID;
    const clientId = profileConfig?.authClientId || PROD_CLIENT_ID;
    const scope = options.scope || profileConfig?.authScope || DEFAULT_SCOPE;

    if (!tenantName || !tenantId || !clientId) {
      out.error(`Profile "${profile}" is missing authTenantName, authTenantId, or authClientId.`);
      out.info('Check your local profile settings and ensure all required fields are set.');
      process.exit(1);
    }

    out.heading('Authenticating with Entra CIAM');
    if (profile !== 'default') {
      out.info(`Profile: ${chalk.cyan(profile)}`);
    }
    out.info(`Tenant: ${chalk.cyan(tenantName)}`);
    out.info('Opening your browser to complete sign-in...');

    try {
      const tokens = await browserLogin(
        tenantName,
        tenantId,
        clientId,
        scope,
      );

      // Store bare tokens now so the cache is populated for the tenant resolution call
      await storeTokens(tokens);

      // Persist this profile as the active one so subsequent commands use it
      await saveActiveProfileToConfig(profile);

      out.blank();
      out.success(`Authenticated as ${chalk.bold(tokens.upn || 'user')}`);
      out.info(`Token expires: ${new Date(tokens.expiresAt).toLocaleString()}`);

      try {
        const publicApiUrl = await resolvePublicApiUrl();
        const context = await resolveActiveTenantContext({
          publicApiUrl,
          interactive: true,
        });
        out.info(`Active tenant: ${chalk.cyan(context.activeTenant.displayName)} ${chalk.dim(`(${context.activeTenant.slug})`)}`);
      } catch (selectionError) {
        out.warn(selectionError instanceof Error ? selectionError.message : String(selectionError));
        out.info(`Run ${chalk.cyan('eai tenant select')} after login to choose the tenant to work with.`);
      }
    } catch (err) {
      out.error(`Login failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

export const logoutCommand = new Command('logout')
  .description('Clear stored authentication tokens')
  .action(async () => {
    const profile = getActiveProfile();
    await clearTokens();
    // Reset active profile to default on logout
    if (profile !== 'default') {
      await saveActiveProfileToConfig('default');
      out.success(`Logged out from profile "${profile}". Stored tokens cleared.`);
    } else {
      out.success('Logged out. Stored tokens cleared.');
    }
  });
