/**
 * Shared output utilities — consistent formatting across all CLI commands.
 */

import chalk from 'chalk';

export const symbols = {
  success: chalk.green('✓'),
  error: chalk.red('✗'),
  warning: chalk.yellow('⚠'),
  info: chalk.blue('→'),
  pending: chalk.gray('○'),
  updated: chalk.cyan('↻'),
  unchanged: chalk.gray('='),
  added: chalk.green('+'),
  removed: chalk.red('-'),
  changed: chalk.yellow('~'),
} as const;

export function success(msg: string): void {
  console.log(`${symbols.success} ${msg}`);
}

export function error(msg: string): void {
  console.error(`${symbols.error} ${msg}`);
}

export function warn(msg: string): void {
  console.log(`${symbols.warning} ${msg}`);
}

export function info(msg: string): void {
  console.log(`${symbols.info} ${msg}`);
}

export function heading(msg: string): void {
  console.log(`\n${chalk.bold(msg)}`);
}

export function dim(msg: string): void {
  console.log(chalk.dim(msg));
}

export function table(rows: Array<[string, string]>): void {
  const maxLabel = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    console.log(`  ${chalk.dim(label.padEnd(maxLabel))}  ${value}`);
  }
}

export function blank(): void {
  console.log();
}
