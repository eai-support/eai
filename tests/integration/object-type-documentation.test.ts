import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Object Type identifier documentation", () => {
  test.each([
    "README.md",
    "EAI_CLI_CHEATSHEET.md",
    ".tech-docs/start-here.md",
    ".tech-docs/eai-app-template.md",
    ".tech-docs/api-reference.md",
  ])("keeps model names and stored slugs distinct in %s", (relativePath) => {
    const documentation = readRepoFile(relativePath);

    expect(documentation).toContain("PascalCase");
    expect(documentation).toMatch(/lowercase\s+kebab-case/);
    expect(documentation).toMatch(
      /exact (published |stored )?(Object Type )?slug/i,
    );
  });

  test("uses the exact slug in the task tracker publication example", () => {
    const example = readRepoFile(".tech-docs/examples/task-tracker.md");

    expect(example).toContain('name: "Task"');
    expect(example).toContain('slug: "task"');
    expect(example).toContain("--resource-type task");
    expect(example).not.toContain("--resource-type Task");
  });

  test.each([
    "resources/gofer/references/platform/eai-app-template.md",
    "resources/gofer/references/platform/eai-service-patterns.md",
    "resources/gofer/references/platform/eai-repo-contract.md",
  ])("keeps installed agent guidance slug-safe in %s", (relativePath) => {
    const guidance = readRepoFile(relativePath);

    expect(guidance).toContain("PascalCase");
    expect(guidance).toContain("stored `slug`");
    expect(guidance).toMatch(/historical stored slug/i);
  });
});
