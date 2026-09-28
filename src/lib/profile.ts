/**
 * Profile management for private environment switching.
 *
 * Default profile ("default") uses public production behavior. Named profiles
 * are intentionally undocumented in public docs and are only for private
 * organization-managed setups.
 *
 * Module-level state pattern (same as setSimpleMode in output.ts)
 * avoids threading profile through 20+ command action handlers.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { Command, OptionValues } from 'commander';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProfileConfig {
  readonly publicApiUrl: string;
  readonly authTenantName: string;
  readonly authTenantId: string;
  readonly authClientId: string;
  readonly authScope?: string;
  /** SECURITY: authorizes one HTTPS managed endpoint, exactly matching this profile's publicApiUrl. */
  readonly managedDeploymentApiUrl?: string;
}

interface ProfilesFile {
  readonly profiles: Record<string, ProfileConfig>;
}

// ── Module-level state ───────────────────────────────────────────────────────

let _activeProfileName = 'default';
const capturedProfiles = new Map<string, ProfileConfig>();
let captureGeneration = 0;

export function setActiveProfile(name: string): void {
  capturedProfiles.clear();
  captureGeneration += 1;
  _activeProfileName = name;
}

export function getActiveProfile(): string {
  return _activeProfileName;
}

/** INVARIANT: command/profile changes invalidate captured local input metadata. */
export function getProfileCaptureGeneration(): number {
  return captureGeneration;
}

/** Resolves the root profile option for nested commands while preserving plain-command production defaults. */
export function resolveCommandProfile(
  command: Pick<Command, 'optsWithGlobals'>,
  environmentProfile = process.env.EAI_PROFILE,
): string {
  const options = command.optsWithGlobals<OptionValues>();
  const explicitProfile = typeof options.profile === 'string'
    ? options.profile.trim()
    : '';
  return explicitProfile || environmentProfile?.trim() || 'default';
}

// ── Paths ────────────────────────────────────────────────────────────────────

function getEaiDir(): string {
  return join(homedir(), '.eai');
}

export function getConfigFilePath(): string {
  return join(getEaiDir(), 'config.json');
}

/**
 * Token file path for a given profile.
 *
 * "default" → ~/.eai/tokens.json  (unchanged from legacy behavior)
 * other     → ~/.eai/tokens/{name}.json
 */
export function getProfileTokensFile(name: string): string {
  if (name === 'default') {
    return join(getEaiDir(), 'tokens.json');
  }
  return join(getEaiDir(), 'tokens', `${name}.json`);
}

// ── Config loading ───────────────────────────────────────────────────────────

/**
 * Load config for a named profile from the local CLI profile settings file.
 *
 * Returns null for the "default" profile (no config needed).
 * Throws if the config file or requested profile is missing.
 */
export async function loadProfileConfig(name: string): Promise<ProfileConfig | null> {
  return captureProfileConfig(name);
}

/** SECURITY: auth and managed gateway share one owner-controlled bounded snapshot until the command/profile changes. */
export function captureProfileConfig(name: string): ProfileConfig | null {
  if (name === 'default') return null;
  const configuredPath = getConfigFilePath();
  const key = `${configuredPath}\n${name}`;
  const cached = capturedProfiles.get(key);
  if (cached) return cached;
  let raw: Buffer;
  try {
    // SECURITY: resolve the trusted home selection (including OS temp-directory aliases), then reject links beneath it.
    const configPath = join(realpathSync(dirname(dirname(configuredPath))), '.eai', 'config.json');
    const parentPath = dirname(configPath);
    if (realpathSync(configPath) !== configPath) throw new Error('Profile path must not contain links.');
    const parent = lstatSync(parentPath);
    const leaf = lstatSync(configPath);
    if (!parent.isDirectory() || parent.isSymbolicLink() || !leaf.isFile() || leaf.isSymbolicLink()
      || (process.platform !== 'win32' && ((parent.mode & 0o022) !== 0 || (leaf.mode & 0o022) !== 0))
      || (process.getuid && (parent.uid !== process.getuid() || leaf.uid !== process.getuid()))) {
      throw new Error('Profile settings must be owned and controlled by the current user.');
    }
    if (!constants.O_NOFOLLOW && process.platform !== 'win32') throw new Error('No-follow profile reads are unavailable.');
    const descriptor = openSync(configPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    try {
      const opened = fstatSync(descriptor);
      if (!opened.isFile() || opened.nlink !== 1 || opened.size > 64 * 1024
        || opened.dev !== leaf.dev || opened.ino !== leaf.ino) throw new Error('Profile settings are unsafe or exceed 64 KiB.');
      const buffer = Buffer.alloc(64 * 1024 + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = readSync(descriptor, buffer, length, buffer.length - length, null);
        if (count === 0) break;
        length += count;
      }
      const after = fstatSync(descriptor);
      const bound = lstatSync(configPath);
      const parentAfter = lstatSync(parentPath);
      if (length !== opened.size || length > 64 * 1024 || after.nlink !== 1 || bound.nlink !== 1
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
        || bound.dev !== opened.dev || bound.ino !== opened.ino || bound.size !== opened.size
        || bound.mtimeMs !== opened.mtimeMs || bound.ctimeMs !== opened.ctimeMs
        || parent.dev !== parentAfter.dev || parent.ino !== parentAfter.ino
        || parentAfter.isSymbolicLink() || parentAfter.uid !== parent.uid || parentAfter.mode !== parent.mode) throw new Error('Profile settings changed during capture.');
      raw = buffer.subarray(0, length);
    } finally { closeSync(descriptor); }
  } catch (cause) {
    throw new Error(
      `Profile "${name}" requires safe owner-controlled local profile settings.`, { cause },
    );
  }

  let file: ProfilesFile;
  try {
    file = JSON.parse(raw.toString('utf8')) as ProfilesFile;
    if (!file || typeof file !== 'object' || Array.isArray(file) || !file.profiles
      || typeof file.profiles !== 'object' || Array.isArray(file.profiles)) throw new Error('Invalid profiles object.');
  } catch {
    throw new Error('Local profile settings contain invalid JSON.');
  }

  const config = file.profiles && Object.hasOwn(file.profiles, name) ? file.profiles[name] : undefined;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    const available = Object.keys(file.profiles ?? {});
    throw new Error(
      `Profile "${name}" is not configured locally.\n` +
      (available.length > 0
        ? `Available profiles: ${available.join(', ')}`
        : `No profiles are configured.`),
    );
  }

  if (['publicApiUrl', 'authTenantName', 'authTenantId', 'authClientId'].some((key) => typeof config[key as keyof ProfileConfig] !== 'string'
    || !(config[key as keyof ProfileConfig] as string).trim())
    || (config.authScope !== undefined && typeof config.authScope !== 'string')
    || (config.managedDeploymentApiUrl !== undefined && typeof config.managedDeploymentApiUrl !== 'string')) {
    throw new Error('Local profile settings contain an invalid public auth/API configuration.');
  }
  if (process.platform === 'win32' && config.managedDeploymentApiUrl !== undefined) {
    throw new Error('Explicit managed profile authorization requires verified owner-controlled no-follow settings; Windows support is not qualified.');
  }
  const snapshot = Object.freeze({ ...config });
  capturedProfiles.set(key, snapshot);
  return snapshot;
}

/**
 * Save or update a local profile.
 * Creates the file and directory if they don't exist.
 */
export async function saveProfileConfig(name: string, config: ProfileConfig): Promise<void> {
  capturedProfiles.clear();
  captureGeneration += 1;
  const dir = getEaiDir();
  await mkdir(dir, { recursive: true });

  const configPath = getConfigFilePath();
  let file: ProfilesFile = { profiles: {} };
  try {
    const raw = await readFile(configPath, 'utf-8');
    file = JSON.parse(raw) as ProfilesFile;
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  file = {
    ...file,
    profiles: {
      ...file.profiles,
      [name]: config,
    },
  };

  await writeFile(configPath, JSON.stringify(file, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  capturedProfiles.clear();
  captureGeneration += 1;
}

/** Default OAuth scope when none is configured. */
export const DEFAULT_AUTH_SCOPE = 'openid profile email offline_access';

/** Public production CIAM tenant name for the default profile. */
export const DEFAULT_PROD_AUTH_TENANT_NAME = 'enterpriseaiplatform';

/** Public production CIAM tenant ID for the default profile. */
export const DEFAULT_PROD_AUTH_TENANT_ID = 'f3035369-5c1a-45f7-8ca5-5cb0ad291d26';

/** Public production CLI client ID for the default profile. */
export const DEFAULT_PROD_AUTH_CLIENT_ID = 'd704bde5-fe36-44ff-9a26-221d53772dd0';

/** Production PublicAPI delegated scope required for default-profile API calls. */
export const PROD_PUBLIC_API_SCOPE = 'api://833fc5ab-f1c9-4c60-b344-64e366f241cc/access_token';

/** Default-profile OAuth scope for production CIAM login. */
export const DEFAULT_PROD_AUTH_SCOPE = `${DEFAULT_AUTH_SCOPE} ${PROD_PUBLIC_API_SCOPE}`;
