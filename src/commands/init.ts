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
import {
  browserLogin,
  isAuthenticated,
  loadTokens,
  resolveAuthConfig,
  storeTokens,
  validateResolvedAuthConfig,
} from "../lib/auth.js";
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
  type ParsedApiError,
} from "../lib/api.js";
import { findProjectRoot, patchEnvFile } from "../lib/config.js";
import { pullCloudEnvValues } from "../lib/cloud-env.js";
import { findGuidance } from "../lib/error-guidance/match.js";
import { formatGuidanceText } from "../lib/error-guidance/render.js";
import { getActiveProfile, loadProfileConfig } from "../lib/profile.js";
import { getNpmExecOptions, getNpmExecutable } from "../lib/npm.js";
import {
  errMsg,
  isRecord,
  normalizeChildTenantDisplayNameOption,
} from "../lib/utils.js";
import type { ProjectManifest } from "../lib/project-manifest.js";
import { saveProjectManifest } from "../lib/project-manifest.js";
import { printEaiSplash } from "../lib/splash.js";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const TEMPLATE_REPO = "https://github.com/eai-support/eai-app-template.git";
const GITHUB_ORG = "eai-support";
const PACKAGE_SCOPE = "eai-tools";
const TEMPLATE_REPO_LABEL = `${GITHUB_ORG}/eai-app-template`;
const ONBOARDING_DOCS_URL = "https://www.enterpriseaigroup.com/docs/getting-started";

export function describeAppCreationFailure(error: ParsedApiError): string {
  const guidance = findGuidance({
    operation: "tenant app create",
    status: error.status,
    serverCode: error.code,
    message: error.message,
  });

  const lines = [`App creation failed: ${error.message}`];
  if (guidance) {
    lines.push("", formatGuidanceText(guidance));
  } else {
    lines.push(
      "",
      "Try next:",
      "1. eai whoami [read-only]",
      "   Confirm the signed-in account and selected workspace.",
      "2. eai tenant list --all --format json [read-only]",
      "   Check that the account can access the workspace.",
      "3. eai errors list [read-only]",
      "   Inspect known recovery guidance before retrying.",
    );
  }

  lines.push(
    "",
    `Getting started: ${ONBOARDING_DOCS_URL}`,
  );
  return lines.join("\n");
}

export function describeCreateFlowFailure(error: unknown): string {
  return [
    errMsg(error),
    "",
    "Try next:",
    "1. eai whoami [read-only]",
    "   Confirm the signed-in account and selected workspace.",
    "2. eai errors list [read-only]",
    "   Inspect known recovery guidance before retrying.",
    `3. Read the setup guide: ${ONBOARDING_DOCS_URL}`,
  ].join("\n");
}

function startEaiStep(message: string) {
  return ora({
    text: message,
    spinner: { interval: 120, frames: ["◇"] },
    color: "cyan",
    indent: 2,
  }).start();
}

function showCreateSection(title: string): void {
  out.blank();
  out.heading(`${chalk.cyan("◇")} ${title}`);
}

type CreateAiTool = "codex" | "claude" | "vscode" | "grok" | "gemini";

const CREATE_AI_TOOL_CHOICES: Array<{ name: string; value: CreateAiTool }> = [
  { name: "Codex", value: "codex" },
  { name: "Claude", value: "claude" },
  { name: "GitHub Copilot in VS Code", value: "vscode" },
  { name: "Grok Build", value: "grok" },
  { name: "Gemini", value: "gemini" },
];

const CREATE_AI_TOOL_LABELS: Record<CreateAiTool, string> = {
  codex: "Codex",
  claude: "Claude",
  vscode: "GitHub Copilot in VS Code",
  grok: "Grok Build",
  gemini: "Gemini",
};

const CREATE_PROMPT_THEME = {
  prefix: {
    idle: chalk.cyan("◇"),
    done: chalk.green("✔"),
  },
  style: {
    message: (text: string) => chalk.bold(text),
  },
};

const CREATE_SELECT_THEME = {
  ...CREATE_PROMPT_THEME,
  icon: { cursor: chalk.cyan("●") },
  style: {
    message: (text: string, status: string) =>
      status === "done" ? "" : chalk.bold(text),
  },
};

const CREATE_NESTED_PROMPT_THEME = {
  ...CREATE_PROMPT_THEME,
  prefix: {
    idle: `  ${chalk.cyan("◇")}`,
    done: `  ${chalk.green("✔")}`,
  },
};

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
  appKey: string;
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

/**
 * `--from` accepts any GitHub repo or local path, and install runs after
 * .env.local has been generated and hydrated. Only the canonical template is
 * trusted to execute scripts on the developer machine unless the user opts in
 * explicitly for a custom source.
 */
export function buildTemplateInstallArgs(from: string): string[] {
  const args = ["install", "--no-audit", "--no-fund"];
  if (from !== TEMPLATE_REPO) args.push("--ignore-scripts");
  return args;
}

export function canRunTemplateScripts(
  from: string,
  trustTemplateScripts: boolean,
): boolean {
  return isDefaultTemplateSource(from) || trustTemplateScripts;
}

/**
 * Tenant binding produced by the most recent `init` run, so the guided `create`
 * flow can report against the runtime tenant instead of the parent workspace.
 */
let lastInitBinding: InitTenantAppBinding | undefined;

export function consumeLastInitBinding(): InitTenantAppBinding | undefined {
  const binding = lastInitBinding;
  lastInitBinding = undefined;
  return binding;
}

export const initCommand = new Command("init")
  .description("Scaffold a new application")
  .argument("[name]", "Name for the app (kebab-case)")
  .option(
    "--from <repo>",
    "GitHub repo URL or local path for template",
    TEMPLATE_REPO,
  )
  .option(
    "--trust-template-scripts",
    "Allow a custom template to run its Object Type generator",
    false,
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
  .option("--no-install", "Skip installing the generated app dependencies")
  .option(
    "--package-profile <profile>",
    "Package profile to record for block catalog discovery: external, internal, or hybrid",
    "external",
  )
  .option("--display-name <name>", "Display name for the app")
  .option("--description <description>", "One-sentence description for the app")
  .option(
    "--app-key <key>",
    "Bind the local project to an existing app instead of creating a new app",
  )
  .option("--no-splash", "Skip the interactive EAI wordmark")
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
    await printEaiSplash(options.splash);
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
      const binding = options.appKey
        ? await reuseTenantAppForInit(
            publicApiUrl,
            tenantContext,
            options.companyTenant || options.tenant,
            options.appKey,
            false,
          )
        : await createTenantAppForInit(
            publicApiUrl,
            tenantContext,
            options.companyTenant || options.tenant,
            options.parentTenant,
            {
              slug: nameArg,
              displayName: options.displayName || toDisplayName(nameArg),
            },
            options.childTenant,
            Boolean(options.createChildTenant),
            false,
          );
      parentTenantId = binding.parentTenantId;
      tenantId = binding.runtimeTenantId;
      lastInitBinding = binding;
      const capabilities = tenantId
        ? await evaluateInitCapabilities(publicApiUrl, tenantId)
        : defaultInitCapabilities();
      initOptions = {
        name: nameArg,
        appKey: binding.appKey,
        displayName: options.displayName || toDisplayName(nameArg),
        description:
          options.description ||
          `${options.displayName || toDisplayName(nameArg)} application`,
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
          default: nameArg || undefined,
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
          default: (answers: { name: string }) =>
            options.displayName || toDisplayName(answers.name),
        },
        {
          type: "input",
          name: "description",
          message: "Description:",
          default: (answers: { displayName: string }) =>
            options.description || `${answers.displayName} application`,
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

      const binding = options.appKey
        ? await reuseTenantAppForInit(
            publicApiUrl,
            tenantContext,
            options.companyTenant || options.tenant,
            options.appKey,
            true,
          )
        : await createTenantAppForInit(
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
      lastInitBinding = binding;

      const featureAnswers = await promptFeatureOptions(publicApiUrl, tenantId);

      initOptions = {
        ...(baseAnswers as {
          name: string;
          displayName: string;
          description: string;
        }),
        appKey: binding.appKey,
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

    out.heading(`  ${chalk.cyan("◇")} Creating ${chalk.cyan(initOptions.displayName)}`);
    out.blank();

    // Step 1: Clone template
    const cloneSpinner = startEaiStep("Cloning template...");
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

    // Step 2: Update package metadata
    const pkgSpinner = startEaiStep("Customizing package metadata...");
    try {
      const pkgPath = join(targetDir, "package.json");
      const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
      pkg.name = `@${PACKAGE_SCOPE}/${initOptions.name}`;
      pkg.description = initOptions.description;
      pkg.version = "0.1.0";
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");

      const lockPath = join(targetDir, "package-lock.json");
      try {
        const lock = JSON.parse(await readFile(lockPath, "utf-8"));
        lock.name = pkg.name;
        lock.version = pkg.version;
        if (isRecord(lock.packages?.[""])) {
          lock.packages[""].name = pkg.name;
          lock.packages[""].version = pkg.version;
        }
        await writeFile(
          lockPath,
          JSON.stringify(lock, null, 2) + "\n",
          "utf-8",
        );
      } catch (error) {
        const code = isRecord(error) ? error.code : undefined;
        if (code !== "ENOENT") {
          throw error;
        }
      }
      pkgSpinner.succeed("Updated package metadata");
    } catch (_err) {
      pkgSpinner.fail("Failed to update package metadata");
    }

    // Step 3: Generate .env.local with placeholders
    const envSpinner = startEaiStep("Generating .env.local...");
    try {
      const envContent = generateEnvFile(initOptions);
      await writeFile(join(targetDir, ".env.local"), envContent, "utf-8");
      await hydrateEnvFromLoginContext(
        targetDir,
        initOptions.name,
        initOptions.parentTenantId,
        initOptions.tenantId,
        initOptions.tenantHomeRegion,
        initOptions.appKey,
      );
      envSpinner.succeed("Generated .env.local");
    } catch (_err) {
      envSpinner.fail("Failed to generate .env.local");
    }

    // Step 4: Generate Object Types scaffold
    const typesSpinner = startEaiStep("Creating Object Types scaffold...");
    try {
      const typesContent = generateObjectTypesScaffold(initOptions);
      await writeFile(
        join(targetDir, "src", "eai.config", "object-types.ts"),
        typesContent,
        "utf-8",
      );
      const generatorPath = join(
        targetDir,
        "scripts",
        "generate-object-types-json.mjs",
      );
      if (!canRunTemplateScripts(options.from, options.trustTemplateScripts)) {
        throw new Error(
          "Custom template scripts are not run automatically. Review the template, then rerun with --trust-template-scripts only if you trust its code.",
        );
      }
      try {
        await access(generatorPath);
      } catch {
        throw new Error(
          "The app template is missing its Object Type manifest generator. Update the template and try again.",
        );
      }
      await exec(process.execPath, [generatorPath], { cwd: targetDir });
      typesSpinner.succeed("Created Object Types scaffold and runtime manifests");
    } catch (err) {
      typesSpinner.fail("Failed to create Object Types scaffold");
      out.error(errMsg(err));
      process.exit(1);
    }

    // Step 5: Generate deploy workflow
    const deploySpinner = startEaiStep("Creating deployment workflow...");
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
    const claudeSpinner = startEaiStep("Generating CLAUDE.md...");
    try {
      const claudeContent = generateClaudeMd(initOptions);
      await writeFile(join(targetDir, "CLAUDE.md"), claudeContent, "utf-8");
      claudeSpinner.succeed("Generated CLAUDE.md");
    } catch (_err) {
      claudeSpinner.fail("Failed to generate CLAUDE.md");
    }

    // Step 7: Install Gofer AI CLI assets
    if (options.gofer) {
      const goferSpinner = startEaiStep("Installing Gofer AI CLI assets...");
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
    const manifestSpinner = startEaiStep("Recording project manifest...");
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

    // Step 9: Install project dependencies
    if (options.install !== false) {
      const installArgs = buildTemplateInstallArgs(options.from);
      const trusted = !installArgs.includes("--ignore-scripts");
      if (!trusted) {
        out.warn(
          `Installing a custom template with ${chalk.cyan("--ignore-scripts")} because ${chalk.cyan(options.from)} is not the canonical EAI app template.`,
        );
        out.nestedInfo(
          `If you trust that source, run ${chalk.cyan("npm rebuild")} inside ${chalk.cyan(targetDir)} to execute its lifecycle scripts.`,
        );
      }
      const installSpinner = startEaiStep("Installing app dependencies...");
      try {
        await exec(getNpmExecutable(), installArgs, {
          cwd: targetDir,
          ...getNpmExecOptions(),
        });
        installSpinner.succeed("Installed app dependencies");
      } catch (err) {
        installSpinner.fail("Failed to install app dependencies");
        out.error(errMsg(err));
        out.nestedInfo(
          `Run \`npm install\` inside ${chalk.cyan(targetDir)} and retry.`,
        );
        process.exit(1);
      }
    }

    // Step 10: Initialize git
    const gitSpinner = startEaiStep("Initializing git...");
    try {
      await exec("git", ["init"], { cwd: targetDir });
      await exec("git", ["add", "."], { cwd: targetDir });
      try {
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
        if (isMissingGitIdentity(err)) {
          gitSpinner.succeed("Initialized git repository; first commit is pending");
          out.warn(describeGitCommitFailure(err));
        } else {
          gitSpinner.warn("Initialized git repository; first commit was not created");
          out.warn(describeGitCommitFailure(err));
        }
      }
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
    out.nestedSuccess(
      `Created ${chalk.bold(initOptions.displayName)} at ${chalk.cyan(targetDir)}`,
    );
    out.blank();
    out.heading("  Next steps:");
    out.blank();
    if (initOptions.tenantId) {
      out.nestedDim(`Main company tenant: ${chalk.cyan(initOptions.parentTenantId)}`);
      out.nestedDim(`Bound to tenant: ${chalk.cyan(initOptions.tenantId)}`);
    }
    if (!entraProvisioned) {
      out.nestedDim(
        `Run ${chalk.cyan("eai provision entra")} inside the project to set up Entra authentication.`,
      );
    }
    out.nestedDim(`Template: ${templatePlan.displaySource}`);
    if (options.gofer) {
      out.nestedDim(
        "Gofer: run eai start to open this project in a detected AI workspace with the public EAI skill.",
      );
    }
    out.nestedDim(`Package profile: ${initOptions.packageProfile}`);
    out.nestedDim(`CLI docs: https://github.com/${GITHUB_ORG}/eai`);
    out.blank();
  });

export interface CreateCommandOptions {
  from: string;
  trustTemplateScripts?: boolean;
  skipPrompts: boolean;
  skipOnboarding: boolean;
  currentDir: boolean;
  tenant?: string;
  companyTenant?: string;
  parentTenant?: string;
  childTenant?: string;
  createChildTenant?: boolean;
  gofer?: boolean;
  install?: boolean;
  packageProfile: string;
  appKey?: string;
  tool?: string;
  splash?: boolean;
}

interface CreateOnboardingAnswers {
  name: string;
  displayName: string;
  description: string;
  useCurrentDirectory: boolean;
  aiTool: CreateAiTool;
}

/**
 * Guided first-run setup matching the public Getting Started flow.
 *
 * The legacy `init` command remains the low-level scaffold entry point. This
 * command owns the first-run experience: local checks, browser auth, tenant
 * confirmation, non-interactive scaffolding, and the hand-off to Gofer.
 */
export const createCommand = new Command("create")
  .description("Guide a new builder through EAI setup and create an application")
  .argument("[name]", "Name for the app (kebab-case)")
  .option(
    "--from <repo>",
    "GitHub repo URL or local path for template",
    TEMPLATE_REPO,
  )
  .option(
    "--trust-template-scripts",
    "Allow a custom template to run its Object Type generator",
    false,
  )
  .option("--skip-prompts", "Use defaults without interactive prompts", false)
  .option(
    "--skip-onboarding",
    "Skip first-run checks and use the legacy init scaffold flow",
    false,
  )
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
  .option("--no-install", "Skip installing the generated app dependencies")
  .option(
    "--package-profile <profile>",
    "Package profile to record for block catalog discovery: external, internal, or hybrid",
    "external",
  )
  .option(
    "--app-key <key>",
    "Bind the local project to an existing app instead of creating a new app",
  )
  .option("--tool <tool>", "AI tool to prepare for: codex, claude, vscode, or gemini")
  .option("--no-splash", "Skip the interactive EAI wordmark")
  .addHelpText(
    "after",
    `
Guided setup:
  1. Check Git, Node.js, and npm
  2. Sign in with the browser and choose the signup workspace
  3. Confirm the project name and folder
  4. Create the app with Gofer AI CLI assets
  5. Check builder readiness and hand off to /0_business_scenario

The command does not create a root tenant. Complete Website signup first so
the CLI can use the onboarding-created company workspace.

Use --skip-onboarding for the legacy scaffold prompts, or use eai init for
the low-level scaffold command directly.
`,
  )
  .action(async (nameArg, options: CreateCommandOptions) => {
    await runCreateFlow(nameArg, options);
  });

async function runCreateFlow(
  nameArg: string | undefined,
  options: CreateCommandOptions,
): Promise<void> {
  await printEaiSplash(options.splash);

  if (options.skipOnboarding || options.skipPrompts) {
    const initArgs = buildForwardedInitArgs(nameArg, options);
    await initCommand.parseAsync(initArgs, { from: "user" });
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    out.error(
      "Guided `eai create` requires an interactive terminal. Use `eai create <name> --skip-prompts` for automation, or run it from a real terminal.",
    );
    process.exit(1);
  }

  try {
    await runCreatePreflight();
    const answers = await promptCreateOnboarding(nameArg, options);
    showCreateSection("Sign in to EAI");
    await ensureCreateAuthentication();

    showCreateSection("Choose your EAI workspace");
    const bootstrapPublicApiUrl = await resolvePublicApiUrl();
    let tenantContext: Awaited<ReturnType<typeof resolveActiveTenantContext>>;
    try {
      tenantContext = await resolveCreateTenantContext(
        bootstrapPublicApiUrl,
        options,
      );
    } catch (error) {
      out.error(error instanceof Error ? error.message : String(error));
      out.nestedInfo(`Complete Website signup, then retry: ${ONBOARDING_DOCS_URL}`);
      process.exit(1);
    }

    out.nestedSuccess(
      `Using company workspace ${chalk.cyan(tenantContext.activeTenant.displayName)} ${chalk.dim(`(${tenantContext.activeTenant.id})`)}`,
    );

    showCreateSection("Build your project");
    const initArgs = buildForwardedInitArgs(
      answers.name,
      options,
      answers,
      tenantContext.activeTenant.id,
    );
    await initCommand.parseAsync(initArgs, { from: "user" });

    // `init` may have bound the app to a freshly created child company. Readiness
    // must be checked against that runtime tenant, not the parent workspace.
    const binding = consumeLastInitBinding();
    const targetDir = answers.useCurrentDirectory
      ? resolve(process.cwd())
      : resolve(process.cwd(), answers.name);
    await reportCreateCompletion(
      targetDir,
      publicApiUrlForHomeRegion(binding?.runtimeTenantHomeRegion) ||
        tenantContext.publicApiUrl,
      binding?.runtimeTenantId || tenantContext.activeTenant.id,
      answers.aiTool,
      options.gofer !== false,
    );
  } catch (error) {
    out.error(describeCreateFlowFailure(error));
    process.exit(1);
  }
}

/**
 * Resolve the workspace for guided create.
 *
 * An explicit --company-tenant/--tenant is passed through as `tenantId` so the
 * membership is validated and the cached active tenant cannot silently replace
 * the operator's choice on a state-changing app create.
 */
export function resolveCreateTenantContext(
  publicApiUrl: string,
  options: CreateCommandOptions,
): ReturnType<typeof resolveActiveTenantContext> {
  return resolveActiveTenantContext({
    publicApiUrl,
    interactive: true,
    tenantId: options.companyTenant || options.tenant,
  });
}

export function buildForwardedInitArgs(
  nameArg: string | undefined,
  options: CreateCommandOptions,
  answers?: CreateOnboardingAnswers,
  tenantId?: string,
): string[] {
  const appName = answers?.name || nameArg;
  const args: string[] = [];
  if (appName) args.push(appName);
  if (options.skipPrompts || answers) args.push("--skip-prompts");
  args.push("--no-splash");

  // `tenantId` is the validated resolution of the explicit options, so the two
  // can no longer disagree; prefer it because it is always a canonical ID.
  const companyTenant = tenantId || options.companyTenant || options.tenant;
  if (companyTenant) args.push("--company-tenant", companyTenant);
  if (options.appKey) args.push("--app-key", options.appKey);
  if (options.parentTenant) args.push("--parent-tenant", options.parentTenant);
  if (options.childTenant) args.push("--child-tenant", options.childTenant);
  if (options.createChildTenant) args.push("--create-child-tenant");
  if (answers?.useCurrentDirectory || options.currentDir) {
    args.push("--current-dir");
  }
  if (answers?.displayName) args.push("--display-name", answers.displayName);
  if (answers?.description) args.push("--description", answers.description);
  if (options.from && options.from !== TEMPLATE_REPO) {
    args.push("--from", options.from);
  }
  if (options.trustTemplateScripts) args.push("--trust-template-scripts");
  if (options.gofer === false) args.push("--no-gofer");
  if (options.install === false) args.push("--no-install");
  if (options.packageProfile) {
    args.push("--package-profile", options.packageProfile);
  }
  return args;
}

async function runCreatePreflight(): Promise<void> {
  showCreateSection("Making sure your computer has the correct prerequisites.");
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] || "0", 10);
  if (nodeMajor < 24) {
    throw new Error(
      `Node.js ${process.versions.node} is too old. EAI CLI requires Node.js 24 or newer.`,
    );
  }

  const checks: Array<{ label: string; command: string; args: string[] }> = [
    { label: "Git", command: "git", args: ["--version"] },
    { label: "npm", command: getNpmExecutable(), args: ["--version"] },
  ];

  out.nestedSuccess(`Node.js ${process.versions.node}`);
  for (const check of checks) {
    try {
      const result = await exec(
        check.command,
        check.args,
        check.command === getNpmExecutable() ? getNpmExecOptions() : undefined,
      );
      const version = String(result.stdout).trim() || String(result.stderr).trim();
      out.nestedSuccess(`${check.label} ${version}`);
    } catch {
      throw new Error(
        `${check.label} is required before creating an EAI app. Install it, reopen your terminal, and run \`npx eai-cli create\` again.`,
      );
    }
  }

  out.nestedSuccess("Local tooling is ready");
}

async function promptCreateOnboarding(
  nameArg: string | undefined,
  options: CreateCommandOptions,
): Promise<CreateOnboardingAnswers> {
  const requestedTool = options.tool?.trim().toLowerCase();
  if (
    requestedTool &&
    !CREATE_AI_TOOL_CHOICES.some((choice) => choice.value === requestedTool)
  ) {
    throw new Error(
      `Unknown --tool "${options.tool}". Use codex, claude, vscode, or gemini.`,
    );
  }

  out.blank();
  const toolAnswer = requestedTool
    ? { aiTool: requestedTool as CreateAiTool }
    : await inquirer.prompt([
        {
          type: "select",
          name: "aiTool",
          message: "Which AI tool will you use for this project?",
          choices: CREATE_AI_TOOL_CHOICES,
          default: "codex",
          theme: CREATE_SELECT_THEME,
        },
      ]);

  out.blank();
  const nameAnswer = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "What is the name of your project?\n  ",
      default: nameArg ? toKebabCase(nameArg) : undefined,
      theme: CREATE_PROMPT_THEME,
      validate: (input: string) => {
        if (!/^[a-z][a-z0-9-]*$/.test(input.trim())) {
          return "Use lowercase letters, numbers, and hyphens; start with a letter";
        }
        return true;
      },
    },
  ]);

  out.blank();
  const displayNameAnswer = await inquirer.prompt([
    {
      type: "input",
      name: "displayName",
      message: "What should we call your project?\n  ",
      default: toDisplayName(String(nameAnswer.name)),
      theme: CREATE_PROMPT_THEME,
    },
  ]);

  out.blank();
  const descriptionAnswer = await inquirer.prompt([
    {
      type: "input",
      name: "description",
      message: "What does your project do?\n  ",
      default: `${displayNameAnswer.displayName} application`,
      theme: CREATE_PROMPT_THEME,
    },
  ]);

  const appName = String(nameAnswer.name).trim();
  let useCurrentDirectory = true;
  if (!options.currentDir) {
    out.blank();
    const locationAnswer = await inquirer.prompt([
      {
        type: "select",
        name: "location",
        message: "Where should we create your project?",
        choices: [
          { name: `New folder ./${appName}`, value: "new" },
          {
            name: `Current folder ./${basename(process.cwd())}`,
            value: "current",
          },
        ],
        default: "new",
        theme: CREATE_SELECT_THEME,
      },
    ]);
    useCurrentDirectory = String(locationAnswer.location) === "current";
  }

  return {
    name: appName,
    displayName: String(displayNameAnswer.displayName).trim(),
    description: String(descriptionAnswer.description).trim(),
    useCurrentDirectory,
    aiTool: String(toolAnswer.aiTool) as CreateAiTool,
  };
}

async function ensureCreateAuthentication(): Promise<void> {
  if (await isAuthenticated()) {
    out.nestedSuccess("EAI login is already active");
    return;
  }

  const { proceed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message: "No EAI login was found. Open the browser to sign in now?\n    ",
      default: true,
      theme: CREATE_NESTED_PROMPT_THEME,
    },
  ]);
  if (!proceed) {
    throw new Error("Sign-in is required before creating an EAI app.");
  }

  const profile = getActiveProfile();
  const projectRoot = await findProjectRoot();
  const resolvedConfig = await resolveAuthConfig(projectRoot || undefined, profile);
  const configIssue = validateResolvedAuthConfig(resolvedConfig);
  if (configIssue) throw new Error(configIssue);

  out.nestedInfo("Opening your browser to complete EAI sign-in...");
  const tokens = await browserLogin(
    resolvedConfig.tenantName,
    resolvedConfig.tenantId,
    resolvedConfig.clientId,
    resolvedConfig.authScope,
  );
  await storeTokens(tokens);
  out.nestedSuccess(`Authenticated as ${chalk.bold(tokens.upn || "user")}`);
}

async function reportCreateCompletion(
  targetDir: string,
  publicApiUrl: string,
  tenantId: string,
  aiTool: CreateAiTool,
  goferExpected: boolean,
): Promise<void> {
  const hasGofer = await Promise.all([
    access(join(targetDir, ".specify")),
    access(join(targetDir, ".agents")),
  ])
    .then(() => true)
    .catch(() => false);

  out.blank();
  if (goferExpected && hasGofer) {
    out.nestedSuccess("Gofer AI CLI assets confirmed");
  } else if (goferExpected) {
    out.warn("Gofer assets were not found; run `eai gofer refresh` inside the project.");
  }

  let builderReady = false;
  try {
    const client = new PlatformAPIClient(publicApiUrl, tenantId);
    const readiness = await client.getBuilderReadiness({ tenantId, workflowKeys: [] });
    builderReady = readiness.status === "available";
    if (builderReady) {
      out.nestedSuccess("Builder readiness is available");
    } else {
      out.warn(`Builder readiness: ${readiness.status}`);
      for (const check of readiness.checks) {
        out.nestedInfo(`${check.key}: ${check.status} — ${check.reasonMessage}`);
      }
    }
  } catch (error) {
    out.warn(
      `Builder readiness could not be checked yet: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  out.blank();
  const summary = buildCreateCompletionSummary(builderReady, aiTool);
  out.heading(summary.heading);
  out.nestedInfo(`Project folder: ${chalk.cyan(targetDir)}`);
  out.nestedInfo(`AI tool: ${chalk.cyan(CREATE_AI_TOOL_LABELS[aiTool])}`);
  for (const step of summary.steps) out.nestedInfo(step);
  out.nestedDim(`Setup guide: ${ONBOARDING_DOCS_URL}`);
  out.blank();
}

/**
 * Next-step copy for guided create. A failed or unchecked builder readiness must
 * not be presented as a ready workspace, and must not send the builder straight
 * into a hand-off that is known to be unproven.
 */
export function buildCreateCompletionSummary(
  builderReady: boolean,
  aiTool: CreateAiTool,
): { heading: string; steps: string[] } {
  const toolLabel = CREATE_AI_TOOL_LABELS[aiTool];
  if (builderReady) {
    return {
      heading: `${chalk.green("✔")} Your EAI workspace is ready`,
      steps: [
        `${toolLabel} is your selected AI workspace. Start it with:`,
        chalk.cyan("eai start"),
      ],
    };
  }

  return {
    heading: `${chalk.yellow("!")} Project created; builder setup is not confirmed yet`,
    steps: [
      `Re-check with ${chalk.cyan("eai doctor")} inside the project folder.`,
      `If it stays unavailable, ask your workspace tenant-admin to finish setup: ${ONBOARDING_DOCS_URL}`,
      `Once readiness reports available, start ${toolLabel} with ${chalk.cyan("eai start")}.`,
    ],
  };
}

export function toKebabCase(value: string): string {
  return value
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

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
  const spinner = startEaiStep("Provisioning Entra app registration...");
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
  appKey: string;
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

interface ExistingAppSelection {
  appKey: string;
  displayName: string;
  runtimeTenantId: string;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body.trim()) return {};
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return { message: body };
  }
}

/** Select one exact app enrollment and derive its recorded runtime tenant. */
export function selectExistingAppSelection(
  payload: unknown,
  requestedAppKey: string,
): ExistingAppSelection {
  const appKey = requestedAppKey.trim();
  const docs =
    isRecord(payload) && Array.isArray(payload.docs)
      ? payload.docs.filter(isRecord)
      : isRecord(payload) && Array.isArray(payload.items)
        ? payload.items.filter(isRecord)
        : [];
  const matches = docs.filter((doc) => {
    const data = isRecord(doc.data) ? doc.data : doc;
    return nonEmptyString(data.verticalKey) === appKey;
  });

  if (matches.length === 0) {
    throw new Error(
      `No app named ${appKey} was found in the selected company workspace. Choose Create a new app or select an app listed for that workspace.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `More than one enrollment was returned for app ${appKey}. The app cannot be selected until the platform record is unambiguous.`,
    );
  }

  const record = matches[0];
  const data = isRecord(record.data) ? record.data : record;
  const runtimeTenantId =
    nonEmptyString(data.childTenantId) ||
    nonEmptyString(data.parentTenantId) ||
    nonEmptyString(data.tenantId);
  if (!runtimeTenantId) {
    throw new Error(
      `The platform record for app ${appKey} does not identify a runtime tenant. Choose Create a new app or ask a company administrator to repair the app record.`,
    );
  }

  return {
    appKey,
    displayName: nonEmptyString(data.displayName) || appKey,
    runtimeTenantId,
  };
}

async function reuseTenantAppForInit(
  publicApiUrl: string,
  tenantContext: InitTenantContext,
  companyFlag: string | undefined,
  requestedAppKey: string,
  interactive: boolean,
): Promise<InitTenantAppBinding> {
  const appKey = requestedAppKey.trim();
  if (!appKey) {
    out.error("An existing app key is required when using --app-key.");
    process.exit(1);
  }

  const companyTenantId = await promptCompanyTenantForInit(
    publicApiUrl,
    tenantContext,
    companyFlag,
    interactive,
  );
  const client = new PlatformAPIClient(publicApiUrl, companyTenantId);
  const res = await client.listResources("tenant-vertical-enrollment", {
    limit: 50,
    where: { verticalKey: appKey },
  });
  const payload = await readJsonPayload(res);
  if (!res.ok) {
    const error = await parseApiError(
      new Response(JSON.stringify(payload), {
        status: res.status,
        statusText: res.statusText,
        headers: { "content-type": "application/json" },
      }),
    );
    out.error(`Existing app lookup failed: ${error.message}`);
    process.exit(1);
  }

  let selection: ExistingAppSelection;
  try {
    selection = selectExistingAppSelection(payload, appKey);
  } catch (error) {
    out.error(errMsg(error));
    process.exit(1);
  }

  let runtimeTenantHomeRegion: string | null | undefined =
    tenantContext.activeTenant?.id === selection.runtimeTenantId
      ? tenantContext.activeTenant.homeRegion
      : undefined;
  if (runtimeTenantHomeRegion === undefined) {
    const tenantResponse = await client.getTenant(selection.runtimeTenantId);
    if (tenantResponse.ok) {
      const tenantPayload = await readJsonPayload(tenantResponse);
      const tenantRecord =
        isRecord(tenantPayload) && isRecord(tenantPayload.tenant)
          ? tenantPayload.tenant
          : tenantPayload;
      runtimeTenantHomeRegion =
        isRecord(tenantRecord) && typeof tenantRecord.homeRegion === "string"
          ? tenantRecord.homeRegion
          : null;
    }
  }

  out.nestedInfo(
    `Using existing app ${chalk.cyan(selection.appKey)} in company tenant ${chalk.cyan(companyTenantId)}; no new platform app will be created.`,
  );
  return {
    appKey: selection.appKey,
    parentTenantId: companyTenantId,
    runtimeTenantId: selection.runtimeTenantId,
    runtimeTenantHomeRegion,
  };
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
    out.error(describeAppCreationFailure(error));
    process.exit(1);
  }

  const payload = (await res.json()) as Record<string, unknown>;
  const childTenant = payload.childTenant;
  const childTenantId =
    childTenant && typeof childTenant === "object"
      ? String((childTenant as Record<string, unknown>).id || "")
      : "";
  if (!childTenantId) {
    out.nestedInfo(
      `Created app ${chalk.cyan(appSeed.slug)} under company tenant ${chalk.cyan(immediateParentTenantId)}.`,
    );
    return {
      appKey: appSeed.slug,
      parentTenantId: companyTenantId,
      runtimeTenantId: immediateParentTenantId,
      runtimeTenantHomeRegion: activeTenant?.homeRegion,
    };
  }

  out.nestedInfo(
    `Created app ${chalk.cyan(appSeed.slug)} under main company ${chalk.cyan(companyTenantId)} with child company ${chalk.cyan(childTenantId)}.`,
  );
  const childTenantHomeRegion =
    childTenant && typeof childTenant === "object"
      ? (childTenant as Record<string, unknown>).homeRegion
      : undefined;
  return {
    appKey: appSeed.slug,
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
  appKey?: string,
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

  if (appKey) {
    patches.EAI_APP_KEY = appKey;
    patches.EAI_VERTICAL_KEY = appKey;
    patches.NEXT_PUBLIC_EAI_APP_KEY = appKey;
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

export function isMissingGitIdentity(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /author identity unknown|please tell me who you are|unable to auto-detect email address/i.test(
    message,
  );
}

export function describeGitCommitFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isMissingGitIdentity(error)) {
    return [
      "The Git repository is ready and the project files are staged, but the first commit is waiting for your Git name and email.",
      'Set them once with `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`, then run `git commit -m "Initial scaffold from template"` inside the project.',
    ].join(" ");
  }
  return `The Git repository is ready and the project files are staged, but the first commit could not be created: ${message}`;
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
EAI_APP_KEY=${opts.appKey}
EAI_VERTICAL_KEY=${opts.appKey}
NEXT_PUBLIC_EAI_APP_KEY=${opts.appKey}

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
          targetObjectType: 'document',
          cardinality: 'one-to-many' as const,
          cascadeDelete: true,
        },
      ],`
    : `      linkTypes: [],`;
  const documentTypeBlock = opts.includeDocs
    ? `
    {
      name: 'Document',
      slug: 'document',
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
  /** Exact stored Object Type slug used on relationship routes. */
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
  requiredStatus?: string | string[];
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
  slug: string;
  displayName: string;
  description?: string;
  authorization?: { privacyClass: 'owner_private' | 'shared_private' };
  properties: PropertyDefinition[];
  linkTypes: LinkTypeDefinition[];
  actions: ActionDefinition[];
  storageBackend: StorageBackend;
  schemaVersion?: number;
  storageMetadataStatus?: 'draft' | 'ready';
  storageBinding?: {
    sql?: {
      databaseAlias: 'tenant-postgres';
      tenantSchemaStrategy: 'per-tenant-schema';
      tableName: string;
    };
  };
  status: ObjectTypeStatus;
}

const postgresqlResourceStorage = {
  schemaVersion: 1,
  storageBackend: 'postgresql' as const,
  storageMetadataStatus: 'ready' as const,
  storageBinding: {
    sql: {
      databaseAlias: 'tenant-postgres' as const,
      tenantSchemaStrategy: 'per-tenant-schema' as const,
      tableName: '${tenantResourcesTableName}',
    },
  },
};

export const objectTypes: Record<string, ObjectTypeDefinition[]> = {
  '${tenantKey}': [
    {
      name: 'Record',
      slug: 'record',
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
  NODE_VERSION: '24.x'

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
