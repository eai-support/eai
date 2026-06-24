import { describe, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

describe('agent discovery eval harness', () => {
  test('regex-small agent discovers guidance and handles known failures safely', async () => {
    const script = fileURLToPath(new URL('../../scripts/eval-agent-discovery.cjs', import.meta.url));
    const cli = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [script, '--cli', cli, '--json'], {
      env: {
        ...process.env,
        NO_COLOR: '1',
      },
      maxBuffer: 1024 * 1024 * 4,
    });

    const payload = JSON.parse(stdout) as {
      summary: {
        pass: boolean;
        scenarioCount: number;
      };
      results: Array<{
        name: string;
        pass: boolean;
        checks: Array<{ name: string; pass: boolean }>;
      }>;
    };

    expect(payload.summary.pass).toBe(true);
    expect(payload.summary.scenarioCount).toBeGreaterThanOrEqual(3);
    expect(payload.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'fresh-discovery',
          pass: true,
          checks: expect.arrayContaining([
            expect.objectContaining({ name: 'read-agent-guide', pass: true }),
          ]),
        }),
        expect.objectContaining({
          name: 'not-logged-in-recovery',
          pass: true,
          checks: expect.arrayContaining([
            expect.objectContaining({ name: 'explained-known-error', pass: true }),
            expect.objectContaining({ name: 'avoided-mutation-without-approval', pass: true }),
          ]),
        }),
      ]),
    );
  });
});
