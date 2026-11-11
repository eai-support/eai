import { readFile, readdir } from "node:fs/promises";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
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
  selectLatestReleaseTag,
  buildManagedDeployProducerBundle,
  buildTemplateMetadata,
  syncGoferResourcesFromCheckout,
  writeManagedDeployProducerBundle,
} from "../../scripts/sync-linked-sources.js";
import {
  DEFAULT_GOFER_RELEASE_MANIFEST_URL,
  DEFAULT_GOFER_REPO_URL,
  GOFER_EXTRA_RESOURCE_MAPPINGS as RUNTIME_RESOURCE_MAPPINGS,
} from "../../src/lib/gofer-refresh.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const { goferResourceTreeSha256 } = createRequire(import.meta.url)("../../scripts/lib/gofer-bundle-identity.cjs") as {
  goferResourceTreeSha256: (root: string) => string;
};

describe("linked source bundle consistency", () => {
  test("captures producer bytes and template metadata from the same exact checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "linked-template-pin-"));
    try {
      const source = join(root, "source");
      const output = join(root, "bundle");
      cpSync(join(REPO_ROOT, "resources/deploy/eai-app-template"), source, { recursive: true });
      writeFileSync(join(source, "package.json"), JSON.stringify({ scripts: { prepare: "husky" } }));
      writeFileSync(join(source, "package-lock.json"), JSON.stringify({ packages: {} }));
      const git = (...args: string[]) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
      git("init", "-b", "main");
      git("config", "user.name", "Controlled fixture");
      git("config", "user.email", "fixture@example.invalid");
      git("add", ".");
      git("commit", "-m", "canonical fixture");
      git("tag", "v9.8.7");
      const commit = git("rev-parse", "HEAD");
      const template = buildTemplateMetadata(source, "v9.8.7");
      const bundle = buildManagedDeployProducerBundle(source, "v9.8.7");
      writeManagedDeployProducerBundle(bundle, output);
      const pin = JSON.parse(readFileSync(join(output, "producer-pin.json"), "utf8"));
      expect(pin.candidate.commit).toBe(commit);
      expect(template.commit).toBe(commit);
      expect(template.version).toBe(pin.releaseGate.tag);
      for (const file of Object.values(bundle.files) as Array<{ path: string; bytes: Buffer; sha256: string }>) {
        expect(readFileSync(join(output, file.path))).toEqual(file.bytes);
        expect(file.sha256).toBe(`sha256:${createHash('sha256').update(file.bytes).digest('hex')}`);
      }
      const workflow = join(source, ".github/workflows/eai-app.yml");
      writeFileSync(workflow, readFileSync(workflow, "utf8").replace("      local_e2e_tunnel:", "      removed_tunnel:"));
      expect(buildManagedDeployProducerBundle(source, "v9.8.7").pin).toEqual(pin);
      git("add", ".");
      git("commit", "-m", "invalid producer fixture");
      expect(() => buildManagedDeployProducerBundle(source, "v9.8.7")).toThrow("exact release tag");
      git("tag", "v9.8.8");
      expect(() => buildManagedDeployProducerBundle(source, "v9.8.8")).toThrow("local_e2e_tunnel");
      expect(readFileSync(join(output, "producer-pin.json"), "utf8")).toBe(`${JSON.stringify(pin, null, 2)}\n`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("binds copied Gofer source and overlays to one complete resource tree", () => {
    const root = mkdtempSync(join(tmpdir(), "linked-gofer-identity-"));
    try {
      const source = join(root, "source");
      const output = join(root, "bundle");
      mkdirSync(join(source, "extension/resources/commands"), { recursive: true });
      writeFileSync(join(source, "extension/package.json"), '{"version":"9.8.7"}');
      mkdirSync(join(source, ".specify/config"), { recursive: true });
      writeFileSync(join(source, "extension/resources/commands/example.md"), "upstream command\n");
      writeFileSync(join(source, ".specify/config/example.json"), '{"upstream":true}\n');
      const metadata = syncGoferResourcesFromCheckout(source, "a".repeat(40), "v9.8.7", output);
      expect(metadata).toMatchObject({ commit: "a".repeat(40), describe: "v9.8.7", version: "9.8.7", dirty: false,
        source: `${GOFER_REPO}@${"a".repeat(40)}` });
      expect(readFileSync(join(output, "config/example.json"), "utf8")).toBe('{"upstream":true}\n');
      expect(metadata.resourceTreeSha256).toBe(goferResourceTreeSha256(output));
      writeFileSync(join(source, "extension/package.json"), '{"version":"main"}');
      expect(() => syncGoferResourcesFromCheckout(source, "b".repeat(40), "main", output)).toThrow("exact extension package version");
      expect(readFileSync(join(output, ".gofer-version"), "utf8")).toBe(`${JSON.stringify(metadata, null, 2)}\n`);
      writeFileSync(join(output, "commands/example.md"), "tampered command\n");
      expect(goferResourceTreeSha256(output)).not.toBe(metadata.resourceTreeSha256);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("scheduled validation refreshes the bumped archive and stages every generated release asset", async () => {
    const workflow = await readFile(join(REPO_ROOT, ".github/workflows/sync-linked-sources.yml"), "utf8");
    expect(workflow.indexOf("npm version patch")).toBeLessThan(workflow.indexOf("npm pack --ignore-scripts"));
    expect(workflow.indexOf("node scripts/generate-registry.cjs")).toBeLessThan(workflow.indexOf("npm run test"));
    expect(workflow.indexOf("npm run docs:release-assets")).toBeLessThan(workflow.indexOf("npm run test"));
    expect(workflow.indexOf("npm run docs:error-guidance")).toBeLessThan(workflow.indexOf("npm run docs:release-assets"));
    const staged = workflow.split("git add ")[1].split("\n")[0];
    for (const file of ["resources/deploy/eai-app-template/", ".tech-docs/error-guidance.md", "docs-site/static/registry/", "docs-site/static/llms.txt", "docs-site/static/cli-help.txt"]) expect(staged).toContain(file);
    expect(workflow).toContain("node scripts/verify-docs-publication.cjs --prepared-source");
  });
});

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

describe("selectLatestReleaseTag", () => {
  const lsRemote = (...refs: string[]) =>
    refs.map((ref, index) => `${"0".repeat(39)}${index}\trefs/tags/${ref}`).join("\n");

  test("compares version segments numerically, not as text", () => {
    expect(selectLatestReleaseTag(lsRemote("v1.9.0", "v1.10.0", "v1.2.0"))).toBe(
      "v1.10.0",
    );
    expect(selectLatestReleaseTag(lsRemote("v2.0.0", "v10.0.0"))).toBe("v10.0.0");
  });

  test("ignores peeled annotated-tag refs and non-release tags", () => {
    // An annotated tag emits both refs/tags/v1.0.0 and refs/tags/v1.0.0^{}.
    expect(
      selectLatestReleaseTag(
        lsRemote("v1.0.0", "v1.0.0^{}", "nightly", "v1.0.0-rc1"),
      ),
    ).toBe("v1.0.0");
  });

  test("reports no release rather than guessing one", () => {
    expect(selectLatestReleaseTag("")).toBeNull();
    expect(selectLatestReleaseTag(lsRemote("nightly", "latest"))).toBeNull();
    expect(selectLatestReleaseTag(undefined)).toBeNull();
  });
});
