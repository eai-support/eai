/**
 * Shared output utilities — consistent formatting across all CLI commands.
 */

import chalk from 'chalk';

function shouldUseColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return process.stdout.isTTY ?? false;
}

let simpleMode = false;

export function setSimpleMode(enabled: boolean): void {
  simpleMode = enabled;
}

export function isSimpleMode(): boolean {
  return simpleMode;
}

const useColor = shouldUseColor();

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
  if (simpleMode) {
    return;
  }

}

export function error(msg: string): void {
  if (simpleMode) {
    console.error(`ERROR: ${msg}`);
    return;
  }

  console.error(`${symbols.error} ${msg}`);
}

export function warn(msg: string): void {
  if (simpleMode) {
    console.warn(`WARNING: ${msg}`);
    return;
  }

  console.warn(`${symbols.warning} ${msg}`);
}

export function info(msg: string): void {
  if (simpleMode) {
    return;
  }

}

export function heading(msg: string): void {
  if (useColor && !simpleMode) {
    return;
  }

}

export function dim(msg: string): void {
  if (useColor && !simpleMode) {
    return;
  }

}

export function table(rows: Array<[string, string]>): void {
  const maxLabel = Math.max(...rows.map(([label]) => label.length), 0);
  for (const [label, value] of rows) {
    const paddedLabel = label.padEnd(maxLabel);
    if (useColor && !simpleMode) {
    } else {
    }
  }
}

export function blank(): void {
}

export function json(data: unknown): void {
}

export function formatOutput(data: unknown, format: 'text' | 'json' | 'yaml'): void {
  if (format === 'json') {
    json(data);
    return;
  }

  if (format === 'yaml') {
    throw new Error('YAML format not yet supported. Use --format json or --format text');
  }

  throw new Error('formatOutput with text format should not be called - caller handles text formatting');
}
