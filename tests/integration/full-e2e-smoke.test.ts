import { mkdtempSync, readFileSync } from 'node:fs';
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

  test('resource update smoke uses full replacement payloads for required fields', () => {
    const source = readFileSync(scriptPath, 'utf8');

    expect(source).toContain("title: 'postgres smoke updated'");
    expect(source).toContain("title: 'documentdb smoke updated'");
    expect(source).toContain('`batch smoke ${index + 1} updated`');
    expect(source).toContain("function: 'count'");
    expect(source).toContain('batchCreate.results');
  });

  test('live smoke executes opt-in invite, negative, and child cleanup paths', () => {
    const source = readFileSync(scriptPath, 'utf8');

    expect(source).toContain('EAI_E2E_INVITE_TEST_USER');
    expect(source).toContain("'user',");
    expect(source).toContain("'invite',");
    expect(source).toContain("'--role',");
    expect(source).toContain('EAI_E2E_NEGATIVE_TESTS');
    expect(source).toContain('expectEaiFailure');
    expect(source).toContain('tenant');
    expect(source).toContain('bootstrap-admin');
    expect(source).toContain('tenant');
    expect(source).toContain('delete');
  });
});
