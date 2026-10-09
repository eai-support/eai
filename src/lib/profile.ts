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

import {
  constants, closeSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync,
  readSync, realpathSync, renameSync, unlinkSync, writeFileSync, type Stats,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Command, OptionValues } from 'commander';
import { parse as parseEnv } from 'dotenv';
import { findProjectRoot } from './config.js';

// ── Types ────────────────────────────────────────────────────────────────────

/** Saved endpoints and login settings; websiteUrl optionally selects the local CLI's support website origin. */
export interface ProfileConfig {
  readonly publicApiUrl: string;
  readonly websiteUrl?: string;
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
  assertProfileName(name);
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

/** A profile selector is a local name, never a token-file path or interpolated env value. */
function assertProfileName(name: string): void {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/.test(name)) {
    throw new Error('EAI profile names must contain 1–128 letters, numbers, dots, underscores or hyphens and cannot start with a dot.');
  }
}

/** Resolve the selector before any token, auth or API configuration is loaded. */
export function resolveCommandProfile(
  command: Pick<Command, 'optsWithGlobals'>,
  environmentProfile = process.env.EAI_PROFILE,
  projectProfile?: string,
): string {
  const options = command.optsWithGlobals<OptionValues>();
  const explicitProfile = typeof options.profile === 'string'
    ? options.profile.trim()
    : '';
  const selected = explicitProfile || environmentProfile?.trim() || projectProfile?.trim() || 'default';
  assertProfileName(selected);
  return selected;
}

const MAX_PROJECT_CONTEXT_BYTES = 64 * 1024;

/** Read only the ignored app-root context, with bounded bytes and no linked/special files. */
function captureProjectProfileEnv(projectRoot: string): Record<string, string> {
  const root = realpathSync(projectRoot);
  const path = join(root, '.env.local');
  let leaf: Stats;
  try { leaf = lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  if (!leaf.isFile() || leaf.isSymbolicLink() || leaf.nlink !== 1 || leaf.size > MAX_PROJECT_CONTEXT_BYTES) {
    throw new Error('Project .env.local context must be a single-link regular file within 64 KiB.');
  }
  const parent = lstatSync(root);
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const opened = fstatSync(descriptor);
    if (!sameFile(leaf, opened)) throw new Error('Project .env.local context changed during capture.');
    const buffer = Buffer.alloc(MAX_PROJECT_CONTEXT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    const bound = lstatSync(path);
    const parentAfter = lstatSync(root);
    if (length !== opened.size || length > MAX_PROJECT_CONTEXT_BYTES
      || !sameFile(opened, fstatSync(descriptor)) || !sameFile(opened, bound)
      || parent.dev !== parentAfter.dev || parent.ino !== parentAfter.ino || parentAfter.isSymbolicLink()) {
      throw new Error('Project .env.local context changed during capture.');
    }
    const env = parseEnv(buffer.subarray(0, length));
    return Object.fromEntries(['EAI_PROFILE', 'BASE_URL_PUBLIC_API', 'ROUTING_BOOTSTRAP_PUBLIC_API_URL']
      .filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));
  } finally { closeSync(descriptor); }
}

function commandPath(command: Command): string[] {
  const path: string[] = [];
  for (let current: Command | null = command; current?.parent; current = current.parent) path.unshift(current.name());
  return path.length ? path : [command.name()];
}

function isLocalProfileDiscovery(command: Command, path: string[]): boolean {
  const options = command.optsWithGlobals();
  return ['update', 'errors', 'agent', 'blocks', 'runtime', 'gofer', 'template'].includes(path[0])
    || (path[0] === 'env' && path[1] === 'list')
    || (path[0] === 'types' && path[1] === 'validate')
    || (path.includes('source') && command.name() === 'validate')
    || (path[0] === 'start' && Boolean(options.check || options.isolationCheck || options.install || options.dryRun));
}

function normalizeProfileApi(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Project and profile PublicAPI endpoints must be HTTP(S) URLs without credentials, queries or fragments.');
  }
  return url.href.replace(/\/+$/, '');
}

/** INVARIANT: a selected profile must not send its tokens to a differently configured app runtime. */
async function assertProfileApiCoherence(profile: string, config: ProfileConfig | null, env: Record<string, string>): Promise<void> {
  const endpoints = [env.BASE_URL_PUBLIC_API, env.ROUTING_BOOTSTRAP_PUBLIC_API_URL, process.env.BASE_URL_PUBLIC_API]
    .filter((value): value is string => Boolean(value?.trim())).map(normalizeProfileApi);
  if (config) {
    const expected = normalizeProfileApi(config.publicApiUrl);
    if (endpoints.some((endpoint) => endpoint !== expected)) {
      throw new Error(`Selected profile "${profile}" does not match the project's PublicAPI configuration. Select the matching local profile, or align BASE_URL_PUBLIC_API and ROUTING_BOOTSTRAP_PUBLIC_API_URL in .env.local and your shell before continuing.`);
    }
    return;
  }
  // Default production can route among supported production regions. Existing
  // explicit local-stack/custom gateway contracts remain separate opt-ins.
  const privateEaiEndpoint = endpoints.some((endpoint) => /^(?:dev-api\.au|test-api\.(?:au|ca|eu))\.myenterprise\.ai$/.test(new URL(endpoint).hostname));
  if (privateEaiEndpoint) {
    const { resolveAuthConfig, validateResolvedAuthConfig } = await import('./auth.js');
    const auth = await resolveAuthConfig();
    const productionAuthTarget = auth.tenantName === DEFAULT_PROD_AUTH_TENANT_NAME
      && auth.tenantId === DEFAULT_PROD_AUTH_TENANT_ID && auth.authScope === DEFAULT_PROD_AUTH_SCOPE;
    if (auth.source !== 'runtime-env' || productionAuthTarget || validateResolvedAuthConfig(auth)) {
      throw new Error('This project targets a private DEV/test PublicAPI, but the default profile uses production authentication. Select its locally configured --profile, set EAI_PROFILE in your shell or ignored app-root .env.local, or provide the complete explicit CLI auth configuration before continuing.');
    }
  }
}

/** Activate the command's app context once, before command handlers can read auth or APIs. */
export async function activateCommandProfile(
  command: Command,
  environmentProfile = process.env.EAI_PROFILE,
  workingDirectory = process.cwd(),
): Promise<void> {
  const path = commandPath(command);
  const options = command.optsWithGlobals();
  const target = path[0] === 'start' && typeof command.processedArgs[0] === 'string'
    ? resolve(workingDirectory, command.processedArgs[0])
    : typeof options.projectDir === 'string' ? resolve(workingDirectory, options.projectDir) : workingDirectory;
  // These commands do not operate on platform/auth context and must remain
  // usable to inspect or repair a project with a broken selector.
  const independent = ['update', 'errors', 'agent', 'blocks'].includes(path[0]);
  const projectRoot = independent ? null : await findProjectRoot(target);
  const env = projectRoot ? captureProjectProfileEnv(projectRoot) : {};
  const profile = resolveCommandProfile(command, environmentProfile, env.EAI_PROFILE);
  setActiveProfile(profile);
  const config = captureProfileConfig(profile); // A missing named profile never falls back to default tokens.
  if (!isLocalProfileDiscovery(command, path)) await assertProfileApiCoherence(profile, config, env);
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
  assertProfileName(name);
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
  assertProfileName(name);
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

const MAX_PROFILE_BYTES = 64 * 1024;

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
    && left.mode === right.mode && left.uid === right.uid && left.nlink === right.nlink;
}

function assertPrivateFile(info: Stats): void {
  if (!info.isFile() || info.nlink !== 1 || info.size > MAX_PROFILE_BYTES
    || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
    || (process.getuid && info.uid !== process.getuid())) {
    throw new Error('Profile updates require an owner-only single-link regular file within 64 KiB.');
  }
}

function assertProfileParent(path: string, expected: Stats): void {
  const current = lstatSync(path);
  if (!current.isDirectory() || current.isSymbolicLink() || realpathSync(path) !== path
    || current.dev !== expected.dev || current.ino !== expected.ino || current.mode !== expected.mode
    || current.uid !== expected.uid || (process.platform !== 'win32' && (current.mode & 0o022) !== 0)
    || (process.getuid && current.uid !== process.getuid())) {
    throw new Error('Profile update parent must remain owned and controlled by the current user.');
  }
}

function readProfileUpdate(path: string): { raw: Buffer; info: Stats } | null {
  let leaf: Stats;
  try { leaf = lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  assertPrivateFile(leaf);
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const opened = fstatSync(descriptor);
    if (!sameFile(leaf, opened)) throw new Error('Profile settings changed during update.');
    const buffer = Buffer.alloc(MAX_PROFILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length !== opened.size || !sameFile(opened, fstatSync(descriptor)) || !sameFile(opened, lstatSync(path))) {
      throw new Error('Profile settings changed during update.');
    }
    return { raw: buffer.subarray(0, length), info: opened };
  } finally { closeSync(descriptor); }
}

/** SECURITY: config.json.lock is shared with other profile writers; contention fails without stale takeover. */
export async function saveProfileConfig(name: string, config: ProfileConfig): Promise<void> {
  assertProfileName(name);
  capturedProfiles.clear();
  captureGeneration += 1;
  if (!constants.O_NOFOLLOW && process.platform !== 'win32') throw new Error('No-follow profile updates are unavailable.');
  const dir = join(realpathSync(homedir()), '.eai');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const parent = lstatSync(dir);
  assertProfileParent(dir, parent);
  const configPath = join(dir, 'config.json');
  const lockPath = configPath + '.lock';
  const lockBytes = Buffer.from(JSON.stringify({ schema: 'eai.profile-config-writer-lock.v1', nonce: randomUUID(), pid: process.pid }) + '\n');
  let lock: number;
  try {
    lock = openSync(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  } catch (cause) {
    throw new Error('Profile settings are locked or unsafe; retry after the active writer finishes. No stale lock is removed automatically.', { cause });
  }
  let ownedLock: Stats | undefined;
  let temporary: { path: string; info: Stats } | undefined;
  const assertLock = (): void => {
    assertProfileParent(dir, parent);
    const bound = lstatSync(lockPath);
    const content = Buffer.alloc(lockBytes.length);
    if (!ownedLock || !sameFile(ownedLock, bound) || !sameFile(ownedLock, fstatSync(lock))
      || readSync(lock, content, 0, content.length, 0) !== content.length || !content.equals(lockBytes)) {
      throw new Error('Profile writer lock ownership changed; no foreign lock is removed.');
    }
  };
  try {
    assertPrivateFile(fstatSync(lock));
    writeFileSync(lock, lockBytes);
    fsyncSync(lock);
    ownedLock = fstatSync(lock);
    assertLock();
    const before = readProfileUpdate(configPath);
    const file = before ? JSON.parse(before.raw.toString('utf8')) as ProfilesFile : { profiles: {} };
    if (!file || typeof file !== 'object' || Array.isArray(file) || !file.profiles
      || typeof file.profiles !== 'object' || Array.isArray(file.profiles)) {
      throw new Error('Local profile settings contain an invalid profiles object; refusing to overwrite.');
    }
    const prior = Object.hasOwn(file.profiles, name) ? file.profiles[name] : undefined;
    if (prior !== undefined && (!prior || typeof prior !== 'object' || Array.isArray(prior))) {
      throw new Error('Local profile settings contain an invalid profile; refusing to overwrite.');
    }
    const knownFields = new Set(['publicApiUrl', 'authTenantName', 'authTenantId', 'authClientId', 'authScope', 'managedDeploymentApiUrl']);
    const preserved = Object.fromEntries(Object.entries(prior ?? {}).filter(([key]) => !knownFields.has(key)));
    const output = JSON.stringify({ ...file, profiles: { ...file.profiles, [name]: { ...preserved, ...config } } }, null, 2) + '\n';
    if (Buffer.byteLength(output) > MAX_PROFILE_BYTES) throw new Error('Profile settings exceed 64 KiB.');
    const path = join(dir, `.config-${randomUUID()}.tmp`);
    const descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
    temporary = { path, info: fstatSync(descriptor) };
    try { writeFileSync(descriptor, output, 'utf8'); fsyncSync(descriptor); }
    finally { temporary.info = fstatSync(descriptor); closeSync(descriptor); }
    const current = readProfileUpdate(configPath);
    if (before ? !current || !sameFile(before.info, current.info) || !before.raw.equals(current.raw) : current !== null) {
      throw new Error('Profile settings changed during update; retry explicitly.');
    }
    assertLock();
    if (!sameFile(temporary.info, lstatSync(path))) throw new Error('Profile update temporary file changed.');
    renameSync(path, configPath);
    temporary = undefined;
  } finally {
    try {
      if (temporary) {
        assertProfileParent(dir, parent);
        if (sameFile(temporary.info, lstatSync(temporary.path))) unlinkSync(temporary.path);
      }
    } finally {
      try { assertLock(); unlinkSync(lockPath); }
      finally { closeSync(lock); capturedProfiles.clear(); captureGeneration += 1; }
    }
  }
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
