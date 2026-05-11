/**
 * Update check — non-blocking background version check with 24h cache.
 *
 * Skipped entirely in CI, when NO_UPDATE_NOTIFIER=1, or non-TTY output.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';

const EAI_DIR = join(homedir(), '.eai');
const CACHE_FILE = join(EAI_DIR, 'update-check.json');
export const NPM_PACKUMENT_URL = 'https://registry.npmjs.org/@eai-tools%2fcli';
export const STATIC_PACKUMENT_URL = 'https://eai-tools.github.io/eai-cli/registry/@eai-tools/cli';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type ReleaseChannel = 'npm' | 'static-registry';

export interface LatestRelease {
  channel: ReleaseChannel;
  version: string;
}

interface UpdateCache {
  lastCheck: number;
  latestVersion: string;
  currentVersion: string;
}

function shouldSkip(): boolean {
  return (
    !!process.env['CI'] ||
    process.env['NO_UPDATE_NOTIFIER'] === '1' ||
    !process.stderr.isTTY
  );
}

/** Compare two semver strings (major.minor.patch). */
export function isNewerVersion(current: string, latest: string): boolean {
  const cur = current.split('.').map(Number);
  const lat = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((lat[i] ?? 0) > (cur[i] ?? 0)) return true;
    if ((lat[i] ?? 0) < (cur[i] ?? 0)) return false;
  }
  return false;
}

export function compareVersions(left: string, right: string): number {
  const lhs = left.split('.').map(Number);
  const rhs = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const delta = (lhs[i] ?? 0) - (rhs[i] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

export function selectNewestRelease(candidates: readonly LatestRelease[]): LatestRelease | null {
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    const versionDelta = compareVersions(right.version, left.version);
    if (versionDelta !== 0) {
      return versionDelta;
    }

    if (left.channel === right.channel) {
      return 0;
    }

    return left.channel === 'npm' ? -1 : 1;
  })[0] ?? null;
}

async function fetchChannelLatest(
  url: string,
  channel: ReleaseChannel,
): Promise<LatestRelease | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = (await res.json()) as { 'dist-tags'?: { latest?: string } };
    const version = data['dist-tags']?.latest ?? null;
    if (!version) {
      return null;
    }

    return { channel, version };
  } catch {
    return null;
  }
}

/** Fetch the newest release from npm and the static registry. */
export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  const releases = await Promise.all([
    fetchChannelLatest(NPM_PACKUMENT_URL, 'npm'),
    fetchChannelLatest(STATIC_PACKUMENT_URL, 'static-registry'),
  ]);

  return selectNewestRelease(releases.filter((release): release is LatestRelease => release !== null));
}

/** Fetch the latest version from the available release channels. */
export async function fetchLatestVersion(): Promise<string | null> {
  return (await fetchLatestRelease())?.version ?? null;
}

async function readCache(): Promise<UpdateCache | null> {
  try {
    const raw = await readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(raw) as UpdateCache;
  } catch {
    return null;
  }
}

async function writeCache(cache: UpdateCache): Promise<void> {
  try {
    await mkdir(EAI_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(cache), 'utf-8');
  } catch {
    // Best-effort — don't fail the CLI
  }
}

/**
 * Fire-and-forget background update check.
 * Reads cache; skips if checked within 24h; otherwise fetches and caches.
 */
export function checkForUpdate(currentVersion: string): void {
  if (shouldSkip()) return;

  // Fire-and-forget — errors are swallowed
  void (async () => {
    const cache = await readCache();
    if (cache && Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) return;

    const latest = await fetchLatestVersion();
    if (!latest) return;

    await writeCache({
      lastCheck: Date.now(),
      latestVersion: latest,
      currentVersion,
    });
  })();
}

/**
 * Print update banner to stderr if a newer version is cached.
 * Called after command execution so the banner appears last.
 */
export async function notifyIfUpdateAvailable(currentVersion: string): Promise<void> {
  if (shouldSkip()) return;

  const cache = await readCache();
  if (!cache) return;
  if (!isNewerVersion(currentVersion, cache.latestVersion)) return;

  const current = chalk.dim(currentVersion);
  const latest = chalk.green(cache.latestVersion);
  const cmd = chalk.cyan('eai update');

  console.error('');
  console.error(`  Update available: ${current} → ${latest}`);
  console.error(`  Run ${cmd} to update`);
  console.error('');
}
