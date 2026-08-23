import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  GOFER_EXTRA_RESOURCE_MAPPINGS as LINKED_SOURCE_RESOURCE_MAPPINGS,
  GOFER_REPO,
  assertCrossPlatformTemplateLifecycleScripts,
  extractEnterprisePackageVersions,
  hashJson,
  parseScopedRegistry,
} from "../../scripts/sync-linked-sources.js";
import {
  DEFAULT_GOFER_RELEASE_MANIFEST_URL,
  DEFAULT_GOFER_REPO_URL,
  GOFER_EXTRA_RESOURCE_MAPPINGS as RUNTIME_RESOURCE_MAPPINGS,
} from "../../src/lib/gofer-refresh.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

interface TextFile {
  path: string;
  contents: string;
}

async function readFilesRecursively(root: string): Promise<TextFile[]> {
  const files: TextFile[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readFilesRecursively(entryPath)));
    } else if (entry.isFile()) {
      files.push({
        path: entryPath,
        contents: await readFile(entryPath, "utf-8"),
      });
    }
  }
  return files;
}

describe("extractEnterprisePackageVersions", () => {
  test("keeps only @enterpriseaigroup packages with stable ordering", () => {
    const packages = extractEnterprisePackageVersions({
      packages: {
        "node_modules/lodash": { version: "4.17.21" },
        "node_modules/@enterpriseaigroup/demo": {
          version: "1.0.57",
          resolved: "https://example.test/demo-1.0.57.tgz",
        },
        "node_modules/@enterpriseaigroup/core": {
          version: "1.0.68",
          resolved: "https://example.test/core-1.0.68.tgz",
        },
      },
    });

    expect(packages).toEqual({
      "@enterpriseaigroup/core": {
        version: "1.0.68",
        resolved: "https://example.test/core-1.0.68.tgz",
      },
      "@enterpriseaigroup/demo": {
        version: "1.0.57",
        resolved: "https://example.test/demo-1.0.57.tgz",
      },
    });
  });
});

describe("parseScopedRegistry", () => {
  test("reads the scoped registry from npmrc content", () => {
    expect(
      parseScopedRegistry(`
      # comment
      @enterpriseaigroup:registry=https://enterpriseaigroup.github.io/enterpriseai-packages/registry
    `),
    ).toBe(
      "https://enterpriseaigroup.github.io/enterpriseai-packages/registry",
    );
  });

  test("returns null when the scope is not configured", () => {
    expect(
      parseScopedRegistry("registry=https://registry.npmjs.org/"),
    ).toBeNull();
  });
});

describe("hashJson", () => {
  test("is stable for identical payloads", () => {
    const payload = {
      "@enterpriseaigroup/core": { version: "1.0.68", resolved: null },
      "@enterpriseaigroup/demo": { version: "1.0.57", resolved: null },
    };

    expect(hashJson(payload)).toBe(hashJson(payload));
  });
});

describe("app template lifecycle scripts", () => {
  test("accepts package-manager-neutral lifecycle commands", () => {
    expect(() =>
      assertCrossPlatformTemplateLifecycleScripts({
        scripts: { prepare: "husky" },
      }),
    ).not.toThrow();
  });

  test("rejects POSIX shell conditionals before capturing a template release", () => {
    expect(() =>
      assertCrossPlatformTemplateLifecycleScripts({
        scripts: { prepare: 'if [ "$HUSKY" != "0" ]; then husky; fi' },
      }),
    ).toThrow(/shell-specific lifecycle scripts.*prepare/);
  });
});

describe("Gofer source ownership", () => {
  test("keeps linked-source and runtime resource normalization aligned", () => {
    expect(LINKED_SOURCE_RESOURCE_MAPPINGS).toEqual(
      RUNTIME_RESOURCE_MAPPINGS,
    );
    expect(LINKED_SOURCE_RESOURCE_MAPPINGS).toEqual(
      expect.arrayContaining([
        [".specify/config", "config"],
        [".specify/contracts", "contracts"],
        [".specify/schemas", "schemas"],
      ]),
    );
  });

  test("uses eai-support for source sync and runtime refresh defaults", async () => {
    expect(GOFER_REPO).toBe("https://github.com/eai-support/eai-gofer.git");
    expect(DEFAULT_GOFER_REPO_URL).toBe(
      "https://github.com/eai-support/eai-gofer.git",
    );
    expect(DEFAULT_GOFER_RELEASE_MANIFEST_URL).toBe(
      "https://eai-support.github.io/eai-gofer/releases/plugins/eai-gofer/gemini-extension.json",
    );

    const linkedSources = JSON.parse(
      await readFile(
        join(REPO_ROOT, "resources", "linked-sources.json"),
        "utf-8",
      ),
    ) as { gofer?: { repo?: string } };
    expect(linkedSources.gofer?.repo).toBe(
      "https://github.com/eai-support/eai-gofer.git",
    );

    const syncScriptPath = join(
      REPO_ROOT,
      "scripts",
      "sync-gofer-resources.cjs",
    );
    const activeSourceFiles: TextFile[] = [
      {
        path: syncScriptPath,
        contents: await readFile(syncScriptPath, "utf-8"),
      },
      ...(await readFilesRecursively(join(REPO_ROOT, "resources", "gofer"))),
    ];
    const retiredUrls = [
      "https://github.com/eai-tools/eai-gofer",
      "https://eai-tools.github.io/eai-gofer",
    ];
    const violations = activeSourceFiles.flatMap(({ path, contents }) =>
      retiredUrls
        .filter((url) => contents.includes(url))
        .map((url) => ({ path, url })),
    );
    expect(violations).toEqual([]);
  });
});
