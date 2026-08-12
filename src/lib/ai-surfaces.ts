import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export type AiSurfaceId =
  | 'vscode-copilot'
  | 'copilot-cli'
  | 'copilot-desktop'
  | 'claude-desktop'
  | 'claude-cli'
  | 'codex-desktop'
  | 'codex-cli'
  | 'grok-cli';

export type AiSurfaceKind = 'desktop' | 'cli' | 'editor';
export type LaunchSupport = 'project-and-prompt' | 'project-only' | 'manual-project';

export interface AiSurfaceDefinition {
  id: AiSurfaceId;
  name: string;
  provider: 'GitHub' | 'Anthropic' | 'OpenAI' | 'xAI';
  kind: AiSurfaceKind;
  installUrl: string;
  launchSupport: LaunchSupport;
  commands: readonly string[];
  macApplications?: readonly string[];
  windowsApplications?: readonly string[];
}

export interface DetectedAiSurface extends AiSurfaceDefinition {
  installed: boolean;
  executable: string | null;
  recommended: boolean;
  previouslyUsed: boolean;
  status: 'ready' | 'not-installed';
  nextAction: string;
}

export interface AiSurfaceInventory {
  contractVersion: 'eai.ai-surfaces/v1';
  platform: NodeJS.Platform;
  projectDirectory: string;
  preferredSurface: AiSurfaceId | null;
  recommendedSurface: AiSurfaceId | null;
  surfaces: DetectedAiSurface[];
}

export interface SurfaceProbe {
  commandPath(command: string): string | null;
  fileExists(path: string): boolean;
  commandOutput(command: string, args: readonly string[]): string | null;
}

export interface LaunchPlan {
  surfaceId: AiSurfaceId;
  surfaceName: string;
  projectDirectory: string;
  mode: 'process' | 'terminal' | 'url' | 'application';
  command: string;
  args: string[];
  cwd: string;
  preparedPrompt: boolean;
  userMessage: string;
}

interface AiPreferences {
  version: 1;
  lastAiSurface?: AiSurfaceId;
}

export const EAI_FIRST_PROMPT = [
  'Use the repository EAI skill to start this app.',
  'Ask me for the business outcome first.',
  'Explain how the EAI platform helps as we work.',
  'Keep internal numbered delivery stages hidden.',
  'Pause for my approval of the business specification, then continue unless a material business, security, cost, deployment, or destructive decision needs approval.',
].join(' ');

export const AI_SURFACES: readonly AiSurfaceDefinition[] = [
  {
    id: 'vscode-copilot',
    name: 'GitHub Copilot in VS Code',
    provider: 'GitHub',
    kind: 'editor',
    installUrl: 'https://code.visualstudio.com/docs/copilot/setup',
    launchSupport: 'project-and-prompt',
    commands: ['code'],
    macApplications: ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'],
    windowsApplications: [
      'AppData/Local/Programs/Microsoft VS Code/bin/code.cmd',
      'AppData/Local/Programs/Microsoft VS Code/Code.exe',
    ],
  },
  {
    id: 'copilot-cli',
    name: 'GitHub Copilot CLI',
    provider: 'GitHub',
    kind: 'cli',
    installUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
    launchSupport: 'project-and-prompt',
    commands: ['copilot'],
  },
  {
    id: 'copilot-desktop',
    name: 'GitHub Copilot',
    provider: 'GitHub',
    kind: 'desktop',
    installUrl: 'https://docs.github.com/en/copilot/how-tos/github-copilot-app/getting-started',
    launchSupport: 'manual-project',
    commands: [],
    macApplications: ['/Applications/GitHub Copilot.app'],
    windowsApplications: ['AppData/Local/Programs/GitHub Copilot/GitHub Copilot.exe'],
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    provider: 'Anthropic',
    kind: 'desktop',
    installUrl: 'https://claude.ai/download',
    launchSupport: 'manual-project',
    commands: [],
    macApplications: ['/Applications/Claude.app'],
    windowsApplications: ['AppData/Local/AnthropicClaude/Claude.exe', 'AppData/Local/Programs/Claude/Claude.exe'],
  },
  {
    id: 'claude-cli',
    name: 'Claude Code',
    provider: 'Anthropic',
    kind: 'cli',
    installUrl: 'https://code.claude.com/docs/en/setup',
    launchSupport: 'project-and-prompt',
    commands: ['claude'],
  },
  {
    id: 'codex-desktop',
    name: 'Codex Desktop',
    provider: 'OpenAI',
    kind: 'desktop',
    installUrl: 'https://openai.com/codex/',
    launchSupport: 'project-only',
    commands: [],
    macApplications: ['/Applications/Codex.app'],
    windowsApplications: ['AppData/Local/Programs/Codex/Codex.exe'],
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    provider: 'OpenAI',
    kind: 'cli',
    installUrl: 'https://developers.openai.com/codex/cli/',
    launchSupport: 'project-and-prompt',
    commands: ['codex'],
  },
  {
    id: 'grok-cli',
    name: 'Grok Build',
    provider: 'xAI',
    kind: 'cli',
    installUrl: 'https://x.ai/cli',
    launchSupport: 'project-and-prompt',
    commands: ['grok'],
  },
] as const;

function preferencesPath(home = homedir()): string {
  return join(home, '.eai', 'preferences.json');
}

export async function readAiPreferences(home = homedir()): Promise<AiPreferences> {
  try {
    const parsed = JSON.parse(await readFile(preferencesPath(home), 'utf8')) as Partial<AiPreferences>;
    const validSurface = AI_SURFACES.some((surface) => surface.id === parsed.lastAiSurface);
    return { version: 1, ...(validSurface ? { lastAiSurface: parsed.lastAiSurface } : {}) };
  } catch {
    return { version: 1 };
  }
}

export async function rememberAiSurface(surfaceId: AiSurfaceId, home = homedir()): Promise<void> {
  const target = preferencesPath(home);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, lastAiSurface: surfaceId }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, target);
}

function defaultCommandPath(command: string): string | null {
  const resolver = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(resolver, [command], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

export const systemSurfaceProbe: SurfaceProbe = {
  commandPath: defaultCommandPath,
  fileExists: existsSync,
  commandOutput(command, args) {
    const result = spawnSync(command, [...args], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    if (result.status !== 0) return null;
    return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  },
};

function candidateApplicationPaths(surface: AiSurfaceDefinition, platform: NodeJS.Platform, home: string): string[] {
  if (platform === 'darwin') {
    return (surface.macApplications ?? []).flatMap((path) => [
      path,
      path.startsWith('/Applications/')
        ? join(home, 'Applications', path.slice('/Applications/'.length))
        : join(home, 'Applications', basename(path)),
    ]);
  }
  if (platform === 'win32') {
    return (surface.windowsApplications ?? []).map((path) =>
      /^[A-Za-z]:[\\/]/.test(path) ? path : join(home, path),
    );
  }
  return [];
}

function findSurfaceExecutable(
  surface: AiSurfaceDefinition,
  platform: NodeJS.Platform,
  home: string,
  probe: SurfaceProbe,
): string | null {
  for (const command of surface.commands) {
    const found = probe.commandPath(command);
    if (found) {
      if (surface.id === 'vscode-copilot') {
        const extensions = probe.commandOutput(found, ['--list-extensions'])?.toLowerCase() ?? '';
        if (!extensions.includes('github.copilot')) continue;
      }
      return found;
    }
  }
  return candidateApplicationPaths(surface, platform, home).find((path) => probe.fileExists(path)) ?? null;
}

export async function detectAiSurfaces(options: {
  projectDirectory?: string;
  platform?: NodeJS.Platform;
  home?: string;
  probe?: SurfaceProbe;
  preferredSurface?: AiSurfaceId | null;
} = {}): Promise<AiSurfaceInventory> {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const probe = options.probe ?? systemSurfaceProbe;
  const preferences = options.preferredSurface === undefined ? await readAiPreferences(home) : { version: 1 as const, lastAiSurface: options.preferredSurface ?? undefined };
  const installed = AI_SURFACES.map((surface) => ({
    surface,
    executable: findSurfaceExecutable(surface, platform, home, probe),
  }));
  const availableIds = new Set(installed.filter((item) => item.executable).map((item) => item.surface.id));
  const preferredSurface = preferences.lastAiSurface && availableIds.has(preferences.lastAiSurface)
    ? preferences.lastAiSurface
    : null;
  const recommendedSurface = preferredSurface
    ?? installed.find((item) => item.executable)?.surface.id
    ?? 'vscode-copilot';

  return {
    contractVersion: 'eai.ai-surfaces/v1',
    platform,
    projectDirectory: resolve(options.projectDirectory ?? process.cwd()),
    preferredSurface,
    recommendedSurface,
    surfaces: installed.map(({ surface, executable }) => ({
      ...surface,
      installed: Boolean(executable),
      executable,
      recommended: surface.id === recommendedSurface,
      previouslyUsed: surface.id === preferredSurface,
      status: executable ? 'ready' : 'not-installed',
      nextAction: executable
        ? `Start EAI in ${surface.name}`
        : `Get ${surface.name} from ${surface.provider}`,
    })),
  };
}

function surfaceOrThrow(inventory: AiSurfaceInventory, surfaceId: string): DetectedAiSurface {
  const surface = inventory.surfaces.find((candidate) => candidate.id === surfaceId);
  if (!surface) throw new Error(`Unknown AI surface: ${surfaceId}`);
  return surface;
}

export function buildAiLaunchPlan(inventory: AiSurfaceInventory, surfaceId: AiSurfaceId): LaunchPlan {
  const surface = surfaceOrThrow(inventory, surfaceId);
  if (!surface.installed || !surface.executable) {
    throw new Error(`${surface.name} is not installed. Open ${surface.installUrl} to get it.`);
  }
  const project = inventory.projectDirectory;
  const common = {
    surfaceId,
    surfaceName: surface.name,
    projectDirectory: project,
    cwd: project,
  } as const;

  switch (surfaceId) {
    case 'vscode-copilot':
      return { ...common, mode: 'process', command: surface.executable, args: ['chat', '-m', 'agent', EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'VS Code will open this project and start an EAI Copilot chat.' };
    case 'copilot-cli':
      return { ...common, mode: 'terminal', command: surface.executable, args: ['-C', project, '-i', EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive EAI Copilot session.' };
    case 'copilot-desktop':
      return { ...common, mode: 'application', command: surface.executable, args: [], preparedPrompt: false, userMessage: 'GitHub Copilot will open. Choose this project folder once, then enter /eai.' };
    case 'claude-desktop':
      return { ...common, mode: 'application', command: surface.executable, args: [], preparedPrompt: false, userMessage: 'Claude Desktop will open. Start a Local session, choose this project folder, then enter /eai.' };
    case 'claude-cli':
      return { ...common, mode: 'terminal', command: surface.executable, args: [EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive Claude EAI session.' };
    case 'codex-desktop': {
      const codexCli = inventory.surfaces.find((candidate) => candidate.id === 'codex-cli');
      return codexCli?.installed && codexCli.executable
        ? { ...common, mode: 'process', command: codexCli.executable, args: ['app', project], preparedPrompt: false, userMessage: 'Codex will open this project. Start with /eai.' }
        : { ...common, mode: 'application', command: surface.executable, args: [project], preparedPrompt: false, userMessage: 'Codex will open this project. Start with /eai.' };
    }
    case 'codex-cli':
      return { ...common, mode: 'terminal', command: surface.executable, args: [EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive Codex EAI session.' };
    case 'grok-cli':
      return { ...common, mode: 'terminal', command: surface.executable, args: [], preparedPrompt: false, userMessage: 'A terminal will open Grok in this project. Start with /eai.' };
  }
}

function shellQuote(value: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function spawnDetached(command: string, args: readonly string[], cwd?: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], { cwd, detached: true, stdio: 'ignore', windowsHide: true });
    child.once('spawn', () => {
      child.unref();
      resolvePromise();
    });
    child.once('error', rejectPromise);
  });
}

export async function openExternalUrl(url: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (!/^https:\/\//.test(url)) {
    throw new Error('EAI refused to open a non-HTTPS provider location.');
  }
  if (platform === 'darwin') await spawnDetached('open', [url]);
  else if (platform === 'win32') await spawnDetached('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  else await spawnDetached('xdg-open', [url]);
}

export async function executeAiLaunchPlan(plan: LaunchPlan, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (plan.mode === 'url') {
    await openExternalUrl(plan.command, platform);
    return;
  }
  if (plan.mode === 'application') {
    if (platform === 'darwin') await spawnDetached('open', ['-a', plan.command, ...plan.args]);
    else await spawnDetached(plan.command, plan.args, plan.cwd);
    return;
  }
  if (plan.mode === 'process') {
    await spawnDetached(plan.command, plan.args, plan.cwd);
    return;
  }

  const commandLine = [plan.command, ...plan.args].map((value) => shellQuote(value, platform)).join(' ');
  if (platform === 'darwin') {
    const escaped = `cd ${shellQuote(plan.cwd, platform)} && ${commandLine}`.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    await spawnDetached('osascript', ['-e', `tell application "Terminal" to do script "${escaped}"`]);
  } else if (platform === 'win32') {
    await spawnDetached('cmd.exe', ['/k', `cd /d ${shellQuote(plan.cwd, platform)} && ${commandLine}`]);
  } else {
    await spawnDetached('x-terminal-emulator', ['-e', 'sh', '-lc', `cd ${shellQuote(plan.cwd, platform)} && ${commandLine}`]);
  }
}

export function getAiSurface(inventory: AiSurfaceInventory, surfaceId: string): DetectedAiSurface {
  return surfaceOrThrow(inventory, surfaceId);
}
