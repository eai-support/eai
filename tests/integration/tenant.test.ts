/**
 * Tenant command filtering tests.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  buildTenantCreateStatusMessages,
  buildTenantListZeroState,
  extractCreatedTenantRecord,
  tenantMatchesParent,
  type TenantCreateOutcome,
} from '../../src/commands/tenant.js';
import {
  evaluateTenantUsability,
  filterTenantAdminEntries,
  normalizeTenantEntries,
  publicApiUrlForHomeRegion,
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

afterEach(() => {
  vi.unstubAllGlobals();
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
      tenantName: 'eaidevmyentepriseai',
      tenantId: '50808ce0-f31b-4fd0-9861-74b83b8c112a',
    })).toEqual({
      headline: 'No active tenant-admin memberships found for the current login.',
      tenantContext: 'Authenticated tenant context: eaidevmyentepriseai (50808ce0-f31b-4fd0-9861-74b83b8c112a)',
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

describe('main company tenant resolution', () => {
  test('HP001 resolves nested Builder tenants to the Builder workspace instead of EAI Developers', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith('/v4/platform/tenants/builder-child')) {
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
      if (href.endsWith('/v4/platform/tenants/builder-workspace')) {
        return new Response(
          JSON.stringify({
            id: 'builder-workspace',
            tier: 'developer',
            parentTenantId: 'eai-developers',
            ultimateParentId: 'eai-developers',
          }),
          { status: 200 },
        );
      }
      return new Response('platform parent hidden from Builder users', { status: 403 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      resolveMainCompanyTenantId('https://test-api.example.com', 'builder-child'),
    ).resolves.toBe('builder-workspace');
  });

  test('HP002 infers Builder workspace from the EAI Developers root when tenant tier is omitted', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith('/v4/platform/tenants/builder-workspace')) {
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
      if (href.endsWith('/v4/platform/tenants/eai-developers')) {
        return new Response(
          JSON.stringify({
            id: 'eai-developers',
            displayName: 'EAI Developers',
            slug: 'eai-developers',
            parentTenant: null,
            ultimateParent: 'eai-developers',
          }),
          { status: 200 },
        );
      }
      return new Response('missing', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      resolveMainCompanyTenantId('https://test-api.example.com', 'builder-workspace'),
    ).resolves.toBe('builder-workspace');
  });

  test('HP003 resolves Team and Enterprise child tenants to the true customer root', async () => {
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
    ).resolves.toBe('team-root');
  });

  test('BP001 rejects unresolved selected tenants instead of guessing a company root', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })));

    await expect(
      resolveMainCompanyTenantId('https://test-api.example.com', 'missing-tenant'),
    ).rejects.toThrow('Tenant missing-tenant could not be resolved (404). missing');
  });
});
