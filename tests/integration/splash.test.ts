import { describe, expect, test } from "vitest";
import {
  EAI_ACCENT_COLOR,
  EAI_LOGOMARK,
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
    expect(EAI_WORDMARK_COLOR).toBe("#1A3754");
    expect(EAI_ACCENT_COLOR).toBe("#8EDFF9");
  });

  test("places the EAI dot-and-arrow mark to the right of the wordmark", () => {
    const splash = renderEaiSplash(false);
    expect(splash).toContain(EAI_LOGOMARK[0].dark);
    expect(splash).toContain(EAI_LOGOMARK[1].accent);
    expect(splash).toContain("▲");
  });

  test("only shows in an interactive terminal", () => {
    expect(shouldShowEaiSplash(true, { isTTY: false })).toBe(false);
  });

  test("can be disabled explicitly", () => {
    expect(shouldShowEaiSplash(false, { isTTY: true })).toBe(false);
  });
});
