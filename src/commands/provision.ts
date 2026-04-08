/**
 * eai provision — provision platform resources for a vertical.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile, patchEnvFile } from '../lib/config.js';
import { resolveActiveTenantContext, resolvePublicApiUrl } from '../lib/tenant-context.js';
import { PlatformAPIClient } from '../lib/api.js';
import * as out from '../lib/output.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';

function handleProvisionError(err: unknown): never {
  const status = (err as { status?: number }).status;
  if (status === 404 || status === 501) {
    out.warn('Provisioning endpoint is not yet available on this platform instance.');
    out.info('Set ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET in .env.local manually,');
    out.info('or contact your platform administrator.');
    process.exit(1);
  }
  if (status === 403) {
    out.error('Permission denied. You must be a tenant-admin to provision an Entra app registration.');
    process.exit(1);
  }
  if (status === 409) {
    out.error('Maximum app registrations per tenant exceeded. Contact your platform administrator.');
    process.exit(1);
  }
  const statusMsg = status ? ` (HTTP ${status})` : '';
  out.error(`Provisioning failed${statusMsg}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

export const provisionCommand = new Command('provision')
  .description('Provision platform resources for this vertical');

// ─── eai provision entra ──────────────────────────────────────────────────

provisionCommand
  .command('entra')
  .description('Create an Entra app registration for end-user auth (Auth.js)')
  .option('--force', 'Re-check the remote app registration even if ENTRA_CLIENT_ID already exists locally', false)
  .addHelpText('after', `
Examples:
  $ eai provision entra
  $ eai provision entra --force

What happens:
  - Calls the platform provisioning API to create an Entra app registration
  - Writes ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET to .env.local
  - If the registration already exists, confirms ENTRA_CLIENT_ID without rotating the secret
  `)
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) {
      exitWithError(ErrorCode.E001);
    }

    const env = await loadEnvFile(root);
    const verticalName = env.NEXT_PUBLIC_APP_NAME;

    if (!verticalName) {
      out.error('NEXT_PUBLIC_APP_NAME is not set in .env.local. Run `eai init` to scaffold a vertical first.');
      process.exit(1);
    }

    // Check if ENTRA_CLIENT_ID already exists
    if (env.ENTRA_CLIENT_ID && !options.force) {
      out.warn(`ENTRA_CLIENT_ID is already set for ${chalk.cyan(verticalName)}.`);
      out.info(`Use ${chalk.cyan('eai provision entra --force')} to re-check the remote registration and confirm ENTRA_CLIENT_ID.`);
      process.exit(0);
    }

    const publicApiUrl = await resolvePublicApiUrl(root);
    let tenantId: string;

    try {
      const context = await resolveActiveTenantContext({ projectRoot: root, publicApiUrl, interactive: true });
      tenantId = context.activeTenant.id;
    } catch (err) {
      out.error(`Failed to resolve active tenant: ${err instanceof Error ? err.message : String(err)}`);
      out.info(`Run ${chalk.cyan('eai login')} and ${chalk.cyan('eai tenant select')} first.`);
      process.exit(1);
    }

    out.info(`Provisioning Entra app registration for ${chalk.cyan(verticalName)} on tenant ${chalk.dim(tenantId)}...`);

    const client = new PlatformAPIClient(publicApiUrl, tenantId);

    let result: { clientId: string; clientSecret: string | null; existing: boolean };
    try {
      result = await client.provisionEntraApp({
        tenantId,
        verticalName,
        redirectUris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
        // The PublicAPI route is intentionally idempotent: it creates on first run and
        // returns the existing app ID on later runs without attempting secret rotation.
        idempotent: true,
      });
    } catch (err) {
      handleProvisionError(err);
    }

    if (result.existing && !result.clientSecret) {
      out.info(`App registration already exists for ${chalk.cyan(verticalName)}.`);
      if (env.ENTRA_CLIENT_SECRET) {
        out.info('Your existing ENTRA_CLIENT_SECRET in .env.local remains valid.');
      } else {
        out.warn('No new ENTRA_CLIENT_SECRET was returned for the existing registration.');
        out.warn('Set ENTRA_CLIENT_SECRET in .env.local manually if it is missing locally.');
      }
      // Still write clientId in case it was missing
      await patchEnvFile(root, { ENTRA_CLIENT_ID: result.clientId });
      out.success(`ENTRA_CLIENT_ID confirmed: ${chalk.dim(result.clientId)}`);
      return;
    }

    if (!result.clientSecret) {
      out.error('Platform returned a registration but no clientSecret. Contact your platform administrator.');
      process.exit(1);
    }

    await patchEnvFile(root, {
      ENTRA_CLIENT_ID: result.clientId,
      ENTRA_CLIENT_SECRET: result.clientSecret,
    });

    out.success(`Entra app registration created for ${chalk.cyan(verticalName)}`);
    out.table([
      ['Client ID', chalk.dim(result.clientId)],
      ['Client Secret', chalk.dim('[written to .env.local]')],
    ]);
    out.warn('The client secret has been written to .env.local and cannot be retrieved again.');
    out.warn('Do NOT commit .env.local to source control.');
  });
