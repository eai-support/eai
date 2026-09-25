import { execFile } from "node:child_process";
import type { PathLike } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test, vi } from "vitest";

const race = vi.hoisted(() => ({
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
      if (!race.swapped && String(path) === race.target) {
        race.swapped = true;
        await actual.rename(race.target, race.displaced);
        await actual.rename(race.replacement, race.target);
      }
      return actual.open(path, flags, mode);
    },
  };
});

import { buildCliManagedSourceBundle } from "../../src/lib/eai-managed-source.js";

const exec = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  race.target = "";
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

  race.target = join(root, "src/app/page.tsx");
  race.displaced = join(root, "src/app/page.original.tsx");
  race.replacement = join(outside, "page.tsx");
  await writeFile(race.replacement, "export default function Replaced() {}\n");

  await expect(buildCliManagedSourceBundle(root)).rejects.toMatchObject({
    code: "SOURCE_CHANGED_DURING_READ",
  });
  expect(race.swapped).toBe(true);
});
