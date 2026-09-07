import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliEntry = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

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

  it('exposes a fixed official provider source without opening it in dry-run mode', async () => {
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
      action: 'open-install-source',
      opened: false,
      surfaceId: 'vscode-copilot',
      officialProvider: 'GitHub',
      url: expect.stringMatching(/^https:\/\//),
    });
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
      action: 'open-install-source',
      opened: false,
      surfaceId: 'antigravity-cli',
      surfaceName: 'Antigravity CLI (agy)',
      officialProvider: 'Google',
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
      await expect(execFileAsync(process.execPath, [
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
      })).rejects.toThrow('Grok Build is not installed');
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
      const inventory = JSON.parse(stdout) as { surfaces: Array<{ id: string; installed: boolean }> };
      expect(inventory.surfaces.find((surface) => surface.id === 'claude-cli')?.installed).toBe(false);
      await expect(readFile(marker, 'utf8')).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
