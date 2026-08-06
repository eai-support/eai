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
import { ErrorCode, exitWithError } from '../lib/error-codes.js';
import {
  expectedStatuses,
  loadRuntimeContract,
  RUNTIME_CONTRACT_FILE,
  validateRuntimeContract,
  type RuntimeSmokeTest,
} from '../lib/runtime-contract.js';

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
    if (!root) { exitWithError(ErrorCode.E001); }

    const envVars = await loadEnvFile(root);
    const appName = envVars.NEXT_PUBLIC_APP_NAME || 'my-app';

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
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai deploy trigger
  $ eai deploy trigger --branch develop
  $ eai deploy trigger --repo eai-support/my-app --format json
  `)
  .action(async (options) => {
    let repo = options.repo;

    if (options.json) options.format = 'json';

    if (!repo) {
      // Try to detect from git remote
      try {
        const { stdout } = await exec('git', ['remote', 'get-url', 'origin']);
        const match = stdout.trim().match(/github\.com[:/](.+?)(?:\.git)?$/);
        if (match) repo = match[1];
      } catch { /* can't detect */ }
    }

    if (!repo) {
      exitWithError(ErrorCode.E305, { details: 'Could not detect GitHub repository. Use --repo org/name' }, options.format);
    }

    const spinner = options.format === 'json' ? null : ora(`Triggering ${options.workflow} on ${repo}...`).start();
    try {
      await exec('gh', [
        'workflow', 'run', options.workflow,
        '--repo', repo,
        '--ref', options.branch,
      ]);

      if (options.format === 'json') {
        out.json({
          triggered: true,
          repo,
          branch: options.branch,
          workflow: options.workflow
        });
      } else {
        spinner!.succeed(`Triggered deployment on ${chalk.cyan(repo)}@${options.branch}`);
        out.info(`Check status: ${chalk.dim(`eai deploy status --repo ${repo}`)}`);
      }
    } catch (err) {
      if (spinner) spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai deploy status ──────────────────────────────────────────────────

deployCommand
  .command('status')
  .description('Check deployment status')
  .option('--repo <repo>', 'GitHub repo (org/name)')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (options) => {
    let repo = options.repo;

    if (options.json) options.format = 'json';

    if (!repo) {
      try {
        const { stdout } = await exec('git', ['remote', 'get-url', 'origin']);
        const match = stdout.trim().match(/github\.com[:/](.+?)(?:\.git)?$/);
        if (match) repo = match[1];
      } catch { /* can't detect */ }
    }

    if (!repo) {
      exitWithError(ErrorCode.E305, { details: 'Could not detect GitHub repository. Use --repo org/name' }, options.format);
    }

    const spinner = options.format === 'json' ? null : ora('Checking deployment status...').start();
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

      if (options.format === 'json') {
        out.json({ repo, runs });
      } else {
        spinner!.succeed(`Recent deployments for ${chalk.cyan(repo)}`);
        for (const run of runs) {
          const icon = run.conclusion === 'success' ? out.symbols.success
            : run.conclusion === 'failure' ? out.symbols.error
            : run.status === 'in_progress' ? chalk.blue('⟳')
            : out.symbols.pending;
          const time = new Date(run.createdAt).toLocaleString();
          out.info(`${icon} ${run.name} — ${chalk.dim(run.headBranch)} — ${chalk.dim(time)}`);
        }
      }
    } catch (err) {
      if (spinner) spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai deploy env ──────────────────────────────────────────────────────

const DEPLOY_PROVIDERS = ['vercel', 'docker', 'aws', 'azure', 'kubernetes', 'vm', 'generic'] as const;
type DeployProvider = (typeof DEPLOY_PROVIDERS)[number];

interface DeployEnvPlan {
  provider: DeployProvider;
  contract: string;
  requiredEnv: string[];
  requiredSecrets: string[];
  optionalSecrets: string[];
  notes: string[];
}

function isDeployProvider(value: string): value is DeployProvider {
  return DEPLOY_PROVIDERS.includes(value as DeployProvider);
}

function providerNotes(provider: DeployProvider): string[] {
  switch (provider) {
    case 'vercel':
      return [
        'Add required environment variables and secrets in Project Settings > Environment Variables.',
        'Add the deployed Auth.js callback URL to the Entra app registration.',
        'Run eai deploy doctor --url against preview and production URLs before marking deployment complete.',
      ];
    case 'docker':
      return [
        'Put non-secret values in an env file or container environment.',
        'Inject secrets through the runtime or orchestrator secret store, not the image.',
        'Run eai deploy doctor --url against the exposed container URL.',
      ];
    case 'aws':
      return [
        'Map required env vars to the app runtime configuration for the selected AWS service.',
        'Store secrets in the provider secret store and inject them at runtime.',
        'Run eai deploy doctor --url against the public load balancer or app URL.',
      ];
    case 'azure':
      return [
        'Map required env vars to App Settings or the selected Azure container runtime.',
        'Store secrets in the platform secret store or Key Vault-backed settings.',
        'Run eai deploy doctor --url against the deployed app URL after restart.',
      ];
    case 'kubernetes':
      return [
        'Put non-secret values in a ConfigMap and secrets in a Secret.',
        'Mount both into the workload as environment variables.',
        'Run eai deploy doctor --url against the ingress URL after rollout.',
      ];
    case 'vm':
      return [
        'Provide env vars and secrets through the process manager or host secret mechanism.',
        'Do not commit runtime secret files to the repo.',
        'Run eai deploy doctor --url against the public or internal app URL.',
      ];
    case 'generic':
      return [
        'Translate the runtime contract into your host environment and secret mechanism.',
        'Configure the Auth.js callback URL in the Entra app registration.',
        'Run eai deploy doctor --url after deployment; /health alone is not enough.',
      ];
  }
}

function buildDeployEnvPlan(provider: DeployProvider, contractPath: string, validation: Awaited<ReturnType<typeof validateRuntimeContract>>): DeployEnvPlan {
  return {
    provider,
    contract: contractPath,
    requiredEnv: validation.summary.requiredEnv,
    requiredSecrets: validation.summary.requiredSecrets,
    optionalSecrets: validation.summary.optionalSecrets,
    notes: providerNotes(provider),
  };
}

deployCommand
  .command('env')
  .description('Print provider-neutral runtime env and secret requirements')
  .requiredOption('--provider <provider>', `Target provider (${DEPLOY_PROVIDERS.join('|')})`)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai deploy env --provider generic
  $ eai deploy env --provider vercel --format json
  $ eai deploy env --provider kubernetes
  `)
  .action(async (options) => {
    if (options.json) options.format = 'json';
    if (!isDeployProvider(options.provider)) {
      exitWithError(ErrorCode.E305, { details: `Unknown provider ${options.provider}. Use one of ${DEPLOY_PROVIDERS.join(', ')}` }, options.format);
    }

    const validation = await validateRuntimeContract();
    const plan = buildDeployEnvPlan(options.provider, validation.contractPath, validation);

    if (options.format === 'json') {
      out.json({
        provider: plan.provider,
        contract: plan.contract,
        requiredEnv: plan.requiredEnv,
        requiredProtectedEnvNames: plan.requiredSecrets,
        optionalProtectedEnvNames: plan.optionalSecrets,
        notes: plan.notes,
        validationStatus: validation.status,
        validationFindings: validation.findings,
      });
      if (validation.status === 'fail') process.exit(1);
      return;
    }

    out.heading(`EAI Deploy Env: ${options.provider}`);
    out.table([
      ['Contract', plan.contract],
      ['Validation', validation.status === 'pass' ? 'PASS' : 'FAIL'],
    ]);

    out.blank();
    out.heading('Required Environment Variables');
    for (const name of plan.requiredEnv) {
      out.info(name);
    }

    out.blank();
    out.heading('Required Secrets');
    for (const name of plan.requiredSecrets) {
      out.info(name);
    }

    if (plan.optionalSecrets.length > 0) {
      out.blank();
      out.heading('Optional Secrets');
      for (const name of plan.optionalSecrets) {
        out.info(name);
      }
    }

    out.blank();
    out.heading('Provider Notes');
    for (const note of plan.notes) {
      out.info(note);
    }

    if (validation.status === 'fail') {
      out.blank();
      for (const finding of validation.findings) {
        out.error(`${finding.code}: ${finding.message}`);
        if (finding.fix) out.info(`Fix: ${finding.fix}`);
      }
      process.exit(1);
    }
  });

// ─── eai deploy doctor ───────────────────────────────────────────────────

type DeployDoctorCategory =
  | 'host/infrastructure'
  | 'app_not_running'
  | 'authjs_config'
  | 'entra_client_redirect_config'
  | 'eai_publicapi_config'
  | 'tenant_workflow_config'
  | 'publicapi_authorization'
  | 'app_code_runtime_error';

interface DeployDoctorCheck {
  name: string;
  method: string;
  path: string;
  url: string;
  category: DeployDoctorCategory;
  status: 'pass' | 'fail' | 'warning' | 'skip';
  httpStatus?: number;
  message: string;
  fix?: string;
}

interface DeployDoctorResult {
  url: string;
  contract: string;
  status: 'pass' | 'fail';
  checks: DeployDoctorCheck[];
  summary: {
    pass: number;
    fail: number;
    warning: number;
    skip: number;
  };
}

function normalizeBaseUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

function combineUrl(baseUrl: string, pathValue: string): string {
  return `${baseUrl}${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`;
}

function coerceDoctorCategory(value: string | undefined, fallback: DeployDoctorCategory): DeployDoctorCategory {
  const allowed = new Set<DeployDoctorCategory>([
    'host/infrastructure',
    'app_not_running',
    'authjs_config',
    'entra_client_redirect_config',
    'eai_publicapi_config',
    'tenant_workflow_config',
    'publicapi_authorization',
    'app_code_runtime_error',
  ]);
  return value && allowed.has(value as DeployDoctorCategory) ? (value as DeployDoctorCategory) : fallback;
}

function classifyStatus(pathValue: string, httpStatus: number, fallback: DeployDoctorCategory): DeployDoctorCategory {
  if (httpStatus === 401 || httpStatus === 403) return 'publicapi_authorization';
  if (httpStatus === 404 && pathValue.includes('/api/auth')) return 'authjs_config';
  if (httpStatus >= 500 && pathValue.includes('/api/eai')) return 'app_code_runtime_error';
  if (httpStatus >= 500) return 'app_not_running';
  return fallback;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function hasTenantWorkflowProblem(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Runtime config did not return a JSON object.';
  }
  const tenants = (body as Record<string, unknown>).tenants;
  if (!tenants || typeof tenants !== 'object' || Array.isArray(tenants)) {
    return 'Runtime config did not include a tenants object.';
  }
  for (const [key, value] of Object.entries(tenants as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return `Tenant key ${key} did not return an object.`;
    }
    const tenant = value as Record<string, unknown>;
    if (typeof tenant.tenantId !== 'string' || tenant.tenantId.trim() === '') {
      return `Tenant key ${key} is missing tenantId.`;
    }
    if (typeof tenant.workflowId !== 'string' || tenant.workflowId.trim() === '') {
      return `Tenant key ${key} is missing workflowId.`;
    }
  }
  return null;
}

function hasAuthProvidersProblem(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Auth.js providers endpoint did not return a JSON object.';
  }
  if (Object.keys(body as Record<string, unknown>).length === 0) {
    return 'Auth.js providers endpoint returned no providers.';
  }
  return null;
}

async function runDoctorCheck(baseUrl: string, test: RuntimeSmokeTest, fallbackCategory: DeployDoctorCategory): Promise<DeployDoctorCheck> {
  const url = combineUrl(baseUrl, test.path);
  const expected = expectedStatuses(test);
  const category = coerceDoctorCategory(test.category, fallbackCategory);
  try {
    const response = await fetch(url, {
      method: test.method,
      signal: AbortSignal.timeout(10_000),
    });
    const body = await readJsonSafely(response);

    if (!expected.includes(response.status)) {
      const failureCategory = classifyStatus(test.path, response.status, category);
      const optionalStatus = test.optional ? 'warning' : 'fail';
      return {
        name: test.name,
        method: test.method,
        path: test.path,
        url,
        category: failureCategory,
        status: optionalStatus,
        httpStatus: response.status,
        message: `Expected HTTP ${expected.join(' or ')}, received ${response.status}.`,
        fix: 'Check the deployed app logs and the runtime contract for this endpoint.',
      };
    }

    if (test.path.includes('/api/eai/config')) {
      const problem = hasTenantWorkflowProblem(body);
      if (problem) {
        return {
          name: test.name,
          method: test.method,
          path: test.path,
          url,
          category: 'tenant_workflow_config',
          status: test.optional ? 'warning' : 'fail',
          httpStatus: response.status,
          message: problem,
          fix: 'Set TENANT_KEYS plus TENANT_{KEY}_ID and WORKFLOW_{KEY}_ID for the deployed app.',
        };
      }
    }

    if (test.path.includes('/api/auth/providers')) {
      const problem = hasAuthProvidersProblem(body);
      if (problem) {
        return {
          name: test.name,
          method: test.method,
          path: test.path,
          url,
          category: 'authjs_config',
          status: test.optional ? 'warning' : 'fail',
          httpStatus: response.status,
          message: problem,
          fix: 'Check AUTH_SECRET, AUTH_URL, Entra client settings, and callback URL registration.',
        };
      }
    }

    return {
      name: test.name,
      method: test.method,
      path: test.path,
      url,
      category,
      status: 'pass',
      httpStatus: response.status,
      message: `HTTP ${response.status}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: test.name,
      method: test.method,
      path: test.path,
      url,
      category: test.path === '/health' ? 'app_not_running' : 'host/infrastructure',
      status: test.optional ? 'warning' : 'fail',
      message,
      fix: 'Confirm the deployed URL is reachable from this machine and the app process is running.',
    };
  }
}

function dedupeSmokeTests(tests: RuntimeSmokeTest[]): RuntimeSmokeTest[] {
  const seen = new Set<string>();
  const unique: RuntimeSmokeTest[] = [];
  for (const test of tests) {
    const key = `${test.method}:${test.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(test);
    }
  }
  return unique;
}

export async function runDeployDoctor(url: string): Promise<DeployDoctorResult> {
  const baseUrl = normalizeBaseUrl(url);
  const validation = await validateRuntimeContract();
  const loaded = await loadRuntimeContract(validation.projectRoot);
  const checks: DeployDoctorCheck[] = [];

  if (validation.status === 'fail') {
    for (const finding of validation.findings) {
      checks.push({
        name: finding.code,
        method: 'LOCAL',
        path: RUNTIME_CONTRACT_FILE,
        url: validation.contractPath,
        category: 'eai_publicapi_config',
        status: 'fail',
        message: finding.message,
        fix: finding.fix,
      });
    }
  }

  const contract = loaded.contract;
  const tests = dedupeSmokeTests([
    {
      name: 'health',
      method: 'GET',
      path: contract.endpoints.health || '/health',
      expectedStatus: 200,
      category: 'app_not_running',
    },
    {
      name: 'auth-providers',
      method: 'GET',
      path: contract.endpoints.authProviders || '/api/auth/providers',
      expectedStatus: 200,
      category: 'authjs_config',
    },
    {
      name: 'runtime-config',
      method: 'GET',
      path: contract.endpoints.runtimeConfig || '/api/eai/config',
      expectedStatus: 200,
      category: 'tenant_workflow_config',
    },
    ...contract.endpoints.public.map((endpoint, index) => ({
      name: `public-${index + 1}`,
      method: endpoint.method || 'GET',
      path: endpoint.path || '/',
      expectedStatus: 200,
      category: endpoint.serverSidePlatformAccess
        ? 'publicapi_authorization'
        : 'app_code_runtime_error',
    })),
    ...contract.endpoints.smokeTests,
  ]);

  for (const test of tests) {
    checks.push(await runDoctorCheck(baseUrl, test, 'app_code_runtime_error'));
  }

  const hasBffSmoke = tests.some(
    (test) =>
      contract.endpoints.bffBasePath &&
      test.path.startsWith(contract.endpoints.bffBasePath) &&
      test.path !== contract.endpoints.runtimeConfig,
  );
  if (!hasBffSmoke) {
    checks.push({
      name: 'publicapi-bff-smoke-declared',
      method: 'CONTRACT',
      path: contract.endpoints.bffBasePath || '/api/eai',
      url: contract.endpoints.bffBasePath || '/api/eai',
      category: 'eai_publicapi_config',
      status: 'warning',
      message: 'No deployed BFF/PublicAPI smoke endpoint is declared; doctor cannot prove PublicAPI reachability through the app.',
      fix: 'Add a safe read-only smoke endpoint to endpoints.smokeTests when the app exposes one.',
    });
  }

  const summary = {
    pass: checks.filter((check) => check.status === 'pass').length,
    fail: checks.filter((check) => check.status === 'fail').length,
    warning: checks.filter((check) => check.status === 'warning').length,
    skip: checks.filter((check) => check.status === 'skip').length,
  };

  return {
    url: baseUrl,
    contract: loaded.contractPath,
    status: summary.fail > 0 ? 'fail' : 'pass',
    checks,
    summary,
  };
}

deployCommand
  .command('doctor')
  .description('Black-box check a deployed EAI app runtime')
  .requiredOption('--url <url>', 'Deployed app base URL')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai deploy doctor --url https://my-app.example.com
  $ eai deploy doctor --url https://my-app.example.com --format json
  `)
  .action(async (options) => {
    if (options.json) options.format = 'json';

    let result: DeployDoctorResult;
    try {
      result = await runDeployDoctor(options.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.format === 'json') {
        out.json({ status: 'fail', error: message });
      } else {
        out.error(message);
      }
      process.exit(1);
      return;
    }

    if (options.format === 'json') {
      out.json(result);
      if (result.status === 'fail') process.exit(1);
      return;
    }

    out.heading('EAI Deploy Doctor');
    out.table([
      ['URL', result.url],
      ['Contract', result.contract],
      ['Status', result.status === 'pass' ? 'PASS' : 'FAIL'],
      ['Passed', String(result.summary.pass)],
      ['Failed', String(result.summary.fail)],
      ['Warnings', String(result.summary.warning)],
    ]);

    out.blank();
    for (const check of result.checks) {
      const icon =
        check.status === 'pass'
          ? out.symbols.success
          : check.status === 'warning'
            ? out.symbols.warning
            : out.symbols.error;
      console.log(`${icon} ${check.name} [${check.category}] ${check.method} ${check.path}: ${check.message}`);
      if (check.fix && check.status !== 'pass') out.info(`Fix: ${check.fix}`);
    }

    out.blank();
    if (result.status === 'pass') {
      out.success('Deployment runtime checks passed.');
    } else {
      out.error('Deployment runtime checks failed.');
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
