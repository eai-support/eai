import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  PlatformAPIClient,
  isManagedPublicRequestTimeout,
} from "../../src/lib/api.js";
import { ManagedSourceError } from "../../src/lib/eai-managed-source.js";
import { responseOperation } from "../../src/lib/eai-managed-source-operation-client.js";
import {
  MAX_PROJECT_MANIFEST_BYTES,
  MAX_TEMPLATE_RESPONSE_BYTES,
  TEMPLATE_MIGRATION_DOCS_URL,
  assertProjectTemplateApproved,
  managedSourceResponseError,
} from "../../src/lib/eai-managed-template-requirement.js";
import type { CliManagedSourceScope } from "../../src/lib/eai-managed-source-client.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const BUNDLED = (
  JSON.parse(
    readFileSync(join(repoRoot, "resources/linked-sources.json"), "utf8"),
  ) as {
    appTemplate: { version: string; commit: string };
  }
).appTemplate;
const BUNDLED_SHORT = BUNDLED.commit.slice(0, 7);
const BUNDLED_LABEL = `${BUNDLED.version} (${BUNDLED_SHORT})`;

const scope: CliManagedSourceScope = {
  tenantId: "company",
  appKey: "my-app",
  targetTenantId: "runtime",
  environment: "preview",
  actorId: "eai-user-oid",
};
const OLD = "3af817f688d374b6260dcffcecb53c4bb94675ef";
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const requirement = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  schemaVersion: "eai.cli_managed_template_requirement.v1",
  tenantId: "company",
  appKey: "my-app",
  requiredTemplateCommitSha: BUNDLED.commit,
  requiredTemplateVersion: BUNDLED.version,
  ...overrides,
});

async function caught(promise: Promise<unknown>): Promise<ManagedSourceError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ManagedSourceError);
    return error as ManagedSourceError;
  }
  throw new Error("expected a ManagedSourceError");
}

describe("managed source operation errors preserve safe public reasons (Issues2025#3574, #3637)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("a stale template names both versions and the supported fixes", async () => {
    const future = "f".repeat(40);
    const error = await caught(
      responseOperation(
        json(
          {
            error: "TEMPLATE_VERSION_NOT_APPROVED",
            message:
              "Local app template commit is not the approved platform version.",
            details: {
              currentTemplateCommitSha: OLD,
              requiredTemplateCommitSha: future,
              requiredTemplateVersion: "v9.0.0",
              hint: "Update the EAI CLI.",
            },
          },
          409,
        ),
      ),
    );
    expect(error.code).toBe("TEMPLATE_VERSION_NOT_APPROVED");
    expect(error.message).toBe(
      "Your project uses app template 3af817f; this environment requires v9.0.0 (fffffff).",
    );
    expect(error.nextAction).toContain(
      `Install an EAI CLI release that bundles app template v9.0.0 (fffffff) (this CLI bundles ${BUNDLED_LABEL})`,
    );
    expect(error.nextAction).not.toContain("@latest");
    expect(error.nextAction).toContain(TEMPLATE_MIGRATION_DOCS_URL);
    expect(error.details).toMatchObject({
      httpStatus: 409,
      currentTemplateCommitSha: OLD,
      requiredTemplateCommitSha: future,
      requiredTemplateVersion: "v9.0.0",
    });
  });

  test("a 409 carrying details.currentTemplateVersion surfaces vX and ignores invalid version tags", async () => {
    const future = "f".repeat(40);
    const withCurrentVersion = await caught(
      responseOperation(
        json(
          {
            error: "TEMPLATE_VERSION_NOT_APPROVED",
            details: {
              currentTemplateCommitSha: OLD,
              currentTemplateVersion: "v1.0.7",
              requiredTemplateCommitSha: future,
              requiredTemplateVersion: "v9.0.0",
            },
          },
          409,
        ),
      ),
    );
    expect(withCurrentVersion.code).toBe("TEMPLATE_VERSION_NOT_APPROVED");
    expect(withCurrentVersion.message).toBe(
      "Your project uses app template v1.0.7 (3af817f); this environment requires v9.0.0 (fffffff).",
    );
    expect(withCurrentVersion.details).toMatchObject({
      httpStatus: 409,
      currentTemplateCommitSha: OLD,
      currentTemplateVersion: "v1.0.7",
      requiredTemplateCommitSha: future,
      requiredTemplateVersion: "v9.0.0",
    });

    const malformedCurrentVersion = await caught(
      responseOperation(
        json(
          {
            error: "TEMPLATE_VERSION_NOT_APPROVED",
            details: {
              currentTemplateCommitSha: OLD,
              currentTemplateVersion: "v1.0.7\u001b[31m",
              requiredTemplateCommitSha: future,
              requiredTemplateVersion: "v9.0.0",
            },
          },
          409,
        ),
      ),
    );
    expect(malformedCurrentVersion.message).toBe(
      "Your project uses app template 3af817f; this environment requires v9.0.0 (fffffff).",
    );
    expect(malformedCurrentVersion.details).not.toHaveProperty(
      "currentTemplateVersion",
    );
  });

  test("FastAPI-wrapped stale templates tell an up-to-date CLI to migrate the project", async () => {
    const error = await caught(
      responseOperation(
        json(
          {
            detail: {
              error: "TEMPLATE_VERSION_NOT_APPROVED",
              details: {
                currentTemplateCommitSha: OLD,
                currentTemplateVersion: "v1.0.7",
                requiredTemplateCommitSha: BUNDLED.commit,
                requiredTemplateVersion: BUNDLED.version,
              },
            },
          },
          409,
        ),
      ),
    );
    expect(error.code).toBe("TEMPLATE_VERSION_NOT_APPROVED");
    expect(error.message).toBe(
      `Your project uses app template v1.0.7 (3af817f); this environment requires ${BUNDLED_LABEL}.`,
    );
    expect(error.nextAction).toContain(
      `This CLI already bundles app template ${BUNDLED_LABEL}: create a new project`,
    );
  });

  test("an environment pinned older than this CLI is not told to install the latest CLI", async () => {
    const error = await caught(
      responseOperation(
        json(
          {
            error: "TEMPLATE_VERSION_NOT_APPROVED",
            details: {
              currentTemplateCommitSha: BUNDLED.commit,
              requiredTemplateCommitSha: OLD,
              requiredTemplateVersion: "v1.0.16",
            },
          },
          409,
        ),
      ),
    );
    expect(error.message).toBe(
      `Your project uses app template ${BUNDLED_SHORT}; this environment requires v1.0.16 (3af817f).`,
    );
    expect(error.nextAction).toContain(
      `Install an EAI CLI release that bundles app template v1.0.16 (3af817f) (this CLI bundles ${BUNDLED_LABEL}), then create a new project`,
    );
    expect(error.nextAction).not.toContain("@latest");
  });

  test.each([
    { error: 'CLI_MANAGED_SOURCE_UPSTREAM_REJECTED', message: 'PRIVATE provider token /internal/path' },
    { detail: 'PRIVATE provider text\u001b[31m' },
    { detail: { error: 'CLI_MANAGED_SOURCE_DIGEST_MISMATCH', message: 'PRIVATE provider text' } },
    { detail: 'Rejected\u009b31m by\u202e reversed\u2066 PRIVATE text\u200b' },
  ])('unknown server content is replaced by fixed guidance (%j)', async body => {
    const error = await caught(responseOperation(json(body, 409)));
    expect(error.code).toBe('MANAGED_SOURCE_UNAVAILABLE');
    expect(error.message).toBe('Managed source operation is unavailable (409). Its remote outcome has not been confirmed.');
    expect(error.nextAction).toContain('confirm the outcome before starting another publication');
    expect(error.details).toEqual({ httpStatus: 409 });
    expect(JSON.stringify(error)).not.toContain('PRIVATE');
    expect(JSON.stringify(error)).not.toContain('UPSTREAM_REJECTED');
  });

  test('non-JSON bodies still report only the status', async () => {
    const error = await caught(responseOperation(new Response('<html>PRIVATE bad gateway</html>', { status: 502 })));
    expect(error.message).toContain('(502)');
    expect(JSON.stringify(error)).not.toContain('PRIVATE');
  });

  test('known local operation identity survives a rejected read in text and structured details', async () => {
    const operationId = `cli-managed-${'a'.repeat(32)}`;
    const error = await managedSourceResponseError(json({ operationId: `cli-managed-${'b'.repeat(32)}`, message: 'PRIVATE' }, 503), operationId);
    expect(error.details).toEqual({ httpStatus: 503, operationId });
    expect(error.nextAction).toContain(`--retry ${operationId}`);
    expect(JSON.stringify(error)).not.toContain('PRIVATE');
    expect(JSON.stringify(error)).not.toContain('b'.repeat(32));
  });

  test("a malformed stale-template body falls back to the readable generic error", async () => {
    const error = await caught(
      responseOperation(
        json(
          {
            error: "TEMPLATE_VERSION_NOT_APPROVED",
            details: { currentTemplateCommitSha: "nope" },
          },
          409,
        ),
      ),
    );
    expect(error.code).toBe("MANAGED_SOURCE_UNAVAILABLE");
    expect(error.message).toContain("TEMPLATE_VERSION_NOT_APPROVED");
  });

  test("oversized streaming error bodies cancel at 8 KiB before buffering remaining chunks", async () => {
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(5_000).fill(0x78);
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls <= 2) {
            controller.enqueue(chunk);
            return;
          }
          throw new Error(
            "stream should have cancelled once MAX_TEMPLATE_RESPONSE_BYTES was exceeded",
          );
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const error = await caught(
      responseOperation(new Response(stream, { status: 502 })),
    );
    expect(MAX_TEMPLATE_RESPONSE_BYTES).toBe(8_192);
    expect(pulls).toBe(2);
    expect(cancelled).toBe(true);
    expect(error.code).toBe("MANAGED_SOURCE_UNAVAILABLE");
    expect(error.message).toContain("(502)");
  });

  test("preserves managed request TimeoutError when an error body stalls mid-stream", async () => {
    const client = new PlatformAPIClient(
      "https://dev-api.au.myenterprise.ai/public",
      scope.tenantId,
    );
    vi.spyOn(
      client as unknown as { assertProfileAuthority: () => void },
      "assertProfileAuthority",
    ).mockImplementation(() => {});
    vi.spyOn(
      client as unknown as { headers: () => Promise<Record<string, string>> },
      "headers",
    ).mockResolvedValue({});
    vi.spyOn(
      client as unknown as { fetchPublic: typeof fetch },
      "fetchPublic",
    ).mockImplementation(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"detail":"slow'));
            },
          }),
          { status: 503 },
        ),
    );
    const response = await client.getCliManagedTemplateRequirement(
      scope.tenantId,
      scope.appKey,
      scope.targetTenantId,
      scope.environment,
      25,
    );
    let thrown: unknown;
    try {
      await managedSourceResponseError(response);
    } catch (error) {
      thrown = error;
    }
    expect(isManagedPublicRequestTimeout(thrown)).toBe(true);
    expect(thrown).toMatchObject({ name: "TimeoutError" });
  });
});

describe("template preflight before the GitHub link step", () => {
  let root: string | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  async function project(manifest: unknown): Promise<string> {
    root = await mkdtemp(join(tmpdir(), "eai-template-preflight-"));
    if (manifest !== undefined)
      await writeFile(
        join(root, ".eai-manifest.json"),
        JSON.stringify(manifest),
      );
    return root;
  }

  test("stops an outdated project with its version and the required version, passing scope.environment", async () => {
    const client = new PlatformAPIClient(
      "https://api.example.test/public",
      scope.tenantId,
    );
    const read = vi
      .spyOn(client, "getCliManagedTemplateRequirement")
      .mockResolvedValue(json(requirement()));
    const prodScope: CliManagedSourceScope = { ...scope, environment: "prod" };
    const error = await caught(
      assertProjectTemplateApproved(
        client,
        prodScope,
        await project({ template: { version: "v1.0.7", commit: OLD } }),
        1000,
      ),
    );
    expect(read).toHaveBeenCalledExactlyOnceWith(
      "company",
      "my-app",
      "runtime",
      "prod",
      1000,
    );
    expect(error.code).toBe("TEMPLATE_VERSION_NOT_APPROVED");
    expect(error.message).toBe(
      `Your project uses app template v1.0.7 (3af817f); this environment requires ${BUNDLED_LABEL}.`,
    );
    expect(error.nextAction).toContain("eai create");
    expect(error.nextAction).toContain(TEMPLATE_MIGRATION_DOCS_URL);
  });

  test("continues when the project already uses the approved template", async () => {
    const client = new PlatformAPIClient(
      "https://api.example.test/public",
      scope.tenantId,
    );
    vi.spyOn(client, "getCliManagedTemplateRequirement").mockResolvedValue(
      json(requirement()),
    );
    await expect(
      assertProjectTemplateApproved(
        client,
        scope,
        await project({ template: { commit: BUNDLED.commit } }),
        1000,
      ),
    ).resolves.toBeUndefined();
  });

  test.each([
    [
      "an older platform without the route",
      () => Promise.resolve(json({ detail: "Not Found" }, 404)),
    ],
    [
      "a platform outage",
      () =>
        Promise.resolve(
          json({ error: "CLI_MANAGED_SOURCE_UPSTREAM_REJECTED" }, 503),
        ),
    ],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
    [
      "an unverifiable body",
      () =>
        Promise.resolve(
          json(requirement({ requiredTemplateCommitSha: "nope" })),
        ),
    ],
    [
      "a crossed app scope",
      () => Promise.resolve(json(requirement({ appKey: "other-app" }))),
    ],
  ])("fails open for %s", async (_label, outcome) => {
    const client = new PlatformAPIClient(
      "https://api.example.test/public",
      scope.tenantId,
    );
    vi.spyOn(client, "getCliManagedTemplateRequirement").mockImplementation(
      outcome,
    );
    await expect(
      assertProjectTemplateApproved(
        client,
        scope,
        await project({ template: { version: "v1.0.7", commit: OLD } }),
        1000,
      ),
    ).resolves.toBeUndefined();
  });

  test("cancels non-OK preflight response streams before failing open", async () => {
    const client = new PlatformAPIClient(
      "https://api.example.test/public",
      scope.tenantId,
    );
    let cancelled = false;
    vi.spyOn(client, "getCliManagedTemplateRequirement").mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('{"detail":"missing"}'),
            );
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 404 },
      ),
    );
    await expect(
      assertProjectTemplateApproved(
        client,
        scope,
        await project({ template: { version: "v1.0.7", commit: OLD } }),
        1000,
      ),
    ).resolves.toBeUndefined();
    expect(cancelled).toBe(true);
  });

  test("fails open when the template-requirement stream exceeds 8 KiB or stalls past timeout", async () => {
    const client = new PlatformAPIClient(
      "https://dev-api.au.myenterprise.ai/public",
      scope.tenantId,
    );
    vi.spyOn(
      client as unknown as { assertProfileAuthority: () => void },
      "assertProfileAuthority",
    ).mockImplementation(() => {});
    vi.spyOn(
      client as unknown as { headers: () => Promise<Record<string, string>> },
      "headers",
    ).mockResolvedValue({});

    let pulls = 0;
    vi.spyOn(
      client as unknown as { fetchPublic: typeof fetch },
      "fetchPublic",
    ).mockImplementationOnce(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                pulls += 1;
                if (pulls <= 2) {
                  controller.enqueue(new Uint8Array(5_000).fill(0x20));
                  return;
                }
                throw new Error(
                  "preflight should stop reading oversized requirement stream",
                );
              },
            },
            { highWaterMark: 0 },
          ),
          { status: 200 },
        ),
    );
    const dir = await project({ template: { version: "v1.0.7", commit: OLD } });
    await expect(
      assertProjectTemplateApproved(client, scope, dir, 1000),
    ).resolves.toBeUndefined();
    expect(pulls).toBe(2);

    vi.spyOn(
      client as unknown as { fetchPublic: typeof fetch },
      "fetchPublic",
    ).mockImplementationOnce(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"schemaVersion":'));
            },
          }),
          { status: 200 },
        ),
    );
    await expect(
      assertProjectTemplateApproved(client, scope, dir, 25),
    ).resolves.toBeUndefined();
  });

  test("fails open without network reads when .eai-manifest.json is oversized or a symlink, including without O_NOFOLLOW", async () => {
    const client = new PlatformAPIClient(
      "https://api.example.test/public",
      scope.tenantId,
    );
    const read = vi
      .spyOn(client, "getCliManagedTemplateRequirement")
      .mockResolvedValue(json(requirement()));

    const oversizedDir = await project(undefined);
    await writeFile(
      join(oversizedDir, ".eai-manifest.json"),
      JSON.stringify({
        template: { version: "v1.0.7", commit: OLD },
        pad: "x".repeat(MAX_PROJECT_MANIFEST_BYTES),
      }),
    );
    await expect(
      assertProjectTemplateApproved(client, scope, oversizedDir, 1000),
    ).resolves.toBeUndefined();

    await rm(oversizedDir, { recursive: true, force: true });
    const symlinkDir = await mkdtemp(join(tmpdir(), "eai-template-symlink-"));
    root = symlinkDir;
    const outside = join(symlinkDir, "target-manifest.json");
    await writeFile(
      outside,
      JSON.stringify({ template: { version: "v1.0.7", commit: OLD } }),
    );
    await symlink(outside, join(symlinkDir, ".eai-manifest.json"));
    await expect(
      assertProjectTemplateApproved(client, scope, symlinkDir, 1000),
    ).resolves.toBeUndefined();
    await expect(
      assertProjectTemplateApproved(client, scope, symlinkDir, 1000, {
        O_NOFOLLOW: 0,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertProjectTemplateApproved(client, scope, symlinkDir, 1000, {
        O_NOFOLLOW: undefined,
      }),
    ).resolves.toBeUndefined();

    const realProject = join(symlinkDir, "real-project");
    await mkdir(realProject);
    await writeFile(
      join(realProject, ".eai-manifest.json"),
      JSON.stringify({ template: { version: "v1.0.7", commit: OLD } }),
    );
    const linkedRoot = join(symlinkDir, "linked-project-root");
    await symlink(realProject, linkedRoot);
    await expect(
      assertProjectTemplateApproved(client, scope, linkedRoot, 1000, {
        O_NOFOLLOW: undefined,
      }),
    ).resolves.toBeUndefined();

    expect(read).not.toHaveBeenCalled();
  });

  test("leaves projects without a template pin to the existing bundle checks", async () => {
    const client = new PlatformAPIClient(
      "https://api.example.test/public",
      scope.tenantId,
    );
    const read = vi.spyOn(client, "getCliManagedTemplateRequirement");
    await expect(
      assertProjectTemplateApproved(
        client,
        scope,
        await project(undefined),
        1000,
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertProjectTemplateApproved(
        client,
        scope,
        await project({ template: { commit: "short" } }),
        1000,
      ),
    ).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
});
