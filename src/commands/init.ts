/**
 * eai init — scaffold a new application from the template.
 */

import { Command } from "commander";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import {
  readFile,
  writeFile,
  access,
  mkdir,
  rm,
  cp,
  mkdtemp,
  chmod,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import ora from "ora";
import chalk from "chalk";
import inquirer from "inquirer";
import * as out from "../lib/output.js";
import { installGoferResources } from "../lib/gofer-installer.js";
import { applyGoferRefresh, planGoferRefresh } from "../lib/gofer-refresh.js";
import { isAuthenticated, loadTokens } from "../lib/auth.js";
import {
  publicApiUrlForHomeRegion,
  resolveActiveTenantContext,
  resolveMainCompanyTenantId,
  resolvePublicApiUrl,
  type TenantMembership,
} from "../lib/tenant-context.js";
import {
  buildTenantHierarchy,
  promptForTenantFromHierarchy,
} from "../lib/tenant-hierarchy.js";
import {
  parseApiError,
  PlatformAPIClient,
  type CapabilityDecision,
} from "../lib/api.js";
import { patchEnvFile } from "../lib/config.js";
import { pullCloudEnvValues } from "../lib/cloud-env.js";
import { getActiveProfile, loadProfileConfig } from "../lib/profile.js";
import { errMsg, normalizeChildTenantDisplayNameOption } from "../lib/utils.js";
import type { ProjectManifest } from "../lib/project-manifest.js";
import { saveProjectManifest } from "../lib/project-manifest.js";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const TEMPLATE_REPO = "https://github.com/eai-tools/eai-app-template.git";
const GITHUB_ORG = "eai-tools";
const TEMPLATE_REPO_LABEL = `${GITHUB_ORG}/eai-app-template`;

interface LinkedSourcesManifest {
  readonly appTemplate?: {
    readonly repo?: string;
    readonly commit?: string;
  };
}

export interface TemplateClonePlan {
  readonly cloneSource: string;
  readonly displaySource: string;
  readonly pinnedCommit?: string;
}

function buildInitialProjectManifest(
  templatePlan: TemplateClonePlan,
  packageProfile: PackageProfile,
): ProjectManifest {
  return {
    schemaVersion: 1,
    cli: {
      version: pkg.version,
    },
    packages: {
      profile: packageProfile,
      source:
        packageProfile === "internal"
          ? "enterpriseai-packages"
          : "eai-packages",
      recordedAt: new Date().toISOString(),
    },
    template: {
      repo: templatePlan.cloneSource,
      commit: templatePlan.pinnedCommit,
      displaySource: templatePlan.displaySource,
      initializedAt: new Date().toISOString(),
    },
  };
}

interface InitOptions {
  name: string;
  displayName: string;
  description: string;
  parentTenantId: string;
  tenantId: string;
  tenantHomeRegion?: string | null;
  includeChat: boolean;
  includeDocs: boolean;
  authProvider: "ciam" | "b2b" | "dual";
  packageProfile: PackageProfile;
}

type PackageProfile = "external" | "internal" | "hybrid";

type InitCapabilityKey =
  | "child-tenants"
  | "ai-chat"
  | "documents"
  | "auth-b2b"
  | "auth-dual";

type InitCapabilityMap = Record<InitCapabilityKey, CapabilityDecision>;

export function describeCloneFailure(
  templateSource: string,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    /spawn git enoent/i.test(message) ||
    normalized.includes("git is not recognized") ||
    (normalized.includes("no such file or directory") &&
      normalized.includes("git"))
  ) {
    return [
      "`git` is required to scaffold from a repository source, but it is not installed or not on your PATH.",
      "Install Git, reopen your terminal, and run the command again.",
      "",
      "Windows: winget install --id Git.Git -e",
      "Download: https://git-scm.com/download/win",
      "",
      `Default public template: ${TEMPLATE_REPO}`,
      `Custom source: eai init <name> --from <repo-or-path>`,
    ].join("\n");
  }

  if (
    isDefaultTemplateSource(templateSource) &&
    /repository .* not found|repository not found|fatal: .* not found/i.test(
      message,
    )
  ) {
    return (
      `${message}\n\nThe default template source (${TEMPLATE_REPO}) could not be reached.\n` +
      `Use ${"`"}eai init <name> --from <repo-or-path>${"`"} with another accessible template source if GitHub is blocked from this machine.`
    );
  }

  return message;
}

function loadLinkedSourcesManifest(): LinkedSourcesManifest | null {
  try {
    return require("../../resources/linked-sources.json") as LinkedSourcesManifest;
  } catch {
    return null;
  }
}

export function isDefaultTemplateSource(templateSource: string): boolean {
  return templateSource === TEMPLATE_REPO;
}

export function resolveTemplateClonePlan(
  templateSource: string,
): TemplateClonePlan {
  if (!isDefaultTemplateSource(templateSource)) {
    return {
      cloneSource: templateSource,
      displaySource: describeTemplateSource(templateSource),
    };
  }

  const linkedSources = loadLinkedSourcesManifest();
  const cloneSource = linkedSources?.appTemplate?.repo || TEMPLATE_REPO;
  const pinnedCommit = linkedSources?.appTemplate?.commit;

  return {
    cloneSource,
    pinnedCommit,
    displaySource: pinnedCommit
      ? `${TEMPLATE_REPO_LABEL}@${pinnedCommit.slice(0, 7)}`
      : TEMPLATE_REPO_LABEL,
  };
}

async function cloneTemplate(
  templateSource: string,
  targetDir: string,
  options: { allowTargetRemoval?: boolean } = {},
): Promise<TemplateClonePlan> {
  const plan = resolveTemplateClonePlan(templateSource);

  if (!plan.pinnedCommit) {
    await exec("git", ["clone", "--depth", "1", plan.cloneSource, targetDir]);
    return plan;
  }

  try {
    await exec("git", ["init", targetDir]);
    await exec("git", [
      "-C",
      targetDir,
      "remote",
      "add",
      "origin",
      plan.cloneSource,
    ]);
    await exec("git", [
      "-C",
      targetDir,
      "fetch",
      "--depth",
      "1",
      "origin",
      plan.pinnedCommit,
    ]);
    await exec("git", ["-C", targetDir, "checkout", "FETCH_HEAD"]);
    return plan;
  } catch (error) {
    if (options.allowTargetRemoval === false) {
      await rm(join(targetDir, ".git"), { recursive: true, force: true });
      throw error;
    }
    await rm(targetDir, { recursive: true, force: true });
    await exec("git", ["clone", plan.cloneSource, targetDir]);
    await exec("git", ["-C", targetDir, "checkout", plan.pinnedCommit]);
    return plan;
  }
}

async function copyTemplateIntoTargetDir(
  templateSource: string,
  targetDir: string,
): Promise<TemplateClonePlan> {
  const templateDir = await mkdtemp(join(tmpdir(), "eai-template-"));
  try {
    await chmod(templateDir, 0o700);
    const plan = await cloneTemplate(templateSource, templateDir);
    await rm(join(templateDir, ".git"), { recursive: true, force: true });
    // Current-directory init updates matching scaffold-managed files while
    // preserving unrelated files and existing repository metadata.
    await cp(templateDir, targetDir, { recursive: true, force: true });
    return plan;
  } finally {
    await rm(templateDir, { recursive: true, force: true });
  }
}

export const initCommand = new Command("init")
  .description("Scaffold a new application")
  .argument("[name]", "Name for the app (kebab-case)")
  .option(
    "--from <repo>",
    "GitHub repo URL or local path for template",
    TEMPLATE_REPO,
  )
  .option("--skip-prompts", "Use defaults without interactive prompts", false)
  .option(
    "--current-dir",
    "Scaffold into the current directory instead of creating ./<name>",
    false,
  )
  .option(
    "--tenant <id>",
    "Main company tenant ID (deprecated alias for --company-tenant)",
  )
  .option("--company-tenant <id>", "Main company tenant ID that owns this app")
  .option(
    "--parent-tenant <id>",
    "Immediate parent company tenant ID for the new child company",
  )
  .option(
    "--child-tenant <name>",
    "Create or reuse a child company tenant display name for the app runtime boundary",
  )
  .option(
    "--create-child-tenant",
    "Prompt for a child company tenant instead of using the selected company tenant",
  )
  .option("--no-gofer", "Skip installing Gofer AI CLI assets")
  .option(
    "--package-profile <profile>",
    "Package profile to record for block catalog discovery: external, internal, or hybrid",
    "external",
  )
  .addHelpText(
    "after",
    `
Gofer AI CLI assets are installed by default:
  .specify/ commands, scripts, templates, hooks, and memory folders
  .claude/ commands and agents for Claude CLI
  .system/skills and .agents/skills for Codex CLI
  .gemini/commands/gofer and .gemini/extension.json for Gemini CLI
  .github/prompts, .github/instructions, and .github/skills for GitHub Copilot

The default public template is pinned to the latest eai-app-template main
commit captured when this CLI release was cut. Use --from to override it with
another repo or local path.

Use --no-gofer only when you need a bare app scaffold.
`,
  )
  .action(async (nameArg, options) => {
    const publicApiUrl = await resolvePublicApiUrl();
    const tenantContext = await loadActiveTenantForInit(publicApiUrl);
    const activeTenant = tenantContext.activeTenant;

    let tenantId: string;
    let parentTenantId: string;
    let initOptions: InitOptions;
    let targetDir: string;
    let targetUsesCurrentDir: boolean;
    const packageProfile = resolvePackageProfile(options.packageProfile);

    if (options.skipPrompts && nameArg) {
      targetUsesCurrentDir = Boolean(options.currentDir);
      targetDir = await resolveInitTargetDir(nameArg, targetUsesCurrentDir);
      const binding = await createTenantAppForInit(
        publicApiUrl,
        tenantContext,
        options.companyTenant || options.tenant,
        options.parentTenant,
        {
          slug: nameArg,
          displayName: toDisplayName(nameArg),
        },
        options.childTenant,
        Boolean(options.createChildTenant),
        false,
      );
      parentTenantId = binding.parentTenantId;
      tenantId = binding.runtimeTenantId;
      const capabilities = tenantId
        ? await evaluateInitCapabilities(publicApiUrl, tenantId)
        : defaultInitCapabilities();
      initOptions = {
        name: nameArg,
        displayName: toDisplayName(nameArg),
        description: `${toDisplayName(nameArg)} application`,
        parentTenantId,
        tenantId,
        tenantHomeRegion:
          binding.runtimeTenantHomeRegion ?? activeTenant?.homeRegion,
        includeChat: capabilities["ai-chat"].outcome === "allow",
        includeDocs: capabilities.documents.outcome === "allow",
        authProvider: "ciam",
        packageProfile,
      };
    } else {
      const baseAnswers = await inquirer.prompt([
        {
          type: "input",
          name: "name",
          message: "App name (kebab-case):",
          default: nameArg,
          validate: (input: string) => {
            if (!/^[a-z][a-z0-9-]*$/.test(input)) {
              return "Must be lowercase, start with a letter, and contain only letters, numbers, and hyphens";
            }
            return true;
          },
        },
        {
          type: "input",
          name: "displayName",
          message: "Display name:",
          default: (answers: { name: string }) => toDisplayName(answers.name),
        },
        {
          type: "input",
          name: "description",
          message: "Description:",
          default: (answers: { displayName: string }) =>
            `${answers.displayName} application`,
        },
      ]);

      const appName = String(baseAnswers.name);
      if (options.currentDir) {
        targetUsesCurrentDir = true;
      } else {
        const locationAnswer = await inquirer.prompt([
          {
            type: "confirm",
            name: "useCurrentDirectory",
            message: `Use current folder "${basename(process.cwd())}" instead of creating ./${appName}?`,
            default: basename(process.cwd()).toLowerCase() === appName,
          },
        ]);
        targetUsesCurrentDir = Boolean(locationAnswer.useCurrentDirectory);
      }

      targetDir = await resolveInitTargetDir(appName, targetUsesCurrentDir);

      const binding = await createTenantAppForInit(
        publicApiUrl,
        tenantContext,
        options.companyTenant || options.tenant,
        options.parentTenant,
        {
          slug: String(baseAnswers.name),
          displayName: String(baseAnswers.displayName),
        },
        options.childTenant,
        Boolean(options.createChildTenant),
        true,
      );
      parentTenantId = binding.parentTenantId;
      tenantId = binding.runtimeTenantId;

      const featureAnswers = await promptFeatureOptions(publicApiUrl, tenantId);

      initOptions = {
        ...(baseAnswers as {
          name: string;
          displayName: string;
          description: string;
        }),
        parentTenantId,
        tenantId,
        tenantHomeRegion:
          binding.runtimeTenantHomeRegion ?? activeTenant?.homeRegion,
        ...(featureAnswers as {
          includeChat: boolean;
          includeDocs: boolean;
          authProvider: "ciam" | "b2b" | "dual";
        }),
        packageProfile,
      };
    }

    out.heading(`Creating ${chalk.cyan(initOptions.displayName)}`);
    out.blank();

    // Step 1: Clone template
    const cloneSpinner = ora("Cloning template...").start();
    const templatePlan = resolveTemplateClonePlan(options.from);
    try {
      if (targetUsesCurrentDir) {
        await copyTemplateIntoTargetDir(options.from, targetDir);
      } else {
        await cloneTemplate(options.from, targetDir, {
          allowTargetRemoval: true,
        });
      }
      // Remove .git to start fresh
      if (!targetUsesCurrentDir) {
        await rm(join(targetDir, ".git"), { recursive: true, force: true });
      }
      cloneSpinner.succeed(
        `Cloned from ${chalk.dim(templatePlan.displaySource)}`,
      );
    } catch (err) {
      cloneSpinner.fail("Failed to clone template");
      out.error(describeCloneFailure(options.from, err));
      process.exit(1);
    }

    // Step 2: Update package.json
    const pkgSpinner = ora("Customizing package.json...").start();
    try {
      const pkgPath = join(targetDir, "package.json");
      const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
      pkg.name = `@${GITHUB_ORG}/${initOptions.name}`;
      pkg.description = initOptions.description;
      pkg.version = "0.1.0";
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
      pkgSpinner.succeed("Updated package.json");
    } catch (_err) {
      pkgSpinner.fail("Failed to update package.json");
    }

    // Step 3: Generate .env.local with placeholders
    const envSpinner = ora("Generating .env.local...").start();
    try {
      const envContent = generateEnvFile(initOptions);
      await writeFile(join(targetDir, ".env.local"), envContent, "utf-8");
      await hydrateEnvFromLoginContext(
        targetDir,
        initOptions.name,
        initOptions.parentTenantId,
        initOptions.tenantId,
        initOptions.tenantHomeRegion,
      );
      envSpinner.succeed("Generated .env.local");
    } catch (_err) {
      envSpinner.fail("Failed to generate .env.local");
    }

    // Step 4: Generate Object Types scaffold
    const typesSpinner = ora("Creating Object Types scaffold...").start();
    try {
      const typesContent = generateObjectTypesScaffold(initOptions);
      await writeFile(
        join(targetDir, "src", "eai.config", "object-types.ts"),
        typesContent,
        "utf-8",
      );
      typesSpinner.succeed("Created Object Types scaffold");
    } catch (_err) {
      typesSpinner.fail("Failed to create Object Types scaffold");
    }

    // Step 5: Generate deploy workflow
    const deploySpinner = ora("Creating deployment workflow...").start();
    try {
      const workflowDir = join(targetDir, ".github", "workflows");
      await mkdir(workflowDir, { recursive: true });
      const workflowContent = generateDeployWorkflow(initOptions);
      await writeFile(
        join(workflowDir, "deploy-demo.yml"),
        workflowContent,
        "utf-8",
      );
      deploySpinner.succeed("Created deploy-demo.yml");
    } catch (_err) {
      deploySpinner.fail("Failed to create deployment workflow");
    }

    // Step 6: Generate project CLAUDE.md
    const claudeSpinner = ora("Generating CLAUDE.md...").start();
    try {
      const claudeContent = generateClaudeMd(initOptions);
      await writeFile(join(targetDir, "CLAUDE.md"), claudeContent, "utf-8");
      claudeSpinner.succeed("Generated CLAUDE.md");
    } catch (_err) {
      claudeSpinner.fail("Failed to generate CLAUDE.md");
    }

    // Step 7: Install Gofer AI CLI assets
    if (options.gofer) {
      const goferSpinner = ora("Installing Gofer AI CLI assets...").start();
      try {
        const summary = await installGoferResources(targetDir, {
          workflowProfile: "enterpriseai",
        });
        goferSpinner.succeed(
          `Installed Gofer assets (${summary.commands} commands, ${summary.agents} agents, ${summary.skills} skills)`,
        );
      } catch (err) {
        goferSpinner.fail("Failed to install Gofer AI CLI assets");
        out.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }

    // Step 8: Record project manifest for future safe refreshes
    const manifestSpinner = ora("Recording project manifest...").start();
    try {
      const initialManifest = buildInitialProjectManifest(
        templatePlan,
        initOptions.packageProfile,
      );
      await saveProjectManifest(targetDir, initialManifest);

      if (options.gofer) {
        const refreshPlan = await planGoferRefresh(targetDir, initialManifest, {
          workflowProfile: "enterpriseai",
        });
        await applyGoferRefresh(refreshPlan);
      }

      manifestSpinner.succeed("Recorded .eai-manifest.json");
    } catch (err) {
      manifestSpinner.fail("Failed to record project manifest");
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    // Step 9: Initialize git
    const gitSpinner = ora("Initializing git...").start();
    try {
      await exec("git", ["init"], { cwd: targetDir });
      await exec("git", ["add", "."], { cwd: targetDir });
      await exec(
        "git",
        [
          "commit",
          "-m",
          `Initial scaffold from template\n\nApp: ${initOptions.displayName}\nCreated by: eai init\nTemplate: ${templatePlan.displaySource}`,
        ],
        { cwd: targetDir },
      );
      gitSpinner.succeed("Initialized git repository");
    } catch (err) {
      gitSpinner.fail("Failed to initialize git");
      out.warn(describeGitInitFailure(err));
    }

    // Step 10: Optionally provision Entra app registration inline against the
    // tenant the user selected in the tenant-binding prompt (not the active
    // tenant blindly). Only runs in interactive mode when logged in and a
    // tenant is bound.
    let entraProvisioned = false;
    if (!options.skipPrompts && initOptions.tenantId) {
      const loggedIn = await isAuthenticated();
      if (loggedIn) {
        out.blank();
        const { provision } = await inquirer.prompt([
          {
            type: "confirm",
            name: "provision",
            message: "Provision Entra app registration now?",
            default: true,
          },
        ]);
        if (provision) {
          entraProvisioned = await provisionEntraInline(
            targetDir,
            initOptions.name,
            initOptions.tenantId,
            publicApiUrl,
          );
        }
      }
    }

    out.blank();
    out.success(
      `Created ${chalk.bold(initOptions.displayName)} at ${chalk.cyan(targetDir)}`,
    );
    out.blank();
    out.heading("Next steps:");
    out.blank();
    if (initOptions.tenantId) {
      out.dim(`Main company tenant: ${chalk.cyan(initOptions.parentTenantId)}`);
      out.dim(`Bound to tenant: ${chalk.cyan(initOptions.tenantId)}`);
    }
    if (!entraProvisioned) {
      out.dim(
        `Run ${chalk.cyan("eai provision entra")} inside the project to set up Entra authentication.`,
      );
    }
    out.dim(`Template: ${templatePlan.displaySource}`);
    if (options.gofer) {
      out.dim(
        "Gofer: Claude /0_gofer_start; Codex uses the repo-local Gofer skills; Gemini /gofer:1_gofer_research; Copilot .github prompts/skills.",
      );
    }
    out.dim(`Package profile: ${initOptions.packageProfile}`);
    out.dim(`CLI docs: https://github.com/${GITHUB_ORG}/eai`);
    out.blank();
  });

function resolvePackageProfile(value: unknown): PackageProfile {
  if (value === "external" || value === "internal" || value === "hybrid") {
    return value;
  }

  out.error(
    `Invalid --package-profile "${String(value)}". Use external, internal, or hybrid.`,
  );
  process.exit(1);
}

/**
 * Provision an Entra app registration inline at the end of `eai init`, bound
 * to the tenant the user selected in the tenant-binding prompt. Returns true
 * on success. Non-fatal: logs a warning and returns false on any failure.
 */
async function provisionEntraInline(
  targetDir: string,
  appName: string,
  tenantId: string,
  publicApiUrl: string,
): Promise<boolean> {
  const spinner = ora("Provisioning Entra app registration...").start();
  try {
    const client = new PlatformAPIClient(publicApiUrl, tenantId);
    const authSiteUrl = `http://localhost:3000/${appName}`;
    const authEndpointUrl = `${authSiteUrl}/api/auth`;
    const result = await client.provisionEntraApp({
      tenantId,
      appName,
      redirectUris: [`${authSiteUrl}/api/auth/callback/microsoft-entra-id`],
      idempotent: true,
    });

    if (
      result.tenantAuthorization?.warning ||
      (result.tenantAuthorization &&
        !result.tenantAuthorization.added &&
        !result.tenantAuthorization.alreadyAuthorized)
    ) {
      spinner.fail("Tenant data-plane authorization incomplete.");
      out.warn(
        `The app registration ${result.clientId} exists, but the tenant allowlist was not updated. Run \`eai provision entra --force --debug\` after platform access is fixed.`,
      );
      return false;
    }

    if (result.clientSecret) {
      await patchEnvFile(targetDir, {
        ENTRA_CLIENT_ID: result.clientId,
        ENTRA_CLIENT_SECRET: result.clientSecret,
        AUTH_URL: authEndpointUrl,
        NEXTAUTH_URL: authSiteUrl,
        AUTH_TRUST_HOST: "true",
      });
      spinner.succeed(
        `Entra app registration ${result.existing ? "confirmed" : "created"}: ${chalk.dim(result.clientId)}`,
      );
      out.warn(
        "The client secret has been written to .env.local and cannot be retrieved again.",
      );
      return true;
    }

    if (result.existing) {
      await patchEnvFile(targetDir, {
        ENTRA_CLIENT_ID: result.clientId,
        AUTH_URL: authEndpointUrl,
        NEXTAUTH_URL: authSiteUrl,
        AUTH_TRUST_HOST: "true",
      });
      const hydratedSecret = await hydrateCloudSecret(targetDir, appName);
      spinner.succeed(
        `Entra app registration confirmed: ${chalk.dim(result.clientId)}`,
      );
      if (hydratedSecret) {
        out.success("ENTRA_CLIENT_SECRET hydrated from cloud config.");
      } else {
        out.warn(
          "An existing registration was found. Run `eai env pull --include-secrets` if ENTRA_CLIENT_SECRET is missing locally.",
        );
      }
      return true;
    }

    spinner.fail("Provisioning returned no credentials.");
    out.warn(
      "Run `eai provision entra` after setup to complete Entra registration.",
    );
    return false;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error("[eai:provision]", err);
    }
    spinner.fail("Entra provisioning failed — skipping.");
    out.warn(
      "Run `eai provision entra` inside the project to complete Entra registration.",
    );
    return false;
  }
}

async function hydrateCloudSecret(
  targetDir: string,
  appName: string,
): Promise<boolean> {
  try {
    const { patches } = await pullCloudEnvValues({
      label: appName,
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

interface InitTenantContext {
  activeTenant: TenantMembership | null;
  memberships: TenantMembership[];
}

async function loadActiveTenantForInit(
  publicApiUrl: string,
): Promise<InitTenantContext> {
  try {
    const ctx = await resolveActiveTenantContext({
      publicApiUrl,
      interactive: false,
    });
    return {
      activeTenant: ctx.activeTenant,
      memberships: ctx.memberships,
    };
  } catch {
    return {
      activeTenant: null,
      memberships: [],
    };
  }
}

async function assertTenantExists(
  publicApiUrl: string,
  tenantId: string,
): Promise<void> {
  const client = new PlatformAPIClient(publicApiUrl, tenantId);
  const res = await client.getTenant(tenantId);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    out.error(
      `Tenant ${tenantId} could not be resolved (${res.status}). ${body}`.trim(),
    );
    process.exit(1);
  }
}

interface InitTenantAppBinding {
  parentTenantId: string;
  runtimeTenantId: string;
  childTenantId?: string;
  runtimeTenantHomeRegion?: string | null;
}

async function promptCompanyTenantForInit(
  publicApiUrl: string,
  tenantContext: InitTenantContext,
  companyFlag: string | undefined,
  interactive: boolean,
): Promise<string> {
  const { activeTenant, memberships } = tenantContext;
  if (companyFlag) {
    await assertTenantExists(publicApiUrl, companyFlag);
    return resolveMainCompanyTenantId(publicApiUrl, companyFlag);
  }

  if (!interactive && !activeTenant) {
    out.error(
      "A main company tenant is required. Pass `--company-tenant <id>` after completing onboarding.",
    );
    process.exit(1);
  }

  if (!interactive && activeTenant) {
    return resolveMainCompanyTenantId(publicApiUrl, activeTenant.id);
  }

  const choices: Array<{
    name: string;
    value: "default" | "other";
    disabled?: string;
  }> = [];

  if (activeTenant) {
    choices.push({
      name: `Default (currently selected): ${activeTenant.displayName} · ${chalk.dim(activeTenant.id)}`,
      value: "default",
    });
  } else {
    choices.push({
      name: "Default (currently selected)",
      value: "default",
      disabled:
        "no active tenant — run `eai login` and complete onboarding first",
    });
  }

  choices.push({
    name: "Other main company tenant (enter ID)",
    value: "other",
  });

  const { mode } = await inquirer.prompt([
    {
      type: "select",
      name: "mode",
      message: "Which main company tenant should own this app?",
      choices,
    },
  ]);

  if (mode === "default") {
    return resolveMainCompanyTenantId(publicApiUrl, activeTenant!.id);
  }

  const selectableMemberships = memberships.filter(
    (membership) => membership.id !== activeTenant?.id,
  );
  let trimmed = "";

  if (selectableMemberships.length > 0) {
    const selectedTenantId = await promptForTenantFromHierarchy(
      buildTenantHierarchy(selectableMemberships),
      {
        message: "Choose the main company tenant for this app",
        extraChoices: [
          {
            name: "Other main company tenant (enter ID manually)",
            value: "__manual__",
          },
        ],
      },
    );
    if (selectedTenantId !== "__manual__") {
      trimmed = selectedTenantId;
    }
  }

  if (!trimmed) {
    const { otherId } = await inquirer.prompt([
      {
        type: "input",
        name: "otherId",
        message: "Main company tenant ID:",
        validate: (input: string) =>
          input.trim().length > 0 || "Main company tenant ID is required",
      },
    ]);
    trimmed = String(otherId).trim();
  }

  await assertTenantExists(publicApiUrl, trimmed);
  return resolveMainCompanyTenantId(publicApiUrl, trimmed);
}

async function createTenantAppForInit(
  publicApiUrl: string,
  tenantContext: InitTenantContext,
  companyFlag: string | undefined,
  immediateParentFlag: string | undefined,
  appSeed: { slug: string; displayName: string },
  childTenantOption: string | undefined,
  createChildTenantFlag: boolean,
  interactive: boolean,
): Promise<InitTenantAppBinding> {
  const companyTenantId = await promptCompanyTenantForInit(
    publicApiUrl,
    tenantContext,
    companyFlag,
    interactive,
  );
  const activeTenant = tenantContext.activeTenant;
  const defaultImmediateParentTenantId =
    companyFlag || !activeTenant ? companyTenantId : activeTenant.id;
  const immediateParentTenantId =
    immediateParentFlag?.trim() || defaultImmediateParentTenantId;
  if (immediateParentTenantId !== companyTenantId) {
    await assertTenantExists(publicApiUrl, immediateParentTenantId);
  }
  const client = new PlatformAPIClient(publicApiUrl, companyTenantId);

  let childTenantDisplayName = "";
  try {
    childTenantDisplayName =
      normalizeChildTenantDisplayNameOption(childTenantOption) ?? "";
  } catch (err) {
    out.error(errMsg(err));
    process.exit(1);
  }
  let shouldCreateChildTenant =
    Boolean(childTenantDisplayName) || createChildTenantFlag;
  if (!shouldCreateChildTenant && interactive) {
    const answer = await inquirer.prompt([
      {
        type: "select",
        name: "appTenantScope",
        message: "App tenant scope:",
        default: "current",
        choices: [
          { name: "Current company tenant", value: "current" },
          { name: "New child company tenant", value: "child" },
        ],
      },
    ]);
    shouldCreateChildTenant =
      String(answer.appTenantScope || "current") === "child";
  }

  if (shouldCreateChildTenant) {
    const childDecision = await evaluateCapabilityForInit(
      client,
      "child-tenants",
      companyTenantId,
    );
    if (childDecision.outcome !== "allow") {
      const suffix = childDecision.upgradeUrl
        ? ` Upgrade: ${childDecision.upgradeUrl}`
        : "";
      out.error(`${childDecision.reasonMessage}${suffix}`);
      process.exit(1);
    }
  }

  if (shouldCreateChildTenant && !childTenantDisplayName && interactive) {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "childTenantDisplayName",
        message: "Child company tenant name:",
        default: appSeed.displayName,
        validate: (input: string) =>
          input.trim().length > 0 || "Child company tenant name is required",
      },
    ]);
    childTenantDisplayName = String(answer.childTenantDisplayName).trim();
  }
  if (shouldCreateChildTenant && !childTenantDisplayName) {
    out.error(
      "A child company tenant name is required. Pass `--child-tenant <name>`.",
    );
    process.exit(1);
  }

  const res = await client.createTenantApp(companyTenantId, {
    appDisplayName: appSeed.displayName,
    verticalKey: appSeed.slug,
    ...(immediateParentTenantId !== companyTenantId
      ? { parentTenantId: immediateParentTenantId }
      : {}),
    ...(childTenantDisplayName ? { childTenantDisplayName } : {}),
    templateKey: "eai-app-template",
    source: "eai-cli",
    usecase: "generic",
  });

  if (!res.ok) {
    const error = await parseApiError(res);
    out.error(`App creation failed: ${error.message}`);
    process.exit(1);
  }

  const payload = (await res.json()) as Record<string, unknown>;
  const childTenant = payload.childTenant;
  const childTenantId =
    childTenant && typeof childTenant === "object"
      ? String((childTenant as Record<string, unknown>).id || "")
      : "";
  if (!childTenantId) {
    out.info(
      `Created app ${chalk.cyan(appSeed.slug)} under company tenant ${chalk.cyan(immediateParentTenantId)}.`,
    );
    return {
      parentTenantId: companyTenantId,
      runtimeTenantId: immediateParentTenantId,
      runtimeTenantHomeRegion: activeTenant?.homeRegion,
    };
  }

  out.info(
    `Created app ${chalk.cyan(appSeed.slug)} under main company ${chalk.cyan(companyTenantId)} with child company ${chalk.cyan(childTenantId)}.`,
  );
  const childTenantHomeRegion =
    childTenant && typeof childTenant === "object"
      ? (childTenant as Record<string, unknown>).homeRegion
      : undefined;
  return {
    parentTenantId: companyTenantId,
    runtimeTenantId: childTenantId,
    childTenantId,
    runtimeTenantHomeRegion:
      typeof childTenantHomeRegion === "string"
        ? childTenantHomeRegion
        : activeTenant?.homeRegion,
  };
}

async function hydrateEnvFromLoginContext(
  targetDir: string,
  appName: string,
  parentTenantId: string,
  platformTenantId: string,
  tenantHomeRegion?: string | null,
): Promise<void> {
  const patches: Record<string, string> = {};
  const envKey = appName.replace(/-/g, "_").toUpperCase();

  const regionalPublicApiUrl = publicApiUrlForHomeRegion(tenantHomeRegion);
  if (regionalPublicApiUrl) {
    patches.BASE_URL_PUBLIC_API = regionalPublicApiUrl;
  } else {
    try {
      patches.BASE_URL_PUBLIC_API = await resolvePublicApiUrl(targetDir);
    } catch {
      // Best-effort bootstrap only.
    }
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

  if (parentTenantId) {
    patches.EAI_PARENT_TENANT_ID = parentTenantId;
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
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function describeTemplateSource(templateSource: string): string {
  if (isDefaultTemplateSource(templateSource)) {
    return TEMPLATE_REPO_LABEL;
  }

  const githubMatch = templateSource.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  if (githubMatch?.[1]) {
    return githubMatch[1].replace(/\/+$/, "");
  }

  return templateSource;
}

function describeGitInitFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/spawn git enoent/i.test(message)) {
    return "`git` was not found on your PATH, so the project was created without an initialized repository. Install Git and run `git init` inside the new project if you want version control.";
  }
  return message;
}

function tenantStorageScope(tenantId: string): string {
  const scope =
    tenantId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(-12) || "tenant";
  return /^[a-z]/.test(scope) ? scope : `t${scope}`;
}

function storageNamePrefix(parts: string[], separator = "_"): string {
  const replacement = separator === "-" ? "-" : "_";
  return parts
    .map((part) => String(part || "").toLowerCase().replace(/-/g, separator))
    .join(separator)
    .replace(/[^a-z0-9_-]+/g, replacement)
    .replace(/^[_-]+|[_-]+$/g, "");
}

function appOwnedSqlTableName(opts: InitOptions, logicalName: string): string {
  const prefix = storageNamePrefix(
    [tenantStorageScope(opts.tenantId), opts.name],
    "_",
  );
  return `${prefix}_${logicalName}`;
}

async function ensureTargetDirAvailable(
  targetDir: string,
  projectName: string,
): Promise<void> {
  try {
    await access(targetDir);
    out.error(`Directory "${projectName}" already exists.`);
    process.exit(1);
  } catch {
    // good — doesn't exist
  }
}

async function resolveInitTargetDir(
  projectName: string,
  useCurrentDir: boolean,
): Promise<string> {
  if (useCurrentDir) {
    return resolve(process.cwd());
  }

  const targetDir = resolve(process.cwd(), projectName);
  await ensureTargetDirAvailable(targetDir, projectName);
  return targetDir;
}

// ─── Generators ────────────────────────────────────────────────────────────

function generateEnvFile(opts: InitOptions): string {
  const envKey = opts.name.replace(/-/g, "_").toUpperCase();
  const authSecret = randomBytes(32).toString("base64");

  return `# =============================================================================
# EAI App: ${opts.displayName}
# Generated by: eai init
# Run 'eai env pull' to sync values from Azure App Config + Key Vault
# =============================================================================

# App Identity
NEXT_PUBLIC_APP_NAME=${opts.name}
APP_BASE_PATH=/${opts.name}
NEXT_PUBLIC_APP_BASE_PATH=/${opts.name}

# =============================================================================
# Platform API
# Run 'eai env pull' to populate from Azure App Config
# =============================================================================
BASE_URL_PUBLIC_API=

# =============================================================================
# Tenant configuration
# EAI_PARENT_TENANT_ID is the onboarding-created company tenant that owns
# the platform app entry.
# EAI_TENANT_ID is the server-side company tenant this app binds to — read by
# the template in src/app/page.tsx and src/app/api/eai/[[...rest]]/route.ts.
# TENANT_KEYS + TENANT_<KEY>_ID support the multi-tenant config resolver at
# src/app/api/eai/config/route.ts. Both keys are kept in sync by eai init.
# =============================================================================
EAI_PARENT_TENANT_ID=
EAI_TENANT_ID=
TENANT_KEYS=${opts.name}
TENANT_${envKey}_ID=

# =============================================================================
# Workflow IDs — populate after provisioning via platform dashboard
# =============================================================================
WORKFLOW_${envKey}_ID=

# =============================================================================
# Init capability selections
# =============================================================================
EAI_INIT_INCLUDE_AI_CHAT=${String(opts.includeChat)}
EAI_INIT_INCLUDE_DOCUMENTS=${String(opts.includeDocs)}
EAI_AUTH_PROVIDER=${opts.authProvider}

# =============================================================================
# Microsoft Entra ID (CIAM) — end-user auth for this app
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
AUTH_URL=http://localhost:3000/${opts.name}/api/auth
NEXTAUTH_URL=http://localhost:3000/${opts.name}
AUTH_TRUST_HOST=true

# =============================================================================
# IMPORTANT: Do NOT commit this file. Use 'eai env pull' to sync from cloud.
# Secrets belong in Azure Key Vault, config in Azure App Config.
# =============================================================================
`;
}

function generateObjectTypesScaffold(opts: InitOptions): string {
  const tenantKey = opts.name;
  const recordsTableName = appOwnedSqlTableName(opts, "records");
  const documentsTableName = appOwnedSqlTableName(opts, "documents");
  const tenantResourcesTableName = appOwnedSqlTableName(opts, "tenant_resources");
  const documentLinkBlock = opts.includeDocs
    ? `      linkTypes: [
        {
          name: 'documents',
          targetObjectType: 'Document',
          cardinality: 'one-to-many' as const,
          cascadeDelete: true,
        },
      ],`
    : `      linkTypes: [],`;
  const documentTypeBlock = opts.includeDocs
    ? `
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
      storageBackend: 'postgresql' as const,
      schemaVersion: 1,
      storageMetadataStatus: 'ready' as const,
      storageBinding: {
        sql: {
          databaseAlias: 'tenant-postgres',
          tenantSchemaStrategy: 'per-tenant-schema' as const,
          tableName: '${documentsTableName}',
        },
      },
      status: 'published' as const,
    },`
    : "";
  return `/**
 * Object Type definitions for ${opts.displayName}
 *
 * Each object type maps to a platform resource with typed validation, actions, and relationship links.
 *
 * Commands:
 *   eai types validate --tenant-key ${tenantKey} --tenant-id <tenant-id>
 *   eai types seed --tenant-key ${tenantKey} --tenant-id <tenant-id>
 *   eai types diff --tenant-key ${tenantKey} --tenant-id <tenant-id>
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

export type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'json' | 'file' | 'relationship';

export interface SelectOption {
  label: string;
  value: string;
}

export interface PropertyDefinition {
  name: string;
  type: FieldType;
  required: boolean;
  indexed?: boolean;
  defaultValue?: string | number | boolean;
  options?: SelectOption[];
  description?: string;
}

export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

export interface LinkTypeDefinition {
  name: string;
  targetObjectType: string;
  cardinality: Cardinality;
  cascadeDelete?: boolean;
}

export type SideEffectType = 'set_field' | 'set_timestamp' | 'set_user';

export interface ActionSideEffect {
  type: SideEffectType;
  field: string;
  value?: string | number | boolean;
}

export interface ActionValidationRules {
  requiredFields?: string[];
  requiredStatus?: string;
}

export interface ActionDefinition {
  name: string;
  displayName: string;
  requiredRole: 'tenant-viewer' | 'tenant-builder' | 'tenant-admin';
  validationRules: ActionValidationRules;
  sideEffects: ActionSideEffect[];
}

export type StorageBackend = 'postgresql' | 'documentdb' | 'blob' | 'search';

export type ObjectTypeStatus = 'draft' | 'published' | 'deprecated';

export interface ObjectTypeDefinition {
  name: string;
  displayName: string;
  description?: string;
  properties: PropertyDefinition[];
  linkTypes: LinkTypeDefinition[];
  actions: ActionDefinition[];
  storageBackend: StorageBackend;
  status: ObjectTypeStatus;
}

const postgresqlResourceStorage = {
  schemaVersion: 1,
  storageBackend: 'postgresql' as const,
  storageMetadataStatus: 'ready' as const,
  storageBinding: {
    sql: {
      databaseAlias: 'tenant-postgres',
      tenantSchemaStrategy: 'per-tenant-schema' as const,
      tableName: '${tenantResourcesTableName}',
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
${documentLinkBlock}
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
      storageBackend: 'postgresql' as const,
      schemaVersion: 1,
      storageMetadataStatus: 'ready' as const,
      storageBinding: {
        sql: {
          databaseAlias: 'tenant-postgres',
          tenantSchemaStrategy: 'per-tenant-schema' as const,
          tableName: '${recordsTableName}',
        },
      },
      status: 'published' as const,
    },
${documentTypeBlock}
  ],

  // ── Dual-tenant example (uncomment if using dual tenant structure) ──
  // '${tenantKey}-customer': [ ... ],
  // '${tenantKey}-staff': [ ... ],
};
`;
}

function defaultInitCapabilities(): InitCapabilityMap {
  return {
    "child-tenants": {
      outcome: "deny",
      reasonCode: "capability_service_unavailable",
      reasonMessage:
        "Child-tenant entitlement could not be confirmed right now.",
      upgradeUrl: null,
    },
    "ai-chat": {
      outcome: "allow",
      reasonCode: "default_cli_fallback",
      reasonMessage:
        "AI chat defaults to enabled when capability evaluation is unavailable.",
      upgradeUrl: null,
    },
    documents: {
      outcome: "allow",
      reasonCode: "default_cli_fallback",
      reasonMessage:
        "Document management defaults to enabled when capability evaluation is unavailable.",
      upgradeUrl: null,
    },
    "auth-b2b": {
      outcome: "deny",
      reasonCode: "template_scaffold_unavailable",
      reasonMessage:
        "B2B auth scaffolding is not currently available in eai init.",
      upgradeUrl: null,
    },
    "auth-dual": {
      outcome: "deny",
      reasonCode: "template_scaffold_unavailable",
      reasonMessage:
        "Dual-auth scaffolding is not currently available in eai init.",
      upgradeUrl: null,
    },
  };
}

async function evaluateCapabilityForInit(
  client: PlatformAPIClient,
  targetCapability: InitCapabilityKey,
  tenantId: string,
): Promise<CapabilityDecision> {
  try {
    return await client.evaluateCapability({
      tenantId,
      targetCapability,
      requestedOperation:
        targetCapability === "child-tenants" ? "create" : "enable",
    });
  } catch {
    return defaultInitCapabilities()[targetCapability];
  }
}

async function evaluateInitCapabilities(
  publicApiUrl: string,
  tenantId: string,
): Promise<InitCapabilityMap> {
  const client = new PlatformAPIClient(publicApiUrl, tenantId);
  const [childTenants, aiChat, documents, authB2B, authDual] =
    await Promise.all([
      evaluateCapabilityForInit(client, "child-tenants", tenantId),
      evaluateCapabilityForInit(client, "ai-chat", tenantId),
      evaluateCapabilityForInit(client, "documents", tenantId),
      evaluateCapabilityForInit(client, "auth-b2b", tenantId),
      evaluateCapabilityForInit(client, "auth-dual", tenantId),
    ]);

  return {
    "child-tenants": childTenants,
    "ai-chat": aiChat,
    documents,
    "auth-b2b": authB2B,
    "auth-dual": authDual,
  };
}

function buildAuthProviderChoices(
  capabilities: InitCapabilityMap,
): Array<{ name: string; value: "ciam" | "b2b" | "dual"; disabled?: string }> {
  const b2bDisabled =
    capabilities["auth-b2b"].outcome === "allow"
      ? "application template scaffolding is not available yet"
      : capabilities["auth-b2b"].reasonMessage;
  const dualDisabled =
    capabilities["auth-dual"].outcome === "allow"
      ? "application template scaffolding is not available yet"
      : capabilities["auth-dual"].reasonMessage;

  return [
    { name: "Entra ID CIAM", value: "ciam" },
    {
      name: "Entra ID B2B (corporate SSO)",
      value: "b2b",
      disabled: b2bDisabled,
    },
    { name: "Dual (CIAM + B2B)", value: "dual", disabled: dualDisabled },
  ];
}

async function promptFeatureOptions(
  publicApiUrl: string,
  tenantId: string,
): Promise<{
  includeChat: boolean;
  includeDocs: boolean;
  authProvider: "ciam" | "b2b" | "dual";
}> {
  const capabilities = await evaluateInitCapabilities(publicApiUrl, tenantId);

  let includeChat = false;
  if (capabilities["ai-chat"].outcome === "allow") {
    const answer = await inquirer.prompt([
      {
        type: "confirm",
        name: "includeChat",
        message: "Include AI chat?",
        default: true,
      },
    ]);
    includeChat = Boolean(answer.includeChat);
  } else {
    out.warn(`AI chat disabled: ${capabilities["ai-chat"].reasonMessage}`);
  }

  let includeDocs = false;
  if (capabilities.documents.outcome === "allow") {
    const answer = await inquirer.prompt([
      {
        type: "confirm",
        name: "includeDocs",
        message: "Include document management?",
        default: true,
      },
    ]);
    includeDocs = Boolean(answer.includeDocs);
  } else {
    out.warn(
      `Document management disabled: ${capabilities.documents.reasonMessage}`,
    );
  }

  const authChoices = buildAuthProviderChoices(capabilities);
  const authProviderAnswer = await inquirer.prompt([
    {
      type: "select",
      name: "authProvider",
      message: "Auth provider:",
      choices: authChoices,
      default: "ciam",
    },
  ]);

  return {
    includeChat,
    includeDocs,
    authProvider: authProviderAnswer.authProvider,
  };
}

function generateDeployWorkflow(opts: InitOptions): string {
  return `# Deploy ${opts.displayName} to Azure App Service
# Triggers on push to main branch
#
# Required GitHub Secrets (in "demo" environment):
#   AZUREAPPSERVICE_CLIENTID     — Azure AD app registration client ID
#   AZUREAPPSERVICE_TENANTID     — Azure AD tenant ID
#   AZUREAPPSERVICE_SUBSCRIPTIONID — Azure subscription ID
#   AZURE_RESOURCE_GROUP         — Azure resource group name
#   AZURE_WEBAPP_NAME            — Azure App Service name

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

An application built on the Enterprise AI platform.

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

## App Router Rule

For \`src/app/**/route.ts\` files, export only:

- HTTP methods such as \`GET\`, \`POST\`, \`PUT\`, and \`PATCH\`
- supported route config fields such as \`dynamic\`, \`runtime\`, and \`revalidate\`

Do not export helper functions, dependency interfaces, or test seams from \`route.ts\`. Put those in a sibling \`handler.ts\` or a module under \`src/lib/\`, then keep \`route.ts\` as a thin wrapper.

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

## App Delivery Checklist

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
