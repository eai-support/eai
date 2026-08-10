import { describe, expect, test } from "vitest";
import {
  EAI_ACCENT_COLOR,
  EAI_BORDER_COLOR,
  EAI_WORDMARK,
  EAI_WORDMARK_COLOR,
  renderEaiSplash,
  renderEaiWordmark,
  shouldShowEaiSplash,
} from "../../src/lib/splash.js";

describe("EAI splash", () => {
  test("uses the ANSI Shadow-style EAI wordmark", () => {
    expect(renderEaiWordmark(false)).toBe(EAI_WORDMARK.join("\n"));
    expect(renderEaiWordmark(false)).toContain("███████╗");
    expect(renderEaiWordmark(false)).toContain("█████╗");
    expect(renderEaiWordmark(false)).toContain("██╗");
  });

  test("uses the approved EAI primary color", () => {
    expect(EAI_WORDMARK_COLOR).toBe("#FFFFFF");
    expect(EAI_ACCENT_COLOR).toBe("#83DBF9");
    expect(EAI_BORDER_COLOR).toBe("#5A8C9E");
  });

  test("renders the ANSI terminal card", () => {
    const splash = renderEaiSplash(false);
    for (const line of EAI_WORDMARK) {
      expect(splash).toContain(line);
    }
    expect(splash).toContain("╭");
    expect(splash).toContain("╰");
    expect(splash).toContain("Welcome to Enterprise AI v");
    expect(splash).toContain("eai help");
    expect(splash).not.toContain("●");
  });

  test("only shows in an interactive terminal", () => {
    expect(shouldShowEaiSplash(true, { isTTY: false })).toBe(false);
  });

  test("can be disabled explicitly", () => {
    expect(shouldShowEaiSplash(false, { isTTY: true })).toBe(false);
  });

  test("honors --no-color applied after module import", () => {
    const previousNoColor = process.env.NO_COLOR;
    const previousForceColor = process.env.FORCE_COLOR;
    // The root command sets these in preAction, long after splash.ts loads.
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    try {
      // eslint-disable-next-line no-control-regex
      expect(renderEaiSplash(true)).toMatch(/\x1b\[/);
      process.env.NO_COLOR = "1";
      // eslint-disable-next-line no-control-regex
      expect(renderEaiSplash(true)).not.toMatch(/\x1b\[/);
    } finally {
      if (previousNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previousNoColor;
      if (previousForceColor === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = previousForceColor;
    }
  });
});
