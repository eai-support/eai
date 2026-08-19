import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, win32 as win32Path } from 'node:path';
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
  launchArgsPrefix: string[];
  launchEnvironment: Record<string, string>;
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
  fileContent?(path: string): string | null;
  realPath?(path: string): string | null;
  commandOutput(command: string, args: readonly string[], environment?: Readonly<Record<string, string>>): string | null;
}

export interface LaunchPlan {
  surfaceId: AiSurfaceId;
  surfaceName: string;
  projectDirectory: string;
  mode: 'process' | 'terminal' | 'url' | 'application';
  command: string;
  args: string[];
  environment?: Record<string, string>;
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
      'AppData/Local/Programs/Microsoft VS Code/Code.exe',
      'AppData/Local/Programs/Microsoft VS Code/bin/code.cmd',
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
    launchSupport: 'project-and-prompt',
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
    name: 'ChatGPT Desktop (Codex)',
    provider: 'OpenAI',
    kind: 'desktop',
    installUrl: 'https://learn.chatgpt.com/docs/app',
    launchSupport: 'manual-project',
    commands: [],
    macApplications: ['/Applications/ChatGPT.app', '/Applications/Codex.app'],
    windowsApplications: [
      'AppData/Local/Programs/ChatGPT/ChatGPT.exe',
      'AppData/Local/Programs/Codex/Codex.exe',
    ],
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    provider: 'OpenAI',
    kind: 'cli',
    installUrl: 'https://learn.chatgpt.com/docs/codex/cli',
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
  const candidates = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (process.platform === 'win32') {
    return candidates.find((candidate) => /\.(?:exe|com|cmd|bat)$/i.test(candidate)) ?? candidates[0] ?? null;
  }
  return candidates[0] ?? null;
}

export const systemSurfaceProbe: SurfaceProbe = {
  commandPath: defaultCommandPath,
  fileExists: existsSync,
  fileContent(path) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  realPath(path) {
    try {
      return realpathSync(path);
    } catch {
      return null;
    }
  },
  commandOutput(command, args, environment) {
    const result = spawnSync(command, [...args], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      env: { ...process.env, ...environment },
    });
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
      /^[A-Za-z]:[\\/]/.test(path) ? path : win32Path.join(home, path),
    );
  }
  return [];
}

interface SurfaceTarget {
  executable: string;
  launchArgsPrefix: string[];
  launchEnvironment: Record<string, string>;
}

function windowsVsCodeTarget(
  surface: AiSurfaceDefinition,
  home: string,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  const shims = new Set<string>();
  const executables = new Set<string>();
  for (const command of surface.commands) {
    const found = probe.commandPath(command);
    if (!found) continue;
    if (/\.(?:cmd|bat)$/i.test(found)) shims.add(found);
    else if (/\.(?:exe|com)$/i.test(found)) executables.add(found);
  }
  for (const candidate of candidateApplicationPaths(surface, 'win32', home)) {
    if (/\.(?:cmd|bat)$/i.test(candidate)) shims.add(candidate);
    else if (/\.(?:exe|com)$/i.test(candidate)) executables.add(candidate);
  }
  for (const executable of executables) {
    shims.add(win32Path.join(win32Path.dirname(executable), 'bin', 'code.cmd'));
  }

  for (const shim of shims) {
    if (!probe.fileExists(shim)) continue;
    const executable = win32Path.resolve(win32Path.dirname(shim), '..', 'Code.exe');
    if (!probe.fileExists(executable)) continue;
    const content = probe.fileContent?.(shim) ?? '';
    const cliMatch = content.match(/"%~dp0([^"\r\n]*\\resources\\app\\out\\cli\.js)"/i);
    if (!cliMatch) continue;
    const cliScript = win32Path.resolve(win32Path.dirname(shim), cliMatch[1]);
    const installRoot = `${win32Path.dirname(executable).toLowerCase()}\\`;
    if (!cliScript.toLowerCase().startsWith(installRoot) || !probe.fileExists(cliScript)) continue;

    const environment = { ELECTRON_RUN_AS_NODE: '1' };
    const builtInCopilot = win32Path.resolve(win32Path.dirname(cliScript), '..', 'extensions', 'copilot');
    const installedExtensions = probe.commandOutput(executable, [cliScript, '--list-extensions'], environment)?.toLowerCase() ?? '';
    if (!probe.fileExists(builtInCopilot) && !installedExtensions.includes('github.copilot')) continue;
    return { executable, launchArgsPrefix: [cliScript], launchEnvironment: environment };
  }
  return null;
}

function vscodeHasCopilot(command: string, probe: SurfaceProbe): boolean {
  const extensions = probe.commandOutput(command, ['--list-extensions'])?.toLowerCase() ?? '';
  if (extensions.includes('github.copilot')) return true;

  const resolvedCommand = probe.realPath?.(command) ?? command;
  const commandDirectory = dirname(resolvedCommand);
  return [
    resolve(commandDirectory, '..', 'extensions', 'copilot'),
    resolve(commandDirectory, '..', 'resources', 'app', 'extensions', 'copilot'),
  ].some((candidate) => probe.fileExists(candidate));
}

function registeredUrlSchemeTarget(
  scheme: 'claude' | 'ghapp',
  platform: NodeJS.Platform,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  if (platform === 'win32') {
    const registered = probe.commandOutput('reg.exe', ['query', `HKCR\\${scheme}\\shell\\open\\command`, '/ve']);
    return registered ? { executable: `${scheme}://`, launchArgsPrefix: [], launchEnvironment: {} } : null;
  }
  if (platform === 'linux') {
    const desktopHandler = probe.commandOutput('xdg-mime', ['query', 'default', `x-scheme-handler/${scheme}`])?.trim();
    return desktopHandler ? { executable: `${scheme}://`, launchArgsPrefix: [], launchEnvironment: {} } : null;
  }
  return null;
}

function findSurfaceTarget(
  surface: AiSurfaceDefinition,
  platform: NodeJS.Platform,
  home: string,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  if (platform === 'win32' && surface.id === 'vscode-copilot') {
    return windowsVsCodeTarget(surface, home, probe);
  }

  for (const command of surface.commands) {
    const found = probe.commandPath(command);
    if (found) {
      if (surface.id === 'vscode-copilot' && !vscodeHasCopilot(found, probe)) continue;
      return { executable: found, launchArgsPrefix: [], launchEnvironment: {} };
    }
  }
  const executable = candidateApplicationPaths(surface, platform, home).find((path) => probe.fileExists(path));
  if (executable) return { executable, launchArgsPrefix: [], launchEnvironment: {} };
  if (surface.id === 'claude-desktop') return registeredUrlSchemeTarget('claude', platform, probe);
  if (surface.id === 'copilot-desktop') return registeredUrlSchemeTarget('ghapp', platform, probe);
  return null;
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
    target: findSurfaceTarget(surface, platform, home, probe),
  }));
  const availableIds = new Set(installed.filter((item) => item.target).map((item) => item.surface.id));
  const preferredSurface = preferences.lastAiSurface && availableIds.has(preferences.lastAiSurface)
    ? preferences.lastAiSurface
    : null;
  const recommendedSurface = preferredSurface
    ?? installed.find((item) => item.target)?.surface.id
    ?? 'vscode-copilot';

  return {
    contractVersion: 'eai.ai-surfaces/v1',
    platform,
    projectDirectory: platform === 'win32'
      ? win32Path.resolve(options.projectDirectory ?? process.cwd())
      : resolve(options.projectDirectory ?? process.cwd()),
    preferredSurface,
    recommendedSurface,
    surfaces: installed.map(({ surface, target }) => ({
      ...surface,
      installed: Boolean(target),
      executable: target?.executable ?? null,
      launchArgsPrefix: target?.launchArgsPrefix ?? [],
      launchEnvironment: target?.launchEnvironment ?? {},
      recommended: surface.id === recommendedSurface,
      previouslyUsed: surface.id === preferredSurface,
      status: target ? 'ready' : 'not-installed',
      nextAction: target
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
      return { ...common, mode: 'process', command: surface.executable, args: [...surface.launchArgsPrefix, 'chat', '-m', 'agent', EAI_FIRST_PROMPT], environment: surface.launchEnvironment, preparedPrompt: true, userMessage: 'VS Code will open this project and start an EAI Copilot chat.' };
    case 'copilot-cli':
      return { ...common, mode: 'terminal', command: surface.executable, args: ['-C', project, '-i', EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive EAI Copilot session.' };
    case 'copilot-desktop':
      return { ...common, mode: 'url', command: 'ghapp://recent', args: [], preparedPrompt: false, userMessage: 'GitHub Copilot will open. Choose this project folder once, then ask it to use the repository EAI skill.' };
    case 'claude-desktop':
      return {
        ...common,
        mode: 'url',
        command: `claude://code/new?q=${encodeURIComponent(EAI_FIRST_PROMPT)}&folder=${encodeURIComponent(project)}`,
        args: [],
        preparedPrompt: true,
        userMessage: 'Claude Desktop will open a Code session for this project with the EAI starting prompt ready to review.',
      };
    case 'claude-cli':
      return { ...common, mode: 'terminal', command: surface.executable, args: [EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive Claude EAI session.' };
    case 'codex-desktop': {
      const codexCli = inventory.surfaces.find((candidate) => candidate.id === 'codex-cli');
      return codexCli?.installed && codexCli.executable
        ? { ...common, mode: 'process', command: codexCli.executable, args: ['app', project], preparedPrompt: false, userMessage: 'ChatGPT Desktop will open this project in Codex. Ask it to use the repository EAI skill.' }
        : { ...common, mode: 'application', command: surface.executable, args: [], preparedPrompt: false, userMessage: 'ChatGPT Desktop will open. Choose this project folder, select Codex, then ask it to use the repository EAI skill.' };
    }
    case 'codex-cli':
      return { ...common, mode: 'terminal', command: surface.executable, args: [EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive Codex EAI session.' };
    case 'grok-cli':
      return { ...common, mode: 'terminal', command: surface.executable, args: ['--cwd', project, '--prompt', EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive Grok EAI session.' };
  }
}

function shellQuote(value: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function spawnDetached(
  command: string,
  args: readonly string[],
  cwd?: string,
  environment?: Readonly<Record<string, string>>,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ...environment },
    });
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

async function openTrustedSurfaceUrl(url: string, platform: NodeJS.Platform): Promise<void> {
  if (!/^(?:claude:\/\/code\/new(?:[?#]|$)|ghapp:\/\/recent(?:[?#]|$))/.test(url)) {
    throw new Error('EAI refused to open an unsupported AI workspace location.');
  }
  if (platform === 'darwin') await spawnDetached('open', [url]);
  else if (platform === 'win32') await spawnDetached('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  else await spawnDetached('xdg-open', [url]);
}

export async function executeAiLaunchPlan(plan: LaunchPlan, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (plan.mode === 'url') {
    await openTrustedSurfaceUrl(plan.command, platform);
    return;
  }
  if (plan.mode === 'application') {
    if (platform === 'darwin') await spawnDetached('open', ['-a', plan.command, ...plan.args]);
    else await spawnDetached(plan.command, plan.args, plan.cwd);
    return;
  }
  if (plan.mode === 'process') {
    await spawnDetached(plan.command, plan.args, plan.cwd, plan.environment);
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
