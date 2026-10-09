import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ home: '', root: '', cwd: '' }));
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => fixture.home }));

import {
  activateCommandProfile, getActiveProfile, getProfileTokensFile,
  resolveCommandProfile, setActiveProfile, type ProfileConfig,
} from '../../src/lib/profile.js';
import * as auth from '../../src/lib/auth.js';
import { resolvePublicApiUrl } from '../../src/lib/tenant-context.js';

const devApi = 'https://dev-api.au.myenterprise.ai/public';
const prodApi = 'https://api.au.myenterprise.ai/public';
const testApi = 'https://test-api.eu.myenterprise.ai/public';
const dev: ProfileConfig = { publicApiUrl: devApi, authTenantName: 'fixture-dev', authTenantId: 'dev-authority', authClientId: 'dev-client' };
const other: ProfileConfig = { ...dev, authTenantId: 'other-authority', authClientId: 'other-client' };

async function writeProfiles(value: Record<string, ProfileConfig> = { dev, other }): Promise<void> {
  const path = join(fixture.home, '.eai', 'config.json');
  await writeFile(path, JSON.stringify({ activeProfile: 'dev', profiles: value }), { mode: 0o600 });
  await chmod(path, 0o600);
}

async function project(name: string, env = '', api?: string): Promise<string> {
  const root = join(fixture.root, name);
  await mkdir(root, { mode: 0o700 });
  await chmod(root, 0o700);
  await writeFile(join(root, 'eai.runtime.json'), '{"schemaVersion":1}');
  if (env || api) {
    const path = join(root, '.env.local');
    await writeFile(path, `${env}${api ? `\nBASE_URL_PUBLIC_API=${api}\nROUTING_BOOTSTRAP_PUBLIC_API_URL=${api}\n` : ''}`, { mode: 0o600 });
    await chmod(path, 0o600);
  }
  return root;
}

function program(action: () => void | Promise<void> = () => {}): Command {
  const root = new Command('eai').option('--profile <name>');
  root.hook('preAction', async (_root, command) => activateCommandProfile(command, process.env.EAI_PROFILE, fixture.cwd));
  root.command('probe').action(action);
  root.command('start').argument('[directory]', 'Target directory', '.')
    .option('--check').option('--dry-run').action(action);
  root.command('update').action(action);
  const env = root.command('env');
  env.command('list').action(action);
  return root;
}

describe('app-local CLI profile context', () => {
  beforeEach(async () => {
    fixture.root = await mkdtemp(join(tmpdir(), 'eai-profile-context-'));
    fixture.home = join(fixture.root, 'home');
    fixture.cwd = fixture.root;
    await mkdir(join(fixture.home, '.eai'), { recursive: true, mode: 0o700 });
    await chmod(fixture.home, 0o700);
    await chmod(join(fixture.home, '.eai'), 0o700);
    for (const key of ['EAI_PROFILE', 'BASE_URL_PUBLIC_API', 'EAI_AUTH_TENANT_NAME', 'EAI_AUTH_TENANT_ID',
      'EAI_AUTH_SCOPE', 'EAI_PUBLIC_API_SCOPE', 'EAI_AUTH_CLIENT_ID', 'EAI_CLI_CLIENT_ID']) vi.stubEnv(key, undefined);
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Profile context must not make provider calls'); }));
    setActiveProfile('default');
    await writeProfiles();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const name of ['default', 'dev', 'other']) {
      setActiveProfile(name);
      await auth.clearTokens();
    }
    setActiveProfile('default');
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
    await rm(fixture.root, { recursive: true, force: true });
  });

  test('outside an app the public default ignores persisted activeProfile and nearby env files', async () => {
    await writeFile(join(fixture.root, '.env.local'), 'EAI_PROFILE=dev\n');
    await program().parseAsync(['probe'], { from: 'user' });
    expect(getActiveProfile()).toBe('default');
    expect(getProfileTokensFile(getActiveProfile())).toBe(join(fixture.home, '.eai', 'tokens.json'));
  });

  test('nested app commands restore only the app-root ignored selector before auth and API resolution', async () => {
    const root = await project('app', 'export EAI_PROFILE="dev" # local selector\nENTRA_CLIENT_ID=app-runtime-client\n', devApi);
    fixture.cwd = join(root, 'src', 'feature');
    await mkdir(fixture.cwd, { recursive: true });
    await writeFile(join(fixture.cwd, '.env.local'), 'EAI_PROFILE=other\n');
    setActiveProfile('default');
    await auth.storeTokens({ accessToken: 'production-fixture', expiresAt: Date.now() + 60_000,
      tenantName: 'enterpriseaiplatform', tenantId: 'production-authority', clientId: 'production-client' });
    setActiveProfile('dev');
    await auth.storeTokens({ accessToken: 'dev-fixture', expiresAt: Date.now() + 60_000,
      tenantName: dev.authTenantName, tenantId: dev.authTenantId, clientId: dev.authClientId });
    setActiveProfile('default');
    let observed: unknown;
    await program(async () => {
      observed = { profile: getActiveProfile(), api: await resolvePublicApiUrl(root),
        token: (await auth.loadTokens())?.accessToken, auth: await auth.resolveAuthConfig(root) };
    }).parseAsync(['probe'], { from: 'user' });
    expect(observed).toMatchObject({ profile: 'dev', api: devApi, token: 'dev-fixture',
      auth: { tenantId: dev.authTenantId, clientId: dev.authClientId, source: 'profile' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    { args: ['--profile', 'other', 'probe'], environment: 'dev', selected: 'other' },
    { args: ['probe'], environment: 'other', selected: 'other' },
    { args: ['probe'], environment: '  ', selected: 'dev' },
  ])('selector precedence preserves $selected: $args / $environment', async ({ args, environment, selected }) => {
    fixture.cwd = await project('app', 'EAI_PROFILE=dev\n', devApi);
    vi.stubEnv('EAI_PROFILE', environment);
    await program().parseAsync(args, { from: 'user' });
    expect(getActiveProfile()).toBe(selected);
    expect(getProfileTokensFile(selected)).toBe(join(fixture.home, '.eai', 'tokens', `${selected}.json`));
  });

  test('explicit default overrides shell/project selectors when the app uses production routing', async () => {
    fixture.cwd = await project('app', 'EAI_PROFILE=dev\n', prodApi);
    vi.stubEnv('EAI_PROFILE', 'other');
    await program().parseAsync(['--profile', 'default', 'probe'], { from: 'user' });
    expect(getActiveProfile()).toBe('default');
  });

  test('different apps select independent named token files and API authorities', async () => {
    await writeProfiles({ dev, other: { ...other, publicApiUrl: testApi } });
    const first = await project('first-app', 'EAI_PROFILE=dev\n', devApi);
    const second = await project('second-app', 'EAI_PROFILE=other\n', testApi);
    fixture.cwd = first;
    await program().parseAsync(['probe'], { from: 'user' });
    expect(await resolvePublicApiUrl(first)).toBe(devApi);
    expect(getProfileTokensFile(getActiveProfile())).toBe(join(fixture.home, '.eai', 'tokens', 'dev.json'));
    fixture.cwd = second;
    await program().parseAsync(['probe'], { from: 'user' });
    expect(await resolvePublicApiUrl(second)).toBe(testApi);
    expect(getProfileTokensFile(getActiveProfile())).toBe(join(fixture.home, '.eai', 'tokens', 'other.json'));
  });

  test.each(['explicit', 'environment', 'project'])('unknown %s profile aborts before tokens, action or provider calls', async (source) => {
    fixture.cwd = await project('app', source === 'project' ? 'EAI_PROFILE=missing\n' : '', devApi);
    if (source === 'environment') vi.stubEnv('EAI_PROFILE', 'missing');
    const tokens = vi.spyOn(auth, 'loadTokens');
    const action = vi.fn();
    await expect(program(action).parseAsync(source === 'explicit' ? ['--profile', 'missing', 'probe'] : ['probe'], { from: 'user' }))
      .rejects.toThrow('Profile "missing" is not configured locally');
    expect(tokens).not.toHaveBeenCalled(); expect(action).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  test.each(['../default', 'dev/../../default', '.', '${EAI_PROFILE}', 'dev:unsafe', 'x'.repeat(129)])('unsafe selector never becomes a token path: %s', (name) => {
    expect(() => resolveCommandProfile({ optsWithGlobals: () => ({ profile: name }) }, '')).toThrow('profile names');
    expect(() => getProfileTokensFile(name)).toThrow('profile names');
  });

  test('explicit override to a different API fails before authenticated handlers', async () => {
    await writeProfiles({ dev, other: { ...other, publicApiUrl: prodApi } });
    fixture.cwd = await project('app', 'EAI_PROFILE=dev\n', devApi);
    const action = vi.fn();
    const tokens = vi.spyOn(auth, 'loadTokens');
    await expect(program(action).parseAsync(['--profile', 'other', 'probe'], { from: 'user' })).rejects.toThrow('does not match');
    expect(tokens).not.toHaveBeenCalled(); expect(action).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  test.each(['routing', 'shell'])('named profile rejects mismatched %s API configuration', async (source) => {
    fixture.cwd = await project('app', 'EAI_PROFILE=dev\n', devApi);
    if (source === 'routing') await writeFile(join(fixture.cwd, '.env.local'), `EAI_PROFILE=dev\nBASE_URL_PUBLIC_API=${devApi}\nROUTING_BOOTSTRAP_PUBLIC_API_URL=${prodApi}\n`);
    else vi.stubEnv('BASE_URL_PUBLIC_API', prodApi);
    await expect(program().parseAsync(['probe'], { from: 'user' })).rejects.toThrow('does not match');
  });

  test('equivalent normalized named endpoints agree', async () => {
    fixture.cwd = await project('app', 'EAI_PROFILE=dev\n', devApi + '/');
    await program().parseAsync(['probe'], { from: 'user' });
    expect(getActiveProfile()).toBe('dev');
  });

  test.each([devApi, testApi, 'http://dev-api.au.myenterprise.ai/public', `${devApi}/v4`])('private API without a selector never uses default production authentication: %s', async (api) => {
    fixture.cwd = await project('app', '', api);
    const action = vi.fn();
    await expect(program(action).parseAsync(['probe'], { from: 'user' })).rejects.toThrow('EAI_PROFILE');
    expect(action).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  test('changing only the production CLI client does not opt production authentication into DEV', async () => {
    fixture.cwd = await project('app', '', devApi);
    vi.stubEnv('EAI_CLI_CLIENT_ID', 'another-production-client');
    await expect(program().parseAsync(['probe'], { from: 'user' })).rejects.toThrow('default profile uses production authentication');
  });

  test('default regional production routing and explicit local-stack endpoints remain supported', async () => {
    fixture.cwd = await project('production-app', `BASE_URL_PUBLIC_API=https://api.eu.myenterprise.ai/public\nROUTING_BOOTSTRAP_PUBLIC_API_URL=${prodApi}\n`);
    await program().parseAsync(['probe'], { from: 'user' });
    expect(getActiveProfile()).toBe('default');
    fixture.cwd = await project('local-app', '', 'http://127.0.0.1:18000/public');
    vi.stubEnv('BASE_URL_PUBLIC_API', 'http://127.0.0.1:18000/public');
    await program().parseAsync(['probe'], { from: 'user' });
    expect(getActiveProfile()).toBe('default');
  });

  test('private API keeps the existing complete explicit CLI auth override contract', async () => {
    fixture.cwd = await project('app', '', devApi);
    vi.stubEnv('EAI_AUTH_TENANT_NAME', dev.authTenantName);
    vi.stubEnv('EAI_AUTH_TENANT_ID', dev.authTenantId);
    vi.stubEnv('EAI_AUTH_SCOPE', 'openid profile api://fixture-dev/access_token');
    await expect(program().parseAsync(['probe'], { from: 'user' })).rejects.toThrow('complete explicit CLI auth');
    vi.stubEnv('EAI_CLI_CLIENT_ID', dev.authClientId);
    await program().parseAsync(['probe'], { from: 'user' });
    expect(getActiveProfile()).toBe('default');
  });

  test('start <directory> restores the target app context instead of the caller app', async () => {
    await writeProfiles({ dev, other: { ...other, publicApiUrl: testApi } });
    const target = await project('target-app', 'EAI_PROFILE=dev\n', devApi);
    fixture.cwd = await project('caller-app', 'EAI_PROFILE=other\n', testApi);
    await program().parseAsync(['start', '../target-app', '--check'], { from: 'user' });
    expect(getActiveProfile()).toBe('dev');
    expect(await resolvePublicApiUrl(target)).toBe(devApi);
  });

  test('local-only detection and env inspection can diagnose a mismatched runtime', async () => {
    fixture.cwd = await project('app', 'EAI_PROFILE=dev\n', prodApi);
    await program().parseAsync(['start', '.', '--check'], { from: 'user' });
    expect(getActiveProfile()).toBe('dev');
    await program().parseAsync(['env', 'list'], { from: 'user' });
    expect(getActiveProfile()).toBe('dev');
  });

  test.each(['oversized', 'symlink', 'hardlink', 'directory'])('unsafe project selector is rejected without following or reading unbounded input: %s', async (kind) => {
    fixture.cwd = await project('app');
    const path = join(fixture.cwd, '.env.local');
    if (kind === 'oversized') await writeFile(path, 'x'.repeat(64 * 1024 + 1));
    if (kind === 'directory') await mkdir(path);
    if (kind === 'symlink' || kind === 'hardlink') {
      const external = join(fixture.root, 'foreign-context');
      await writeFile(external, 'EAI_PROFILE=dev\n');
      if (kind === 'symlink') await symlink(external, path); else await link(external, path);
    }
    const action = vi.fn();
    await expect(program(action).parseAsync(['probe'], { from: 'user' })).rejects.toThrow('single-link regular file within 64 KiB');
    expect(action).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  test('update remains usable to repair an app with malformed or oversized local context', async () => {
    fixture.cwd = await project('app', 'x'.repeat(64 * 1024 + 1));
    const action = vi.fn();
    await program(action).parseAsync(['update'], { from: 'user' });
    expect(action).toHaveBeenCalledOnce();
    expect(getActiveProfile()).toBe('default');
  });
});
