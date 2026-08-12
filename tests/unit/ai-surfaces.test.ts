import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AI_SURFACES,
  buildAiLaunchPlan,
  detectAiSurfaces,
  readAiPreferences,
  rememberAiSurface,
  type SurfaceProbe,
} from '../../src/lib/ai-surfaces.js';

function probe(commands: Record<string, string>, files: string[] = [], outputs: Record<string, string> = {}): SurfaceProbe {
  return {
    commandPath: (command) => commands[command] ?? null,
    fileExists: (path) => files.includes(path),
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

  it('uses documented manual desktop and Grok interactive launch contracts', async () => {
    const inventory = await detectAiSurfaces({
      platform: 'darwin',
      home: '/Users/test',
      projectDirectory: '/work/customer-portal',
      preferredSurface: null,
      probe: probe(
        { grok: '/usr/local/bin/grok' },
        ['/Applications/Claude.app'],
      ),
    });
    expect(buildAiLaunchPlan(inventory, 'claude-desktop')).toMatchObject({
      mode: 'application',
      preparedPrompt: false,
      args: [],
    });
    expect(buildAiLaunchPlan(inventory, 'grok-cli')).toMatchObject({
      mode: 'terminal',
      cwd: '/work/customer-portal',
      args: [],
      preparedPrompt: false,
      userMessage: expect.stringContaining('/eai'),
    });
  });

  it('uses fixed HTTPS official installation sources', () => {
    expect(AI_SURFACES).toHaveLength(8);
    for (const surface of AI_SURFACES) {
      expect(surface.installUrl).toMatch(/^https:\/\//);
      expect(surface.installUrl).not.toContain('localhost');
    }
  });

  it('stores only the selected surface in a private local preference file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'eai-surface-'));
    await rememberAiSurface('claude-desktop', home);
    expect(await readAiPreferences(home)).toEqual({ version: 1, lastAiSurface: 'claude-desktop' });
    const content = await readFile(join(home, '.eai', 'preferences.json'), 'utf8');
    expect(content).not.toMatch(/token|tenant|prompt|account/i);
  });
});
