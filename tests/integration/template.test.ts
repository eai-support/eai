import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import { workingDirectoryIs } from '../helpers/setup-dsl.js';
import { runCommand } from '../helpers/action-dsl.js';
import { expectCommandSucceeded, expectDisplayedMessage } from '../helpers/assert-dsl.js';

const execFileAsync = promisify(execFile);

async function writeFileRecursive(root: string, relativePath: string, contents: string): Promise<void> {
  const absolutePath = join(root, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, 'utf-8');
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'EAI CLI Tests',
      GIT_AUTHOR_EMAIL: 'tests@example.com',
      GIT_COMMITTER_NAME: 'EAI CLI Tests',
      GIT_COMMITTER_EMAIL: 'tests@example.com',
    },
  });

  return stdout.trim();
}

async function createTemplateRepo(repoRoot: string): Promise<{ initialCommit: string; latestCommit: string }> {
  await mkdir(repoRoot, { recursive: true });
  await writeFileRecursive(repoRoot, 'package.json', JSON.stringify({ name: '@eai-tools/vertical-template-fixture', version: '0.1.0' }, null, 2) + '\n');
  await writeFileRecursive(repoRoot, 'src/components/Hero.tsx', 'export function Hero() { return <div>Hero v1</div>; }\n');
  await writeFileRecursive(repoRoot, 'src/app/page.tsx', 'export default function Page() { return <Hero />; }\n');

  await git(repoRoot, ['init']);
  await git(repoRoot, ['add', '.']);
  await git(repoRoot, ['commit', '-m', 'initial template']);
  const initialCommit = await git(repoRoot, ['rev-parse', 'HEAD']);

  await writeFileRecursive(repoRoot, 'src/components/Hero.tsx', 'export function Hero() { return <div>Hero v2</div>; }\n');
  await writeFileRecursive(repoRoot, 'src/components/Badge.tsx', 'export function Badge() { return <span>New UI</span>; }\n');
  await git(repoRoot, ['add', '.']);
  await git(repoRoot, ['commit', '-m', 'template ui refresh']);
  const latestCommit = await git(repoRoot, ['rev-parse', 'HEAD']);

  return { initialCommit, latestCommit };
}

describe('eai template check', () => {
  let env: TestEnvironment;
  let ctx: TestContext;

  beforeEach(async () => {
    env = await createTestEnvironment();
    ctx = {
      workingDir: env.dir,
      mockAPI: {} as TestContext['mockAPI'],
      env: {},
      prompts: [],
    };

    workingDirectoryIs(ctx, env.dir);
  });

  afterEach(async () => {
    await env.cleanup();
  });

  test('previews template and UI drift without writing files', async () => {
    const templateRepo = join(tmpdir(), `eai-template-source-${Date.now()}`);
    const { initialCommit } = await createTemplateRepo(templateRepo);

    await writeFileRecursive(env.dir, 'package.json', JSON.stringify({
      name: '@eai-tools/template-check-fixture',
      version: '0.0.1',
      dependencies: {
        '@eai-tools/core': '1.0.0',
      },
    }, null, 2) + '\n');
    await writeFileRecursive(env.dir, 'src/eai.config/object-types.ts', 'export const objectTypes = {};\n');
    await writeFileRecursive(env.dir, 'src/components/Hero.tsx', 'export function Hero() { return <div>Hero v1</div>; }\n');
    await writeFileRecursive(env.dir, '.eai-manifest.json', JSON.stringify({
      schemaVersion: 1,
      template: {
        repo: templateRepo,
        commit: initialCommit,
        displaySource: `${templateRepo}@${initialCommit.slice(0, 7)}`,
      },
    }, null, 2) + '\n');

    const result = await runCommand(ctx, 'eai template check');

    expectCommandSucceeded(result);
    expectDisplayedMessage(result, 'Template Check');
    expectDisplayedMessage(result, 'Current comparison source');
    expectDisplayedMessage(result, 'src/components/Hero.tsx');
    expectDisplayedMessage(result, 'src/components/Badge.tsx');
    expectDisplayedMessage(result, 'Files needing manual review');
    expectDisplayedMessage(result, 'UI files in review set');
  });
});
