import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  findRetiredSupportPhrases,
  RETIRED_SUPPORT_PHRASES,
}: {
  readonly findRetiredSupportPhrases: (root: string, files?: readonly string[]) => string[];
  readonly RETIRED_SUPPORT_PHRASES: readonly string[];
} = require('../../scripts/verify-error-guidance.cjs');

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('retired support wording check', () => {
  it('names the six phrases the help-on-request rewrite retired', () => {
    expect(RETIRED_SUPPORT_PHRASES).toEqual([
      ['Support after', 'an unresolved EAI error'].join(' '),
      ['If the command still fails,', 'prepare a report with'].join(' '),
      ['If anything fails,', 'say'].join(' '),
      ['For unresolved', 'EAI errors'].join(' '),
      ['If the failure remains', 'unresolved'].join(' '),
      ['offer the', 'support preview'].join(' '),
    ]);
  });

  it('reports the file and phrase for each retired sentence and passes clean files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eai-retired-phrases-'));
    roots.push(root);
    await writeFile(join(root, 'stale.md'), `# Notes\n\n${['Support after', 'an unresolved EAI error'].join(' ')}\n${['offer the', 'support preview'].join(' ')}\n`);
    await writeFile(join(root, 'current.md'), 'Start a support report only when the person explicitly asks for help or support.\n');
    await writeFile(join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const findings = findRetiredSupportPhrases(root, ['stale.md', 'current.md', 'image.png', 'missing.md']);
    expect(findings).toEqual([
      `stale.md: "${['Support after', 'an unresolved EAI error'].join(' ')}"`,
      `stale.md: "${['offer the', 'support preview'].join(' ')}"`,
    ]);
    expect(findRetiredSupportPhrases(root, ['current.md'])).toEqual([]);
  });
});
