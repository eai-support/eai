import { describe, expect, it, vi } from 'vitest';
import {
  buildCompanionInstallerExecConfig,
  buildCompanionInstallerEnvironment,
  installAndVerifyCompanionCli,
  runCompanionCliInstaller,
} from '../../src/lib/ai-surface-installer.js';

describe('AI surface companion installer', () => {
  it.each([
    ['copilot-cli', 'copilot'],
    ['antigravity-cli', 'antigravity'],
    ['claude-cli', 'claude'],
    ['codex-cli', 'codex'],
    ['grok-cli', 'grok'],
  ] as const)('maps %s to the verified helper tool %s', (companion, tool) => {
    const config = buildCompanionInstallerExecConfig('linux', '/workspace', companion, '/resources');
    expect(config).toMatchObject({
      command: '/bin/bash',
      args: ['/resources/bash-scripts/install-optional-tools.sh', '--workspace-path', '/workspace', '--tools', tool],
    });
  });

  it('builds a non-interactive Windows command without a shell', () => {
    const config = buildCompanionInstallerExecConfig('win32', 'C:\\workspace', 'codex-cli', 'C:\\resources');
    expect(config.command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(config.args).toContain('-NonInteractive');
    expect(config.args).toContain('codex');
  });

  it('uses the configured Windows system root for PowerShell', () => {
    const config = buildCompanionInstallerExecConfig(
      'win32',
      'D:\\workspace',
      'copilot-cli',
      'D:\\resources',
      { SystemRoot: 'D:\\Windows' },
    );
    expect(config.command).toBe('D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(config.systemRoot).toBe('D:\\Windows');
  });

  it('returns a safe result without returning child output', async () => {
    const runner = vi.fn().mockResolvedValue({ exitCode: 1, stdout: 'secret', stderr: 'private path' });
    const result = await runCompanionCliInstaller({
      platform: 'linux',
      workspacePath: '.',
      companionCli: 'claude-cli',
      resourcesPath: 'resources/gofer',
      runner,
    });
    expect(result).toEqual({ ok: false, reason: 'failed' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('private path');
  });

  it('removes shell hooks and builds a trusted executable search path', () => {
    const environment = buildCompanionInstallerEnvironment('linux', {
      HOME: '/home/test',
      PATH: '/attacker',
      BASH_ENV: '/attacker/start.sh',
      NODE_OPTIONS: '--require=/attacker/node.js',
    });
    expect(environment.HOME).toBe('/home/test');
    expect(environment.PATH).not.toContain('/attacker');
    expect(environment).not.toHaveProperty('BASH_ENV');
    expect(environment).not.toHaveProperty('NODE_OPTIONS');
  });

  it('reports helper completion for later trusted verification', async () => {
    const result = await runCompanionCliInstaller({
      platform: 'darwin',
      workspacePath: '.',
      companionCli: 'grok-cli',
      resourcesPath: 'resources/gofer',
      runner: vi.fn().mockResolvedValue({ exitCode: 0 }),
    });
    expect(result).toEqual({ ok: true, reason: 'completed' });
  });

  it.each([
    [false, 'installed'],
    [true, 'updated'],
  ] as const)('reports verified completion when prior installed is %s', async (wasInstalled, status) => {
    const result = await installAndVerifyCompanionCli({
      companionCli: 'codex-cli',
      wasInstalled,
      runInstaller: async () => ({ ok: true, reason: 'completed' }),
      verifyInstalled: async () => true,
    });
    expect(result).toEqual({ status, installed: true, userActionRequired: false });
  });

  it('does not report success when trusted detection cannot verify the CLI', async () => {
    const result = await installAndVerifyCompanionCli({
      companionCli: 'claude-cli',
      wasInstalled: false,
      runInstaller: async () => ({ ok: true, reason: 'completed' }),
      verifyInstalled: async () => false,
    });
    expect(result).toEqual({ status: 'user-action-required', installed: false, userActionRequired: true });
  });

  it('returns user action when trusted detection throws', async () => {
    const result = await installAndVerifyCompanionCli({
      companionCli: 'claude-cli',
      wasInstalled: false,
      runInstaller: async () => ({ ok: true, reason: 'completed' }),
      verifyInstalled: async () => { throw new Error('unsafe local detail'); },
    });
    expect(result).toEqual({ status: 'user-action-required', installed: false, userActionRequired: true });
  });

  it('returns a safe failure when the installer rejects', async () => {
    const result = await installAndVerifyCompanionCli({
      companionCli: 'copilot-cli',
      wasInstalled: true,
      runInstaller: async () => { throw new Error('missing local resource'); },
      verifyInstalled: async () => true,
    });
    expect(result).toEqual({ status: 'failed', installed: true, userActionRequired: true });
  });
});
