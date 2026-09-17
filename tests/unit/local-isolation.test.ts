import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessLocalIsolation } from '../../src/lib/local-isolation.js';

const directories: string[] = [];

async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'eai-local-isolation-'));
  directories.push(directory);
  await writeFile(join(directory, 'README.md'), 'test\n');
  execFileSync('git', ['init', '--quiet', directory]);
  return directory;
}

async function dedicatedWorktree(): Promise<string> {
  const directory = await repository();
  execFileSync('git', ['-C', directory, 'add', 'README.md']);
  execFileSync('git', ['-C', directory, '-c', 'user.name=Isolation Test', '-c', 'user.email=isolation@example.invalid', 'commit', '--quiet', '-m', 'test']);
  const worktree = join(directory, 'task');
  execFileSync('git', ['-C', directory, 'worktree', 'add', '--quiet', '--detach', worktree]);
  return worktree;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('local isolation contract', () => {
  it('requires a Git worktree boundary before a host is ready', () => {
    const report = assessLocalIsolation({
      projectDirectory: tmpdir(), platform: 'darwin', surfaceIds: ['codex-cli'],
    });
    expect(report).toMatchObject({
      contractVersion: 'eai.local-isolation/v1', gitRepository: false, cloudExecution: 'prohibited',
      assessments: [{ surfaceId: 'codex-cli', status: 'missing-prerequisite', missing: ['Git repository'] }],
    });
  });

  it('does not qualify an ordinary repository checkout', async () => {
    const report = assessLocalIsolation({
      projectDirectory: await repository(), platform: 'darwin', surfaceIds: ['codex-cli'],
    });
    expect(report).toMatchObject({
      gitRepository: true,
      assessments: [{ status: 'missing-prerequisite', missing: ['Dedicated Git worktree'] }],
    });
  });

  it('does not qualify Codex from worktree and sandbox arguments alone', async () => {
    const report = assessLocalIsolation({
      projectDirectory: await dedicatedWorktree(), platform: 'linux', surfaceIds: ['codex-cli'],
    });
    expect(report.assessments).toEqual([expect.objectContaining({
      surfaceId: 'codex-cli', status: 'manual-host-setup', localOnly: true,
      requiresGitWorktree: true, requiresOsSandbox: true,
      hostArguments: ['--sandbox', 'workspace-write', '--ask-for-approval', 'never'],
      missing: ['Verified native Codex sandbox enforcement'],
    })]);
  });

  it('accepts a project directory below a dedicated worktree root', async () => {
    const worktree = await dedicatedWorktree();
    const projectDirectory = join(worktree, 'src');
    await mkdir(projectDirectory);
    const report = assessLocalIsolation({ projectDirectory, platform: 'linux', surfaceIds: ['codex-cli'] });
    expect(report.assessments[0]).toMatchObject({
      status: 'manual-host-setup', missing: ['Verified native Codex sandbox enforcement'],
    });
  });

  it('does not report ready on an unsupported Node platform', async () => {
    const report = assessLocalIsolation({
      projectDirectory: await dedicatedWorktree(), platform: 'freebsd', surfaceIds: ['codex-cli', 'grok-cli'],
    });
    expect(report.assessments).toEqual([
      expect.objectContaining({ status: 'unsupported', missing: ['Supported OS sandbox contract'] }),
      expect.objectContaining({ status: 'unsupported', missing: ['Supported OS sandbox contract'] }),
    ]);
  });

  it.skipIf(process.platform === 'win32')('does not trust helper version probes on Linux', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'eai-local-sandbox-'));
    directories.push(directory);
    const bwrap = join(directory, 'bwrap');
    await writeFile(bwrap, '#!/bin/sh\nexit 1\n');
    await chmod(bwrap, 0o755);
    vi.stubEnv('PATH', `${directory}${delimiter}${process.env.PATH ?? ''}`);
    const report = assessLocalIsolation({
      projectDirectory: await dedicatedWorktree(), platform: 'linux', surfaceIds: ['codex-cli'],
    });
    expect(report.assessments[0]).toMatchObject({
      status: 'manual-host-setup', missing: ['Verified native Codex sandbox enforcement'],
    });
  });

  it.skipIf(process.platform === 'win32')('does not trust PATH-supplied helper lookalikes as isolation proof', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'eai-local-sandbox-'));
    directories.push(directory);
    const bwrap = join(directory, 'bwrap');
    const socat = join(directory, 'socat');
    await writeFile(bwrap, '#!/bin/sh\n[ "$1" = "--version" ]\n');
    await writeFile(socat, '#!/bin/sh\n[ "$1" = "-V" ]\n');
    await chmod(bwrap, 0o755);
    await chmod(socat, 0o755);
    vi.stubEnv('PATH', `${directory}${delimiter}${process.env.PATH ?? ''}`);
    const report = assessLocalIsolation({
      projectDirectory: await dedicatedWorktree(), platform: 'linux', surfaceIds: ['codex-cli'],
    });
    expect(report.assessments[0]).toMatchObject({
      status: 'manual-host-setup', missing: ['Verified native Codex sandbox enforcement'],
    });
  });

  it.skipIf(process.platform !== 'darwin')('rejects an unsigned Codex lookalike before the native probe', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'eai-codex-lookalike-'));
    directories.push(directory);
    const codex = join(directory, 'codex');
    await writeFile(codex, '#!/bin/sh\nexit 0\n');
    await chmod(codex, 0o755);
    vi.stubEnv('PATH', `${directory}${delimiter}${process.env.PATH ?? ''}`);
    const report = assessLocalIsolation({
      projectDirectory: await dedicatedWorktree(), platform: 'darwin', surfaceIds: ['codex-cli'],
    });
    expect(report.assessments[0]).toMatchObject({
      status: 'manual-host-setup', missing: ['Verified native Codex sandbox enforcement'],
    });
  });

  it('keeps native Windows and Grok fail closed without an enforcement probe', async () => {
    const report = assessLocalIsolation({
      projectDirectory: await dedicatedWorktree(), platform: 'win32', surfaceIds: ['codex-cli', 'grok-cli'],
    });
    expect(report.assessments.map((assessment) => assessment.status)).toEqual([
      'manual-host-setup', 'manual-host-setup',
    ]);
  });

  it('does not treat Antigravity sandbox flags as proof without a project binding', async () => {
    const report = assessLocalIsolation({
      projectDirectory: await dedicatedWorktree(), platform: 'darwin', surfaceIds: ['antigravity-cli'],
    });
    expect(report.assessments).toEqual([expect.objectContaining({
      status: 'manual-host-setup', hostArguments: ['--sandbox'],
      missing: ['Verified Antigravity project binding'],
    })]);
  });
});
