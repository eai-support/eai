/**
 * eai verify — run platform connectivity checks.
 * eai doctor — comprehensive diagnostics with fix suggestions.
 */

import { Command } from 'commander';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile, loadObjectTypes } from '../lib/config.js';
import { isAuthenticated, loadTokens } from '../lib/auth.js';
import { PlatformAPIClient } from '../lib/api.js';
import * as out from '../lib/output.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';

export const verifyCommand = new Command('verify')
  .description('Run platform connectivity checks')
  .action(async () => {
    const root = await findProjectRoot();
    if (!root) {
      exitWithError(ErrorCode.E001);
    }

    const envVars = await loadEnvFile(root);
    const env = { ...envVars, ...process.env };
    const publicApiUrl = env.BASE_URL_PUBLIC_API;
    const tenantId = env.TENANT_DEFAULT_ID || Object.keys(env)
      .filter(k => k.startsWith('TENANT_') && k.endsWith('_ID'))
      .map(k => env[k])[0];

    if (!publicApiUrl) {
      exitWithError(ErrorCode.E002, { var: 'BASE_URL_PUBLIC_API' });
    }

    out.heading('Platform Connectivity Checks');
    out.blank();

    const client = new PlatformAPIClient(publicApiUrl, tenantId || 'unknown');
    let passed = 0;
    let failed = 0;

    // Check 1: PublicAPI reachable
    const apiSpinner = ora('PublicAPI gateway').start();
    try {
      const start = Date.now();
      const res = await fetch(`${publicApiUrl}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      const latency = Date.now() - start;
      if (res.ok || res.status === 404) {
        // 404 is fine — means server is up, just no /health endpoint
        apiSpinner.succeed(`PublicAPI reachable (${latency}ms)`);
        passed++;
      } else {
        apiSpinner.fail(`PublicAPI returned ${res.status}`);
        failed++;
      }
    } catch (err) {
      apiSpinner.fail(`PublicAPI not reachable: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }

    // Check 2: Auth token
    const authSpinner = ora('Authentication').start();
    const authenticated = await isAuthenticated();
    if (authenticated) {
      const tokens = await loadTokens();
      authSpinner.succeed(`Authenticated as ${tokens?.upn || 'user'}`);
      passed++;
    } else {
      authSpinner.warn('Not authenticated — run `eai login`');
      failed++;
    }

    // Check 3: Platform service connectivity
    if (authenticated && tenantId) {
      const cfgSpinner = ora('Platform service').start();
      try {
        const res = await client.platformRequest('/object-types', 'GET', undefined, { limit: 1 });
        if (res.ok) {
          cfgSpinner.succeed('Platform service reachable');
          passed++;
        } else {
          cfgSpinner.fail(`Platform service returned ${res.status}`);
          failed++;
        }
      } catch (err) {
        cfgSpinner.fail(`Platform service not reachable: ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      }
    }

    // Check 4: Data service (schema)
    if (authenticated && tenantId) {
      const resSpinner = ora('Data service (schema)').start();
      try {
        const res = await client.getSchema();
        if (res.ok) {
          const schema = await res.json() as { objectTypes?: unknown[] };
          const typeCount = (schema?.objectTypes as unknown[])?.length || 0;
          resSpinner.succeed(`Data service reachable — ${typeCount} published types`);
          passed++;
        } else {
          resSpinner.fail(`Data service returned ${res.status}`);
          failed++;
        }
      } catch (err) {
        resSpinner.fail(`Data service not reachable: ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      }
    }

    // Check 5: Local Object Types
    const typesSpinner = ora('Local Object Types').start();
    try {
      const types = await loadObjectTypes(root);
      const totalTypes = Object.values(types).reduce((sum, t) => sum + t.length, 0);
      const tenantKeys = Object.keys(types);
      typesSpinner.succeed(`${totalTypes} types across ${tenantKeys.length} tenant scope(s)`);
      passed++;
    } catch (err) {
      typesSpinner.fail(`No Object Types found: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }

    // Summary
    out.blank();
    if (failed === 0) {
      out.success(`All ${passed} checks passed`);
    } else {
      out.warn(`${passed} passed, ${failed} failed`);
    }
  });

// ─── eai doctor ────────────────────────────────────────────────────────────

export const doctorCommand = new Command('doctor')
  .description('Diagnose common issues and suggest fixes')
  .option('--fix', 'Attempt to fix issues automatically', false)
  .action(async (_options) => {
    const issues: Array<{ severity: 'error' | 'warn' | 'info'; message: string; fix?: string }> = [];

    out.heading('EAI Platform Health Check');
    out.blank();

    // 1. Project detection
    const root = await findProjectRoot();
    if (!root) {
      out.error('Not in an EAI project directory.');
      exitWithError(ErrorCode.E001);
    }
    out.success(`Project root: ${chalk.dim(root)}`);

    // 2. .env.local exists
    try {
      await access(join(root, '.env.local'));
      out.success('.env.local exists');
    } catch {
      issues.push({
        severity: 'error',
        message: '.env.local not found',
        fix: 'Run `eai env pull` to sync from Azure App Config',
      });
      out.error('.env.local not found');
    }

    // 3. Required env vars
    const envVars = await loadEnvFile(root);
    const required = ['BASE_URL_PUBLIC_API', 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'AUTH_SECRET'];
    for (const key of required) {
      const value = envVars[key] || process.env[key];
      if (!value || value.startsWith('<')) {
        issues.push({
          severity: 'error',
          message: `${key} not set or has placeholder value`,
          fix: `Set ${key} in .env.local or run \`eai env pull --include-secrets\``,
        });
        out.error(`${key} — not set`);
      } else {
        out.success(`${key} — set`);
      }
    }

    // 4. Auth status
    const authenticated = await isAuthenticated();
    if (authenticated) {
      const tokens = await loadTokens();
      out.success(`Authenticated as ${tokens?.upn || 'user'}`);
    } else {
      issues.push({
        severity: 'warn',
        message: 'Not authenticated',
        fix: 'Run `eai login` to authenticate with Entra CIAM',
      });
      out.warn('Not authenticated');
    }

    // 5. Object types loadable
    try {
      const types = await loadObjectTypes(root);
      const totalTypes = Object.values(types).reduce((sum, t) => sum + t.length, 0);
      out.success(`Object Types: ${totalTypes} defined`);
    } catch (err) {
      issues.push({
        severity: 'warn',
        message: `Object Types not loadable: ${err instanceof Error ? err.message : String(err)}`,
        fix: 'Check src/eai.config/object-types.ts for syntax errors',
      });
      out.warn('Object Types not loadable');
    }

    // 6. Deployment workflow exists
    try {
      await access(join(root, '.github', 'workflows', 'deploy-demo.yml'));
      out.success('Deployment workflow exists');
    } catch {
      issues.push({
        severity: 'warn',
        message: 'deploy-demo.yml not found',
        fix: 'Run `eai deploy setup` to generate the workflow',
      });
      out.warn('deploy-demo.yml not found');
    }

    // 7. node_modules exists
    try {
      await access(join(root, 'node_modules'));
      out.success('Dependencies installed');
    } catch {
      issues.push({
        severity: 'error',
        message: 'node_modules not found',
        fix: 'Run `npm install`',
      });
      out.error('Dependencies not installed');
    }

    // 8. Platform SDK available
    try {
      await access(join(root, 'packages', 'platform-sdk'));
      out.success('Platform SDK present');
    } catch {
      try {
        await access(join(root, 'node_modules', '@eai-tools', 'platform-sdk'));
        out.success('Platform SDK installed');
      } catch {
        issues.push({
          severity: 'warn',
          message: 'Platform SDK not found',
          fix: 'Run `npm install` to install @eai-tools/platform-sdk',
        });
        out.warn('Platform SDK not found');
      }
    }

    // Summary
    out.blank();
    if (issues.length === 0) {
      out.success('No issues found. Your project is healthy!');
    } else {
      out.heading(`${issues.length} issue(s) found`);
      out.blank();
      for (const issue of issues) {
        const icon = issue.severity === 'error' ? out.symbols.error
          : issue.severity === 'warn' ? out.symbols.warning
          : out.symbols.info;
        if (issue.fix) {
        }
      }
    }
  });
