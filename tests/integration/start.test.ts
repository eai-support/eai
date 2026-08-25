import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliEntry = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const projectDirectory = fileURLToPath(new URL('../../', import.meta.url));
const existingProjectFile = fileURLToPath(new URL('../../package.json', import.meta.url));
const AI_SURFACE_INTEGRATION_TIMEOUT_MS = 30_000;

interface CliExecution {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function cliRuns(args: readonly string[]): Promise<CliExecution> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, ...args], {
      env: { ...process.env, EAI_UPDATE_CHECK_DISABLED: '1', NO_COLOR: '1' },
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof failure.code === 'number' ? failure.code : -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

function expectCleanJsonFailure(
  execution: CliExecution,
  expectedMessage: string,
): void {
  expect(execution.exitCode).toBe(1);
  expect(execution.stderr).toBe('');
  expect(execution.stdout).not.toContain('file://');
  expect(execution.stdout).not.toContain('Node.js v');
  expect(JSON.parse(execution.stdout)).toEqual({
    action: 'start',
    ok: false,
    error: { message: expectedMessage },
  });
}

describe('eai start', () => {
  it('returns the stable read-only detection contract', async () => {
    const { stdout } = await execFileAsync(process.execPath, [cliEntry, 'start', '--check', '--format', 'json'], {
      env: { ...process.env, EAI_UPDATE_CHECK_DISABLED: '1' },
    });
    const inventory = JSON.parse(stdout) as { contractVersion: string; launchContractVersion: string; surfaces: Array<{ id: string; installed: boolean }> };
    expect(inventory.contractVersion).toBe('eai.ai-surfaces/v1');
    expect(inventory.launchContractVersion).toBe('eai.ai-launch/v1');
    expect(inventory.surfaces.map((surface) => surface.id)).toEqual(expect.arrayContaining(['vscode-copilot', 'claude-desktop', 'codex-cli', 'grok-cli']));
    expect(inventory.surfaces.every((surface) => typeof surface.installed === 'boolean')).toBe(true);
  }, AI_SURFACE_INTEGRATION_TIMEOUT_MS);

  it('advertises the command through describe', async () => {
    const { stdout } = await execFileAsync(process.execPath, [cliEntry, '--describe'], {
      env: { ...process.env, EAI_UPDATE_CHECK_DISABLED: '1' },
    });
    expect(stdout).toContain('"command": "start"');
    expect(stdout).toContain('"name": "--surface"');
  });

  it('advertises explicit Copilot prompt insertion through describe and help', async () => {
    const [describeExecution, helpExecution] = await Promise.all([
      cliRuns(['--describe']),
      cliRuns(['start', '--help']),
    ]);

    expect(describeExecution.exitCode).toBe(0);
    expect(describeExecution.stderr).toBe('');
    expect(describeExecution.stdout).toContain('"name": "--allow-copilot-prompt-insertion"');
    expect(helpExecution.exitCode).toBe(0);
    expect(helpExecution.stderr).toBe('');
    expect(helpExecution.stdout).toContain('--allow-copilot-prompt-insertion');
  });

  it('returns a clean JSON failure for an unknown surface', async () => {
    const execution = await cliRuns([
      'start',
      projectDirectory,
      '--surface',
      'not-a-surface',
      '--dry-run',
      '--format',
      'json',
    ]);

    expectCleanJsonFailure(execution, 'Unknown AI surface: not-a-surface');
  }, AI_SURFACE_INTEGRATION_TIMEOUT_MS);

  it('returns a clean JSON failure for a missing project folder', async () => {
    const missingProjectDirectory = `${cliEntry}/missing-project`;

    const execution = await cliRuns([
      'start',
      missingProjectDirectory,
      '--check',
      '--format',
      'json',
    ]);

    expectCleanJsonFailure(execution, `Project folder does not exist: ${missingProjectDirectory}`);
  });

  it('rejects an existing file because it is not a project folder', async () => {
    const execution = await cliRuns([
      'start',
      existingProjectFile,
      '--check',
      '--format',
      'json',
    ]);

    expectCleanJsonFailure(execution, `Project path is not a folder: ${existingProjectFile}`);
  });

  it('requires an explicit Copilot Desktop surface for prompt-insertion consent', async () => {
    const execution = await cliRuns([
      'start',
      projectDirectory,
      '--allow-copilot-prompt-insertion',
      '--dry-run',
      '--format',
      'json',
    ]);

    expectCleanJsonFailure(
      execution,
      '--allow-copilot-prompt-insertion requires --surface copilot-desktop.',
    );
  });

  it('rejects an unsupported output format without a stack trace', async () => {
    const execution = await cliRuns([
      'start',
      projectDirectory,
      '--check',
      '--format',
      'yaml',
    ]);

    expect(execution.exitCode).toBe(1);
    expect(execution.stdout).toBe('');
    expect(execution.stderr).toContain('Unsupported format. Use text or json.');
    expect(execution.stderr).not.toContain('file://');
    expect(execution.stderr).not.toContain('Node.js v');
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
  }, AI_SURFACE_INTEGRATION_TIMEOUT_MS);
});
