import { createHash, randomUUID } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { listErrorGuidance } from './error-guidance/catalog.js';
import { findGuidance } from './error-guidance/match.js';
import type { GuidanceLookupInput } from './error-guidance/types.js';
import { getActiveProfile } from './profile.js';
import { isSupportSensitiveKey, redactSupportBundle, redactSupportText } from './support-redaction.js';

export interface SupportErrorContext {
  readonly command: string;
  readonly exitCode: number;
  readonly errorCode?: string;
  readonly reasonCode?: string;
  readonly message?: string;
  readonly recordedAt: string;
}

const MAX_MESSAGE_LENGTH = 4096;
const MAX_STDERR_LENGTH = 32768;
const MAX_CONTEXT_BYTES = 16384;
export const SUPPORT_SUGGESTION = 'Run eai support to prepare a report for your approval.';

let commandPath = 'eai';
let latestError: Omit<SupportErrorContext, 'command' | 'exitCode' | 'recordedAt'> = {};
let trackingInstalled = false;

function sensitiveEnvironmentValues(): string[] {
  return Object.entries(process.env)
    .filter(([key, value]) => isSupportSensitiveKey(key) && Boolean(value))
    .map(([, value]) => value as string);
}

/** Keep only command names, because positional arguments and flags may contain credentials. */
export function setSupportCommand(command: string): void {
  commandPath = /^eai(?: [a-z][a-z0-9-]*)*$/.test(command) && command.length <= 256
    ? command
    : 'eai';
}

export function getSupportContextPath(profile = getActiveProfile()): string {
  const profileHash = createHash('sha256').update(profile).digest('hex').slice(0, 16);
  return join(homedir(), '.eai', 'support', `last-error-${profileHash}.json`);
}

export function recordSupportError(input: GuidanceLookupInput): void {
  const message = typeof input.message === 'string'
    ? redactSupportText(input.message, sensitiveEnvironmentValues()).trim()
    : undefined;
  const guidance = findGuidance({
    ...input,
    operation: input.operation ?? commandPath,
    code: input.code ?? message?.match(/Error code:\s*(E\d{3})/i)?.[1],
    reasonCode: input.reasonCode ?? message?.match(/Reason:\s*([a-z0-9_]+)/i)?.[1],
    message,
  }) ?? listErrorGuidance().find(entry => {
    const title = entry.title.replace(/[.!?]+$/, '').toLowerCase();
    return message?.split('\n').some(line => {
      const text = line.replace(/^(?:ERROR:\s*|✗\s*)/, '').trim().toLowerCase();
      return text === title || text.startsWith(`${title}.`) || text.startsWith(`${title}:`)
        || text.startsWith(`${title} `);
    });
  });

  latestError = {
    ...latestError,
    ...(guidance ? { errorCode: guidance.code, reasonCode: guidance.reasonCode } : {}),
    ...(message ? { message: message.slice(-MAX_MESSAGE_LENGTH) } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Preserve upstream JSON error fields while keeping the support offer in the same document. */
export function formatSupportErrorBody(body: string): string {
  let payload: Record<string, unknown> | undefined;
  try { payload = asRecord(JSON.parse(body)); }
  catch { return redactSupportText(body, sensitiveEnvironmentValues()); }
  if (!payload) return redactSupportText(body, sensitiveEnvironmentValues());

  const error = asRecord(payload.error);
  const details = error ?? payload;
  const suggestion = typeof details.suggestion === 'string' && details.suggestion
    ? `${details.suggestion}\n\n${SUPPORT_SUGGESTION}` : SUPPORT_SUGGESTION;
  const result = error
    ? { ...payload, error: { ...error, suggestion } }
    : { ...payload, suggestion };
  return JSON.stringify(redactSupportBundle(result, sensitiveEnvironmentValues()), null, 2);
}

export function recordSupportJsonError(value: unknown): void {
  const payload = asRecord(value);
  if (!payload || (!payload.error && payload.ok !== false && payload.success !== false)) return;

  const error = asRecord(payload.error);
  const guidance = asRecord(payload.guidance) ?? asRecord(error?.guidance);
  const message = typeof payload.error === 'string' ? payload.error : error?.message ?? payload.message;
  const code = guidance?.code ?? error?.code;
  const reasonCode = guidance?.reasonCode ?? error?.reasonCode ?? payload.reasonCode;
  recordSupportError({
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof reasonCode === 'string' ? { reasonCode } : {}),
    ...(typeof message === 'string' ? { message } : {}),
    ...(typeof payload.status === 'number' ? { status: payload.status } : {}),
    ...(typeof error?.code === 'string' ? { serverCode: error.code } : {}),
  });
}

function shouldKeepPreviousError(): boolean {
  return commandPath === 'eai support' || commandPath.startsWith('eai support ')
    || commandPath === 'eai errors' || commandPath.startsWith('eai errors ');
}

function persistSupportContext(exitCode: number): void {
  const path = getSupportContextPath();
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const context: SupportErrorContext = {
    command: commandPath,
    exitCode,
    ...latestError,
    recordedAt: new Date().toISOString(),
  };

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(context)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporaryPath, path);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/** Synchronous writes also cover commands that terminate immediately with process.exit(). */
export function installSupportErrorTracking(): void {
  if (trackingInstalled) return;
  trackingInstalled = true;
  const originalWrite = process.stderr.write;
  let stderrText = '';
  let hasStructuredStderrError = false;

  process.stderr.write = ((...args: unknown[]): boolean => {
    const chunk = args[0];
    const text = typeof chunk === 'string' ? chunk : chunk instanceof Uint8Array
      ? Buffer.from(chunk).toString('utf8') : undefined;
    if (text && !shouldKeepPreviousError()) {
      // Keep writes together so a bearer split across chunks is redacted as one value.
      stderrText = `${stderrText}${text}`.slice(-MAX_STDERR_LENGTH);
      recordSupportError({ message: stderrText });
      if (stderrText.trim().startsWith('{')) {
        try {
          const payload: unknown = JSON.parse(stderrText);
          recordSupportJsonError(payload);
          const record = asRecord(payload);
          hasStructuredStderrError = Boolean(record?.error)
            || (typeof record?.suggestion === 'string' && record.suggestion.includes(SUPPORT_SUGGESTION));
        } catch {
          // stderr may contain partial JSON or plain diagnostic text.
        }
      }
    }
    return Reflect.apply(originalWrite, process.stderr, args) as boolean;
  }) as typeof process.stderr.write;

  process.on('uncaughtExceptionMonitor', (error) => {
    recordSupportError({ message: error.message });
  });

  process.on('exit', (exitCode) => {
    if (exitCode === 0) return;
    if (!shouldKeepPreviousError()) {
      try {
        persistSupportContext(exitCode);
      } catch {
        Reflect.apply(originalWrite, process.stderr, ['Could not save the previous error for eai support.\n']);
      }
    }
    if (!hasStructuredStderrError) {
      Reflect.apply(originalWrite, process.stderr, [`${SUPPORT_SUGGESTION}\n`]);
    }
  });
}

export function readSupportContext(): SupportErrorContext | null {
  const path = getSupportContextPath();
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.size > MAX_CONTEXT_BYTES) {
      throw new Error('Saved support context is invalid.');
    }
    const payload = asRecord(JSON.parse(readFileSync(path, 'utf8')));
    if (!payload || typeof payload.command !== 'string'
      || !/^eai(?: [a-z][a-z0-9-]*)*$/.test(payload.command)
      || payload.command.length > 256
      || typeof payload.exitCode !== 'number' || !Number.isInteger(payload.exitCode)
      || payload.exitCode <= 0 || payload.exitCode > 255
      || typeof payload.recordedAt !== 'string' || !Number.isFinite(Date.parse(payload.recordedAt))) {
      throw new Error('Saved support context is invalid.');
    }
    const guidance = findGuidance({
      ...(typeof payload.errorCode === 'string' ? { code: payload.errorCode } : {}),
      ...(typeof payload.reasonCode === 'string' ? { reasonCode: payload.reasonCode } : {}),
    });
    return {
      command: payload.command,
      exitCode: payload.exitCode,
      recordedAt: new Date(payload.recordedAt).toISOString(),
      ...(guidance ? { errorCode: guidance.code, reasonCode: guidance.reasonCode } : {}),
      ...(typeof payload.message === 'string'
        ? { message: redactSupportText(payload.message, sensitiveEnvironmentValues()).slice(-MAX_MESSAGE_LENGTH) } : {}),
    };
  } catch (error) {
    if (asRecord(error)?.code === 'ENOENT') return null;
    throw new Error('Could not read the previous error for eai support.', { cause: error });
  }
}
