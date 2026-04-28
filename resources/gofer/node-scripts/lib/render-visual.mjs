/**
 * render-visual.mjs
 *
 * Simple template renderer for visual templates under
 * `.specify/templates/visuals/`.
 *
 * - Reads a template file from disk.
 * - Replaces every `{{KEY}}` token with `data[KEY]` when present.
 * - Leaves unmatched `{{KEY}}` placeholders in place untouched.
 * - Returns the rendered markdown as a string.
 *
 * Used by the two-pass canvas pipeline (visual-pass-pipeline.mjs) and
 * directly by stage commands that need to produce visual artefacts.
 */

import { readFile } from 'node:fs/promises';

const PLACEHOLDER_RE = /\{\{([A-Z0-9_]+)\}\}/g;

/**
 * Render a template by substituting `{{KEY}}` placeholders with values from
 * `data`. Unmatched placeholders are preserved verbatim.
 *
 * @param {string} templatePath Absolute path to the template file.
 * @param {Record<string, string|number>} data Substitution map keyed by
 *   placeholder name (without braces).
 * @returns {Promise<string>} Rendered markdown content.
 */
export async function renderVisual(templatePath, data = {}) {
  const raw = await readFile(templatePath, 'utf8');
  return renderString(raw, data);
}

/**
 * Render an in-memory string with the same substitution rules. Exposed for
 * tests and for callers that have already loaded the template (e.g. pass-2
 * canvas refresh re-uses the existing on-disk artefact rather than the
 * pristine template).
 *
 * @param {string} input Raw template content.
 * @param {Record<string, string|number>} data Substitution map.
 * @returns {string} Rendered string.
 */
export function renderString(input, data = {}) {
  return input.replace(PLACEHOLDER_RE, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const value = data[key];
      return value === undefined || value === null ? match : String(value);
    }
    return match;
  });
}

export default renderVisual;
