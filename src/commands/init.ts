/**
 * eai init — scaffold a new vertical application from the template.
 */

import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import ora from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as out from '../lib/output.js';

const exec = promisify(execFile);

const TEMPLATE_REPO = 'https://github.com/enterpriseaigroup/Vertical-Template.git';
const GITHUB_ORG = 'enterpriseaigroup';

interface InitOptions {
  name: string;
  displayName: string;
  description: string;
  tenantStructure: 'single' | 'dual' | 'multi';
  includeChat: boolean;
  includeDocs: boolean;
  authProvider: 'ciam' | 'b2b' | 'dual';
}

export const initCommand = new Command('init')
  .description('Scaffold a new vertical application')
  .argument('[name]', 'Name for the vertical (kebab-case)')
  .option('--from <repo>', 'GitHub repo URL or local path for template', TEMPLATE_REPO)
  .option('--skip-prompts', 'Use defaults without interactive prompts', false)
  .action(async (nameArg, options) => {
    let initOptions: InitOptions;

    if (options.skipPrompts && nameArg) {
      initOptions = {
        name: nameArg,
        displayName: toDisplayName(nameArg),
        description: `${toDisplayName(nameArg)} vertical application`,
        tenantStructure: 'single',
        includeChat: true,
        includeDocs: true,
        authProvider: 'ciam',
      };
    } else {
      // Interactive prompts
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Vertical name (kebab-case):',
          default: nameArg,
          validate: (input: string) => {
            if (!/^[a-z][a-z0-9-]*$/.test(input)) {
              return 'Must be lowercase, start with a letter, and contain only letters, numbers, and hyphens';
            }
            return true;
          },
        },
        {
          type: 'input',
          name: 'displayName',
          message: 'Display name:',
          default: (answers: { name: string }) => toDisplayName(answers.name),
        },
        {
          type: 'input',
          name: 'description',
          message: 'Description:',
          default: (answers: { displayName: string }) => `${answers.displayName} vertical application`,
        },
        {
          type: 'list',
          name: 'tenantStructure',
          message: 'Tenant structure:',
          choices: [
            { name: 'Single tenant (most common)', value: 'single' },
            { name: 'Dual tenant (e.g., customer + staff portals)', value: 'dual' },
            { name: 'Multi-tenant hierarchy', value: 'multi' },
          ],
        },
        {
          type: 'confirm',
          name: 'includeChat',
          message: 'Include AI chat?',
          default: true,
        },
        {
          type: 'confirm',
          name: 'includeDocs',
          message: 'Include document management?',
          default: true,
        },
        {
          type: 'list',
          name: 'authProvider',
          message: 'Auth provider:',
          choices: [
            { name: 'Entra ID CIAM (recommended)', value: 'ciam' },
            { name: 'Entra ID B2B (corporate SSO)', value: 'b2b' },
            { name: 'Dual (CIAM + B2B)', value: 'dual' },
          ],
        },
      ]);

      initOptions = answers as InitOptions;
    }

    const targetDir = resolve(process.cwd(), initOptions.name);

    // Check if directory already exists
    try {
      await access(targetDir);
      out.error(`Directory "${initOptions.name}" already exists.`);
      process.exit(1);
    } catch { /* good — doesn't exist */ }

    out.heading(`Creating ${chalk.cyan(initOptions.displayName)}`);
    out.blank();

    // Step 1: Clone template
    const cloneSpinner = ora('Cloning Vertical-Template...').start();
    try {
      await exec('git', ['clone', '--depth', '1', options.from, targetDir]);
      // Remove .git to start fresh
      await exec('rm', ['-rf', join(targetDir, '.git')]);
      cloneSpinner.succeed('Cloned template');
    } catch (err) {
      cloneSpinner.fail('Failed to clone template');
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    // Step 2: Update package.json
    const pkgSpinner = ora('Customizing package.json...').start();
    try {
      const pkgPath = join(targetDir, 'package.json');
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      pkg.name = `@enterpriseaigroup/${initOptions.name}`;
      pkg.description = initOptions.description;
      pkg.version = '0.1.0';
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      pkgSpinner.succeed('Updated package.json');
    } catch (err) {
      pkgSpinner.fail('Failed to update package.json');
    }

    // Step 3: Generate .env.local with placeholders
    const envSpinner = ora('Generating .env.local...').start();
    try {
      const envContent = generateEnvFile(initOptions);
      await writeFile(join(targetDir, '.env.local'), envContent, 'utf-8');
      envSpinner.succeed('Generated .env.local');
    } catch (err) {
      envSpinner.fail('Failed to generate .env.local');
    }

    // Step 4: Generate Object Types scaffold
    const typesSpinner = ora('Creating Object Types scaffold...').start();
    try {
      const typesContent = generateObjectTypesScaffold(initOptions);
      await writeFile(join(targetDir, 'src', 'eai.config', 'object-types.ts'), typesContent, 'utf-8');
      typesSpinner.succeed('Created Object Types scaffold');
    } catch (err) {
      typesSpinner.fail('Failed to create Object Types scaffold');
    }

    // Step 5: Generate deploy workflow
    const deploySpinner = ora('Creating deployment workflow...').start();
    try {
      const workflowDir = join(targetDir, '.github', 'workflows');
      await mkdir(workflowDir, { recursive: true });
      const workflowContent = generateDeployWorkflow(initOptions);
      await writeFile(join(workflowDir, 'deploy-demo.yml'), workflowContent, 'utf-8');
      deploySpinner.succeed('Created deploy-demo.yml');
    } catch (err) {
      deploySpinner.fail('Failed to create deployment workflow');
    }

    // Step 6: Initialize git
    const gitSpinner = ora('Initializing git...').start();
    try {
      await exec('git', ['init'], { cwd: targetDir });
      await exec('git', ['add', '.'], { cwd: targetDir });
      await exec('git', ['commit', '-m', `Initial scaffold from Vertical-Template\n\nApp: ${initOptions.displayName}\nCreated by: eai init`], { cwd: targetDir });
      gitSpinner.succeed('Initialized git repository');
    } catch (err) {
      gitSpinner.fail('Failed to initialize git');
    }

    out.blank();
    out.success(`Created ${chalk.bold(initOptions.displayName)} at ${chalk.cyan(targetDir)}`);
    out.blank();
    out.heading('Next steps:');
    console.log(`  1. ${chalk.cyan(`cd ${initOptions.name}`)}`);
    console.log(`  2. ${chalk.cyan('npm install')}`);
    console.log(`  3. ${chalk.cyan('eai login')} — authenticate with Entra CIAM`);
    console.log(`  4. ${chalk.cyan('eai env pull')} — sync environment from cloud`);
    console.log(`  5. Edit ${chalk.cyan('src/eai.config/object-types.ts')} — define your data model`);
    console.log(`  6. ${chalk.cyan('eai types validate')} — check your types`);
    console.log(`  7. ${chalk.cyan('eai types seed')} — push types to Configurator`);
    console.log(`  8. ${chalk.cyan('eai dev')} — start local development`);
    out.blank();
  });

function toDisplayName(name: string): string {
  return name
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function generateEnvFile(opts: InitOptions): string {
  return `# =============================================================================
# EAI Vertical: ${opts.displayName}
# Generated by: eai init
# =============================================================================

# App Identity
NEXT_PUBLIC_APP_NAME=${opts.name}
APP_BASE_PATH=/${opts.name}

# Platform API
BASE_URL_PUBLIC_API=https://test-api.myenterprise.ai

# Tenant & Workflow (replace with actual IDs after provisioning)
TENANT_KEYS=${opts.name}
TENANT_${opts.name.replace(/-/g, '_').toUpperCase()}_ID=<your-tenant-id>
WORKFLOW_${opts.name.replace(/-/g, '_').toUpperCase()}_ID=<your-workflow-id>

# Microsoft Entra ID (CIAM)
ENTRA_TENANT_NAME=eaidevmyentepriseai
ENTRA_TENANT_ID=50808ce0-f31b-4fd0-9861-74b83b8c112a
ENTRA_CLIENT_ID=<your-app-client-id>
ENTRA_CLIENT_SECRET=<your-app-client-secret>
ENTRA_SCOPES="email offline_access openid profile"

# Auth.js — generate with: openssl rand -base64 32
AUTH_SECRET=<generate-with-openssl>
`;
}

function generateObjectTypesScaffold(opts: InitOptions): string {
  const tenantKey = opts.name;
  return `/**
 * Object Type definitions for ${opts.displayName}.
 *
 * Define your data model here. Each object type maps to a resource
 * in ResourceAPI (PostgreSQL JSONB) with typed validation.
 *
 * Run \`eai types validate\` to check your definitions.
 * Run \`eai types seed\` to push to Configurator.
 *
 * Field types: text | number | boolean | date | select | json | file | relationship
 * Cardinality: one-to-one | one-to-many | many-to-one | many-to-many
 * Roles: tenant-user | tenant-staff | tenant-admin
 * Side effects: set_field | set_timestamp | set_user
 */

export const objectTypes = {
  '${tenantKey}': [
    {
      name: 'Example',
      displayName: 'Example',
      description: 'An example object type — replace with your domain model',
      properties: [
        {
          name: 'title',
          type: 'text' as const,
          required: true,
          indexed: true,
          description: 'The title of this record',
        },
        {
          name: 'description',
          type: 'text' as const,
          required: false,
          description: 'A detailed description',
        },
        {
          name: 'status',
          type: 'select' as const,
          required: true,
          defaultValue: 'draft',
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Active', value: 'active' },
            { label: 'Archived', value: 'archived' },
          ],
          description: 'Current lifecycle status',
        },
        {
          name: 'createdAt',
          type: 'date' as const,
          required: false,
          description: 'When this record was created',
        },
      ],
      linkTypes: [],
      actions: [
        {
          name: 'activate',
          displayName: 'Activate',
          requiredRole: 'tenant-staff' as const,
          validationRules: {
            requiredFields: ['title'],
            requiredStatus: 'draft',
          },
          sideEffects: [
            { type: 'set_field' as const, field: 'status', value: 'active' },
            { type: 'set_timestamp' as const, field: 'createdAt' },
          ],
        },
      ],
      storageBackend: 'postgresql' as const,
      status: 'published' as const,
    },
  ],
};
`;
}

function generateDeployWorkflow(opts: InitOptions): string {
  return `# Deploy ${opts.displayName} to Azure App Service
# Triggers on push to main branch
#
# Required GitHub Secrets (in "demo" environment):
#   AZUREAPPSERVICE_CLIENTID
#   AZUREAPPSERVICE_TENANTID
#   AZUREAPPSERVICE_SUBSCRIPTIONID
#   AZURE_RESOURCE_GROUP
#   AZURE_WEBAPP_NAME

name: Deploy ${opts.displayName}

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  APP_NAME: ${opts.name}
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
        uses: azure/webapps-deploy@v3
        with:
          app-name: \${{ secrets.AZURE_WEBAPP_NAME }}
          package: app-content.zip

      - name: Restart App Service
        run: |
          az webapp restart \\
            --resource-group \${{ secrets.AZURE_RESOURCE_GROUP }} \\
            --name \${{ secrets.AZURE_WEBAPP_NAME }}
`;
}
