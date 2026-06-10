/**
 * Tenant command filtering tests.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as auth from '../../src/lib/auth.js';
import type { StoredTokens } from '../../src/lib/auth.js';
import * as config from '../../src/lib/config.js';
import * as profile from '../../src/lib/profile.js';
import {
  buildTenantBootstrapAdminStatusMessages,
  buildTenantCreateStatusMessages,
  buildTenantListZeroState,
  extractCreatedTenantRecord,
  tenantMatchesParent,
  type TenantCreateOutcome,
} from '../../src/commands/tenant.js';
import {
  DEFAULT_PUBLIC_API_URL,
  evaluateTenantUsability,
  filterTenantAdminEntries,
  normalizeTenantEntries,
  publicApiUrlForHomeRegion,
  fetchTenantAdminMemberships,
  resolvePublicApiUrl,
  resolveMainCompanyTenantId,
  tenantEntryHasTenantAdminRole,
  toTenantMembership,
  type TenantMembership,
  type TenantEntry,
} from '../../src/lib/tenant-context.js';

function createTenantEntry(
  overrides: Partial<TenantEntry> = {},
): TenantEntry {
  return {
    tenant: {
      id: 'tenant-1',
      displayName: 'Tenant One',
      slug: 'tenant-one',
      isActive: true,
    },
    roleAssignments: [],
    ...overrides,
  };
}

const originalBaseUrlPublicApi = process.env.BASE_URL_PUBLIC_API;
const originalRoutingBootstrapPublicApiUrl = process.env.ROUTING_BOOTSTRAP_PUBLIC_API_URL;

function storedTokens(overrides: Partial<StoredTokens> = {}): StoredTokens {
  return {
    accessToken: '<fixture-cached-access-value>',
    expiresAt: Date.now() + 60_000,
    tenantId: profile.DEFAULT_PROD_AUTH_TENANT_ID,
    tenantName: profile.DEFAULT_PROD_AUTH_TENANT_NAME,
    clientId: profile.DEFAULT_PROD_AUTH_CLIENT_ID,
    ...overrides,
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

beforeEach(() => {
  delete process.env.BASE_URL_PUBLIC_API;
  delete process.env.ROUTING_BOOTSTRAP_PUBLIC_API_URL;
  vi.spyOn(profile, 'getActiveProfile').mockReturnValue('default');
  vi.spyOn(profile, 'loadProfileConfig').mockResolvedValue(null);
  vi.spyOn(config, 'findProjectRoot').mockResolvedValue(null);
  vi.spyOn(config, 'loadEnvFile').mockResolvedValue({});
  vi.spyOn(auth, 'loadTokens').mockResolvedValue(null);
  vi.spyOn(auth, 'getAccessToken').mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreEnv('BASE_URL_PUBLIC_API', originalBaseUrlPublicApi);
  restoreEnv('ROUTING_BOOTSTRAP_PUBLIC_API_URL', originalRoutingBootstrapPublicApiUrl);
});

describe('tenant list filtering', () => {
  test('recognises tenant-admin via role assignments', () => {
    const entry = createTenantEntry({
      roleAssignments: [{ baseRole: 'tenant-admin', displayName: 'Admin' }],
    });

    expect(tenantEntryHasTenantAdminRole(entry)).toBe(true);
  });

  test('recognises tenant-admin via compatibility fields', () => {
    expect(tenantEntryHasTenantAdminRole(createTenantEntry({ isTenantAdmin: true }))).toBe(true);
    expect(tenantEntryHasTenantAdminRole(createTenantEntry({ roles: ['tenant-user', 'tenant-admin'] }))).toBe(true);
    expect(tenantEntryHasTenantAdminRole(createTenantEntry({ role: 'tenant-admin' }))).toBe(true);
  });

  test('filters out non-admin and inactive memberships', () => {
    const entries: TenantEntry[] = [
      createTenantEntry({
        tenant: {
          id: 'tenant-admin',
          displayName: 'Tenant Admin',
          slug: 'tenant-admin',
          isActive: true,
        },
        roleAssignments: [{ baseRole: 'tenant-admin', displayName: 'Admin' }],
      }),
      createTenantEntry({
        tenant: {
          id: 'tenant-staff',
          displayName: 'Tenant Staff',
          slug: 'tenant-staff',
          isActive: true,
        },
        roleAssignments: [{ baseRole: 'tenant-staff', displayName: 'Staff' }],
      }),
      createTenantEntry({
        tenant: {
          id: 'tenant-inactive',
          displayName: 'Tenant Inactive',
          slug: 'tenant-inactive',
          isActive: false,
        },
        roleAssignments: [{ baseRole: 'tenant-admin', displayName: 'Admin' }],
      }),
    ];

    expect(filterTenantAdminEntries(entries)).toEqual([entries[0]]);
  });

  test('builds a clear zero-state for users without tenant-admin memberships', () => {
    expect(buildTenantListZeroState({
      tenantName: 'profile-dev-tenant',
      tenantId: 'dev-tenant-id',
    })).toEqual({
      headline: 'No active tenant-admin memberships found for the current login.',
      tenantContext: 'Authenticated tenant context: profile-dev-tenant (dev-tenant-id)',
      hint: 'Use `eai whoami` to inspect the authenticated tenant context.',
    });
  });

  test('matches parent tenant via parent metadata or direct tenant id fallback', () => {
    const childEntry = createTenantEntry({
      tenant: {
        id: 'child-tenant',
        displayName: 'Child Tenant',
        slug: 'child-tenant',
        isActive: true,
        parent: { id: 'parent-tenant' },
      },
    });

    const directEntry = createTenantEntry({
      tenant: {
        id: 'direct-tenant',
        displayName: 'Direct Tenant',
        slug: 'direct-tenant',
        isActive: true,
      },
    });

    expect(tenantMatchesParent(childEntry, 'parent-tenant')).toBe(true);
    expect(tenantMatchesParent(directEntry, 'direct-tenant')).toBe(true);
    expect(tenantMatchesParent(childEntry, 'other-tenant')).toBe(false);
  });

  test('normalizes flat admin membership payloads into tenant entries', () => {
    expect(normalizeTenantEntries({
      tenants: [{
        id: 'tenant-admin',
        displayName: 'Tenant Admin',
        slug: 'tenant-admin',
        isTenantAdmin: true,
        roles: ['tenant-admin'],
      }],
    })).toEqual([{
      tenant: {
        id: 'tenant-admin',
        displayName: 'Tenant Admin',
        slug: 'tenant-admin',
        isActive: true,
        parent: undefined,
        parentId: undefined,
        domain: undefined,
      },
      isTenantAdmin: true,
      roles: ['tenant-admin'],
    }]);
  });

  test('normalizes PublicAPI tenant membership payloads with singular role', () => {
    const entries = normalizeTenantEntries({
      tenants: [{
        id: 'tenant-mikeno',
        displayName: 'Mikeno',
        slug: 'dev-mikeno-41b96a77',
        role: 'tenant-admin',
        depth: 1,
        createdAt: '2026-05-08T00:00:00Z',
      }],
      totalCount: 1,
      cacheHit: false,
    });

    expect(filterTenantAdminEntries(entries)).toEqual([{
      tenant: {
        id: 'tenant-mikeno',
        displayName: 'Mikeno',
        slug: 'dev-mikeno-41b96a77',
        isActive: true,
        parent: undefined,
        parentId: undefined,
        domain: undefined,
      },
      role: 'tenant-admin',
      roles: undefined,
      isTenantAdmin: undefined,
    }]);
  });

  test('HP003 preserves homeRegion so Canada accounts use the Canada PublicAPI URL', () => {
    const [entry] = normalizeTenantEntries({
      tenants: [{
        id: 'tenant-ca',
        displayName: 'Canada Workspace',
        slug: 'canada-workspace',
        role: 'tenant-admin',
        depth: 1,
        createdAt: '2026-05-08T00:00:00Z',
        homeRegion: 'ca',
        hqCountryCode: 'CA',
      }],
    });

    expect(entry).toBeDefined();
    const membership = toTenantMembership(entry!);

    expect(membership.homeRegion).toBe('ca');
    expect(publicApiUrlForHomeRegion(membership.homeRegion)).toBe(
      'https://api.ca.myenterprise.ai/public',
    );
  });

  test('HP004 hydrates missing membership homeRegion from tenant management details', async () => {
    vi.mocked(auth.loadTokens).mockResolvedValue(storedTokens({ oid: 'user-oid' }));
    vi.mocked(auth.getAccessToken).mockResolvedValue('access-token');
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === `${DEFAULT_PUBLIC_API_URL}/v4/identity/tenants`) {
        return new Response(
          JSON.stringify({
            tenants: [{
              id: 'tenant-eu',
              displayName: 'Denmark Workspace',
              slug: 'denmark-workspace',
              role: 'tenant-admin',
              isActive: true,
            }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (href === `${DEFAULT_PUBLIC_API_URL}/v4/platform/tenants/tenant-eu/management`) {
        return new Response(
          JSON.stringify({
            id: 'tenant-eu',
            displayName: 'Denmark Workspace',
            slug: 'denmark-workspace',
            homeRegion: 'eu',
            hqCountryCode: 'DK',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(`Unhandled request: ${href}`, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchTenantAdminMemberships(DEFAULT_PUBLIC_API_URL);

    expect(result.memberships[0]?.homeRegion).toBe('eu');
    expect(result.memberships[0]?.hqCountryCode).toBe('DK');
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_PUBLIC_API_URL}/v4/platform/tenants/tenant-eu/management`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('HP005 resolves PublicAPI URL from tenant management when cached homeRegion is missing', async () => {
    vi.mocked(auth.loadTokens).mockResolvedValue(storedTokens({
      oid: 'user-oid',
      activeTenantId: 'tenant-eu',
      activeTenantName: 'Denmark Workspace',
      activeTenantSlug: 'denmark-workspace',
      activeTenantHomeRegion: null,
      membershipsCachedAt: Date.now(),
    }));
    const storeTokensSpy = vi.spyOn(auth, 'storeTokens').mockResolvedValue();
    vi.mocked(auth.getAccessToken).mockResolvedValue('access-token');
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === `${DEFAULT_PUBLIC_API_URL}/v4/identity/tenants`) {
        return new Response(
          JSON.stringify({
            tenants: [{
              id: 'tenant-eu',
              displayName: 'Denmark Workspace',
              slug: 'denmark-workspace',
              role: 'tenant-admin',
              isActive: true,
            }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (href === `${DEFAULT_PUBLIC_API_URL}/v4/platform/tenants/tenant-eu/management`) {
        return new Response(
          JSON.stringify({
            id: 'tenant-eu',
            displayName: 'Denmark Workspace',
            slug: 'denmark-workspace',
            homeRegion: 'eu',
            hqCountryCode: 'DK',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(`Unhandled request: ${href}`, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolvePublicApiUrl()).resolves.toBe('https://api.eu.myenterprise.ai/public');

    expect(storeTokensSpy).toHaveBeenCalledWith(expect.objectContaining({
      activeTenantHomeRegion: 'eu',
      activeTenantHqCountryCode: 'DK',
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('evaluates a created-only tenant as not yet usable', () => {
    expect(evaluateTenantUsability('tenant-1', [])).toEqual({
      tenantId: 'tenant-1',
      created: true,
      bootstrapped: false,
      membershipConfirmed: false,
      adminConfirmed: false,
      usable: false,
      autoSelected: false,
    });
  });

  test('evaluates a direct tenant-admin membership as usable', () => {
    const memberships: TenantMembership[] = [{
      id: 'tenant-1',
      displayName: 'Tenant One',
      slug: 'tenant-one',
      isActive: true,
      roles: ['tenant-admin'],
    }];

    expect(evaluateTenantUsability('tenant-1', memberships, {
      bootstrapped: true,
      autoSelected: true,
    })).toEqual({
      tenantId: 'tenant-1',
      created: true,
      bootstrapped: true,
      membershipConfirmed: true,
      adminConfirmed: true,
      usable: true,
      autoSelected: true,
    });
  });

  test('describes a bootstrapped and auto-selected child tenant truthfully', () => {
    const outcome: TenantCreateOutcome = {
      tenant: { id: 'tenant-1', slug: 'tenant-one' },
      bootstrap: {
        parentTenantId: 'parent-1',
        childTenantId: 'tenant-1',
        userOid: 'user-1',
        membershipCreated: true,
        adminAssigned: true,
        usable: true,
        status: 'bootstrapped',
        reason: null,
      },
      usability: {
        tenantId: 'tenant-1',
        created: true,
        bootstrapped: true,
        membershipConfirmed: true,
        adminConfirmed: true,
        usable: true,
        autoSelected: true,
      },
    };

    expect(buildTenantCreateStatusMessages(outcome)).toEqual([
      'Bootstrap: first tenant admin was provisioned for the current login.',
      'Usable: direct tenant-admin confirmed and the new tenant was selected.',
    ]);
  });

  test('describes missing bootstrap confirmation without overstating readiness', () => {
    const outcome: TenantCreateOutcome = {
      tenant: { id: 'tenant-1', slug: 'tenant-one' },
      bootstrapError: {
        status: 409,
        code: 'CHILD_ALREADY_HAS_ADMIN',
        message: 'Tenant tenant-1 already has a tenant admin',
      },
      usability: {
        tenantId: 'tenant-1',
        created: true,
        bootstrapped: false,
        membershipConfirmed: false,
        adminConfirmed: false,
        usable: false,
        autoSelected: false,
      },
    };

    expect(buildTenantCreateStatusMessages(outcome)).toEqual([
      'Bootstrap not confirmed: CHILD_ALREADY_HAS_ADMIN: Tenant tenant-1 already has a tenant admin',
      'Usable: not yet confirmed. The tenant exists, but direct tenant-admin membership is not visible yet.',
    ]);
  });

  test('describes bootstrap failure as non-fatal when direct tenant-admin is already confirmed', () => {
    const outcome: TenantCreateOutcome = {
      tenant: { id: 'tenant-1', slug: 'tenant-one' },
      bootstrapError: {
        status: 403,
        code: 'TENANT_ACCESS_DENIED',
        message: 'User does not have access to tenant tenant-1',
      },
      usability: {
        tenantId: 'tenant-1',
        created: true,
        bootstrapped: false,
        membershipConfirmed: true,
        adminConfirmed: true,
        usable: true,
        autoSelected: true,
      },
    };

    expect(buildTenantCreateStatusMessages(outcome)).toEqual([
      'Bootstrap not confirmed: TENANT_ACCESS_DENIED: User does not have access to tenant tenant-1',
      'Usable: direct tenant-admin confirmed and the new tenant was selected.',
    ]);
  });

  test('describes retrospective child tenant admin bootstrap truthfully', () => {
    expect(buildTenantBootstrapAdminStatusMessages({
      parentTenantId: 'parent-1',
      childTenantId: 'child-1',
      userOid: 'user-1',
      membershipCreated: true,
      adminAssigned: true,
      usable: true,
      status: 'bootstrapped',
      reason: null,
    })).toEqual([
      'Bootstrap: tenant-admin access was provisioned for the target user.',
      'Membership: child tenant membership was created.',
      'Role: tenant-admin was assigned on the child tenant.',
      'Usable: direct tenant-admin confirmed for the child tenant.',
    ]);

    expect(buildTenantBootstrapAdminStatusMessages({
      parentTenantId: 'parent-1',
      childTenantId: 'child-1',
      userOid: 'user-1',
      membershipCreated: false,
      adminAssigned: false,
      usable: true,
      status: 'already-usable',
      reason: 'target_user_already_child_tenant_admin',
    })).toEqual([
      'Bootstrap: the target user already had direct tenant-admin on the child tenant.',
      'Membership: child tenant membership already existed or did not need creation.',
      'Role: tenant-admin was already assigned or did not need assignment.',
      'Usable: direct tenant-admin confirmed for the child tenant.',
    ]);
  });

  test('extracts the created tenant record from nested create responses', () => {
    expect(extractCreatedTenantRecord({
      doc: {
        id: 'tenant-2',
        slug: 'tenant-two',
      },
      message: 'Tenant successfully created.',
    })).toEqual({
      id: 'tenant-2',
      slug: 'tenant-two',
    });

    expect(extractCreatedTenantRecord({
      id: 'tenant-1',
      slug: 'tenant-one',
    })).toEqual({
      id: 'tenant-1',
      slug: 'tenant-one',
    });
  });
});

describe('PublicAPI URL routing order', () => {
  test('uses named profile PublicAPI URL before environment or tenant routing', async () => {
    process.env.BASE_URL_PUBLIC_API = 'https://env.example.test/public';
    vi.mocked(profile.getActiveProfile).mockReturnValue('canada');
    vi.mocked(profile.loadProfileConfig).mockResolvedValue({
      publicApiUrl: 'https://profile.example.test/public',
      authTenantName: 'Profile Tenant',
      authTenantId: 'profile-tenant',
      authClientId: 'profile-client',
    });

    await expect(resolvePublicApiUrl('/workspace')).resolves.toBe(
      'https://profile.example.test/public',
    );
    expect(config.loadEnvFile).not.toHaveBeenCalled();
    expect(auth.loadTokens).not.toHaveBeenCalled();
  });

  test('uses BASE_URL_PUBLIC_API before stored tenant region routing', async () => {
    vi.mocked(config.findProjectRoot).mockResolvedValue('/workspace');
    vi.mocked(config.loadEnvFile).mockResolvedValue({
      BASE_URL_PUBLIC_API: 'https://env.example.test/public',
    });
    vi.mocked(auth.loadTokens).mockResolvedValue(storedTokens({
      activeTenantHomeRegion: 'ca',
    }));

    await expect(resolvePublicApiUrl()).resolves.toBe(
      'https://env.example.test/public',
    );
    expect(auth.loadTokens).not.toHaveBeenCalled();
  });

  test('uses stored active tenant home region before session routing', async () => {
    vi.mocked(auth.loadTokens).mockResolvedValue(storedTokens({
      activeTenantId: 'tenant-eu',
      activeTenantHomeRegion: 'eu',
    }));

    await expect(resolvePublicApiUrl('/workspace')).resolves.toBe(
      'https://api.eu.myenterprise.ai/public',
    );
    expect(auth.getAccessToken).not.toHaveBeenCalled();
  });

  test('uses trusted session routing when no override or stored home region exists', async () => {
    vi.mocked(auth.loadTokens).mockResolvedValue(storedTokens({
      activeTenantId: 'tenant-ca',
    }));
    vi.mocked(auth.getAccessToken).mockResolvedValue('session-token');
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        status: 'resolved',
        apiBaseUrl: 'https://api.ca.myenterprise.ai',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolvePublicApiUrl('/workspace')).resolves.toBe(
      'https://api.ca.myenterprise.ai/public',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_PUBLIC_API_URL}/v4/identity/session/resolve`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer session-token',
        }),
        body: JSON.stringify({
          product: 'eai-cli',
          requestedTenantId: 'tenant-ca',
        }),
      }),
    );
  });

  test('allows loopback session routing for local dev-stack smoke tests', async () => {
    vi.mocked(auth.loadTokens).mockResolvedValue(storedTokens({
      activeTenantId: 'tenant-local',
    }));
    vi.mocked(auth.getAccessToken).mockResolvedValue('session-token');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        status: 'resolved',
        apiBaseUrl: 'http://localhost:8000',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    await expect(resolvePublicApiUrl('/workspace')).resolves.toBe(
      'http://localhost:8000',
    );
  });

  test('falls back to AU when session routing returns an untrusted host', async () => {
    vi.mocked(auth.loadTokens).mockResolvedValue(storedTokens({
      activeTenantId: 'tenant-ca',
    }));
    vi.mocked(auth.getAccessToken).mockResolvedValue('session-token');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        status: 'resolved',
        apiBaseUrl: 'https://attacker.example/public',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    await expect(resolvePublicApiUrl('/workspace')).resolves.toBe(
      DEFAULT_PUBLIC_API_URL,
    );
  });

  test('falls back to AU when no routing input is available', async () => {
    await expect(resolvePublicApiUrl('/workspace')).resolves.toBe(
      DEFAULT_PUBLIC_API_URL,
    );
  });
});

describe('main company tenant resolution', () => {
  test('HP001 uses the selected tenant even when public metadata includes parent fields', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith('/v4/platform/tenants/builder-child/management')) {
        return new Response(
          JSON.stringify({
            id: 'builder-child',
            tier: 'developer',
            parentTenantId: 'builder-workspace',
            ultimateParentId: 'eai-developers',
          }),
          { status: 200 },
        );
      }
      return new Response('unexpected parent lookup', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      resolveMainCompanyTenantId('https://test-api.example.com', 'builder-child'),
    ).resolves.toBe('builder-child');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('HP002 uses the selected Builder workspace when tenant tier is omitted', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith('/v4/platform/tenants/builder-workspace/management')) {
        return new Response(
          JSON.stringify({
            id: 'builder-workspace',
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            parentTenant: 'eai-developers',
            ultimateParent: 'eai-developers',
          }),
          { status: 200 },
        );
      }
      return new Response('unexpected parent lookup', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      resolveMainCompanyTenantId('https://test-api.example.com', 'builder-workspace'),
    ).resolves.toBe('builder-workspace');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('HP003 ignores ultimateParentId in public management metadata', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        id: 'team-child',
        tier: 'business',
        parentTenantId: 'team-department',
        ultimateParentId: 'team-root',
      }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      resolveMainCompanyTenantId('https://test-api.example.com', 'team-child'),
    ).resolves.toBe('team-child');
  });

  test('BP001 rejects unresolved selected tenants instead of guessing a company root', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })));

    await expect(
      resolveMainCompanyTenantId('https://test-api.example.com', 'missing-tenant'),
    ).rejects.toThrow('Tenant missing-tenant could not be resolved (404). missing');
  });
});
