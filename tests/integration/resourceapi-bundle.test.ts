import { describe, expect, test } from 'vitest';

import {
  PASSIVE_RESOURCEAPI_BUNDLE_SCHEMA,
  buildPassiveResourceApiBundle,
  extractObjectTypesForPassiveBundle,
} from '../../src/lib/resourceapi-bundle.js';

describe('ResourceAPI passive bundle builder', () => {
  test('builds tenant-scoped passive snapshot from Configurator objectTypes export', () => {
    const bundle = buildPassiveResourceApiBundle(
      {
        objectTypes: [
          {
            id: 'planning-document',
            name: 'Planning Document',
            slug: 'planning-document',
            status: 'published',
            storageBackend: 'postgresql',
          },
          {
            id: 'integration-source',
            name: 'Integration Source',
            slug: 'integration-source',
            status: 'published',
            storageBackend: 'mongodb',
          },
          {
            id: 'draft-only',
            name: 'Draft Only',
            slug: 'draft-only',
            status: 'draft',
            storageBackend: 'blob',
          },
        ],
      },
      {
        tenantId: 'tenant-1',
        installId: 'install-1',
        productKey: 'daisy-assist',
        source: 'object-types.json',
        generatedAt: '2026-06-01T00:00:00.000Z',
        schemaVersion: '42',
      },
    );

    expect(bundle.schemaVersion).toBe(PASSIVE_RESOURCEAPI_BUNDLE_SCHEMA);
    expect(bundle.productKeys).toEqual(['daisy-assist']);
    expect(bundle.objectTypes.map((objectType) => objectType.slug)).toEqual([
      'planning-document',
      'integration-source',
    ]);
    expect(bundle.storageBackends).toEqual(['documentdb', 'postgresql']);
    expect(bundle.tenants['tenant-1']?.installId).toBe('install-1');
    expect(bundle.tenants['tenant-1']?.objectTypes).toHaveLength(2);
    expect(bundle.metadata.schemaVersion).toBe('42');
  });

  test('accepts ResourceAPI schema endpoint object_types response shape', () => {
    const objectTypes = extractObjectTypesForPassiveBundle({
      object_types: [
        {
          id: 'blob-doc',
          name: 'Blob Doc',
          slug: 'blob-doc',
          storageBackend: 'blob',
        },
      ],
    });

    expect(objectTypes).toEqual([
      {
        id: 'blob-doc',
        name: 'Blob Doc',
        slug: 'blob-doc',
        storageBackend: 'blob',
      },
    ]);
  });
});
