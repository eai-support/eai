/**
 * eai provision — provision platform resources for a vertical.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile, patchEnvFile } from '../lib/config.js';
import { resolveActiveTenantContext, resolvePublicApiUrl } from '../lib/tenant-context.js';
import { PlatformAPIClient, PlatformAPIRequestError } from '../lib/api.js';
import * as out from '../lib/output.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';

interface ErrorContext {
  status?: number;
  serverMessage?: string;
  serverCode?: string;
  requestId?: string;
  rawBody?: string;
}

function readErrorContext(err: unknown): ErrorContext {
  if (err instanceof PlatformAPIRequestError) {
    return {
      status: err.status,
      serverMessage: err.serverMessage,
      serverCode: err.serverCode,
      requestId: err.requestId,
      rawBody: err.rawBody,
    };
  }
  return {};
}

interface DiagnosticsContext {
  tenantSlug?: string;
  tenantId?: string;
  userOid?: string;
  debug: boolean;
}

function printServerDetail(ctx: ErrorContext, diag: DiagnosticsContext): void {
  if (ctx.serverMessage) {
    out.info(`Server: ${ctx.serverMessage}`);
  }
  if (ctx.requestId) {
    out.info(`Request ID: ${ctx.requestId}`);
  }
  if (diag.debug && ctx.rawBody) {
    out.info('Raw response body:');
    out.info(ctx.rawBody);
  }
}

function printProvisionFallback(reference: string): void {
  out.info(`Reference: ${reference}`);
  out.info('Retry after confirming you are logged in and have selected the correct tenant.');
  out.info('If this continues, contact your platform administrator.');
  out.info('Manual fallback: set ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET in .env.local.');
}

function tenantLabel(diag: DiagnosticsContext): string {
  if (diag.tenantSlug && diag.tenantId) {
    return `${chalk.cyan(diag.tenantSlug)} (${chalk.dim(diag.tenantId)})`;
  }
  return chalk.cyan(diag.tenantSlug ?? diag.tenantId ?? 'unknown');
}

function handleProvisionError(err: unknown, diag: DiagnosticsContext): never {
  const ctx = readErrorContext(err);
  const status = ctx.status;

  if (status === 404) {
    out.error('Entra provisioning is not available for this tenant or platform instance.');
    printServerDetail(ctx, diag);
    printProvisionFallback('EAI-PROVISION-UNAVAILABLE');
    process.exit(1);
  }
  if (status === 501) {
    out.error('Entra provisioning is not available on this platform instance.');
    printServerDetail(ctx, diag);
    printProvisionFallback('EAI-PROVISION-UNAVAILABLE');
    process.exit(1);
  }
  if (status === 403) {
    out.error(`Permission denied for tenant ${tenantLabel(diag)}.`);
    printServerDetail(ctx, diag);
    out.info('Confirm role with: eai whoami --verbose && eai tenant list');
    if (diag.userOid) {
      out.info(
        `Platform team can verify membership at /api/custom-users/${diag.userOid}/tenant-memberships`,
      );
    }
    out.info('Reference: EAI-PROVISION-FORBIDDEN');
    process.exit(1);
  }
  if (status === 409) {
    out.error('The maximum number of app registrations for this tenant has been reached.');
    printServerDetail(ctx, diag);
    out.info('Reference: EAI-PROVISION-LIMIT');
    out.info('Contact your platform administrator.');
    process.exit(1);
  }
  out.error('Entra provisioning failed.');
  printServerDetail(ctx, diag);
  printProvisionFallback('EAI-PROVISION-FAILED');
  process.exit(1);
}

async function formatProvisionResponseError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `Storage provisioning failed: ${response.status} ${response.statusText}`;
  }

  try {
    const payload = JSON.parse(text) as {
      detail?: { message?: string; error?: string } | string;
      error?: string;
      message?: string;
    };
    const detail = payload.detail;
    const message = typeof detail === 'object'
      ? detail.message || detail.error
      : detail || payload.message || payload.error;
    return `Storage provisioning failed: ${response.status} ${response.statusText}${message ? ` — ${message}` : ''}`;
  } catch {
    return `Storage provisioning failed: ${response.status} ${response.statusText} — ${text.slice(0, 300)}`;
  }
}

export const provisionCommand = new Command('provision')
  .description('Provision platform resources for this vertical');

// ─── eai provision entra ──────────────────────────────────────────────────

provisionCommand
  .command('entra')
  .description('Create an Entra app registration for end-user auth (Auth.js)')
  .option('--force', 'Re-check the remote app registration even if ENTRA_CLIENT_ID already exists locally', false)
  .option('--debug', 'Print full server response body on failure (diagnostic only — may contain raw error context)', false)
  .addHelpText('after', `
Examples:
  $ eai provision entra
  $ eai provision entra --force

What happens:
  - Calls the platform provisioning API to create an Entra app registration
  - Writes ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET to .env.local
  - If the registration already exists, confirms ENTRA_CLIENT_ID without rotating the secret

Diagnostics:
  - Uses the PublicAPI URL from the active profile, .env.local BASE_URL_PUBLIC_API, environment, or the default API
  - Default/no profile targets production; --profile test and --profile dev target their configured platform APIs
  - The platform chooses the matching CIAM from its deployment configuration; the CLI never sends a CIAM selector
  - Errors are product-safe and include a support reference without exposing platform internals
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
    let tenantSlug: string | undefined;
    let userOid: string | undefined;

    try {
      const context = await resolveActiveTenantContext({ projectRoot: root, publicApiUrl, interactive: true });
      tenantId = context.activeTenant.id;
      tenantSlug = (context.activeTenant as { slug?: string }).slug;
      userOid = (context as { user?: { oid?: string; id?: string } }).user?.oid
        ?? (context as { user?: { id?: string } }).user?.id;
    } catch {
      out.error('Failed to resolve active tenant.');
      out.info(`Run ${chalk.cyan('eai login')} and ${chalk.cyan('eai tenant select')} first.`);
      process.exit(1);
    }

    const diag: DiagnosticsContext = { tenantSlug, tenantId, userOid, debug: Boolean(options.debug) };

    out.info(`Provisioning Entra app registration for ${chalk.cyan(verticalName)}...`);

    const client = new PlatformAPIClient(publicApiUrl, tenantId);

    let result: {
      clientId: string;
      clientSecret: string | null;
      existing: boolean;
      scopes: string[];
      redirectUris: string[];
      environment: string | null;
      tenantId: string | null;
    };
    try {
      result = await client.provisionEntraApp({
        tenantId,
        verticalName,
        redirectUris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
        // The platform route is intentionally idempotent: it creates on first run and
        // returns the existing app ID on later runs without attempting secret rotation.
        idempotent: true,
      });
    } catch (err) {
      handleProvisionError(err, diag);
    }

    // Build env-var patches that derive from the platform response so the
    // CLI persists scopes / redirect URIs / environment / tenant id without
    // requiring manual portal clicks. Older PublicAPI versions return empty
    // arrays; in that case we leave the keys untouched rather than writing
    // empty strings.
    const optionalEnv: Record<string, string> = {};
    if (result.scopes.length > 0) {
      optionalEnv.ENTRA_SCOPES = result.scopes.join(' ');
    }
    if (result.redirectUris.length > 0) {
      optionalEnv.ENTRA_REDIRECT_URIS = result.redirectUris.join(',');
    }
    if (result.environment) {
      optionalEnv.ENTRA_ENVIRONMENT = result.environment;
    }
    if (result.tenantId) {
      optionalEnv.EAI_TENANT_ID = result.tenantId;
    }

    if (result.existing && !result.clientSecret) {
      out.info(`App registration already exists for ${chalk.cyan(verticalName)}.`);
      if (env.ENTRA_CLIENT_SECRET) {
        out.info('Your existing ENTRA_CLIENT_SECRET in .env.local remains valid.');
      } else {
        out.warn('No new ENTRA_CLIENT_SECRET was returned for the existing registration.');
        out.warn('Set ENTRA_CLIENT_SECRET in .env.local manually if it is missing locally.');
      }
      await patchEnvFile(root, { ENTRA_CLIENT_ID: result.clientId, ...optionalEnv });
      out.success(`ENTRA_CLIENT_ID confirmed: ${chalk.dim(result.clientId)}`);
      if (Object.keys(optionalEnv).length > 0) {
        out.info(`Refreshed env vars from platform response: ${Object.keys(optionalEnv).join(', ')}`);
      } else {
        out.warn('Platform response did not include scopes/redirect URIs — set ENTRA_SCOPES manually.');
      }
      return;
    }

    if (!result.clientSecret) {
      out.error('Platform returned a registration but no clientSecret. Contact your platform administrator.');
      process.exit(1);
    }

    await patchEnvFile(root, {
      ENTRA_CLIENT_ID: result.clientId,
      ENTRA_CLIENT_SECRET: result.clientSecret,
      ...optionalEnv,
    });

    out.success(`Entra app registration created for ${chalk.cyan(verticalName)}`);
    const tableRows: Array<[string, string]> = [
      ['Client ID', chalk.dim(result.clientId)],
      ['Client Secret', chalk.dim('[written to .env.local]')],
    ];
    if (optionalEnv.ENTRA_SCOPES) {
      tableRows.push(['Scopes', chalk.dim(optionalEnv.ENTRA_SCOPES)]);
    }
    if (optionalEnv.ENTRA_REDIRECT_URIS) {
      tableRows.push(['Redirect URIs', chalk.dim(optionalEnv.ENTRA_REDIRECT_URIS)]);
    }
    if (optionalEnv.ENTRA_ENVIRONMENT) {
      tableRows.push(['Environment', chalk.dim(optionalEnv.ENTRA_ENVIRONMENT)]);
    }
    out.table(tableRows);
    out.warn('The client secret has been written to .env.local and cannot be retrieved again.');
    out.warn('Do NOT commit .env.local to source control.');

    if (!optionalEnv.ENTRA_SCOPES) {
      out.warn('Platform response did not include scopes — set ENTRA_SCOPES manually.');
    }
    if (!optionalEnv.ENTRA_REDIRECT_URIS) {
      out.warn('Platform response did not include redirect URIs — set ENTRA_REDIRECT_URIS manually.');
    }
  });

// ─── eai provision storage ───────────────────────────────────────────────

provisionCommand
  .command('storage')
  .description('Provision ResourceAPI storage for the active tenant')
  .option('--tenant-id <id>', 'Provision storage for a specific tenant')
  .option('--backend <backend>', 'postgresql|mongodb|documentdb|blob|search|all', 'all')
  .option('--dry-run', 'Plan actions without applying changes', false)
  .option('--rebuild-search', 'Request search projection rebuild after provisioning', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) {
      exitWithError(ErrorCode.E001);
    }

    const publicApiUrl = await resolvePublicApiUrl(root);
    let tenantId: string = options.tenantId;

    try {
      const context = await resolveActiveTenantContext({
        projectRoot: root,
        publicApiUrl,
        tenantId,
        interactive: !tenantId,
        forceRefresh: Boolean(tenantId),
      });
      tenantId = context.activeTenant.id;
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const client = new PlatformAPIClient(publicApiUrl, tenantId);
    const jsonOutput = options.json || options.format === 'json';
    if (!jsonOutput) {
      out.info(`${options.dryRun ? 'Planning' : 'Provisioning'} storage for tenant ${tenantId}...`);
    }

    const response = await client.provisionStorage({
      backend: options.backend,
      dryRun: Boolean(options.dryRun),
      rebuildSearch: Boolean(options.rebuildSearch),
    });

    if (!response.ok) {
      out.error(await formatProvisionResponseError(response));
      process.exit(1);
    }

    const payload = await response.json() as {
      tenantId: string;
      dryRun: boolean;
      results: Array<{
        objectType: string;
        backend: string;
        status: string;
        actions?: string[];
      }>;
    };

    if (jsonOutput) {
      out.json(payload);
      return;
    }

    out.success(options.dryRun ? 'Storage plan complete' : 'Storage provisioning complete');
    for (const result of payload.results) {
      out.info(`${chalk.cyan(result.objectType)} ${chalk.dim(result.backend)} ${result.status}`);
      for (const action of result.actions || []) {
        out.dim(`  ${action}`);
      }
    }
  });
