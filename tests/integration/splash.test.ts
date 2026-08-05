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
});
