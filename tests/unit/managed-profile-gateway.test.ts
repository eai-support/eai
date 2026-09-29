import { mkdtemp, mkdir, chmod, writeFile, readFile, readdir, stat, rm, symlink, link } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, test, beforeEach, afterEach, expect, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ home: '', token: vi.fn(async () => 'fixture-bearer') }));
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => fixture.home }));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, openSync: vi.fn(actual.openSync), readSync: vi.fn(actual.readSync), renameSync: vi.fn(actual.renameSync), writeFileSync: vi.fn(actual.writeFileSync) };
});
vi.mock('../../src/lib/auth.js', async (original) => ({ ...await original<typeof import('../../src/lib/auth.js')>(), getAccessToken: fixture.token }));
import { openSync, readSync, renameSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { setActiveProfile, captureProfileConfig, loadProfileConfig, saveProfileConfig } from '../../src/lib/profile.js';
import { requireManagedPublicApiUrl } from '../../src/lib/managed-public-api.js';
import { PlatformAPIClient, probePublicApiReachability } from '../../src/lib/api.js';
import { resolveAuthConfig } from '../../src/lib/auth.js';

const gateway = 'https://private-api.example.test:8443';
const prod = 'https://api.au.myenterprise.ai/public';
const config = (url = gateway, authorized: string | null = url) => ({
  publicApiUrl: url, authTenantName: 'fixture-private', authTenantId: 'fixture-tenant', authClientId: 'fixture-client',
  ...(authorized === null ? {} : { managedDeploymentApiUrl: authorized }),
});
async function profiles(value: Record<string, unknown>): Promise<void> {
  await writeFile(join(fixture.home, '.eai/config.json'), JSON.stringify({ profiles: value }), { mode: 0o600 });
}

describe('explicit private managed gateway authority', () => {
  beforeEach(async () => {
    fixture.home = await mkdtemp(join(tmpdir(), 'eai-profile-policy-'));
    await mkdir(join(fixture.home, '.eai'), { mode: 0o700 });
    setActiveProfile('default');
    vi.mocked(openSync).mockClear(); vi.mocked(readSync).mockClear(); fixture.token.mockClear();
  });
  afterEach(async () => {
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); setActiveProfile('default');
    await rm(fixture.home, { recursive: true, force: true });
  });

  test('ordinary regional policy performs zero profile reads and rejects env-only authority', () => {
    vi.stubEnv('BASE_URL_PUBLIC_API', gateway);
    expect(requireManagedPublicApiUrl(prod)).toBe(prod);
    expect(() => requireManagedPublicApiUrl(gateway)).toThrow('trusted EAI regional');
    expect(openSync).not.toHaveBeenCalled(); expect(readSync).not.toHaveBeenCalled();
  });
  test('one bounded named snapshot pins cold and warm calls and is reused by auth', async () => {
    await profiles({ selected: config() }); setActiveProfile('selected');
    expect(() => requireManagedPublicApiUrl(prod)).toThrow('exactly match');
    expect(requireManagedPublicApiUrl(gateway + '/')).toBe(gateway);
    await profiles({ selected: { ...config(), authClientId: 'changed-after-capture' } });
    expect((await resolveAuthConfig()).clientId).toBe('fixture-client');
    expect(() => requireManagedPublicApiUrl(prod)).toThrow('exactly match');
    expect((await loadProfileConfig('selected'))?.authClientId).toBe('fixture-client');
    expect(openSync).toHaveBeenCalledTimes(1); expect(readSync).toHaveBeenCalledTimes(2);
    expect(fixture.token).not.toHaveBeenCalled();
  });
  test('switching and saving invalidate authority; legacy named profiles stay regional only', async () => {
    await profiles({ selected: config(), other: config('https://second.example.test'), legacy: config(prod, null) });
    setActiveProfile('selected'); expect(requireManagedPublicApiUrl(gateway)).toBe(gateway);
    setActiveProfile('other'); expect(() => requireManagedPublicApiUrl(gateway)).toThrow('exactly match');
    expect(requireManagedPublicApiUrl('https://second.example.test')).toBe('https://second.example.test');
    await saveProfileConfig('other', config(gateway)); expect(requireManagedPublicApiUrl(gateway)).toBe(gateway);
    setActiveProfile('legacy'); expect(requireManagedPublicApiUrl(prod)).toBe(prod);
    expect(() => requireManagedPublicApiUrl(gateway)).toThrow('trusted EAI regional');
    setActiveProfile('default'); expect(() => requireManagedPublicApiUrl(gateway)).toThrow('trusted EAI regional');
  });
  test.each(['http://private-api.example.test', 'https://user:secret@private-api.example.test',
    'https://private-api.example.test/?q=1', 'https://private-api.example.test/#fragment',
    'https://private-api.example.test/a/../public', 'https://private-api.example.test/%2e%2e/public',
    'https://private-api.example.test\\public', 'https://private-api.example.test/other',
    'https://private-api.example.test:443', 'https://PRIVATE-API.example.test'])('unsafe configured URL is denied before credentials/provider: %s', async (url) => {
    await profiles({ selected: config(url) }); setActiveProfile('selected');
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    expect(() => new PlatformAPIClient(url, 'fixture-runtime')).toThrow();
    expect(provider).not.toHaveBeenCalled(); expect(fixture.token).not.toHaveBeenCalled();
  });
  test('mismatching approval, missing approval and a wrong request cannot acquire credentials', async () => {
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    for (const selected of [config(gateway, 'https://other.example.test'), config(gateway, null)]) {
      await profiles({ selected }); setActiveProfile('selected');
      expect(() => requireManagedPublicApiUrl(gateway)).toThrow();
    }
    await profiles({ selected: config() }); setActiveProfile('selected');
    expect(() => new PlatformAPIClient('https://other.example.test', 'fixture-runtime')).toThrow();
    expect(provider).not.toHaveBeenCalled(); expect(fixture.token).not.toHaveBeenCalled();
  });
  test.each(['authorized', 'legacy', 'default'])('old %s client cannot cross a profile switch or save before auth/provider', async (kind) => {
    await profiles({ selected: config(), legacy: config(prod, null) });
    setActiveProfile(kind === 'authorized' ? 'selected' : kind === 'legacy' ? 'legacy' : 'default');
    const client = new PlatformAPIClient(kind === 'authorized' ? gateway : prod, 'fixture-runtime');
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    setActiveProfile('selected');
    await expect(client.listResources('fixture-type')).rejects.toThrow('authority changed');
    expect(fixture.token).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled();
    const current = new PlatformAPIClient(gateway, 'fixture-runtime');
    await saveProfileConfig('selected', config());
    await expect(current.getResource('fixture-type', 'fixture-id')).rejects.toThrow('authority changed');
    expect(fixture.token).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled();
  });
  test('authorized public and resource requests reject redirects with one token call per request', async () => {
    await profiles({ selected: config() }); setActiveProfile('selected');
    const provider = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', provider);
    const client = new PlatformAPIClient(gateway, 'fixture-runtime', { publicRequestRedirect: 'follow' });
    await client.listResources('fixture-type', { page: 2 });
    expect(provider).toHaveBeenLastCalledWith(expect.stringContaining(gateway + '/v4/'), expect.objectContaining({ redirect: 'error' }));
    expect(fixture.token).toHaveBeenCalledTimes(1); expect(openSync).toHaveBeenCalledTimes(1);
    await client.getResource('fixture-type', 'fixture-id');
    expect(provider).toHaveBeenLastCalledWith(expect.stringContaining(gateway + '/v4/'), expect.objectContaining({ redirect: 'error' }));
    expect(fixture.token).toHaveBeenCalledTimes(2); expect(openSync).toHaveBeenCalledTimes(1);
  });
  test.each([null, [], 4, { profiles: [] }, { profiles: null }, { profiles: { selected: { publicApiUrl: 4 } } }])('malformed profile JSON cannot become authority: %j', async (value) => {
    await writeFile(join(fixture.home, '.eai/config.json'), JSON.stringify(value), { mode: 0o600 });
    setActiveProfile('selected');
    expect(() => captureProfileConfig('selected')).toThrow();
    expect(fixture.token).not.toHaveBeenCalled();
  });
  test('profile switch while headers await a token blocks the next provider call', async () => {
    await profiles({ selected: config() }); setActiveProfile('selected');
    let release!: (value: string) => void;
    fixture.token.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }));
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    const request = new PlatformAPIClient(gateway, 'fixture-runtime').listResources('fixture-type');
    await Promise.resolve();
    setActiveProfile('default'); release('fixture-bearer');
    await expect(request).rejects.toThrow('authority changed');
    expect(fixture.token).toHaveBeenCalledTimes(1); expect(provider).not.toHaveBeenCalled();
  });
  test('default resource query and redirect policy remain unchanged without profile IO', async () => {
    const provider = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', provider);
    await new PlatformAPIClient(prod, 'fixture-runtime', { publicRequestRedirect: 'manual' }).listResources('fixture-type', { page: 2 });
    expect(provider).toHaveBeenCalledWith(expect.stringContaining('page=2'), expect.objectContaining({ redirect: 'manual' }));
    expect(fixture.token).toHaveBeenCalledTimes(1); expect(openSync).not.toHaveBeenCalled(); expect(readSync).not.toHaveBeenCalled();
  });
  test('named reachability uses the same snapshot, rejects redirect and wrong origin without token IO', async () => {
    await profiles({ selected: config() }); setActiveProfile('selected');
    const provider = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', provider);
    await probePublicApiReachability(gateway, 1000);
    expect(provider).toHaveBeenCalledWith(gateway + '/v4/data/resources/health', expect.objectContaining({ redirect: 'error' }));
    expect(() => probePublicApiReachability(prod, 1000)).toThrow('exactly match');
    expect(provider).toHaveBeenCalledTimes(1); expect(openSync).toHaveBeenCalledTimes(1); expect(fixture.token).not.toHaveBeenCalled();
  });
  test.each(['symlink', 'hardlink', 'writable', 'oversized'])('unsafe profile file is rejected: %s', async (kind) => {
    await profiles({ selected: config() });
    const path = join(fixture.home, '.eai/config.json');
    if (kind === 'symlink') { await rm(path); await writeFile(join(fixture.home, 'other'), '{}'); await symlink(join(fixture.home, 'other'), path); }
    if (kind === 'hardlink') await link(path, join(fixture.home, 'alias'));
    if (kind === 'writable') await chmod(path, 0o666);
    if (kind === 'oversized') await writeFile(path, 'x'.repeat(64 * 1024 + 1));
    setActiveProfile('selected'); expect(() => captureProfileConfig('selected')).toThrow('safe owner-controlled');
    expect(fixture.token).not.toHaveBeenCalled();
  });

  test('atomic profile update preserves unrelated settings, profiles and token bytes', async () => {
    const path = join(fixture.home, '.eai/config.json');
    const old = { unrelated: { preserve: true }, profiles: { opaque: { futureField: ['preserved'] }, selected: { ...config(), futureField: 'preserved' } } };
    await writeFile(path, JSON.stringify(old), { mode: 0o600 });
    const tokenPath = join(fixture.home, '.eai/tokens.json');
    await writeFile(tokenPath, 'opaque fixture token bytes', { mode: 0o600 });
    await saveProfileConfig('selected', config('https://updated.example.test'));
    const current = JSON.parse(await readFile(path, 'utf8'));
    expect(current.unrelated).toEqual(old.unrelated);
    expect(current.profiles.opaque).toEqual(old.profiles.opaque);
    expect(current.profiles.selected).toEqual({ ...config('https://updated.example.test'), futureField: 'preserved' });
    expect(await readFile(tokenPath, 'utf8')).toBe('opaque fixture token bytes');
    expect((await stat(path)).mode & 0o077).toBe(0);
    expect(await readdir(join(fixture.home, '.eai'))).toEqual(expect.arrayContaining(['config.json', 'tokens.json']));
    expect((await readdir(join(fixture.home, '.eai'))).some((name) => name.endsWith('.lock') || name.endsWith('.tmp'))).toBe(false);
  });
  test('new config initialization is owner-only and does not overwrite another profile', async () => {
    await saveProfileConfig('first', config());
    await saveProfileConfig('second', config('https://second.example.test'));
    const current = JSON.parse(await readFile(join(fixture.home, '.eai/config.json'), 'utf8'));
    expect(current.profiles).toEqual({ first: config(), second: config('https://second.example.test') });
  });
  test('preserving unknown fields cannot retain an omitted managed authorization', async () => {
    await profiles({ selected: { ...config(), futureField: 'preserved' } });
    await saveProfileConfig('selected', config(prod, null));
    const current = JSON.parse(await readFile(join(fixture.home, '.eai/config.json'), 'utf8'));
    expect(current.profiles.selected).toEqual({ ...config(prod, null), futureField: 'preserved' });
    expect(Object.hasOwn(current.profiles.selected, 'managedDeploymentApiUrl')).toBe(false);
  });
  test.each(['{', 'null', '[]', '{"profiles":[]}', '{"profiles":null}', '{"profiles":{"selected":[]}}'])('invalid existing config is never reset by save: %s', async (raw) => {
    const path = join(fixture.home, '.eai/config.json');
    await writeFile(path, raw, { mode: 0o600 });
    await expect(saveProfileConfig('selected', config())).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(raw);
    expect(await readdir(join(fixture.home, '.eai'))).toEqual(['config.json']);
  });
  test.each(['symlink', 'hardlink', 'writable', 'oversized'])('unsafe existing file is never overwritten by save: %s', async (kind) => {
    await profiles({ selected: config() });
    const path = join(fixture.home, '.eai/config.json');
    if (kind === 'symlink') { await rm(path); await writeFile(join(fixture.home, 'other'), '{}'); await symlink(join(fixture.home, 'other'), path); }
    if (kind === 'hardlink') await link(path, join(fixture.home, 'alias'));
    if (kind === 'writable') await chmod(path, 0o666);
    if (kind === 'oversized') await writeFile(path, 'x'.repeat(64 * 1024 + 1));
    const original = await readFile(path);
    await expect(saveProfileConfig('selected', config())).rejects.toThrow('owner-only');
    expect(await readFile(path)).toEqual(original);
    expect((await readdir(join(fixture.home, '.eai'))).some((name) => name.endsWith('.lock') || name.endsWith('.tmp'))).toBe(false);
  });
  test.each(['held', 'stale', 'symlink', 'hardlink'])('contention leaves the %s lock and config untouched without takeover', async (kind) => {
    await profiles({ selected: config() });
    const path = join(fixture.home, '.eai/config.json');
    const lockPath = path + '.lock';
    const lock = JSON.stringify({ schema: 'eai.profile-config-writer-lock.v1', nonce: 'foreign-fixture', pid: kind === 'stale' ? -1 : process.pid });
    await writeFile(lockPath, lock, { mode: 0o600 });
    if (kind === 'symlink') { await rm(lockPath); await symlink(path, lockPath); }
    if (kind === 'hardlink') await link(lockPath, join(fixture.home, 'lock-alias'));
    const original = await readFile(path); const lockOriginal = await readFile(lockPath);
    await expect(saveProfileConfig('selected', config('https://updated.example.test'))).rejects.toThrow('locked or unsafe');
    expect(await readFile(path)).toEqual(original); expect(await readFile(lockPath)).toEqual(lockOriginal);
  });
  test('serialization bound fails before replacing a valid existing config', async () => {
    await profiles({ selected: config() });
    const path = join(fixture.home, '.eai/config.json'); const original = await readFile(path);
    await expect(saveProfileConfig('selected', { ...config(), authScope: 'x'.repeat(64 * 1024) })).rejects.toThrow('64 KiB');
    expect(await readFile(path)).toEqual(original);
    expect(await readdir(join(fixture.home, '.eai'))).toEqual(['config.json']);
  });
  test('a non-cooperating edit before the final check is rejected and preserved', async () => {
    await profiles({ selected: config() });
    const path = join(fixture.home, '.eai/config.json');
    const foreign = JSON.stringify({ profiles: { external: { preserve: true } } });
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const write = vi.mocked(writeFileSync);
    write.mockImplementationOnce((...args) => {
      actual.writeFileSync(...args);
      write.mockImplementationOnce((...temporaryArgs) => {
        actual.writeFileSync(...temporaryArgs); actual.writeFileSync(path, foreign);
      });
    });
    await expect(saveProfileConfig('selected', config())).rejects.toThrow('changed during update');
    expect(await readFile(path, 'utf8')).toBe(foreign);
    expect(await readdir(join(fixture.home, '.eai'))).toEqual(['config.json']);
  });
  test.each(['inode', 'nonce'])('release refuses a replaced %s lock instead of deleting it', async (kind) => {
    await profiles({ selected: config() });
    const path = join(fixture.home, '.eai/config.json'); const lockPath = path + '.lock';
    const foreign = JSON.stringify({ schema: 'eai.profile-config-writer-lock.v1', nonce: 'replacement-fixture', pid: process.pid });
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(renameSync).mockImplementationOnce((...args) => {
      const owned = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(owned.schema).toBe('eai.profile-config-writer-lock.v1'); expect(owned.nonce).toEqual(expect.any(String));
      actual.renameSync(...args);
      if (kind === 'inode') unlinkSync(lockPath);
      actual.writeFileSync(lockPath, foreign, { mode: 0o600 });
    });
    await expect(saveProfileConfig('selected', config())).rejects.toThrow('lock ownership changed');
    expect(await readFile(lockPath, 'utf8')).toBe(foreign);
  });
});
