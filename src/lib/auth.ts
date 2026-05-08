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
import { getActiveProfile, getProfileTokensFile, loadProfileConfig, DEFAULT_AUTH_SCOPE, DEFAULT_PROD_AUTH_SCOPE } from './profile.js';

function getTokensFile(profile = getActiveProfile()): string {
  return getProfileTokensFile(profile);
}

function getEncryptionKeySource(): string {
  return `eai-cli-${homedir()}-token-store`;
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
}

interface BrowserLoginResult {
  code: string;
  state: string;
}

interface PkceValues {
  codeVerifier: string;
  codeChallenge: string;
}

interface CallbackServer {
  redirectUri: string;
  waitForResult: Promise<BrowserLoginResult>;
  close: () => Promise<void>;
}

function getEncryptionKey(): Buffer {
  return createHash('sha256').update(getEncryptionKeySource()).digest();
}

async function resolveAuthScope(profile: string): Promise<string> {
  if (profile === 'default') {
    return DEFAULT_PROD_AUTH_SCOPE;
  }

  try {
    const config = await loadProfileConfig(profile);
    return config?.authScope || DEFAULT_AUTH_SCOPE;
  } catch {
    return DEFAULT_AUTH_SCOPE;
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
  const key = getEncryptionKey();
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
    upn: parseJwtClaim(token.access_token, 'preferred_username') || undefined,
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

async function startBrowserCallbackServer(timeoutMs: number): Promise<CallbackServer> {
  const server = createServer();
  let closed = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  let resolveResult!: (value: BrowserLoginResult) => void;
  let rejectResult!: (reason?: Error) => void;

  const waitForResult = new Promise<BrowserLoginResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

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

  server.on('request', (req, res) => {
    const baseUrl = 'http://localhost';
    const reqUrl = new URL(req.url || '/', baseUrl);
    const code = reqUrl.searchParams.get('code');
    const state = reqUrl.searchParams.get('state');
    const error = reqUrl.searchParams.get('error');
    const errorDescription = reqUrl.searchParams.get('error_description');

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Login failed. Return to the terminal.');
      if (!settled) {
        settled = true;
        rejectResult(new Error(`Authorization failed: ${error} — ${errorDescription || 'no description'}`));
        void close();
      }
      return;
    }

    if (!code || !state) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Missing code/state in callback. Please retry login.');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Login successful. Return to the terminal.');

    if (!settled) {
      settled = true;
      resolveResult({ code, state });
      void close();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await close();
    throw new Error('Unable to determine local callback port.');
  }

  timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectResult(new Error('Timed out waiting for browser authentication callback.'));
      void close();
    }
  }, timeoutMs);

  server.on('error', err => {
    if (!settled) {
      settled = true;
      rejectResult(err instanceof Error ? err : new Error(String(err)));
      void close();
    }
  });

  return {
    redirectUri: `http://localhost:${(address as AddressInfo).port}`,
    waitForResult,
    close,
  };
}

/**
 * Initiate browser-based authorization code flow with PKCE for Entra CIAM.
 */
export async function browserLogin(
  tenantName: string,
  tenantId: string,
  clientId: string,
  scope: string,
): Promise<StoredTokens> {
  const authority = `https://${tenantName}.ciamlogin.com/${tenantId}`;
  const state = base64UrlEncode(randomBytes(16));
  const { codeVerifier, codeChallenge } = generatePkce();

  const callbackServer = await startBrowserCallbackServer(300_000);
  try {
    const authorizeUrl = new URL(`${authority}/oauth2/v2.0/authorize`);
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', callbackServer.redirectUri);
    authorizeUrl.searchParams.set('response_mode', 'query');
    authorizeUrl.searchParams.set('scope', scope);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    try {
      await openBrowser(authorizeUrl.toString());
    } catch (err) {
      throw new Error(
        `Failed to open browser automatically. Open this URL manually: ${authorizeUrl.toString()}`,
        { cause: err },
      );
    }

    const result = await callbackServer.waitForResult;
    if (result.state !== state) {
      throw new Error('State mismatch in authentication callback. Please retry login.');
    }

    const tokenRes = await fetch(`${authority}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code: result.code,
        redirect_uri: callbackServer.redirectUri,
        code_verifier: codeVerifier,
        scope,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      const error = tokenData?.error || 'token_exchange_failed';
      const description = tokenData?.error_description || 'No description provided';
      throw new Error(`Token exchange failed: ${error} — ${description}`);
    }

    // Return tokens without writing — caller writes once after tenant context is resolved
    return buildStoredTokens(tokenData as TokenResponse, tenantId, tenantName, clientId, scope);
  } finally {
    await callbackServer.close();
  }
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
    upn: parseJwtClaim(data.access_token, 'preferred_username') || tokens.upn,
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
