import { afterEach, describe, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, link, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import inquirer from 'inquirer';
import * as output from '../../src/lib/output.js';
import { createManagedSourceValidateCommand, SOURCE_VALIDATION_SCHEMA } from '../../src/commands/eai-managed-source-validate.js';
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
  process.exitCode = 0;
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('read-only managed source validation command', () => {
  test('checks edited business source and app-owned tests without emitting content or writing a receipt', async () => {
    const root = await project();
    const business = 'private business implementation';
    await put(root, 'src/app/page.tsx', business);
    await put(root, 'src/app/page.test.tsx', 'app business behavior test');
    const log = vi.spyOn(output, 'json').mockImplementation(() => undefined);
    await createManagedSourceValidateCommand().parseAsync(['--project-dir', root, '--format', 'json'], { from: 'user' });
    const result = log.mock.calls[0][0];
    expect(result).toEqual({ schemaVersion: SOURCE_VALIDATION_SCHEMA, sourceMode: 'eai-cli-generated', status: 'passed', templateCommitSha: templateCommit, fileCount: 9, totalBytes: expect.any(Number) });
    expect(JSON.stringify(result)).not.toContain(business);
    expect(JSON.stringify(result)).not.toContain(Buffer.from(business).toString('base64'));
    await expect(readFile(join(root, '.eai/cli-managed-source-receipt.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(process.exitCode ?? 0).toBe(0);
  });

  test.each(['Dockerfile', 'src/auth.ts', '.github/workflows/eai-app.yml'])('reports protected deployment edit %s before publication', async path => {
    const root = await project();
    await put(root, path, 'unsupported platform runner edit');
    const log = vi.spyOn(output, 'json').mockImplementation(() => undefined);
    await createManagedSourceValidateCommand().parseAsync(['--project-dir', root, '--format', 'json'], { from: 'user' });
    expect(log.mock.calls[0][0]).toMatchObject({ schemaVersion: SOURCE_VALIDATION_SCHEMA, status: 'failed', error: { code: 'SOURCE_SCOPE_UNSUPPORTED', message: expect.stringContaining(path) } });
    expect(process.exitCode).toBe(1);
    expect(await readFile(join(root, path), 'utf8')).toBe('unsupported platform runner edit');
    await expect(readFile(join(root, '.eai/cli-managed-source-receipt.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('rejects unsupported output formats before inspecting source', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await createManagedSourceValidateCommand().parseAsync(['--project-dir', '/does-not-exist', '--format', 'yaml'], { from: 'user' });
    expect(String(error.mock.calls[0][0])).toContain('FORMAT_INVALID');
    expect(process.exitCode).toBe(1);
  });

  test('does not expose malformed manifest contents through unexpected parser failures', async () => {
    const root = await project();
    const privateValue = 'private-invalid-manifest-content';
    await put(root, '.eai-manifest.json', `{"privateValue":"${privateValue}`);
    const log = vi.spyOn(output, 'json').mockImplementation(() => undefined);
    await createManagedSourceValidateCommand().parseAsync(['--project-dir', root, '--format', 'json'], { from: 'user' });
    const result = log.mock.calls[0][0];
    expect(result).toMatchObject({ status: 'failed', error: { code: 'SOURCE_VALIDATION_FAILED' } });
    expect(JSON.stringify(result)).not.toContain(privateValue);
    expect(process.exitCode).toBe(1);
    await expect(readFile(join(root, '.eai/cli-managed-source-receipt.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function put(root: string, path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cli-managed-source-'));
  cleanup.push(root);
  for (const [path, content] of Object.entries({
    '.eai-manifest.json': JSON.stringify({ template: { repo: 'https://github.com/eai-support/eai-app-template.git', commit: templateCommit } }),
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
    expect(paths).toEqual(['.gitignore', 'README.md', 'eai.config.ts', 'eai.runtime.json', 'package.json', 'public/ignored.png', 'public/scaffold.svg', 'src/app/page.tsx', 'src/eai.config/default.ts', 'src/types/order.ts']);
    const image = first.bundle.files.find(file => file.path === 'public/ignored.png')!;
    expect(image).toEqual({ path: 'public/ignored.png', type: 'file', mode: '100644', size: binary.length, sha256: hash(binary), contentBase64: binary.toString('base64') });
    expect(first.totalBytes).toBe(first.bundle.files.reduce((total, file) => total + file.size, 0));
    expect(first.bundle.configHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.bundle.bundleSha256).toBe(hash(JSON.stringify([templateCommit, first.bundle.configHash, first.bundle.files.map(file => [file.path, file.size, file.sha256, file.mode])])));
  });

  test('expresses deleted app files by absence from the complete snapshot', async () => {
    const root = await project();
    await rm(join(root, 'public/scaffold.svg'));
    expect((await buildCliManagedSourceBundle(root)).bundle.files.map(file => file.path)).not.toContain('public/scaffold.svg');
  });

  test('excludes generated editor, Gofer and build metadata while preserving runtime source', async () => {
    const root = await project();
    const before = await buildCliManagedSourceBundle(root);
    for (const path of ['.vscode/settings.json', '.github/skills/eai/SKILL.md', '.husky/_/h', '.last_package_hash', 'AGENTS.md', 'next-env.d.ts', 'tsconfig.tsbuildinfo']) await put(root, path, 'local tooling output');
    expect(await buildCliManagedSourceBundle(root)).toEqual(before);
  });

  test('writes recomputable local evidence without embedding source bytes', async () => {
    const root = await project();
    const { bundle, totalBytes } = await buildCliManagedSourceBundle(root);
    const receipt = JSON.parse(await readFile(await writeCliManagedSourceReceipt(root, bundle), 'utf8'));
    expect(receipt).toEqual({
      schemaVersion: 'eai.cli_managed_source_local_receipt.v1', sourceMode: 'eai-cli-generated',
      templateCommitSha: templateCommit, bundleSha256: bundle.bundleSha256, configHash: bundle.configHash, totalBytes,
      files: bundle.files.map(({ path, size, sha256, mode }) => ({ path, size, sha256, mode })),
    });
    expect(receipt.bundleSha256).toBe(hash(JSON.stringify([
      receipt.templateCommitSha, receipt.configHash,
      receipt.files.map((file: { path: string; size: number; sha256: string; mode: string }) => [file.path, file.size, file.sha256, file.mode]),
    ])));
    expect((await buildCliManagedSourceBundle(root)).bundle).toEqual(bundle);
  });

  test('writes compatible legacy evidence without inventing executable modes', async () => {
    const root = await project();
    const { bundle } = await buildCliManagedSourceBundle(root);
    const files = bundle.files.map(({ mode: _mode, ...file }) => file);
    const legacy = { ...bundle, files, bundleSha256: hash(JSON.stringify([
      bundle.templateCommitSha, bundle.configHash, files.map(file => [file.path, file.size, file.sha256]),
    ])) };
    const receipt = JSON.parse(await readFile(await writeCliManagedSourceReceipt(root, legacy), 'utf8'));
    expect(receipt.files.every((file: Record<string, unknown>) => !Object.hasOwn(file, 'mode'))).toBe(true);
    expect(receipt.bundleSha256).toBe(hash(JSON.stringify([
      receipt.templateCommitSha, receipt.configHash,
      receipt.files.map((file: { path: string; size: number; sha256: string }) => [file.path, file.size, file.sha256]),
    ])));
  });

  test('refuses to write local evidence through a linked directory', async () => {
    const root = await project();
    const { bundle } = await buildCliManagedSourceBundle(root);
    const outside = await mkdtemp(join(tmpdir(), 'cli-receipt-outside-'));
    cleanup.push(outside);
    await symlink(outside, join(root, '.eai'), 'dir');
    await expect(writeCliManagedSourceReceipt(root, bundle)).rejects.toMatchObject({ code: 'SOURCE_RECEIPT_PATH_INVALID' });
  });

  test.each(['src/auth.ts', 'src/eai.config/register.ts', '.github/workflows/eai-app.yml', 'Dockerfile'])('fails with actionable unsupported deployment changes for %s', async path => {
    const root = await project();
    await put(root, path, 'changed local bytes');
    await expect(buildCliManagedSourceBundle(root)).rejects.toThrow(path);
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'SOURCE_SCOPE_UNSUPPORTED' });
  });

  test('uploads the complete authored app outside NCB roots without changing local files', async () => {
    const root = await project();
    const authored = {
      'run.sh': '#!/bin/sh\nnode server/main.js\n',
      'run.ps1': 'node server/main.js\n',
      'tests/cross-platform-lifecycle.test.mjs': 'authored lifecycle test',
      'backend/orders.py': 'authored backend implementation',
      'server/main.js': 'authored server implementation',
      'scripts/build.sh': 'authored build command',
      'docs/api.md': 'authored API documentation',
      'README.md': 'authored project documentation',
      'custom-ignored.ts': 'authored ignored business source',
      '.dockerignore': 'node_modules\n',
      '.husky/pre-commit': 'authored local check',
    };
    for (const [path, bytes] of Object.entries(authored)) await put(root, path, bytes);
    const { bundle } = await buildCliManagedSourceBundle(root);
    for (const [path, bytes] of Object.entries(authored)) {
      const uploaded = bundle.files.find(file => file.path === path);
      expect(uploaded).toMatchObject({ sha256: hash(bytes), size: Buffer.byteLength(bytes), contentBase64: Buffer.from(bytes).toString('base64') });
      expect(await readFile(join(root, path), 'utf8')).toBe(bytes);
    }
    await rm(join(root, 'backend/orders.py'));
    expect((await buildCliManagedSourceBundle(root)).bundle.files.map(file => file.path)).not.toContain('backend/orders.py');
  });

  test('binds executable app script permissions into the source digest on every OS', async () => {
    const root = await project();
    await put(root, 'scripts/build.sh', '#!/bin/sh\nprintf build\n');
    await chmod(join(root, 'scripts/build.sh'), 0o644);
    await exec('git', ['add', 'scripts/build.sh'], { cwd: root });
    await exec('git', ['update-index', '--chmod=-x', 'scripts/build.sh'], { cwd: root });
    const regular = await buildCliManagedSourceBundle(root);
    await chmod(join(root, 'scripts/build.sh'), 0o755);
    await exec('git', ['update-index', '--chmod=+x', 'scripts/build.sh'], { cwd: root });
    const executable = await buildCliManagedSourceBundle(root);
    const before = regular.bundle.files.find(file => file.path === 'scripts/build.sh')!;
    const after = executable.bundle.files.find(file => file.path === 'scripts/build.sh')!;
    expect(before.mode).toBe('100644');
    expect(after.mode).toBe('100755');
    expect(after.sha256).toBe(before.sha256);
    expect(after.contentBase64).toBe(before.contentBase64);
    expect(executable.bundle.bundleSha256).not.toBe(regular.bundle.bundleSha256);
  });

  test.each(['package.json', 'eai.config.ts', 'eai.runtime.json'])('refuses removed root config %s because the publisher would retain its template default', async path => {
    const root = await project();
    await rm(join(root, path));
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'SOURCE_SCOPE_UNSUPPORTED' });
  });

  test('rejects an authored file hard-linked outside the project', async () => {
    const root = await project();
    const outside = await mkdtemp(join(tmpdir(), 'managed-source-hardlink-')); cleanup.push(outside);
    await writeFile(join(outside, 'outside.ts'), 'external file');
    await link(join(outside, 'outside.ts'), join(root, 'src/app/linked.ts'));
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'SOURCE_SYMLINK_UNSUPPORTED' });
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

  test('accepts an explicit committed template migration in the same scaffold history', async () => {
    const root = await project();
    const nextCommit = 'b'.repeat(40);
    const nextRepo = 'https://github.com/eai-generated-apps/eai-3503-local-e2e-template.git';
    await put(root, '.eai-manifest.json', JSON.stringify({ template: { repo: nextRepo, commit: nextCommit } }));
    await exec('git', ['add', '--', '.eai-manifest.json'], { cwd: root });
    await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Migrate reviewed template', '-m', `EAI-Template-Migration-From: ${templateCommit}\nEAI-Template-Migration-To: ${nextCommit}\nEAI-Template-Migration-Repository: ${nextRepo}`], { cwd: root });
    const { bundle } = await buildCliManagedSourceBundle(root);
    expect(bundle.templateCommitSha).toBe(nextCommit);
    await put(root, 'src/app/page.tsx', 'export default function Page() { return "edited"; }');
    expect((await buildCliManagedSourceBundle(root)).bundle.templateCommitSha).toBe(nextCommit);
  });

  test('rejects a changed pin without an exact committed migration trailer', async () => {
    const root = await project();
    await put(root, '.eai-manifest.json', JSON.stringify({ template: { repo: 'https://github.com/eai-generated-apps/other.git', commit: 'b'.repeat(40) } }));
    await exec('git', ['add', '--', '.eai-manifest.json'], { cwd: root });
    await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Change template without verified migration'], { cwd: root });
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'TEMPLATE_PIN_CHANGED' });
  });

  test('requires every committed template migration to chain from the prior pin and repository', async () => {
    const root = await project();
    const firstCommit = 'b'.repeat(40);
    const secondCommit = 'c'.repeat(40);
    const firstRepo = 'https://github.com/eai-generated-apps/first.git';
    const secondRepo = 'https://github.com/eai-generated-apps/second.git';
    await put(root, '.eai-manifest.json', JSON.stringify({ template: { repo: firstRepo, commit: firstCommit } }));
    await exec('git', ['add', '--', '.eai-manifest.json'], { cwd: root });
    await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Migrate reviewed template', '-m', `EAI-Template-Migration-From: ${templateCommit}\nEAI-Template-Migration-To: ${firstCommit}\nEAI-Template-Migration-Repository: ${firstRepo}`], { cwd: root });
    await put(root, '.eai-manifest.json', JSON.stringify({ template: { repo: secondRepo, commit: secondCommit } }));
    await exec('git', ['add', '--', '.eai-manifest.json'], { cwd: root });
    await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Migrate reviewed template', '-m', `EAI-Template-Migration-From: ${firstCommit}\nEAI-Template-Migration-To: ${secondCommit}\nEAI-Template-Migration-Repository: ${secondRepo}`], { cwd: root });
    expect((await buildCliManagedSourceBundle(root)).bundle.templateCommitSha).toBe(secondCommit);
    await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--amend', '--quiet', '-m', 'Migrate reviewed template', '-m', `EAI-Template-Migration-From: ${templateCommit}\nEAI-Template-Migration-To: ${secondCommit}\nEAI-Template-Migration-Repository: ${secondRepo}`], { cwd: root });
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'TEMPLATE_PIN_CHANGED' });
  });

  test('rejects an uncommitted edit after a verified template migration', async () => {
    const root = await project();
    const nextCommit = 'b'.repeat(40);
    const nextRepo = 'https://github.com/eai-generated-apps/approved.git';
    await put(root, '.eai-manifest.json', JSON.stringify({ template: { repo: nextRepo, commit: nextCommit } }));
    await exec('git', ['add', '--', '.eai-manifest.json'], { cwd: root });
    await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Migrate reviewed template', '-m', `EAI-Template-Migration-From: ${templateCommit}\nEAI-Template-Migration-To: ${nextCommit}\nEAI-Template-Migration-Repository: ${nextRepo}`], { cwd: root });
    await put(root, '.eai-manifest.json', JSON.stringify({ template: { repo: nextRepo, commit: 'c'.repeat(40) } }));
    await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: 'TEMPLATE_PIN_CHANGED' });
  });

  test('rejects a template migration commit that also changes app source', async () => {
    const root = await project();
    const nextCommit = 'b'.repeat(40);
    const nextRepo = 'https://github.com/eai-generated-apps/approved.git';
    await put(root, '.eai-manifest.json', JSON.stringify({ template: { repo: nextRepo, commit: nextCommit } }));
    await put(root, 'src/app/page.tsx', 'export default function Page() { return "mixed"; }');
    await exec('git', ['add', '--', '.eai-manifest.json', 'src/app/page.tsx'], { cwd: root });
    await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Migrate reviewed template', '-m', `EAI-Template-Migration-From: ${templateCommit}\nEAI-Template-Migration-To: ${nextCommit}\nEAI-Template-Migration-Repository: ${nextRepo}`], { cwd: root });
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

  test.each(['../src/x.ts', 'src/../x.ts', '/src/x.ts', 'src\\x.ts', 'src/.env', 'backend/.npmrc', 'server/private.key', 'C:/app.js', 'server/main.js:secret', 'src/app/api/auth/route.ts', 'src/lib/platform/client.ts', '.github/workflows/build.yml', 'Dockerfile', '.eai/operation.json', 'node_modules/pkg.js'])('rejects unsupported wire path %s', path => {
    expect(isManagedAppSourcePath(path)).toBe(false);
  });

  test.each(['eai.config.ts', 'eai.runtime.json', 'package.json', 'src/app/page.tsx', 'public/logo.svg', 'run.sh', 'run.ps1', 'tests/cross-platform-lifecycle.test.mjs', 'backend/orders.py', 'server/main.js', 'scripts/build.sh', 'README.md', '.gitignore', '.dockerignore'])('accepts authored app path %s', path => {
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
