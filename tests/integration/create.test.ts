import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import inquirer from "inquirer";

const resolveActiveTenantContext = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/tenant-context.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveActiveTenantContext,
}));

import {
  createCommand,
  ensureCreateAuthentication,
  buildCreateCompletionSummary,
  resolveCreateCompletionPublicApiUrl,
  buildForwardedInitArgs,
  buildTemplateInstallArgs,
  canRunTemplateScripts,
  resolveCreateTenantContext,
  toKebabCase,
  type CreateCommandOptions,
} from "../../src/commands/init.js";

import { setActiveProfile } from "../../src/lib/profile.js";
import * as auth from "../../src/lib/auth.js";
import { createTestEnvironment, type TestEnvironment } from "../helpers/test-env.js";

const baseOptions: CreateCommandOptions = {
  from: "https://github.com/eai-support/eai-app-template.git",
  skipPrompts: false,
  skipOnboarding: false,
  currentDir: false,
  packageProfile: "external",
};

describe("eai create onboarding helpers", () => {
  test("readiness preserves named gateway while default follows child runtime region", () => {
    setActiveProfile("private-selected");
    expect(resolveCreateCompletionPublicApiUrl("https://private.example.test", "eu")).toBe("https://private.example.test");
    setActiveProfile("default");
    expect(resolveCreateCompletionPublicApiUrl("https://api.au.myenterprise.ai/public", "eu")).toBe("https://api.eu.myenterprise.ai/public");
  });

  test("forwards an explicit template release to init", () => {
    expect(
      buildForwardedInitArgs(
        "my-app",
        {
          ...baseOptions,
          templateVersion: "v1.4.0",
        },
        undefined,
        "tenant-123",
      ),
    ).toContainEqual("--template-version");
  });

  test("converts plain-language names to CLI-safe project names", () => {
    expect(toKebabCase("Supplier Onboarding Portal")).toBe(
      "supplier-onboarding-portal",
    );
    expect(toKebabCase("  AI_Cockpit  ")).toBe("ai-cockpit");
  });

  test("forwards the guided answers into a non-interactive init command", () => {
    expect(
      buildForwardedInitArgs(
        undefined,
        baseOptions,
        {
          name: "supplier-portal",
          displayName: "Supplier Portal",
          description: "Manage suppliers",
          useCurrentDirectory: false,
          aiTool: "codex",
        },
        "tenant-123",
      ),
    ).toEqual([
      "supplier-portal",
      "--skip-prompts",
      "--no-splash",
      "--company-workspace",
      "tenant-123",
      "--display-name",
      "Supplier Portal",
      "--description",
      "Manage suppliers",
      "--package-profile",
      "external",
      "--tool",
      "codex",
    ]);
  });

  test("forwards the selected harness into scripted init", () => {
    expect(buildForwardedInitArgs("my-app", {
      ...baseOptions,
      skipPrompts: true,
      tool: "claude",
    })).toEqual([
      "my-app", "--skip-prompts", "--no-splash", "--package-profile", "external", "--tool", "claude",
    ]);
  });

  test("keeps the legacy scaffold flags available for scripted create", () => {
    expect(
      buildForwardedInitArgs("my-app", {
        ...baseOptions,
        skipPrompts: true,
        currentDir: true,
        gofer: false,
        from: "./local-template",
        companyTenant: "tenant-456",
      }),
    ).toEqual([
      "my-app",
      "--skip-prompts",
      "--no-splash",
      "--company-workspace",
      "tenant-456",
      "--current-dir",
      "--from",
      "./local-template",
      "--no-gofer",
      "--package-profile",
      "external",
    ]);
  });

  test("forwards explicit trust for custom template scripts", () => {
    expect(
      buildForwardedInitArgs("my-app", {
        ...baseOptions,
        from: "./reviewed-template",
        trustTemplateScripts: true,
      }),
    ).toContain("--trust-template-scripts");
  });

  test("can explicitly skip automatic dependency installation", () => {
    expect(
      buildForwardedInitArgs("my-app", {
        ...baseOptions,
        install: false,
      }),
    ).toContain("--no-install");
  });

  test("forwards an existing app binding without changing the create flow", () => {
    expect(
      buildForwardedInitArgs("local-project", {
        ...baseOptions,
        skipPrompts: true,
        companyTenant: "tenant-456",
        appKey: "existing-app",
      }),
    ).toContain("--app-key");
    expect(
      buildForwardedInitArgs("local-project", {
        ...baseOptions,
        skipPrompts: true,
        companyTenant: "tenant-456",
        appKey: "existing-app",
      }),
    ).toContain("existing-app");
  });

  test("lets --skip-onboarding fall back to the legacy interactive prompts", () => {
    expect(
      buildForwardedInitArgs("my-app", {
        ...baseOptions,
        skipOnboarding: true,
      }),
    ).toEqual(["my-app", "--no-splash", "--package-profile", "external"]);
  });
});

describe("guided create tenant boundary", () => {
  beforeEach(() => {
    resolveActiveTenantContext.mockReset();
    resolveActiveTenantContext.mockResolvedValue({});
  });

  test("an explicit company tenant cannot be replaced by the cached active tenant", async () => {
    await resolveCreateTenantContext("https://public-api.example", {
      ...baseOptions,
      companyTenant: "tenant-b",
    });
    expect(resolveActiveTenantContext).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-b" }),
    );
  });

  test("honors the deprecated --tenant alias", async () => {
    await resolveCreateTenantContext("https://public-api.example", {
      ...baseOptions,
      tenant: "tenant-c",
    });
    expect(resolveActiveTenantContext).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-c" }),
    );
  });

  test("falls back to interactive selection when no tenant is requested", async () => {
    await resolveCreateTenantContext("https://public-api.example", baseOptions);
    expect(resolveActiveTenantContext).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: undefined, interactive: true }),
    );
  });
});

describe("guided create completion reporting", () => {
  test("only claims the workspace is ready when builder readiness is available", () => {
    const ready = buildCreateCompletionSummary(true, "codex");
    expect(ready.heading).toContain("ready");
    expect(ready.steps.join("\n")).toContain("eai start");
  });

  test("does not send the builder into an unproven hand-off", () => {
    const pending = buildCreateCompletionSummary(false, "codex");
    expect(pending.heading).not.toContain("is ready");
    expect(pending.heading).toContain("not confirmed");
    expect(pending.steps.join("\n")).toContain("eai doctor");
  });
});

describe("template install trust boundary", () => {
  test("runs lifecycle scripts only for the canonical template", () => {
    expect(
      buildTemplateInstallArgs(
        "https://github.com/eai-support/eai-app-template.git",
      ),
    ).not.toContain("--ignore-scripts");
  });

  test("blocks lifecycle scripts for custom template sources", () => {
    expect(buildTemplateInstallArgs("./local-template")).toContain(
      "--ignore-scripts",
    );
    expect(
      buildTemplateInstallArgs("https://github.com/someone/untrusted.git"),
    ).toContain("--ignore-scripts");
  });

  test("requires explicit trust before running a custom template generator", () => {
    expect(
      canRunTemplateScripts(
        "https://github.com/eai-support/eai-app-template.git",
        false,
      ),
    ).toBe(true);
    expect(canRunTemplateScripts("./local-template", false)).toBe(false);
    expect(canRunTemplateScripts("./local-template", true)).toBe(true);
  });
});

describe("eai create inline sign-in", () => {
  const PROD_DIRECTORY = "f3035369-5c1a-45f7-8ca5-5cb0ad291d26";
  const PROD_CLIENT = "d704bde5-fe36-44ff-9a26-221d53772dd0";
  let environment: TestEnvironment;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  function fixtureTokens(): auth.StoredTokens {
    return {
      accessToken: "<fixture-access-value>",
      expiresAt: Date.now() + 600_000,
      tenantName: "enterpriseaiplatform",
      tenantId: PROD_DIRECTORY,
      clientId: PROD_CLIENT,
      upn: "person@example.test",
    };
  }

  beforeEach(async () => {
    environment = await createTestEnvironment();
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = environment.dir;
    process.env.USERPROFILE = environment.dir;
    for (const key of ["EAI_ACCESS_TOKEN", "EAI_LOGIN_VIA_PORTAL", "EAI_AUTH_TENANT_NAME", "EAI_AUTH_TENANT_ID",
      "EAI_AUTH_SCOPE", "EAI_PUBLIC_API_SCOPE", "EAI_CLI_CLIENT_ID", "EAI_AUTH_CLIENT_ID", "EAI_CLI_COMPANY_CLIENT_ID"]) {
      vi.stubEnv(key, undefined);
    }
    setActiveProfile("default");
    vi.spyOn(process, "cwd").mockReturnValue(environment.dir);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(inquirer, "prompt").mockResolvedValue({ proceed: true } as never);
  });

  afterEach(async () => {
    await auth.clearTokens();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
    await environment.cleanup();
  });

  test("goes through the Admin Portal by default, like plain eai login", async () => {
    // Every browser flow is replaced, so no test opens a real browser.
    const portal = vi.spyOn(auth, "portalLogin").mockResolvedValue({
      tokens: fixtureTokens(),
      signedInEmail: "Person@Example.Test",
      typedEmail: "person@example.test",
    });
    const direct = vi.spyOn(auth, "browserLogin").mockRejectedValue(new Error("direct sign-in must not run"));

    await ensureCreateAuthentication();

    expect(portal).toHaveBeenCalledWith("enterpriseaiplatform", PROD_DIRECTORY, expect.any(String), expect.objectContaining({
      portalUrl: "https://admin-portal.myenterprise.ai",
      standardClientId: PROD_CLIENT,
    }));
    expect(direct).not.toHaveBeenCalled();
    expect((await auth.loadTokens())?.clientId).toBe(PROD_CLIENT);
  });

  test.each([
    ["--direct", { direct: true }, {}],
    ["EAI_LOGIN_VIA_PORTAL=false", {}, { EAI_LOGIN_VIA_PORTAL: "false" }],
  ])("%s keeps the direct sign-in", async (_name, options, env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const portal = vi.spyOn(auth, "portalLogin").mockRejectedValue(new Error("Portal sign-in must not run"));
    const direct = vi.spyOn(auth, "browserLogin").mockResolvedValue(fixtureTokens());

    await ensureCreateAuthentication(options);

    expect(direct).toHaveBeenCalledWith("enterpriseaiplatform", PROD_DIRECTORY, PROD_CLIENT, expect.any(String), expect.any(Object));
    expect(portal).not.toHaveBeenCalled();
    expect((await auth.loadTokens())?.clientId).toBe(PROD_CLIENT);
  });

  test("a signed-in email that differs from the typed one is not saved without a yes", async () => {
    vi.spyOn(auth, "portalLogin").mockResolvedValue({
      tokens: fixtureTokens(),
      signedInEmail: "someone-else@example.test",
      typedEmail: "person@example.test",
    });
    vi.spyOn(auth, "browserLogin").mockRejectedValue(new Error("direct sign-in must not run"));

    // No terminal under test, so the default answer (no) applies.
    await expect(ensureCreateAuthentication()).rejects.toThrow("Login not saved.");
    expect(await auth.loadTokens()).toBeNull();
  });

  test("an existing login is reused without opening a browser", async () => {
    await auth.storeTokens(fixtureTokens());
    const portal = vi.spyOn(auth, "portalLogin");
    const direct = vi.spyOn(auth, "browserLogin");

    await ensureCreateAuthentication();

    expect(portal).not.toHaveBeenCalled();
    expect(direct).not.toHaveBeenCalled();
  });

  test("eai create accepts --direct for its inline sign-in", () => {
    expect(createCommand.options.map((option) => option.long)).toContain("--direct");
  });
});
