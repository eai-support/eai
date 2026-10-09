import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { acknowledgedCreatedAppBinding, acknowledgedSelectedAppBinding, reserveInitBindingReceipt } from '../../src/lib/init-app-binding.js';

const nonce = '12345678-1234-4234-8234-123456789abc';
const authority = { publicApiUrl: 'http://localhost:18000', actorId: 'original-actor' };
const binding = { appKey: 'e2e-test-app', parentTenantId: 'parent', runtimeTenantId: 'runtime', enrollmentId: 'enrollment-1', createdApp: true, createdChildTenant: true };
const response = { tenantId: 'parent', appKey: binding.appKey, verticalKey: binding.appKey,
  app: { id: 'enrollment-1', tenantId: 'parent', parentTenantId: 'parent', verticalKey: binding.appKey, childTenantId: 'runtime' },
  childTenant: { id: 'runtime' }, created: { app: true, childTenant: true } };
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eai-init-binding-'));
  roots.push(root);
  const project = join(root, 'project');
  const evidence = join(root, 'private');
  await mkdir(project, { mode: 0o700 });
  await mkdir(evidence, { mode: 0o700 });
  await chmod(root, 0o700);
  await chmod(project, 0o700);
  await chmod(evidence, 0o700);
  return { root, project, evidence, path: join(evidence, 'binding.json') };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('private init acknowledgement', () => {
  test('normal init has no receipt filesystem work', async () => {
    expect(await reserveInitBindingReceipt(undefined, undefined, '/does-not-exist', 'create')).toBeUndefined();
  });
  test('reserves pending nonownership, acknowledges actual response, and keeps original private file on conflicts', async () => {
    const f = await fixture();
    const receipt = await reserveInitBindingReceipt(f.path, nonce, f.project, 'create');
    const pending = JSON.parse(await readFile(f.path, 'utf8'));
    expect(pending).toMatchObject({ status: 'pending', nonce, requestKind: 'create' });
    expect(pending).not.toHaveProperty('createdApp');
    receipt!.captureAuthority(authority);
    await receipt!.acknowledge(acknowledgedCreatedAppBinding(response, binding.appKey, 'parent', 'parent'));
    const original = await readFile(f.path, 'utf8');
    expect(JSON.parse(original)).toMatchObject({ ...authority, ...binding, status: 'acknowledged', nonce });
    expect((await lstat(f.path)).mode & 0o777).toBe(0o600);
    await expect(reserveInitBindingReceipt(f.path, nonce, f.project, 'create')).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(receipt!.acknowledge(binding)).rejects.toThrow(/reservation changed/);
    expect(await readFile(f.path, 'utf8')).toBe(original);
  });
  test('concurrent creation reported false never becomes creation authority from request mode', async () => {
    const f = await fixture();
    const receipt = await reserveInitBindingReceipt(f.path, nonce, f.project, 'create');
    receipt!.captureAuthority(authority);
    await receipt!.acknowledge(acknowledgedCreatedAppBinding({ ...response, created: { app: false, childTenant: false } }, binding.appKey, 'parent', 'parent'));
    expect(JSON.parse(await readFile(f.path, 'utf8'))).toMatchObject({ requestKind: 'create', createdApp: false, createdChildTenant: false });
  });
  test('existing selection cannot gain either app or child cleanup ownership', async () => {
    const f = await fixture();
    const receipt = await reserveInitBindingReceipt(f.path, nonce, f.project, 'select');
    receipt!.captureAuthority(authority);
    await expect(receipt!.acknowledge(binding)).rejects.toThrow(/actual creation/);
    expect(JSON.parse(await readFile(f.path, 'utf8')).status).toBe('pending');
    await receipt!.acknowledge({ ...binding, createdApp: false, createdChildTenant: false });
    expect(JSON.parse(await readFile(f.path, 'utf8'))).toMatchObject({ requestKind: 'select', createdApp: false });
  });
  test('selection retains exact immutable enrollment and distinct runtime with no creation flags', () => {
    expect(acknowledgedSelectedAppBinding({ docs: [{ id: 'enrollment-1', tenantId: 'parent', data: {
      tenantId: 'parent', parentTenantId: 'parent', childTenantId: 'runtime', verticalKey: binding.appKey,
    } }], page: 1, totalPages: 1, totalDocs: 1, hasNextPage: false, hasPrevPage: false, nextCursor: null }, binding.appKey, 'parent'))
      .toEqual({ ...binding, createdApp: false, createdChildTenant: false });
  });
  test.each([
    { totalDocs: 2 }, { hasNextPage: true }, { nextCursor: 'more' }, { page: 2 }, { totalPages: 2 },
    { docs: [{ id: 'one', tenantId: 'other', verticalKey: binding.appKey }] },
    { docs: [{ id: 'one', tenantId: 'parent', verticalKey: ` ${binding.appKey}` }] },
    { docs: [{ id: 'one', tenantId: 'parent', childTenantId: ' runtime ', verticalKey: binding.appKey }] },
    { docs: [{ id: 'one', tenantId: 'parent', verticalKey: binding.appKey }, { id: 'two', tenantId: 'parent', verticalKey: binding.appKey }] },
    { items: [{ id: 'other', tenantId: 'parent', verticalKey: binding.appKey }] },
  ])('selection rejects incomplete or conflicting enrollment output %j', changed => {
    expect(() => acknowledgedSelectedAppBinding({ docs: [{ id: 'enrollment-1', tenantId: 'parent', verticalKey: binding.appKey }], ...changed }, binding.appKey, 'parent')).toThrow();
  });
  test.each(['page', 'totalPages', 'totalDocs', 'hasNextPage', 'hasPrevPage'] as const)(
    'selection rejects a lookup without %s completeness metadata', field => {
      const response = { docs: [{ id: 'enrollment-1', tenantId: 'parent', verticalKey: binding.appKey }],
        page: 1, totalPages: 1, totalDocs: 1, hasNextPage: false, hasPrevPage: false };
      delete (response as Record<string, unknown>)[field];
      expect(() => acknowledgedSelectedAppBinding(response, binding.appKey, 'parent')).toThrow('incomplete');
    },
  );
  test('concurrent receipt reservations admit one invocation and preserve the winning pending bytes', async () => {
    const f = await fixture();
    const attempts = await Promise.allSettled([nonce, '87654321-4321-4321-8321-abcdefabcdef']
      .map(value => reserveInitBindingReceipt(f.path, value, f.project, 'create')));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    const winner = attempts.findIndex(result => result.status === 'fulfilled');
    expect(JSON.parse(await readFile(f.path, 'utf8'))).toMatchObject({ nonce: [nonce, '87654321-4321-4321-8321-abcdefabcdef'][winner], status: 'pending' });
  });
  test.each([
    ['company', { ...response, tenantId: 'other' }],
    ['app key', { ...response, appKey: 'other' }],
    ['alias', { ...response, verticalKey: 'other' }],
    ['enrollment', { ...response, app: { ...response.app, id: '' } }],
    ['parent', { ...response, app: { ...response.app, parentTenantId: 'other' } }],
    ['child', { ...response, childTenant: { id: 'other' } }],
    ['flag', { ...response, created: { app: 'true', childTenant: false } }],
  ])('rejects mismatched response %s without inventing identity', (_label, value) => {
    expect(() => acknowledgedCreatedAppBinding(value, binding.appKey, 'parent', 'parent')).toThrow();
  });
  test('strict flag pairing, project exclusion, and private permissions reject before reservation', async () => {
    const f = await fixture();
    for (const [path, suppliedNonce] of [[f.path, undefined], [undefined, nonce], ['relative.json', nonce], [f.path, nonce.toUpperCase()]] as const) {
      await expect(reserveInitBindingReceipt(path, suppliedNonce, f.project, 'create')).rejects.toThrow(/Pair/);
    }
    await expect(reserveInitBindingReceipt(join(f.project, 'binding.json'), nonce, f.project, 'create')).rejects.toThrow(/outside/);
    await chmod(f.evidence, 0o755);
    await expect(reserveInitBindingReceipt(f.path, nonce, f.project, 'create')).rejects.toThrow(/owner-only/);
  });
  test('leaf links and arbitrary linked parents never reserve or alter unrelated files', async () => {
    const f = await fixture();
    const victim = join(f.root, 'victim');
    await writeFile(victim, 'unchanged');
    await symlink(victim, f.path);
    await expect(reserveInitBindingReceipt(f.path, nonce, f.project, 'create')).rejects.toThrow();
    const linked = join(f.root, 'linked');
    await symlink(f.evidence, linked);
    await expect(reserveInitBindingReceipt(join(linked, 'other.json'), nonce, f.project, 'create')).rejects.toThrow(/linked/);
    expect(await readFile(victim, 'utf8')).toBe('unchanged');
  });
  test('receipt evidence under an enclosing Git working tree is rejected before publication', async () => {
    const f = await fixture();
    await writeFile(join(f.root, '.git'), 'gitdir: /elsewhere');
    await expect(reserveInitBindingReceipt(f.path, nonce, f.project, 'create')).rejects.toThrow(/outside Git/);
    await expect(lstat(f.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  test('original parent replacement and modified pending authority fail before acknowledgement publication', async () => {
    const f = await fixture();
    const receipt = await reserveInitBindingReceipt(f.path, nonce, f.project, 'create');
    receipt!.captureAuthority(authority);
    const original = await readFile(f.path, 'utf8');
    await rename(f.evidence, `${f.evidence}-old`);
    await mkdir(f.evidence, { mode: 0o700 });
    await writeFile(f.path, original, { mode: 0o600 });
    await expect(receipt!.acknowledge(binding)).rejects.toThrow(/directory changed/);
    expect(await readFile(f.path, 'utf8')).toBe(original);
    expect(await readFile(join(`${f.evidence}-old`, 'binding.json'), 'utf8')).toBe(original);
  });
  test('uncertain response or absent original actor stays pending, with no ownership fields', async () => {
    const f = await fixture();
    const receipt = await reserveInitBindingReceipt(f.path, nonce, f.project, 'create');
    await expect(receipt!.acknowledge(binding)).rejects.toThrow(/no captured/);
    const pending = JSON.parse(await readFile(f.path, 'utf8'));
    expect(pending.status).toBe('pending'); expect(pending).not.toHaveProperty('actorId');
    expect(pending).not.toHaveProperty('enrollmentId');
  });
});
