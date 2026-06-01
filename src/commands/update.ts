/**
 * eai update — check for and install CLI updates.
 *
 * eai update         Install the latest version
 * eai update --check Dry-run: show current vs latest
 */

import { Command } from 'commander';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import ora from 'ora';
import chalk from 'chalk';
import {
  fetchLatestRelease,
  STATIC_REGISTRY_URL,
  type ReleaseChannel,
  isNewerVersion,
} from '../lib/update-check.js';
import { getNpmExecutable } from '../lib/npm.js';
import * as out from '../lib/output.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const STATIC_SCOPE_REGISTRY_FLAG = `--@eai-tools:registry=${STATIC_REGISTRY_URL}`;

export function buildUpdateInstallArgs(
  version: string,
  _channel: ReleaseChannel = 'static-registry',
): string[] {
  const args = [
    'install',
    '-g',
    `@eai-tools/cli@${version}`,
    '--prefer-online',
  ];

  args.push(STATIC_SCOPE_REGISTRY_FLAG);

  return args;
}

export function isUpdatePermissionError(message: string): boolean {
  return /EACCES|permission/i.test(message);
}

export function buildUpdatePermissionGuidance(
  version: string,
  channel: ReleaseChannel = 'static-registry',
  platform: NodeJS.Platform = process.platform,
): string[] {
  const installCommand = `npm ${buildUpdateInstallArgs(version, channel).join(' ')}`;

  if (platform === 'win32') {
    return [
      'Your global npm install location is not writable from this shell.',
      `Retry from an elevated PowerShell or Command Prompt: ${installCommand}`,
    ];
  }

  return [
    'Your global npm install location is not writable from this shell.',
    `Retry from a shell that can write to your global npm directory: ${installCommand}`,
    'If you use nvm, Homebrew, or Volta, prefer their user-writable install path instead of sudo.',
  ];
}

export const updateCommand = new Command('update')
  .description('Check for and install CLI updates')
  .option('--check', 'Only check for updates without installing')
  .addHelpText('after', `
Examples:
  $ eai update --check
  $ eai update

Notes:
  - The CLI installs from the scoped EAI static registry on GitHub Pages.
  - One-time setup for manual installs: npm config set @eai-tools:registry ${STATIC_REGISTRY_URL} --location=user
  - \`eai update\` upgrades the installed CLI package only; it does not rewrite existing project files.
  - Use \`eai gofer refresh --check\` to preview safe repo-local Gofer asset updates.
  - Use \`eai template check\` to preview app-template and UI drift before copying changes manually.
  - If npm hits a permissions error, the CLI explains how to retry on your platform.
  `)
  .action(async (options: { check?: boolean }) => {
    const current = pkg.version;

    const spinner = ora('Checking for updates...').start();
    const latestRelease = await fetchLatestRelease();

    if (!latestRelease) {
      spinner.fail('Could not reach the EAI static release registry.');
      out.info('Check your network connection and try again.');
      process.exit(1);
    }

    const { channel, version: latest } = latestRelease;
    if (!isNewerVersion(current, latest)) {
      spinner.succeed(`Already on the latest version (${chalk.green(current)})`);
      return;
    }

    spinner.succeed(`Update available: ${chalk.dim(current)} → ${chalk.green(latest)}`);

    if (options.check) {
      out.info(`Run ${chalk.cyan('eai update')} to install.`);
      return;
    }

    const installSpinner = ora(`Installing @eai-tools/cli@${latest}...`).start();
    try {
      await exec(getNpmExecutable(), buildUpdateInstallArgs(latest, channel));
      installSpinner.succeed(`Updated to ${chalk.green(latest)}`);
    } catch (err) {
      installSpinner.fail('Update failed.');
      const message = err instanceof Error ? err.message : String(err);
      if (isUpdatePermissionError(message)) {
        for (const line of buildUpdatePermissionGuidance(latest, channel)) {
          if (line.includes(': ')) {
            const [prefix, ...rest] = line.split(': ');
            out.info(`${prefix}: ${chalk.cyan(rest.join(': '))}`);
          } else {
            out.info(line);
          }
        }
      } else {
        out.error(message);
        out.info(`Manual install: ${chalk.cyan(`npm ${buildUpdateInstallArgs(latest, channel).join(' ')}`)}`);
      }
      process.exit(1);
    }
  });
