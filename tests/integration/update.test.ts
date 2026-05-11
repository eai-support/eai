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
  test('uses npm directly when npm is the newest release source', () => {
    expect(buildUpdateInstallArgs('1.2.3')).toEqual([
      'install',
      '-g',
      '@eai-tools/cli@1.2.3',
      '--prefer-online',
      '--@eai-tools:registry=https://registry.npmjs.org/',
      '--registry=https://registry.npmjs.org/',
    ]);
  });

  test('uses a scoped registry override when the static registry is newer', () => {
    expect(buildUpdateInstallArgs('1.2.3', 'static-registry')).toEqual([
      'install',
      '-g',
      '@eai-tools/cli@1.2.3',
      '--prefer-online',
      '--@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry',
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
    expect(buildUpdatePermissionGuidance('1.2.3', 'npm', 'darwin')).toEqual([
      'Your global npm install location is not writable from this shell.',
      'Retry from a shell that can write to your global npm directory: npm install -g @eai-tools/cli@1.2.3 --prefer-online --@eai-tools:registry=https://registry.npmjs.org/ --registry=https://registry.npmjs.org/',
      'If you use nvm, Homebrew, or Volta, prefer their user-writable install path instead of sudo.',
    ]);
  });

  test('includes the scoped registry when the static registry is the freshest channel', () => {
    expect(buildUpdatePermissionGuidance('1.2.3', 'static-registry', 'darwin')).toEqual([
      'Your global npm install location is not writable from this shell.',
      'Retry from a shell that can write to your global npm directory: npm install -g @eai-tools/cli@1.2.3 --prefer-online --@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry',
      'If you use nvm, Homebrew, or Volta, prefer their user-writable install path instead of sudo.',
    ]);
  });

  test('uses elevated shell guidance on Windows', () => {
    expect(buildUpdatePermissionGuidance('1.2.3', 'npm', 'win32')).toEqual([
      'Your global npm install location is not writable from this shell.',
      'Retry from an elevated PowerShell or Command Prompt: npm install -g @eai-tools/cli@1.2.3 --prefer-online --@eai-tools:registry=https://registry.npmjs.org/ --registry=https://registry.npmjs.org/',
    ]);
  });
});

describe('release channel selection', () => {
  test('compares semver numerically', () => {
    expect(compareVersions('2.8.4', '2.8.0')).toBeGreaterThan(0);
    expect(compareVersions('2.8.0', '2.8.4')).toBeLessThan(0);
    expect(compareVersions('2.8.4', '2.8.4')).toBe(0);
  });

  test('picks the newest version across npm and static registry', () => {
    expect(selectNewestRelease([
      { channel: 'npm', version: '2.8.0' },
      { channel: 'static-registry', version: '2.8.4' },
    ])).toEqual({ channel: 'static-registry', version: '2.8.4' });
  });

  test('prefers npm when both channels expose the same latest version', () => {
    expect(selectNewestRelease([
      { channel: 'static-registry', version: '2.8.4' },
      { channel: 'npm', version: '2.8.4' },
    ])).toEqual({ channel: 'npm', version: '2.8.4' });
  });
});
