/**
 * eai deploy — deployment management.
 *
 * setup:   Generate deploy-demo.yml + configure GitHub secrets
 * trigger: Trigger deployment workflow
 * status:  Check deployment status
 */

import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile } from '../lib/config.js';
import * as out from '../lib/output.js';

const exec = promisify(execFile);

export const deployCommand = new Command('deploy')
  .description('Deployment management');

// ─── eai deploy setup ─────────────────────────────────────────────────────

deployCommand
  .command('setup')
  .description('Generate deployment workflow and configure GitHub secrets')
  .option('--repo <repo>', 'GitHub repo (org/name)')
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) { out.error('Not in an EAI project.'); process.exit(1); }

    const envVars = await loadEnvFile(root);
    const appName = envVars.NEXT_PUBLIC_APP_NAME || 'my-vertical';

    // Check if workflow already exists
    const workflowPath = join(root, '.github', 'workflows', 'deploy-demo.yml');
    try {
      await access(workflowPath);
      out.warn('deploy-demo.yml already exists. Skipping workflow generation.');
    } catch {
      const spinner = ora('Generating deploy-demo.yml...').start();
      const workflowDir = join(root, '.github', 'workflows');
      await mkdir(workflowDir, { recursive: true });

      const workflow = generateWorkflow(appName);
      await writeFile(workflowPath, workflow, 'utf-8');
      spinner.succeed('Created .github/workflows/deploy-demo.yml');
    }

    // Configure GitHub secrets if repo is available
    const repo = options.repo;
    if (repo) {
      out.heading('Configuring GitHub secrets');
      out.info(`Repository: ${chalk.cyan(repo)}`);

      const secrets = [
        { name: 'AZUREAPPSERVICE_CLIENTID', desc: 'Azure AD app client ID for deployment' },
        { name: 'AZUREAPPSERVICE_TENANTID', desc: 'Azure AD tenant ID' },
        { name: 'AZUREAPPSERVICE_SUBSCRIPTIONID', desc: 'Azure subscription ID' },
        { name: 'AZURE_RESOURCE_GROUP', desc: 'Resource group name' },
        { name: 'AZURE_WEBAPP_NAME', desc: 'App Service name' },
      ];

      for (const secret of secrets) {
        try {
          await exec('gh', ['secret', 'list', '--repo', repo]);
          out.info(`Configure ${chalk.cyan(secret.name)}: ${secret.desc}`);
        } catch {
          out.warn(`Could not check secrets for ${repo}. Install and authenticate gh CLI.`);
          break;
        }
      }

      out.blank();
      out.info('Set secrets with: gh secret set SECRET_NAME --repo ' + repo);
    } else {
      out.blank();
      out.info('To configure GitHub secrets, re-run with --repo org/name');
    }
  });

// ─── eai deploy trigger ──────────────────────────────────────────────────

deployCommand
  .command('trigger')
  .description('Trigger deployment workflow')
  .option('--repo <repo>', 'GitHub repo (org/name)')
  .option('--branch <branch>', 'Branch to deploy', 'main')
  .option('--workflow <name>', 'Workflow filename', 'deploy-demo.yml')
  .option('--json', 'Output raw JSON', false)
  .action(async (options) => {
    let repo = options.repo;

    if (!repo) {
      // Try to detect from git remote
      try {
        const { stdout } = await exec('git', ['remote', 'get-url', 'origin']);
        const match = stdout.trim().match(/github\.com[:/](.+?)(?:\.git)?$/);
        if (match) repo = match[1];
      } catch { /* can't detect */ }
    }

    if (!repo) {
      out.error('Could not detect GitHub repo. Use --repo org/name');
      process.exit(1);
    }

    const spinner = ora(`Triggering ${options.workflow} on ${repo}...`).start();
    try {
      await exec('gh', [
        'workflow', 'run', options.workflow,
        '--repo', repo,
        '--ref', options.branch,
      ]);
      spinner.succeed(`Triggered deployment on ${chalk.cyan(repo)}@${options.branch}`);

      if (options.json) {
      } else {
        out.info(`Check status: ${chalk.dim(`eai deploy status --repo ${repo}`)}`);
      }
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai deploy status ──────────────────────────────────────────────────

deployCommand
  .command('status')
  .description('Check deployment status')
  .option('--repo <repo>', 'GitHub repo (org/name)')
  .option('--json', 'Output raw JSON', false)
  .action(async (options) => {
    let repo = options.repo;

    if (!repo) {
      try {
        const { stdout } = await exec('git', ['remote', 'get-url', 'origin']);
        const match = stdout.trim().match(/github\.com[:/](.+?)(?:\.git)?$/);
        if (match) repo = match[1];
      } catch { /* can't detect */ }
    }

    if (!repo) {
      out.error('Could not detect GitHub repo. Use --repo org/name');
      process.exit(1);
    }

    const spinner = ora('Checking deployment status...').start();
    try {
      const { stdout } = await exec('gh', [
        'run', 'list',
        '--repo', repo,
        '--limit', '5',
        '--json', 'status,conclusion,name,createdAt,headBranch',
      ]);

      const runs = JSON.parse(stdout) as Array<{
        status: string;
        conclusion: string;
        name: string;
        createdAt: string;
        headBranch: string;
      }>;

      spinner.succeed(`Recent deployments for ${chalk.cyan(repo)}`);

      if (options.json) {
      } else {
        for (const run of runs) {
          const icon = run.conclusion === 'success' ? out.symbols.success
            : run.conclusion === 'failure' ? out.symbols.error
            : run.status === 'in_progress' ? chalk.blue('⟳')
            : out.symbols.pending;
          const time = new Date(run.createdAt).toLocaleString();
        }
      }
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

function generateWorkflow(appName: string): string {
  return `name: Deploy ${appName}

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  APP_NAME: ${appName}
  NODE_VERSION: '20.x'

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment: demo
    permissions:
      id-token: write
      contents: read

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: \${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build Object Types JSON
        run: npm run build:object-types

      - name: Build
        run: npm run build
        env:
          APP_BASE_PATH: /\${{ env.APP_NAME }}

      - name: Package standalone output
        run: |
          mkdir -p deploy/\${{ env.APP_NAME }}
          cp -r .next/standalone/. deploy/\${{ env.APP_NAME }}/
          cp -r .next/static deploy/\${{ env.APP_NAME }}/.next/
          cp -r public deploy/\${{ env.APP_NAME }}/ 2>/dev/null || true
          cd deploy && zip -r ../app-content.zip \${{ env.APP_NAME }}

      - name: Azure Login
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZUREAPPSERVICE_CLIENTID }}
          tenant-id: \${{ secrets.AZUREAPPSERVICE_TENANTID }}
          subscription-id: \${{ secrets.AZUREAPPSERVICE_SUBSCRIPTIONID }}

      - name: Deploy to Azure
        run: |
          az webapp deploy \\
            --resource-group \${{ secrets.AZURE_RESOURCE_GROUP }} \\
            --name \${{ secrets.AZURE_WEBAPP_NAME }} \\
            --src-path app-content.zip \\
            --type zip \\
            --target-path /home/site/wwwroot/\${{ env.APP_NAME }}

      - name: Restart App Service
        run: |
          az webapp restart \\
            --resource-group \${{ secrets.AZURE_RESOURCE_GROUP }} \\
            --name \${{ secrets.AZURE_WEBAPP_NAME }}
`;
}
