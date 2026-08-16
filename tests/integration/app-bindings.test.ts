import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { appCommand } from "../../src/commands/vertical.js";
import { loadAppCapabilityRequirements } from "../../src/commands/app-bindings.js";

describe("eai app bindings command schema", () => {
  test("exposes list, set, remove, and readiness validation", () => {
    const bindings = appCommand.commands.find(
      (command) => command.name() === "bindings",
    );
    expect(bindings?.commands.map((command) => command.name())).toEqual([
      "list",
      "set",
      "remove",
      "validate",
    ]);
  });

  test("auto-discovers the canonical generated requirements manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "eai-bindings-"));
    const configDir = join(root, "src", "eai.config");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "capabilities.generated.json"),
      JSON.stringify({
        schemaVersion: "eai.app_capabilities.v1",
        appKey: "rates-review",
        requirements: [
          {
            alias: "primary-workflow",
            capability: "workflows.runtime",
            required: true,
            description: "Workflow executed by the generated application.",
          },
        ],
      }),
    );
    try {
      await expect(
        loadAppCapabilityRequirements("rates-review", undefined, root),
      ).resolves.toEqual(expect.objectContaining({ appKey: "rates-review" }));
      await expect(
        loadAppCapabilityRequirements("another-app", undefined, root),
      ).rejects.toThrow(/do not match app another-app/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    ["unknown root field", { unexpected: true }],
    [
      "duplicate alias",
      {
        requirements: [
          {
            alias: "primary-workflow",
            capability: "workflows.runtime",
            required: true,
            description: "One",
          },
          {
            alias: "primary-workflow",
            capability: "workflows.runtime",
            required: false,
            description: "Two",
          },
        ],
      },
    ],
    [
      "unbounded alias",
      {
        requirements: [
          {
            alias: "x".repeat(121),
            capability: "workflows.runtime",
            required: true,
            description: "Workflow",
          },
        ],
      },
    ],
  ])("rejects a malformed canonical manifest: %s", async (_case, override) => {
    const root = await mkdtemp(join(tmpdir(), "eai-bindings-invalid-"));
    const manifestPath = join(root, "capabilities.json");
    const base = {
      schemaVersion: "eai.app_capabilities.v1",
      appKey: "rates-review",
      requirements: [
        {
          alias: "primary-workflow",
          capability: "workflows.runtime",
          required: true,
          description: "Workflow executed by the generated application.",
        },
      ],
    };
    await writeFile(manifestPath, JSON.stringify({ ...base, ...override }));
    try {
      await expect(
        loadAppCapabilityRequirements("rates-review", manifestPath, root),
      ).rejects.toThrow(/do not match app rates-review/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
