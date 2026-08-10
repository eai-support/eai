import { createRequire } from "node:module";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { isSimpleMode } from "./output.js";

type RGB = [number, number, number];
type ColorMode = "truecolor" | "256" | "none";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version: string };

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
// ANSI escape sequences are intentionally matched here to calculate visible width.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

const SKY: RGB = [131, 219, 249];
const WORDMARK: RGB = [255, 255, 255];
const BORDER: RGB = [90, 140, 158];
const DIM: RGB = [148, 156, 173];
const DIMMER: RGB = [98, 106, 123];
const CYAN: RGB = [92, 208, 224];
const AMBER: RGB = [242, 180, 90];
const USER: RGB = [127, 224, 166];
const COMMAND: RGB = [231, 233, 240];

const FALLBACK_256: Record<string, number> = {
  "131,219,249": 117,
  "255,255,255": 15,
  "90,140,158": 66,
  "148,156,173": 103,
  "98,106,123": 60,
  "92,208,224": 80,
  "242,180,90": 215,
  "127,224,166": 114,
  "231,233,240": 255,
};

export const EAI_WORDMARK_COLOR = "#FFFFFF";
export const EAI_ACCENT_COLOR = "#83DBF9";
export const EAI_BORDER_COLOR = "#5A8C9E";

/** Exact six-line EAI banner used by the terminal card. */
export const EAI_WORDMARK = [
  "███████╗ █████╗ ██╗",
  "██╔════╝██╔══██╗██║",
  "█████╗  ███████║██║",
  "██╔══╝  ██╔══██║██║",
  "███████╗██║  ██║██║",
  "╚══════╝╚═╝  ╚═╝╚═╝",
] as const;

const BANNER = EAI_WORDMARK;

function renderBannerLine(line: string, lineIndex: number, mode: ColorMode): string {
  if (mode === "none") return line;

  // The base wordmark is white. These three blue segments are the intentional
  // Brand accents: the right half of E's middle filled bar and the actual
  // lower body block of A. All outline glyphs and the I remain white.
  if (lineIndex === 2) {
    return (
      paint(WORDMARK, line.slice(0, 3), mode) +
      paint(SKY, line.slice(3, 5), mode) +
      paint(WORDMARK, line.slice(5), mode)
    );
  }

  if (lineIndex === 4) {
    return (
      paint(WORDMARK, line.slice(0, 13), mode) +
      paint(SKY, line.slice(13, 15), mode) +
      paint(WORDMARK, line.slice(15), mode)
    );
  }

  return paint(WORDMARK, line, mode);
}

/**
 * Resolved per render, not at import time: the root command applies --no-color
 * and --color in its preAction hook, long after this module is loaded.
 */
function colorMode(): ColorMode {
  if (process.env.NO_COLOR) return "none";
  if (!process.env.FORCE_COLOR && !process.stdout.isTTY) return "none";
  return /truecolor|24bit/i.test(process.env.COLORTERM ?? "")
    ? "truecolor"
    : "256";
}

function paint(rgb: RGB, text: string, mode: ColorMode = colorMode()): string {
  if (mode === "none") return text;
  if (mode === "truecolor") {
    return `${ESC}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}${RESET}`;
  }
  return `${ESC}38;5;${FALLBACK_256[rgb.join(",")] ?? 7}m${text}${RESET}`;
}

const visibleWidth = (value: string): number =>
  value.replace(ANSI_RE, "").length;

function terminalPrompt(mode: ColorMode): string {
  const user = process.env.USER || process.env.USERNAME || "user";
  const host = hostname().split(".")[0] || "eai";
  return `${paint(USER, `${user}@${host}`, mode)} ${paint(DIM, "~", mode)} ${paint(COMMAND, "eai", mode)}`;
}

function buildContent(mode: ColorMode): string[] {
  return [
    "",
    ...BANNER.map((line, index) => renderBannerLine(line, index, mode)),
    "",
    paint(DIM, "Welcome to Enterprise AI ", mode) +
      paint(CYAN, `v${packageJson.version}`, mode),
    "",
    paint(DIM, "Stuck?", mode) +
      "  " +
      paint(AMBER, "eai help", mode) +
      "  " +
      paint(DIMMER, "everything you can do", mode),
    "",
  ];
}

function buildCardLines(mode: ColorMode): string[] {
  const content = buildContent(mode);
  const padding = 3;
  const contentWidth = Math.max(...content.map(visibleWidth));
  const innerWidth = contentWidth + padding * 2;
  const border = (value: string) => paint(BORDER, value, mode);
  const top = border(`╭${"─".repeat(innerWidth)}╮`);
  const bottom = border(`╰${"─".repeat(innerWidth)}╯`);
  const row = (line: string) =>
    `${border("│")}${" ".repeat(padding)}${line}${" ".repeat(
      Math.max(0, innerWidth - padding - visibleWidth(line)),
    )}${border("│")}`;

  return [terminalPrompt(mode), "", top, ...content.map(row), bottom, ""];
}

export function renderEaiWordmark(colored = true): string {
  const mode = colored ? colorMode() : "none";
  return BANNER.map((line, index) => renderBannerLine(line, index, mode)).join("\n");
}

export function renderEaiSplash(colored = true): string {
  const mode = colored ? colorMode() : "none";
  return buildCardLines(mode).join("\n");
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

export async function renderSplash(
  options: { animate?: boolean } = {},
): Promise<void> {
  const mode = colorMode();
  const animate = (options.animate ?? true) && mode !== "none";
  const lines = buildCardLines(mode);

  if (!animate) {
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }

  for (const line of lines) {
    process.stdout.write(`${line}\n`);
    if (visibleWidth(line) > 0) await sleep(70);
  }
}

export async function printEaiSplash(
  enabled = true,
  stdout: Pick<NodeJS.WriteStream, "isTTY"> = process.stdout,
): Promise<void> {
  if (!shouldShowEaiSplash(enabled, stdout)) return;

  await renderSplash({ animate: process.env.EAI_NO_ANIMATION !== "1" });
}
