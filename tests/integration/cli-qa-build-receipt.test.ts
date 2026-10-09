import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const build = require('../../scripts/cli-qa-build-receipt.cjs');
const smoke = require('../../scripts/eai-full-e2e-smoke.cjs');
const qa = require('../../scripts/cli-qa-foundation.cjs');
const roots: string[] = [];
const observedAt = '2026-10-09T06:00:00.000Z';
const now = Date.parse(observedAt);
interface Candidate {
  gitSha: string; binarySha256: string; runtimeSha256: string; runtimeFileCount: number; version: string; dirty: boolean | null;
}
interface CommandResult { status: number | null; stdout: string; stderr: string; error?: Error; signal?: string | null }
interface CommandOptions { cwd: string; timeout?: number; env?: NodeJS.ProcessEnv }
type Execute = (command: string, args: string[], options: CommandOptions) => CommandResult;
const actual: Execute = (command, args, options) => {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', shell: false, maxBuffer: 8 * 1024 * 1024 });
  return { ...result, stdout: result.stdout || '', stderr: result.stderr || '' };
};
function git(root: string, args: string[]): string {
  const result = actual('git', args, { cwd: root, timeout: 10000 });
  if (result.status !== 0) throw new Error('Owned source fixture Git operation failed.');
  return result.stdout.trim();
}
function commit(root: string): string {
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=CLI QA fixture', '-c', 'user.email=cli-qa@example.invalid', '-c', 'core.hooksPath=/dev/null',
    'commit', '--no-gpg-sign', '-qm', 'test: owned build fixture']);
  return git(root, ['rev-parse', 'HEAD']);
}
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'eai-source-build-'))); roots.push(root);
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'resources'));
  writeFileSync(join(root, '.gitignore'), 'dist/\n.private/\n');
  writeFileSync(join(root, 'src/main.js'), "export const value = 'source';\n");
  writeFileSync(join(root, 'resources/contract.txt'), 'owned source/runtime fixture\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'eai-owned-build-fixture', version: '3.19.2',
    scripts: { build: 'node scripts/build.cjs' } }));
  writeFileSync(join(root, 'scripts/build.cjs'), [
    "const fs = require('node:fs');",
    "fs.rmSync('dist', { recursive: true, force: true });",
    "fs.mkdirSync('dist/lib', { recursive: true });",
    "fs.writeFileSync('dist/index.js', fs.readFileSync('src/main.js'));",
    "fs.writeFileSync('dist/lib/provider.js', 'export const fixture = true;\\n');",
  ].join('\n') + '\n');
  git(root, ['init', '-q']); const head = commit(root);
  const cliPath = join(root, 'dist/index.js'), output = join(root, '.private/receipt.json');
  const candidateEvidence = (path: string): Candidate => ({ ...smoke.candidateEvidence(path),
    gitSha: git(root, ['rev-parse', 'HEAD']), dirty: git(root, ['status', '--porcelain', '--untracked-files=all']) !== '' });
  let builds = 0;
  const calls: Array<{ command: string; args: string[]; options: CommandOptions }> = [];
  const execute: Execute = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    if (command === 'npm') {
      builds++;
      const result = actual(process.execPath, ['scripts/build.cjs'], options);
      return result;
    }
    return actual(command, args, options);
  };
  const dependencies = { root, execute, candidateEvidence, now: () => now };
  return { root, head, cliPath, output, options: { cliPath, output }, dependencies, execute, candidateEvidence, calls, builds: () => builds };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('actual source/build/runtime binding with explicitly controlled fixture provenance', () => {
  test('builds missing dist through canonical npm argv and fingerprints every tracked source and runtime file', () => {
    const value = fixture(); expect(existsSync(value.cliPath)).toBe(false);
    // Only this miniature owned package runs npm. The shared CLI dist remains untouched.
    const receipt = build.runBuildReceipt(value.options, { ...value.dependencies, execute: actual });
    expect(receipt).toMatchObject({ schemaVersion: 'eai.cli-source-build.v1', qualification: 'controlled-fixtures', qualified: false,
      status: 'passed', command: ['npm', 'run', 'build'], exitCode: 0, sourceSha: value.head, sourceUnchanged: true,
      sourceFingerprintVersion: 'eai.cli-tracked-source-sha256.v1', sourceFileCount: 5, nodeVersion: process.version, observedAt });
    expect(receipt.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.candidate).toEqual(value.candidateEvidence(value.cliPath));
    expect(receipt.candidate.runtimeFileCount).toBe(4);
    expect(git(value.root, ['status', '--porcelain', '--untracked-files=all'])).toBe('');
    expect(statSync(value.output).mode & 0o777).toBe(0o600); expect(statSync(join(value.root, '.private')).mode & 0o777).toBe(0o700);
    expect(qa.readPrivate(value.output)).toEqual(receipt);
    expect(build.sourceBuildVerified(receipt, receipt.candidate, { now })).toBe(false);
  });
  test('records only a bounded canonical build command and never retains command output or injected secret fields', () => {
    const value = fixture();
    const receipt = build.runBuildReceipt(value.options, { ...value.dependencies,
      candidateEvidence: (path: string) => ({ ...value.candidateEvidence(path), token: 'synthetic-private-marker' }) });
    const call = value.calls.find(row => row.command === 'npm')!;
    expect(call.args).toEqual(['run', 'build']); expect(call.options.cwd).toBe(value.root); expect(call.options.timeout).toBe(300000);
    expect(receipt.candidate).not.toHaveProperty('token'); expect(readFileSync(value.output, 'utf8')).not.toContain('synthetic-private-marker');
    expect(receipt.qualified).toBe(false);
  });
  test('a committed change in any tracked source or non-entry runtime module changes the complete fingerprints', () => {
    const value = fixture(); const first = build.runBuildReceipt(value.options, value.dependencies);
    writeFileSync(join(value.root, 'resources/contract.txt'), 'new owned source/runtime fixture\n'); commit(value.root);
    const second = build.runBuildReceipt(value.options, value.dependencies);
    expect(second.sourceSha256).not.toBe(first.sourceSha256); expect(second.sourceSha).not.toBe(first.sourceSha);
    expect(second.candidate.binarySha256).toBe(first.candidate.binarySha256); expect(second.candidate.runtimeSha256).not.toBe(first.candidate.runtimeSha256);
    expect(build.sourceBuildVerified(second, second.candidate, { now })).toBe(false);
  });
  test.each(['modified', 'untracked', 'staged'])('refuses %s source before build and invalidates prior success evidence', mode => {
    const value = fixture();
    qa.writePrivate(value.output, { schemaVersion: build.SCHEMA, status: 'passed', qualified: true, qualification: 'normal-build' });
    writeFileSync(join(value.root, mode === 'untracked' ? 'src/new.js' : 'src/main.js'), 'changed source\n');
    if (mode === 'staged') git(value.root, ['add', 'src/main.js']);
    expect(() => build.runBuildReceipt(value.options, value.dependencies)).toThrow('SOURCE_DIRTY');
    expect(value.builds()).toBe(0); expect(qa.readPrivate(value.output)).toMatchObject({ qualified: false, status: 'failed', sourceUnchanged: false });
  });
  test.each(['status', 'head'])('unavailable Git %s is unknown and cannot qualify or dispatch build', mode => {
    const value = fixture();
    const execute: Execute = (command, args, options) => command === 'git' && args[0] === (mode === 'status' ? 'status' : 'rev-parse')
      && (mode === 'status' || args.includes('--verify')) ? { status: null, stdout: '', stderr: 'synthetic-private-marker', error: new Error('synthetic-private-marker') }
      : value.execute(command, args, options);
    expect(() => build.runBuildReceipt(value.options, { ...value.dependencies, execute })).toThrow(mode === 'status' ? 'SOURCE_STATUS_UNVERIFIED' : 'SOURCE_HEAD_UNVERIFIED');
    expect(value.builds()).toBe(0); expect(qa.readPrivate(value.output).qualified).toBe(false);
    expect(readFileSync(value.output, 'utf8')).not.toContain('synthetic-private-marker');
  });
  test.each([1, null])('failed or uncertain build exit %s never leaves a successful receipt', status => {
    const value = fixture(); qa.writePrivate(value.output, { schemaVersion: build.SCHEMA, qualified: true, status: 'passed' });
    const execute: Execute = (command, args, options) => command === 'npm'
      ? { status, stdout: 'synthetic-private-marker', stderr: 'synthetic-private-marker' } : value.execute(command, args, options);
    expect(() => build.runBuildReceipt(value.options, { ...value.dependencies, execute })).toThrow('BUILD_FAILED');
    expect(qa.readPrivate(value.output)).toMatchObject({ status: 'failed', qualified: false, sourceUnchanged: false, failureCode: 'BUILD_FAILED', exitCode: status });
    expect(readFileSync(value.output, 'utf8')).not.toContain('synthetic-private-marker');
    expect(existsSync(value.output + '.lease')).toBe(false);
  });
  test.each(['dirty', 'commit'])('source %s during build stops the source/artifact join', mode => {
    const value = fixture();
    const execute: Execute = (command, args, options) => {
      const result = value.execute(command, args, options);
      if (command === 'npm') { writeFileSync(join(value.root, 'src/main.js'), 'changed during build\n'); if (mode === 'commit') commit(value.root); }
      return result;
    };
    expect(() => build.runBuildReceipt(value.options, { ...value.dependencies, execute })).toThrow(mode === 'dirty' ? 'SOURCE_DIRTY' : 'SOURCE_CHANGED_DURING_BUILD');
    expect(value.builds()).toBe(1); expect(qa.readPrivate(value.output)).toMatchObject({ status: 'failed', qualified: false, sourceUnchanged: false });
  });
  test('source mutation while measuring compiled bytes cannot be published as unchanged', () => {
    const value = fixture();
    const candidateEvidence = (path: string) => {
      const result = value.candidateEvidence(path); writeFileSync(join(value.root, 'src/main.js'), 'changed during measurement\n'); commit(value.root); return result;
    };
    expect(() => build.runBuildReceipt(value.options, { ...value.dependencies, candidateEvidence })).toThrow('SOURCE_CHANGED_DURING_MEASUREMENT');
    expect(qa.readPrivate(value.output).qualified).toBe(false);
  });
  test.each(['dirty', 'null', 'wrong-head'])('rejects %s compiled candidate evidence after the build', mode => {
    const value = fixture();
    const candidateEvidence = (path: string) => ({ ...value.candidateEvidence(path),
      ...(mode === 'wrong-head' ? { gitSha: 'a'.repeat(40) } : { dirty: mode === 'dirty' ? true : null }) });
    expect(() => build.runBuildReceipt(value.options, { ...value.dependencies, candidateEvidence })).toThrow('BUILT_CANDIDATE_UNVERIFIED');
    expect(qa.readPrivate(value.output).qualified).toBe(false);
  });
  test.each(['v22.0.0', 'v25.0.0', 'unknown'])('requires the declared Node 24 build baseline (%s)', nodeVersion => {
    const value = fixture(); expect(() => build.runBuildReceipt(value.options, { ...value.dependencies, nodeVersion })).toThrow('NODE_24_REQUIRED');
    expect(value.builds()).toBe(0); expect(qa.readPrivate(value.output).qualified).toBe(false);
  });
});

describe('source receipt boundary and private evidence lifecycle', () => {
  test('wrong entry path is rejected and a prior receipt becomes unqualified', () => {
    const value = fixture(); qa.writePrivate(value.output, { schemaVersion: build.SCHEMA, qualified: true, status: 'passed' });
    expect(() => build.runBuildReceipt({ ...value.options, cliPath: join(value.root, 'src/main.js') }, value.dependencies)).toThrow('EXACT_CLI_PATH_REQUIRED');
    expect(value.builds()).toBe(0); expect(qa.readPrivate(value.output).qualified).toBe(false);
  });
  test('receipt output cannot enter the runtime inventory or dirty tracked source', () => {
    const value = fixture();
    expect(() => build.runBuildReceipt({ ...value.options, output: join(value.root, 'dist/receipt.json') }, value.dependencies)).toThrow('OUTPUT_INSIDE_RUNTIME');
    expect(() => build.runBuildReceipt({ ...value.options, output: join(value.root, 'src/receipt.json') }, value.dependencies)).toThrow('OUTPUT_NOT_IGNORED');
    expect(value.builds()).toBe(0);
  });
  test.each(['file-link', 'parent-link', 'hard-link', 'public-file', 'public-parent'])('refuses %s evidence paths before dispatch', mode => {
    const value = fixture(); qa.writePrivate(value.output, { schemaVersion: build.SCHEMA, qualified: false });
    let output = value.output;
    if (mode === 'file-link') { output = join(value.root, '.private/linked.json'); symlinkSync(value.output, output); }
    if (mode === 'parent-link') { symlinkSync(join(value.root, '.private'), join(value.root, '.linked')); output = join(value.root, '.linked/receipt.json'); }
    if (mode === 'hard-link') linkSync(value.output, join(value.root, '.private/alias.json'));
    if (mode === 'public-file') chmodSync(value.output, 0o644);
    if (mode === 'public-parent') chmodSync(join(value.root, '.private'), 0o755);
    expect(() => build.runBuildReceipt({ ...value.options, output }, value.dependencies)).toThrow(); expect(value.builds()).toBe(0);
  });
  test('tracked links never enter the full source fingerprint even when Git is clean', () => {
    const value = fixture(); symlinkSync('main.js', join(value.root, 'src/link.js')); commit(value.root);
    expect(() => build.runBuildReceipt(value.options, value.dependencies)).toThrow('SOURCE_FILE_UNSUPPORTED'); expect(value.builds()).toBe(0);
  });
  test('tracked source hard links and linked compiled entry points stop before compilation', () => {
    for (const kind of ['source-hard-link', 'entry-link']) {
      const value = fixture(); mkdirSync(join(value.root, '.private'), { mode: 0o700 });
      if (kind === 'source-hard-link') linkSync(join(value.root, 'src/main.js'), join(value.root, '.private/source-alias'));
      else { mkdirSync(join(value.root, 'dist')); symlinkSync(join(value.root, 'src/main.js'), value.cliPath); }
      expect(() => build.runBuildReceipt(value.options, value.dependencies)).toThrow(kind === 'entry-link' ? 'LINKED_PATH' : 'SOURCE_FILE_UNSUPPORTED');
      expect(value.builds()).toBe(0); expect(qa.readPrivate(value.output).qualified).toBe(false);
    }
  });
  test('an existing lease cannot run compilation or remove another runner\'s state', () => {
    const value = fixture(); mkdirSync(join(value.root, '.private'), { mode: 0o700 });
    writeFileSync(value.output + '.lease', 'owned fixture lease', { mode: 0o600 });
    expect(() => build.runBuildReceipt(value.options, value.dependencies)).toThrow('leased'); expect(value.builds()).toBe(0);
    expect(readFileSync(value.output + '.lease', 'utf8')).toBe('owned fixture lease');
  });
  test('unrelated private JSON must never be overwritten as build evidence', () => {
    const value = fixture(); qa.writePrivate(value.output, { schemaVersion: 'unrelated-private-state', value: 'synthetic-private-marker' });
    expect(() => build.runBuildReceipt(value.options, value.dependencies)).toThrow('OUTPUT_NOT_BUILD_RECEIPT');
    expect(qa.readPrivate(value.output).schemaVersion).toBe('unrelated-private-state'); expect(value.builds()).toBe(0);
  });
  test.each([
    [], ['--cli', 'dist/index.js'], ['--cli', '--output', 'dist/index.js', 'receipt.json'],
    ['--cli', 'dist/index.js', '--cli', 'receipt.json'], ['--cli', 'dist/index.js', '--output', '--unknown'],
  ].map(args => ({ args })))('CLI argument rejection cannot trigger a shared build ($args)', ({ args }) => {
    const result = actual(process.execPath, [join(process.cwd(), 'scripts/cli-qa-build-receipt.cjs'), ...args], { cwd: process.cwd(), timeout: 10000 });
    expect(result.status).toBe(1); expect(result.stdout).toBe(''); expect(result.stderr).toContain('EXPLICIT_PATHS_REQUIRED');
  });
});

describe('fresh normal-build receipt validation', () => {
  // This is a DTO validation model only, never written as actual build evidence.
  const candidate: Candidate = { gitSha: 'a'.repeat(40), binarySha256: 'b'.repeat(64), runtimeSha256: 'c'.repeat(64),
    runtimeFileCount: 802, version: '3.19.2', dirty: false };
  const receipt = { schemaVersion: build.SCHEMA, status: 'passed', qualification: 'normal-build', qualified: true,
    sourceSha: candidate.gitSha, sourceSha256: 'd'.repeat(64), sourceFileCount: 900,
    sourceFingerprintVersion: build.SOURCE_FINGERPRINT, sourceUnchanged: true, command: ['npm', 'run', 'build'], exitCode: 0,
    nodeVersion: 'v24.12.0', observedAt, candidate };
  test('matches the complete candidate and inclusive one-hour observation boundary', () => {
    expect(build.sourceBuildVerified(receipt, candidate, { now })).toBe(true);
    expect(build.sourceBuildVerified(receipt, candidate, { now: now + 3600000 })).toBe(true);
    expect(build.sourceBuildVerified(receipt, candidate, { now: now - 60000 })).toBe(true);
    expect(build.sourceBuildVerified(receipt, candidate, { now: now + 3600001 })).toBe(false);
    expect(build.sourceBuildVerified(receipt, candidate, { now: now - 60001 })).toBe(false);
  });
  test.each([
    { qualified: false }, { qualification: 'controlled-fixtures' }, { status: 'failed' }, { sourceUnchanged: false }, { exitCode: 1 },
    { sourceSha: 'e'.repeat(40) }, { sourceSha256: 'unknown' }, { sourceFileCount: 0 }, { sourceFingerprintVersion: 'unversioned' },
    { command: ['npm', 'run', 'build', '--ignore-scripts'] }, { command: 'npm run build' }, { nodeVersion: 'v22.0.0' },
    { nodeVersion: 'v25.0.0' }, { observedAt: 'invalid' }, { observedAt: '2020-01-01' },
    { sourceSha256: ['d'.repeat(64)] }, { nodeVersion: ['v24.12.0'] }, { observedAt: [observedAt] },
  ])('refuses incomplete, controlled or mismatched receipt %j', patch => {
    expect(build.sourceBuildVerified({ ...receipt, ...patch }, candidate, { now })).toBe(false);
  });
  test.each(['gitSha', 'binarySha256', 'runtimeSha256', 'runtimeFileCount', 'version', 'dirty'])('binds exact candidate %s', field => {
    const different = { ...candidate, [field]: field === 'runtimeFileCount' ? 803 : field === 'dirty' ? true : field === 'version' ? '3.19.3' : 'e'.repeat(field === 'gitSha' ? 40 : 64) };
    expect(build.sourceBuildVerified(receipt, different, { now })).toBe(false);
  });
  test.each([null, undefined, true])('unknown or dirty candidate status %s cannot certify', dirty => {
    expect(build.sourceBuildVerified(receipt, { ...candidate, dirty }, { now })).toBe(false);
  });
  test('missing receipt/candidate and non-finite observer time remain unverified', () => {
    expect(build.sourceBuildVerified(null, candidate, { now })).toBe(false); expect(build.sourceBuildVerified(receipt, null, { now })).toBe(false);
    expect(build.sourceBuildVerified(receipt, candidate, { now: Number.NaN })).toBe(false);
    expect(build.sourceBuildVerified(receipt, candidate, { now: BigInt(now) })).toBe(false);
    expect(build.sourceBuildVerified(receipt, { ...candidate, runtimeSha256: [candidate.runtimeSha256] }, { now })).toBe(false);
  });
});
