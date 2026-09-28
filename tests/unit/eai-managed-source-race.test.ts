import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, type PathLike } from "node:fs";
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test, vi } from "vitest";

const race = vi.hoisted(() => ({
  trigger: "",
  fifoTrigger: "",
  inventoryTrigger: "",
  realpathTrigger: "",
  readTrigger: "",
  boundedReadTrigger: "",
  pathReadTrigger: "",
  addTrigger: "",
  addPath: "",
  addContent: "",
  added: false,
  target: "",
  replacement: "",
  displaced: "",
  swapped: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    realpath: async (path: PathLike) => {
      if (!race.swapped && String(path) === race.realpathTrigger) {
        race.swapped = true;
        await actual.rename(race.target, race.displaced);
        await actual.rename(race.replacement, race.target);
      }
      return actual.realpath(path);
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (!race.swapped && String(args[0]) === race.pathReadTrigger) {
        race.swapped = true;
        await actual.rename(race.target, race.displaced);
        await actual.rename(race.replacement, race.target);
      }
      return actual.readFile(...args);
    },
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      if (!race.swapped && String(args[0]) === race.inventoryTrigger) {
        race.swapped = true;
        await actual.rename(race.target, race.displaced);
        await actual.symlink(race.replacement, race.target, "dir");
      }
      return actual.readdir(...args);
    },
    open: async (path: PathLike, flags: string | number, mode?: number) => {
      if (String(path) === race.fifoTrigger && !race.swapped) {
        expect(Number(flags) & constants.O_NONBLOCK).not.toBe(0);
        race.swapped = true;
        await actual.rm(path);
        await new Promise<void>((resolve, reject) => execFile("mkfifo", [String(path)], error => error ? reject(error) : resolve()));
      }
      const stagedFor = (target: string): boolean => !!target
        && dirname(String(path)) === dirname(target)
        && basename(String(path)).startsWith(".eai-write-");
      if (!race.added && (String(path) === race.addTrigger || stagedFor(race.addTrigger))) {
        race.added = true;
        await actual.writeFile(race.addPath, race.addContent);
      }
      if (!race.swapped && (String(path) === race.trigger || stagedFor(race.trigger))) {
        race.swapped = true;
        await actual.rename(race.target, race.displaced);
        await actual.rename(race.replacement, race.target);
      }
      const handle = await actual.open(path, flags, mode);
      if (String(path) === race.boundedReadTrigger) {
        const originalRead = handle.read.bind(handle);
        handle.read = (async (...args: Parameters<typeof handle.read>) => {
          expect((args[0] as Buffer).byteLength).toBeLessThanOrEqual(64 * 1024);
          return originalRead(...args);
        }) as typeof handle.read;
      }
      if (String(path) === race.readTrigger) {
        const originalRead = handle.read.bind(handle);
        const originalReadFile = handle.readFile.bind(handle);
        const swapAfterRead = async (): Promise<void> => {
          if (race.swapped) return;
          race.swapped = true;
          await actual.rename(race.target, race.displaced);
          await actual.rename(race.replacement, race.target);
        };
        handle.read = (async (...args: Parameters<typeof handle.read>) => {
          const result = await originalRead(...args);
          await swapAfterRead();
          return result;
        }) as typeof handle.read;
        handle.readFile = (async (...args: Parameters<typeof handle.readFile>) => {
          const result = await originalReadFile(...args);
          await swapAfterRead();
          return result;
        }) as typeof handle.readFile;
      }
      return handle;
    },
  };
});

import { buildManagedDeployConfigHash, installCanonicalManagedDeployFiles } from "../../src/lib/eai-managed-deploy-files.js";
import {
  assertOpenedRegularTarget,
  readPrivateFileNoFollow,
  writePrivateFileNoFollow,
  writeBoundRegularFile,
  writeManagedDeployEvidence,
} from "../../src/lib/eai-managed-deploy-filesystem.js";
import {
  claimManagedDeployDispatch,
  saveManagedDeployState,
} from "../../src/lib/eai-managed-deploy-state.js";
import type { ManagedDeployState } from "../../src/lib/eai-managed-deploy-contract.js";
import { readSourceUnknownEvidenceFile } from "../../src/lib/source-unknown-evidence-file.js";
import { bindManagedProjectRoot } from "../../src/lib/eai-managed-root-binding.js";
import {
  buildCliManagedSourceBundle,
  writeCliManagedSourceReceipt,
  type CliManagedSourceBundle,
} from "../../src/lib/eai-managed-source.js";

const exec = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  race.target = "";
  race.fifoTrigger = "";
  race.inventoryTrigger = "";
  race.trigger = "";
  race.realpathTrigger = "";
  race.readTrigger = "";
  race.boundedReadTrigger = "";
  race.pathReadTrigger = "";
  race.addTrigger = "";
  race.addPath = "";
  race.addContent = "";
  race.added = false;
  race.replacement = "";
  race.displaced = "";
  race.swapped = false;
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

function retryState(): ManagedDeployState {
  return {
    schema: "eai.managed-deploy-state.v1",
    tenantId: "tenant-1",
    targetTenantId: "tenant-1",
    appKey: "planning-portal",
    operationId: "source-unknown-parent-race",
    nonce: "one-time-nonce",
    repo: "enterprise/planning-portal",
    branch: "main",
    ref: "refs/heads/main",
    commitSha: "a".repeat(40),
    workflowPath: ".github/workflows/eai-app.yml",
    configHash: `sha256:${"b".repeat(64)}`,
    environment: "preview",
    installationId: 123,
    actorId: "eai-user-oid",
    githubLinkSessionId: "github-link-123",
    githubUserId: 456,
    githubLogin: "linked-user",
    githubProofId: "proof-123",
    publicApiUrl: "https://test-api.au.myenterprise.ai/public",
  };
}

test("rejects a source file replaced between metadata check and no-follow open", async () => {
  const root = await mkdtemp(join(tmpdir(), "cli-managed-source-race-"));
  const outside = await mkdtemp(
    join(tmpdir(), "cli-managed-source-replacement-"),
  );
  cleanup.push(root, outside);
  await put(
    root,
    ".eai-manifest.json",
    JSON.stringify({ template: { commit: "a".repeat(40) } }),
  );
  await put(root, "package.json", '{"name":"fixture","private":true}\n');
  await put(root, "eai.config.ts", "export default {};\n");
  await put(root, "eai.runtime.json", '{"schemaVersion":1}\n');
  await put(root, "src/app/page.tsx", "export default function Page() {}\n");
  await exec("git", ["init", "--quiet"], { cwd: root });
  await exec("git", ["add", "."], { cwd: root });
  await exec(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "Initial scaffold from template\n\nCreated by: eai init",
    ],
    { cwd: root },
  );

  const canonicalRoot = await realpath(root);
  race.target = join(canonicalRoot, "src/app/page.tsx");
  race.trigger = race.target;
  race.displaced = join(canonicalRoot, "src/app/page.original.tsx");
  race.replacement = join(outside, "page.tsx");
  await writeFile(race.replacement, "export default function Replaced() {}\n");

  await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({
    code: "SOURCE_CHANGED_DURING_READ",
  });
  expect(race.swapped).toBe(true);
});

test("does not report a replaced canonical target symlink as unchanged", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-install-match-race-")));
  const outside = await realpath(await mkdtemp(join(tmpdir(), "managed-install-match-outside-")));
  cleanup.push(root, outside);
  await installCanonicalManagedDeployFiles(root);
  const target = join(root, ".github/workflows/eai-app.yml");
  const identical = join(outside, "canonical-workflow.yml");
  const replacement = join(outside, "replacement-link");
  await writeFile(identical, await readFile(target));
  await symlink(identical, replacement);
  race.target = target;
  race.displaced = `${target}.original`;
  race.replacement = replacement;
  race.trigger = target;
  race.pathReadTrigger = target;

  await expect(installCanonicalManagedDeployFiles(root)).rejects.toThrow(
    "Managed deployment refused an untrusted file",
  );
  expect(race.swapped).toBe(true);
  expect(await readFile(identical)).toEqual(await readFile(race.displaced));
});

test("rejects a managed source root replaced during canonical resolution", async () => {
  const work = await mkdtemp(join(tmpdir(), "cli-managed-source-root-race-"));
  cleanup.push(work);
  const root = join(work, "app");
  race.replacement = join(work, "replacement");
  race.displaced = join(work, "app-original");
  await mkdir(root);
  await mkdir(race.replacement);
  race.target = root;
  race.realpathTrigger = root;

  await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({
    code: "SOURCE_PATH_INVALID",
  });
  expect(race.swapped).toBe(true);
});

test("rejects a configuration root replaced during canonical resolution", async () => {
  const work = await mkdtemp(join(tmpdir(), "managed-config-root-race-"));
  cleanup.push(work);
  const root = join(work, "app");
  race.replacement = join(work, "replacement");
  race.displaced = join(work, "app-original");
  await mkdir(root);
  await mkdir(race.replacement);
  await put(root, "eai.runtime.json", '{"schemaVersion":1}\n');
  await put(race.replacement, "eai.runtime.json", '{"schemaVersion":2}\n');
  race.target = root;
  race.realpathTrigger = root;

  await expect(buildManagedDeployConfigHash(root)).rejects.toThrow(
    "project root changed during canonical resolution",
  );
  expect(race.swapped).toBe(true);
});

test("rejects a source parent replaced before the no-follow open", async () => {
  const root = await mkdtemp(join(tmpdir(), "cli-managed-source-parent-race-"));
  const outside = await mkdtemp(join(tmpdir(), "cli-managed-source-parent-replacement-"));
  cleanup.push(root, outside);
  await put(root, ".eai-manifest.json", JSON.stringify({ template: { commit: "a".repeat(40) } }));
  await put(root, "package.json", '{"name":"fixture","private":true}\n');
  await put(root, "eai.config.ts", "export default {};\n");
  await put(root, "eai.runtime.json", '{"schemaVersion":1}\n');
  await put(root, "src/app/page.tsx", "export default function Page() {}\n");
  await exec("git", ["init", "--quiet"], { cwd: root });
  await exec("git", ["add", "."], { cwd: root });
  await exec("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Initial scaffold from template\n\nCreated by: eai init"], { cwd: root });

  const canonicalRoot = await realpath(root);
  race.trigger = join(canonicalRoot, "src/app/page.tsx");
  race.target = join(canonicalRoot, "src/app");
  race.displaced = join(canonicalRoot, "src/app-original");
  race.replacement = join(outside, "app");
  await put(outside, "app/page.tsx", "export default function Replaced() {}\n");

  await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({
    code: "SOURCE_CHANGED_DURING_READ",
  });
  expect(race.swapped).toBe(true);
});

test("rejects a governed configuration parent replaced before the no-follow open", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-config-parent-race-")));
  const outside = await mkdtemp(join(tmpdir(), "managed-config-parent-replacement-"));
  cleanup.push(root, outside);
  await put(root, "eai.runtime.json", '{"schemaVersion":1}\n');
  await put(root, "src/eai.config/deployment-contract.ts", "export const contract = 1;\n");
  await put(outside, "eai.config/deployment-contract.ts", "export const contract = 2;\n");

  race.trigger = join(root, "src/eai.config/deployment-contract.ts");
  race.target = join(root, "src/eai.config");
  race.displaced = join(root, "src/eai.config-original");
  race.replacement = join(outside, "eai.config");

  await expect(buildManagedDeployConfigHash(root)).rejects.toThrow(
    /Governed configuration (?:path )?changed before its no-follow read/,
  );
  expect(race.swapped).toBe(true);
});

test("rejects a same-name governed directory replacement after initial inventory", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-config-inventory-race-")));
  const outside = await realpath(await mkdtemp(join(tmpdir(), "managed-config-inventory-replacement-")));
  cleanup.push(root, outside);
  await put(root, "eai.runtime.json", '{"schemaVersion":1}\n');
  await put(root, "src/eai.config/runtime.ts", "export const source = 'original';\n");
  await put(outside, "eai.config/runtime.ts", "export const source = 'replacement';\n");
  race.readTrigger = join(root, "eai.runtime.json");
  race.target = join(root, "src/eai.config");
  race.displaced = join(root, "src/eai.config-original");
  race.replacement = join(outside, "eai.config");

  await expect(buildManagedDeployConfigHash(root)).rejects.toThrow(
    "Governed configuration path changed",
  );
  expect(race.swapped).toBe(true);
});

test("rejects a governed configuration parent replaced after the bounded read", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-config-postread-race-")));
  const outside = await realpath(await mkdtemp(join(tmpdir(), "managed-config-postread-replacement-")));
  cleanup.push(root, outside);
  await put(root, "eai.runtime.json", '{"schemaVersion":1}\n');
  await put(root, "src/eai.config/deployment-contract.ts", "export const contract = 1;\n");
  await put(outside, "eai.config/deployment-contract.ts", "export const contract = 2;\n");

  race.readTrigger = join(root, "src/eai.config/deployment-contract.ts");
  race.target = join(root, "src/eai.config");
  race.displaced = join(root, "src/eai.config-original");
  race.replacement = join(outside, "eai.config");

  await expect(buildManagedDeployConfigHash(root)).rejects.toThrow(
    /Governed configuration (?:path )?changed/,
  );
  expect(race.swapped).toBe(true);
});

test("rejects a governed file added after the initial inventory", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-config-inventory-race-")));
  cleanup.push(root);
  await put(root, "eai.runtime.json", '{"schemaVersion":1}\n');
  await put(root, "src/eai.config/deployment-contract.ts", "export const contract = 1;\n");
  race.addTrigger = join(root, "eai.runtime.json");
  race.addPath = join(root, "src/eai.config/late.spec.ts");
  race.addContent = "export const late = true;\n";

  await expect(buildManagedDeployConfigHash(root)).rejects.toThrow(
    "Governed configuration inventory changed during hashing",
  );
  expect(race.added).toBe(true);
});

test("rejects a source parent replaced after the bounded read", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "cli-managed-source-postread-race-")));
  const outside = await realpath(await mkdtemp(join(tmpdir(), "cli-managed-source-postread-replacement-")));
  cleanup.push(root, outside);
  await put(root, ".eai-manifest.json", JSON.stringify({ template: { commit: "a".repeat(40) } }));
  await put(root, "package.json", '{"name":"fixture","private":true}\n');
  await put(root, "eai.config.ts", "export default {};\n");
  await put(root, "eai.runtime.json", '{"schemaVersion":1}\n');
  await put(root, "src/app/page.tsx", "export default function Page() {}\n");
  await exec("git", ["init", "--quiet"], { cwd: root });
  await exec("git", ["add", "."], { cwd: root });
  await exec("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Initial scaffold from template\n\nCreated by: eai init"], { cwd: root });
  await put(outside, "app/page.tsx", "export default function Replaced() {}\n");

  race.readTrigger = join(root, "src/app/page.tsx");
  race.target = join(root, "src/app");
  race.displaced = join(root, "src/app-original");
  race.replacement = join(outside, "app");

  await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({
    code: "SOURCE_CHANGED_DURING_READ",
  });
  expect(race.swapped).toBe(true);
});

test("does not write doctor evidence through a replaced parent", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-doctor-parent-race-")));
  const outside = await realpath(await mkdtemp(join(tmpdir(), "managed-doctor-parent-replacement-")));
  cleanup.push(root, outside);
  const target = join(root, ".eai/reports/deploy-doctor.json");
  await mkdir(join(outside, "reports"));
  race.trigger = target;
  race.target = join(root, ".eai/reports");
  race.displaced = join(root, ".eai/reports-original");
  race.replacement = join(outside, "reports");

  await expect(writeManagedDeployEvidence(target, { status: "pass" })).rejects.toThrow(
    "evidence directory changed",
  );
  expect(race.swapped).toBe(true);
  await expect(readFile(join(root, ".eai/reports/deploy-doctor.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

test("does not create doctor evidence directories after the bound project root is replaced", async () => {
  const work = await realpath(await mkdtemp(join(tmpdir(), "managed-doctor-root-race-")));
  cleanup.push(work);
  const root = join(work, "app");
  const displaced = join(work, "app-original");
  const replacement = join(work, "replacement");
  await mkdir(root);
  await mkdir(replacement);
  const binding = await bindManagedProjectRoot(root);
  await rename(root, displaced);
  await rename(replacement, root);

  await expect(writeManagedDeployEvidence(
    join(root, ".eai/reports/deploy-doctor.json"),
    { status: "pass" },
    binding,
  )).rejects.toThrow("project root changed");
  expect(await readdir(root)).toEqual([]);
});

test("does not write a local source receipt through a replaced parent", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-receipt-parent-race-")));
  const outside = await realpath(await mkdtemp(join(tmpdir(), "managed-receipt-parent-replacement-")));
  cleanup.push(root, outside);
  await mkdir(join(outside, "eai"));
  const target = join(root, ".eai/cli-managed-source-receipt.json");
  race.trigger = target;
  race.target = join(root, ".eai");
  race.displaced = join(root, ".eai-original");
  race.replacement = join(outside, "eai");
  const bundle: CliManagedSourceBundle = {
    schemaVersion: "eai.cli_managed_source_bundle.v1",
    templateCommitSha: "a".repeat(40),
    bundleSha256: `sha256:${"b".repeat(64)}`,
    configHash: `sha256:${"c".repeat(64)}`,
    files: [],
  };

  await expect(writeCliManagedSourceReceipt(root, bundle)).rejects.toMatchObject({
    code: "SOURCE_RECEIPT_PATH_INVALID",
  });
  expect(race.swapped).toBe(true);
  await expect(readFile(join(root, ".eai/cli-managed-source-receipt.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

test("does not write a local source receipt through a replaced project root", async () => {
  const work = await mkdtemp(join(tmpdir(), "managed-receipt-root-race-"));
  cleanup.push(work);
  const root = join(work, "app");
  race.replacement = join(work, "replacement");
  race.displaced = join(work, "app-original");
  await mkdir(root);
  await mkdir(race.replacement);
  race.target = root;
  race.realpathTrigger = root;
  const bundle: CliManagedSourceBundle = {
    schemaVersion: "eai.cli_managed_source_bundle.v1",
    templateCommitSha: "a".repeat(40),
    bundleSha256: `sha256:${"b".repeat(64)}`,
    configHash: `sha256:${"c".repeat(64)}`,
    files: [],
  };

  await expect(writeCliManagedSourceReceipt(root, bundle)).rejects.toMatchObject({
    code: "SOURCE_RECEIPT_PATH_INVALID",
  });
  expect(race.swapped).toBe(true);
  await expect(readFile(join(root, ".eai/cli-managed-source-receipt.json"), "utf8"))
    .rejects.toMatchObject({ code: "ENOENT" });
});

test("does not write canonical file bytes through a replaced parent", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-install-parent-race-")));
  const outside = await realpath(await mkdtemp(join(tmpdir(), "managed-install-parent-replacement-")));
  cleanup.push(root, outside);
  await mkdir(join(root, ".github/workflows"), { recursive: true });
  await mkdir(join(outside, "workflows"));
  const workflow = join(root, ".github/workflows/eai-app.yml");
  race.trigger = workflow;
  race.target = join(root, ".github/workflows");
  race.displaced = join(root, ".github/workflows-original");
  race.replacement = join(outside, "workflows");

  await expect(installCanonicalManagedDeployFiles(root)).rejects.toThrow(
    "evidence directory changed",
  );
  expect(race.swapped).toBe(true);
  await expect(readFile(workflow, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

test("does not install canonical files through a replaced project root", async () => {
  const work = await mkdtemp(join(tmpdir(), "managed-install-root-race-"));
  cleanup.push(work);
  const root = join(work, "app");
  race.replacement = join(work, "replacement");
  race.displaced = join(work, "app-original");
  await mkdir(root);
  await mkdir(race.replacement);
  race.target = root;
  race.realpathTrigger = root;

  await expect(installCanonicalManagedDeployFiles(root)).rejects.toThrow(
    "project root changed during canonical resolution",
  );
  expect(race.swapped).toBe(true);
  await expect(readFile(join(root, ".github/workflows/eai-app.yml"), "utf8"))
    .rejects.toMatchObject({ code: "ENOENT" });
});

test("does not clobber a canonical target that appears before exclusive creation", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-install-create-race-")));
  cleanup.push(root);
  await mkdir(join(root, ".github/workflows"), { recursive: true });
  const workflow = join(root, ".github/workflows/eai-app.yml");
  race.addTrigger = workflow;
  race.addPath = workflow;
  race.addContent = "concurrent local edit\n";

  await expect(installCanonicalManagedDeployFiles(root)).rejects.toMatchObject({
    code: "EEXIST",
  });
  expect(race.added).toBe(true);
  await expect(readFile(workflow, "utf8")).resolves.toBe("concurrent local edit\n");
});

test("does not clobber an existing canonical target changed before open", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-install-existing-race-")));
  cleanup.push(root);
  const target = join(root, "eai-app.yml");
  await writeFile(target, "inspected local edit\n");
  race.addTrigger = target;
  race.addPath = target;
  race.addContent = "concurrent local edit with a different size\n";

  await expect(writeBoundRegularFile(target, "canonical replacement\n")).rejects.toThrow(
    "generated file changed before its bound write",
  );
  expect(race.added).toBe(true);
  await expect(readFile(target, "utf8")).resolves.toBe(
    "concurrent local edit with a different size\n",
  );
});

test("rejects a private file that grows after inspection before allocation", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-private-read-size-race-")));
  cleanup.push(root);
  const target = join(root, "state.json");
  await writeFile(target, "{}\n", { mode: 0o600 });
  race.addTrigger = target;
  race.addPath = target;
  race.addContent = "x".repeat(1024);

  await expect(readPrivateFileNoFollow(target, 64)).rejects.toThrow(
    /changed or exceeded its size bound before reading/,
  );
  expect(race.added).toBe(true);
});

test.each(["state", "dispatch"])(
  "does not write private %s authority through a replaced parent",
  async (kind) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), `managed-${kind}-parent-race-`)));
    const outside = await realpath(await mkdtemp(join(tmpdir(), `managed-${kind}-parent-replacement-`)));
    cleanup.push(root, outside);
    const directory = join(root, "managed-deployments");
    await mkdir(directory);
    await mkdir(join(outside, "managed-deployments"));
    const state = retryState();
    const suffix = kind === "state" ? ".json" : ".json.dispatch";
    race.trigger = join(directory, `${state.operationId}${suffix}`);
    race.target = directory;
    race.displaced = join(root, "managed-deployments-original");
    race.replacement = join(outside, "managed-deployments");

    await expect(kind === "state"
      ? saveManagedDeployState(state, directory)
      : claimManagedDeployDispatch(state, directory)).rejects.toThrow(
      "evidence directory changed",
    );
    expect(race.swapped).toBe(true);
    if (kind === "dispatch") {
      await expect(readFile(race.trigger, "utf8")).resolves.toBe("");
    } else {
      await expect(readFile(race.trigger, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }
  },
);


test("preserves the caller's inspected absence through canonical creation", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-absence-race-")));
  cleanup.push(root);
  const target = join(root, "eai-app.yml");
  await writeFile(target, "created after caller inspection\n");
  await expect(writeBoundRegularFile(target, "replacement", 0o644, undefined, { status: undefined })).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(target, "utf8")).toBe("created after caller inspection\n");
});

test("preserves the inspected private inode before mutation", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-private-inode-race-")));
  cleanup.push(root);
  const target = join(root, "state.json");
  await writeFile(target, "original", { mode: 0o600 });
  race.addTrigger = target; race.addPath = target; race.addContent = "concurrent replacement";
  await expect(writePrivateFileNoFollow(target, "new authority")).rejects.toThrow("private file changed before its bound write");
  expect(await readFile(target, "utf8")).toBe("concurrent replacement");
});

test("rejects a same-inode config rewrite between inspection and open", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-config-open-race-")));
  cleanup.push(root);
  const target = join(root, "eai.runtime.json");
  await writeFile(target, "original config");
  race.addTrigger = target; race.addPath = target; race.addContent = "substitute config";
  await expect(buildManagedDeployConfigHash(root)).rejects.toThrow("changed before its no-follow read");
});


test.skipIf(process.platform === "win32")("rejects a FIFO swapped into an evidence read without blocking", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-evidence-fifo-race-")));
  cleanup.push(root);
  const target = join(root, "evidence.json");
  await writeFile(target, "{}");
  race.fifoTrigger = target;
  await expect(readSourceUnknownEvidenceFile(target)).rejects.toThrow("changed before its no-follow read");
  expect(race.swapped).toBe(true);
});

test("rejects a source child swapped to a link before inventory readdir", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-source-inventory-link-race-")));
  const outside = await realpath(await mkdtemp(join(tmpdir(), "managed-source-inventory-outside-")));
  cleanup.push(root, outside);
  await put(root, ".eai-manifest.json", JSON.stringify({ template: { commit: "a".repeat(40) } }));
  await put(root, "package.json", '{}'); await put(root, "eai.runtime.json", '{}');
  await put(root, "src/app/page.tsx", "original page");
  await exec("git", ["init", "--quiet"], { cwd: root });
  await exec("git", ["add", "."], { cwd: root });
  await exec("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Initial scaffold from template\n\nCreated by: eai init"], { cwd: root });
  race.inventoryTrigger = join(root, "src/app"); race.target = race.inventoryTrigger;
  race.displaced = join(root, "src/app-original"); race.replacement = outside;
  await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({ code: "SOURCE_CHANGED_DURING_READ" });
});


test("rejects a second link observed after the descriptor's earlier snapshot", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-write-link-snapshot-")));
  cleanup.push(root);
  const target = join(root, "output.txt");
  await writeFile(target, "original");
  const before = await lstat(target);
  const handle = await open(target, constants.O_RDONLY);
  try {
    await link(target, join(root, "outside-link.txt"));
    vi.spyOn(handle, "stat").mockResolvedValue(before);
    await expect(assertOpenedRegularTarget(target, handle)).rejects.toThrow("untrusted file");
    expect(await readFile(target, "utf8")).toBe("original");
  } finally {
    await handle.close();
  }
});

test("hashes large governed config with at most 64 KiB retained per read", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-config-fixed-buffer-")));
  cleanup.push(root);
  const content = "x".repeat(512 * 1024 + 17);
  race.boundedReadTrigger = join(root, "eai.runtime.json");
  await writeFile(race.boundedReadTrigger, content);
  const expected = createHash("sha256").update("eai.runtime.json\0").update(content).update("\0").digest("hex");
  await expect(buildManagedDeployConfigHash(root)).resolves.toBe(`sha256:${expected}`);
});
