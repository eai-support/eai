/**
 * canonical-descriptions.mjs
 * Canonical stage descriptions for all 16 Gofer pipeline stages.
 * Each description must be ≤140 chars and the cumulative UTF-8 byte total
 * must not exceed 2048 bytes (Codex skill-budget constraint).
 */

export const CANONICAL_DESCRIPTIONS = {
  '0_business_scenario':
    'Define the business problem and scenario for Gofer to analyse and solve.',
  '0a_problem_validation':
    'Validate the business problem using 5 Whys root-cause analysis and stakeholder mapping.',
  '1_gofer_research':
    'Research codebase, CLI integrations, and technology landscape for the target feature.',
  '2_gofer_specify':
    'Generate a feature specification from research findings and approved proposal review.',
  '3_gofer_plan':
    'Create a detailed technical implementation plan with architecture, data model, and contracts.',
  '4_gofer_tasks':
    'Break down the implementation plan into dependency-ordered, parallelisable tasks.',
  '5_gofer_implement':
    'Execute all tasks from tasks.md phase by phase with feedback loops and engineering review.',
  '6_gofer_validate':
    'Validate the implementation against spec acceptance criteria across six quality dimensions.',
  '6a_gofer_engineering_review':
    'Run a targeted engineering review on a specific component or concern.',
  '7_gofer_save':
    'Save session state and create a handoff checkpoint for resumption in a new context.',
  '7a_stakeholder_comms':
    'Generate stakeholder-facing communications: release notes, demo scripts, and change briefs.',
  '8_gofer_resume':
    'Resume a previous Gofer session from a saved checkpoint file.',
  '9_gofer_tests':
    'Generate comprehensive test suites from four testing perspectives for a target component.',
  '10_gofer_cloud':
    'Deploy and configure the Gofer cloud integration for remote pipeline execution.',
  gofer_constitution:
    'Display the Gofer working constitution and core principles for this project.',
  gofer_hydrate:
    'Hydrate the Gofer context with project memory, constitution, and prior pipeline state.',
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
