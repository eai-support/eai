/**
 * Tenant command filtering tests.
 */

import { describe, expect, test } from 'vitest';
import { buildTenantListZeroState, tenantMatchesParent } from '../../src/commands/tenant.js';
import {
  filterTenantAdminEntries,
  normalizeTenantEntries,
  tenantEntryHasTenantAdminRole,
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
});
