import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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
});
