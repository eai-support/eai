#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import producerVerifier from "./verify-managed-deploy-producer-pin.cjs";
import bundleIdentity from "./lib/gofer-bundle-identity.cjs";

const { goferResourceTreeSha256 } = bundleIdentity;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const GOFER_REPO = "https://github.com/eai-support/eai-gofer.git";
const TEMPLATE_REPO = "https://github.com/eai-support/eai-app-template.git";
const ENTERPRISE_SCOPE = "@enterpriseaigroup";
const GOFER_PIN_FILE = path.join(ROOT, ".gofer-version");
const GOFER_RESOURCES_TARGET = path.join(ROOT, "resources", "gofer");
const LINKED_SOURCES_FILE = path.join(ROOT, "resources", "linked-sources.json");
const PRODUCER_ROOT = path.join(ROOT, "resources", "deploy", "eai-app-template");
const GOFER_BASE_RESOURCE_DIR = path.join("extension", "resources");
export const GOFER_EXTRA_RESOURCE_MAPPINGS = [
  [".specify/config", "config"],
  [".specify/contracts", "contracts"],
  [".specify/commands", "commands"],
  [".specify/memory", "memory"],
  [".specify/references", "references"],
  [".specify/schemas", "schemas"],
  [".system/skills", "system-skills"],
  [".agents/skills", "agents-skills"],
  [".grok/skills", "grok-skills"],
];

export function extractEnterprisePackageVersions(lockfile) {
  const packageEntries = Object.entries(lockfile?.packages ?? {})
    .filter(([name, pkg]) => {
      return (
        name.startsWith(`node_modules/${ENTERPRISE_SCOPE}/`) &&
        pkg &&
        typeof pkg === "object" &&
        typeof pkg.version === "string"
      );
    })
    .sort(([left], [right]) => left.localeCompare(right));

  return Object.fromEntries(
    packageEntries.map(([name, pkg]) => {
      return [
        name.replace("node_modules/", ""),
        {
          version: pkg.version,
          resolved: typeof pkg.resolved === "string" ? pkg.resolved : null,
        },
      ];
    }),
  );
}

export function parseScopedRegistry(text, scope = ENTERPRISE_SCOPE) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const [key, ...valueParts] = line.split("=");
    if (key?.trim() !== `${scope}:registry`) {
      continue;
    }
    const value = valueParts.join("=").trim();
    return value || null;
  }

  return null;
}

export function hashJson(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
    ...options,
  }).trim();
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function cloneDefaultBranch(repo, workdir) {
  execFileSync("git", ["clone", "--depth", "1", repo, workdir], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

function resolveSha(workdir) {
  return run("git", ["-C", workdir, "rev-parse", "HEAD"]);
}

function resolveDescribe(workdir) {
  return run("git", ["-C", workdir, "describe", "--tags", "--always"]);
}

const RELEASE_TAG_REF = /^refs\/tags\/(v\d+\.\d+\.\d+)$/;

function compareReleaseTagsDesc(left, right) {
  const leftParts = left.slice(1).split(".").map(Number);
  const rightParts = right.slice(1).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return rightParts[index] - leftParts[index];
    }
  }
  return 0;
}

/**
 * Pick the highest `vX.Y.Z` release from `git ls-remote --tags` output.
 *
 * Segments are compared numerically, so v1.10.0 outranks v1.9.0. Peeled
 * annotated-tag refs (`refs/tags/v1.0.0^{}`) and any non-release tag are
 * ignored rather than treated as a candidate release.
 */
export function selectLatestReleaseTag(lsRemoteOutput) {
  const releases = [];
  for (const line of String(lsRemoteOutput ?? "").split(/\r?\n/)) {
    const ref = line.trim().split(/\s+/)[1];
    const match = ref ? RELEASE_TAG_REF.exec(ref) : null;
    if (match) {
      releases.push(match[1]);
    }
  }
  return releases.sort(compareReleaseTagsDesc)[0] ?? null;
}

/**
 * Check out the newest published template release.
 *
 * The template used to be pinned at whatever main happened to hold, which gave
 * a scaffolded app no release identity and let each consumer drift to its own
 * SHA. A missing release is a hard failure: silently falling back to main would
 * restore exactly the drift this pin exists to stop.
 */
function cloneLatestRelease(repo, workdir) {
  const tag = selectLatestReleaseTag(run("git", ["ls-remote", "--tags", repo]));
  if (!tag) {
    throw new Error(
      `${repo} has no vX.Y.Z release tag. Cut a template release before syncing linked sources.`,
    );
  }
  execFileSync("git", ["clone", "--depth", "1", "--branch", tag, repo, workdir], {
    cwd: ROOT,
    stdio: "inherit",
  });
  return tag;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function assertCrossPlatformTemplateLifecycleScripts(packageJson) {
  const lifecycleNames = [
    "preinstall",
    "install",
    "postinstall",
    "prepare",
    "prepack",
  ];
  const scripts = packageJson?.scripts ?? {};
  const unsafe = lifecycleNames.filter((name) => {
    const command = scripts[name];
    return (
      typeof command === "string" &&
      (/\bthen\b/.test(command) || /\bfi\b/.test(command) || /\[\s+[^\]]+\]/.test(command))
    );
  });
  if (unsafe.length > 0) {
    throw new Error(
      `eai-app-template contains shell-specific lifecycle scripts that cannot run on every supported operating system: ${unsafe.join(", ")}`,
    );
  }
}

function readGoferResourceMetadata() {
  const metadataPath = path.join(GOFER_RESOURCES_TARGET, ".gofer-version");
  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  try {
    const metadata = readJson(metadataPath);
    return typeof metadata?.commit === "string" ? metadata : null;
  } catch {
    return null;
  }
}

export function buildTemplateMetadata(workdir, version) {
  const packageJson = readJson(path.join(workdir, "package.json"));
  assertCrossPlatformTemplateLifecycleScripts(packageJson);
  const packageLockPath = path.join(workdir, "package-lock.json");
  const npmrcPath = path.join(workdir, ".npmrc");
  const packageLockText = fs.readFileSync(packageLockPath, "utf-8");
  const packageLock = JSON.parse(packageLockText);
  const enterprisePackages = extractEnterprisePackageVersions(packageLock);

  return {
    repo: TEMPLATE_REPO,
    version,
    commit: resolveSha(workdir),
    packageLockSha256: crypto
      .createHash("sha256")
      .update(packageLockText)
      .digest("hex"),
    enterpriseRegistry: fs.existsSync(npmrcPath)
      ? parseScopedRegistry(fs.readFileSync(npmrcPath, "utf-8"))
      : null,
    enterprisePackageFingerprint: hashJson(enterprisePackages),
    enterprisePackages,
  };
}

function copyDir(sourceDir, targetDir) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      copyDir(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function mirrorDirectory(sourceDir, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  copyDir(sourceDir, targetDir);
}

function syncDirectoryIfPresent(workdir, sourceRelativeDir, targetRelativeDir, targetRoot) {
  const sourceDir = path.join(workdir, sourceRelativeDir);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    return;
  }

  const targetDir = path.join(targetRoot, targetRelativeDir);
  fs.mkdirSync(targetDir, { recursive: true });
  copyDir(sourceDir, targetDir);
}

export function syncGoferResourcesFromCheckout(workdir, commit, describe, targetRoot = GOFER_RESOURCES_TARGET) {
  const version = readJson(path.join(workdir, "extension", "package.json")).version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("Gofer source must declare an exact extension package version.");
  }
  const sourceDir = path.join(workdir, GOFER_BASE_RESOURCE_DIR);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`gofer checkout is missing ${GOFER_BASE_RESOURCE_DIR}/`);
  }

  mirrorDirectory(sourceDir, targetRoot);
  for (const [
    sourceRelativeDir,
    targetRelativeDir,
  ] of GOFER_EXTRA_RESOURCE_MAPPINGS) {
    syncDirectoryIfPresent(workdir, sourceRelativeDir, targetRelativeDir, targetRoot);
  }

  const metadata = {
    commit,
    describe,
    version,
    source: `${GOFER_REPO}@${commit}`,
    dirty: false,
    resourceTreeSha256: goferResourceTreeSha256(targetRoot),
  };
  writeJson(path.join(targetRoot, ".gofer-version"), metadata);
  return metadata;
}

/** Capture the producer from the same immutable release as template metadata. */
export function buildManagedDeployProducerBundle(workdir, tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("Template producer requires a release tag.");
  const commit = resolveSha(workdir);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Template producer requires an exact source commit.");
  const taggedCommit = run("git", ["-C", workdir, "rev-parse", `refs/tags/${tag}^{commit}`]);
  if (taggedCommit !== commit) throw new Error("Template producer checkout must match its exact release tag.");
  const files = Object.fromEntries(Object.entries(producerVerifier.PRODUCER_FILES).map(([key, relative]) => {
    const bytes = execFileSync("git", ["-C", workdir, "show", `${commit}:${relative}`], {
      encoding: null, stdio: ["ignore", "pipe", "pipe"],
    });
    return [key, { path: relative, bytes, sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}` }];
  }));
  const pin = {
    schemaVersion: "eai.managed-deploy-producer-pin.v1",
    repository: "eai-support/eai-app-template",
    candidate: { commit, ...Object.fromEntries(Object.entries(files).map(([key, file]) => [key, { path: file.path, sha256: file.sha256 }])) },
    releaseGate: { status: "released", tag, commit },
    githubProducerIdentity: { profile: "github-environment-v1", templateCommitSha: commit, workflowSha256: files.workflow.sha256 },
  };
  producerVerifier.assertCanonicalProducerPaths(pin);
  producerVerifier.assertProducerIdentity(pin);
  producerVerifier.assertEnvironmentProducerWorkflow(files.workflow.bytes.toString("utf8"));
  producerVerifier.assertProducerDispatchInputs(files.workflow.bytes.toString("utf8"));
  return { pin, files };
}

export function writeManagedDeployProducerBundle(bundle, targetRoot = PRODUCER_ROOT) {
  for (const file of Object.values(bundle.files)) {
    const destination = path.join(targetRoot, file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, file.bytes);
  }
  writeJson(path.join(targetRoot, "producer-pin.json"), bundle.pin);
}

function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "eai-linked-sources-"));
  const goferDir = path.join(tmpRoot, "gofer");
  const templateDir = path.join(tmpRoot, "eai-app-template");

  try {
    console.log(`▸ Cloning ${GOFER_REPO}`);
    cloneDefaultBranch(GOFER_REPO, goferDir);
    console.log(`▸ Cloning latest ${TEMPLATE_REPO} release`);
    const templateVersion = cloneLatestRelease(TEMPLATE_REPO, templateDir);
    console.log(`▸ Template release ${templateVersion}`);

    const goferCommit = resolveSha(goferDir);
    const goferDescribe = resolveDescribe(goferDir);
    const stagedGofer = path.join(tmpRoot, "gofer-bundle");
    const goferMetadata = syncGoferResourcesFromCheckout(goferDir, goferCommit, goferDescribe, stagedGofer);
    const producerBundle = buildManagedDeployProducerBundle(templateDir, templateVersion);
    const nextManifest = {
      schemaVersion: 1,
      gofer: {
        repo: GOFER_REPO,
        commit: goferCommit,
        describe: goferDescribe,
        version: goferMetadata.version,
        resourceTreeSha256: goferMetadata.resourceTreeSha256,
      },
      appTemplate: buildTemplateMetadata(templateDir, templateVersion),
    };
    producerVerifier.assertLinkedTemplateRelease(producerBundle.pin, nextManifest);

    const currentManifest = fs.existsSync(LINKED_SOURCES_FILE)
      ? readJson(LINKED_SOURCES_FILE)
      : null;
    const currentGoferPin = fs.existsSync(GOFER_PIN_FILE)
      ? fs.readFileSync(GOFER_PIN_FILE, "utf-8").trim()
      : null;
    const currentGoferMetadata = readGoferResourceMetadata();

    const manifestChanged =
      JSON.stringify(currentManifest) !== JSON.stringify(nextManifest);
    const goferChanged = currentGoferPin !== goferCommit;
    const goferResourcesChanged = currentGoferMetadata?.commit !== goferCommit ||
      !fs.existsSync(GOFER_RESOURCES_TARGET) ||
      goferResourceTreeSha256(GOFER_RESOURCES_TARGET) !== goferMetadata.resourceTreeSha256 ||
      currentGoferMetadata.resourceTreeSha256 !== goferMetadata.resourceTreeSha256 ||
      currentGoferMetadata.version !== goferMetadata.version ||
      currentGoferMetadata.describe !== goferMetadata.describe ||
      currentGoferMetadata.source !== goferMetadata.source || currentGoferMetadata.dirty !== false;
    const producerChanged = !fs.existsSync(path.join(PRODUCER_ROOT, "producer-pin.json")) ||
      JSON.stringify(readJson(path.join(PRODUCER_ROOT, "producer-pin.json"))) !== JSON.stringify(producerBundle.pin) ||
      Object.values(producerBundle.files).some(file => !fs.existsSync(path.join(PRODUCER_ROOT, file.path)) ||
        !fs.readFileSync(path.join(PRODUCER_ROOT, file.path)).equals(file.bytes));

    if (!manifestChanged && !goferChanged && !goferResourcesChanged && !producerChanged) {
      console.log("✓ Linked sources already match upstream HEADs");
      return;
    }

    if (goferChanged) {
      fs.writeFileSync(GOFER_PIN_FILE, `${goferCommit}\n`);
      console.log(`▸ Updated .gofer-version → ${goferCommit}`);
    } else {
      console.log(`▸ Gofer pin already current at ${goferCommit}`);
    }

    if (goferChanged || goferResourcesChanged) {
      mirrorDirectory(stagedGofer, GOFER_RESOURCES_TARGET);
    }

    if (producerChanged) writeManagedDeployProducerBundle(producerBundle);

    writeJson(LINKED_SOURCES_FILE, nextManifest);
    console.log(`▸ Wrote ${path.relative(ROOT, LINKED_SOURCES_FILE)}`);
    console.log("✓ Linked source metadata refreshed");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

const entryFile = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === entryFile) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${message}`);
    process.exit(1);
  }
}
