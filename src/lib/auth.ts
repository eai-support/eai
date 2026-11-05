/**
 * Authentication module — Entra CIAM browser auth (authorization code + PKCE)
 * plus token storage/refresh.
 *
 * Tokens are stored per-profile: ~/.eai/tokens.json (default) or
 * ~/.eai/tokens/{profile}.json (named profiles). Encrypted with AES-256-CBC.
 * For production, this would use OS keychain via keytar, but we avoid
 * the native dependency for now.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { createServer } from 'node:http';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { URL } from 'node:url';
import type { AddressInfo } from 'node:net';
import {
  getActiveProfile,
  getProfileTokensFile,
  loadProfileConfig,
  DEFAULT_AUTH_SCOPE,
  DEFAULT_PROD_AUTH_SCOPE,
  DEFAULT_PROD_AUTH_TENANT_NAME,
  DEFAULT_PROD_AUTH_TENANT_ID,
  DEFAULT_PROD_AUTH_CLIENT_ID,
  DEFAULT_PROD_AUTH_COMPANY_CLIENT_ID,
} from './profile.js';
import { isExpectedCallbackHost, isGuid } from './company-sign-in.js';

function getTokensFile(profile = getActiveProfile()): string {
  return getProfileTokensFile(profile);
}

function getEncryptionKeySource(): string {
  return `eai-${homedir()}-token-store`;
}

function getLegacyEncryptionKeySource(): string {
  return `${['eai', 'cli'].join('-')}-${homedir()}-token-store`;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tenantId: string;
  tenantName: string;
  clientId: string;
  authScope?: string;
  upn?: string;
  oid?: string;
  activeTenantId?: string;
  activeTenantName?: string;
  activeTenantSlug?: string;
  activeTenantDomain?: string;
  activeTenantHomeRegion?: string | null;
  activeTenantHqCountryCode?: string | null;
  publicApiUrl?: string;
  membershipsCachedAt?: number;
}

// Module-level cache — keyed by profile name so concurrent profile reads don't collide
const _cache: Map<string, StoredTokens> = new Map();

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  /** Read only for the account confirmation; never stored. */
  id_token?: string;
}

interface PkceValues {
  codeVerifier: string;
  codeChallenge: string;
}

/** Knobs for the browser PKCE sign-in: a fixed callback port, an OpenID prompt override and the wait. */
export interface BrowserLoginOptions {
  callbackPort?: number;
  onAuthorizeUrl?: (url: string) => void;
  /**
   * OpenID Connect `prompt` value for the direct path. `select_account`
   * interrupts single sign-on and shows the account picker, so a browser
   * already signed in to the wrong account cannot be taken silently. The
   * `--company` path always sends `prompt=login` instead.
   */
  prompt?: 'select_account';
  /** How long to wait for the browser; five minutes unless a test shortens it. */
  timeoutMs?: number;
}

/** A finished `--company` sign-in, before the caller decides whether to save it. */
export interface SignInResult {
  readonly tokens: StoredTokens;
  /** The token's `email` claim (access token, then ID token), for the account confirmation only. */
  readonly signedInEmail?: string;
}

export interface ResolvedAuthConfig {
  tenantName: string;
  tenantId: string;
  clientId: string;
  authScope: string;
  source: 'default-prod' | 'runtime-env' | 'profile';
  clientIdSource: 'default-prod' | 'runtime-env' | 'profile';
  /** A named profile's company sign-in client (GUID-validated when the profile is read). */
  authCompanyClientId?: string;
}

/** Where `eai login --company` found the company sign-in app for this sign-in directory. */
export interface CompanyClientResolution {
  readonly clientId: string;
  readonly source: 'profile' | 'runtime-env' | 'default-prod';
}

export interface CompanyClientOptions {
  /** True when `--tenant-name` or `--tenant-id` was given: the PROD default never applies then. */
  readonly tenantFlagsGiven?: boolean;
  readonly env?: Record<string, string | undefined>;
  /** Test seam; defaults to DEFAULT_PROD_AUTH_COMPANY_CLIENT_ID, which stays unset until the PROD app is pinned. */
  readonly prodDefaultClientId?: string;
}

/** Shown when no company sign-in app resolves for the active sign-in directory. */
export const COMPANY_SIGN_IN_NOT_SET_UP = "Company sign-in isn't set up for this environment yet.";

function getEncryptionKey(source = getEncryptionKeySource()): Buffer {
  return createHash('sha256').update(source).digest();
}

function normalizeEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeAuthScope(scope: string): string {
  return scope
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(' ');
}

function readFirstEnvValue(env: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeEnvValue(env[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function buildDefaultAuthScopeForAudience(audienceScope: string): string {
  return normalizeAuthScope(`${DEFAULT_AUTH_SCOPE} ${audienceScope}`);
}

async function loadRuntimeAuthEnv(): Promise<Record<string, string>> {
  return { ...process.env } as Record<string, string>;
}

function resolveDefaultProfileAuthScopeFromEnv(env: Record<string, string>): string | undefined {
  const explicitScope = readFirstEnvValue(env, [
    'EAI_AUTH_SCOPE',
  ]);
  if (explicitScope) {
    return normalizeAuthScope(explicitScope);
  }

  const delegatedScope = readFirstEnvValue(env, [
    'EAI_PUBLIC_API_SCOPE',
  ]);
  if (delegatedScope) {
    return buildDefaultAuthScopeForAudience(delegatedScope);
  }

  return undefined;
}

function resolveDefaultProfileClientId(env: Record<string, string>): {
  clientId: string;
  source: ResolvedAuthConfig['clientIdSource'];
} {
  const explicitClientId = readFirstEnvValue(env, [
    'EAI_CLI_CLIENT_ID',
    'EAI_AUTH_CLIENT_ID',
  ]);
  if (explicitClientId) {
    return { clientId: explicitClientId, source: 'runtime-env' };
  }
  return { clientId: DEFAULT_PROD_AUTH_CLIENT_ID, source: 'default-prod' };
}

export function extractAudienceHintsFromScope(scope: string): string[] {
  const hints = new Set<string>();

  for (const rawPart of normalizeAuthScope(scope).split(' ')) {
    if (!rawPart || ['openid', 'profile', 'email', 'offline_access'].includes(rawPart)) {
      continue;
    }

    let normalized = rawPart;
    if (normalized.endsWith('/.default')) {
      normalized = normalized.slice(0, -'/.default'.length);
    } else if (normalized.endsWith('/access_token')) {
      normalized = normalized.slice(0, -'/access_token'.length);
    }

    hints.add(normalized);
    if (normalized.startsWith('api://')) {
      const withoutScheme = normalized.slice('api://'.length);
      if (withoutScheme) {
        hints.add(withoutScheme);
      }
    }
  }

  return [...hints];
}

export async function resolveAuthConfig(
  projectRoot?: string,
  profile = getActiveProfile(),
): Promise<ResolvedAuthConfig> {
  if (profile !== 'default') {
    const config = await loadProfileConfig(profile);
    if (!config) {
      throw new Error(`Profile "${profile}" is not configured locally.`);
    }
    return {
      tenantName: config.authTenantName,
      tenantId: config.authTenantId,
      clientId: config.authClientId,
      authScope: normalizeAuthScope(config.authScope || DEFAULT_AUTH_SCOPE),
      source: 'profile',
      clientIdSource: 'profile',
      ...(config.authCompanyClientId ? { authCompanyClientId: config.authCompanyClientId } : {}),
    };
  }

  const env = await loadRuntimeAuthEnv();
  const tenantName = readFirstEnvValue(env, [
    'EAI_AUTH_TENANT_NAME',
  ]) || DEFAULT_PROD_AUTH_TENANT_NAME;
  const tenantId = readFirstEnvValue(env, [
    'EAI_AUTH_TENANT_ID',
  ]) || DEFAULT_PROD_AUTH_TENANT_ID;
  const authScope = resolveDefaultProfileAuthScopeFromEnv(env) || DEFAULT_PROD_AUTH_SCOPE;
  const { clientId, source: clientIdSource } = resolveDefaultProfileClientId(env);

  const source = (
    tenantName !== DEFAULT_PROD_AUTH_TENANT_NAME
    || tenantId !== DEFAULT_PROD_AUTH_TENANT_ID
    || authScope !== DEFAULT_PROD_AUTH_SCOPE
    || clientIdSource === 'runtime-env'
  ) ? 'runtime-env' : 'default-prod';

  return {
    tenantName,
    tenantId,
    clientId,
    authScope,
    source,
    clientIdSource,
  };
}

export function validateResolvedAuthConfig(config: ResolvedAuthConfig): string | null {
  const isNonProdOverride = config.source === 'runtime-env' && (
    config.tenantName !== DEFAULT_PROD_AUTH_TENANT_NAME
    || config.tenantId !== DEFAULT_PROD_AUTH_TENANT_ID
    || config.authScope !== DEFAULT_PROD_AUTH_SCOPE
  );

  if (isNonProdOverride && config.clientIdSource === 'default-prod') {
    return [
      'This environment overrides Entra/PublicAPI auth away from the public production defaults,',
      'but no CLI public client ID was provided.',
      'Set `EAI_CLI_CLIENT_ID` (or `EAI_AUTH_CLIENT_ID`) in your shell/devcontainer,',
      'or use a named `eai --profile ...` config with `authClientId`.',
    ].join(' ');
  }

  return null;
}

/** The public PROD sign-in target exactly: the same bundle validateResolvedAuthConfig treats as the defaults. */
function isPublicProdAuthTarget(config: Pick<ResolvedAuthConfig, 'tenantName' | 'tenantId' | 'authScope'>): boolean {
  return config.tenantName === DEFAULT_PROD_AUTH_TENANT_NAME
    && config.tenantId === DEFAULT_PROD_AUTH_TENANT_ID
    && config.authScope === DEFAULT_PROD_AUTH_SCOPE;
}

/**
 * Resolve the CLI company sign-in app for the active sign-in directory, in
 * order: the profile's `authCompanyClientId`, then `EAI_CLI_COMPANY_CLIENT_ID`,
 * then the PROD constant. Returns `null` when none applies.
 *
 * INVARIANT: like validateResolvedAuthConfig, the PROD constant is used only
 * for the public PROD target (directory, name and scope) and never with
 * `--tenant-*` flags, so a PROD app ID is never sent to another directory.
 */
export function resolveCompanyClient(
  config: Pick<ResolvedAuthConfig, 'tenantName' | 'tenantId' | 'authScope' | 'authCompanyClientId'>,
  options: CompanyClientOptions = {},
): CompanyClientResolution | null {
  if (config.authCompanyClientId) {
    return { clientId: config.authCompanyClientId, source: 'profile' };
  }

  const fromEnv = normalizeEnvValue((options.env ?? process.env).EAI_CLI_COMPANY_CLIENT_ID);
  if (fromEnv) {
    if (!isGuid(fromEnv)) {
      throw new Error('EAI_CLI_COMPANY_CLIENT_ID must be the company sign-in app\'s client ID (a GUID).');
    }
    return { clientId: fromEnv, source: 'runtime-env' };
  }

  const prodDefault = Object.hasOwn(options, 'prodDefaultClientId')
    ? options.prodDefaultClientId
    : DEFAULT_PROD_AUTH_COMPANY_CLIENT_ID;
  if (prodDefault && !options.tenantFlagsGiven && isPublicProdAuthTarget(config)) {
    return { clientId: prodDefault, source: 'default-prod' };
  }
  return null;
}

export async function getActiveAuthConfigMismatch(
  tokens?: StoredTokens,
  projectRoot?: string,
): Promise<string | null> {
  const currentTokens = tokens ?? await loadTokens();
  if (!currentTokens) {
    return null;
  }

  const authConfig = await resolveAuthConfig(projectRoot);
  const loginIssue = validateResolvedAuthConfig(authConfig);
  if (loginIssue) {
    return loginIssue;
  }

  const mismatches: string[] = [];
  if (currentTokens.tenantId !== authConfig.tenantId) {
    mismatches.push(`authority tenant id ${currentTokens.tenantId} != ${authConfig.tenantId}`);
  }
  if (currentTokens.tenantName !== authConfig.tenantName) {
    mismatches.push(`authority tenant ${currentTokens.tenantName} != ${authConfig.tenantName}`);
  }
  // A login is valid with this directory's ordinary CLI app or its company
  // sign-in app; any other stored client is still a mismatch.
  let companyClientId: string | undefined;
  try {
    companyClientId = resolveCompanyClient(authConfig)?.clientId;
  } catch {
    companyClientId = undefined;
  }
  if (currentTokens.clientId !== authConfig.clientId && currentTokens.clientId !== companyClientId) {
    mismatches.push(companyClientId
      ? `client id ${currentTokens.clientId} is neither ${authConfig.clientId} nor the company sign-in client ${companyClientId}`
      : `client id ${currentTokens.clientId} != ${authConfig.clientId}`);
  }

  const tokenAudience = parseJwtClaim(currentTokens.accessToken, 'aud');
  const expectedAudiences = extractAudienceHintsFromScope(authConfig.authScope);
  if (tokenAudience && expectedAudiences.length > 0 && !expectedAudiences.includes(tokenAudience)) {
    mismatches.push(`token audience ${tokenAudience} is not one of ${expectedAudiences.join(', ')}`);
  }

  if (mismatches.length === 0) {
    return null;
  }

  return [
    'Stored CLI login does not match the active auth configuration for this environment.',
    `Current auth target: tenant=${authConfig.tenantName} (${authConfig.tenantId}), client=${authConfig.clientId}`,
    tokenAudience ? `Stored token audience: ${tokenAudience}` : 'Stored token audience: unavailable',
    `Mismatch: ${mismatches.join('; ')}`,
    'Run `eai login` again for this environment before using workspace or provisioning commands.',
  ].join(' ');
}

async function resolveAuthScope(profile: string): Promise<string> {
  try {
    return (await resolveAuthConfig(undefined, profile)).authScope;
  } catch {
    return profile === 'default' ? DEFAULT_PROD_AUTH_SCOPE : DEFAULT_AUTH_SCOPE;
  }
}

async function ensureDir(tokensFile: string): Promise<void> {
  await mkdir(dirname(tokensFile), { recursive: true });
}

function encrypt(data: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(data, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

function decrypt(data: string): string {
  const sources = [getEncryptionKeySource(), getLegacyEncryptionKeySource()];
  let lastError: unknown;

  for (const source of sources) {
    try {
      return decryptWithKey(data, getEncryptionKey(source));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function decryptWithKey(data: string, key: Buffer): string {
  const [ivHex, encrypted] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
}

export async function storeTokens(tokens: StoredTokens): Promise<void> {
  const profile = getActiveProfile();
  const tokensFile = getTokensFile(profile);
  await ensureDir(tokensFile);
  const encrypted = encrypt(JSON.stringify(tokens));
  await writeFile(tokensFile, encrypted, { encoding: 'utf-8', mode: 0o600 });
  _cache.set(profile, tokens);
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const profile = getActiveProfile();
  const cached = _cache.get(profile);
  if (cached) return cached;
  const tokensFile = getTokensFile(profile);
  try {
    const encrypted = await readFile(tokensFile, 'utf-8');
    const decrypted = decrypt(encrypted);
    const tokens: StoredTokens = JSON.parse(decrypted);
    // Backfill oid from JWT if missing (tokens stored before this field was added)
    if (!tokens.oid && tokens.accessToken) {
      tokens.oid = parseJwtClaim(tokens.accessToken, 'oid') || undefined;
    }
    if (!tokens.authScope) {
      tokens.authScope = await resolveAuthScope(profile);
    }
    _cache.set(profile, tokens);
    return tokens;
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  const profile = getActiveProfile();
  const tokensFile = getTokensFile(profile);
  _cache.delete(profile);
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(tokensFile);
  } catch (err) {
    if (!(err instanceof Error) || !('code' in err) || (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Check if we have a valid (non-expired) access token.
 */
export async function isAuthenticated(): Promise<boolean> {
  if (process.env.EAI_ACCESS_TOKEN) return true;
  const tokens = await loadTokens();
  if (!tokens) return false;
  return tokens.expiresAt > Date.now();
}

/**
 * Get the current access token, refreshing if expired.
 * Supports EAI_ACCESS_TOKEN env var for headless/server use.
 */
export async function getAccessToken(): Promise<string | null> {
  const envToken = process.env.EAI_ACCESS_TOKEN;
  if (envToken) return envToken;

  const tokens = await loadTokens();
  if (!tokens) return null;

  // Token still valid (with 5 min buffer)
  if (tokens.expiresAt > Date.now() + 300_000) {
    return tokens.accessToken;
  }

  // Try refresh
  if (tokens.refreshToken) {
    try {
      const refreshed = await refreshAccessToken(tokens);
      if (refreshed) {
        await storeTokens(refreshed);
        return refreshed.accessToken;
      }
    } catch {
      // Refresh failed (network error or server rejection) — caller treats user as unauthenticated
      return null;
    }
  }

  return null;
}

function buildStoredTokens(
  token: TokenResponse,
  tenantId: string,
  tenantName: string,
  clientId: string,
  authScope: string,
): StoredTokens {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    tenantId,
    tenantName,
    clientId,
    authScope,
    upn: parseJwtDisplayIdentity(token.access_token),
    oid: parseJwtClaim(token.access_token, 'oid') || undefined,
  };
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generatePkce(): PkceValues {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

function isValidCallbackPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function resolveCallbackPort(options: BrowserLoginOptions = {}): number {
  if (options.callbackPort !== undefined && !isValidCallbackPort(options.callbackPort)) {
    throw new Error('Callback port must be an integer between 1 and 65535.');
  }

  return options.callbackPort ?? 0;
}

export function getBrowserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') {
    // Use the URL protocol handler directly so cmd.exe does not strip query params like "&scope=...".
    return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  }
  return { command: 'xdg-open', args: [url] };
}

async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const opener = getBrowserOpenCommand(url);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(opener.command, opener.args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Failed to open browser (exit code ${code ?? 'unknown'})`));
    });
  });
}

/** One authorize request the CLI waits on: its app, state and PKCE verifier. */
interface PendingAuthorization {
  readonly clientId: string;
  readonly state: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

interface BrowserLoginResult {
  readonly code: string;
  readonly authorization: PendingAuthorization;
}

interface CallbackServer {
  readonly port: number;
  readonly redirectUri: string;
  readonly waitForResult: Promise<BrowserLoginResult>;
  /** Accept this authorize request on `/` (direct and --company set it before opening the browser). */
  expect: (authorization: PendingAuthorization) => void;
  close: () => Promise<void>;
}

const CALLBACK_MISMATCH = "This sign-in doesn't match the CLI that started it.";

// Sent on every local response: the pages and the URLs (which carry a code,
// state or email) must not be cached or leak through a Referer header.
const HARDENED_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const;

/*
 * The CLI's local callback server (Issues2025#3458, plan §7). The CLI always
 * does the OAuth itself.
 *
 * eai login --company:   new auth state A + PKCE → open authorize(company app, A, S256, prompt=login)
 *
 * GET /?code&state=A           (or ?error&state=A)
 *   ├─ Host header not localhost:PORT ............ 400, keep waiting
 *   ├─ state != current auth state A ............ 400, keep waiting (an error without A is ignored)
 *   └─ ok → redeem with that client + verifier
 *          → email claim == typed email (case-insensitive)? store
 *            : terminal "Signed in as X (typed Y). Save? [y/N]" → y: store / n: discard, exit 1
 * Every response: Cache-Control: no-store, Referrer-Policy: no-referrer
 *
 * The direct path (`eai login --direct`, browserLogin) uses the same server
 * with one auth state and today's authorize request.
 */
async function startBrowserCallbackServer(
  timeoutMs: number,
  options: BrowserLoginOptions = {},
): Promise<CallbackServer> {
  const server = createServer();
  let closed = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: PendingAuthorization | undefined;
  let boundPort = 0;
  const callbackPort = resolveCallbackPort(options);

  let resolveResult!: (value: BrowserLoginResult) => void;
  let rejectResult!: (reason?: Error) => void;

  const waitForResult = new Promise<BrowserLoginResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // The wait can end (an error callback, a timeout) while the
  // caller is still opening the browser; the caller awaits it right after.
  waitForResult.catch(() => undefined);

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    await new Promise<void>((resolve, reject) => {
      server.close(err => {
        if (err) reject(err);
        else resolve();
      });
    }).catch(() => undefined);
  };

  const settle = (outcome: { result: BrowserLoginResult } | { error: Error }): void => {
    if (settled) return;
    settled = true;
    if ('result' in outcome) resolveResult(outcome.result);
    else rejectResult(outcome.error);
    void close();
  };

  server.on('request', (req, res) => {
    const reply = (status: number, body: string, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { ...HARDENED_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers });
      res.end(body);
    };

    if (settled) {
      reply(410, 'This sign-in has already finished. Return to the terminal.');
      return;
    }
    if (!isExpectedCallbackHost(req.headers.host, boundPort)) {
      reply(400, CALLBACK_MISMATCH);
      return;
    }
    if (req.method !== 'GET') {
      reply(405, 'Only GET is supported.', { Allow: 'GET' });
      return;
    }

    const reqUrl = new URL(req.url || '/', `http://localhost:${boundPort}`);
    if (reqUrl.pathname !== '/') {
      reply(404, 'Not found.');
      return;
    }

    const states = reqUrl.searchParams.getAll('state');
    if (!current || states.length !== 1 || states[0] !== current.state) {
      // Includes an `error` without the current auth state: it is ignored.
      reply(400, CALLBACK_MISMATCH);
      return;
    }

    const error = reqUrl.searchParams.get('error');
    if (error) {
      const errorDescription = reqUrl.searchParams.get('error_description');
      reply(200, 'Login failed. Return to the terminal.');
      settle({ error: new Error(`Authorization failed: ${error} — ${errorDescription || 'no description'}`) });
      return;
    }

    const code = reqUrl.searchParams.get('code');
    if (!code) {
      reply(400, 'Missing code in callback. Please retry login.');
      return;
    }

    reply(200, 'Login successful. Return to the terminal.');
    settle({ result: { code, authorization: current } });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(callbackPort, 'localhost', () => {
      server.off('error', reject);
      resolve();
    });
  }).catch((error: unknown) => {
    if (
      callbackPort !== 0 &&
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
    ) {
      throw new Error(
        `Callback port ${callbackPort} is already in use. Choose a different port, ` +
        `restart your local port forward, and retry login.`,
      );
    }
    throw error;
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await close();
    throw new Error('Unable to determine local callback port.');
  }
  boundPort = (address as AddressInfo).port;

  timer = setTimeout(() => {
    settle({
      error: new Error(
        callbackPort === 0
          ? 'Timed out waiting for browser authentication callback.'
          : `Timed out waiting for browser authentication callback on localhost:${callbackPort}. ` +
            codespacesForwardHint(callbackPort),
      ),
    });
  }, timeoutMs);

  server.on('error', err => {
    settle({ error: err instanceof Error ? err : new Error(String(err)) });
  });

  return {
    port: boundPort,
    redirectUri: `http://localhost:${boundPort}`,
    waitForResult,
    expect: (authorization) => { current = authorization; },
    close,
  };
}

function codespacesForwardHint(callbackPort: number): string {
  return `If you are in Codespaces, make sure \`gh codespace ports forward ${callbackPort}:${callbackPort}\` ` +
    'is still running on your local machine.';
}

function authorityFor(tenantName: string, tenantId: string): string {
  return `https://${tenantName}.ciamlogin.com/${tenantId}`;
}

function newAuthorization(clientId: string, stateBytes: number): PendingAuthorization {
  const { codeVerifier, codeChallenge } = generatePkce();
  return {
    clientId,
    state: base64UrlEncode(randomBytes(stateBytes)),
    codeVerifier,
    codeChallenge,
  };
}

interface AuthorizeExtras {
  readonly prompt?: 'login' | 'select_account';
}

function buildAuthorizeUrl(
  authority: string,
  authorization: PendingAuthorization,
  redirectUri: string,
  scope: string,
  extras: AuthorizeExtras = {},
): string {
  const authorizeUrl = new URL(`${authority}/oauth2/v2.0/authorize`);
  authorizeUrl.searchParams.set('client_id', authorization.clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_mode', 'query');
  authorizeUrl.searchParams.set('scope', scope);
  authorizeUrl.searchParams.set('state', authorization.state);
  authorizeUrl.searchParams.set('code_challenge', authorization.codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  if (extras.prompt) authorizeUrl.searchParams.set('prompt', extras.prompt);
  return authorizeUrl.toString();
}

/** The `email` claim for the account confirmation: access token first, then the ID token from the same response. */
function readEmailClaim(token: TokenResponse): string | undefined {
  for (const jwt of [token.access_token, token.id_token]) {
    if (!jwt) continue;
    const email: unknown = parseJwtClaim(jwt, 'email');
    if (typeof email === 'string' && email.trim()) return email.trim();
  }
  return undefined;
}

/** Redeem the code with the client and verifier of the authorize request that produced it. */
async function finishSignIn(
  authority: string,
  tenantId: string,
  tenantName: string,
  scope: string,
  redirectUri: string,
  result: BrowserLoginResult,
): Promise<SignInResult> {
  const tokenRes = await fetch(`${authority}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: result.authorization.clientId,
      grant_type: 'authorization_code',
      code: result.code,
      redirect_uri: redirectUri,
      code_verifier: result.authorization.codeVerifier,
      scope,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    const error = tokenData?.error || 'token_exchange_failed';
    const description = tokenData?.error_description || 'No description provided';
    throw new Error(`Token exchange failed: ${error} — ${description}`);
  }

  const token = tokenData as TokenResponse;
  const signedInEmail = readEmailClaim(token);
  // Return tokens without writing — caller writes once after confirming the account and resolving tenant context
  return {
    tokens: buildStoredTokens(token, tenantId, tenantName, result.authorization.clientId, scope),
    ...(signedInEmail ? { signedInEmail } : {}),
  };
}

async function signInWithAuthorizeRequest(
  tenantName: string,
  tenantId: string,
  clientId: string,
  scope: string,
  options: BrowserLoginOptions,
  mode: { readonly stateBytes: number; readonly prompt?: 'login' | 'select_account' },
): Promise<SignInResult> {
  const authority = authorityFor(tenantName, tenantId);
  const callbackServer = await startBrowserCallbackServer(options.timeoutMs ?? 300_000, options);
  try {
    const authorization = newAuthorization(clientId, mode.stateBytes);
    callbackServer.expect(authorization);
    const authorizeUrl = buildAuthorizeUrl(authority, authorization, callbackServer.redirectUri, scope, { prompt: mode.prompt });
    options.onAuthorizeUrl?.(authorizeUrl);

    try {
      await openBrowser(authorizeUrl);
    } catch (err) {
      // The caller has already shown the URL. Keep the callback server alive
      // for remote terminals, such as Codespaces, where automatic browser
      // opening may fail but the user can paste the URL into a local browser.
      if (!options.onAuthorizeUrl) {
        throw new Error(
          `Failed to open browser automatically. Open this URL manually: ${authorizeUrl}`,
          { cause: err },
        );
      }
    }

    const result = await callbackServer.waitForResult;
    return await finishSignIn(authority, tenantId, tenantName, scope, callbackServer.redirectUri, result);
  } finally {
    await callbackServer.close();
  }
}

/**
 * Initiate browser-based authorization code flow with PKCE for Entra CIAM.
 *
 * This is the direct path (`eai login --direct`): today's authorize request
 * with the directory's ordinary CLI app and no Portal; `prompt` is sent only
 * for `--switch-account`.
 */
export async function browserLogin(
  tenantName: string,
  tenantId: string,
  clientId: string,
  scope: string,
  options: BrowserLoginOptions = {},
): Promise<StoredTokens> {
  const { tokens } = await signInWithAuthorizeRequest(tenantName, tenantId, clientId, scope, options, {
    stateBytes: 16,
    prompt: options.prompt,
  });
  return tokens;
}

/**
 * `eai login --company`: open the company sign-in app's authorize request
 * directly (no Portal), with PKCE S256 and `prompt=login` so a shared school
 * device always asks for the password. The caller confirms the account and
 * stores the tokens with the company client ID, which refresh then reuses.
 */
export async function companyLogin(
  tenantName: string,
  tenantId: string,
  companyClientId: string,
  scope: string,
  options: Omit<BrowserLoginOptions, 'prompt'> = {},
): Promise<SignInResult> {
  return signInWithAuthorizeRequest(tenantName, tenantId, companyClientId, scope, options, {
    stateBytes: 32,
    prompt: 'login',
  });
}

/**
 * Refresh an access token using the refresh token.
 */
async function refreshAccessToken(tokens: StoredTokens): Promise<StoredTokens | null> {
  if (!tokens.refreshToken || !tokens.clientId) return null;

  const authority = `https://${tokens.tenantName}.ciamlogin.com/${tokens.tenantId}`;
  const scope = tokens.authScope || await resolveAuthScope(getActiveProfile());

  const res = await fetch(`${authority}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: tokens.clientId,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      scope,
    }),
  });

  if (!res.ok) return null;

  const data: TokenResponse = await res.json();
  // Spread existing tokens as base to preserve activeTenant* and publicApiUrl fields
  return {
    ...tokens,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    authScope: scope,
    upn: parseJwtDisplayIdentity(data.access_token) || tokens.upn,
    oid: parseJwtClaim(data.access_token, 'oid') || tokens.oid,
  };
}

/**
 * Parse a claim from a JWT without verification (for display only).
 */
function parseJwtClaim(jwt: string, claim: string): string | null {
  try {
    const payload = jwt.split('.')[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return decoded[claim] || null;
  } catch {
    return null;
  }
}

function parseJwtDisplayIdentity(jwt: string): string | undefined {
  return (
    parseJwtClaim(jwt, 'preferred_username') ||
    parseJwtClaim(jwt, 'upn') ||
    parseJwtClaim(jwt, 'email') ||
    parseJwtClaim(jwt, 'name') ||
    undefined
  );
}
