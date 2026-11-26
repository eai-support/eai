import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PlatformAPIClient } from '../../src/lib/api.js';
import * as context from '../../src/lib/context.js';
import { checkTypeSeedPreflight, resolveTypeSeedBinding, TypeSeedPreflightError } from '../../src/lib/type-seed-preflight.js';
import { diffObjectTypesForTenant, shouldFailTypeSeedRun, typesCommand } from '../../src/commands/types.js';
import { findGuidance } from '../../src/lib/error-guidance/match.js';
import { loadObjectTypes } from '../../src/lib/config.js';

const owner = '22222222-2222-4222-8222-222222222222';
const runtime = '11111111-1111-4111-8111-111111111111';
const binding = { appKey: 'my-app', ownerTenantId: owner, runtimeTenantId: runtime, appBound: true };
const roots: string[] = [];
const originalExitCode = process.exitCode;
afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const enrollment = (ready = true) => ({ tenantId: owner, targetTenantId: runtime, appKey: 'my-app', enrollment: {
  tenantId: owner, verticalKey: 'my-app', childTenantId: runtime,
  provisioningState: ready ? 'ready' : 'pending',
} });

function catalogPage(docs: Record<string, unknown>[] = []): Response {
  return Response.json({ docs, totalDocs: docs.length, totalPages: 1, page: 1, limit: 100, pagingCounter: 1,
    hasPrevPage: false, hasNextPage: false, prevPage: null, nextPage: null });
}

async function fixture(tableName = 't111111111111_my_app_records', strategy = 'per-tenant-schema'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eai-seed-preflight-'));
  roots.push(root);
  await mkdir(join(root, 'src/eai.config'), { recursive: true });
  await writeFile(join(root, '.env.local'), `EAI_APP_KEY=my-app\nEAI_PARENT_TENANT_ID=${owner}\nEAI_TENANT_ID=${runtime}\n`);
  await writeFile(join(root, 'src/eai.config/object-types.ts'), `export const objectTypes = { 'my-app': [{ name: 'Record', slug: 'record', displayName: 'Record', properties: [], linkTypes: [], actions: [], status: 'published', storageBackend: 'postgresql', storageMetadataStatus: 'ready', storageBinding: { sql: { databaseAlias: 'tenant-postgres', tenantSchemaStrategy: '${strategy}', tableName: '${tableName}' } } }] };`);
  vi.spyOn(context, 'resolveCommandContext').mockResolvedValue({ root, publicApiUrl: 'https://test-api.example.com', tenantId: runtime,
    activeTenant: { id: runtime, slug: 'my-app', name: 'My app' }, memberships: [], tokens: {} } as context.CommandContext);
  vi.spyOn(PlatformAPIClient.prototype, 'getPublishedObjectTypes').mockImplementation(async () => catalogPage());
  return root;
}

describe('Object Type publication prerequisites', () => {
  test('diff reports a select choice change even when the property name stays the same', async () => {
    const root = await fixture();
    const [template] = (await loadObjectTypes(root))['my-app'];
    const original = { label: 'Draft', value: 'draft' };
    const field = { name: 'stage', type: 'select' as const, required: false, options: [original] };
    const local = { ...template, properties: [{ ...field, options: [original, { label: 'Ready', value: 'ready' }] }] };
    const published = { ...template, properties: [{ ...field, options: [{ ...original, id: 'catalog-row' }] }] };
    expect(diffObjectTypesForTenant('my-app', runtime, 'option', [local], [published]).changed[0]?.changedProperties).toEqual(['stage']);
    expect(diffObjectTypesForTenant('my-app', runtime, 'option', [{ ...template, properties: [field] }], [published]).changed).toEqual([]);
  });

  test.each(['unchanged', 'unclaimed', 'diff', 'changed required', 'new type', 'changed description', 'new property', 'different target', 'ambiguous', 'duplicate request', 'missing scope'])('checks a legacy relationship against the published runtime: %s', async scenario => {
    const root = await fixture();
    const field = { name: 'clientId', type: 'relationship', description: 'Parent client', required: true, indexed: true };
    const [definition] = (await loadObjectTypes(root))['my-app'];
    const desiredField = ['diff', 'changed required'].includes(scenario) ? { ...field, required: false } : field;
    const desired = { ...definition, properties: [desiredField, { name: 'notes', type: 'text' }] };
    const requested = scenario === 'duplicate request' ? [desired, desired] : [desired];
    await writeFile(join(root, 'src/eai.config/object-types.ts'), 'export const objectTypes = ' + JSON.stringify({ 'my-app': requested }) + ';');
    const stored = { id: 'published-child', tenant: runtime, scope: scenario === 'missing scope' ? undefined : 'tenant',
      ...definition, properties: [{ ...field, id: 'catalog-field-id', options: [],
        ...(scenario === 'changed description' ? { description: 'Another client' } : {}),
        ...(scenario === 'new property' ? { name: 'previousId' } : {}),
        ...(scenario === 'different target' ? { targetObjectType: 'client' } : {}) }] };
    const docs = scenario === 'new type' ? [] : scenario === 'ambiguous' ? [stored, { ...stored, id: 'other-copy' }] : [stored];
    vi.spyOn(PlatformAPIClient.prototype, 'getBoundAppProvisioningJobs').mockResolvedValue(Response.json(enrollment()));
    vi.mocked(PlatformAPIClient.prototype.getPublishedObjectTypes).mockImplementation(async () => catalogPage(docs));
    const ownership = vi.spyOn(PlatformAPIClient.prototype, 'getAppDeletionPlan').mockResolvedValue(Response.json({
      tenantId: owner, targetTenantId: runtime, appKey: 'my-app', status: 'planned', deletionComplete: false,
      enrollmentOwner: { tenantId: owner, installId: 'owner-install' }, installIds: ['owner-install', 'child-install'],
      retainedSharedObjectTypes: [], ownershipManifestHash: '1'.repeat(64), tenantObjectTypeDocumentIds: [stored.id],
      resourcePartitions: [{ tenantId: runtime, installId: 'child-install', resourceScopes: scenario === 'unclaimed' ? []
        : [{ objectType: 'record', ownershipMode: 'exclusive' }] }],
    }));
    const save = vi.spyOn(PlatformAPIClient.prototype, 'saveAppObjectTypeManifest');
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('unexpected offline rejection'); });
    if (scenario === 'diff') {
      await typesCommand.parseAsync(['diff', '--tenant-key', 'my-app', '--tenant-id', runtime, '--format', 'json'], { from: 'user' });
      const report = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
      expect(report.tenants[0].error).toBeUndefined();
      expect(report.tenants[0].changed).toMatchObject([{ changedProperties: ['clientId'], addedProperties: ['notes'] }]);
      expect(process.exitCode ?? 0).toBe(0);
      expect(ownership).not.toHaveBeenCalled();
    } else {
      await typesCommand.parseAsync(['seed', '--dry-run', '--format', 'json'], { from: 'user' });
      const result = JSON.parse(String(output.mock.calls.at(-1)?.[0])).tenants[0];
      if (scenario === 'unchanged') {
        expect(result.preflight?.ready).toBe(true);
        expect(ownership).toHaveBeenCalledExactlyOnceWith(owner, 'my-app', runtime);
      } else if (scenario === 'unclaimed') expect(result.errorCode).toBe('EAI_PUBLISHED_BINDING_REVIEW_REQUIRED');
      else expect(result.error).toContain('clientId');
    }
    expect(save).not.toHaveBeenCalled();
  });

  test('resolves the company/runtime hint and corroborates it with one read', async () => {
    const root = await fixture();
    expect(await resolveTypeSeedBinding(root, 'template', runtime)).toEqual(binding);
    const get = vi.fn(async () => new Response(JSON.stringify(enrollment())));
    await checkTypeSeedPreflight({ getBoundAppProvisioningJobs: get } as unknown as PlatformAPIClient, binding);
    expect(get).toHaveBeenCalledExactlyOnceWith('my-app', runtime);
  });

  test.each([404, 409])('missing prerequisite HTTP %i has a catalogued code and exact recovery', async status => {
    const client = { getBoundAppProvisioningJobs: async () => new Response('{}', { status }) } as PlatformAPIClient;
    await expect(checkTypeSeedPreflight(client, binding)).rejects.toThrow(new RegExp(`eai app provision my-app --tenant-id ${runtime} --app-tenant-id ${owner}`));
    await expect(checkTypeSeedPreflight(client, binding)).rejects.toBeInstanceOf(TypeSeedPreflightError);
    expect(findGuidance({ serverCode: 'EAI_PROVISION_REQUIRED_FOR_TYPES' })?.code).toBe('E262');
  });

  test('rejects a mismatched runtime before any mutation', async () => {
    const response = enrollment();
    response.enrollment.childTenantId = owner;
    await expect(checkTypeSeedPreflight({ getBoundAppProvisioningJobs: async () => new Response(JSON.stringify(response)) } as PlatformAPIClient, binding)).rejects.toThrow(/exact owner, app, and runtime/);
  });

  test.each([undefined, owner])('requires targetTenantId to identify the exact requested runtime (%s)', async targetTenantId => {
    const payload = { ...enrollment(), targetTenantId };
    await expect(checkTypeSeedPreflight({ getBoundAppProvisioningJobs: async () => new Response(JSON.stringify(payload)) } as PlatformAPIClient, binding)).rejects.toThrow(/exact owner, app, and runtime/);
  });

  test('identifies a missing runtime in the regional response even when owner and runtime are the same', async () => {
    const sameWorkspace = { ...binding, ownerTenantId: runtime };
    const payload = { ...enrollment(), tenantId: runtime, targetTenantId: undefined,
      enrollment: { verticalKey: binding.appKey, tenantId: runtime, provisioningState: 'ready' } };
    const client = { getBoundAppProvisioningJobs: async () => Response.json(payload) } as PlatformAPIClient;
    await expect(checkTypeSeedPreflight(client, sameWorkspace)).rejects.toThrow('targetTenantId');
  });

  test.each([
    { provisioningState: 'failed', readiness: { ready: true, status: 'ready' } },
    { provisioningState: 'ready', readiness: { ready: false, status: 'ready' } },
    { provisioningState: 'ready', metadata: { appProvisioning: { status: 'running' } } },
  ])('rejects contradictory readiness before publication (%j)', async patch => {
    const payload = enrollment();
    Object.assign(payload.enrollment, patch);
    await expect(checkTypeSeedPreflight({ getBoundAppProvisioningJobs: async () => new Response(JSON.stringify(payload)) } as PlatformAPIClient, binding)).rejects.toBeInstanceOf(TypeSeedPreflightError);
  });

  test.each([true, false])('dry-run checks readiness before reading catalog; readiness=%s', async ready => {
    await fixture();
    const reads = vi.spyOn(PlatformAPIClient.prototype, 'getBoundAppProvisioningJobs').mockResolvedValue(new Response(JSON.stringify(enrollment(ready))));
    const save = vi.spyOn(PlatformAPIClient.prototype, 'saveAppObjectTypeManifest');
    const publish = vi.spyOn(PlatformAPIClient.prototype, 'publishAppObjectTypes');
    const sync = vi.spyOn(PlatformAPIClient.prototype, 'syncStorageSchema');
    const log = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await typesCommand.parseAsync(['seed', '--dry-run', '--format', 'json'], { from: 'user' });
    expect(reads, JSON.stringify(log.mock.calls)).toHaveBeenCalledOnce();
    expect(vi.mocked(PlatformAPIClient.prototype.getPublishedObjectTypes).mock.calls.length > 0).toBe(ready);
    expect(save).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    const payload = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(payload.tenants[0].dryRun).toBe(true);
    if (ready) expect(payload.tenants[0].preflight.ready).toBe(true);
    else {
      expect(payload.tenants[0].errorCode).toBe('EAI_PROVISION_REQUIRED_FOR_TYPES');
      expect(process.exitCode).toBe(1);
    }
  });

  test.each(["verified","wrong definition","wrong enrollment"])(
    'uses only an exact server preview for an inherited binding (%s)',
    async (scenario) => {
      const root = await fixture('template_my_app_records', 'per-tenant-database');
      const [type] = (await loadObjectTypes(root))['my-app'];
      const stored = { ...type, id: 'child-copy', scope: 'tenant', tenant: runtime, updatedAt: 'revision' };
      vi.mocked(PlatformAPIClient.prototype.getPublishedObjectTypes).mockImplementation(async () =>
        catalogPage([stored]),
      );
      vi.spyOn(PlatformAPIClient.prototype, 'getBoundAppProvisioningJobs').mockImplementation(async () =>
        Response.json({ ...enrollment(), enrollmentId: 'install' }),
      );
      const review = vi
        .spyOn(PlatformAPIClient.prototype, 'previewAppObjectTypeManifest')
        .mockImplementation(async () =>
          Response.json({
            mode: 'preview',
            tenantId: owner,
            targetTenantId: runtime,
            appKey: 'my-app',
            enrollmentId: scenario === 'wrong enrollment' ? 'other-install' : 'install',
            objectTypes: [
              {
                id: scenario === 'wrong definition' ? 'another-copy' : 'child-copy',
                slug: type.slug,
                version: 'revision',
                grantId: 'a-grant',
                changed: true,
              },
            ],
          }),
        );
      const save = vi.spyOn(PlatformAPIClient.prototype, 'saveAppObjectTypeManifest');
      const direct = vi.spyOn(PlatformAPIClient.prototype, 'updateObjectType');
      const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      await typesCommand.parseAsync(
        ['seed', '--tenant-key', 'my-app', '--tenant-id', runtime, '--dry-run', '--format', 'json'],
        { from: 'user' },
      );
      const result = JSON.parse(String(output.mock.calls.at(-1)?.[0])).tenants[0];
      expect(review).toHaveBeenCalledOnce();
      expect(result.preflight?.ready === true).toBe(scenario === 'verified');
      expect(save).not.toHaveBeenCalled();
      expect(direct).not.toHaveBeenCalled();
    },
  );

  test('a bound app refuses direct fallback after a manifest route failure', async () => {
    await fixture();
    vi.spyOn(PlatformAPIClient.prototype, 'getBoundAppProvisioningJobs').mockImplementation(async () => new Response(JSON.stringify(enrollment())));
    vi.spyOn(PlatformAPIClient.prototype, 'saveAppObjectTypeManifest').mockResolvedValue(new Response('{}', { status: 405 }));
    const direct = vi.spyOn(PlatformAPIClient.prototype, 'createObjectType');
    const log = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await typesCommand.parseAsync(['seed', '--format', 'json'], { from: 'user' });
    expect(direct).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])).tenants[0].verification.converged).toBe(false);
  });

  test.each([
    ['template_my_app_records', true, runtime],
    ['template_my_app_records', false, owner],
    ['t111111111111_my_app_records', true, owner],
  ] as const)('seed preserves existing storage: table=%s dryRun=%s owner=%s', async (table, dryRun, ownerId) => {
    await fixture(table, 'per-tenant-database');
    const readEnrollment = vi.spyOn(PlatformAPIClient.prototype, 'getBoundAppProvisioningJobs')
      .mockResolvedValue(Response.json({ ...enrollment(), tenantId: ownerId, enrollment: { ...enrollment().enrollment, tenantId: ownerId } }));
    const stored = { sql: { databaseAlias: 'tenant-postgres', tenantSchemaStrategy: 'per-tenant-database', tableName: 'template_my_app_records' } };
    const readCatalog = vi.mocked(PlatformAPIClient.prototype.getPublishedObjectTypes).mockImplementation(async () =>
      catalogPage([{ id: 'child-definition', name: 'Record', slug: 'record', scope: 'tenant', tenant: runtime,
        status: 'published', storageBackend: 'postgresql', storageMetadataStatus: 'ready', storageBinding: stored }]));
    const save = vi.spyOn(PlatformAPIClient.prototype, 'saveAppObjectTypeManifest');
    const publish = vi.spyOn(PlatformAPIClient.prototype, 'publishAppObjectTypes');
    const create = vi.spyOn(PlatformAPIClient.prototype, 'createObjectType');
    const update = vi.spyOn(PlatformAPIClient.prototype, 'updateObjectType');
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await typesCommand.parseAsync(['seed', '--tenant-key', 'my-app', '--tenant-id', runtime, '--app-tenant-id', ownerId, '--format', 'json', ...(dryRun ? ['--dry-run'] : [])], { from: 'user' });
    const result = JSON.parse(String(output.mock.calls.at(-1)?.[0])).tenants[0];
    expect(readEnrollment).toHaveBeenCalledExactlyOnceWith('my-app', runtime);
    expect(readCatalog).toHaveBeenCalled();
    expect(result.errorCode).toBe('EAI_PUBLISHED_BINDING_REVIEW_REQUIRED');
    expect(result.error).toContain('record');
    expect(result.error).toContain('ownership');
    expect(result.error).not.toContain('eai app provision');
    expect(save).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test.each([true, false])('a backend switch still checks a published definition with the same name: dryRun=%s', async dryRun => {
    const root = await fixture();
    const requested = { name: 'Record', slug: 'record', displayName: 'Record', properties: [], actions: [], linkTypes: [],
      status: 'published', storageBackend: 'blob', storageMetadataStatus: 'ready',
      storageBinding: { blob: { storageAccountAlias: 'tenant-blob', containerName: 'runtime-my-app-record' } } };
    await writeFile(join(root, 'src/eai.config/object-types.ts'), `export const objectTypes = ${JSON.stringify({ 'my-app': [requested] })};`);
    vi.spyOn(PlatformAPIClient.prototype, 'getBoundAppProvisioningJobs').mockResolvedValue(Response.json(enrollment()));
    vi.mocked(PlatformAPIClient.prototype.getPublishedObjectTypes).mockImplementation(async () => catalogPage([{
      id: 'published-copy', name: 'Record', slug: 'historical-record', scope: 'tenant', tenant: runtime, status: 'published',
      storageBackend: 'postgresql', storageMetadataStatus: 'ready',
      storageBinding: { sql: { databaseAlias: 'tenant-postgres', tenantSchemaStrategy: 'per-tenant-database', tableName: 'template_my_app_records' } },
    }]));
    const save = vi.spyOn(PlatformAPIClient.prototype, 'saveAppObjectTypeManifest').mockResolvedValue(new Response(null, {status: 405}));
    const direct = vi.spyOn(PlatformAPIClient.prototype, 'updateObjectType');
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await typesCommand.parseAsync(['seed', '--format', 'json', ...(dryRun ? ['--dry-run'] : [])], { from: 'user' });
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0])).tenants[0].errorCode).toBe('EAI_PUBLISHED_BINDING_REVIEW_REQUIRED');
    expect(save).not.toHaveBeenCalled();
    expect(direct).not.toHaveBeenCalled();
  });

  test('rechecks the catalog before a compatibility fallback can write', async () => {
    const root = await fixture();
    await writeFile(join(root, '.env.local'), `EAI_TENANT_ID=${runtime}\n`);
    vi.spyOn(PlatformAPIClient.prototype, 'getBoundAppProvisioningJobs').mockResolvedValue(Response.json({
      ...enrollment(), tenantId: runtime, enrollment: { ...enrollment().enrollment, tenantId: runtime },
    }));
    const stored = { id: 'published-copy', name: 'Record', slug: 'record', tenant: runtime, scope: 'tenant', status: 'published',
      storageBackend: 'postgresql', storageMetadataStatus: 'ready', storageBinding: {sql: { databaseAlias: 'tenant-postgres',
        tenantSchemaStrategy: 'per-tenant-database', tableName: 'template_my_app_records' }} };
    vi.mocked(PlatformAPIClient.prototype.getPublishedObjectTypes)
      .mockImplementationOnce(async () => catalogPage()).mockImplementationOnce(async () => catalogPage())
      .mockImplementation(async () => catalogPage([stored]));
    const save = vi.spyOn(PlatformAPIClient.prototype, 'saveAppObjectTypeManifest').mockResolvedValue(new Response(null, {status: 405}));
    const update = vi.spyOn(PlatformAPIClient.prototype, 'updateObjectType');
    const create = vi.spyOn(PlatformAPIClient.prototype, 'createObjectType');
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await typesCommand.parseAsync(['seed', '--format', 'json'], { from: 'user' });
    expect(save).toHaveBeenCalledOnce();
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0])).tenants[0].errorCode).toBe('EAI_PUBLISHED_BINDING_REVIEW_REQUIRED');
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test('preview cannot rename an existing dedicated table even when both names have the current prefix', async () => {
    const root = await fixture('t111111111111_my_app_replacement', 'per-tenant-database');
    const [current] = (await loadObjectTypes(root))['my-app'];
    const sql = { ...current.storageBinding!.sql!, tableName: 't111111111111_my_app_original' };
    vi.spyOn(PlatformAPIClient.prototype, 'getBoundAppProvisioningJobs').mockResolvedValue(Response.json(enrollment()));
    vi.mocked(PlatformAPIClient.prototype.getPublishedObjectTypes).mockImplementation(async () => catalogPage([{
      ...current, id: 'dedicated-copy', scope: 'tenant', tenant: runtime, storageBinding: { sql },
    }]));
    const save = vi.spyOn(PlatformAPIClient.prototype, 'saveAppObjectTypeManifest');
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await typesCommand.parseAsync(['seed', '--dry-run', '--format', 'json'], { from: 'user' });
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0])).tenants[0].errorCode).toBe('EAI_PUBLISHED_BINDING_REVIEW_REQUIRED');
    expect(save).not.toHaveBeenCalled();
  });

  test.each(['failed', 'synced'])('seed overall convergence reflects runtime sync %s', async status => {
    const root = await fixture();
    const expectedDefinitions = (await loadObjectTypes(root))['my-app'];
    vi.spyOn(PlatformAPIClient.prototype, 'getBoundAppProvisioningJobs').mockImplementation(async () => new Response(JSON.stringify(enrollment())));
    vi.spyOn(PlatformAPIClient.prototype, 'saveAppObjectTypeManifest').mockResolvedValue(new Response('{}'));
    vi.spyOn(PlatformAPIClient.prototype, 'publishAppObjectTypes').mockResolvedValue(new Response(JSON.stringify({
      tenantId: owner, results: [{ name: 'Record', status: 'created' }],
      verification: { tenantId: runtime, requestedTypes: ['Record'], matchedTypes: ['Record'], missingTypes: [], driftedTypes: [], failedCount: 0, converged: true },
      resourceApiSchemaSync: { status },
    })));
    vi.spyOn(PlatformAPIClient.prototype, 'getResourceStorageSchemaStatus').mockResolvedValue(new Response(JSON.stringify({ objectTypeSlugs: ['record'] })));
    vi.spyOn(PlatformAPIClient.prototype, 'getSchema').mockResolvedValue(new Response(JSON.stringify({ tenant_id: runtime, object_types: expectedDefinitions })));
    const direct = vi.spyOn(PlatformAPIClient.prototype, 'createObjectType');
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await typesCommand.parseAsync(['seed'], { from: 'user' });
    expect(direct).not.toHaveBeenCalled();
    const text = output.mock.calls.flat().join('\n');
    if (status === 'failed') {
      expect(text).not.toContain('Verification: converged');
      expect(process.exitCode).toBe(1);
    } else expect(text).toContain('Verification: converged');
  });

  test.each([
    ['new type', [], true],
    ['wrong workspace', [{ id: 'copy', name: 'Record', slug: 'record', tenant: owner }], false],
    ['incomplete type', [{ name: 'Record', slug: 'record' }], false],
  ] as const)('dedicated storage preview checks the runtime catalog: %s', async (_label, docs, allowed) => {
    await fixture('t111111111111_my_app_records', 'per-tenant-database');
    vi.spyOn(PlatformAPIClient.prototype, 'getBoundAppProvisioningJobs').mockResolvedValue(Response.json(enrollment()));
    vi.mocked(PlatformAPIClient.prototype.getPublishedObjectTypes).mockImplementation(async () => catalogPage([...docs]));
    const save = vi.spyOn(PlatformAPIClient.prototype, 'saveAppObjectTypeManifest');
    const publish = vi.spyOn(PlatformAPIClient.prototype, 'publishAppObjectTypes');
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await typesCommand.parseAsync(['seed', '--dry-run', '--format', 'json'], { from: 'user' });
    const result = JSON.parse(String(output.mock.calls.at(-1)?.[0])).tenants[0];
    if (allowed) expect(result.preflight?.ready).toBe(true);
    else {
      expect(result.error).toMatch(/catalog/i);
      expect(process.exitCode).toBe(1);
    }
    expect(save).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  test.each(['save', 'alternate save', 'publish'])('surfaces a binding conflict on %s without reprovisioning or direct writes', async phase => {
    await fixture('t111111111111_my_app_records', 'per-tenant-database');
    vi.spyOn(PlatformAPIClient.prototype, 'getBoundAppProvisioningJobs').mockImplementation(async () => Response.json(enrollment()));
    const conflict = () => Response.json({ detail: { error: 'EAI_PUBLISHED_BINDING_REVIEW_REQUIRED',
      details: { objectTypes: [{ slug: 'record', reason: 'binding_changed' }] } } }, { status: 409 });
    const save = vi.spyOn(PlatformAPIClient.prototype, 'saveAppObjectTypeManifest').mockResolvedValue(phase === 'publish' ? Response.json({}) : conflict());
    if (phase === 'alternate save') save.mockResolvedValueOnce(Response.json({ detail: 'unsupported slug' }, { status: 422 }));
    const publish = vi.spyOn(PlatformAPIClient.prototype, 'publishAppObjectTypes').mockResolvedValue(conflict());
    const direct = vi.spyOn(PlatformAPIClient.prototype, 'updateObjectType');
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await typesCommand.parseAsync(['seed', '--format', 'json'], { from: 'user' });
    const result = JSON.parse(String(output.mock.calls.at(-1)?.[0])).tenants[0];
    expect(result.errorCode).toBe('EAI_PUBLISHED_BINDING_REVIEW_REQUIRED');
    expect(result.error).toContain('record');
    expect(result.error).not.toContain('eai app provision');
    expect(save).toHaveBeenCalledTimes(phase === 'alternate save' ? 2 : 1);
    expect(publish).toHaveBeenCalledTimes(phase === 'publish' ? 1 : 0);
    expect(direct).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test('preserves the typed backend provisioning refusal if readiness changes after preflight', async () => {
    await fixture();
    vi.spyOn(PlatformAPIClient.prototype, 'getBoundAppProvisioningJobs').mockImplementation(async () => new Response(JSON.stringify(enrollment())));
    vi.spyOn(PlatformAPIClient.prototype, 'saveAppObjectTypeManifest').mockResolvedValue(new Response('{}'));
    vi.spyOn(PlatformAPIClient.prototype, 'publishAppObjectTypes').mockResolvedValue(new Response(JSON.stringify({ detail: {
      error: 'EAI_PROVISION_REQUIRED_FOR_TYPES', message: 'App resources must be provisioned before publishing object types.',
      details: { appKey: 'my-app', ownerTenantId: owner, runtimeTenantId: runtime },
    } }), { status: 409 }));
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await typesCommand.parseAsync(['seed', '--format', 'json'], { from: 'user' });
    const result = JSON.parse(String(output.mock.calls.at(-1)?.[0])).tenants[0];
    expect(result.errorCode).toBe('EAI_PROVISION_REQUIRED_FOR_TYPES');
    expect(result.error).toContain(`eai app provision my-app --tenant-id ${runtime} --app-tenant-id ${owner}`);
    expect(result.verification.converged).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  test('synchronized runtime evidence is required for success', () => {
    const verification = { tenantId: runtime, requestedTypes: ['Record'], matchedTypes: ['Record'], missingTypes: [], driftedTypes: [], createdCount: 1, updatedCount: 0, failedCount: 0, converged: true };
    expect(shouldFailTypeSeedRun([{ verification, resourceApiSchemaSync: { status: 'synced' } }])).toBe(false);
    expect(shouldFailTypeSeedRun([{ dryRun: true, error: 'not provisioned' }])).toBe(true);
  });

  test('diff exposes a changed relationship target even when property names match', () => {
    const local = { name: 'Role', slug: 'role', displayName: 'Role', status: 'published' as const,
      properties: [{ name: 'trust', type: 'relationship' as const, required: true, targetObjectType: 'trust' }], linkTypes: [], actions: [] };
    const result = diffObjectTypesForTenant('my-app', runtime, 'option', [local], [{ ...local, properties: [{ ...local.properties[0], targetObjectType: 'party' }] }]);
    expect(result.unchanged).toHaveLength(0);
    expect(result.changed[0].changedProperties).toEqual(['trust']);
    expect(result.changed[0].unchangedProperties).toEqual([]);
  });
});
