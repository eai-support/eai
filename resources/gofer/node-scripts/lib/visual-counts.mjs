/**
 * visual-counts.mjs
 *
 * Walks a TO-BE value-stream markdown document and counts how many steps
 * carry each AI-leverage verb tag (Replace / Augment / Automate / Observe).
 *
 * The convention enforced by `visual-value-stream-writer` and the persona-pack
 * gate is that every TO-BE step renders the verb inline as `AI: <Verb>` —
 * either inside a Mermaid node (`S1[Step text<br/>AI: Augment]`) or in the
 * surrounding markdown. This function detects the inline tag with a
 * case-insensitive regex and returns a totals object suitable for feeding
 * directly into the Impact Canvas pie chart.
 */

import { VERBS, validateVerb } from './ai-leverage-tagger.mjs';

const TAG_RE = /AI:\s*(Replace|Augment|Automate|Observe)\b/gi;

/**
 * Count AI-leverage verbs in a TO-BE value-stream markdown string.
 *
 * @param {string} valueStreamMarkdown Raw markdown content of `value-stream-tobe.md`.
 * @returns {{ replace: number, augment: number, automate: number, observe: number }}
 *   Totals keyed by lowercased verb name. Missing verbs are reported as 0.
 */
export function countVerbs(valueStreamMarkdown) {
  const totals = { replace: 0, augment: 0, automate: 0, observe: 0 };
  if (typeof valueStreamMarkdown !== 'string' || valueStreamMarkdown.length === 0) {
    return totals;
  }

  for (const match of valueStreamMarkdown.matchAll(TAG_RE)) {
    const raw = match[1];
    const canonical = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    validateVerb(canonical); // Defensive: never count a non-canonical verb.
    const key = canonical.toLowerCase();
    totals[key] += 1;
  }

  return totals;
}

export { VERBS };
export default countVerbs;
