import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(path);
    }
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  }));
  return files.flat();
}

describe('PublicAPI v4 migration guard', () => {
  test('CLI runtime source does not call public v3 routes', async () => {
    const files = await collectSourceFiles(join(process.cwd(), 'src'));
    const offenders: string[] = [];

    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      if (content.includes('/v3/')) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
