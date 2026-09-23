import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { findProjectRoot } from "./config.js";

const exec = promisify(execFile);
const MAX_DIFF_BYTES = 32_000;
const MAX_TOTAL_DIFF_BYTES = 512_000;
const MAX_TEXT_FILE_BYTES = 256_000;

export type TemplateCapabilityCategory =
  | "platform"
  | "authentication"
  | "runtime"
  | "data"
  | "deployment"
  | "tooling"
  | "presentation"
  | "general";

export type TemplateAdoptionDecision =
  | "safe-add"
  | "semantic-merge"
  | "preserve-existing"
  | "already-present"
  | "blocked";

export interface TemplateAssessmentRoot {
  readonly root: string;
  readonly kind: "eai-project" | "git-package" | "git-repository" | "package";
}

export interface TemplateAiSourceItem {
  readonly relativePath: string;
  readonly state: "missing" | "modified" | "unchanged" | "blocked-symlink";
}

interface PackageDocument {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly packageManager?: string;
}

interface RepositoryInventory {
  readonly frameworks: readonly string[];
  readonly packageManager: string | null;
  readonly scripts: readonly string[];
  readonly designSystems: readonly string[];
  readonly uiRoots: readonly string[];
  readonly git: {
    readonly head: string | null;
    readonly dirty: boolean | null;
  };
}

interface TemplateAiDiff {
  readonly kind: "unified" | "omitted-binary" | "omitted-size" | "omitted-budget" | "none";
  readonly text?: string;
  readonly truncated: boolean;
}

interface TemplateAiOperation {
  readonly path: string;
  readonly state: TemplateAiSourceItem["state"];
  readonly decision: TemplateAdoptionDecision;
  readonly fileRole: "integration" | "configuration" | "test" | "documentation" | "presentation";
  readonly confidence: "high" | "medium";
  readonly risk: "low" | "medium" | "high";
  readonly purpose: string;
  readonly instructions: readonly string[];
  readonly companions: readonly string[];
  readonly projectSha256: string | null;
  readonly templateSha256: string;
  readonly diff: TemplateAiDiff;
}

interface TemplateAiCapability {
  readonly id: string;
  readonly category: TemplateCapabilityCategory;
  readonly purpose: string;
  readonly dependencies: readonly string[];
  readonly operations: readonly TemplateAiOperation[];
  readonly validation: readonly { readonly command: string; readonly purpose: string }[];
}

export interface TemplateAiPlan {
  readonly schemaVersion: "eai.template-ai-plan.v1";
  readonly mode: "ai-plan";
  readonly generatedAt: string;
  readonly readOnly: true;
  readonly policy: {
    readonly preserveUi: boolean;
    readonly allowAutomaticWrites: false;
    readonly rules: readonly string[];
  };
  readonly project: {
    readonly root: ".";
    readonly kind: TemplateAssessmentRoot["kind"];
    readonly provenance: "recorded-template" | "inferred-template" | "unbased-adoption";
    readonly inventory: RepositoryInventory;
  };
  readonly template: {
    readonly repo: string;
    readonly ref: string;
    readonly commit: string | null;
    readonly policySource: "cli-built-in-v1";
  };
  readonly summary: Readonly<Record<TemplateAdoptionDecision, number>>;
  readonly capabilities: readonly TemplateAiCapability[];
  readonly safeguards: readonly string[];
  readonly nextSteps: readonly {
    readonly order: number;
    readonly capabilityId: string;
    readonly action: string;
  }[];
}

interface CapabilityPolicy {
  readonly id: string;
  readonly category: TemplateCapabilityCategory;
  readonly purpose: string;
  readonly dependencies: readonly string[];
}

const POLICIES: readonly CapabilityPolicy[] = [
  { id: "tooling", category: "tooling", purpose: "Merge required packages, scripts, compiler settings, and developer checks.", dependencies: [] },
  { id: "platform-runtime", category: "runtime", purpose: "Configure the EAI application runtime, environment contract, and framework integration.", dependencies: ["tooling"] },
  { id: "platform-sdk", category: "platform", purpose: "Provide typed EAI clients, errors, resource routing, and service modules.", dependencies: ["platform-runtime"] },
  { id: "authentication-session", category: "authentication", purpose: "Connect EAI sign-in, server sessions, and protected access.", dependencies: ["platform-runtime", "platform-sdk"] },
  { id: "public-api-bff", category: "platform", purpose: "Route authenticated server requests to EAI PublicAPI with tenant context.", dependencies: ["authentication-session", "platform-runtime", "platform-sdk"] },
  { id: "tenant-data", category: "data", purpose: "Define tenant configuration, object types, storage, and typed resource access.", dependencies: ["platform-sdk", "public-api-bff"] },
  { id: "workflow-runtime", category: "runtime", purpose: "Support generated workflows, submissions, documents, and assistant interactions.", dependencies: ["tenant-data", "public-api-bff"] },
  { id: "readiness", category: "runtime", purpose: "Expose local and deployed checks for EAI runtime readiness.", dependencies: ["platform-runtime", "public-api-bff"] },
  { id: "deployment", category: "deployment", purpose: "Describe and validate the portable EAI deployment contract.", dependencies: ["readiness"] },
  { id: "presentation", category: "presentation", purpose: "Reference presentation patterns without replacing the existing experience.", dependencies: [] },
  { id: "general", category: "general", purpose: "Review supporting template material that has no platform-specific classification.", dependencies: [] },
];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function nearestPackageRoot(from: string, boundary?: string): Promise<string | null> {
  let current = resolve(from);
  const stop = boundary ? resolve(boundary) : resolve("/");
  while (!boundary || current === stop || !relative(stop, current).startsWith("..")) {
    if (await exists(join(current, "package.json"))) return current;
    if (current === stop || current === dirname(current)) break;
    current = dirname(current);
  }
  return null;
}

export async function resolveTemplateAssessmentRoot(
  from = process.cwd(),
): Promise<TemplateAssessmentRoot | null> {
  const canonicalFrom = await realpath(from);
  const eaiRoot = await findProjectRoot(canonicalFrom);
  if (eaiRoot) return { root: await realpath(eaiRoot), kind: "eai-project" };

  const gitRoot = await (async (): Promise<string | null> => {
    try {
      const result = await exec("git", ["-C", canonicalFrom, "rev-parse", "--show-toplevel"]);
      return await realpath(result.stdout.trim());
    } catch {
      return null;
    }
  })();

  if (gitRoot) {
    const packageRoot = await nearestPackageRoot(canonicalFrom, gitRoot);
    return packageRoot
      ? { root: await realpath(packageRoot), kind: "git-package" }
      : { root: gitRoot, kind: "git-repository" };
  }

  const packageRoot = await nearestPackageRoot(canonicalFrom);
  return packageRoot
    ? { root: await realpath(packageRoot), kind: "package" }
    : null;
}

function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

function isPresentationPath(path: string): boolean {
  if (/^(?:src\/)?app\/api\//.test(path)) return false;
  return (
    /^(?:src\/)?components\//.test(path) ||
    /^(?:src\/)?app\/(?:.*\/)?(?:page|layout)\.(?:tsx?|jsx?)$/.test(path) ||
    /\.(?:css|scss|sass|less)$/.test(path) ||
    /^(?:public|assets)\//.test(path) ||
    /favicon\./.test(path)
  );
}

function policyForPath(path: string): CapabilityPolicy {
  const find = (id: string): CapabilityPolicy => POLICIES.find((item) => item.id === id)!;
  if (isPresentationPath(path)) return find("presentation");
  if (/^(?:eai\.runtime\.json|next\.config\.|\.env\.example)/.test(path)) return find("platform-runtime");
  if (/^(?:src\/)?auth\.ts$|^src\/app\/api\/auth\/|session-resolve|middleware\.ts$/.test(path)) return find("authentication-session");
  if (/^src\/app\/api\/eai\/\[\[\.\.\.rest\]\]|publicapi-|api-helpers/.test(path)) return find("public-api-bff");
  if (/^packages\/platform-sdk\//.test(path)) return find("platform-sdk");
  if (/^src\/eai\.config\/|use(?:Resources|Documents|Chat)|seed-object-types|storage-provisioning|schema-provenance/.test(path)) return find("tenant-data");
  if (/generated-workflow|workflow-(?:assistant|submissions)/.test(path)) return find("workflow-runtime");
  if (/readiness|(?:^|\/)health\//.test(path)) return find("readiness");
  if (/^\.github\/workflows\/eai-app\.yml$|deployment-contract|source-unknown-deployment|^eai\.runtime\.json$/.test(path)) return find("deployment");
  if (/^(?:package(?:-lock)?\.json|tsconfig\.json|next\.config\.|eslint\.config\.|jest\.|playwright\.|run\.)/.test(path)) return find("tooling");
  return find("general");
}

function roleForPath(path: string, policy: CapabilityPolicy): TemplateAiOperation["fileRole"] {
  if (policy.category === "presentation") return "presentation";
  if (/\.(?:test|spec)\.|^tests\//.test(path)) return "test";
  if (/^(?:README|docs\/)|\.md$/.test(path)) return "documentation";
  if (/config|package|runtime|\.ya?ml$|\.json$/.test(path)) return "configuration";
  return "integration";
}

function decisionFor(
  item: TemplateAiSourceItem,
  policy: CapabilityPolicy,
  preserveUi: boolean,
  frameworkCompatible: boolean,
): TemplateAdoptionDecision {
  if (item.state === "unchanged") return "already-present";
  if (item.state === "blocked-symlink") return "blocked";
  if (policy.category === "presentation" && preserveUi) return "preserve-existing";
  if (
    !frameworkCompatible &&
    !["presentation", "tooling", "general"].includes(policy.category)
  ) return "blocked";
  if (item.state === "missing" && !["tooling", "data", "deployment"].includes(policy.category)) return "safe-add";
  return "semantic-merge";
}

function instructionsFor(
  item: TemplateAiSourceItem,
  policy: CapabilityPolicy,
  decision: TemplateAdoptionDecision,
): string[] {
  if (decision === "preserve-existing") {
    return [
      "Keep the repository's layout, styles, tokens, content, components, and interaction patterns.",
      "Use this template file only as a behavior reference. Connect EAI through existing UI boundaries.",
    ];
  }
  if (decision === "blocked") {
    return item.state === "blocked-symlink"
      ? [
          "Inspect this symbolic link and its target before planning any adoption.",
          "Do not read, replace, or follow a path that can escape the assessed repository.",
        ]
      : [
          "Do not copy this Next.js implementation into an incompatible framework.",
          "Design a framework-native adapter that satisfies the same EAI capability contract.",
        ];
  }
  if (decision === "safe-add") {
    return [
      "Add this nonvisual integration file with its companion capability prerequisites.",
      "Resolve route, import, and framework collisions before committing the addition.",
    ];
  }
  if (decision === "semantic-merge") {
    return [
      "Merge the required keys and behavior into the existing file. Do not replace the whole file.",
      policy.category === "authentication"
        ? "Preserve any stricter existing access and session rules."
        : "Preserve project-specific configuration and unrelated behavior.",
    ];
  }
  return ["No file change is required. Verify that the existing behavior still satisfies the capability contract."];
}

async function boundedDiff(
  projectPath: string,
  templatePath: string,
  relativePath: string,
  state: TemplateAiSourceItem["state"],
  remainingBudget: number,
): Promise<TemplateAiDiff> {
  if (state === "unchanged") return { kind: "none", truncated: false };
  if (state === "blocked-symlink") return { kind: "none", truncated: false };
  if (remainingBudget <= 0) return { kind: "omitted-budget", truncated: true };
  const template = await readFile(templatePath);
  const project = state === "missing" ? Buffer.alloc(0) : await readFile(projectPath);
  if (template.includes(0) || project.includes(0)) return { kind: "omitted-binary", truncated: false };
  if (template.byteLength > MAX_TEXT_FILE_BYTES || project.byteLength > MAX_TEXT_FILE_BYTES) {
    return { kind: "omitted-size", truncated: false };
  }

  let text: string;
  if (state === "missing") {
    const lines = template.toString("utf-8").split("\n");
    text = [`--- a/${relativePath}`, `+++ b/${relativePath}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join("\n");
  } else {
    try {
      await exec("git", ["diff", "--no-index", "--no-ext-diff", "--unified=3", "--", projectPath, templatePath], { maxBuffer: 2_000_000 });
      text = "";
    } catch (error) {
      const stdout = typeof error === "object" && error && "stdout" in error ? String(error.stdout) : "";
      const hunk = stdout.indexOf("@@");
      const proposedLines = hunk >= 0
        ? stdout.slice(hunk).split("\n").filter((line) => line.startsWith("@@") || (line.startsWith("+") && !line.startsWith("+++")))
        : [];
      text = [`--- existing/${relativePath} (contents withheld)`, `+++ template/${relativePath}`, ...proposedLines].join("\n").trimEnd();
    }
  }

  const encoded = Buffer.from(text, "utf-8");
  const limit = Math.min(MAX_DIFF_BYTES, remainingBudget);
  const truncated = encoded.byteLength > limit;
  return {
    kind: "unified",
    text: truncated ? encoded.subarray(0, limit).toString("utf-8") : text,
    truncated,
  };
}

async function readPackage(path: string): Promise<PackageDocument | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as PackageDocument;
  } catch {
    return null;
  }
}

async function inventoryRepository(root: string): Promise<RepositoryInventory> {
  const pkg = await readPackage(join(root, "package.json"));
  const dependencies = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const frameworks = ["next", "react", "vue", "nuxt", "svelte", "@angular/core"].filter((name) => dependencies[name]);
  const designSystems = ["tailwindcss", "@mui/material", "@chakra-ui/react", "antd", "shadcn"].filter((name) => dependencies[name]);
  const uiRoots = (await Promise.all(["src/app", "app", "src/components", "components", "src/pages", "pages"].map(async (path) => (await exists(join(root, path)) ? path : null)))).filter((path): path is string => Boolean(path));
  let packageManager = pkg?.packageManager?.split("@")[0] ?? null;
  if (!packageManager) {
    if (await exists(join(root, "pnpm-lock.yaml"))) packageManager = "pnpm";
    else if (await exists(join(root, "yarn.lock"))) packageManager = "yarn";
    else if (await exists(join(root, "package-lock.json"))) packageManager = "npm";
  }
  const git = await (async (): Promise<RepositoryInventory["git"]> => {
    try {
      const head = (await exec("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
      const dirty = Boolean((await exec("git", ["-C", root, "status", "--porcelain"])).stdout.trim());
      return { head, dirty };
    } catch {
      return { head: null, dirty: null };
    }
  })();
  return {
    frameworks,
    packageManager,
    scripts: Object.keys(pkg?.scripts ?? {}).sort(),
    designSystems,
    uiRoots,
    git,
  };
}

function validationFor(policy: CapabilityPolicy, scripts: readonly string[], packageManager: string | null): { command: string; purpose: string }[] {
  const validations: { command: string; purpose: string }[] = [];
  const runner = packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : "npm run";
  if (scripts.includes("typecheck")) validations.push({ command: `${runner} typecheck`, purpose: "Check merged types and server/client boundaries." });
  if (scripts.includes("test")) validations.push({ command: `${runner} test`, purpose: `Verify the ${policy.id} behavior and existing regressions.` });
  if (scripts.includes("build")) validations.push({ command: `${runner} build`, purpose: "Verify the production application build." });
  return validations;
}

function safeTemplateIdentifier(source: string): string {
  try {
    const parsed = new URL(source);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "custom-template-source";
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "custom-template-source";
  }
}

export async function buildTemplateAiPlan(options: {
  readonly assessment: TemplateAssessmentRoot;
  readonly templateRoot: string;
  readonly templateRepo: string;
  readonly templateRef: string;
  readonly templateCommit: string | null;
  readonly provenance: TemplateAiPlan["project"]["provenance"];
  readonly items: readonly TemplateAiSourceItem[];
  readonly preserveUi: boolean;
}): Promise<TemplateAiPlan> {
  const inventory = await inventoryRepository(options.assessment.root);
  const frameworkCompatible =
    options.assessment.kind === "eai-project" || inventory.frameworks.includes("next");
  const grouped = new Map<string, TemplateAiOperation[]>();
  let remainingDiffBudget = MAX_TOTAL_DIFF_BYTES;

  for (const item of [...options.items].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    const policy = policyForPath(item.relativePath);
    const decision = decisionFor(
      item,
      policy,
      options.preserveUi,
      frameworkCompatible,
    );
    const templatePath = join(options.templateRoot, item.relativePath);
    const projectPath = join(options.assessment.root, item.relativePath);
    const templateContents = await readFile(templatePath);
    const projectContents = item.state === "missing" || item.state === "blocked-symlink"
      ? null
      : await readFile(projectPath);
    const diff = await boundedDiff(
      projectPath,
      templatePath,
      item.relativePath,
      item.state,
      remainingDiffBudget,
    );
    remainingDiffBudget -= Buffer.byteLength(diff.text ?? "", "utf-8");
    const operation: TemplateAiOperation = {
      path: item.relativePath,
      state: item.state,
      decision,
      fileRole: roleForPath(item.relativePath, policy),
      confidence: "medium",
      risk: policy.category === "presentation" || policy.category === "authentication" ? "high" : decision === "safe-add" ? "low" : "medium",
      purpose: policy.purpose,
      instructions: instructionsFor(item, policy, decision),
      companions: policy.dependencies,
      projectSha256: projectContents ? sha256(projectContents) : null,
      templateSha256: sha256(templateContents),
      diff,
    };
    grouped.set(policy.id, [...(grouped.get(policy.id) ?? []), operation]);
  }

  const capabilities = POLICIES
    .filter((policy) => grouped.has(policy.id))
    .map((policy): TemplateAiCapability => ({
      id: policy.id,
      category: policy.category,
      purpose: policy.purpose,
      dependencies: policy.dependencies,
      operations: grouped.get(policy.id)!,
      validation: validationFor(policy, inventory.scripts, inventory.packageManager),
    }));
  const summary: Record<TemplateAdoptionDecision, number> = {
    "safe-add": 0,
    "semantic-merge": 0,
    "preserve-existing": 0,
    "already-present": 0,
    "blocked": 0,
  };
  for (const capability of capabilities) {
    for (const operation of capability.operations) summary[operation.decision] += 1;
  }

  const activeCapabilities = capabilities.filter((capability) => capability.id !== "presentation");
  return {
    schemaVersion: "eai.template-ai-plan.v1",
    mode: "ai-plan",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    policy: {
      preserveUi: options.preserveUi,
      allowAutomaticWrites: false,
      rules: [
        "Keep existing layout, styles, design tokens, content, components, and interaction patterns.",
        "Use template presentation files as references only when UI preservation is active.",
        "Add platform capabilities in dependency order and validate after each capability.",
        "Do not copy secrets or environment values from either repository.",
        "Require human review before any repository write.",
      ],
    },
    project: {
      root: ".",
      kind: options.assessment.kind,
      provenance: options.provenance,
      inventory,
    },
    template: {
      repo: safeTemplateIdentifier(options.templateRepo),
      ref: options.templateRef,
      commit: options.templateCommit,
      policySource: "cli-built-in-v1",
    },
    summary,
    capabilities,
    safeguards: [
      "This plan is advisory and read-only.",
      "Bounded diffs omit binary files and text files larger than 256 KiB.",
      "The total emitted diff budget is 512 KiB. Hashes remain available when later diffs are omitted.",
      "A safe-add decision still requires its listed capability dependencies and repository validation.",
      "Authentication changes must preserve stricter existing access controls.",
      "Stored EAI object-type slugs remain authoritative and must not be regenerated from display names.",
    ],
    nextSteps: activeCapabilities.map((capability, index) => ({
      order: index + 1,
      capabilityId: capability.id,
      action: `Review ${capability.id} operations, satisfy ${capability.dependencies.length ? capability.dependencies.join(", ") : "repository prerequisites"}, then run the listed validation.`,
    })),
  };
}
