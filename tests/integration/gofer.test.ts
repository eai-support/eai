import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
} from "../helpers/assert-dsl.js";
import { installGoferResources } from "../../src/lib/gofer-installer.js";

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
const GOFER_BASE_COMMIT = "6059c0e61377f648a9470b3554ae689e6912ec24";
const GOFER_OPTIONAL_INSTALLER_OVERLAY_COMMIT = "03f3c5d7c6a0aa1121f85b0da4a31cdfe1218b8d";
const GOFER_OPTIONAL_INSTALLER_SHA256 = {
  "bash-scripts/install-optional-tools.sh": "9b870c7c803df01738a614aab115e41e1e880d08244992e905694456ee73abac",
  "powershell-scripts/install-optional-tools.ps1": "a7fbfefad761074480f634504fb88d6739050ac95c501dd1d59380e258879811",
} as const;

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

  test("installs the source-pinned document lifecycle guidance without changing the base Gofer pin", async () => {
    const metadata = JSON.parse(await readFile(GOFER_VERSION_FILE, 'utf8'));
    expect(metadata.commit).toBe(GOFER_BASE_COMMIT);
    expect(metadata.document_lifecycle_overlay).toMatchObject({
      commit: 'b9cc180288efbf857b763cf1e2565ec093f15765',
      source: 'https://github.com/eai-support/eai-gofer',
      section: 'Document Lifecycle Rules',
      dirty: false,
    });
    const relativePath = 'references/platform/eai-service-patterns.md';
    const bundled = await readFile(join(BUNDLED_GOFER_RESOURCES, relativePath), 'utf8');
    const section = '## Document Lifecycle Rules\n' + bundled
      .split('## Document Lifecycle Rules\n')[1].split('\n## Storage Backend Rules')[0].trimEnd() + '\n';
    expect(createHash('sha256').update(section).digest('hex'))
      .toBe(metadata.document_lifecycle_overlay.section_sha256);
    const installed = await readFile(join(env.dir, '.specify', relativePath), 'utf8');
    expect(installed).toContain(section.trimEnd());
    expect(installed).toContain('business-document-v1');
    expect(installed).toContain('Preserve working DAISY/Assess');
    expect(installed).toContain('never re-upload automatically');
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
  test("record clean composite provenance for the exact optional-installer overlay", async () => {
    const metadata = JSON.parse(await readFile(GOFER_VERSION_FILE, "utf-8")) as {
      commit?: string;
      source?: string;
      dirty?: boolean;
      overlay_source?: string;
      overlay_commit?: string;
      overlays?: string[];
    };

    expect(metadata).toMatchObject({
      commit: GOFER_BASE_COMMIT,
      source: `https://github.com/eai-support/eai-gofer.git@${GOFER_BASE_COMMIT}`,
      dirty: false,
      overlay_source: `https://github.com/eai-support/eai-gofer.git@${GOFER_OPTIONAL_INSTALLER_OVERLAY_COMMIT}`,
      overlay_commit: GOFER_OPTIONAL_INSTALLER_OVERLAY_COMMIT,
      overlays: Object.keys(GOFER_OPTIONAL_INSTALLER_SHA256),
    });

    for (const [relativePath, expectedSha256] of Object.entries(GOFER_OPTIONAL_INSTALLER_SHA256)) {
      const contents = await readFile(join(BUNDLED_GOFER_RESOURCES, relativePath));
      expect(createHash("sha256").update(contents).digest("hex")).toBe(expectedSha256);
    }
  });

  test("match the active .specify installers exactly", async () => {
    const installerPaths = [
      ["bash", "install-optional-tools.sh", "bash-scripts"],
      ["powershell", "install-optional-tools.ps1", "powershell-scripts"],
    ] as const;

    for (const [activeDirectory, fileName, bundledDirectory] of installerPaths) {
      const [activeInstaller, bundledInstaller] = await Promise.all([
        readFile(join(ACTIVE_SPECIFY_RESOURCES, activeDirectory, fileName), "utf-8"),
        readFile(join(BUNDLED_GOFER_RESOURCES, bundledDirectory, fileName), "utf-8"),
      ]);

      expect(activeInstaller).toBe(bundledInstaller);
    }
  });

  test("use current provider-owned CLI installers and never install Gemini as Antigravity", async () => {
    const bashInstaller = await readFile(
      join(BUNDLED_GOFER_RESOURCES, "bash-scripts", "install-optional-tools.sh"),
      "utf-8",
    );
    const powershellInstaller = await readFile(
      join(BUNDLED_GOFER_RESOURCES, "powershell-scripts", "install-optional-tools.ps1"),
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
    expect(installers).toContain("sha512-M8uZI0V0dahYV1KZij3nGDxaXEGG7I7YUZzQPI7NEZkL/83Nl/tNTbPdxKtdWZbOmWoXsPKXty/eEYoj6RHDhA==");
    expect(installers).toContain("https://registry.npmjs.org/");
    expect(installers).not.toContain("@google/gemini-cli");
    expect(installers).not.toContain("@openai/codex-cli");
    expect(installers).not.toContain("@anthropic-ai/claude-code");
    expect(installers).toContain("claude auth login");
    expect(installers).not.toMatch(/\bclaude login\b/);
    expect(bashInstaller).toContain("--proto '=https' --proto-redir '=https' --tlsv1.2");
    expect(bashInstaller).toContain("--max-redirs 5 --connect-timeout 15 --max-time 120 --max-filesize 1048576");
    expect(bashInstaller).toContain("Refusing $tool_name installer because its SHA-256 digest changed");
    expect(bashInstaller).toContain("compute_sha256 /dev/fd/8");
    expect(bashInstaller).toContain("run_sanitized_installer \"$shell_name\" /dev/fd/9");
    expect(bashInstaller).toContain("INSTALLER_TIMEOUT_SECONDS=900");
    expect(bashInstaller).toContain("validate_installed_cli");
    expect(bashInstaller).toContain("apt-cache show azure-cli >/dev/null 2>&1");
    expect(bashInstaller).toContain("Azure CLI is unavailable from the configured apt repositories");
    expect(powershellInstaller).toContain("$handler.AllowAutoRedirect = $false");
    expect(powershellInstaller).toContain("$allowedOrigins -cnotcontains $currentOrigin");
    expect(powershellInstaller).toContain("$sha256.ComputeHash($installerBytes)");
    expect(powershellInstaller).toContain("-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command -");
    expect(powershellInstaller).toContain("$startInfo.RedirectStandardInput = $true");
    expect(powershellInstaller).toContain("$startInfo.EnvironmentVariables.Clear()");
    expect(powershellInstaller).toContain("CopyToAsync([System.IO.Stream]::Null)");
    expect(powershellInstaller).toContain("[DateTime]::UtcNow.AddMinutes(15)");
    expect(powershellInstaller).toContain("Test-InstalledCli");
    expect(powershellInstaller).not.toContain("Invoke-Expression");
  });

  test("pins every provider bootstrap and suppresses untrusted installer output", async () => {
    const bashInstaller = await readFile(
      join(BUNDLED_GOFER_RESOURCES, "bash-scripts", "install-optional-tools.sh"),
      "utf-8",
    );
    const powershellInstaller = await readFile(
      join(BUNDLED_GOFER_RESOURCES, "powershell-scripts", "install-optional-tools.ps1"),
      "utf-8",
    );

    expect(bashInstaller.match(/^[ \t]*"[0-9a-f]{64}"[ \t]*\\?$/gm)).toHaveLength(4);
    expect(powershellInstaller.match(/-ExpectedSha256 '[0-9a-f]{64}'/g)).toHaveLength(4);
    expect(bashInstaller).toContain('>/dev/null 2>&1');
    expect(powershellInstaller).toContain('$startInfo.RedirectStandardOutput = $true');
    expect(powershellInstaller).toContain('$startInfo.RedirectStandardError = $true');
    expect(powershellInstaller).toContain('ConvertTo-SafeDiagnostic');
    expect(powershellInstaller).toContain("if ([string]::IsNullOrEmpty($Message))");
    expect(powershellInstaller).toContain("return 'No diagnostic details were provided.'");
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
      expect(`${result.stdout}${result.stderr}`).not.toContain("credential=do-not-print");
    }
  });

  const powershellPath = ["/usr/bin/pwsh", "/opt/homebrew/bin/pwsh"].find(existsSync);
  test.runIf(Boolean(powershellPath))(
    "does not validate Copilot after its PowerShell npm install fails",
    async () => {
      const fixtureRoot = await mkdtemp(join(tmpdir(), "eai-optional-installer-test-"));
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
            // PowerShell cold starts on hosted Linux runners can exceed the
            // generic child-process timeout before the fixture npm is invoked.
            timeoutMs: 15_000,
            env: {
              ...process.env,
              PATH: `${fixtureRoot}:/usr/bin:/bin`,
              HOME: fixtureRoot,
              USERPROFILE: fixtureRoot,
              FAKE_NPM_LOG: callLog,
            },
          },
        );

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
    20_000,
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
