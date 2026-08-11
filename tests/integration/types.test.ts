/**
 * Tenant resolution tests for eai types.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildPayloadEqualsParams, PlatformAPIClient } from '../../src/lib/api.js';
import {
  canonicalizeObjectTypeRelationshipTargets,
  loadObjectTypes,
  validateObjectTypeDefinitions,
  type ObjectTypeDefinition,
  type ObjectTypeProperty,
} from '../../src/lib/config.js';
import { validateObjectTypeDefaultValues } from '../../src/lib/object-type-defaults.js';
import {
  appOwnedSqlTablePrefix,
  appObjectTypePublishFallbackReason,
  collectTypeDefaultValueValidationIssues,
  collectTypeStorageValidationIssues,
  describeFailedPlatformResponse,
  diffObjectTypesForTenant,
  findMatchingRemoteTypes,
  resolveDefaultTenantKey,
  resolveTenantIdForKey,
  resolveTypesPullOutputPath,
  shouldFailTypeSeedRun,
  summarizeAppObjectTypePublish,
  summarizeResourceApiSchemaSync,
  toAppManifestObjectTypes,
  trySeedViaAppManifestPublish,
  validateObjectTypeAppOwnedStorageMetadata,
  validateObjectTypeStorageMetadata,
  verifyTypeSeedConvergence,
  verifyTypeSeedConvergenceWithRetry,
  waitForResourceApiSchemaVisibility,
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

describe('resolveTypesPullOutputPath', () => {
  test('preserves absolute output paths and roots relative paths', async () => {
    const absolute = join('/tmp', 'eai-object-types.generated.ts');

    await expect(resolveTypesPullOutputPath('/project', absolute)).resolves.toBe(absolute);
    await expect(resolveTypesPullOutputPath('/project', 'src/eai.config/object-types.generated.ts')).resolves.toBe(
      join('/project', 'src/eai.config/object-types.generated.ts'),
    );
  });
});

describe('app object-type publish helpers', () => {
  test('diffObjectTypesForTenant reports local, remote, changed, and unchanged groups', () => {
    const result = diffObjectTypesForTenant(
      'smoke-app',
      'tenant-1',
      'option',
      [
        {
          name: 'Workflow',
          displayName: 'Workflow',
          properties: [
            { name: 'title', type: 'text', required: true },
            { name: 'status', type: 'text', required: false },
          ],
          linkTypes: [],
          actions: [],
        } as ObjectTypeDefinition,
        {
          name: 'LocalOnly',
          displayName: 'Local only',
          properties: [],
          linkTypes: [],
          actions: [],
        } as ObjectTypeDefinition,
        {
          name: 'Unchanged',
          displayName: 'Unchanged',
          properties: [{ name: 'title', type: 'text', required: true }],
          linkTypes: [],
          actions: [],
        } as ObjectTypeDefinition,
      ],
      [
        {
          name: 'Workflow',
          slug: 'workflow',
          properties: [{ name: 'title' }, { name: 'oldField' }],
          linkTypes: [],
          actions: [],
        },
        {
          name: 'Unchanged',
          slug: 'unchanged',
          properties: [{ name: 'title' }],
          linkTypes: [],
          actions: [],
        },
        {
          name: 'RemoteOnly',
          slug: 'remote-only',
          properties: [],
          linkTypes: [],
          actions: [],
        },
      ],
    );

    expect(result).toMatchObject({
      tenantKey: 'smoke-app',
      tenantId: 'tenant-1',
      resolutionSource: 'option',
      localCount: 3,
      remoteCount: 3,
    });
    expect(result.localOnly.map((entry) => entry.name)).toEqual(['LocalOnly']);
    expect(result.remoteOnly.map((entry) => entry.name)).toEqual(['RemoteOnly']);
    expect(result.unchanged.map((entry) => entry.name)).toEqual(['Unchanged']);
    expect(result.changed).toEqual([
      {
        name: 'Workflow',
        slug: 'workflow',
        addedProperties: ['status'],
        removedProperties: ['oldField'],
        unchangedProperties: ['title'],
      },
    ]);
  });

  test('marks manifest object types as published when status is omitted', () => {
    const objectType = {
      name: 'SubmissionFile',
      displayName: 'Submission file',
      properties: [],
      linkTypes: [],
      actions: [],
      storageBackend: 'blob',
      storageMetadataStatus: 'ready',
    } as unknown as ObjectTypeDefinition;

    expect(toAppManifestObjectTypes([objectType])).toEqual([
      {
        ...objectType,
        status: 'published',
      },
    ]);
  });

  test('preserves list-valued requiredStatus rules for app manifest publication', () => {
    const objectType = {
      name: 'Draft',
      displayName: 'Draft',
      properties: [],
      linkTypes: [],
      actions: [
        {
          name: 'approve',
          displayName: 'Approve',
          requiredRole: 'tenant-admin',
          validationRules: {
            requiredStatus: ['draft', 'review'],
          },
          sideEffects: [],
        },
      ],
    } as unknown as ObjectTypeDefinition;

    expect(toAppManifestObjectTypes([objectType])).toEqual([
      {
        ...objectType,
        status: 'published',
      },
    ]);
  });

  test('summarizes platform publish results including ResourceAPI sync metadata', () => {
    const objectType = {
      name: 'SubmissionFile',
      displayName: 'Submission file',
      properties: [],
      linkTypes: [],
      actions: [],
      status: 'published',
    } as ObjectTypeDefinition;

    expect(summarizeAppObjectTypePublish('no-code-builder', 'tenant-1', [objectType], {
      results: [
        { name: 'SubmissionFile', status: 'created' },
      ],
      verification: {
        tenantId: 'tenant-1',
        requestedTypes: ['SubmissionFile'],
        matchedTypes: ['SubmissionFile'],
        missingTypes: [],
        driftedTypes: [],
        createdCount: 1,
        updatedCount: 0,
        failedCount: 0,
        converged: true,
      },
      resourceApiSchemaSync: {
        status: 'queued',
      },
    })).toEqual({
      tenantKey: 'no-code-builder',
      tenantId: 'tenant-1',
      created: 1,
      updated: 0,
      failed: 0,
      publishingMode: 'app-manifest',
      resourceApiSchemaSync: {
        status: 'queued',
      },
      verification: {
        tenantId: 'tenant-1',
        requestedTypes: ['SubmissionFile'],
        matchedTypes: ['SubmissionFile'],
        missingTypes: [],
        driftedTypes: [],
        createdCount: 1,
        updatedCount: 0,
        failedCount: 0,
        converged: true,
      },
    });
  });

  test('does not fall back to direct object-type writes when manifest validation fails', async () => {
    await expect(appObjectTypePublishFallbackReason(new Response('{}', { status: 422 }), 'publish')).resolves.toBeNull();
  });

  test('adds app-owned storage repair guidance to manifest publish validation failures', async () => {
    const objectType = {
      name: 'FeedItem',
      displayName: 'Feed item',
      properties: [],
      linkTypes: [],
      actions: [],
      storageBackend: 'postgresql',
      storageMetadataStatus: 'ready',
      status: 'published',
    } as ObjectTypeDefinition;
    const client = {
      saveAppObjectTypeManifest: async () => new Response('{}', { status: 200 }),
      publishAppObjectTypes: async () => new Response(JSON.stringify({
        error: 'VALIDATION_ERROR',
        message: 'postgresql storageBinding databaseAlias "resourceapi-postgres" is not authorized for this tenant app',
      }), {
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: { 'content-type': 'application/json' },
      }),
    } as unknown as PlatformAPIClient;

    await expect(
      trySeedViaAppManifestPublish(client, 'post-pilot', '5dd8db37-0993-f01c-0487-e8f0fae6c3d7', [objectType]),
    ).rejects.toThrow(/tenant app Object Types must use app-owned storage bindings/);
  });

  test('does not fall back to direct object-type writes when manifest route is missing', async () => {
    await expect(appObjectTypePublishFallbackReason(new Response('{}', { status: 404 }), 'publish')).resolves.toBeNull();
  });

  test('falls back to direct object-type writes when the tenant has no app enrollment (404 app not found)', async () => {
    const res = new Response('App was not found for this company.', { status: 404 });
    await expect(appObjectTypePublishFallbackReason(res, 'save')).resolves.toMatch(/no app enrollment/);
  });

  test('uses AdminAPI resource schema sync metadata from manifest publication', async () => {
    const objectType = {
      name: 'SubmissionFile',
      displayName: 'Submission file',
      properties: [],
      linkTypes: [],
      actions: [],
      storageBackend: 'blob',
      storageMetadataStatus: 'ready',
      status: 'published',
    } as ObjectTypeDefinition;
    const client = {
      saveAppObjectTypeManifest: async () => new Response('{}', { status: 200 }),
      publishAppObjectTypes: async () => new Response(JSON.stringify({
        results: [
          { name: 'SubmissionFile', status: 'created' },
        ],
        verification: {
          tenantId: 'tenant-1',
          requestedTypes: ['SubmissionFile'],
          matchedTypes: ['SubmissionFile'],
          missingTypes: [],
          driftedTypes: [],
          createdCount: 1,
          updatedCount: 0,
          failedCount: 0,
          converged: true,
        },
        resourceApiSchemaSync: {
          status: 'queued',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      syncStorageSchema: async () => {
        throw new Error('app manifest path must not call direct ResourceAPI sync');
      },
    } as unknown as PlatformAPIClient;

    const outcome = await trySeedViaAppManifestPublish(client, 'no-code-builder', 'tenant-1', [objectType]);

    expect(outcome.fallbackReason).toBeUndefined();
    expect(outcome.result?.resourceApiSchemaSync).toMatchObject({
      status: 'queued',
    });
  });
});

describe('ResourceAPI schema sync summary', () => {
  test('marks a successful schema sync payload as synced', async () => {
    const response = new Response(JSON.stringify({
      tenantId: 'tenant-1',
      dryRun: false,
      results: [
        { objectType: 'Project', backend: 'postgresql', status: 'provisioned' },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(summarizeResourceApiSchemaSync(response, ['project'])).resolves.toEqual({
      tenantId: 'tenant-1',
      dryRun: false,
      results: [
        { objectType: 'Project', backend: 'postgresql', status: 'provisioned' },
      ],
      status: 'synced',
    });
  });

  test('marks schema sync as failed when no result proves requested bindings', async () => {
    const response = new Response(JSON.stringify({
      tenantId: 'tenant-1',
      results: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(summarizeResourceApiSchemaSync(response, ['Project'])).resolves.toMatchObject({
      status: 'failed',
      missingObjectTypes: ['project'],
    });
  });

  test('marks schema sync as failed when any binding fails', async () => {
    const response = new Response(JSON.stringify({
      tenantId: 'tenant-1',
      results: [
        { objectType: 'Project', backend: 'postgresql', status: 'failed' },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(summarizeResourceApiSchemaSync(response)).resolves.toMatchObject({
      status: 'failed',
    });
  });

  test('marks schema sync as failed when requested binding is skipped', async () => {
    const response = new Response(JSON.stringify({
      tenantId: 'tenant-1',
      results: [
        { objectType: 'Project', backend: 'postgresql', status: 'skipped' },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(summarizeResourceApiSchemaSync(response, ['Project'])).resolves.toMatchObject({
      status: 'failed',
      missingObjectTypes: ['project'],
    });
  });

  test('adds actionable guidance for untrusted ResourceAPI background applies', async () => {
    const response = new Response(JSON.stringify({
      tenantId: 'tenant-1',
      errorCode: 'RESOURCEAPI_SCHEMA_BACKGROUND_APPLY_UNTRUSTED_INSTALL',
      message: 'ResourceAPI runtime schema refresh skipped.',
      result: {
        installTrustFingerprint: {
          installId: 'eai-prod-ae-resourceapi',
          mode: 'customer-hosted-passive',
        },
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(summarizeResourceApiSchemaSync(response, ['FactBatchLoad'])).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'RESOURCEAPI_SCHEMA_BACKGROUND_APPLY_UNTRUSTED_INSTALL',
      missingObjectTypes: ['fact-batch-load'],
      guidance: {
        platformActionRequired: true,
        currentState: expect.stringContaining('published to platform metadata'),
        reason: expect.stringContaining('mode=customer-hosted-passive'),
        fix: expect.stringContaining('mode=eai-hosted'),
        nextSteps: expect.arrayContaining([
          expect.stringContaining('eai resources schema --tenant-id tenant-1'),
          expect.stringContaining('--install-id eai-prod-ae-resourceapi'),
        ]),
      },
    });
  });

  test('captures non-2xx schema sync responses as failed', async () => {
    const response = new Response(JSON.stringify({
      detail: 'storage sync failed',
    }), {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'content-type': 'application/json' },
    });

    await expect(summarizeResourceApiSchemaSync(response)).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('500 Internal Server Error'),
    });
  });

  test('redacts secrets in failed ResourceAPI result details', async () => {
    const response = new Response(JSON.stringify({
      tenantId: 'tenant-1',
      results: [
        {
          objectType: 'Project',
          backend: 'documentdb',
          status: 'failed',
          reason: 'connect failed for mongodb://admin:s3cr3t@cluster.example:27017/db',
          details: {
            issues: ['auth rejected, password=hunter2 supplied'],
          },
          error: 'mongodb://user:pass@host/db unreachable',
        },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const summary = await summarizeResourceApiSchemaSync(response, ['Project']);
    const serialized = JSON.stringify(summary);

    expect(summary).toMatchObject({ status: 'failed' });
    expect(serialized).not.toContain('s3cr3t');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('user:pass');
    expect(serialized).toContain('[redacted]');
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

describe('verifyTypeSeedConvergenceWithRetry', () => {
  test('waits for payload publication before checking schema convergence', async () => {
    let bulkCalls = 0;

    const client = {
      getPublishedObjectTypes: async (options?: { name?: string }) => {
        if (!options?.name) {
          bulkCalls += 1;
        }
        const published = bulkCalls >= 2;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            docs: published
              ? [{ name: 'Customer', slug: 'customer', status: 'published' }]
              : [],
          }),
        };
      },
      getSchema: async () => {
        throw new Error('schema fallback should not run after published convergence');
      },
    } as unknown as PlatformAPIClient;

    const verification = await verifyTypeSeedConvergenceWithRetry(
      client,
      'tenant-1',
      ['Customer'],
      {
        createdCount: 1,
        updatedCount: 0,
        failedCount: 0,
      },
      {
        attempts: 3,
        delayMs: 0,
      },
    );

    expect(verification.converged).toBe(true);
    expect(verification.matchedTypes).toEqual(['Customer']);
    expect(bulkCalls).toBe(2);
  });

  test('uses precise published lookups when the bulk page misses requested types', async () => {
    const calls: Array<{ name?: string; limit?: number }> = [];
    const client = {
      getPublishedObjectTypes: async (options?: { name?: string; limit?: number }) => {
        calls.push(options ?? {});
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            docs: options?.name === 'Customer'
              ? [{ name: 'Customer', slug: 'customer', status: 'published' }]
              : [{ name: 'OtherType', slug: 'other-type', status: 'published' }],
          }),
        };
      },
      getSchema: async () => {
        throw new Error('schema fallback should not run after precise published convergence');
      },
    } as unknown as PlatformAPIClient;

    const verification = await verifyTypeSeedConvergenceWithRetry(
      client,
      'tenant-1',
      ['Customer'],
      {
        createdCount: 1,
        updatedCount: 0,
        failedCount: 0,
      },
      {
        attempts: 1,
        delayMs: 0,
      },
    );

    expect(verification.converged).toBe(true);
    expect(verification.matchedTypes).toEqual(['Customer']);
    expect(calls).toEqual([
      { limit: 20 },
      { name: 'Customer', limit: 10 },
    ]);
  });

  test('retries until published types converge', async () => {
    const payloads = [
      {
        docs: [
          { name: 'Customer', slug: 'customer', status: 'draft' },
        ],
      },
      {
        docs: [
          { name: 'Customer', slug: 'customer', status: 'published' },
        ],
      },
    ];

    const client = {
      getSchema: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => payloads.shift(),
      }),
    } as unknown as PlatformAPIClient;

    const verification = await verifyTypeSeedConvergenceWithRetry(
      client,
      'tenant-1',
      ['Customer'],
      {
        createdCount: 1,
        updatedCount: 0,
        failedCount: 0,
      },
      {
        attempts: 2,
        delayMs: 0,
      },
    );

    expect(verification.converged).toBe(true);
    expect(verification.matchedTypes).toEqual(['Customer']);
  });

  test('returns the last partial verification when convergence never happens', async () => {
    const client = {
      getSchema: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          docs: [{ name: 'Customer', slug: 'customer', status: 'draft' }],
        }),
      }),
    } as unknown as PlatformAPIClient;

    const verification = await verifyTypeSeedConvergenceWithRetry(
      client,
      'tenant-1',
      ['Customer'],
      {
        createdCount: 1,
        updatedCount: 0,
        failedCount: 0,
      },
      {
        attempts: 2,
        delayMs: 0,
      },
    );

    expect(verification.converged).toBe(false);
    expect(verification.driftedTypes).toEqual(['Customer']);
  });
});

describe('waitForResourceApiSchemaVisibility', () => {
  test('waits for queued app-manifest ResourceAPI sync to become schema-visible', async () => {
    let schemaCalls = 0;
    const client = {
      getResourceStorageSchemaStatus: async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      }),
      getSchema: async () => {
        schemaCalls += 1;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            objectTypes: schemaCalls >= 2
              ? [{ name: 'Customer', slug: 'customer' }]
              : [],
          }),
        };
      },
    } as unknown as PlatformAPIClient;

    await expect(waitForResourceApiSchemaVisibility(
      client,
      'tenant-1',
      ['Customer'],
      { status: 'queued', objectTypes: ['customer'] },
      { attempts: 3, delayMs: 0 },
    )).resolves.toMatchObject({
      status: 'synced',
      schemaVisibility: 'visible',
    });
    expect(schemaCalls).toBe(2);
  });

  test('accepts passive storage schema-status objectTypeSlugs as schema-visible', async () => {
    const client = {
      getResourceStorageSchemaStatus: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          objectTypeSlugs: ['customer', 'order-line'],
        }),
      }),
      getSchema: async () => {
        throw new Error('generic schema should not be polled after schema-status converges');
      },
    } as unknown as PlatformAPIClient;

    await expect(waitForResourceApiSchemaVisibility(
      client,
      'tenant-1',
      ['Customer', 'OrderLine'],
      { status: 'queued', objectTypes: ['customer', 'order-line'] },
      { attempts: 3, delayMs: 0 },
    )).resolves.toMatchObject({
      status: 'synced',
      schemaVisibility: 'visible',
      schemaVisibilitySource: 'storage.schema-status',
    });
  });

  test('marks queued app-manifest sync as failed when ResourceAPI schema stays stale', async () => {
    const client = {
      getResourceStorageSchemaStatus: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ objectTypeSlugs: [] }),
      }),
      getSchema: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ objectTypes: [] }),
      }),
    } as unknown as PlatformAPIClient;

    await expect(waitForResourceApiSchemaVisibility(
      client,
      'tenant-1',
      ['Customer'],
      { status: 'queued', objectTypes: ['customer'] },
      { attempts: 2, delayMs: 0 },
    )).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'RESOURCEAPI_SCHEMA_VISIBILITY_TIMEOUT',
      guidance: {
        platformActionRequired: true,
        title: expect.stringContaining('visibility timed out'),
      },
      details: {
        missingTypes: ['Customer'],
      },
    });
  });

  test('does not poll ResourceAPI schema for terminal sync metadata', async () => {
    const client = {
      getResourceStorageSchemaStatus: async () => {
        throw new Error('schema status should not be polled for terminal metadata');
      },
      getSchema: async () => {
        throw new Error('schema should not be polled for terminal metadata');
      },
    } as unknown as PlatformAPIClient;

    await expect(waitForResourceApiSchemaVisibility(
      client,
      'tenant-1',
      ['Customer'],
      { status: 'synced' },
      { attempts: 1, delayMs: 0 },
    )).resolves.toEqual({ status: 'synced' });
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

  test('returns true when ResourceAPI schema sync failed after convergence', () => {
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
        resourceApiSchemaSync: {
          status: 'failed',
        },
      },
    ])).toBe(true);
  });

  test('returns false when ResourceAPI schema sync is queued after convergence', () => {
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
        resourceApiSchemaSync: {
          status: 'queued',
        },
      },
    ])).toBe(false);
  });

  test('returns false when ResourceAPI schema sync is pending after convergence', () => {
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
        resourceApiSchemaSync: {
          status: 'pending',
        },
      },
    ])).toBe(false);
  });

  test('returns true when ResourceAPI schema sync is skipped after convergence', () => {
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
        resourceApiSchemaSync: {
          status: 'skipped',
        },
      },
    ])).toBe(true);
  });

  test('returns true when ResourceAPI schema sync is blocked after convergence', () => {
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
        resourceApiSchemaSync: {
          status: 'blocked',
        },
      },
    ])).toBe(true);
  });
});

describe('loadObjectTypes', () => {
  test('resolves relationship model names through the declared stored slug without deriving at runtime', () => {
    const definitions: Record<string, ObjectTypeDefinition[]> = {
      template: [
        {
          name: 'OPAMeasure',
          slug: 'opameasure',
          displayName: 'OPA measure',
          properties: [],
          linkTypes: [],
          actions: [],
          status: 'published',
        },
        {
          name: 'BusinessCase',
          slug: 'business-case',
          displayName: 'Business case',
          properties: [],
          linkTypes: [
            {
              name: 'opaMeasures',
              targetObjectType: 'OPAMeasure',
              cardinality: 'one-to-many',
            },
          ],
          actions: [],
          status: 'published',
        },
      ],
    };

    expect(() => validateObjectTypeDefinitions(definitions)).not.toThrow();
    const canonical = canonicalizeObjectTypeRelationshipTargets(definitions);

    expect(canonical.template?.[1]?.linkTypes[0]?.targetObjectType).toBe('opameasure');
    expect(definitions.template?.[1]?.linkTypes[0]?.targetObjectType).toBe('OPAMeasure');
  });

  test('rejects an unresolved relationship model name instead of guessing a route slug', () => {
    expect(() => validateObjectTypeDefinitions({
      template: [{
        name: 'BusinessCase',
        slug: 'business-case',
        displayName: 'Business case',
        properties: [],
        linkTypes: [{
          name: 'opaMeasures',
          targetObjectType: 'OPAMeasure',
          cardinality: 'one-to-many',
        }],
        actions: [],
        status: 'published',
      }],
    })).toThrow(/OBJECT_TYPE_LINK_TARGET_UNRESOLVED/);
  });

  test('rejects a new source definition with a missing or unsupported mismatched slug before provisioning', () => {
    expect(() => validateObjectTypeDefinitions({
      template: [{
        name: 'GitHubConnection',
        displayName: 'GitHub connection',
        properties: [],
        linkTypes: [],
        actions: [],
        status: 'draft',
      }],
    })).toThrow(/OBJECT_TYPE_SLUG_MISSING/);

    expect(() => validateObjectTypeDefinitions({
      template: [{
        name: 'BusinessCase',
        slug: 'businesscase',
        displayName: 'Business case',
        properties: [],
        linkTypes: [],
        actions: [],
        status: 'draft',
      }],
    })).toThrow(/OBJECT_TYPE_SLUG_DERIVATION_MISMATCH/);
  });

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

  test('loads generated storage binding contract values while evaluating object types', async () => {
    const env = await createTestEnvironment();
    const objectTypesDir = join(env.dir, 'src', 'eai.config');
    const contractDir = join(env.dir, '.eai');

    try {
      await mkdir(objectTypesDir, { recursive: true });
      await mkdir(contractDir, { recursive: true });
      await writeFile(
        join(contractDir, 'storage-bindings.json'),
        JSON.stringify({
          schemaVersion: 1,
          tenantId: '5dd8db37-0993-f01c-0487-e8f0fae6c3d7',
          appKey: 'post-pilot',
          storageNamePrefixes: {
            sql: 'e8f0fae6c3d7_post_pilot_',
          },
        }),
        'utf-8',
      );
      await writeFile(
        join(objectTypesDir, 'object-types.ts'),
        `function appSqlStorage(logicalTableName) {
          return {
            storageBackend: 'postgresql',
            storageMetadataStatus: 'ready',
            storageBinding: {
              sql: {
                databaseAlias: 'tenant-postgres',
                tenantSchemaStrategy: 'per-tenant-schema',
                tableName: process.env.EAI_STORAGE_TABLE_PREFIX + logicalTableName,
              },
            },
          };
        }
        export const objectTypes = {
          'post-pilot': [{
            name: 'FeedItem',
            displayName: 'Feed item',
            properties: [],
            linkTypes: [],
            actions: [],
            status: 'published',
            ...appSqlStorage('feed_items'),
          }],
        };\n`,
        'utf-8',
      );

      await expect(loadObjectTypes(env.dir)).resolves.toEqual({
        'post-pilot': [
          expect.objectContaining({
            name: 'FeedItem',
            storageBinding: {
              sql: expect.objectContaining({
                tableName: 'e8f0fae6c3d7_post_pilot_feed_items',
              }),
            },
          }),
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

describe('validateObjectTypeStorageMetadata', () => {
  test('rejects published types that are not storage-ready', () => {
    expect(validateObjectTypeStorageMetadata({
      ...buildObjectType([]),
      status: 'published',
    })).toEqual([
      expect.stringContaining('published Object Types require storageMetadataStatus "ready"'),
    ]);
  });

  test('accepts tenant-app PostgreSQL storage metadata shape', () => {
    expect(validateObjectTypeStorageMetadata({
      ...buildObjectType([]),
      status: 'published',
      schemaVersion: 1,
      storageBackend: 'postgresql',
      storageMetadataStatus: 'ready',
      storageBinding: {
        sql: {
          databaseAlias: 'tenant-postgres',
          tenantSchemaStrategy: 'per-tenant-schema',
          tableName: 'e8f0fae6c3d7_template_workflows',
        },
      },
    })).toEqual([]);
  });

  test('reports missing backend-specific binding fields', () => {
    expect(validateObjectTypeStorageMetadata({
      ...buildObjectType([]),
      status: 'published',
      storageBackend: 'documentdb',
      storageMetadataStatus: 'ready',
      storageBinding: {
        documentdb: {
          databaseAlias: 'resourceapi-cosmos',
          databaseName: 'resources',
          collectionName: 'tenantResources',
          partitionKey: '',
        },
      },
    })).toEqual([
      'DocumentDB storageBinding is incomplete. Missing: partitionKey',
    ]);
  });
});

describe('collectTypeStorageValidationIssues', () => {
  test('accepts published types with ready PostgreSQL storage metadata', () => {
    const issues = collectTypeStorageValidationIssues({
      template: [
        {
          ...buildObjectType([]),
          status: 'published',
          storageBackend: 'postgresql',
          storageMetadataStatus: 'ready',
          storageBinding: {
            sql: {
              databaseAlias: 'tenant-postgres',
              tenantSchemaStrategy: 'per-tenant-schema',
              tableName: 'e8f0fae6c3d7_template_workflows',
            },
          },
        },
      ],
    }, {
      tenantIdsByKey: {
        template: '5dd8db37-0993-f01c-0487-e8f0fae6c3d7',
      },
    });

    expect(issues).toEqual([]);
  });

  test('rejects legacy shared PostgreSQL aliases for app Object Types', () => {
    const issues = collectTypeStorageValidationIssues({
      template: [
        {
          ...buildObjectType([]),
          status: 'published',
          storageBackend: 'postgresql',
          storageMetadataStatus: 'ready',
          storageBinding: {
            sql: {
              databaseAlias: 'resourceapi-postgres',
              tenantSchemaStrategy: 'per-tenant-schema',
              tableName: 'workflows',
            },
          },
        },
      ],
    });

    expect(issues).toEqual([
      {
        tenantKey: 'template',
        typeName: 'Workflow',
        issue: expect.stringContaining('legacy shared platform alias'),
      },
    ]);
  });

  test('rejects tenant-app PostgreSQL table names without the app key fragment', () => {
    const issues = validateObjectTypeAppOwnedStorageMetadata({
      ...buildObjectType([]),
      status: 'published',
      storageBackend: 'postgresql',
      storageMetadataStatus: 'ready',
      storageBinding: {
        sql: {
          databaseAlias: 'tenant-postgres',
          tenantSchemaStrategy: 'per-tenant-schema',
          tableName: 'feed_items',
        },
      },
    }, 'post-pilot');

    expect(issues).toEqual([
      expect.stringContaining('does not include the app key fragment "post_pilot_"'),
    ]);
  });

  test('rejects tenant-app PostgreSQL table names without the exact tenant prefix', () => {
    const tenantId = '5dd8db37-0993-f01c-0487-e8f0fae6c3d7';
    expect(appOwnedSqlTablePrefix(tenantId, 'post-pilot')).toBe(
      'e8f0fae6c3d7_post_pilot_',
    );

    const issues = validateObjectTypeAppOwnedStorageMetadata({
      ...buildObjectType([]),
      status: 'published',
      storageBackend: 'postgresql',
      storageMetadataStatus: 'ready',
      storageBinding: {
        sql: {
          databaseAlias: 'tenant-postgres',
          tenantSchemaStrategy: 'per-tenant-schema',
          tableName: 'post_pilot_feed_items',
        },
      },
    }, 'post-pilot', tenantId);

    expect(issues).toEqual([
      expect.stringContaining(
        'must start with app-owned prefix "e8f0fae6c3d7_post_pilot_"',
      ),
    ]);
  });

  test('rejects published types without ready storage metadata', () => {
    const issues = collectTypeStorageValidationIssues({
      template: [
        {
          ...buildObjectType([]),
          status: 'published',
        },
      ],
    });

    expect(issues).toEqual([
      {
        tenantKey: 'template',
        typeName: 'Workflow',
        issue: expect.stringContaining('published Object Types require storageMetadataStatus "ready"'),
      },
    ]);
  });

  test('rejects ready PostgreSQL metadata with incomplete binding', () => {
    const issues = collectTypeStorageValidationIssues({
      template: [
        {
          ...buildObjectType([]),
          storageBackend: 'postgresql',
          storageMetadataStatus: 'ready',
          storageBinding: {
            sql: {
              databaseAlias: 'tenant-postgres',
              tenantSchemaStrategy: 'per-tenant-schema',
              tableName: '',
            },
          },
        },
      ],
    });

    expect(issues).toEqual([
      {
        tenantKey: 'template',
        typeName: 'Workflow',
        issue: expect.stringContaining('tableName'),
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

  test('does not throw when the server nests a structured object in message', async () => {
    // Regression: a non-string `message` previously crashed on `.trim()`
    // (the post-seed schema-sync summary observed this against ResourceAPI).
    const response = new Response(
      JSON.stringify({ message: { reason: 'conflict', fields: ['slug'] } }),
      { status: 409, statusText: 'Conflict', headers: { 'x-request-id': 'req-9' } },
    );

    const detail = await describeFailedPlatformResponse(response);
    expect(detail).toContain('409 Conflict');
    expect(detail).toContain('conflict');
    expect(detail).toContain('(request req-9)');
  });

  test('falls back to status when there is no body', async () => {
    const response = new Response('', { status: 404, statusText: 'Not Found' });
    await expect(describeFailedPlatformResponse(response)).resolves.toBe('404 Not Found');
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
