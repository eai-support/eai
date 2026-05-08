/**
 * eai init — scaffold a new vertical application from the template.
 */

import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, access, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import ora from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as out from '../lib/output.js';
import { installGoferResources } from '../lib/gofer-installer.js';
import { isAuthenticated, loadTokens } from '../lib/auth.js';
import { resolveActiveTenantContext, resolvePublicApiUrl, type TenantMembership } from '../lib/tenant-context.js';
import { PlatformAPIClient } from '../lib/api.js';
import { patchEnvFile } from '../lib/config.js';
import { pullCloudEnvValues } from '../lib/cloud-env.js';
import { getActiveProfile, loadProfileConfig } from '../lib/profile.js';

const exec = promisify(execFile);

const TEMPLATE_REPO = 'https://github.com/eai-tools/eai-vertical-template.git';
const GITHUB_ORG = 'eai-tools';
const TEMPLATE_REPO_LABEL = `${GITHUB_ORG}/eai-vertical-template`;

interface InitOptions {
  name: string;
  displayName: string;
  description: string;
  tenantId: string;
  includeChat: boolean;
  includeDocs: boolean;
  authProvider: 'ciam' | 'b2b' | 'dual';
}

export function describeCloneFailure(templateSource: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    /spawn git enoent/i.test(message)
    || normalized.includes('git is not recognized')
    || normalized.includes('no such file or directory')
    && normalized.includes('git')
  ) {
    return [
      '`git` is required to scaffold from a repository source, but it is not installed or not on your PATH.',
      'Install Git, reopen your terminal, and run the command again.',
      '',
      'Windows: winget install --id Git.Git -e',
      'Download: https://git-scm.com/download/win',
      '',
      `Default public template: ${TEMPLATE_REPO}`,
      `Custom source: eai init <name> --from <repo-or-path>`,
    ].join('\n');
  }

  if (
    templateSource === TEMPLATE_REPO
    && /repository .* not found|repository not found|fatal: .* not found/i.test(message)
  ) {
    return `${message}\n\nThe default template source (${TEMPLATE_REPO}) could not be reached.\n` +
      `Use ${'`'}eai init <name> --from <repo-or-path>${'`'} with another accessible template source if GitHub is blocked from this machine.`;
  }

  return message;
}

export const initCommand = new Command('init')
  .description('Scaffold a new vertical application')
  .argument('[name]', 'Name for the vertical (kebab-case)')
  .option('--from <repo>', 'GitHub repo URL or local path for template', TEMPLATE_REPO)
  .option('--skip-prompts', 'Use defaults without interactive prompts', false)
  .option('--tenant <id>', 'Bind this vertical to the given platform tenant ID (non-interactive)')
  .option('--create-child-tenant', '[not implemented] Create a real child tenant boundary under the default tenant')
  .option('--no-gofer', 'Skip installing Gofer AI CLI assets')
  .addHelpText('after', `
Gofer AI CLI assets are installed by default:
  .specify/ commands, scripts, templates, hooks, and memory folders
  .claude/ commands and agents for Claude CLI
  .system/skills/gofer and .agents/skills/gofer for Codex CLI
  .gemini/commands/gofer and .gemini/extension.json for Gemini CLI
  .github/prompts, .github/instructions, and .github/skills for GitHub Copilot

Use --no-gofer only when you need a bare vertical scaffold.
`)
  .action(async (nameArg, options) => {
    if (options.createChildTenant) {
      out.error('`--create-child-tenant` is not implemented yet. Re-run without this flag, or use `--tenant <id>` to bind an existing tenant.');
      process.exit(1);
    }

    const publicApiUrl = await resolvePublicApiUrl();
    const activeTenant = await loadActiveTenantForInit(publicApiUrl);

    let tenantId: string;
    let initOptions: InitOptions;

    if (options.skipPrompts && nameArg) {
      if (options.tenant) {
        await assertTenantExists(publicApiUrl, options.tenant);
        tenantId = options.tenant;
      } else if (activeTenant) {
        tenantId = activeTenant.id;
      } else {
        tenantId = '';
        out.warn('No active tenant and `--tenant <id>` not supplied — TENANT_<KEY>_ID will be left blank. Bind later by editing .env.local.');
      }
      initOptions = {
        name: nameArg,
        displayName: toDisplayName(nameArg),
        description: `${toDisplayName(nameArg)} vertical application`,
        tenantId,
        includeChat: true,
        includeDocs: true,
        authProvider: 'ciam',
      };
    } else {
      const baseAnswers = await inquirer.prompt([
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
      ]);

      tenantId = await promptTenantBinding(publicApiUrl, activeTenant, options.tenant);

      const featureAnswers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'includeChat',
          message: 'Include AI chat? [not implemented — flag only]',
          default: true,
        },
        {
          type: 'confirm',
          name: 'includeDocs',
          message: 'Include document management? [not implemented — flag only]',
          default: true,
        },
        {
          type: 'list',
          name: 'authProvider',
          message: 'Auth provider:',
          choices: [
            { name: 'Entra ID CIAM (default, implemented)', value: 'ciam' },
            { name: 'Entra ID B2B (corporate SSO) [not implemented]', value: 'b2b' },
            { name: 'Dual (CIAM + B2B) [not implemented]', value: 'dual' },
          ],
        },
      ]);

      initOptions = {
        ...(baseAnswers as { name: string; displayName: string; description: string }),
        tenantId,
        ...(featureAnswers as { includeChat: boolean; includeDocs: boolean; authProvider: 'ciam' | 'b2b' | 'dual' }),
      };
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
    const cloneSpinner = ora('Cloning template...').start();
    try {
      await exec('git', ['clone', '--depth', '1', options.from, targetDir]);
      // Remove .git to start fresh
      await rm(join(targetDir, '.git'), { recursive: true, force: true });
      cloneSpinner.succeed(`Cloned from ${chalk.dim(describeTemplateSource(options.from))}`);
    } catch (err) {
      cloneSpinner.fail('Failed to clone template');
      out.error(describeCloneFailure(options.from, err));
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
      await hydrateEnvFromLoginContext(targetDir, initOptions.name, initOptions.tenantId);
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

    // Step 7: Install Gofer AI CLI assets
    if (options.gofer) {
      const goferSpinner = ora('Installing Gofer AI CLI assets...').start();
      try {
        const summary = await installGoferResources(targetDir, {
          workflowProfile: 'enterpriseai',
        });
        goferSpinner.succeed(
          `Installed Gofer assets (${summary.commands} commands, ${summary.agents} agents, ${summary.skills} skills)`,
        );
      } catch (err) {
        goferSpinner.fail('Failed to install Gofer AI CLI assets');
        out.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }

    // Step 8: Initialize git
    const gitSpinner = ora('Initializing git...').start();
    try {
      await exec('git', ['init'], { cwd: targetDir });
      await exec('git', ['add', '.'], { cwd: targetDir });
      await exec('git', ['commit', '-m', `Initial scaffold from template\n\nApp: ${initOptions.displayName}\nCreated by: eai init\nTemplate: ${describeTemplateSource(options.from)}`], { cwd: targetDir });
      gitSpinner.succeed('Initialized git repository');
    } catch (err) {
      gitSpinner.fail('Failed to initialize git');
      out.warn(describeGitInitFailure(err));
    }

    // Step 9: Optionally provision Entra app registration inline against the
    // tenant the user selected in the tenant-binding prompt (not the active
    // tenant blindly). Only runs in interactive mode when logged in and a
    // tenant is bound.
    let entraProvisioned = false;
    if (!options.skipPrompts && initOptions.tenantId) {
      const loggedIn = await isAuthenticated();
      if (loggedIn) {
        out.blank();
        const { provision } = await inquirer.prompt([{
          type: 'confirm',
          name: 'provision',
          message: 'Provision Entra app registration now?',
          default: true,
        }]);
        if (provision) {
          entraProvisioned = await provisionEntraInline(targetDir, initOptions.name, initOptions.tenantId, publicApiUrl);
        }
      }
    }

    out.blank();
    out.success(`Created ${chalk.bold(initOptions.displayName)} at ${chalk.cyan(targetDir)}`);
    out.blank();
    out.heading('Next steps:');
    out.blank();
    if (initOptions.tenantId) {
      out.dim(`Bound to tenant: ${chalk.cyan(initOptions.tenantId)}`);
    }
    if (!entraProvisioned) {
      out.dim(`Run ${chalk.cyan('eai provision entra')} inside the project to set up Entra authentication.`);
    }
    out.dim(`Template: ${options.from}`);
    if (options.gofer) {
      out.dim('Gofer: Claude /0_business_scenario; Codex $gofer/1_gofer_research; Gemini /gofer:1_gofer_research; Copilot .github prompts/skills.');
    }
    out.dim(`CLI docs: https://github.com/${GITHUB_ORG}/eai-cli`);
    out.blank();
  });

/**
 * Provision an Entra app registration inline at the end of `eai init`, bound
 * to the tenant the user selected in the tenant-binding prompt. Returns true
 * on success. Non-fatal: logs a warning and returns false on any failure.
 */
async function provisionEntraInline(
  targetDir: string,
  verticalName: string,
  tenantId: string,
  publicApiUrl: string,
): Promise<boolean> {
  const spinner = ora('Provisioning Entra app registration...').start();
  try {
    const client = new PlatformAPIClient(publicApiUrl, tenantId);
    const result = await client.provisionEntraApp({
      tenantId,
      verticalName,
      redirectUris: [`http://localhost:3000/${verticalName}/api/auth/callback/microsoft-entra-id`],
      idempotent: true,
    });

    if (result.clientSecret) {
      await patchEnvFile(targetDir, {
        ENTRA_CLIENT_ID: result.clientId,
        ENTRA_CLIENT_SECRET: result.clientSecret,
      });
      spinner.succeed(`Entra app registration ${result.existing ? 'confirmed' : 'created'}: ${chalk.dim(result.clientId)}`);
      out.warn('The client secret has been written to .env.local and cannot be retrieved again.');
      return true;
    }

    if (result.existing) {
      await patchEnvFile(targetDir, { ENTRA_CLIENT_ID: result.clientId });
      const hydratedSecret = await hydrateCloudSecret(targetDir, verticalName);
      spinner.succeed(`Entra app registration confirmed: ${chalk.dim(result.clientId)}`);
      if (hydratedSecret) {
        out.success('ENTRA_CLIENT_SECRET hydrated from cloud config.');
      } else {
        out.warn('An existing registration was found. Run `eai env pull --include-secrets` if ENTRA_CLIENT_SECRET is missing locally.');
      }
      return true;
    }

    spinner.fail('Provisioning returned no credentials.');
    out.warn('Run `eai provision entra` after setup to complete Entra registration.');
    return false;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error('[eai:provision]', err);
    }
    spinner.fail('Entra provisioning failed — skipping.');
    out.warn('Run `eai provision entra` inside the project to complete Entra registration.');
    return false;
  }
}

async function hydrateCloudSecret(targetDir: string, verticalName: string): Promise<boolean> {
  try {
    const { patches } = await pullCloudEnvValues({
      label: verticalName,
      includeSecrets: true,
    });
    const secret = patches.ENTRA_CLIENT_SECRET;
    if (!secret) {
      return false;
    }
    await patchEnvFile(targetDir, { ENTRA_CLIENT_SECRET: secret });
    return true;
  } catch {
    return false;
  }
}

async function loadActiveTenantForInit(publicApiUrl: string): Promise<TenantMembership | null> {
  try {
    const ctx = await resolveActiveTenantContext({ publicApiUrl, interactive: false });
    return ctx.activeTenant;
  } catch {
    return null;
  }
}

async function assertTenantExists(publicApiUrl: string, tenantId: string): Promise<void> {
  const client = new PlatformAPIClient(publicApiUrl, tenantId);
  const res = await client.getTenant(tenantId);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    out.error(`Tenant ${tenantId} could not be resolved (${res.status}). ${body}`.trim());
    process.exit(1);
  }
}

async function promptTenantBinding(
  publicApiUrl: string,
  activeTenant: TenantMembership | null,
  tenantFlag: string | undefined,
): Promise<string> {
  if (tenantFlag) {
    await assertTenantExists(publicApiUrl, tenantFlag);
    return tenantFlag;
  }

  const choices: Array<{ name: string; value: 'default' | 'child' | 'other'; disabled?: string }> = [];

  if (activeTenant) {
    choices.push({
      name: `Default (currently selected): ${activeTenant.displayName} · ${chalk.dim(activeTenant.id)}`,
      value: 'default',
    });
  } else {
    choices.push({
      name: 'Default (currently selected)',
      value: 'default',
      disabled: 'no active tenant — run `eai login` and `eai tenant select` first',
    });
  }

  choices.push({
    name: 'Create a child tenant boundary under the default  [not implemented]',
    value: 'child',
  });

  choices.push({
    name: 'Other tenant (enter ID)',
    value: 'other',
  });

  const { mode } = await inquirer.prompt([{
    type: 'list',
    name: 'mode',
    message: 'Which platform tenant should this vertical bind to?',
    choices,
  }]);

  if (mode === 'default') {
    return activeTenant!.id;
  }

  if (mode === 'child') {
    // Stub: child-tenant creation from `eai init` is intentionally not wired up
    // yet. The underlying API (`PlatformAPIClient.createTenant({ parent })` plus
    // `bootstrapChildTenantAdmin`) is exercised by `eai tenant create --parent`,
    // which currently has a known bootstrap-admin-assignment failure mode. Until
    // that is resolved, `init` fails hard rather than leaving a half-provisioned
    // child tenant bound to a brand-new workspace boundary.
    //
    // When ready, the implementation is roughly:
    //   const { childName, childSlug } = await inquirer.prompt([...]);
    //   const client = new PlatformAPIClient(publicApiUrl, activeTenant!.id);
    //   const res = await client.createTenant({ name: childName, slug: childSlug, parent: activeTenant!.id });
    //   ... parse response, run bootstrapChildTenantAdmin, return new tenant id.
    out.error('Creating a child tenant from `eai init` is not implemented yet. Use child tenants only for real workspace/company hierarchy boundaries. For a vertical app under the active company tenant, run `eai vertical create "<name>" --template blank-vertical-template` after init.');
    process.exit(1);
  }

  const { otherId } = await inquirer.prompt([{
    type: 'input',
    name: 'otherId',
    message: 'Tenant ID:',
    validate: (input: string) => input.trim().length > 0 || 'Tenant ID is required',
  }]);
  const trimmed = String(otherId).trim();
  await assertTenantExists(publicApiUrl, trimmed);
  return trimmed;
}

async function hydrateEnvFromLoginContext(
  targetDir: string,
  verticalName: string,
  platformTenantId: string,
): Promise<void> {
  const patches: Record<string, string> = {};
  const envKey = verticalName.replace(/-/g, '_').toUpperCase();

  try {
    patches.BASE_URL_PUBLIC_API = await resolvePublicApiUrl(targetDir);
  } catch {
    // Best-effort bootstrap only.
  }

  try {
    const profileName = getActiveProfile();
    const profileConfig = await loadProfileConfig(profileName);
    if (profileConfig?.authTenantName) {
      patches.ENTRA_TENANT_NAME = profileConfig.authTenantName;
    }
    if (profileConfig?.authTenantId) {
      patches.ENTRA_TENANT_ID = profileConfig.authTenantId;
    }
  } catch {
    // Default profile has no config file.
  }

  try {
    const tokens = await loadTokens();
    if (tokens?.tenantName) {
      patches.ENTRA_TENANT_NAME = tokens.tenantName;
    }
    if (tokens?.tenantId) {
      patches.ENTRA_TENANT_ID = tokens.tenantId;
    }
  } catch {
    // Best-effort bootstrap only.
  }

  if (platformTenantId) {
    patches.EAI_TENANT_ID = platformTenantId;
    patches[`TENANT_${envKey}_ID`] = platformTenantId;
  }

  if (Object.keys(patches).length > 0) {
    await patchEnvFile(targetDir, patches);
  }
}

function toDisplayName(name: string): string {
  return name
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function describeTemplateSource(templateSource: string): string {
  if (templateSource === TEMPLATE_REPO) {
    return TEMPLATE_REPO_LABEL;
  }

  const githubMatch = templateSource.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  if (githubMatch?.[1]) {
    return githubMatch[1].replace(/\/+$/, '');
  }

  return templateSource;
}

function describeGitInitFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/spawn git enoent/i.test(message)) {
    return '`git` was not found on your PATH, so the project was created without an initialized repository. Install Git and run `git init` inside the new project if you want version control.';
  }
  return message;
}

// ─── Generators ────────────────────────────────────────────────────────────

function generateEnvFile(opts: InitOptions): string {
  const envKey = opts.name.replace(/-/g, '_').toUpperCase();
  const authSecret = randomBytes(32).toString('base64');
  const workflowSection = `WORKFLOW_${envKey}_ID=`;

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
# Run 'eai env pull' to populate from Azure App Config
# =============================================================================
BASE_URL_PUBLIC_API=

# =============================================================================
# Tenant configuration
# EAI_TENANT_ID is the server-side tenant this vertical binds to — read by
# the template in src/app/page.tsx and src/app/api/eai/[[...rest]]/route.ts.
# TENANT_KEYS + TENANT_<KEY>_ID support the multi-tenant config resolver at
# src/app/api/eai/config/route.ts. Both keys are kept in sync by eai init.
# =============================================================================
EAI_TENANT_ID=
TENANT_KEYS=${opts.name}
TENANT_${envKey}_ID=

# =============================================================================
# Workflow IDs — populate after provisioning via platform dashboard
# =============================================================================
${workflowSection}

# =============================================================================
# Microsoft Entra ID (CIAM) — end-user auth for this vertical
# Run 'eai provision entra' to populate ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET
# =============================================================================
ENTRA_TENANT_NAME=
ENTRA_TENANT_ID=
ENTRA_SCOPES="email offline_access openid profile"
ENTRA_CLIENT_ID=
ENTRA_CLIENT_SECRET=

# =============================================================================
# Auth.js — auto-generated secret
# =============================================================================
AUTH_SECRET=${authSecret}

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

const postgresqlResourceStorage = {
  schemaVersion: 1,
  storageBackend: 'postgresql' as const,
  storageMetadataStatus: 'ready' as const,
  storageBinding: {
    sql: {
      databaseAlias: 'resourceapi-postgres',
      tenantSchemaStrategy: 'per-tenant-database' as const,
      schemaName: 'resources',
      tableName: 'tenant_resources',
    },
  },
};

export const objectTypes = {
  '${tenantKey}': [
    {
      name: 'Record',
      displayName: 'Record',
      description: 'A sample record — replace with your domain model',
      ...postgresqlResourceStorage,
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
      ...postgresqlResourceStorage,
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
import { EAIPlatformClient } from '@enterpriseaigroup/platform-sdk';
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
| \`packages/platform-sdk/\` | Local typed API client source until the SDK is promoted to a shared package |
| \`.github/workflows/deploy-demo.yml\` | Deployment workflow |
`;
}
