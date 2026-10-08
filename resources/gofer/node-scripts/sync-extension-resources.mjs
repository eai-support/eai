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
  ['.claude/skills', 'extension/resources/claude-skills'],
  ['.github/agents', 'extension/resources/github-agents'],
  ['.github/prompts', 'extension/resources/copilot-prompts'],
  ['.github/instructions', 'extension/resources/copilot-instructions'],
  ['.github/skills', 'extension/resources/github-skills'],
  ['.gemini', 'extension/resources/gemini'],
  ['.grok/skills', 'extension/resources/grok-skills'],
  ['.specify/commands', 'extension/resources/specify-commands'],
  ['.specify/config', 'extension/resources/specify-config'],
  ['.specify/contracts', 'extension/resources/contracts'],
  ['.specify/references', 'extension/resources/references'],
  ['.specify/schemas', 'extension/resources/schemas'],
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

async function filesMatch(sourcePath, targetPath) {
  try {
    const [source, target] = await Promise.all([fs.readFile(sourcePath), fs.readFile(targetPath)]);
    if (source.equals(target)) return true;
    if (path.basename(sourcePath) === 'object-type-routing-v1.json') return false;
    if (path.extname(sourcePath) !== '.json') return false;
    return JSON.stringify(JSON.parse(source.toString('utf8'))) === JSON.stringify(JSON.parse(target.toString('utf8')));
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function findSyncDrift(sourcePath, targetPath, relativePath = '') {
  const drift = [];
  const sourceExists = await pathExists(sourcePath);
  const targetExists = await pathExists(targetPath);
  if (!sourceExists || !targetExists) {
    drift.push(relativePath || '.');
    return drift;
  }
  const [sourceEntries, targetEntries] = await Promise.all([
    fs.readdir(sourcePath, { withFileTypes: true }),
    fs.readdir(targetPath, { withFileTypes: true }),
  ]);
  const names = new Set([...sourceEntries, ...targetEntries].map((entry) => entry.name));
  for (const name of [...names].sort()) {
    const sourceEntry = sourceEntries.find((entry) => entry.name === name);
    const targetEntry = targetEntries.find((entry) => entry.name === name);
    const nestedRelativePath = path.join(relativePath, name);
    if (!sourceEntry || !targetEntry || sourceEntry.isDirectory() !== targetEntry.isDirectory()) {
      drift.push(nestedRelativePath);
    } else if (sourceEntry.isDirectory()) {
      drift.push(
        ...(await findSyncDrift(path.join(sourcePath, name), path.join(targetPath, name), nestedRelativePath))
      );
    } else if (!(await filesMatch(path.join(sourcePath, name), path.join(targetPath, name)))) {
      drift.push(nestedRelativePath);
    }
  }
  return drift;
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

export async function check() {
  const drift = [];
  const codexFragmentPath = path.join(REPO_ROOT, '.specify', 'outputs', 'codex-config-fragment.toml');
  const codexConfigPath = path.join(REPO_ROOT, 'codex-config.toml');
  if (!(await filesMatch(codexFragmentPath, codexConfigPath))) drift.push('codex-config.toml');

  for (const [sourceRelativePath, targetRelativePath] of SYNC_PAIRS) {
    const differences = await findSyncDrift(
      path.join(REPO_ROOT, sourceRelativePath),
      path.join(REPO_ROOT, targetRelativePath)
    );
    drift.push(...differences.map((difference) => `${targetRelativePath}/${difference}`));
  }
  return drift.sort();
}

export async function main({ checkOnly = false } = {}) {
  if (checkOnly) {
    const drift = await check();
    if (drift.length > 0) {
      console.error(`extension/resources/ is out of sync:\n${drift.map((item) => `- ${item}`).join('\n')}`);
      return false;
    }
    console.log('✓ extension/resources/ is in sync with canonical sources');
    return true;
  }
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
  return true;
}

if (IS_DIRECT_RUN) {
  const checkOnly = process.argv.slice(2).includes('--check');
  main({ checkOnly }).then((valid) => {
    if (!valid) process.exitCode = 1;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
