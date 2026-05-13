#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const IS_DIRECT_RUN = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

const SYNC_PAIRS = [
  ['.claude/commands', 'extension/resources/claude-commands'],
  ['.claude/agents', 'extension/resources/claude-agents'],
  ['.github/prompts', 'extension/resources/copilot-prompts'],
  ['.github/instructions', 'extension/resources/copilot-instructions'],
  ['.gemini', 'extension/resources/gemini'],
  ['.specify/commands', 'extension/resources/specify-commands'],
  ['.specify/scripts/bash', 'extension/resources/bash-scripts'],
  ['.specify/scripts/powershell', 'extension/resources/powershell-scripts'],
  ['.specify/scripts/node', 'extension/resources/node-scripts'],
  ['.specify/scripts/hooks', 'extension/resources/hook-scripts'],
  ['.specify/templates', 'extension/resources/templates'],
];

function isNodeErrorWithCode(error) {
  return typeof error === 'object' && error !== null && 'code' in error;
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function copyFileWithMode(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  const sourceStat = await fs.stat(sourcePath);
  await fs.chmod(targetPath, sourceStat.mode);
}

async function syncDirectory(sourcePath, targetPath) {
  if (!(await pathExists(sourcePath))) {
    console.log(`i skip: ${sourcePath} does not exist`);
    return;
  }

  await fs.mkdir(targetPath, { recursive: true });

  const sourceEntries = await fs.readdir(sourcePath, { withFileTypes: true });
  const sourceNames = new Set(sourceEntries.map((entry) => entry.name));

  if (await pathExists(targetPath)) {
    const targetEntries = await fs.readdir(targetPath, { withFileTypes: true });
    await Promise.all(
      targetEntries
        .filter((entry) => !sourceNames.has(entry.name))
        .map((entry) =>
          fs.rm(path.join(targetPath, entry.name), { recursive: true, force: true })
        )
    );
  }

  for (const entry of sourceEntries) {
    const sourceEntryPath = path.join(sourcePath, entry.name);
    const targetEntryPath = path.join(targetPath, entry.name);

    if (entry.isDirectory()) {
      await syncDirectory(sourceEntryPath, targetEntryPath);
      continue;
    }

    await copyFileWithMode(sourceEntryPath, targetEntryPath);
  }
}

export async function main() {
  const codexFragmentPath = path.join(REPO_ROOT, '.specify', 'outputs', 'codex-config-fragment.toml');
  const codexConfigPath = path.join(REPO_ROOT, 'codex-config.toml');
  await copyFileWithMode(codexFragmentPath, codexConfigPath);

  console.log('i Syncing canonical sources into extension/resources/ ...');
  for (const [sourceRelativePath, targetRelativePath] of SYNC_PAIRS) {
    await syncDirectory(
      path.join(REPO_ROOT, sourceRelativePath),
      path.join(REPO_ROOT, targetRelativePath)
    );
    console.log(`✓ synced ${sourceRelativePath} → ${targetRelativePath}`);
  }

  console.log('✓ extension/resources/ is in sync with canonical sources');
}

if (IS_DIRECT_RUN) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
