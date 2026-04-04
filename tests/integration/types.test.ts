/**
 * Tenant resolution tests for eai types.
 */

import { describe, expect, test } from 'vitest';
import { resolveDefaultTenantKey, resolveTenantIdForKey } from '../../src/commands/types.js';

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
