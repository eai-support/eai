import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, chmod, copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
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

const execFileAsync = promisify(execFile);
const GOFER_REPO_URL = 'https://github.com/eai-support/eai-gofer.git';
const GOFER_RELEASE_MANIFEST_URL = 'https://eai-support.github.io/eai-gofer/releases/plugins/eai-gofer/gemini-extension.json';
const GOFER_FETCH_TIMEOUT_MS = 5000;
const GOFER_CACHE_ROOT = join(homedir(), '.eai', 'gofer-cache');
const GOFER_BASE_RESOURCE_DIR = join('extension', 'resources');
const GOFER_EXTRA_RESOURCE_MAPPINGS: readonly (readonly [string, string])[] = [
  ['.specify/commands', 'commands'],
  ['.specify/memory', 'memory'],
  ['.specify/references', 'references'],
  ['.system/skills', 'system-skills'],
  ['.agents/skills', 'agents-skills'],
];

interface GoferBundleMetadata {
  readonly commit?: string;
  readonly describe?: string;
  readonly syncedAt?: string;
  readonly source?: 'latest' | 'bundled';
  readonly warning?: string;
}

interface GoferResourcesSource {
  readonly root: string;
  readonly metadata: GoferBundleMetadata;
}

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
  readonly bundle: GoferBundleMetadata;
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

async function readResourcesMetadata(root: string): Promise<GoferBundleMetadata> {
  const metadataPath = join(root, '.gofer-version');
  try {
    const raw = JSON.parse(await readFile(metadataPath, 'utf-8')) as {
      commit?: string;
      describe?: string;
      synced_at?: string;
      syncedAt?: string;
    };
    return {
      commit: raw.commit,
      describe: raw.describe,
      syncedAt: raw.synced_at ?? raw.syncedAt,
    };
  } catch {
    return {};
  }
}

function shouldUseLatestGoferSource(): boolean {
  const mode = (process.env['EAI_GOFER_REFRESH_SOURCE'] || '').trim().toLowerCase();
  if (mode === 'bundled') {
    return false;
  }
  if (mode === 'latest') {
    return true;
  }
  if (process.env['EAI_GOFER_REFRESH_BUNDLED_ONLY'] === '1') {
    return false;
  }
  if (process.env['EAI_GOFER_REFRESH_RESOURCES_PATH']) {
    return true;
  }
  return process.env['NODE_ENV'] !== 'test';
}

function getLatestManifestUrl(): string {
  return process.env['EAI_GOFER_REFRESH_MANIFEST_URL'] || GOFER_RELEASE_MANIFEST_URL;
}

function getGoferRepoUrl(): string {
  return process.env['EAI_GOFER_REFRESH_REPO_URL'] || GOFER_REPO_URL;
}

function getGoferCacheRoot(): string {
  return process.env['EAI_GOFER_REFRESH_CACHE_DIR'] || GOFER_CACHE_ROOT;
}

function sanitizeCacheSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-');
}

async function fetchLatestGoferVersion(): Promise<{ version: string; generated?: string } | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), GOFER_FETCH_TIMEOUT_MS);
    const response = await fetch(getLatestManifestUrl(), { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    const data = await response.json() as { version?: unknown; generated?: unknown };
    if (typeof data.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?$/.test(data.version)) {
      return null;
    }
    return {
      version: data.version,
      generated: typeof data.generated === 'string' ? data.generated : undefined,
    };
  } catch {
    return null;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function runGit(args: readonly string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function ensureLatestGoferCheckout(version: string): Promise<string> {
  const tag = `v${version}`;
  const checkoutRoot = join(getGoferCacheRoot(), sanitizeCacheSegment(tag), 'repo');
  if (
    await fileExists(join(checkoutRoot, '.git')) &&
    await isDirectoryPath(join(checkoutRoot, GOFER_BASE_RESOURCE_DIR))
  ) {
    return checkoutRoot;
  }

  await rm(checkoutRoot, { recursive: true, force: true });
  await mkdir(dirname(checkoutRoot), { recursive: true });
  await runGit([
    'clone',
    '--depth',
    '1',
    '--branch',
    tag,
    getGoferRepoUrl(),
    checkoutRoot,
  ]);
  return checkoutRoot;
}

async function copyDirectoryIfPresent(source: string, target: string): Promise<void> {
  if (!(await isDirectoryPath(source))) {
    return;
  }
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

async function writeResourcesMetadata(root: string, metadata: GoferBundleMetadata): Promise<void> {
  await writeFile(join(root, '.gofer-version'), JSON.stringify({
    commit: metadata.commit,
    describe: metadata.describe,
    synced_at: metadata.syncedAt,
  }, null, 2) + '\n');
}

async function normalizeGoferResourcesCheckout(
  checkoutRoot: string,
  metadata: GoferBundleMetadata,
): Promise<string> {
  const resourcesRoot = join(dirname(checkoutRoot), 'resources');
  const currentMetadata = await readResourcesMetadata(resourcesRoot);
  if (currentMetadata.commit && metadata.commit && currentMetadata.commit === metadata.commit) {
    return resourcesRoot;
  }

  const baseResources = join(checkoutRoot, GOFER_BASE_RESOURCE_DIR);
  if (!(await isDirectoryPath(baseResources))) {
    throw new Error(`eai-gofer checkout is missing ${GOFER_BASE_RESOURCE_DIR}`);
  }

  await rm(resourcesRoot, { recursive: true, force: true });
  await mkdir(resourcesRoot, { recursive: true });
  await cp(baseResources, resourcesRoot, { recursive: true, force: true });
  for (const [sourceRelative, targetRelative] of GOFER_EXTRA_RESOURCE_MAPPINGS) {
    await copyDirectoryIfPresent(join(checkoutRoot, sourceRelative), join(resourcesRoot, targetRelative));
  }
  await writeResourcesMetadata(resourcesRoot, metadata);
  return resourcesRoot;
}

async function resolveBundledGoferResourcesSource(warning?: string): Promise<GoferResourcesSource> {
  const root = resolveGoferResourcesPath();
  return {
    root,
    metadata: {
      ...await readResourcesMetadata(root),
      source: 'bundled',
      warning,
    },
  };
}

async function resolveLatestGoferResourcesSource(): Promise<GoferResourcesSource | null> {
  const overridePath = process.env['EAI_GOFER_REFRESH_RESOURCES_PATH'];
  if (overridePath) {
    const root = resolve(overridePath);
    return {
      root,
      metadata: {
        ...await readResourcesMetadata(root),
        source: 'latest',
      },
    };
  }

  const latest = await fetchLatestGoferVersion();
  if (!latest) {
    return null;
  }

  const checkoutRoot = await ensureLatestGoferCheckout(latest.version);
  const commit = await runGit(['rev-parse', 'HEAD'], checkoutRoot).catch(() => undefined);
  const metadata: GoferBundleMetadata = {
    commit,
    describe: `v${latest.version}`,
    syncedAt: latest.generated,
    source: 'latest',
  };
  return {
    root: await normalizeGoferResourcesCheckout(checkoutRoot, metadata),
    metadata,
  };
}

async function resolveGoferResourcesSource(): Promise<GoferResourcesSource> {
  if (!shouldUseLatestGoferSource()) {
    return resolveBundledGoferResourcesSource();
  }

  try {
    const latest = await resolveLatestGoferResourcesSource();
    if (latest) {
      return latest;
    }
    return resolveBundledGoferResourcesSource('Could not resolve the latest eai-gofer release; using bundled assets.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return resolveBundledGoferResourcesSource(`Could not prepare the latest eai-gofer release (${message}); using bundled assets.`);
  }
}

export async function readGoferBundleMetadata(): Promise<GoferBundleMetadata> {
  return (await resolveGoferResourcesSource()).metadata;
}

async function collectBundledCandidates(resourcesRoot: string): Promise<ManagedCandidate[]> {
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
  const resourcesSource = await resolveGoferResourcesSource();
  const bundle = resourcesSource.metadata;
  const desiredFiles = new Map<string, ManagedCandidate>();

  for (const candidate of [
    ...await collectBundledCandidates(resourcesSource.root),
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
      bundle: {
        commit: plan.bundle.commit,
        describe: plan.bundle.describe,
        syncedAt: plan.bundle.syncedAt,
      },
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
