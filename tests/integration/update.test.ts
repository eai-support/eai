import { describe, expect, test } from 'vitest';
import { buildUpdateInstallArgs } from '../../src/commands/update.js';

describe('buildUpdateInstallArgs', () => {
  test('uses a scoped registry override so public npm dependencies still resolve', () => {
    expect(buildUpdateInstallArgs('0.1.5')).toEqual([
      'install',
      '-g',
      '@eai-tools/cli@0.1.5',
      '--@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry',
    ]);
  });
});
