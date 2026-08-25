import { expect } from 'vitest';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from './setup-dsl.js';
import {
  expectFileContains,
  expectFileExists,
  expectFileNotExists,
} from './assert-dsl.js';

const INTERNAL_GOFER_COMMANDS = [
  '0_gofer_start',
  '0a_problem_validation',
  '1_gofer_research',
  '2_gofer_specify',
  '3_gofer_plan',
  '4_gofer_tasks',
  '5_gofer_implement',
  '6_gofer_validate',
  '7_gofer_save',
  '7a_stakeholder_comms',
  '8_gofer_branding',
  '9_gofer_tests',
  '10_gofer_cloud',
  'gofer_bootstrap_workspace',
  'gofer_check_workspace',
  'gofer_constitution',
  'gofer_diagnose',
  'gofer_eai_first_run',
  'gofer_hydrate',
  'gofer_personality',
  'gofer_plan',
  'gofer_side',
  'gofer_spec_summary',
  'gofer_tdd',
  'gofer_vocabulary',
  'gofer_zoom_out',
] as const;

const PUBLIC_SURFACE_FILES = [
  '.claude/commands/eai.md',
  '.claude/skills/eai/SKILL.md',
  '.agents/skills/eai/SKILL.md',
  '.system/skills/eai/SKILL.md',
  '.github/prompts/eai.prompt.md',
  '.github/skills/eai/SKILL.md',
  '.github/copilot-instructions.md',
  '.gemini/extension.json',
  '.gemini/commands/gofer/eai.md',
  '.gemini/commands/gofer/eai.toml',
  '.gemini/commands/gofer/manifest.json',
  '.grok/skills/eai/SKILL.md',
  '.vscode/settings.json',
] as const;

const STALE_VISIBLE_SURFACE_FILES = [
  '.claude/commands/gofer.md',
  '.claude/commands/0_gofer_start.md',
  '.claude/commands/1_gofer_research.md',
  '.claude/skills/eai-gofer/SKILL.md',
  '.claude/skills/0_gofer_start/SKILL.md',
  '.agents/skills/gofer/SKILL.md',
  '.agents/skills/0_gofer_start/SKILL.md',
  '.agents/skills/1_gofer_research/SKILL.md',
  '.system/skills/gofer/SKILL.md',
  '.system/skills/0_gofer_start/SKILL.md',
  '.system/skills/1_gofer_research/SKILL.md',
  '.github/prompts/gofer.prompt.md',
  '.github/prompts/0_gofer_start.prompt.md',
  '.github/prompts/1_gofer_research.prompt.md',
  '.github/skills/eai-gofer/SKILL.md',
  '.github/skills/0-gofer-start/SKILL.md',
  '.github/skills/1-gofer-research/SKILL.md',
  '.gemini/commands/gofer/gofer.md',
  '.gemini/commands/gofer/gofer.toml',
  '.gemini/commands/gofer/0_gofer_start.md',
  '.gemini/commands/gofer/0_gofer_start.toml',
  '.gemini/commands/gofer/1_gofer_research.md',
  '.gemini/commands/gofer/1_gofer_research.toml',
  '.grok/skills/gofer/SKILL.md',
  '.grok/skills/0_gofer_start/SKILL.md',
] as const;

function workspacePath(root: string, relativePath: string): string {
  return root ? join(root, relativePath) : relativePath;
}

async function expectDirectoryOnlyContains(
  ctx: TestContext,
  root: string,
  relativeDirectory: string,
  expectedEntries: readonly string[],
): Promise<void> {
  const fullDirectory = join(ctx.workingDir, workspacePath(root, relativeDirectory));
  const actual = (await readdir(fullDirectory)).sort();
  expect(actual).toEqual([...expectedEntries].sort());
}

export async function expectGoferSurfaceContract(
  ctx: TestContext,
  root = '',
  options: { readonly checkPublicGuidance?: boolean } = {},
): Promise<void> {
  for (const relativePath of PUBLIC_SURFACE_FILES) {
    await expectFileExists(ctx, workspacePath(root, relativePath));
  }

  await expectDirectoryOnlyContains(ctx, root, '.claude/commands', ['eai.md']);
  await expectDirectoryOnlyContains(ctx, root, '.github/prompts', ['eai.prompt.md']);
  await expectDirectoryOnlyContains(ctx, root, '.gemini/commands/gofer', [
    'eai.md',
    'eai.toml',
    'manifest.json',
  ]);

  for (const relativePath of STALE_VISIBLE_SURFACE_FILES) {
    await expectFileNotExists(ctx, workspacePath(root, relativePath));
  }

  for (const command of INTERNAL_GOFER_COMMANDS) {
    await expectFileExists(ctx, workspacePath(root, `.specify/commands/${command}.md`));
  }

  if (options.checkPublicGuidance ?? true) {
    await expectFileContains(
      ctx,
      workspacePath(root, '.claude/skills/eai/SKILL.md'),
      'Use this as the single user-facing Gofer command',
    );
    await expectFileContains(
      ctx,
      workspacePath(root, '.agents/skills/eai/SKILL.md'),
      'Host: Codex',
    );
    await expectFileContains(
      ctx,
      workspacePath(root, '.github/skills/eai/SKILL.md'),
      'canonicalCommand: eai',
    );
    await expectFileContains(
      ctx,
      workspacePath(root, '.grok/skills/eai/SKILL.md'),
      'Host: Grok Build',
    );
  }
  await expectFileContains(
    ctx,
    workspacePath(root, '.gemini/commands/gofer/manifest.json'),
    '"eai"',
  );
}
