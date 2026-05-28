#!/usr/bin/env node
/**
 * marp-deck.mjs
 *
 * Optional Marp deck generator (FR-030). Reads `<featureDir>/visuals/*.md`
 * in deterministic alphabetical order and emits a single Marp slide deck:
 * Marp frontmatter, then each visual as its own slide, separated by `---`.
 *
 * Public API:
 *   generateMarpDeck(featureDir, outputPath)
 *     -> Promise<{ ok: true, slides: number, written: string } |
 *                { ok: false, reason: string }>
 *
 * CLI usage:
 *   node marp-deck.mjs <featureDir> <outputPath>
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MARP_FRONTMATTER = `---
marp: true
theme: default
paginate: true
---
`;

/**
 * @param {string} featureDir   Absolute path to the feature directory
 * @param {string} outputPath   Absolute path for the .marp.md output
 */
export async function generateMarpDeck(featureDir, outputPath) {
  const visualsDir = path.join(featureDir, 'visuals');

  let entries;
  try {
    entries = await readdir(visualsDir, { withFileTypes: true });
  } catch (err) {
    if (err && /** @type {any} */ (err).code === 'ENOENT') {
      return { ok: false, reason: 'visuals-dir-missing' };
    }
    return { ok: false, reason: `readdir-error: ${err.message}` };
  }

  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort(); // deterministic alphabetical order

  if (mdFiles.length === 0) {
    return { ok: false, reason: 'no-visuals' };
  }

  const slideContents = [];
  for (const name of mdFiles) {
    const raw = await readFile(path.join(visualsDir, name), 'utf8');
    slideContents.push(raw.trimEnd());
  }

  const body = [MARP_FRONTMATTER, ...slideContents].join('\n\n---\n\n') + '\n';

  await writeFile(outputPath, body, 'utf8');

  return { ok: true, slides: slideContents.length, written: outputPath };
}

// CLI entrypoint
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('marp-deck.mjs') ||
    process.argv[1] === new URL(import.meta.url).pathname);

if (isMain) {
  const [, , featureDir, outputPath] = process.argv;
  if (!featureDir || !outputPath) {
    console.error('Usage: marp-deck.mjs <featureDir> <outputPath>');
    process.exit(1);
  }
  const result = await generateMarpDeck(path.resolve(featureDir), path.resolve(outputPath));
  if (result.ok) {
    console.log(`marp-deck: wrote ${result.written} (${result.slides} slides)`);
    process.exit(0);
  } else {
    console.error(`marp-deck failed: ${result.reason}`);
    process.exit(1);
  }
}
