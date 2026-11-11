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
const enrollment = (ready = true) => ({ tenantId: owner, appKey: 'my-app', enrollment: {
  tenantId: owner, verticalKey: 'my-app', childTenantId: runtime,
  provisioningState: ready ? 'ready' : 'pending',
} });

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eai-seed-preflight-'));
  roots.push(root);
  await mkdir(join(root, 'src/eai.config'), { recursive: true });
  await writeFile(join(root, '.env.local'), `EAI_APP_KEY=my-app\nEAI_PARENT_TENANT_ID=${owner}\nEAI_TENANT_ID=${runtime}\n`);
  await writeFile(join(root, 'src/eai.config/object-types.ts'), `export const objectTypes = { 'my-app': [{ name: 'Record', slug: 'record', displayName: 'Record', properties: [], linkTypes: [], actions: [], status: 'published', storageBackend: 'postgresql', storageMetadataStatus: 'ready', storageBinding: { sql: { databaseAlias: 'tenant-postgres', tenantSchemaStrategy: 'per-tenant-schema', tableName: 't111111111111_my_app_records' } } }] };`);
  vi.spyOn(context, 'resolveCommandContext').mockResolvedValue({ root, publicApiUrl: 'https://test-api.example.com', tenantId: runtime,
    activeTenant: { id: runtime, slug: 'my-app', name: 'My app' }, memberships: [], tokens: {} } as context.CommandContext);
  return root;
}

describe('Object Type publication prerequisites', () => {
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

  test.each([true, false])('dry-run reads readiness only; readiness=%s', async ready => {
    await fixture();
    const reads = vi.spyOn(PlatformAPIClient.prototype, 'getBoundAppProvisioningJobs').mockResolvedValue(new Response(JSON.stringify(enrollment(ready))));
    const save = vi.spyOn(PlatformAPIClient.prototype, 'saveAppObjectTypeManifest');
    const publish = vi.spyOn(PlatformAPIClient.prototype, 'publishAppObjectTypes');
    const sync = vi.spyOn(PlatformAPIClient.prototype, 'syncStorageSchema');
    const log = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await typesCommand.parseAsync(['seed', '--dry-run', '--format', 'json'], { from: 'user' });
    expect(reads, JSON.stringify(log.mock.calls)).toHaveBeenCalledOnce();
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
