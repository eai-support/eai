import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

describe('installed unsupported capability contracts', () => {
  test.each([
    { args: ['types', 'define'], code: 'TYPES_DEFINE_UNSUPPORTED', channel: 'stdout' as const },
    { args: ['resources', 'indexes-apply'], code: 'RESOURCE_INDEX_APPLY_UNSUPPORTED', channel: 'stderr' as const },
  ])('$code precedes missing-profile authentication and project context', ({ args, code, channel }) => {
    const home = mkdtempSync(join(tmpdir(), 'eai-unsupported-'));
    try {
      const result = spawnSync(process.execPath, [resolve('dist/index.js'), ...args, '--format', 'json'], {
        cwd: home, encoding: 'utf8', timeout: 10_000,
        env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, NO_COLOR: '1',
          EAI_PROFILE: 'missing-audit-profile', BASE_URL_PUBLIC_API: 'http://127.0.0.1:9' },
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(JSON.parse(result[channel]).error.code).toBe(code);
      if (channel === 'stdout') {
        expect(result.stderr).toMatch(/^(?:Run eai support to prepare a report for your approval\.\n)?$/);
      } else expect(result.stdout).toBe('');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
