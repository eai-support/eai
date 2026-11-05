/**
 * The sign-in routing shared by `eai login` and `eai create`'s inline sign-in
 * (Issues2025#3458, N3): the Admin Portal hop by default, `--company` for the
 * company sign-in page, and the direct flow for `--direct`,
 * EAI_LOGIN_VIA_PORTAL=false or a directory without a known Portal. Portal and
 * company sign-ins confirm the account before the caller stores the tokens.
 */

import chalk from 'chalk';
import {
  browserLogin,
  companyLogin,
  COMPANY_SIGN_IN_NOT_SET_UP,
  portalLogin,
  resolveCompanyClient,
  type ResolvedAuthConfig,
  type SignInResult,
  type StoredTokens,
} from './auth.js';
import {
  askYesNo,
  canPromptInTerminal,
  describeLoginConfirmation,
  isPortalLoginDisabled,
  resolvePortalUrl,
} from './company-sign-in.js';

/** Which sign-in to run. */
export type SignInPlan =
  | { readonly mode: 'company'; readonly companyClientId: string }
  | { readonly mode: 'portal'; readonly portalUrl: string; readonly companyClientId?: string }
  /** `portalUnknown`: the Portal was wanted, but this directory has none. */
  | { readonly mode: 'direct'; readonly portalUnknown: boolean };

export interface SignInPlanRequest {
  /** The effective sign-in directory ID (after `--tenant-id`). */
  readonly tenantId: string;
  readonly company?: boolean;
  readonly direct?: boolean;
  /** True when `--tenant-name` or `--tenant-id` was given: the PROD company default never applies then. */
  readonly tenantFlagsGiven?: boolean;
}

/**
 * Choose the sign-in. The Portal is chosen by sign-in directory ID, never by
 * region. Throws COMPANY_SIGN_IN_NOT_SET_UP for `--company` without a company
 * app, and a settings error for an invalid EAI_CLI_COMPANY_CLIENT_ID.
 */
export function planSignIn(config: ResolvedAuthConfig, request: SignInPlanRequest): SignInPlan {
  const resolveCompany = (): string | undefined =>
    resolveCompanyClient(config, { tenantFlagsGiven: request.tenantFlagsGiven })?.clientId;

  if (request.company) {
    const companyClientId = resolveCompany();
    if (!companyClientId) throw new Error(COMPANY_SIGN_IN_NOT_SET_UP);
    return { mode: 'company', companyClientId };
  }
  if (request.direct || isPortalLoginDisabled()) return { mode: 'direct', portalUnknown: false };

  const portalUrl = resolvePortalUrl(request.tenantId, config.portalUrl);
  if (!portalUrl) return { mode: 'direct', portalUnknown: true };
  const companyClientId = resolveCompany();
  return companyClientId ? { mode: 'portal', portalUrl, companyClientId } : { mode: 'portal', portalUrl };
}

export interface SignInRunOptions {
  readonly tenantName: string;
  readonly tenantId: string;
  /** The directory's ordinary CLI app. */
  readonly clientId: string;
  readonly scope: string;
  readonly callbackPort?: number;
  /** Direct flow only: send prompt=select_account. */
  readonly switchAccount?: boolean;
  /** Where progress lines go: `eai login` uses out.info, `eai create` its nested style. */
  readonly info: (message: string) => void;
}

/** The tokens, and whether the person confirmed the account (always true on the direct flow). */
export interface SignInOutcome {
  readonly tokens: StoredTokens;
  readonly confirmed: boolean;
}

/** Shown when the person declines to save a Portal or company login. */
export const LOGIN_NOT_SAVED =
  'Login not saved. Run `eai login` again and sign in with the account you meant to use.';

/**
 * D2/OV3: before a Portal or `--company` login is saved, show whose account
 * it is. A matching typed email saves without asking; with no terminal to
 * answer in, the default answer applies (yes for --company, no on a mismatch).
 */
async function confirmSignedInAccount(result: SignInResult, info: (message: string) => void): Promise<boolean> {
  const confirmation = describeLoginConfirmation({
    signedInEmail: result.signedInEmail,
    typedEmail: result.typedEmail,
    displayIdentity: result.tokens.upn,
  });
  if (!confirmation) return true;

  if (!canPromptInTerminal()) {
    info(`${confirmation.question} No terminal to answer in, so using the default: ${confirmation.defaultYes ? 'yes' : 'no'}.`);
    return confirmation.defaultYes;
  }
  return askYesNo(confirmation.question, confirmation.defaultYes);
}

/** Run the planned sign-in. The caller stores the tokens only when `confirmed` is true. */
export async function runSignIn(plan: SignInPlan, options: SignInRunOptions): Promise<SignInOutcome> {
  const showAuthorizeUrl = options.callbackPort === undefined
    ? undefined
    : (url: string) => options.info(`Open this URL in your local browser: ${chalk.cyan(url)}`);

  if (plan.mode === 'company') {
    options.info('Opening your browser to the company sign-in page...');
    const result = await companyLogin(options.tenantName, options.tenantId, plan.companyClientId, options.scope, {
      callbackPort: options.callbackPort,
      onAuthorizeUrl: showAuthorizeUrl,
    });
    return { tokens: result.tokens, confirmed: await confirmSignedInAccount(result, options.info) };
  }

  if (plan.mode === 'portal') {
    options.info('Opening the Admin Portal in your browser. Type your email there to choose how you sign in.');
    const result = await portalLogin(options.tenantName, options.tenantId, options.scope, {
      portalUrl: plan.portalUrl,
      standardClientId: options.clientId,
      companyClientId: plan.companyClientId,
      callbackPort: options.callbackPort,
      onPortalUrl: (url) => options.info(`If your browser doesn't open, go to: ${chalk.cyan(url)}`),
    });
    return { tokens: result.tokens, confirmed: await confirmSignedInAccount(result, options.info) };
  }

  if (plan.portalUnknown) {
    options.info('No Admin Portal sign-in page is known for this sign-in directory, so the CLI opens the ordinary sign-in page directly.');
  }
  options.info('Opening your browser to complete sign-in...');
  const tokens = await browserLogin(options.tenantName, options.tenantId, options.clientId, options.scope, {
    callbackPort: options.callbackPort,
    prompt: options.switchAccount ? 'select_account' : undefined,
    onAuthorizeUrl: showAuthorizeUrl,
  });
  return { tokens, confirmed: true };
}
