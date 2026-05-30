/**
 * canonical-descriptions.mjs
 * Canonical descriptions for all Gofer pipeline, utility, and helper commands
 * that participate in the Codex skill-budget inventory.
 * Each description must be ≤140 chars and the cumulative UTF-8 byte total
 * must not exceed 2048 bytes (Codex skill-budget constraint).
 */

export const CANONICAL_DESCRIPTIONS = {
  '0_business_scenario':
    'Define the business problem Gofer should solve.',
  '0a_problem_validation':
    'Validate the problem with 5 Whys and stakeholder mapping.',
  '1_gofer_research':
    'Research the codebase, integrations, and technology landscape.',
  '2_gofer_specify':
    'Generate a feature spec from research and approved review.',
  '3_gofer_plan':
    'Create the technical plan, architecture, data model, and contracts.',
  '4_gofer_tasks':
    'Break the plan into dependency-ordered, parallel tasks.',
  '5_gofer_implement':
    'Execute tasks phase by phase with feedback and review.',
  '6_gofer_validate':
    'Validate the work with scoring, blast-radius analysis, and review.',
  '7_gofer_save':
    'Save session state for later resumption.',
  '7a_stakeholder_comms':
    'Generate release notes, demos, and change briefs for stakeholders.',
  '8_gofer_resume':
    'Resume a previous Gofer session from a saved checkpoint file.',
  '9_gofer_tests':
    'Generate tests from four perspectives for a target component.',
  '10_gofer_cloud':
    'Deploy and configure Gofer cloud integration.',
  gofer_constitution:
    'Create or update the project constitution.',
  gofer_hydrate:
    'Reverse-engineer a specification from existing code.',
  'gofer:check-workspace':
    'Check whether the repo scaffold is missing or stale.',
  'gofer:bootstrap-workspace':
    'Create or update the repo-owned Gofer scaffold.',
  'gofer:vocabulary':
    'Extract domain terms into a canonical glossary.',
  'gofer:diagnose':
    'Run a structured reproduce-minimize-instrument-fix loop.',
  'gofer:tdd':
    'Guide a red-green-refactor loop tied to acceptance criteria.',
  'gofer:spec-summary':
    'Generate a business summary of feature value and scope.',
  'gofer:zoom-out':
    'Show how the current feature fits broader system boundaries.',
};

/**
 * Validates that all descriptions satisfy the Codex budget constraints:
 * - Each description is ≤140 chars
 * - Cumulative UTF-8 byte total ≤2048 bytes
 *
 * @throws {Error} if any constraint is violated
 */
export function validateDescriptions() {
  const entries = Object.entries(CANONICAL_DESCRIPTIONS);
  let totalBytes = 0;

  for (const [name, description] of entries) {
    if (description.length > 140) {
      throw new Error(
        `Description for '${name}' exceeds 140 chars: ${description.length} chars`
      );
    }
    const bytes = Buffer.byteLength(description, 'utf8');
    totalBytes += bytes;
  }

  if (totalBytes > 2048) {
    throw new Error(
      `Cumulative UTF-8 byte total exceeds 2048 bytes: ${totalBytes} bytes`
    );
  }

  return { count: entries.length, totalBytes };
}
