import { beforeEach, describe, expect, test, vi } from "vitest";

const resolveActiveTenantContext = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/tenant-context.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveActiveTenantContext,
}));

import {
  buildCreateCompletionSummary,
  buildForwardedInitArgs,
  buildTemplateInstallArgs,
  resolveCreateTenantContext,
  toKebabCase,
  type CreateCommandOptions,
} from "../../src/commands/init.js";

const baseOptions: CreateCommandOptions = {
  from: "https://github.com/eai-support/eai-app-template.git",
  skipPrompts: false,
  skipOnboarding: false,
  currentDir: false,
  packageProfile: "external",
};

describe("eai create onboarding helpers", () => {
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
      "--company-tenant",
      "tenant-123",
      "--display-name",
      "Supplier Portal",
      "--description",
      "Manage suppliers",
      "--package-profile",
      "external",
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
      "--company-tenant",
      "tenant-456",
      "--current-dir",
      "--from",
      "./local-template",
      "--no-gofer",
      "--package-profile",
      "external",
    ]);
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
});
