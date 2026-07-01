/**
 * eai login — authenticate with Entra CIAM via browser auth (PKCE).
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { browserLogin, clearTokens, storeTokens, resolveAuthConfig, validateResolvedAuthConfig } from '../lib/auth.js';
import { findProjectRoot } from '../lib/config.js';
import {
  buildPublicApiEnvSyncNotice,
  resolveActiveTenantContext,
  resolvePublicApiUrl,
} from '../lib/tenant-context.js';
import { getActiveProfile } from '../lib/profile.js';
import * as out from '../lib/output.js';

function parseCallbackPort(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid callback port: ${value}`);
  }

  return port;
}

export const loginCommand = new Command('login')
  .description('Authenticate with Entra CIAM')
  .option('--tenant-name <name>', 'CIAM tenant name')
  .option('--tenant-id <id>', 'CIAM tenant ID')
  .option('--scope <scope>', 'OAuth scopes')
  .option('--callback-port <port>', 'Localhost port to listen on for the OAuth callback')
  .addHelpText('after', `
Examples:
  $ eai login
  $ eai login --tenant-name myorg --tenant-id 12345678-abcd-efgh-ijkl-123456789012
  $ eai login --callback-port 3476
  $ eai whoami

What happens next:
  - The CLI opens your browser to sign you in.
  - With --callback-port, the CLI still uses localhost and listens on that exact port.
  - For Codespaces, run 'gh codespace ports forward -c <codespace> 3476:3476' on your local machine and keep it running while you sign in.
  - If you only have one tenant-admin membership, it becomes active automatically.
  - If you have more than one, run 'eai tenant select' to choose the tenant to work with.
  `)
  .action(async (options) => {
    const profile = getActiveProfile();
    const projectRoot = await findProjectRoot();
    const resolvedConfig = await resolveAuthConfig(projectRoot || undefined, profile);
    const configIssue = validateResolvedAuthConfig(resolvedConfig);
    if (configIssue) {
      out.error(configIssue);
      process.exit(1);
    }

    // Resolve auth config: command flags → runtime/profile config → public defaults
    const tenantName = options.tenantName || resolvedConfig.tenantName;
    const tenantId = options.tenantId || resolvedConfig.tenantId;
    const clientId = resolvedConfig.clientId;
    const scope = options.scope || resolvedConfig.authScope;
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
      const callbackPort = parseCallbackPort(options.callbackPort);
      const tokens = await browserLogin(
        tenantName,
        tenantId,
        clientId,
        scope,
        {
          callbackPort,
          onAuthorizeUrl: callbackPort === undefined
            ? undefined
            : (url) => out.info(`Open this URL in your local browser: ${chalk.cyan(url)}`),
        },
      );

      // Store bare tokens now so the cache is populated for the tenant resolution call
      await storeTokens(tokens);

      out.blank();
      out.success(`Authenticated as ${chalk.bold(tokens.upn || 'user')}`);
      out.info(`Token expires: ${new Date(tokens.expiresAt).toLocaleString()}`);

      try {
        const projectRoot = await findProjectRoot();
        const publicApiUrl = await resolvePublicApiUrl(projectRoot || undefined);
        const context = await resolveActiveTenantContext({
          projectRoot: projectRoot || undefined,
          publicApiUrl,
          interactive: true,
        });
        out.info(`Active tenant: ${chalk.cyan(context.activeTenant.displayName)} ${chalk.dim(`(${context.activeTenant.slug})`)}`);
        const notice = buildPublicApiEnvSyncNotice(context.publicApiEnvSync);
        if (notice?.level === 'warn') {
          out.warn(notice.message);
        } else if (notice) {
          out.success(notice.message);
        }
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
    if (profile !== 'default') {
      out.success(`Logged out from profile "${profile}". Stored tokens cleared.`);
    } else {
      out.success('Logged out. Stored tokens cleared.');
    }
  });
