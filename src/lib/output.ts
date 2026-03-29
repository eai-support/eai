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
    console.log(`SUCCESS: ${msg}`);
  } else {
    console.log(`${symbols.success} ${msg}`);
  }
}

export function error(msg: string): void {
  if (simpleMode) {
    console.error(`ERROR: ${msg}`);
  } else {
    console.error(`${symbols.error} ${msg}`);
  }
}

export function warn(msg: string): void {
  if (simpleMode) {
    console.warn(`WARNING: ${msg}`);
  } else {
    console.warn(`${symbols.warning} ${msg}`);
  }
}

export function info(msg: string): void {
  if (simpleMode) {
    console.log(`-> ${msg}`);
  } else {
    console.log(`${symbols.info} ${chalk.dim(msg)}`);
  }
}

export function heading(msg: string): void {
  if (useColor && !simpleMode) {
    console.log(chalk.bold(msg));
  } else {
    console.log(msg);
  }
}

export function dim(msg: string): void {
  if (useColor && !simpleMode) {
    console.log(chalk.dim(msg));
  } else {
    console.log(msg);
  }
}

export function table(rows: Array<[string, string]>): void {
  const maxLabel = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    const paddedLabel = label.padEnd(maxLabel);
    if (useColor && !simpleMode) {
      console.log(`  ${chalk.dim(paddedLabel)}  ${value}`);
    } else {
      console.log(`  ${paddedLabel}  ${value}`);
    }
  }
}

export function blank(): void {
  console.log('');
}

export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
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
