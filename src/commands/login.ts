/**
 * eai login — authenticate with Entra CIAM via device code flow.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { deviceCodeLogin, clearTokens } from '../lib/auth.js';
import { findProjectRoot, loadEnvFile } from '../lib/config.js';
import * as out from '../lib/output.js';

// Default CIAM tenant for EAI platform
const DEFAULT_TENANT_NAME = 'eaidevmyentepriseai';
const DEFAULT_TENANT_ID = '50808ce0-f31b-4fd0-9861-74b83b8c112a';
const DEFAULT_SCOPE = 'openid profile email offline_access';

export const loginCommand = new Command('login')
  .description('Authenticate with Entra CIAM')
  .option('--tenant-name <name>', 'CIAM tenant name', DEFAULT_TENANT_NAME)
  .option('--tenant-id <id>', 'CIAM tenant ID', DEFAULT_TENANT_ID)
  .option('--client-id <id>', 'App registration client ID')
  .option('--scope <scope>', 'OAuth scopes', DEFAULT_SCOPE)
  .action(async (options) => {
    let clientId = options.clientId;

    // Try to resolve client ID from project config
    if (!clientId) {
      const root = await findProjectRoot();
      if (root) {
        const env = await loadEnvFile(root);
        clientId = env.ENTRA_CLIENT_ID || process.env.ENTRA_CLIENT_ID;
      }
    }

    if (!clientId) {
      out.error('No client ID provided. Use --client-id or set ENTRA_CLIENT_ID in .env.local');
      process.exit(1);
    }

    out.heading('Authenticating with Entra CIAM');
    out.info(`Tenant: ${chalk.cyan(options.tenantName)}`);
    out.info(`Client: ${chalk.dim(clientId)}`);

    try {
      const tokens = await deviceCodeLogin(
        options.tenantName,
        options.tenantId,
        clientId,
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
