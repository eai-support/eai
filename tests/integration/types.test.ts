/**
 * Tenant resolution tests for eai types.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildPayloadEqualsParams } from '../../src/lib/api.js';
import { loadObjectTypes } from '../../src/lib/config.js';
import {
  findMatchingRemoteTypes,
  resolveDefaultTenantKey,
  resolveTenantIdForKey,
  shouldFailTypeSeedRun,
  verifyTypeSeedConvergence,
} from '../../src/commands/types.js';
import { createTestEnvironment } from '../helpers/test-env.js';

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

  test('dedupes duplicate remote slugs by newest published type before comparing convergence', () => {
    expect(verifyTypeSeedConvergence(
      'tenant-1',
      ['ConversationMessage'],
      {
        docs: [
          {
            name: 'ConversationMessage',
            slug: 'conversation-message',
            status: 'published',
            publishedAt: '2026-04-04T00:00:00.000Z',
            properties: [{ name: 'councilName' }],
          },
          {
            name: 'ConversationMessage',
            slug: 'conversation-message',
            status: 'published',
            publishedAt: '2026-04-05T00:00:00.000Z',
            properties: [{ name: 'messageId' }],
          },
        ],
      },
      {
        createdCount: 0,
        updatedCount: 1,
        failedCount: 0,
      },
    )).toEqual({
      tenantId: 'tenant-1',
      requestedTypes: ['ConversationMessage'],
      matchedTypes: ['ConversationMessage'],
      missingTypes: [],
      driftedTypes: [],
      createdCount: 0,
      updatedCount: 1,
      failedCount: 0,
      converged: true,
    });
  });
});

describe('findMatchingRemoteTypes', () => {
  test('prefers the most recently published duplicate when multiple docs share a slug', () => {
    const matches = findMatchingRemoteTypes(
      [
        {
          id: 'older',
          name: 'ConversationMessage',
          slug: 'conversation-message',
          properties: [],
          linkTypes: [],
          actions: [],
          status: 'published',
          publishedAt: '2026-04-04T00:00:00.000Z',
        },
        {
          id: 'newer',
          name: 'ConversationMessage',
          slug: 'conversation-message',
          properties: [],
          linkTypes: [],
          actions: [],
          status: 'published',
          publishedAt: '2026-04-05T00:00:00.000Z',
        },
      ],
      'ConversationMessage',
    );

    expect(matches.map((doc) => doc.id)).toEqual(['newer', 'older']);
  });
});

describe('shouldFailTypeSeedRun', () => {
  test('returns false when every tenant verification converged', () => {
    expect(shouldFailTypeSeedRun([
      {
        verification: {
          tenantId: 'tenant-1',
          requestedTypes: ['Customer'],
          matchedTypes: ['Customer'],
          missingTypes: [],
          driftedTypes: [],
          createdCount: 1,
          updatedCount: 0,
          failedCount: 0,
          converged: true,
        },
      },
    ])).toBe(false);
  });

  test('returns true when any tenant verification did not converge', () => {
    expect(shouldFailTypeSeedRun([
      {
        verification: {
          tenantId: 'tenant-1',
          requestedTypes: ['Customer'],
          matchedTypes: [],
          missingTypes: ['Customer'],
          driftedTypes: [],
          createdCount: 0,
          updatedCount: 0,
          failedCount: 0,
          converged: false,
        },
      },
    ])).toBe(true);
  });
});

describe('loadObjectTypes', () => {
  test('loads object types through a file URL compatible temp import path', async () => {
    const env = await createTestEnvironment();
    const objectTypesDir = join(env.dir, 'src', 'eai.config');

    try {
      await mkdir(objectTypesDir, { recursive: true });
      await writeFile(
        join(objectTypesDir, 'object-types.ts'),
        'export const objectTypes = { template: [{ name: "TestType", displayName: "Test Type", properties: [], linkTypes: [], actions: [], status: "draft" }] };\n',
        'utf-8',
      );

      await expect(loadObjectTypes(env.dir)).resolves.toEqual({
        template: [
          {
            name: 'TestType',
            displayName: 'Test Type',
            properties: [],
            linkTypes: [],
            actions: [],
            status: 'draft',
          },
        ],
      });
    } finally {
      await env.cleanup();
    }
  });
});

describe('buildPayloadEqualsParams', () => {
  test('serializes Payload filters using flat query parameter keys', () => {
    expect(buildPayloadEqualsParams(
      {
        tenant: 'tenant-1',
        name: 'ConversationMessage',
      },
      {
        limit: 1,
        sort: 'name',
      },
    )).toEqual({
      'where[tenant][equals]': 'tenant-1',
      'where[name][equals]': 'ConversationMessage',
      limit: 1,
      sort: 'name',
    });
  });
});
