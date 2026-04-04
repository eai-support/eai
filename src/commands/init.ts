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

const TEMPLATE_REPO = 'https://github.com/eai-tools/Vertical-Template.git';
const GITHUB_ORG = 'eai-tools';

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
      cloneSpinner.succeed(`Cloned from ${chalk.dim(GITHUB_ORG + '/Vertical-Template')}`);
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
      pkg.name = `@${GITHUB_ORG}/${initOptions.name}`;
      pkg.description = initOptions.description;
      pkg.version = '0.1.0';
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      pkgSpinner.succeed('Updated package.json');
    } catch (_err) {
      pkgSpinner.fail('Failed to update package.json');
    }

    // Step 3: Generate .env.local with placeholders
    const envSpinner = ora('Generating .env.local...').start();
    try {
      const envContent = generateEnvFile(initOptions);
      await writeFile(join(targetDir, '.env.local'), envContent, 'utf-8');
      envSpinner.succeed('Generated .env.local');
    } catch (_err) {
      envSpinner.fail('Failed to generate .env.local');
    }

    // Step 4: Generate Object Types scaffold
    const typesSpinner = ora('Creating Object Types scaffold...').start();
    try {
      const typesContent = generateObjectTypesScaffold(initOptions);
      await writeFile(join(targetDir, 'src', 'eai.config', 'object-types.ts'), typesContent, 'utf-8');
      typesSpinner.succeed('Created Object Types scaffold');
    } catch (_err) {
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
    } catch (_err) {
      deploySpinner.fail('Failed to create deployment workflow');
    }

    // Step 6: Generate project CLAUDE.md
    const claudeSpinner = ora('Generating CLAUDE.md...').start();
    try {
      const claudeContent = generateClaudeMd(initOptions);
      await writeFile(join(targetDir, 'CLAUDE.md'), claudeContent, 'utf-8');
      claudeSpinner.succeed('Generated CLAUDE.md');
    } catch (_err) {
      claudeSpinner.fail('Failed to generate CLAUDE.md');
    }

    // Step 7: Initialize git
    const gitSpinner = ora('Initializing git...').start();
    try {
      await exec('git', ['init'], { cwd: targetDir });
      await exec('git', ['add', '.'], { cwd: targetDir });
      await exec('git', ['commit', '-m', `Initial scaffold from Vertical-Template\n\nApp: ${initOptions.displayName}\nCreated by: eai init\nTemplate: ${GITHUB_ORG}/Vertical-Template`], { cwd: targetDir });
      gitSpinner.succeed('Initialized git repository');
    } catch (_err) {
      gitSpinner.fail('Failed to initialize git');
    }

    out.blank();
    out.success(`Created ${chalk.bold(initOptions.displayName)} at ${chalk.cyan(targetDir)}`);
    out.blank();
    out.heading('Next steps:');
    out.blank();
    out.dim(`Template: https://github.com/${GITHUB_ORG}/Vertical-Template`);
    out.dim(`CLI docs: https://github.com/${GITHUB_ORG}/eai-cli`);
    out.blank();
  });

function toDisplayName(name: string): string {
  return name
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ─── Generators ────────────────────────────────────────────────────────────

function generateEnvFile(opts: InitOptions): string {
  const envKey = opts.name.replace(/-/g, '_').toUpperCase();

  let workflowSection: string;
  if (opts.tenantStructure === 'dual') {
    workflowSection = `# Workflow IDs
# Dual-tenant apps can keep separate workflows per local object-type scope
WORKFLOW_${envKey}_CUSTOMER_ID=<platform-workflow-id>
WORKFLOW_${envKey}_STAFF_ID=<platform-workflow-id>`;
  } else {
    workflowSection = `# Workflow IDs
# Replace IDs with actual values from platform after provisioning
WORKFLOW_${envKey}_ID=<platform-workflow-id>`;
  }

  return `# =============================================================================
# EAI Vertical: ${opts.displayName}
# Generated by: eai init
# Run 'eai env pull' to sync values from Azure App Config + Key Vault
# =============================================================================

# App Identity
NEXT_PUBLIC_APP_NAME=${opts.name}
APP_BASE_PATH=/${opts.name}

# =============================================================================
# Platform API
# =============================================================================
BASE_URL_PUBLIC_API=https://test-api.myenterprise.ai

# =============================================================================
# Active tenant selection for CLI commands comes from:
#   eai login
#   eai tenant select
# ${workflowSection}
# =============================================================================

# =============================================================================
# Microsoft Entra ID (CIAM)
# =============================================================================
ENTRA_TENANT_NAME=eaidevmyentepriseai
ENTRA_TENANT_ID=50808ce0-f31b-4fd0-9861-74b83b8c112a
ENTRA_SCOPES="email offline_access openid profile"

# =============================================================================
# Auth.js — generate with: openssl rand -base64 32
# =============================================================================
AUTH_SECRET=<generate-with-openssl>

# =============================================================================
# IMPORTANT: Do NOT commit this file. Use 'eai env pull' to sync from cloud.
# Secrets belong in Azure Key Vault, config in Azure App Config.
# =============================================================================
`;
}

function generateObjectTypesScaffold(opts: InitOptions): string {
  const tenantKey = opts.name;
  return `/**
 * Object Type definitions for ${opts.displayName}
 *
 * Each object type maps to a platform resource with typed validation, actions, and relationship links.
 *
 * Commands:
 *   eai types validate    Check definitions against platform schema
 *   eai types seed        Push to platform via PublicAPI
 *   eai types diff        Compare local vs remote state
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ Field Types                                                  │
 * ├────────────┬─────────────────────────────────────────────────┤
 * │ text       │ String value (names, emails, IDs)               │
 * │ number     │ Integer or float (counts, amounts, scores)      │
 * │ boolean    │ True/false flag (isVerified, isActive)           │
 * │ date       │ ISO 8601 datetime (submittedAt, createdAt)      │
 * │ select     │ Enum — requires \`options\` array                 │
 * │ json       │ Arbitrary JSON object (metadata, config)        │
 * │ file       │ File reference URL (attachments, uploads)       │
 * │ relationship│ Reference to another resource by ID            │
 * ├────────────┼─────────────────────────────────────────────────┤
 * │ Link Types (cardinality)                                     │
 * ├────────────┼─────────────────────────────────────────────────┤
 * │ one-to-one │ Single reference (e.g., profile → user)         │
 * │ one-to-many│ Parent → children (e.g., order → items)         │
 * │ many-to-one│ Child → parent (e.g., item → order)             │
 * │ many-to-many│ Bidirectional (e.g., tags ↔ articles)          │
 * ├────────────┼─────────────────────────────────────────────────┤
 * │ Action Side Effects                                          │
 * ├────────────┼─────────────────────────────────────────────────┤
 * │ set_field  │ Set a property to a specific value               │
 * │ set_timestamp │ Set a date field to current time              │
 * │ set_user   │ Set a field to the current user's ID             │
 * ├────────────┼─────────────────────────────────────────────────┤
 * │ Roles                                                        │
 * ├────────────┼─────────────────────────────────────────────────┤
 * │ tenant-viewer│ Basic access (read and lightweight submit)     │
 * │ tenant-builder│ Extended access (view all, edit, actions)     │
 * │ tenant-admin│ Full access (delete, configure)                │
 * └────────────┴─────────────────────────────────────────────────┘
 */

export const objectTypes = {
  '${tenantKey}': [
    {
      name: 'Record',
      displayName: 'Record',
      description: 'A sample record — replace with your domain model',
      properties: [
        {
          name: 'title',
          type: 'text' as const,
          required: true,
          indexed: true,
          description: 'Title of this record',
        },
        {
          name: 'description',
          type: 'text' as const,
          required: false,
          description: 'Detailed description',
        },
        {
          name: 'priority',
          type: 'number' as const,
          required: false,
          defaultValue: 0,
          description: 'Priority level (0 = normal)',
        },
        {
          name: 'isActive',
          type: 'boolean' as const,
          required: true,
          defaultValue: true,
          description: 'Whether this record is active',
        },
        {
          name: 'dueDate',
          type: 'date' as const,
          required: false,
          description: 'Target completion date',
        },
        {
          name: 'status',
          type: 'select' as const,
          required: true,
          defaultValue: 'draft',
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'In Progress', value: 'in-progress' },
            { label: 'Complete', value: 'complete' },
            { label: 'Archived', value: 'archived' },
          ],
          description: 'Current lifecycle status',
        },
        {
          name: 'metadata',
          type: 'json' as const,
          required: false,
          description: 'Arbitrary metadata (tags, notes, etc.)',
        },
        {
          name: 'assignedTo',
          type: 'relationship' as const,
          required: false,
          indexed: true,
          description: 'User ID of the assignee',
        },
      ],
      linkTypes: [
        {
          name: 'documents',
          targetObjectType: 'Document',
          cardinality: 'one-to-many' as const,
          cascadeDelete: true,
        },
      ],
      actions: [
        {
          name: 'submit',
          displayName: 'Submit',
          requiredRole: 'tenant-viewer' as const,
          validationRules: {
            requiredFields: ['title'],
            requiredStatus: 'draft',
          },
          sideEffects: [
            { type: 'set_field' as const, field: 'status', value: 'in-progress' },
            { type: 'set_timestamp' as const, field: 'dueDate' },
            { type: 'set_user' as const, field: 'assignedTo' },
          ],
        },
        {
          name: 'complete',
          displayName: 'Mark Complete',
          requiredRole: 'tenant-builder' as const,
          validationRules: {
            requiredStatus: 'in-progress',
          },
          sideEffects: [
            { type: 'set_field' as const, field: 'status', value: 'complete' },
            { type: 'set_field' as const, field: 'isActive', value: false },
          ],
        },
      ],
      status: 'published' as const,
    },
    {
      name: 'Document',
      displayName: 'Document',
      description: 'Uploaded file with classification metadata',
      properties: [
        {
          name: 'fileName',
          type: 'text' as const,
          required: true,
          description: 'Original file name',
        },
        {
          name: 'fileUrl',
          type: 'file' as const,
          required: true,
          description: 'URL to the uploaded file',
        },
        {
          name: 'category',
          type: 'select' as const,
          required: false,
          options: [
            { label: 'General', value: 'general' },
            { label: 'Report', value: 'report' },
            { label: 'Evidence', value: 'evidence' },
          ],
          description: 'Document category (can be auto-classified)',
        },
        {
          name: 'uploadedAt',
          type: 'date' as const,
          required: false,
          description: 'When the document was uploaded',
        },
      ],
      linkTypes: [],
      actions: [],
      status: 'published' as const,
    },
  ],

  // ── Dual-tenant example (uncomment if using dual tenant structure) ──
  // '${tenantKey}-customer': [ ... ],
  // '${tenantKey}-staff': [ ... ],
};
`;
}

function generateDeployWorkflow(opts: InitOptions): string {
  return `# Deploy ${opts.displayName} to Azure App Service
# Triggers on push to main branch
#
# Required GitHub Secrets (in "demo" environment):
#   AZUREAPPSERVICE_CLIENTID     — Azure AD app registration client ID
#   AZUREAPPSERVICE_TENANTID     — Azure AD tenant ID
#   AZUREAPPSERVICE_SUBSCRIPTIONID — Azure subscription ID
#   AZURE_RESOURCE_GROUP         — e.g., rg-demo-infrastructure
#   AZURE_WEBAPP_NAME            — e.g., app-demo-eai-dev

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

function generateClaudeMd(opts: InitOptions): string {
  return `# ${opts.displayName}

A vertical application built on the Enterprise AI platform.

## Tech Stack

- **Framework**: Next.js 15+ with App Router
- **Language**: TypeScript (strict mode)
- **UI**: React 18+, Tailwind CSS, Shadcn/ui
- **Auth**: Auth.js with Microsoft Entra ID (CIAM)
- **Data**: Platform SDK → data service (typed resource storage)
- **AI**: Platform SDK → AI service (RAG chat, document classification)

## Platform Architecture

\`\`\`
Browser → Next.js App → BFF Proxy (/api/eai/*) → EAI Platform API
\`\`\`

Tokens are injected server-side by the BFF proxy. Never exposed to the browser.

## Object Types

Defined in \`src/eai.config/object-types.ts\`. Each type maps to a platform resource with typed validation, actions, and relationship links.

**Field types**: text, number, boolean, date, select, json, file, relationship
**Link cardinality**: one-to-one, one-to-many, many-to-one, many-to-many
**Action roles**: tenant-viewer, tenant-builder, tenant-admin
**Side effects**: set_field, set_timestamp, set_user

## Data Access

\`\`\`typescript
// React hook (client components)
import { useResources } from '@/hooks/useResources';
const { list, get, create, update, delete: remove } = useResources<MyData>('MyType');

// Platform SDK (server-side)
import { EAIPlatformClient } from '@eai-tools/platform-sdk';
const client = new EAIPlatformClient({ tenantId: 'my-tenant' });
await client.resources.create('MyType', { title: 'Hello' });
\`\`\`

## EAI CLI Commands

| Command | Purpose |
|---------|---------|
| \`eai dev\` | Start local dev server |
| \`eai tenant select\` | Choose the active tenant for platform commands |
| \`eai types validate\` | Validate Object Types |
| \`eai types seed\` | Push types to platform |
| \`eai types diff\` | Compare local vs remote |
| \`eai resources list <type>\` | List resources |
| \`eai chat stream <msg>\` | Test AI chat |
| \`eai env pull\` | Sync cloud config |
| \`eai deploy trigger\` | Trigger deployment |
| \`eai verify\` | Platform connectivity check |
| \`eai doctor\` | Diagnose issues |

## Vertical Delivery Checklist

| Step | Action | Verification |
|------|--------|-------------|
| 1 | Define object types in \`src/eai.config/object-types.ts\` | \`eai types validate\` passes |
| 2 | Set up tenant config in \`src/eai.config/\` | Config registered in index.ts |
| 3 | Create data access hooks in \`src/hooks/\` | Hooks use Platform SDK |
| 4 | Build UI pages in \`src/app/(presentation)/\` | Pages render with data |
| 5 | Configure AI chat/docs (if needed) | Chat streams, docs upload |
| 6 | Seed object types | \`eai types seed\` succeeds |
| 7 | Configure deployment | \`deploy-demo.yml\` has correct APP_NAME |
| 8 | Deploy | \`eai deploy trigger\` → app loads at \`/${opts.name}\` |
| 9 | Verify | \`eai verify\` all checks pass |

## Environment Variables

See \`.env.local\` for required variables. Use \`eai env pull\` to sync from Azure App Config.

Key variables:
- \`BASE_URL_PUBLIC_API\` — Platform API gateway URL
- \`WORKFLOW_*_ID\` — Platform workflow IDs
- \`ENTRA_*\` — Microsoft Entra ID (CIAM) auth config
- \`AUTH_SECRET\` — Auth.js session encryption key

## Key Files

| File | Purpose |
|------|---------|
| \`src/eai.config/object-types.ts\` | Data model definitions |
| \`src/eai.config/default.ts\` | Tenant configuration |
| \`src/auth.ts\` | Auth.js configuration |
| \`src/app/api/eai/[[...rest]]/route.ts\` | BFF proxy (token injection) |
| \`packages/platform-sdk/\` | Typed API client |
| \`.github/workflows/deploy-demo.yml\` | Deployment workflow |
`;
}
