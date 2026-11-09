import { spawn } from "node:child_process";
import process from "node:process";
import chalk from "chalk";
import { findProjectRoot } from "./config.js";
import { applyGoferRefresh, planGoferRefresh } from "./gofer-refresh.js";
import { resolveProjectManifest } from "./project-manifest.js";
import * as out from "./output.js";
import { isDefaultTemplateSource, resolveTemplateClonePlan } from "../commands/init.js";

const DEFAULT_TEMPLATE_SOURCE =
  "https://github.com/eai-support/eai-app-template.git";

export type ProjectMaintenanceMode = "check" | "apply";

export interface ProjectUpdateMaintenanceOptions {
  readonly mode: ProjectMaintenanceMode;
  readonly runTemplateCheck?: () => Promise<boolean>;
}

export interface ProjectUpdateMaintenanceResult {
  readonly projectRoot: string | null;
  readonly gofer: "skipped" | "current" | "checked" | "refreshed";
  readonly template:
    | "skipped"
    | "current"
    | "review-recommended"
    | "custom-source"
    | "untracked";
}

function hasGoferWork(summary: {
  readonly added: number;
  readonly updated: number;
  readonly deleted: number;
  readonly conflicted: number;
}): boolean {
  return (
    summary.added > 0 ||
    summary.updated > 0 ||
    summary.deleted > 0 ||
    summary.conflicted > 0
  );
}

function renderGoferSummary(rows: {
  readonly added: number;
  readonly updated: number;
  readonly deleted: number;
  readonly conflicted: number;
  readonly unchanged?: number;
  readonly backedUp?: number;
}): void {
  out.table([
    ["Added", String(rows.added)],
    ["Updated", String(rows.updated)],
    ["Deleted", String(rows.deleted)],
    ["Conflicted", String(rows.conflicted)],
    ...(typeof rows.unchanged === "number"
      ? [["Unchanged", String(rows.unchanged)] as [string, string]]
      : []),
    ...(typeof rows.backedUp === "number"
      ? [["Backed up", String(rows.backedUp)] as [string, string]]
      : []),
  ]);
}

function describeTemplateSnapshot(template: {
  readonly displaySource?: string;
  readonly repo?: string;
  readonly commit?: string;
}): string {
  if (template.displaySource) {
    return template.displaySource;
  }

  if (template.commit && template.repo) {
    return `${template.repo}@${template.commit.slice(0, 7)}`;
  }

  return template.repo || "unknown";
}

async function runAutomaticTemplateCheck(
  options: ProjectUpdateMaintenanceOptions,
): Promise<void> {
  if (!options.runTemplateCheck) {
    return;
  }

  out.blank();
  out.info("Running the read-only app-template drift check...");
  const succeeded = await options.runTemplateCheck();
  if (!succeeded) {
    out.warn(
      "The automatic template check could not complete. Gofer maintenance succeeded; run `eai template check` to retry the read-only review.",
    );
  }
}

async function renderTemplateStatus(
  projectRoot: string,
): Promise<ProjectUpdateMaintenanceResult["template"]> {
  const resolvedManifest = await resolveProjectManifest(projectRoot);
  const manifest = resolvedManifest.manifest;

  if (!manifest?.template) {
    out.info(
      "Template provenance is not recorded for this project. Run `eai template check` after recording template provenance if you need app-template drift detail.",
    );
    return "untracked";
  }

  const bundledTemplate = resolveTemplateClonePlan(DEFAULT_TEMPLATE_SOURCE);
  const projectTemplateLabel = describeTemplateSnapshot(manifest.template);
  const bundledTemplateLabel = describeTemplateSnapshot({
    repo: bundledTemplate.cloneSource,
    commit: bundledTemplate.pinnedCommit,
    displaySource: bundledTemplate.displaySource,
  });

  if (
    manifest.template.repo &&
    !isDefaultTemplateSource(manifest.template.repo) &&
    manifest.template.repo !== bundledTemplate.cloneSource
  ) {
    out.info(`Project template source: ${projectTemplateLabel}`);
    out.info(`Current bundled default template: ${bundledTemplateLabel}`);
    out.info(
      "This project uses a custom template source, so app-template updates require manual review.",
    );
    out.dim(`  Review: ${chalk.cyan("eai template check")}`);
    return "custom-source";
  }

  if (
    manifest.template.commit &&
    bundledTemplate.pinnedCommit &&
    manifest.template.commit !== bundledTemplate.pinnedCommit
  ) {
    out.warn(
      `App-template snapshot has changed since this project was initialized: ${projectTemplateLabel} -> ${bundledTemplateLabel}`,
    );
    out.info(
      "Template and UI files are not auto-merged into existing apps. Review the diff before copying anything.",
    );
    out.dim(`  Review: ${chalk.cyan("eai template check")}`);
    return "review-recommended";
  }

  if (!manifest.template.commit || !bundledTemplate.pinnedCommit) {
    out.info(
      `Template snapshot: ${projectTemplateLabel}. Run ${chalk.cyan("eai template check")} for file-level review when needed.`,
    );
    return "review-recommended";
  }

  out.success(`Template snapshot is current: ${projectTemplateLabel}`);
  return "current";
}

export async function runProjectUpdateMaintenance(
  options: ProjectUpdateMaintenanceOptions,
): Promise<ProjectUpdateMaintenanceResult> {
  const projectRoot = await findProjectRoot();
  if (!projectRoot) {
    out.info("No EAI project detected here; skipping Gofer and app-template maintenance.");
    return {
      projectRoot: null,
      gofer: "skipped",
      template: "skipped",
    };
  }

  out.blank();
  out.heading("Project Maintenance");
  out.blank();
  out.success(`Project root: ${chalk.dim(projectRoot)}`);

  const resolvedManifest = await resolveProjectManifest(projectRoot);
  const plan = await planGoferRefresh(projectRoot, resolvedManifest.manifest, {
    workflowProfile: "enterpriseai",
  });

  if (options.mode === "check") {
    if (hasGoferWork(plan.summary) || plan.firstRefresh) {
      out.info("Gofer-managed asset refresh is available.");
      renderGoferSummary(plan.summary);
      out.dim(`  Apply: ${chalk.cyan("eai gofer refresh")}`);
    } else {
      out.success("Gofer-managed assets are already up to date.");
    }

    const template = await renderTemplateStatus(projectRoot);
    return {
      projectRoot,
      gofer: hasGoferWork(plan.summary) || plan.firstRefresh ? "checked" : "current",
      template,
    };
  }

  const applyResult = await applyGoferRefresh(plan, { force: true });
  if (hasGoferWork(applyResult.summary) || plan.firstRefresh) {
    out.success("Gofer-managed assets refreshed.");
    renderGoferSummary(applyResult.summary);
    if (applyResult.backupDirectory) {
      out.info(`Backup directory: ${applyResult.backupDirectory}`);
    }
  } else {
    out.success("Gofer-managed assets are already up to date.");
  }

  const template = await renderTemplateStatus(projectRoot);
  await runAutomaticTemplateCheck(options);
  return {
    projectRoot,
    gofer: "refreshed",
    template,
  };
}

export function runCurrentCliCommand(args: readonly string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const entry = process.argv[1];
    if (!entry) {
      resolve(false);
      return;
    }

    const child = spawn(process.execPath, [entry, ...args], {
      stdio: "inherit",
      env: {
        ...process.env,
        NO_UPDATE_NOTIFIER: "1",
      },
    });

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export interface InstalledEaiCommandExecConfig {
  readonly command: string;
  readonly args: string[];
  readonly shell: boolean;
}

export function buildInstalledEaiCommandExecConfig(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): InstalledEaiCommandExecConfig {
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "eai.cmd", ...args],
      shell: false,
    };
  }

  return {
    command: "eai",
    args: [...args],
    shell: false,
  };
}

export function runInstalledEaiCommand(args: readonly string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const config = buildInstalledEaiCommandExecConfig(args);
    const child = spawn(config.command, config.args, {
      stdio: "inherit",
      shell: config.shell,
      env: {
        ...process.env,
        NO_UPDATE_NOTIFIER: "1",
      },
    });

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
