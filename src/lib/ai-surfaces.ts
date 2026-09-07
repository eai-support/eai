import {
  constants as fsConstants,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  basename,
  delimiter,
  dirname,
  join,
  relative,
  resolve,
  win32 as win32Path,
} from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

export type AiSurfaceId =
  | 'vscode-copilot'
  | 'copilot-cli'
  | 'copilot-desktop'
  | 'antigravity-desktop'
  | 'antigravity-cli'
  | 'claude-desktop'
  | 'claude-cli'
  | 'codex-desktop'
  | 'codex-cli'
  | 'grok-bot'
  | 'grok-cli';

export type AiSurfaceKind = 'desktop' | 'cli' | 'editor';
export type LaunchSupport = 'project-and-prompt' | 'project-only' | 'manual-project' | 'launch-only';
export type AiSurfaceCapability = 'desktop-project-launch' | 'initial-prompt';
export type AiSurfaceContractVersion = 'v1' | 'v2';

export interface AiSurfaceDefinition {
  id: AiSurfaceId;
  name: string;
  provider: 'GitHub' | 'Google' | 'Anthropic' | 'OpenAI' | 'xAI';
  kind: AiSurfaceKind;
  installUrl: string;
  launchSupport: LaunchSupport;
  commands: readonly string[];
  macApplications?: readonly string[];
  windowsApplications?: readonly string[];
  windowsProgramFilesApplications?: readonly string[];
  windowsAppxPackageNames?: readonly string[];
  linuxApplications?: readonly string[];
  macExecutables?: readonly string[];
  windowsExecutables?: readonly string[];
  linuxExecutables?: readonly string[];
}

export interface DetectedAiSurface extends AiSurfaceDefinition {
  installed: boolean;
  executable: string | null;
  launchArgsPrefix: string[];
  launchEnvironment: Record<string, string>;
  capabilities: AiSurfaceCapability[];
  recommended: boolean;
  previouslyUsed: boolean;
  status: 'ready' | 'not-installed';
  nextAction: string;
  deepLinkScheme?: 'claude' | 'ghapp';
  verification?: LaunchArtifactVerification;
}

export interface AiSurfaceInventory {
  contractVersion: `eai.ai-surfaces/${AiSurfaceContractVersion}`;
  platform: NodeJS.Platform;
  projectDirectory: string;
  preferredSurface: AiSurfaceId | null;
  recommendedSurface: AiSurfaceId | null;
  surfaces: DetectedAiSurface[];
}

export type LegacyAiSurfaceId = Exclude<
  AiSurfaceId,
  'antigravity-desktop' | 'antigravity-cli' | 'grok-bot'
>;

export interface AiSurfaceInventoryV1 {
  contractVersion: 'eai.ai-surfaces/v1';
  platform: NodeJS.Platform;
  projectDirectory: string;
  preferredSurface: LegacyAiSurfaceId | null;
  recommendedSurface: LegacyAiSurfaceId | null;
  surfaces: Array<{
    id: LegacyAiSurfaceId;
    name: string;
    provider: 'GitHub' | 'Anthropic' | 'OpenAI' | 'xAI';
    kind: Exclude<AiSurfaceKind, never>;
    installUrl: string;
    launchSupport: Exclude<LaunchSupport, 'launch-only'>;
    commands: readonly string[];
    macApplications?: readonly string[];
    windowsApplications?: readonly string[];
    installed: boolean;
    executable: string | null;
    launchArgsPrefix: string[];
    launchEnvironment: Record<string, string>;
    recommended: boolean;
    previouslyUsed: boolean;
    status: 'ready' | 'not-installed';
    nextAction: string;
  }>;
}

export interface AiSurfaceInventoryV2 {
  contractVersion: 'eai.ai-surfaces/v2';
  platform: NodeJS.Platform;
  projectDirectory: string;
  preferredSurface: AiSurfaceId | null;
  recommendedSurface: AiSurfaceId | null;
  surfaces: Array<{
    id: AiSurfaceId;
    name: string;
    provider: AiSurfaceDefinition['provider'];
    kind: AiSurfaceKind;
    installUrl: string;
    launchSupport: LaunchSupport;
    capabilities: AiSurfaceCapability[];
    installed: boolean;
    recommended: boolean;
    previouslyUsed: boolean;
    status: 'ready' | 'not-installed';
    nextAction: string;
  }>;
}

export interface SurfaceProbe {
  commandPath(command: string): string | null;
  fileExists(path: string): boolean;
  fileContent?(path: string): string | null;
  realPath?(path: string): string | null;
  directoryEntries?(path: string): readonly string[];
  directoryTreeIdentity?(path: string): DirectoryTreeIdentity | null;
  fileStatus?(path: string): SurfaceFileStatus | null;
  fileHeader?(path: string, length: number): Uint8Array | null;
  fileSha256?(path: string): string | null;
  macApplicationIdentity?(
    path: string,
    expected?: ExpectedMacApplicationIdentity,
  ): MacApplicationIdentity | null;
  macExecutableIdentity?(
    path: string,
    expected?: ExpectedMacExecutableIdentity,
  ): MacExecutableIdentity | null;
  windowsExecutableIdentity?(path: string): WindowsExecutableIdentity | null;
  windowsVsCodeInstallationAcl?(path: string): boolean;
  windowsAppxIdentity?(packageName: string): WindowsAppxIdentity | null;
  windowsUrlHandlerExecutable?(scheme: 'claude' | 'ghapp'): string | null;
  linuxPackageIdentity?(path: string): LinuxPackageIdentity | null;
  linuxUrlSchemeDesktopId?(scheme: 'claude' | 'ghapp'): string | null;
}

export interface SurfaceFileStatus {
  isFile: boolean;
  executable: boolean;
  mode: number;
  size: number;
  isSymbolicLink?: boolean;
  uid?: number;
  gid?: number;
  device?: number;
  inode?: number;
  modifiedTimeMs?: number;
}

export interface DirectoryTreeIdentity {
  realPath: string;
  fileCount: number;
  totalBytes: number;
  sha256: string;
}

export interface WindowsExecutableIdentity {
  productName: string;
  companyName?: string;
  publisher: string;
  architecture: 'x64' | 'arm64';
}

export interface MacApplicationIdentity {
  bundleIdentifier: string;
  teamIdentifier: string;
  executablePath: string;
  architectures: readonly NodeJS.Architecture[];
  urlSchemes: readonly string[];
}

export interface MacExecutableIdentity {
  identifier: string;
  teamIdentifier: string;
  architectures: readonly NodeJS.Architecture[];
}

export interface WindowsAppxIdentity {
  packageName: string;
  publisher: string;
  publisherId: string;
  familyName: string;
  applicationIds: readonly string[];
  architecture: 'x64' | 'arm64';
  signatureKind: 'Developer' | 'Store';
  status: 'Ok';
}

export interface LinuxPackageIdentity {
  packageName: string;
  architecture: 'x64' | 'arm64';
  version: string;
  manager: 'dpkg' | 'rpm';
  ownedPath: string;
  origin: string;
  signatureVerified: boolean;
  signingKeyFingerprint?: string;
  catalogArtifactSha256?: string;
  executableSha256?: string;
}

export interface CommandOutputInvocation {
  command: string;
  args: string[];
  windowsVerbatimArguments?: true;
}

type WindowsCommandAction = '/c' | '/k';

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
  verification?: LaunchArtifactVerification;
}

interface LaunchFileBinding {
  realPath: string;
  size: number;
  sha256: string;
  device?: number;
  inode?: number;
  modifiedTimeMs?: number;
}

export type LaunchArtifactVerification =
  | (LaunchFileBinding & {
      kind: 'copilot-appimage' | 'grok-appimage' | 'portable-elf';
      architecture: NodeJS.Architecture;
    })
  | (LaunchFileBinding & {
      kind: 'mac-executable';
      architecture: NodeJS.Architecture;
      identifier: string;
      teamIdentifier: string;
    })
  | {
      kind: 'mac-application';
      realPath: string;
      executablePath: string;
      executableSize: number;
      executableSha256: string;
      executableDevice?: number;
      executableInode?: number;
      executableModifiedTimeMs?: number;
      commandRealPath?: string;
      commandSize?: number;
      commandSha256?: string;
      commandDevice?: number;
      commandInode?: number;
      commandModifiedTimeMs?: number;
      architecture: NodeJS.Architecture;
      bundleIdentifier: string;
      teamIdentifier: string;
      requiredScheme?: 'claude' | 'ghapp';
    }
  | (LaunchFileBinding & {
      kind: 'windows-executable';
      architecture: 'x64' | 'arm64';
      productName: string;
      companyName?: string;
      publisher: string;
    })
  | {
      kind: 'windows-appx';
      packageName: string;
      publisher: string;
      publisherId: string;
      familyName: string;
      applicationId: string;
      architecture: 'x64' | 'arm64';
      signatureKind: WindowsAppxIdentity['signatureKind'];
    }
  | (LaunchFileBinding & {
      kind: 'linux-package';
      architecture: 'x64' | 'arm64';
      packageName: string;
      version: string;
      manager: LinuxPackageIdentity['manager'];
      origin: string;
      catalogArtifactSha256: string;
    })
  | (LaunchFileBinding & {
      kind: 'vscode-catalog';
      platform: 'win32' | 'linux';
      architecture: 'x64' | 'arm64';
      version: string;
      commit: string;
      installationRoot: string;
      cliPath: string;
      catalogArtifactSha256: string;
      applicationTree: DirectoryTreeIdentity;
      auxiliaryTree?: DirectoryTreeIdentity;
      visualManifest?: LaunchFileBinding;
    });

export interface LinuxTerminalInvocation {
  command: string;
  args: string[];
}

export interface AiLaunchExecutionOptions {
  commandPath?: (command: string) => string | null;
  probe?: SurfaceProbe;
}

export interface AiLaunchDispatch {
  dispatched: true;
  confirmed: false;
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

const AI_SURFACE_DEFINITIONS: readonly AiSurfaceDefinition[] = [
  {
    id: 'vscode-copilot',
    name: 'GitHub Copilot in VS Code',
    provider: 'GitHub',
    kind: 'editor',
    installUrl: 'https://code.visualstudio.com/docs/copilot/setup',
    launchSupport: 'project-and-prompt',
    commands: ['code'],
    macApplications: ['/Applications/Visual Studio Code.app'],
    windowsProgramFilesApplications: ['Microsoft VS Code/Code.exe'],
  },
  {
    id: 'copilot-cli',
    name: 'GitHub Copilot CLI',
    provider: 'GitHub',
    kind: 'cli',
    installUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli',
    launchSupport: 'project-and-prompt',
    commands: ['copilot'],
    macExecutables: ['.local/bin/copilot'],
    windowsExecutables: [
      'AppData/Local/Microsoft/WinGet/Links/copilot.exe',
      'AppData/Roaming/npm/copilot.cmd',
    ],
    linuxExecutables: ['.local/bin/copilot'],
  },
  {
    id: 'copilot-desktop',
    name: 'GitHub Copilot app',
    provider: 'GitHub',
    kind: 'desktop',
    installUrl: 'https://docs.github.com/en/copilot/get-started/quickstart-copilot-app',
    launchSupport: 'manual-project',
    commands: [],
    macApplications: ['/Applications/GitHub Copilot.app'],
    windowsApplications: ['AppData/Local/Programs/GitHub Copilot/github.exe'],
    windowsProgramFilesApplications: ['GitHub Copilot/github.exe'],
    linuxApplications: ['/usr/bin/github'],
  },
  {
    id: 'antigravity-desktop',
    name: 'Google Antigravity 2.0',
    provider: 'Google',
    kind: 'desktop',
    installUrl: 'https://antigravity.google/download',
    launchSupport: 'manual-project',
    commands: [],
    macApplications: ['/Applications/Antigravity.app'],
    windowsApplications: ['AppData/Local/Programs/antigravity/Antigravity.exe'],
    linuxApplications: [
      'Applications/Antigravity-arm64/antigravity',
      'Applications/Antigravity-x64/antigravity',
      'Downloads/Antigravity-arm64/antigravity',
      'Downloads/Antigravity-x64/antigravity',
      '/opt/Antigravity-arm64/antigravity',
      '/opt/Antigravity-x64/antigravity',
    ],
  },
  {
    id: 'antigravity-cli',
    name: 'Antigravity CLI (agy)',
    provider: 'Google',
    kind: 'cli',
    installUrl: 'https://antigravity.google/docs/cli/install/',
    launchSupport: 'project-and-prompt',
    commands: ['agy'],
    macExecutables: ['.local/bin/agy'],
    windowsExecutables: ['AppData/Local/agy/bin/agy.exe'],
    linuxExecutables: ['.local/bin/agy'],
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    provider: 'Anthropic',
    kind: 'desktop',
    installUrl: 'https://claude.com/download',
    launchSupport: 'project-and-prompt',
    commands: [],
    macApplications: ['/Applications/Claude.app'],
    windowsApplications: [
      'AppData/Local/AnthropicClaude/Claude.exe',
      'AppData/Local/Programs/Claude/Claude.exe',
    ],
    windowsAppxPackageNames: ['Claude'],
    linuxApplications: ['/usr/bin/claude-desktop', '/usr/lib/claude-desktop/claude-desktop'],
  },
  {
    id: 'claude-cli',
    name: 'Claude Code',
    provider: 'Anthropic',
    kind: 'cli',
    installUrl: 'https://code.claude.com/docs/en/setup',
    launchSupport: 'project-and-prompt',
    commands: ['claude'],
    macExecutables: ['.local/bin/claude'],
    windowsExecutables: ['.local/bin/claude.exe'],
    linuxExecutables: ['.local/bin/claude'],
  },
  {
    id: 'codex-desktop',
    name: 'ChatGPT desktop (Codex)',
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
    windowsAppxPackageNames: ['OpenAI.Codex'],
    linuxApplications: ['/usr/bin/chatgpt', '/usr/lib/chatgpt/ChatGPT'],
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    provider: 'OpenAI',
    kind: 'cli',
    installUrl: 'https://learn.chatgpt.com/docs/codex/cli',
    launchSupport: 'project-and-prompt',
    commands: ['codex'],
    macExecutables: ['.local/bin/codex'],
    windowsExecutables: ['AppData/Local/Programs/OpenAI/Codex/bin/codex.exe'],
    linuxExecutables: ['.local/bin/codex'],
  },
  {
    id: 'grok-bot',
    name: 'Grok Bot',
    provider: 'xAI',
    kind: 'desktop',
    installUrl: 'https://x.ai/bot',
    launchSupport: 'launch-only',
    commands: [],
    macApplications: ['/Applications/Grok Bot.app'],
    windowsApplications: ['AppData/Local/Programs/Grok Bot/Grok Bot.exe'],
    linuxApplications: ['/opt/Grok Bot/grok-bot', '/usr/bin/grok-bot'],
  },
  {
    id: 'grok-cli',
    name: 'Grok Build',
    provider: 'xAI',
    kind: 'cli',
    installUrl: 'https://x.ai/build',
    launchSupport: 'project-and-prompt',
    commands: ['grok'],
    macExecutables: ['.grok/bin/grok'],
    windowsExecutables: ['.grok/bin/grok.exe'],
    linuxExecutables: ['.grok/bin/grok'],
  },
] as const;

const V2_AI_SURFACE_IDS = [
  'vscode-copilot',
  'copilot-desktop',
  'antigravity-desktop',
  'claude-desktop',
  'codex-desktop',
  'grok-bot',
  'copilot-cli',
  'antigravity-cli',
  'claude-cli',
  'codex-cli',
  'grok-cli',
] as const satisfies readonly AiSurfaceId[];

const AI_SURFACE_DEFINITIONS_BY_ID = new Map(
  AI_SURFACE_DEFINITIONS.map((definition) => [definition.id, definition] as const),
);
if (AI_SURFACE_DEFINITIONS_BY_ID.size !== V2_AI_SURFACE_IDS.length
  || AI_SURFACE_DEFINITIONS.length !== V2_AI_SURFACE_IDS.length) {
  throw new Error('EAI AI surface definitions must contain each canonical v2 surface exactly once.');
}

export const AI_SURFACES: readonly AiSurfaceDefinition[] = Object.freeze(
  V2_AI_SURFACE_IDS.map((id) => {
    const definition = AI_SURFACE_DEFINITIONS_BY_ID.get(id);
    if (!definition) throw new Error(`EAI AI surface definition is missing: ${id}`);
    for (const values of [
      definition.commands,
      definition.macApplications,
      definition.windowsApplications,
      definition.windowsProgramFilesApplications,
      definition.windowsAppxPackageNames,
      definition.linuxApplications,
      definition.macExecutables,
      definition.windowsExecutables,
      definition.linuxExecutables,
    ]) {
      if (values) Object.freeze(values);
    }
    return Object.freeze(definition);
  }),
);

const LEGACY_AI_SURFACES: ReadonlyArray<{
  id: LegacyAiSurfaceId;
  name: string;
  provider: 'GitHub' | 'Anthropic' | 'OpenAI' | 'xAI';
  kind: AiSurfaceKind;
  installUrl: string;
  launchSupport: Exclude<LaunchSupport, 'launch-only'>;
  commands: readonly string[];
  macApplications?: readonly string[];
  windowsApplications?: readonly string[];
}> = [
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
    windowsApplications: [
      'AppData/Local/AnthropicClaude/Claude.exe',
      'AppData/Local/Programs/Claude/Claude.exe',
    ],
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
  if (!AI_SURFACE_DEFINITIONS_BY_ID.has(surfaceId)) {
    throw new Error(`Unknown AI surface: ${String(surfaceId)}`);
  }
  const target = preferencesPath(home);
  const preferencesDirectory = dirname(target);
  try {
    await mkdir(preferencesDirectory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }

  const directoryStatus = lstatSync(preferencesDirectory);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (!directoryStatus.isDirectory()
    || directoryStatus.isSymbolicLink()
    || (process.platform !== 'win32'
      && ((currentUid !== null && directoryStatus.uid !== currentUid)
        || (directoryStatus.mode & 0o022) !== 0))) {
    throw new Error('EAI refused to write preferences through an untrusted directory.');
  }

  const temporary = join(
    preferencesDirectory,
    `.preferences.${process.pid}.${randomBytes(16).toString('hex')}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(
      `${JSON.stringify({ version: 1, lastAiSurface: surfaceId }, null, 2)}\n`,
      { encoding: 'utf8' },
    );
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function windowsEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const exact = environment[name];
  if (exact) return exact;
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? environment[key] : undefined;
}

const WINDOWS_CMD_META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/g;
const WINDOWS_CMD = 'C:\\Windows\\System32\\cmd.exe';

function escapeWindowsCmdCommand(value: string): string {
  return value.replace(WINDOWS_CMD_META_CHARACTERS, '^$1');
}

function escapeWindowsCmdArgument(value: string): string {
  // Match CommandLineToArgvW quoting first, then protect every cmd.exe metacharacter.
  // This is the same non-shell interpolation strategy used by established Windows
  // process launchers: cmd.exe receives one already-escaped command string and Node
  // is told not to quote that string again.
  let escaped = value.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  escaped = escaped.replace(/(?=(\\+?)?)\1$/, '$1$1');
  escaped = `"${escaped}"`;
  return escaped.replace(WINDOWS_CMD_META_CHARACTERS, '^$1');
}

export function buildWindowsCommandInvocation(
  command: string,
  args: readonly string[],
  action: WindowsCommandAction,
  _environment: NodeJS.ProcessEnv = process.env,
): CommandOutputInvocation {
  if ([command, ...args].some((value) => /[\0\r\n]/.test(value))) {
    throw new Error('EAI refused to execute a Windows command containing control characters.');
  }

  const normalizedCommand = win32Path.normalize(command);
  const escapedCommand = /\.(?:cmd|bat)$/i.test(normalizedCommand)
    ? escapeWindowsCmdCommand(normalizedCommand)
    : escapeWindowsCmdArgument(normalizedCommand);
  const shellCommand = [escapedCommand, ...args.map(escapeWindowsCmdArgument)].join(' ');
  return {
    command: WINDOWS_CMD,
    args: ['/d', '/v:off', '/s', action, `"${shellCommand}"`],
    windowsVerbatimArguments: true,
  };
}

export function buildCommandOutputInvocation(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): CommandOutputInvocation {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) {
    return { command, args: [...args] };
  }
  return buildWindowsCommandInvocation(command, args, '/c', environment);
}

function defaultCommandPath(command: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(command)) return null;
  const pathValue = process.env.PATH ?? '';
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const commandHasExtension = process.platform === 'win32' && /\.[A-Za-z0-9]+$/.test(command);
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    for (const extension of commandHasExtension ? [''] : extensions) {
      const candidate = process.platform === 'win32'
        ? win32Path.resolve(directory, `${command}${extension}`)
        : resolve(directory, command);
      try {
        const status = statSync(candidate);
        if (!status.isFile()) continue;
        if (process.platform !== 'win32' && (status.mode & 0o111) === 0) continue;
        return realpathSync(candidate);
      } catch {
        // PATH entries are untrusted input. A missing or inaccessible entry is
        // simply not a detected command.
      }
    }
  }
  return null;
}

function defaultFileStatus(path: string): SurfaceFileStatus | null {
  try {
    const status = lstatSync(path);
    return {
      isFile: status.isFile(),
      executable: process.platform === 'win32' || (status.mode & 0o111) !== 0,
      mode: status.mode,
      size: status.size,
      isSymbolicLink: status.isSymbolicLink(),
      uid: status.uid,
      gid: status.gid,
      device: status.dev,
      inode: status.ino,
      modifiedTimeMs: status.mtimeMs,
    };
  } catch {
    return null;
  }
}

function defaultFileHeader(path: string, length: number): Uint8Array | null {
  if (!Number.isSafeInteger(length) || length <= 0 || length > 4096) return null;
  let descriptor: number | null = null;
  try {
    const flags = process.platform === 'win32'
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
    descriptor = openSync(path, flags);
    const status = fstatSync(descriptor);
    if (!status.isFile() || (process.platform !== 'win32' && (status.mode & 0o022) !== 0)) return null;
    const bytes = Buffer.alloc(length);
    const bytesRead = readSync(descriptor, bytes, 0, length, 0);
    return bytes.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function defaultFileSha256(path: string): string | null {
  const buffer = Buffer.alloc(1024 * 1024);
  const hash = createHash('sha256');
  let descriptor: number | null = null;
  try {
    const flags = process.platform === 'win32'
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
    descriptor = openSync(path, flags);
    const status = fstatSync(descriptor);
    if (!status.isFile() || (process.platform !== 'win32' && (status.mode & 0o022) !== 0)) return null;
    let position = 0;
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest('hex');
  } catch {
    return null;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

const MAX_CATALOG_TREE_FILES = 10_000;
const MAX_CATALOG_TREE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CATALOG_TREE_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_CATALOG_TREE_DIRECTORIES = 10_000;
const MAX_CATALOG_TREE_DEPTH = 64;

function boundedDirectoryEntries(
  path: string,
  maximumEntries: number,
): NonNullable<ReturnType<ReturnType<typeof opendirSync>['readSync']>>[] | null {
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 0) return null;
  const entries: NonNullable<ReturnType<ReturnType<typeof opendirSync>['readSync']>>[] = [];
  let directory: ReturnType<typeof opendirSync> | null = null;
  try {
    directory = opendirSync(path);
    while (true) {
      const entry = directory.readSync();
      if (entry === null) break;
      if (entries.length >= maximumEntries) return null;
      entries.push(entry);
    }
    return entries;
  } catch {
    return null;
  } finally {
    try {
      directory?.closeSync();
    } catch {
      // Reading to EOF may already have closed the directory handle.
    }
  }
}

function catalogTreeNodeIsTrusted(path: string, expectDirectory: boolean): boolean {
  try {
    const status = lstatSync(path);
    if (status.isSymbolicLink()
      || (expectDirectory ? !status.isDirectory() : !status.isFile())) return false;
    if (process.platform === 'linux') {
      // The Microsoft Debian package uses root:root files that may be
      // group-writable. Group 0 is privileged, so reject any other owner/group
      // and every world-writable node while accepting that exact package mode.
      if (status.uid !== 0 || status.gid !== 0 || (status.mode & 0o002) !== 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function catalogFileSha256(path: string): string | null {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  let descriptor: number | null = null;
  try {
    if (!catalogTreeNodeIsTrusted(path, false)) return null;
    const before = lstatSync(path);
    const flags = process.platform === 'win32'
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
    descriptor = openSync(path, flags);
    const opened = fstatSync(descriptor);
    if (!opened.isFile()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.size !== before.size
      || (process.platform === 'linux'
        && (opened.uid !== 0 || opened.gid !== 0 || (opened.mode & 0o002) !== 0))) return null;
    let position = 0;
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = fstatSync(descriptor);
    if (after.dev !== opened.dev
      || after.ino !== opened.ino
      || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs) return null;
    return hash.digest('hex');
  } catch {
    return null;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function defaultDirectoryTreeIdentity(path: string): DirectoryTreeIdentity | null {
  if (process.platform !== 'win32' && process.platform !== 'linux') return null;
  let realRoot: string;
  try {
    if (!catalogTreeNodeIsTrusted(path, true)) return null;
    realRoot = realpathSync(path);
    if (realRoot !== resolve(path)) return null;
    let ancestor = realRoot;
    while (true) {
      if (!catalogTreeNodeIsTrusted(ancestor, true)) return null;
      const parent = dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
  } catch {
    return null;
  }

  const files: Array<{ path: string; relativePath: string; size: number }> = [];
  const directories: Array<{
    path: string;
    entries: string[];
    device: number;
    inode: number;
  }> = [];
  const pending: Array<{ path: string; depth: number }> = [{ path: realRoot, depth: 0 }];
  let discoveredBytes = 0;
  try {
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current
        || current.depth > MAX_CATALOG_TREE_DEPTH
        || directories.length >= MAX_CATALOG_TREE_DIRECTORIES
        || !catalogTreeNodeIsTrusted(current.path, true)) return null;
      const directoryStatus = lstatSync(current.path);
      const maximumEntries = (MAX_CATALOG_TREE_FILES - files.length)
        + (MAX_CATALOG_TREE_DIRECTORIES - directories.length - 1);
      const entries = boundedDirectoryEntries(current.path, maximumEntries);
      if (!entries) return null;
      const entryNames = entries.map((entry) => entry.name).sort((left, right) => (
        Buffer.from(left).compare(Buffer.from(right))
      ));
      directories.push({
        path: current.path,
        entries: entryNames,
        device: directoryStatus.dev,
        inode: directoryStatus.ino,
      });
      for (const entry of entries) {
        const candidate = join(current.path, entry.name);
        if (entry.isSymbolicLink()) return null;
        if (entry.isDirectory()) {
          pending.push({ path: candidate, depth: current.depth + 1 });
          continue;
        }
        if (!entry.isFile() || !catalogTreeNodeIsTrusted(candidate, false)) return null;
        const relativePath = relative(realRoot, candidate).split('\\').join('/');
        if (!relativePath
          || relativePath.startsWith('../')
          || /[\0\r\n]/.test(relativePath)) return null;
        const status = lstatSync(candidate);
        if (!Number.isSafeInteger(status.size)
          || status.size < 0
          || status.size > MAX_CATALOG_TREE_FILE_BYTES
          || files.length >= MAX_CATALOG_TREE_FILES
          || discoveredBytes > MAX_CATALOG_TREE_BYTES - status.size) return null;
        discoveredBytes += status.size;
        files.push({ path: candidate, relativePath, size: status.size });
      }
    }
  } catch {
    return null;
  }
  files.sort((left, right) => Buffer.from(left.relativePath).compare(Buffer.from(right.relativePath)));

  const aggregate = createHash('sha256');
  let totalBytes = 0;
  for (const file of files) {
    const sha256 = catalogFileSha256(file.path);
    if (!sha256) return null;
    totalBytes += file.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_CATALOG_TREE_BYTES) return null;
    aggregate.update(file.relativePath);
    aggregate.update('\0');
    aggregate.update(String(file.size));
    aggregate.update('\0');
    aggregate.update(sha256);
    aggregate.update('\n');
  }
  try {
    for (const directory of directories) {
      if (!catalogTreeNodeIsTrusted(directory.path, true)) return null;
      const status = lstatSync(directory.path);
      if (status.dev !== directory.device || status.ino !== directory.inode) return null;
      const relisted = boundedDirectoryEntries(directory.path, directory.entries.length);
      if (!relisted) return null;
      const entries = relisted.map((entry) => entry.name)
        .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
      if (entries.length !== directory.entries.length
        || entries.some((entry, index) => entry !== directory.entries[index])) return null;
    }
  } catch {
    return null;
  }
  return {
    realPath: realRoot,
    fileCount: files.length,
    totalBytes,
    sha256: aggregate.digest('hex'),
  };
}

interface MetadataHelperResult {
  stdout: string;
  stderr: string;
}

const POSIX_METADATA_HELPERS = new Set([
  '/usr/bin/codesign',
  '/usr/bin/dpkg',
  '/usr/bin/dpkg-query',
  '/usr/bin/plutil',
  '/usr/bin/xdg-mime',
]);

function runPosixMetadataHelper(command: string, args: readonly string[]): MetadataHelperResult | null {
  if (!POSIX_METADATA_HELPERS.has(command)) return null;
  try {
    const status = statSync(command);
    if (!status.isFile() || status.uid !== 0 || (status.mode & 0o022) !== 0) return null;
  } catch {
    return null;
  }
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C' },
  });
  if (result.status !== 0) return null;
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function machOArchitectures(path: string): NodeJS.Architecture[] | null {
  const headerBytes = defaultFileHeader(path, 4096);
  if (!headerBytes || headerBytes.length < 8) return null;
  const header = Buffer.from(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
  const architectures: NodeJS.Architecture[] = [];
  const addCpuType = (cpuType: number): boolean => {
    if (cpuType === 0x01000007) architectures.push('x64');
    else if (cpuType === 0x0100000c) architectures.push('arm64');
    else return false;
    return true;
  };
  const magic = header.readUInt32BE(0);
  if (magic === 0xfeedfacf || magic === 0xfeedface) {
    if (!addCpuType(header.readUInt32BE(4))) return null;
  } else if (magic === 0xcffaedfe || magic === 0xcefaedfe) {
    if (!addCpuType(header.readUInt32LE(4))) return null;
  } else if (
    magic === 0xcafebabe
    || magic === 0xbebafeca
    || magic === 0xcafebabf
    || magic === 0xbfbafeca
  ) {
    const littleEndian = magic === 0xbebafeca || magic === 0xbfbafeca;
    const recordSize = magic === 0xcafebabf || magic === 0xbfbafeca ? 32 : 20;
    const readUInt32 = (offset: number) => littleEndian
      ? header.readUInt32LE(offset)
      : header.readUInt32BE(offset);
    const count = readUInt32(4);
    if (count < 1 || count > 64 || 8 + count * recordSize > header.length) return null;
    for (let index = 0; index < count; index += 1) {
      if (!addCpuType(readUInt32(8 + index * recordSize))) return null;
    }
  } else {
    return null;
  }
  return [...new Set(architectures)];
}

function defaultMacApplicationIdentity(
  path: string,
  expected?: ExpectedMacApplicationIdentity,
): MacApplicationIdentity | null {
  if (process.platform !== 'darwin') return null;
  if (!expected
    || !/^[A-Za-z0-9.-]+$/.test(expected.bundleIdentifier)
    || !/^[A-Z0-9]{10}$/.test(expected.teamIdentifier)) return null;
  const applicationPath = trustedPosixDirectory(path);
  if (!applicationPath?.endsWith('.app')) return null;

  const trustedDeveloperId = runPosixMetadataHelper('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--test-requirement',
    `=identifier "${expected.bundleIdentifier}" and anchor apple generic and certificate leaf[subject.OU] = "${expected.teamIdentifier}"`,
    applicationPath,
  ]);
  if (!trustedDeveloperId) return null;

  const infoPlist = join(applicationPath, 'Contents', 'Info.plist');
  const plistJson = runPosixMetadataHelper('/usr/bin/plutil', [
    '-convert',
    'json',
    '-o',
    '-',
    infoPlist,
  ])?.stdout;
  let plist: {
    CFBundleIdentifier?: unknown;
    CFBundleExecutable?: unknown;
    CFBundleURLTypes?: unknown;
  };
  try {
    plist = JSON.parse(plistJson ?? '') as typeof plist;
  } catch {
    return null;
  }
  const bundleIdentifier = typeof plist.CFBundleIdentifier === 'string'
    ? plist.CFBundleIdentifier
    : null;
  if (bundleIdentifier !== expected.bundleIdentifier) return null;
  const executableName = typeof plist.CFBundleExecutable === 'string'
    ? plist.CFBundleExecutable
    : null;
  if (!executableName || /[\\/\0\r\n]/.test(executableName)) return null;
  let executablePath: string;
  try {
    executablePath = realpathSync(join(applicationPath, 'Contents', 'MacOS', executableName));
    if (!executablePath.startsWith(`${applicationPath}/Contents/MacOS/`)) return null;
    const status = statSync(executablePath);
    if (!status.isFile() || (status.mode & 0o111) === 0 || (status.mode & 0o022) !== 0) return null;
  } catch {
    return null;
  }

  const architectures = machOArchitectures(executablePath);
  if (!architectures) return null;

  const urlTypes = Array.isArray(plist.CFBundleURLTypes)
    ? plist.CFBundleURLTypes as Array<{ CFBundleURLSchemes?: unknown }>
    : [];
  const urlSchemes = urlTypes.flatMap((entry) => Array.isArray(entry.CFBundleURLSchemes)
    ? entry.CFBundleURLSchemes.filter((value): value is string => typeof value === 'string')
    : []);

  return {
    bundleIdentifier,
    teamIdentifier: expected.teamIdentifier,
    executablePath,
    architectures,
    urlSchemes,
  };
}

function trustedPosixAncestors(path: string): boolean {
  if (process.platform === 'win32') return false;
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
  try {
    let cursor = path;
    while (true) {
      const status = lstatSync(cursor);
      if (status.isSymbolicLink()
        || (status.mode & 0o022) !== 0
        || (currentUid !== null && status.uid !== 0 && status.uid !== currentUid)) return false;
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  } catch {
    return false;
  }
  return true;
}

function trustedPosixDirectory(path: string): string | null {
  if (process.platform === 'win32') return null;
  try {
    const original = lstatSync(path);
    if (!original.isDirectory() || original.isSymbolicLink()) return null;
    const realPath = realpathSync(path);
    return realPath === resolve(path) && trustedPosixAncestors(realPath) ? realPath : null;
  } catch {
    return null;
  }
}

function rootOwnedProtectedExecutable(path: string): boolean {
  if (process.platform === 'win32') return false;
  try {
    const realPath = realpathSync(path);
    if (realPath !== path) return false;
    let cursor = realPath;
    while (true) {
      const status = lstatSync(cursor);
      if (status.isSymbolicLink() || status.uid !== 0 || (status.mode & 0o022) !== 0) return false;
      if (cursor === realPath && (!status.isFile() || (status.mode & 0o111) === 0)) return false;
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    return true;
  } catch {
    return false;
  }
}

function trustedPosixFile(path: string): { realPath: string; status: SurfaceFileStatus } | null {
  if (process.platform === 'win32') return null;
  let realPath: string;
  try {
    const original = lstatSync(path);
    if (!original.isFile() || original.isSymbolicLink() || (original.mode & 0o111) === 0) return null;
    realPath = realpathSync(path);
    if (realPath !== resolve(path) || !trustedPosixAncestors(realPath)) return null;
  } catch {
    return null;
  }
  const status = defaultFileStatus(realPath);
  return status?.isFile && status.executable && !status.isSymbolicLink
    ? { realPath, status }
    : null;
}

function defaultMacExecutableIdentity(
  path: string,
  expected?: ExpectedMacExecutableIdentity,
): MacExecutableIdentity | null {
  if (process.platform !== 'darwin'
    || !expected
    || !/^[A-Za-z0-9.-]+$/.test(expected.identifier)
    || !/^[A-Z0-9]{10}$/.test(expected.teamIdentifier)) return null;
  const trustedFile = trustedPosixFile(path);
  if (!trustedFile) return null;
  const verified = runPosixMetadataHelper('/usr/bin/codesign', [
    '--verify',
    '--strict',
    '--test-requirement',
    `=identifier "${expected.identifier}" and anchor apple generic and certificate leaf[subject.OU] = "${expected.teamIdentifier}"`,
    trustedFile.realPath,
  ]);
  const architectures = verified ? machOArchitectures(trustedFile.realPath) : null;
  if (!architectures) return null;
  return {
    identifier: expected.identifier,
    teamIdentifier: expected.teamIdentifier,
    architectures,
  };
}

const WINDOWS_POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const WINDOWS_REG = 'C:\\Windows\\System32\\reg.exe';

function runWindowsMetadataHelper(
  command: typeof WINDOWS_POWERSHELL | typeof WINDOWS_REG,
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {},
  timeout = 5000,
): MetadataHelperResult | null {
  if (process.platform !== 'win32' || !existsSync(command)) return null;
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    env: {
      SystemRoot: 'C:\\Windows',
      WINDIR: 'C:\\Windows',
      PATH: 'C:\\Windows\\System32;C:\\Windows',
      ...environment,
    },
  });
  if (result.status !== 0) return null;
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function defaultWindowsExecutableIdentity(path: string): WindowsExecutableIdentity | null {
  if (process.platform !== 'win32') return null;
  const script = [
    "$ErrorActionPreference='Stop'",
    '$item = Get-Item -LiteralPath $env:EAI_SURFACE_EXECUTABLE',
    'if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }',
    '$ancestor = $item.Directory; while ($null -ne $ancestor) { if (($ancestor.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }; $ancestor = $ancestor.Parent }',
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:EAI_SURFACE_EXECUTABLE',
    "if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) { exit 1 }",
    '$stream = [System.IO.File]::OpenRead($env:EAI_SURFACE_EXECUTABLE)',
    'try { $reader = [System.IO.BinaryReader]::new($stream); if ($reader.ReadUInt16() -ne 0x5A4D) { exit 1 }; $stream.Position = 0x3C; $peOffset = $reader.ReadInt32(); $stream.Position = $peOffset; if ($reader.ReadUInt32() -ne 0x00004550) { exit 1 }; $machine = $reader.ReadUInt16() } finally { $stream.Dispose() }',
    "$architecture = switch ($machine) { 0x8664 { 'x64' } 0xAA64 { 'arm64' } default { exit 1 } }",
    '[pscustomobject]@{ productName = [string]$item.VersionInfo.ProductName; companyName = [string]$item.VersionInfo.CompanyName; publisher = [string]$signature.SignerCertificate.Subject; architecture = $architecture } | ConvertTo-Json -Compress',
  ].join('; ');
  const result = runWindowsMetadataHelper(
    WINDOWS_POWERSHELL,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { EAI_SURFACE_EXECUTABLE: path },
  );
  if (!result) return null;
  try {
    const parsed = JSON.parse(result.stdout.trim()) as Partial<WindowsExecutableIdentity>;
    if (typeof parsed.productName !== 'string'
      || typeof parsed.companyName !== 'string'
      || typeof parsed.publisher !== 'string'
      || (parsed.architecture !== 'x64' && parsed.architecture !== 'arm64')) return null;
    return {
      productName: parsed.productName,
      companyName: parsed.companyName,
      publisher: parsed.publisher,
      architecture: parsed.architecture,
    };
  } catch {
    return null;
  }
}

function defaultWindowsVsCodeInstallationAcl(path: string): boolean {
  if (process.platform !== 'win32') return false;
  const script = [
    "$ErrorActionPreference='Stop'",
    "$trustedWriters=@('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')",
    "$trustedOwners=@('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')",
    '$writeMask=[int64]0x500D0156',
    'function Test-ProtectedNode($item,[bool]$requireProtected,[bool]$ignoreInheritOnly){ if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }; $acl=Get-Acl -LiteralPath $item.FullName; if (-not $acl.AreAccessRulesCanonical -or ($requireProtected -and -not $acl.AreAccessRulesProtected) -or $acl.Sddl -match "NO_ACCESS_CONTROL") { exit 1 }; $owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; if ($trustedOwners -notcontains $owner) { exit 1 }; foreach($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) { if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or $trustedWriters -contains $rule.IdentityReference.Value) { continue }; if ($ignoreInheritOnly -and (($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0)) { continue }; if (([int64]$rule.FileSystemRights -band $writeMask) -ne 0) { exit 1 } } }',
    '$programFiles=[System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::ProgramFiles)',
    '$programFilesItem=Get-Item -Force -LiteralPath $programFiles',
    "$expected=[System.IO.Path]::GetFullPath((Join-Path $programFilesItem.FullName 'Microsoft VS Code')).TrimEnd([char]92)",
    '$root=Get-Item -Force -LiteralPath $env:EAI_VSCODE_INSTALLATION',
    '$rootPath=[System.IO.Path]::GetFullPath($root.FullName).TrimEnd([char]92)',
    'if (-not [string]::Equals($rootPath,$expected,[System.StringComparison]::OrdinalIgnoreCase)) { exit 1 }',
    'Test-ProtectedNode $programFilesItem $true $true',
    'Test-ProtectedNode $root $true $false',
    '$pending=[System.Collections.Generic.Stack[System.IO.DirectoryInfo]]::new(); $pending.Push($root); $count=0',
    'while($pending.Count -gt 0) { $directory=$pending.Pop(); foreach($item in Get-ChildItem -Force -LiteralPath $directory.FullName) { $count++; if ($count -gt 20000) { exit 1 }; Test-ProtectedNode $item $false $false; if ($item.PSIsContainer) { $pending.Push($item) } } }',
    "Write-Output 'ok'",
  ].join('; ');
  const result = runWindowsMetadataHelper(
    WINDOWS_POWERSHELL,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { EAI_VSCODE_INSTALLATION: path },
    20_000,
  );
  return result?.stdout.trim() === 'ok';
}

function defaultWindowsAppxIdentity(packageName: string): WindowsAppxIdentity | null {
  if (process.platform !== 'win32' || !/^[A-Za-z0-9.-]+$/.test(packageName)) return null;
  const script = [
    "$ErrorActionPreference='Stop'",
    '$package = Get-AppxPackage -Name $env:EAI_SURFACE_PACKAGE | Sort-Object Version -Descending | Select-Object -First 1',
    'if ($null -eq $package) { exit 1 }',
    '$manifest = Get-AppxPackageManifest -Package $package.PackageFullName',
    '$applicationIds = @($manifest.Package.Applications.Application | ForEach-Object { [string]$_.Id })',
    'if ($applicationIds.Count -eq 0 -or @($applicationIds | Where-Object { $_ -notmatch "^[A-Za-z0-9._-]+$" }).Count -gt 0) { exit 1 }',
    '[pscustomobject]@{ packageName = [string]$package.Name; publisher = [string]$package.Publisher; publisherId = [string]$package.PublisherId; familyName = [string]$package.PackageFamilyName; applicationIds = [string[]]$applicationIds; architecture = [string]$package.Architecture; signatureKind = [string]$package.SignatureKind; status = [string]$package.Status } | ConvertTo-Json -Compress',
  ].join('; ');
  const result = runWindowsMetadataHelper(
    WINDOWS_POWERSHELL,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { EAI_SURFACE_PACKAGE: packageName },
  );
  if (!result) return null;
  try {
    const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    const architecture = typeof parsed.architecture === 'string' ? parsed.architecture.toLowerCase() : '';
    const applicationIds = Array.isArray(parsed.applicationIds)
      ? parsed.applicationIds.filter((value): value is string => typeof value === 'string')
      : typeof parsed.applicationIds === 'string' ? [parsed.applicationIds] : [];
    if (typeof parsed.packageName !== 'string'
      || typeof parsed.publisher !== 'string'
      || typeof parsed.publisherId !== 'string'
      || typeof parsed.familyName !== 'string'
      || (architecture !== 'x64' && architecture !== 'arm64')
      || (parsed.signatureKind !== 'Developer' && parsed.signatureKind !== 'Store')
      || parsed.status !== 'Ok'
      || applicationIds.length === 0) return null;
    return {
      packageName: parsed.packageName,
      publisher: parsed.publisher,
      publisherId: parsed.publisherId,
      familyName: parsed.familyName,
      applicationIds,
      architecture,
      signatureKind: parsed.signatureKind,
      status: 'Ok',
    };
  } catch {
    return null;
  }
}

function windowsRegistryExecutable(output: string): string | null {
  const value = output
    .split(/\r?\n/)
    .map((line) => line.match(/\bREG_(?:EXPAND_)?SZ\s+(.+)$/i)?.[1]?.trim())
    .find((candidate): candidate is string => Boolean(candidate));
  if (!value || /[\0\r\n]/.test(value)) return null;
  const quoted = value.match(/^"([A-Za-z]:\\[^"<>|?*]+\.exe)"\s+(?:"%1"|%1)$/i);
  if (quoted) return win32Path.normalize(quoted[1]);
  const unquoted = value.match(/^([A-Za-z]:\\[^\s"<>|?*]+\.exe)\s+(?:"%1"|%1)$/i);
  return unquoted ? win32Path.normalize(unquoted[1]) : null;
}

function defaultWindowsUrlHandlerExecutable(scheme: 'claude' | 'ghapp'): string | null {
  const result = runWindowsMetadataHelper(
    WINDOWS_REG,
    ['query', `HKCR\\${scheme}\\shell\\open\\command`, '/ve'],
  );
  return result ? windowsRegistryExecutable(result.stdout) : null;
}

function nodeArchitectureFromLinux(value: string): 'x64' | 'arm64' | null {
  if (value === 'amd64' || value === 'x86_64') return 'x64';
  if (value === 'arm64' || value === 'aarch64') return 'arm64';
  return null;
}

const COPILOT_LINUX_VERSION = '1.1.15';
const COPILOT_LINUX_ORIGIN = `https://github.com/github/app/releases/tag/v${COPILOT_LINUX_VERSION}`;
const VERIFIED_COPILOT_LINUX_DEBS: Readonly<Partial<Record<NodeJS.Architecture, {
  artifactSha256: string;
  executableSize: number;
  executableSha256: string;
  packageManifestSize: number;
  packageManifestSha256: string;
}>>> = {
  arm64: {
    artifactSha256: '587445c4ad98917638204f6a66f15b1868b8795b317725cbed37fc635df07e10',
    executableSize: 969_511_224,
    executableSha256: 'accf69bea75cb15c2afbb88b9011fa98a0705d8196ace29c49fb802548b27f0c',
    packageManifestSize: 5_892,
    packageManifestSha256: '1b54b99c5bcfb24e17d4d3ba1e73ffc80c8985021ed185cb0ac857890c541236',
  },
  x64: {
    artifactSha256: 'cf884fd0b9e5418285e82318c4fe712d74955f66982bae6a5d5c43aa1f44233e',
    executableSize: 982_846_656,
    executableSha256: '6033d7d87d60e5e86f00cf79f87174392051e016e6fad439d0eb657e6a5fdc55',
    packageManifestSize: 5_892,
    packageManifestSha256: '12d527ed0e0d9dd3f73bc88f99f15b1e49765f2d3157ab0f159158685c9ad1ec',
  },
};

const VSCODE_CATALOG_VERSION = '1.136.1';
const VSCODE_CATALOG_COMMIT = 'a44adf7f53e00964ab890f9f8758a334f1fc15bc';
const VSCODE_CATALOG_COMMIT_DIRECTORY = VSCODE_CATALOG_COMMIT.slice(0, 10);
const VSCODE_CATALOG_LAUNCH_ENVIRONMENT = Object.freeze({
  ELECTRON_RUN_AS_NODE: '1',
  VSCODE_DEV: '',
  VSCODE_IPC_HOOK_CLI: '',
});
const WINDOWS_VSCODE_INSTALLATION_ENTRIES = Object.freeze([
  VSCODE_CATALOG_COMMIT_DIRECTORY,
  'bin',
  'Code.exe',
  'Code.VisualElementsManifest.xml',
  'unins000.dat',
  'unins000.exe',
  'unins000.msg',
]);
const WINDOWS_VSCODE_UNINSTALLER_FILES = Object.freeze([
  'unins000.dat',
  'unins000.exe',
  'unins000.msg',
]);
const WINDOWS_VSCODE_BIN_ENTRIES = Object.freeze([
  'code',
  'code-tunnel.exe',
  'code.cmd',
]);

interface VsCodeCatalogFile {
  size: number;
  sha256: string;
}

interface VsCodeCatalogEntry {
  artifactSha256: string;
  executable: VsCodeCatalogFile;
  applicationTree: Omit<DirectoryTreeIdentity, 'realPath'>;
  auxiliaryTree?: Omit<DirectoryTreeIdentity, 'realPath'>;
  visualManifest?: VsCodeCatalogFile;
  packageJson: VsCodeCatalogFile;
  productJson: VsCodeCatalogFile;
  copilotPackageJson: VsCodeCatalogFile;
  cliJs: VsCodeCatalogFile;
  packageVersion?: string;
  origin: string;
}

// Exact payloads provisioned by the EAI Setup ARM64 release harness. The
// executable alone is insufficient for Electron: bind every application runtime
// file, including sibling native libraries, so modified code cannot inherit a
// valid executable signature. Update these values only from a newly verified
// official asset.
const VERIFIED_VSCODE_CATALOGS: Readonly<Partial<Record<'win32' | 'linux', Partial<Record<
  NodeJS.Architecture,
  VsCodeCatalogEntry
>>>>> = {
  win32: {
    arm64: {
      artifactSha256: '57454d84d55f07b532fcf42295c57a5445054006be668ad7b1c19c9de9f68e31',
      executable: {
        size: 218_732_896,
        sha256: 'c8e8f54f217223f3d4adff4dbd1f529aa7386c3a1705dbe214ecf187b963423e',
      },
      applicationTree: {
        fileCount: 2_463,
        totalBytes: 782_690_305,
        sha256: '11009193bf07e51892a0ae9f6030188c7f8914e79ef4344e2f6a3a344807753f',
      },
      auxiliaryTree: {
        fileCount: 3,
        totalBytes: 25_558_542,
        sha256: '73fbdad4bf097af9408bdcbe75f4c5cc1741b88b9eedf9d946b338124457408b',
      },
      visualManifest: {
        size: 398,
        sha256: 'cff3bb59579080b4ac4e69fc8d936c35bbb41455f66f9188ed54f4e31882e68b',
      },
      packageJson: {
        size: 15_233,
        sha256: '18ce306138992d44d6c0537c386943b277621865d5161e1932e792b09ef766f0',
      },
      productJson: {
        size: 71_150,
        sha256: '4bdbecbf1cd1a700f4f738216bd0e6f08f561a52e1fd9ca915ea9ff9a6a7a7a6',
      },
      copilotPackageJson: {
        size: 200_790,
        sha256: '586aa5105751792bedcb7c3ef785d0c1cb1bac8c97812afd50f1349f0a6c1a09',
      },
      cliJs: {
        size: 291_407,
        sha256: '487137301c6d9ac59dc846a93c17e2f52ba98fdf1670c164dac24b4eb5acad61',
      },
      origin: `https://update.code.visualstudio.com/${VSCODE_CATALOG_VERSION}/win32-arm64/stable`,
    },
  },
  linux: {
    arm64: {
      artifactSha256: 'baa72f92d3feaa76d015202c57271475ea15809e635587279171a972cdd612a4',
      executable: {
        size: 212_536_608,
        sha256: '8872f37cb828d74498b0451ed923a141e5b144dfd9de9c8f41265bf90b0af98d',
      },
      applicationTree: {
        fileCount: 2_415,
        totalBytes: 1_035_373_322,
        sha256: '437e3d7f2338684372876807533f7d38c0e9b56bd8be9238b520dfc2a01ef8e6',
      },
      packageJson: {
        size: 15_266,
        sha256: 'ba6a64fd136466074831d91c20ec6d3dd110c127a84a8ac9b47cd4f075172ad9',
      },
      productJson: {
        size: 67_081,
        sha256: '0fb7ff5e7c78427f0601f864ec8adc8e163a384f8da1c49e9e99adbffaa7e547',
      },
      copilotPackageJson: {
        size: 200_790,
        sha256: '586aa5105751792bedcb7c3ef785d0c1cb1bac8c97812afd50f1349f0a6c1a09',
      },
      cliJs: {
        size: 291_436,
        sha256: 'c26b66d4031d946523eb9b951da9bc56aba16417e91d84534ce6367e815fe342',
      },
      packageVersion: '1.136.1-1788414014',
      origin: `https://update.code.visualstudio.com/${VSCODE_CATALOG_VERSION}/linux-deb-arm64/stable`,
    },
  },
};

function vsCodeCatalog(
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): VsCodeCatalogEntry | null {
  if (platform !== 'win32' && platform !== 'linux') return null;
  return VERIFIED_VSCODE_CATALOGS[platform]?.[architecture] ?? null;
}

function rootOwnedReadOnlyFileContent(path: string): string | null {
  try {
    const realPath = realpathSync(path);
    if (realPath !== resolve(path)) return null;
    let cursor = realPath;
    while (true) {
      const status = lstatSync(cursor);
      if (status.isSymbolicLink() || status.uid !== 0 || (status.mode & 0o022) !== 0) return null;
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    const status = lstatSync(realPath);
    if (!status.isFile()) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function immutableCopilotDpkgIdentityMatches(
  packageName: string,
  architecture: 'x64' | 'arm64',
  version: string,
  ownedPath: string,
): (typeof VERIFIED_COPILOT_LINUX_DEBS)[NodeJS.Architecture] | null {
  const expected = VERIFIED_COPILOT_LINUX_DEBS[architecture];
  if (packageName !== 'github'
    || !expected
    || version !== COPILOT_LINUX_VERSION
    || ownedPath !== '/usr/bin/github') return null;
  const status = defaultFileStatus(ownedPath);
  const header = defaultFileHeader(ownedPath, 64);
  const packageManifest = '/var/lib/dpkg/info/github.md5sums';
  const packageManifestStatus = defaultFileStatus(packageManifest);
  return status?.isFile
    && status.executable
    && (status.mode & 0o022) === 0
    && status.size === expected.executableSize
    && header
    && validElfHeader(header, architecture)
    && defaultFileSha256(ownedPath) === expected.executableSha256
    && rootOwnedReadOnlyFileContent(packageManifest) !== null
    && packageManifestStatus?.size === expected.packageManifestSize
    && defaultFileSha256(packageManifest) === expected.packageManifestSha256
    ? expected
    : null;
}

function immutableVsCodeDpkgIdentityMatches(
  packageName: string,
  architecture: 'x64' | 'arm64',
  version: string,
  ownedPath: string,
): VsCodeCatalogEntry | null {
  const expected = vsCodeCatalog('linux', architecture);
  if (packageName !== 'code'
    || !expected?.packageVersion
    || version !== expected.packageVersion
    || ownedPath !== '/usr/share/code/code') return null;
  const status = defaultFileStatus(ownedPath);
  const header = defaultFileHeader(ownedPath, 64);
  return status?.isFile
    && status.executable
    && status.uid === 0
    && status.gid === 0
    && (status.mode & 0o022) === 0
    && status.size === expected.executable.size
    && header
    && validElfHeader(header, architecture)
    && defaultFileSha256(ownedPath) === expected.executable.sha256
    ? expected
    : null;
}

function defaultLinuxPackageIdentity(path: string): LinuxPackageIdentity | null {
  if (process.platform !== 'linux') return null;
  let ownedPath: string;
  try {
    ownedPath = realpathSync(path);
  } catch {
    return null;
  }

  const owner = runPosixMetadataHelper('/usr/bin/dpkg-query', ['-S', ownedPath])?.stdout.trim();
  const ownerMatch = owner?.match(/^([A-Za-z0-9+.-]+)(?::[A-Za-z0-9_-]+)?:\s+(.+)$/);
  if (ownerMatch && ownerMatch[2] === ownedPath) {
    const packageName = ownerMatch[1];
    const metadata = runPosixMetadataHelper('/usr/bin/dpkg-query', [
      '-W',
      '-f=${Package}\t${Architecture}\t${Version}\t${Status}',
      packageName,
    ])?.stdout.trim();
    const match = metadata?.match(/^([A-Za-z0-9+.-]+)\t([A-Za-z0-9_-]+)\t(\S+)\tinstall ok installed$/);
    const architecture = match ? nodeArchitectureFromLinux(match[2]) : null;
    const verified = runPosixMetadataHelper('/usr/bin/dpkg', ['--verify', packageName]);
    const immutableCopilot = match && architecture
      ? immutableCopilotDpkgIdentityMatches(packageName, architecture, match[3], ownedPath)
      : null;
    const immutableVsCode = match && architecture
      ? immutableVsCodeDpkgIdentityMatches(packageName, architecture, match[3], ownedPath)
      : null;
    if (match?.[1] === packageName
      && architecture
      && verified
      && verified.stdout.trim() === ''
      && immutableCopilot) {
      return {
        packageName,
        architecture,
        version: match[3],
        manager: 'dpkg',
        ownedPath,
        origin: COPILOT_LINUX_ORIGIN,
        signatureVerified: false,
        catalogArtifactSha256: immutableCopilot.artifactSha256,
        executableSha256: immutableCopilot.executableSha256,
      };
    }
    if (match?.[1] === packageName
      && architecture
      && verified
      && verified.stdout.trim() === ''
      && immutableVsCode) {
      return {
        packageName,
        architecture,
        version: match[3],
        manager: 'dpkg',
        ownedPath,
        origin: immutableVsCode.origin,
        signatureVerified: false,
        catalogArtifactSha256: immutableVsCode.artifactSha256,
        executableSha256: immutableVsCode.executable.sha256,
      };
    }
  }
  return null;
}

function defaultLinuxUrlSchemeDesktopId(scheme: 'claude' | 'ghapp'): string | null {
  if (process.platform !== 'linux') return null;
  const value = runPosixMetadataHelper(
    '/usr/bin/xdg-mime',
    ['query', 'default', `x-scheme-handler/${scheme}`],
  )?.stdout.trim();
  return value && /^[A-Za-z0-9][A-Za-z0-9._-]*\.desktop$/.test(value) ? value : null;
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
  directoryEntries(path) {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  directoryTreeIdentity: defaultDirectoryTreeIdentity,
  fileStatus: defaultFileStatus,
  fileHeader: defaultFileHeader,
  fileSha256: defaultFileSha256,
  macApplicationIdentity: defaultMacApplicationIdentity,
  macExecutableIdentity: defaultMacExecutableIdentity,
  windowsExecutableIdentity: defaultWindowsExecutableIdentity,
  windowsVsCodeInstallationAcl: defaultWindowsVsCodeInstallationAcl,
  windowsAppxIdentity: defaultWindowsAppxIdentity,
  windowsUrlHandlerExecutable: defaultWindowsUrlHandlerExecutable,
  linuxPackageIdentity: defaultLinuxPackageIdentity,
  linuxUrlSchemeDesktopId: defaultLinuxUrlSchemeDesktopId,
};

function windowsUserPathCandidates(
  paths: readonly string[],
  home: string,
  environment: NodeJS.ProcessEnv,
): string[] {
  const candidates: string[] = [];
  const localAppData = windowsEnvironmentValue(environment, 'LOCALAPPDATA');
  const appData = windowsEnvironmentValue(environment, 'APPDATA');
  for (const path of paths) {
    if (/^[A-Za-z]:[\\/]/.test(path)) {
      candidates.push(path);
      continue;
    }
    const localSuffix = path.match(/^AppData[\\/]Local[\\/](.+)$/i)?.[1];
    const roamingSuffix = path.match(/^AppData[\\/]Roaming[\\/](.+)$/i)?.[1];
    if (localSuffix && localAppData) candidates.push(win32Path.join(localAppData, localSuffix));
    if (roamingSuffix && appData) candidates.push(win32Path.join(appData, roamingSuffix));
    candidates.push(win32Path.join(home, path));
  }
  return [...new Set(candidates)];
}

function candidateApplicationPaths(
  surface: AiSurfaceDefinition,
  platform: NodeJS.Platform,
  home: string,
  environment: NodeJS.ProcessEnv,
): string[] {
  if (platform === 'darwin') {
    return (surface.macApplications ?? []).flatMap((path) => [
      path,
      path.startsWith('/Applications/')
        ? join(home, 'Applications', path.slice('/Applications/'.length))
        : join(home, 'Applications', basename(path)),
    ]);
  }
  if (platform === 'win32') {
    const candidates = windowsUserPathCandidates(surface.windowsApplications ?? [], home, environment);
    const programFilesRoots = [
      windowsEnvironmentValue(environment, 'ProgramW6432'),
      windowsEnvironmentValue(environment, 'ProgramFiles'),
      'C:\\Program Files',
    ].filter((value): value is string => Boolean(value));
    for (const root of [...new Set(programFilesRoots)]) {
      for (const path of surface.windowsProgramFilesApplications ?? []) {
        candidates.push(win32Path.join(root, path));
      }
    }
    return [...new Set(candidates)];
  }
  if (platform === 'linux') {
    return (surface.linuxApplications ?? []).map((path) =>
      path.startsWith('/') ? path : join(home, path),
    );
  }
  return [];
}

function candidateExecutablePaths(
  surface: AiSurfaceDefinition,
  platform: NodeJS.Platform,
  home: string,
  environment: NodeJS.ProcessEnv,
): string[] {
  if (platform === 'darwin') {
    return (surface.macExecutables ?? []).map((path) => path.startsWith('/') ? path : join(home, path));
  }
  if (platform === 'win32') {
    return windowsUserPathCandidates(surface.windowsExecutables ?? [], home, environment);
  }
  if (platform === 'linux') {
    return (surface.linuxExecutables ?? []).map((path) => path.startsWith('/') ? path : join(home, path));
  }
  return [];
}

function resolvedRegularExecutable(
  executable: string,
  platform: NodeJS.Platform,
  probe: SurfaceProbe,
): string | null {
  const originalStatus = probe.fileStatus?.(executable);
  if (originalStatus?.isSymbolicLink) return null;
  const realExecutable = probe.realPath?.(executable);
  if (!realExecutable) return null;
  const status = probe.fileStatus?.(realExecutable);
  if (!status?.isFile || !status.executable) return null;
  if (status.isSymbolicLink || (platform !== 'win32' && (status.mode & 0o022) !== 0)) return null;
  return realExecutable;
}

function launchFileBinding(
  path: string,
  probe: SurfaceProbe,
  platform: NodeJS.Platform = process.platform,
): LaunchFileBinding | null {
  const realPath = probe.realPath?.(path);
  const status = realPath ? probe.fileStatus?.(realPath) : null;
  const sha256 = realPath ? probe.fileSha256?.(realPath)?.toLowerCase() : null;
  if (!realPath
    || !status?.isFile
    || !status.executable
    || status.isSymbolicLink
    || (platform !== 'win32' && (status.mode & 0o022) !== 0)
    || !sha256
    || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  return {
    realPath,
    size: status.size,
    sha256,
    ...(status.device === undefined ? {} : { device: status.device }),
    ...(status.inode === undefined ? {} : { inode: status.inode }),
    ...(status.modifiedTimeMs === undefined ? {} : { modifiedTimeMs: status.modifiedTimeMs }),
  };
}

interface ExpectedMacApplicationIdentity {
  bundleIdentifier: string;
  teamIdentifier: string;
  requiredScheme?: 'claude' | 'ghapp';
}

interface ExpectedMacExecutableIdentity {
  identifier: string;
  teamIdentifier: string;
}

const EXPECTED_MAC_APPLICATION_IDENTITIES: Readonly<Partial<Record<AiSurfaceId, ExpectedMacApplicationIdentity>>> = {
  'vscode-copilot': { bundleIdentifier: 'com.microsoft.VSCode', teamIdentifier: 'UBF8T346G9' },
  'copilot-desktop': {
    bundleIdentifier: 'com.github.githubapp',
    teamIdentifier: 'VEKTX9H2N7',
    requiredScheme: 'ghapp',
  },
  'antigravity-desktop': { bundleIdentifier: 'com.google.antigravity', teamIdentifier: 'EQHXZ8M8AV' },
  'claude-desktop': {
    bundleIdentifier: 'com.anthropic.claudefordesktop',
    teamIdentifier: 'Q6L2SF6YDW',
    requiredScheme: 'claude',
  },
  'codex-desktop': { bundleIdentifier: 'com.openai.codex', teamIdentifier: '2DC432GLL2' },
  'grok-bot': { bundleIdentifier: 'com.anysphere.sand', teamIdentifier: 'DCNK4UB866' },
};

const EXPECTED_MAC_EXECUTABLE_IDENTITIES: Readonly<Partial<Record<AiSurfaceId, ExpectedMacExecutableIdentity>>> = {
  'copilot-cli': { identifier: 'copilot', teamIdentifier: 'VEKTX9H2N7' },
  'claude-cli': { identifier: 'com.anthropic.claude-code', teamIdentifier: 'Q6L2SF6YDW' },
  'codex-cli': { identifier: 'codex', teamIdentifier: '2DC432GLL2' },
};

function authenticatedCliTarget(
  surface: AiSurfaceDefinition,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
  home: string,
  environment: NodeJS.ProcessEnv,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  // Current reproducible signer evidence exists only for these three macOS
  // binaries. Windows and Linux CLIs remain intentionally undetected until an
  // exact Authenticode/package or immutable catalog identity is recorded.
  if (surface.kind !== 'cli' || platform !== 'darwin') return null;
  const expected = EXPECTED_MAC_EXECUTABLE_IDENTITIES[surface.id];
  if (!expected) return null;
  const candidates = [
    ...surface.commands.map((command) => probe.commandPath(command)).filter((value): value is string => Boolean(value)),
    ...candidateExecutablePaths(surface, platform, home, environment),
  ];
  for (const candidate of [...new Set(candidates)]) {
    const executable = resolvedRegularExecutable(candidate, platform, probe);
    if (!executable) continue;
    const identity = probe.macExecutableIdentity?.(executable, expected);
    const binding = launchFileBinding(executable, probe, platform);
    if (!identity
      || !binding
      || identity.identifier !== expected.identifier
      || identity.teamIdentifier !== expected.teamIdentifier
      || !identity.architectures.includes(architecture)) continue;
    return {
      executable: binding.realPath,
      launchArgsPrefix: [],
      launchEnvironment: {},
      // Signer identity alone does not prove a particular command-line
      // contract version, so advertise no optional flags until signed version
      // metadata is captured in the provenance catalog.
      capabilities: [],
      verification: {
        kind: 'mac-executable',
        ...binding,
        architecture,
        identifier: identity.identifier,
        teamIdentifier: identity.teamIdentifier,
      },
    };
  }
  return null;
}

function windowsApplicationIdentityMatches(
  surface: AiSurfaceDefinition,
  executable: string,
  architecture: NodeJS.Architecture,
  probe: SurfaceProbe,
): boolean {
  const identity = probe.windowsExecutableIdentity?.(executable);
  return Boolean(identity && windowsApplicationIdentityValueMatches(surface, identity, architecture));
}

function windowsApplicationIdentityValueMatches(
  surface: AiSurfaceDefinition,
  identity: WindowsExecutableIdentity,
  architecture: NodeJS.Architecture,
): boolean {
  if (!identity || identity.architecture !== architecture) return false;
  if (surface.id === 'vscode-copilot') {
    return identity.productName.trim() === 'Visual Studio Code'
      && identity.publisher === 'CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US';
  }
  if (surface.id === 'claude-desktop') {
    return (identity.productName.trim() === 'Claude' || identity.productName.trim() === 'Claude Desktop')
      && identity.publisher === 'CN=Anthropic PBC, O=Anthropic PBC, C=US';
  }
  if (surface.id === 'copilot-desktop') {
    return identity.productName.trim() === 'GitHub Copilot'
      && identity.publisher === 'CN=GitHub, Inc., O=GitHub, Inc., C=US';
  }
  return false;
}

function linuxPackageIdentityMatches(
  executable: string,
  packageName: 'code' | 'github' | 'claude-desktop' | 'chatgpt' | 'grok-bot',
  architecture: NodeJS.Architecture,
  probe: SurfaceProbe,
): boolean {
  const identity = probe.linuxPackageIdentity?.(executable);
  const realExecutable = probe.realPath?.(executable);
  if (!identity
    || !realExecutable
    || identity.packageName !== packageName
    || identity.architecture !== architecture
    || identity.ownedPath !== realExecutable
    || !/^\S+$/.test(identity.version)) return false;
  if (packageName === 'github') {
    const expected = VERIFIED_COPILOT_LINUX_DEBS[architecture];
    return Boolean(expected
      && identity.manager === 'dpkg'
      && identity.version === COPILOT_LINUX_VERSION
      && identity.origin === COPILOT_LINUX_ORIGIN
      && identity.signatureVerified === false
      && identity.catalogArtifactSha256 === expected.artifactSha256
      && identity.executableSha256 === expected.executableSha256);
  }
  if (packageName === 'code') {
    const expected = vsCodeCatalog('linux', architecture);
    return Boolean(expected
      && expected.packageVersion
      && identity.manager === 'dpkg'
      && identity.version === expected.packageVersion
      && identity.origin === expected.origin
      && identity.signatureVerified === false
      && identity.catalogArtifactSha256 === expected.artifactSha256
      && identity.executableSha256 === expected.executable.sha256);
  }
  // Repository configuration plus package-manager ownership does not bind the
  // installed payload to a signed repository index. These packages remain
  // fail-closed until an immutable signed-index/package/payload catalog exists.
  return false;
}

function applicationLaunchVerification(
  surface: AiSurfaceDefinition,
  executable: string,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
  probe: SurfaceProbe,
): LaunchArtifactVerification | null {
  if (platform === 'darwin') {
    const expected = EXPECTED_MAC_APPLICATION_IDENTITIES[surface.id];
    const identity = probe.macApplicationIdentity?.(executable, expected);
    const realApplication = probe.realPath?.(executable);
    const realExecutable = identity ? probe.realPath?.(identity.executablePath) : null;
    const executableBinding = realExecutable ? launchFileBinding(realExecutable, probe, platform) : null;
    if (!expected
      || !identity
      || !realApplication
      || !realExecutable
      || !executableBinding
      || identity.bundleIdentifier !== expected.bundleIdentifier
      || identity.teamIdentifier !== expected.teamIdentifier
      || !identity.architectures.includes(architecture)
      || !realExecutable.startsWith(`${realApplication}/Contents/MacOS/`)
      || (expected.requiredScheme !== undefined
        && !identity.urlSchemes.includes(expected.requiredScheme))) return null;
    return {
      kind: 'mac-application',
      realPath: realApplication,
      executablePath: realExecutable,
      executableSize: executableBinding.size,
      executableSha256: executableBinding.sha256,
      ...(executableBinding.device === undefined ? {} : { executableDevice: executableBinding.device }),
      ...(executableBinding.inode === undefined ? {} : { executableInode: executableBinding.inode }),
      ...(executableBinding.modifiedTimeMs === undefined
        ? {}
        : { executableModifiedTimeMs: executableBinding.modifiedTimeMs }),
      architecture,
      bundleIdentifier: identity.bundleIdentifier,
      teamIdentifier: identity.teamIdentifier,
      ...(expected.requiredScheme ? { requiredScheme: expected.requiredScheme } : {}),
    };
  }
  if (platform === 'win32') {
    const identity = probe.windowsExecutableIdentity?.(executable);
    const binding = launchFileBinding(executable, probe, platform);
    if (!identity
      || !binding
      || !windowsApplicationIdentityValueMatches(surface, identity, architecture)) return null;
    return {
      kind: 'windows-executable',
      ...binding,
      architecture: identity.architecture,
      productName: identity.productName,
      ...(identity.companyName ? { companyName: identity.companyName } : {}),
      publisher: identity.publisher,
    };
  }
  if (platform !== 'linux') return null;
  const identity = probe.linuxPackageIdentity?.(executable);
  const binding = launchFileBinding(executable, probe, platform);
  if (!identity
    || !binding
    || !identity.catalogArtifactSha256
    || identity.executableSha256 !== binding.sha256
    || surface.id !== 'copilot-desktop'
    || !linuxPackageIdentityMatches(executable, 'github', architecture, probe)) return null;
  return {
    kind: 'linux-package',
    ...binding,
    architecture: identity.architecture,
    packageName: identity.packageName,
    version: identity.version,
    manager: identity.manager,
    origin: identity.origin,
    catalogArtifactSha256: identity.catalogArtifactSha256,
  };
}

function hasExpectedApplicationIdentity(
  surface: AiSurfaceDefinition,
  executable: string,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
  probe: SurfaceProbe,
): boolean {
  return applicationLaunchVerification(surface, executable, platform, architecture, probe) !== null;
}

interface SurfaceTarget {
  executable: string;
  launchArgsPrefix: string[];
  launchEnvironment: Record<string, string>;
  capabilities?: AiSurfaceCapability[];
  deepLinkScheme?: 'claude' | 'ghapp';
  verification?: LaunchArtifactVerification;
}

function sameCatalogPath(
  left: string,
  right: string,
  platform: 'win32' | 'linux',
): boolean {
  return platform === 'win32'
    ? win32Path.normalize(left).toLowerCase() === win32Path.normalize(right).toLowerCase()
    : resolve(left) === resolve(right);
}

function catalogFileMatches(
  path: string,
  expected: VsCodeCatalogFile,
  platform: 'win32' | 'linux',
  probe: SurfaceProbe,
): boolean {
  const realPath = probe.realPath?.(path);
  const status = realPath ? probe.fileStatus?.(realPath) : null;
  return Boolean(realPath
    && sameCatalogPath(realPath, path, platform)
    && status?.isFile
    && !status.isSymbolicLink
    && status.size === expected.size
    && probe.fileSha256?.(realPath)?.toLowerCase() === expected.sha256);
}

function catalogFileBinding(
  path: string,
  expected: VsCodeCatalogFile,
  platform: 'win32' | 'linux',
  probe: SurfaceProbe,
): LaunchFileBinding | null {
  if (!catalogFileMatches(path, expected, platform, probe)) return null;
  const realPath = probe.realPath?.(path);
  const status = realPath ? probe.fileStatus?.(realPath) : null;
  if (!realPath || !status) return null;
  return {
    realPath,
    size: status.size,
    sha256: expected.sha256,
    ...(status.device === undefined ? {} : { device: status.device }),
    ...(status.inode === undefined ? {} : { inode: status.inode }),
    ...(status.modifiedTimeMs === undefined ? {} : { modifiedTimeMs: status.modifiedTimeMs }),
  };
}

function vscodeCatalogMetadataMatches(
  resourceRoot: string,
  expected: VsCodeCatalogEntry,
  platform: 'win32' | 'linux',
  probe: SurfaceProbe,
): boolean {
  const pathFor = (...segments: string[]) => platform === 'win32'
    ? win32Path.join(resourceRoot, ...segments)
    : join(resourceRoot, ...segments);
  const packagePath = pathFor('package.json');
  const productPath = pathFor('product.json');
  const copilotPath = pathFor('extensions', 'copilot', 'package.json');
  const cliPath = pathFor('out', 'cli.js');
  if (!catalogFileMatches(packagePath, expected.packageJson, platform, probe)
    || !catalogFileMatches(productPath, expected.productJson, platform, probe)
    || !catalogFileMatches(copilotPath, expected.copilotPackageJson, platform, probe)
    || !catalogFileMatches(cliPath, expected.cliJs, platform, probe)) return false;
  try {
    const packageMetadata = JSON.parse(probe.fileContent?.(packagePath) ?? '') as Record<string, unknown>;
    const productMetadata = JSON.parse(probe.fileContent?.(productPath) ?? '') as Record<string, unknown>;
    const copilotMetadata = JSON.parse(probe.fileContent?.(copilotPath) ?? '') as Record<string, unknown>;
    const engines = copilotMetadata.engines as Record<string, unknown> | undefined;
    return packageMetadata.name === 'Code'
      && packageMetadata.version === VSCODE_CATALOG_VERSION
      && packageMetadata.main === './out/main.js'
      && productMetadata.nameLong === 'Visual Studio Code'
      && productMetadata.applicationName === 'code'
      && productMetadata.commit === VSCODE_CATALOG_COMMIT
      && productMetadata.quality === 'stable'
      && copilotMetadata.publisher === 'GitHub'
      && copilotMetadata.name === 'copilot-chat'
      && copilotMetadata.version === '0.64.1'
      && engines?.vscode === `^${VSCODE_CATALOG_VERSION}`;
  } catch {
    return false;
  }
}

function vscodeCatalogTreeMatches(
  applicationRoot: string,
  expected: Omit<DirectoryTreeIdentity, 'realPath'>,
  platform: 'win32' | 'linux',
  probe: SurfaceProbe,
): DirectoryTreeIdentity | null {
  const identity = probe.directoryTreeIdentity?.(applicationRoot);
  return identity
    && sameCatalogPath(identity.realPath, applicationRoot, platform)
    && identity.fileCount === expected.fileCount
    && identity.totalBytes === expected.totalBytes
    && identity.sha256 === expected.sha256
    ? identity
    : null;
}

function exactStringRecord(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => (
      key === expectedKeys[index] && actual[key] === expected[key]
    ));
}

function windowsDirectoryHasExactEntries(
  directory: string,
  expectedEntries: readonly string[],
  probe: SurfaceProbe,
): boolean {
  const entries = probe.directoryEntries?.(directory);
  if (!entries || new Set(entries.map((entry) => entry.toLowerCase())).size !== entries.length) return false;
  const actual = [...entries].map((entry) => entry.toLowerCase()).sort();
  const expected = expectedEntries.map((entry) => entry.toLowerCase()).sort();
  return actual.length === expected.length
    && actual.every((entry, index) => entry === expected[index]);
}

function windowsVsCodeInstallationRootMatches(
  installationRoot: string,
  probe: SurfaceProbe,
): boolean {
  if (!windowsDirectoryHasExactEntries(
    installationRoot,
    WINDOWS_VSCODE_INSTALLATION_ENTRIES,
    probe,
  ) || !windowsDirectoryHasExactEntries(
    win32Path.join(installationRoot, 'bin'),
    WINDOWS_VSCODE_BIN_ENTRIES,
    probe,
  )) return false;
  return WINDOWS_VSCODE_UNINSTALLER_FILES.every((file) => {
    const path = win32Path.join(installationRoot, file);
    const realPath = probe.realPath?.(path);
    const status = realPath ? probe.fileStatus?.(realPath) : null;
    return Boolean(realPath
      && sameCatalogPath(realPath, path, 'win32')
      && status?.isFile
      && !status.isSymbolicLink);
  });
}

function catalogTreeShapeMatches(
  actual: DirectoryTreeIdentity | undefined,
  realPath: string,
  expected: Omit<DirectoryTreeIdentity, 'realPath'> | undefined,
  platform: 'win32' | 'linux',
): boolean {
  return Boolean(actual
    && expected
    && sameCatalogPath(actual.realPath, realPath, platform)
    && actual.fileCount === expected.fileCount
    && actual.totalBytes === expected.totalBytes
    && actual.sha256 === expected.sha256);
}

function vscodeCatalogVerificationShapeMatches(
  surface: DetectedAiSurface,
  platform: NodeJS.Platform,
): boolean {
  const verification = surface.verification;
  if (surface.id !== 'vscode-copilot'
    || (platform !== 'win32' && platform !== 'linux')
    || verification?.kind !== 'vscode-catalog'
    || verification.platform !== platform
    || surface.executable === null
    || !sameCatalogPath(surface.executable, verification.realPath, platform)
    || !equalStringArrays(surface.launchArgsPrefix, [verification.cliPath])
    || !exactStringRecord(surface.launchEnvironment, VSCODE_CATALOG_LAUNCH_ENVIRONMENT)
    || verification.version !== VSCODE_CATALOG_VERSION
    || verification.commit !== VSCODE_CATALOG_COMMIT) return false;
  const expected = vsCodeCatalog(platform, verification.architecture);
  if (!expected
    || verification.catalogArtifactSha256 !== expected.artifactSha256
    || verification.size !== expected.executable.size
    || verification.sha256 !== expected.executable.sha256) return false;

  if (platform === 'win32') {
    const installationRoot = win32Path.dirname(verification.realPath);
    const applicationRoot = win32Path.join(installationRoot, VSCODE_CATALOG_COMMIT_DIRECTORY);
    const resourceRoot = win32Path.join(applicationRoot, 'resources', 'app');
    const auxiliaryRoot = win32Path.join(installationRoot, 'bin');
    const visualManifestPath = win32Path.join(installationRoot, 'Code.VisualElementsManifest.xml');
    return win32Path.basename(verification.realPath).toLowerCase() === 'code.exe'
      && sameCatalogPath(verification.installationRoot, installationRoot, 'win32')
      && sameCatalogPath(verification.cliPath, win32Path.join(resourceRoot, 'out', 'cli.js'), 'win32')
      && catalogTreeShapeMatches(
        verification.applicationTree,
        applicationRoot,
        expected.applicationTree,
        'win32',
      )
      && catalogTreeShapeMatches(
        verification.auxiliaryTree,
        auxiliaryRoot,
        expected.auxiliaryTree,
        'win32',
      )
      && Boolean(expected.visualManifest
        && verification.visualManifest
        && sameCatalogPath(verification.visualManifest.realPath, visualManifestPath, 'win32')
        && verification.visualManifest.size === expected.visualManifest.size
        && verification.visualManifest.sha256 === expected.visualManifest.sha256);
  }

  return sameCatalogPath(verification.realPath, '/usr/share/code/code', 'linux')
    && sameCatalogPath(verification.installationRoot, '/usr/share/code', 'linux')
    && sameCatalogPath(verification.cliPath, '/usr/share/code/resources/app/out/cli.js', 'linux')
    && catalogTreeShapeMatches(
      verification.applicationTree,
      '/usr/share/code',
      expected.applicationTree,
      'linux',
    )
    && verification.auxiliaryTree === undefined
    && verification.visualManifest === undefined;
}

function windowsVsCodeTarget(
  surface: AiSurfaceDefinition,
  architecture: NodeJS.Architecture,
  home: string,
  environment: NodeJS.ProcessEnv,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  const expected = vsCodeCatalog('win32', architecture);
  if (!expected || (architecture !== 'x64' && architecture !== 'arm64')) return null;
  for (const candidate of candidateApplicationPaths(surface, 'win32', home, environment)) {
    if (win32Path.basename(candidate).toLowerCase() !== 'code.exe'
      || !probe.fileExists(candidate)) continue;
    const candidateInstallationRoot = win32Path.dirname(candidate);
    if (!probe.windowsVsCodeInstallationAcl?.(candidateInstallationRoot)) continue;
    const binding = launchFileBinding(candidate, probe, 'win32');
    const identity = probe.windowsExecutableIdentity?.(candidate);
    if (!binding
      || !sameCatalogPath(binding.realPath, candidate, 'win32')
      || binding.size !== expected.executable.size
      || binding.sha256 !== expected.executable.sha256
      || !identity
      || !windowsApplicationIdentityValueMatches(surface, identity, architecture)) continue;
    const installationRoot = win32Path.dirname(binding.realPath);
    const applicationRoot = win32Path.join(installationRoot, VSCODE_CATALOG_COMMIT_DIRECTORY);
    const resourceRoot = win32Path.join(applicationRoot, 'resources', 'app');
    const auxiliaryRoot = win32Path.join(installationRoot, 'bin');
    const visualManifestPath = win32Path.join(installationRoot, 'Code.VisualElementsManifest.xml');
    const applicationTree = vscodeCatalogTreeMatches(
      applicationRoot,
      expected.applicationTree,
      'win32',
      probe,
    );
    const auxiliaryTree = expected.auxiliaryTree
      ? vscodeCatalogTreeMatches(auxiliaryRoot, expected.auxiliaryTree, 'win32', probe)
      : null;
    const visualManifest = expected.visualManifest
      ? catalogFileBinding(visualManifestPath, expected.visualManifest, 'win32', probe)
      : null;
    if (!applicationTree
      || !auxiliaryTree
      || !visualManifest
      || !windowsVsCodeInstallationRootMatches(installationRoot, probe)
      || !vscodeCatalogMetadataMatches(resourceRoot, expected, 'win32', probe)) continue;
    const cliPath = win32Path.join(resourceRoot, 'out', 'cli.js');
    return {
      executable: binding.realPath,
      launchArgsPrefix: [cliPath],
      launchEnvironment: { ...VSCODE_CATALOG_LAUNCH_ENVIRONMENT },
      capabilities: ['initial-prompt'],
      verification: {
        kind: 'vscode-catalog',
        ...binding,
        platform: 'win32',
        architecture,
        version: VSCODE_CATALOG_VERSION,
        commit: VSCODE_CATALOG_COMMIT,
        installationRoot,
        cliPath,
        catalogArtifactSha256: expected.artifactSha256,
        applicationTree,
        auxiliaryTree,
        visualManifest,
      },
    };
  }
  return null;
}

function vscodeHasCopilotMetadata(
  _home: string,
  _platform: NodeJS.Platform,
  probe: SurfaceProbe,
  builtInCandidates: readonly string[],
): boolean {
  // Only metadata inside the already authenticated application/package may be
  // used. User-writable extension manifests are not publisher authentication.
  return builtInCandidates.some((candidate) => probe.fileExists(candidate));
}

function macVsCodeTarget(
  surface: AiSurfaceDefinition,
  architecture: NodeJS.Architecture,
  home: string,
  environment: NodeJS.ProcessEnv,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  for (const application of candidateApplicationPaths(surface, 'darwin', home, environment)) {
    if (!probe.fileExists(application)) continue;
    const verification = applicationLaunchVerification(
      surface,
      application,
      'darwin',
      architecture,
      probe,
    );
    if (!verification || verification.kind !== 'mac-application') continue;
    const realApplication = probe.realPath?.(application);
    if (!realApplication) continue;
    const command = join(realApplication, 'Contents', 'Resources', 'app', 'bin', 'code');
    const realCommand = resolvedRegularExecutable(command, 'darwin', probe);
    const commandBinding = realCommand ? launchFileBinding(realCommand, probe, 'darwin') : null;
    if (!realCommand
      || !commandBinding
      || !realCommand.startsWith(`${realApplication}/Contents/Resources/app/bin/`)) continue;
    const builtInCopilot = join(realApplication, 'Contents', 'Resources', 'app', 'extensions', 'copilot');
    if (!vscodeHasCopilotMetadata(home, 'darwin', probe, [builtInCopilot])) continue;
    return {
      executable: realCommand,
      launchArgsPrefix: [],
      launchEnvironment: {},
      verification: {
        ...verification,
        commandRealPath: commandBinding.realPath,
        commandSize: commandBinding.size,
        commandSha256: commandBinding.sha256,
        ...(commandBinding.device === undefined ? {} : { commandDevice: commandBinding.device }),
        ...(commandBinding.inode === undefined ? {} : { commandInode: commandBinding.inode }),
        ...(commandBinding.modifiedTimeMs === undefined
          ? {}
          : { commandModifiedTimeMs: commandBinding.modifiedTimeMs }),
      },
    };
  }
  return null;
}

function linuxVsCodeTarget(
  surface: AiSurfaceDefinition,
  architecture: NodeJS.Architecture,
  _home: string,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  const expected = vsCodeCatalog('linux', architecture);
  const executable = '/usr/share/code/code';
  if (!expected
    || (architecture !== 'x64' && architecture !== 'arm64')
    || !probe.fileExists(executable)) return null;
  const binding = launchFileBinding(executable, probe, 'linux');
  const header = probe.fileHeader?.(executable, 64);
  if (!binding
    || binding.size !== expected.executable.size
    || binding.sha256 !== expected.executable.sha256
    || !header
    || !validElfHeader(header, architecture)
    || !linuxPackageIdentityMatches(executable, 'code', architecture, probe)) return null;
  const installationRoot = '/usr/share/code';
  const resourceRoot = join(installationRoot, 'resources', 'app');
  const applicationTree = vscodeCatalogTreeMatches(
    installationRoot,
    expected.applicationTree,
    'linux',
    probe,
  );
  if (!applicationTree
    || !vscodeCatalogMetadataMatches(resourceRoot, expected, 'linux', probe)) return null;
  const cliPath = join(resourceRoot, 'out', 'cli.js');
  return {
    executable: binding.realPath,
    launchArgsPrefix: [cliPath],
    launchEnvironment: { ...VSCODE_CATALOG_LAUNCH_ENVIRONMENT },
    capabilities: ['initial-prompt'],
    verification: {
      kind: 'vscode-catalog',
      ...binding,
      platform: 'linux',
      architecture,
      version: VSCODE_CATALOG_VERSION,
      commit: VSCODE_CATALOG_COMMIT,
      installationRoot,
      cliPath,
      catalogArtifactSha256: expected.artifactSha256,
      applicationTree,
    },
  };
}

type DesktopEntry = ReadonlyMap<string, string>;

function parseDesktopEntry(content: string): DesktopEntry | null {
  const values = new Map<string, string>();
  let inDesktopEntry = false;
  for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      inDesktopEntry = line === '[Desktop Entry]';
      continue;
    }
    if (!inDesktopEntry) continue;
    const separator = rawLine.indexOf('=');
    if (separator <= 0) return null;
    const key = rawLine.slice(0, separator).trim();
    // Locale-qualified keys (for example `Name[en_AU]`) are valid desktop-entry
    // metadata. Keep them separate from the unqualified values used for launch
    // validation, while still rejecting duplicate or malformed keys.
    if (!/^[A-Za-z][A-Za-z0-9-]*(?:\[[A-Za-z0-9_.@-]+\])?$/.test(key) || values.has(key)) return null;
    values.set(key, rawLine.slice(separator + 1).trim());
  }
  return values.size > 0 ? values : null;
}

function decodeDesktopValue(value: string): string | null {
  let decoded = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\') {
      decoded += character;
      continue;
    }
    const escaped = value[index + 1];
    if (escaped === undefined) return null;
    const replacement: Readonly<Record<string, string>> = {
      s: ' ',
      n: '\n',
      t: '\t',
      r: '\r',
      '\\': '\\',
    };
    if (!(escaped in replacement)) return null;
    decoded += replacement[escaped];
    index += 1;
  }
  return decoded;
}

function parseDesktopExec(value: string): string[] | null {
  if (!value || /[\0\r\n]/.test(value)) return null;
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  const flush = () => {
    if (current) tokens.push(current);
    current = '';
  };

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (/\s/.test(character) && !quoted) {
      flush();
      continue;
    }
    current += character;
  }
  if (escaped || quoted) return null;
  flush();
  if (tokens.length === 0) return null;

  const result: string[] = [];
  for (const token of tokens) {
    if (/^%[fFuUdDnNickvm]$/.test(token)) continue;
    const literal = token.replace(/%%/g, '%');
    if (/%[A-Za-z%]/.test(literal)) return null;
    result.push(literal);
  }
  return result.length > 0 ? result : null;
}

function linuxApplicationDirectories(home: string, environment: NodeJS.ProcessEnv): string[] {
  const dataHome = environment.XDG_DATA_HOME && environment.XDG_DATA_HOME.startsWith('/')
    ? environment.XDG_DATA_HOME
    : join(home, '.local', 'share');
  const dataDirectories = (environment.XDG_DATA_DIRS ?? '/usr/local/share:/usr/share')
    .split(':')
    .filter((candidate) => candidate.startsWith('/'));
  return [...new Set([dataHome, ...dataDirectories].map((directory) => join(directory, 'applications')))];
}

function desktopEntryPath(
  desktopId: string,
  home: string,
  environment: NodeJS.ProcessEnv,
  probe: SurfaceProbe,
): string | null {
  if (!validDesktopFileName(desktopId)) return null;
  for (const directory of linuxApplicationDirectories(home, environment)) {
    const candidate = join(directory, desktopId);
    if (probe.fileExists(candidate) && probe.fileContent?.(candidate)) return candidate;
  }
  return null;
}

function validDesktopFileName(fileName: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.desktop$/.test(fileName)
    || fileName === 'GitHub Copilot.desktop';
}

function desktopEntryHasScheme(entry: DesktopEntry, scheme: 'claude' | 'ghapp'): boolean {
  const mimeTypes = entry.get('MimeType')?.split(';').filter(Boolean) ?? [];
  return mimeTypes.includes(`x-scheme-handler/${scheme}`);
}

function regularExecutable(path: string, probe: SurfaceProbe): boolean {
  const status = probe.fileStatus?.(path);
  return Boolean(status?.isFile && status.executable && (status.mode & 0o022) === 0);
}

function expectedElfMachine(architecture: NodeJS.Architecture): number | null {
  if (architecture === 'x64') return 62;
  if (architecture === 'arm64') return 183;
  return null;
}

function validElfHeader(header: Uint8Array, architecture: NodeJS.Architecture): boolean {
  const machine = expectedElfMachine(architecture);
  return machine !== null
    && header.length >= 20
    && header[0] === 0x7f
    && header[1] === 0x45
    && header[2] === 0x4c
    && header[3] === 0x46
    && header[4] === 2
    && header[5] === 1
    && (header[18] | (header[19] << 8)) === machine;
}

function validAppImageHeader(header: Uint8Array, architecture: NodeJS.Architecture): boolean {
  const appImageType = header[10];
  return validElfHeader(header, architecture)
    && header[8] === 0x41
    && header[9] === 0x49
    && (appImageType === 1 || appImageType === 2)
    ;
}

// The current Antigravity 2 Linux distribution is an unsigned tar archive.
// Bind the extracted executable to the immutable official archive payload;
// legacy apt 1.x packages are intentionally not accepted as Antigravity 2.
const VERIFIED_ANTIGRAVITY_LINUX_EXECUTABLES: Readonly<Partial<Record<NodeJS.Architecture, {
  version: string;
  size: number;
  sha256: string;
}>>> = {
  arm64: {
    version: '2.12.2',
    size: 197_528_864,
    sha256: 'e706505fdd89003390c256b084ee44625e4ab0aacd068b8f62290af8b0a6f6ed',
  },
  x64: {
    version: '2.12.2',
    size: 206_036_184,
    sha256: 'b0d127772d2983a93771055a93b673d5fdd1726d6e47db8e269b204e665972d6',
  },
};

function verifiedLinuxAntigravityTarget(
  surface: AiSurfaceDefinition,
  architecture: NodeJS.Architecture,
  home: string,
  environment: NodeJS.ProcessEnv,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  const expected = VERIFIED_ANTIGRAVITY_LINUX_EXECUTABLES[architecture];
  if (!expected) return null;
  for (const candidate of candidateApplicationPaths(surface, 'linux', home, environment)) {
    if (!probe.fileExists(candidate)) continue;
    const realPath = probe.realPath?.(candidate);
    const status = realPath ? probe.fileStatus?.(realPath) : null;
    const header = realPath ? probe.fileHeader?.(realPath, 64) : null;
    const sha256 = realPath ? probe.fileSha256?.(realPath)?.toLowerCase() : null;
    if (!realPath
      || !status?.isFile
      || !status.executable
      || (status.mode & 0o022) !== 0
      || status.size !== expected.size
      || !header
      || !validElfHeader(header, architecture)
      || sha256 !== expected.sha256) continue;
    return {
      executable: realPath,
      launchArgsPrefix: [],
      launchEnvironment: {},
      verification: {
        kind: 'portable-elf',
        realPath,
        size: status.size,
        sha256,
        architecture,
      },
    };
  }
  return null;
}

// The vendor's current AppImages have empty AppImage signature sections, so
// verify the complete assets against independently recorded SHA-256 digests.
// Source: the xAI-linked Cursor updater's stable `sand` channel, 2026-09-06.
const VERIFIED_GROK_BOT_APPIMAGES: Readonly<Record<string, Partial<Record<NodeJS.Architecture, {
  size: number;
  sha256: string;
}>>>> = {
  '0.43.0': {
    arm64: {
      size: 132_756_388,
      sha256: '798757a576dd4a2f3953344af45197dd4dcf1fba792da850f20733a033ea4236',
    },
    x64: {
      size: 132_012_959,
      sha256: 'd810e4e1f49da15bc178f54cfc5840c780fb8efe1341d4220898fc4f244ba75b',
    },
  },
};

const VERIFIED_COPILOT_APPIMAGES: Readonly<Record<string, Partial<Record<NodeJS.Architecture, {
  size: number;
  sha256: string;
}>>>> = {
  '1.1.15': {
    arm64: {
      size: 485_141_000,
      sha256: '0d02335a7accea8e2f2faf0a6ab76f2ed9f0ed217793f900ed36ae110342f33a',
    },
    x64: {
      size: 535_726_584,
      sha256: '2f41db0a46b3c1d75d307bb47109440f4aa5faaf7f1b95df9f679ccbc35e2809',
    },
  },
};

function verifiedAppImage(
  executable: string,
  entry: DesktopEntry,
  architecture: NodeJS.Architecture,
  expectedName: string,
  catalog: Readonly<Record<string, Partial<Record<NodeJS.Architecture, {
    size: number;
    sha256: string;
  }>>>>,
  probe: SurfaceProbe,
): { realPath: string; size: number; sha256: string } | null {
  const realExecutable = probe.realPath?.(executable);
  if (!realExecutable?.startsWith('/') || !/\.AppImage$/i.test(realExecutable)) return null;
  if (!regularExecutable(realExecutable, probe)) return null;
  const header = probe.fileHeader?.(realExecutable, 64);
  if (!header || !validAppImageHeader(header, architecture)) return null;

  const name = decodeDesktopValue(entry.get('Name') ?? '');
  const version = entry.get('X-AppImage-Version');
  if (name !== expectedName
    || entry.get('Type') !== 'Application'
    || entry.get('Terminal') === 'true'
    || (version !== undefined && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))) {
    return null;
  }

  const status = probe.fileStatus?.(realExecutable);
  if (!status) return null;
  const release = Object.entries(catalog)
    .map(([releaseVersion, architectures]) => ({ releaseVersion, asset: architectures[architecture] }))
    .find((candidate) => candidate.asset?.size === status.size);
  if (!release?.asset || (version !== undefined && version !== release.releaseVersion)) return null;
  const actualDigest = probe.fileSha256?.(realExecutable)?.toLowerCase();
  if (actualDigest !== release.asset.sha256) return null;

  const declaredDigest = entry.get('X-AppImage-SHA256');
  if (declaredDigest !== undefined) {
    if (!/^[0-9a-f]{64}$/i.test(declaredDigest)) return null;
    if (actualDigest !== declaredDigest.toLowerCase()) return null;
  }
  return { realPath: realExecutable, size: status.size, sha256: actualDigest };
}

function verifiedGrokBotAppImage(
  executable: string,
  entry: DesktopEntry,
  architecture: NodeJS.Architecture,
  probe: SurfaceProbe,
): string | null {
  return verifiedAppImage(
    executable,
    entry,
    architecture,
    'Grok Bot',
    VERIFIED_GROK_BOT_APPIMAGES,
    probe,
  )?.realPath ?? null;
}

function registeredLinuxCopilotAppImageTarget(
  home: string,
  environment: NodeJS.ProcessEnv,
  architecture: NodeJS.Architecture,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  for (const directory of linuxApplicationDirectories(home, environment)) {
    for (const fileName of probe.directoryEntries?.(directory) ?? []) {
      if (!validDesktopFileName(fileName)) continue;
      const entry = parseDesktopEntry(probe.fileContent?.(join(directory, fileName)) ?? '');
      if (!entry || !desktopEntryHasScheme(entry, 'ghapp')) continue;
      const invocation = parseDesktopExec(entry.get('Exec') ?? '');
      if (!invocation || invocation.length !== 1 || !invocation[0].startsWith('/')) continue;
      const verified = verifiedAppImage(
        invocation[0],
        entry,
        architecture,
        'GitHub Copilot',
        VERIFIED_COPILOT_APPIMAGES,
        probe,
      );
      if (!verified) continue;
      return {
        executable: verified.realPath,
        launchArgsPrefix: [],
        launchEnvironment: {},
        deepLinkScheme: 'ghapp',
        verification: {
          kind: 'copilot-appimage',
          realPath: verified.realPath,
          size: verified.size,
          sha256: verified.sha256,
          architecture,
        },
      };
    }
  }
  return null;
}

function registeredLinuxGrokBotAppImageTarget(
  home: string,
  environment: NodeJS.ProcessEnv,
  architecture: NodeJS.Architecture,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  for (const directory of linuxApplicationDirectories(home, environment)) {
    for (const fileName of probe.directoryEntries?.(directory) ?? []) {
      if (!validDesktopFileName(fileName)) continue;
      const path = join(directory, fileName);
      const entry = parseDesktopEntry(probe.fileContent?.(path) ?? '');
      if (!entry) continue;
      const invocation = parseDesktopExec(entry.get('Exec') ?? '');
      if (!invocation || !invocation[0].startsWith('/')) continue;
      const launchArgsPrefix = invocation.slice(1);
      if (launchArgsPrefix.length > 1
        || (launchArgsPrefix.length === 1 && launchArgsPrefix[0] !== '--ozone-platform-hint=auto')) {
        continue;
      }
      const executable = verifiedGrokBotAppImage(invocation[0], entry, architecture, probe);
      if (!executable) continue;
      const status = probe.fileStatus?.(executable);
      const sha256 = probe.fileSha256?.(executable)?.toLowerCase();
      if (!status || !sha256) continue;
      return {
        executable,
        launchArgsPrefix,
        launchEnvironment: {},
        verification: {
          kind: 'grok-appimage',
          realPath: executable,
          size: status.size,
          sha256,
          architecture,
        },
      };
    }
  }
  return null;
}

function registeredUrlSchemeTarget(
  surface: AiSurfaceDefinition,
  scheme: 'claude' | 'ghapp',
  platform: NodeJS.Platform,
  home: string,
  environment: NodeJS.ProcessEnv,
  architecture: NodeJS.Architecture,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  if (platform === 'darwin') {
    const application = candidateApplicationPaths(surface, platform, home, environment).find((candidate) =>
      probe.fileExists(candidate)
      && hasExpectedApplicationIdentity(surface, candidate, platform, architecture, probe));
    const executable = application ? probe.realPath?.(application) : null;
    const verification = application
      ? applicationLaunchVerification(surface, application, platform, architecture, probe)
      : null;
    return executable && verification
      ? { executable, launchArgsPrefix: [], launchEnvironment: {}, deepLinkScheme: scheme, verification }
      : null;
  }
  if (platform === 'win32') {
    const executable = probe.windowsUrlHandlerExecutable?.(scheme);
    if (!executable || !probe.fileExists(executable)) return null;
    if (!windowsApplicationIdentityMatches(surface, executable, architecture, probe)) return null;
    const realExecutable = probe.realPath?.(executable);
    const verification = applicationLaunchVerification(surface, executable, platform, architecture, probe);
    return realExecutable && verification
      ? { executable: realExecutable, launchArgsPrefix: [], launchEnvironment: {}, deepLinkScheme: scheme, verification }
      : null;
  }
  if (platform === 'linux') {
    const desktopId = probe.linuxUrlSchemeDesktopId?.(scheme) ?? '';
    const path = desktopEntryPath(desktopId, home, environment, probe);
    const entry = path ? parseDesktopEntry(probe.fileContent?.(path) ?? '') : null;
    if (!entry || entry.get('Type') !== 'Application' || !desktopEntryHasScheme(entry, scheme)) return null;
    const invocation = parseDesktopExec(entry.get('Exec') ?? '');
    if (!invocation || invocation.length !== 1) return null;
    const resolvedExecutable = invocation[0].startsWith('/')
      ? invocation[0]
      : probe.commandPath(invocation[0]);
    if (!resolvedExecutable || !probe.fileExists(resolvedExecutable)) return null;
    const expectedExecutable = surface.id === 'claude-desktop' ? '/usr/bin/claude-desktop' : '/usr/bin/github';
    if (resolvedExecutable !== expectedExecutable) return null;
    if (!hasExpectedApplicationIdentity(surface, resolvedExecutable, platform, architecture, probe)) return null;
    const realExecutable = probe.realPath?.(resolvedExecutable);
    const verification = applicationLaunchVerification(
      surface,
      resolvedExecutable,
      platform,
      architecture,
      probe,
    );
    return realExecutable && verification
      ? { executable: realExecutable, launchArgsPrefix: [], launchEnvironment: {}, deepLinkScheme: scheme, verification }
      : null;
  }
  return null;
}

const EXPECTED_WINDOWS_APPX_IDENTITIES: Readonly<Partial<Record<AiSurfaceId, {
  packageName: string;
  publisher?: string;
  publisherId: string;
  familyName: string;
  applicationId: string;
  signatureKinds: readonly WindowsAppxIdentity['signatureKind'][];
}>>> = {
  'claude-desktop': {
    packageName: 'Claude',
    publisher: 'CN="Anthropic, PBC", O="Anthropic, PBC", L=San Francisco, S=California, C=US, SERIALNUMBER=4860621, OID.2.5.4.15=Private Organization, OID.1.3.6.1.4.1.311.60.2.1.2=Delaware, OID.1.3.6.1.4.1.311.60.2.1.3=US',
    publisherId: 'pzs8sxrjxfjjc',
    familyName: 'Claude_pzs8sxrjxfjjc',
    applicationId: 'Claude',
    signatureKinds: ['Developer'],
  },
  'codex-desktop': {
    packageName: 'OpenAI.Codex',
    publisher: 'CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B',
    publisherId: '2p2nqsd0c76g0',
    familyName: 'OpenAI.Codex_2p2nqsd0c76g0',
    applicationId: 'App',
    signatureKinds: ['Store'],
  },
};

function windowsAppxTarget(
  surface: AiSurfaceDefinition,
  architecture: NodeJS.Architecture,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  const expected = EXPECTED_WINDOWS_APPX_IDENTITIES[surface.id];
  if (!expected || (architecture !== 'x64' && architecture !== 'arm64')) return null;
  for (const packageName of surface.windowsAppxPackageNames ?? []) {
    const identity = probe.windowsAppxIdentity?.(packageName);
    if (!identity
      || identity.packageName !== expected.packageName
      || !identity.publisher.trim()
      || (expected.publisher !== undefined && identity.publisher !== expected.publisher)
      || identity.publisherId !== expected.publisherId
      || identity.familyName !== expected.familyName
      || !identity.applicationIds.includes(expected.applicationId)
      || identity.architecture !== architecture
      || !expected.signatureKinds.includes(identity.signatureKind)
      || identity.status !== 'Ok') continue;
    return {
      executable: `shell:AppsFolder\\${identity.familyName}!${expected.applicationId}`,
      launchArgsPrefix: [],
      launchEnvironment: {},
      verification: {
        kind: 'windows-appx',
        packageName: identity.packageName,
        publisher: identity.publisher,
        publisherId: identity.publisherId,
        familyName: identity.familyName,
        applicationId: expected.applicationId,
        architecture: identity.architecture,
        signatureKind: identity.signatureKind,
      },
    };
  }
  return null;
}

function findSurfaceTarget(
  surface: AiSurfaceDefinition,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
  home: string,
  environment: NodeJS.ProcessEnv,
  probe: SurfaceProbe,
): SurfaceTarget | null {
  if (surface.id === 'vscode-copilot') {
    if (platform === 'darwin') return macVsCodeTarget(surface, architecture, home, environment, probe);
    if (platform === 'win32') return windowsVsCodeTarget(surface, architecture, home, environment, probe);
    if (platform === 'linux') return linuxVsCodeTarget(surface, architecture, home, probe);
    return null;
  }
  if (platform === 'linux' && surface.id === 'antigravity-desktop') {
    return verifiedLinuxAntigravityTarget(surface, architecture, home, environment, probe);
  }
  if (platform === 'linux' && surface.id === 'copilot-desktop') {
    const appImage = registeredLinuxCopilotAppImageTarget(home, environment, architecture, probe);
    if (appImage) return appImage;
  }
  if (platform === 'linux' && surface.id === 'grok-bot') {
    const appImage = registeredLinuxGrokBotAppImageTarget(home, environment, architecture, probe);
    if (appImage) return appImage;
  }
  if (surface.kind === 'cli') {
    return authenticatedCliTarget(surface, platform, architecture, home, environment, probe);
  }

  let applicationTarget: SurfaceTarget | null = null;
  for (const application of candidateApplicationPaths(surface, platform, home, environment)) {
    if (!probe.fileExists(application)) continue;
    const verification = applicationLaunchVerification(
      surface,
      application,
      platform,
      architecture,
      probe,
    );
    const realApplication = verification ? probe.realPath?.(application) : null;
    if (!verification || !realApplication) continue;
    applicationTarget = {
      executable: realApplication,
      launchArgsPrefix: [],
      launchEnvironment: {},
      verification,
    };
    break;
  }
  const appx = platform === 'win32' ? windowsAppxTarget(surface, architecture, probe) : null;
  if (surface.id === 'claude-desktop') {
    const handler = registeredUrlSchemeTarget(
      surface,
      'claude',
      platform,
      home,
      environment,
      architecture,
      probe,
    );
    if (handler) return handler;
  }
  if (surface.id === 'copilot-desktop') {
    const handler = registeredUrlSchemeTarget(
      surface,
      'ghapp',
      platform,
      home,
      environment,
      architecture,
      probe,
    );
    if (handler) return handler;
  }
  if (appx) return appx;
  return applicationTarget;
}

function resolvedLaunchSupport(
  surface: AiSurfaceDefinition,
  target: SurfaceTarget | null,
  targets: ReadonlyMap<AiSurfaceId, SurfaceTarget | null>,
  platform: NodeJS.Platform,
): LaunchSupport {
  if (!target) return surface.launchSupport;
  if (surface.id === 'vscode-copilot') {
    return target.capabilities?.includes('initial-prompt') ? 'project-and-prompt' : 'project-only';
  }
  if (surface.id === 'claude-desktop') {
    return target.deepLinkScheme === 'claude' ? 'project-and-prompt' : 'manual-project';
  }
  if (surface.id === 'copilot-cli'
    || surface.id === 'antigravity-cli'
    || surface.id === 'claude-cli'
    || surface.id === 'codex-cli'
    || surface.id === 'grok-cli') {
    return target.capabilities?.includes('initial-prompt') ? 'project-and-prompt' : 'project-only';
  }
  if (surface.id === 'copilot-desktop') {
    return targets.get('copilot-cli')?.capabilities?.includes('desktop-project-launch')
      ? 'project-only'
      : 'manual-project';
  }
  if (surface.id === 'codex-desktop') {
    return platform === 'darwin'
      && targets.get('codex-cli')?.capabilities?.includes('desktop-project-launch')
      ? 'project-only'
      : 'manual-project';
  }
  return surface.launchSupport;
}

export async function detectAiSurfaces(options: {
  projectDirectory?: string;
  platform?: NodeJS.Platform;
  architecture?: NodeJS.Architecture;
  home?: string;
  environment?: NodeJS.ProcessEnv;
  probe?: SurfaceProbe;
  preferredSurface?: AiSurfaceId | null;
} = {}): Promise<AiSurfaceInventory> {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const home = options.home ?? homedir();
  const environment = options.environment ?? process.env;
  const baseProbe = options.probe ?? systemSurfaceProbe;
  const macIdentityCache = new Map<string, MacApplicationIdentity | null>();
  const probe: SurfaceProbe = platform === 'darwin' && baseProbe.macApplicationIdentity
    ? {
        ...baseProbe,
        macApplicationIdentity(path, expected) {
          const cacheKey = JSON.stringify([
            path,
            expected?.bundleIdentifier ?? '',
            expected?.teamIdentifier ?? '',
            expected?.requiredScheme ?? '',
          ]);
          if (!macIdentityCache.has(cacheKey)) {
            macIdentityCache.set(
              cacheKey,
              baseProbe.macApplicationIdentity?.(path, expected) ?? null,
            );
          }
          return macIdentityCache.get(cacheKey) ?? null;
        },
      }
    : baseProbe;
  const preferences = options.preferredSurface === undefined ? await readAiPreferences(home) : { version: 1 as const, lastAiSurface: options.preferredSurface ?? undefined };
  const targets = new Map<AiSurfaceId, SurfaceTarget | null>(AI_SURFACES.map((surface) => {
    const target = findSurfaceTarget(surface, platform, architecture, home, environment, probe);
    return [surface.id, target?.verification ? target : null] as const;
  }));
  const installed = AI_SURFACES.map((definition) => {
    const target = targets.get(definition.id) ?? null;
    const surface: AiSurfaceDefinition = {
      ...definition,
      launchSupport: resolvedLaunchSupport(definition, target, targets, platform),
    };
    return { surface, target };
  });
  const availableIds = new Set(installed.filter((item) => item.target).map((item) => item.surface.id));
  const preferredSurface = preferences.lastAiSurface && availableIds.has(preferences.lastAiSurface)
    ? preferences.lastAiSurface
    : null;
  const launchSupportPriority: Readonly<Record<LaunchSupport, number>> = {
    'project-and-prompt': 4,
    'project-only': 3,
    'manual-project': 2,
    'launch-only': 1,
  };
  const bestInstalled = installed
    .filter((item) => item.target)
    .reduce<(typeof installed)[number] | null>((best, item) => {
      if (!best) return item;
      return launchSupportPriority[item.surface.launchSupport] > launchSupportPriority[best.surface.launchSupport]
        ? item
        : best;
    }, null);
  const recommendedSurface = preferredSurface
    ?? bestInstalled?.surface.id
    ?? 'vscode-copilot';

  return {
    contractVersion: 'eai.ai-surfaces/v2',
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
      capabilities: target?.capabilities ?? [],
      ...(target?.deepLinkScheme ? { deepLinkScheme: target.deepLinkScheme } : {}),
      ...(target?.verification ? { verification: target.verification } : {}),
      recommended: surface.id === recommendedSurface,
      previouslyUsed: surface.id === preferredSurface,
      status: target ? 'ready' : 'not-installed',
      nextAction: target
        ? `Start EAI in ${surface.name}`
        : `Get ${surface.name} from ${surface.provider}`,
    })),
  };
}

function isLegacyAiSurfaceId(surfaceId: AiSurfaceId | null): surfaceId is LegacyAiSurfaceId {
  return surfaceId !== null && LEGACY_AI_SURFACES.some((surface) => surface.id === surfaceId);
}

function equalStringArrays(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function expectedInventoryLaunchSupport(
  definition: AiSurfaceDefinition,
  detected: DetectedAiSurface,
  detectedById: ReadonlyMap<AiSurfaceId, DetectedAiSurface>,
  platform: NodeJS.Platform,
): LaunchSupport {
  if (!detected.installed) return definition.launchSupport;
  if (definition.id === 'vscode-copilot') {
    return detected.capabilities.includes('initial-prompt') ? 'project-and-prompt' : 'project-only';
  }
  if (definition.id === 'claude-desktop') {
    return detected.deepLinkScheme === 'claude' ? 'project-and-prompt' : 'manual-project';
  }
  if (definition.id === 'copilot-cli'
    || definition.id === 'antigravity-cli'
    || definition.id === 'claude-cli'
    || definition.id === 'codex-cli'
    || definition.id === 'grok-cli') {
    return detected.capabilities.includes('initial-prompt') ? 'project-and-prompt' : 'project-only';
  }
  if (definition.id === 'copilot-desktop') {
    const cli = detectedById.get('copilot-cli');
    return cli?.installed && cli.capabilities.includes('desktop-project-launch')
      ? 'project-only'
      : 'manual-project';
  }
  if (definition.id === 'codex-desktop') {
    const cli = detectedById.get('codex-cli');
    return platform === 'darwin'
      && cli?.installed
      && cli.capabilities.includes('desktop-project-launch')
      ? 'project-only'
      : 'manual-project';
  }
  return definition.launchSupport;
}

function authenticatedSurfaceCapabilities(
  surface: DetectedAiSurface,
  platform: NodeJS.Platform,
): AiSurfaceCapability[] {
  return vscodeCatalogVerificationShapeMatches(surface, platform)
    ? ['initial-prompt']
    : [];
}

function canonicalV2InventoryOrThrow(inventory: AiSurfaceInventory): DetectedAiSurface[] {
  if (inventory.contractVersion !== 'eai.ai-surfaces/v2'
    || inventory.surfaces.length !== V2_AI_SURFACE_IDS.length) {
    throw new Error('EAI refused to serialize a noncanonical v2 AI surface inventory.');
  }
  const detectedById = new Map<AiSurfaceId, DetectedAiSurface>();
  for (const [index, detected] of inventory.surfaces.entries()) {
    const expectedId = V2_AI_SURFACE_IDS[index];
    const definition = AI_SURFACES[index];
    if (!definition
      || detected.id !== expectedId
      || detectedById.has(detected.id)
      || detected.name !== definition.name
      || detected.provider !== definition.provider
      || detected.kind !== definition.kind
      || detected.installUrl !== definition.installUrl
      || !equalStringArrays(detected.commands, definition.commands)) {
      throw new Error('EAI refused to serialize a tampered or reordered v2 AI surface inventory.');
    }
    detectedById.set(detected.id, detected);
  }

  const validReference = (surfaceId: AiSurfaceId | null): boolean => surfaceId === null
    || detectedById.has(surfaceId);
  if (!validReference(inventory.preferredSurface)
    || !validReference(inventory.recommendedSurface)
    || (inventory.preferredSurface !== null
      && !detectedById.get(inventory.preferredSurface)?.installed)) {
    throw new Error('EAI refused to serialize a v2 inventory with a dangling surface reference.');
  }

  for (const [index, detected] of inventory.surfaces.entries()) {
    const definition = AI_SURFACES[index];
    const authenticatedCapabilities = detected.installed
      ? authenticatedSurfaceCapabilities(detected, inventory.platform)
      : [];
    if (!Array.isArray(detected.capabilities)
      || new Set(detected.capabilities).size !== detected.capabilities.length
      || !equalStringArrays(detected.capabilities, authenticatedCapabilities)) {
      throw new Error(`EAI refused to serialize invalid capabilities for ${detected.id}.`);
    }
    const installed = detected.installed === true;
    if (installed !== Boolean(detected.executable && detected.verification)
      || detected.status !== (installed ? 'ready' : 'not-installed')
      || (!installed && (detected.executable !== null
        || detected.verification !== undefined
        || detected.capabilities.length !== 0))
      || detected.recommended !== (detected.id === inventory.recommendedSurface)
      || detected.previouslyUsed !== (detected.id === inventory.preferredSurface)
      || detected.nextAction !== (installed
        ? `Start EAI in ${definition.name}`
        : `Get ${definition.name} from ${definition.provider}`)
      || detected.launchSupport !== expectedInventoryLaunchSupport(
        definition,
        detected,
        detectedById,
        inventory.platform,
      )) {
      throw new Error(`EAI refused to serialize inconsistent v2 state for ${detected.id}.`);
    }
    if (installed
      && detected.id === 'vscode-copilot'
      && ((inventory.platform === 'win32' || inventory.platform === 'linux')
        ? (detected.verification?.kind !== 'vscode-catalog'
          || !vscodeCatalogVerificationShapeMatches(detected, inventory.platform))
        : inventory.platform === 'darwin'
          ? detected.verification?.kind !== 'mac-application'
          : true)) {
      throw new Error('EAI refused to serialize unauthenticated VS Code catalog evidence.');
    }
  }
  return inventory.surfaces;
}

export function serializeAiSurfaceInventory(
  inventory: AiSurfaceInventory,
  contractVersion: 'v1',
): AiSurfaceInventoryV1;
export function serializeAiSurfaceInventory(
  inventory: AiSurfaceInventory,
  contractVersion: 'v2',
): AiSurfaceInventoryV2;
export function serializeAiSurfaceInventory(
  inventory: AiSurfaceInventory,
  contractVersion: AiSurfaceContractVersion,
): AiSurfaceInventoryV1 | AiSurfaceInventoryV2;
export function serializeAiSurfaceInventory(
  inventory: AiSurfaceInventory,
  contractVersion: AiSurfaceContractVersion,
): AiSurfaceInventoryV1 | AiSurfaceInventoryV2 {
  if (contractVersion === 'v2') {
    const canonicalDetected = canonicalV2InventoryOrThrow(inventory);
    return {
      contractVersion: 'eai.ai-surfaces/v2',
      platform: inventory.platform,
      projectDirectory: inventory.projectDirectory,
      preferredSurface: inventory.preferredSurface,
      recommendedSurface: inventory.recommendedSurface,
      surfaces: AI_SURFACES.map((definition, index) => ({
        id: definition.id,
        name: definition.name,
        provider: definition.provider,
        kind: definition.kind,
        installUrl: definition.installUrl,
        launchSupport: canonicalDetected[index].launchSupport,
        capabilities: [...canonicalDetected[index].capabilities],
        installed: canonicalDetected[index].installed,
        recommended: canonicalDetected[index].recommended,
        previouslyUsed: canonicalDetected[index].previouslyUsed,
        status: canonicalDetected[index].status,
        nextAction: canonicalDetected[index].nextAction,
      })),
    };
  }

  const detectedById = new Map(inventory.surfaces.map((surface) => [surface.id, surface]));
  const preferredSurface = isLegacyAiSurfaceId(inventory.preferredSurface)
    && detectedById.get(inventory.preferredSurface)?.installed
    ? inventory.preferredSurface
    : null;
  const recommendedSurface = preferredSurface
    ?? LEGACY_AI_SURFACES.find((surface) => detectedById.get(surface.id)?.installed)?.id
    ?? 'vscode-copilot';

  return {
    contractVersion: 'eai.ai-surfaces/v1',
    platform: inventory.platform,
    projectDirectory: inventory.projectDirectory,
    preferredSurface,
    recommendedSurface,
    surfaces: LEGACY_AI_SURFACES.map((definition) => {
      const detected = detectedById.get(definition.id);
      const installed = Boolean(detected?.installed);
      return {
        ...definition,
        installed,
        executable: detected?.executable ?? null,
        launchArgsPrefix: detected ? [...detected.launchArgsPrefix] : [],
        launchEnvironment: detected ? { ...detected.launchEnvironment } : {},
        recommended: definition.id === recommendedSurface,
        previouslyUsed: definition.id === preferredSurface,
        status: installed ? 'ready' : 'not-installed',
        nextAction: installed
          ? `Start EAI in ${definition.name}`
          : `Get ${definition.name} from ${definition.provider}`,
      };
    }),
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
  if (!surface.verification) {
    throw new Error(`EAI refused to launch ${surface.name} without authenticated launch evidence.`);
  }
  if (!equalStringArrays(surface.capabilities, authenticatedSurfaceCapabilities(surface, inventory.platform))) {
    throw new Error(`EAI refused unproven optional launch capabilities for ${surface.name}.`);
  }
  const project = inventory.projectDirectory;
  const common = {
    surfaceId,
    surfaceName: surface.name,
    projectDirectory: project,
    cwd: project,
    verification: surface.verification,
  } as const;

  switch (surfaceId) {
    case 'vscode-copilot':
      if (surface.verification.kind === 'vscode-catalog') {
        if (!vscodeCatalogVerificationShapeMatches(surface, inventory.platform)) {
          throw new Error('EAI refused unauthenticated VS Code catalog evidence.');
        }
        return {
          ...common,
          mode: 'process',
          command: surface.verification.realPath,
          args: [surface.verification.cliPath, 'chat', '-m', 'agent', EAI_FIRST_PROMPT],
          environment: { ...VSCODE_CATALOG_LAUNCH_ENVIRONMENT },
          preparedPrompt: true,
          userMessage: 'VS Code will open this project and start an EAI Copilot chat.',
        };
      }
      if (inventory.platform !== 'darwin' || surface.verification.kind !== 'mac-application') {
        throw new Error('EAI refused unauthenticated VS Code launch evidence.');
      }
      return {
        ...common,
        mode: 'process',
        command: surface.executable,
        args: [project],
        environment: {},
        preparedPrompt: false,
        userMessage: 'VS Code will open this project. Open Copilot Chat and ask it to use the repository EAI skill.',
      };
    case 'copilot-cli':
      return surface.capabilities.includes('initial-prompt')
        ? { ...common, mode: 'terminal', command: surface.executable, args: ['-C', project, '-i', EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive EAI Copilot session.' }
        : { ...common, mode: 'terminal', command: surface.executable, args: [], preparedPrompt: false, userMessage: 'A terminal will open GitHub Copilot CLI in this project. Ask it to use the repository EAI skill.' };
    case 'copilot-desktop': {
      const copilotCli = inventory.surfaces.find((candidate) => candidate.id === 'copilot-cli');
      if (copilotCli?.installed
        && copilotCli.executable
        && copilotCli.capabilities.includes('desktop-project-launch')) {
        if (!copilotCli.verification) throw new Error('EAI refused to delegate to an unverified GitHub Copilot CLI.');
        return { ...common, verification: copilotCli.verification, mode: 'process', command: copilotCli.executable, args: ['app'], preparedPrompt: false, userMessage: 'GitHub Copilot will open a new desktop session in this project. Ask it to use the repository EAI skill.' };
      }
      return surface.deepLinkScheme === 'ghapp'
        ? { ...common, mode: 'application', command: surface.executable, args: ['ghapp://recent'], preparedPrompt: false, userMessage: 'GitHub Copilot will open. Choose this project folder once, then ask it to use the repository EAI skill.', ...(surface.verification ? { verification: surface.verification } : {}) }
        : { ...common, mode: 'application', command: surface.executable, args: [], preparedPrompt: false, userMessage: 'GitHub Copilot will open. Choose this project folder once, then ask it to use the repository EAI skill.', ...(surface.verification ? { verification: surface.verification } : {}) };
    }
    case 'antigravity-desktop':
      return { ...common, mode: 'application', command: surface.executable, args: [], preparedPrompt: false, userMessage: 'Google Antigravity will open. Add this project folder, create or select its project, then ask it to use the repository EAI skill.', ...(surface.verification ? { verification: surface.verification } : {}) };
    case 'antigravity-cli':
      return surface.capabilities.includes('initial-prompt')
        ? { ...common, mode: 'terminal', command: surface.executable, args: ['-i', EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive Antigravity EAI session in this project.' }
        : { ...common, mode: 'terminal', command: surface.executable, args: [], preparedPrompt: false, userMessage: 'A terminal will open Antigravity CLI in this project. Ask it to use the repository EAI skill.' };
    case 'claude-desktop':
      return surface.deepLinkScheme === 'claude'
        ? {
            ...common,
            mode: 'application',
            command: surface.executable,
            args: [`claude://code/new?q=${encodeURIComponent(EAI_FIRST_PROMPT)}&folder=${encodeURIComponent(project)}`],
            preparedPrompt: true,
            userMessage: 'Claude Desktop will open a Code session for this project with the EAI starting prompt ready to review.',
          }
        : {
            ...common,
            mode: 'application',
            command: surface.executable,
            args: [],
            preparedPrompt: false,
            userMessage: 'Claude Desktop will open. Choose this project folder, start a Code session, then ask it to use the repository EAI skill.',
          };
    case 'claude-cli':
      return surface.capabilities.includes('initial-prompt')
        ? { ...common, mode: 'terminal', command: surface.executable, args: [EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive Claude EAI session.' }
        : { ...common, mode: 'terminal', command: surface.executable, args: [], preparedPrompt: false, userMessage: 'A terminal will open Claude Code in this project. Ask it to use the repository EAI skill.' };
    case 'codex-desktop': {
      const codexCli = inventory.surfaces.find((candidate) => candidate.id === 'codex-cli');
      return inventory.platform === 'darwin'
        && codexCli?.installed
        && codexCli.executable
        && codexCli.capabilities.includes('desktop-project-launch')
        ? (() => {
            if (!codexCli.verification) throw new Error('EAI refused to delegate to an unverified Codex CLI.');
            return { ...common, verification: codexCli.verification, mode: 'process' as const, command: codexCli.executable, args: ['app', project], preparedPrompt: false, userMessage: 'ChatGPT Desktop will open this project in Codex. Ask it to use the repository EAI skill.' };
          })()
        : { ...common, mode: 'application', command: surface.executable, args: [], preparedPrompt: false, userMessage: 'ChatGPT Desktop will open. Choose this project folder, select Codex, then ask it to use the repository EAI skill.' };
    }
    case 'codex-cli':
      return surface.capabilities.includes('initial-prompt')
        ? { ...common, mode: 'terminal', command: surface.executable, args: [EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive Codex EAI session.' }
        : { ...common, mode: 'terminal', command: surface.executable, args: [], preparedPrompt: false, userMessage: 'A terminal will open Codex CLI in this project. Ask it to use the repository EAI skill.' };
    case 'grok-bot':
      return { ...common, mode: 'application', command: surface.executable, args: [...surface.launchArgsPrefix], preparedPrompt: false, userMessage: 'Grok Bot will open. It manages cloud Bots and does not automatically open this local project; use Grok Build for a local coding workspace.', ...(surface.verification ? { verification: surface.verification } : {}) };
    case 'grok-cli':
      return surface.capabilities.includes('initial-prompt')
        ? { ...common, mode: 'terminal', command: surface.executable, args: ['--cwd', project, EAI_FIRST_PROMPT], preparedPrompt: true, userMessage: 'A terminal will open an interactive Grok Build EAI session for this project.' }
        : { ...common, mode: 'terminal', command: surface.executable, args: ['--cwd', project], preparedPrompt: false, userMessage: 'A terminal will open Grok Build in this project. Ask it to use the repository EAI skill.' };
  }
}

function shellQuote(value: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function sanitizedVsCodeRuntimeEnvironment(
  platform: 'win32' | 'linux',
  ambient: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(ambient)) {
    const normalized = key.toUpperCase();
    if (value === undefined
      || normalized.startsWith('NODE_')
      || normalized.startsWith('ELECTRON_')
      || normalized.startsWith('VSCODE_')
      || (platform === 'linux'
        && (normalized.startsWith('LD_') || normalized.startsWith('DYLD_')))) continue;
    sanitized[key] = value;
  }
  return { ...sanitized, ...VSCODE_CATALOG_LAUNCH_ENVIRONMENT };
}

function spawnDetached(
  command: string,
  args: readonly string[],
  cwd?: string,
  environment?: Readonly<Record<string, string>>,
  windowsVerbatimArguments?: true,
  windowsHide = true,
  replaceEnvironment = false,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide,
      env: replaceEnvironment ? { ...environment } : { ...process.env, ...environment },
      ...(windowsVerbatimArguments ? { windowsVerbatimArguments } : {}),
    });
    child.once('spawn', () => {
      child.unref();
      resolvePromise();
    });
    child.once('error', rejectPromise);
  });
}

async function spawnWindowsCommand(
  command: string,
  args: readonly string[],
  action: WindowsCommandAction,
  cwd: string,
  environment?: Readonly<Record<string, string>>,
  windowsHide = true,
): Promise<void> {
  const runtimeEnvironment = { ...process.env, ...environment };
  const invocation = buildWindowsCommandInvocation(command, args, action, runtimeEnvironment);
  await spawnDetached(
    invocation.command,
    invocation.args,
    cwd,
    environment,
    invocation.windowsVerbatimArguments,
    windowsHide,
  );
}

export async function openExternalUrl(url: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (!/^https:\/\//.test(url)) {
    throw new Error('EAI refused to open a non-HTTPS provider location.');
  }
  if (platform === 'darwin') await spawnDetached('/usr/bin/open', [url]);
  else if (platform === 'win32') await spawnDetached('C:\\Windows\\System32\\rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  else await spawnDetached('/usr/bin/xdg-open', [url]);
}

function trustedSurfaceUrlIsSupported(url: string): boolean {
  return /^(?:claude:\/\/code\/new(?:[?#]|$)|ghapp:\/\/recent(?:[?#]|$))/.test(url);
}

async function openTrustedSurfaceUrl(url: string, platform: NodeJS.Platform): Promise<void> {
  if (!trustedSurfaceUrlIsSupported(url)) {
    throw new Error('EAI refused to open an unsupported AI workspace location.');
  }
  if (platform === 'darwin') await spawnDetached('/usr/bin/open', [url]);
  else if (platform === 'win32') await spawnDetached('C:\\Windows\\System32\\rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  else await spawnDetached('/usr/bin/xdg-open', [url]);
}

export function buildLinuxTerminalInvocation(
  plan: LaunchPlan,
  commandPath: (command: string) => string | null = defaultCommandPath,
): LinuxTerminalInvocation {
  const candidates: ReadonlyArray<{
    name: string;
    trustedRealPaths: readonly string[];
    args: () => string[];
  }> = [
    { name: 'xdg-terminal-exec', trustedRealPaths: ['/usr/bin/xdg-terminal-exec'], args: () => ['--', plan.command, ...plan.args] },
    { name: 'kgx', trustedRealPaths: ['/usr/bin/kgx'], args: () => [`--working-directory=${plan.cwd}`, '--', plan.command, ...plan.args] },
    { name: 'gnome-terminal', trustedRealPaths: ['/usr/bin/gnome-terminal'], args: () => [`--working-directory=${plan.cwd}`, '--', plan.command, ...plan.args] },
    { name: 'konsole', trustedRealPaths: ['/usr/bin/konsole'], args: () => ['--workdir', plan.cwd, '-e', plan.command, ...plan.args] },
    { name: 'kitty', trustedRealPaths: ['/usr/bin/kitty'], args: () => ['--directory', plan.cwd, '--', plan.command, ...plan.args] },
    { name: 'wezterm', trustedRealPaths: ['/usr/bin/wezterm'], args: () => ['start', '--cwd', plan.cwd, '--', plan.command, ...plan.args] },
    { name: 'alacritty', trustedRealPaths: ['/usr/bin/alacritty'], args: () => ['--working-directory', plan.cwd, '-e', plan.command, ...plan.args] },
    { name: 'xfce4-terminal', trustedRealPaths: ['/usr/bin/xfce4-terminal'], args: () => ['--working-directory', plan.cwd, '--execute', plan.command, ...plan.args] },
    { name: 'mate-terminal', trustedRealPaths: ['/usr/bin/mate-terminal'], args: () => [`--working-directory=${plan.cwd}`, '--', plan.command, ...plan.args] },
    { name: 'foot', trustedRealPaths: ['/usr/bin/foot'], args: () => [`--working-directory=${plan.cwd}`, '--', plan.command, ...plan.args] },
    {
      name: 'x-terminal-emulator',
      trustedRealPaths: [
        '/usr/bin/gnome-terminal', '/usr/bin/konsole', '/usr/bin/xfce4-terminal',
        '/usr/bin/mate-terminal', '/usr/bin/xterm',
      ],
      args: () => ['-e', plan.command, ...plan.args],
    },
    { name: 'xterm', trustedRealPaths: ['/usr/bin/xterm'], args: () => ['-e', plan.command, ...plan.args] },
  ];
  for (const candidate of candidates) {
    const executable = commandPath(candidate.name);
    if (executable
      && candidate.trustedRealPaths.includes(executable)
      && (commandPath !== defaultCommandPath || rootOwnedProtectedExecutable(executable))) {
      return { command: executable, args: candidate.args() };
    }
  }
  throw new Error(
    'EAI could not find a supported Linux terminal emulator. Install GNOME Console, GNOME Terminal, Konsole, Kitty, WezTerm, Alacritty, Xfce Terminal, MATE Terminal, foot, xterm, or xdg-terminal-exec and retry.',
  );
}

function unchangedFileBinding(
  expected: LaunchFileBinding,
  path: string,
  platform: NodeJS.Platform,
  probe: SurfaceProbe,
): boolean {
  const actual = launchFileBinding(path, probe, platform);
  return Boolean(actual
    && actual.realPath === expected.realPath
    && actual.size === expected.size
    && actual.sha256 === expected.sha256
    && (expected.device === undefined || actual.device === expected.device)
    && (expected.inode === undefined || actual.inode === expected.inode)
    && (expected.modifiedTimeMs === undefined || actual.modifiedTimeMs === expected.modifiedTimeMs));
}

function unchangedCatalogFileBinding(
  expected: LaunchFileBinding,
  path: string,
  catalog: VsCodeCatalogFile,
  platform: 'win32' | 'linux',
  probe: SurfaceProbe,
): boolean {
  const actual = catalogFileBinding(path, catalog, platform, probe);
  return Boolean(actual
    && sameCatalogPath(actual.realPath, expected.realPath, platform)
    && actual.size === expected.size
    && actual.sha256 === expected.sha256
    && (expected.device === undefined || actual.device === expected.device)
    && (expected.inode === undefined || actual.inode === expected.inode)
    && (expected.modifiedTimeMs === undefined || actual.modifiedTimeMs === expected.modifiedTimeMs));
}

function launchArtifactStillAuthenticated(
  plan: LaunchPlan,
  platform: NodeJS.Platform,
  probe: SurfaceProbe,
): boolean {
  const verification = plan.verification;
  if (!verification) return false;
  const surface = AI_SURFACE_DEFINITIONS_BY_ID.get(plan.surfaceId);
  if (!surface) return false;

  if (verification.kind === 'copilot-appimage'
    || verification.kind === 'grok-appimage'
    || verification.kind === 'portable-elf') {
    if (platform !== 'linux'
      || !unchangedFileBinding(verification, plan.command, platform, probe)) return false;
    const header = probe.fileHeader?.(verification.realPath, 64);
    const appImageCatalog = verification.kind === 'grok-appimage'
      ? VERIFIED_GROK_BOT_APPIMAGES
      : verification.kind === 'copilot-appimage'
        ? VERIFIED_COPILOT_APPIMAGES
        : null;
    const knownArtifact = appImageCatalog
      ? Object.values(appImageCatalog).some((architectures) => {
          const artifact = architectures[verification.architecture];
          return artifact?.size === verification.size && artifact.sha256 === verification.sha256;
        })
      : (() => {
          const artifact = VERIFIED_ANTIGRAVITY_LINUX_EXECUTABLES[verification.architecture];
          return artifact?.size === verification.size && artifact.sha256 === verification.sha256;
        })();
    const expectedSurface = verification.kind === 'grok-appimage'
      ? plan.surfaceId === 'grok-bot'
      : verification.kind === 'copilot-appimage'
        ? plan.surfaceId === 'copilot-desktop'
        : plan.surfaceId === 'antigravity-desktop';
    return Boolean(knownArtifact
      && expectedSurface
      && header
      && (appImageCatalog
        ? validAppImageHeader(header, verification.architecture)
        : validElfHeader(header, verification.architecture)));
  }

  if (verification.kind === 'mac-executable') {
    if (platform !== 'darwin'
      || !unchangedFileBinding(verification, plan.command, platform, probe)) return false;
    const expectedSurfaceId = plan.surfaceId === 'copilot-desktop'
      ? 'copilot-cli'
      : plan.surfaceId === 'codex-desktop'
        ? 'codex-cli'
        : plan.surfaceId;
    const expected = EXPECTED_MAC_EXECUTABLE_IDENTITIES[expectedSurfaceId];
    const identity = probe.macExecutableIdentity?.(verification.realPath, expected);
    return Boolean(expected
      && identity
      && verification.identifier === expected.identifier
      && verification.teamIdentifier === expected.teamIdentifier
      && identity.identifier === expected.identifier
      && identity.teamIdentifier === expected.teamIdentifier
      && identity.architectures.includes(verification.architecture));
  }

  if (verification.kind === 'mac-application') {
    if (platform !== 'darwin') return false;
    const expected = EXPECTED_MAC_APPLICATION_IDENTITIES[plan.surfaceId];
    if (!expected
      || verification.bundleIdentifier !== expected.bundleIdentifier
      || verification.teamIdentifier !== expected.teamIdentifier
      || verification.requiredScheme !== expected.requiredScheme
      || probe.realPath?.(verification.realPath) !== verification.realPath) return false;
    const identity = probe.macApplicationIdentity?.(verification.realPath, expected);
    if (!identity
      || identity.bundleIdentifier !== expected.bundleIdentifier
      || identity.teamIdentifier !== expected.teamIdentifier
      || identity.executablePath !== verification.executablePath
      || !identity.architectures.includes(verification.architecture)
      || (expected.requiredScheme !== undefined
        && !identity.urlSchemes.includes(expected.requiredScheme))) return false;
    const executableBinding: LaunchFileBinding = {
      realPath: verification.executablePath,
      size: verification.executableSize,
      sha256: verification.executableSha256,
      ...(verification.executableDevice === undefined ? {} : { device: verification.executableDevice }),
      ...(verification.executableInode === undefined ? {} : { inode: verification.executableInode }),
      ...(verification.executableModifiedTimeMs === undefined
        ? {}
        : { modifiedTimeMs: verification.executableModifiedTimeMs }),
    };
    if (!unchangedFileBinding(executableBinding, verification.executablePath, platform, probe)) return false;
    if (verification.commandRealPath !== undefined) {
      if (verification.commandSize === undefined || verification.commandSha256 === undefined) return false;
      const commandBinding: LaunchFileBinding = {
        realPath: verification.commandRealPath,
        size: verification.commandSize,
        sha256: verification.commandSha256,
        ...(verification.commandDevice === undefined ? {} : { device: verification.commandDevice }),
        ...(verification.commandInode === undefined ? {} : { inode: verification.commandInode }),
        ...(verification.commandModifiedTimeMs === undefined
          ? {}
          : { modifiedTimeMs: verification.commandModifiedTimeMs }),
      };
      return unchangedFileBinding(commandBinding, plan.command, platform, probe);
    }
    return probe.realPath?.(plan.command) === verification.realPath;
  }

  if (verification.kind === 'vscode-catalog') {
    if (plan.surfaceId !== 'vscode-copilot'
      || plan.surfaceName !== surface.name
      || plan.mode !== 'process'
      || plan.cwd !== plan.projectDirectory
      || plan.preparedPrompt !== true
      || !sameCatalogPath(plan.command, verification.realPath, verification.platform)
      || !exactStringRecord(plan.environment ?? {}, VSCODE_CATALOG_LAUNCH_ENVIRONMENT)
      || !equalStringArrays(
        plan.args,
        [verification.cliPath, 'chat', '-m', 'agent', EAI_FIRST_PROMPT],
      )
      || platform !== verification.platform
      || (verification.architecture !== 'x64' && verification.architecture !== 'arm64')
      || verification.version !== VSCODE_CATALOG_VERSION
      || verification.commit !== VSCODE_CATALOG_COMMIT) return false;
    const installationRoot = verification.platform === 'win32'
      ? win32Path.dirname(verification.realPath)
      : '/usr/share/code';
    if (verification.platform === 'win32'
      && !probe.windowsVsCodeInstallationAcl?.(installationRoot)) return false;
    const expected = vsCodeCatalog(verification.platform, verification.architecture);
    if (!expected
      || verification.catalogArtifactSha256 !== expected.artifactSha256
      || verification.size !== expected.executable.size
      || verification.sha256 !== expected.executable.sha256
      || !unchangedFileBinding(verification, plan.command, platform, probe)) return false;
    const applicationRoot = verification.platform === 'win32'
      ? win32Path.join(installationRoot, VSCODE_CATALOG_COMMIT_DIRECTORY)
      : installationRoot;
    const resourceRoot = verification.platform === 'win32'
      ? win32Path.join(applicationRoot, 'resources', 'app')
      : join(applicationRoot, 'resources', 'app');
    const expectedCliPath = verification.platform === 'win32'
      ? win32Path.join(resourceRoot, 'out', 'cli.js')
      : join(resourceRoot, 'out', 'cli.js');
    if (!sameCatalogPath(verification.installationRoot, installationRoot, verification.platform)
      || !sameCatalogPath(verification.cliPath, expectedCliPath, verification.platform)
      || !catalogTreeShapeMatches(
        verification.applicationTree,
        applicationRoot,
        expected.applicationTree,
        verification.platform,
      )
      || !vscodeCatalogMetadataMatches(resourceRoot, expected, verification.platform, probe)) return false;
    const applicationTree = vscodeCatalogTreeMatches(
      applicationRoot,
      expected.applicationTree,
      verification.platform,
      probe,
    );
    if (!applicationTree
      || !sameCatalogPath(
        applicationTree.realPath,
        verification.applicationTree.realPath,
        verification.platform,
      )
      || applicationTree.fileCount !== verification.applicationTree.fileCount
      || applicationTree.totalBytes !== verification.applicationTree.totalBytes
      || applicationTree.sha256 !== verification.applicationTree.sha256) return false;
    if (verification.platform === 'win32') {
      const auxiliaryRoot = win32Path.join(installationRoot, 'bin');
      const auxiliaryTree = expected.auxiliaryTree
        ? vscodeCatalogTreeMatches(auxiliaryRoot, expected.auxiliaryTree, 'win32', probe)
        : null;
      const visualManifestPath = win32Path.join(installationRoot, 'Code.VisualElementsManifest.xml');
      if (!windowsVsCodeInstallationRootMatches(installationRoot, probe)
        || !auxiliaryTree
        || !catalogTreeShapeMatches(
          verification.auxiliaryTree,
          auxiliaryRoot,
          expected.auxiliaryTree,
          'win32',
        )
        || auxiliaryTree.fileCount !== verification.auxiliaryTree?.fileCount
        || auxiliaryTree.totalBytes !== verification.auxiliaryTree.totalBytes
        || auxiliaryTree.sha256 !== verification.auxiliaryTree.sha256
        || !expected.visualManifest
        || !verification.visualManifest
        || !unchangedCatalogFileBinding(
          verification.visualManifest,
          visualManifestPath,
          expected.visualManifest,
          'win32',
          probe,
        )) return false;
      const identity = probe.windowsExecutableIdentity?.(verification.realPath);
      return Boolean(identity
        && windowsApplicationIdentityValueMatches(surface, identity, verification.architecture));
    }
    if (verification.auxiliaryTree !== undefined || verification.visualManifest !== undefined) return false;
    const header = probe.fileHeader?.(verification.realPath, 64);
    return Boolean(header
      && validElfHeader(header, verification.architecture)
      && linuxPackageIdentityMatches(
        verification.realPath,
        'code',
        verification.architecture,
        probe,
      ));
  }

  if (verification.kind === 'windows-executable') {
    if (platform !== 'win32'
      || !unchangedFileBinding(verification, plan.command, platform, probe)) return false;
    const identity = probe.windowsExecutableIdentity?.(verification.realPath);
    return Boolean(identity
      && windowsApplicationIdentityValueMatches(surface, identity, verification.architecture)
      && identity.productName === verification.productName
      && identity.companyName === verification.companyName
      && identity.publisher === verification.publisher);
  }

  if (verification.kind === 'windows-appx') {
    if (platform !== 'win32') return false;
    const expected = EXPECTED_WINDOWS_APPX_IDENTITIES[plan.surfaceId];
    const identity = probe.windowsAppxIdentity?.(verification.packageName);
    return Boolean(expected
      && identity
      && plan.command === `shell:AppsFolder\\${verification.familyName}!${verification.applicationId}`
      && verification.packageName === expected.packageName
      && verification.applicationId === expected.applicationId
      && verification.publisherId === expected.publisherId
      && verification.familyName === expected.familyName
      && (expected.publisher === undefined || verification.publisher === expected.publisher)
      && expected.signatureKinds.includes(verification.signatureKind)
      && identity.packageName === verification.packageName
      && identity.publisher === verification.publisher
      && identity.publisherId === verification.publisherId
      && identity.familyName === verification.familyName
      && identity.applicationIds.includes(verification.applicationId)
      && identity.architecture === verification.architecture
      && identity.signatureKind === verification.signatureKind
      && identity.status === 'Ok');
  }

  if (verification.kind === 'linux-package') {
    if (platform !== 'linux'
      || plan.surfaceId !== 'copilot-desktop'
      || !unchangedFileBinding(verification, plan.command, platform, probe)) return false;
    const identity = probe.linuxPackageIdentity?.(verification.realPath);
    return Boolean(identity
      && linuxPackageIdentityMatches(
        verification.realPath,
        'github',
        verification.architecture,
        probe,
      )
      && identity.packageName === verification.packageName
      && identity.version === verification.version
      && identity.manager === verification.manager
      && identity.origin === verification.origin
      && identity.catalogArtifactSha256 === verification.catalogArtifactSha256
      && identity.executableSha256 === verification.sha256);
  }

  return false;
}

export async function executeAiLaunchPlan(
  plan: LaunchPlan,
  platform: NodeJS.Platform = process.platform,
  options: AiLaunchExecutionOptions = {},
): Promise<AiLaunchDispatch> {
  const dispatch: AiLaunchDispatch = { dispatched: true, confirmed: false };
  if (plan.mode === 'url' && !trustedSurfaceUrlIsSupported(plan.command)) {
    throw new Error('EAI refused to open an unsupported AI workspace location.');
  }
  const deepLinkArguments = plan.args.filter((argument) => /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(argument));
  if (deepLinkArguments.some((argument) => !trustedSurfaceUrlIsSupported(argument))
    || (plan.surfaceId === 'claude-desktop'
      && deepLinkArguments.some((argument) => !argument.startsWith('claude://code/new')))
    || (plan.surfaceId === 'copilot-desktop'
      && deepLinkArguments.some((argument) => !argument.startsWith('ghapp://recent')))) {
    throw new Error('EAI refused to open an unsupported AI workspace location.');
  }
  if (plan.mode === 'application') {
    const safeApplicationArguments = (() => {
      if (plan.surfaceId === 'claude-desktop') {
        return plan.args.length === 0
          || (plan.args.length === 1 && /^claude:\/\/code\/new(?:[?#]|$)/.test(plan.args[0]));
      }
      if (plan.surfaceId === 'copilot-desktop') {
        return plan.args.length === 0
          || (plan.args.length === 1 && /^ghapp:\/\/recent(?:[?#]|$)/.test(plan.args[0]));
      }
      if (plan.surfaceId === 'grok-bot') {
        return plan.args.length === 0
          || (plan.args.length === 1 && plan.args[0] === '--ozone-platform-hint=auto');
      }
      return plan.args.length === 0;
    })();
    if (!safeApplicationArguments) {
      throw new Error('EAI refused unexpected application launch arguments.');
    }
  }
  if (plan.surfaceId === 'vscode-copilot'
    && ((platform === 'win32' || platform === 'linux')
      ? plan.verification?.kind !== 'vscode-catalog'
      : platform === 'darwin'
        ? plan.verification?.kind !== 'mac-application'
        : true)) {
    throw new Error('EAI refused to launch VS Code without platform-authenticated catalog evidence.');
  }
  const probe = options.probe ?? systemSurfaceProbe;
  if (!launchArtifactStillAuthenticated(plan, platform, probe)) {
    throw new Error(`EAI refused to launch ${plan.surfaceName} because its authenticated application changed after detection.`);
  }
  if (plan.mode === 'url') {
    await openTrustedSurfaceUrl(plan.command, platform);
    return dispatch;
  }
  if (plan.mode === 'application') {
    if (platform === 'darwin') await spawnDetached('/usr/bin/open', ['-a', plan.command, ...plan.args]);
    else if (platform === 'win32' && plan.command.startsWith('shell:AppsFolder\\')) {
      await spawnDetached('C:\\Windows\\explorer.exe', [plan.command]);
    }
    else await spawnDetached(plan.command, plan.args, plan.cwd);
    return dispatch;
  }
  if (plan.mode === 'process') {
    if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(plan.command)) {
      await spawnWindowsCommand(plan.command, plan.args, '/c', plan.cwd, plan.environment);
      return dispatch;
    }
    if (plan.verification?.kind === 'vscode-catalog') {
      await spawnDetached(
        plan.command,
        plan.args,
        plan.cwd,
        sanitizedVsCodeRuntimeEnvironment(plan.verification.platform),
        undefined,
        true,
        true,
      );
      return dispatch;
    }
    await spawnDetached(plan.command, plan.args, plan.cwd, plan.environment);
    return dispatch;
  }

  if (platform === 'win32') {
    await spawnWindowsCommand(plan.command, plan.args, '/k', plan.cwd, plan.environment, false);
    return dispatch;
  }

  if (platform === 'darwin') {
    const commandLine = [plan.command, ...plan.args].map((value) => shellQuote(value, platform)).join(' ');
    const escaped = `cd ${shellQuote(plan.cwd, platform)} && ${commandLine}`.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    await spawnDetached('/usr/bin/osascript', ['-e', `tell application "Terminal" to do script "${escaped}"`]);
  } else {
    const terminal = buildLinuxTerminalInvocation(plan, options.commandPath);
    await spawnDetached(terminal.command, terminal.args, plan.cwd, plan.environment);
  }
  return dispatch;
}

export function getAiSurface(inventory: AiSurfaceInventory, surfaceId: string): DetectedAiSurface {
  return surfaceOrThrow(inventory, surfaceId);
}
