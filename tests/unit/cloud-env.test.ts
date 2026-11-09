import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';

const fixture = vi.hoisted(() => ({
  exec: vi.fn(async (_file: string, _args: string[]) => ({ stdout: '', stderr: '' })),
}));
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  const execFile = vi.fn();
  Object.defineProperty(execFile, promisify.custom, { value: fixture.exec });
  return { ...actual, execFile };
});

const referenceType = 'application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8';
const vaultUri = 'https://fixture.vault.azure.net/secrets/fixture-secret';

function cloudValues(value: string): void {
  fixture.exec.mockResolvedValueOnce({ stdout: JSON.stringify([
    { key: 'PUBLIC_FLAG', value: 'ready' },
    { key: 'AUTH_SECRET', value, contentType: referenceType },
  ]), stderr: '' });
}

describe('cloud environment secret resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    fixture.exec.mockReset();
    vi.stubEnv('EAI_APP_CONFIG_STORE', 'fixture-store');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test('default pulls return normal values and unresolved reference metadata without fetching secrets', async () => {
    cloudValues(JSON.stringify({ uri: vaultUri }));
    const { pullCloudEnvValues } = await import('../../src/lib/cloud-env.js');

    await expect(pullCloudEnvValues({ label: 'qa-app' })).resolves.toEqual({
      store: 'fixture-store', patches: { PUBLIC_FLAG: 'ready' },
      secretRefs: [{ key: 'AUTH_SECRET', vaultUri }],
    });

    expect(fixture.exec).toHaveBeenCalledOnce();
    expect(fixture.exec).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([
      'appconfig', 'kv', 'list', '--name', 'fixture-store', '--label', 'qa-app', '--output', 'json',
    ]));
  });

  test('requested secrets resolve into patches through the exact Key Vault reference', async () => {
    cloudValues(JSON.stringify({ uri: vaultUri }));
    fixture.exec.mockResolvedValueOnce({ stdout: '<resolved-fixture-secret>\n', stderr: '' });
    const { pullCloudEnvValues } = await import('../../src/lib/cloud-env.js');

    await expect(pullCloudEnvValues({ label: 'qa-app', includeSecrets: true })).resolves.toEqual({
      store: 'fixture-store', patches: { PUBLIC_FLAG: 'ready', AUTH_SECRET: '<resolved-fixture-secret>' },
      secretRefs: [{ key: 'AUTH_SECRET', vaultUri }],
    });

    expect(fixture.exec).toHaveBeenCalledTimes(2);
    expect(fixture.exec).toHaveBeenLastCalledWith(expect.any(String), [
      'keyvault', 'secret', 'show', '--id', vaultUri, '--query', 'value', '--output', 'tsv',
    ]);
  });

  test('a denied requested secret aborts the entire pull and keeps command errors and reference values private', async () => {
    cloudValues(JSON.stringify({ uri: vaultUri }));
    fixture.exec.mockRejectedValueOnce(Object.assign(
      new Error(`Azure rejected ${vaultUri}: <sensitive-fixture-value>`),
      { stdout: '<sensitive-fixture-value>', stderr: '<sensitive-azure-stderr>' },
    ));
    const { pullCloudEnvValues } = await import('../../src/lib/cloud-env.js');

    const error = await pullCloudEnvValues({ label: 'qa-app', includeSecrets: true })
      .then(() => { throw new Error('The pull incorrectly succeeded'); }, (reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Could not resolve requested secret for AUTH_SECRET.');
    expect((error as Error).cause).toBeUndefined();
    expect(String(error)).not.toMatch(/fixture\.vault|sensitive-fixture-value|sensitive-azure-stderr/);
    expect(fixture.exec).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['invalid JSON', '{<private-malformed-reference>'],
    ['missing uri', '{"private":"<private-reference-value>"}'],
    ['non-string uri', '{"uri":42}'],
    ['empty uri', '{"uri":"   "}'],
    ['null reference', 'null'],
  ])('a marked Key Vault reference with %s never falls back to a plain value', async (_name, value) => {
    cloudValues(value);
    const { pullCloudEnvValues } = await import('../../src/lib/cloud-env.js');

    await expect(pullCloudEnvValues({ label: 'qa-app', includeSecrets: true }))
      .rejects.toThrow('Invalid Key Vault reference for AUTH_SECRET.');

    expect(fixture.exec).toHaveBeenCalledOnce();
  });

  test('malformed references also fail default pulls without fetching or writing reference JSON', async () => {
    cloudValues('{<private-malformed-reference>');
    const { pullCloudEnvValues } = await import('../../src/lib/cloud-env.js');

    await expect(pullCloudEnvValues({ label: 'qa-app' }))
      .rejects.toThrow('Invalid Key Vault reference for AUTH_SECRET.');

    expect(fixture.exec).toHaveBeenCalledOnce();
  });

  test('ordinary JSON values remain plain values when they are not marked as secret references', async () => {
    fixture.exec.mockResolvedValueOnce({ stdout: JSON.stringify([
      { key: 'PUBLIC_JSON', value: '{"uri":"application-value"}' },
    ]), stderr: '' });
    const { pullCloudEnvValues } = await import('../../src/lib/cloud-env.js');

    await expect(pullCloudEnvValues({ label: 'qa-app', includeSecrets: true })).resolves.toEqual({
      store: 'fixture-store', patches: { PUBLIC_JSON: '{"uri":"application-value"}' }, secretRefs: [],
    });

    expect(fixture.exec).toHaveBeenCalledOnce();
  });

  test.each([false, true])('local selector references are excluded before parsing or fetching, includeSecrets=%s', async (includeSecrets) => {
    fixture.exec.mockResolvedValueOnce({ stdout: JSON.stringify([
      { key: 'EAI_PROFILE', value: '{invalid-selector-reference', contentType: referenceType },
      { key: 'PUBLIC_FLAG', value: 'ready' },
    ]), stderr: '' });
    const { pullCloudEnvValues } = await import('../../src/lib/cloud-env.js');
    await expect(pullCloudEnvValues({ label: 'qa-app', includeSecrets })).resolves.toEqual({
      store: 'fixture-store', patches: { PUBLIC_FLAG: 'ready' }, secretRefs: [],
    });
    expect(fixture.exec).toHaveBeenCalledOnce();
  });

  test.each([false, true])('valid local selector references never become cloud values or secret requests, includeSecrets=%s', async (includeSecrets) => {
    fixture.exec.mockResolvedValueOnce({ stdout: JSON.stringify([
      { key: 'EAI_PROFILE', value: JSON.stringify({ uri: vaultUri }), contentType: referenceType },
      { key: 'PUBLIC_FLAG', value: 'ready' },
    ]), stderr: '' });
    fixture.exec.mockResolvedValueOnce({ stdout: '<unrequested-selector-secret>\n', stderr: '' });
    const { pullCloudEnvValues } = await import('../../src/lib/cloud-env.js');
    await expect(pullCloudEnvValues({ label: 'qa-app', includeSecrets })).resolves.toEqual({
      store: 'fixture-store', patches: { PUBLIC_FLAG: 'ready' }, secretRefs: [],
    });
    expect(fixture.exec).toHaveBeenCalledOnce();
  });

  test('excluding a local selector retains the exact requested application secret contract', async () => {
    fixture.exec.mockResolvedValueOnce({ stdout: JSON.stringify([
      { key: 'EAI_PROFILE', value: '{invalid-selector-reference', contentType: referenceType },
      { key: 'AUTH_SECRET', value: JSON.stringify({ uri: vaultUri }), contentType: referenceType },
    ]), stderr: '' });
    fixture.exec.mockResolvedValueOnce({ stdout: '<requested-application-secret>\n', stderr: '' });
    const { pullCloudEnvValues } = await import('../../src/lib/cloud-env.js');
    await expect(pullCloudEnvValues({ label: 'qa-app', includeSecrets: true })).resolves.toEqual({
      store: 'fixture-store', patches: { AUTH_SECRET: '<requested-application-secret>' },
      secretRefs: [{ key: 'AUTH_SECRET', vaultUri }],
    });
    expect(fixture.exec).toHaveBeenCalledTimes(2);
    expect(fixture.exec).toHaveBeenLastCalledWith(expect.any(String), [
      'keyvault', 'secret', 'show', '--id', vaultUri, '--query', 'value', '--output', 'tsv',
    ]);
  });

  test('a plain local selector is also excluded from the shared pull result', async () => {
    fixture.exec.mockResolvedValueOnce({ stdout: JSON.stringify([
      { key: 'EAI_PROFILE', value: 'cloud-profile' }, { key: 'PUBLIC_FLAG', value: 'ready' },
    ]), stderr: '' });
    const { pullCloudEnvValues } = await import('../../src/lib/cloud-env.js');
    await expect(pullCloudEnvValues({ label: 'qa-app' })).resolves.toEqual({
      store: 'fixture-store', patches: { PUBLIC_FLAG: 'ready' }, secretRefs: [],
    });
    expect(fixture.exec).toHaveBeenCalledOnce();
  });

  test.each(['valid', 'malformed'])('real env pull skips a %s selector reference before any Key Vault request', async (kind) => {
    const root = await mkdtemp(join(tmpdir(), 'eai-env-excluded-selector-'));
    const file = join(root, '.env.local');
    const before = 'EAI_PROFILE=dev\nNEXT_PUBLIC_APP_NAME=fixture-app\nPUBLIC_FLAG=local\n';
    await writeFile(file, before, { mode: 0o600 });
    await chmod(file, 0o600);
    fixture.exec.mockResolvedValueOnce({ stdout: JSON.stringify([
      { key: 'EAI_PROFILE', value: kind === 'valid' ? JSON.stringify({ uri: vaultUri }) : '{invalid-selector-reference', contentType: referenceType },
      { key: 'PUBLIC_FLAG', value: 'cloud' },
    ]), stderr: '' });
    fixture.exec.mockResolvedValueOnce({ stdout: '<unrequested-selector-secret>\n', stderr: '' });
    const config = await import('../../src/lib/config.js');
    const discovery = vi.spyOn(config, 'findProjectRoot').mockResolvedValue(root);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('Unexpected pull exit'); }) as never);
    try {
      const { envCommand } = await import('../../src/commands/env.js');
      await new Command('eai').addCommand(envCommand).parseAsync(['env', 'pull', '--include-secrets'], { from: 'user' });
      expect(fixture.exec).toHaveBeenCalledOnce();
      expect(exit).not.toHaveBeenCalled();
      const after = await readFile(file, 'utf8');
      expect(after).toContain('EAI_PROFILE=dev');
      expect(after).toContain('PUBLIC_FLAG=cloud');
      expect(after).not.toContain('unrequested-selector-secret');
    } finally {
      exit.mockRestore(); discovery.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
