import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliEntry = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

describe('eai start', () => {
  it('returns the stable read-only detection contract', async () => {
    const { stdout } = await execFileAsync(process.execPath, [cliEntry, 'start', '--check', '--format', 'json'], {
      env: { ...process.env, EAI_UPDATE_CHECK_DISABLED: '1' },
    });
    const inventory = JSON.parse(stdout) as { contractVersion: string; surfaces: Array<{ id: string; installed: boolean }> };
    expect(inventory.contractVersion).toBe('eai.ai-surfaces/v1');
    expect(inventory.surfaces.map((surface) => surface.id)).toEqual(expect.arrayContaining(['vscode-copilot', 'claude-desktop', 'codex-cli', 'grok-cli']));
    expect(inventory.surfaces.every((surface) => typeof surface.installed === 'boolean')).toBe(true);
  });

  it('advertises the command through describe', async () => {
    const { stdout } = await execFileAsync(process.execPath, [cliEntry, '--describe'], {
      env: { ...process.env, EAI_UPDATE_CHECK_DISABLED: '1' },
    });
    expect(stdout).toContain('"command": "start"');
    expect(stdout).toContain('"name": "--surface"');
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
});
