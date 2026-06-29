/**
 * eai update — check for and install CLI updates.
 *
 * eai update         Install the latest version
 * eai update --check Dry-run: show current vs latest
 */

import { Command, Option } from 'commander';
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
import {
  runCurrentCliCommand,
  runInstalledEaiCommand,
  runProjectUpdateMaintenance,
} from '../lib/update-maintenance.js';

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
  .option('--no-project-refresh', 'Skip Gofer/app-template maintenance for the current project')
  .addOption(new Option('--project-maintenance-only', 'Run project maintenance without checking the CLI release').hideHelp())
  .addHelpText('after', `
Examples:
  $ eai update --check
  $ eai update

Notes:
  - The CLI installs from the scoped EAI static registry on GitHub Pages.
  - One-time setup for manual installs: npm config set @eai-tools:registry ${STATIC_REGISTRY_URL} --location=user
  - \`eai update --check\` previews CLI, Gofer, and app-template status without writing files.
  - \`eai update\` upgrades the CLI, refreshes safe Gofer-managed files in the current EAI project, and reports app-template drift.
  - Use \`eai gofer refresh --check\` to preview Gofer-managed file changes separately.
  - App-template and UI files are not auto-merged; use \`eai template check\` to review them.
  - If npm hits a permissions error, the CLI explains how to retry on your platform.
  `)
  .action(async (options: { check?: boolean; projectRefresh?: boolean; projectMaintenanceOnly?: boolean }) => {
    if (options.projectMaintenanceOnly) {
      await runProjectUpdateMaintenance({
        mode: options.check ? 'check' : 'apply',
        offerTemplateCheck: !options.check,
        runTemplateCheck: () => runCurrentCliCommand(['template', 'check']),
      });
      return;
    }

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
      if (options.projectRefresh !== false) {
        await runProjectUpdateMaintenance({
          mode: options.check ? 'check' : 'apply',
          offerTemplateCheck: !options.check,
          runTemplateCheck: () => runCurrentCliCommand(['template', 'check']),
        });
      }
      return;
    }

    spinner.succeed(`Update available: ${chalk.dim(current)} → ${chalk.green(latest)}`);

    if (options.check) {
      out.info(`Run ${chalk.cyan('eai update')} to install.`);
      if (options.projectRefresh !== false) {
        await runProjectUpdateMaintenance({
          mode: 'check',
        });
      }
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

    if (options.projectRefresh !== false) {
      const ranFreshMaintenance = await runInstalledEaiCommand(['update', '--project-maintenance-only']);
      if (!ranFreshMaintenance) {
        out.warn('Could not run project maintenance through the freshly installed CLI; using the current process instead.');
        await runProjectUpdateMaintenance({
          mode: 'apply',
          offerTemplateCheck: true,
          runTemplateCheck: () => runCurrentCliCommand(['template', 'check']),
        });
      }
    }
  });
