/**
 * eai login — authenticate with Entra CIAM via browser auth (PKCE).
 *
 * Plain `eai login` goes through the sign-in directory's Admin Portal page,
 * which routes school and company emails to their own sign-in. `--company`
 * opens the company sign-in page directly, and `--direct` (or
 * EAI_LOGIN_VIA_PORTAL=false) keeps the original direct flow.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  clearTokens,
  COMPANY_SIGN_IN_NOT_SET_UP,
  getActiveAuthConfigMismatch,
  resolveAuthConfig,
  storeTokens,
  validateResolvedAuthConfig,
} from '../lib/auth.js';
import { LOGIN_NOT_SAVED, planSignIn, runSignIn, type SignInOutcome, type SignInPlan } from '../lib/sign-in-flow.js';
import { findProjectRoot } from '../lib/config.js';
import {
  buildPublicApiEnvSyncNotice,
  resolveActiveTenantContext,
  resolvePublicApiUrl,
} from '../lib/tenant-context.js';
import { assertActiveProfileApiCoherence, getActiveProfile } from '../lib/profile.js';
import * as out from '../lib/output.js';

function parseCallbackPort(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid callback port: ${value}`);
  }

  return port;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `eai login`: browser PKCE sign-in (through the Admin Portal routing page, `--company` or `--direct`), then active workspace resolution. */
export const loginCommand = new Command('login')
  .description('Authenticate with Entra CIAM using your configured sign-in directory')
  .option('--tenant-name <name>', 'CIAM tenant name')
  .option('--tenant-id <id>', 'CIAM tenant ID')
  .option('--scope <scope>', 'OAuth scopes')
  .option('--callback-port <port>', 'Localhost port to listen on for the OAuth callback')
  .option('--company', 'Sign in with a school or company account on the company sign-in page, without the Admin Portal step')
  .option('--direct', 'Skip the Admin Portal step and open the ordinary sign-in page, as earlier CLI versions did')
  .option('--switch-account', 'With the direct sign-in, ask the browser which account to use, even when it is already signed in')
  .addHelpText('after', `
Examples:
  $ eai login
  $ eai login --company
  $ eai login --direct
  $ eai login --tenant-name myorg --tenant-id 12345678-abcd-efgh-ijkl-123456789012
  $ eai login --callback-port 3476
  $ eai login --direct --switch-account
  $ eai whoami

What happens next:
  - The CLI opens your sign-in directory's Admin Portal page and also prints its link. Type your email:
    school and company accounts go straight to their own sign-in, other accounts to the ordinary sign-in page.
  - --company opens the company sign-in page directly, without the Portal step (school or company accounts).
  - --direct, or EAI_LOGIN_VIA_PORTAL=false, skips the Portal step and opens the ordinary sign-in page.
  - With --switch-account, the direct sign-in shows the browser's account picker instead of reusing the signed-in session.
    The Portal and --company sign-ins always ask you to sign in again.
  - After a Portal or --company sign-in, the CLI shows the signed-in account. If it differs from the email you
    typed, it asks before saving the login.
  - With --callback-port, the CLI still uses localhost and listens on that exact port for both the Portal step and the sign-in callback.
  - For Codespaces, run 'gh codespace ports forward -c <codespace> 3476:3476' on your local machine and keep it running while you sign in.
  - If you only have one workspace admin membership, it becomes active automatically.
  - If you have more than one, run 'eai workspace select' to choose the workspace to work with.
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
    if (options.company && options.direct) {
      out.error('Use either --company or --direct, not both.');
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

    // The Portal is chosen by sign-in directory ID (never by region); --company,
    // --direct, EAI_LOGIN_VIA_PORTAL=false and unknown directories skip it.
    let callbackPort: number | undefined;
    let plan: SignInPlan;
    try {
      callbackPort = parseCallbackPort(options.callbackPort);
      plan = planSignIn(resolvedConfig, {
        tenantId,
        company: options.company,
        direct: options.direct,
        tenantFlagsGiven: Boolean(options.tenantName || options.tenantId),
      });
    } catch (err) {
      const message = errorMessage(err);
      out.error(message === COMPANY_SIGN_IN_NOT_SET_UP ? message : `Login failed: ${message}`);
      process.exit(1);
    }

    out.heading('Authenticating with Entra CIAM');
    if (profile !== 'default') {
      out.info(`Profile: ${chalk.cyan(profile)}`);
    }
    out.info(`Sign-in directory: ${chalk.cyan(tenantName)}`);

    let outcome: SignInOutcome;
    try {
      outcome = await runSignIn(plan, {
        tenantName,
        tenantId,
        clientId,
        scope,
        callbackPort,
        switchAccount: options.switchAccount,
        info: (message) => out.info(message),
      });
    } catch (err) {
      out.error(`Login failed: ${errorMessage(err)}`);
      process.exit(1);
    }

    if (!outcome.confirmed) {
      // The tokens were never written, so discarding them leaves any earlier login untouched.
      out.error(LOGIN_NOT_SAVED);
      process.exit(1);
    }
    const { tokens } = outcome;

    try {
      // Store bare tokens now so the cache is populated for the tenant resolution call
      await storeTokens(tokens);

      out.blank();
      out.success(`Authenticated as ${chalk.bold(tokens.upn || 'user')}`);
      out.info(`Token expires: ${new Date(tokens.expiresAt).toLocaleString()}`);

      try {
        const projectRoot = await findProjectRoot();
        await assertActiveProfileApiCoherence(projectRoot || undefined);
        const mismatch = await getActiveAuthConfigMismatch(tokens, projectRoot || undefined);
        if (mismatch) throw new Error(mismatch);
        const publicApiUrl = await resolvePublicApiUrl(projectRoot || undefined);
        const context = await resolveActiveTenantContext({
          projectRoot: projectRoot || undefined,
          publicApiUrl,
          interactive: true,
        });
        out.info(`Active workspace: ${chalk.cyan(context.activeTenant.displayName)} ${chalk.dim(`(${context.activeTenant.slug})`)}`);
        const notice = buildPublicApiEnvSyncNotice(context.publicApiEnvSync);
        if (notice?.level === 'warn') {
          out.warn(notice.message);
        } else if (notice) {
          out.success(notice.message);
        }
      } catch (selectionError) {
        out.warn(errorMessage(selectionError));
        out.info(`Run ${chalk.cyan('eai workspace select')} after login to choose the workspace to work with.`);
      }
    } catch (err) {
      out.error(`Login failed: ${errorMessage(err)}`);
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
