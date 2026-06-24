import { describe, expect, test } from 'vitest';
import {
  buildDevServerArgs,
  getDevServerSpawnConfig,
  normalizeDevPort,
} from '../../src/commands/dev.js';

describe('eai dev spawn configuration', () => {
  test('builds the npm dev script arguments with Turbopack enabled', () => {
    expect(buildDevServerArgs('3000', true)).toEqual([
      'run',
      'dev',
      '--',
      '--port',
      '3000',
      '--turbopack',
    ]);
  });

  test('builds the npm dev script arguments with Turbopack disabled', () => {
    expect(buildDevServerArgs('3001', false)).toEqual([
      'run',
      'dev',
      '--',
      '--port',
      '3001',
    ]);
  });

  test('uses shell mode only on Windows so npm.cmd can launch reliably', () => {
    expect(getDevServerSpawnConfig('win32')).toEqual({
      command: 'npm.cmd',
      shell: true,
    });
    expect(getDevServerSpawnConfig('darwin')).toEqual({
      command: 'npm',
      shell: false,
    });
    expect(getDevServerSpawnConfig('linux')).toEqual({
      command: 'npm',
      shell: false,
    });
  });
});

describe('eai dev port validation', () => {
  test('normalizes valid numeric ports', () => {
    expect(normalizeDevPort('3000')).toBe('3000');
    expect(normalizeDevPort('03000')).toBe('3000');
    expect(normalizeDevPort(65_535)).toBe('65535');
  });

  test('rejects invalid or shell-sensitive port values', () => {
    expect(normalizeDevPort('0')).toBeNull();
    expect(normalizeDevPort('65536')).toBeNull();
    expect(normalizeDevPort('3000 && echo unsafe')).toBeNull();
    expect(normalizeDevPort('abc')).toBeNull();
  });
});
