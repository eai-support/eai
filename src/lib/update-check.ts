/**
 * Update check — non-blocking background version check with 24h cache.
 *
 * Skipped entirely in CI, when NO_UPDATE_NOTIFIER=1, or non-TTY output.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import process from 'node:process';
import chalk from 'chalk';

const EAI_DIR = join(homedir(), '.eai');
const CACHE_FILE = join(EAI_DIR, 'update-check.json');
export const STATIC_REGISTRY_URL = 'https://eai-tools.github.io/eai/registry/';
export const STATIC_PACKUMENT_URL = `${STATIC_REGISTRY_URL}@enterpriseai/cli`;
export const NPMJS_REGISTRY_URL = 'https://registry.npmjs.org/';
export const NPMJS_PACKUMENT_URL = `${NPMJS_REGISTRY_URL}@enterpriseai%2fcli`;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_FETCH_TIMEOUT_MS = 5000;
const DISCOVERY_FETCH_TIMEOUT_MS = 1200;

export type ReleaseChannel = 'npmjs' | 'static-registry';

export interface LatestRelease {
  channel: ReleaseChannel;
  version: string;
}

export interface UpdateCache {
  lastCheck: number;
  latestVersion: string;
  currentVersion: string;
}

export interface UpdateNoticeOptions {
  readonly args?: readonly string[];
  readonly runUpdate?: () => Promise<boolean>;
}

function shouldSkip(): boolean {
  if (process.env['NO_UPDATE_NOTIFIER'] === '1') {
    return true;
  }

  if (process.env['EAI_UPDATE_NOTIFIER_FORCE'] === '1') {
    return false;
  }

  return (
    !!process.env['CI'] ||
    !process.stderr.isTTY
  );
}

function getStaticPackumentUrl(): string {
  return process.env['EAI_UPDATE_PACKUMENT_URL'] || STATIC_PACKUMENT_URL;
}

function getNpmjsPackumentUrl(): string {
  return process.env['EAI_UPDATE_NPMJS_PACKUMENT_URL'] || NPMJS_PACKUMENT_URL;
}

export function isMachineReadableInvocation(args: readonly string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === '--describe' || arg === '--json') {
      return true;
    }

    if (arg === '--format' && args[index + 1] === 'json') {
      return true;
    }

    if (arg === '--format=json') {
      return true;
    }
  }

  return false;
}

export function shouldOfferInteractiveUpdatePrompt(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  stdin: Pick<NodeJS.ReadStream, 'isTTY'> = process.stdin,
  stderr: Pick<NodeJS.WriteStream, 'isTTY'> = process.stderr,
): boolean {
  if (env['NO_UPDATE_NOTIFIER'] === '1' || env['EAI_UPDATE_PROMPT_SUPPRESS'] === '1') {
    return false;
  }

  if (env['CI'] || isMachineReadableInvocation(args)) {
    return false;
  }

  return Boolean(stdin.isTTY && stderr.isTTY);
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

  const channelPriority: Record<ReleaseChannel, number> = {
    npmjs: 0,
    'static-registry': 1,
  };

  return [...candidates].sort((left, right) => {
    const versionDelta = compareVersions(right.version, left.version);
    if (versionDelta !== 0) {
      return versionDelta;
    }

    return channelPriority[left.channel] - channelPriority[right.channel];
  })[0] ?? null;
}

async function fetchChannelLatest(
  url: string,
  channel: ReleaseChannel,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<LatestRelease | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });

    if (!res.ok) return null;

    const data = (await res.json()) as { 'dist-tags'?: { latest?: string } };
    const version = data['dist-tags']?.latest ?? null;
    if (!version) {
      return null;
    }

    return { channel, version };
  } catch {
    return null;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/** Fetch the newest release from the public npm registry, falling back to the static EAI registry. */
export async function fetchLatestRelease(timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<LatestRelease | null> {
  const [npmjsRelease, staticRelease] = await Promise.all([
    fetchChannelLatest(getNpmjsPackumentUrl(), 'npmjs', timeoutMs),
    fetchChannelLatest(getStaticPackumentUrl(), 'static-registry', timeoutMs),
  ]);

  return selectNewestRelease([
    ...(npmjsRelease ? [npmjsRelease] : []),
    ...(staticRelease ? [staticRelease] : []),
  ]);
}

/** Fetch the latest version from the available release channels. */
export async function fetchLatestVersion(timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<string | null> {
  return (await fetchLatestRelease(timeoutMs))?.version ?? null;
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

async function refreshCache(
  currentVersion: string,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<UpdateCache | null> {
  const latest = await fetchLatestVersion(timeoutMs);
  if (!latest) {
    return null;
  }

  const cache = {
    lastCheck: Date.now(),
    latestVersion: latest,
    currentVersion,
  };
  await writeCache(cache);
  return cache;
}

async function readFreshOrRefreshCache(
  currentVersion: string,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<UpdateCache | null> {
  const cache = await readCache();
  if (cache && Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) {
    return cache;
  }

  return await refreshCache(currentVersion, timeoutMs) ?? cache;
}

/**
 * Fire-and-forget background update check.
 * Reads cache; skips if checked within 24h; otherwise fetches and caches.
 */
export function checkForUpdate(currentVersion: string): void {
  if (shouldSkip()) return;

  // Fire-and-forget — errors are swallowed
  void (async () => {
    await readFreshOrRefreshCache(currentVersion);
  })();
}

/**
 * Print update banner to stderr if a newer version is cached.
 * Called after command execution so the banner appears last.
 */
export async function notifyIfUpdateAvailable(
  currentVersion: string,
  options: UpdateNoticeOptions = {},
): Promise<void> {
  if (shouldSkip()) return;

  const cache = await readCache();
  await printUpdateNotice(currentVersion, cache, options);
}

export async function runCurrentCliUpdate(): Promise<boolean> {
  return new Promise((resolve) => {
    const entry = process.argv[1];
    if (!entry) {
      resolve(false);
      return;
    }

    const child = spawn(process.execPath, [entry, 'update'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        EAI_UPDATE_PROMPT_SUPPRESS: '1',
        NO_UPDATE_NOTIFIER: '1',
      },
    });

    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

async function promptForUpdate(): Promise<boolean> {
  const { default: inquirer } = await import('inquirer');
  const { updateNow } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'updateNow',
      message: 'Update eai now?',
      default: true,
    },
  ]) as { updateNow?: boolean };

  return Boolean(updateNow);
}

export async function printUpdateNotice(
  currentVersion: string,
  cache: UpdateCache | null,
  options: UpdateNoticeOptions = {},
): Promise<void> {
  if (!cache) return;
  if (!isNewerVersion(currentVersion, cache.latestVersion)) return;

  const current = chalk.dim(currentVersion);
  const latest = chalk.green(cache.latestVersion);
  const cmd = chalk.cyan('eai update');

  console.error('');
  console.error(`  Update available: ${current} → ${latest}`);
  if (shouldOfferInteractiveUpdatePrompt(options.args ?? [])) {
    const accepted = await promptForUpdate();
    if (accepted) {
      const ran = await (options.runUpdate ?? runCurrentCliUpdate)();
      if (!ran) {
        console.error(`  Run ${cmd} to update`);
      }
      console.error('');
      return;
    }

    console.error(`  Run ${cmd} when you are ready`);
    console.error('');
    return;
  }

  console.error(`  Run ${cmd} to update`);
  console.error('');
}

/**
 * Discovery commands are where stale CLIs hurt most: a user or agent asks
 * "what can this do?" and old binaries cannot list new commands. Do a bounded
 * foreground refresh so root help and unknown commands can point at eai update.
 */
export async function notifyIfUpdateAvailableForDiscovery(currentVersion: string): Promise<void> {
  if (shouldSkip()) return;

  const cache = await readFreshOrRefreshCache(currentVersion, DISCOVERY_FETCH_TIMEOUT_MS);
  await printUpdateNotice(currentVersion, cache);
}
