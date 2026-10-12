import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import {
  GOFER_RESOURCE_MAPPINGS,
  installGoferResources,
} from "../../src/lib/gofer-installer.js";

const BUNDLED_GOFER_RESOURCES = fileURLToPath(
  new URL("../../resources/gofer/", import.meta.url),
);
const ACTIVE_SPECIFY_RESOURCES = fileURLToPath(
  new URL("../../.specify/scripts/", import.meta.url),
);
const START_HERE_DOCUMENT = fileURLToPath(
  new URL("../../.tech-docs/start-here.md", import.meta.url),
);
const GOFER_SYNC_SCRIPT = fileURLToPath(
  new URL("../../scripts/sync-gofer-resources.cjs", import.meta.url),
);
const GOFER_VERSION_FILE = join(BUNDLED_GOFER_RESOURCES, ".gofer-version");
const GOFER_RELEASE_COMMIT = "965833ad06c5bed1c76b2e493891036449e67561";
const GOFER_RELEASE_TAG = "v3.14.3";
const GOFER_RELEASE_SOURCE = `https://github.com/eai-support/eai-gofer.git@${GOFER_RELEASE_TAG}`;
const GOFER_OPTIONAL_INSTALLER_SHA256 = {
  "bash-scripts/install-optional-tools.sh":
    "9b870c7c803df01738a614aab115e41e1e880d08244992e905694456ee73abac",
  "powershell-scripts/install-optional-tools.ps1":
    "a7fbfefad761074480f634504fb88d6739050ac95c501dd1d59380e258879811",
} as const;
const SOURCE_READINESS_SCRIPT_SHA256 =
  "6a33b8494944b0c91c54dcde27ce55b50ffd45fe0e1c3f685b6493441ff50903";

interface ChildResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runChild(
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
  },
): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let didTimeOut = false;
    const timeout = setTimeout(() => {
      didTimeOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 5_000);
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-131_072);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-131_072);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolve({ exitCode: 127, stdout, stderr: `${stderr}${error.message}` });
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: didTimeOut ? 124 : (code ?? 1), stdout, stderr });
    });
  });
}

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

  test("regenerated public entrypoints retain report preview, consent, and welcome guidance", async () => {
    const moduleUrl = pathToFileURL(join(BUNDLED_GOFER_RESOURCES, "node-scripts/generate-commands.mjs")).href;
    const result = await runChild(process.execPath, ["--input-type=module", "--eval", `
      import {buildPublicEntrypointPrompt} from ${JSON.stringify(moduleUrl)};
      const hosts = ['claude', 'copilot', 'codex-or-antigravity', 'codex', 'grok', 'gemini'];
      console.log(JSON.stringify(hosts.map(host => {
        const eai = buildPublicEntrypointPrompt({name:'eai', title:'EAI', description:'EAI'}, [], host);
        const update = buildPublicEntrypointPrompt({name:'eai-update', title:'EAI update', description:'Update EAI'}, [], host);
        return {
          host,
          support: eai.split('## Support after an unresolved EAI error')[1]?.split('## Verified EAI CLI Command Contract')[0],
          welcome: eai.split('### Required First-Run Response')[1]?.split('## Route The Pipeline')[0],
          updateHasSupport: update.includes('eai support --source harness'),
        };
      })));
    `], { cwd: env.dir });
    expect(result.exitCode, result.stderr).toBe(0);
    const entries = JSON.parse(result.stdout) as Array<{ host: string; support: string; welcome: string; updateHasSupport: boolean }>;
    expect(entries).toHaveLength(6);
    for (const { host, support, welcome, updateHasSupport } of entries) {
      expect(support, host).toContain("eai support --source harness --tool <current-tool> --format json");
      expect(support, host).toContain("Only after they approve that bundle");
      expect(support, host).toContain("--yes --no-open");
      expect(support, host).toContain("Never assume consent");
      expect(welcome, host).toContain('If anything fails, say "get help" or type `eai support`');
      expect(updateHasSupport, host).toBe(false);
    }
    });

  test("JSON refresh checks report file metadata without serializing managed contents", async () => {
    const relativePath = ".specify/commands/3_gofer_plan.md";
    const target = join(env.dir, relativePath);
    const contents = await readFile(target);
    await rm(target);
    ctx.env.EAI_GOFER_REFRESH_SOURCE = "bundled";

    const result = await runCommand(ctx, "eai gofer refresh --check --format json");
    expectCommandSucceeded(result);
    const payload = JSON.parse(result.stdout) as {
      items: Array<Record<string, unknown>>;
    };
    expect(payload.items.find((item) => item.relativePath === relativePath)).toMatchObject({
      action: "add",
      source: "bundled",
      desiredHash: createHash("sha256").update(contents).digest("hex"),
      executable: false,
    });
    expect(payload.items.every((item) => !("contents" in item))).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThan(131_072);
    expect(existsSync(target)).toBe(false);
  });

  test("installs the released document lifecycle guidance", async () => {
    const metadata = JSON.parse(await readFile(GOFER_VERSION_FILE, "utf8"));
    expect(metadata).toMatchObject({
      commit: GOFER_RELEASE_COMMIT,
      describe: GOFER_RELEASE_TAG,
      source: GOFER_RELEASE_SOURCE,
      dirty: false,
    });
    const relativePath = "references/platform/eai-service-patterns.md";
    const bundled = await readFile(join(BUNDLED_GOFER_RESOURCES, relativePath), "utf8");
    const installed = await readFile(
      join(env.dir, ".specify", relativePath),
      "utf8",
    );
    expect(installed).toBe(bundled);
    expect(installed).toContain("## Document Lifecycle Rules");
    expect(installed).toContain("POST /v4/data/documents/upload");
    expect(installed).toContain("Existing DAISY and Assess");
    expect(installed).toContain("workspace retention policy");
  });

  test("installs the released managed-source guidance and executable readiness check", async () => {
    const metadata = JSON.parse(await readFile(GOFER_VERSION_FILE, "utf8"));
    expect(metadata).toMatchObject({
      commit: GOFER_RELEASE_COMMIT,
      describe: GOFER_RELEASE_TAG,
      source: GOFER_RELEASE_SOURCE,
      dirty: false,
    });
    for (const relativePath of [
      "commands/3_gofer_plan.md",
      "commands/4_gofer_tasks.md",
      "commands/5_gofer_implement.md",
      "commands/6_gofer_validate.md",
      "references/platform/eai-app-template.md",
      "node-scripts/eai-app-template-readiness.mjs",
    ]) {
      const bundled = await readFile(join(BUNDLED_GOFER_RESOURCES, relativePath));
      const mapping = GOFER_RESOURCE_MAPPINGS.find(({ sourceSubdirectory }) =>
        relativePath.startsWith(`${sourceSubdirectory}/`),
      );
      expect(mapping).toBeDefined();
      const installed = join(env.dir, ...mapping!.targetSegments, relativePath.slice(mapping!.sourceSubdirectory.length + 1));
      expect(await readFile(installed)).toEqual(bundled);
    }
    const readiness = await readFile(join(BUNDLED_GOFER_RESOURCES, "node-scripts/eai-app-template-readiness.mjs"));
    expect(createHash("sha256").update(readiness).digest("hex")).toBe(SOURCE_READINESS_SCRIPT_SHA256);
    const validate = await readFile(
      join(env.dir, ".specify/commands/6_gofer_validate.md"),
      "utf8",
    );
    expect(validate.indexOf("## Managed-Source Readiness Gate")).toBeLessThan(
      validate.indexOf("## Step 1.5:"),
    );
    expect(validate).toContain("all customer-authored app");
    expect(validate).toContain("workflow controls");
    expect(validate).toContain("Unsupported custom runtimes");
    const packageManifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    );
    expect(packageManifest.files).toContain("resources");
  });

  test("resolves Windows npm shims to Node without executing shim text or ComSpec", async () => {
    const directory = join(env.dir, "CLI path & %literal%");
    const packageRoot = join(directory, "node_modules", "@enterpriseai", "cli");
    const entrypoint = join(packageRoot, "dist", "index.js");
    const marker = join(env.dir, "shell-was-executed");
    await mkdir(join(packageRoot, "dist"), { recursive: true });
    await writeFile(join(directory, "eai.cmd"), `echo unsafe > "${marker}"`);
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "@enterpriseai/cli", bin: { eai: "dist/index.js" } }));
    await writeFile(entrypoint, "console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));");
    const moduleUrl = pathToFileURL(join(BUNDLED_GOFER_RESOURCES, "node-scripts/eai-app-template-readiness.mjs")).href;
    const result = await runChild(process.execPath, ["--input-type=module", "--eval", `
      import {resolveCliExecution} from ${JSON.stringify(moduleUrl)};
      import {execFileSync} from 'node:child_process';
      const selected = await resolveCliExecution('eai', 'win32', ${JSON.stringify(directory)});
      if (!selected || selected.command !== process.execPath) throw new Error('Expected Node entrypoint');
      process.stdout.write(execFileSync(selected.command, selected.args, {cwd:${JSON.stringify(env.dir)},encoding:'utf8'}));
    `], { cwd: env.dir, env: { ...process.env, ComSpec: `cmd.exe /c echo unsafe > "${marker}"` } });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ args: ["deploy", "source", "validate", "--format", "json"], cwd: await realpath(env.dir) });
    expect(existsSync(marker)).toBe(false);
  });

  test.each(["missing-shim", "wrong-package", "wrong-bin", "missing-entrypoint"])(
    "fails closed on Windows when the selected shim has %s", async (fault) => {
      const directory = join(env.dir, "selected-cli");
      const packageRoot = join(directory, "node_modules", "@enterpriseai", "cli");
      await mkdir(join(packageRoot, "dist"), { recursive: true });
      if (fault !== "missing-shim") await writeFile(join(directory, "eai.cmd"), "untrusted shim text");
      await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: fault === "wrong-package" ? "unrelated-cli" : "@enterpriseai/cli", bin: { eai: fault === "wrong-bin" ? "alternate.js" : "dist/index.js" } }));
      if (fault !== "missing-entrypoint") await writeFile(join(packageRoot, "dist", "index.js"), "");
      const moduleUrl = pathToFileURL(join(BUNDLED_GOFER_RESOURCES, "node-scripts/eai-app-template-readiness.mjs")).href;
      const result = await runChild(process.execPath, ["--input-type=module", "--eval", `
        import {resolveCliExecution} from ${JSON.stringify(moduleUrl)};
        console.log(JSON.stringify(await resolveCliExecution('eai', 'win32', ${JSON.stringify([directory, env.dir].join(delimiter))})));
      `], { cwd: env.dir });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toBeNull();
    },
  );

  test.each([
    {
      name: "valid source",
      cliExit: 0,
      report: {
        schemaVersion: "eai.cli_managed_source_validation.v1",
        status: "passed",
        sourceMode: "eai-cli-generated",
        templateCommitSha: "a".repeat(40),
        fileCount: 3,
        totalBytes: 40,
      },
      expectedStatus: "passed",
      expectedCode: undefined,
    },
    {
      name: "unsupported source",
      cliExit: 1,
      report: {
        schemaVersion: "eai.cli_managed_source_validation.v1",
        status: "failed",
        sourceMode: "eai-cli-generated",
        error: {
          code: "SOURCE_SCOPE_UNSUPPORTED",
          message: "PRIVATE_VALIDATOR_DETAIL",
        },
      },
      expectedStatus: "failed",
      expectedCode: "SOURCE_SCOPE_UNSUPPORTED",
    },
    {
      name: "malformed source receipt",
      cliExit: 0,
      report: {
        schemaVersion: "wrong",
        privateContent: "PRIVATE_VALIDATOR_DETAIL",
      },
      expectedStatus: "failed",
      expectedCode: "SOURCE_VALIDATOR_INVALID",
    },
  ])(
    "installed checker invokes only the selected read-only validator for $name",
    async ({ cliExit, report, expectedStatus, expectedCode }) => {
      await writeFile(
        join(env.dir, ".eai-manifest.json"),
        JSON.stringify({
          schemaVersion: 1,
          template: {
            repo: "https://github.com/eai-support/eai-app-template",
            initializedAt: "2026-10-05T00:00:00Z",
          },
        }),
      );
      await writeFile(join(env.dir, "eai.runtime.json"), "{}\n");
      await writeFile(
        join(env.dir, "src/eai.config/register.ts"),
        "export {};\n",
      );
      await writeFile(join(env.dir, ".env.example"), "");
      await writeFile(join(env.dir, ".npmrc"), "");
      const selectedCli = join(env.dir, "selected-cli.cjs");
      const invocation = join(env.dir, "validator-invocation.json");
      await writeFile(
        selectedCli,
        `const fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(invocation)}, JSON.stringify({args: process.argv.slice(2), cwd: fs.realpathSync(process.cwd())}));\nfs.writeSync(1, JSON.stringify(${JSON.stringify(report)}));\nprocess.exit(${cliExit});\n`,
      );
      const result = await runChild(
        process.execPath,
        [
          await realpath(
            join(
              env.dir,
              ".specify/scripts/node/eai-app-template-readiness.mjs",
            ),
          ),
          "--root",
          env.dir,
          "--source",
          "eai-managed",
          "--cli",
          selectedCli,
          "--json",
        ],
        { cwd: env.dir },
      );
      expect(result.exitCode).toBe(expectedStatus === "passed" ? 0 : 2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ready: expectedStatus === "passed",
        sourceValidation: {
          status: expectedStatus,
          ...(expectedCode ? { code: expectedCode } : {}),
        },
      });
      expect(JSON.parse(await readFile(invocation, "utf8"))).toEqual({
        args: ["deploy", "source", "validate", "--format", "json"],
        cwd: await realpath(env.dir),
      });
      expect(result.stdout + result.stderr).not.toContain(
        "PRIVATE_VALIDATOR_DETAIL",
      );
      expect(existsSync(join(env.dir, ".eai/deployments"))).toBe(false);
    },
  );

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
    await expectFileExists(ctx, ".specify/config/object-type-routing.json");
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
      "platform SDK route owner declared in `.specify/config/object-type-routing.json`",
    );
    await expectFileExists(
      ctx,
      ".specify/schemas/object-type-identifier-audit-v1.schema.json",
    );
    await expectFileExists(
      ctx,
      ".specify/schemas/object-type-routing-phase-bundle-v1.schema.json",
    );
  });

  test("refreshes support guidance for existing projects while preserving project instructions", async () => {
    const supportReference = join(env.dir, ".specify/references/platform/eai-support.md");
    await rm(supportReference);
    const skillPath = join(env.dir, ".agents/skills/eai/SKILL.md");
    const skill = await readFile(skillPath, "utf8");
    await writeFile(skillPath, skill.replace(
      /## Support after an unresolved EAI error\n[\s\S]*?(?=## Verified EAI CLI Command Contract)/,
      "",
    ));
    await writeFile(join(env.dir, "CLAUDE.md"), "# Project notes\nKeep this custom instruction.\n");
    await writeFile(join(env.dir, "AGENTS.md"), "# Agent notes\nKeep this custom instruction.\n");

    const result = await runCommand(ctx, "eai gofer refresh");
    expectCommandSucceeded(result);
    await expectFileContains(ctx, ".specify/references/platform/eai-support.md", "Only after they approve that bundle");
    await expectFileContains(ctx, ".agents/skills/eai/SKILL.md", "--yes --no-open");
    await expectFileContains(ctx, ".grok/skills/eai/SKILL.md", 'say "get help"');
    expect(await readFile(join(env.dir, "CLAUDE.md"), "utf8")).toBe("# Project notes\nKeep this custom instruction.\n");
    expect(await readFile(join(env.dir, "AGENTS.md"), "utf8")).toBe("# Agent notes\nKeep this custom instruction.\n");
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

  test("refuses to force-refresh a managed path through a symbolic link", async () => {
    const seedResult = await runCommand(ctx, "eai gofer refresh");
    expectCommandSucceeded(seedResult);

    const managedFile = join(env.dir, ".github", "copilot-instructions.md");
    const outsideFile = join(env.dir, "outside-managed-target.md");
    await writeFile(outsideFile, "KEEP OUTSIDE CONTENT\n", "utf-8");
    await rm(managedFile);
    await symlink(outsideFile, managedFile);

    const forceResult = await runCommand(ctx, "eai gofer refresh --force");

    expect(forceResult.exitCode).not.toBe(0);
    expect(`${forceResult.stdout}\n${forceResult.stderr}`).toContain(
      "Refusing to refresh Gofer-managed symbolic link",
    );
    expect(await readFile(outsideFile, "utf-8")).toBe("KEEP OUTSIDE CONTENT\n");
  });

  test("preflights generated settings paths before changing managed files", async () => {
    const seedResult = await runCommand(ctx, "eai gofer refresh");
    expectCommandSucceeded(seedResult);

    const managedFile = join(env.dir, ".github", "copilot-instructions.md");
    const original = await readFile(managedFile, "utf-8");
    await writeFile(managedFile, `${original}\nKEEP LOCAL CHANGE\n`, "utf-8");
    const outsideDirectory = join(env.dir, "outside-vscode");
    await mkdir(outsideDirectory);
    await rm(join(env.dir, ".vscode"), { recursive: true, force: true });
    await symlink(outsideDirectory, join(env.dir, ".vscode"));

    const forceResult = await runCommand(ctx, "eai gofer refresh --force");

    expect(forceResult.exitCode).not.toBe(0);
    expect(`${forceResult.stdout}\n${forceResult.stderr}`).toContain(
      "Refusing to refresh Gofer-managed symbolic link",
    );
    expect(await readFile(managedFile, "utf-8")).toContain("KEEP LOCAL CHANGE");
  });

  test("rejects traversal paths from a crafted managed-file manifest", async () => {
    const outsideFile = join(env.dir, "..", `outside-gofer-${Date.now()}.md`);
    await writeFile(outsideFile, "KEEP OUTSIDE\n", "utf-8");
    await writeFile(
      join(env.dir, ".eai-manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        gofer: {
          managedFiles: {
            [relative(env.dir, outsideFile)]: {
              sha256: "invalid",
              source: "generated",
            },
          },
        },
      }),
      "utf-8",
    );

    const result = await runCommand(ctx, "eai gofer refresh --force");

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "Refusing unsafe Gofer-managed path",
    );
    expect(await readFile(outsideFile, "utf-8")).toBe("KEEP OUTSIDE\n");
    await rm(outsideFile, { force: true });
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
    ctx.env.EAI_GOFER_REFRESH_RESOURCES_PATH = await realpath(latestResources);

    const result = await runCommand(
      ctx,
      "eai gofer refresh --check --format json",
    );
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

describe("bundled optional AI tool installers", () => {
  test("record the released Gofer source and exact optional installers", async () => {
    const metadata = JSON.parse(
      await readFile(GOFER_VERSION_FILE, "utf-8"),
    ) as {
      commit?: string;
      describe?: string;
    };

    expect(metadata).toMatchObject({
      commit: GOFER_RELEASE_COMMIT,
      describe: GOFER_RELEASE_TAG,
      source: GOFER_RELEASE_SOURCE,
      dirty: false,
    });

    for (const [relativePath, expectedSha256] of Object.entries(
      GOFER_OPTIONAL_INSTALLER_SHA256,
    )) {
      const contents = await readFile(
        join(BUNDLED_GOFER_RESOURCES, relativePath),
      );
      expect(createHash("sha256").update(contents).digest("hex")).toBe(
        expectedSha256,
      );
    }
  });

  test("match the active .specify installers exactly", async () => {
    const installerPaths = [
      ["bash", "install-optional-tools.sh", "bash-scripts"],
      ["powershell", "install-optional-tools.ps1", "powershell-scripts"],
    ] as const;

    for (const [
      activeDirectory,
      fileName,
      bundledDirectory,
    ] of installerPaths) {
      const [activeInstaller, bundledInstaller] = await Promise.all([
        readFile(
          join(ACTIVE_SPECIFY_RESOURCES, activeDirectory, fileName),
          "utf-8",
        ),
        readFile(
          join(BUNDLED_GOFER_RESOURCES, bundledDirectory, fileName),
          "utf-8",
        ),
      ]);

      expect(activeInstaller).toBe(bundledInstaller);
    }
  });

  test("use current provider-owned CLI installers and never install Gemini as Antigravity", async () => {
    const bashInstaller = await readFile(
      join(
        BUNDLED_GOFER_RESOURCES,
        "bash-scripts",
        "install-optional-tools.sh",
      ),
      "utf-8",
    );
    const powershellInstaller = await readFile(
      join(
        BUNDLED_GOFER_RESOURCES,
        "powershell-scripts",
        "install-optional-tools.ps1",
      ),
      "utf-8",
    );
    const installers = `${bashInstaller}\n${powershellInstaller}`;

    for (const url of [
      "https://antigravity.google/cli/install.sh",
      "https://antigravity.google/cli/install.ps1",
      "https://claude.ai/install.sh",
      "https://claude.ai/install.ps1",
      "https://chatgpt.com/codex/install.sh",
      "https://chatgpt.com/codex/install.ps1",
      "https://x.ai/cli/install.sh",
      "https://x.ai/cli/install.ps1",
    ]) {
      expect(installers).toContain(url);
    }
    expect(installers).toContain("@github/copilot@1.0.83");
    expect(installers).toContain(
      "sha512-M8uZI0V0dahYV1KZij3nGDxaXEGG7I7YUZzQPI7NEZkL/83Nl/tNTbPdxKtdWZbOmWoXsPKXty/eEYoj6RHDhA==",
    );
    expect(installers).toContain("https://registry.npmjs.org/");
    expect(installers).not.toContain("@google/gemini-cli");
    expect(installers).not.toContain("@openai/codex-cli");
    expect(installers).not.toContain("@anthropic-ai/claude-code");
    expect(installers).toContain("claude auth login");
    expect(installers).not.toMatch(/\bclaude login\b/);
    expect(bashInstaller).toContain(
      "--proto '=https' --proto-redir '=https' --tlsv1.2",
    );
    expect(bashInstaller).toContain(
      "--max-redirs 5 --connect-timeout 15 --max-time 120 --max-filesize 1048576",
    );
    expect(bashInstaller).toContain(
      "Refusing $tool_name installer because its SHA-256 digest changed",
    );
    expect(bashInstaller).toContain("compute_sha256 /dev/fd/8");
    expect(bashInstaller).toContain(
      'run_sanitized_installer "$shell_name" /dev/fd/9',
    );
    expect(bashInstaller).toContain("INSTALLER_TIMEOUT_SECONDS=900");
    expect(bashInstaller).toContain("validate_installed_cli");
    expect(bashInstaller).toContain("apt-cache show azure-cli >/dev/null 2>&1");
    expect(bashInstaller).toContain(
      "Azure CLI is unavailable from the configured apt repositories",
    );
    expect(powershellInstaller).toContain(
      "$handler.AllowAutoRedirect = $false",
    );
    expect(powershellInstaller).toContain(
      "$allowedOrigins -cnotcontains $currentOrigin",
    );
    expect(powershellInstaller).toContain(
      "$sha256.ComputeHash($installerBytes)",
    );
    expect(powershellInstaller).toContain(
      "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command -",
    );
    expect(powershellInstaller).toContain(
      "$startInfo.RedirectStandardInput = $true",
    );
    expect(powershellInstaller).toContain(
      "$startInfo.EnvironmentVariables.Clear()",
    );
    expect(powershellInstaller).toContain(
      "CopyToAsync([System.IO.Stream]::Null)",
    );
    expect(powershellInstaller).toContain("[DateTime]::UtcNow.AddMinutes(15)");
    expect(powershellInstaller).toContain("Test-InstalledCli");
    expect(powershellInstaller).not.toContain("Invoke-Expression");
  });

  test("pins every provider bootstrap and suppresses untrusted installer output", async () => {
    const bashInstaller = await readFile(
      join(
        BUNDLED_GOFER_RESOURCES,
        "bash-scripts",
        "install-optional-tools.sh",
      ),
      "utf-8",
    );
    const powershellInstaller = await readFile(
      join(
        BUNDLED_GOFER_RESOURCES,
        "powershell-scripts",
        "install-optional-tools.ps1",
      ),
      "utf-8",
    );

    expect(
      bashInstaller.match(/^[ \t]*"[0-9a-f]{64}"[ \t]*\\?$/gm),
    ).toHaveLength(4);
    expect(
      powershellInstaller.match(/-ExpectedSha256 '[0-9a-f]{64}'/g),
    ).toHaveLength(4);
    expect(bashInstaller).toContain(">/dev/null 2>&1");
    expect(powershellInstaller).toContain(
      "$startInfo.RedirectStandardOutput = $true",
    );
    expect(powershellInstaller).toContain(
      "$startInfo.RedirectStandardError = $true",
    );
    expect(powershellInstaller).toContain("ConvertTo-SafeDiagnostic");
    expect(powershellInstaller).toContain(
      "if ([string]::IsNullOrEmpty($Message))",
    );
    expect(powershellInstaller).toContain(
      "return 'No diagnostic details were provided.'",
    );
  });

  test("rejects malformed Bash options and does not echo untrusted option contents", async () => {
    const bashInstaller = join(
      BUNDLED_GOFER_RESOURCES,
      "bash-scripts",
      "install-optional-tools.sh",
    );
    const cases = [
      ["--tools"],
      ["--workspace-path", "--unexpected"],
      ["--unknown", "credential=do-not-print"],
    ];

    for (const args of cases) {
      const result = await runChild("/bin/bash", [bashInstaller, ...args], {
        cwd: BUNDLED_GOFER_RESOURCES,
        env: { ...process.env, HOME: BUNDLED_GOFER_RESOURCES },
      });
      expect(result.exitCode).toBe(64);
      expect(`${result.stdout}${result.stderr}`).not.toContain(
        "credential=do-not-print",
      );
    }
  });

  const powershellPath = ["/usr/bin/pwsh", "/opt/homebrew/bin/pwsh"].find(
    existsSync,
  );
  test.runIf(Boolean(powershellPath))(
    "does not validate Copilot after its PowerShell npm install fails",
    async () => {
      const fixtureRoot = await mkdtemp(
        join(tmpdir(), "eai-optional-installer-test-"),
      );
      const fakeNpm = join(fixtureRoot, "npm");
      const callLog = join(fixtureRoot, "npm-calls.txt");
      try {
        await writeFile(
          fakeNpm,
          `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_NPM_LOG"
case "$1" in
  view)
    printf '%s\\n' '"sha512-M8uZI0V0dahYV1KZij3nGDxaXEGG7I7YUZzQPI7NEZkL/83Nl/tNTbPdxKtdWZbOmWoXsPKXty/eEYoj6RHDhA=="'
    exit 0
    ;;
  install)
    exit 23
    ;;
  *)
    exit 99
    ;;
esac
`,
          "utf-8",
        );
        await chmod(fakeNpm, 0o755);

        const powershellInstaller = join(
          BUNDLED_GOFER_RESOURCES,
          "powershell-scripts",
          "install-optional-tools.ps1",
        );
        const result = await runChild(
          powershellPath as string,
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            powershellInstaller,
            "-WorkspacePath",
            fixtureRoot,
            "-Tools",
            "copilot",
          ],
          {
            cwd: fixtureRoot,
            // Hosted Linux PowerShell can cold start under concurrent tests.
            timeoutMs: process.platform === "linux" ? 30_000 : 15_000,
            env: {
              ...process.env,
              PATH: `${fixtureRoot}:/usr/bin:/bin`,
              HOME: fixtureRoot,
              USERPROFILE: fixtureRoot,
              FAKE_NPM_LOG: callLog,
            },
          },
        );

        expect(result.exitCode).not.toBe(124);
        expect(existsSync(callLog)).toBe(true);
        const npmCalls = await readFile(callLog, "utf-8");
        expect(result.exitCode).toBe(1);
        expect(npmCalls).toContain("install --global");
        expect(npmCalls).not.toContain("prefix --global");
        expect(`${result.stdout}${result.stderr}`).not.toContain(
          "Validating the installed GitHub Copilot CLI executable path",
        );
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    },
    40_000,
  );
});

describe("current AI workspace documentation", () => {
  test("lists exactly six graphical surfaces followed by five CLI surfaces", async () => {
    const source = await readFile(START_HERE_DOCUMENT, "utf-8");
    const catalogSection = source
      .split("Current handoff support, in catalog order:")[1]
      ?.split("\n\nOn Linux")[0];
    expect(catalogSection).toBeTruthy();
    const labels = [...(catalogSection ?? "").matchAll(/^\| ([^|]+?) \|/gm)]
      .map((match) => match[1])
      .filter((label) => label !== "AI workspace");

    expect(labels).toEqual([
      "GitHub Copilot in VS Code",
      "GitHub Copilot app",
      "Google Antigravity 2.0",
      "Claude Desktop",
      "ChatGPT desktop (Codex)",
      "Grok Bot",
      "GitHub Copilot CLI",
      "Antigravity CLI (`agy`)",
      "Claude Code",
      "Codex CLI",
      "Grok Build",
    ]);
    expect(catalogSection).not.toMatch(/Gemini/i);
  });
});
