import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const olderPublicApiRoute = /\/v(?:1|2|3)\//;
const maintainedSurface = /(?:^|\/)(?:src|tests|scripts|resources\/gofer|\.agents|\.specify|\.tech-docs|docs-site\/static)\//;
const textSurface = /\.(?:md|mdx|txt|ts|tsx|js|cjs|mjs|json|ya?ml|sh)$/;

describe('PublicAPI V4 contract guard', () => {
  test('maintained runtime, tests, skills, Specify assets, and docs contain no older PublicAPI routes', async () => {
    const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const files = stdout.split('\0').filter((file) => maintainedSurface.test(file) && textSurface.test(file));
    const offenders: string[] = [];

    for (const file of files) {
      if (!(await stat(file).catch(() => null))) {
        continue;
      }
      const content = await readFile(file, 'utf8');
      if (olderPublicApiRoute.test(content)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
