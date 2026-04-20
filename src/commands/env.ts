/**
 * eai env — manage environment variables.
 *
 * pull: sync Azure App Config + Key Vault → local .env.local
 * list: show current environment variables
 * push: push local overrides to cloud (admin)
 */

import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile, patchEnvFile } from '../lib/config.js';
import { getAzureCliInvocation } from '../lib/azure-cli.js';
import { pullCloudEnvValues, resolveAppConfigStore } from '../lib/cloud-env.js';
import * as out from '../lib/output.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';

const exec = promisify(execFile);

async function execAzureCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const invocation = getAzureCliInvocation(args);
  return exec(invocation.file, invocation.args);
}

export const envCommand = new Command('env')
  .description('Manage environment variables');

// ─── eai env pull ──────────────────────────────────────────────────────────

envCommand
  .command('pull')
  .description('Sync cloud config to local .env.local')
  .option('--env <environment>', 'Environment (dev, test, prod)', 'dev')
  .option('--label <label>', 'App Config label (defaults to app name)')
  .option('--include-secrets', 'Resolve Key Vault references', false)
  .addHelpText('after', `
Examples:
  $ eai env pull
  $ eai env pull --env prod --include-secrets
  `)
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) {
      exitWithError(ErrorCode.E001);
    }

    // Determine label from existing env or flag
    const existingEnv = await loadEnvFile(root);
    const label = options.label || existingEnv.NEXT_PUBLIC_APP_NAME;
    if (!label) {
      exitWithError(ErrorCode.E303, { field: '--label or NEXT_PUBLIC_APP_NAME in .env.local' });
    }

    const store = resolveAppConfigStore(options.env);
    const spinner = ora(`Pulling config from ${store} (label: ${label})`).start();

    try {
      const { patches, secretRefs } = await pullCloudEnvValues({
        environment: options.env,
        label,
        includeSecrets: options.includeSecrets,
      });
      spinner.succeed(`Found ${Object.keys(patches).length + (!options.includeSecrets ? secretRefs.length : 0)} config values`);

      for (const [key, value] of Object.entries(patches)) {
        if (secretRefs.some((ref) => ref.key === key)) {
          out.success(`${key} = ${chalk.dim('[from Key Vault]')}`);
        } else {
          out.success(`${key} = ${chalk.dim(truncate(value, 60))}`);
        }
      }

      if (!options.includeSecrets) {
        for (const ref of secretRefs) {
          if (!(ref.key in patches)) {
            out.info(`${ref.key} = ${chalk.dim('[Key Vault ref — skipped]')}`);
          }
        }
      }

      // Merge into existing .env.local — preserves TENANT_KEYS, AUTH_SECRET, etc.
      if (Object.keys(patches).length > 0) {
        await patchEnvFile(root, patches);
      }

      out.blank();
      out.success(`Written to ${chalk.bold('.env.local')} (${Object.keys(patches).length} variables)`);

      if (secretRefs.length > 0 && !options.includeSecrets) {
        out.blank();
        out.warn(`${secretRefs.length} Key Vault references skipped. Use --include-secrets to resolve them.`);
      }
    } catch (err) {
      spinner.fail('Failed to pull config');
      if (err instanceof Error && err.message.includes('az')) {
        out.error('Azure CLI not found or not logged in. Run `az login` first.');
      } else {
        out.error(err instanceof Error ? err.message : String(err));
      }
      process.exit(1);
    }
  });

// ─── eai env list ──────────────────────────────────────────────────────────

envCommand
  .command('list')
  .description('Show current environment variables')
  .option('--show-secrets', 'Show secret values (default: masked)', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) {
      exitWithError(ErrorCode.E001);
    }

    if (options.json) options.format = 'json';

    const env = await loadEnvFile(root);
    const keys = Object.keys(env).sort();

    if (keys.length === 0) {
      if (options.format === 'json') {
        out.json({ variables: {}, count: 0 });
      } else {
        out.warn('No .env.local found. Run `eai env pull` to sync from cloud.');
      }
      return;
    }

    const secretKeys = ['SECRET', 'PASSWORD', 'KEY', 'TOKEN', 'CREDENTIAL'];
    const variables: Record<string, string> = {};

    for (const key of keys) {
      const isSecret = secretKeys.some(s => key.toUpperCase().includes(s));
      const value = isSecret && !options.showSecrets ? '[hidden]' : env[key];
      variables[key] = value;
    }

    if (options.format === 'json') {
      out.json({ variables, count: keys.length });
    } else {
      out.heading(`Environment (${keys.length} variables)`);
      for (const key of keys) {
        const displayValue = variables[key] === '[hidden]'
          ? chalk.dim('[hidden — use --show-secrets]')
          : variables[key];
        out.info(`${chalk.cyan(key)} = ${displayValue}`);
      }
    }
  });

// ─── eai env push ──────────────────────────────────────────────────────────

envCommand
  .command('push')
  .description('Push local config overrides to cloud (admin)')
  .option('--label <label>', 'App Config label')
  .option('--key <key>', 'Push a single key')
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) {
      exitWithError(ErrorCode.E001);
    }

    const env = await loadEnvFile(root);
    const label = options.label || env.NEXT_PUBLIC_APP_NAME;

    if (!label) {
      exitWithError(ErrorCode.E303, { field: '--label or NEXT_PUBLIC_APP_NAME' });
    }

    const keysToSync = options.key ? [options.key] : Object.keys(env);
    const store = resolveAppConfigStore('dev');
    const spinner = ora(`Pushing ${keysToSync.length} values to ${store} (label: ${label})`).start();

    let pushed = 0;
    for (const key of keysToSync) {
      if (!env[key]) continue;
      // Skip comments and empty values
      if (key.startsWith('#')) continue;

      try {
        await execAzureCli([
          'appconfig', 'kv', 'set',
          '--name', store,
          '--key', key,
          '--value', env[key],
          '--label', label,
          '--yes',
        ]);
        pushed++;
      } catch (_err) {
        spinner.warn(`Failed to push ${key}`);
      }
    }

    spinner.succeed(`Pushed ${pushed} values to ${store} (label: ${label})`);
  });

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}
