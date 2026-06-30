/**
 * eai provision — provision platform resources for an app.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findProjectRoot, loadEnvFile, patchEnvFile } from '../lib/config.js';
import { resolveActiveTenantContext, resolvePublicApiUrl } from '../lib/tenant-context.js';
import {
  PlatformAPIClient,
  PlatformAPIRequestError,
  type SigninCompletenessSummary,
  type TenantAuthorizationSummary,
} from '../lib/api.js';
import { getAccessToken, loadTokens } from '../lib/auth.js';
import * as out from '../lib/output.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';
import { buildPassiveResourceApiBundle } from '../lib/resourceapi-bundle.js';
import { findGuidanceByCode } from '../lib/error-guidance/catalog.js';
import { formatGuidanceText } from '../lib/error-guidance/render.js';

interface ErrorContext {
  status?: number;
  serverMessage?: string;
  serverCode?: string;
  requestId?: string;
  rawBody?: string;
}

interface ServerDetailOptions {
  includeServerMessage?: boolean;
  includeServerCode?: boolean;
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

function normalizeLocalEntraSetting(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  if (['empty', 'changeme', 'placeholder', '<empty>'].includes(normalized.toLowerCase())) {
    return null;
  }
  return normalized;
}

function hasUsableLocalEntraSecret(env: Record<string, string>): boolean {
  return normalizeLocalEntraSetting(env.ENTRA_CLIENT_SECRET) !== null;
}

function hasUsableLocalEntraClientId(env: Record<string, string>): boolean {
  return normalizeLocalEntraSetting(env.ENTRA_CLIENT_ID) !== null;
}

async function removeEnvFileKeys(projectRoot: string, keys: string[]): Promise<void> {
  const envPath = join(projectRoot, '.env.local');
  let content: string;
  try {
    content = await readFile(envPath, 'utf-8');
  } catch {
    return;
  }

  const keySet = new Set(keys);
  const updatedLines = content
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      for (const key of keySet) {
        if (line.startsWith(`${key}=`) || trimmed.startsWith(`export ${key}=`)) {
          return false;
        }
      }
      return true;
    });
  const normalized = updatedLines.join('\n').replace(/\n{3,}/g, '\n\n');
  await writeFile(envPath, normalized.endsWith('\n') ? normalized : `${normalized}\n`, 'utf-8');
}

function printServerDetail(
  ctx: ErrorContext,
  diag: DiagnosticsContext,
  options: ServerDetailOptions = {},
): void {
  const includeServerMessage = options.includeServerMessage ?? true;
  const includeServerCode = options.includeServerCode ?? true;

  if (includeServerMessage && ctx.serverMessage) {
    out.info(`Server: ${ctx.serverMessage}`);
  }
  if (ctx.requestId) {
    out.info(`Request ID: ${ctx.requestId}`);
  }
  if (diag.debug && ctx.status) {
    out.info(`HTTP status: ${ctx.status}`);
  }
  if (diag.debug && includeServerCode && ctx.serverCode) {
    out.info(`Server code: ${ctx.serverCode}`);
  }
}

function printProvisionFallback(reference: string): void {
  out.info(`Reference: ${reference}`);
  out.info('Retry after confirming you are logged in and have selected the correct tenant.');
  out.info('If this continues, contact your platform administrator.');
  out.info('Manual fallback: set ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET in .env.local.');
}

function printGuidance(code: ErrorCode, context?: Record<string, string>): void {
  const guidance = findGuidanceByCode(code);
  if (guidance) {
    out.error(formatGuidanceText(guidance, context));
  }
}

function tenantLabel(diag: DiagnosticsContext): string {
  if (diag.tenantSlug && diag.tenantId) {
    return `${chalk.cyan(diag.tenantSlug)} (${chalk.dim(diag.tenantId)})`;
  }
  return chalk.cyan(diag.tenantSlug ?? diag.tenantId ?? 'unknown');
}

function isAuthConfigErrorMessage(message: string): boolean {
  return message.includes('Stored CLI login does not match the active auth configuration')
    || message.includes('no CLI public client ID was provided');
}

function handleProvisionError(err: unknown, diag: DiagnosticsContext): never {
  const ctx = readErrorContext(err);
  const status = ctx.status;

  if (status === 404) {
    out.error('Entra provisioning is not available for this tenant or platform instance.');
    printServerDetail(ctx, diag, { includeServerMessage: false, includeServerCode: false });
    printProvisionFallback('EAI-PROVISION-UNAVAILABLE');
    process.exit(1);
  }
  if (status === 501) {
    out.error('Entra provisioning is not available on this platform instance.');
    printServerDetail(ctx, diag, { includeServerMessage: false, includeServerCode: false });
    printProvisionFallback('EAI-PROVISION-UNAVAILABLE');
    process.exit(1);
  }
  if (status === 403) {
    out.error(`Permission denied for tenant ${tenantLabel(diag)}.`);
    printServerDetail(ctx, diag);
    out.info('Confirm role with: eai whoami --verbose && eai tenant list');
    if (diag.userOid) {
      out.info(
        `Platform team can verify membership at /v4/platform/users/${diag.userOid}/memberships`,
      );
    }
    out.info('Reference: EAI-PROVISION-FORBIDDEN');
    printGuidance(ErrorCode.E204);
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

function handleSecretRotationError(err: unknown, diag: DiagnosticsContext): never {
  const ctx = readErrorContext(err);
  out.error('Entra client secret rotation failed.');
  printServerDetail(ctx, diag);
  out.info('Reference: EAI-PROVISION-ROTATE-SECRET-FAILED');
  out.info('Confirm you are a tenant admin and ENTRA_CLIENT_ID belongs to the active tenant.');
  process.exit(1);
}

function handleDeprovisionError(err: unknown, diag: DiagnosticsContext): never {
  const ctx = readErrorContext(err);
  out.error('Entra app deprovisioning failed.');
  printServerDetail(ctx, diag);
  out.info('Reference: EAI-PROVISION-DEAUTHORIZE-FAILED');
  out.info('Confirm you are a tenant admin and the client id belongs to the active tenant.');
  process.exit(1);
}

async function formatJsonResponseError(response: Response, label: string): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `${label} failed: ${response.status} ${response.statusText}`;
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
    return `${label} failed: ${response.status} ${response.statusText}${message ? ` — ${message}` : ''}`;
  } catch {
    return `${label} failed: ${response.status} ${response.statusText} — ${text.slice(0, 300)}`;
  }
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
  .description('Provision platform resources for this app');

// ─── eai provision entra ──────────────────────────────────────────────────

provisionCommand
  .command('entra')
  .description('Create an Entra app registration for end-user auth (Auth.js)')
  .option('--force', 'Re-check the remote app registration even if ENTRA_CLIENT_ID already exists locally', false)
  .option('--rotate-secret', 'Rotate the existing ENTRA_CLIENT_ID secret and write the new value to .env.local', false)
  .option('--deauthorize', 'Remove tenant authorization and delete the Entra app registration for cleanup', false)
  .option('--client-id <id>', 'Client ID to deauthorize; defaults to ENTRA_CLIENT_ID in .env.local')
  .option('--keep-registration', 'Only remove tenant authorization; do not delete the Entra app registration', false)
  .option(
    '--redirect-uri <uri>',
    'Additional OAuth redirect URI to register (e.g. a deployed callback). Repeatable. Registered alongside the local callback; the platform merges with existing URIs.',
    (val: string, prev: string[]) => prev.concat(val),
    [] as string[],
  )
  .option('--debug', 'Print product-safe diagnostic status and request identifiers on failure', false)
  .addHelpText('after', `
Examples:
  $ eai provision entra
  $ eai provision entra --force
  $ eai provision entra --rotate-secret
  $ eai provision entra --deauthorize --force
  $ eai provision entra --redirect-uri https://abc.com/api/auth/callback/microsoft-entra-id

What happens:
  - Calls the platform provisioning API to create an Entra app registration
  - Writes ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET to .env.local
  - If the registration already exists, confirms ENTRA_CLIENT_ID without rotating the secret
  - With --rotate-secret, rotates the existing app registration secret through the platform API
  - With --deauthorize --force, removes tenant authorization, deletes the app registration, and removes local ENTRA_CLIENT_ID/SECRET
  - With --redirect-uri, registers the given deployed callback(s) in addition to the local one (the platform merges them with any already registered)

Diagnostics:
  - Uses the PublicAPI URL from the active profile, .env.local BASE_URL_PUBLIC_API, environment, or the default API
  - Default/no profile uses the public API; private profiles use their locally configured API
  - The platform chooses the matching CIAM from its deployment configuration; the CLI never sends a CIAM selector
  - Errors are product-safe and include a support reference without exposing platform internals
  `)
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) {
      exitWithError(ErrorCode.E001);
    }

    const env = await loadEnvFile(root);
    const appName = env.NEXT_PUBLIC_APP_NAME;

    if (!appName) {
      out.error('NEXT_PUBLIC_APP_NAME is not set in .env.local. Run `eai init` to scaffold an app first.');
      process.exit(1);
    }

    // Check if ENTRA_CLIENT_ID already exists
    if (hasUsableLocalEntraClientId(env) && !options.force && !options.rotateSecret && !options.deauthorize) {
      out.warn(`ENTRA_CLIENT_ID is already set for ${chalk.cyan(appName)}.`);
      out.info(`Use ${chalk.cyan('eai provision entra --force')} to re-check the remote registration and confirm ENTRA_CLIENT_ID.`);
      out.info(`Use ${chalk.cyan('eai provision entra --rotate-secret')} to rotate and write a new ENTRA_CLIENT_SECRET.`);
      out.info(`Use ${chalk.cyan('eai provision entra --deauthorize --force')} to clean up the app registration.`);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAuthConfigErrorMessage(message)) {
        out.error(message);
        out.info('Run `eai login` again after sourcing the intended environment, then retry provisioning.');
        process.exit(1);
      }
      out.error('Failed to resolve active tenant.');
      out.info(`Run ${chalk.cyan('eai login')} and ${chalk.cyan('eai tenant select')} first.`);
      process.exit(1);
    }

    const diag: DiagnosticsContext = { tenantSlug, tenantId, userOid, debug: Boolean(options.debug) };

    const client = new PlatformAPIClient(publicApiUrl, tenantId);

    if (options.deauthorize) {
      if (options.rotateSecret) {
        out.error('Choose either --deauthorize or --rotate-secret, not both.');
        process.exit(1);
      }
      if ((options.redirectUri as string[] | undefined)?.length) {
        out.error('Do not combine --deauthorize with --redirect-uri.');
        process.exit(1);
      }
      if (!options.force) {
        out.error('Refusing to deauthorize without explicit confirmation.');
        out.info(`Re-run with ${chalk.cyan('eai provision entra --deauthorize --force')}.`);
        process.exit(1);
      }

      const localClientId = normalizeLocalEntraSetting(env.ENTRA_CLIENT_ID);
      const clientId = normalizeLocalEntraSetting(options.clientId) ?? localClientId;
      if (!clientId) {
        out.error('No Entra client id was provided or found in .env.local.');
        out.info('Pass --client-id <id>, or run from a project with ENTRA_CLIENT_ID in .env.local.');
        process.exit(1);
      }

      out.info(`Deauthorizing Entra app registration for ${chalk.cyan(appName)}...`);
      try {
        const result = await client.deprovisionEntraApp({
          tenantId,
          clientId,
          deleteRegistration: !options.keepRegistration,
        });
        const localEnvCleaned = localClientId === clientId;
        if (localEnvCleaned) {
          await removeEnvFileKeys(root, ['ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET']);
        } else if (localClientId) {
          out.warn('Local ENTRA_CLIENT_ID belongs to a different app; leaving .env.local unchanged.');
        }
        out.success(`Entra app cleanup complete for ${chalk.cyan(appName)}`);
        out.table([
          ['Client ID', chalk.dim(result.clientId)],
          ['Tenant authorization removed', result.tenantDeauthorization.removed ? chalk.green('yes') : chalk.yellow('already absent')],
          ['App registration found', result.appRegistrationFound ? 'yes' : 'no'],
          ['App registration deleted', result.appRegistrationDeleted ? 'yes' : options.keepRegistration ? 'kept' : 'already absent'],
          ['Local env cleaned', localEnvCleaned ? 'ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET' : 'not changed'],
        ]);
        return;
      } catch (err) {
        handleDeprovisionError(err, diag);
      }
    }

    if (options.rotateSecret) {
      if (!hasUsableLocalEntraClientId(env)) {
        out.error('ENTRA_CLIENT_ID is not set in .env.local. Run `eai provision entra` first.');
        process.exit(1);
      }
      out.info(`Rotating Entra client secret for ${chalk.cyan(appName)}...`);
      try {
        const rotated = await client.rotateEntraAppSecret({
          tenantId,
          clientId: normalizeLocalEntraSetting(env.ENTRA_CLIENT_ID)!,
        });
        await patchEnvFile(root, {
          ENTRA_CLIENT_ID: rotated.clientId,
          ENTRA_CLIENT_SECRET: rotated.clientSecret,
          EAI_TENANT_ID: rotated.tenantId,
        });
        out.success(`Entra client secret rotated for ${chalk.cyan(appName)}`);
        out.table([
          ['Client ID', chalk.dim(rotated.clientId)],
          ['Client Secret', chalk.dim('[written to .env.local]')],
          ['Expires', chalk.dim(rotated.expiresAt || 'unknown')],
        ]);
        out.warn('The new client secret has been written to .env.local and cannot be retrieved again.');
        out.warn('Do NOT commit .env.local to source control.');
        return;
      } catch (err) {
        handleSecretRotationError(err, diag);
      }
    }

    out.info(`Provisioning Entra app registration for ${chalk.cyan(appName)}...`);

    let result: {
      clientId: string;
      clientSecret: string | null;
      existing: boolean;
      scopes: string[];
      redirectUris: string[];
      environment: string | null;
      tenantId: string | null;
      tenantAuthorization: TenantAuthorizationSummary | null;
      signinCompleteness: SigninCompletenessSummary | null;
    };
    const authRuntime = resolveAuthRuntime(env);
    const localCallback = `${authRuntime.siteUrl}/api/auth/callback/microsoft-entra-id`;
    // Local callback first, then any deployed callbacks passed via --redirect-uri,
    // deduped. The platform merges these with already-registered URIs (additive),
    // so this never drops a previously-registered deployed callback.
    const extraRedirectUris = (options.redirectUri as string[] | undefined) ?? [];
    const redirectUris = [localCallback, ...extraRedirectUris.filter((u) => u !== localCallback)];

    try {
      result = await client.provisionEntraApp({
        tenantId,
        appName,
        redirectUris,
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
    optionalEnv.ENTRA_REDIRECT_URIS = redirectUris.join(' ');
    optionalEnv.AUTH_URL = authRuntime.siteUrl;
    optionalEnv.NEXTAUTH_URL = authRuntime.siteUrl;
    optionalEnv.AUTH_TRUST_HOST = 'true';
    if (result.environment) {
      optionalEnv.ENTRA_ENVIRONMENT = result.environment;
    }
    if (result.tenantId) {
      optionalEnv.EAI_TENANT_ID = result.tenantId;
    }

    // Persist the Entra directory (authority) tenant id + name from the
    // authenticated session so Auth.js can construct the issuer URL without a
    // follow-up `eai env pull`. These come from the login token, not the
    // platform provision response.
    const tokens = await loadTokens();
    if (tokens?.tenantId) {
      optionalEnv.ENTRA_TENANT_ID = tokens.tenantId;
    }
    if (tokens?.tenantName) {
      optionalEnv.ENTRA_TENANT_NAME = tokens.tenantName;
    }

    if (result.existing && !result.clientSecret) {
      out.info(`App registration already exists for ${chalk.cyan(appName)}.`);
      if (hasUsableLocalEntraSecret(env)) {
        out.info('Your existing ENTRA_CLIENT_SECRET in .env.local remains valid.');
      } else {
        out.error('No usable ENTRA_CLIENT_SECRET is available locally for the existing app registration.');
        out.info('Run `eai provision entra --rotate-secret` to generate a new local secret, or set ENTRA_CLIENT_SECRET in .env.local.');
        process.exit(1);
      }
      await patchEnvFile(root, { ENTRA_CLIENT_ID: result.clientId, ...optionalEnv });
      out.success(`ENTRA_CLIENT_ID confirmed: ${chalk.dim(result.clientId)}`);
      if (Object.keys(optionalEnv).length > 0) {
        out.info(`Refreshed env vars from platform response: ${Object.keys(optionalEnv).join(', ')}`);
      } else {
        out.warn('Platform response did not include scopes/redirect URIs — set ENTRA_SCOPES manually.');
      }
      reportTenantAuthorization(result.tenantAuthorization, result.clientId);
      reportSigninCompleteness(result.signinCompleteness, result.clientId);
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

    out.success(`Entra app registration created for ${chalk.cyan(appName)}`);
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
    if (optionalEnv.ENTRA_TENANT_ID) {
      tableRows.push(['Directory Tenant ID', chalk.dim(optionalEnv.ENTRA_TENANT_ID)]);
    }
    if (optionalEnv.ENTRA_TENANT_NAME) {
      tableRows.push(['Directory Tenant', chalk.dim(optionalEnv.ENTRA_TENANT_NAME)]);
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

    // Surface the management API's post-provision sign-in wiring rollup. When the API
    // permission merge / admin consent / preAuthorizedApplications steps
    // failed silently, the app reg looks "created" but cannot reach
    // platform API from a user session — sign-in then fails with AADSTS650057
    // the moment the app's BFF proxy makes its first call. Refusing to
    // exit 0 here turns that silent failure into a loud, actionable one.
    reportTenantAuthorization(result.tenantAuthorization, result.clientId);
    reportSigninCompleteness(result.signinCompleteness, result.clientId);
  });

// ─── eai provision resourceapi-refresh ──────────────────────────────────

provisionCommand
  .command('resourceapi-refresh')
  .description('Refresh a passive customer storage schema snapshot through the management service')
  .requiredOption('--admin-api-url <url>', 'Management service URL for server-backed orchestration')
  .option('--tenant-id <id>', 'Tenant ID the refresh is scoped to')
  .option('--install-id <id>', 'Customer storage install registry ID')
  .option('--apply', 'Apply the refreshed snapshot after planning', false)
  .option('--dry-run', 'With --apply, ask the storage service to plan schema application without writing', false)
  .option('--backend <backend>', 'postgresql|mongodb|documentdb|blob|search|all', 'all')
  .option('--rebuild-search', 'Request search projection rebuild after schema sync', false)
  .option('--force-overwrite', 'Allow the passive snapshot to overwrite an existing schema version', false)
  .option('--no-verify', 'Skip storage schema-status verification after apply')
  .option('--no-update-install-registry', 'Do not update the tenant install registry schema hash after apply')
  .option('--reason <text>', 'Human-readable reason for a real schema refresh apply')
  .option('--change-ticket <id>', 'Support/change ticket for audit trail')
  .option('--product <key>', 'Product/app key this refresh enables')
  .option('--schema-version <version>', 'Tenant schema version to stamp into metadata', '1')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai provision resourceapi-refresh --admin-api-url https://admin-api.example --tenant-id <tenantId> --install-id <installId>
  $ eai provision resourceapi-refresh --admin-api-url https://admin-api.example --tenant-id <tenantId> --install-id <installId> --apply --dry-run --force-overwrite
  $ eai provision resourceapi-refresh --admin-api-url https://admin-api.example --tenant-id <tenantId> --install-id <installId> --apply --force-overwrite --reason "Repair passive schema drift"

Notes:
  - This is a super-admin repair path for passive customer storage schema metadata.
  - It updates the tenant install registry only after the storage service accepts and verifies the refreshed snapshot.
  `)
  .action(async (options) => {
    const jsonOutput = options.json || options.format === 'json';
    const adminApiUrl = String(options.adminApiUrl || '').trim().replace(/\/+$/, '');
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

    const token = await getAccessToken();
    if (!token) {
      out.error('Not logged in. Run `eai login` before calling server-backed provisioning.');
      process.exit(1);
    }

    const response = await fetch(
      `${adminApiUrl}/v4/platform/tenants/${encodeURIComponent(tenantId)}/resourceapi/passive-refresh`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          installId: options.installId,
          productKey: options.product,
          schemaVersion: options.schemaVersion,
          apply: Boolean(options.apply),
          dryRun: Boolean(options.dryRun),
          backend: options.backend,
          rebuildSearch: Boolean(options.rebuildSearch),
          forceOverwrite: Boolean(options.forceOverwrite),
          verify: options.verify !== false,
          updateInstallRegistry: options.updateInstallRegistry !== false,
          reason: options.reason,
          changeTicket: options.changeTicket,
        }),
      },
    );
    if (!response.ok) {
      out.error(await formatJsonResponseError(response, 'passive customer storage schema refresh'));
      process.exit(1);
    }

    const payload = await response.json() as {
      tenantId: string;
      installId: string;
      schemaHash: string;
      objectTypeCount: number;
      storageBackends: string[];
      verified: boolean;
      installRegistryUpdated: boolean;
      currentDiff?: { missingObjectTypes?: string[] };
      verifyDiff?: { missingObjectTypes?: string[] } | null;
    };

    if (jsonOutput) {
      out.json(payload);
      return;
    }

    out.success(options.apply ? 'Passive customer storage schema refresh applied' : 'Passive customer storage schema refresh planned');
    out.info(`Tenant: ${chalk.cyan(payload.tenantId)}`);
    out.info(`Install: ${chalk.dim(payload.installId)}`);
    out.info(`Object Types: ${payload.objectTypeCount}`);
    out.info(`Storage Backends: ${payload.storageBackends.join(', ')}`);
    out.info(`Schema Hash: ${chalk.dim(payload.schemaHash)}`);
    out.info(`Verified: ${payload.verified ? 'yes' : 'no'}`);
    out.info(`Install Registry Updated: ${payload.installRegistryUpdated ? 'yes' : 'no'}`);
    const missing = payload.verifyDiff?.missingObjectTypes || payload.currentDiff?.missingObjectTypes || [];
    if (missing.length) {
      out.warn(`Missing Object Types: ${missing.join(', ')}`);
    }
  });

function normaliseBasePath(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed || trimmed === '/') {
    return '';
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

function stripAuthEndpointPath(pathname: string): string {
  if (pathname === '/api/auth') {
    return '/';
  }
  return pathname.endsWith('/api/auth')
    ? pathname.slice(0, -'/api/auth'.length) || '/'
    : pathname;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveAuthRuntime(env: Record<string, string>): { siteUrl: string } {
  const basePath = normaliseBasePath(env.APP_BASE_PATH);
  const rawUrl = env.NEXTAUTH_URL || env.AUTH_URL || 'http://localhost:3000';

  try {
    const url = new URL(rawUrl);
    url.pathname = basePath || stripAuthEndpointPath(url.pathname);
    url.search = '';
    url.hash = '';
    return { siteUrl: stripTrailingSlash(url.toString()) };
  } catch {
    return { siteUrl: `http://localhost:3000${basePath}` };
  }
}

function reportSigninCompleteness(
  summary: SigninCompletenessSummary | null,
  clientId: string,
): void {
  if (!summary) {
    // Older PublicAPI deployments don't relay this field. We can't tell
    // success from failure, so don't claim either way — silent.
    return;
  }
  if (summary.signinReady) {
    out.success('Sign-in wiring complete: app reg has Graph + PublicAPI delegated permissions, admin consent, and preAuthorizedApplications.');
    return;
  }
  // Not ready — emit a structured error block and exit non-zero so
  // onboarding scripts fail fast instead of producing a broken app.
  out.error('Sign-in wiring incomplete — provisioning succeeded but the new app reg cannot reach PublicAPI from a user session.');
  out.warn('  ✗ Without the steps below, browser sign-in will fail with AADSTS650057 the moment the BFF proxy calls PublicAPI.');
  const stepRow = (label: string, ok: boolean): [string, string] => [
    label,
    ok ? chalk.green('✓ done') : chalk.red('✗ missing'),
  ];
  out.table([
    stepRow('Graph delegated perms', summary.graphPermsAdded),
    stepRow('PublicAPI delegated perms', summary.publicapiPermsAdded),
    stepRow('Admin consent', summary.consentGranted),
    stepRow('preAuthorizedApplications', summary.publicapiPreauthorized),
  ]);
  if (summary.warnings.length > 0) {
    out.warn('Reasons:');
    for (const w of summary.warnings) {
      out.warn(`  - ${w}`);
    }
  }
  out.warn('Remediation:');
  out.warn(`  1. Azure portal → Microsoft Entra ID → App registrations → ${chalk.cyan(clientId)}`);
  out.warn('  2. API permissions → Add a permission → APIs my organization uses → select PublicAPI → Delegated permissions → access_token → Add');
  out.warn('  3. Grant admin consent for the directory tenant');
  out.warn('  4. Re-run sign-in (clear localhost cookie / use Incognito)');
  out.warn('Or: ask your platform team to review the public provisioning support reference for this tenant.');
  process.exit(1);
}

function reportTenantAuthorization(
  summary: TenantAuthorizationSummary | null,
  clientId: string,
): void {
  if (!summary) {
    out.warn('Tenant data-plane authorization status was not reported by PublicAPI.');
    out.warn('Run `eai user provision-me` after provisioning to verify tenant access.');
    return;
  }

  if (summary.warning || (!summary.added && !summary.alreadyAuthorized)) {
    if (summary.warning) {
      out.warn(`Reason: ${summary.warning}`);
    }
    out.warn(`App client ID: ${chalk.cyan(clientId)}`);
    const code = summary.warning?.includes('502') || summary.warning?.includes('5xx')
      ? ErrorCode.E243
      : ErrorCode.E242;
    printGuidance(code);
    process.exit(1);
  }

  out.success(
    summary.added
      ? 'Tenant data-plane authorization complete: app was added to the tenant allowlist.'
      : 'Tenant data-plane authorization complete: app was already on the tenant allowlist.',
  );
}

// ─── eai provision storage ───────────────────────────────────────────────

provisionCommand
  .command('storage')
  .description('Provision storage for the active tenant')
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

// ─── eai provision resourceapi-bundle ────────────────────────────────────

provisionCommand
  .command('resourceapi-bundle')
  .description('Prepare a customer-hosted storage schema bundle')
  .option('--schema <file>', 'Object-types export JSON for local bundle generation')
  .option('--tenant-id <id>', 'Tenant ID the bundle is scoped to')
  .option('--install-id <id>', 'Customer storage install registry ID')
  .option('--admin-api-url <url>', 'Management service URL for server-backed orchestration')
  .option('--apply', 'Ask the management service to push the signed bundle to the customer storage install', false)
  .option('--dry-run', 'Plan schema application without applying customer storage changes', false)
  .option('--backend <backend>', 'postgresql|mongodb|documentdb|blob|search|all', 'all')
  .option('--rebuild-search', 'Request search projection rebuild after schema sync', false)
  .option('--product <key>', 'Product/app key this bundle enables')
  .option('--schema-version <version>', 'Tenant schema version to stamp into metadata', '1')
  .option('--out <file>', 'Write bundle JSON to this file')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai provision resourceapi-bundle --schema object-types.json --tenant-id <tenantId> --install-id <installId> --out resourceapi-bundle.json
  $ eai provision resourceapi-bundle --admin-api-url https://admin-api.example --tenant-id <tenantId> --install-id <installId> --apply
  $ eai provision resourceapi-bundle --schema object-types.json --tenant-id <tenantId> --install-id <installId> --product daisy-assist --format json

Notes:
  - With --admin-api-url, the management service reads the platform schema source of truth, signs the bundle, and can push it.
  - Local --schema mode is for offline inspection only and does not own provisioning policy.
  `)
  .action(async (options) => {
    const jsonOutput = options.json || options.format === 'json';
    const adminApiUrl = String(options.adminApiUrl || '').trim().replace(/\/+$/, '');

    if (adminApiUrl) {
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

      const token = await getAccessToken();
      if (!token) {
        out.error('Not logged in. Run `eai login` before calling server-backed provisioning.');
        process.exit(1);
      }

      const response = await fetch(
        `${adminApiUrl}/v4/platform/tenants/${encodeURIComponent(tenantId)}/resourceapi/passive-bundle`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            installId: options.installId,
            productKey: options.product,
            schemaVersion: options.schemaVersion,
            apply: Boolean(options.apply),
            dryRun: Boolean(options.dryRun),
            backend: options.backend,
            rebuildSearch: Boolean(options.rebuildSearch),
          }),
        },
      );
      if (!response.ok) {
        out.error(await formatJsonResponseError(response, 'storage schema bundle provisioning'));
        process.exit(1);
      }

      const payload = await response.json() as {
        tenantId: string;
        installId: string;
        objectTypeCount: number;
        storageBackends: string[];
        bundle: Record<string, unknown>;
        applyResult?: Record<string, unknown> | null;
      };

      if (options.out) {
        await writeFile(options.out, `${JSON.stringify(payload.bundle, null, 2)}\n`, 'utf-8');
      }

      if (jsonOutput) {
        out.json(payload);
        return;
      }

      if (options.apply) {
        out.success('Storage schema bundle applied through the management service');
      } else if (options.out) {
        out.success(`Storage schema bundle written to ${chalk.cyan(options.out)}`);
      } else {
        out.success('Storage schema bundle prepared through the management service');
      }
      out.info(`Tenant: ${chalk.cyan(payload.tenantId)}`);
      out.info(`Install: ${chalk.dim(payload.installId)}`);
      out.info(`Object Types: ${payload.objectTypeCount}`);
      out.info(`Storage Backends: ${payload.storageBackends.join(', ')}`);
      return;
    }

    const schemaPath = String(options.schema || '').trim();
    if (!schemaPath || !options.tenantId || !options.installId) {
      out.error('--schema, --tenant-id, and --install-id are required for local bundle generation.');
      out.info('Use --admin-api-url to let the management service build the bundle from the platform schema source of truth.');
      process.exit(1);
    }

    const raw = await readFile(schemaPath, 'utf-8');
    const schemaExport = JSON.parse(raw) as unknown;
    const bundle = buildPassiveResourceApiBundle(schemaExport, {
      tenantId: options.tenantId,
      installId: options.installId,
      productKey: options.product,
      schemaVersion: options.schemaVersion,
      source: schemaPath,
    });

    if (options.out) {
      await writeFile(options.out, `${JSON.stringify(bundle, null, 2)}\n`, 'utf-8');
    }

    if (jsonOutput) {
      out.json(bundle);
      return;
    }

    if (options.out) {
      out.success(`Storage schema bundle written to ${chalk.cyan(options.out)}`);
    } else {
      out.info(JSON.stringify(bundle, null, 2));
    }
    out.info(`Tenant: ${chalk.cyan(bundle.tenantId)}`);
    out.info(`Install: ${chalk.dim(bundle.installId)}`);
    out.info(`Object Types: ${bundle.objectTypes.length}`);
    out.info(`Storage Backends: ${bundle.storageBackends.join(', ')}`);
  });
