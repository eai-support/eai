import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createTestEnvironment,
  type TestEnvironment,
} from "../helpers/test-env.js";
import type { TestContext } from "../helpers/setup-dsl.js";
import { workingDirectoryIs } from "../helpers/setup-dsl.js";
import { runCommand } from "../helpers/action-dsl.js";
import {
  expectCommandSucceeded,
  expectDisplayedMessage,
  expectFileContains,
  expectFileExists,
} from "../helpers/assert-dsl.js";
import { installGoferResources } from "../../src/lib/gofer-installer.js";

async function createGoferFixture(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, "src", "eai.config"), { recursive: true });
  await writeFile(
    join(projectRoot, "src", "eai.config", "object-types.ts"),
    "export const objectTypes = {};\n",
    "utf-8",
  );
  await writeFile(
    join(projectRoot, "package.json"),
    JSON.stringify(
      {
        name: "@eai-tools/eai-gofer-refresh-fixture",
        version: "0.0.1",
        type: "module",
        scripts: {
          build: "next build",
          lint: "eslint .",
          test: "vitest run",
        },
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );

  await installGoferResources(projectRoot, {
    workflowProfile: "enterpriseai",
  });
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursive(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      results.push(entryPath);
    }
  }

  return results;
}

describe("eai gofer refresh", () => {
  let env: TestEnvironment;
  let ctx: TestContext;

  beforeEach(async () => {
    env = await createTestEnvironment();
    ctx = {
      workingDir: env.dir,
      mockAPI: {} as TestContext["mockAPI"],
      env: {},
      prompts: [],
    };

    workingDirectoryIs(ctx, env.dir);
    await createGoferFixture(env.dir);
  });

  afterEach(async () => {
    await env.cleanup();
  });

  test("records the current managed snapshot on the first refresh without rewriting matching files", async () => {
    const result = await runCommand(ctx, "eai gofer refresh");

    expectCommandSucceeded(result);
    expectDisplayedMessage(
      result,
      "Recorded the current state in `.eai-manifest.json`",
    );
    await expectFileExists(ctx, ".eai-manifest.json");
    await expectFileContains(
      ctx,
      ".eai-manifest.json",
      '".github/copilot-instructions.md"',
    );
    await expectFileExists(
      ctx,
      ".specify/references/platform/eai-app-template.md",
    );
    await expectFileContains(
      ctx,
      ".specify/references/platform/eai-app-template.md",
      "canonical scaffold",
    );
    await expectFileExists(
      ctx,
      ".specify/references/platform/eai-config-driven-ui.md",
    );
    await expectFileContains(
      ctx,
      ".specify/references/platform/eai-config-driven-ui.md",
      "Config-Driven UI Reference",
    );
  });

  test("detects local edits as conflicts and only overwrites them when forced", async () => {
    const seedResult = await runCommand(ctx, "eai gofer refresh");
    expectCommandSucceeded(seedResult);

    const managedFile = join(env.dir, ".github", "copilot-instructions.md");
    const original = await readFile(managedFile, "utf-8");
    await writeFile(managedFile, `${original}\nLOCAL CUSTOMIZATION\n`, "utf-8");

    const checkResult = await runCommand(ctx, "eai gofer refresh --check");
    expectCommandSucceeded(checkResult);
    expectDisplayedMessage(checkResult, "conflict");
    expectDisplayedMessage(checkResult, ".github/copilot-instructions.md");
    await expectFileContains(
      ctx,
      ".github/copilot-instructions.md",
      "LOCAL CUSTOMIZATION",
    );

    const forceResult = await runCommand(ctx, "eai gofer refresh --force");
    expectCommandSucceeded(forceResult);

    const refreshed = await readFile(managedFile, "utf-8");
    expect(refreshed).not.toContain("LOCAL CUSTOMIZATION");

    const backups = await listFilesRecursive(
      join(env.dir, ".specify", "_backup", "gofer-refresh"),
    );
    expect(
      backups.some((path) =>
        path.endsWith(join(".github", "copilot-instructions.md")),
      ),
    ).toBe(true);
  });
});
