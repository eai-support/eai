import { createHash } from 'node:crypto';
import { access, chmod, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import {
  GOFER_RESOURCE_MAPPINGS,
  installClaudeHooks,
  renderGoferManagedTextFiles,
  resolveGoferResourcesPath,
  updateGitignore,
  updateVSCodeSettings,
} from './gofer-installer.js';
import type { GoferInstallOptions } from './gofer-installer.js';
import type { GoferManagedFileState, ProjectManifest } from './project-manifest.js';
import { saveProjectManifest } from './project-manifest.js';

export interface GoferRefreshSummary {
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
  conflicted: number;
  backedUp: number;
}

export interface GoferRefreshPlanItem {
  readonly relativePath: string;
  readonly action: 'add' | 'update' | 'adopt-update' | 'delete' | 'unchanged' | 'conflict' | 'conflict-delete';
  readonly source: 'bundled' | 'generated';
  readonly desiredHash?: string;
  readonly currentHash?: string;
  readonly executable: boolean;
  readonly contents?: Buffer;
}

export interface GoferRefreshPlan {
  readonly projectRoot: string;
  readonly manifest: ProjectManifest | null;
  readonly bundle: {
    readonly commit?: string;
    readonly describe?: string;
    readonly syncedAt?: string;
  };
  readonly items: readonly GoferRefreshPlanItem[];
  readonly summary: GoferRefreshSummary;
  readonly firstRefresh: boolean;
}

interface ManagedCandidate {
  readonly relativePath: string;
  readonly contents: Buffer;
  readonly source: 'bundled' | 'generated';
  readonly executable: boolean;
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function hashContents(contents: Buffer | string): string {
  return createHash('sha256').update(contents).digest('hex');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readCurrentHash(path: string): Promise<string | null> {
  if (!(await fileExists(path))) {
    return null;
  }

  return hashContents(await readFile(path));
}

export async function readGoferBundleMetadata(): Promise<{ commit?: string; describe?: string; syncedAt?: string }> {
  const metadataPath = join(resolveGoferResourcesPath(), '.gofer-version');
  try {
    const raw = JSON.parse(await readFile(metadataPath, 'utf-8')) as {
      commit?: string;
      describe?: string;
      synced_at?: string;
    };
    return {
      commit: raw.commit,
      describe: raw.describe,
      syncedAt: raw.synced_at,
    };
  } catch {
    return {};
  }
}

async function collectBundledCandidates(): Promise<ManagedCandidate[]> {
  const resourcesRoot = resolveGoferResourcesPath();
  const candidates: ManagedCandidate[] = [];

  for (const mapping of GOFER_RESOURCE_MAPPINGS) {
    const sourceRoot = join(resourcesRoot, mapping.sourceSubdirectory);
    const files = await collectDirectoryFiles(sourceRoot);
    for (const sourcePath of files) {
      const relativeSource = normalizeRelativePath(relative(sourceRoot, sourcePath));
      candidates.push({
        relativePath: normalizeRelativePath(join(...mapping.targetSegments, relativeSource)),
        contents: await readFile(sourcePath),
        source: 'bundled',
        executable: mapping.makeExecutable ?? false,
      });
    }
  }

  return candidates;
}

async function collectDirectoryFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectDirectoryFiles(entryPath));
      continue;
    }

    if (entry.isFile()) {
      results.push(entryPath);
    }
  }

  return results;
}

async function collectGeneratedCandidates(
  projectRoot: string,
  options: GoferInstallOptions,
): Promise<ManagedCandidate[]> {
  const generated = await renderGoferManagedTextFiles(projectRoot, options);

  return generated
    .filter((file) => file.relativePath !== 'AGENTS.md')
    .map((file) => ({
      relativePath: normalizeRelativePath(file.relativePath),
      contents: Buffer.from(file.content, 'utf-8'),
      source: 'generated' as const,
      executable: false,
    }));
}

function buildSummary(items: readonly GoferRefreshPlanItem[]): GoferRefreshSummary {
  return items.reduce<GoferRefreshSummary>((summary, item) => {
    switch (item.action) {
      case 'add':
        summary.added += 1;
        break;
      case 'update':
      case 'adopt-update':
        summary.updated += 1;
        break;
      case 'delete':
        summary.deleted += 1;
        break;
      case 'unchanged':
        summary.unchanged += 1;
        break;
      case 'conflict':
      case 'conflict-delete':
        summary.conflicted += 1;
        break;
    }
    return summary;
  }, {
    added: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    conflicted: 0,
    backedUp: 0,
  });
}

export async function planGoferRefresh(
  projectRoot: string,
  manifest: ProjectManifest | null,
  options: GoferInstallOptions = {},
): Promise<GoferRefreshPlan> {
  const bundle = await readGoferBundleMetadata();
  const desiredFiles = new Map<string, ManagedCandidate>();

  for (const candidate of [
    ...await collectBundledCandidates(),
    ...await collectGeneratedCandidates(projectRoot, options),
  ]) {
    desiredFiles.set(candidate.relativePath, candidate);
  }

  const trackedFiles = manifest?.gofer?.managedFiles ?? {};
  const items: GoferRefreshPlanItem[] = [];
  const firstRefresh = !manifest?.gofer;

  for (const candidate of [...desiredFiles.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    const absolutePath = join(projectRoot, candidate.relativePath);
    const currentHash = await readCurrentHash(absolutePath);
    const desiredHash = hashContents(candidate.contents);
    const tracked = trackedFiles[candidate.relativePath];

    if (currentHash === null) {
      items.push({
        relativePath: candidate.relativePath,
        action: 'add',
        source: candidate.source,
        desiredHash,
        executable: candidate.executable,
        contents: candidate.contents,
      });
      continue;
    }

    if (currentHash === desiredHash) {
      items.push({
        relativePath: candidate.relativePath,
        action: 'unchanged',
        source: candidate.source,
        currentHash,
        desiredHash,
        executable: candidate.executable,
      });
      continue;
    }

    if (!tracked) {
      items.push({
        relativePath: candidate.relativePath,
        action: 'adopt-update',
        source: candidate.source,
        currentHash,
        desiredHash,
        executable: candidate.executable,
        contents: candidate.contents,
      });
      continue;
    }

    if (tracked.sha256 === currentHash) {
      items.push({
        relativePath: candidate.relativePath,
        action: 'update',
        source: candidate.source,
        currentHash,
        desiredHash,
        executable: candidate.executable,
        contents: candidate.contents,
      });
      continue;
    }

    items.push({
      relativePath: candidate.relativePath,
      action: 'conflict',
      source: candidate.source,
      currentHash,
      desiredHash,
      executable: candidate.executable,
      contents: candidate.contents,
    });
  }

  for (const relativePath of Object.keys(trackedFiles).sort()) {
    if (desiredFiles.has(relativePath)) {
      continue;
    }

    const absolutePath = join(projectRoot, relativePath);
    const currentHash = await readCurrentHash(absolutePath);
    if (!currentHash) {
      continue;
    }

    items.push({
      relativePath,
      action: trackedFiles[relativePath]?.sha256 === currentHash ? 'delete' : 'conflict-delete',
      source: trackedFiles[relativePath]?.source ?? 'generated',
      currentHash,
      executable: false,
    });
  }

  return {
    projectRoot,
    manifest,
    bundle,
    items,
    summary: buildSummary(items),
    firstRefresh,
  };
}

async function backupFile(projectRoot: string, backupRoot: string, relativePath: string): Promise<void> {
  const sourcePath = join(projectRoot, relativePath);
  if (!(await fileExists(sourcePath))) {
    return;
  }

  const backupPath = join(backupRoot, relativePath);
  await mkdir(dirname(backupPath), { recursive: true });
  await copyFile(sourcePath, backupPath);
}

function createManifestFromPlan(
  plan: GoferRefreshPlan,
  appliedItems: readonly GoferRefreshPlanItem[],
): ProjectManifest {
  const nextManagedFiles: Record<string, GoferManagedFileState> = {
    ...(plan.manifest?.gofer?.managedFiles ?? {}),
  };

  for (const item of appliedItems) {
    if (item.action === 'delete') {
      delete nextManagedFiles[item.relativePath];
      continue;
    }

    if (item.action === 'add' || item.action === 'update' || item.action === 'adopt-update' || item.action === 'unchanged') {
      if (!item.desiredHash) {
        continue;
      }

      nextManagedFiles[item.relativePath] = {
        sha256: item.desiredHash,
        source: item.source,
      };
    }
  }

  return {
    schemaVersion: 1,
    cli: plan.manifest?.cli,
    packages: plan.manifest?.packages,
    template: plan.manifest?.template,
    gofer: {
      bundle: plan.bundle,
      managedFiles: nextManagedFiles,
      refreshedAt: new Date().toISOString(),
    },
  };
}

export async function applyGoferRefresh(
  plan: GoferRefreshPlan,
  options: { readonly force?: boolean } = {},
): Promise<{ summary: GoferRefreshSummary; backupDirectory: string | null; manifest: ProjectManifest }> {
  const force = options.force ?? false;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = join(plan.projectRoot, '.specify', '_backup', 'gofer-refresh', timestamp);
  let backupCount = 0;
  const appliedItems: GoferRefreshPlanItem[] = [];

  for (const item of plan.items) {
    const absolutePath = join(plan.projectRoot, item.relativePath);

    if (item.action === 'conflict' || item.action === 'conflict-delete') {
      if (!force) {
        continue;
      }

      await backupFile(plan.projectRoot, backupRoot, item.relativePath);
      backupCount += 1;

      if (item.action === 'conflict-delete') {
        await rm(absolutePath, { force: true });
        appliedItems.push({ ...item, action: 'delete' });
        continue;
      }

      if (!item.contents) {
        continue;
      }

      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, item.contents);
      if (item.executable) {
        await chmod(absolutePath, 0o755);
      }
      appliedItems.push({ ...item, action: 'update' });
      continue;
    }

    if (item.action === 'delete') {
      await backupFile(plan.projectRoot, backupRoot, item.relativePath);
      backupCount += 1;
      await rm(absolutePath, { force: true });
      appliedItems.push(item);
      continue;
    }

    if (item.action === 'unchanged') {
      appliedItems.push(item);
      continue;
    }

    if (!item.contents) {
      continue;
    }

    if (item.action === 'adopt-update') {
      await backupFile(plan.projectRoot, backupRoot, item.relativePath);
      backupCount += 1;
    }

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, item.contents);
    if (item.executable) {
      await chmod(absolutePath, 0o755);
    }
    appliedItems.push(item);
  }

  await installClaudeHooks(plan.projectRoot);
  await updateVSCodeSettings(plan.projectRoot);
  await updateGitignore(plan.projectRoot);

  const manifest = createManifestFromPlan(plan, appliedItems);
  await saveProjectManifest(plan.projectRoot, manifest);

  const summary = buildSummary([
    ...appliedItems,
    ...plan.items.filter((item) => {
      if (item.action !== 'conflict' && item.action !== 'conflict-delete') {
        return false;
      }

      return !force;
    }),
  ]);

  const finalSummary: GoferRefreshSummary = {
    ...summary,
    backedUp: backupCount,
  };

  return {
    summary: finalSummary,
    backupDirectory: backupCount > 0 ? backupRoot : null,
    manifest,
  };
}

export async function isDirectoryPath(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
