import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assessLocalIsolation } from '../../src/lib/local-isolation.js';

const directories: string[] = [];

async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'eai-local-isolation-'));
  directories.push(directory);
  await writeFile(join(directory, 'README.md'), 'test\n');
  execFileSync('git', ['init', '--quiet', directory]);
  return directory;
}

afterEach(async () => {
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

  it('qualifies local Codex only with a repository and sandbox arguments', async () => {
    const report = assessLocalIsolation({
      projectDirectory: await repository(), platform: 'darwin', surfaceIds: ['codex-cli'],
    });
    expect(report.assessments).toEqual([expect.objectContaining({
      surfaceId: 'codex-cli', status: 'ready', localOnly: true,
      requiresGitWorktree: true, requiresOsSandbox: true,
      hostArguments: ['--sandbox', 'workspace-write', '--ask-for-approval', 'never'],
    })]);
  });

  it('does not treat Antigravity sandbox flags as proof without a project binding', async () => {
    const report = assessLocalIsolation({
      projectDirectory: await repository(), platform: 'darwin', surfaceIds: ['antigravity-cli'],
    });
    expect(report.assessments).toEqual([expect.objectContaining({
      status: 'manual-host-setup', hostArguments: ['--sandbox'],
      missing: ['Verified Antigravity project binding'],
    })]);
  });
});
