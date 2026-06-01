/**
 * eai dev — start local development server.
 *
 * Starts Next.js with BFF proxy pointing to live PublicAPI.
 * Checks connectivity before starting.
 */

import { Command } from 'commander';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile } from '../lib/config.js';
import { getNpmExecutable } from '../lib/npm.js';
import { getAccessToken } from '../lib/auth.js';
import * as out from '../lib/output.js';

export const devCommand = new Command('dev')
  .description('Start local development server')
  .option('--port <port>', 'Port number', '3000')
  .option('--turbo', 'Use Turbopack (default: true)', true)
  .option('--no-turbo', 'Disable Turbopack')
  .option('--skip-checks', 'Skip connectivity checks', false)
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) {
      out.error('Not in an EAI project. Run `eai init` to create one, or cd into a project.');
      process.exit(1);
    }

    const envVars = await loadEnvFile(root);
    const env = { ...envVars, ...process.env };
    const appName = env.NEXT_PUBLIC_APP_NAME || 'unknown';
    const publicApiUrl = env.BASE_URL_PUBLIC_API;
    let accessToken = env.EAI_ACCESS_TOKEN;

    if (!accessToken) {
      try {
        accessToken = await getAccessToken() || undefined;
        if (accessToken) {
          env.EAI_ACCESS_TOKEN = accessToken;
        }
      } catch {
        accessToken = undefined;
      }
    }

    out.heading(`Starting ${chalk.cyan(appName)}`);
    out.blank();

    // Pre-flight checks
    if (!options.skipChecks) {
      // Check .env.local
      if (Object.keys(envVars).length === 0) {
        out.warn('No .env.local found. Run `eai env pull` to sync from cloud.');
      } else {
        out.success('Loaded .env.local');
      }

      // Check PublicAPI connectivity
      if (publicApiUrl) {
        try {
          const res = await fetch(`${publicApiUrl}/health`, {
            signal: AbortSignal.timeout(5_000),
          });
          if (res.ok || res.status === 404) {
            out.success(`PublicAPI reachable at ${chalk.dim(publicApiUrl)}`);
          } else {
            out.warn(`PublicAPI returned ${res.status}`);
          }
        } catch {
          out.warn(`PublicAPI not reachable. CRUD/chat operations may fail.`);
          out.info('Run `eai verify` to diagnose connectivity.');
        }
      } else {
        out.warn('BASE_URL_PUBLIC_API not set. API calls will fail.');
      }

      if (accessToken) {
        out.success('Loaded CLI access token for local API proxy');
      } else if (!env.ENTRA_CLIENT_ID || !env.ENTRA_CLIENT_SECRET || !env.ENTRA_TENANT_ID) {
        out.warn('No CLI token or Entra client credentials available. Local API proxy calls may fail.');
        out.info('Run `eai login` before `eai dev`, or populate ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, and ENTRA_TENANT_ID.');
      }

      out.blank();
    }

    // Start Next.js dev server
    const args = ['run', 'dev', '--', '--port', options.port];
    if (options.turbo) {
      args.push('--turbopack');
    }

    out.info(`Starting Next.js at ${chalk.cyan(`http://localhost:${options.port}/${appName}`)}`);
    out.blank();

    const child = spawn(getNpmExecutable(), args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...envVars, ...(accessToken ? { EAI_ACCESS_TOKEN: accessToken } : {}) },
    });

    child.on('error', (err) => {
      out.error(`Failed to start: ${err.message}`);
      process.exit(1);
    });

    child.on('exit', (code) => {
      process.exit(code || 0);
    });

    // Forward signals
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
  });
