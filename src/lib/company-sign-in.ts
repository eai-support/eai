/**
 * Company sign-in helpers for `eai login` (Issues2025#3458, N3).
 *
 * Plain `eai login` sends the browser to the sign-in directory's AU Admin
 * Portal page `/login/cli`. The Portal only decides where an email signs in
 * and sends the browser back to the CLI's local `/eai/route` (a JavaScript
 * navigation, or a 303 without JavaScript: always a GET); the CLI then
 * builds the External ID request itself (see the callback-server diagram in
 * auth.ts). These helpers hold the pure parts of that contract: which Portal,
 * the shape of the route the Portal sends back, and the account confirmation
 * shown before a login is saved.
 *
 * This module has no imports from the CLI so that profile.ts can use its
 * validators without an import cycle.
 */

import { createInterface } from 'node:readline/promises';

/**
 * The AU Admin Portal for each External ID sign-in directory (D3). The Portal
 * is always chosen by directory ID, never by PublicAPI region: CA and EU users
 * of a directory use the same AU page. Any other directory falls back to the
 * direct sign-in flow unless its profile sets `portalUrl`.
 */
export const SIGN_IN_DIRECTORY_PORTALS: Readonly<Record<string, string>> = Object.freeze({
  // DEV
  '50808ce0-f31b-4fd0-9861-74b83b8c112a': 'https://dev-admin-portal.myenterprise.ai',
  // TEST
  'dffacd2b-7705-43f2-86ae-75d1ef003a71': 'https://test-admin-portal.myenterprise.ai',
  // PROD (DEFAULT_PROD_AUTH_TENANT_ID)
  'f3035369-5c1a-45f7-8ca5-5cb0ad291d26': 'https://admin-portal.myenterprise.ai',
});

/** The Portal's CLI sign-in page, relative to the Portal origin. */
export const PORTAL_CLI_LOGIN_PATH = '/login/cli';

/** The local path the Portal sends the browser back to after the email form. */
export const PORTAL_ROUTE_PATH = '/eai/route';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LOGIN_HINT_LENGTH = 320;
// Portal contract: `domain_hint` is the company route's `signInHint`.
const DOMAIN_HINT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
// One address: no whitespace, control or format characters, exactly one "@".
const LOGIN_HINT = /^[^\s@\p{Cc}\p{Cf}]+@[^\s@\p{Cc}\p{Cf}]+$/u;
const UNPRINTABLE = /[\p{Cc}\p{Cf}]/gu;
const LOCAL_PORTAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** True for an Entra application (client) ID. */
export function isGuid(value: unknown): value is string {
  return typeof value === 'string' && GUID.test(value);
}

/**
 * SECURITY: the local callback answers only a browser addressing this exact
 * listener as `localhost:{PORT}`, which stops DNS-rebinding pages on other
 * hosts. Browsers omit the default port, so port 80 also accepts a bare
 * `localhost`. `127.0.0.1` is refused: the redirect URI and the Portal
 * contract both use the literal host `localhost`.
 */
export function isExpectedCallbackHost(host: string | undefined, port: number): boolean {
  const value = host?.toLowerCase();
  return value === `localhost:${port}` || (port === 80 && value === 'localhost');
}

/**
 * Validate a profile `portalUrl` override and return its origin.
 *
 * SECURITY: the Portal decides which app and hints the CLI uses, so an
 * override must be https; plain http is accepted only for a Portal running on
 * this machine (`localhost` or `127.0.0.1`). Paths, queries, fragments and
 * credentials are refused so the value is an origin and nothing else.
 */
export function normalizePortalUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('portalUrl must be an absolute URL such as https://admin-portal.example.');
  }
  const local = url.protocol === 'http:' && LOCAL_PORTAL_HOSTS.has(url.hostname);
  if ((url.protocol !== 'https:' && !local) || url.username || url.password
    || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('portalUrl must be an https origin, or http://localhost or http://127.0.0.1 for local Portal development.');
  }
  return url.origin;
}

/** The Portal for this sign-in directory: the profile override, then the directory table; `null` when none is known. */
export function resolvePortalUrl(directoryId: string, override?: string): string | null {
  if (override) return normalizePortalUrl(override);
  return Object.hasOwn(SIGN_IN_DIRECTORY_PORTALS, directoryId) ? SIGN_IN_DIRECTORY_PORTALS[directoryId] : null;
}

/** `EAI_LOGIN_VIA_PORTAL=false` (or 0, no, off) keeps plain `eai login` on the direct flow. */
export function isPortalLoginDisabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.EAI_LOGIN_VIA_PORTAL?.trim().toLowerCase();
  return value === 'false' || value === '0' || value === 'no' || value === 'off';
}

/** `{portal}/login/cli?port={PORT}&state={R}`: the only values the CLI sends the Portal. */
export function buildPortalLoginUrl(portalUrl: string, port: number, routeState: string): string {
  const url = new URL(PORTAL_CLI_LOGIN_PATH, `${normalizePortalUrl(portalUrl)}/`);
  url.searchParams.set('port', String(port));
  url.searchParams.set('state', routeState);
  return url.toString();
}

/** One address of at most 320 characters, as the Portal's normalised `login_hint`. */
export function isValidLoginHint(value: string): boolean {
  return value.length <= MAX_LOGIN_HINT_LENGTH && LOGIN_HINT.test(value);
}

/** The Portal contract's `domain_hint` format. */
export function isValidDomainHint(value: string): boolean {
  return DOMAIN_HINT.test(value);
}

/** Which app the Portal chose for the typed email. */
export type PortalRouteKind = 'company' | 'standard';

/** A validated `/eai/route` request from the Portal. */
export interface PortalRoute {
  readonly kind: PortalRouteKind;
  /** The normalised email the person typed on the Portal page. */
  readonly loginHint: string;
  /** The company route's sign-in hint; only ever set for `kind: 'company'`. */
  readonly domainHint?: string;
}

function single(params: URLSearchParams, name: string): string | undefined | null {
  const values = params.getAll(name);
  if (values.length > 1) return null;
  return values[0];
}

/**
 * Validate the Portal's `/eai/route` query against the route state this CLI
 * sent. Returns `null` for anything outside the contract: a different or
 * missing state, an unknown kind, a login hint that is not one address of at
 * most 320 characters, a domain hint in a bad format, or a repeated parameter.
 * The caller answers 400 and keeps waiting.
 */
export function parsePortalRoute(params: URLSearchParams, expectedState: string): PortalRoute | null {
  const state = single(params, 'state');
  const kind = single(params, 'kind');
  const loginHint = single(params, 'login_hint');
  const domainHint = single(params, 'domain_hint');
  if (state === null || kind === null || loginHint === null || domainHint === null) return null;
  if (!state || state !== expectedState) return null;
  if (kind !== 'company' && kind !== 'standard') return null;
  if (!loginHint || !isValidLoginHint(loginHint)) return null;
  if (domainHint !== undefined && !isValidDomainHint(domainHint)) return null;
  if (kind === 'company' && domainHint !== undefined) return { kind, loginHint, domainHint };
  return { kind, loginHint };
}

/** Strip control and format characters before showing token or Portal text in a terminal. */
export function printable(value: string): string {
  return value.replace(UNPRINTABLE, '');
}

/** The question to ask before saving a Portal or company login; `null` means save without asking. */
export interface LoginConfirmation {
  readonly question: string;
  readonly defaultYes: boolean;
}

/**
 * Davis's D2/OV3 rule for saving a login. Only the token's `email` claim is
 * compared, case-insensitively, with the email typed on the Portal page; the
 * display name (`preferred_username` and friends) is shown when the claim is
 * missing but is never compared.
 *
 * - Typed email and a matching claim: save without asking.
 * - Typed email and a different or missing claim: ask, default no.
 * - Nothing typed (`--company`): show the account and ask, default yes.
 */
export function describeLoginConfirmation(input: {
  readonly signedInEmail?: string;
  readonly typedEmail?: string;
  readonly displayIdentity?: string;
}): LoginConfirmation | null {
  const signedIn = input.signedInEmail?.trim();
  const account = signedIn
    ? printable(signedIn)
    : input.displayIdentity?.trim()
      ? `${printable(input.displayIdentity.trim())} (no email address on the token)`
      : 'an account with no email address';

  if (input.typedEmail !== undefined) {
    const typed = input.typedEmail.trim();
    if (signedIn && signedIn.toLowerCase() === typed.toLowerCase()) return null;
    return {
      question: `You signed in as ${account}, but typed ${printable(typed)}. Save this login? [y/N]`,
      defaultYes: false,
    };
  }
  return { question: `Signed in as ${account}. Save this login? [Y/n]`, defaultYes: true };
}

/** True when the person can answer a question in this terminal. */
export function canPromptInTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Ask a yes/no question in the terminal; an empty or unclear answer takes the default. */
export async function askYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt.question(`${question} `)).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    return defaultYes;
  } finally {
    prompt.close();
  }
}
