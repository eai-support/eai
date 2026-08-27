import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiSurfaceInventory, DetectedAiSurface, LaunchPlan } from '../../src/lib/ai-surfaces.js';

const aiSurfaceMocks = vi.hoisted(() => ({
  buildAiLaunchPlan: vi.fn(),
  detectAiSurfaces: vi.fn(),
  executeAiLaunchPlan: vi.fn(),
  getAiSurface: vi.fn(),
  rememberAiSurface: vi.fn(),
}));

vi.mock('../../src/lib/ai-surfaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/ai-surfaces.js')>();
  return { ...actual, ...aiSurfaceMocks };
});

import { startCommand } from '../../src/commands/start.js';

const projectDirectory = fileURLToPath(new URL('../../', import.meta.url));
const copilotSurface = {
  id: 'copilot-desktop',
  name: 'GitHub Copilot',
  provider: 'GitHub',
  installed: true,
} as DetectedAiSurface;
const inventory = {
  contractVersion: 'eai.ai-surfaces/v1',
  launchContractVersion: 'eai.ai-launch/v1',
  platform: 'darwin',
  projectDirectory,
  projectGitHubRepository: null,
  preferredSurface: null,
  recommendedSurface: 'copilot-desktop',
  surfaces: [copilotSurface],
} as AiSurfaceInventory;

function copilotPlan(): LaunchPlan {
  return {
    surfaceId: 'copilot-desktop',
    surfaceName: 'GitHub Copilot',
    projectDirectory,
    mode: 'process',
    command: '/usr/local/bin/copilot',
    args: ['app'],
    cwd: projectDirectory,
    preparedPrompt: false,
    promptToCopy: 'First EAI message',
    postLaunchAction: 'macos-copilot-insert-prompt',
    postLaunchApplication: '/Applications/GitHub Copilot.app',
    userMessage: 'Open Copilot and fill its message box.',
  };
}

describe('eai start prompt-insertion authorization', () => {
  beforeEach(() => {
    aiSurfaceMocks.detectAiSurfaces.mockResolvedValue(inventory);
    aiSurfaceMocks.getAiSurface.mockReturnValue(copilotSurface);
    aiSurfaceMocks.buildAiLaunchPlan.mockImplementation(copilotPlan);
    aiSurfaceMocks.executeAiLaunchPlan.mockResolvedValue({ promptInsertionStatus: 'not-attempted' });
    aiSurfaceMocks.rememberAiSurface.mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('removes desktop UI automation by default and preserves it only after explicit scoped consent', async () => {
    await startCommand.parseAsync([
      projectDirectory,
      '--surface',
      'copilot-desktop',
      '--no-remember',
    ], { from: 'user' });

    const defaultPlan = aiSurfaceMocks.executeAiLaunchPlan.mock.calls[0]?.[0] as LaunchPlan;
    expect(defaultPlan).not.toHaveProperty('postLaunchAction');
    expect(defaultPlan).not.toHaveProperty('postLaunchApplication');
    expect(defaultPlan.userMessage).toContain('will not press Allow or fill the message box');
    expect(aiSurfaceMocks.executeAiLaunchPlan).toHaveBeenNthCalledWith(1, defaultPlan, 'darwin');

    await startCommand.parseAsync([
      projectDirectory,
      '--surface',
      'copilot-desktop',
      '--allow-copilot-prompt-insertion',
      '--no-remember',
    ], { from: 'user' });

    expect(aiSurfaceMocks.executeAiLaunchPlan).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        postLaunchAction: 'macos-copilot-insert-prompt',
        postLaunchApplication: '/Applications/GitHub Copilot.app',
      }),
      'darwin',
    );
  });
});
