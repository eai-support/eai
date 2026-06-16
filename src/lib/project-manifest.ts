import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

export const PROJECT_MANIFEST_RELATIVE_PATH = ".eai-manifest.json";
const DEFAULT_TEMPLATE_REPO =
  "https://github.com/eai-tools/eai-app-template.git";
const DEFAULT_TEMPLATE_REPO_NAME = "eai-app-template";
const execFileAsync = promisify(execFile);

export interface GoferManagedFileState {
  readonly sha256: string;
  readonly source: "bundled" | "generated";
}

export interface ProjectManifest {
  readonly schemaVersion: 1;
  readonly cli?: {
    readonly version: string;
  };
  readonly packages?: {
    readonly profile: "external" | "internal" | "hybrid";
    readonly source?: "eai-packages" | "enterpriseai-packages";
    readonly recordedAt?: string;
  };
  readonly template?: {
    readonly repo?: string;
    readonly commit?: string;
    readonly displaySource?: string;
    readonly initializedAt?: string;
  };
  readonly gofer?: {
    readonly bundle?: {
      readonly commit?: string;
      readonly describe?: string;
      readonly syncedAt?: string;
    };
    readonly managedFiles: Record<string, GoferManagedFileState>;
    readonly refreshedAt?: string;
  };
}

export type ProjectManifestSource =
  | "file"
  | "inferred-init-commit"
  | "inferred-project-structure"
  | "none";

export interface ResolvedProjectManifest {
  readonly manifest: ProjectManifest | null;
  readonly source: ProjectManifestSource;
}

export function getProjectManifestPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MANIFEST_RELATIVE_PATH);
}

export async function loadProjectManifest(
  projectRoot: string,
): Promise<ProjectManifest | null> {
  try {
    const raw = await readFile(getProjectManifestPath(projectRoot), "utf-8");
    return JSON.parse(raw) as ProjectManifest;
  } catch {
    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function coerceTemplateRepoFromDisplaySource(displaySource: string): {
  repo: string;
  commit?: string;
} {
  const trimmed = displaySource.trim();
  const defaultMatch = trimmed.match(
    new RegExp(
      `^(eai-tools\\/${DEFAULT_TEMPLATE_REPO_NAME})(?:@([0-9a-f]{7,40}))?$`,
      "i",
    ),
  );
  if (defaultMatch) {
    return {
      repo: DEFAULT_TEMPLATE_REPO,
      commit: defaultMatch[2],
    };
  }

  const githubUrlMatch = trimmed.match(
    /^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?(?:@([0-9a-f]{7,40}))?$/i,
  );
  if (githubUrlMatch?.[1]) {
    return {
      repo: `https://github.com/${githubUrlMatch[1].replace(/\/+$/, "")}.git`,
      commit: githubUrlMatch[2],
    };
  }

  const githubLabelMatch = trimmed.match(
    /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:@([0-9a-f]{7,40}))?$/,
  );
  if (githubLabelMatch?.[1]) {
    return {
      repo: `https://github.com/${githubLabelMatch[1]}.git`,
      commit: githubLabelMatch[2],
    };
  }

  return { repo: trimmed };
}

async function inferManifestFromLegacyInitCommit(
  projectRoot: string,
): Promise<ProjectManifest | null> {
  try {
    const { stdout: rootCommitStdout } = await execFileAsync(
      "git",
      ["rev-list", "--max-parents=0", "HEAD"],
      {
        cwd: projectRoot,
      },
    );
    const rootCommit = rootCommitStdout.trim().split(/\s+/)[0];
    if (!rootCommit) {
      return null;
    }

    const { stdout: metadataStdout } = await execFileAsync(
      "git",
      ["show", "-s", "--format=%B%x00%cI", rootCommit],
      { cwd: projectRoot },
    );
    const [message = "", committedAt = ""] = metadataStdout.split("\0");
    if (
      !/Initial scaffold from template/i.test(message) ||
      !/Created by:\s*eai init/i.test(message)
    ) {
      return null;
    }

    const templateLine = message
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("Template:"));
    if (!templateLine) {
      return null;
    }

    const displaySource = templateLine.replace(/^Template:\s*/, "").trim();
    if (!displaySource) {
      return null;
    }

    const template = coerceTemplateRepoFromDisplaySource(displaySource);
    return {
      schemaVersion: 1,
      template: {
        ...template,
        displaySource,
        initializedAt: committedAt || undefined,
      },
    };
  } catch {
    return null;
  }
}

async function inferManifestFromLegacyProjectStructure(
  projectRoot: string,
): Promise<ProjectManifest | null> {
  const [
    hasObjectTypes,
    hasTenantConfig,
    hasSpecifyDir,
    hasClaudeConfig,
    hasGeminiConfig,
    hasClaudeDoc,
  ] = await Promise.all([
    fileExists(join(projectRoot, "src", "eai.config", "object-types.ts")),
    fileExists(join(projectRoot, "src", "eai.config", "default.ts")),
    fileExists(join(projectRoot, ".specify")),
    fileExists(join(projectRoot, ".claude")),
    fileExists(join(projectRoot, ".gemini")),
    fileExists(join(projectRoot, "CLAUDE.md")),
  ]);

  if (!hasObjectTypes) {
    return null;
  }

  try {
    const pkg = JSON.parse(
      await readFile(join(projectRoot, "package.json"), "utf-8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDependencies = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    const hasEaiDependencies = Boolean(
      allDependencies["@enterpriseaigroup/core"] ||
      allDependencies["@enterpriseaigroup/demo"] ||
      allDependencies["@enterpriseaigroup/platform-sdk"] ||
      allDependencies["@eai-tools/core"] ||
      allDependencies["@eai-tools/platform-sdk"],
    );

    if (
      !(
        hasEaiDependencies ||
        hasTenantConfig ||
        hasSpecifyDir ||
        hasClaudeConfig ||
        hasGeminiConfig ||
        hasClaudeDoc
      )
    ) {
      return null;
    }

    return {
      schemaVersion: 1,
      template: {
        repo: DEFAULT_TEMPLATE_REPO,
        displaySource: "eai-tools/eai-app-template (legacy scaffold inferred)",
      },
    };
  } catch {
    return null;
  }
}

export async function resolveProjectManifest(
  projectRoot: string,
): Promise<ResolvedProjectManifest> {
  const manifest = await loadProjectManifest(projectRoot);
  if (manifest?.template) {
    return {
      manifest,
      source: "file",
    };
  }

  const initCommitManifest =
    await inferManifestFromLegacyInitCommit(projectRoot);
  if (initCommitManifest) {
    return {
      manifest: manifest
        ? {
            ...manifest,
            template: initCommitManifest.template,
          }
        : initCommitManifest,
      source: "inferred-init-commit",
    };
  }

  const structureManifest =
    await inferManifestFromLegacyProjectStructure(projectRoot);
  if (structureManifest) {
    return {
      manifest: manifest
        ? {
            ...manifest,
            template: structureManifest.template,
          }
        : structureManifest,
      source: "inferred-project-structure",
    };
  }

  if (manifest) {
    return {
      manifest,
      source: "file",
    };
  }

  return {
    manifest: null,
    source: "none",
  };
}

export async function saveProjectManifest(
  projectRoot: string,
  manifest: ProjectManifest,
): Promise<void> {
  const manifestPath = getProjectManifestPath(projectRoot);
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
}

export async function updateProjectManifest(
  projectRoot: string,
  updater: (current: ProjectManifest | null) => ProjectManifest,
): Promise<ProjectManifest> {
  const next = updater(await loadProjectManifest(projectRoot));
  await saveProjectManifest(projectRoot, next);
  return next;
}
