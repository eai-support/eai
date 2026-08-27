import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, win32 as win32Path } from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';

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
type DesktopUrlScheme = 'claude' | 'codex' | 'ghapp';

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
  deepLinkScheme: DesktopUrlScheme | null;
  supportsAppBridge: boolean;
  recommended: boolean;
  previouslyUsed: boolean;
  status: 'ready' | 'not-installed';
  nextAction: string;
}

export interface AiSurfaceInventory {
  contractVersion: 'eai.ai-surfaces/v1';
  launchContractVersion: 'eai.ai-launch/v1';
  platform: NodeJS.Platform;
  projectDirectory: string;
  projectGitHubRepository: string | null;
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
  urlApplication?: string;
  environment?: Record<string, string>;
  cwd: string;
  preparedPrompt: boolean;
  promptToCopy?: string;
  postLaunchAction?: 'macos-copilot-insert-prompt';
  postLaunchApplication?: string;
  userMessage: string;
}

export type PromptInsertionStatus =
  | 'not-attempted'
  | 'inserted'
  | 'permission-required'
  | 'app-not-ready'
  | 'focus-lost'
  | 'draft-not-empty'
  | 'unsafe-target'
  | 'automation-failed';

export interface LaunchExecutionResult {
  promptInsertionStatus: PromptInsertionStatus;
}

interface AiPreferences {
  version: 1;
  lastAiSurface?: AiSurfaceId;
}

export const EAI_FIRST_PROMPT = '✨ Get started with EAI ✨';

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
    launchSupport: 'project-only',
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
    name: 'Codex Desktop',
    provider: 'OpenAI',
    kind: 'desktop',
    installUrl: 'https://learn.chatgpt.com/docs/app',
    launchSupport: 'project-and-prompt',
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
  const result = spawnSync(resolver, [command], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  });
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
  deepLinkScheme: DesktopUrlScheme | null;
  supportsAppBridge?: boolean;
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
    if (!vscodeSupportsPromptedChat(executable, [cliScript], environment, probe)) continue;
    return { executable, launchArgsPrefix: [cliScript], launchEnvironment: environment, deepLinkScheme: null };
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

function vscodeSupportsPromptedChat(
  command: string,
  argsPrefix: readonly string[],
  environment: Readonly<Record<string, string>>,
  probe: SurfaceProbe,
): boolean {
  const help = probe.commandOutput(command, [...argsPrefix, 'chat', '--help'], environment) ?? '';
  return /(?:^|\s)--mode(?:\s|=|$)/m.test(help);
}

function isOfficialWindowsGitHubCopilotShim(command: string, probe: SurfaceProbe): boolean {
  const content = probe.fileContent?.(command)?.replaceAll('/', '\\') ?? '';
  if (!/(?:%dp0%|%~dp0)\\?node_modules\\@github\\copilot\\npm-loader\.js/i.test(content)) return false;

  const loader = win32Path.join(
    win32Path.dirname(command),
    'node_modules',
    '@github',
    'copilot',
    'npm-loader.js',
  );
  return probe.fileExists(loader);
}

interface MacApplicationMetadata {
  bundleId: string;
  urlSchemes: string[];
  teamId: string | null;
}

function macApplicationMetadata(application: string, probe: SurfaceProbe): MacApplicationMetadata | null {
  const signatureVerified = probe.commandOutput('/usr/bin/codesign', [
    '--verify', '--deep', '--strict', '--verbose=2', application,
  ]);
  if (signatureVerified === null) return null;

  const infoPlist = join(application, 'Contents', 'Info.plist');
  const bundleId = probe.commandOutput('/usr/bin/plutil', [
    '-extract', 'CFBundleIdentifier', 'raw', '-o', '-', infoPlist,
  ])?.trim();
  if (!bundleId) return null;
  const signature = probe.commandOutput('/usr/bin/codesign', ['-dv', '--verbose=4', application]) ?? '';
  const teamId = signature.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? null;
  const urlTypes = probe.commandOutput('/usr/bin/plutil', [
    '-extract', 'CFBundleURLTypes', 'json', '-o', '-', infoPlist,
  ]);
  if (!urlTypes) return { bundleId, urlSchemes: [], teamId };
  try {
    const parsed = JSON.parse(urlTypes) as Array<{ CFBundleURLSchemes?: unknown }>;
    const urlSchemes = parsed.flatMap((item) => Array.isArray(item.CFBundleURLSchemes)
      ? item.CFBundleURLSchemes.filter((scheme): scheme is string => typeof scheme === 'string')
      : []);
    return { bundleId, urlSchemes, teamId };
  } catch {
    return { bundleId, urlSchemes: [], teamId };
  }
}

function macDesktopTarget(
  surface: AiSurfaceDefinition,
  application: string,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  const base = { executable: application, launchArgsPrefix: [], launchEnvironment: {} };
  if (surface.id !== 'copilot-desktop' && surface.id !== 'claude-desktop' && surface.id !== 'codex-desktop') {
    return { ...base, deepLinkScheme: null };
  }

  const metadata = macApplicationMetadata(application, probe);
  const expected = surface.id === 'copilot-desktop'
    ? { bundleId: 'com.github.githubapp', scheme: 'ghapp' as const, teamId: 'VEKTX9H2N7' }
    : surface.id === 'claude-desktop'
      ? { bundleId: 'com.anthropic.claudefordesktop', scheme: 'claude' as const, teamId: 'Q6L2SF6YDW' }
      : { bundleId: 'com.openai.codex', scheme: 'codex' as const, teamId: '2DC432GLL2' };
  if (metadata?.bundleId !== expected.bundleId || metadata.teamId !== expected.teamId) return null;
  return {
    ...base,
    deepLinkScheme: metadata?.urlSchemes.includes(expected.scheme) ? expected.scheme : null,
  };
}

function registeredUrlSchemeTarget(
  scheme: DesktopUrlScheme,
  platform: NodeJS.Platform,
  surface: AiSurfaceDefinition,
  home: string,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  if (platform === 'win32') {
    const registered = probe.commandOutput('reg.exe', ['query', `HKCR\\${scheme}\\shell\\open\\command`, '/ve']);
    if (!registered) return null;
    const executable = registered.match(/"([^"\r\n]+\.exe)"/i)?.[1]
      ?? registered.match(/REG_\w+\s+([A-Za-z]:\\[^\r\n]+?\.exe)(?:\s|$)/i)?.[1];
    const expectedNames: Record<DesktopUrlScheme, readonly string[]> = {
      claude: ['claude.exe'],
      codex: ['codex.exe', 'chatgpt.exe'],
      ghapp: ['github copilot.exe'],
    };
    const normalizedExecutable = executable
      ? win32Path.normalize(executable).replace(/^\\\\\?\\/, '').toLowerCase()
      : null;
    const trustedPaths = candidateApplicationPaths(surface, platform, home)
      .map((candidate) => win32Path.normalize(candidate).replace(/^\\\\\?\\/, '').toLowerCase());
    if (!executable || !expectedNames[scheme].includes(win32Path.basename(executable).toLowerCase())
      || !probe.fileExists(executable) || !normalizedExecutable || !trustedPaths.includes(normalizedExecutable)) return null;
    return { executable, launchArgsPrefix: [], launchEnvironment: {}, deepLinkScheme: scheme };
  }
  if (platform === 'linux') {
    const desktopHandler = probe.commandOutput('xdg-mime', ['query', 'default', `x-scheme-handler/${scheme}`])?.trim();
    const expectedHandlerNames: Record<DesktopUrlScheme, readonly string[]> = {
      claude: ['claude.desktop', 'com.anthropic.claude.desktop'],
      codex: ['codex.desktop', 'com.openai.codex.desktop', 'chatgpt.desktop'],
      ghapp: ['github-copilot.desktop', 'github-copilot-client.desktop'],
    };
    if (!desktopHandler) return null;
    const handlerName = basename(desktopHandler).toLowerCase();
    if (!expectedHandlerNames[scheme].includes(handlerName)) return null;
    // A per-user desktop entry shadows a system entry with the same name. Do
    // not hand a project path and prompt to a URL handler whose publisher
    // identity can be replaced without administrator privileges.
    const userDesktopPaths = [
      join(home, '.local', 'share', 'applications', handlerName),
      join(home, '.local', 'share', 'flatpak', 'exports', 'share', 'applications', handlerName),
    ];
    if (userDesktopPaths.some((candidate) => probe.fileExists(candidate))) return null;
    const systemDesktopPaths = [
      join('/usr/local/share/applications', handlerName),
      join('/usr/share/applications', handlerName),
      join('/var/lib/flatpak/exports/share/applications', handlerName),
      join('/var/lib/snapd/desktop/applications', handlerName),
    ];
    const desktopEntry = systemDesktopPaths
      .filter((candidate) => probe.fileExists(candidate))
      .map((candidate) => probe.fileContent?.(candidate) ?? '')
      .find((content) => {
        const exec = content.match(/^Exec=(.+)$/mi)?.[1] ?? '';
        const mimeTypes = (content.match(/^MimeType=(.+)$/mi)?.[1] ?? '').split(';');
        const expectedExec = scheme === 'claude'
          ? /(?:^|[\s/.])(?:anthropic|claude)(?:[\s/.]|$)/i
          : scheme === 'codex'
            ? /(?:^|[\s/.])(?:openai|codex|chatgpt)(?:[\s/.]|$)/i
            : /(?:github[^\r\n]*copilot|(?:^|[\s/.])copilot(?:[\s/.]|$))/i;
        return content.includes('[Desktop Entry]')
          && mimeTypes.includes(`x-scheme-handler/${scheme}`)
          && expectedExec.test(exec);
      });
    if (!desktopEntry) return null;
    return { executable: `${scheme}://`, launchArgsPrefix: [], launchEnvironment: {}, deepLinkScheme: scheme };
  }
  return null;
}

function discoveredMacApplications(surface: AiSurfaceDefinition, probe: SurfaceProbe): string[] {
  const bundleId = surface.id === 'copilot-desktop'
    ? 'com.github.githubapp'
    : surface.id === 'claude-desktop'
      ? 'com.anthropic.claudefordesktop'
      : surface.id === 'codex-desktop' ? 'com.openai.codex' : null;
  if (!bundleId) return [];
  const output = probe.commandOutput('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${bundleId}'`]) ?? '';
  return output.split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.endsWith('.app') && probe.fileExists(candidate));
}

function applicationTargetFromPaths(
  surface: AiSurfaceDefinition,
  platform: NodeJS.Platform,
  paths: readonly string[],
  probe: SurfaceProbe,
): SurfaceTarget | null {
  for (const executable of paths.filter((path) => probe.fileExists(path))) {
    if (surface.id === 'vscode-copilot'
      && (!vscodeHasCopilot(executable, probe) || !vscodeSupportsPromptedChat(executable, [], {}, probe))) continue;
    if (platform === 'darwin') {
      const target = macDesktopTarget(surface, executable, probe);
      if (target) return target;
      continue;
    }
    return { executable, launchArgsPrefix: [], launchEnvironment: {}, deepLinkScheme: null };
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
      if (surface.id === 'vscode-copilot'
        && (!vscodeHasCopilot(found, probe) || !vscodeSupportsPromptedChat(found, [], {}, probe))) continue;
      if (surface.id === 'copilot-cli') {
        // Windows npm shims cannot be probed as native executables. Verify the
        // shim is wired to GitHub's package before allowing it to receive the
        // starter prompt. The optional desktop bridge remains disabled because
        // its version-specific capability cannot be safely probed here.
        if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(found)) {
          if (!isOfficialWindowsGitHubCopilotShim(found, probe)) continue;
          return {
            executable: found,
            launchArgsPrefix: [],
            launchEnvironment: {},
            deepLinkScheme: null,
            supportsAppBridge: false,
          };
        }
        const help = probe.commandOutput(found, ['--help']) ?? '';
        if (!/GitHub Copilot CLI/i.test(help)) continue;
        return {
          executable: found,
          launchArgsPrefix: [],
          launchEnvironment: {},
          deepLinkScheme: null,
          supportsAppBridge: /(?:^|\r?\n)\s*app\s{2,}/m.test(help),
        };
      }
      return { executable: found, launchArgsPrefix: [], launchEnvironment: {}, deepLinkScheme: null };
    }
  }
  if (surface.id === 'claude-desktop') {
    const handler = registeredUrlSchemeTarget('claude', platform, surface, home, probe);
    if (handler) return handler;
  }
  if (surface.id === 'copilot-desktop') {
    const handler = registeredUrlSchemeTarget('ghapp', platform, surface, home, probe);
    if (handler) return handler;
  }
  if (surface.id === 'codex-desktop') {
    const handler = registeredUrlSchemeTarget('codex', platform, surface, home, probe);
    if (handler) return handler;
  }
  const applicationPaths = candidateApplicationPaths(surface, platform, home);
  const applicationTarget = applicationTargetFromPaths(surface, platform, applicationPaths, probe);
  if (applicationTarget) return applicationTarget;
  if (platform === 'darwin') {
    const discoveredTarget = applicationTargetFromPaths(
      surface,
      platform,
      discoveredMacApplications(surface, probe).filter((candidate) => !applicationPaths.includes(candidate)),
      probe,
    );
    if (discoveredTarget) return discoveredTarget;
  }
  return null;
}

function githubRepositoryFromRemote(remote: string): string | null {
  const value = remote.trim();
  const hasUnsafeCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f || character === '?' || character === '#';
  });
  if (!value || hasUnsafeCharacter) return null;

  const match = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i)
    ?? value.match(/^git@github\.com:([^/]+)\/([^/]+)$/i)
    ?? value.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/i);
  if (!match) return null;

  const owner = match[1];
  const repository = match[2].endsWith('.git') ? match[2].slice(0, -4) : match[2];
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) return null;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repository) || repository === '.' || repository === '..') return null;
  return `${owner}/${repository}`;
}

function comparableProjectPath(path: string, platform: NodeJS.Platform, probe: SurfaceProbe): string {
  const realPath = probe.realPath?.(path) ?? path;
  return platform === 'win32'
    ? win32Path.resolve(realPath).replace(/[\\/]+$/, '').toLowerCase()
    : resolve(realPath).replace(/\/+$/, '');
}

function detectProjectGitHubRepository(
  projectDirectory: string,
  platform: NodeJS.Platform,
  probe: SurfaceProbe,
): string | null {
  const root = probe.commandOutput('git', ['-C', projectDirectory, 'rev-parse', '--show-toplevel'])?.trim();
  if (!root || /[\r\n]/.test(root)) return null;
  if (comparableProjectPath(root, platform, probe) !== comparableProjectPath(projectDirectory, platform, probe)) return null;
  const remote = probe.commandOutput('git', ['-C', projectDirectory, 'remote', 'get-url', 'origin'])?.trim();
  return remote && !/[\r\n]/.test(remote) ? githubRepositoryFromRemote(remote) : null;
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
  const projectDirectory = platform === 'win32'
    ? win32Path.resolve(options.projectDirectory ?? process.cwd())
    : resolve(options.projectDirectory ?? process.cwd());
  const projectGitHubRepository = detectProjectGitHubRepository(projectDirectory, platform, probe);
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
  const copilotCliTarget = installed.find((item) => item.surface.id === 'copilot-cli')?.target ?? null;
  const copilotAppBridgeSupported = copilotCliTarget?.supportsAppBridge === true;

  return {
    contractVersion: 'eai.ai-surfaces/v1',
    launchContractVersion: 'eai.ai-launch/v1',
    platform,
    projectDirectory,
    projectGitHubRepository,
    preferredSurface,
    recommendedSurface,
    surfaces: installed.map(({ surface, target }) => ({
      ...surface,
      launchSupport: !target
        ? surface.launchSupport
        : surface.id === 'copilot-desktop'
          ? copilotAppBridgeSupported
            ? platform === 'darwin' ? 'project-and-prompt' : 'project-only'
            : target.deepLinkScheme === 'ghapp' && projectGitHubRepository
              ? 'project-and-prompt'
              : target.executable !== 'ghapp://'
              ? 'project-only'
              : 'manual-project'
          : (surface.id === 'claude-desktop' || surface.id === 'codex-desktop')
              && target.deepLinkScheme === null
            ? 'manual-project'
            : surface.launchSupport,
      installed: Boolean(target),
      executable: target?.executable ?? null,
      launchArgsPrefix: target?.launchArgsPrefix ?? [],
      launchEnvironment: target?.launchEnvironment ?? {},
      deepLinkScheme: target?.deepLinkScheme ?? null,
      supportsAppBridge: surface.id === 'copilot-cli' && copilotAppBridgeSupported,
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

function desktopLaunchUrl(base: string, parameters: Readonly<Record<string, string>>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url.toString();
}

function verifiedMacUrlApplication(inventory: AiSurfaceInventory, surface: DetectedAiSurface): string | undefined {
  const executable = surface.executable;
  return inventory.platform === 'darwin' && executable && isAbsolute(executable) && executable.endsWith('.app')
    ? executable
    : undefined;
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
      return { ...common, mode: 'process', command: surface.executable, args: [...surface.launchArgsPrefix, 'chat', '--mode', 'agent', EAI_FIRST_PROMPT], environment: surface.launchEnvironment, preparedPrompt: true, userMessage: 'VS Code will open this project and start an EAI Copilot chat.' };
    case 'copilot-cli':
      return { ...common, mode: 'terminal', command: surface.executable, args: ['-C', project, '-i', EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive EAI Copilot session.' };
    case 'copilot-desktop': {
      const copilotCli = inventory.surfaces.find((candidate) => candidate.id === 'copilot-cli');
      const copyPromptMessage = 'GitHub Copilot will open this exact project. This app connection cannot pre-fill the first message. Use EAI\'s Copy first message action, or copy the labelled First message in the terminal; paste it into Copilot, then press Send.';
      if (copilotCli?.installed && copilotCli.executable && copilotCli.supportsAppBridge) {
        return {
          ...common,
          mode: 'process',
          command: copilotCli.executable,
          args: [...copilotCli.launchArgsPrefix, 'app'],
          environment: copilotCli.launchEnvironment,
          preparedPrompt: false,
          promptToCopy: EAI_FIRST_PROMPT,
          ...(inventory.platform === 'darwin'
            ? {
                postLaunchAction: 'macos-copilot-insert-prompt' as const,
                postLaunchApplication: verifiedMacUrlApplication(inventory, surface),
              }
            : {}),
          userMessage: inventory.platform === 'darwin'
            ? 'GitHub Copilot will ask to confirm opening this local session. EAI will confirm the exact project and put the first message into Copilot\'s empty message box without pressing Send.'
            : copyPromptMessage,
        };
      }
      if (surface.deepLinkScheme === 'ghapp' && inventory.projectGitHubRepository) {
        return {
          ...common,
          mode: 'url',
          command: desktopLaunchUrl('ghapp://session/new', {
            repo: inventory.projectGitHubRepository,
            mode: 'interactive',
            prompt: EAI_FIRST_PROMPT,
          }),
          args: [],
          urlApplication: verifiedMacUrlApplication(inventory, surface),
          preparedPrompt: true,
          userMessage: 'GitHub Copilot will ask you to confirm a new Interactive session for this GitHub repository, with the first EAI message ready.',
        };
      }
      return surface.executable === 'ghapp://'
        ? {
            ...common,
            mode: 'url',
            command: 'ghapp://',
            args: [],
            preparedPrompt: false,
            promptToCopy: EAI_FIRST_PROMPT,
            userMessage: 'GitHub Copilot will open. Add this project and start a session. Then use EAI\'s Copy first message action, or copy the labelled First message in the terminal; paste it into Copilot, and press Send.',
          }
        : {
            ...common,
            mode: 'application',
            command: surface.executable,
            args: [project],
            preparedPrompt: false,
            promptToCopy: EAI_FIRST_PROMPT,
            userMessage: copyPromptMessage,
          };
    }
    case 'claude-desktop':
      return surface.deepLinkScheme === 'claude'
        ? {
            ...common,
            mode: 'url',
            command: desktopLaunchUrl('claude://code/new', { q: EAI_FIRST_PROMPT, folder: project }),
            args: [],
            urlApplication: verifiedMacUrlApplication(inventory, surface),
            preparedPrompt: true,
            userMessage: 'Claude Desktop will open a Code session for this project with the EAI starting prompt ready to review. Confirm the folder if asked, then press Send when ready.',
          }
        : {
            ...common,
            mode: 'application',
            command: surface.executable,
            args: [],
            preparedPrompt: false,
            promptToCopy: EAI_FIRST_PROMPT,
            userMessage: 'Claude Desktop will open. Choose this project folder and start a Code session; this installed version does not expose the secure project link.',
          };
    case 'claude-cli':
      return { ...common, mode: 'terminal', command: surface.executable, args: [EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive Claude EAI session.' };
    case 'codex-desktop':
      return surface.deepLinkScheme === 'codex'
        ? {
            ...common,
            mode: 'url',
            command: desktopLaunchUrl('codex://new', { prompt: EAI_FIRST_PROMPT, path: project }),
            args: [],
            urlApplication: verifiedMacUrlApplication(inventory, surface),
            preparedPrompt: true,
            userMessage: 'Codex Desktop will open a new chat for this project with the EAI starting prompt ready to review. Press Send when ready.',
          }
        : {
            ...common,
            mode: 'application',
            command: surface.executable,
            args: [],
            preparedPrompt: false,
            promptToCopy: EAI_FIRST_PROMPT,
            userMessage: 'Codex Desktop will open. Choose this project folder and start a new chat; this installed version does not expose the secure project link.',
          };
    case 'codex-cli':
      return { ...common, mode: 'terminal', command: surface.executable, args: [EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive Codex EAI session.' };
    case 'grok-cli':
      return { ...common, mode: 'terminal', command: surface.executable, args: ['--cwd', project, '-p', EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open a Grok EAI session for this project.' };
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

const MACOS_COPILOT_APP_BRIDGE_TIMEOUT_MS = 20_000;
const MACOS_COPILOT_APP_BRIDGE_TERMINATION_GRACE_MS = 2_000;
const MACOS_COPILOT_APP_BRIDGE_KILL_GRACE_MS = 1_000;

function runMacCopilotAppBridge(
  command: string,
  args: readonly string[],
  cwd: string,
  environment?: Readonly<Record<string, string>>,
): Promise<boolean> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], {
      cwd,
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ...environment },
    });
    let settled = false;
    let terminationTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (terminationTimer) clearTimeout(terminationTimer);
      if (killTimer) clearTimeout(killTimer);
      resolvePromise(result);
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill('SIGTERM');
      terminationTimer = setTimeout(() => {
        if (settled) return;
        child.kill('SIGKILL');
        killTimer = setTimeout(() => finish(false), MACOS_COPILOT_APP_BRIDGE_KILL_GRACE_MS);
      }, MACOS_COPILOT_APP_BRIDGE_TERMINATION_GRACE_MS);
    }, MACOS_COPILOT_APP_BRIDGE_TIMEOUT_MS);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (terminationTimer) clearTimeout(terminationTimer);
      if (killTimer) clearTimeout(killTimer);
      rejectPromise(error);
    });
    child.once('exit', (code) => finish(code === 0));
  });
}

const MACOS_COPILOT_PROMPT_TIMEOUT_MS = 90_000;

export const MACOS_COPILOT_PROMPT_SCRIPT = `use framework "Foundation"

on wallClockSeconds()
  set nowDate to current application's NSDate's |date|()
  return (nowDate's timeIntervalSince1970()) as real
end wallClockSeconds

on run argv
  set promptText to item 1 of argv
  set expectedApplicationPath to item 2 of argv
  set expectedProjectPath to item 3 of argv
  if expectedApplicationPath does not end with "/" then set expectedApplicationPath to expectedApplicationPath & "/"
  set expectedFolderButtonLabel to "Copy folder, " & expectedProjectPath
  set allowPressed to false
  set observedProcessId to missing value
  set observedWindowCount to missing value
  set observedWindowPosition to missing value
  set observedWindowSize to missing value
  set discoveryPollsRemaining to 20
  set discoveryScansRemaining to 12
  set transitionPollsRemaining to 0
  set mutationDeadline to (my wallClockSeconds()) + 70
  repeat
    if allowPressed is false then
      if discoveryPollsRemaining is 0 then return "APP_NOT_READY"
      set discoveryPollsRemaining to discoveryPollsRemaining - 1
    else
      if transitionPollsRemaining is 0 then return "UNSAFE_ALLOW_TRANSITION_TIMEOUT"
      set transitionPollsRemaining to transitionPollsRemaining - 1
    end if
    try
      tell application "System Events"
        set copilotProcesses to every application process whose bundle identifier is "com.github.githubapp"
        if (count of copilotProcesses) > 1 then return "AMBIGUOUS_PROCESS"
        if (count of copilotProcesses) is 0 and allowPressed is true then return "UNSAFE_PROCESS_MISSING"
        if (count of copilotProcesses) is 1 then
          set copilotProcess to first item of copilotProcesses
          set currentProcessId to unix id of copilotProcess
          if allowPressed is true and currentProcessId is not observedProcessId then return "UNSAFE_PROCESS_CHANGED"
          set runningApplicationPath to POSIX path of (application file of copilotProcess as alias)
          if runningApplicationPath does not end with "/" then set runningApplicationPath to runningApplicationPath & "/"
          if runningApplicationPath is not expectedApplicationPath then return "UNVERIFIED_APPLICATION"
          tell copilotProcess
            if frontmost is true then
              if allowPressed is true and (count of windows) is not observedWindowCount then return "UNSAFE_WINDOW_COUNT_CHANGED"
              if (count of windows) > 0 then
                if allowPressed is false then
                  if discoveryScansRemaining is 0 then return "APP_NOT_READY"
                  set discoveryScansRemaining to discoveryScansRemaining - 1
                  set folderButtons to {}
                  set allowButtons to {}
                  set denyButtons to {}
                  set allElements to entire contents of front window
                  repeat with targetElement in allElements
                    try
                      if (role of targetElement) is "AXButton" then
                        set elementName to ""
                        set elementDescription to ""
                        try
                          set elementName to name of targetElement as text
                        end try
                        try
                          set elementDescription to description of targetElement as text
                        end try
                        if elementName is expectedFolderButtonLabel or elementDescription is expectedFolderButtonLabel then set end of folderButtons to targetElement
                        if elementName is "Allow" or elementDescription is "Allow" then set end of allowButtons to targetElement
                        if elementName is "Deny" or elementDescription is "Deny" then set end of denyButtons to targetElement
                      end if
                    end try
                  end repeat
                  if (count of folderButtons) > 1 then return "UNSAFE_CONFIRMATION_FOLDER_COUNT"
                  if (count of allowButtons) > 1 or (count of denyButtons) > 1 then return "UNSAFE_CONFIRMATION_ACTION_COUNT"
                  if (count of folderButtons) is 1 and (count of allowButtons) is 1 and (count of denyButtons) is 1 then
                    set candidateFolderButton to first item of folderButtons
                    set candidateAllowButton to first item of allowButtons
                    set candidateDenyButton to first item of denyButtons
                    if (enabled of candidateFolderButton is not true) or (enabled of candidateAllowButton is not true) or (enabled of candidateDenyButton is not true) then return "UNSAFE_CONFIRMATION_ACTION_STATE"
                    set observedProcessId to currentProcessId
                    set observedWindowCount to count of windows
                    set observedWindowPosition to position of front window
                    set observedWindowSize to size of front window
                    if frontmost is not true then return "FOCUS_LOST"
                    if (unix id of copilotProcess) is not observedProcessId then return "UNSAFE_PROCESS_CHANGED"
                    if (count of windows) is not observedWindowCount then return "UNSAFE_WINDOW_COUNT_CHANGED"
                    if (position of front window) is not equal to observedWindowPosition then return "UNSAFE_WINDOW_POSITION_CHANGED"
                    if (size of front window) is not equal to observedWindowSize then return "UNSAFE_WINDOW_SIZE_CHANGED"
                    set allowButtonName to ""
                    set allowButtonDescription to ""
                    try
                      set allowButtonName to name of candidateAllowButton as text
                    end try
                    try
                      set allowButtonDescription to description of candidateAllowButton as text
                    end try
                    if (role of candidateAllowButton) is not "AXButton" or (enabled of candidateAllowButton) is not true then return "UNSAFE_ALLOW_TARGET_CHANGED"
                    if allowButtonName is not "Allow" and allowButtonDescription is not "Allow" then return "UNSAFE_ALLOW_TARGET_CHANGED"
                    if (my wallClockSeconds()) is greater than or equal to mutationDeadline then return "UNSAFE_MUTATION_DEADLINE_EXCEEDED"
                    try
                      perform action "AXPress" of candidateAllowButton
                    on error pressErrorMessage number pressErrorNumber
                      if pressErrorNumber is -1719 or pressErrorNumber is -1743 or pressErrorNumber is -25211 then return "PERMISSION_REQUIRED"
                      return "UNSAFE_ALLOW_PRESS_FAILED"
                    end try
                    set allowPressed to true
                    set transitionPollsRemaining to 8
                  end if
                else
                  if (position of front window) is not equal to observedWindowPosition then return "UNSAFE_WINDOW_POSITION_CHANGED"
                  if (size of front window) is not equal to observedWindowSize then return "UNSAFE_WINDOW_SIZE_CHANGED"
                  set confirmationMarkers to 0
                  set messageFields to {}
                  set allElements to entire contents of front window
                  repeat with targetElement in allElements
                    try
                      set targetRole to role of targetElement
                      if targetRole is "AXButton" then
                        set elementName to ""
                        set elementDescription to ""
                        try
                          set elementName to name of targetElement as text
                        end try
                        try
                          set elementDescription to description of targetElement as text
                        end try
                        if elementName is expectedFolderButtonLabel or elementDescription is expectedFolderButtonLabel or elementName is "Allow" or elementDescription is "Allow" or elementName is "Deny" or elementDescription is "Deny" then set confirmationMarkers to confirmationMarkers + 1
                      else if targetRole is "AXTextArea" and (description of targetElement) is "Message" then
                        set end of messageFields to targetElement
                      end if
                    end try
                  end repeat
                  if confirmationMarkers is 0 then
                    if (count of messageFields) > 1 then return "UNSAFE_MESSAGE_FIELD_COUNT"
                    if (count of messageFields) is 1 then
                      set messageField to first item of messageFields
                      if (enabled of messageField is true) and (focused of messageField is true) then
                        set messageFieldPosition to position of messageField
                        set messageFieldSize to size of messageField
                        set messageFieldValue to value of messageField
                        if messageFieldValue is promptText then return "INSERTED"
                        if messageFieldValue is not "" then return "DRAFT_NOT_EMPTY"

                        if frontmost is not true then return "FOCUS_LOST"
                        if (count of windows) is not observedWindowCount then return "UNSAFE_WINDOW_COUNT_CHANGED"
                        if (position of front window) is not equal to observedWindowPosition then return "UNSAFE_WINDOW_POSITION_CHANGED"
                        if (size of front window) is not equal to observedWindowSize then return "UNSAFE_WINDOW_SIZE_CHANGED"
                        set focusedElement to value of attribute "AXFocusedUIElement" of copilotProcess
                        if focusedElement is missing value then return "UNSAFE_FOCUSED_ELEMENT_MISSING"
                        if (role of focusedElement) is not "AXTextArea" or (description of focusedElement) is not "Message" then return "UNSAFE_FOCUSED_FIELD_ROLE"
                        if (enabled of focusedElement is not true) or (focused of focusedElement is not true) then return "UNSAFE_FOCUSED_FIELD_STATE"
                        if (position of focusedElement) is not equal to messageFieldPosition then return "UNSAFE_FOCUSED_FIELD_POSITION"
                        if (size of focusedElement) is not equal to messageFieldSize then return "UNSAFE_FOCUSED_FIELD_SIZE"
                        set focusedElementValue to value of focusedElement
                        if focusedElementValue is not equal to messageFieldValue then return "UNSAFE_FOCUSED_FIELD_VALUE"
                        if frontmost is not true then return "FOCUS_LOST"
                        if (unix id of copilotProcess) is not observedProcessId then return "UNSAFE_PROCESS_CHANGED"
                        if (count of windows) is not observedWindowCount then return "UNSAFE_WINDOW_COUNT_CHANGED"
                        if (position of front window) is not equal to observedWindowPosition then return "UNSAFE_WINDOW_POSITION_CHANGED"
                        if (size of front window) is not equal to observedWindowSize then return "UNSAFE_WINDOW_SIZE_CHANGED"
                        if (my wallClockSeconds()) is greater than or equal to mutationDeadline then return "UNSAFE_MUTATION_DEADLINE_EXCEEDED"
                        set value of focusedElement to promptText
                        delay 0.2
                        if (value of focusedElement) is promptText then return "INSERTED"
                        return "INSERTION_UNCONFIRMED"
                      end if
                    end if
                  end if
                end if
              end if
            else if allowPressed is true then
              return "FOCUS_LOST"
            end if
          end tell
        end if
      end tell
    on error errorMessage number errorNumber
      if errorNumber is -1719 or errorNumber is -1743 or errorNumber is -25211 then return "PERMISSION_REQUIRED"
      return "AUTOMATION_FAILED"
    end try
    if allowPressed is true then
      delay 0.1
    else
      delay 0.25
    end if
  end repeat
end run`;

function runMacCopilotPromptInsertion(
  prompt: string,
  expectedApplication: string,
  expectedProject: string,
): Promise<PromptInsertionStatus> {
  return new Promise((resolvePromise) => {
    execFile(
      '/usr/bin/osascript',
      ['-e', MACOS_COPILOT_PROMPT_SCRIPT, '--', prompt, expectedApplication, expectedProject],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: MACOS_COPILOT_PROMPT_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
      },
      (error, stdout, stderr) => {
        const result = `${stdout ?? ''}`.trim();
        if (!error && result === 'INSERTED') return resolvePromise('inserted');
        if (result === 'PERMISSION_REQUIRED'
          || /not authorized|not allowed|assistive access|-1719|-1743|-25211/i.test(`${stderr ?? ''}`)) {
          return resolvePromise('permission-required');
        }
        if (result === 'DRAFT_NOT_EMPTY') return resolvePromise('draft-not-empty');
        if (result === 'FOCUS_LOST') return resolvePromise('focus-lost');
        if (result === 'APP_NOT_READY') return resolvePromise('app-not-ready');
        if (result === 'AMBIGUOUS_PROCESS'
          || result === 'UNVERIFIED_APPLICATION'
          || /^UNSAFE_[A-Z_]+$/.test(result)
          || result === 'AMBIGUOUS_MESSAGE_FIELD'
          || result === 'INSERTION_UNCONFIRMED') return resolvePromise('unsafe-target');
        return resolvePromise('automation-failed');
      },
    );
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

function hasExactQuery(url: URL, keys: readonly string[]): boolean {
  const actualKeys = [...url.searchParams.keys()];
  return actualKeys.length === keys.length
    && keys.every((key) => url.searchParams.getAll(key).length === 1 && Boolean(url.searchParams.get(key)));
}

function isTrustedSurfaceUrl(value: string, plan: LaunchPlan): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port || url.hash) return false;
    if (url.protocol === 'claude:') {
      return plan.surfaceId === 'claude-desktop'
        && url.hostname === 'code'
        && url.pathname === '/new'
        && hasExactQuery(url, ['q', 'folder'])
        && url.searchParams.get('q') === EAI_FIRST_PROMPT
        && url.searchParams.get('folder') === plan.projectDirectory;
    }
    if (url.protocol === 'codex:') {
      return plan.surfaceId === 'codex-desktop'
        && url.hostname === 'new'
        && url.pathname === ''
        && hasExactQuery(url, ['prompt', 'path'])
        && url.searchParams.get('prompt') === EAI_FIRST_PROMPT
        && url.searchParams.get('path') === plan.projectDirectory;
    }
    if (url.protocol === 'ghapp:') {
      if (plan.surfaceId !== 'copilot-desktop') return false;
      if (url.hostname === '' && url.pathname === '' && url.search === '') {
        return plan.promptToCopy === EAI_FIRST_PROMPT;
      }
      if (url.hostname !== 'session' || url.pathname !== '/new'
        || !hasExactQuery(url, ['repo', 'mode', 'prompt'])) return false;
      const repository = url.searchParams.get('repo') ?? '';
      return githubRepositoryFromRemote(`https://github.com/${repository}`) === repository
        && url.searchParams.get('mode') === 'interactive'
        && url.searchParams.get('prompt') === EAI_FIRST_PROMPT;
    }
    return false;
  } catch {
    return false;
  }
}

async function openTrustedSurfaceUrl(
  plan: LaunchPlan,
  platform: NodeJS.Platform,
): Promise<void> {
  const url = plan.command;
  const macApplication = plan.urlApplication;
  if (!isTrustedSurfaceUrl(url, plan)) {
    throw new Error('EAI refused to open an unsupported AI workspace location.');
  }
  if (platform === 'darwin') {
    if (macApplication && (!isAbsolute(macApplication) || !macApplication.endsWith('.app'))) {
      throw new Error('EAI refused to open an unverified AI workspace application.');
    }
    await spawnDetached('open', macApplication ? ['-a', macApplication, '-u', url] : ['-u', url]);
  }
  else if (platform === 'win32') await spawnDetached('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  else await spawnDetached('xdg-open', [url]);
}

export async function executeAiLaunchPlan(
  plan: LaunchPlan,
  platform: NodeJS.Platform = process.platform,
): Promise<LaunchExecutionResult> {
  if (plan.mode === 'url') {
    await openTrustedSurfaceUrl(plan, platform);
    return { promptInsertionStatus: 'not-attempted' };
  }
  if (plan.mode === 'application') {
    if (platform === 'darwin') await spawnDetached('open', ['-a', plan.command, ...plan.args]);
    else await spawnDetached(plan.command, plan.args, plan.cwd);
    return { promptInsertionStatus: 'not-attempted' };
  }
  if (plan.mode === 'process') {
    const isExactMacCopilotAppBridge = platform === 'darwin'
      && plan.postLaunchAction === 'macos-copilot-insert-prompt'
      && plan.surfaceId === 'copilot-desktop'
      && isAbsolute(plan.command)
      && plan.args.length === 1
      && plan.args[0] === 'app'
      && plan.cwd === plan.projectDirectory
      && isAbsolute(plan.projectDirectory)
      && plan.promptToCopy === EAI_FIRST_PROMPT
      && plan.postLaunchApplication
      && isAbsolute(plan.postLaunchApplication)
      && plan.postLaunchApplication.endsWith('.app');
    if (isExactMacCopilotAppBridge && plan.postLaunchApplication) {
      const bridgeCompleted = await runMacCopilotAppBridge(
        plan.command,
        plan.args,
        plan.cwd,
        plan.environment,
      );
      if (!bridgeCompleted) {
        throw new Error('GitHub Copilot did not finish opening this project. No prompt insertion was attempted.');
      }
      await spawnDetached('open', ['-a', plan.postLaunchApplication]);
      const promptInsertionStatus = await runMacCopilotPromptInsertion(
        EAI_FIRST_PROMPT,
        plan.postLaunchApplication,
        plan.projectDirectory,
      );
      return { promptInsertionStatus };
    }
    await spawnDetached(plan.command, plan.args, plan.cwd, plan.environment);
    return { promptInsertionStatus: 'not-attempted' };
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
  return { promptInsertionStatus: 'not-attempted' };
}

export function getAiSurface(inventory: AiSurfaceInventory, surfaceId: string): DetectedAiSurface {
  return surfaceOrThrow(inventory, surfaceId);
}
