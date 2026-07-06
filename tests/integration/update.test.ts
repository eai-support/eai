import { describe, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  buildUpdateInstallArgs,
  buildUpdatePermissionGuidance,
  isUpdatePermissionError,
} from '../../src/commands/update.js';
import {
  compareVersions,
  selectNewestRelease,
  shouldOfferInteractiveUpdatePrompt,
} from '../../src/lib/update-check.js';
import { getNpmExecutable } from '../../src/lib/npm.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { runCommand } from '../helpers/action-dsl.js';
import type { TestContext } from '../helpers/setup-dsl.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

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
    url: `http://127.0.0.1:${address.port}/@enterpriseai/cli`,
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createEaiProjectFixture(root: string): Promise<void> {
  await mkdir(join(root, 'src', 'eai.config'), { recursive: true });
  await writeFile(
    join(root, 'src', 'eai.config', 'object-types.ts'),
    'export const objectTypes = {};\n',
    'utf-8',
  );
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify({
      name: '@eai-tools/update-maintenance-fixture',
      version: '0.0.1',
      type: 'module',
      dependencies: {
        '@eai-tools/core': '1.0.0',
      },
    }, null, 2)}\n`,
    'utf-8',
  );
}

describe('buildUpdateInstallArgs', () => {
  test('uses npmjs for canonical CLI installs by default', () => {
    expect(buildUpdateInstallArgs('1.2.3')).toEqual([
      'install',
      '-g',
      '@enterpriseai/cli@1.2.3',
      '--prefer-online',
      '--registry=https://registry.npmjs.org/',
      '--@enterpriseai:registry=https://registry.npmjs.org/',
    ]);
  });

  test('uses the simple eai-cli alias when the alias package is installed', () => {
    expect(buildUpdateInstallArgs('1.2.3', 'npmjs', 'eai-cli')).toEqual([
      'install',
      '-g',
      'eai-cli@1.2.3',
      '--prefer-online',
      '--registry=https://registry.npmjs.org/',
    ]);
  });

  test('uses the scoped static registry override for fallback installs', () => {
    expect(buildUpdateInstallArgs('1.2.3', 'static-registry')).toEqual([
      'install',
      '-g',
      '@enterpriseai/cli@1.2.3',
      '--prefer-online',
      '--@enterpriseai:registry=https://eai-tools.github.io/eai/registry/',
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
    expect(buildUpdatePermissionGuidance('1.2.3', 'npmjs', 'darwin')).toEqual([
      'Your global npm install location is not writable from this shell.',
      'Retry from a shell that can write to your global npm directory: npm install -g @enterpriseai/cli@1.2.3 --prefer-online --registry=https://registry.npmjs.org/ --@enterpriseai:registry=https://registry.npmjs.org/',
      'If you use nvm, Homebrew, or Volta, prefer their user-writable install path instead of sudo.',
    ]);
  });

  test('includes the static fallback registry when retrying a static-registry install', () => {
    expect(buildUpdatePermissionGuidance('1.2.3', 'static-registry', 'darwin')).toEqual([
      'Your global npm install location is not writable from this shell.',
      'Retry from a shell that can write to your global npm directory: npm install -g @enterpriseai/cli@1.2.3 --prefer-online --@enterpriseai:registry=https://eai-tools.github.io/eai/registry/',
      'If you use nvm, Homebrew, or Volta, prefer their user-writable install path instead of sudo.',
    ]);
  });

  test('uses elevated shell guidance on Windows', () => {
    expect(buildUpdatePermissionGuidance('1.2.3', 'npmjs', 'win32')).toEqual([
      'Your global npm install location is not writable from this shell.',
      'Retry from an elevated PowerShell or Command Prompt: npm install -g @enterpriseai/cli@1.2.3 --prefer-online --registry=https://registry.npmjs.org/ --@enterpriseai:registry=https://registry.npmjs.org/',
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

  test('prefers npmjs when npmjs and the static registry have the same version', () => {
    expect(selectNewestRelease([
      { channel: 'static-registry', version: '2.8.5' },
      { channel: 'npmjs', version: '2.8.5' },
    ])).toEqual({ channel: 'npmjs', version: '2.8.5' });
  });

  test('uses the newer static fallback when npmjs is behind', () => {
    expect(selectNewestRelease([
      { channel: 'npmjs', version: '2.8.4' },
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
        EAI_UPDATE_NPMJS_PACKUMENT_URL: server.url,
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
        subcommands: Array<{ command: string; options?: Array<{ name: string }> }>;
      };
      expect(schema.subcommands.map((command) => command.command)).toEqual(
        expect.arrayContaining(['errors', 'agent']),
      );
      const updateCommand = schema.subcommands.find((command) => command.command === 'update');
      expect(updateCommand?.options?.map((option) => option.name)).not.toContain('--project-maintenance-only');
    } finally {
      await close();
    }
  });
});

describe('interactive update prompt safety', () => {
  const tty = { isTTY: true };
  const notTty = { isTTY: false };

  test('offers update prompt only for safe interactive text commands', () => {
    expect(shouldOfferInteractiveUpdatePrompt(['whoami'], {}, tty, tty)).toBe(true);
    expect(shouldOfferInteractiveUpdatePrompt(['whoami', '--format', 'json'], {}, tty, tty)).toBe(false);
    expect(shouldOfferInteractiveUpdatePrompt(['whoami', '--json'], {}, tty, tty)).toBe(false);
    expect(shouldOfferInteractiveUpdatePrompt(['--describe'], {}, tty, tty)).toBe(false);
    expect(shouldOfferInteractiveUpdatePrompt(['whoami'], { CI: 'true' }, tty, tty)).toBe(false);
    expect(shouldOfferInteractiveUpdatePrompt(['whoami'], {}, notTty, tty)).toBe(false);
    expect(shouldOfferInteractiveUpdatePrompt(['whoami'], { NO_UPDATE_NOTIFIER: '1' }, tty, tty)).toBe(false);
  });
});

describe('eai update project maintenance', () => {
  async function createMaintenanceContext(): Promise<{
    readonly env: TestEnvironment;
    readonly ctx: TestContext;
    readonly close: () => Promise<void>;
  }> {
    const env = await createTestEnvironment();
    const server = await startPackumentServer(pkg.version);
    await createEaiProjectFixture(env.dir);

    const ctx: TestContext = {
      workingDir: env.dir,
      mockAPI: {} as TestContext['mockAPI'],
      env: {
        EAI_UPDATE_NPMJS_PACKUMENT_URL: server.url,
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

  test('runs read-only project maintenance during update checks', async () => {
    const { env, ctx, close } = await createMaintenanceContext();
    try {
      const result = await runCommand(ctx, 'eai update --check');

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Already on the latest version');
      expect(result.stdout).toContain('Project Maintenance');
      expect(result.stdout).toContain('Gofer-managed asset refresh is available');
      expect(await pathExists(join(env.dir, '.eai-manifest.json'))).toBe(false);
    } finally {
      await close();
    }
  });

  test('applies safe Gofer maintenance during explicit update', async () => {
    const { env, ctx, close } = await createMaintenanceContext();
    try {
      const result = await runCommand(ctx, 'eai update');

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Already on the latest version');
      expect(result.stdout).toContain('Project Maintenance');
      expect(result.stdout).toContain('Gofer-managed assets refreshed');
      expect(await pathExists(join(env.dir, '.eai-manifest.json'))).toBe(true);
      expect(await pathExists(join(env.dir, '.specify', 'commands', '0_gofer_start.md'))).toBe(true);
    } finally {
      await close();
    }
  });
});
