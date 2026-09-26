import { execFile } from "node:child_process";
import type { PathLike } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test, vi } from "vitest";

const race = vi.hoisted(() => ({
  trigger: "",
  triggerPrefix: "",
  readTrigger: "",
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
    open: async (path: PathLike, flags: string | number, mode?: number) => {
      if (!race.added && String(path) === race.addTrigger) {
        race.added = true;
        await actual.writeFile(race.addPath, race.addContent);
      }
      if (!race.swapped && (String(path) === race.trigger
        || (race.triggerPrefix && String(path).startsWith(race.triggerPrefix)))) {
        race.swapped = true;
        await actual.rename(race.target, race.displaced);
        await actual.rename(race.replacement, race.target);
      }
      const handle = await actual.open(path, flags, mode);
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
import { writeManagedDeployEvidence } from "../../src/lib/eai-managed-deploy-filesystem.js";
import {
  claimManagedDeployDispatch,
  saveManagedDeployState,
} from "../../src/lib/eai-managed-deploy-state.js";
import type { ManagedDeployState } from "../../src/lib/eai-managed-deploy-contract.js";
import {
  buildCliManagedSourceBundle,
  writeCliManagedSourceReceipt,
  type CliManagedSourceBundle,
} from "../../src/lib/eai-managed-source.js";

const exec = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  race.target = "";
  race.trigger = "";
  race.triggerPrefix = "";
  race.readTrigger = "";
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
  const root = await mkdtemp(join(tmpdir(), "managed-config-parent-race-"));
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
  await expect(readFile(join(root, ".eai/reports/deploy-doctor.json"), "utf8")).resolves.toBe("");
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
  await expect(readFile(join(root, ".eai/cli-managed-source-receipt.json"), "utf8")).resolves.toBe("");
});

test("does not atomically install canonical files through a replaced parent", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "managed-install-parent-race-")));
  const outside = await realpath(await mkdtemp(join(tmpdir(), "managed-install-parent-replacement-")));
  cleanup.push(root, outside);
  await mkdir(join(root, ".github/workflows"), { recursive: true });
  await mkdir(join(outside, "workflows"));
  const workflow = join(root, ".github/workflows/eai-app.yml");
  race.triggerPrefix = `${workflow}.eai-`;
  race.target = join(root, ".github/workflows");
  race.displaced = join(root, ".github/workflows-original");
  race.replacement = join(outside, "workflows");

  await expect(installCanonicalManagedDeployFiles(root)).rejects.toThrow(
    "evidence directory changed",
  );
  expect(race.swapped).toBe(true);
  await expect(readFile(workflow, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
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
    await expect(readFile(race.trigger, "utf8")).resolves.toBe("");
  },
);
