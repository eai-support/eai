import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { cleanupTestTokens, userIsLoggedIn, userIsNotLoggedIn, type TestContext } from '../helpers/setup-dsl.js';
import * as auth from '../../src/lib/auth.js';
import { getActiveProfile, setActiveProfile } from '../../src/lib/profile.js';

describe('test token home isolation', () => {
  let environment: TestEnvironment;
  let ambient: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalProfile: string;
  let context: TestContext;
  const tokens = (value: string): auth.StoredTokens => ({ accessToken: value, expiresAt: Date.now() + 60_000,
    tenantName: 'fixture-authority', tenantId: 'fixture-authority-id', clientId: 'fixture-client', authScope: 'openid profile' });

  beforeEach(async () => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalProfile = getActiveProfile();
    ambient = await mkdtemp(join(tmpdir(), 'eai-ambient-sentinel-'));
    environment = await createTestEnvironment();
    process.env.HOME = ambient;
    process.env.USERPROFILE = ambient;
    setActiveProfile('default');
    await auth.storeTokens(tokens('ambient-fixture-token'));
    context = { workingDir: environment.dir, env: {}, prompts: [], mockAPI: undefined as never };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    // All auth cleanup stays inside the disposable sentinel home as well.
    process.env.HOME = ambient; process.env.USERPROFILE = ambient;
    for (const profile of ['default', 'dev']) { setActiveProfile(profile); await auth.clearTokens(); }
    setActiveProfile(originalProfile);
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
    await environment.cleanup();
    await rm(ambient, { recursive: true, force: true });
  });

  test('arrange and cleanup preserve ambient token bytes, bind both fixture-home variables and clear stale fixture cache', async () => {
    const sentinel = await readFile(join(ambient, '.eai', 'tokens.json'));
    await userIsLoggedIn(context, { email: 'fixture@example.test' });
    expect(context.env).toMatchObject({ HOME: environment.dir, USERPROFILE: environment.dir });
    expect(process.env.HOME).toBe(ambient); expect(process.env.USERPROFILE).toBe(ambient);
    process.env.HOME = environment.dir; process.env.USERPROFILE = environment.dir;
    expect((await auth.loadTokens())?.upn).toBe('fixture@example.test');
    process.env.HOME = ambient; process.env.USERPROFILE = ambient;
    await cleanupTestTokens(context);
    await expect(readFile(join(environment.dir, '.eai', 'tokens.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(ambient, '.eai', 'tokens.json'))).toEqual(sentinel);
    expect((await auth.loadTokens())?.accessToken).toBe('ambient-fixture-token');
    expect(process.env.HOME).toBe(ambient); expect(process.env.USERPROFILE).toBe(ambient);
  });

  test('missing context after failed setup never falls back to ambient home', async () => {
    const sentinel = await readFile(join(ambient, '.eai', 'tokens.json'));
    const clear = vi.spyOn(auth, 'clearTokens');
    await cleanupTestTokens(undefined);
    expect(clear).not.toHaveBeenCalled();
    expect(await readFile(join(ambient, '.eai', 'tokens.json'))).toEqual(sentinel);
  });

  test('explicit ambient home cannot be used as a fixture home', async () => {
    context.env.HOME = ambient;
    const sentinel = await readFile(join(ambient, '.eai', 'tokens.json'));
    await expect(cleanupTestTokens(context)).rejects.toThrow('active disposable test environment');
    await expect(userIsLoggedIn(context)).rejects.toThrow('active disposable test environment');
    expect(await readFile(join(ambient, '.eai', 'tokens.json'))).toEqual(sentinel);
  });

  test('linked fixture token directories cannot redirect cleanup or writes into ambient home', async () => {
    await symlink(join(ambient, '.eai'), join(environment.dir, '.eai'), 'dir');
    const sentinel = await readFile(join(ambient, '.eai', 'tokens.json'));
    await expect(cleanupTestTokens(context)).rejects.toThrow('must not contain links');
    await expect(userIsLoggedIn(context)).rejects.toThrow('must not contain links');
    expect(await readFile(join(ambient, '.eai', 'tokens.json'))).toEqual(sentinel);
  });

  test('logged-out arrangement clears the fixture cache without clearing ambient authentication', async () => {
    await userIsLoggedIn(context);
    process.env.HOME = environment.dir; process.env.USERPROFILE = environment.dir;
    expect(await auth.loadTokens()).not.toBeNull();
    process.env.HOME = ambient; process.env.USERPROFILE = ambient;
    await userIsNotLoggedIn(context);
    expect(context.env).not.toHaveProperty('EAI_ACCESS_TOKEN');
    process.env.HOME = environment.dir; process.env.USERPROFILE = environment.dir;
    expect(await auth.loadTokens()).toBeNull();
    process.env.HOME = ambient; process.env.USERPROFILE = ambient;
    expect((await auth.loadTokens())?.accessToken).toBe('ambient-fixture-token');
  });

  test('named-profile cleanup preserves the selected profile and both ambient token files', async () => {
    setActiveProfile('dev');
    await auth.storeTokens(tokens('ambient-dev-fixture-token'));
    const namedSentinel = await readFile(join(ambient, '.eai', 'tokens', 'dev.json'));
    const defaultSentinel = await readFile(join(ambient, '.eai', 'tokens.json'));
    await cleanupTestTokens(context);
    expect(getActiveProfile()).toBe('dev');
    expect(process.env.HOME).toBe(ambient); expect(process.env.USERPROFILE).toBe(ambient);
    expect(await readFile(join(ambient, '.eai', 'tokens', 'dev.json'))).toEqual(namedSentinel);
    expect(await readFile(join(ambient, '.eai', 'tokens.json'))).toEqual(defaultSentinel);
    expect((await auth.loadTokens())?.accessToken).toBe('ambient-dev-fixture-token');
  });

  test('cleanup failure restores ambient home before propagating the error', async () => {
    setActiveProfile('dev');
    await mkdir(join(environment.dir, '.eai', 'tokens', 'dev.json'), { recursive: true });
    await expect(cleanupTestTokens(context)).rejects.toThrow();
    expect(process.env.HOME).toBe(ambient); expect(process.env.USERPROFILE).toBe(ambient);
    expect(getActiveProfile()).toBe('dev');
    expect((await readFile(join(ambient, '.eai', 'tokens.json'))).length).toBeGreaterThan(0);
  });
});
