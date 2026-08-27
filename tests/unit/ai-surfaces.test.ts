import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AI_SURFACES,
  EAI_FIRST_PROMPT,
  MACOS_COPILOT_PROMPT_SCRIPT,
  buildAiLaunchPlan,
  detectAiSurfaces,
  executeAiLaunchPlan,
  readAiPreferences,
  rememberAiSurface,
  type LaunchPlan,
  type SurfaceProbe,
} from '../../src/lib/ai-surfaces.js';

const VSCODE_COPILOT_READY_OUTPUT = [
  'GitHub.copilot-chat',
  '-m --mode <mode>',
].join('\n');

const COPILOT_CLI_HELP = [
  'GitHub Copilot CLI - An AI-powered coding assistant.',
  'Commands:',
  '  app    Open the GitHub Copilot app',
].join('\n');

function probeOutputKey(command: string, args: readonly string[]): string {
  return [command, ...args].join('\0');
}

function macAppMetadataOutputs(application: string, bundleId: string, schemes: string[]): Record<string, string> {
  const infoPlist = `${application}/Contents/Info.plist`;
  const teamId = bundleId === 'com.github.githubapp'
    ? 'VEKTX9H2N7'
    : bundleId === 'com.anthropic.claudefordesktop'
      ? 'Q6L2SF6YDW'
      : bundleId === 'com.openai.codex' ? '2DC432GLL2' : null;
  return {
    [probeOutputKey('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', application])]: '',
    [probeOutputKey('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', infoPlist])]: bundleId,
    [probeOutputKey('/usr/bin/plutil', ['-extract', 'CFBundleURLTypes', 'json', '-o', '-', infoPlist])]: JSON.stringify([
      { CFBundleURLSchemes: schemes },
    ]),
    ...(teamId
      ? { [probeOutputKey('/usr/bin/codesign', ['-dv', '--verbose=4', application])]: `Identifier=${bundleId}\nTeamIdentifier=${teamId}` }
      : {}),
  };
}

const LINUX_DESKTOP_FILES = [
  '/usr/share/applications/claude.desktop',
  '/usr/share/applications/codex.desktop',
  '/usr/share/applications/github-copilot.desktop',
];

const LINUX_DESKTOP_CONTENTS = {
  '/usr/share/applications/claude.desktop': '[Desktop Entry]\nExec=/opt/anthropic/claude %u\nMimeType=x-scheme-handler/claude;',
  '/usr/share/applications/codex.desktop': '[Desktop Entry]\nExec=/opt/openai/codex %u\nMimeType=x-scheme-handler/codex;',
  '/usr/share/applications/github-copilot.desktop': '[Desktop Entry]\nExec=/opt/github-copilot/copilot %u\nMimeType=x-scheme-handler/ghapp;',
};

const spawnMock = vi.hoisted(() => vi.fn());
const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: execFileMock, spawn: spawnMock };
});

function urlLaunchPlan(command: string): LaunchPlan {
  const surfaceId = command.startsWith('codex:')
    ? 'codex-desktop'
    : command.startsWith('ghapp:')
      ? 'copilot-desktop'
      : 'claude-desktop';
  return {
    surfaceId,
    surfaceName: 'Claude Desktop',
    projectDirectory: '/work/customer-portal',
    mode: 'url',
    command,
    args: [],
    cwd: '/work/customer-portal',
    preparedPrompt: true,
    ...(command === 'ghapp://' ? { promptToCopy: EAI_FIRST_PROMPT } : {}),
    userMessage: 'Claude Desktop will open.',
  };
}

function macCopilotAppPlan(overrides: Partial<LaunchPlan> = {}): LaunchPlan {
  return {
    surfaceId: 'copilot-desktop',
    surfaceName: 'GitHub Copilot',
    projectDirectory: '/work/local-only',
    mode: 'process',
    command: '/usr/local/bin/copilot',
    args: ['app'],
    cwd: '/work/local-only',
    preparedPrompt: false,
    promptToCopy: EAI_FIRST_PROMPT,
    postLaunchAction: 'macos-copilot-insert-prompt',
    postLaunchApplication: '/Applications/GitHub Copilot.app',
    userMessage: 'Open Copilot.',
    ...overrides,
  };
}

function allowDetachedLaunch(promptResult = 'APP_NOT_READY'): void {
  spawnMock.mockImplementation(() => {
    const child = {
      once: (event: string, listener: (...args: unknown[]) => void) => {
        if (event === 'spawn') listener();
        if (event === 'exit') listener(0, null);
        return child;
      },
      unref: vi.fn(),
      kill: vi.fn(),
    };
    return child;
  });
  execFileMock.mockImplementation((
    _command: string,
    _args: readonly string[],
    _options: object,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    callback(null, `${promptResult}\n`, '');
    return undefined;
  });
}

function probe(
  commands: Record<string, string>,
  files: string[] = [],
  outputs: Record<string, string> = {},
  contents: Record<string, string> = {},
  realPaths: Record<string, string> = {},
): SurfaceProbe {
  return {
    commandPath: (command) => commands[command] ?? null,
    fileExists: (path) => files.includes(path),
    fileContent: (path) => contents[path] ?? null,
    realPath: (path) => realPaths[path] ?? path,
    commandOutput: (command, args) => outputs[probeOutputKey(command, args)] ?? outputs[command] ?? null,
  };
}

describe('AI surface contract', () => {
  it('keeps the visible first EAI message short and stable', () => {
    expect(EAI_FIRST_PROMPT).toBe('✨ Get started with EAI ✨');
  });

  it('detects VS Code only when Copilot is installed and recommends it first', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/app',
      preferredSurface: null,
      probe: probe(
        { code: '/usr/local/bin/code', claude: '/usr/local/bin/claude' },
        [],
        { '/usr/local/bin/code': VSCODE_COPILOT_READY_OUTPUT },
      ),
    });

    expect(inventory.recommendedSurface).toBe('vscode-copilot');
    expect(inventory.launchContractVersion).toBe('eai.ai-launch/v1');
    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')).toMatchObject({ installed: true, recommended: true });
    expect(inventory.surfaces.find((surface) => surface.id === 'claude-cli')?.installed).toBe(true);
  });

  it('falls back from a stale preference to the best installed surface', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      home: '/home/test',
      preferredSurface: 'codex-desktop',
      probe: probe({ grok: '/usr/bin/grok' }),
    });
    expect(inventory.preferredSurface).toBeNull();
    expect(inventory.recommendedSurface).toBe('grok-cli');
  });

  it('detects Copilot when current Linux VS Code supplies it as a built-in feature', async () => {
    const codeCommand = '/usr/bin/code';
    const resolvedCode = '/usr/share/code/bin/code';
    const builtInCopilot = '/usr/share/code/resources/app/extensions/copilot';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      home: '/home/test',
      preferredSurface: null,
      probe: probe(
        { code: codeCommand },
        [builtInCopilot],
        { [codeCommand]: VSCODE_COPILOT_READY_OUTPUT },
        {},
        { [codeCommand]: resolvedCode },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')).toMatchObject({
      installed: true,
      executable: codeCommand,
      recommended: true,
    });
  });

  it('does not mistake plain VS Code for a Copilot-ready workspace', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      home: '/home/test',
      preferredSurface: null,
      probe: probe({ code: '/usr/bin/code' }, [], { '/usr/bin/code': '' }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')?.installed).toBe(false);
  });

  it('does not claim VS Code can start a prompt when its chat command is unavailable', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      preferredSurface: null,
      probe: probe(
        { code: '/usr/local/bin/code' },
        [],
        { '/usr/local/bin/code': 'GitHub.copilot-chat' },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')?.installed).toBe(false);
  });

  it('does not mistake an unrelated copilot command for GitHub Copilot CLI', async () => {
    const command = '/usr/local/bin/copilot';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/app',
      preferredSurface: null,
      probe: probe({ copilot: command }, [], {
        [probeOutputKey(command, ['--help'])]: 'AWS Copilot CLI\nCommands:\n  app    Deploy an application',
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-cli')?.installed).toBe(false);
  });

  it('keeps the official Windows npm Copilot shim available without executing it as a native binary', async () => {
    const command = 'C:\\Users\\test\\AppData\\Roaming\\npm\\copilot.cmd';
    const loader = 'C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\@github\\copilot\\npm-loader.js';
    const commandOutput = vi.fn(() => null);
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\app',
      preferredSurface: null,
      probe: {
        commandPath: (name) => name === 'copilot' ? command : null,
        fileExists: (path) => path === loader,
        fileContent: (path) => path === command
          ? '@ECHO off\r\nnode "%dp0%\\node_modules\\@github\\copilot\\npm-loader.js" %*'
          : null,
        commandOutput,
      },
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-cli')).toMatchObject({
      installed: true,
      executable: command,
      supportsAppBridge: false,
    });
    expect(buildAiLaunchPlan(inventory, 'copilot-cli')).toMatchObject({
      mode: 'terminal',
      command,
      preparedPrompt: true,
    });
    expect(commandOutput).not.toHaveBeenCalledWith(command, ['--help'], expect.anything());
  });

  it('rejects an unrelated Windows copilot shim', async () => {
    const command = 'C:\\Users\\test\\bin\\copilot.cmd';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\app',
      preferredSurface: null,
      probe: probe(
        { copilot: command },
        [command],
        {},
        { [command]: '@ECHO off\r\naws-copilot.exe %*' },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-cli')?.installed).toBe(false);
  });

  it('recognises prompted VS Code chat without depending on English help text', async () => {
    const commandOutput = vi.fn((_command: string, args: readonly string[]) => {
      if (args.join(' ') === '--list-extensions') return 'GitHub.copilot-chat';
      if (args.join(' ') === 'chat --help') return 'Opciones\n-m --mode <modo>';
      return null;
    });
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      preferredSurface: null,
      probe: {
        commandPath: (command) => command === 'code' ? '/usr/local/bin/code' : null,
        fileExists: () => false,
        commandOutput,
      },
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')?.installed).toBe(true);
    expect(commandOutput).toHaveBeenCalledWith('/usr/local/bin/code', ['chat', '--help'], {});
  });

  it('recommends the most complete supported workspace when none is installed', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'win32',
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
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe(
        { copilot: '/usr/local/bin/copilot', codex: '/usr/local/bin/codex' },
        ['/Applications/Codex.app'],
        {
          ...macAppMetadataOutputs('/Applications/Codex.app', 'com.openai.codex', ['codex']),
          [probeOutputKey('/usr/local/bin/copilot', ['--help'])]: COPILOT_CLI_HELP,
        },
      ),
    });
    expect(buildAiLaunchPlan(inventory, 'copilot-cli')).toMatchObject({
      mode: 'terminal',
      command: '/usr/local/bin/copilot',
      args: ['-C', '/work/customer-portal', '-i', EAI_FIRST_PROMPT],
      preparedPrompt: true,
    });
    expect(buildAiLaunchPlan(inventory, 'codex-desktop')).toMatchObject({
      mode: 'url',
      command: expect.stringMatching(/^codex:\/\/new\?/),
      args: [],
      preparedPrompt: true,
    });
  });

  it('executes VS Code with the exact project folder and submitted chat prompt', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe(
        { code: '/usr/local/bin/code' },
        [],
        {
          '/usr/local/bin/code': VSCODE_COPILOT_READY_OUTPUT,
        },
      ),
    });
    spawnMock.mockReset();
    allowDetachedLaunch();

    await executeAiLaunchPlan(buildAiLaunchPlan(inventory, 'vscode-copilot'), 'darwin');

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/local/bin/code',
      ['chat', '--mode', 'agent', EAI_FIRST_PROMPT],
      expect.objectContaining({ cwd: '/work/customer-portal', detached: true, windowsHide: true }),
    );
  });

  it('builds an explicit launch contract for every supported AI workspace', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe(
        {
          code: '/usr/local/bin/code',
          copilot: '/usr/local/bin/copilot',
          claude: '/usr/local/bin/claude',
          codex: '/usr/local/bin/codex',
          grok: '/usr/local/bin/grok',
        },
        ['/Applications/GitHub Copilot.app', '/Applications/Claude.app', '/Applications/ChatGPT.app'],
        {
          '/usr/local/bin/code': VSCODE_COPILOT_READY_OUTPUT,
          [probeOutputKey('/usr/local/bin/copilot', ['--help'])]: COPILOT_CLI_HELP,
          ...macAppMetadataOutputs('/Applications/GitHub Copilot.app', 'com.github.githubapp', ['ghapp', 'github-app', 'gh']),
          ...macAppMetadataOutputs('/Applications/Claude.app', 'com.anthropic.claudefordesktop', ['claude']),
          ...macAppMetadataOutputs('/Applications/ChatGPT.app', 'com.openai.codex', ['codex']),
        },
      ),
    });

    const plans = Object.fromEntries(AI_SURFACES.map((surface) => [surface.id, buildAiLaunchPlan(inventory, surface.id)]));
    expect(plans).toMatchObject({
      'vscode-copilot': { mode: 'process', preparedPrompt: true },
      'copilot-cli': { mode: 'terminal', preparedPrompt: true },
      'copilot-desktop': {
        mode: 'process',
        command: '/usr/local/bin/copilot',
        args: ['app'],
        preparedPrompt: false,
        postLaunchAction: 'macos-copilot-insert-prompt',
        postLaunchApplication: '/Applications/GitHub Copilot.app',
      },
      'claude-desktop': { mode: 'url', preparedPrompt: true },
      'claude-cli': { mode: 'terminal', preparedPrompt: true },
      'codex-desktop': { mode: 'url', preparedPrompt: true },
      'codex-cli': { mode: 'terminal', preparedPrompt: true },
      'grok-cli': { mode: 'terminal', preparedPrompt: true },
    });
  });

  it('uses the documented Claude and Codex Desktop deep links and Grok launch contract', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      home: '/home/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: {
        ...probe({ grok: '/usr/local/bin/grok' }, LINUX_DESKTOP_FILES, {}, LINUX_DESKTOP_CONTENTS),
        commandOutput: (command, args) => {
          if (command !== 'xdg-mime') return null;
          if (args.at(-1) === 'x-scheme-handler/claude') return 'claude.desktop';
          if (args.at(-1) === 'x-scheme-handler/codex') return 'codex.desktop';
          return null;
        },
      },
    });
    expect(buildAiLaunchPlan(inventory, 'claude-desktop')).toMatchObject({
      mode: 'url',
      command: expect.stringMatching(/^claude:\/\/code\/new\?/),
      preparedPrompt: true,
      args: [],
    });
    expect(buildAiLaunchPlan(inventory, 'codex-desktop')).toMatchObject({
      mode: 'url',
      command: expect.stringMatching(/^codex:\/\/new\?/),
      preparedPrompt: true,
      args: [],
    });
    expect(buildAiLaunchPlan(inventory, 'grok-cli')).toMatchObject({
      mode: 'terminal',
      cwd: '/work/customer-portal',
      args: ['--cwd', '/work/customer-portal', '-p', EAI_FIRST_PROMPT],
      preparedPrompt: true,
    });
  });

  it('detects packaged desktop apps through their registered URL handlers', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      home: '/home/test',
      preferredSurface: null,
      probe: {
        ...probe({}, LINUX_DESKTOP_FILES, {}, LINUX_DESKTOP_CONTENTS),
        commandOutput: (command, args) => {
          if (command !== 'xdg-mime') return null;
          if (args.at(-1) === 'x-scheme-handler/claude') return 'claude.desktop';
          if (args.at(-1) === 'x-scheme-handler/ghapp') return 'github-copilot.desktop';
          if (args.at(-1) === 'x-scheme-handler/codex') return 'codex.desktop';
          return null;
        },
      },
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'claude-desktop')?.installed).toBe(true);
    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-desktop')?.installed).toBe(true);
    expect(inventory.surfaces.find((surface) => surface.id === 'codex-desktop')?.installed).toBe(true);
  });

  it('keeps the Copilot app fallback while using Claude Desktop official project link on macOS', async () => {
    const copilotApp = '/Applications/GitHub Copilot.app';
    const claudeApp = '/Applications/Claude.app';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe({}, [copilotApp, claudeApp], {
        ...macAppMetadataOutputs(copilotApp, 'com.github.githubapp', ['ghapp', 'github-app', 'gh']),
        ...macAppMetadataOutputs(claudeApp, 'com.anthropic.claudefordesktop', ['claude']),
      }),
    });

    const copilotPlan = buildAiLaunchPlan(inventory, 'copilot-desktop');
    expect(copilotPlan).toMatchObject({
      mode: 'application',
      command: copilotApp,
      args: ['/work/customer-portal'],
      preparedPrompt: false,
      promptToCopy: EAI_FIRST_PROMPT,
      userMessage: expect.stringContaining('cannot pre-fill'),
    });
    expect(copilotPlan.userMessage).not.toContain('EAI will confirm');
    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-desktop')?.launchSupport)
      .toBe('project-only');
    expect(buildAiLaunchPlan(inventory, 'claude-desktop')).toMatchObject({
      mode: 'url',
      command: expect.stringMatching(/^claude:\/\/code\/new\?/),
      preparedPrompt: true,
    });

    spawnMock.mockReset();
    allowDetachedLaunch();
    await executeAiLaunchPlan(copilotPlan, 'darwin');
    expect(spawnMock).toHaveBeenCalledWith(
      'open',
      ['-a', copilotApp, '/work/customer-portal'],
      expect.objectContaining({ detached: true, windowsHide: true }),
    );
  });

  it('uses the official Copilot app bridge for an exact local-only project', async () => {
    const copilotApp = '/Applications/GitHub Copilot.app';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/local-only',
      preferredSurface: null,
      probe: probe(
        { copilot: '/usr/local/bin/copilot' },
        [copilotApp],
        {
          ...macAppMetadataOutputs(copilotApp, 'com.github.githubapp', ['ghapp']),
          [probeOutputKey('/usr/local/bin/copilot', ['--help'])]: COPILOT_CLI_HELP,
        },
      ),
    });

    expect(inventory.projectGitHubRepository).toBeNull();
    expect(buildAiLaunchPlan(inventory, 'copilot-desktop')).toMatchObject({
      mode: 'process',
      command: '/usr/local/bin/copilot',
      args: ['app'],
      cwd: '/work/local-only',
      preparedPrompt: false,
      promptToCopy: EAI_FIRST_PROMPT,
      postLaunchAction: 'macos-copilot-insert-prompt',
      postLaunchApplication: copilotApp,
      userMessage: expect.stringContaining('EAI will confirm'),
    });

    spawnMock.mockReset();
    execFileMock.mockReset();
    allowDetachedLaunch('INSERTED');
    const execution = await executeAiLaunchPlan(buildAiLaunchPlan(inventory, 'copilot-desktop'), 'darwin');
    expect(execution).toEqual({ promptInsertionStatus: 'inserted' });
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      '/usr/local/bin/copilot',
      ['app'],
      expect.objectContaining({ cwd: '/work/local-only', detached: false, windowsHide: true }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'open',
      ['-a', copilotApp],
      expect.objectContaining({ detached: true, windowsHide: true }),
    );
    expect(execFileMock).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      ['-e', MACOS_COPILOT_PROMPT_SCRIPT, '--', EAI_FIRST_PROMPT, copilotApp, '/work/local-only'],
      expect.objectContaining({ timeout: 90_000, windowsHide: true }),
      expect.any(Function),
    );
    expect(spawnMock.mock.invocationCallOrder[0]).toBeLessThan(spawnMock.mock.invocationCallOrder[1]);
    expect(spawnMock.mock.invocationCallOrder[1]).toBeLessThan(execFileMock.mock.invocationCallOrder[0]);
  });

  it('prefers the exact local Copilot app bridge over a repository deep link', async () => {
    const project = '/work/customer-portal';
    const copilotApp = '/Applications/GitHub Copilot.app';
    const copilotCli = '/usr/local/bin/copilot';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: project,
      preferredSurface: null,
      probe: probe(
        { copilot: copilotCli },
        [copilotApp],
        {
          ...macAppMetadataOutputs(copilotApp, 'com.github.githubapp', ['ghapp']),
          [probeOutputKey(copilotCli, ['--help'])]: COPILOT_CLI_HELP,
          [probeOutputKey('git', ['-C', project, 'rev-parse', '--show-toplevel'])]: project,
          [probeOutputKey('git', ['-C', project, 'remote', 'get-url', 'origin'])]: 'git@github.com:eai-support/customer-portal.git',
        },
      ),
    });

    expect(inventory.projectGitHubRepository).toBe('eai-support/customer-portal');
    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-desktop')?.launchSupport)
      .toBe('project-and-prompt');
    expect(buildAiLaunchPlan(inventory, 'copilot-desktop')).toMatchObject({
      mode: 'process',
      command: copilotCli,
      args: ['app'],
      cwd: project,
      postLaunchAction: 'macos-copilot-insert-prompt',
      postLaunchApplication: copilotApp,
    });
  });

  it('does not add macOS prompt insertion to a local Copilot app bridge on other platforms', async () => {
    const command = '/usr/local/bin/copilot';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      home: '/home/test',
      projectDirectory: '/work/local-only',
      preferredSurface: null,
      probe: {
        ...probe({ copilot: command }, LINUX_DESKTOP_FILES, {}, LINUX_DESKTOP_CONTENTS),
        commandOutput: (executable, args) => {
          if (executable === command && args.join(' ') === '--help') return COPILOT_CLI_HELP;
          if (executable === 'xdg-mime' && args.at(-1) === 'x-scheme-handler/ghapp') {
            return 'github-copilot.desktop';
          }
          return null;
        },
      },
    });

    expect(buildAiLaunchPlan(inventory, 'copilot-desktop')).toMatchObject({
      mode: 'process',
      command,
      args: ['app'],
      preparedPrompt: false,
    });
    expect(buildAiLaunchPlan(inventory, 'copilot-desktop').postLaunchAction).toBeUndefined();
  });

  it.each([
    ['PERMISSION_REQUIRED', 'permission-required'],
    ['APP_NOT_READY', 'app-not-ready'],
    ['FOCUS_LOST', 'focus-lost'],
    ['DRAFT_NOT_EMPTY', 'draft-not-empty'],
    ['UNVERIFIED_APPLICATION', 'unsafe-target'],
    ['UNSAFE_MUTATION_DEADLINE_EXCEEDED', 'unsafe-target'],
    ['UNSAFE_ALLOW_TRANSITION_TIMEOUT', 'unsafe-target'],
    ['UNSAFE_PROCESS_MISSING', 'unsafe-target'],
    ['UNSAFE_PROCESS_CHANGED', 'unsafe-target'],
    ['UNSAFE_WINDOW_COUNT_CHANGED', 'unsafe-target'],
    ['UNSAFE_WINDOW_POSITION_CHANGED', 'unsafe-target'],
    ['UNSAFE_WINDOW_SIZE_CHANGED', 'unsafe-target'],
    ['UNSAFE_CONFIRMATION_FOLDER_COUNT', 'unsafe-target'],
    ['UNSAFE_CONFIRMATION_ACTION_COUNT', 'unsafe-target'],
    ['UNSAFE_CONFIRMATION_ACTION_STATE', 'unsafe-target'],
    ['UNSAFE_ALLOW_TARGET_CHANGED', 'unsafe-target'],
    ['UNSAFE_ALLOW_PRESS_FAILED', 'unsafe-target'],
    ['UNSAFE_MESSAGE_FIELD_COUNT', 'unsafe-target'],
    ['UNSAFE_MESSAGE_FIELD_STATE', 'unsafe-target'],
    ['UNSAFE_FOCUSED_ELEMENT_MISSING', 'unsafe-target'],
    ['UNSAFE_FOCUSED_FIELD_ROLE', 'unsafe-target'],
    ['UNSAFE_FOCUSED_FIELD_STATE', 'unsafe-target'],
    ['UNSAFE_FOCUSED_FIELD_POSITION', 'unsafe-target'],
    ['UNSAFE_FOCUSED_FIELD_SIZE', 'unsafe-target'],
    ['UNSAFE_FOCUSED_FIELD_VALUE', 'unsafe-target'],
    ['AMBIGUOUS_MESSAGE_FIELD', 'unsafe-target'],
    ['INSERTION_UNCONFIRMED', 'unsafe-target'],
    ['AUTOMATION_FAILED', 'automation-failed'],
  ] as const)('keeps Copilot launch success separate from prompt insertion result %s', async (scriptResult, expectedStatus) => {
    const plan: LaunchPlan = {
      surfaceId: 'copilot-desktop',
      surfaceName: 'GitHub Copilot',
      projectDirectory: '/work/local-only',
      mode: 'process',
      command: '/usr/local/bin/copilot',
      args: ['app'],
      cwd: '/work/local-only',
      preparedPrompt: false,
      promptToCopy: EAI_FIRST_PROMPT,
      postLaunchAction: 'macos-copilot-insert-prompt',
      postLaunchApplication: '/Applications/GitHub Copilot.app',
      userMessage: 'Open Copilot.',
    };
    spawnMock.mockReset();
    execFileMock.mockReset();
    allowDetachedLaunch(scriptResult);

    await expect(executeAiLaunchPlan(plan, 'darwin')).resolves.toEqual({
      promptInsertionStatus: expectedStatus,
    });
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('starts Copilot accessibility automation only after the app bridge exits successfully', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    spawnMock.mockReset();
    execFileMock.mockReset();
    allowDetachedLaunch('INSERTED');
    spawnMock.mockImplementation((command: string) => {
      const bridgeChild = {
        once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          listeners.set(event, listener);
          return bridgeChild;
        }),
        kill: vi.fn(),
      };
      if (command === '/usr/local/bin/copilot') return bridgeChild;
      const detachedChild = {
        once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          if (event === 'spawn') listener();
          return detachedChild;
        }),
        unref: vi.fn(),
      };
      return detachedChild;
    });

    const execution = executeAiLaunchPlan(macCopilotAppPlan(), 'darwin');
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).not.toHaveBeenCalled();
    listeners.get('exit')?.(0, null);

    await expect(execution).resolves.toEqual({ promptInsertionStatus: 'inserted' });
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'open',
      ['-a', '/Applications/GitHub Copilot.app'],
      expect.objectContaining({ detached: true }),
    );
    expect(spawnMock.mock.invocationCallOrder[1]).toBeLessThan(execFileMock.mock.invocationCallOrder[0]);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('does not start Copilot accessibility automation after a failed app bridge', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    spawnMock.mockReset();
    execFileMock.mockReset();
    allowDetachedLaunch('INSERTED');
    spawnMock.mockImplementation(() => {
      const child = {
        once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          listeners.set(event, listener);
          return child;
        }),
        kill: vi.fn(),
      };
      return child;
    });

    const execution = executeAiLaunchPlan(macCopilotAppPlan(), 'darwin');
    const rejectedLaunch = expect(execution).rejects.toThrow(
      'GitHub Copilot did not finish opening this project. No prompt insertion was attempted.',
    );
    listeners.get('exit')?.(2, null);

    await rejectedLaunch;
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).not.toHaveBeenCalledWith('open', expect.anything(), expect.anything());
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('propagates an app bridge spawn error without activating Copilot or accessibility automation', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    spawnMock.mockReset();
    execFileMock.mockReset();
    spawnMock.mockImplementation(() => {
      const child = {
        once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          listeners.set(event, listener);
          return child;
        }),
        kill: vi.fn(),
      };
      return child;
    });

    const execution = executeAiLaunchPlan(macCopilotAppPlan(), 'darwin');
    const spawnError = new Error('spawn EACCES');
    const rejectedLaunch = expect(execution).rejects.toThrow(spawnError);
    listeners.get('error')?.(spawnError);

    await rejectedLaunch;
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).not.toHaveBeenCalledWith('open', expect.anything(), expect.anything());
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('terminates a timed-out app bridge without starting late accessibility automation', async () => {
    vi.useFakeTimers();
    try {
      spawnMock.mockReset();
      execFileMock.mockReset();
      allowDetachedLaunch('INSERTED');
      const kill = vi.fn();
      spawnMock.mockImplementation(() => {
        const child = {
          once: vi.fn(() => child),
          kill,
        };
        return child;
      });

      const execution = executeAiLaunchPlan(macCopilotAppPlan(), 'darwin');
      const rejectedLaunch = expect(execution).rejects.toThrow(
        'GitHub Copilot did not finish opening this project. No prompt insertion was attempted.',
      );
      await vi.advanceTimersByTimeAsync(23_000);

      await rejectedLaunch;
      expect(kill).toHaveBeenCalledWith('SIGTERM');
      expect(kill).toHaveBeenCalledWith('SIGKILL');
      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(spawnMock).not.toHaveBeenCalledWith('open', expect.anything(), expect.anything());
      expect(execFileMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('presses only the exact project Allow control, fills the verified empty Message field, and never sends', () => {
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('bundle identifier is "com.github.githubapp"');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('application file of copilotProcess');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('runningApplicationPath is not expectedApplicationPath');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('"Copy folder, " & expectedProjectPath');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('elementName is "Allow"');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('elementName is "Deny"');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('perform action "AXPress" of candidateAllowButton');
    expect(MACOS_COPILOT_PROMPT_SCRIPT.match(/perform action "AXPress"/g)).toHaveLength(1);
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('if confirmationMarkers is 0 then');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('set observedProcessId to currentProcessId');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('set observedWindowCount to count of windows');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('(count of windows) is not observedWindowCount');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('(position of front window) is not equal to observedWindowPosition');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('(size of front window) is not equal to observedWindowSize');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('set focusedElement to value of attribute "AXFocusedUIElement" of copilotProcess');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('(position of focusedElement) is not equal to messageFieldPosition');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('(size of focusedElement) is not equal to messageFieldSize');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('focusedElementValue is not equal to messageFieldValue');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).not.toContain('front window is not observedWindow');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).not.toContain('focusedElement is not messageField');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('if frontmost is not true then return "FOCUS_LOST"');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('set discoveryPollsRemaining to 20');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('set discoveryScansRemaining to 12');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('set transitionPollsRemaining to 8');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('set mutationDeadline to (my wallClockSeconds()) + 70');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('if (my wallClockSeconds()) is greater than or equal to mutationDeadline then return "UNSAFE_MUTATION_DEADLINE_EXCEEDED"');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('targetRole is "AXTextArea"');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('(description of targetElement) is "Message"');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('(focused of messageField is true)');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('focused of focusedElement is not true');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('messageFieldValue is not ""');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).toContain('set value of focusedElement to promptText');
    expect(MACOS_COPILOT_PROMPT_SCRIPT).not.toMatch(/\bkeystroke\b|\bclick\b|\bactivate\b|key code 36/i);
  });

  it('does not run macOS prompt insertion for a widened Copilot app command', async () => {
    const plan: LaunchPlan = {
      surfaceId: 'copilot-desktop',
      surfaceName: 'GitHub Copilot',
      projectDirectory: '/work/local-only',
      mode: 'process',
      command: '/usr/local/bin/copilot',
      args: ['--verbose', 'app'],
      cwd: '/work/local-only',
      preparedPrompt: false,
      promptToCopy: EAI_FIRST_PROMPT,
      postLaunchAction: 'macos-copilot-insert-prompt',
      postLaunchApplication: '/Applications/GitHub Copilot.app',
      userMessage: 'Open Copilot.',
    };
    spawnMock.mockReset();
    execFileMock.mockReset();
    allowDetachedLaunch('INSERTED');

    await expect(executeAiLaunchPlan(plan, 'darwin')).resolves.toEqual({
      promptInsertionStatus: 'not-attempted',
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('opens a GitHub-backed Copilot app session with the exact first prompt', async () => {
    const project = "/work/R&D #1/naïve's app";
    const copilotApp = '/Applications/GitHub Copilot.app';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: project,
      preferredSurface: null,
      probe: probe({}, [copilotApp], {
        ...macAppMetadataOutputs(copilotApp, 'com.github.githubapp', ['ghapp']),
        [probeOutputKey('git', ['-C', project, 'rev-parse', '--show-toplevel'])]: project,
        [probeOutputKey('git', ['-C', project, 'remote', 'get-url', 'origin'])]: 'git@github.com:eai-support/customer-portal.git',
      }),
    });

    expect(inventory.projectGitHubRepository).toBe('eai-support/customer-portal');
    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-desktop')?.launchSupport)
      .toBe('project-and-prompt');
    const plan = buildAiLaunchPlan(inventory, 'copilot-desktop');
    const url = new URL(plan.command);
    expect(plan).toMatchObject({
      mode: 'url',
      preparedPrompt: true,
      args: [],
      urlApplication: copilotApp,
    });
    expect(url.protocol).toBe('ghapp:');
    expect(url.hostname).toBe('session');
    expect(url.pathname).toBe('/new');
    expect(url.searchParams.get('repo')).toBe('eai-support/customer-portal');
    expect(url.searchParams.get('mode')).toBe('interactive');
    expect(url.searchParams.get('prompt')).toBe(EAI_FIRST_PROMPT);

    spawnMock.mockReset();
    allowDetachedLaunch();
    await executeAiLaunchPlan(plan, 'darwin');
    expect(spawnMock).toHaveBeenCalledWith(
      'open',
      ['-a', copilotApp, '-u', plan.command],
      expect.objectContaining({ detached: true, windowsHide: true }),
    );
  });

  it.each([
    ['https://github.com/eai-support/customer-portal.git', 'eai-support/customer-portal'],
    ['git@github.com:eai-support/customer-portal.git', 'eai-support/customer-portal'],
    ['ssh://git@github.com/eai-support/customer-portal', 'eai-support/customer-portal'],
  ])('recognises the strict GitHub origin %s', async (remote, expected) => {
    const project = '/work/customer-portal';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      projectDirectory: project,
      preferredSurface: null,
      probe: probe({}, [], {
        [probeOutputKey('git', ['-C', project, 'rev-parse', '--show-toplevel'])]: project,
        [probeOutputKey('git', ['-C', project, 'remote', 'get-url', 'origin'])]: remote,
      }),
    });
    expect(inventory.projectGitHubRepository).toBe(expected);
  });

  it.each([
    'https://gitlab.com/eai-support/customer-portal.git',
    'https://github.com/eai-support/customer-portal/extra',
    'https://user@github.com/eai-support/customer-portal.git',
    'https://github.com/eai support/customer-portal.git',
    'https://github.com/eai-support/customer-portal.git?token=secret',
  ])('does not put an untrusted project remote into a Copilot app link: %s', async (remote) => {
    const project = '/work/customer-portal';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      projectDirectory: project,
      preferredSurface: null,
      probe: probe({}, [], {
        [probeOutputKey('git', ['-C', project, 'rev-parse', '--show-toplevel'])]: project,
        [probeOutputKey('git', ['-C', project, 'remote', 'get-url', 'origin'])]: remote,
      }),
    });
    expect(inventory.projectGitHubRepository).toBeNull();
  });

  it('does not borrow a GitHub origin from a parent repository', async () => {
    const project = '/work/parent/child';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      projectDirectory: project,
      preferredSurface: null,
      probe: probe({}, [], {
        [probeOutputKey('git', ['-C', project, 'rev-parse', '--show-toplevel'])]: '/work/parent',
        [probeOutputKey('git', ['-C', project, 'remote', 'get-url', 'origin'])]: 'https://github.com/eai-support/parent.git',
      }),
    });
    expect(inventory.projectGitHubRepository).toBeNull();
  });

  it('falls back to opening an older Claude app when its secure project link is unavailable', async () => {
    const claudeApp = '/Applications/Claude.app';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe({}, [claudeApp], {
        ...macAppMetadataOutputs(claudeApp, 'com.anthropic.claudefordesktop', []),
      }),
    });

    expect(buildAiLaunchPlan(inventory, 'claude-desktop')).toMatchObject({
      mode: 'application',
      command: claudeApp,
      preparedPrompt: false,
      promptToCopy: EAI_FIRST_PROMPT,
    });
    expect(inventory.surfaces.find((surface) => surface.id === 'claude-desktop')?.launchSupport)
      .toBe('manual-project');
  });

  it('keeps a genuine Codex bundle installed when URL scheme metadata is unavailable', async () => {
    const codexApp = '/Applications/ChatGPT.app';
    const infoPlist = `${codexApp}/Contents/Info.plist`;
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe({}, [codexApp], {
        [probeOutputKey('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', codexApp])]: '',
        [probeOutputKey('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', infoPlist])]: 'com.openai.codex',
        [probeOutputKey('/usr/bin/codesign', ['-dv', '--verbose=4', codexApp])]: 'Identifier=com.openai.codex\nTeamIdentifier=2DC432GLL2',
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'codex-desktop')).toMatchObject({
      installed: true,
      launchSupport: 'manual-project',
      deepLinkScheme: null,
    });
    expect(buildAiLaunchPlan(inventory, 'codex-desktop')).toMatchObject({
      mode: 'application',
      command: codexApp,
      preparedPrompt: false,
      promptToCopy: EAI_FIRST_PROMPT,
    });
  });

  it.each([
    ['claude-desktop', '/Applications/Claude.app', 'com.anthropic.claudefordesktop', 'claude'],
    ['codex-desktop', '/Applications/ChatGPT.app', 'com.openai.codex', 'codex'],
  ] as const)('rejects %s when its macOS signing team is not the expected provider', async (surfaceId, application, bundleId, scheme) => {
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe({}, [application], {
        ...macAppMetadataOutputs(application, bundleId, [scheme]),
        [probeOutputKey('/usr/bin/codesign', ['-dv', '--verbose=4', application])]: `Identifier=${bundleId}\nTeamIdentifier=WRONGTEAM`,
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === surfaceId)?.installed).toBe(false);
  });

  it('rejects a macOS app whose signature metadata is intact but signature verification fails', async () => {
    const codexApp = '/Applications/ChatGPT.app';
    const outputs = macAppMetadataOutputs(codexApp, 'com.openai.codex', ['codex']);
    delete outputs[probeOutputKey('/usr/bin/codesign', [
      '--verify', '--deep', '--strict', '--verbose=2', codexApp,
    ])];
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe({}, [codexApp], outputs),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'codex-desktop')?.installed).toBe(false);
  });

  it('discovers a renamed Codex app by its verified macOS bundle identifier', async () => {
    const relocatedCodex = '/Applications/AI Tools/My Codex.app';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      preferredSurface: null,
      probe: probe({}, [relocatedCodex], {
        [probeOutputKey('/usr/bin/mdfind', ["kMDItemCFBundleIdentifier == 'com.openai.codex'"])]: relocatedCodex,
        ...macAppMetadataOutputs(relocatedCodex, 'com.openai.codex', ['codex']),
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'codex-desktop')).toMatchObject({
      installed: true,
      executable: relocatedCodex,
      deepLinkScheme: 'codex',
    });
  });

  it('does not mistake the classic ChatGPT bundle for Codex Desktop', async () => {
    const chatGptApp = '/Applications/ChatGPT.app';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      preferredSurface: null,
      probe: probe({}, [chatGptApp], {
        ...macAppMetadataOutputs(chatGptApp, 'com.openai.chat', ['chatgpt']),
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'codex-desktop')?.installed).toBe(false);
  });

  it('does not hand the project to an unverified app named GitHub Copilot', async () => {
    const copilotApp = '/Applications/GitHub Copilot.app';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe({}, [copilotApp], {
        ...macAppMetadataOutputs(copilotApp, 'com.example.lookalike', ['ghapp']),
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-desktop')?.installed).toBe(false);
  });

  it('requires GitHub signing identity before handing a project to the Copilot app', async () => {
    const copilotApp = '/Applications/GitHub Copilot.app';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe({}, [copilotApp], {
        ...macAppMetadataOutputs(copilotApp, 'com.github.githubapp', ['ghapp']),
        [probeOutputKey('/usr/bin/codesign', ['-dv', '--verbose=4', copilotApp])]: 'Identifier=com.github.githubapp\nTeamIdentifier=NOTGITHUB',
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-desktop')?.installed).toBe(false);
  });

  it('round-trips the exact project and first prompt through desktop links', async () => {
    const project = "/work/R&D #1/naïve's app";
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: project,
      preferredSurface: null,
      probe: probe({}, ['/Applications/Claude.app', '/Applications/ChatGPT.app'], {
        ...macAppMetadataOutputs('/Applications/Claude.app', 'com.anthropic.claudefordesktop', ['claude']),
        ...macAppMetadataOutputs('/Applications/ChatGPT.app', 'com.openai.codex', ['codex']),
      }),
    });

    const claude = new URL(buildAiLaunchPlan(inventory, 'claude-desktop').command);
    expect(claude.protocol).toBe('claude:');
    expect(claude.hostname).toBe('code');
    expect(claude.pathname).toBe('/new');
    expect(claude.searchParams.get('folder')).toBe(project);
    expect(claude.searchParams.get('q')).toBe(EAI_FIRST_PROMPT);

    const codex = new URL(buildAiLaunchPlan(inventory, 'codex-desktop').command);
    expect(codex.protocol).toBe('codex:');
    expect(codex.hostname).toBe('new');
    expect(codex.searchParams.get('path')).toBe(project);
    expect(codex.searchParams.get('prompt')).toBe(EAI_FIRST_PROMPT);
  });

  it.each([
    [`claude://code/new?q=${encodeURIComponent(EAI_FIRST_PROMPT)}&folder=%2Fwork%2Fcustomer-portal`, 'open', 'darwin'],
    [`codex://new?prompt=${encodeURIComponent(EAI_FIRST_PROMPT)}&path=%2Fwork%2Fcustomer-portal`, 'open', 'darwin'],
    ['ghapp://', 'rundll32.exe', 'win32'],
  ] as const)('launches the approved desktop deep link %s', async (url, launcher, platform) => {
    spawnMock.mockReset();
    allowDetachedLaunch();

    await executeAiLaunchPlan(urlLaunchPlan(url), platform);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      launcher,
      platform === 'darwin' ? ['-u', url] : ['url.dll,FileProtocolHandler', url],
      expect.objectContaining({ detached: true, windowsHide: true }),
    );
  });

  it.each([
    'https://example.com',
    'file:///tmp/customer-portal',
    'claude://settings',
    'claude://code/newer?q=Start',
    'claude://code/new?q=Start',
    'claude://code/new?q=Start&q=Again&folder=%2Fwork',
    'claude://code/new?q=Start&folder=%2Fwork&extra=value',
    'claude://code/new?q=Start&folder=%2Fwork#fragment',
    'claude://user@code/new?q=Start&folder=%2Fwork',
    'codex://settings',
    'codex://new',
    'codex://new?prompt=Start',
    'codex://new?prompt=Start&path=%2Fwork&path=%2Fother',
    'codex://new?prompt=Start&path=%2Fwork&extra=value',
    'codex://new?prompt=Start&path=%2Fwork#fragment',
    'codex://user@new?prompt=Start&path=%2Fwork',
    'ghapp://settings',
    'ghapp://recent',
    'ghapp://recently-opened',
    'ghapp://session/new?mode=interactive&prompt=Start',
    'ghapp://session/new?repo=owner%2Frepo&mode=plan&prompt=Start',
    'ghapp://session/new?repo=owner%2Frepo&mode=interactive&prompt=Start',
    'ghapp://session/new?repo=owner%2Frepo%2Fextra&mode=interactive&prompt=Start',
  ])('rejects the unapproved desktop location %s before launch', async (url) => {
    spawnMock.mockReset();

    await expect(executeAiLaunchPlan(urlLaunchPlan(url), 'darwin')).rejects.toThrow(
      'EAI refused to open an unsupported AI workspace location.',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it.each([
    [`claude://code/new?q=${encodeURIComponent(EAI_FIRST_PROMPT)}&folder=%2Fwork%2Fanother-project`],
    [`codex://new?prompt=${encodeURIComponent(EAI_FIRST_PROMPT)}&path=%2Fwork%2Fanother-project`],
  ])('rejects an otherwise valid desktop link bound to a different project: %s', async (url) => {
    spawnMock.mockReset();

    await expect(executeAiLaunchPlan(urlLaunchPlan(url), 'darwin')).rejects.toThrow(
      'EAI refused to open an unsupported AI workspace location.',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('uses fixed HTTPS official installation sources', () => {
    expect(AI_SURFACES).toHaveLength(8);
    for (const surface of AI_SURFACES) {
      expect(surface.installUrl).toMatch(/^https:\/\//);
      expect(surface.installUrl).not.toContain('localhost');
    }
  });

  it('resolves the native Windows VS Code executable before launching Copilot', async () => {
    const codeShim = 'C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd';
    const codeExe = 'C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
    const cliScript = 'C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\a5b5009513\\resources\\app\\out\\cli.js';
    const builtInCopilot = 'C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\a5b5009513\\resources\\app\\extensions\\copilot';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: probe(
        { code: codeShim },
        [codeShim, codeExe, cliScript, builtInCopilot],
        { [codeExe]: VSCODE_COPILOT_READY_OUTPUT },
        { [codeShim]: '@echo off\n"%~dp0..\\Code.exe" "%~dp0..\\a5b5009513\\resources\\app\\out\\cli.js" %*' },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')?.executable).toBe(codeExe);
    expect(buildAiLaunchPlan(inventory, 'vscode-copilot')).toMatchObject({
      mode: 'process',
      command: codeExe,
      args: [cliScript, 'chat', '--mode', 'agent', EAI_FIRST_PROMPT],
      environment: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });

  it('uses the Codex desktop project link when Codex CLI is not installed on Windows', async () => {
    const codexExe = 'C:\\Users\\test\\AppData\\Local\\Programs\\Codex\\Codex.exe';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: probe({}, [codexExe], { 'reg.exe': `"${codexExe}" "%1"` }),
    });

    expect(buildAiLaunchPlan(inventory, 'codex-desktop')).toMatchObject({
      mode: 'url',
      command: expect.stringMatching(/^codex:\/\/new\?/),
      args: [],
      preparedPrompt: true,
      userMessage: expect.stringContaining('ready to review'),
    });
  });

  it('does not send the project path or prompt to an unverified URL handler', async () => {
    const spoofedCodex = 'C:\\Users\\test\\Downloads\\Codex.exe';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: probe({}, [spoofedCodex], {
        'reg.exe': `"${spoofedCodex}" "%1"`,
      }),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'codex-desktop')?.installed).toBe(false);
    expect(inventory.surfaces.find((surface) => surface.id === 'claude-desktop')?.installed).toBe(false);
  });

  it('rejects a Linux handler name that has no matching desktop entry contract', async () => {
    const spoofedEntry = '/usr/share/applications/codex.desktop';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      home: '/home/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: {
        ...probe({}, [spoofedEntry], {}, {
          [spoofedEntry]: '[Desktop Entry]\nExec=/tmp/not-codex %u\nMimeType=x-scheme-handler/https;',
        }),
        commandOutput: (command, args) => command === 'xdg-mime' && args.at(-1) === 'x-scheme-handler/codex'
          ? 'codex.desktop'
          : null,
      },
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'codex-desktop')?.installed).toBe(false);
  });

  it.each([
    ['codex', 'codex.desktop', 'Exec=/tmp/codex %u'],
    ['claude', 'claude.desktop', 'Exec=/tmp/claude %u'],
    ['ghapp', 'github-copilot.desktop', 'Exec=/tmp/github-copilot %u'],
  ] as const)('rejects a user-local Linux %s handler that shadows an official desktop entry', async (scheme, handler, execLine) => {
    const userEntry = `/home/test/.local/share/applications/${handler}`;
    const systemEntry = `/usr/share/applications/${handler}`;
    const surfaceId = scheme === 'codex' ? 'codex-desktop' : scheme === 'claude' ? 'claude-desktop' : 'copilot-desktop';
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      home: '/home/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: {
        ...probe({}, [userEntry, systemEntry], {}, {
          [userEntry]: `[Desktop Entry]\n${execLine}\nMimeType=x-scheme-handler/${scheme};`,
          [systemEntry]: `[Desktop Entry]\n${execLine.replace('/tmp/', '/opt/provider/')}\nMimeType=x-scheme-handler/${scheme};`,
        }),
        commandOutput: (command, args) => command === 'xdg-mime' && args.at(-1) === `x-scheme-handler/${scheme}`
          ? handler
          : null,
      },
    });

    expect(inventory.surfaces.find((surface) => surface.id === surfaceId)?.installed).toBe(false);
  });

  it('keeps the native Codex app fallback when its Windows project link is unavailable', async () => {
    const codexExe = 'C:\\Users\\test\\AppData\\Local\\Programs\\Codex\\Codex.exe';
    const inventory = await detectAiSurfaces({
      platform: 'win32',
      home: 'C:\\Users\\test',
      projectDirectory: 'C:\\work\\customer-portal',
      preferredSurface: null,
      probe: probe({}, [codexExe]),
    });

    expect(buildAiLaunchPlan(inventory, 'codex-desktop')).toMatchObject({
      mode: 'application',
      command: codexExe,
      preparedPrompt: false,
      promptToCopy: EAI_FIRST_PROMPT,
    });
  });

  it('stores only the selected surface in a private local preference file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'eai-surface-'));
    await rememberAiSurface('claude-desktop', home);
    expect(await readAiPreferences(home)).toEqual({ version: 1, lastAiSurface: 'claude-desktop' });
    const content = await readFile(join(home, '.eai', 'preferences.json'), 'utf8');
    expect(content).not.toMatch(/token|tenant|prompt|account/i);
  });
});
