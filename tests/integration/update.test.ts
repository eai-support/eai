import { describe, expect, test } from 'vitest';
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

describe('buildUpdateInstallArgs', () => {
  test('uses the scoped static registry override for CLI installs', () => {
    expect(buildUpdateInstallArgs('1.2.3')).toEqual([
      'install',
      '-g',
      '@eai-tools/cli@1.2.3',
      '--prefer-online',
      '--@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry/',
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
      'Retry from a shell that can write to your global npm directory: npm install -g @eai-tools/cli@1.2.3 --prefer-online --@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry/',
      'If you use nvm, Homebrew, or Volta, prefer their user-writable install path instead of sudo.',
    ]);
  });

  test('includes the scoped registry when retrying a static-registry install', () => {
    expect(buildUpdatePermissionGuidance('1.2.3', 'static-registry', 'darwin')).toEqual([
      'Your global npm install location is not writable from this shell.',
      'Retry from a shell that can write to your global npm directory: npm install -g @eai-tools/cli@1.2.3 --prefer-online --@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry/',
      'If you use nvm, Homebrew, or Volta, prefer their user-writable install path instead of sudo.',
    ]);
  });

  test('uses elevated shell guidance on Windows', () => {
    expect(buildUpdatePermissionGuidance('1.2.3', 'static-registry', 'win32')).toEqual([
      'Your global npm install location is not writable from this shell.',
      'Retry from an elevated PowerShell or Command Prompt: npm install -g @eai-tools/cli@1.2.3 --prefer-online --@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry/',
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
