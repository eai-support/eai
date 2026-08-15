#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const GOFER_REPO = "https://github.com/eai-support/eai-gofer.git";
const TEMPLATE_REPO = "https://github.com/eai-support/eai-app-template.git";
const ENTERPRISE_SCOPE = "@enterpriseaigroup";
const GOFER_PIN_FILE = path.join(ROOT, ".gofer-version");
const GOFER_RESOURCES_TARGET = path.join(ROOT, "resources", "gofer");
const LINKED_SOURCES_FILE = path.join(ROOT, "resources", "linked-sources.json");
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function readGoferResourceCommit() {
  const metadataPath = path.join(GOFER_RESOURCES_TARGET, ".gofer-version");
  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  try {
    const metadata = readJson(metadataPath);
    return typeof metadata?.commit === "string" ? metadata.commit : null;
  } catch {
    return null;
  }
}

function buildTemplateMetadata(workdir) {
  const packageLockPath = path.join(workdir, "package-lock.json");
  const npmrcPath = path.join(workdir, ".npmrc");
  const packageLockText = fs.readFileSync(packageLockPath, "utf-8");
  const packageLock = JSON.parse(packageLockText);
  const enterprisePackages = extractEnterprisePackageVersions(packageLock);

  return {
    repo: TEMPLATE_REPO,
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

function syncDirectoryIfPresent(workdir, sourceRelativeDir, targetRelativeDir) {
  const sourceDir = path.join(workdir, sourceRelativeDir);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    return;
  }

  const targetDir = path.join(GOFER_RESOURCES_TARGET, targetRelativeDir);
  fs.mkdirSync(targetDir, { recursive: true });
  copyDir(sourceDir, targetDir);
}

function syncGoferResourcesFromCheckout(workdir, commit, describe) {
  const sourceDir = path.join(workdir, GOFER_BASE_RESOURCE_DIR);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`gofer checkout is missing ${GOFER_BASE_RESOURCE_DIR}/`);
  }

  mirrorDirectory(sourceDir, GOFER_RESOURCES_TARGET);
  for (const [
    sourceRelativeDir,
    targetRelativeDir,
  ] of GOFER_EXTRA_RESOURCE_MAPPINGS) {
    syncDirectoryIfPresent(workdir, sourceRelativeDir, targetRelativeDir);
  }

  writeJson(path.join(GOFER_RESOURCES_TARGET, ".gofer-version"), {
    commit,
    describe,
  });
}

function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "eai-linked-sources-"));
  const goferDir = path.join(tmpRoot, "gofer");
  const templateDir = path.join(tmpRoot, "eai-app-template");

  try {
    console.log(`▸ Cloning ${GOFER_REPO}`);
    cloneDefaultBranch(GOFER_REPO, goferDir);
    console.log(`▸ Cloning ${TEMPLATE_REPO}`);
    cloneDefaultBranch(TEMPLATE_REPO, templateDir);

    const goferCommit = resolveSha(goferDir);
    const goferDescribe = resolveDescribe(goferDir);
    const nextManifest = {
      schemaVersion: 1,
      gofer: {
        repo: GOFER_REPO,
        commit: goferCommit,
        describe: goferDescribe,
      },
      appTemplate: buildTemplateMetadata(templateDir),
    };

    const currentManifest = fs.existsSync(LINKED_SOURCES_FILE)
      ? readJson(LINKED_SOURCES_FILE)
      : null;
    const currentGoferPin = fs.existsSync(GOFER_PIN_FILE)
      ? fs.readFileSync(GOFER_PIN_FILE, "utf-8").trim()
      : null;
    const currentGoferResourceCommit = readGoferResourceCommit();

    const manifestChanged =
      JSON.stringify(currentManifest) !== JSON.stringify(nextManifest);
    const goferChanged = currentGoferPin !== goferCommit;
    const goferResourcesChanged = currentGoferResourceCommit !== goferCommit;

    if (!manifestChanged && !goferChanged && !goferResourcesChanged) {
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
      syncGoferResourcesFromCheckout(goferDir, goferCommit, goferDescribe);
    }

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
