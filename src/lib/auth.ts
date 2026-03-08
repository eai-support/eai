/**
 * Authentication module — Entra CIAM device code flow + token storage.
 *
 * Tokens are stored in a local file (~/.eai/tokens.json) with encryption.
 * For production, this would use OS keychain via keytar, but we avoid
 * the native dependency for now.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const EAI_DIR = join(homedir(), '.eai');
const TOKENS_FILE = join(EAI_DIR, 'tokens.json');
const ENCRYPTION_KEY_SOURCE = `eai-cli-${homedir()}-token-store`;

interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tenantId: string;
  tenantName: string;
  upn?: string;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

function getEncryptionKey(): Buffer {
  return createHash('sha256').update(ENCRYPTION_KEY_SOURCE).digest();
}

async function ensureDir(): Promise<void> {
  await mkdir(EAI_DIR, { recursive: true });
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
  await ensureDir();
  const encrypted = encrypt(JSON.stringify(tokens));
  await writeFile(TOKENS_FILE, encrypted, 'utf-8');
}

export async function loadTokens(): Promise<StoredTokens | null> {
  try {
    const encrypted = await readFile(TOKENS_FILE, 'utf-8');
    const decrypted = decrypt(encrypted);
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(TOKENS_FILE);
  } catch { /* file may not exist */ }
}

/**
 * Check if we have a valid (non-expired) access token.
 */
export async function isAuthenticated(): Promise<boolean> {
  const tokens = await loadTokens();
  if (!tokens) return false;
  return tokens.expiresAt > Date.now();
}

/**
 * Get the current access token, refreshing if expired.
 */
export async function getAccessToken(): Promise<string | null> {
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
    } catch { /* refresh failed, re-login needed */ }
  }

  return null;
}

/**
 * Initiate device code flow for Entra CIAM authentication.
 */
export async function deviceCodeLogin(
  tenantName: string,
  tenantId: string,
  clientId: string,
  scope: string,
): Promise<StoredTokens> {
  const authority = `https://${tenantName}.ciamlogin.com/${tenantId}`;

  // Step 1: Request device code
  const deviceCodeRes = await fetch(`${authority}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      scope,
    }),
  });

  if (!deviceCodeRes.ok) {
    const text = await deviceCodeRes.text();
    throw new Error(`Device code request failed: ${deviceCodeRes.status} ${text}`);
  }

  const deviceCode: DeviceCodeResponse = await deviceCodeRes.json();

  // Display message to user
  console.log();
  console.log(deviceCode.message);
  console.log();

  // Step 2: Poll for token
  const pollInterval = (deviceCode.interval || 5) * 1000;
  const deadline = Date.now() + deviceCode.expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollInterval));

    const tokenRes = await fetch(`${authority}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode.device_code,
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenRes.ok) {
      const token = tokenData as TokenResponse;
      const stored: StoredTokens = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + token.expires_in * 1000,
        tenantId,
        tenantName,
        upn: parseJwtClaim(token.access_token, 'preferred_username') || undefined,
      };
      await storeTokens(stored);
      return stored;
    }

    // authorization_pending means keep polling
    if (tokenData.error === 'authorization_pending') {
      continue;
    }

    // slow_down means increase interval
    if (tokenData.error === 'slow_down') {
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    // Any other error is fatal
    throw new Error(`Token request failed: ${tokenData.error} — ${tokenData.error_description}`);
  }

  throw new Error('Device code flow timed out. Please try again.');
}

/**
 * Refresh an access token using the refresh token.
 */
async function refreshAccessToken(tokens: StoredTokens): Promise<StoredTokens | null> {
  if (!tokens.refreshToken) return null;

  const authority = `https://${tokens.tenantName}.ciamlogin.com/${tokens.tenantId}`;

  const res = await fetch(`${authority}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    }),
  });

  if (!res.ok) return null;

  const data: TokenResponse = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    tenantId: tokens.tenantId,
    tenantName: tokens.tenantName,
    upn: parseJwtClaim(data.access_token, 'preferred_username') || tokens.upn,
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
