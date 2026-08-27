import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  expectFileNotExists,
} from "../helpers/assert-dsl.js";
import { expectGoferSurfaceContract } from "../helpers/gofer-surface-contract.js";
import { installGoferResources } from "../../src/lib/gofer-installer.js";

const BUNDLED_GOFER_RESOURCES = fileURLToPath(
  new URL("../../resources/gofer/", import.meta.url),
);
const GOFER_SYNC_SCRIPT = fileURLToPath(
  new URL("../../scripts/sync-gofer-resources.cjs", import.meta.url),
);

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
    await expectFileContains(
      ctx,
      ".eai-manifest.json",
      '".claude/skills/eai/SKILL.md"',
    );
    await expectFileExists(ctx, ".claude/skills/eai/SKILL.md");
    await expectFileContains(
      ctx,
      ".claude/skills/eai/SKILL.md",
      "## Local Settings Cleanup Contract",
    );
    await expectFileNotExists(ctx, ".agents/skills/0_gofer_start/SKILL.md");
    await expectFileNotExists(ctx, ".github/skills/0-gofer-start/SKILL.md");
    await expectFileExists(ctx, ".gemini/commands/gofer/eai.md");
    await expectFileNotExists(ctx, ".gemini/commands/gofer/0_gofer_start.md");
    await expectFileNotExists(ctx, ".gemini/commands/gofer/0_gofer_start.toml");
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
    await expectFileExists(
      ctx,
      ".specify/config/object-type-routing.json",
    );
    await expectFileContains(
      ctx,
      ".specify/config/object-type-routing.json",
      '"contractVersion": "eai.object-type-routing/v1"',
    );
    await expectFileContains(
      ctx,
      ".specify/config/object-type-routing.json",
      "never re-derive or rename historical stored slugs",
    );
    await expectFileExists(
      ctx,
      ".specify/contracts/object-type-routing-v1.json",
    );
    await expectFileContains(
      ctx,
      ".specify/contracts/object-type-routing-v1.json",
      '"authoritativeTransportIdentifier": "slug"',
    );
    await expectFileContains(
      ctx,
      ".specify/contracts/object-type-routing-v1.json",
      '"sourceField": "linkTypes[].targetObjectType"',
    );
    await expectFileContains(
      ctx,
      ".specify/commands/6_gofer_validate.md",
      "Generated `linkTypes[].targetObjectType`",
    );
    await expectFileExists(
      ctx,
      ".specify/schemas/object-type-identifier-audit-v1.schema.json",
    );
    await expectFileExists(
      ctx,
      ".specify/schemas/object-type-routing-phase-bundle-v1.schema.json",
    );
    await expectGoferSurfaceContract(ctx);
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

  test("can refresh from a newer Gofer resources source without a new CLI release", async () => {
    const latestResources = join(env.dir, "latest-gofer-resources");
    await cp(BUNDLED_GOFER_RESOURCES, latestResources, { recursive: true });
    await writeFile(
      join(latestResources, ".gofer-version"),
      JSON.stringify(
        {
          commit: "latest-gofer-commit",
          describe: "v99.0.0",
          synced_at: "2099-01-01T00:00:00Z",
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    ctx.env.EAI_GOFER_REFRESH_SOURCE = "latest";
    ctx.env.EAI_GOFER_REFRESH_RESOURCES_PATH = latestResources;

    const result = await runCommand(ctx, "eai gofer refresh --check --format json");
    expectCommandSucceeded(result);

    const payload = JSON.parse(result.stdout) as {
      bundle?: { describe?: string; commit?: string; source?: string };
    };
    expect(payload.bundle).toMatchObject({
      describe: "v99.0.0",
      commit: "latest-gofer-commit",
      source: "latest",
    });
  });

  test("installs a plain-language Claude skill from a newer Gofer resources source", async () => {
    const latestCheckout = join(env.dir, "latest-gofer-checkout");
    const latestResources = join(latestCheckout, "extension", "resources");
    const eaiSkillDirectory = join(latestResources, "claude-skills", "eai");
    await cp(BUNDLED_GOFER_RESOURCES, latestResources, { recursive: true });
    await mkdir(eaiSkillDirectory, { recursive: true });
    await writeFile(
      join(eaiSkillDirectory, "SKILL.md"),
      [
        "---",
        "name: eai",
        'description: "Use when the user says Get started with EAI."',
        "---",
        "",
        "## Welcome to Enterprise AI 👋",
        "",
      ].join("\n"),
      "utf-8",
    );

    ctx.env.EAI_GOFER_REFRESH_SOURCE = "latest";
    ctx.env.EAI_GOFER_REFRESH_RESOURCES_PATH = latestCheckout;
    ctx.env.EAI_GOFER_REFRESH_CACHE_DIR = join(env.dir, "gofer-cache");

    const result = await runCommand(ctx, "eai gofer refresh");
    expectCommandSucceeded(result);
    await expectFileContains(
      ctx,
      ".claude/skills/eai/SKILL.md",
      "Use when the user says Get started with EAI",
    );
    await expectFileContains(
      ctx,
      ".claude/skills/eai/SKILL.md",
      "Welcome to Enterprise AI 👋",
    );
    await expectFileExists(ctx, ".claude/commands/eai.md");
    await expectFileNotExists(ctx, ".claude/commands/0_gofer_start.md");
    await expectFileNotExists(ctx, ".agents/skills/0_gofer_start/SKILL.md");
    await expectFileNotExists(ctx, ".github/skills/0-gofer-start/SKILL.md");
    await expectFileExists(ctx, ".gemini/commands/gofer/eai.md");
    await expectFileNotExists(ctx, ".gemini/commands/gofer/0_gofer_start.md");
    await expectFileNotExists(ctx, ".gemini/commands/gofer/0_gofer_start.toml");
    await expectFileExists(ctx, ".specify/commands/0_gofer_start.md");
    await expectFileExists(ctx, ".claude/agents/codebase-analyzer.md");
    await expectGoferSurfaceContract(ctx, "", { checkPublicGuidance: false });
  });
});

describe("bundled Gofer Object Type routing assets", () => {
  test("syncs config, contracts, and schemas into installable resource paths", async () => {
    const source = await readFile(GOFER_SYNC_SCRIPT, "utf-8");

    expect(source).toContain("['.specify/config', 'config']");
    expect(source).toContain("['.specify/contracts', 'contracts']");
    expect(source).toContain("['.specify/schemas', 'schemas']");
    expect(source).toContain("'--others'");
    expect(source).toContain("'--exclude-standard'");
  });
});
