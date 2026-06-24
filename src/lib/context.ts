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
  type TenantMembership,
  type ActiveTenantContext,
} from './tenant-context.js';
import type { StoredTokens } from './auth.js';
import { ErrorCode, exitWithError } from './error-codes.js';

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

/**
 * Resolve the full command context needed by every authenticated command.
 *
 * Before: 4 lines of boilerplate copy-pasted 9 times.
 * After: one call.
 */
export async function resolveCommandContext(options?: {
  tenantId?: string;
  interactive?: boolean;
  forceRefresh?: boolean;
}): Promise<CommandContext> {
  const root = await findProjectRoot();
  if (!root) {
    exitWithError(ErrorCode.E001);
  }

  const publicApiUrl = await resolvePublicApiUrl(root);
  let context: ActiveTenantContext;
  try {
    context = await resolveActiveTenantContext({
      projectRoot: root,
      publicApiUrl,
      interactive: options?.interactive ?? true,
      tenantId: options?.tenantId,
      forceRefresh: options?.forceRefresh,
    });
  } catch (error) {
    if (error instanceof TenantMembershipAuthError) {
      exitWithError(ErrorCode.E102);
    }
    throw error;
  }

  const client = new PlatformAPIClient(context.publicApiUrl, context.activeTenant.id);

  return {
    root,
    publicApiUrl: context.publicApiUrl,
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
