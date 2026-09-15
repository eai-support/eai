import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { AI_SURFACES, type AiSurfaceId, type AiSurfaceInventory } from '../../src/lib/ai-surfaces.js';
import { performAiSurfaceInstall } from '../../src/commands/start.js';

const execFileAsync = promisify(execFile);
const cliEntry = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

function installInventory(installedIds: readonly AiSurfaceId[]): AiSurfaceInventory {
  return {
    contractVersion: 'eai.ai-surfaces/v2', platform: 'linux', projectDirectory: '/work/app',
    preferredSurface: null, recommendedSurface: null,
    surfaces: AI_SURFACES.map((surface) => ({
      ...surface, installed: installedIds.includes(surface.id), executable: null,
      launchArgsPrefix: [], launchEnvironment: {}, capabilities: [], recommended: false,
      previouslyUsed: false, status: installedIds.includes(surface.id) ? 'ready' : 'not-installed',
      nextAction: '',
    })),
  };
}

describe('eai start', () => {
  it('returns the stable read-only detection contract', { timeout: 30_000 }, async () => {
    const { stdout } = await execFileAsync(process.execPath, [cliEntry, 'start', '--check', '--format', 'json'], {
      env: { ...process.env, EAI_UPDATE_CHECK_DISABLED: '1' },
    });
    const inventory = JSON.parse(stdout) as {
      contractVersion: string;
      surfaces: Array<{ id: string; kind: 'desktop' | 'cli' | 'editor'; installed: boolean }>;
    };
    expect(inventory.contractVersion).toBe('eai.ai-surfaces/v1');
    expect(inventory.surfaces.map((surface) => surface.id)).toEqual([
      'vscode-copilot',
      'copilot-cli',
      'copilot-desktop',
      'claude-desktop',
      'claude-cli',
      'codex-desktop',
      'codex-cli',
      'grok-cli',
    ]);
    expect(
      inventory.surfaces
        .filter((surface) => surface.kind === 'desktop' || surface.kind === 'editor')
        .map((surface) => surface.id),
    ).toEqual([
      'vscode-copilot',
      'copilot-desktop',
      'claude-desktop',
      'codex-desktop',
    ]);
    expect(inventory.surfaces.every((surface) => typeof surface.installed === 'boolean')).toBe(true);
  });

  it('negotiates the v2 surface contract explicitly for current installers', { timeout: 30_000 }, async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      cliEntry,
      'start',
      '--check',
      '--format',
      'json',
      '--contract-version',
      'v2',
    ], {
      env: { ...process.env, EAI_UPDATE_CHECK_DISABLED: '1' },
    });

    const inventory = JSON.parse(stdout) as {
      contractVersion: string;
      surfaces: Array<Record<string, unknown>>;
    };
    expect(inventory).toMatchObject({
      contractVersion: 'eai.ai-surfaces/v2',
    });
    expect(inventory.surfaces.map((surface) => surface.id)).toEqual([
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
    expect(Object.keys(inventory.surfaces[0]).sort()).toEqual([
      'capabilities',
      'companionCli',
      'companionCliError',
      'companionCliInstalled',
      'companionCliStatus',
      'id',
      'installUrl',
      'installed',
      'kind',
      'launchSupport',
      'name',
      'nextAction',
      'previouslyUsed',
      'provider',
      'recommended',
      'status',
    ]);
  });

  it('rejects unsupported surface contract versions', async () => {
    await expect(execFileAsync(process.execPath, [
      cliEntry,
      'start',
      '--check',
      '--format',
      'json',
      '--contract-version',
      'v3',
    ], {
      env: { ...process.env, EAI_UPDATE_CHECK_DISABLED: '1' },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining('Unsupported AI surface contract version: v3. Use v1 or v2.'),
    });
  });

  it('advertises the command through describe', async () => {
    const { stdout } = await execFileAsync(process.execPath, [cliEntry, '--describe'], {
      env: { ...process.env, EAI_UPDATE_CHECK_DISABLED: '1' },
    });
    expect(stdout).toContain('"command": "start"');
    expect(stdout).toContain('"name": "--surface"');
    expect(stdout).toContain('"name": "--contract-version"');
  });

  it('plans the paired CLI install without running it or opening a page', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      cliEntry,
      'start',
      '--surface',
      'vscode-copilot',
      '--install',
      '--dry-run',
      '--format',
      'json',
    ], { env: { ...process.env, EAI_UPDATE_CHECK_DISABLED: '1' } });
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      action: 'install-ai-surface',
      surfaceId: 'vscode-copilot',
      companionCli: 'copilot-cli',
      companionCliStatus: 'planned',
      desktopInstallPageOpened: false,
      url: expect.stringMatching(/^https:\/\//),
    });
  });

  it('keeps dry-run free of installer, detection, and browser side effects', async () => {
    const runInstaller = vi.fn();
    const detect = vi.fn();
    const openUrl = vi.fn();
    const result = await performAiSurfaceInstall({
      surfaceId: 'claude-desktop', inventory: installInventory([]),
      projectDirectory: '/work/app', dryRun: true,
      dependencies: { runInstaller, detect, openUrl },
    });
    expect(result).toMatchObject({ companionCli: 'claude-cli', companionCliStatus: 'planned' });
    expect(runInstaller).not.toHaveBeenCalled();
    expect(detect).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('runs, verifies, and reports a companion CLI update', async () => {
    const runInstaller = vi.fn().mockResolvedValue({ ok: true, reason: 'completed' });
    const detect = vi.fn().mockResolvedValue(installInventory(['codex-cli']));
    const openUrl = vi.fn();
    const result = await performAiSurfaceInstall({
      surfaceId: 'codex-cli', inventory: installInventory(['codex-cli']),
      projectDirectory: '/work/app', dryRun: false,
      dependencies: { runInstaller, detect, openUrl },
    });
    expect(runInstaller).toHaveBeenCalledWith(expect.objectContaining({ platform: 'linux', companionCli: 'codex-cli' }));
    expect(result).toMatchObject({ ok: true, companionCliStatus: 'updated', companionCliInstalled: true });
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('opens official pages and returns safe fields when installation needs user action', async () => {
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const result = await performAiSurfaceInstall({
      surfaceId: 'grok-bot', inventory: installInventory([]),
      projectDirectory: '/work/app', dryRun: false,
      dependencies: {
        runInstaller: vi.fn().mockResolvedValue({ ok: false, reason: 'failed', stderr: 'private' }),
        detect: vi.fn(), openUrl,
      },
    });
    expect(result).toMatchObject({
      ok: false, companionCli: 'grok-cli', companionCliStatus: 'failed',
      desktopInstallPageOpened: true, companionInstallPageOpened: true,
      userActionRequired: true,
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(openUrl).toHaveBeenCalledTimes(2);
  });

  it('opens Google Antigravity rather than Gemini as the current Google source', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      cliEntry,
      'start',
      '--surface',
      'antigravity-cli',
      '--install',
      '--dry-run',
      '--format',
      'json',
    ], { env: { ...process.env, EAI_UPDATE_CHECK_DISABLED: '1' } });
    expect(JSON.parse(stdout)).toMatchObject({
      action: 'install-ai-surface',
      surfaceId: 'antigravity-cli',
      surfaceName: 'Antigravity CLI (agy)',
      companionCli: 'antigravity-cli',
      companionCliStatus: 'planned',
      url: 'https://antigravity.google/docs/cli/install/',
    });
  });

  it('rejects an unauthenticated provider lookalike even in dry-run mode', { timeout: 30_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'eai-start-dispatch-'));
    const executable = join(directory, '.grok', 'bin', process.platform === 'win32' ? 'grok.exe' : 'grok');
    const marker = join(directory, 'provider-was-executed');
    await mkdir(join(directory, '.grok', 'bin'), { recursive: true });
    const script = process.platform === 'win32'
      ? [
          '@echo off',
          `echo executed>"${marker}"`,
          'if "%1"=="--version" echo grok 1.0.13 (test)& exit /b 0',
          'if "%1"=="--help" echo Usage: grok [OPTIONS] [PROMPT]& exit /b 0',
          'exit /b 42',
          '',
        ].join('\r\n')
      : [
          '#!/bin/sh',
          `printf executed > ${JSON.stringify(marker)}`,
          'if [ "$1" = "--version" ]; then printf "%s\\n" "grok 1.0.13 (test)"; exit 0; fi',
          'if [ "$1" = "--help" ]; then printf "%s\\n" "Usage: grok [OPTIONS] [PROMPT]"; exit 0; fi',
          'exit 42',
          '',
        ].join('\n');
    await writeFile(executable, script, 'utf8');
    if (process.platform !== 'win32') await chmod(executable, 0o755);

    try {
      await execFileAsync(process.execPath, [
        cliEntry,
          'start',
          directory,
          '--surface',
          'grok-cli',
        '--dry-run',
        '--format',
        'json',
      ], {
        env: {
          ...process.env,
          EAI_UPDATE_CHECK_DISABLED: '1',
          HOME: directory,
          PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
        },
      }).catch(() => undefined);
      await expect(readFile(marker, 'utf8')).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not execute a detected provider binary during --check', { timeout: 30_000 }, async () => {
    if (process.platform === 'win32') return;
    const directory = await mkdtemp(join(tmpdir(), 'eai-start-metadata-only-'));
    const binDirectory = join(directory, '.local', 'bin');
    const executable = join(binDirectory, 'claude');
    const marker = join(directory, 'provider-was-executed');
    await mkdir(binDirectory, { recursive: true });
    await writeFile(executable, `#!/bin/sh\nprintf executed > ${JSON.stringify(marker)}\n`, 'utf8');
    await chmod(executable, 0o755);

    try {
      const { stdout } = await execFileAsync(process.execPath, [
        cliEntry,
        'start',
        '--check',
        '--format',
        'json',
        '--contract-version',
        'v2',
      ], {
        env: { ...process.env, EAI_UPDATE_CHECK_DISABLED: '1', HOME: directory },
      });
      expect(JSON.parse(stdout)).toMatchObject({ contractVersion: 'eai.ai-surfaces/v2' });
      await expect(readFile(marker, 'utf8')).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
