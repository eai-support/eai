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
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Command, OptionValues } from 'commander';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProfileConfig {
  readonly publicApiUrl: string;
  readonly authTenantName: string;
  readonly authTenantId: string;
  readonly authClientId: string;
  readonly authScope?: string;
}

interface ProfilesFile {
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
  if (name === 'default') return null;

  const configPath = getConfigFilePath();
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    throw new Error(
      `Profile "${name}" requires local profile settings but they are not configured.`,
    );
  }

  let file: ProfilesFile;
  try {
    file = JSON.parse(raw) as ProfilesFile;
  } catch {
    throw new Error('Local profile settings contain invalid JSON.');
  }

  const config = file.profiles?.[name];
  if (!config) {
    const available = Object.keys(file.profiles ?? {});
    throw new Error(
      `Profile "${name}" is not configured locally.\n` +
      (available.length > 0
        ? `Available profiles: ${available.join(', ')}`
        : `No profiles are configured.`),
    );
  }

  return config;
}

/**
 * Save or update a local profile.
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
