/**
 * eai update — check for and install CLI updates.
 *
 * eai update         Install the latest version
 * eai update --check Dry-run: show current vs latest
 */

import { Command, Option } from 'commander';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile, readlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import process from 'node:process';
import ora from 'ora';
import chalk from 'chalk';
import {
  fetchLatestRelease,
  NPMJS_REGISTRY_URL,
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
const pkg = require('../../package.json') as { name?: string; version: string };
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const STATIC_SCOPE_REGISTRY_FLAG = `--@enterpriseai:registry=${STATIC_REGISTRY_URL}`;
const NPMJS_REGISTRY_FLAG = `--registry=${NPMJS_REGISTRY_URL}`;
const NPMJS_SCOPE_REGISTRY_FLAG = `--@enterpriseai:registry=${NPMJS_REGISTRY_URL}`;

function installedPackageName(): string {
  return pkg.name === 'eai-cli' ? 'eai-cli' : '@enterpriseai/cli';
}

export function buildUpdateInstallArgs(
  version: string,
  channel: ReleaseChannel = 'npmjs',
  packageName = '@enterpriseai/cli',
): string[] {
  const resolvedPackageName = channel === 'static-registry'
    ? '@enterpriseai/cli'
    : packageName;
  const args = [
    'install',
    '-g',
    `${resolvedPackageName}@${version}`,
    '--prefer-online',
  ];

  if (channel === 'static-registry') {
    args.push(STATIC_SCOPE_REGISTRY_FLAG);
  } else {
    args.push(NPMJS_REGISTRY_FLAG);
    if (resolvedPackageName.startsWith('@enterpriseai/')) {
      args.push(NPMJS_SCOPE_REGISTRY_FLAG);
    }
  }

  return args;
}

export function buildUpdateInstallExecConfig(
  version: string,
  channel: ReleaseChannel = 'npmjs',
  packageName = '@enterpriseai/cli',
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; shell: boolean } {
  const npmExecutable = getNpmExecutable(platform);
  const installArgs = buildUpdateInstallArgs(version, channel, packageName);

  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', npmExecutable, ...installArgs],
      shell: false,
    };
  }

  return {
    command: npmExecutable,
    args: installArgs,
    shell: false,
  };
}

export function isUpdatePermissionError(message: string): boolean {
  return /EACCES|permission/i.test(message);
}

export function buildUpdatePermissionGuidance(
  version: string,
  channel: ReleaseChannel = 'npmjs',
  platform: NodeJS.Platform = process.platform,
): string[] {
  const installCommand = `npm ${buildUpdateInstallArgs(version, channel, installedPackageName()).join(' ')}`;

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

/**
 * EAI Setup stages a pinned, checksum-verified CLI under ~/.eai-setup/toolchains
 * and runs it through its ~/.eai-setup/bin/eai shim, so a global npm install
 * cannot replace it. Returns the toolchains root when this CLI runs from there.
 */
export function findEaiSetupToolchain(
  packageRoot: string = PACKAGE_ROOT,
  homeDir: string = homedir(),
): string | null {
  let toolchainsRoot = join(homeDir, '.eai-setup', 'toolchains');
  try {
    // Node reports this module by its real path; match a home reached through a symlink.
    toolchainsRoot = realpathSync(toolchainsRoot);
  } catch {
    // No EAI Setup toolchain on disk; the lexical comparison below still applies.
  }
  const pathInside = relative(toolchainsRoot, packageRoot);
  if (!pathInside || pathInside.startsWith('..') || isAbsolute(pathInside)) {
    return null;
  }
  return toolchainsRoot;
}

export function buildEaiSetupUpdateGuidance(current: string, latest: string): string[] {
  return [
    `EAI Setup manages this eai command and pins it to ${current}, so eai update cannot replace it.`,
    `Run ${latest} without changing EAI Setup: npx -y @enterpriseai/cli@${latest} <command>`,
    'To update the managed CLI, run a newer EAI Setup release. It installs the CLI version it bundles.',
  ];
}

export interface UpdateBinConflict {
  readonly binPath: string;
  readonly ownerPackage?: string;
  readonly ownerVersion?: string;
}

/**
 * npm refuses to overwrite a bin that another global package owns (EEXIST),
 * for example the retired @eai-tools/cli. Name that owner so the user can
 * remove it instead of retrying the same failing install.
 */
export async function findUpdateBinConflict(message: string): Promise<UpdateBinConflict | null> {
  if (!/\bEEXIST\b/.test(message)) return null;
  const binPath = (/File exists: (.+)/.exec(message) ?? /npm (?:error|ERR!) path (.+)/.exec(message))?.[1]?.trim();
  if (!binPath) return null;

  try {
    const target = resolve(dirname(binPath), await readlink(binPath));
    const owner = /^(.*?[\\/]node_modules[\\/])((?:@[^\\/]+[\\/])?[^\\/]+)(?:[\\/]|$)/.exec(target);
    if (!owner) return { binPath };
    const ownerPackage = owner[2].replace(/\\/g, '/');
    try {
      const ownerManifest = JSON.parse(
        await readFile(join(owner[1], owner[2], 'package.json'), 'utf-8'),
      ) as { version?: unknown };
      return typeof ownerManifest.version === 'string'
        ? { binPath, ownerPackage, ownerVersion: ownerManifest.version }
        : { binPath, ownerPackage };
    } catch {
      return { binPath, ownerPackage };
    }
  } catch {
    return { binPath };
  }
}

export function buildUpdateBinConflictGuidance(
  conflict: UpdateBinConflict,
  installCommand: string,
): string[] {
  if (!conflict.ownerPackage) {
    return [
      `The existing ${conflict.binPath} is not part of this CLI, so npm could not replace it.`,
      `Remove the package or file that provides it, then install the update: ${installCommand}`,
    ];
  }

  const owner = conflict.ownerVersion
    ? `${conflict.ownerPackage} ${conflict.ownerVersion}`
    : conflict.ownerPackage;
  return [
    `The existing ${conflict.binPath} belongs to ${owner}, so npm could not replace it.`,
    `Remove that package: npm uninstall -g ${conflict.ownerPackage}`,
    `Then install the update: ${installCommand}`,
  ];
}

function printGuidance(lines: readonly string[]): void {
  for (const line of lines) {
    if (line.includes(': ')) {
      const [prefix, ...rest] = line.split(': ');
      out.info(`${prefix}: ${chalk.cyan(rest.join(': '))}`);
    } else {
      out.info(line);
    }
  }
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
  - The CLI installs from the public npm registry by default.
  - Recommended install: npm install -g eai-cli
  - Canonical package install: npm install -g @enterpriseai/cli
  - Static registry fallback: npm install -g @enterpriseai/cli --@enterpriseai:registry=${STATIC_REGISTRY_URL}
  - \`eai update --check\` previews CLI, Gofer, and app-template status without writing files.
  - \`eai update\` upgrades the CLI, force-refreshes Gofer-managed files with backups, and automatically runs a read-only app-template drift check.
  - Use \`eai gofer refresh --check\` to preview Gofer-managed file changes separately.
  - The automatic \`eai template check\` is read-only; app-template and UI files are never auto-merged.
  - If npm hits a permissions error, the CLI explains how to retry on your platform.
  - If another package owns the eai command (npm EEXIST), the CLI names it and shows how to remove it.
  - EAI Setup pins its own CLI copy; \`eai update\` then explains how to run or install a newer version.
  `)
  .action(async (options: { check?: boolean; projectRefresh?: boolean; projectMaintenanceOnly?: boolean }) => {
    if (options.projectMaintenanceOnly) {
      await runProjectUpdateMaintenance({
        mode: options.check ? 'check' : 'apply',
        runTemplateCheck: options.check
          ? undefined
          : () => runCurrentCliCommand(['template', 'check']),
      });
      return;
    }

    const current = pkg.version;

    const spinner = ora('Checking for updates...').start();
    const latestRelease = await fetchLatestRelease();

    if (!latestRelease) {
      spinner.fail('Could not reach the EAI release registry.');
      out.info('Check your network connection and try again.');
      process.exit(1);
    }

    const { channel, version: latest } = latestRelease;
    if (!isNewerVersion(current, latest)) {
      spinner.succeed(`Already on the latest version (${chalk.green(current)})`);
      if (options.projectRefresh !== false) {
        await runProjectUpdateMaintenance({
          mode: options.check ? 'check' : 'apply',
          runTemplateCheck: options.check
            ? undefined
            : () => runCurrentCliCommand(['template', 'check']),
        });
      }
      return;
    }

    spinner.succeed(`Update available: ${chalk.dim(current)} → ${chalk.green(latest)}`);
    const setupManaged = findEaiSetupToolchain() !== null;

    if (options.check) {
      if (setupManaged) {
        printGuidance(buildEaiSetupUpdateGuidance(current, latest));
      } else {
        out.info(`Run ${chalk.cyan('eai update')} to install.`);
      }
      if (options.projectRefresh !== false) {
        await runProjectUpdateMaintenance({
          mode: 'check',
        });
      }
      return;
    }

    if (setupManaged) {
      printGuidance(buildEaiSetupUpdateGuidance(current, latest));
      process.exit(1);
    }

    const packageName = installedPackageName();
    const installSpinner = ora(`Installing ${packageName}@${latest}...`).start();
    try {
      const install = buildUpdateInstallExecConfig(latest, channel, packageName);
      await exec(install.command, install.args, { shell: install.shell });
      installSpinner.succeed(`Updated to ${chalk.green(latest)}`);
    } catch (err) {
      installSpinner.fail('Update failed.');
      const message = err instanceof Error ? err.message : String(err);
      const binConflict = await findUpdateBinConflict(message);
      if (binConflict) {
        printGuidance(buildUpdateBinConflictGuidance(
          binConflict,
          `npm ${buildUpdateInstallArgs(latest, channel, packageName).join(' ')}`,
        ));
      } else if (isUpdatePermissionError(message)) {
        printGuidance(buildUpdatePermissionGuidance(latest, channel));
      } else {
        out.error(message);
        out.info(`Manual install: ${chalk.cyan(`npm ${buildUpdateInstallArgs(latest, channel, packageName).join(' ')}`)}`);
      }
      process.exit(1);
    }

    if (options.projectRefresh !== false) {
      const ranFreshMaintenance = await runInstalledEaiCommand(['update', '--project-maintenance-only']);
      if (!ranFreshMaintenance) {
        out.warn('Could not run project maintenance through the freshly installed CLI; using the current process instead.');
        await runProjectUpdateMaintenance({
          mode: 'apply',
          runTemplateCheck: () => runCurrentCliCommand(['template', 'check']),
        });
      }
    }
  });
