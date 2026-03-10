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
const REGISTRY_URL = 'https://eai-tools.github.io/eai-cli/registry/@eai-tools/cli';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

/** Fetch the latest version from the GitHub Pages npm registry. */
export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = (await res.json()) as { 'dist-tags'?: { latest?: string } };
    return data['dist-tags']?.latest ?? null;
  } catch {
    return null;
  }
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
