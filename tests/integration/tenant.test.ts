/**
 * Tenant command filtering tests.
 */

import { describe, expect, test } from 'vitest';
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
  tenantEntryHasTenantAdminRole,
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
