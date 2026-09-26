import { execFile } from "node:child_process";
import type { PathLike } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test, vi } from "vitest";

const race = vi.hoisted(() => ({
  trigger: "",
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
      if (!race.swapped && String(path) === race.trigger) {
        race.swapped = true;
        await actual.rename(race.target, race.displaced);
        await actual.rename(race.replacement, race.target);
      }
      return actual.open(path, flags, mode);
    },
  };
});

import { buildManagedDeployConfigHash } from "../../src/lib/eai-managed-deploy-files.js";
import { writeManagedDeployEvidence } from "../../src/lib/eai-managed-deploy-filesystem.js";
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
