import chalk from "chalk";
import { isSimpleMode } from "./output.js";

export const EAI_WORDMARK_COLOR = "#1A3754";
export const EAI_ACCENT_COLOR = "#8EDFF9";

/**
 * ANSI Shadow-style wordmark used by the interactive create experience.
 * Keep this as a checked-in asset so the splash does not depend on figlet or
 * another runtime package being available on the user's machine.
 */
export const EAI_WORDMARK = [
  "███████╗  █████╗  ██╗",
  "██╔════╝ ██╔══██╗ ██║",
  "█████╗   ███████║ ██║",
  "██╔══╝   ██╔══██║ ██║",
  "███████╗ ██║  ██║ ██║",
  "╚══════╝ ╚═╝  ╚═╝ ╚═╝",
] as const;

/** Compact terminal version of the EAI mark: dot, light-blue chevron, and navy stem. */
export const EAI_LOGOMARK = [
  { dark: "        ●", accent: "" },
  { dark: "", accent: "      ▄███▄" },
  { dark: "", accent: "    ▄██   ██▄" },
  { dark: "", accent: "  ▄███       ███" },
  { dark: "       ▲", accent: "" },
  { dark: "       ███", accent: "" },
] as const;

export function renderEaiWordmark(colored = true): string {
  const wordmark = EAI_WORDMARK.join("\n");
  return colored ? chalk.hex(EAI_WORDMARK_COLOR)(wordmark) : wordmark;
}

export function renderEaiSplash(colored = true): string {
  return EAI_WORDMARK.map((wordmarkLine, index) => {
    const markLine = EAI_LOGOMARK[index];
    const wordmark = colored
      ? chalk.hex(EAI_WORDMARK_COLOR)(wordmarkLine)
      : wordmarkLine;
    const dark = colored
      ? chalk.hex(EAI_WORDMARK_COLOR)(markLine.dark)
      : markLine.dark;
    const accent = colored
      ? chalk.hex(EAI_ACCENT_COLOR)(markLine.accent)
      : markLine.accent;
    return `${wordmark}${dark}${accent}`;
  }).join("\n");
}

export function shouldShowEaiSplash(
  enabled = true,
  stdout: Pick<NodeJS.WriteStream, "isTTY"> = process.stdout,
): boolean {
  return (
    enabled &&
    !isSimpleMode() &&
    !process.env.CI &&
    process.env.EAI_NO_SPLASH !== "1" &&
    Boolean(stdout.isTTY)
  );
}

export function printEaiSplash(
  enabled = true,
  stdout: Pick<NodeJS.WriteStream, "isTTY"> = process.stdout,
): void {
  if (!shouldShowEaiSplash(enabled, stdout)) {
    return;
  }

  const colored = !process.env.NO_COLOR && process.env.FORCE_COLOR !== "0";
  console.log(renderEaiSplash(colored));
  console.log();
}
