import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AI_SURFACES,
  buildAiLaunchPlan,
  detectAiSurfaces,
  executeAiLaunchPlan,
  readAiPreferences,
  rememberAiSurface,
  type LaunchPlan,
  type SurfaceProbe,
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
): SurfaceProbe {
  return {
    commandPath: (command) => commands[command] ?? null,
    fileExists: (path) => files.includes(path),
    fileContent: (path) => contents[path] ?? null,
    realPath: (path) => realPaths[path] ?? path,
    commandOutput: (command) => outputs[command] ?? null,
  };
}

describe('AI surface contract', () => {
  it('detects VS Code only when Copilot is installed and recommends it first', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/app',
      preferredSurface: null,
      probe: probe(
        { code: '/usr/local/bin/code', claude: '/usr/local/bin/claude' },
        [],
        { '/usr/local/bin/code': 'GitHub.copilot-chat\nGitHub.copilot' },
      ),
    });

    expect(inventory.recommendedSurface).toBe('vscode-copilot');
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
        { [codeCommand]: '' },
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
      ),
    });
    expect(buildAiLaunchPlan(inventory, 'copilot-cli')).toMatchObject({
      mode: 'terminal',
      command: '/usr/local/bin/copilot',
      args: ['-C', '/work/customer-portal', '-i', expect.stringContaining('business outcome')],
      preparedPrompt: true,
    });
    expect(buildAiLaunchPlan(inventory, 'codex-desktop')).toMatchObject({
      mode: 'process',
      command: '/usr/local/bin/codex',
      args: ['app', '/work/customer-portal'],
      preparedPrompt: false,
    });
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
        { '/usr/local/bin/code': 'GitHub.copilot-chat' },
      ),
    });

    const plans = Object.fromEntries(AI_SURFACES.map((surface) => [surface.id, buildAiLaunchPlan(inventory, surface.id)]));
    expect(plans).toMatchObject({
      'vscode-copilot': { mode: 'process', preparedPrompt: true },
      'copilot-cli': { mode: 'terminal', preparedPrompt: true },
      'copilot-desktop': { mode: 'application', preparedPrompt: false },
      'claude-desktop': { mode: 'application', preparedPrompt: false },
      'claude-cli': { mode: 'terminal', preparedPrompt: true },
      'codex-desktop': { mode: 'process', preparedPrompt: false },
      'codex-cli': { mode: 'terminal', preparedPrompt: true },
      'grok-cli': { mode: 'terminal', preparedPrompt: true },
    });
  });

  it('uses the documented Claude Desktop deep link and Grok launch contracts', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      home: '/home/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: {
        ...probe({ grok: '/usr/local/bin/grok' }),
        commandOutput: (command, args) =>
          command === 'xdg-mime' && args.at(-1) === 'x-scheme-handler/claude' ? 'claude.desktop' : null,
      },
    });
    expect(buildAiLaunchPlan(inventory, 'claude-desktop')).toMatchObject({
      mode: 'url',
      command: expect.stringMatching(/^claude:\/\/code\/new\?/),
      preparedPrompt: true,
      args: [],
    });
    expect(buildAiLaunchPlan(inventory, 'grok-cli')).toMatchObject({
      mode: 'terminal',
      cwd: '/work/customer-portal',
      args: ['--cwd', '/work/customer-portal', '-p', expect.stringContaining('business outcome')],
      preparedPrompt: true,
    });
  });

  it('detects packaged desktop apps through their registered URL handlers', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'linux',
      home: '/home/test',
      preferredSurface: null,
      probe: {
        commandPath: () => null,
        fileExists: () => false,
        commandOutput: (command, args) => {
          if (command !== 'xdg-mime') return null;
          if (args.at(-1) === 'x-scheme-handler/claude') return 'claude.desktop';
          if (args.at(-1) === 'x-scheme-handler/ghapp') return 'github-copilot.desktop';
          return null;
        },
      },
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'claude-desktop')?.installed).toBe(true);
    expect(inventory.surfaces.find((surface) => surface.id === 'copilot-desktop')?.installed).toBe(true);
  });

  it('falls back to the installed desktop app when its deep-link handler is unavailable', async () => {
    const copilotApp = '/Applications/GitHub Copilot.app';
    const claudeApp = '/Applications/Claude.app';
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe({}, [copilotApp, claudeApp]),
    });

    expect(buildAiLaunchPlan(inventory, 'copilot-desktop')).toMatchObject({
      mode: 'application',
      command: copilotApp,
      preparedPrompt: false,
    });
    expect(buildAiLaunchPlan(inventory, 'claude-desktop')).toMatchObject({
      mode: 'application',
      command: claudeApp,
      preparedPrompt: false,
    });
  });

  it.each([
    ['claude://code/new?q=Start&folder=%2Fwork%2Fcustomer-portal', 'open', 'darwin'],
    ['ghapp://recent', 'rundll32.exe', 'win32'],
  ] as const)('launches the approved desktop deep link %s', async (url, launcher, platform) => {
    spawnMock.mockReset();
    allowDetachedLaunch();

    await executeAiLaunchPlan(urlLaunchPlan(url), platform);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      launcher,
      platform === 'darwin' ? [url] : ['url.dll,FileProtocolHandler', url],
      expect.objectContaining({ detached: true, windowsHide: true }),
    );
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
        {},
        { [codeShim]: '@echo off\n"%~dp0..\\Code.exe" "%~dp0..\\a5b5009513\\resources\\app\\out\\cli.js" %*' },
      ),
    });

    expect(inventory.surfaces.find((surface) => surface.id === 'vscode-copilot')?.executable).toBe(codeExe);
    expect(buildAiLaunchPlan(inventory, 'vscode-copilot')).toMatchObject({
      mode: 'process',
      command: codeExe,
      args: [cliScript, 'chat', '-m', 'agent', expect.stringContaining('business outcome')],
      environment: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });

  it('uses the native desktop fallback when Codex CLI is not installed on Windows', async () => {
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
      args: [],
      userMessage: expect.stringContaining('Choose this project folder'),
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
