import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const scriptPath = join(root, 'scripts', 'eai-full-e2e-smoke.cjs');
const cliPath = join(root, 'dist', 'index.js');

describe('full e2e smoke traceability', () => {
  test('covers every public CLI leaf command from --describe', () => {
    const output = execFileSync(process.execPath, [
      scriptPath,
      '--check',
      '--cli',
      cliPath,
    ], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(output).toContain('Full e2e traceability covers');
    expect(output).toContain('CLI leaf commands');
  });

  test('generated plan documents option-level and alias coverage', () => {
    const output = execFileSync(process.execPath, [
      scriptPath,
      '--plan',
      '--cli',
      cliPath,
    ], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(output).toContain('Smoke calls / options');
    expect(output).toContain('Deferred options');
    expect(output).toContain('`eai vertical list`');
  });

  test('redacts password-like values when live auth preflight fails', () => {
    const isolatedHome = mkdtempSync(join(tmpdir(), 'eai-smoke-home-'));
    const secret = 'super-secret-e2e-password';
    const result = spawnSync(process.execPath, [
      scriptPath,
      '--live',
      '--cli',
      cliPath,
    ], {
      cwd: root,
      env: {
        ...process.env,
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        EAI_E2E_TEST_PROFILE: 'test-redaction',
        EAI_E2E_TEST_USERNAME: 'redaction@example.invalid',
        EAI_E2E_TEST_PASSWORD: secret,
      },
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('test profile is not authenticated');
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(secret);
  });
});
