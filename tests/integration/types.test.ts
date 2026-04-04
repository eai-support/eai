/**
 * Tenant resolution tests for eai types.
 */

import { describe, expect, test } from 'vitest';
import {
  resolveDefaultTenantKey,
  resolveTenantIdForKey,
  verifyTypeSeedConvergence,
} from '../../src/commands/types.js';

describe('resolveTenantIdForKey', () => {
  test('uses the explicit CLI tenant override when present', () => {
    const resolution = resolveTenantIdForKey(
      'council',
      'tenant-council-id',
    );

    expect(resolution).toEqual({
      tenantId: 'tenant-council-id',
      source: 'option',
    });
  });

  test('uses the active tenant when no explicit override is provided', () => {
    const resolution = resolveTenantIdForKey(
      'template',
      undefined,
      'active-tenant-id',
    );

    expect(resolution).toEqual({
      tenantId: 'active-tenant-id',
      source: 'active:tenant',
    });
  });

  test('returns unresolved details when no active tenant or override exists', () => {
    const resolution = resolveTenantIdForKey('council');

    expect(resolution).toEqual({
      source: 'unresolved',
    });
  });
});

describe('resolveDefaultTenantKey', () => {
  test('prefers the only configured key', () => {
    expect(resolveDefaultTenantKey({
      council: [],
    })).toBe('council');
  });

  test('prefers an exact match on the active tenant slug', () => {
    expect(resolveDefaultTenantKey({
      council: [],
      template: [],
    }, 'council')).toBe('council');
  });

  test('falls back to template before default when multiple keys exist', () => {
    expect(resolveDefaultTenantKey({
      council: [],
      template: [],
      default: [],
    })).toBe('template');
  });
});

describe('verifyTypeSeedConvergence', () => {
  test('reports converged when all requested types are published remotely', () => {
    expect(verifyTypeSeedConvergence(
      'tenant-1',
      ['Customer', 'Project'],
      {
        docs: [
          { name: 'Customer', slug: 'customer', status: 'published' },
          { name: 'Project', slug: 'project', status: 'published' },
        ],
      },
      {
        createdCount: 1,
        updatedCount: 1,
        failedCount: 0,
      },
    )).toEqual({
      tenantId: 'tenant-1',
      requestedTypes: ['Customer', 'Project'],
      matchedTypes: ['Customer', 'Project'],
      missingTypes: [],
      driftedTypes: [],
      createdCount: 1,
      updatedCount: 1,
      failedCount: 0,
      converged: true,
    });
  });

  test('reports partial when some requested types are still drafts remotely', () => {
    expect(verifyTypeSeedConvergence(
      'tenant-1',
      ['Customer', 'Project'],
      {
        docs: [
          { name: 'Customer', slug: 'customer', status: 'published' },
          { name: 'Project', slug: 'project', status: 'draft' },
        ],
      },
      {
        createdCount: 0,
        updatedCount: 1,
        failedCount: 0,
      },
    )).toEqual({
      tenantId: 'tenant-1',
      requestedTypes: ['Customer', 'Project'],
      matchedTypes: ['Customer'],
      missingTypes: [],
      driftedTypes: ['Project'],
      createdCount: 0,
      updatedCount: 1,
      failedCount: 0,
      converged: false,
    });
  });

  test('reports partial when requested types are missing or writes failed', () => {
    expect(verifyTypeSeedConvergence(
      'tenant-1',
      ['Customer', 'Project'],
      {
        docs: [
          { name: 'Customer', slug: 'customer', status: 'published' },
        ],
      },
      {
        createdCount: 1,
        updatedCount: 0,
        failedCount: 1,
      },
    )).toEqual({
      tenantId: 'tenant-1',
      requestedTypes: ['Customer', 'Project'],
      matchedTypes: ['Customer'],
      missingTypes: ['Project'],
      driftedTypes: [],
      createdCount: 1,
      updatedCount: 0,
      failedCount: 1,
      converged: false,
    });
  });
});
