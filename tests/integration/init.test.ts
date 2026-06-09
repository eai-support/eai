/**
 * Init Command Integration Tests
 *
 * Tests for: eai init [name] [--from <repo>] [--skip-prompts]
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import inquirer from "inquirer";
import { describe, test, beforeEach, afterEach, expect, vi } from "vitest";
import {
  describeCloneFailure,
  initCommand,
  isDefaultTemplateSource,
  resolveTemplateClonePlan,
} from "../../src/commands/init.js";
import * as auth from "../../src/lib/auth.js";
import { PlatformAPIClient } from "../../src/lib/api.js";
import * as tenantContext from "../../src/lib/tenant-context.js";
import {
  createTestEnvironment,
  captureConsole,
  type TestEnvironment,
} from "../helpers/test-env.js";
import { createMockServer, PublicAPIMock } from "../helpers/mock-server.js";
import type { TestContext } from "../helpers/setup-dsl.js";
import {
  workingDirectoryIs,
  gitIsInstalled,
  networkIsAvailable,
  directoryExists,
} from "../helpers/setup-dsl.js";
import { runCommand } from "../helpers/action-dsl.js";
import {
  expectCommandFailed,
  expectDirectoryCreated,
  expectFileExists,
  expectFileNotExists,
  expectFileContains,
  expectErrorMessage,
  expectNoPrompts,
  expectExitCode,
} from "../helpers/assert-dsl.js";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };
const linkedSources = require("../../resources/linked-sources.json") as {
  appTemplate: { commit: string };
};
const TEST_PUBLIC_API_URL = "https://profile-test.example.test/public";

function allowedCapability() {
  return {
    outcome: "allow" as const,
    reasonCode: "allowed",
    reasonMessage: "Capability is included in the current plan.",
    upgradeUrl: null,
  };
}

async function createLocalTemplateRepo(baseDir: string): Promise<string> {
  const templateDir = join(baseDir, "eai-app-template");
  await mkdir(join(templateDir, "src", "eai.config"), { recursive: true });
  await writeFile(
    join(templateDir, "package.json"),
    JSON.stringify(
      {
        name: "eai-app-template",
        version: "0.0.1",
        type: "module",
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    join(templateDir, "src", "eai.config", "object-types.ts"),
    "export const objectTypes = {};\n",
  );
  await exec("git", ["init"], { cwd: templateDir });
  await exec("git", ["config", "user.email", "tests@example.com"], {
    cwd: templateDir,
  });
  await exec("git", ["config", "user.name", "EAI CLI Tests"], {
    cwd: templateDir,
  });
  await exec("git", ["add", "."], { cwd: templateDir });
  await exec("git", ["commit", "-m", "Initial template"], { cwd: templateDir });
  return templateDir;
}

describe("eai init", () => {
  let env: TestEnvironment;
  let mockServer: ReturnType<typeof createMockServer>;
  let ctx: TestContext;
  let templateRepo: string;
  let originalPublicApiUrl: string | undefined;

  beforeEach(async () => {
    originalPublicApiUrl = process.env.BASE_URL_PUBLIC_API;
    process.env.BASE_URL_PUBLIC_API = TEST_PUBLIC_API_URL;

    env = await createTestEnvironment();
    mockServer = createMockServer();
    mockServer.start();

    ctx = {
      workingDir: env.dir,
      mockAPI: new PublicAPIMock("https://test-api.example.com", mockServer),
      env: {},
      prompts: [],
    };

    Object.assign(ctx.env, {
      GIT_AUTHOR_NAME: "EAI CLI Tests",
      GIT_AUTHOR_EMAIL: "tests@example.com",
      GIT_COMMITTER_NAME: "EAI CLI Tests",
      GIT_COMMITTER_EMAIL: "tests@example.com",
    });

    templateRepo = await createLocalTemplateRepo(env.dir);
  });

  afterEach(async () => {
    mockServer.stop();
    await env.cleanup();
    if (originalPublicApiUrl === undefined) {
      delete process.env.BASE_URL_PUBLIC_API;
    } else {
      process.env.BASE_URL_PUBLIC_API = originalPublicApiUrl;
    }
  });

  test("TC001: Initialize new vertical interactively", async () => {
    // TC001: Initialize new vertical interactively
    // Traces to: Init-US1-AC1
    //
    // workingDirectoryIs('/tmp/test-projects')
    // gitIsInstalled()
    // networkIsAvailable()
    //
    // runCommand('eai init my-vertical')
    // respondToPrompt('Display Name', 'My Vertical')
    // respondToPrompt('Description', 'Test vertical app')
    // respondToPrompt('Tenant Structure', 'single')
    // respondToPrompt('Include AI Chat', 'yes')
    // respondToPrompt('Include Docs', 'yes')
    // respondToPrompt('Auth Provider', 'ciam')
    //
    // expectDirectoryCreated('my-vertical')
    // expectFileExists('my-vertical/package.json')
    // expectFileContains('my-vertical/package.json', '"name": "my-vertical"')
    // expectFileExists('my-vertical/.env.local')
    // expectFileExists('my-vertical/src/eai.config/object-types.ts')
    // expectSuccessMessage('Vertical "My Vertical" initialized')

    workingDirectoryIs(ctx, env.dir);
    gitIsInstalled(ctx);
    networkIsAvailable(ctx);

    const promptSpy = vi
      .spyOn(inquirer, "prompt")
      .mockResolvedValueOnce({
        name: "my-vertical",
        displayName: "My Vertical",
        description: "My Vertical vertical application",
      })
      .mockResolvedValueOnce({ mode: "default" })
      .mockResolvedValueOnce({ appTenantScope: "current" })
      .mockResolvedValueOnce({ includeChat: true })
      .mockResolvedValueOnce({ includeDocs: true })
      .mockResolvedValueOnce({ authProvider: "ciam" });
    const tenantCtxSpy = vi
      .spyOn(tenantContext, "resolveActiveTenantContext")
      .mockResolvedValue({
        publicApiUrl: "https://profile-test.example.test/public",
        tokens: {
          accessToken: "access",
          expiresAt: Date.now() + 60_000,
          tenantId: "ciam-guid",
          tenantName: "profile-test-tenant",
          clientId: "client-id",
        },
        activeTenant: {
          id: "tenant-123",
          displayName: "Test Tenant",
          slug: "test-tenant",
          domain: "test.example.com",
          isActive: true,
          roles: ["tenant-admin"],
        },
        memberships: [],
      });
    const authSpy = vi.spyOn(auth, "isAuthenticated").mockResolvedValue(false);
    const loadTokensSpy = vi.spyOn(auth, "loadTokens").mockResolvedValue({
      accessToken: "access",
      expiresAt: Date.now() + 60_000,
      tenantId: "ciam-guid",
      tenantName: "profile-test-tenant",
      clientId: "client-id",
    });
    const capabilitySpy = vi
      .spyOn(PlatformAPIClient.prototype, "evaluateCapability")
      .mockResolvedValue(allowedCapability());
    const getTenantSpy = vi
      .spyOn(PlatformAPIClient.prototype, "getTenant")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "tenant-123",
            displayName: "Test Tenant",
            ultimateParentId: "tenant-123",
          }),
          { status: 200 },
        ),
      );
    const createTenantAppSpy = vi
      .spyOn(PlatformAPIClient.prototype, "createTenantApp")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            childTenant: null,
          }),
          { status: 201 },
        ),
      );
    const consoleCapture = captureConsole();

    try {
      await initCommand.parseAsync(["my-vertical", "--from", templateRepo], {
        from: "user",
      });
      expect(createTenantAppSpy).toHaveBeenCalledWith(
        "tenant-123",
        expect.objectContaining({
          appDisplayName: "My Vertical",
          verticalKey: "my-vertical",
          source: "eai-cli",
        }),
      );
      expect(createTenantAppSpy.mock.calls[0]?.[1]).not.toHaveProperty(
        "childTenantDisplayName",
      );
    } finally {
      consoleCapture.restore();
      authSpy.mockRestore();
      loadTokensSpy.mockRestore();
      promptSpy.mockRestore();
      tenantCtxSpy.mockRestore();
      capabilitySpy.mockRestore();
      getTenantSpy.mockRestore();
      createTenantAppSpy.mockRestore();
    }

    await expectDirectoryCreated(ctx, "my-vertical");
    await expectFileExists(ctx, "my-vertical/package.json");
    await expectFileContains(
      ctx,
      "my-vertical/package.json",
      '"name": "@eai-tools/my-vertical"',
    );
    await expectFileExists(ctx, "my-vertical/.env.local");
    await expectFileContains(
      ctx,
      "my-vertical/.env.local",
      "EAI_PARENT_TENANT_ID=tenant-123",
    );
    await expectFileContains(
      ctx,
      "my-vertical/.env.local",
      "EAI_TENANT_ID=tenant-123",
    );
    await expectFileContains(
      ctx,
      "my-vertical/.env.local",
      "APP_BASE_PATH=/my-vertical",
    );
    await expectFileContains(
      ctx,
      "my-vertical/.env.local",
      "NEXT_PUBLIC_APP_BASE_PATH=/my-vertical",
    );
    await expectFileContains(
      ctx,
      "my-vertical/.env.local",
      "AUTH_URL=http://localhost:3000/my-vertical",
    );
    await expectFileContains(
      ctx,
      "my-vertical/.env.local",
      "NEXTAUTH_URL=http://localhost:3000/my-vertical",
    );
    await expectFileExists(ctx, "my-vertical/src/eai.config/object-types.ts");
    await expectFileExists(
      ctx,
      "my-vertical/.claude/commands/0_business_scenario.md",
    );
    await expectFileExists(
      ctx,
      "my-vertical/.claude/agents/codebase-analyzer.md",
    );
    await expectFileExists(
      ctx,
      "my-vertical/.specify/commands/1_gofer_research.md",
    );
    await expectFileExists(
      ctx,
      "my-vertical/.specify/scripts/bash/pipeline-state.sh",
    );
    await expectFileExists(ctx, "my-vertical/.eai-manifest.json");
    await expectFileExists(
      ctx,
      "my-vertical/.system/skills/1_gofer_research/SKILL.md",
    );
    await expectFileExists(
      ctx,
      "my-vertical/.agents/skills/1_gofer_research/SKILL.md",
    );
    await expectFileExists(
      ctx,
      "my-vertical/.agents/skills/0_business_scenario/SKILL.md",
    );
    await expectFileExists(ctx, "my-vertical/.gemini/extension.json");
    await expectFileExists(
      ctx,
      "my-vertical/.gemini/commands/gofer/1_gofer_research.toml",
    );
    await expectFileExists(
      ctx,
      "my-vertical/.gemini/commands/gofer/0_business_scenario.toml",
    );
    await expectFileExists(
      ctx,
      "my-vertical/.github/prompts/0_business_scenario.prompt.md",
    );
    await expectFileExists(
      ctx,
      "my-vertical/.github/skills/0-business-scenario/SKILL.md",
    );
    await expectFileExists(ctx, "my-vertical/.github/copilot-instructions.md");
    await expectFileContains(ctx, "my-vertical/CLAUDE.md", "## Gofer Pipeline");
    await expectFileContains(
      ctx,
      "my-vertical/.eai-manifest.json",
      `"version": "${pkg.version}"`,
    );
    await expectFileContains(
      ctx,
      "my-vertical/.eai-manifest.json",
      '"displaySource":',
    );
    expect(consoleCapture.stdout.join("\n")).toContain("Created My Vertical");
  }, 30_000);

  test("creates and binds a child tenant during init when requested", async () => {
    workingDirectoryIs(ctx, env.dir);

    const promptSpy = vi
      .spyOn(inquirer, "prompt")
      .mockResolvedValueOnce({
        name: "child-vertical",
        displayName: "Child Vertical",
        description: "Child Vertical vertical application",
      })
      .mockResolvedValueOnce({ mode: "default" })
      .mockResolvedValueOnce({ appTenantScope: "child" })
      .mockResolvedValueOnce({ childTenantDisplayName: "Child Vertical" })
      .mockResolvedValueOnce({ includeChat: true })
      .mockResolvedValueOnce({ includeDocs: true })
      .mockResolvedValueOnce({ authProvider: "ciam" });
    const tenantCtxSpy = vi
      .spyOn(tenantContext, "resolveActiveTenantContext")
      .mockResolvedValue({
        publicApiUrl: "https://profile-test.example.test/public",
        tokens: {
          accessToken: "access",
          expiresAt: Date.now() + 60_000,
          tenantId: "ciam-guid",
          tenantName: "profile-test-tenant",
          clientId: "client-id",
        },
        activeTenant: {
          id: "tenant-parent",
          displayName: "Parent Tenant",
          slug: "parent-tenant",
          domain: "parent.example.com",
          isActive: true,
          roles: ["tenant-admin"],
        },
        memberships: [],
      });
    const authSpy = vi.spyOn(auth, "isAuthenticated").mockResolvedValue(false);
    const loadTokensSpy = vi.spyOn(auth, "loadTokens").mockResolvedValue({
      accessToken: "access",
      expiresAt: Date.now() + 60_000,
      tenantId: "ciam-guid",
      tenantName: "profile-test-tenant",
      clientId: "client-id",
      oid: "user-oid",
      upn: "user@example.com",
    });
    const capabilitySpy = vi
      .spyOn(PlatformAPIClient.prototype, "evaluateCapability")
      .mockResolvedValue(allowedCapability());
    const getTenantSpy = vi
      .spyOn(PlatformAPIClient.prototype, "getTenant")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "tenant-parent",
            displayName: "Parent Tenant",
            ultimateParentId: "tenant-parent",
          }),
          { status: 200 },
        ),
      );
    const createTenantAppSpy = vi
      .spyOn(PlatformAPIClient.prototype, "createTenantApp")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            childTenant: {
              id: "tenant-child",
              displayName: "Child Vertical",
              slug: "child-vertical",
            },
          }),
          { status: 201 },
        ),
      );

    try {
      await initCommand.parseAsync(["child-vertical", "--from", templateRepo], {
        from: "user",
      });
      const envContent = await readFile(
        join(env.dir, "child-vertical", ".env.local"),
        "utf-8",
      );
      expect(envContent).toContain("EAI_TENANT_ID=tenant-child");
      expect(envContent).toContain("EAI_PARENT_TENANT_ID=tenant-parent");
      expect(envContent).toContain("TENANT_CHILD_VERTICAL_ID=tenant-child");
      expect(createTenantAppSpy).toHaveBeenCalledWith(
        "tenant-parent",
        expect.objectContaining({
          appDisplayName: "Child Vertical",
          verticalKey: "child-vertical",
          childTenantDisplayName: "Child Vertical",
          source: "eai-cli",
        }),
      );
      expect(capabilitySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-parent",
          targetCapability: "child-tenants",
        }),
      );
    } finally {
      authSpy.mockRestore();
      promptSpy.mockRestore();
      tenantCtxSpy.mockRestore();
      loadTokensSpy.mockRestore();
      capabilitySpy.mockRestore();
      getTenantSpy.mockRestore();
      createTenantAppSpy.mockRestore();
    }
  }, 30_000);

  test("TC002: Initialize with --skip-prompts flag", async () => {
    // TC002: Initialize with --skip-prompts flag
    // Traces to: Init-US1-AC2
    //
    // workingDirectoryIs('/tmp/test-projects')
    //
    // runCommand('eai init quick-app --skip-prompts')
    //
    // expectDirectoryCreated('quick-app')
    // expectFileContains('quick-app/package.json', '"name": "quick-app"')
    // expectFileContains('quick-app/package.json', '"displayName": "Quick App"')
    // expectNoPrompts()

    workingDirectoryIs(ctx, env.dir);

    const promptSpy = vi
      .spyOn(inquirer, "prompt")
      .mockRejectedValue(new Error("Unexpected prompt during --skip-prompts"));
    const tenantCtxSpy = vi
      .spyOn(tenantContext, "resolveActiveTenantContext")
      .mockResolvedValue({
        publicApiUrl: TEST_PUBLIC_API_URL,
        tokens: {
          accessToken: "access",
          expiresAt: Date.now() + 60_000,
          tenantId: "ciam-guid",
          tenantName: "profile-test-tenant",
          clientId: "client-id",
        },
        activeTenant: {
          id: "tenant-parent",
          displayName: "Parent Tenant",
          slug: "parent-tenant",
          domain: "parent.example.com",
          isActive: true,
          roles: ["tenant-admin"],
        },
        memberships: [],
      });
    const loadTokensSpy = vi.spyOn(auth, "loadTokens").mockResolvedValue({
      accessToken: "access",
      expiresAt: Date.now() + 60_000,
      tenantId: "ciam-guid",
      tenantName: "profile-test-tenant",
      clientId: "client-id",
    });
    const capabilitySpy = vi
      .spyOn(PlatformAPIClient.prototype, "evaluateCapability")
      .mockResolvedValue(allowedCapability());
    const getTenantSpy = vi
      .spyOn(PlatformAPIClient.prototype, "getTenant")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "tenant-parent",
            displayName: "Parent Tenant",
            ultimateParentId: "tenant-parent",
          }),
          { status: 200 },
        ),
      );
    const createTenantAppSpy = vi
      .spyOn(PlatformAPIClient.prototype, "createTenantApp")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            childTenant: {
              id: "tenant-quick-app",
              displayName: "Quick App",
              slug: "quick-app",
            },
          }),
          { status: 201 },
        ),
      );

    try {
      await initCommand.parseAsync(
        [
          "quick-app",
          "--skip-prompts",
          "--company-tenant",
          "tenant-parent",
          "--child-tenant",
          "Quick App",
          "--from",
          templateRepo,
        ],
        { from: "user" },
      );
      expect(promptSpy).not.toHaveBeenCalled();
    } finally {
      promptSpy.mockRestore();
      tenantCtxSpy.mockRestore();
      loadTokensSpy.mockRestore();
      capabilitySpy.mockRestore();
      getTenantSpy.mockRestore();
      createTenantAppSpy.mockRestore();
    }

    await expectDirectoryCreated(ctx, "quick-app");
    await expectFileContains(
      ctx,
      "quick-app/package.json",
      '"name": "@eai-tools/quick-app"',
    );
    await expectFileContains(
      ctx,
      "quick-app/src/eai.config/object-types.ts",
      "storageMetadataStatus: 'ready' as const",
    );
    await expectFileContains(
      ctx,
      "quick-app/src/eai.config/object-types.ts",
      "databaseAlias: 'resourceapi-postgres'",
    );
    await expectFileContains(
      ctx,
      "quick-app/src/eai.config/object-types.ts",
      "tableName: 'tenant_resources'",
    );
    await expectFileExists(
      ctx,
      "quick-app/.claude/commands/0_business_scenario.md",
    );
    await expectFileExists(
      ctx,
      "quick-app/.claude/agents/codebase-analyzer.md",
    );
    await expectFileExists(
      ctx,
      "quick-app/.specify/commands/1_gofer_research.md",
    );
    await expectFileExists(
      ctx,
      "quick-app/.specify/scripts/hooks/post-tool-use.mjs",
    );
    await expectFileExists(
      ctx,
      "quick-app/.agents/skills/1_gofer_research/SKILL.md",
    );
    await expectFileExists(
      ctx,
      "quick-app/.gemini/commands/gofer/1_gofer_research.md",
    );
    await expectFileExists(
      ctx,
      "quick-app/.github/skills/0-business-scenario/SKILL.md",
    );
    const objectTypes = await readFile(
      join(env.dir, "quick-app", "src", "eai.config", "object-types.ts"),
      "utf-8",
    );
    expect(objectTypes).toContain("storageMetadataStatus: 'ready' as const");
    expect(objectTypes).toContain("databaseAlias: 'resourceapi-postgres'");
    expect(objectTypes).toContain(
      "tenantSchemaStrategy: 'per-tenant-database' as const",
    );
    expect(objectTypes).toContain("tableName: 'tenant_resources'");
    expectNoPrompts(ctx);
  }, 30_000);

  test("TC002b: Init can skip Gofer asset installation", async () => {
    workingDirectoryIs(ctx, env.dir);

    const promptSpy = vi
      .spyOn(inquirer, "prompt")
      .mockRejectedValue(new Error("Unexpected prompt during --skip-prompts"));
    const tenantCtxSpy = vi
      .spyOn(tenantContext, "resolveActiveTenantContext")
      .mockResolvedValue({
        publicApiUrl: TEST_PUBLIC_API_URL,
        tokens: {
          accessToken: "access",
          expiresAt: Date.now() + 60_000,
          tenantId: "ciam-guid",
          tenantName: "profile-test-tenant",
          clientId: "client-id",
        },
        activeTenant: {
          id: "tenant-parent",
          displayName: "Parent Tenant",
          slug: "parent-tenant",
          domain: "parent.example.com",
          isActive: true,
          roles: ["tenant-admin"],
        },
        memberships: [],
      });
    const loadTokensSpy = vi.spyOn(auth, "loadTokens").mockResolvedValue({
      accessToken: "access",
      expiresAt: Date.now() + 60_000,
      tenantId: "ciam-guid",
      tenantName: "profile-test-tenant",
      clientId: "client-id",
    });
    const capabilitySpy = vi
      .spyOn(PlatformAPIClient.prototype, "evaluateCapability")
      .mockResolvedValue(allowedCapability());
    const getTenantSpy = vi
      .spyOn(PlatformAPIClient.prototype, "getTenant")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "tenant-parent",
            displayName: "Parent Tenant",
            ultimateParentId: "tenant-parent",
          }),
          { status: 200 },
        ),
      );
    const createTenantAppSpy = vi
      .spyOn(PlatformAPIClient.prototype, "createTenantApp")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            childTenant: {
              id: "tenant-plain-app",
              displayName: "Plain App",
              slug: "plain-app",
            },
          }),
          { status: 201 },
        ),
      );

    try {
      await initCommand.parseAsync(
        [
          "plain-app",
          "--skip-prompts",
          "--no-gofer",
          "--company-tenant",
          "tenant-parent",
          "--child-tenant",
          "Plain App",
          "--from",
          templateRepo,
        ],
        { from: "user" },
      );
      expect(promptSpy).not.toHaveBeenCalled();
    } finally {
      promptSpy.mockRestore();
      tenantCtxSpy.mockRestore();
      loadTokensSpy.mockRestore();
      capabilitySpy.mockRestore();
      getTenantSpy.mockRestore();
      createTenantAppSpy.mockRestore();
    }

    await expectDirectoryCreated(ctx, "plain-app");
    await expectFileContains(
      ctx,
      "plain-app/package.json",
      '"name": "@eai-tools/plain-app"',
    );
    await expectFileNotExists(
      ctx,
      "plain-app/.claude/commands/0_business_scenario.md",
    );
    await expectFileNotExists(
      ctx,
      "plain-app/.specify/commands/1_gofer_research.md",
    );
    await expectFileNotExists(
      ctx,
      "plain-app/.agents/skills/1_gofer_research/SKILL.md",
    );
    await expectFileNotExists(ctx, "plain-app/.gemini/extension.json");
  });

  test("init pre-populates known env values from active profile and tenant context", async () => {
    workingDirectoryIs(ctx, env.dir);

    const authSpy = vi.spyOn(auth, "isAuthenticated").mockResolvedValue(false);
    const publicApiSpy = vi
      .spyOn(tenantContext, "resolvePublicApiUrl")
      .mockResolvedValue("https://profile-test.example.test/public");
    const tenantSpy = vi
      .spyOn(tenantContext, "resolveActiveTenantContext")
      .mockResolvedValue({
        publicApiUrl: "https://profile-test.example.test/public",
        tokens: {
          accessToken: "access",
          expiresAt: Date.now() + 60_000,
          tenantId: "ciam-guid",
          tenantName: "profile-test-tenant",
          clientId: "client-id",
        },
        activeTenant: {
          id: "tenant-123",
          displayName: "Test Tenant",
          slug: "test-tenant",
          domain: "test.example.com",
          isActive: true,
          roles: ["tenant-admin"],
        },
        memberships: [],
      });
    const loadTokensSpy = vi.spyOn(auth, "loadTokens").mockResolvedValue({
      accessToken: "access",
      expiresAt: Date.now() + 60_000,
      tenantId: "ciam-guid",
      tenantName: "profile-test-tenant",
      clientId: "client-id",
    });
    const capabilitySpy = vi
      .spyOn(PlatformAPIClient.prototype, "evaluateCapability")
      .mockResolvedValue(allowedCapability());
    const getTenantSpy = vi
      .spyOn(PlatformAPIClient.prototype, "getTenant")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "tenant-123",
            displayName: "Test Tenant",
            ultimateParentId: "tenant-123",
          }),
          { status: 200 },
        ),
      );
    const createTenantAppSpy = vi
      .spyOn(PlatformAPIClient.prototype, "createTenantApp")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            childTenant: {
              id: "tenant-prefilled-app",
              displayName: "Prefilled App",
              slug: "prefilled-app",
            },
          }),
          { status: 201 },
        ),
      );

    try {
      await initCommand.parseAsync(
        [
          "prefilled-app",
          "--skip-prompts",
          "--child-tenant",
          "Prefilled App",
          "--from",
          templateRepo,
        ],
        { from: "user" },
      );
      const envContent = await readFile(
        join(env.dir, "prefilled-app", ".env.local"),
        "utf-8",
      );
      expect(envContent).toContain(
        "BASE_URL_PUBLIC_API=https://profile-test.example.test/public",
      );
      expect(envContent).toContain(
        "ENTRA_TENANT_NAME=profile-test-tenant",
      );
      expect(envContent).toContain("ENTRA_TENANT_ID=ciam-guid");
      expect(envContent).toContain("EAI_PARENT_TENANT_ID=tenant-123");
      expect(envContent).toContain("EAI_TENANT_ID=tenant-prefilled-app");
      expect(envContent).toContain(
        "TENANT_PREFILLED_APP_ID=tenant-prefilled-app",
      );
    } finally {
      authSpy.mockRestore();
      publicApiSpy.mockRestore();
      tenantSpy.mockRestore();
      loadTokensSpy.mockRestore();
      capabilitySpy.mockRestore();
      getTenantSpy.mockRestore();
      createTenantAppSpy.mockRestore();
    }
  }, 30_000);

  test("TC004: Init fails when directory exists", async () => {
    // TC004: Init fails when directory exists
    // Traces to: Init-US1-ERR1
    //
    // directoryExists('/tmp/test-projects/existing-app')
    //
    // runCommand('eai init existing-app')
    //
    // expectCommandFailed()
    // expectErrorMessage('Directory "existing-app" already exists')
    // expectExitCode(1)

    workingDirectoryIs(ctx, env.dir);
    await directoryExists(ctx, "existing-app");

    const result = await runCommand(
      ctx,
      `eai init existing-app --skip-prompts --from ${templateRepo}`,
    );

    expectCommandFailed(result);
    expectErrorMessage(result, 'Directory "existing-app" already exists.');
    expectExitCode(result, 1);
  });

  // Additional tests would follow the same pattern...
  // TC003: Initialize from custom template repository
  // TC005: Initialize fails when git not installed
  // TC006: Initialize multi-tenant structure
  // TC007: Initialize without AI chat
  // TC008: Generated object-types.ts is valid
  // TC009: Generated deployment workflow is valid
  // TC010: Init creates initial git commit
});

describe("describeCloneFailure", () => {
  test("explains unreachable default template repository failures", () => {
    const message = describeCloneFailure(
      "https://github.com/eai-tools/eai-app-template.git",
      new Error(
        "Command failed: git clone ...\nremote: Repository not found.\nfatal: repository not found",
      ),
    );

    expect(message).toContain("default template source");
    expect(message).toContain("--from <repo-or-path>");
    expect(message).toContain("could not be reached");
  });

  test("explains when git is not installed", () => {
    const message = describeCloneFailure(
      "https://github.com/eai-tools/eai-app-template.git",
      new Error("spawn git ENOENT"),
    );

    expect(message).toContain("`git` is required");
    expect(message).toContain("winget install --id Git.Git -e");
    expect(message).toContain("eai-tools/eai-app-template.git");
  });

  test("passes through unrelated clone errors", () => {
    expect(
      describeCloneFailure(
        "/tmp/template",
        new Error("fatal: unable to access repository"),
      ),
    ).toBe("fatal: unable to access repository");
  });
});

describe("resolveTemplateClonePlan", () => {
  test("treats only the canonical app template URL as the default source", () => {
    expect(
      isDefaultTemplateSource(
        "https://github.com/eai-tools/eai-app-template.git",
      ),
    ).toBe(true);
    expect(
      isDefaultTemplateSource(
        "https://github.com/eai-tools/old-internal-template.git",
      ),
    ).toBe(false);
  });

  test("returns the linked-source pin for the default template", () => {
    const plan = resolveTemplateClonePlan(
      "https://github.com/eai-tools/eai-app-template.git",
    );
    expect(plan.cloneSource).toBe(
      "https://github.com/eai-tools/eai-app-template.git",
    );
    expect(plan.pinnedCommit).toBe(linkedSources.appTemplate.commit);
    expect(plan.displaySource).toBe(
      `eai-tools/eai-app-template@${linkedSources.appTemplate.commit.slice(0, 7)}`,
    );
  });

  test("passes through custom template sources unchanged", () => {
    const plan = resolveTemplateClonePlan("/tmp/custom-template");
    expect(plan.cloneSource).toBe("/tmp/custom-template");
    expect(plan.pinnedCommit).toBeUndefined();
    expect(plan.displaySource).toBe("/tmp/custom-template");
  });
});
