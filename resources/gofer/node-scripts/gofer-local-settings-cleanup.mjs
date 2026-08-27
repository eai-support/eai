#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STALE_GOFER_STEMS = [
  '0_business_scenario',
  '0a_problem_validation',
  '0_gofer_start',
  '1_gofer_research',
  '2_gofer_specify',
  '3_gofer_plan',
  '4_gofer_tasks',
  '5_gofer_implement',
  '6_gofer_validate',
  '6a_gofer_engineering_review',
  '7_gofer_save',
  '7a_stakeholder_comms',
  '8_gofer_branding',
  '8_gofer_resume',
  '9_gofer_tests',
  '10_gofer_cloud',
  'gofer',
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
];

const GOFER_CONTENT_MARKER =
  /\b(Gofer|gofer|eai-gofer|EAI delivery pipeline|\.specify\/commands|gofer-workspace-check)\b/;

const __filename = fileURLToPath(import.meta.url);

function toPortablePath(value) {
  return value.split(path.sep).join('/');
}

function buildArchiveStamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

function buildVisibleSurfaceRelatives(stem) {
  return [
    path.join('.claude', 'commands', `${stem}.md`),
    path.join('.claude', 'skills', stem),
    path.join('.github', 'prompts', `${stem}.prompt.md`),
    path.join('.github', 'skills', stem),
    path.join('.agents', 'skills', stem),
    path.join('.system', 'skills', stem),
    path.join('.gemini', 'commands', 'gofer', `${stem}.md`),
    path.join('.gemini', 'commands', 'gofer', `${stem}.toml`),
    path.join('.grok', 'skills', stem),
  ];
}

function buildHomeRelatives(stem) {
  return [
    path.join('.claude', 'commands', `${stem}.md`),
    path.join('.claude', 'skills', stem),
    path.join('.codex', 'skills', stem),
    path.join('.gemini', 'commands', 'gofer', `${stem}.md`),
    path.join('.gemini', 'commands', 'gofer', `${stem}.toml`),
    path.join('.grok', 'skills', stem),
  ];
}

function buildBundleRelatives(stem) {
  return [
    path.join('commands', `${stem}.md`),
    path.join('skills', stem),
    path.join('plugin-skills', stem),
    path.join('.claude', 'commands', `${stem}.md`),
    path.join('.claude', 'skills', stem),
    path.join('.github', 'prompts', `${stem}.prompt.md`),
    path.join('.github', 'skills', stem),
    path.join('.agents', 'skills', stem),
    path.join('.system', 'skills', stem),
    path.join('.gemini', 'commands', 'gofer', `${stem}.md`),
    path.join('.gemini', 'commands', 'gofer', `${stem}.toml`),
    path.join('.grok', 'skills', stem),
  ];
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfFile(targetPath) {
  try {
    return await fs.readFile(targetPath, 'utf8');
  } catch {
    return null;
  }
}

async function directoryHasGoferMarker(targetPath, limit = 40) {
  let checked = 0;

  async function visit(current) {
    if (checked >= limit) return false;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (await visit(fullPath)) return true;
      } else if (entry.isFile()) {
        checked += 1;
        const content = await readTextIfFile(fullPath);
        if (content && GOFER_CONTENT_MARKER.test(content)) {
          return true;
        }
      }
    }

    return false;
  }

  return await visit(targetPath);
}

async function isGoferManagedTarget(targetPath) {
  const content = await readTextIfFile(targetPath);
  if (content !== null) {
    return GOFER_CONTENT_MARKER.test(content);
  }

  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }

  return await directoryHasGoferMarker(targetPath);
}

function sanitizeArchivePart(value) {
  return toPortablePath(value)
    .replace(/^[A-Za-z]:/, (match) => match.replace(':', ''))
    .replace(/[^A-Za-z0-9._/-]+/g, '_')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

async function moveToArchive(targetPath, archivePath) {
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  try {
    await fs.rename(targetPath, archivePath);
  } catch (error) {
    if (error?.code !== 'EXDEV') {
      throw error;
    }
    await fs.cp(targetPath, archivePath, { recursive: true, force: true });
    await fs.rm(targetPath, { recursive: true, force: true });
  }
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = path.resolve(candidate.root, candidate.relativePath);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function discoverCodexCacheBundleRoots(home) {
  const roots = [];
  const base = path.join(home, '.codex', 'plugins', 'cache', 'eai-gofer', 'eai-gofer');
  let entries;
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return roots;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      roots.push(path.join(base, entry.name));
    }
  }

  return roots;
}

async function buildCleanupCandidates({ home, workspaces = [], bundleRoots = [] }) {
  const candidates = [];

  for (const stem of STALE_GOFER_STEMS) {
    for (const relativePath of buildHomeRelatives(stem)) {
      candidates.push({ scope: 'home', root: home, relativePath });
    }
  }

  const defaultBundleRoots = [
    path.join(home, 'plugins', 'eai-gofer'),
    path.join(home, '.claude', 'plugins', 'marketplaces', 'eai-gofer', 'plugins', 'eai-gofer'),
    path.join(home, '.gemini', 'extensions', 'eai-gofer'),
    ...(await discoverCodexCacheBundleRoots(home)),
    ...bundleRoots,
  ];

  for (const bundleRoot of defaultBundleRoots) {
    for (const stem of STALE_GOFER_STEMS) {
      for (const relativePath of buildBundleRelatives(stem)) {
        candidates.push({ scope: 'bundle', root: bundleRoot, relativePath });
      }
    }
    candidates.push({
      scope: 'bundle',
      root: bundleRoot,
      relativePath: path.join('.specify', 'commands', '0_business_scenario.md'),
    });
  }

  for (const workspaceRoot of workspaces) {
    for (const stem of STALE_GOFER_STEMS) {
      for (const relativePath of buildVisibleSurfaceRelatives(stem)) {
        candidates.push({ scope: 'workspace', root: workspaceRoot, relativePath });
      }
    }
    candidates.push({
      scope: 'workspace',
      root: workspaceRoot,
      relativePath: path.join('.specify', 'commands', '0_business_scenario.md'),
    });
  }

  return uniqueCandidates(candidates);
}

export async function cleanupLocalSettings({
  home = os.homedir(),
  workspaces = [],
  bundleRoots = [],
  apply = false,
  now = new Date(),
} = {}) {
  const archiveStamp = buildArchiveStamp(now);
  const archiveRoot = path.join(home, '.eai-gofer', 'legacy-settings-backups', archiveStamp);
  const report = {
    status: apply ? 'applied' : 'planned',
    archiveRoot,
    removed: [],
    skipped: [],
  };

  for (const candidate of await buildCleanupCandidates({ home, workspaces, bundleRoots })) {
    const targetPath = path.join(candidate.root, candidate.relativePath);
    if (!(await pathExists(targetPath))) {
      continue;
    }

    if (!(await isGoferManagedTarget(targetPath))) {
      report.skipped.push({
        scope: candidate.scope,
        path: targetPath,
        reason: 'no-gofer-marker',
      });
      continue;
    }

    const archivePath = path.join(
      archiveRoot,
      candidate.scope,
      sanitizeArchivePart(candidate.root),
      sanitizeArchivePart(candidate.relativePath)
    );

    report.removed.push({
      scope: candidate.scope,
      path: targetPath,
      archivePath,
    });

    if (apply) {
      await moveToArchive(targetPath, archivePath);
    }
  }

  return report;
}

function parseArgs(argv) {
  const options = {
    home: os.homedir(),
    workspaces: [],
    bundleRoots: [],
    apply: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];

    if (arg === '--home') options.home = path.resolve(next());
    else if (arg === '--workspace') options.workspaces.push(path.resolve(next()));
    else if (arg === '--bundle') options.bundleRoots.push(path.resolve(next()));
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function helpText() {
  return `Gofer Local Settings Cleanup

Archives stale Gofer command and skill entries from known Claude, Codex,
Copilot, Gemini, Grok, VS Code, desktop, and CLI surface paths.

Usage:
  node .specify/scripts/node/gofer-local-settings-cleanup.mjs [options]

Options:
  --workspace <path>   Also clean repo-local visible command surfaces.
  --bundle <path>      Also clean a downloaded eai-gofer plugin bundle.
  --home <path>        Home directory to inspect. Defaults to current user.
  --apply              Move stale entries to an archive. Default is dry-run.
  --dry-run            Report planned cleanup only.
  --json               Print machine-readable output.
  --help               Show this help.
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  const report = await cleanupLocalSettings(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const verb = options.apply ? 'archived' : 'would archive';
  console.log(`Gofer cleanup ${report.status}. ${report.removed.length} stale entries ${verb}.`);
  if (report.removed.length > 0) {
    console.log(`Archive root: ${report.archiveRoot}`);
  }
  for (const item of report.removed) {
    console.log(`- ${item.path}`);
  }
  if (report.skipped.length > 0) {
    console.log(`Skipped ${report.skipped.length} candidate(s) without Gofer markers.`);
  }
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(__filename)) {
  main().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exit(1);
  });
}
