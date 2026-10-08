import { createRequire } from 'node:module';
import { platform, release } from 'node:os';
import { findProjectRoot, loadEnvFile } from './config.js';
import type { StoredTokens } from './auth.js';
import { getActiveProfile, loadProfileConfig } from './profile.js';
import { findGuidanceByCodeOrReason } from './error-guidance/catalog.js';
import { readSupportContext } from './support-context.js';
import { isSupportSensitiveKey, redactSupportBundle, redactSupportText } from './support-redaction.js';

const require = createRequire(import.meta.url);
const { version: cliVersion } = require('../../package.json') as { version: string };
export const SUPPORT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8_192;

export interface SupportOptions {
  readonly format?: string;
  readonly source?: string;
  readonly tool?: string;
  readonly toolVersion?: string;
  readonly command?: string;
  readonly exitCode?: string;
  readonly errorCode?: string;
  readonly description?: string;
  readonly yes?: boolean;
  readonly open?: boolean;
}

export interface SupportBundle {
  readonly source: 'eai-cli' | 'harness';
  readonly tool: { readonly name: string; readonly version: string };
  readonly cli: { readonly command?: string; readonly exitCode?: number; readonly errorCode?: string; readonly reasonCode?: string };
  readonly cliVersion: string;
  readonly service: 'eai-cli';
  readonly category: 'technical';
  readonly summary: string;
  readonly description: string;
  readonly os: 'macos' | 'windows' | 'linux' | 'unknown';
  readonly environment: 'dev' | 'test' | 'prod' | 'local' | 'unknown';
  readonly tenantId?: string;
  readonly tenantName?: string;
  readonly appId?: string;
  readonly appName?: string;
  readonly error?: string;
  readonly occurredAt?: string;
}

export class SupportRequestError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export async function resolveSupportWebsite(): Promise<string> {
  const profile = getActiveProfile();
  const config = await loadProfileConfig(profile);
  const value = process.env.EAI_WEBSITE_URL || config?.websiteUrl
    || (profile === 'default' ? 'https://www.enterpriseaigroup.com' : undefined);
  if (!value) throw new Error('Configure websiteUrl for the active CLI profile before preparing a support report.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('The configured support website must be a valid origin.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('The support website must be an HTTPS origin (HTTP is allowed for a local fixture).');
  }
  return url.origin;
}

function boundedOption(value: string | undefined, limit: number, label: string): void {
  if (value !== undefined && (!value.trim() || value.length > limit)) {
    throw new Error(`${label} must be nonempty and at most ${limit} characters.`);
  }
}

export async function collectSupportBundle(options: SupportOptions, session: StoredTokens | null): Promise<SupportBundle> {
  if (options.format && !['text', 'json'].includes(options.format)) throw new Error('Use --format text or --format json.');
  const source = options.source ?? (options.tool ? 'harness' : 'eai-cli');
  if (source !== 'harness' && source !== 'eai-cli') throw new Error('Use --source eai-cli or --source harness.');
  boundedOption(options.tool, 80, 'Tool name');
  boundedOption(options.toolVersion, 100, 'Tool version');
  boundedOption(options.command, 500, 'Command');
  boundedOption(options.description, 6000, 'Description');
  const exitCode = options.exitCode === undefined ? undefined : Number(options.exitCode);
  if (exitCode !== undefined && (!/^-?\d+$/.test(options.exitCode!) || !Number.isInteger(exitCode)
    || exitCode < -2147483648 || exitCode > 2147483647)) throw new Error('Exit code must be a signed 32-bit integer.');
  const context = readSupportContext();
  const guidance = findGuidanceByCodeOrReason(options.errorCode ?? context?.errorCode ?? context?.reasonCode ?? '');
  if (options.errorCode && !guidance) throw new Error('Unknown error code or reason. Run eai errors list --format json.');
  const projectRoot = await findProjectRoot();
  const env = projectRoot ? await loadEnvFile(projectRoot) : {};
  const sensitiveValues = [session?.accessToken, session?.refreshToken,
    ...Object.entries({ ...env, ...process.env }).filter(([key]) => isSupportSensitiveKey(key)).map(([, value]) => value)]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const safe = (value: string | undefined, limit: number): string | undefined => value ? redactSupportText(value, sensitiveValues).slice(0, limit) : undefined;
  const os = platform() === 'darwin' ? 'macos' : platform() === 'win32' ? 'windows' : platform() === 'linux' ? 'linux' : 'unknown';
  const profile = getActiveProfile();
  const environment = ['dev', 'test', 'prod', 'local'].includes(profile) ? profile as SupportBundle['environment'] : profile === 'default' ? 'prod' : 'unknown';
  const command = safe(options.command ?? context?.command, 500);
  const description = safe(options.description ?? [
    'Help requested for an EAI CLI command.', `CLI version: ${cliVersion}`, `OS: ${os} ${release()}`,
    command ? `Command: ${command}` : '', guidance ? `Error: ${guidance.code} (${guidance.reasonCode})` : '',
  ].filter(Boolean).join('\n'), 6000)!;
  if (description.length < 10) throw new Error('Description must contain at least 10 characters after redaction.');
  return redactSupportBundle({
    source, tool: { name: safe(options.tool ?? 'eai-cli', 80)!, version: safe(options.toolVersion ?? (options.tool ? undefined : cliVersion), 100) ?? '' },
    cli: { command, exitCode: exitCode ?? context?.exitCode, errorCode: guidance?.code, reasonCode: guidance?.reasonCode },
    cliVersion, service: 'eai-cli', category: 'technical', summary: safe(guidance?.title ?? 'Help with EAI CLI', 180)!,
    description, os, environment,
    tenantId: safe(env.EAI_TENANT_ID ?? env.NEXT_PUBLIC_EAI_TENANT_ID ?? env.TENANT_DEFAULT_ID ?? session?.activeTenantId, 160),
    tenantName: safe(env.EAI_TENANT_NAME ?? session?.activeTenantName, 160),
    appId: safe(env.EAI_APP_KEY ?? env.NEXT_PUBLIC_EAI_APP_KEY, 160), appName: safe(env.NEXT_PUBLIC_APP_NAME, 160),
    error: safe(context?.message, 4000), occurredAt: context?.recordedAt,
  }, sensitiveValues);
}

export interface SupportDraft { readonly url: string; readonly expiresAt: string }

export async function createSupportDraft(website: string, bundle: SupportBundle, bearer: string, timeoutMs = SUPPORT_TIMEOUT_MS): Promise<SupportDraft | null> {
  try {
    // Draft creates are not idempotent. A timeout must never trigger an automatic retry.
    const response = await fetch(`${website}/api/support/drafts`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify(bundle),
    });
    if (response.status !== 201) {
      await response.body?.cancel();
      if (response.status === 401) return null;
      const messages: Record<number, string> = {
        400: 'The website rejected the support report fields.', 413: 'The support report is too large.',
        429: 'The support report limit was reached. Try again later.',
        503: 'The support website is temporarily unavailable.',
      };
      throw new SupportRequestError(`http_${response.status}`, messages[response.status] ?? 'The support website could not create a draft.');
    }
    if (!response.headers.get('content-type')?.includes('application/json') || !response.body) {
      await response.body?.cancel();
      throw new SupportRequestError('invalid_response', 'The support website returned an invalid draft response.');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new SupportRequestError('invalid_response', 'The support website returned an invalid draft response.');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object') throw new SupportRequestError('invalid_response', 'The support website returned an invalid draft response.');
    const { id, token, expiresAt, redeemUrl } = data as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)
      || typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()
      || redeemUrl !== `${website}/support#draft=${id}.${token}`) {
      throw new SupportRequestError('invalid_response', 'The support website returned an invalid draft response.');
    }
    return { url: redeemUrl, expiresAt };
  } catch (error) {
    if (error instanceof SupportRequestError) throw error;
    if (error instanceof SyntaxError) throw new SupportRequestError('invalid_response', 'The support website returned an invalid draft response.');
    throw new SupportRequestError('request_failed', 'The support request failed or timed out. No retry was sent; a draft may have been created.');
  }
}
