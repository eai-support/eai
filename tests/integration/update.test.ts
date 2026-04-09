import { describe, expect, test } from 'vitest';
import { buildUpdateInstallArgs } from '../../src/commands/update.js';
import { getNpmExecutable } from '../../src/lib/npm.js';

describe('buildUpdateInstallArgs', () => {
  test('uses a scoped registry override so public npm dependencies still resolve', () => {
    expect(buildUpdateInstallArgs('1.2.3')).toEqual([
      'install',
      '-g',
      '@eai-tools/cli@1.2.3',
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
