/**
 * eai login — authenticate with Entra CIAM via browser auth (PKCE).
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { browserLogin, clearTokens, storeTokens } from '../lib/auth.js';
import { resolveActiveTenantContext, resolvePublicApiUrl } from '../lib/tenant-context.js';
import * as out from '../lib/output.js';

// CIAM identifiers — must be set via environment variables.
// EAI_CIAM_TENANT_NAME, EAI_CIAM_TENANT_ID, EAI_CIAM_CLIENT_ID, EAI_CIAM_SCOPE
const DEFAULT_TENANT_NAME = process.env.EAI_CIAM_TENANT_NAME ?? '';
const DEFAULT_TENANT_ID = process.env.EAI_CIAM_TENANT_ID ?? '';
const DEFAULT_SCOPE = process.env.EAI_CIAM_SCOPE ?? 'openid profile email offline_access';
// EAI CLI first-party App Registration (public client — 'EAI CLI - Developer Tools')
const DEFAULT_CLIENT_ID = process.env.EAI_CIAM_CLIENT_ID ?? '';

export const loginCommand = new Command('login')
  .description('Authenticate with Entra CIAM')
  .option('--tenant-name <name>', 'CIAM tenant name', DEFAULT_TENANT_NAME)
  .option('--tenant-id <id>', 'CIAM tenant ID', DEFAULT_TENANT_ID)
  .option('--scope <scope>', 'OAuth scopes', DEFAULT_SCOPE)
  .addHelpText('after', `
Examples:
  $ eai login
  $ eai login --tenant-name myorg --tenant-id 12345678-abcd-efgh-ijkl-123456789012
  $ eai whoami

What happens next:
  - The CLI opens your browser to sign you in.
  - If you only have one tenant-admin membership, it becomes active automatically.
  - If you have more than one, run 'eai tenant select' to choose the tenant to work with.
  `)
  .action(async (options) => {
    out.heading('Authenticating with Entra CIAM');
    out.info(`Tenant: ${chalk.cyan(options.tenantName)}`);
    out.info('Opening your browser to complete sign-in...');

    try {
      const tokens = await browserLogin(
        options.tenantName,
        options.tenantId,
        DEFAULT_CLIENT_ID,
        options.scope,
      );

      // Store bare tokens now so the cache is populated for the tenant resolution call
      await storeTokens(tokens);

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
    await clearTokens();
    out.success('Logged out. Stored tokens cleared.');
  });
