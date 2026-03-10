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
import ora from 'ora';
import chalk from 'chalk';
import { fetchLatestVersion, isNewerVersion } from '../lib/update-check.js';
import * as out from '../lib/output.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const REGISTRY_URL = 'https://eai-tools.github.io/eai-cli/registry';

export const updateCommand = new Command('update')
  .description('Check for and install CLI updates')
  .option('--check', 'Only check for updates without installing')
  .action(async (options: { check?: boolean }) => {
    const current = pkg.version;

    const spinner = ora('Checking for updates...').start();
    const latest = await fetchLatestVersion();

    if (!latest) {
      spinner.fail('Could not reach the update registry.');
      out.info('Check your network connection and try again.');
      process.exit(1);
    }

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
      await exec('npm', [
        'install', '-g',
        `@eai-tools/cli@${latest}`,
        '--registry', REGISTRY_URL,
      ]);
      installSpinner.succeed(`Updated to ${chalk.green(latest)}`);
    } catch (err) {
      installSpinner.fail('Update failed.');
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('EACCES') || message.includes('permission')) {
        out.info(`Try with sudo: ${chalk.cyan(`sudo npm install -g @eai-tools/cli@${latest} --registry ${REGISTRY_URL}`)}`);
      } else {
        out.error(message);
        out.info(`Manual install: ${chalk.cyan(`npm install -g @eai-tools/cli@${latest} --registry ${REGISTRY_URL}`)}`);
      }
      process.exit(1);
    }
  });
