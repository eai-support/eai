/**
 * Company sign-in helpers for `eai login` (Issues2025#3458, N3).
 *
 * `eai login --company` signs in with the sign-in directory's CLI company
 * sign-in app (see the callback-server diagram in auth.ts). These helpers hold
 * the pure parts: client ID validation and the account confirmation shown
 * before a login is saved.
 *
 * This module has no imports from the CLI so that profile.ts can use its
 * validators without an import cycle.
 */

import { createInterface } from 'node:readline/promises';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNPRINTABLE = /[\p{Cc}\p{Cf}]/gu;

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
