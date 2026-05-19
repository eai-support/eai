/**
 * Profile management — environment switching for dev/test/prod.
 *
 * Default profile ("default") uses legacy behavior: no config file,
 * tokens at ~/.eai/tokens.json. Named profiles (e.g. "dev", "test")
 * read config from ~/.eai/config.json and store tokens at
 * ~/.eai/tokens/{name}.json.
 *
 * Module-level state pattern (same as setSimpleMode in output.ts)
 * avoids threading profile through 20+ command action handlers.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProfileConfig {
  readonly publicApiUrl: string;
  readonly authTenantName: string;
  readonly authTenantId: string;
  readonly authClientId: string;
  readonly authScope?: string;
}

interface ProfilesFile {
  activeProfile?: string;
  readonly profiles: Record<string, ProfileConfig>;
}

// ── Module-level state ───────────────────────────────────────────────────────

let _activeProfileName = 'default';

export function setActiveProfile(name: string): void {
  _activeProfileName = name;
}

export function getActiveProfile(): string {
  return _activeProfileName;
}

// ── Paths ────────────────────────────────────────────────────────────────────

/**
 * Root directory for CLI state (config + tokens).
 * Defaults to `~/.eai`. Override with `EAI_PROFILE_DIR` for headless/parallel
 * test runners that must avoid collisions on the user's home directory.
 */
function getEaiDir(): string {
  return process.env.EAI_PROFILE_DIR || join(homedir(), '.eai');
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
 * Load config for a named profile from ~/.eai/config.json.
 *
 * Returns null for the "default" profile (legacy behavior — no config needed).
 * Throws if the config file or requested profile is missing.
 */
export async function loadProfileConfig(name: string): Promise<ProfileConfig | null> {
  if (name === 'default') return null;

  const configPath = getConfigFilePath();
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    throw new Error(
      `Profile "${name}" requires ~/.eai/config.json but the file does not exist.\n` +
      `See .tech-docs/profiles.md for setup instructions.`,
    );
  }

  let file: ProfilesFile;
  try {
    file = JSON.parse(raw) as ProfilesFile;
  } catch {
    throw new Error(`~/.eai/config.json contains invalid JSON.`);
  }

  const config = file.profiles?.[name];
  if (!config) {
    const available = Object.keys(file.profiles ?? {});
    throw new Error(
      `Profile "${name}" not found in ~/.eai/config.json.\n` +
      (available.length > 0
        ? `Available profiles: ${available.join(', ')}`
        : `No profiles are configured.`),
    );
  }

  return config;
}

/**
 * Save or update a profile in ~/.eai/config.json.
 * Creates the file and directory if they don't exist.
 */
export async function saveProfileConfig(name: string, config: ProfileConfig): Promise<void> {
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
}

/**
 * Read the activeProfile field from ~/.eai/config.json.
 * Returns "default" if the file doesn't exist or has no activeProfile.
 */
export async function loadActiveProfileFromConfig(): Promise<string> {
  try {
    const raw = await readFile(getConfigFilePath(), 'utf-8');
    const file = JSON.parse(raw) as ProfilesFile;
    return file.activeProfile ?? 'default';
  } catch {
    return 'default';
  }
}

/**
 * Persist the active profile name in ~/.eai/config.json.
 * Called on `eai --profile dev login` so subsequent commands remember the profile.
 * Setting to "default" removes the activeProfile field.
 */
export async function saveActiveProfileToConfig(name: string): Promise<void> {
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

  if (name === 'default') {
    delete file.activeProfile;
  } else {
    file = { ...file, activeProfile: name };
  }

  await writeFile(configPath, JSON.stringify(file, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

/** Default OAuth scope when none is configured. */
export const DEFAULT_AUTH_SCOPE = 'openid profile email offline_access';

/** Production PublicAPI delegated scope required for default-profile API calls. */
export const PROD_PUBLIC_API_SCOPE = 'api://833fc5ab-f1c9-4c60-b344-64e366f241cc/access_token';

/** Default-profile OAuth scope for production CIAM login. */
export const DEFAULT_PROD_AUTH_SCOPE = `${DEFAULT_AUTH_SCOPE} ${PROD_PUBLIC_API_SCOPE}`;
