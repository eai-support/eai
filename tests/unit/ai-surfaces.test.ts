import { mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AI_SURFACES,
  buildCommandOutputInvocation,
  buildLinuxTerminalInvocation,
  buildWindowsCommandInvocation,
  buildAiLaunchPlan,
  detectAiSurfaces,
  executeAiLaunchPlan,
  readAiPreferences,
  rememberAiSurface,
  serializeAiSurfaceInventory,
  type LaunchPlan,
  type DirectoryTreeIdentity,
  type LinuxPackageIdentity,
  type MacApplicationIdentity,
  type MacExecutableIdentity,
  type SurfaceFileStatus,
  type SurfaceProbe,
  type WindowsAppxIdentity,
  type WindowsExecutableIdentity,
} from '../../src/lib/ai-surfaces.js';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: spawnMock };
});

function urlLaunchPlan(command: string): LaunchPlan {
  return {
    surfaceId: 'claude-desktop',
    surfaceName: 'Claude Desktop',
    projectDirectory: '/work/customer-portal',
    mode: 'url',
    command,
    args: [],
    cwd: '/work/customer-portal',
    preparedPrompt: true,
    userMessage: 'Claude Desktop will open.',
  };
}

function terminalLaunchPlan(): LaunchPlan {
  return {
    surfaceId: 'claude-cli',
    surfaceName: 'Claude Code',
    projectDirectory: '/work/Customer Portal',
    mode: 'terminal',
    command: '/home/test/.local/bin/claude',
    args: ['value; touch /tmp/not-run', '--safe'],
    environment: { EAI_TEST: '1' },
    cwd: '/work/Customer Portal',
    preparedPrompt: true,
    userMessage: 'A terminal will open.',
  };
}

function allowDetachedLaunch(): void {
  spawnMock.mockImplementation(() => {
    const child = {
      once: (event: string, listener: () => void) => {
        if (event === 'spawn') listener();
        return child;
      },
      unref: vi.fn(),
    };
    return child;
  });
}

function probe(
  commands: Record<string, string>,
  files: string[] = [],
  outputs: Record<string, string> = {},
  contents: Record<string, string> = {},
  realPaths: Record<string, string> = {},
  evidence: Record<string, {
    status?: SurfaceFileStatus;
    header?: Uint8Array;
    sha256?: string;
    macIdentity?: MacApplicationIdentity | null;
    macExecutableIdentity?: MacExecutableIdentity | null;
    windowsIdentity?: (Omit<WindowsExecutableIdentity, 'architecture'> & {
      architecture?: WindowsExecutableIdentity['architecture'];
    }) | null;
    windowsAppxIdentity?: WindowsAppxIdentity | null;
    linuxPackageIdentity?: LinuxPackageIdentity | null;
    directoryTreeIdentity?: DirectoryTreeIdentity | null;
    entries?: readonly string[];
    windowsVsCodeInstallationAcl?: boolean;
  }> = {},
): SurfaceProbe {
  const commandPaths = new Set(Object.values(commands));
  const defaultMacIdentities: Record<string, Omit<MacApplicationIdentity, 'executablePath'>> = {
    '/Applications/Visual Studio Code.app': {
      bundleIdentifier: 'com.microsoft.VSCode', teamIdentifier: 'UBF8T346G9', architectures: ['arm64', 'x64'], urlSchemes: [],
    },
    '/Applications/GitHub Copilot.app': {
      bundleIdentifier: 'com.github.githubapp', teamIdentifier: 'VEKTX9H2N7', architectures: ['arm64', 'x64'], urlSchemes: ['ghapp'],
    },
    '/Applications/Antigravity.app': {
      bundleIdentifier: 'com.google.antigravity', teamIdentifier: 'EQHXZ8M8AV', architectures: ['arm64', 'x64'], urlSchemes: [],
    },
    '/Applications/Claude.app': {
      bundleIdentifier: 'com.anthropic.claudefordesktop', teamIdentifier: 'Q6L2SF6YDW', architectures: ['arm64', 'x64'], urlSchemes: ['claude'],
    },
    '/Applications/ChatGPT.app': {
      bundleIdentifier: 'com.openai.codex', teamIdentifier: '2DC432GLL2', architectures: ['arm64', 'x64'], urlSchemes: [],
    },
    '/Applications/Codex.app': {
      bundleIdentifier: 'com.openai.codex', teamIdentifier: '2DC432GLL2', architectures: ['arm64', 'x64'], urlSchemes: [],
    },
    '/Applications/Grok Bot.app': {
      bundleIdentifier: 'com.anysphere.sand', teamIdentifier: 'DCNK4UB866', architectures: ['arm64', 'x64'], urlSchemes: [],
    },
  };
  return {
    commandPath: (command) => commands[command] ?? null,
    fileExists: (path) => files.includes(path),
    fileContent: (path) => contents[path] ?? null,
    realPath: (path) => realPaths[path] ?? path,
    directoryEntries: (directory) => evidence[directory]?.entries ?? Object.keys(contents)
      .filter((candidate) => (
        candidate.startsWith(`${directory}/`) || candidate.startsWith(`${directory}\\`)
      ))
      .map((candidate) => candidate.slice(directory.length + 1))
      .filter((candidate) => !candidate.includes('/') && !candidate.includes('\\')),
    directoryTreeIdentity: (path) => evidence[path]?.directoryTreeIdentity ?? null,
    fileStatus: (path) => evidence[path]?.status
      ?? (files.includes(path)
        || commandPaths.has(path)
        || /\.app\/Contents\/(?:MacOS|Resources\/app\/bin)\//.test(path)
        ? { isFile: true, executable: true, mode: 0o100755, size: 1024 }
        : null),
    fileHeader: (path, length) => evidence[path]?.header?.slice(0, length) ?? null,
    fileSha256: (path) => evidence[path]?.sha256
      ?? (files.includes(path)
        || commandPaths.has(path)
        || /\.app\/Contents\/(?:MacOS|Resources\/app\/bin)\//.test(path)
        ? 'f'.repeat(64)
        : null),
    macApplicationIdentity: (path) => {
      if (Object.prototype.hasOwnProperty.call(evidence[path] ?? {}, 'macIdentity')) {
        return evidence[path]?.macIdentity ?? null;
      }
      const identity = defaultMacIdentities[path];
      if (!identity) return null;
      const executableName = path.endsWith('Visual Studio Code.app') ? 'Electron' : path.split('/').at(-1)?.replace(/\.app$/, '') ?? 'App';
      return { ...identity, executablePath: `${path}/Contents/MacOS/${executableName}` };
    },
    macExecutableIdentity: (path) => {
      if (Object.prototype.hasOwnProperty.call(evidence[path] ?? {}, 'macExecutableIdentity')) {
        return evidence[path]?.macExecutableIdentity ?? null;
      }
      const command = path.split('/').at(-1);
      if (command === 'copilot') {
        return { identifier: 'copilot', teamIdentifier: 'VEKTX9H2N7', architectures: ['arm64', 'x64'] };
      }
      if (command === 'claude') {
        return { identifier: 'com.anthropic.claude-code', teamIdentifier: 'Q6L2SF6YDW', architectures: ['arm64', 'x64'] };
      }
      if (command === 'codex') {
        return { identifier: 'codex', teamIdentifier: '2DC432GLL2', architectures: ['arm64', 'x64'] };
      }
      return null;
    },
    windowsExecutableIdentity: (path) => {
      const identity = evidence[path]?.windowsIdentity;
      return identity ? { ...identity, architecture: identity.architecture ?? 'arm64' } : null;
    },
    windowsVsCodeInstallationAcl: (path) => evidence[path]?.windowsVsCodeInstallationAcl ?? false,
    windowsAppxIdentity: (packageName) => evidence[packageName]?.windowsAppxIdentity ?? null,
    windowsUrlHandlerExecutable: (scheme) => outputs[`windows-handler:${scheme}`] ?? null,
    linuxPackageIdentity: (path) => evidence[path]?.linuxPackageIdentity ?? null,
    linuxUrlSchemeDesktopId: (scheme) => outputs[`linux-handler:${scheme}`] ?? null,
  };
}

function elfHeader(machine: 62 | 183): Uint8Array {
  const header = new Uint8Array(64);
  header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  header[18] = machine & 0xff;
  header[19] = machine >> 8;
  return header;
}

function appImageHeader(machine: 62 | 183): Uint8Array {
  const header = elfHeader(machine);
  header.set([0x41, 0x49, 2], 8);
  return header;
}

const VSCODE_VERSION = '1.136.1';
const VSCODE_COMMIT = 'a44adf7f53e00964ab890f9f8758a334f1fc15bc';
const VSCODE_WINDOWS_ROOT = 'C:\\Program Files\\Microsoft VS Code';
const VSCODE_WINDOWS_EXECUTABLE = `${VSCODE_WINDOWS_ROOT}\\Code.exe`;
const VSCODE_WINDOWS_APPLICATION = `${VSCODE_WINDOWS_ROOT}\\a44adf7f53`;
const VSCODE_WINDOWS_RESOURCES = `${VSCODE_WINDOWS_ROOT}\\a44adf7f53\\resources\\app`;
const VSCODE_WINDOWS_CLI = `${VSCODE_WINDOWS_RESOURCES}\\out\\cli.js`;
const VSCODE_WINDOWS_BIN = `${VSCODE_WINDOWS_ROOT}\\bin`;
const VSCODE_WINDOWS_MANIFEST = `${VSCODE_WINDOWS_ROOT}\\Code.VisualElementsManifest.xml`;
const VSCODE_LINUX_EXECUTABLE = '/usr/share/code/code';
const VSCODE_LINUX_RESOURCES = '/usr/share/code/resources/app';
const VSCODE_LINUX_CLI = `${VSCODE_LINUX_RESOURCES}/out/cli.js`;

function vscodeMetadataContents(root: string, separator: '/' | '\\'): Record<string, string> {
  const path = (...segments: string[]) => [root, ...segments].join(separator);
  return {
    [path('package.json')]: JSON.stringify({ name: 'Code', version: VSCODE_VERSION, main: './out/main.js' }),
    [path('product.json')]: JSON.stringify({
      nameLong: 'Visual Studio Code',
      applicationName: 'code',
      commit: VSCODE_COMMIT,
      quality: 'stable',
    }),
    [path('extensions', 'copilot', 'package.json')]: JSON.stringify({
      publisher: 'GitHub',
      name: 'copilot-chat',
      version: '0.64.1',
      engines: { vscode: `^${VSCODE_VERSION}` },
    }),
  };
}

function windowsVsCodeCatalogProbe(
  applicationSha256 = '11009193bf07e51892a0ae9f6030188c7f8914e79ef4344e2f6a3a344807753f',
  rootEntries: readonly string[] = [
    'a44adf7f53', 'bin', 'Code.exe', 'Code.VisualElementsManifest.xml',
    'unins000.dat', 'unins000.exe', 'unins000.msg',
  ],
  binEntries: readonly string[] = ['code', 'code-tunnel.exe', 'code.cmd'],
  aclTrusted = true,
): SurfaceProbe {
  const contents = vscodeMetadataContents(VSCODE_WINDOWS_RESOURCES, '\\');
  const packagePath = `${VSCODE_WINDOWS_RESOURCES}\\package.json`;
  const productPath = `${VSCODE_WINDOWS_RESOURCES}\\product.json`;
  const copilotPath = `${VSCODE_WINDOWS_RESOURCES}\\extensions\\copilot\\package.json`;
  const uninstallerFiles = rootEntries
    .filter((entry) => /^unins000[.](?:dat|exe|msg)$/i.test(entry))
    .map((entry) => `${VSCODE_WINDOWS_ROOT}\\${entry}`);
  return probe(
    { code: `${VSCODE_WINDOWS_ROOT}\\bin\\code.cmd` },
    [
      VSCODE_WINDOWS_EXECUTABLE,
      VSCODE_WINDOWS_CLI,
      VSCODE_WINDOWS_MANIFEST,
      packagePath,
      productPath,
      copilotPath,
      ...uninstallerFiles,
    ],
    {},
    contents,
    {},
    {
      [VSCODE_WINDOWS_EXECUTABLE]: {
        status: { isFile: true, executable: true, mode: 0, size: 218_732_896 },
        sha256: 'c8e8f54f217223f3d4adff4dbd1f529aa7386c3a1705dbe214ecf187b963423e',
        windowsIdentity: {
          productName: 'Visual Studio Code',
          companyName: 'Microsoft Corporation',
          publisher: 'CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US',
          architecture: 'arm64',
        },
      },
      [VSCODE_WINDOWS_APPLICATION]: {
        directoryTreeIdentity: {
          realPath: VSCODE_WINDOWS_APPLICATION,
          fileCount: 2_463,
          totalBytes: 782_690_305,
          sha256: applicationSha256,
        },
      },
      [VSCODE_WINDOWS_BIN]: {
        entries: binEntries,
        directoryTreeIdentity: {
          realPath: VSCODE_WINDOWS_BIN,
          fileCount: 3,
          totalBytes: 25_558_542,
          sha256: '73fbdad4bf097af9408bdcbe75f4c5cc1741b88b9eedf9d946b338124457408b',
        },
      },
      [VSCODE_WINDOWS_MANIFEST]: {
        status: { isFile: true, executable: false, mode: 0, size: 398 },
        sha256: 'cff3bb59579080b4ac4e69fc8d936c35bbb41455f66f9188ed54f4e31882e68b',
      },
      [packagePath]: {
        status: { isFile: true, executable: false, mode: 0, size: 15_233 },
        sha256: '18ce306138992d44d6c0537c386943b277621865d5161e1932e792b09ef766f0',
      },
      [productPath]: {
        status: { isFile: true, executable: false, mode: 0, size: 71_150 },
        sha256: '4bdbecbf1cd1a700f4f738216bd0e6f08f561a52e1fd9ca915ea9ff9a6a7a7a6',
      },
      [copilotPath]: {
        status: { isFile: true, executable: false, mode: 0, size: 200_790 },
        sha256: '586aa5105751792bedcb7c3ef785d0c1cb1bac8c97812afd50f1349f0a6c1a09',
      },
      [VSCODE_WINDOWS_CLI]: {
        status: { isFile: true, executable: false, mode: 0, size: 291_407 },
        sha256: '487137301c6d9ac59dc846a93c17e2f52ba98fdf1670c164dac24b4eb5acad61',
      },
      [VSCODE_WINDOWS_ROOT]: {
        entries: rootEntries,
        windowsVsCodeInstallationAcl: aclTrusted,
      },
    },
  );
}

function linuxVsCodeCatalogProbe(applicationSha256 = '437e3d7f2338684372876807533f7d38c0e9b56bd8be9238b520dfc2a01ef8e6'): SurfaceProbe {
  const contents = vscodeMetadataContents(VSCODE_LINUX_RESOURCES, '/');
  const packagePath = `${VSCODE_LINUX_RESOURCES}/package.json`;
  const productPath = `${VSCODE_LINUX_RESOURCES}/product.json`;
  const copilotPath = `${VSCODE_LINUX_RESOURCES}/extensions/copilot/package.json`;
  return probe(
    { code: '/usr/bin/code' },
    [VSCODE_LINUX_EXECUTABLE, VSCODE_LINUX_CLI, packagePath, productPath, copilotPath],
    {},
    contents,
    {},
    {
      [VSCODE_LINUX_EXECUTABLE]: {
        status: { isFile: true, executable: true, mode: 0o100755, size: 212_536_608 },
        header: elfHeader(183),
        sha256: '8872f37cb828d74498b0451ed923a141e5b144dfd9de9c8f41265bf90b0af98d',
        linuxPackageIdentity: {
          packageName: 'code',
          architecture: 'arm64',
          version: '1.136.1-1788414014',
          manager: 'dpkg',
          ownedPath: VSCODE_LINUX_EXECUTABLE,
          origin: 'https://update.code.visualstudio.com/1.136.1/linux-deb-arm64/stable',
          signatureVerified: false,
          catalogArtifactSha256: 'baa72f92d3feaa76d015202c57271475ea15809e635587279171a972cdd612a4',
          executableSha256: '8872f37cb828d74498b0451ed923a141e5b144dfd9de9c8f41265bf90b0af98d',
        },
      },
      ['/usr/share/code']: {
        directoryTreeIdentity: {
          realPath: '/usr/share/code',
          fileCount: 2_415,
          totalBytes: 1_035_373_322,
          sha256: applicationSha256,
        },
      },
      [packagePath]: {
        status: { isFile: true, executable: false, mode: 0o100664, size: 15_266 },
        sha256: 'ba6a64fd136466074831d91c20ec6d3dd110c127a84a8ac9b47cd4f075172ad9',
      },
      [productPath]: {
        status: { isFile: true, executable: false, mode: 0o100664, size: 67_081 },
        sha256: '0fb7ff5e7c78427f0601f864ec8adc8e163a384f8da1c49e9e99adbffaa7e547',
      },
      [copilotPath]: {
        status: { isFile: true, executable: false, mode: 0o100644, size: 200_790 },
        sha256: '586aa5105751792bedcb7c3ef785d0c1cb1bac8c97812afd50f1349f0a6c1a09',
      },
      [VSCODE_LINUX_CLI]: {
        status: { isFile: true, executable: false, mode: 0o100664, size: 291_436 },
        sha256: 'c26b66d4031d946523eb9b951da9bc56aba16417e91d84534ce6367e815fe342',
      },
    },
  );
}

describe('AI surface contract', () => {
  it('requires an explicit architecture when simulating another operating system', async () => {
    const simulatedPlatform = process.platform === 'win32' ? 'linux' : 'win32';

    await expect(detectAiSurfaces({
      platform: simulatedPlatform,
      preferredSurface: null,
      probe: probe({}, []),
    })).rejects.toThrow(`An explicit architecture is required when detecting ${simulatedPlatform}`);
  });

  it('publishes exactly six graphical surfaces, including VS Code with Copilot', () => {
    expect(AI_SURFACES.map((surface) => surface.id)).toEqual([
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
    ]);
    expect(Object.isFrozen(AI_SURFACES)).toBe(true);
    expect(AI_SURFACES.every((surface) => Object.isFrozen(surface) && Object.isFrozen(surface.commands))).toBe(true);
    const graphicalSurfaces = AI_SURFACES.filter(
      (surface) => surface.kind === 'desktop' || surface.kind === 'editor',
    );

    expect(graphicalSurfaces.map((surface) => surface.id)).toEqual([
      'vscode-copilot',
      'copilot-desktop',
      'antigravity-desktop',
      'claude-desktop',
      'codex-desktop',
      'grok-bot',
    ]);
    expect(graphicalSurfaces).toHaveLength(6);
  });

  it('serializes the immutable eight-surface v1 payload exactly', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      projectDirectory: '/work/app',
      preferredSurface: null,
      probe: probe({}),
    });

    expect(serializeAiSurfaceInventory(inventory, 'v1')).toEqual({
      contractVersion: 'eai.ai-surfaces/v1',
      platform: 'linux',
      projectDirectory: '/work/app',
      preferredSurface: null,
      recommendedSurface: 'vscode-copilot',
      surfaces: [
        {
          id: 'vscode-copilot', name: 'GitHub Copilot in VS Code', provider: 'GitHub', kind: 'editor',
          installUrl: 'https://code.visualstudio.com/docs/copilot/setup', launchSupport: 'project-and-prompt', commands: ['code'],
          macApplications: ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'],
          windowsApplications: ['AppData/Local/Programs/Microsoft VS Code/Code.exe', 'AppData/Local/Programs/Microsoft VS Code/bin/code.cmd'],
          installed: false, executable: null, launchArgsPrefix: [], launchEnvironment: {}, recommended: true,
          previouslyUsed: false, status: 'not-installed', nextAction: 'Get GitHub Copilot in VS Code from GitHub',
        },
        {
          id: 'copilot-cli', name: 'GitHub Copilot CLI', provider: 'GitHub', kind: 'cli',
          installUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli', launchSupport: 'project-and-prompt', commands: ['copilot'],
          installed: false, executable: null, launchArgsPrefix: [], launchEnvironment: {}, recommended: false,
          previouslyUsed: false, status: 'not-installed', nextAction: 'Get GitHub Copilot CLI from GitHub',
        },
        {
          id: 'copilot-desktop', name: 'GitHub Copilot', provider: 'GitHub', kind: 'desktop',
          installUrl: 'https://docs.github.com/en/copilot/how-tos/github-copilot-app/getting-started', launchSupport: 'manual-project', commands: [],
          macApplications: ['/Applications/GitHub Copilot.app'],
          windowsApplications: ['AppData/Local/Programs/GitHub Copilot/GitHub Copilot.exe'],
          installed: false, executable: null, launchArgsPrefix: [], launchEnvironment: {}, recommended: false,
          previouslyUsed: false, status: 'not-installed', nextAction: 'Get GitHub Copilot from GitHub',
        },
        {
          id: 'claude-desktop', name: 'Claude Desktop', provider: 'Anthropic', kind: 'desktop',
          installUrl: 'https://claude.ai/download', launchSupport: 'project-and-prompt', commands: [],
          macApplications: ['/Applications/Claude.app'],
          windowsApplications: ['AppData/Local/AnthropicClaude/Claude.exe', 'AppData/Local/Programs/Claude/Claude.exe'],
          installed: false, executable: null, launchArgsPrefix: [], launchEnvironment: {}, recommended: false,
          previouslyUsed: false, status: 'not-installed', nextAction: 'Get Claude Desktop from Anthropic',
        },
        {
          id: 'claude-cli', name: 'Claude Code', provider: 'Anthropic', kind: 'cli',
          installUrl: 'https://code.claude.com/docs/en/setup', launchSupport: 'project-and-prompt', commands: ['claude'],
          installed: false, executable: null, launchArgsPrefix: [], launchEnvironment: {}, recommended: false,
          previouslyUsed: false, status: 'not-installed', nextAction: 'Get Claude Code from Anthropic',
        },
        {
          id: 'codex-desktop', name: 'ChatGPT Desktop (Codex)', provider: 'OpenAI', kind: 'desktop',
          installUrl: 'https://learn.chatgpt.com/docs/app', launchSupport: 'manual-project', commands: [],
          macApplications: ['/Applications/ChatGPT.app', '/Applications/Codex.app'],
          windowsApplications: ['AppData/Local/Programs/ChatGPT/ChatGPT.exe', 'AppData/Local/Programs/Codex/Codex.exe'],
          installed: false, executable: null, launchArgsPrefix: [], launchEnvironment: {}, recommended: false,
          previouslyUsed: false, status: 'not-installed', nextAction: 'Get ChatGPT Desktop (Codex) from OpenAI',
        },
        {
          id: 'codex-cli', name: 'Codex CLI', provider: 'OpenAI', kind: 'cli',
          installUrl: 'https://learn.chatgpt.com/docs/codex/cli', launchSupport: 'project-and-prompt', commands: ['codex'],
          installed: false, executable: null, launchArgsPrefix: [], launchEnvironment: {}, recommended: false,
          previouslyUsed: false, status: 'not-installed', nextAction: 'Get Codex CLI from OpenAI',
        },
        {
          id: 'grok-cli', name: 'Grok Build', provider: 'xAI', kind: 'cli',
          installUrl: 'https://x.ai/cli', launchSupport: 'project-and-prompt', commands: ['grok'],
          installed: false, executable: null, launchArgsPrefix: [], launchEnvironment: {}, recommended: false,
          previouslyUsed: false, status: 'not-installed', nextAction: 'Get Grok Build from xAI',
        },
      ],
    });
  });

  it('serializes the exact 11-surface v2 Setup payload with no internal paths', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      projectDirectory: '/work/app',
      preferredSurface: null,
      probe: probe({}),
    });
    const surfaceContract = [
      ['vscode-copilot', 'GitHub Copilot in VS Code', 'GitHub', 'editor', 'https://code.visualstudio.com/docs/copilot/setup', 'project-and-prompt', []],
      ['copilot-desktop', 'GitHub Copilot app', 'GitHub', 'desktop', 'https://docs.github.com/en/copilot/get-started/quickstart-copilot-app', 'manual-project', []],
      ['antigravity-desktop', 'Google Antigravity 2.0', 'Google', 'desktop', 'https://antigravity.google/download', 'manual-project', []],
      ['claude-desktop', 'Claude Desktop', 'Anthropic', 'desktop', 'https://claude.com/download', 'project-and-prompt', []],
      ['codex-desktop', 'ChatGPT desktop (Codex)', 'OpenAI', 'desktop', 'https://learn.chatgpt.com/docs/app', 'manual-project', []],
      ['grok-bot', 'Grok Bot', 'xAI', 'desktop', 'https://x.ai/bot', 'launch-only', []],
      ['copilot-cli', 'GitHub Copilot CLI', 'GitHub', 'cli', 'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli', 'project-and-prompt', []],
      ['antigravity-cli', 'Antigravity CLI (agy)', 'Google', 'cli', 'https://antigravity.google/docs/cli/install/', 'project-and-prompt', []],
      ['claude-cli', 'Claude Code', 'Anthropic', 'cli', 'https://code.claude.com/docs/en/setup', 'project-and-prompt', []],
      ['codex-cli', 'Codex CLI', 'OpenAI', 'cli', 'https://learn.chatgpt.com/docs/codex/cli', 'project-and-prompt', []],
      ['grok-cli', 'Grok Build', 'xAI', 'cli', 'https://x.ai/build', 'project-and-prompt', []],
    ] as const;

    expect(serializeAiSurfaceInventory(inventory, 'v2')).toEqual({
      contractVersion: 'eai.ai-surfaces/v2',
      platform: 'linux',
      projectDirectory: '/work/app',
      preferredSurface: null,
      recommendedSurface: 'vscode-copilot',
      surfaces: surfaceContract.map(([id, name, provider, kind, installUrl, launchSupport, capabilities]) => ({
        id,
        name,
        provider,
        kind,
        installUrl,
        launchSupport,
        capabilities: [...capabilities],
        installed: false,
        recommended: id === 'vscode-copilot',
        previouslyUsed: false,
        status: 'not-installed',
        nextAction: `Get ${name} from ${provider}`,
      })),
    });
    for (const surface of serializeAiSurfaceInventory(inventory, 'v2').surfaces) {
      expect(surface).not.toHaveProperty('executable');
      expect(surface).not.toHaveProperty('launchEnvironment');
      expect(surface).not.toHaveProperty('commands');
    }
  });

  it.each([
    ['missing surface', (inventory: Awaited<ReturnType<typeof detectAiSurfaces>>) => { inventory.surfaces.pop(); }],
    ['duplicate surface', (inventory: Awaited<ReturnType<typeof detectAiSurfaces>>) => { inventory.surfaces[1] = inventory.surfaces[0]; }],
    ['reordered surfaces', (inventory: Awaited<ReturnType<typeof detectAiSurfaces>>) => { [inventory.surfaces[0], inventory.surfaces[1]] = [inventory.surfaces[1], inventory.surfaces[0]]; }],
    ['tampered metadata', (inventory: Awaited<ReturnType<typeof detectAiSurfaces>>) => { inventory.surfaces[0].name = 'Spoofed editor'; }],
    ['dangling recommendation', (inventory: Awaited<ReturnType<typeof detectAiSurfaces>>) => { inventory.recommendedSurface = 'missing' as typeof inventory.recommendedSurface; }],
  ])('rejects a noncanonical v2 inventory with %s', async (_name, mutate) => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      projectDirectory: '/work/app',
      preferredSurface: null,
      probe: probe({}),
    });
    mutate(inventory);
    expect(() => serializeAiSurfaceInventory(inventory, 'v2')).toThrow(/refused to serialize/i);
  });

  it('detects VS Code only when Copilot is installed and recommends it first', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      architecture: 'arm64',
      home: '/Users/test',
      projectDirectory: '/work/app',
      preferredSurface: null,
      probe: probe(
        { claude: '/usr/local/bin/claude' },
        [
          '/Applications/Visual Studio Code.app',
          '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/copilot',
        ],
      ),
    });

    expect(inventory.recommendedSurface).toBe('vscode-copilot');
    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')).toMatchObject({ installed: true, recommended: true });
    expect(inventory.surfaces.find((surface) => surface.id === 'claude-cli')?.installed).toBe(true);
  });

  it('never executes provider commands and rejects unauthenticated Linux CLIs during detection', async () => {
    const providerExecution = vi.fn(() => {
      throw new Error('provider execution is forbidden during detection');
    });
    const baseProbe = probe({
      claude: '/home/test/.local/bin/claude',
      agy: '/home/test/.local/bin/agy',
      grok: '/home/test/.grok/bin/grok',
    });
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: { ...baseProbe, commandOutput: providerExecution } as SurfaceProbe,
    });

    expect(providerExecution).not.toHaveBeenCalled();
    expect(inventory.surfaces.filter((surface) => surface.installed)).toEqual([]);
  });

  it('accepts only exact macOS CLI signer identities and carries verification for every positive target', async () => {
    const claude = '/Users/test/.local/bin/claude';
    const valid = await detectAiSurfaces({
      platform: 'darwin',
      architecture: 'arm64',
      home: '/Users/test',
      preferredSurface: null,
      probe: probe({ claude }),
    });
    const wrongSigner = await detectAiSurfaces({
      platform: 'darwin',
      architecture: 'arm64',
      home: '/Users/test',
      preferredSurface: null,
      probe: probe({ claude }, [], {}, {}, {}, {
        [claude]: {
          macExecutableIdentity: {
            identifier: 'com.anthropic.claude-code',
            teamIdentifier: 'BADTEAM123',
            architectures: ['arm64'],
          },
        },
      }),
    });

    expect(valid.surfaces.find((surface) => surface.id === 'claude-cli')).toMatchObject({
      installed: true,
      verification: {
        kind: 'mac-executable',
        identifier: 'com.anthropic.claude-code',
        teamIdentifier: 'Q6L2SF6YDW',
        architecture: 'arm64',
      },
    });
    expect(valid.surfaces.filter((surface) => surface.installed).every((surface) => surface.verification)).toBe(true);
    expect(wrongSigner.surfaces.find((surface) => surface.id === 'claude-cli')?.installed).toBe(false);
  });

  it('revalidates a macOS CLI signer immediately before dispatch', async () => {
    const claude = '/Users/test/.local/bin/claude';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      architecture: 'arm64',
      home: '/Users/test',
      projectDirectory: '/work/app',
      preferredSurface: null,
      probe: probe({ claude }),
    });
    const plan = buildAiLaunchPlan(inventory, 'claude-cli');
    spawnMock.mockReset();

    await expect(executeAiLaunchPlan(plan, 'darwin', {
      probe: probe({ claude }, [], {}, {}, {}, {
        [claude]: {
          macExecutableIdentity: {
            identifier: 'com.anthropic.claude-code',
            teamIdentifier: 'BADTEAM123',
            architectures: ['arm64'],
          },
        },
      }),
    })).rejects.toThrow('authenticated application changed after detection');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects a symlinked CLI even when it resolves inside an expected install directory', async () => {
    const link = '/Users/test/.local/bin/claude';
    const target = '/Users/test/.local/lib/claude/claude';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      architecture: 'arm64',
      home: '/Users/test',
      preferredSurface: null,
      probe: probe({ claude: link }, [link, target], {}, {}, { [link]: target }, {
        [link]: {
          status: {
            isFile: false,
            executable: true,
            mode: 0o120755,
            size: 64,
            isSymbolicLink: true,
          },
        },
      }),
    });
    expect(inventory.surfaces.find((surface) => surface.id === 'claude-cli')?.installed).toBe(false);
  });

  it('rejects a reviewed CLI symlink whose target escapes every reviewed install root', async () => {
    const link = '/home/test/.local/bin/claude';
    const escapedTarget = '/tmp/lookalike-claude';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        { claude: escapedTarget },
        [link, escapedTarget],
        {},
        {},
        { [link]: escapedTarget },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'claude-cli')?.installed).toBe(false);
  });

  it.each([
    ['wrong bundle', { bundleIdentifier: 'com.example.Claude', teamIdentifier: 'Q6L2SF6YDW', architectures: ['arm64'] as const, urlSchemes: ['claude'] }],
    ['wrong team', { bundleIdentifier: 'com.anthropic.claudefordesktop', teamIdentifier: 'BADTEAM123', architectures: ['arm64'] as const, urlSchemes: ['claude'] }],
    ['wrong architecture', { bundleIdentifier: 'com.anthropic.claudefordesktop', teamIdentifier: 'Q6L2SF6YDW', architectures: ['x64'] as const, urlSchemes: ['claude'] }],
    ['missing URL scheme', { bundleIdentifier: 'com.anthropic.claudefordesktop', teamIdentifier: 'Q6L2SF6YDW', architectures: ['arm64'] as const, urlSchemes: [] }],
  ])('rejects a macOS Claude app with %s', async (_reason, identity) => {
    const application = '/Applications/Claude.app';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      architecture: 'arm64',
      home: '/Users/test',
      preferredSurface: null,
      probe: probe({}, [application], {}, {}, {}, {
        [application]: {
          macIdentity: {
            ...identity,
            executablePath: `${application}/Contents/MacOS/Claude`,
          },
        },
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'claude-desktop')?.installed).toBe(false);
  });

  it('rejects a macOS application whose signed executable escapes its bundle', async () => {
    const application = '/Applications/Claude.app';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      architecture: 'arm64',
      home: '/Users/test',
      preferredSurface: null,
      probe: probe({}, [application, '/tmp/Claude'], {}, {}, {}, {
        [application]: {
          macIdentity: {
            bundleIdentifier: 'com.anthropic.claudefordesktop',
            teamIdentifier: 'Q6L2SF6YDW',
            executablePath: '/tmp/Claude',
            architectures: ['arm64'],
            urlSchemes: ['claude'],
          },
        },
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'claude-desktop')?.installed).toBe(false);
  });

  it('revalidates a signed macOS application immediately before dispatch', async () => {
    const application = '/Applications/Claude.app';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      architecture: 'arm64',
      home: '/Users/test',
      projectDirectory: '/work/app',
      preferredSurface: null,
      probe: probe({}, [application]),
    });
    const plan = buildAiLaunchPlan(inventory, 'claude-desktop');
    spawnMock.mockReset();

    await expect(executeAiLaunchPlan(plan, 'darwin', {
      probe: probe({}, [application], {}, {}, {}, {
        [application]: {
          macIdentity: {
            bundleIdentifier: 'com.anthropic.claudefordesktop',
            teamIdentifier: 'BADTEAM123',
            executablePath: `${application}/Contents/MacOS/Claude`,
            architectures: ['arm64'],
            urlSchemes: ['claude'],
          },
        },
      }),
    })).rejects.toThrow('authenticated application changed after detection');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('falls back from a stale preference to the best installed surface', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: 'codex-desktop',
      probe: probe({ grok: '/home/test/.grok/bin/grok' }),
    });
    expect(inventory.preferredSurface).toBeNull();
    expect(inventory.recommendedSurface).toBe('vscode-copilot');
  });

  it('rejects Linux VS Code when repository metadata is not bound to its exact package payload', async () => {
    const codeCommand = '/usr/bin/code';
    const resolvedCode = '/usr/share/code/bin/code';
    const builtInCopilot = '/usr/share/code/resources/app/extensions/copilot';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        { code: codeCommand },
        [builtInCopilot, resolvedCode],
        { [codeCommand]: '' },
        {},
        { [codeCommand]: resolvedCode },
        {
          [resolvedCode]: {
            linuxPackageIdentity: {
              packageName: 'code',
              architecture: 'arm64',
              version: '1.135.0',
              manager: 'dpkg',
              ownedPath: resolvedCode,
              origin: 'https://packages.microsoft.com/repos/code',
              signatureVerified: true,
              signingKeyFingerprint: 'BC528686B50D79E339D3721CEB3E94ADBE1229CF',
            },
          },
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')).toMatchObject({
      installed: false,
      executable: null,
      recommended: true,
    });
  });

  it('accepts and revalidates the exact ARM64 Ubuntu VS Code and Copilot payload', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: linuxVsCodeCatalogProbe(),
    });
    const surface = inventory.surfaces.find((candidate) => candidate.id === 'vscode-copilot');
    expect(surface).toMatchObject({
      installed: true,
      executable: VSCODE_LINUX_EXECUTABLE,
      capabilities: ['initial-prompt'],
      launchSupport: 'project-and-prompt',
      verification: {
        kind: 'vscode-catalog',
        platform: 'linux',
        architecture: 'arm64',
        version: VSCODE_VERSION,
        commit: VSCODE_COMMIT,
      },
    });
    expect(serializeAiSurfaceInventory(inventory, 'v2').surfaces[0]).toMatchObject({
      id: 'vscode-copilot',
      installed: true,
      capabilities: ['initial-prompt'],
    });
    const plan = buildAiLaunchPlan(inventory, 'vscode-copilot');
    expect(plan).toMatchObject({
      mode: 'process',
      command: VSCODE_LINUX_EXECUTABLE,
      args: [VSCODE_LINUX_CLI, 'chat', '-m', 'agent', expect.stringContaining('repository EAI skill')],
      environment: {
        ELECTRON_RUN_AS_NODE: '1',
        VSCODE_DEV: '',
        VSCODE_IPC_HOOK_CLI: '',
      },
      preparedPrompt: true,
    });

    spawnMock.mockReset();
    allowDetachedLaunch();
    await expect(executeAiLaunchPlan(plan, 'linux', {
      probe: linuxVsCodeCatalogProbe(),
    })).resolves.toEqual({ dispatched: true, confirmed: false });
    expect(spawnMock).toHaveBeenCalledWith(
      VSCODE_LINUX_EXECUTABLE,
      plan.args,
      expect.objectContaining({ cwd: '/work/customer-portal', detached: true }),
    );
    spawnMock.mockReset();
    await expect(executeAiLaunchPlan(plan, 'linux', {
      probe: linuxVsCodeCatalogProbe('0'.repeat(64)),
    })).rejects.toThrow('authenticated application changed after detection');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('does not mistake plain VS Code for a Copilot-ready workspace', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe({ code: '/usr/bin/code' }, [], { '/usr/bin/code': '' }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')?.installed).toBe(false);
  });

  it('requires an exact VS Code Copilot extension identifier line', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        { code: '/usr/bin/code' },
        [],
        { '/usr/bin/code': 'example.github.copilot-helper\ngithub.copilot-chat.disabled' },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')?.installed).toBe(false);
  });

  it('recommends the most complete supported workspace when none is installed', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\app',
      preferredSurface: null,
      probe: probe({}),
    });
    expect(inventory.preferredSurface).toBeNull();
    expect(inventory.recommendedSurface).toBe('vscode-copilot');
    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')).toMatchObject({
      installed: false,
      recommended: true,
    });
  });

  it('builds provider-specific plans without executing them', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      architecture: 'arm64',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe(
        { copilot: '/usr/local/bin/copilot', codex: '/usr/local/bin/codex' },
        ['/Applications/Codex.app'],
        {
          '/usr/local/bin/copilot --version': "GitHub Copilot CLI 1.0.81-7.\nRun 'copilot update' to check for updates.",
          '/usr/local/bin/copilot app --help': 'Usage: copilot app [options]\nOpen the GitHub Copilot app in the current directory',
          '/usr/local/bin/codex --version': 'codex-cli 0.150.0-alpha.12.2',
          '/usr/local/bin/codex app --help': 'Usage: codex app [OPTIONS] [PATH]\nLaunch the Desktop app',
        },
      ),
    });
    expect(buildAiLaunchPlan(inventory, 'copilot-cli')).toMatchObject({
      mode: 'terminal',
      command: '/usr/local/bin/copilot',
      args: [],
      preparedPrompt: false,
    });
    expect(buildAiLaunchPlan(inventory, 'codex-desktop')).toMatchObject({
      mode: 'application',
      command: '/Applications/Codex.app',
      args: [],
      preparedPrompt: false,
    });
  });

  it('builds launch contracts only for authenticated macOS workspaces', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      architecture: 'arm64',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe(
        {
          code: '/usr/local/bin/code',
          copilot: '/usr/local/bin/copilot',
          agy: '/Users/test/.local/bin/agy',
          claude: '/usr/local/bin/claude',
          codex: '/usr/local/bin/codex',
          grok: '/Users/test/.grok/bin/grok',
        },
        [
          '/Applications/Visual Studio Code.app',
          '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/copilot',
          '/Applications/GitHub Copilot.app',
          '/Applications/Antigravity.app',
          '/Applications/Claude.app',
          '/Applications/ChatGPT.app',
          '/Applications/Grok Bot.app',
        ],
        {
          '/usr/local/bin/code': 'GitHub.copilot-chat',
          '/usr/local/bin/copilot --version': "GitHub Copilot CLI 1.0.81-7.\nRun 'copilot update' to check for updates.",
          '/usr/local/bin/copilot app --help': 'Usage: copilot app [options]\nOpen the GitHub Copilot app in the current directory',
          '/usr/local/bin/agy --version': '1.1.27',
          '/usr/local/bin/agy --help': 'Usage of antigravity:\n  -i string\n  --prompt-interactive string',
          '/usr/local/bin/claude --version': '2.1.261 (Claude Code)',
          '/usr/local/bin/claude --help': 'Usage: claude [options] [command] [prompt]',
          '/usr/local/bin/codex --version': 'codex-cli 0.150.0-alpha.12.2',
          '/usr/local/bin/codex app --help': 'Usage: codex app [OPTIONS] [PATH]\nLaunch the Desktop app',
          '/usr/local/bin/grok --version': 'grok 1.0.13 (5e9a58528b76)',
          '/usr/local/bin/grok --help': 'Usage: grok [OPTIONS] [PROMPT] [COMMAND]\nArguments:\n  [PROMPT]  Initial prompt for the interactive session',
        },
      ),
    });

    const authenticatedIds = [
      'vscode-copilot',
      'copilot-desktop',
      'antigravity-desktop',
      'claude-desktop',
      'codex-desktop',
      'grok-bot',
      'copilot-cli',
      'claude-cli',
      'codex-cli',
    ] as const;
    const plans = Object.fromEntries(authenticatedIds.map((surfaceId) => [
      surfaceId,
      buildAiLaunchPlan(inventory, surfaceId),
    ]));
    expect(plans).toMatchObject({
      'vscode-copilot': { mode: 'process', preparedPrompt: false },
      'copilot-cli': { mode: 'terminal', preparedPrompt: false },
      'copilot-desktop': { mode: 'application', command: '/Applications/GitHub Copilot.app', preparedPrompt: false },
      'antigravity-desktop': { mode: 'application', preparedPrompt: false },
      'claude-desktop': { mode: 'application', command: '/Applications/Claude.app', preparedPrompt: true },
      'claude-cli': { mode: 'terminal', preparedPrompt: false },
      'codex-desktop': { mode: 'application', preparedPrompt: false },
      'codex-cli': { mode: 'terminal', preparedPrompt: false },
      'grok-bot': { mode: 'application', preparedPrompt: false },
    });
    expect(() => buildAiLaunchPlan(inventory, 'antigravity-cli')).toThrow('is not installed');
    expect(() => buildAiLaunchPlan(inventory, 'grok-cli')).toThrow('is not installed');
  });

  it('uses the authenticated Claude Desktop contract and rejects unproven macOS CLIs', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      architecture: 'arm64',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe(
        { agy: '/Users/test/.local/bin/agy', grok: '/Users/test/.grok/bin/grok' },
        ['/Applications/Claude.app'],
      ),
    });
    expect(buildAiLaunchPlan(inventory, 'claude-desktop')).toMatchObject({
      mode: 'application',
      command: '/Applications/Claude.app',
      preparedPrompt: true,
      args: [expect.stringMatching(/^claude:\/\/code\/new\?/)],
    });
    expect(() => buildAiLaunchPlan(inventory, 'antigravity-cli')).toThrow('is not installed');
    expect(() => buildAiLaunchPlan(inventory, 'grok-cli')).toThrow('is not installed');
  });

  it('does not mistake an unrelated grok command for the official Grok Build CLI', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe({ grok: '/usr/bin/grok' }, [], { '/usr/bin/grok': 'community grok tool 2.0' }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'grok-cli')?.installed).toBe(false);
  });

  it('rejects Grok Build on Linux without immutable package or artifact identity', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe(
        { grok: '/home/test/.grok/bin/grok' },
        [],
        {
          '/home/test/.grok/bin/grok --version': 'grok 1.0.0 (abc123)',
          '/home/test/.grok/bin/grok --help': 'Usage: grok [OPTIONS] [COMMAND]\n  --cwd <PATH>',
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'grok-cli')).toMatchObject({
      installed: false,
      capabilities: [],
      launchSupport: 'project-and-prompt',
    });
    expect(() => buildAiLaunchPlan(inventory, 'grok-cli')).toThrow('is not installed');
  });

  it('rejects Antigravity CLI on Linux without immutable package or artifact identity', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe(
        { agy: '/home/test/.local/bin/agy' },
        [],
        {
          '/home/test/.local/bin/agy --version': '1.0.3',
          '/home/test/.local/bin/agy --help': 'Usage of antigravity:\n  --version',
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'antigravity-cli')).toMatchObject({
      installed: false,
      capabilities: [],
      launchSupport: 'project-and-prompt',
    });
    expect(() => buildAiLaunchPlan(inventory, 'antigravity-cli')).toThrow('is not installed');
  });

  it('does not mistake an unrelated agy command for the official Antigravity CLI', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        { agy: '/usr/bin/agy' },
        [],
        {
          '/usr/bin/agy --version': '9.9.9',
          '/usr/bin/agy --help': 'Usage: agy [OPTIONS]',
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'antigravity-cli')?.installed).toBe(false);
  });

  it('rejects an unproven Windows Copilot CLI while retaining the signed desktop app', async () => {
    const copilotCli = 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WinGet\\Links\\copilot.exe';
    const copilotApp = 'C:\\Users\\test\\AppData\\Local\\Programs\\GitHub Copilot\\github.exe';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: probe(
        { copilot: copilotCli },
        [copilotApp],
        { [`${copilotCli} --version`]: 'GitHub Copilot CLI 1.0.80.' },
        {},
        {},
        {
          [copilotApp]: {
            windowsIdentity: {
              productName: 'GitHub Copilot',
              publisher: 'CN=GitHub, Inc., O=GitHub, Inc., C=US',
            },
          },
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-cli')).toMatchObject({
      installed: false,
      capabilities: [],
    });
    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-desktop')).toMatchObject({
      installed: true,
      launchSupport: 'manual-project',
    });
    expect(buildAiLaunchPlan(inventory, 'copilot-desktop')).toMatchObject({
      mode: 'application',
      command: copilotApp,
      preparedPrompt: false,
    });
  });

  it('keeps macOS Codex CLI capabilities conservative without signed version metadata', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      architecture: 'arm64',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe(
        { codex: '/usr/local/bin/codex' },
        ['/Applications/ChatGPT.app'],
        { '/usr/local/bin/codex --version': 'codex-cli 0.149.0' },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'codex-cli')).toMatchObject({
      installed: true,
      capabilities: [],
    });
    expect(inventory.surfaces.find((surface) => surface.id === 'codex-desktop')).toMatchObject({
      installed: true,
      launchSupport: 'manual-project',
    });
    expect(buildAiLaunchPlan(inventory, 'codex-desktop')).toMatchObject({
      mode: 'application',
      command: '/Applications/ChatGPT.app',
      preparedPrompt: false,
    });
  });

  it('rejects Claude Code on Linux without signed-index payload binding', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe(
        { claude: '/home/test/.local/bin/claude' },
        [],
        {
          '/usr/local/bin/claude --version': '2.1.261 (Claude Code)',
          '/usr/local/bin/claude --help': 'Usage: claude [options] [command]',
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'claude-cli')).toMatchObject({
      installed: false,
      capabilities: [],
      launchSupport: 'project-and-prompt',
    });
    expect(() => buildAiLaunchPlan(inventory, 'claude-cli')).toThrow('is not installed');
  });

  it('rejects the obsolete Antigravity apt package and unauthenticated agy binary', async () => {
    const antigravity = '/usr/bin/antigravity';
    const realAntigravity = '/usr/share/antigravity/bin/antigravity';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        { agy: '/home/test/.local/bin/agy' },
        [
          antigravity,
          '/usr/share/applications/antigravity.desktop',
          '/usr/bin/claude-desktop',
          '/usr/bin/chatgpt',
          '/usr/bin/grok-bot',
          '/usr/share/applications/grok-bot.desktop',
        ],
        {
          '/home/test/.local/bin/agy --version': '1.1.27',
          '/home/test/.local/bin/agy --help': 'Usage of antigravity:\n  -i string\n  --prompt-interactive string',
          'dpkg-query -W -f=${Package}\t${Architecture}\t${Version} claude-desktop': 'claude-desktop\tarm64\t0.13.88',
          'dpkg-query -W -f=${Package}\t${Architecture}\t${Version} chatgpt': 'chatgpt\tarm64\t1.2026.238',
          'dpkg-query -W -f=${Package}\t${Architecture}\t${Version} grok-bot': 'grok-bot\tarm64\t0.43.0',
        },
        {
          '/usr/share/applications/antigravity.desktop': '[Desktop Entry]\nName=Antigravity\nExec=/usr/share/antigravity/antigravity %F',
          '/usr/share/applications/grok-bot.desktop': '[Desktop Entry]\nName=Grok Bot\nExec=grok-bot %U',
        },
        { [antigravity]: realAntigravity },
        {
          [antigravity]: {
            linuxPackageIdentity: {
              packageName: 'antigravity',
              architecture: 'arm64',
              version: '2.12.2-1',
              manager: 'dpkg',
              ownedPath: realAntigravity,
              origin: 'https://us-central1-apt.pkg.dev/projects/antigravity-auto-updater-dev/ antigravity-debian',
              signatureVerified: true,
            },
          },
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'antigravity-cli')?.installed).toBe(false);
    for (const surfaceId of ['antigravity-desktop', 'claude-desktop', 'codex-desktop', 'grok-bot']) {
      expect(inventory.surfaces.find((surface) => surface.id === surfaceId)?.installed).toBe(false);
    }
  });

  it('fails closed for a portable Antigravity Linux executable without package identity', async () => {
    const executable = '/home/test/Downloads/Antigravity-arm64/antigravity';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe({}, [executable]),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'antigravity-desktop')).toMatchObject({
      installed: false,
      executable: null,
    });
  });

  it('accepts and pre-dispatch revalidates the immutable Antigravity 2 Linux ARM payload', async () => {
    const executable = '/home/test/Applications/Antigravity-arm64/antigravity';
    const digest = 'e706505fdd89003390c256b084ee44625e4ab0aacd068b8f62290af8b0a6f6ed';
    const evidence = {
      [executable]: {
        status: { isFile: true, executable: true, mode: 0o100755, size: 197_528_864 },
        header: elfHeader(183),
        sha256: digest,
      },
    };
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe({}, [executable], {}, {}, {}, evidence),
    });
    const surface = inventory.surfaces.find((candidate) => candidate.id === 'antigravity-desktop');
    const plan = buildAiLaunchPlan(inventory, 'antigravity-desktop');

    expect(surface).toMatchObject({
      installed: true,
      executable,
      verification: {
        kind: 'portable-elf',
        size: 197_528_864,
        sha256: digest,
        architecture: 'arm64',
      },
    });
    expect(plan.verification).toMatchObject({ kind: 'portable-elf', sha256: digest });

    await expect(executeAiLaunchPlan(plan, 'linux', {
      probe: probe({}, [executable], {}, {}, {}, {
        [executable]: { ...evidence[executable], sha256: '0'.repeat(64) },
      }),
    })).rejects.toThrow('authenticated application changed after detection');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects the Antigravity Linux payload for the wrong architecture', async () => {
    const executable = '/home/test/Applications/Antigravity-arm64/antigravity';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'x64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe({}, [executable], {}, {}, {}, {
        [executable]: {
          status: { isFile: true, executable: true, mode: 0o100755, size: 197_528_864 },
          header: elfHeader(183),
          sha256: 'e706505fdd89003390c256b084ee44625e4ab0aacd068b8f62290af8b0a6f6ed',
        },
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'antigravity-desktop')?.installed).toBe(false);
  });

  it('accepts the immutable Antigravity 2 Linux x64 payload', async () => {
    const executable = '/home/test/Applications/Antigravity-x64/antigravity';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'x64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe({}, [executable], {}, {}, {}, {
        [executable]: {
          status: { isFile: true, executable: true, mode: 0o100755, size: 206_036_184 },
          header: elfHeader(62),
          sha256: 'b0d127772d2983a93771055a93b673d5fdd1726d6e47db8e269b204e665972d6',
        },
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'antigravity-desktop')).toMatchObject({
      installed: true,
      executable,
      verification: { kind: 'portable-elf', architecture: 'x64' },
    });
  });

  it('fails closed for a Windows Grok Bot executable until its signer identity is captured', async () => {
    const executable = 'C:\\Users\\test\\AppData\\Local\\Programs\\Grok Bot\\Grok Bot.exe';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      preferredSurface: null,
      probe: probe({}, [executable]),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'grok-bot')).toMatchObject({
      installed: false,
      executable: null,
      launchSupport: 'launch-only',
    });
  });

  it('rejects an unrelated Linux executable named grok-bot', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe({}, ['/usr/bin/grok-bot']),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'grok-bot')?.installed).toBe(false);
  });

  it('fails closed for a Grok Bot RPM without a proven repository and signer identity', async () => {
    const executable = '/opt/Grok Bot/grok-bot';
    const desktopEntry = '/usr/share/applications/grok-bot.desktop';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        {},
        [executable, desktopEntry],
        { rpm: 'grok-bot\taarch64\t0.43.0-1' },
        { [desktopEntry]: '[Desktop Entry]\nName=Grok Bot\nExec="/opt/Grok Bot/grok-bot" %U' },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'grok-bot')).toMatchObject({
      installed: false,
      executable: null,
    });
  });

  it('recognises a registered official Grok Bot Linux AppImage', async () => {
    const executable = '/home/test/Applications/Grok Bot-0.43.0-arm64.AppImage';
    const desktopEntry = '/home/test/.xdg/share/applications/appimagekit-grok-bot.desktop';
    const digest = '798757a576dd4a2f3953344af45197dd4dcf1fba792da850f20733a033ea4236';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      environment: { XDG_DATA_HOME: '/home/test/.xdg/share' },
      preferredSurface: null,
      probe: probe(
        {},
        [executable],
        {},
        {
          [desktopEntry]: [
            '[Desktop Entry]',
            'Type=Application',
            'Name=Grok Bot',
            'Icon=grok-bot',
            'StartupWMClass=Grok Bot',
            'Terminal=false',
            'X-AppImage-Version=0.43.0',
            `X-AppImage-SHA256=${digest}`,
            `Exec="${executable}" --ozone-platform-hint=auto %U`,
          ].join('\n'),
        },
        {},
        {
          [executable]: {
            status: { isFile: true, executable: true, mode: 0o100755, size: 132_756_388 },
            header: appImageHeader(183),
            sha256: digest,
          },
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'grok-bot')).toMatchObject({
      installed: true,
      executable,
      launchArgsPrefix: ['--ozone-platform-hint=auto'],
      launchSupport: 'launch-only',
    });
    expect(buildAiLaunchPlan(inventory, 'grok-bot')).toMatchObject({
      mode: 'application',
      command: executable,
      args: ['--ozone-platform-hint=auto'],
    });
  });

  it('revalidates a Grok Bot AppImage immediately before dispatch', async () => {
    const executable = '/home/test/Applications/Grok Bot-0.43.0-arm64.AppImage';
    const desktopEntry = '/home/test/.local/share/applications/grok-bot.desktop';
    const digest = '798757a576dd4a2f3953344af45197dd4dcf1fba792da850f20733a033ea4236';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        {},
        [executable],
        {},
        { [desktopEntry]: `[Desktop Entry]\nType=Application\nName=Grok Bot\nX-AppImage-Version=0.43.0\nExec="${executable}" %U` },
        {},
        {
          [executable]: {
            status: { isFile: true, executable: true, mode: 0o100755, size: 132_756_388 },
            header: appImageHeader(183),
            sha256: digest,
          },
        },
      ),
    });
    const plan = buildAiLaunchPlan(inventory, 'grok-bot');
    const changedProbe = probe({}, [executable], {}, {}, {}, {
      [executable]: {
        status: { isFile: true, executable: true, mode: 0o100755, size: 132_756_388 },
        header: appImageHeader(183),
        sha256: 'b'.repeat(64),
      },
    });
    spawnMock.mockReset();

    await expect(executeAiLaunchPlan(plan, 'linux', { probe: changedProbe })).rejects.toThrow(
      'authenticated application changed after detection',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('recognises a minimal localized XDG registration for the verified x64 Grok Bot AppImage', async () => {
    const executable = '/home/test/Applications/Grok_Bot_0.43.0_x64.AppImage';
    const desktopEntry = '/home/test/.local/share/applications/grok-bot.desktop';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'x64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        {},
        [executable],
        {},
        {
          [desktopEntry]: [
            '[Desktop Entry]',
            'Type=Application',
            'Name=Grok Bot',
            'Name[fr]=Grok Bot',
            `Exec=${executable} %U`,
          ].join('\n'),
        },
        {},
        {
          [executable]: {
            status: { isFile: true, executable: true, mode: 0o100755, size: 132_012_959 },
            header: appImageHeader(62),
            sha256: 'd810e4e1f49da15bc178f54cfc5840c780fb8efe1341d4220898fc4f244ba75b',
          },
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'grok-bot')).toMatchObject({
      installed: true,
      executable,
    });
  });

  it('rejects an unregistered or mislabeled Linux AppImage', async () => {
    const executable = '/home/test/Applications/Grok Bot.AppImage';
    const desktopEntry = '/home/test/.local/share/applications/unrelated.desktop';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        {},
        [executable],
        {},
        {
          [desktopEntry]: `[Desktop Entry]\nName=Unrelated App\nExec="${executable}" %U\nType=Application`,
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'grok-bot')?.installed).toBe(false);
  });

  it.each([
    ['wrong architecture', appImageHeader(62), 0o100755, '798757a576dd4a2f3953344af45197dd4dcf1fba792da850f20733a033ea4236', '798757a576dd4a2f3953344af45197dd4dcf1fba792da850f20733a033ea4236'],
    ['world-writable file', appImageHeader(183), 0o100777, '798757a576dd4a2f3953344af45197dd4dcf1fba792da850f20733a033ea4236', '798757a576dd4a2f3953344af45197dd4dcf1fba792da850f20733a033ea4236'],
    ['unknown provider digest', appImageHeader(183), 0o100755, 'a'.repeat(64), 'a'.repeat(64)],
    ['declared digest mismatch', appImageHeader(183), 0o100755, '798757a576dd4a2f3953344af45197dd4dcf1fba792da850f20733a033ea4236', 'b'.repeat(64)],
  ])('rejects a registered Grok Bot AppImage with %s', async (_reason, header, mode, actualDigest, declaredDigest) => {
    const executable = '/home/test/Applications/Grok Bot-0.43.0-arm64.AppImage';
    const desktopEntry = '/home/test/.local/share/applications/grok-bot.desktop';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        {},
        [executable],
        {},
        {
          [desktopEntry]: [
            '[Desktop Entry]',
            'Type=Application',
            'Name=Grok Bot',
            'Icon=grok-bot',
            'X-AppImage-Version=0.43.0',
            `X-AppImage-SHA256=${declaredDigest}`,
            `Exec="${executable}" %U`,
          ].join('\n'),
        },
        {},
        {
          [executable]: {
            status: { isFile: true, executable: true, mode, size: 132_756_388 },
            header,
            sha256: actualDigest,
          },
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'grok-bot')?.installed).toBe(false);
  });

  it.each([
    ['non-application type', 'Type=Link', `Exec="/home/test/Applications/Grok Bot.AppImage" %U`],
    ['relative executable', 'Type=Application', 'Exec=grok-bot.AppImage %U'],
    ['malformed quoting', 'Type=Application', 'Exec="/home/test/Applications/Grok Bot.AppImage %U'],
    ['embedded field code', 'Type=Application', `Exec="/home/test/Applications/Grok Bot.AppImage" --open=%U`],
    ['unsafe static option', 'Type=Application', `Exec="/home/test/Applications/Grok Bot.AppImage" --remote-debugging-port=9222 %U`],
  ])('rejects Grok Bot AppImage desktop metadata with %s', async (_reason, type, execLine) => {
    const executable = '/home/test/Applications/Grok Bot.AppImage';
    const desktopEntry = '/home/test/.local/share/applications/grok-bot.desktop';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        {},
        [executable],
        {},
        {
          [desktopEntry]: [
            '[Desktop Entry]',
            type,
            'Name=Grok Bot',
            'Icon=grok-bot',
            'X-AppImage-Version=0.43.0',
            execLine,
          ].join('\n'),
        },
        {},
        {
          [executable]: {
            status: { isFile: true, executable: true, mode: 0o100755, size: 132_756_388 },
            header: appImageHeader(183),
            sha256: '798757a576dd4a2f3953344af45197dd4dcf1fba792da850f20733a033ea4236',
          },
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'grok-bot')?.installed).toBe(false);
  });

  it.each([
    ['another-package\tarm64\t0.43.0', '[Desktop Entry]\nName=Grok Bot\nExec=grok-bot %U'],
    ['grok-bot\tarm64\t0.43.0', '[Desktop Entry]\nName=Grok Bot\nExec=/tmp/unrelated-grok-bot %U'],
  ])('rejects a spoofed Grok Bot Linux package or desktop entry', async (packageOutput, desktopContent) => {
    const executable = '/usr/bin/grok-bot';
    const desktopEntry = '/usr/share/applications/grok-bot.desktop';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        {},
        [executable, desktopEntry],
        { 'dpkg-query': packageOutput },
        { [desktopEntry]: desktopContent },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'grok-bot')?.installed).toBe(false);
  });

  it('rejects the obsolete packaged Antigravity Linux launcher', async () => {
    const executable = '/usr/bin/antigravity';
    const ownedPath = '/usr/share/antigravity/bin/antigravity';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        {},
        [executable, '/usr/share/applications/antigravity.desktop'],
        { 'dpkg-query': 'antigravity\tarm64\t1.107.0-1' },
        {
          '/usr/share/applications/antigravity.desktop': [
            '[Desktop Entry]',
            'Name=Antigravity',
            'Exec=/usr/share/antigravity/antigravity %F',
          ].join('\n'),
        },
        { [executable]: ownedPath },
        {
          [executable]: {
            linuxPackageIdentity: {
              packageName: 'antigravity',
              architecture: 'arm64',
              version: '2.12.2-1',
              manager: 'dpkg',
              ownedPath,
              origin: 'https://us-central1-apt.pkg.dev/projects/antigravity-auto-updater-dev/ antigravity-debian',
              signatureVerified: true,
            },
          },
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'antigravity-desktop')).toMatchObject({
      installed: false,
      executable: null,
    });
  });

  it.each([
    ['darwin', '/Users/test'],
    ['linux', '/home/test'],
  ] as const)('requires authenticated provider-native CLIs outside PATH on %s', async (platform, home) => {
    const copilot = `${home}/.local/bin/copilot`;
    const claude = `${home}/.local/bin/claude`;
    const codex = `${home}/.local/bin/codex`;
    const inventory = await detectAiSurfaces({
      platform,
      architecture: 'arm64',
      home,
      preferredSurface: null,
      probe: probe(
        {},
        [copilot, claude, codex],
        {
          [`${copilot} --version`]: 'GitHub Copilot CLI 1.0.81-7.',
          [`${claude} --version`]: '2.1.261 (Claude Code)',
          [`${claude} --help`]: 'Usage: claude [options] [command] [prompt]',
          [`${codex} --version`]: 'codex-cli 0.153.4',
        },
      ),
    });

    for (const [surfaceId, executable] of [
      ['copilot-cli', copilot],
      ['claude-cli', claude],
      ['codex-cli', codex],
    ] as const) {
      expect(inventory.surfaces.find((surface) => surface.id === surfaceId)).toMatchObject({
        installed: platform === 'darwin',
        executable: platform === 'darwin' ? executable : null,
      });
    }
  });

  it('rejects native Windows CLIs without captured exact signer/package provenance', async () => {
    const claude = 'C:\\Users\\test\\.local\\bin\\claude.exe';
    const codex = 'D:\\Profiles\\test\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe';
    const copilot = 'D:\\Profiles\\test\\Local\\Microsoft\\WinGet\\Links\\copilot.exe';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      environment: { localappdata: 'D:\\Profiles\\test\\Local' },
      preferredSurface: null,
      probe: probe(
        {},
        [claude, codex, copilot],
        {
          [`${copilot} --version`]: 'GitHub Copilot CLI 1.0.81-7.',
          [`${claude} --version`]: '2.1.261 (Claude Code)',
          [`${claude} --help`]: 'Usage: claude [options] [command] [prompt]',
          [`${codex} --version`]: 'codex-cli 0.153.4',
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-cli')?.executable).toBeNull();
    expect(inventory.surfaces.find((surface) => surface.id === 'claude-cli')?.executable).toBeNull();
    expect(inventory.surfaces.find((surface) => surface.id === 'codex-cli')?.executable).toBeNull();
  });

  it('rejects a Windows npm Copilot shim without a package-integrity binding', async () => {
    const copilot = 'E:\\Profiles\\test\\Roaming\\npm\\copilot.cmd';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      environment: { APPDATA: 'E:\\Profiles\\test\\Roaming' },
      preferredSurface: null,
      probe: probe(
        {},
        [copilot],
        { [`${copilot} --version`]: 'GitHub Copilot CLI 1.0.81-7.' },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-cli')).toMatchObject({
      installed: false,
      executable: null,
    });
  });

  it('builds a non-interpolating trusted system cmd invocation for Windows command shims', () => {
    const invocation = buildCommandOutputInvocation(
      'C:\\Users\\Test User\\AppData\\Roaming\\npm\\copilot.cmd',
      ['app', '--help', 'value & whoami'],
      'win32',
      { COMSPEC: 'D:\\Windows\\System32\\cmd.exe' },
    );

    expect(invocation).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/v:off',
        '/s',
        '/c',
        '"C:\\Users\\Test^ User\\AppData\\Roaming\\npm\\copilot.cmd ^"app^" ^"--help^" ^"value^ ^&^ whoami^""',
      ],
      windowsVerbatimArguments: true,
    });
    expect(invocation.args.at(-1)).not.toContain('value & whoami');
    expect(() => buildCommandOutputInvocation(
      'C:\\Tools\\probe.bat',
      ['--version\r\n& whoami'],
      'win32',
      {},
    )).toThrow('control characters');
  });

  it('ignores an environment-supplied ComSpec for native Windows executables', () => {
    const invocation = buildWindowsCommandInvocation(
      'C:\\Program Files\\OpenAI\\Codex\\codex.exe',
      ['value & whoami'],
      '/k',
      { ComSpec: 'D:\\Windows\\System32\\cmd.exe' },
    );

    expect(invocation).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/v:off',
        '/s',
        '/k',
        '"^"C:\\Program^ Files\\OpenAI\\Codex\\codex.exe^" ^"value^ ^&^ whoami^""',
      ],
      windowsVerbatimArguments: true,
    });
    expect(invocation.args.at(-1)).not.toContain('value & whoami');
  });

  it('refuses to launch a Windows command shim without authenticated package evidence', async () => {
    const command = 'C:\\Users\\Test User\\AppData\\Roaming\\npm\\copilot.cmd';
    const plan: LaunchPlan = {
      surfaceId: 'copilot-desktop',
      surfaceName: 'GitHub Copilot app',
      projectDirectory: 'C:\\work\\Customer Portal',
      mode: 'process',
      command,
      args: ['app', 'value & whoami'],
      environment: { ComSpec: 'D:\\Windows\\System32\\cmd.exe', EAI_TEST: '1' },
      cwd: 'C:\\work\\Customer Portal',
      preparedPrompt: false,
      userMessage: 'GitHub Copilot will open.',
    };

    spawnMock.mockReset();
    allowDetachedLaunch();
    await expect(executeAiLaunchPlan(plan, 'win32')).rejects.toThrow('authenticated application');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'C:\\Users\\Test User\\AppData\\Roaming\\npm\\copilot.cmd',
      '"C:\\Users\\Test^ User\\AppData\\Roaming\\npm\\copilot.cmd ^"value^ ^&^ whoami^""',
    ],
    [
      'C:\\Program Files\\OpenAI\\Codex\\codex.exe',
      '"^"C:\\Program^ Files\\OpenAI\\Codex\\codex.exe^" ^"value^ ^&^ whoami^""',
    ],
  ])('refuses the Windows terminal handoff without identity for %s', async (command, _commandLine) => {
    const plan: LaunchPlan = {
      surfaceId: 'codex-cli',
      surfaceName: 'Codex CLI',
      projectDirectory: 'C:\\work\\Customer Portal',
      mode: 'terminal',
      command,
      args: ['value & whoami'],
      environment: { COMSPEC: 'D:\\Windows\\System32\\cmd.exe' },
      cwd: 'C:\\work\\Customer Portal',
      preparedPrompt: true,
      userMessage: 'A terminal will open.',
    };

    spawnMock.mockReset();
    allowDetachedLaunch();
    await expect(executeAiLaunchPlan(plan, 'win32')).rejects.toThrow('authenticated application');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it.each([
    ['xdg-terminal-exec', ['--', '/home/test/.local/bin/claude', 'value; touch /tmp/not-run', '--safe']],
    ['kgx', ['--working-directory=/work/Customer Portal', '--', '/home/test/.local/bin/claude', 'value; touch /tmp/not-run', '--safe']],
    ['gnome-terminal', ['--working-directory=/work/Customer Portal', '--', '/home/test/.local/bin/claude', 'value; touch /tmp/not-run', '--safe']],
    ['konsole', ['--workdir', '/work/Customer Portal', '-e', '/home/test/.local/bin/claude', 'value; touch /tmp/not-run', '--safe']],
    ['kitty', ['--directory', '/work/Customer Portal', '--', '/home/test/.local/bin/claude', 'value; touch /tmp/not-run', '--safe']],
    ['wezterm', ['start', '--cwd', '/work/Customer Portal', '--', '/home/test/.local/bin/claude', 'value; touch /tmp/not-run', '--safe']],
    ['alacritty', ['--working-directory', '/work/Customer Portal', '-e', '/home/test/.local/bin/claude', 'value; touch /tmp/not-run', '--safe']],
    ['xfce4-terminal', ['--working-directory', '/work/Customer Portal', '--execute', '/home/test/.local/bin/claude', 'value; touch /tmp/not-run', '--safe']],
    ['mate-terminal', ['--working-directory=/work/Customer Portal', '--', '/home/test/.local/bin/claude', 'value; touch /tmp/not-run', '--safe']],
    ['foot', ['--working-directory=/work/Customer Portal', '--', '/home/test/.local/bin/claude', 'value; touch /tmp/not-run', '--safe']],
    ['x-terminal-emulator', ['-e', '/home/test/.local/bin/claude', 'value; touch /tmp/not-run', '--safe']],
    ['xterm', ['-e', '/home/test/.local/bin/claude', 'value; touch /tmp/not-run', '--safe']],
  ] as const)('adapts a Linux terminal launch for %s without shell interpolation', (terminal, args) => {
    const resolvedTerminal = terminal === 'x-terminal-emulator' ? '/usr/bin/xterm' : `/usr/bin/${terminal}`;
    const invocation = buildLinuxTerminalInvocation(
      terminalLaunchPlan(),
      (candidate) => candidate === terminal ? resolvedTerminal : null,
    );

    expect(invocation).toEqual({ command: resolvedTerminal, args });
    expect(invocation.args).toContain('value; touch /tmp/not-run');
  });

  it('rejects a PATH-hijacked Linux terminal outside canonical system paths', () => {
    expect(() => buildLinuxTerminalInvocation(
      terminalLaunchPlan(),
      () => '/home/test/.local/bin/gnome-terminal',
    )).toThrow('could not find a supported Linux terminal emulator');
  });

  it('refuses an unauthenticated Linux CLI before selecting a terminal', async () => {
    const plan = terminalLaunchPlan();
    spawnMock.mockReset();
    allowDetachedLaunch();

    await expect(executeAiLaunchPlan(plan, 'linux', {
      commandPath: (command) => ({
        'gnome-terminal': '/usr/bin/gnome-terminal',
        xterm: '/usr/bin/xterm',
      })[command] ?? null,
    })).rejects.toThrow('authenticated application');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('fails safely when no supported Linux terminal is available', () => {
    expect(() => buildLinuxTerminalInvocation(terminalLaunchPlan(), () => null)).toThrow(
      'could not find a supported Linux terminal emulator',
    );
  });

  it('fails closed for Linux Copilot packages until a trusted origin and signer are recorded', async () => {
    const files = ['/usr/bin/github', '/usr/share/applications/GitHub Copilot.desktop'];
    const unrelated = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe({}, files, { 'dpkg-query': 'another-package\tarm64\t1.1.15' }),
    });
    const official = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe({}, files, { 'dpkg-query': 'github\tarm64\t1.1.15' }),
    });

    expect(unrelated.surfaces.find((surface) => surface.id === 'copilot-desktop')?.installed).toBe(false);
    expect(official.surfaces.find((surface) => surface.id === 'copilot-desktop')?.installed).toBe(false);
  });

  it('accepts only the immutable official Linux ARM Copilot application payload', async () => {
    const executable = '/usr/bin/github';
    const desktopEntry = '/usr/share/applications/GitHub Copilot.desktop';
    const identity: LinuxPackageIdentity = {
      packageName: 'github',
      architecture: 'arm64',
      version: '1.1.15',
      manager: 'dpkg',
      ownedPath: executable,
      origin: 'https://github.com/github/app/releases/tag/v1.1.15',
      signatureVerified: false,
      catalogArtifactSha256: '587445c4ad98917638204f6a66f15b1868b8795b317725cbed37fc635df07e10',
      executableSha256: 'accf69bea75cb15c2afbb88b9011fa98a0705d8196ace29c49fb802548b27f0c',
    };
    const contents = {
      [desktopEntry]: [
        '[Desktop Entry]',
        'Exec=github %u',
        'MimeType=x-scheme-handler/github-app;x-scheme-handler/ghapp;x-scheme-handler/gh',
        'Name=GitHub Copilot',
        'Terminal=false',
        'Type=Application',
      ].join('\n'),
    };
    const valid = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        { github: executable },
        [executable, desktopEntry],
        { 'linux-handler:ghapp': 'GitHub Copilot.desktop' },
        contents,
        {},
        { [executable]: { linuxPackageIdentity: identity, sha256: identity.executableSha256 } },
      ),
    });
    const wrongDigest = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe({}, [executable], {}, {}, {}, {
        [executable]: {
          linuxPackageIdentity: { ...identity, executableSha256: '0'.repeat(64) },
        },
      }),
    });

    expect(valid.surfaces.find((surface) => surface.id === 'copilot-desktop')).toMatchObject({
      installed: true,
      executable,
      deepLinkScheme: 'ghapp',
    });
    expect(wrongDigest.surfaces.find((surface) => surface.id === 'copilot-desktop')?.installed).toBe(false);
  });

  it('accepts and pre-dispatch revalidates the immutable Linux ARM Copilot AppImage', async () => {
    const executable = '/home/test/Applications/GitHub-Copilot-1.1.15-arm64.AppImage';
    const desktopEntry = '/home/test/.local/share/applications/GitHub Copilot.desktop';
    const digest = '0d02335a7accea8e2f2faf0a6ab76f2ed9f0ed217793f900ed36ae110342f33a';
    const contents = {
      [desktopEntry]: [
        '[Desktop Entry]',
        `Exec="${executable}" %u`,
        'MimeType=x-scheme-handler/github-app;x-scheme-handler/ghapp;x-scheme-handler/gh',
        'Name=GitHub Copilot',
        'Terminal=false',
        'Type=Application',
        'X-AppImage-Version=1.1.15',
      ].join('\n'),
    };
    const validEvidence = {
      [executable]: {
        status: { isFile: true, executable: true, mode: 0o100755, size: 485_141_000 },
        header: appImageHeader(183),
        sha256: digest,
      },
    };
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe({}, [executable], {}, contents, {}, validEvidence),
    });
    const plan = buildAiLaunchPlan(inventory, 'copilot-desktop');

    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-desktop')).toMatchObject({
      installed: true,
      executable,
      deepLinkScheme: 'ghapp',
      verification: { kind: 'copilot-appimage', size: 485_141_000, sha256: digest },
    });
    expect(plan.verification).toMatchObject({ kind: 'copilot-appimage', sha256: digest });

    await expect(executeAiLaunchPlan(plan, 'linux', {
      probe: probe({}, [executable], {}, {}, {}, {
        [executable]: { ...validEvidence[executable], header: appImageHeader(62) },
      }),
    })).rejects.toThrow('authenticated application changed after detection');
  });

  it('accepts the immutable official Linux x64 Copilot package payload', async () => {
    const executable = '/usr/bin/github';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'x64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe({}, [executable], {}, {}, {}, {
        [executable]: {
          sha256: '6033d7d87d60e5e86f00cf79f87174392051e016e6fad439d0eb657e6a5fdc55',
          linuxPackageIdentity: {
            packageName: 'github',
            architecture: 'x64',
            version: '1.1.15',
            manager: 'dpkg',
            ownedPath: executable,
            origin: 'https://github.com/github/app/releases/tag/v1.1.15',
            signatureVerified: false,
            catalogArtifactSha256: 'cf884fd0b9e5418285e82318c4fe712d74955f66982bae6a5d5c43aa1f44233e',
            executableSha256: '6033d7d87d60e5e86f00cf79f87174392051e016e6fad439d0eb657e6a5fdc55',
          },
        },
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-desktop')).toMatchObject({
      installed: true,
      executable,
    });
  });

  it('fails closed for a Linux Copilot RPM without trusted repository evidence', async () => {
    const files = ['/usr/bin/github', '/usr/share/applications/GitHub Copilot.desktop'];
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe({}, files, { rpm: 'github\taarch64\t1.1.15-1' }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-desktop')).toMatchObject({
      installed: false,
      executable: null,
    });
  });

  it.each([
    {
      surfaceId: 'codex-desktop' as const,
      candidate: '/usr/bin/chatgpt',
      realExecutable: '/usr/lib/chatgpt/ChatGPT',
      packageName: 'chatgpt',
      version: '26.901.51231',
      origin: 'https://persistent.oaistatic.com/codex-app-prod/linux/deb stable',
      fingerprint: '3BFA0E4AE8B8CC16A2D9BA684A3B4A566C4660E4',
    },
    {
      surfaceId: 'grok-bot' as const,
      candidate: '/opt/Grok Bot/grok-bot',
      realExecutable: '/opt/Grok Bot/grok-bot',
      packageName: 'grok-bot',
      version: '0.43.0',
      origin: 'https://downloads.cursor.com/aptrepo grok-bot',
      fingerprint: '380FF4BCDC34A4BD92A3565342A1772E62E492D6',
    },
  ])('rejects repository-only Linux package identity for $surfaceId without payload binding', async ({
    surfaceId,
    candidate,
    realExecutable,
    packageName,
    version,
    origin,
    fingerprint,
  }) => {
    const identity: LinuxPackageIdentity = {
      packageName,
      architecture: 'arm64',
      version,
      manager: 'dpkg',
      ownedPath: realExecutable,
      origin,
      signatureVerified: true,
      signingKeyFingerprint: fingerprint,
    };
    const valid = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        {},
        [candidate, realExecutable],
        {},
        {},
        { [candidate]: realExecutable },
        { [candidate]: { linuxPackageIdentity: identity } },
      ),
    });
    const wrongKey = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        {},
        [candidate, realExecutable],
        {},
        {},
        { [candidate]: realExecutable },
        {
          [candidate]: {
            linuxPackageIdentity: { ...identity, signingKeyFingerprint: '0'.repeat(40) },
          },
        },
      ),
    });

    expect(valid.surfaces.find((surface) => surface.id === surfaceId)).toMatchObject({
      installed: false,
      executable: null,
    });
    expect(wrongKey.surfaces.find((surface) => surface.id === surfaceId)?.installed).toBe(false);
  });

  it('recommends authenticated Grok Bot when Grok Build identity is unproven', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      architecture: 'arm64',
      home: '/Users/test',
      preferredSurface: null,
      probe: probe(
        { grok: '/Users/test/.grok/bin/grok' },
        ['/Applications/Grok Bot.app'],
        { '/Users/test/.grok/bin/grok': 'grok 1.0.13 (5e9a58528b76)' },
      ),
    });

    expect(inventory.recommendedSurface).toBe('grok-bot');
  });

  it('does not trust Linux URL handlers without a supported package identity', async () => {
    const claudeDesktopEntry = '/usr/share/applications/claude.desktop';
    const copilotDesktopEntry = '/usr/share/applications/github-copilot.desktop';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        { 'claude-desktop': '/usr/bin/claude-desktop', github: '/usr/bin/github' },
        [
          claudeDesktopEntry,
          copilotDesktopEntry,
          '/usr/share/applications/GitHub Copilot.desktop',
          '/usr/bin/claude-desktop',
          '/usr/bin/github',
        ],
        {
          'xdg-mime query default x-scheme-handler/claude': 'claude.desktop',
          'xdg-mime query default x-scheme-handler/ghapp': 'github-copilot.desktop',
          'dpkg-query -W -f=${Package}\t${Architecture}\t${Version} claude-desktop': 'claude-desktop\tarm64\t0.13.88',
          'dpkg-query -W -f=${Package}\t${Architecture}\t${Version} github': 'github\tarm64\t1.1.15',
        },
        {
          [claudeDesktopEntry]: [
            '[Desktop Entry]',
            'Type=Application',
            'Name=Claude',
            'Exec=claude-desktop %U',
            'MimeType=x-scheme-handler/claude;',
          ].join('\n'),
          [copilotDesktopEntry]: [
            '[Desktop Entry]',
            'Type=Application',
            'Name=GitHub Copilot',
            'Exec=github %U',
            'MimeType=x-scheme-handler/ghapp;',
          ].join('\n'),
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'claude-desktop')?.installed).toBe(false);
    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-desktop')?.installed).toBe(false);
  });

  it('rejects Claude Desktop apt metadata without signed-index package-payload binding', async () => {
    const executable = '/usr/bin/claude-desktop';
    const realExecutable = '/usr/lib/claude-desktop/claude-desktop';
    const desktopEntry = '/usr/share/applications/claude.desktop';
    const identity: LinuxPackageIdentity = {
      packageName: 'claude-desktop',
      architecture: 'arm64',
      version: '1.46388.2',
      manager: 'dpkg',
      ownedPath: realExecutable,
      origin: 'https://downloads.claude.ai/claude-desktop/apt/stable stable',
      signatureVerified: true,
      signingKeyFingerprint: '31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE',
    };
    const valid = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe(
        { 'claude-desktop': executable },
        [executable, realExecutable, desktopEntry],
        { 'linux-handler:claude': 'claude.desktop' },
        {
          [desktopEntry]: [
            '[Desktop Entry]',
            'Type=Application',
            'Name=Claude',
            'Exec=claude-desktop %U',
            'MimeType=x-scheme-handler/claude;',
          ].join('\n'),
        },
        { [executable]: realExecutable },
        { [executable]: { linuxPackageIdentity: identity } },
      ),
    });
    const wrongKey = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        {},
        [executable, realExecutable],
        { [executable]: realExecutable },
        {},
        {},
        {
          [executable]: {
            linuxPackageIdentity: { ...identity, signingKeyFingerprint: '0000000000000000000000000000000000000000' },
          },
        },
      ),
    });

    expect(valid.surfaces.find((surface) => surface.id === 'claude-desktop')).toMatchObject({
      installed: false,
      executable: null,
    });
    expect(() => buildAiLaunchPlan(valid, 'claude-desktop')).toThrow('is not installed');
    expect(wrongKey.surfaces.find((surface) => surface.id === 'claude-desktop')?.installed).toBe(false);
  });

  it.each([
    ['missing declared URL scheme', 'MimeType=text/plain;', 'Exec=claude-desktop %U'],
    ['different executable', 'MimeType=x-scheme-handler/claude;', 'Exec=/tmp/claude-desktop %U'],
    ['shell-like embedded field code', 'MimeType=x-scheme-handler/claude;', 'Exec=claude-desktop --url=%U'],
  ])('rejects a stale or spoofed Linux URL handler with %s', async (_reason, mimeType, execLine) => {
    const desktopEntry = '/home/test/.local/share/applications/claude.desktop';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        { 'claude-desktop': '/usr/bin/claude-desktop' },
        [desktopEntry, '/usr/bin/claude-desktop', '/tmp/claude-desktop'],
        {
          'xdg-mime query default x-scheme-handler/claude': 'claude.desktop',
          'dpkg-query -W -f=${Package}\t${Architecture}\t${Version} claude-desktop': 'claude-desktop\tarm64\t0.13.88',
        },
        {
          [desktopEntry]: [
            '[Desktop Entry]',
            'Type=Application',
            'Name=Claude',
            execLine,
            mimeType,
          ].join('\n'),
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'claude-desktop')?.installed).toBe(false);
  });

  it('falls back to the installed Windows desktop app when its deep-link handler is unavailable', async () => {
    const copilotApp = 'C:\\Users\\test\\AppData\\Local\\Programs\\GitHub Copilot\\github.exe';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: probe(
        {},
        [copilotApp],
        {},
        {},
        {},
        {
          [copilotApp]: {
            windowsIdentity: {
              productName: 'GitHub Copilot',
              publisher: 'CN=GitHub, Inc., O=GitHub, Inc., C=US',
            },
          },
        },
      ),
    });

    expect(buildAiLaunchPlan(inventory, 'copilot-desktop')).toMatchObject({
      mode: 'application',
      command: copilotApp,
      preparedPrompt: false,
    });
  });

  it('does not trust a Windows Copilot executable by install path alone', async () => {
    const copilotApp = 'C:\\Users\\test\\AppData\\Local\\Programs\\GitHub Copilot\\github.exe';
    const unsigned = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      preferredSurface: null,
      probe: probe({}, [copilotApp]),
    });
    const wrongPublisher = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      preferredSurface: null,
      probe: probe(
        {},
        [copilotApp],
        {},
        {},
        {},
        {
          [copilotApp]: {
            windowsIdentity: { productName: 'GitHub Copilot', publisher: 'O=Unrelated Corp, C=US' },
          },
        },
      ),
    });

    expect(unsigned.surfaces.find((surface) => surface.id === 'copilot-desktop')?.installed).toBe(false);
    expect(wrongPublisher.surfaces.find((surface) => surface.id === 'copilot-desktop')?.installed).toBe(false);
  });

  it('uses Program Files for signed Copilot and fails closed for unsigned Antigravity', async () => {
    const redirectedAntigravity = 'D:\\Profiles\\test\\Local\\Programs\\antigravity\\Antigravity.exe';
    const machineCopilot = 'D:\\Apps\\GitHub Copilot\\github.exe';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      environment: {
        LOCALAPPDATA: 'D:\\Profiles\\test\\Local',
        ProgramFiles: 'D:\\Apps',
      },
      preferredSurface: null,
      probe: probe(
        {},
        [redirectedAntigravity, machineCopilot],
        {},
        {},
        {},
        {
          [machineCopilot]: {
            windowsIdentity: {
              productName: 'GitHub Copilot',
              publisher: 'CN=GitHub, Inc., O=GitHub, Inc., C=US',
            },
          },
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'antigravity-desktop')).toMatchObject({
      installed: false,
      executable: null,
    });
    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-desktop')).toMatchObject({
      installed: true,
      executable: machineCopilot,
    });
  });

  it('detects the current Windows Claude Desktop MSIX identity', async () => {
    const publisher = 'CN="Anthropic, PBC", O="Anthropic, PBC", L=San Francisco, S=California, C=US, SERIALNUMBER=4860621, OID.2.5.4.15=Private Organization, OID.1.3.6.1.4.1.311.60.2.1.2=Delaware, OID.1.3.6.1.4.1.311.60.2.1.3=US';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: probe({}, [], {}, {}, {}, {
        Claude: {
          windowsAppxIdentity: {
            packageName: 'Claude',
            publisher,
            publisherId: 'pzs8sxrjxfjjc',
            familyName: 'Claude_pzs8sxrjxfjjc',
            applicationIds: ['Claude'],
            architecture: 'arm64',
            signatureKind: 'Developer',
            status: 'Ok',
          },
        },
      }),
    });

    expect(buildAiLaunchPlan(inventory, 'claude-desktop')).toMatchObject({
      mode: 'application',
      command: 'shell:AppsFolder\\Claude_pzs8sxrjxfjjc!Claude',
      preparedPrompt: false,
    });
  });

  it('rejects a Windows Store desktop package built for the wrong architecture', async () => {
    const publisher = 'CN="Anthropic, PBC", O="Anthropic, PBC", L=San Francisco, S=California, C=US, SERIALNUMBER=4860621, OID.2.5.4.15=Private Organization, OID.1.3.6.1.4.1.311.60.2.1.2=Delaware, OID.1.3.6.1.4.1.311.60.2.1.3=US';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      preferredSurface: null,
      probe: probe({}, [], {}, {}, {}, {
        Claude: {
          windowsAppxIdentity: {
            packageName: 'Claude',
            publisher,
            publisherId: 'pzs8sxrjxfjjc',
            familyName: 'Claude_pzs8sxrjxfjjc',
            applicationIds: ['Claude'],
            architecture: 'x64',
            signatureKind: 'Developer',
            status: 'Ok',
          },
        },
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'claude-desktop')?.installed).toBe(false);
  });

  it.each([
    'C:\\Users\\test\\AppData\\Local\\AnthropicClaude\\Claude.exe',
    'C:\\Users\\test\\AppData\\Local\\Programs\\Claude\\Claude.exe',
  ])('recognises the signed official Windows Claude executable at %s', async (executable) => {
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      preferredSurface: null,
      probe: probe(
        {},
        [executable],
        {},
        {},
        {},
        {
          [executable]: {
            windowsIdentity: {
              productName: 'Claude',
              publisher: 'CN=Anthropic PBC, O=Anthropic PBC, C=US',
            },
          },
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'claude-desktop')).toMatchObject({
      installed: true,
      executable,
    });
  });

  it.each([
    ['Claude Desktop', 'CN=Unrelated Corp, O=Unrelated Corp, C=US'],
    ['Unrelated App', 'CN=Anthropic PBC, O=Anthropic PBC, C=US'],
  ])('rejects a Windows Claude path with product %s and publisher %s', async (productName, publisher) => {
    const executable = 'C:\\Users\\test\\AppData\\Local\\AnthropicClaude\\Claude.exe';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      preferredSurface: null,
      probe: probe(
        {},
        [executable],
        {},
        {},
        {},
        { [executable]: { windowsIdentity: { productName, publisher } } },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'claude-desktop')?.installed).toBe(false);
  });

  it('validates the registered Windows Claude URL-handler executable identity', async () => {
    const executable = 'D:\\Portable\\Claude.exe';
    const valid = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      preferredSurface: null,
      probe: probe(
        {},
        [executable],
        { 'windows-handler:claude': executable },
        {},
        {},
        {
          [executable]: {
            windowsIdentity: {
              productName: 'Claude Desktop',
              publisher: 'CN=Anthropic PBC, O=Anthropic PBC, C=US',
            },
          },
        },
      ),
    });
    const spoofed = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      preferredSurface: null,
      probe: probe(
        {},
        [executable],
        { 'windows-handler:claude': executable },
        {},
        {},
        { [executable]: { windowsIdentity: { productName: 'Claude', publisher: 'O=Unrelated Corp, C=US' } } },
      ),
    });
    const unsafeRegistration = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      preferredSurface: null,
      probe: probe(
        {},
        [executable],
        {},
        {},
        {},
        {
          [executable]: {
            windowsIdentity: {
              productName: 'Claude',
              publisher: 'CN=Anthropic PBC, O=Anthropic PBC, C=US',
            },
          },
        },
      ),
    });

    expect(valid.surfaces.find((surface) => surface.id === 'claude-desktop')).toMatchObject({
      installed: true,
      executable,
      deepLinkScheme: 'claude',
    });
    expect(spoofed.surfaces.find((surface) => surface.id === 'claude-desktop')?.installed).toBe(false);
    expect(unsafeRegistration.surfaces.find((surface) => surface.id === 'claude-desktop')?.installed).toBe(false);
  });

  it.each([
    ['claude://code/new?q=Start&folder=%2Fwork%2Fcustomer-portal', '/usr/bin/open', 'darwin'],
    ['ghapp://recent', 'C:\\Windows\\System32\\rundll32.exe', 'win32'],
  ] as const)('refuses a desktop deep link without authenticated handler evidence: %s', async (url, _launcher, platform) => {
    spawnMock.mockReset();
    allowDetachedLaunch();

    await expect(executeAiLaunchPlan(urlLaunchPlan(url), platform)).rejects.toThrow('authenticated application');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it.each([
    'https://example.com',
    'file:///tmp/customer-portal',
    'claude://settings',
    'claude://code/newer?q=Start',
    'ghapp://settings',
    'ghapp://recently-opened',
  ])('rejects the unapproved desktop location %s before launch', async (url) => {
    spawnMock.mockReset();

    await expect(executeAiLaunchPlan(urlLaunchPlan(url), 'darwin')).rejects.toThrow(
      'EAI refused to open an unsupported AI workspace location.',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('uses fixed HTTPS official installation sources', () => {
    expect(AI_SURFACES).toHaveLength(11);
    expect(AI_SURFACES.map((surface) => surface.id)).toEqual(expect.arrayContaining([
      'antigravity-desktop',
      'antigravity-cli',
      'claude-desktop',
      'claude-cli',
      'copilot-desktop',
      'copilot-cli',
      'codex-desktop',
      'codex-cli',
      'grok-bot',
      'grok-cli',
    ]));
    expect(AI_SURFACES.some((surface) => surface.id.startsWith('gemini'))).toBe(false);
    expect(JSON.stringify(AI_SURFACES)).not.toMatch(/gemini/i);
    expect(Object.fromEntries(AI_SURFACES.map((surface) => [surface.id, surface.installUrl]))).toMatchObject({
      'antigravity-desktop': 'https://antigravity.google/download',
      'antigravity-cli': 'https://antigravity.google/docs/cli/install/',
      'copilot-desktop': 'https://docs.github.com/en/copilot/get-started/quickstart-copilot-app',
      'copilot-cli': 'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli',
      'claude-desktop': 'https://claude.com/download',
      'claude-cli': 'https://code.claude.com/docs/en/setup',
      'codex-desktop': 'https://learn.chatgpt.com/docs/app',
      'codex-cli': 'https://learn.chatgpt.com/docs/codex/cli',
      'grok-bot': 'https://x.ai/bot',
      'grok-cli': 'https://x.ai/build',
    });
    for (const surface of AI_SURFACES) {
      expect(surface.installUrl).toMatch(/^https:\/\//);
      expect(surface.installUrl).not.toContain('localhost');
    }
  });

  it('rejects signed Windows Code.exe as a host for mutable CLI JavaScript', async () => {
    const codeShim = 'C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd';
    const codeExe = 'C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
    const cliScript = 'C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\a5b5009513\\resources\\app\\out\\cli.js';
    const builtInCopilot = 'C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\a5b5009513\\resources\\app\\extensions\\copilot';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: probe(
        { code: codeShim },
        [codeShim, codeExe, cliScript, builtInCopilot],
        {},
        { [codeShim]: '@echo off\n"%~dp0..\\Code.exe" "%~dp0..\\a5b5009513\\resources\\app\\out\\cli.js" %*' },
        {},
        {
          [codeExe]: {
            windowsIdentity: {
              productName: 'Visual Studio Code',
              publisher: 'CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US',
            },
          },
        },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')).toMatchObject({
      installed: false,
      executable: null,
    });
    expect(() => buildAiLaunchPlan(inventory, 'vscode-copilot')).toThrow('is not installed');
  });

  it('accepts and revalidates the exact ARM64 Windows VS Code and Copilot payload', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      environment: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: windowsVsCodeCatalogProbe(),
    });
    const surface = inventory.surfaces.find((candidate) => candidate.id === 'vscode-copilot');
    expect(surface).toMatchObject({
      installed: true,
      executable: VSCODE_WINDOWS_EXECUTABLE,
      capabilities: ['initial-prompt'],
      launchSupport: 'project-and-prompt',
      verification: {
        kind: 'vscode-catalog',
        platform: 'win32',
        architecture: 'arm64',
        version: VSCODE_VERSION,
        commit: VSCODE_COMMIT,
      },
    });
    const plan = buildAiLaunchPlan(inventory, 'vscode-copilot');
    expect(plan).toMatchObject({
      mode: 'process',
      command: VSCODE_WINDOWS_EXECUTABLE,
      args: [VSCODE_WINDOWS_CLI, 'chat', '-m', 'agent', expect.stringContaining('repository EAI skill')],
      environment: {
        ELECTRON_RUN_AS_NODE: '1',
        VSCODE_DEV: '',
        VSCODE_IPC_HOOK_CLI: '',
      },
      preparedPrompt: true,
    });

    spawnMock.mockReset();
    allowDetachedLaunch();
    await expect(executeAiLaunchPlan(plan, 'win32', {
      probe: windowsVsCodeCatalogProbe(),
    })).resolves.toEqual({ dispatched: true, confirmed: false });
    expect(spawnMock).toHaveBeenCalledWith(
      VSCODE_WINDOWS_EXECUTABLE,
      plan.args,
      expect.objectContaining({ cwd: 'C:\\work\\customer-portal', detached: true }),
    );
    spawnMock.mockReset();
    await expect(executeAiLaunchPlan(plan, 'win32', {
      probe: windowsVsCodeCatalogProbe('0'.repeat(64)),
    })).rejects.toThrow('authenticated application changed after detection');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('requires the cataloged Windows VS Code SystemSetup tree to retain protected Program Files ACLs', async () => {
    expect(AI_SURFACES.find((surface) => surface.id === 'vscode-copilot')).toMatchObject({
      windowsProgramFilesApplications: ['Microsoft VS Code/Code.exe'],
    });
    expect(AI_SURFACES.find((surface) => surface.id === 'vscode-copilot')?.windowsApplications).toBeUndefined();

    const rejected = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: windowsVsCodeCatalogProbe(undefined, undefined, undefined, false),
    });
    expect(rejected.surfaces.find((surface) => surface.id === 'vscode-copilot')).toMatchObject({
      installed: false,
      executable: null,
    });

    const accepted = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: windowsVsCodeCatalogProbe(),
    });
    const plan = buildAiLaunchPlan(accepted, 'vscode-copilot');
    spawnMock.mockReset();
    await expect(executeAiLaunchPlan(plan, 'win32', {
      probe: windowsVsCodeCatalogProbe(undefined, undefined, undefined, false),
    })).rejects.toThrow('authenticated application changed after detection');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects Windows VS Code when updater residue changes the authenticated install root', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      environment: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      preferredSurface: null,
      probe: windowsVsCodeCatalogProbe(
        undefined,
        [
          'a44adf7f53', 'bin', 'Code.exe', 'Code.VisualElementsManifest.xml',
          'new_Code.exe', 'unins000.dat', 'unins000.exe', 'unins000.msg',
        ],
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')).toMatchObject({
      installed: false,
      executable: null,
    });
  });

  it('rejects Windows VS Code when updater residue changes the authenticated bin directory', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      environment: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      preferredSurface: null,
      probe: windowsVsCodeCatalogProbe(
        undefined,
        undefined,
        ['code', 'code-tunnel.exe', 'code.cmd', 'new_code', 'new_code-tunnel.exe', 'new_code.cmd'],
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')).toMatchObject({
      installed: false,
      executable: null,
    });
  });

  it('binds VS Code capabilities and launch semantics to the authenticated catalog record', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      environment: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: windowsVsCodeCatalogProbe(),
    });
    const surface = inventory.surfaces.find((candidate) => candidate.id === 'vscode-copilot')!;
    surface.launchArgsPrefix = ['C:\\attacker\\cli.js'];

    expect(() => serializeAiSurfaceInventory(inventory, 'v2')).toThrow('invalid capabilities');
    expect(() => buildAiLaunchPlan(inventory, 'vscode-copilot')).toThrow(
      'unproven optional launch capabilities',
    );

    surface.launchArgsPrefix = [VSCODE_WINDOWS_CLI];
    const plan = buildAiLaunchPlan(inventory, 'vscode-copilot');
    plan.args = [VSCODE_WINDOWS_CLI, 'chat', '-m', 'agent', 'attacker-controlled prompt'];
    spawnMock.mockReset();
    await expect(executeAiLaunchPlan(plan, 'win32', {
      probe: windowsVsCodeCatalogProbe(),
    })).rejects.toThrow('authenticated application changed after detection');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects a signed Code executable substituted for the required Windows catalog proof', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      environment: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: windowsVsCodeCatalogProbe(),
    });
    const surface = inventory.surfaces.find((candidate) => candidate.id === 'vscode-copilot')!;
    surface.capabilities = [];
    surface.launchSupport = 'project-only';
    surface.launchArgsPrefix = [];
    surface.launchEnvironment = { ELECTRON_RUN_AS_NODE: '1' };
    surface.verification = {
      kind: 'windows-executable',
      realPath: VSCODE_WINDOWS_EXECUTABLE,
      size: 218_732_896,
      sha256: 'c8e8f54f217223f3d4adff4dbd1f529aa7386c3a1705dbe214ecf187b963423e',
      architecture: 'arm64',
      productName: 'Visual Studio Code',
      companyName: 'Microsoft Corporation',
      publisher: 'CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US',
    };

    expect(() => serializeAiSurfaceInventory(inventory, 'v2')).toThrow(
      'unauthenticated VS Code catalog evidence',
    );
    expect(() => buildAiLaunchPlan(inventory, 'vscode-copilot')).toThrow(
      'unauthenticated VS Code launch evidence',
    );

    const forgedPlan: LaunchPlan = {
      surfaceId: 'vscode-copilot',
      surfaceName: 'GitHub Copilot in VS Code',
      projectDirectory: 'C:\\work\\customer-portal',
      mode: 'process',
      command: VSCODE_WINDOWS_EXECUTABLE,
      args: ['C:\\attacker\\payload.js'],
      environment: { ELECTRON_RUN_AS_NODE: '1' },
      cwd: 'C:\\work\\customer-portal',
      preparedPrompt: false,
      userMessage: 'forged',
      verification: surface.verification,
    };
    spawnMock.mockReset();
    await expect(executeAiLaunchPlan(forgedPlan, 'win32', {
      probe: windowsVsCodeCatalogProbe(),
    })).rejects.toThrow('without platform-authenticated catalog evidence');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('scrubs Node, Electron, VS Code, and native-loader injection variables from VS Code', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      architecture: 'arm64',
      home: '/home/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: linuxVsCodeCatalogProbe(),
    });
    const plan = buildAiLaunchPlan(inventory, 'vscode-copilot');
    vi.stubEnv('NODE_OPTIONS', '--require=/tmp/attacker.cjs');
    vi.stubEnv('NoDe_PaTh', '/tmp/attacker');
    vi.stubEnv('ELECTRON_EXTRA_LAUNCH_ARGS', '--inspect');
    vi.stubEnv('VSCODE_CLI', '/tmp/attacker.js');
    vi.stubEnv('LD_PRELOAD', '/tmp/attacker.so');
    vi.stubEnv('DYLD_INSERT_LIBRARIES', '/tmp/attacker.dylib');
    vi.stubEnv('EAI_SAFE_ENVIRONMENT_MARKER', 'retained');
    spawnMock.mockReset();
    allowDetachedLaunch();
    try {
      await executeAiLaunchPlan(plan, 'linux', { probe: linuxVsCodeCatalogProbe() });
      const options = spawnMock.mock.calls[0]?.[2] as { env?: Record<string, string> };
      const normalizedKeys = Object.keys(options.env ?? {}).map((key) => key.toUpperCase());
      expect(normalizedKeys.some((key) => (
        key.startsWith('NODE_')
        || (key.startsWith('ELECTRON_') && key !== 'ELECTRON_RUN_AS_NODE')
        || (key.startsWith('VSCODE_')
          && key !== 'VSCODE_DEV'
          && key !== 'VSCODE_IPC_HOOK_CLI')
        || key.startsWith('LD_')
        || key.startsWith('DYLD_')
      ))).toBe(false);
      expect(options.env).toMatchObject({
        EAI_SAFE_ENVIRONMENT_MARKER: 'retained',
        ELECTRON_RUN_AS_NODE: '1',
        VSCODE_DEV: '',
        VSCODE_IPC_HOOK_CLI: '',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects caller-forged VS Code optional capabilities without catalog evidence', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      architecture: 'arm64',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe({}, [
        '/Applications/Visual Studio Code.app',
        '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/copilot',
      ]),
    });
    const surface = inventory.surfaces.find((candidate) => candidate.id === 'vscode-copilot')!;
    expect(surface).toMatchObject({ capabilities: [], launchSupport: 'project-only' });
    expect(buildAiLaunchPlan(inventory, 'vscode-copilot')).toMatchObject({
      args: ['/work/customer-portal'],
      preparedPrompt: false,
    });
    surface.capabilities = ['initial-prompt'];
    expect(() => buildAiLaunchPlan(inventory, 'vscode-copilot')).toThrow(
      'unproven optional launch capabilities',
    );
    expect(() => serializeAiSurfaceInventory(inventory, 'v2')).toThrow('invalid capabilities');
  });

  it('fails closed for a direct Windows Codex executable until its signer identity is captured', async () => {
    const codexExe = 'C:\\Users\\test\\AppData\\Local\\Programs\\Codex\\Codex.exe';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: probe({}, [codexExe]),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'codex-desktop')?.installed).toBe(false);
    expect(() => buildAiLaunchPlan(inventory, 'codex-desktop')).toThrow('is not installed');
  });

  it('accepts the exact current Windows Store ChatGPT/Codex package identity', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: probe({}, [], {}, {}, {}, {
        'OpenAI.Codex': {
          windowsAppxIdentity: {
            packageName: 'OpenAI.Codex',
            publisher: 'CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B',
            publisherId: '2p2nqsd0c76g0',
            familyName: 'OpenAI.Codex_2p2nqsd0c76g0',
            applicationIds: ['App'],
            architecture: 'arm64',
            signatureKind: 'Store',
            status: 'Ok',
          },
        },
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'codex-desktop')?.installed).toBe(true);
    expect(buildAiLaunchPlan(inventory, 'codex-desktop')).toMatchObject({
      mode: 'application',
      command: 'shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App',
      preparedPrompt: false,
    });
  });

  it('revalidates Windows AppX identity immediately before dispatch', async () => {
    const packageIdentity: WindowsAppxIdentity = {
      packageName: 'OpenAI.Codex',
      publisher: 'CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B',
      publisherId: '2p2nqsd0c76g0',
      familyName: 'OpenAI.Codex_2p2nqsd0c76g0',
      applicationIds: ['App'],
      architecture: 'arm64',
      signatureKind: 'Store',
      status: 'Ok',
    };
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: probe({}, [], {}, {}, {}, {
        'OpenAI.Codex': { windowsAppxIdentity: packageIdentity },
      }),
    });
    const plan = buildAiLaunchPlan(inventory, 'codex-desktop');
    spawnMock.mockReset();
    allowDetachedLaunch();

    await expect(executeAiLaunchPlan(plan, 'win32', {
      probe: probe({}, [], {}, {}, {}, {
        'OpenAI.Codex': { windowsAppxIdentity: packageIdentity },
      }),
    })).resolves.toEqual({ dispatched: true, confirmed: false });
    expect(spawnMock).toHaveBeenCalledWith(
      'C:\\Windows\\explorer.exe',
      ['shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App'],
      expect.objectContaining({ detached: true }),
    );
    spawnMock.mockReset();

    await expect(executeAiLaunchPlan(plan, 'win32', {
      probe: probe({}, [], {}, {}, {}, {
        'OpenAI.Codex': {
          windowsAppxIdentity: { ...packageIdentity, publisher: 'CN=Unrelated Publisher' },
        },
      }),
    })).rejects.toThrow('authenticated application changed after detection');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects a spoofed Windows Store ChatGPT publisher', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      preferredSurface: null,
      probe: probe({}, [], {}, {}, {}, {
        'OpenAI.Codex': {
          windowsAppxIdentity: {
            packageName: 'OpenAI.Codex',
            publisher: 'CN=Unrelated Publisher',
            publisherId: '2p2nqsd0c76g0',
            familyName: 'OpenAI.Codex_2p2nqsd0c76g0',
            applicationIds: ['App'],
            architecture: 'arm64',
            signatureKind: 'Store',
            status: 'Ok',
          },
        },
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'codex-desktop')?.installed).toBe(false);
  });

  it('rejects a caller-forged installed Windows Codex application without evidence', async () => {
    const codexCli = 'C:\\Users\\test\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      architecture: 'arm64',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: probe({ codex: codexCli }),
    });
    const desktop = inventory.surfaces.find((surface) => surface.id === 'codex-desktop')!;
    desktop.installed = true;
    desktop.executable = 'C:\\Program Files\\OpenAI\\Codex\\Codex.exe';
    desktop.status = 'ready';

    expect(() => buildAiLaunchPlan(inventory, 'codex-desktop')).toThrow('without authenticated launch evidence');
  });

  it('stores only the selected surface in a private local preference file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'eai-surface-'));
    try {
      await rememberAiSurface('claude-desktop', home);
      expect(await readAiPreferences(home)).toEqual({ version: 1, lastAiSurface: 'claude-desktop' });
      const content = await readFile(join(home, '.eai', 'preferences.json'), 'utf8');
      expect(content).not.toMatch(/token|tenant|prompt|account/i);
      expect(await readdir(join(home, '.eai'))).toEqual(['preferences.json']);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('refuses to write preferences through a symlinked state directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'eai-surface-home-'));
    const redirected = await mkdtemp(join(tmpdir(), 'eai-surface-redirect-'));
    try {
      await symlink(redirected, join(home, '.eai'), 'dir');
      await expect(rememberAiSurface('claude-desktop', home)).rejects.toThrow('untrusted directory');
      expect(await readdir(redirected)).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(redirected, { recursive: true, force: true });
    }
  });
});
