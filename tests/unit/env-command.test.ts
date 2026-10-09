import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  root: '', exec: vi.fn(async (_file: string, _args: string[]) => ({ stdout: '', stderr: '' })),
  pull: vi.fn(), store: vi.fn(() => 'fixture-store'),
  patch: vi.fn((_root: string, _patches: Record<string, string>) => {}), success: vi.fn(), info: vi.fn(), json: vi.fn(), warn: vi.fn(),
  spinner: { start: vi.fn(), succeed: vi.fn(), fail: vi.fn(), warn: vi.fn() },
}));
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  const execFile = vi.fn();
  Object.defineProperty(execFile, promisify.custom, { value: fixture.exec });
  return { ...actual, execFile };
});
vi.mock('../../src/lib/config.js', async (original) => {
  const actual = await original<typeof import('../../src/lib/config.js')>();
  return { ...actual, findProjectRoot: async () => fixture.root,
    patchEnvFile: async (root: string, patches: Record<string, string>) => {
      fixture.patch(root, patches);
      return actual.patchEnvFile(root, patches);
    } };
});
vi.mock('../../src/lib/cloud-env.js', () => ({ pullCloudEnvValues: fixture.pull, resolveAppConfigStore: fixture.store }));
vi.mock('ora', () => ({ default: () => ({ ...fixture.spinner, start: () => fixture.spinner }) }));
vi.mock('../../src/lib/output.js', () => ({
  success: fixture.success, info: fixture.info, json: fixture.json, warn: fixture.warn,
  error: vi.fn(), blank: vi.fn(), heading: vi.fn(),
}));

async function run(args: string[]): Promise<void> {
  const { envCommand } = await import('../../src/commands/env.js');
  await new Command('eai').addCommand(envCommand).parseAsync(['env', ...args], { from: 'user' });
}

describe('cloud environment command contracts', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    fixture.exec.mockReset().mockResolvedValue({ stdout: '', stderr: '' });
    fixture.root = await mkdtemp(join(tmpdir(), 'eai-env-profile-'));
    await chmod(fixture.root, 0o700);
    await writeFile(join(fixture.root, '.env.local'), [
      '# Private workstation context', 'EAI_PROFILE=dev', 'NEXT_PUBLIC_APP_NAME=fixture-app',
      'PUBLIC_FLAG=local-value', 'AUTH_SECRET=<local-fixture-secret>', '',
    ].join('\n'), { mode: 0o600 });
    await chmod(join(fixture.root, '.env.local'), 0o600);
    fixture.pull.mockResolvedValue({ patches: {}, secretRefs: [] });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(fixture.root, { recursive: true, force: true });
  });

  test('push exports normal application keys while keeping EAI_PROFILE local', async () => {
    await run(['push']);
    const keys = fixture.exec.mock.calls.map(([, args]) => args[(args as string[]).indexOf('--key') + 1]);
    expect(keys).toEqual(['NEXT_PUBLIC_APP_NAME', 'PUBLIC_FLAG', 'AUTH_SECRET']);
    expect(fixture.exec.mock.calls.every(([, args]) => !(args as string[]).includes('EAI_PROFILE'))).toBe(true);
    expect(await readFile(join(fixture.root, '.env.local'), 'utf8')).toContain('EAI_PROFILE=dev');
  });

  test('explicit --key EAI_PROFILE performs no cloud lookup or write', async () => {
    await run(['push', '--key', 'EAI_PROFILE']);
    expect(fixture.exec).not.toHaveBeenCalled();
    expect(fixture.store).not.toHaveBeenCalled();
    expect(fixture.info).toHaveBeenCalledWith(expect.stringContaining('local CLI selector'));
  });

  test('single application key pushes with the requested label', async () => {
    await run(['push', '--key', 'PUBLIC_FLAG', '--label', 'qa-app']);
    expect(fixture.exec).toHaveBeenCalledOnce();
    expect(fixture.exec).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([
      '--key', 'PUBLIC_FLAG', '--value', 'local-value', '--label', 'qa-app',
    ]));
    expect(fixture.spinner.succeed).toHaveBeenCalledWith('Pushed 1 values to fixture-store (label: qa-app)');
    expect(fixture.spinner.fail).not.toHaveBeenCalled();
  });

  test('a partial push continues remaining keys, reports the failed key and exits nonzero', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit 1');
    }) as never);
    fixture.exec.mockImplementation(async (_file, args) => {
      if (args[args.indexOf('--key') + 1] === 'PUBLIC_FLAG') {
        throw new Error('Azure write denied');
      }
      return { stdout: '', stderr: '' };
    });

    await expect(run(['push'])).rejects.toThrow('exit 1');

    expect(fixture.exec.mock.calls.map(([, args]) => args[args.indexOf('--key') + 1])).toEqual([
      'NEXT_PUBLIC_APP_NAME', 'PUBLIC_FLAG', 'AUTH_SECRET',
    ]);
    expect(fixture.spinner.warn).toHaveBeenCalledExactlyOnceWith('Failed to push PUBLIC_FLAG');
    expect(fixture.spinner.fail).toHaveBeenCalledExactlyOnceWith(
      'Pushed 2 values to fixture-store (label: fixture-app); 1 failed: PUBLIC_FLAG',
    );
    expect(fixture.spinner.succeed).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  test('a failed single-key push reports no success and keeps cloud errors and values private', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit 1');
    }) as never);
    fixture.exec.mockRejectedValue(new Error('Azure rejected --value <local-fixture-secret>'));

    await expect(run(['push', '--key', 'AUTH_SECRET', '--label', 'qa-app'])).rejects.toThrow('exit 1');

    expect(fixture.exec).toHaveBeenCalledOnce();
    expect(fixture.spinner.fail).toHaveBeenCalledExactlyOnceWith(
      'Pushed 0 values to fixture-store (label: qa-app); 1 failed: AUTH_SECRET',
    );
    expect(fixture.spinner.succeed).not.toHaveBeenCalled();
    expect([...fixture.spinner.warn.mock.calls, ...fixture.spinner.fail.mock.calls].flat().join('\n'))
      .not.toContain('<local-fixture-secret>');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  test.each([false, true])('pull preserves local selector with include-secrets=%s, including a cloud Key Vault selector', async (includeSecrets) => {
    fixture.pull.mockResolvedValue({ patches: { EAI_PROFILE: 'production-from-cloud', PUBLIC_FLAG: 'cloud-value' },
      secretRefs: [{ key: 'EAI_PROFILE', secretName: 'cloud-selector' }, { key: 'OTHER_SECRET', secretName: 'other-secret' }] });
    await run(['pull', ...(includeSecrets ? ['--include-secrets'] : [])]);
    const env = await readFile(join(fixture.root, '.env.local'), 'utf8');
    expect(env).toContain('EAI_PROFILE=dev');
    expect(env).not.toContain('production-from-cloud');
    expect(env).toContain('PUBLIC_FLAG=cloud-value');
    expect(env).toContain('AUTH_SECRET=<local-fixture-secret>');
    expect(fixture.patch).toHaveBeenCalledWith(fixture.root, { PUBLIC_FLAG: 'cloud-value' });
    expect(fixture.success.mock.calls.flat().join('\n')).not.toMatch(/EAI_PROFILE|production-from-cloud/);
    expect(fixture.info.mock.calls.flat().join('\n')).not.toMatch(/EAI_PROFILE|cloud-selector/);
    expect(fixture.spinner.succeed).toHaveBeenCalledWith(`Found ${includeSecrets ? 1 : 2} config values`);
  });

  test('pulling only cloud EAI_PROFILE leaves the file unchanged', async () => {
    const before = await readFile(join(fixture.root, '.env.local'), 'utf8');
    fixture.pull.mockResolvedValue({ patches: { EAI_PROFILE: 'other' }, secretRefs: [] });
    await run(['pull']);
    expect(fixture.patch).not.toHaveBeenCalled();
    expect(await readFile(join(fixture.root, '.env.local'), 'utf8')).toBe(before);
    expect(fixture.spinner.succeed).toHaveBeenCalledWith('Found 0 config values');
  });

  test('list still exposes the local selector for consultant diagnostics', async () => {
    await run(['list', '--format', 'json']);
    expect(fixture.json).toHaveBeenCalledWith({ variables: {
      AUTH_SECRET: '[hidden]', EAI_PROFILE: 'dev', NEXT_PUBLIC_APP_NAME: 'fixture-app', PUBLIC_FLAG: 'local-value',
    }, count: 4 });
  });
});
