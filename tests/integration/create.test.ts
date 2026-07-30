import { describe, expect, test } from "vitest";
import {
  buildForwardedInitArgs,
  toKebabCase,
  type CreateCommandOptions,
} from "../../src/commands/init.js";

const baseOptions: CreateCommandOptions = {
  from: "https://github.com/eai-tools/eai-app-template.git",
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

  test("lets --skip-onboarding fall back to the legacy interactive prompts", () => {
    expect(
      buildForwardedInitArgs("my-app", {
        ...baseOptions,
        skipOnboarding: true,
      }),
    ).toEqual(["my-app", "--no-splash", "--package-profile", "external"]);
  });
});
