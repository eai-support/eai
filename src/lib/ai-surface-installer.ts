import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { delimiter, dirname, join, resolve, sep, win32 } from 'node:path';
import { resolveGoferResourcesPath } from './gofer-installer.js';
import type { CompanionCliSurfaceId } from './ai-surfaces.js';

// Packaged helpers own the 15-minute provider deadline and cleanup. This outer
// deadline is a final guard with enough headroom for their cleanup path.
const INSTALL_TIMEOUT_MS = 17 * 60 * 1000;

export type CompanionInstallerTool = 'copilot' | 'antigravity' | 'claude' | 'codex' | 'grok';

export interface CompanionInstallerExecConfig {
  readonly platform: NodeJS.Platform;
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly systemRoot?: string;
}

export interface CompanionInstallerRunResult {
  readonly ok: boolean;
  readonly reason: 'completed' | 'failed';
}

export type CompanionCliInstallStatus =
  | 'installed'
  | 'updated'
  | 'failed'
  | 'user-action-required';

export interface CompanionCliInstallResult {
  readonly status: CompanionCliInstallStatus;
  readonly installed: boolean;
  readonly userActionRequired: boolean;
}

export type CompanionInstallerRunner = (
  config: CompanionInstallerExecConfig,
) => Promise<{ readonly exitCode: number }>;

const COMPANION_TO_TOOL: Readonly<Record<CompanionCliSurfaceId, CompanionInstallerTool>> = Object.freeze({
  'copilot-cli': 'copilot',
  'antigravity-cli': 'antigravity',
  'claude-cli': 'claude',
  'codex-cli': 'codex',
  'grok-cli': 'grok',
});

export function buildCompanionInstallerEnvironment(
  platform: NodeJS.Platform,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nodeDirectory = dirname(process.execPath);
  const trustedPath = platform === 'win32'
    ? [nodeDirectory, `${source.SystemRoot ?? 'C:\\Windows'}\\System32`]
    : [nodeDirectory, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const environment: NodeJS.ProcessEnv = { PATH: [...new Set(trustedPath)].join(delimiter) };
  for (const key of [
    'HOME', 'USER', 'LOGNAME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'ProgramFiles', 'ProgramFiles(x86)', 'SystemRoot', 'ComSpec',
    'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL',
  ]) {
    if (source[key]) environment[key] = source[key];
  }
  return environment;
}

export function buildCompanionInstallerExecConfig(
  platform: NodeJS.Platform,
  workspacePath: string,
  companionCli: CompanionCliSurfaceId,
  resourcesPath = resolveGoferResourcesPath(),
  environment: NodeJS.ProcessEnv = process.env,
): CompanionInstallerExecConfig {
  const workspace = resolve(workspacePath);
  const tool = COMPANION_TO_TOOL[companionCli];
  if (platform === 'win32') {
    const systemRoot = environment.SystemRoot ?? 'C:\\Windows';
    return {
      platform,
      command: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(resourcesPath, 'powershell-scripts', 'install-optional-tools.ps1'),
        '-WorkspacePath',
        workspace,
        '-Tools',
        tool,
      ],
      timeoutMs: INSTALL_TIMEOUT_MS,
      systemRoot,
    };
  }
  if (platform === 'darwin' || platform === 'linux') {
    return {
      platform,
      command: '/bin/bash',
      args: [
        join(resourcesPath, 'bash-scripts', 'install-optional-tools.sh'),
        '--workspace-path',
        workspace,
        '--tools',
        tool,
      ],
      timeoutMs: INSTALL_TIMEOUT_MS,
    };
  }
  throw new Error(`Companion CLI installation is not supported on ${platform}.`);
}

async function defaultCompanionInstallerRunner(
  config: CompanionInstallerExecConfig,
): Promise<{ readonly exitCode: number }> {
  return new Promise((resolveResult) => {
    const child = spawn(config.command, [...config.args], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
      detached: config.platform !== 'win32',
      env: buildCompanionInstallerEnvironment(config.platform),
    });
    let settled = false;
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ exitCode });
    };
    const timer = setTimeout(() => {
      if (config.platform === 'win32') {
        spawn(win32.join(config.systemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], {
          shell: false, stdio: 'ignore', windowsHide: true,
          env: buildCompanionInstallerEnvironment('win32'),
        }).once('error', () => child.kill('SIGTERM'));
      } else if (child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      }
      setTimeout(() => {
        if (settled && child.exitCode !== null) return;
        if (config.platform !== 'win32' && child.pid) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        } else child.kill('SIGKILL');
      }, 5_000).unref();
    }, config.timeoutMs);
    child.once('error', () => finish(1));
    child.once('close', (code) => finish(code ?? 1));
  });
}

export async function runCompanionCliInstaller(options: {
  readonly platform?: NodeJS.Platform;
  readonly workspacePath: string;
  readonly companionCli: CompanionCliSurfaceId;
  readonly resourcesPath?: string;
  readonly runner?: CompanionInstallerRunner;
}): Promise<CompanionInstallerRunResult> {
  const platform = options.platform ?? process.platform;
  const config = buildCompanionInstallerExecConfig(
    platform,
    options.workspacePath,
    options.companionCli,
    options.resourcesPath,
  );
  const scriptIndex = platform === 'win32' ? 6 : 0;
  const resourceRoot = await realpath(options.resourcesPath ?? resolveGoferResourcesPath());
  const scriptPath = config.args[scriptIndex];
  const scriptStatus = await lstat(scriptPath);
  const resolvedScript = await realpath(scriptPath);
  if (!scriptStatus.isFile()
    || scriptStatus.isSymbolicLink()
    || (resolvedScript !== resourceRoot && !resolvedScript.startsWith(`${resourceRoot}${sep}`))) {
    throw new Error('EAI refused an untrusted companion installer resource.');
  }
  const trustedConfig = {
    ...config,
    args: config.args.map((value, index) => index === scriptIndex ? resolvedScript : value),
  };
  const result = await (options.runner ?? defaultCompanionInstallerRunner)(trustedConfig);
  return result.exitCode === 0
    ? { ok: true, reason: 'completed' }
    : { ok: false, reason: 'failed' };
}

export async function installAndVerifyCompanionCli(options: {
  readonly companionCli: CompanionCliSurfaceId;
  readonly wasInstalled: boolean;
  readonly runInstaller: () => Promise<CompanionInstallerRunResult>;
  readonly verifyInstalled: () => Promise<boolean>;
}): Promise<CompanionCliInstallResult> {
  const run = await options.runInstaller().catch(() => ({ ok: false, reason: 'failed' as const }));
  if (!run.ok) {
    return { status: 'failed', installed: options.wasInstalled, userActionRequired: true };
  }
  const installed = await options.verifyInstalled().catch(() => false);
  if (!installed) {
    return { status: 'user-action-required', installed: false, userActionRequired: true };
  }
  return {
    status: options.wasInstalled ? 'updated' : 'installed',
    installed: true,
    userActionRequired: false,
  };
}
