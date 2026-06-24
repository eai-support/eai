import { describe, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  buildUpdateInstallArgs,
  buildUpdatePermissionGuidance,
  isUpdatePermissionError,
} from '../../src/commands/update.js';
import {
  compareVersions,
  selectNewestRelease,
} from '../../src/lib/update-check.js';
import { getNpmExecutable } from '../../src/lib/npm.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { runCommand } from '../helpers/action-dsl.js';
import type { TestContext } from '../helpers/setup-dsl.js';

async function startPackumentServer(latestVersion: string): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  const server: Server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ 'dist-tags': { latest: latestVersion } }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start packument test server');
  }

  return {
    url: `http://127.0.0.1:${address.port}/@eai-tools/cli`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    }),
  };
}

describe('buildUpdateInstallArgs', () => {
  test('uses the scoped static registry override for CLI installs', () => {
    expect(buildUpdateInstallArgs('1.2.3')).toEqual([
      'install',
      '-g',
      '@eai-tools/cli@1.2.3',
      '--prefer-online',
      '--@eai-tools:registry=https://eai-tools.github.io/eai/registry/',
    ]);
  });
});

describe('getNpmExecutable', () => {
  test('uses npm on macOS and Linux', () => {
    expect(getNpmExecutable('darwin')).toBe('npm');
    expect(getNpmExecutable('linux')).toBe('npm');
  });

  test('uses npm.cmd on Windows', () => {
    expect(getNpmExecutable('win32')).toBe('npm.cmd');
  });
});

describe('update permission guidance', () => {
  test('detects permission failures', () => {
    expect(isUpdatePermissionError('spawn EACCES')).toBe(true);
    expect(isUpdatePermissionError('permission denied')).toBe(true);
    expect(isUpdatePermissionError('spawn npm ENOENT')).toBe(false);
  });

  test('avoids sudo-centric guidance on Unix', () => {
    expect(buildUpdatePermissionGuidance('1.2.3', 'static-registry', 'darwin')).toEqual([
      'Your global npm install location is not writable from this shell.',
      'Retry from a shell that can write to your global npm directory: npm install -g @eai-tools/cli@1.2.3 --prefer-online --@eai-tools:registry=https://eai-tools.github.io/eai/registry/',
      'If you use nvm, Homebrew, or Volta, prefer their user-writable install path instead of sudo.',
    ]);
  });

  test('includes the scoped registry when retrying a static-registry install', () => {
    expect(buildUpdatePermissionGuidance('1.2.3', 'static-registry', 'darwin')).toEqual([
      'Your global npm install location is not writable from this shell.',
      'Retry from a shell that can write to your global npm directory: npm install -g @eai-tools/cli@1.2.3 --prefer-online --@eai-tools:registry=https://eai-tools.github.io/eai/registry/',
      'If you use nvm, Homebrew, or Volta, prefer their user-writable install path instead of sudo.',
    ]);
  });

  test('uses elevated shell guidance on Windows', () => {
    expect(buildUpdatePermissionGuidance('1.2.3', 'static-registry', 'win32')).toEqual([
      'Your global npm install location is not writable from this shell.',
      'Retry from an elevated PowerShell or Command Prompt: npm install -g @eai-tools/cli@1.2.3 --prefer-online --@eai-tools:registry=https://eai-tools.github.io/eai/registry/',
    ]);
  });
});

describe('release channel selection', () => {
  test('compares semver numerically', () => {
    expect(compareVersions('2.8.4', '2.8.0')).toBeGreaterThan(0);
    expect(compareVersions('2.8.0', '2.8.4')).toBeLessThan(0);
    expect(compareVersions('2.8.4', '2.8.4')).toBe(0);
  });

  test('returns the static registry release when present', () => {
    expect(selectNewestRelease([
      { channel: 'static-registry', version: '2.8.4' },
    ])).toEqual({ channel: 'static-registry', version: '2.8.4' });
  });

  test('picks the newer static registry version when multiple static snapshots are compared', () => {
    expect(selectNewestRelease([
      { channel: 'static-registry', version: '2.8.4' },
      { channel: 'static-registry', version: '2.8.5' },
    ])).toEqual({ channel: 'static-registry', version: '2.8.5' });
  });
});

describe('discovery update notifier', () => {
  async function createUpdateCheckContext(latestVersion = '99.99.99'): Promise<{
    readonly env: TestEnvironment;
    readonly ctx: TestContext;
    readonly close: () => Promise<void>;
  }> {
    const env = await createTestEnvironment();
    const server = await startPackumentServer(latestVersion);
    const ctx: TestContext = {
      workingDir: env.dir,
      mockAPI: {} as TestContext['mockAPI'],
      env: {
        EAI_UPDATE_NOTIFIER_FORCE: '1',
        EAI_UPDATE_PACKUMENT_URL: server.url,
        NO_COLOR: '1',
      },
      prompts: [],
    };

    return {
      env,
      ctx,
      close: async () => {
        await server.close();
        await env.cleanup();
      },
    };
  }

  test('checks for updates when a user runs root help discovery', async () => {
    const { ctx, close } = await createUpdateCheckContext();
    try {
      const result = await runCommand(ctx, 'eai');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: eai [options] [command]');
      expect(result.stderr).toContain('Update available:');
      expect(result.stderr).toContain('Run eai update to update');
    } finally {
      await close();
    }
  });

  test('checks for updates before reporting an unknown top-level command', async () => {
    const { ctx, close } = await createUpdateCheckContext();
    try {
      const result = await runCommand(ctx, 'eai future-command');

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Update available:');
      expect(result.stderr).toContain("error: unknown command 'future-command'");
    } finally {
      await close();
    }
  });

  test('keeps --describe machine-readable and free of update banners', async () => {
    const { ctx, close } = await createUpdateCheckContext();
    try {
      const result = await runCommand(ctx, 'eai --describe');

      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain('Update available:');
      const schema = JSON.parse(result.stdout) as {
        subcommands: Array<{ command: string }>;
      };
      expect(schema.subcommands.map((command) => command.command)).toEqual(
        expect.arrayContaining(['errors', 'agent']),
      );
    } finally {
      await close();
    }
  });
});
