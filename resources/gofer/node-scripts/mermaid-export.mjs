#!/usr/bin/env node
/**
 * mermaid-export.mjs
 *
 * Thin wrapper around `mmdc` (the @mermaid-js/mermaid-cli binary). Renders a
 * Mermaid diagram from a markdown / .mmd input file to PNG/SVG/PDF.
 *
 * **CRITICAL — NFR-006 INVARIANT**:
 *   This script MUST NOT disable the Chrome sandbox when invoking mmdc.
 *   The default Chrome sandbox is required when rendering Mermaid in CI /
 *   shared environments.
 *   Verified by `tests/unit/visuals/mmdc-sandbox.test.ts`.
 *
 * Behaviour:
 *   - If `mmdc` is on PATH, spawn it with `-i <input> -o <output>` and inherit
 *     stdio so callers see real progress output.
 *   - If `mmdc` is missing (ENOENT), print a single visible warning to stderr
 *     and return `{ ok: false, reason: 'mmdc-not-installed' }`. Callers can
 *     then fall back to inline Mermaid blocks.
 *   - Any non-zero exit status from mmdc surfaces as `{ ok: false, reason }`.
 */

import { spawnSync } from 'node:child_process';

/**
 * Export a Mermaid diagram via mmdc.
 *
 * @param {string} inputPath  Path to a .md or .mmd file
 * @param {string} outputPath Path to the output (extension drives format: .png/.svg/.pdf)
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
export async function exportMermaid(inputPath, outputPath) {
  // INVARIANT (NFR-006): default Chrome sandbox required. No flags that
  // disable the sandbox may ever be added here.
  const args = ['-i', inputPath, '-o', outputPath];

  const result = spawnSync('mmdc', args, { stdio: 'inherit' });

  if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === 'ENOENT') {
    process.stderr.write(
      'Warning: mmdc not found. Install @mermaid-js/mermaid-cli to enable visual exports.\n',
    );
    return { ok: false, reason: 'mmdc-not-installed' };
  }

  if (result.error) {
    process.stderr.write(`mermaid-export: spawn failed: ${result.error.message}\n`);
    return { ok: false, reason: 'spawn-error' };
  }

  if (result.status === 0) {
    return { ok: true, reason: 'ok' };
  }

  return { ok: false, reason: `exit-${result.status}` };
}

// CLI entrypoint
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('mermaid-export.mjs') ||
    process.argv[1] === new URL(import.meta.url).pathname);

if (isMain) {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error('Usage: mermaid-export.mjs <input.md> <output.png>');
    process.exit(1);
  }
  const result = await exportMermaid(inputPath, outputPath);
  process.exit(result.ok ? 0 : 1);
}
