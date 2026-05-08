import inquirer from 'inquirer';
import { findProjectRoot, loadEnvFile } from './config.js';
import { loadTokens, storeTokens, type StoredTokens } from './auth.js';
import { PlatformAPIClient } from './api.js';
import { isRecord } from './utils.js';
import { getActiveProfile, loadProfileConfig } from './profile.js';

export const DEFAULT_PUBLIC_API_URL = 'https://api.ae.myenterprise.ai/public';

export interface TenantRoleAssignment {
  baseRole?: string;
  displayName?: string;
}

export interface TenantEntry {
  tenant: {
    id: string;
    displayName: string;
    slug: string;
    domain?: string;
    isActive: boolean;
    parent?: { id?: string } | string | null;
    parentId?: string | null;
  };
  roleAssignments?: TenantRoleAssignment[];
  isTenantAdmin?: boolean;
  role?: string;
  roles?: string[];
}

interface AdminTenantMembership {
  id: string;
  displayName: string;
  slug: string;
  domain?: string;
  isActive?: boolean;
  parent?: { id?: string } | string | null;
  parentId?: string | null;
  role?: string;
  roles?: string[];
  isTenantAdmin?: boolean;
}

export interface TenantMembership {
  id: string;
  displayName: string;
  slug: string;
  domain?: string;
  isActive: boolean;
  roles: string[];
}

export interface ActiveTenantContext {
  publicApiUrl: string;
  tokens: StoredTokens;
  activeTenant: TenantMembership;
  memberships: TenantMembership[];
}

export interface TenantUsabilityStatus {
  tenantId: string;
  created: boolean;
  bootstrapped: boolean;
  membershipConfirmed: boolean;
  adminConfirmed: boolean;
  usable: boolean;
  autoSelected: boolean;
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function getTenantRoles(entry: TenantEntry): string[] {
  return unique([
    ...(entry.roles ?? []),
    entry.role,
    ...(entry.roleAssignments ?? []).map((assignment) => assignment.baseRole),
    entry.isTenantAdmin ? 'tenant-admin' : undefined,
  ]);
}

export function tenantEntryHasTenantAdminRole(entry: TenantEntry): boolean {
  return getTenantRoles(entry).includes('tenant-admin');
}

export function filterTenantAdminEntries(entries: TenantEntry[]): TenantEntry[] {
  return entries.filter((entry) => (
    entry.tenant?.isActive !== false && tenantEntryHasTenantAdminRole(entry)
  ));
}

function isAdminTenantMembership(value: unknown): value is AdminTenantMembership {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.displayName === 'string'
    && typeof value.slug === 'string';
}

function toTenantEntry(value: AdminTenantMembership | TenantEntry): TenantEntry {
  if ('tenant' in value) {
    return value;
  }

  return {
    tenant: {
      id: value.id,
      displayName: value.displayName,
      slug: value.slug,
      domain: value.domain,
      isActive: value.isActive !== false,
      parent: value.parent,
      parentId: value.parentId,
    },
    role: value.role,
    roles: value.roles,
    isTenantAdmin: value.isTenantAdmin,
  };
}

export function normalizeTenantEntries(payload: unknown): TenantEntry[] {
  if (!isRecord(payload)) {
    return [];
  }

  const record = payload as {
    tenants?: Array<TenantEntry | AdminTenantMembership>;
    user?: { tenants?: Array<TenantEntry | AdminTenantMembership> };
  };
  const source = record.tenants ?? record.user?.tenants ?? [];

  return source
    .filter((entry): entry is TenantEntry | AdminTenantMembership => isRecord(entry))
    .map(toTenantEntry)
    .filter((entry) => isAdminTenantMembership(entry.tenant) || isRecord(entry.tenant));
}

export function toTenantMembership(entry: TenantEntry): TenantMembership {
  return {
    id: entry.tenant.id,
    displayName: entry.tenant.displayName,
    slug: entry.tenant.slug,
    domain: entry.tenant.domain,
    isActive: entry.tenant.isActive,
    roles: getTenantRoles(entry),
  };
}

export function findTenantMembership(
  memberships: TenantMembership[],
  tenantId: string,
): TenantMembership | undefined {
  return memberships.find((membership) => membership.id === tenantId || membership.slug === tenantId);
}

export function evaluateTenantUsability(
  tenantId: string,
  memberships: TenantMembership[],
  options?: {
    created?: boolean;
    bootstrapped?: boolean;
    autoSelected?: boolean;
  },
): TenantUsabilityStatus {
  const membership = findTenantMembership(memberships, tenantId);
  const adminConfirmed = Boolean(membership?.roles.includes('tenant-admin'));

  return {
    tenantId,
    created: options?.created ?? true,
    bootstrapped: options?.bootstrapped ?? false,
    membershipConfirmed: Boolean(membership),
    adminConfirmed,
    usable: Boolean(membership) && adminConfirmed,
    autoSelected: options?.autoSelected ?? false,
  };
}

/**
 * Resolve the Public API URL for the CLI to call.
 *
 * Priority:
 *  1. Profile config (non-default profiles only)
 *  2. BASE_URL_PUBLIC_API from project .env.local or process env
 *  3. DEFAULT_PUBLIC_API_URL fallback
 */
async function loadContextEnv(projectRoot?: string): Promise<Record<string, string>> {
  const root = projectRoot ?? await findProjectRoot() ?? undefined;
  const envVars = root ? await loadEnvFile(root) : {};
  return { ...envVars, ...process.env } as Record<string, string>;
}

export async function resolvePublicApiUrl(projectRoot?: string): Promise<string> {
  // 1. Profile config (named profiles carry their own API URL)
  const profile = getActiveProfile();
  if (profile !== 'default') {
    const config = await loadProfileConfig(profile);
    if (config?.publicApiUrl) {
      return config.publicApiUrl;
    }
  }

  // 2. Preserve the existing project-aware override path for default profile usage.
  const env = await loadContextEnv(projectRoot);
  if (env.BASE_URL_PUBLIC_API) {
    return env.BASE_URL_PUBLIC_API;
  }

  // 3. Default/no profile must target production. Do not let stale login metadata
  // override the current environment selection.
  return DEFAULT_PUBLIC_API_URL;
}

export function getStoredActiveTenant(tokens: StoredTokens): TenantMembership | null {
  if (!tokens.activeTenantId || !tokens.activeTenantName) {
    return null;
  }

  return {
    id: tokens.activeTenantId,
    displayName: tokens.activeTenantName,
    slug: tokens.activeTenantSlug || tokens.activeTenantName,
    domain: tokens.activeTenantDomain,
    isActive: true,
    roles: ['tenant-admin'],
  };
}

export async function fetchTenantAdminMemberships(publicApiUrl?: string): Promise<{
  publicApiUrl: string;
  tokens: StoredTokens;
  memberships: TenantMembership[];
}> {
  const tokens = await loadTokens();
  if (!tokens?.oid) {
    throw new Error('Not logged in. Run `eai login` to authenticate.');
  }

  const resolvedPublicApiUrl = publicApiUrl || await resolvePublicApiUrl();
  const client = new PlatformAPIClient(resolvedPublicApiUrl, 'system');
  const response = await client.listCurrentUserTenants();

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to load tenant memberships: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
  }

  const payload = await response.json();
  const memberships = filterTenantAdminEntries(normalizeTenantEntries(payload)).map(toTenantMembership);

  return {
    publicApiUrl: resolvedPublicApiUrl,
    tokens,
    memberships,
  };
}

export async function saveActiveTenantSelection(
  tenant: TenantMembership,
  publicApiUrl?: string,
  existingTokens?: StoredTokens,
): Promise<StoredTokens> {
  const tokens = existingTokens ?? await loadTokens();
  if (!tokens) {
    throw new Error('Not logged in. Run `eai login` to authenticate.');
  }

  const next: StoredTokens = {
    ...tokens,
    activeTenantId: tenant.id,
    activeTenantName: tenant.displayName,
    activeTenantSlug: tenant.slug,
    activeTenantDomain: tenant.domain,
    publicApiUrl: publicApiUrl || tokens.publicApiUrl,
    membershipsCachedAt: Date.now(),
  };

  await storeTokens(next);
  return next;
}

export async function refreshTenantUsabilityStatus(
  tenantId: string,
  options?: {
    publicApiUrl?: string;
    created?: boolean;
    bootstrapped?: boolean;
    autoSelect?: boolean;
  },
): Promise<{
  publicApiUrl: string;
  tokens: StoredTokens;
  memberships: TenantMembership[];
  membership?: TenantMembership;
  status: TenantUsabilityStatus;
}> {
  const fetched = await fetchTenantAdminMemberships(options?.publicApiUrl);
  const membership = findTenantMembership(fetched.memberships, tenantId);
  let status = evaluateTenantUsability(tenantId, fetched.memberships, {
    created: options?.created,
    bootstrapped: options?.bootstrapped,
    autoSelected: false,
  });
  let tokens = fetched.tokens;

  if (options?.autoSelect && membership && status.usable) {
    tokens = await saveActiveTenantSelection(membership, fetched.publicApiUrl);
    status = {
      ...status,
      autoSelected: true,
    };
  }

  return {
    publicApiUrl: fetched.publicApiUrl,
    tokens,
    memberships: fetched.memberships,
    membership,
    status,
  };
}

async function promptForTenantSelection(memberships: TenantMembership[]): Promise<TenantMembership> {
  const { tenantId } = await inquirer.prompt([{
    type: 'list',
    name: 'tenantId',
    message: 'Select the tenant to work with now',
    choices: memberships.map((tenant) => ({
      name: `${tenant.displayName} (${tenant.slug})${tenant.domain ? ` — ${tenant.domain}` : ''}`,
      value: tenant.id,
    })),
  }]);

  const selected = memberships.find((tenant) => tenant.id === tenantId);
  if (!selected) {
    throw new Error('Selected tenant was not found.');
  }

  return selected;
}

const MEMBERSHIP_CACHE_TTL_MS = 15 * 60_000;

export async function resolveActiveTenantContext(options?: {
  projectRoot?: string;
  publicApiUrl?: string;
  interactive?: boolean;
  forcePrompt?: boolean;
  forceRefresh?: boolean;
  tenantId?: string;
}): Promise<ActiveTenantContext> {
  // Short-circuit: if tenant context is cached and TTL is valid, skip Admin API call
  if (!options?.forceRefresh && !options?.forcePrompt && !options?.tenantId) {
    const cached = await loadTokens();
    if (
      cached?.activeTenantId &&
      cached.activeTenantName &&
      cached.membershipsCachedAt &&
      Date.now() - cached.membershipsCachedAt < MEMBERSHIP_CACHE_TTL_MS
    ) {
      const activeTenant: TenantMembership = {
        id: cached.activeTenantId,
        displayName: cached.activeTenantName,
        slug: cached.activeTenantSlug || cached.activeTenantName,
        domain: cached.activeTenantDomain,
        isActive: true,
        roles: ['tenant-admin'],
      };
      const publicApiUrl = options?.publicApiUrl || await resolvePublicApiUrl(options?.projectRoot);
      return { publicApiUrl, tokens: cached, activeTenant, memberships: [activeTenant] };
    }
  }

  const fetched = await fetchTenantAdminMemberships(options?.publicApiUrl || await resolvePublicApiUrl(options?.projectRoot));
  const { tokens, memberships } = fetched;

  if (memberships.length === 0) {
    throw new Error('No active tenant-admin memberships found for the current login. Run `eai tenant list` to inspect your access.');
  }

  let selected: TenantMembership | undefined;
  if (options?.tenantId) {
    selected = memberships.find((tenant) => tenant.id === options.tenantId || tenant.slug === options.tenantId);
    if (!selected) {
      throw new Error(`Tenant "${options.tenantId}" is not available in your active tenant-admin memberships.`);
    }
  } else if (!options?.forcePrompt && tokens.activeTenantId) {
    selected = memberships.find((tenant) => tenant.id === tokens.activeTenantId);
  }

  if (!selected) {
    if (memberships.length === 1) {
      selected = memberships[0];
    } else if (options?.interactive === false || !process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('Multiple active tenant-admin memberships found. Run `eai tenant select` to choose one.');
    } else {
      selected = await promptForTenantSelection(memberships);
    }
  }

  const updatedTokens = await saveActiveTenantSelection(selected, fetched.publicApiUrl, tokens);
  return {
    publicApiUrl: fetched.publicApiUrl,
    tokens: updatedTokens,
    activeTenant: selected,
    memberships,
  };
}
