/**
 * Tenant resolution tests for eai types.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildPayloadEqualsParams } from '../../src/lib/api.js';
import { loadObjectTypes, type ObjectTypeDefinition, type ObjectTypeProperty } from '../../src/lib/config.js';
import { validateObjectTypeDefaultValues } from '../../src/lib/object-type-defaults.js';
import {
  collectTypeDefaultValueValidationIssues,
  describeFailedPlatformResponse,
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

function buildObjectType(properties: ObjectTypeProperty[]): ObjectTypeDefinition {
  return {
    name: 'Workflow',
    displayName: 'Workflow',
    properties,
    linkTypes: [],
    actions: [],
    status: 'draft',
  };
}

describe('validateObjectTypeDefaultValues', () => {
  test.each([
    ['text string', { name: 'title', type: 'text', required: false, defaultValue: 'Untitled' }],
    ['text empty string', { name: 'summary', type: 'text', required: false, defaultValue: '' }],
    [
      'select simple string',
      {
        name: 'status',
        type: 'select',
        required: false,
        defaultValue: 'draft',
        options: [{ label: 'Draft', value: 'draft' }],
      },
    ],
    [
      'select hyphenated value',
      {
        name: 'stage',
        type: 'select',
        required: false,
        defaultValue: 'in-review',
        options: [{ label: 'In Review', value: 'in-review' }],
      },
    ],
    [
      'select numeric-looking value',
      {
        name: 'priorityCode',
        type: 'select',
        required: false,
        defaultValue: '1',
        options: [{ label: 'One', value: '1' }],
      },
    ],
    ['date date-only string', { name: 'submittedOn', type: 'date', required: false, defaultValue: '2026-04-23' }],
    ['date timestamp string', { name: 'submittedAt', type: 'date', required: false, defaultValue: '2026-04-23T10:00:00Z' }],
    ['file URL string', { name: 'documentUrl', type: 'file', required: false, defaultValue: 'https://blob.example/doc.pdf' }],
    ['file blob reference string', { name: 'documentRef', type: 'file', required: false, defaultValue: 'tenant/workflow/doc.pdf' }],
    ['relationship UUID string', { name: 'ownerId', type: 'relationship', required: false, defaultValue: '550e8400-e29b-41d4-a716-446655440000' }],
    ['integer number', { name: 'priority', type: 'number', required: false, defaultValue: 1 }],
    ['decimal number', { name: 'score', type: 'number', required: false, defaultValue: 1.5 }],
    ['boolean true', { name: 'active', type: 'boolean', required: false, defaultValue: true }],
    ['boolean false', { name: 'archived', type: 'boolean', required: false, defaultValue: false }],
    ['json object', { name: 'metadata', type: 'json', required: false, defaultValue: { source: 'seed' } }],
    ['json array', { name: 'tags', type: 'json', required: false, defaultValue: ['seeded', 'workflow'] }],
    ['json string', { name: 'jsonText', type: 'json', required: false, defaultValue: 'literal' }],
    ['json number', { name: 'jsonNumber', type: 'json', required: false, defaultValue: 7 }],
    ['json boolean', { name: 'jsonFlag', type: 'json', required: false, defaultValue: false }],
    ['explicit null', { name: 'optionalNote', type: 'text', required: false, defaultValue: null }],
  ])('accepts %s default values', (_label, property) => {
    expect(validateObjectTypeDefaultValues(buildObjectType([property as ObjectTypeProperty]))).toEqual([]);
  });

  test.each([
    [
      'select default outside option values',
      {
        name: 'status',
        type: 'select',
        required: false,
        defaultValue: 'archived',
        options: [{ label: 'Draft', value: 'draft' }],
      },
      'must match one of the select option values',
    ],
    [
      'select default without options',
      { name: 'status', type: 'select', required: false, defaultValue: 'draft' },
      'select property has no options',
    ],
    [
      'text default as number',
      { name: 'title', type: 'text', required: false, defaultValue: 1 },
      'must be a string',
    ],
    [
      'number default as string',
      { name: 'priority', type: 'number', required: false, defaultValue: '1' },
      'must be a finite number',
    ],
    [
      'boolean default as string',
      { name: 'active', type: 'boolean', required: false, defaultValue: 'true' },
      'must be a boolean',
    ],
  ])('rejects %s', (_label, property, message) => {
    expect(validateObjectTypeDefaultValues(buildObjectType([property as ObjectTypeProperty]))).toEqual([
      expect.stringContaining(message),
    ]);
  });
});

describe('collectTypeDefaultValueValidationIssues', () => {
  test('reports tenant and type context for seed-time defaultValue failures', () => {
    const issues = collectTypeDefaultValueValidationIssues({
      template: [
        buildObjectType([
          {
            name: 'status',
            type: 'select',
            required: false,
            defaultValue: 'archived',
            options: [{ label: 'Draft', value: 'draft' }],
          },
        ]),
      ],
    });

    expect(issues).toEqual([
      {
        tenantKey: 'template',
        typeName: 'Workflow',
        issue: expect.stringContaining('must match one of the select option values'),
      },
    ]);
  });
});

describe('describeFailedPlatformResponse', () => {
  test('includes server validation detail from JSON error responses', async () => {
    const response = new Response(
      JSON.stringify({ errors: [{ message: 'Properties 1 > Default Value: This field has an invalid input.' }] }),
      {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'x-request-id': 'request-123' },
      },
    );

    await expect(describeFailedPlatformResponse(response)).resolves.toBe(
      '400 Bad Request - Properties 1 > Default Value: This field has an invalid input. (request request-123)',
    );
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
