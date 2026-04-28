/**
 * visual-pass-pipeline.mjs
 *
 * Two-pass canvas pipeline for the Impact Canvas visual.
 *
 * Pass 1 runs inside `/2_gofer_specify`: a fresh `impact-canvas.md` is
 * rendered from the template using heuristic risks pulled from the spec's
 * NFR + Out-of-Scope sections.
 *
 * Pass 2 runs inside `/6_gofer_validate`: the existing `impact-canvas.md` is
 * read back, and ONLY the "Top Three Risks" block is rewritten with the
 * validation council's output. Every other byte (header, problem statement,
 * personas, AI-leverage pie, outcomes) is preserved.  The frontmatter
 * `pass:` marker is bumped from 1 to 2 so consumers can tell which pass
 * produced the artefact.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderVisual } from './render-visual.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(
  __dirname,
  '../../../templates/visuals/impact-canvas.md'
);

// Match the full "## Top Three Risks" section greedily, stopping at the next
// `## ` heading or end-of-file. Using a greedy `[\s\S]*` plus a positive
// lookahead avoids the degenerate non-greedy zero-width match that would
// only consume the heading itself.
const RISKS_BLOCK_RE = /## Top Three Risks[\s\S]*?(?=\n## |$)/;

/**
 * Build the canonical "Top Three Risks" markdown block from a list of risks.
 *
 * @param {string[]} risks Array of three risk descriptions.
 * @param {'pass-1'|'pass-2'} source Which pass produced the risks.
 * @returns {string} Markdown block ending without a trailing blank line.
 */
function buildRisksBlock(risks, source) {
  const safeRisks = [risks[0] ?? '', risks[1] ?? '', risks[2] ?? ''];
  const passComment =
    source === 'pass-2'
      ? '<!-- pass-2: validation council output -->'
      : '<!-- pass-1: heuristic from spec NFRs and Out-of-Scope -->';
  return [
    '## Top Three Risks',
    passComment,
    `1. ${safeRisks[0]}`,
    `2. ${safeRisks[1]}`,
    `3. ${safeRisks[2]}`,
    '',
  ].join('\n');
}

/**
 * Pass 1 — render a complete Impact Canvas with heuristic risks.
 *
 * @param {string} featureDir Absolute path to `.specify/specs/<feature>/`.
 * @param {object} specData Substitution payload.
 * @param {string} specData.FEATURE_NAME
 * @param {string} specData.DATE  ISO date string.
 * @param {string} specData.PROBLEM_STATEMENT
 * @param {string} specData.PERSONA_LIST
 * @param {number} specData.REPLACE_COUNT
 * @param {number} specData.AUGMENT_COUNT
 * @param {number} specData.AUTOMATE_COUNT
 * @param {number} specData.OBSERVE_COUNT
 * @param {string[]} specData.HEURISTIC_RISKS  Length-3 array.
 * @param {string} specData.OUTCOMES
 * @returns {Promise<string>} Absolute path of the written canvas.
 */
export async function runPass1(featureDir, specData) {
  const visualsDir = path.join(featureDir, 'visuals');
  await mkdir(visualsDir, { recursive: true });

  const data = {
    PASS: 1,
    FEATURE_NAME: specData.FEATURE_NAME ?? '',
    DATE: specData.DATE ?? new Date().toISOString().slice(0, 10),
    PROBLEM_STATEMENT: specData.PROBLEM_STATEMENT ?? '',
    PERSONA_LIST: specData.PERSONA_LIST ?? '',
    REPLACE_COUNT: specData.REPLACE_COUNT ?? 0,
    AUGMENT_COUNT: specData.AUGMENT_COUNT ?? 0,
    AUTOMATE_COUNT: specData.AUTOMATE_COUNT ?? 0,
    OBSERVE_COUNT: specData.OBSERVE_COUNT ?? 0,
    RISK_1: (specData.HEURISTIC_RISKS ?? [])[0] ?? '',
    RISK_2: (specData.HEURISTIC_RISKS ?? [])[1] ?? '',
    RISK_3: (specData.HEURISTIC_RISKS ?? [])[2] ?? '',
    OUTCOMES: specData.OUTCOMES ?? '',
  };

  const rendered = await renderVisual(TEMPLATE_PATH, data);
  const outPath = path.join(visualsDir, 'impact-canvas.md');
  await writeFile(outPath, rendered, 'utf8');
  return outPath;
}

/**
 * Pass 2 — re-read the existing canvas, swap ONLY the Top Three Risks block,
 * and bump the `pass:` field. Throws if `impact-canvas.md` does not exist.
 *
 * @param {string} featureDir Absolute path to `.specify/specs/<feature>/`.
 * @param {object} validationData
 * @param {string[]} validationData.VALIDATED_RISKS Length-3 array from the
 *   validation council.
 * @returns {Promise<string>} Absolute path of the rewritten canvas.
 */
export async function runPass2(featureDir, validationData) {
  const canvasPath = path.join(featureDir, 'visuals', 'impact-canvas.md');
  const original = await readFile(canvasPath, 'utf8');

  const risks = validationData?.VALIDATED_RISKS ?? [];
  const newBlock = buildRisksBlock(risks, 'pass-2');

  if (!RISKS_BLOCK_RE.test(original)) {
    throw new Error(
      `runPass2: impact-canvas.md at ${canvasPath} is missing the "## Top Three Risks" section`
    );
  }

  let updated = original.replace(RISKS_BLOCK_RE, `${newBlock}\n`);

  // Bump `pass:` field in frontmatter from 1 to 2 (or any other digit -> 2).
  updated = updated.replace(/^(pass:\s*).*$/m, `$12`);

  await writeFile(canvasPath, updated, 'utf8');
  return canvasPath;
}

export default { runPass1, runPass2 };
