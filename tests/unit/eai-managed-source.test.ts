import { afterEach, describe, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import inquirer from 'inquirer';
import {
  buildCliManagedSourceBundle,
  chooseManagedDeploySource,
  isManagedAppSourcePath,
  writeCliManagedSourceReceipt,
} from '../../src/lib/eai-managed-source.js';

const exec = promisify(execFile);
const templateCommit = 'a'.repeat(40);
const cleanup: string[] = [];
const hash = (value: string | Buffer): string => `sha256:${createHash('sha256').update(value).digest('hex')}`;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function put(root: string, path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cli-managed-source-'));
  cleanup.push(root);
  for (const [path, content] of Object.entries({
    '.eai-manifest.json': JSON.stringify({ template: { commit: templateCommit } }),
    '.gitignore': 'node_modules/\n.env*\npublic/ignored.png\ncustom-ignored.ts\n',
    'package.json': '{"name":"local-app","private":true}',
    'eai.config.ts': 'export default { appKey: "local-app" };',
    'eai.runtime.json': '{"schemaVersion":1}',
    'src/app/page.tsx': 'export default function Page() { return "scaffold"; }',
    'src/auth.ts': 'export const platformAuth = true;',
    'src/eai.config/default.ts': 'export default { appKey: "local-app" };',
    'src/eai.config/register.ts': 'export const registry = "platform";',
    'public/scaffold.svg': '<svg />',
    '.github/workflows/eai-app.yml': 'platform workflow',
    'README.md': 'original scaffold documentation',
  })) await put(root, path, content);
  await exec('git', ['init', '--quiet'], { cwd: root });
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Initial scaffold from template\n\nCreated by: eai init'], { cwd: root });
  return root;
}

describe('managed local source snapshot', () => {
  test('packages current edited, untracked and ignored source bytes with deterministic metadata', async () => {
    const root = await project();
    await put(root, 'src/app/page.tsx', 'export default function Page() { return "local edit"; }');
    await put(root, 'src/types/order.ts', 'export type Order = { id: string };');
    const binary = Buffer.from([0, 255, 128, 7]);
    await put(root, 'public/ignored.png', binary);
    await put(root, '.env.local', 'SECRET=local-only');
    const first = await buildCliManagedSourceBundle(root);
    const second = await buildCliManagedSourceBundle(root);
    expect(first).toEqual(second);
    expect(first.bundle.templateCommitSha).toBe(templateCommit);
    const paths = first.bundle.files.map(file => file.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toEqual(['eai.config.ts', 'eai.runtime.json', 'package.json', 'public/ignored.png', 'public/scaffold.svg', 'src/app/page.tsx', 'src/eai.config/default.ts', 'src/types/order.ts']);
    const image = first.bundle.files.find(file => file.path === 'public/ignored.png')!;
    expect(image).toEqual({ path: 'public/ignored.png', type: 'file', size: binary.length, sha256: hash(binary), contentBase64: binary.toString('base64') });
    expect(first.totalBytes).toBe(first.bundle.files.reduce((total, file) => total + file.size, 0));
    expect(first.bundle.configHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.bundle.bundleSha256).toBe(hash(JSON.stringify([templateCommit, first.bundle.configHash, first.bundle.files.map(file => [file.path, file.size, file.sha256])])));
  });

  test('expresses deleted app files by absence from the complete snapshot', async () => {
    const root = await project();
    await rm(join(root, 'public/scaffold.svg'));
    expect((await buildCliManagedSourceBundle(root)).bundle.files.map(file => file.path)).not.toContain('public/scaffold.svg');
  });

  test('excludes generated editor, Gofer and build metadata while preserving runtime source', async () => {
    const root = await project();
    const before = await buildCliManagedSourceBundle(root);
    for (const path of ['.vscode/settings.json', '.github/skills/eai/SKILL.md', 'AGENTS.md', 'next-env.d.ts', 'tsconfig.tsbuildinfo']) await put(root, path, 'local tooling output');
    expect(await buildCliManagedSourceBundle(root)).toEqual(before);
  });

  test('writes recomputable local evidence without embedding source bytes', async () => {
    const root = await project();
    const { bundle, totalBytes } = await buildCliManagedSourceBundle(root);
    const receipt = JSON.parse(await readFile(await writeCliManagedSourceReceipt(root, bundle), 'utf8'));
    expect(receipt).toEqual({
      schemaVersion: 'eai.cli_managed_source_local_receipt.v1', sourceMode: 'eai-cli-generated',
      templateCommitSha: templateCommit, bundleSha256: bundle.bundleSha256, configHash: bundle.configHash, totalBytes,
      files: bundle.files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
    });
    expect((await buildCliManagedSourceBundle(root)).bundle).toEqual(bundle);
  });

  test('refuses to write local evidence through a linked directory', async () => {
    const root = await project();
    const { bundle } = await buildCliManagedSourceBundle(root);
    const outside = await mkdtemp(join(tmpdir(), 'cli-receipt-outside-'));
    cleanup.push(outside);
    await symlink(outside, join(root, '.eai'), 'dir');
    await expect(writeCliManagedSourceReceipt(root, bundle)).rejects.toMatchObject({ code: 'SOURCE_RECEIPT_PATH_INVALID' });
  });

  test.each(['src/auth.ts', 'src/eai.config/register.ts', '.github/workflows/eai-app.yml', 'README.md', 'custom-ignored.ts'])('fails with actionable unsupported changes for %s', async path => {
    const root = await project();
    await put(root, path, 'changed local bytes');
    await expect(buildCliManagedSourceBundle(root)).rejects.toThrow(path);
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'SOURCE_SCOPE_UNSUPPORTED' });
  });

  test.each(['package.json', 'eai.config.ts', 'eai.runtime.json'])('refuses removed root config %s because the publisher would retain its template default', async path => {
    const root = await project();
    await rm(join(root, path));
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'SOURCE_SCOPE_UNSUPPORTED' });
  });

  test.each(['src/app/new.ts', 'public/linked', 'src/custom'])('does not read through a source symlink at %s', async path => {
    const root = await project();
    const outside = await mkdtemp(join(tmpdir(), 'cli-source-outside-'));
    cleanup.push(outside);
    await mkdir(dirname(join(root, path)), { recursive: true });
    await symlink(outside, join(root, path), 'dir');
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'SOURCE_SYMLINK_UNSUPPORTED' });
  });

  test('does not trust a custom template without an exact reviewed pin', async () => {
    const root = await project();
    await put(root, '.eai-manifest.json', JSON.stringify({ template: { source: 'custom' } }));
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'TEMPLATE_PIN_REQUIRED' });
  });

  test('does not trust an edited template pin after the original scaffold commit', async () => {
    const root = await project();
    await put(root, '.eai-manifest.json', JSON.stringify({ template: { commit: 'b'.repeat(40) } }));
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'TEMPLATE_PIN_CHANGED' });
  });

  test('requires a scaffold baseline before deciding platform files are unchanged', async () => {
    const root = await project();
    await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--amend', '--quiet', '-m', 'imported source'], { cwd: root });
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'SOURCE_BASELINE_REQUIRED' });
  });

  test.each([`${['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')}\n<fixture-not-a-real-key>`, `ghp_${'a'.repeat(36)}`])('rejects embedded credentials before source leaves the folder', async secret => {
    const root = await project();
    await put(root, 'src/lib/settings.ts', secret);
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'SOURCE_CREDENTIAL_DETECTED' });
  });

  test.each(['public/client.key', 'public/.npmrc', 'src/.env.local'])('rejects credential file %s within app source instead of silently omitting it', async path => {
    const root = await project();
    await put(root, path, 'sensitive content');
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'SOURCE_CREDENTIAL_DETECTED' });
  });

  test('bounds decoded individual file size', async () => {
    const root = await project();
    await put(root, 'public/large.bin', Buffer.alloc(2 * 1024 * 1024 + 1));
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'SOURCE_FILE_LIMIT' });
  });

  test('bounds aggregate decoded size', async () => {
    const root = await project();
    await Promise.all(Array.from({ length: 11 }, (_, index) => put(root, `public/file-${index}.bin`, Buffer.alloc(2 * 1024 * 1024))));
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'SOURCE_TOTAL_LIMIT' });
  });

  test('bounds snapshot file count', async () => {
    const root = await project();
    await Promise.all(Array.from({ length: 500 }, (_, index) => put(root, `public/file-${index}.txt`, 'a')));
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'SOURCE_FILE_COUNT_LIMIT' });
  });

  test('accepts exactly 500 sorted source files with one reproducible digest', async () => {
    const root = await project();
    const baselineCount = (await buildCliManagedSourceBundle(root)).bundle.files.length;
    await Promise.all(Array.from({ length: 500 - baselineCount }, (_, index) => put(root, `public/file-${index}.txt`, 'a')));
    const first = await buildCliManagedSourceBundle(root);
    const second = await buildCliManagedSourceBundle(root);
    expect(first.bundle.files).toHaveLength(500);
    expect(first).toEqual(second);
    expect(first.bundle.files.map(file => file.path)).toEqual(first.bundle.files.map(file => file.path).sort());
  });

  test.each(['../src/x.ts', 'src/../x.ts', '/src/x.ts', 'src\\x.ts', 'src/.env', 'src/app/api/auth/route.ts', 'src/lib/platform/client.ts', '.github/workflows/build.yml'])('rejects unsupported wire path %s', path => {
    expect(isManagedAppSourcePath(path)).toBe(false);
  });

  test.each(['eai.config.ts', 'eai.runtime.json', 'package.json', 'src/app/page.tsx', 'public/logo.svg'])('accepts governed app path %s', path => {
    expect(isManagedAppSourcePath(path)).toBe(true);
  });
});

describe('explicit source choice', () => {
  test.each(['eai-managed', 'customer-owned'] as const)('preserves an explicit %s source', async source => {
    expect(await chooseManagedDeploySource({ source, format: 'json' }, false)).toBe(source);
  });
  test('requires an explicit source choice even with a repository flag', async () => {
    await expect(chooseManagedDeploySource({ repo: 'customer/app', format: 'json' }, false)).rejects.toMatchObject({ code: 'SOURCE_CHOICE_REQUIRED' });
  });
  test('requires source selection in noninteractive and JSON runs', async () => {
    await expect(chooseManagedDeploySource({ format: 'text' }, false)).rejects.toMatchObject({ code: 'SOURCE_CHOICE_REQUIRED' });
    await expect(chooseManagedDeploySource({ format: 'json' }, true)).rejects.toMatchObject({ code: 'SOURCE_CHOICE_REQUIRED' });
  });
  test('does not accept a client-selected maintained repository', async () => {
    await expect(chooseManagedDeploySource({ source: 'eai-managed', repo: 'customer/app', format: 'text' }, false)).rejects.toMatchObject({ code: 'SOURCE_CHOICE_CONFLICT' });
  });
  test('rejects an unknown source mode', async () => {
    await expect(chooseManagedDeploySource({ source: 'unknown', format: 'text' }, false)).rejects.toMatchObject({ code: 'SOURCE_CHOICE_INVALID' });
  });
  test('presents distinct maintained and customer choices', async () => {
    const prompt = vi.spyOn(inquirer, 'prompt').mockResolvedValue({ source: 'eai-managed' });
    expect(await chooseManagedDeploySource({ format: 'text' }, true)).toBe('eai-managed');
    expect(prompt).toHaveBeenCalledWith([expect.objectContaining({ choices: [expect.objectContaining({ value: 'eai-managed' }), expect.objectContaining({ value: 'customer-owned' })] })]);
  });
});
