/**
 * Shared output utilities — consistent formatting across all CLI commands.
 */

import chalk from 'chalk';

// TTY and color detection
function shouldUseColor(): boolean {
  // Check NO_COLOR environment variable
  if (process.env.NO_COLOR) {
    return false;
  }

  // Check FORCE_COLOR environment variable
  if (process.env.FORCE_COLOR) {
    return true;
  }

  // Check if stdout is a TTY
  return process.stdout.isTTY ?? false;
}

// Simple mode detection (will be set by global flag)
let simpleMode = false;

export function setSimpleMode(enabled: boolean): void {
  simpleMode = enabled;
}

export function isSimpleMode(): boolean {
  return simpleMode;
}

const useColor = shouldUseColor();

const SENSITIVE_ASSIGNMENT_PATTERN =
  /((?:["']?[\w.-]*(?:token|secret|password|passwd|pwd|api[_-]?key|cookie|credential|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token)[\w.-]*["']?\s*[:=]\s*["']?))([^"',\s}]+)/gi;
const SENSITIVE_KEY_PATTERN =
  /(?:token|secret|password|passwd|pwd|api[_-]?key|authorization|cookie|credential|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token)/i;
const AUTH_HEADER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

export function redactSensitiveText(msg: string): string {
  return msg
    .replace(AUTH_HEADER_PATTERN, '$1 [redacted]')
    .replace(JWT_PATTERN, '[redacted-jwt]')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '$1[redacted]');
}

function redactingJsonReplacer(key: string, value: unknown): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return '[redacted]';
  }

  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }
  return value;
}

export const symbols = {
  success: useColor ? chalk.green('✓') : '✓',
  error: useColor ? chalk.red('✗') : '✗',
  warning: useColor ? chalk.yellow('⚠') : '⚠',
  info: useColor ? chalk.blue('→') : '→',
  pending: useColor ? chalk.gray('○') : '○',
  updated: useColor ? chalk.cyan('↻') : '↻',
  unchanged: useColor ? chalk.gray('=') : '=',
  added: useColor ? chalk.green('+') : '+',
  removed: useColor ? chalk.red('-') : '-',
  changed: useColor ? chalk.yellow('~') : '~',
} as const;

export function success(msg: string): void {
  const safeMsg = redactSensitiveText(msg);
  if (simpleMode) {
    console.log(`SUCCESS: ${safeMsg}`);
  } else {
    console.log(`${symbols.success} ${safeMsg}`);
  }
}

export function error(msg: string): void {
  const safeMsg = redactSensitiveText(msg);
  if (simpleMode) {
    console.error(`ERROR: ${safeMsg}`);
  } else {
    console.error(`${symbols.error} ${safeMsg}`);
  }
}

export function warn(msg: string): void {
  const safeMsg = redactSensitiveText(msg);
  if (simpleMode) {
    console.warn(`WARNING: ${safeMsg}`);
  } else {
    console.warn(`${symbols.warning} ${safeMsg}`);
  }
}

export function info(msg: string): void {
  const safeMsg = redactSensitiveText(msg);
  if (simpleMode) {
    console.log(`-> ${safeMsg}`);
  } else {
    console.log(`${symbols.info} ${chalk.dim(safeMsg)}`);
  }
}

export function heading(msg: string): void {
  const safeMsg = redactSensitiveText(msg);
  if (useColor && !simpleMode) {
    console.log(chalk.bold(safeMsg));
  } else {
    console.log(safeMsg);
  }
}

export function dim(msg: string): void {
  const safeMsg = redactSensitiveText(msg);
  if (useColor && !simpleMode) {
    console.log(chalk.dim(safeMsg));
  } else {
    console.log(safeMsg);
  }
}

export function table(rows: Array<[string, string]>): void {
  const maxLabel = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    const paddedLabel = redactSensitiveText(label.padEnd(maxLabel));
    const safeValue = redactSensitiveText(value);
    if (useColor && !simpleMode) {
      console.log(`  ${chalk.dim(paddedLabel)}  ${safeValue}`);
    } else {
      console.log(`  ${paddedLabel}  ${safeValue}`);
    }
  }
}

export function blank(): void {
  console.log('');
}

export function json(data: unknown): void {
  console.log(JSON.stringify(data, redactingJsonReplacer, 2));
}

export function formatOutput(data: unknown, format: 'text' | 'json' | 'yaml'): void {
  if (format === 'json') {
    json(data);
  } else if (format === 'yaml') {
    throw new Error('YAML format not yet supported. Use --format json or --format text');
  } else {
    throw new Error('formatOutput with text format should not be called - caller handles text formatting');
  }
}
