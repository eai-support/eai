/**
 * eai login — authenticate with Entra CIAM via device code flow.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { deviceCodeLogin, clearTokens } from '../lib/auth.js';
import * as out from '../lib/output.js';

// Default CIAM tenant for EAI platform
const DEFAULT_TENANT_NAME = 'eaidevmyentepriseai';
const DEFAULT_TENANT_ID = '50808ce0-f31b-4fd0-9861-74b83b8c112a';
const DEFAULT_SCOPE = 'openid profile email offline_access api://32191e63-e253-48de-9ea1-a5337e236fe6/access_as_user';
// EAI CLI first-party App Registration (public client — 'EAI CLI - Developer Tools')
const DEFAULT_CLIENT_ID = 'c3c10ee2-aeeb-4a64-8eea-5ca43a3252af';

export const loginCommand = new Command('login')
  .description('Authenticate with Entra CIAM')
  .option('--tenant-name <name>', 'CIAM tenant name', DEFAULT_TENANT_NAME)
  .option('--tenant-id <id>', 'CIAM tenant ID', DEFAULT_TENANT_ID)
  .option('--scope <scope>', 'OAuth scopes', DEFAULT_SCOPE)
  .action(async (options) => {
    out.heading('Authenticating with Entra CIAM');
    out.info(`Tenant: ${chalk.cyan(options.tenantName)}`);

    try {
      const tokens = await deviceCodeLogin(
        options.tenantName,
        options.tenantId,
        DEFAULT_CLIENT_ID,
        options.scope,
      );

      out.blank();
      out.success(`Authenticated as ${chalk.bold(tokens.upn || 'user')}`);
      out.info(`Token expires: ${new Date(tokens.expiresAt).toLocaleString()}`);
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
