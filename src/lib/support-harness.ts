import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { redactSupportText } from './support-redaction.js';

/** Raw `--context-file` bytes accepted before parsing. */
export const HARNESS_CONTEXT_MAX_RAW_BYTES = 64 * 1024;
/** UTF-8 size of the redacted `harness` block the website accepts. */
export const HARNESS_BLOCK_MAX_BYTES = 32 * 1024;
export const ORGANISATION_LOCATIONS = ['apac', 'emea', 'americas'] as const;
export type OrganisationLocation = typeof ORGANISATION_LOCATIONS[number];

export interface HarnessCommand {
  readonly command: string;
  readonly exitCode: number;
  readonly errorCode?: string;
  readonly reasonCode?: string;
  readonly at?: string;
}

export interface HarnessError {
  readonly code?: string;
  readonly message: string;
  readonly at?: string;
}

/** Bounded session summary written by the AI harness; the person reviews it before anything is sent. */
export interface HarnessContext {
  readonly requestedByPerson: true;
  readonly request: string;
  readonly goal: string;
  readonly summary: string;
  readonly steps: readonly string[];
  readonly commands: readonly HarnessCommand[];
  readonly errors: readonly HarnessError[];
  readonly attemptedFixes: readonly string[];
  readonly filesTouched: readonly string[];
  readonly truncated: boolean;
}

/** Safe failure for context-file problems; messages name fields, never values. */
export class SupportContextError extends Error {
  constructor(readonly code: 'context_unreadable' | 'context_invalid' | 'context_too_large', message: string) {
    super(message);
  }
}

const LIMITS = {
  request: 500, goal: 1000, summary: 4000, step: 500, steps: 50, command: 500, commands: 50,
  errorCode: 40, reasonCode: 80, at: 40, code: 80, message: 1000, errors: 50,
  attemptedFix: 500, attemptedFixes: 20, fileTouched: 260, filesTouched: 100,
} as const;
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readStdin(stdin: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stdin) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > HARNESS_CONTEXT_MAX_RAW_BYTES) {
      throw new SupportContextError('context_too_large', `The context on stdin exceeds ${HARNESS_CONTEXT_MAX_RAW_BYTES} bytes.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Only this private directory is eligible for automatic context deletion. */
export function ensureSupportContextDirectory(): string {
  let directory = realpathSync(homedir());
  for (const part of ['.eai', 'support', 'context']) {
    directory = join(directory, part);
    if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
      throw new SupportContextError('context_unreadable', 'The support context directory must not be a symlink.');
    }
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  if (realpathSync(directory) !== directory || lstatSync(directory).isSymbolicLink()) {
    throw new SupportContextError('context_unreadable', 'The support context directory must not be a symlink.');
  }
  chmodSync(directory, 0o700);
  return directory;
}

function ownedContextFile(source: string): string | undefined {
  try {
    const directory = ensureSupportContextDirectory();
    const candidate = resolve(source);
    const lexicalDirectory = resolve(homedir(), '.eai', 'support', 'context');
    if (!candidate.startsWith(`${directory}${sep}`) && !candidate.startsWith(`${lexicalDirectory}${sep}`)) return undefined;
    const metadata = lstatSync(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return undefined;
    if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) return undefined;
    const actual = realpathSync(candidate);
    return actual.startsWith(`${directory}${sep}`) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function discardOwnedHarnessContext(source: string | undefined): void {
  if (!source || source === '-') return;
  const file = ownedContextFile(source);
  if (!file) return;
  try { rmSync(file, { force: true }); }
  catch { process.stderr.write('The owned support context file could not be deleted; remove it yourself.\n'); }
}

export function purgeStaleHarnessContexts(now = Date.now()): void {
  const directory = ensureSupportContextDirectory();
  for (const entry of readdirSync(directory)) {
    const file = ownedContextFile(join(directory, entry));
    if (file && now - statSync(file).mtimeMs > 24 * 60 * 60 * 1000) discardOwnedHarnessContext(file);
  }
}

/**
 * Reads the harness summary from stdin (`-`) or a path, bounded before parsing.
 * Preview keeps the file so an approved rerun can read the same report.
 * @returns The parsed JSON value, still unvalidated.
 */
export async function readHarnessContextSource(source: string, stdin: NodeJS.ReadableStream = process.stdin): Promise<unknown> {
  let raw: Buffer;
  if (source === '-') {
    try {
      raw = await readStdin(stdin);
    } catch (error) {
      if (error instanceof SupportContextError) throw error;
      throw new SupportContextError('context_unreadable', 'The context on stdin could not be read.');
    }
  } else {
    let metadata;
    try {
      metadata = statSync(source);
    } catch {
      throw new SupportContextError('context_unreadable', 'The context file could not be read. Check the --context-file path.');
    }
    if (!metadata.isFile()) throw new SupportContextError('context_unreadable', 'The context file must be a regular file.');
    try {
      if (metadata.size > HARNESS_CONTEXT_MAX_RAW_BYTES) {
        throw new SupportContextError('context_too_large', `The context file exceeds ${HARNESS_CONTEXT_MAX_RAW_BYTES} bytes.`);
      }
      const descriptor = openSync(source, 'r');
      try {
        const buffer = Buffer.alloc(HARNESS_CONTEXT_MAX_RAW_BYTES + 1);
        let bytes = 0;
        while (bytes < buffer.length) {
          const received = readSync(descriptor, buffer, bytes, buffer.length - bytes, null);
          if (received === 0) break;
          bytes += received;
        }
        if (bytes > HARNESS_CONTEXT_MAX_RAW_BYTES) throw new SupportContextError('context_too_large', 'The context file exceeds the raw byte limit.');
        raw = buffer.subarray(0, bytes);
      } finally { closeSync(descriptor); }
    } catch (error) {
      if (error instanceof SupportContextError) throw error;
      throw new SupportContextError('context_unreadable', 'The context file could not be read. Check the --context-file path.');
    }
  }
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw new SupportContextError('context_invalid', 'The context must be a JSON object.');
  }
}

class FieldIssues {
  readonly names: string[] = [];
  add(name: string): void { this.names.push(name); }
  text(limit: number, name: string, value: unknown, required: boolean): string | undefined {
    if (value === undefined) {
      if (required) this.add(name);
      return undefined;
    }
    if (typeof value !== 'string' || !value.trim() || value.length > limit) {
      this.add(name);
      return undefined;
    }
    return value;
  }
  datetime(name: string, value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.length > LIMITS.at || !Number.isFinite(Date.parse(value))) {
      this.add(name);
      return undefined;
    }
    return new Date(value).toISOString();
  }
  list<T>(name: string, value: unknown, limit: number, item: (entry: unknown, path: string) => T | undefined): T[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > limit) {
      this.add(name);
      return [];
    }
    return value.map((entry, index) => item(entry, `${name}[${index}]`)).filter((entry): entry is T => entry !== undefined);
  }
  unknownKeys(path: string, record: Record<string, unknown>, allowed: readonly string[]): void {
    for (const key of Object.keys(record)) {
      if (!allowed.includes(key)) this.add(`${path}${path ? '.' : ''}${key} (unexpected)`);
    }
  }
}

function isAbsoluteOrHomePath(value: string): boolean {
  return isAbsolute(value) || /^(?:[A-Za-z]:[\\/]|\\\\|\/|~)/.test(value);
}

/**
 * Validates the harness summary against the website contract and reports offending field names only.
 * Missing lists default to empty and a missing `truncated` to false; everything else is strict.
 */
export function validateHarnessContext(value: unknown): HarnessContext {
  const issues = new FieldIssues();
  if (!isRecord(value)) throw new SupportContextError('context_invalid', 'The context must be a JSON object.');
  issues.unknownKeys('', value, ['requestedByPerson', 'request', 'goal', 'summary', 'steps', 'commands', 'errors', 'attemptedFixes', 'filesTouched', 'truncated']);
  if (value.requestedByPerson !== true) issues.add('requestedByPerson');
  const request = issues.text(LIMITS.request, 'request', value.request, true);
  const goal = issues.text(LIMITS.goal, 'goal', value.goal, true);
  const summary = issues.text(LIMITS.summary, 'summary', value.summary, true);
  const steps = issues.list('steps', value.steps, LIMITS.steps, (entry, path) => issues.text(LIMITS.step, path, entry, true));
  const commands = issues.list('commands', value.commands, LIMITS.commands, (entry, path): HarnessCommand | undefined => {
    if (!isRecord(entry)) {
      issues.add(path);
      return undefined;
    }
    issues.unknownKeys(path, entry, ['command', 'exitCode', 'errorCode', 'reasonCode', 'at']);
    const command = issues.text(LIMITS.command, `${path}.command`, entry.command, true);
    const exitCode = entry.exitCode;
    if (typeof exitCode !== 'number' || !Number.isInteger(exitCode) || exitCode < INT32_MIN || exitCode > INT32_MAX) {
      issues.add(`${path}.exitCode`);
    }
    const errorCode = issues.text(LIMITS.errorCode, `${path}.errorCode`, entry.errorCode, false);
    const reasonCode = issues.text(LIMITS.reasonCode, `${path}.reasonCode`, entry.reasonCode, false);
    const at = issues.datetime(`${path}.at`, entry.at);
    return command === undefined || typeof exitCode !== 'number' ? undefined : {
      command, exitCode,
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(reasonCode === undefined ? {} : { reasonCode }),
      ...(at === undefined ? {} : { at }),
    };
  });
  const errors = issues.list('errors', value.errors, LIMITS.errors, (entry, path): HarnessError | undefined => {
    if (!isRecord(entry)) {
      issues.add(path);
      return undefined;
    }
    issues.unknownKeys(path, entry, ['code', 'message', 'at']);
    const code = issues.text(LIMITS.code, `${path}.code`, entry.code, false);
    const message = issues.text(LIMITS.message, `${path}.message`, entry.message, true);
    const at = issues.datetime(`${path}.at`, entry.at);
    return message === undefined ? undefined : {
      ...(code === undefined ? {} : { code }), message, ...(at === undefined ? {} : { at }),
    };
  });
  const attemptedFixes = issues.list('attemptedFixes', value.attemptedFixes, LIMITS.attemptedFixes,
    (entry, path) => issues.text(LIMITS.attemptedFix, path, entry, true));
  const filesTouched = issues.list('filesTouched', value.filesTouched, LIMITS.filesTouched, (entry, path) => {
    const file = issues.text(LIMITS.fileTouched, path, entry, true);
    if (file !== undefined && (isAbsoluteOrHomePath(file) || /^[a-z][a-z0-9+.-]*:/i.test(file) || file.split(/[\\/]/).includes('..'))) {
      issues.add(`${path} (absolute path)`);
      return undefined;
    }
    return file;
  });
  if (value.truncated !== undefined && typeof value.truncated !== 'boolean') issues.add('truncated');
  if (issues.names.length > 0 || request === undefined || goal === undefined || summary === undefined) {
    throw new SupportContextError('context_invalid', `Invalid harness context fields: ${issues.names.join(', ')}.`);
  }
  return {
    requestedByPerson: true, request, goal, summary,
    steps, commands, errors, attemptedFixes, filesTouched, truncated: value.truncated === true,
  };
}

export interface HarnessRedactionScope {
  readonly sensitiveValues: readonly string[];
  /** Spellings of the home directory to hide (as configured and as resolved). */
  readonly homes: readonly string[];
  /** Spellings of the project root to hide; empty outside a project. */
  readonly projectRoots: readonly string[];
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The spellings of a path to hide: as given, resolved, and re-rooted under each spelling of a parent
 * (a project under a symlinked home such as `/var/...` versus `/private/var/...` on macOS).
 */
export function pathAliases(path: string | null | undefined, parents: readonly string[] = []): string[] {
  if (!path) return [];
  const resolved = realpathOrSelf(path);
  const aliases = new Set([path, resolved]);
  if (process.env.PWD && realpathOrSelf(process.env.PWD) === resolved) aliases.add(process.env.PWD);
  for (const parent of parents) {
    const resolvedParent = realpathOrSelf(parent);
    if (resolved === resolvedParent) aliases.add(parent);
    else if (resolved.startsWith(resolvedParent.endsWith(sep) ? resolvedParent : `${resolvedParent}${sep}`)) {
      aliases.add(`${parent.endsWith(sep) ? parent.slice(0, -1) : parent}${resolved.slice(resolvedParent.length)}`);
    }
  }
  return [...aliases];
}

function replacePathPrefix(text: string, prefix: string, replacement: string): string {
  const trimmed = prefix.replace(/[\\/]+$/, '');
  if (!trimmed) return text;
  const escaped = trimmed.split(/[\\/]/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]');
  return text.replace(new RegExp(`${escaped}(?=$|[\\\\/\\s"'\x60:),;])`, /^[a-z]:/i.test(trimmed) ? 'gi' : 'g'), replacement);
}

/**
 * Applies the shared credential redaction plus local path hiding (project root → `.`, home → `~`) to every text field,
 * then trims each field back to its contract length.
 */
export function redactHarnessContext(context: HarnessContext, scope: HarnessRedactionScope): HarnessContext {
  const safe = (value: string, limit: number): string => {
    let text = value;
    for (const root of scope.projectRoots) text = replacePathPrefix(text, root, '.');
    for (const home of scope.homes) text = replacePathPrefix(text, home, '~');
    return redactSupportText(text, scope.sensitiveValues).slice(0, limit);
  };
  return {
    requestedByPerson: true,
    request: safe(context.request, LIMITS.request),
    goal: safe(context.goal, LIMITS.goal),
    summary: safe(context.summary, LIMITS.summary),
    steps: context.steps.map(step => safe(step, LIMITS.step)),
    commands: context.commands.map(command => ({
      ...command,
      command: safe(command.command, LIMITS.command),
      ...(command.errorCode === undefined ? {} : { errorCode: safe(command.errorCode, LIMITS.errorCode) }),
      ...(command.reasonCode === undefined ? {} : { reasonCode: safe(command.reasonCode, LIMITS.reasonCode) }),
    })),
    errors: context.errors.map(error => ({
      ...error,
      ...(error.code === undefined ? {} : { code: safe(error.code, LIMITS.code) }),
      message: safe(error.message, LIMITS.message),
    })),
    attemptedFixes: context.attemptedFixes.map(fix => safe(fix, LIMITS.attemptedFix)),
    filesTouched: context.filesTouched.map(file => safe(file, LIMITS.fileTouched)),
    truncated: context.truncated,
  };
}

/** Byte size the website measures: UTF-8 of the serialized block. */
export function harnessBlockBytes(context: HarnessContext): number {
  return Buffer.byteLength(JSON.stringify(context), 'utf8');
}

/**
 * Drops the oldest steps, then commands, then errors until the redacted block fits the website cap.
 * Anything dropped marks the block truncated; a block that cannot fit fails closed.
 */
export function fitHarnessContext(context: HarnessContext): HarnessContext {
  const steps = [...context.steps];
  const commands = [...context.commands];
  const errors = [...context.errors];
  let truncated = context.truncated;
  let current: HarnessContext = { ...context, steps, commands, errors, truncated };
  while (harnessBlockBytes(current) > HARNESS_BLOCK_MAX_BYTES) {
    if (steps.length > 0) steps.shift();
    else if (commands.length > 0) commands.shift();
    else if (errors.length > 0) errors.shift();
    else throw new SupportContextError('context_too_large', `The session summary exceeds ${HARNESS_BLOCK_MAX_BYTES} bytes after redaction. Shorten the summary, goal, request, attempted fixes or files touched.`);
    truncated = true;
    current = { ...context, steps, commands, errors, truncated };
  }
  return current;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, sortKeys(value[key])]));
  }
  return value;
}

/** Deterministic serialization (sorted keys, no whitespace) so the same report always yields the same digest. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** The consent binding: sha256 of the canonical redacted bundle, as the person approves it. */
export function bundleDigest(bundle: unknown): string {
  return createHash('sha256').update(canonicalJson(bundle), 'utf8').digest('hex');
}

const LABELS: Record<string, string> = {
  source: 'Source', tool: 'Reporting tool', name: 'Name', version: 'Version', cli: 'Failing CLI command',
  command: 'Command', exitCode: 'Exit code', errorCode: 'Error code', reasonCode: 'Reason', cliVersion: 'CLI version',
  service: 'Service', category: 'Category', summary: 'Summary', description: 'Description', os: 'Operating system',
  environment: 'Environment', tenantId: 'Workspace id', tenantName: 'Workspace', appId: 'App id', appName: 'App',
  error: 'Error', occurredAt: 'Occurred at', organisationLocation: 'Organisation location',
  harness: 'Session summary from the AI assistant', requestedByPerson: 'Requested by the person', request: 'Request',
  goal: 'Goal', steps: 'Steps', commands: 'Commands run', errors: 'Errors seen', attemptedFixes: 'Attempted fixes',
  filesTouched: 'Files touched', truncated: 'Truncated to fit', at: 'At', code: 'Code', message: 'Message',
};

function renderValue(key: string, value: unknown, indent: string, lines: string[]): void {
  const label = LABELS[key] ?? key;
  if (value === undefined) return;
  if (Array.isArray(value)) {
    lines.push(`${indent}${label}:${value.length === 0 ? ' none' : ''}`);
    value.forEach((item, index) => {
      if (isRecord(item)) {
        lines.push(`${indent}  ${index + 1}.`);
        for (const [childKey, child] of Object.entries(item)) renderValue(childKey, child, `${indent}    `, lines);
      } else {
        lines.push(`${indent}  ${index + 1}. ${String(item)}`);
      }
    });
    return;
  }
  if (isRecord(value)) {
    lines.push(`${indent}${label}:`);
    for (const [childKey, child] of Object.entries(value)) renderValue(childKey, child, `${indent}  `, lines);
    return;
  }
  const text = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
  if (text.includes('\n')) {
    lines.push(`${indent}${label}:`);
    for (const line of text.split('\n')) lines.push(`${indent}  ${line}`);
    return;
  }
  lines.push(`${indent}${label}: ${text}`);
}

/** Plain-text rendering of the whole redacted bundle, ending with the digest the person approves. */
export function renderSupportPreview(bundle: Record<string, unknown>, digest: string): string {
  const lines: string[] = ['EAI support report (redacted). Review every line before approving.'];
  for (const [key, value] of Object.entries(bundle)) renderValue(key, value, '', lines);
  lines.push('', `Report digest: ${digest}`);
  return lines.join('\n');
}

export function isOrganisationLocation(value: unknown): value is OrganisationLocation {
  return typeof value === 'string' && (ORGANISATION_LOCATIONS as readonly string[]).includes(value);
}
