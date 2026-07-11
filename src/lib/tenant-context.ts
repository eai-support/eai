import { findProjectRoot, loadEnvFile, patchEnvFile } from "./config.js";
import {
  getAccessToken,
  getActiveAuthConfigMismatch,
  loadTokens,
  storeTokens,
  type StoredTokens,
} from "./auth.js";
import { PlatformAPIClient } from "./api.js";
import { isRecord } from "./utils.js";
import { getActiveProfile, loadProfileConfig } from "./profile.js";
import {
  buildTenantHierarchy,
  loadTenantHierarchy,
  promptForTenantFromHierarchy,
} from "./tenant-hierarchy.js";

export const DEFAULT_PUBLIC_API_URL = "https://api.au.myenterprise.ai/public";

const REGION_PUBLIC_API_URLS = {
  au: DEFAULT_PUBLIC_API_URL,
  ca: "https://api.ca.myenterprise.ai/public",
  eu: "https://api.eu.myenterprise.ai/public",
} as const;

export type HomeRegion = keyof typeof REGION_PUBLIC_API_URLS;

const TRUSTED_SESSION_PUBLIC_API_HOSTS = new Set([
  "api.au.myenterprise.ai",
  "api.ca.myenterprise.ai",
  "api.eu.myenterprise.ai",
]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const TENANT_MEMBERSHIP_AUTH_MESSAGE =
  "Authentication is missing or expired. Run `eai login` to refresh your session.";

export class TenantMembershipAuthError extends Error {
  readonly status?: number;

  constructor(status?: number) {
    super(TENANT_MEMBERSHIP_AUTH_MESSAGE);
    this.name = "TenantMembershipAuthError";
    this.status = status;
  }
}

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
    homeRegion?: string | null;
    hqCountryCode?: string | null;
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
  parentTenant?: { id?: string } | string | null;
  parentId?: string | null;
  parentTenantId?: string | null;
  parent_tenant_id?: string | null;
  homeRegion?: string | null;
  hqCountryCode?: string | null;
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
  parentId?: string | null;
  homeRegion?: string | null;
  hqCountryCode?: string | null;
}

export interface ActiveTenantContext {
  publicApiUrl: string;
  tokens: StoredTokens;
  activeTenant: TenantMembership;
  memberships: TenantMembership[];
  publicApiEnvSync?: PublicApiEnvSyncResult;
}

export type PublicApiEnvSyncResult =
  | {
      status: "updated";
      projectRoot: string;
      publicApiUrl: string;
      previousPublicApiUrl?: string;
      homeRegion: HomeRegion;
    }
  | {
      status: "already-current";
      projectRoot: string;
      publicApiUrl: string;
      homeRegion: HomeRegion;
    }
  | {
      status: "skipped";
      reason: "no-project-root" | "unresolved-home-region";
      homeRegion?: string | null;
    };

export interface PublicApiEnvSyncNotice {
  level: "success" | "warn";
  message: string;
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

type TenantHierarchyRecord = Record<string, unknown>;

interface SessionResolveResponse {
  status?: string;
  apiBaseUrl?: unknown;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/g, "");
}

export function normalizeHomeRegion(
  value: string | null | undefined,
): HomeRegion | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === "au" || normalized === "ca" || normalized === "eu"
    ? normalized
    : null;
}

export function publicApiUrlForHomeRegion(
  value: string | null | undefined,
): string | null {
  const region = normalizeHomeRegion(value);
  return region ? REGION_PUBLIC_API_URLS[region] : null;
}

export async function syncProjectPublicApiUrlForTenant(
  tenant: Pick<TenantMembership, "homeRegion">,
  projectRoot?: string | null,
): Promise<PublicApiEnvSyncResult> {
  const homeRegion = normalizeHomeRegion(tenant.homeRegion);
  if (!homeRegion) {
    return {
      status: "skipped",
      reason: "unresolved-home-region",
      homeRegion: tenant.homeRegion,
    };
  }

  const root = projectRoot ?? (await findProjectRoot());
  if (!root) {
    return { status: "skipped", reason: "no-project-root", homeRegion };
  }

  const publicApiUrl = REGION_PUBLIC_API_URLS[homeRegion];
  const env = await loadEnvFile(root);
  const previousPublicApiUrl = env.BASE_URL_PUBLIC_API?.trim();
  if (previousPublicApiUrl === publicApiUrl) {
    return {
      status: "already-current",
      projectRoot: root,
      publicApiUrl,
      homeRegion,
    };
  }

  await patchEnvFile(root, { BASE_URL_PUBLIC_API: publicApiUrl });
  return {
    status: "updated",
    projectRoot: root,
    publicApiUrl,
    previousPublicApiUrl: previousPublicApiUrl || undefined,
    homeRegion,
  };
}

export function buildPublicApiEnvSyncNotice(
  result: PublicApiEnvSyncResult | undefined,
): PublicApiEnvSyncNotice | null {
  if (!result) return null;

  if (
    result.status === "skipped" &&
    result.reason === "unresolved-home-region"
  ) {
    return {
      level: "warn",
      message:
        "Active tenant homeRegion is missing; regional PublicAPI routing may fall back. " +
        "Ask a tenant or platform admin to repair tenant metadata before provisioning resources.",
    };
  }

  if (result.status !== "updated") return null;

  const target = `BASE_URL_PUBLIC_API=${result.publicApiUrl}`;
  if (result.previousPublicApiUrl) {
    return {
      level: "warn",
      message:
        `.env.local ${target} for active tenant homeRegion ${result.homeRegion} ` +
        `(was ${result.previousPublicApiUrl}).`,
    };
  }

  return {
    level: "success",
    message: `.env.local ${target} for active tenant homeRegion ${result.homeRegion}.`,
  };
}

function normalizeCliPublicApiUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const pathWithoutTrailingSlash = url.pathname.replace(/\/+$/g, "");
    if (
      !pathWithoutTrailingSlash &&
      /\.myenterprise\.ai$/i.test(url.hostname)
    ) {
      url.pathname = "/public";
    } else {
      url.pathname = pathWithoutTrailingSlash;
    }
    return url.toString().replace(/\/+$/g, "");
  } catch {
    return normalizeBaseUrl(value);
  }
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

function normalizeTrustedSessionPublicApiUrl(value: unknown): string | null {
  const normalized = normalizeCliPublicApiUrl(value);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    const isLoopback = isLoopbackHost(hostname);
    if (url.username || url.password) return null;
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && isLoopback)
    ) {
      return null;
    }
    if (!isLoopback && !TRUSTED_SESSION_PUBLIC_API_HOSTS.has(hostname)) {
      return null;
    }
    return normalizeCliPublicApiUrl(url.toString());
  } catch {
    return null;
  }
}

function buildSessionResolveUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v4/identity/session/resolve`;
}

async function resolveRegionalPublicApiUrlFromSession(
  requestedTenantId?: string | null,
): Promise<string | null> {
  const accessToken = await getAccessToken();
  if (!accessToken) return null;

  const bootstrapBaseUrl =
    process.env.ROUTING_BOOTSTRAP_PUBLIC_API_URL?.trim() ||
    DEFAULT_PUBLIC_API_URL;
  try {
    const response = await fetch(buildSessionResolveUrl(bootstrapBaseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product: "eai-cli",
        requestedTenantId: requestedTenantId || undefined,
      }),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as SessionResolveResponse;
    if (payload.status !== "resolved") return null;
    return normalizeTrustedSessionPublicApiUrl(payload.apiBaseUrl);
  } catch {
    return null;
  }
}

async function resolveRegionalPublicApiUrlFromTenantManagement(
  tokens: StoredTokens | null,
): Promise<string | null> {
  if (!tokens?.activeTenantId) return null;

  const bootstrapBaseUrl =
    process.env.ROUTING_BOOTSTRAP_PUBLIC_API_URL?.trim() ||
    DEFAULT_PUBLIC_API_URL;
  try {
    const client = new PlatformAPIClient(
      normalizeBaseUrl(bootstrapBaseUrl),
      tokens.activeTenantId,
    );
    const response = await client.getTenant(tokens.activeTenantId);
    if (!response.ok) return null;

    const detail = tenantManagementDetailRecord(await response.json());
    if (!detail) return null;

    const homeRegion = optionalStringOrNull(detail.homeRegion);
    const regionalUrl = publicApiUrlForHomeRegion(homeRegion);
    if (!regionalUrl) return null;

    const hqCountryCode = optionalStringOrNull(detail.hqCountryCode);
    await storeTokens({
      ...tokens,
      activeTenantHomeRegion: homeRegion,
      activeTenantHqCountryCode:
        hqCountryCode === undefined
          ? tokens.activeTenantHqCountryCode
          : hqCountryCode,
    });
    return regionalUrl;
  } catch {
    return null;
  }
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

async function readTenantManagementRecord(
  client: PlatformAPIClient,
  tenantId: string,
): Promise<TenantHierarchyRecord> {
  const response = await client.getTenant(tenantId);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Tenant ${tenantId} could not be resolved (${response.status}). ${body}`.trim(),
    );
  }

  const payload = await response.json();
  if (!isRecord(payload)) {
    throw new Error(`Tenant ${tenantId} returned an invalid response.`);
  }
  return payload;
}

export async function resolveMainCompanyTenantId(
  publicApiUrl: string,
  tenantId: string,
): Promise<string> {
  const client = new PlatformAPIClient(publicApiUrl, tenantId);
  await readTenantManagementRecord(client, tenantId);
  return tenantId;
}

export function getTenantRoles(entry: TenantEntry): string[] {
  return unique([
    ...(entry.roles ?? []),
    entry.role,
    ...(entry.roleAssignments ?? []).map((assignment) => assignment.baseRole),
    entry.isTenantAdmin ? "tenant-admin" : undefined,
  ]);
}

export function tenantEntryHasTenantAdminRole(entry: TenantEntry): boolean {
  return getTenantRoles(entry).includes("tenant-admin");
}

export function filterTenantAdminEntries(
  entries: TenantEntry[],
): TenantEntry[] {
  return entries.filter(
    (entry) =>
      entry.tenant?.isActive !== false && tenantEntryHasTenantAdminRole(entry),
  );
}

function isAdminTenantMembership(
  value: unknown,
): value is AdminTenantMembership {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.slug === "string"
  );
}

function toTenantEntry(
  value: AdminTenantMembership | TenantEntry,
): TenantEntry {
  if ("tenant" in value) {
    return value;
  }

  return {
    tenant: {
      id: value.id,
      displayName: value.displayName,
      slug: value.slug,
      domain: value.domain,
      isActive: value.isActive !== false,
      parent: value.parent ?? value.parentTenant,
      parentId: value.parentId ?? value.parentTenantId ?? value.parent_tenant_id,
      homeRegion: value.homeRegion,
      hqCountryCode: value.hqCountryCode,
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
    .filter((entry): entry is TenantEntry | AdminTenantMembership =>
      isRecord(entry),
    )
    .map(toTenantEntry)
    .filter(
      (entry) =>
        isAdminTenantMembership(entry.tenant) || isRecord(entry.tenant),
    );
}

export function toTenantMembership(entry: TenantEntry): TenantMembership {
  return {
    id: entry.tenant.id,
    displayName: entry.tenant.displayName,
    slug: entry.tenant.slug,
    domain: entry.tenant.domain,
    isActive: entry.tenant.isActive,
    roles: getTenantRoles(entry),
    parentId:
      (typeof entry.tenant.parent === "string"
        ? entry.tenant.parent
        : entry.tenant.parent?.id) ?? entry.tenant.parentId,
    homeRegion: entry.tenant.homeRegion,
    hqCountryCode: entry.tenant.hqCountryCode,
  };
}

function optionalStringOrNull(value: unknown): string | null | undefined {
  if (typeof value === "string") return value;
  if (value === null) return null;
  return undefined;
}

function tenantManagementDetailRecord(
  payload: unknown,
): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  return isRecord(payload.tenant) ? payload.tenant : payload;
}

function mergeTenantManagementDetails(
  membership: TenantMembership,
  payload: unknown,
): TenantMembership {
  const detail = tenantManagementDetailRecord(payload);
  if (!detail) return membership;

  const homeRegion = optionalStringOrNull(detail.homeRegion);
  const hqCountryCode = optionalStringOrNull(detail.hqCountryCode);
  const parentId =
    optionalStringOrNull(detail.parentTenantId) ??
    optionalStringOrNull(detail.parentId) ??
    (isRecord(detail.parentTenant)
      ? optionalStringOrNull(detail.parentTenant.id)
      : optionalStringOrNull(detail.parentTenant)) ??
    (isRecord(detail.parent)
      ? optionalStringOrNull(detail.parent.id)
      : optionalStringOrNull(detail.parent));

  return {
    ...membership,
    parentId: parentId === undefined ? membership.parentId : parentId,
    homeRegion: homeRegion === undefined ? membership.homeRegion : homeRegion,
    hqCountryCode:
      hqCountryCode === undefined ? membership.hqCountryCode : hqCountryCode,
  };
}

async function hydrateTenantMembershipManagementDetails(
  client: PlatformAPIClient,
  memberships: TenantMembership[],
): Promise<TenantMembership[]> {
  return Promise.all(
    memberships.map(async (membership) => {
      if (
        membership.homeRegion &&
        membership.hqCountryCode &&
        membership.parentId !== undefined
      ) {
        return membership;
      }

      try {
        const response = await client.getTenant(membership.id);
        if (!response.ok) {
          return membership;
        }
        return mergeTenantManagementDetails(membership, await response.json());
      } catch {
        return membership;
      }
    }),
  );
}

export function findTenantMembership(
  memberships: TenantMembership[],
  tenantId: string,
): TenantMembership | undefined {
  return memberships.find(
    (membership) => membership.id === tenantId || membership.slug === tenantId,
  );
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
  const adminConfirmed = Boolean(membership?.roles.includes("tenant-admin"));

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
 *  3. Active tenant homeRegion from stored login context
 *  4. Tenant management homeRegion from PublicAPI
 *  5. PublicAPI session routing bootstrap for authenticated default profiles
 *  6. DEFAULT_PUBLIC_API_URL fallback
 */
async function loadContextEnv(
  projectRoot?: string,
): Promise<Record<string, string>> {
  const root = projectRoot ?? (await findProjectRoot()) ?? undefined;
  const envVars = root ? await loadEnvFile(root) : {};
  return { ...envVars, ...process.env } as Record<string, string>;
}

export async function resolvePublicApiUrl(
  projectRoot?: string,
): Promise<string> {
  // 1. Profile config (named profiles carry their own API URL)
  const profile = getActiveProfile();
  if (profile !== "default") {
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

  const tokens = await loadTokens();
  const storedRegionalUrl = publicApiUrlForHomeRegion(
    tokens?.activeTenantHomeRegion,
  );
  if (storedRegionalUrl) {
    return storedRegionalUrl;
  }

  const tenantManagementRegionalUrl =
    await resolveRegionalPublicApiUrlFromTenantManagement(tokens);
  if (tenantManagementRegionalUrl) {
    return tenantManagementRegionalUrl;
  }

  const routedUrl = await resolveRegionalPublicApiUrlFromSession(
    tokens?.activeTenantId,
  );
  if (routedUrl) {
    return routedUrl;
  }

  return DEFAULT_PUBLIC_API_URL;
}

export function getStoredActiveTenant(
  tokens: StoredTokens,
): TenantMembership | null {
  if (!tokens.activeTenantId || !tokens.activeTenantName) {
    return null;
  }

  return {
    id: tokens.activeTenantId,
    displayName: tokens.activeTenantName,
    slug: tokens.activeTenantSlug || tokens.activeTenantName,
    domain: tokens.activeTenantDomain,
    isActive: true,
    roles: ["tenant-admin"],
    homeRegion: tokens.activeTenantHomeRegion,
    hqCountryCode: tokens.activeTenantHqCountryCode,
  };
}

export async function fetchTenantAdminMemberships(
  publicApiUrl?: string,
): Promise<{
  publicApiUrl: string;
  tokens: StoredTokens;
  memberships: TenantMembership[];
}> {
  const tokens = await loadTokens();
  if (!tokens?.oid) {
    throw new Error("Not logged in. Run `eai login` to authenticate.");
  }
  const authMismatch = await getActiveAuthConfigMismatch(tokens);
  if (authMismatch) {
    throw new Error(authMismatch);
  }

  const resolvedPublicApiUrl = publicApiUrl || (await resolvePublicApiUrl());
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new TenantMembershipAuthError(401);
  }

  const client = new PlatformAPIClient(resolvedPublicApiUrl, "system");
  const response = await client.listCurrentUserTenants();

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) {
      throw new TenantMembershipAuthError(response.status);
    }
    throw new Error(
      `Failed to load tenant memberships: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
    );
  }

  const payload = await response.json();
  const memberships = await hydrateTenantMembershipManagementDetails(
    client,
    filterTenantAdminEntries(normalizeTenantEntries(payload)).map(
      toTenantMembership,
    ),
  );

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
  const tokens = existingTokens ?? (await loadTokens());
  if (!tokens) {
    throw new Error("Not logged in. Run `eai login` to authenticate.");
  }

  const next: StoredTokens = {
    ...tokens,
    activeTenantId: tenant.id,
    activeTenantName: tenant.displayName,
    activeTenantSlug: tenant.slug,
    activeTenantDomain: tenant.domain,
    activeTenantHomeRegion: tenant.homeRegion,
    activeTenantHqCountryCode: tenant.hqCountryCode,
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
    await syncProjectPublicApiUrlForTenant(membership);
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

async function promptForTenantSelection(
  memberships: TenantMembership[],
  publicApiUrl: string,
): Promise<TenantMembership> {
  const hierarchy = await loadTenantHierarchy({
    publicApiUrl,
    memberships,
  });
  const roots = hierarchy.roots.length
    ? hierarchy.roots
    : buildTenantHierarchy(memberships);
  const tenantId = await promptForTenantFromHierarchy(roots);

  const selected = memberships.find((tenant) => tenant.id === tenantId);
  if (!selected) {
    throw new Error("Selected tenant was not found.");
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
  const authMismatch = await getActiveAuthConfigMismatch(
    undefined,
    options?.projectRoot,
  );
  if (authMismatch) {
    throw new Error(authMismatch);
  }

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
        roles: ["tenant-admin"],
        homeRegion: cached.activeTenantHomeRegion,
        hqCountryCode: cached.activeTenantHqCountryCode,
      };
      const publicApiUrl =
        options?.publicApiUrl ||
        (await resolvePublicApiUrl(options?.projectRoot));
      return {
        publicApiUrl,
        tokens: cached,
        activeTenant,
        memberships: [activeTenant],
      };
    }
  }

  const fetched = await fetchTenantAdminMemberships(
    options?.publicApiUrl || (await resolvePublicApiUrl(options?.projectRoot)),
  );
  const { tokens, memberships } = fetched;

  if (memberships.length === 0) {
    throw new Error(
      "No active tenant-admin memberships found for the current login. Run `eai tenant list` to inspect your access.",
    );
  }

  let selected: TenantMembership | undefined;
  if (options?.tenantId) {
    selected = memberships.find(
      (tenant) =>
        tenant.id === options.tenantId || tenant.slug === options.tenantId,
    );
    if (!selected) {
      throw new Error(
        `Tenant "${options.tenantId}" is not available in your active tenant-admin memberships.`,
      );
    }
  } else if (!options?.forcePrompt && tokens.activeTenantId) {
    selected = memberships.find(
      (tenant) => tenant.id === tokens.activeTenantId,
    );
  }

  if (!selected) {
    if (memberships.length === 1) {
      selected = memberships[0];
    } else if (
      options?.interactive === false ||
      !process.stdin.isTTY ||
      !process.stdout.isTTY
    ) {
      throw new Error(
        "Multiple active tenant-admin memberships found. Run `eai tenant select` to choose one.",
      );
    } else {
      selected = await promptForTenantSelection(memberships, fetched.publicApiUrl);
    }
  }

  const updatedTokens = await saveActiveTenantSelection(
    selected,
    fetched.publicApiUrl,
    tokens,
  );
  const publicApiEnvSync = await syncProjectPublicApiUrlForTenant(
    selected,
    options?.projectRoot,
  );
  return {
    publicApiUrl: fetched.publicApiUrl,
    tokens: updatedTokens,
    activeTenant: selected,
    memberships,
    publicApiEnvSync,
  };
}
