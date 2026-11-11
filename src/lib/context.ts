/**
 * Shared command context resolution — eliminates the 4-step boilerplate that was
 * copy-pasted across every authenticated command.
 */

import ora from 'ora';
import type { Ora } from 'ora';
import { findProjectRoot } from './config.js';
import { PlatformAPIClient } from './api.js';
import {
  resolvePublicApiUrl,
  resolveActiveTenantContext,
  TenantMembershipAuthError,
  TenantLoginRequiredError,
  TenantAuthConfigMismatchError,
  type TenantMembership,
  type ActiveTenantContext,
  type PublicApiRequestPolicy,
} from './tenant-context.js';
import type { StoredTokens } from './auth.js';
import { ErrorCode, errorCatalog, exitWithError } from './error-codes.js';

export interface CommandContext {
  root: string;
  publicApiUrl: string;
  client: PlatformAPIClient;
  tenantId: string;
  tenantSlug: string;
  activeTenant: TenantMembership;
  memberships: TenantMembership[];
  tokens: StoredTokens;
}

/** Context for a read-only, workspace-scoped command that may run outside an app folder. */
export interface WorkspaceCommandContext extends Omit<CommandContext, 'root'> {
  /** The app folder, or null when the command runs outside one. */
  root: string | null;
}

export interface ResolveCommandContextOptions {
  tenantId?: string;
  interactive?: boolean;
  forceRefresh?: boolean;
  validatePublicApiUrl?: (url: string) => string;
  publicApiUrl?: string;
  pinPublicApiUrl?: boolean;
  /** Let an owning command retain operation identity instead of exiting here. */
  onError?: (code: ErrorCode, message?: string) => never;
}

/**
 * Resolve the full command context needed by every authenticated command.
 *
 * Before: 4 lines of boilerplate copy-pasted 9 times.
 * After: one call.
 *
 * With `allowOutsideProject`, a read-only command that names its workspace
 * explicitly (`tenantId`) runs without an app folder; the Public API URL then
 * comes from the active profile and stored login, as for `eai workspace`.
 */
export async function resolveCommandContext(
  options: ResolveCommandContextOptions & { allowOutsideProject: true },
): Promise<WorkspaceCommandContext>;
export async function resolveCommandContext(
  options?: ResolveCommandContextOptions,
): Promise<CommandContext>;
export async function resolveCommandContext(
  options?: ResolveCommandContextOptions & { allowOutsideProject?: boolean },
): Promise<CommandContext | WorkspaceCommandContext> {
  const root = await findProjectRoot();
  if (!root && !(options?.allowOutsideProject && options.tenantId)) {
    options?.onError?.(ErrorCode.E001);
    exitWithError(ErrorCode.E001);
  }

  const requestPolicy: PublicApiRequestPolicy | undefined = options?.validatePublicApiUrl
    ? { validateUrl: options.validatePublicApiUrl, redirect: 'error' }
    : undefined;
  const resolvedPublicApiUrl = options?.publicApiUrl
    ?? await resolvePublicApiUrl(root ?? undefined, requestPolicy);
  const publicApiUrl = options?.validatePublicApiUrl
    ? options.validatePublicApiUrl(resolvedPublicApiUrl)
    : resolvedPublicApiUrl;
  let context: ActiveTenantContext;
  try {
    context = await resolveActiveTenantContext({
      projectRoot: root ?? undefined,
      publicApiUrl,
      interactive: options?.interactive ?? true,
      tenantId: options?.tenantId,
      forceRefresh: options?.forceRefresh,
      requestPolicy,
      pinPublicApiUrl: options?.pinPublicApiUrl,
    });
  } catch (error) {
    if (error instanceof TenantLoginRequiredError) {
      options?.onError?.(ErrorCode.E101);
      exitWithError(ErrorCode.E101);
    }
    if (error instanceof TenantMembershipAuthError) {
      options?.onError?.(ErrorCode.E102);
      exitWithError(ErrorCode.E102);
    }
    if (error instanceof TenantAuthConfigMismatchError) {
      options?.onError?.(ErrorCode.E104, errorCatalog[ErrorCode.E104].message.replace('{details}', error.safeMessage));
      exitWithError(ErrorCode.E104, { details: error.safeMessage });
    }
    throw error;
  }

  const contextPublicApiUrl = options?.validatePublicApiUrl
    ? options.validatePublicApiUrl(context.publicApiUrl)
    : context.publicApiUrl;
  const client = new PlatformAPIClient(contextPublicApiUrl, context.activeTenant.id, {
    publicRequestRedirect: requestPolicy?.redirect,
  });

  return {
    root,
    publicApiUrl: contextPublicApiUrl,
    client,
    tenantId: context.activeTenant.id,
    tenantSlug: context.activeTenant.slug,
    activeTenant: context.activeTenant,
    memberships: context.memberships,
    tokens: context.tokens,
  };
}

/**
 * Normalise the output format — collapses the `--json` shorthand flag into `--format`.
 * Replaces 11× inline ternary: `options.json ? 'json' : options.format`
 */
export function normalizeFormat(options: { format?: string; json?: boolean }): string {
  if (options.json) return 'json';
  return options.format || 'text';
}

/**
 * Start a spinner for non-JSON output, or return null for JSON/non-TTY contexts.
 * Replaces 15× inline `ora(message).start()` calls.
 */
export function makeSpinner(format: string, message: string): Ora | null {
  if (format === 'json' || !process.stdout.isTTY) return null;
  return ora(message).start();
}
