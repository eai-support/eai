import { test, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalAppCredential } from '../../src/lib/local-app-credential.js';
import { parse } from 'dotenv';

const binding = { tenantId: 'runtime', appName: 'app', clientId: 'client' };
async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'eai-credential-test-'));
  await writeFile(join(root, '.env.local'), 'EAI_APP_KEY=app\n', { mode: 0o600 });
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function options(root: string, issue: () => Promise<string>, reissue = false) {
  return { root, binding, patches: { EAI_TENANT_ID: 'runtime' }, issue, reissue };
}

test('uncertain issuance refuses ordinary retries and requires explicit reissue consent', async () => fixture(async root => {
  let calls = 0;
  const issue = async () => { calls++; throw new Error('network response lost'); };
  await expect(createLocalAppCredential(options(root, issue))).rejects.toThrow('network response lost');
  await expect(createLocalAppCredential(options(root, issue))).rejects.toThrow('may have succeeded');
  expect(calls).toBe(1);
  await createLocalAppCredential(options(root, async () => { calls++; return 'private-fixture-secret'; }, true));
  expect(calls).toBe(2);
  const journal = JSON.parse(await readFile(join(root, '.env.credential.local'), 'utf8'));
  expect(journal.phase).toBe('complete');
  expect(journal.secret).toBeUndefined();
  if (process.platform !== 'win32') expect((await stat(join(root, '.env.credential.local'))).mode & 0o777).toBe(0o600);
}));

test('retained issued credential recovers after local write drift without another issuer request', async () => fixture(async root => {
  const before = await readFile(join(root, '.env.local'), 'utf8');
  let calls = 0;
  const issue = async () => { calls++; await writeFile(join(root, '.env.local'), 'CHANGED=true\n'); return 'saved-fixture-secret'; };
  await expect(createLocalAppCredential(options(root, issue))).rejects.toThrow('retained privately');
  expect(await readFile(join(root, '.env.local'), 'utf8')).toBe('CHANGED=true\n');
  await expect(createLocalAppCredential(options(root, issue))).rejects.toThrow('changed after issuance');
  await writeFile(join(root, '.env.local'), before);
  await createLocalAppCredential(options(root, issue));
  expect(calls).toBe(1);
  expect(await readFile(join(root, '.env.local'), 'utf8')).toContain('ENTRA_CLIENT_SECRET=saved-fixture-secret');
}));

test('simultaneous local setup refuses the second request before its issuer boundary', async () => fixture(async root => {
  let release!: () => void;
  const gated = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const first = createLocalAppCredential(options(root, async () => { started(); await gated; return 'fixture-secret'; }));
  await entered;
  let secondCalls = 0;
  await expect(createLocalAppCredential(options(root, async () => { secondCalls++; return 'other'; }))).rejects.toThrow('in progress');
  expect(secondCalls).toBe(0);
  release(); await first;
}));

test('definitive issuer denial preserves configuration and permits a later authorized setup', async () => fixture(async root => {
  const before = await readFile(join(root, '.env.local'), 'utf8');
  await expect(createLocalAppCredential(options(root, async () => { throw Object.assign(new Error('denied'), { status: 403 }); }))).rejects.toThrow('denied');
  expect(await readFile(join(root, '.env.local'), 'utf8')).toBe(before);
  await createLocalAppCredential(options(root, async () => 'fixture-secret'));
}));

test('crossed stored app authority refuses recovery even with explicit reissue consent', async () => fixture(async root => {
  await expect(createLocalAppCredential(options(root, async () => { throw new Error('lost'); }))).rejects.toThrow();
  let calls = 0;
  await expect(createLocalAppCredential({ ...options(root, async () => { calls++; return 'secret'; }, true),
    binding: { ...binding, clientId: 'crossed' } })).rejects.toThrow('different selected app');
  expect(calls).toBe(0);
}));

test('a symlinked credential journal cannot inject a recovery secret or request another one', async () => fixture(async root => {
  const target = join(root, 'external');
  await writeFile(target, '{}', { mode: 0o600 });
  await symlink(target, join(root, '.env.credential.local'));
  let calls = 0;
  await expect(createLocalAppCredential(options(root, async () => { calls++; return 'secret'; }))).rejects.toThrow('owner-only');
  expect(calls).toBe(0);
  expect(await readFile(target, 'utf8')).toBe('{}');
}));


test('an exited setup process lock permits private issued-credential recovery without reissue', async () => fixture(async root => {
  const before = await readFile(join(root, '.env.local'), 'utf8');
  let calls = 0;
  await expect(createLocalAppCredential(options(root, async () => {
    calls++; await writeFile(join(root, '.env.local'), 'changed=true\n'); return 'saved-secret';
  }))).rejects.toThrow('retained privately');
  await writeFile(join(root, '.env.local'), before);
  await writeFile(join(root, '.env.credential-lock.local'), JSON.stringify({ pid: 2147483647, nonce: 'exited-fixture-owner' }), { mode: 0o600 });
  await createLocalAppCredential(options(root, async () => { calls++; return 'never'; }));
  expect(calls).toBe(1);
  expect(await readFile(join(root, '.env.local'), 'utf8')).toContain('ENTRA_CLIENT_SECRET=saved-secret');
}));

test.each(['ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'EAI_TENANT_ID'])('duplicate %s entries deny issuance until the local configuration is corrected', async key => fixture(async root => {
  const before = `EAI_APP_KEY=app\n${key}=first\n export ${key} = last\n`;
  await writeFile(join(root, '.env.local'), before);
  let calls = 0;
  const issue = async () => { calls++; return 'issued-secret'; };
  await expect(createLocalAppCredential(options(root, issue))).rejects.toThrow('Duplicate');
  expect(calls).toBe(0);
  expect(await readFile(join(root, '.env.local'), 'utf8')).toBe(before);
  await expect(stat(join(root, '.env.credential.local'))).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(join(root, '.env.local'), `EAI_APP_KEY=app\n export ${key} = old\n`);
  await createLocalAppCredential(options(root, issue));
  expect(calls).toBe(1);
  const actual = parse(await readFile(join(root, '.env.local'), 'utf8'));
  expect(actual.ENTRA_CLIENT_ID).toBe(binding.clientId);
  expect(actual.ENTRA_CLIENT_SECRET).toBe('issued-secret');
  expect(actual.EAI_TENANT_ID).toBe('runtime');
}));
