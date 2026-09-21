#!/usr/bin/env node
/**
 * assemble-stakeholder-pack.mjs
 *
 * Composes a stakeholder pack from a feature directory's `visuals/`. The
 * artifact ordering is fixed and deterministic so two consecutive runs with
 * the same inputs produce byte-identical output (FR-028, NFR-011).
 *
 * Order (locked by spec, do not reorder):
 *   1. impact-canvas.md
 *   2. c4-context.md
 *   3. c4-container.md
 *   4. value-stream-asis.md
 *   5. value-stream-tobe.md
 *   6. capability-heatmap.md
 *   7. bounded-context.md
 *   8. data-model-erd.md
 *   9. risk-heatmap.md
 *  10. roi-projection.md
 *
 * Missing files are skipped with a stderr warning; ordering of present files
 * is unaffected. Output is written to `<featureDir>/stakeholder-pack.md`.
 *
 * Public API:
 *   assembleStakeholderPack(featureDir)
 *     -> Promise<{ written: string, included: string[], missing: string[] }>
 *
 * CLI usage:
 *   node assemble-stakeholder-pack.mjs <featureDir>
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Locked artifact order. Do not change without updating the spec + tests.
 */
export const STAKEHOLDER_PACK_ORDER = Object.freeze([
  'impact-canvas.md',
  'c4-context.md',
  'c4-container.md',
  'value-stream-asis.md',
  'value-stream-tobe.md',
  'capability-heatmap.md',
  'bounded-context.md',
  'data-model-erd.md',
  'risk-heatmap.md',
  'roi-projection.md',
]);

const SEPARATOR = '\n\n---\n\n';

/**
 * @param {string} featureDir Absolute path to the feature directory.
 * @returns {Promise<{ written: string, included: string[], missing: string[] }>}
 */
export async function assembleStakeholderPack(featureDir) {
  const visualsDir = path.join(featureDir, 'visuals');
  const included = [];
  const missing = [];
  const sections = [];

  for (const name of STAKEHOLDER_PACK_ORDER) {
    const filePath = path.join(visualsDir, name);
    try {
      const content = await readFile(filePath, 'utf8');
      sections.push(content.trimEnd());
      included.push(name);
    } catch (err) {
      if (err && /** @type {any} */ (err).code === 'ENOENT') {
        process.stderr.write(
          `[assemble-stakeholder-pack] skipping missing artifact: ${name}\n`,
        );
        missing.push(name);
        continue;
      }
      throw err;
    }
  }

  // Compose: each section separated by `---`. Leading separator omitted so
  // the first section's H1 is not preceded by a horizontal rule.
  const body = sections.length === 0 ? '' : sections.join(SEPARATOR) + '\n';

  const outputPath = path.join(featureDir, 'stakeholder-pack.md');
  await writeFile(outputPath, body, 'utf8');

  return { written: outputPath, included, missing };
}

// CLI entrypoint
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('assemble-stakeholder-pack.mjs') ||
    process.argv[1] === new URL(import.meta.url).pathname);

if (isMain) {
  const featureDir = process.argv[2];
  if (!featureDir) {
    console.error('Usage: assemble-stakeholder-pack.mjs <featureDir>');
    process.exit(1);
  }
  try {
    const result = await assembleStakeholderPack(path.resolve(featureDir));
    console.log(`assembled: ${result.written}`);
    console.log(`included (${result.included.length}): ${result.included.join(', ')}`);
    if (result.missing.length > 0) {
      console.log(`missing (${result.missing.length}): ${result.missing.join(', ')}`);
    }
  } catch (err) {
    console.error(`assemble failed: ${err && err.message ? err.message : err}`);
    process.exit(1);
  }
}
