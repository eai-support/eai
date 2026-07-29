import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  createTestEnvironment,
  type TestEnvironment,
} from "../helpers/test-env.js";

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface DescribeOption {
  name?: unknown;
  type?: unknown;
  description?: unknown;
  values?: unknown;
}

interface DescribeCommand {
  command?: unknown;
  description?: unknown;
  aliases?: unknown;
  options?: unknown;
  subcommands?: unknown;
}

const cliEntry = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

const TOP_LEVEL_COMMANDS = [
  "init",
  "dev",
  "login",
  "logout",
  "env",
  "types",
  "tenant",
  "user",
  "resources",
  "app",
  "chat",
  "workflow",
  "docs",
  "deploy",
  "runtime",
  "verify",
  "doctor",
  "whoami",
  "update",
  "provision",
  "gofer",
  "template",
  "blocks",
  "publicapi",
  "errors",
  "agent",
] as const;

const SOURCE_UNKNOWN_APP_FLAGS: Readonly<Record<string, readonly string[]>> = {
  "connect-existing": [
    "--repo",
    "--tenant-id",
    "--repo-url",
    "--branch",
    "--workflow",
    "--ref",
    "--commit",
    "--config",
    "--runtime",
    "--template-version",
    "--base-template-sha",
    "--approved-source-sha",
    "--approved-release",
    "--schema-digest",
    "--validator-digest",
    "--skip-validate",
    "--format",
    "--json",
  ],
  "adopt-observed": [
    "--repo",
    "--url",
    "--tenant-id",
    "--repo-url",
    "--environment",
    "--branch",
    "--workflow",
    "--ref",
    "--commit",
    "--config",
    "--runtime",
    "--template-version",
    "--base-template-sha",
    "--approved-source-sha",
    "--approved-release",
    "--schema-digest",
    "--validator-digest",
    "--deployment-id",
    "--image-digest",
    "--config-hash",
    "--observed-at",
    "--skip-validate",
    "--format",
    "--json",
  ],
  "workflow-setup": [
    "--tenant-id",
    "--environment",
    "--workflow",
    "--ref",
    "--commit",
    "--config-hash",
    "--skip-validate",
    "--format",
    "--json",
  ],
  "workflow-evidence": [
    "--repo",
    "--operation-id",
    "--nonce",
    "--commit",
    "--config-hash",
    "--artifact-digest",
    "--image-digest",
    "--tenant-id",
    "--environment",
    "--branch",
    "--workflow",
    "--ref",
    "--template-version",
    "--base-template-sha",
    "--approved-source-sha",
    "--approved-release",
    "--schema-digest",
    "--validator-digest",
    "--workflow-run-id",
    "--workflow-run-attempt",
    "--github-oidc-token",
    "--github-oidc-audience",
    "--skip-validate",
    "--format",
    "--json",
  ],
  "deploy-source-unknown": [
    "--operation-id",
    "--tenant-id",
    "--environment",
    "--repo",
    "--workflow",
    "--ref",
    "--commit",
    "--workflow-run-id",
    "--config-hash",
    "--artifact-digest",
    "--image-digest",
    "--target-kind",
    "--release-channel",
    "--skip-validate",
    "--format",
    "--json",
  ],
  "deploy-source-unknown-status": [
    "--tenant-id",
    "--skip-validate",
    "--format",
    "--json",
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateOption(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return;
  }

  const option = value as DescribeOption;
  for (const field of ["name", "type", "description"] as const) {
    if (typeof option[field] !== "string") {
      issues.push(`${path}.${field} must be a string`);
    }
  }
  if (
    option.values !== undefined &&
    (!Array.isArray(option.values) ||
      option.values.some((item) => typeof item !== "string"))
  ) {
    issues.push(`${path}.values must be an array of strings when present`);
  }
}

function validateCommand(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return;
  }

  const command = value as DescribeCommand;
  if (typeof command.command !== "string" || command.command.length === 0) {
    issues.push(`${path}.command must be a non-empty string`);
  }
  if (typeof command.description !== "string") {
    issues.push(`${path}.description must be a string`);
  }
  if (
    !Array.isArray(command.aliases) ||
    command.aliases.some((item) => typeof item !== "string")
  ) {
    issues.push(`${path}.aliases must be an array of strings`);
  }
  if (!Array.isArray(command.options)) {
    issues.push(`${path}.options must be an array`);
  } else {
    command.options.forEach((option, index) =>
      validateOption(option, `${path}.options[${index}]`, issues),
    );
  }
  if (command.subcommands !== undefined) {
    if (!Array.isArray(command.subcommands)) {
      issues.push(`${path}.subcommands must be an array when present`);
    } else {
      command.subcommands.forEach((child, index) => {
        validateCommand(child, `${path}.subcommands[${index}]`, issues);
      });
    }
  }
}

function childCommands(command: DescribeCommand): DescribeCommand[] {
  return Array.isArray(command.subcommands)
    ? (command.subcommands.filter(isRecord) as DescribeCommand[])
    : [];
}

function optionNames(command: DescribeCommand): string[] {
  return Array.isArray(command.options)
    ? command.options
        .filter(isRecord)
        .map((option) => option.name)
        .filter((name): name is string => typeof name === "string")
    : [];
}

function findCommand(
  command: DescribeCommand,
  commandPath: readonly string[],
): DescribeCommand | undefined {
  const [head, ...tail] = commandPath;
  const child = childCommands(command).find(
    (candidate) => candidate.command === head,
  );
  if (!child || tail.length === 0) return child;
  return findCommand(child, tail);
}

function runCli(args: readonly string[], cwd: string): Promise<CliResult> {
  const env = {
    ...process.env,
    HOME: cwd,
    USERPROFILE: cwd,
    EAI_ACCESS_TOKEN: "",
    EAI_NON_INTERACTIVE: "1",
    EAI_PROFILE: "default",
    NO_UPDATE_NOTIFIER: "1",
  };

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [cliEntry, ...args],
      { cwd, env, encoding: "utf8", timeout: 10_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({
          exitCode: error && typeof error.code === "number" ? error.code : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

describe("built CLI discovery and error contracts", () => {
  let testEnvironment: TestEnvironment;

  beforeEach(async () => {
    testEnvironment = await createTestEnvironment();
  });

  afterEach(async () => {
    await testEnvironment.cleanup();
  });

  test("--describe preserves the recursive command schema", async () => {
    const result = await runCli(["--describe"], testEnvironment.dir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const schema = JSON.parse(result.stdout) as unknown;
    const issues: string[] = [];
    validateCommand(schema, "describe", issues);
    expect(issues).toEqual([]);
    expect(childCommands(schema as DescribeCommand).length).toBeGreaterThan(10);
  });

  test("--describe preserves the exact top-level command set", async () => {
    const result = await runCli(["--describe"], testEnvironment.dir);
    const schema = JSON.parse(result.stdout) as DescribeCommand;
    const actual = childCommands(schema)
      .map((command) => command.command)
      .filter((name): name is string => typeof name === "string")
      .sort();

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(actual).toEqual([...TOP_LEVEL_COMMANDS].sort());
  });

  test("--describe preserves source-unknown app commands and their exact flags", async () => {
    const result = await runCli(["--describe"], testEnvironment.dir);
    const schema = JSON.parse(result.stdout) as DescribeCommand;

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    for (const [commandName, expectedFlags] of Object.entries(
      SOURCE_UNKNOWN_APP_FLAGS,
    )) {
      const command = findCommand(schema, ["app", commandName]);
      expect(
        command,
        `expected --describe to include app ${commandName}`,
      ).toBeDefined();
      expect(optionNames(command ?? {}).sort()).toEqual(
        [...expectedFlags].sort(),
      );
    }
  });

  test.each([
    {
      code: "E001",
      args: ["verify", "calls"],
      message: /not in an EAI project/i,
      suggestion: /eai init/i,
    },
    {
      code: "E101",
      args: ["tenant", "list"],
      message: /not logged in/i,
      suggestion: /eai login/i,
    },
  ])(
    "$code keeps the established text error contract",
    async ({ code, args, message, suggestion }) => {
      const result = await runCli(args, testEnvironment.dir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(message);
      expect(result.stderr).toMatch(suggestion);
      expect(result.stderr).toMatch(new RegExp(`Error code: ${code}`));
      expect(() => JSON.parse(result.stderr)).toThrow();
    },
  );

  test("E305 keeps the structured JSON error envelope", async () => {
    const result = await runCli(
      ["blocks", "describe", "definitely-not-a-real-block", "--format", "json"],
      testEnvironment.dir,
    );
    const envelope = JSON.parse(result.stderr) as {
      error: {
        code: string;
        message: string;
        suggestion: string;
        exitCode: number;
      };
    };

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(envelope).toEqual({
      error: {
        code: "E305",
        message: expect.stringMatching(/unknown block|invalid input/i),
        suggestion: expect.stringMatching(/check your input/i),
        exitCode: 1,
      },
    });
  });
});
