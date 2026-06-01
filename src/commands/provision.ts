/**
 * eai provision — provision platform resources for an app.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile, patchEnvFile } from '../lib/config.js';
import { resolveActiveTenantContext, resolvePublicApiUrl } from '../lib/tenant-context.js';
import { PlatformAPIClient, PlatformAPIRequestError, type SigninCompletenessSummary } from '../lib/api.js';
import { loadTokens } from '../lib/auth.js';
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
  if (diag.debug && ctx.status) {
    out.info(`HTTP status: ${ctx.status}`);
  }
  if (diag.debug && ctx.serverCode) {
    out.info(`Server code: ${ctx.serverCode}`);
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
        `Platform team can verify membership at /v4/platform/users/${diag.userOid}/memberships`,
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

function handleSecretRotationError(err: unknown, diag: DiagnosticsContext): never {
  const ctx = readErrorContext(err);
  out.error('Entra client secret rotation failed.');
  printServerDetail(ctx, diag);
  out.info('Reference: EAI-PROVISION-ROTATE-SECRET-FAILED');
  out.info('Confirm you are a tenant admin and ENTRA_CLIENT_ID belongs to the active tenant.');
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
  .description('Provision platform resources for this app');

// ─── eai provision entra ──────────────────────────────────────────────────

provisionCommand
  .command('entra')
  .description('Create an Entra app registration for end-user auth (Auth.js)')
  .option('--force', 'Re-check the remote app registration even if ENTRA_CLIENT_ID already exists locally', false)
  .option('--rotate-secret', 'Rotate the existing ENTRA_CLIENT_ID secret and write the new value to .env.local', false)
  .option('--debug', 'Print product-safe diagnostic status and request identifiers on failure', false)
  .addHelpText('after', `
Examples:
  $ eai provision entra
  $ eai provision entra --force
  $ eai provision entra --rotate-secret

What happens:
  - Calls the platform provisioning API to create an Entra app registration
  - Writes ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET to .env.local
  - If the registration already exists, confirms ENTRA_CLIENT_ID without rotating the secret
  - With --rotate-secret, rotates the existing app registration secret through the platform API

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
    const verticalName = env.NEXT_PUBLIC_APP_NAME;

    if (!verticalName) {
      out.error('NEXT_PUBLIC_APP_NAME is not set in .env.local. Run `eai init` to scaffold an app first.');
      process.exit(1);
    }

    // Check if ENTRA_CLIENT_ID already exists
    if (env.ENTRA_CLIENT_ID && !options.force && !options.rotateSecret) {
      out.warn(`ENTRA_CLIENT_ID is already set for ${chalk.cyan(verticalName)}.`);
      out.info(`Use ${chalk.cyan('eai provision entra --force')} to re-check the remote registration and confirm ENTRA_CLIENT_ID.`);
      out.info(`Use ${chalk.cyan('eai provision entra --rotate-secret')} to rotate and write a new ENTRA_CLIENT_SECRET.`);
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

    const client = new PlatformAPIClient(publicApiUrl, tenantId);

    if (options.rotateSecret) {
      if (!env.ENTRA_CLIENT_ID) {
        out.error('ENTRA_CLIENT_ID is not set in .env.local. Run `eai provision entra` first.');
        process.exit(1);
      }
      out.info(`Rotating Entra client secret for ${chalk.cyan(verticalName)}...`);
      try {
        const rotated = await client.rotateEntraAppSecret({
          tenantId,
          clientId: env.ENTRA_CLIENT_ID,
        });
        await patchEnvFile(root, {
          ENTRA_CLIENT_ID: rotated.clientId,
          ENTRA_CLIENT_SECRET: rotated.clientSecret,
          EAI_TENANT_ID: rotated.tenantId,
        });
        out.success(`Entra client secret rotated for ${chalk.cyan(verticalName)}`);
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

    out.info(`Provisioning Entra app registration for ${chalk.cyan(verticalName)}...`);

    let result: {
      clientId: string;
      clientSecret: string | null;
      existing: boolean;
      scopes: string[];
      redirectUris: string[];
      environment: string | null;
      tenantId: string | null;
      signinCompleteness: SigninCompletenessSummary | null;
    };
    const authRuntime = resolveAuthRuntime(env);
    const localCallback = `${authRuntime.siteUrl}/api/auth/callback/microsoft-entra-id`;

    try {
      result = await client.provisionEntraApp({
        tenantId,
        verticalName,
        redirectUris: [localCallback],
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
    optionalEnv.ENTRA_REDIRECT_URIS = localCallback;
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

    // Surface AdminAPI's post-provision sign-in wiring rollup. When the API
    // permission merge / admin consent / preAuthorizedApplications steps
    // failed silently, the app reg looks "created" but cannot reach
    // PublicAPI from a user session — sign-in then fails with AADSTS650057
    // the moment the app's BFF proxy makes its first call. Refusing to
    // exit 0 here turns that silent failure into a loud, actionable one.
    reportSigninCompleteness(result.signinCompleteness, result.clientId);
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
