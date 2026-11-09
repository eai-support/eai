import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const olderPublicApiRoute = /\/v(?:1|2|3)\//;
const externalTypeSafeEndpoint = 'https://api.typesafe.ai/v1/systemone';
const maintainedSurface = /(?:^|\/)(?:src|tests|scripts|resources\/gofer|\.agents|\.specify|\.tech-docs|docs-site\/static)\//;
const textSurface = /\.(?:md|mdx|txt|ts|tsx|js|cjs|mjs|json|ya?ml|sh)$/;

function hasOlderPublicApiRoute(content: string): boolean {
  return olderPublicApiRoute.test(content.replaceAll(externalTypeSafeEndpoint, ''));
}

describe('PublicAPI V4 contract guard', () => {
  test('retains old PublicAPI route rejection while excluding the exact external TypeSafe endpoint', () => {
    expect(hasOlderPublicApiRoute('https://api.typesafe.ai/v1/systemone')).toBe(false);
    expect(hasOlderPublicApiRoute(`const route = "/v${3}/platform/tenants";`)).toBe(true);
  });

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
      if (hasOlderPublicApiRoute(content)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
