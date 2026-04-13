import { describe, expect, test } from 'vitest';
import {
  buildUpdateInstallArgs,
  buildUpdatePermissionGuidance,
  isUpdatePermissionError,
} from '../../src/commands/update.js';
import { getNpmExecutable } from '../../src/lib/npm.js';

describe('buildUpdateInstallArgs', () => {
  test('uses a scoped registry override so public npm dependencies still resolve', () => {
    expect(buildUpdateInstallArgs('1.2.3')).toEqual([
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
    expect(buildUpdatePermissionGuidance('1.2.3', 'darwin')).toEqual([
      'Your global npm install location is not writable from this shell.',
      'Retry from a shell that can write to your global npm directory: npm install -g @eai-tools/cli@1.2.3 --prefer-online --@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry',
      'If you use nvm, Homebrew, or Volta, prefer their user-writable install path instead of sudo.',
    ]);
  });

  test('uses elevated shell guidance on Windows', () => {
    expect(buildUpdatePermissionGuidance('1.2.3', 'win32')).toEqual([
      'Your global npm install location is not writable from this shell.',
      'Retry from an elevated PowerShell or Command Prompt: npm install -g @eai-tools/cli@1.2.3 --prefer-online --@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry',
    ]);
  });
});
