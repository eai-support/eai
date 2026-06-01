#!/usr/bin/env node

/**
 * Generate issues.md from tasks.md
 *
 * This script parses tasks.md and generates a GitHub-ready issues.md file
 * where each task becomes a GitHub issue following the Requirements Ticket template.
 *
 * Usage:
 *   node generate-issues.js <feature-dir>
 *   node generate-issues.js /path/to/.specify/specs/001-feature-name
 *
 * Input: tasks.md in the feature directory
 * Output: issues.md in the same feature directory
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Error: Feature directory path required');
  console.error('Usage: node generate-issues.js <feature-dir>');
  process.exit(1);
}

const featureDir = args[0];
const tasksPath = path.join(featureDir, 'tasks.md');
const specPath = path.join(featureDir, 'spec.md');
const planPath = path.join(featureDir, 'plan.md');
const issuesPath = path.join(featureDir, 'issues.md');

// Validate inputs
if (!fs.existsSync(tasksPath)) {
  console.error(`Error: tasks.md not found at ${tasksPath}`);
  process.exit(1);
}

const tasksContent = fs.readFileSync(tasksPath, 'utf-8');

// Parse feature metadata from tasks.md header
const featureNameMatch = tasksContent.match(/^# Task Breakdown: (.+)$/m);
const featureIdMatch = tasksContent.match(/\*\*Feature ID\*\*: (.+)$/m);
const featureName = featureNameMatch ? featureNameMatch[1] : 'Unknown Feature';
const featureId = featureIdMatch ? featureIdMatch[1].trim() : 'unknown';

// Load spec.md and plan.md if available for context
let specContent = '';
let planContent = '';
if (fs.existsSync(specPath)) {
  specContent = fs.readFileSync(specPath, 'utf-8');
}
if (fs.existsSync(planPath)) {
  planContent = fs.readFileSync(planPath, 'utf-8');
}

// Parse tasks from tasks.md
// Format: - [ ] T001 [P?] [US?] Description with file path
const taskRegex = /^- \[ \] (T\d+) (\[P\] )?(\[US\d+\] )?(.+)$/gm;
const tasks = [];
let match;

while ((match = taskRegex.exec(tasksContent)) !== null) {
  const taskId = match[1];
  const isParallel = !!match[2];
  const storyLabel = match[3] ? match[3].trim() : '';
  const description = match[4].trim();

  // Extract file path from description (usually at the end after "in")
  const filePathMatch = description.match(/\s+in\s+(.+\.(ts|js|py|java|go|rs|rb|php|md|json|yaml|yml|tsx|jsx|vue|swift|kt|cs|cpp|c|h))$/i);
  const filePath = filePathMatch ? filePathMatch[1].trim() : '';
  const cleanDescription = filePathMatch ? description.replace(filePathMatch[0], '').trim() : description;

  // Determine phase from the section it's in
  const taskIndex = match.index;
  const contentBeforeTask = tasksContent.substring(0, taskIndex);
  const phaseMatch = contentBeforeTask.match(/## (Phase \d+: .+?)(?=\n|$)/g);
  const phase = phaseMatch ? phaseMatch[phaseMatch.length - 1].replace('## ', '').trim() : 'Unknown Phase';

  tasks.push({
    taskId,
    isParallel,
    storyLabel,
    description: cleanDescription,
    filePath,
    phase,
    fullDescription: description
  });
}


// Generate issues.md content
const issues = [];
let issueNumber = 1;

for (const task of tasks) {
  const issue = generateIssue(issueNumber, task, featureName, featureId);
  issues.push(issue);
  issueNumber++;
}

// Build the full issues.md content
const issuesContent = buildIssuesDocument(featureName, featureId, issues, tasks);

// Write issues.md
fs.writeFileSync(issuesPath, issuesContent, 'utf-8');

// Generate summary
const phaseSummary = {};
for (const task of tasks) {
  if (!phaseSummary[task.phase]) {
    phaseSummary[task.phase] = 0;
  }
  phaseSummary[task.phase]++;
}

for (const [phase, count] of Object.entries(phaseSummary)) {
}

/**
 * Generate a single GitHub issue from a task
 */
function generateIssue(issueNumber, task, featureName, featureId) {
  const { taskId, isParallel, storyLabel, description, filePath, phase, fullDescription } = task;

  // Determine labels based on phase and story
  const labels = ['enhancement'];
  const phaseSlug = phase.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  labels.push(phaseSlug);
  if (storyLabel) {
    labels.push(storyLabel.toLowerCase().replace(/[\[\]]/g, ''));
  }
  if (isParallel) {
    labels.push('parallel');
  }

  // Extract effort estimation (S/M/L or hours)
  const effort = estimateEffort(description, filePath);

  // Generate acceptance criteria from the description
  const acceptanceCriteria = generateAcceptanceCriteria(description, filePath);

  return `## Issue #${issueNumber}: ${taskId} - ${description}

**Labels**: \`${labels.join('`, `')}\`
**Assignees**: @MikeNowosadko
**Title**: [Feature]: ${taskId} - ${description}

### Screen described (Mike)

${generateScreenDescription(description, filePath)}

### Business Rationale

**Problem**: This task is part of implementing the "${featureName}" feature.

**Value**: Completing this task contributes to the overall feature goal by ${generateValueStatement(description)}.

**Impact**: This is a ${phase.toLowerCase()} task that ${storyLabel ? `supports ${storyLabel}` : 'provides foundational infrastructure'}.

**Priority**: ${determinePriority(phase, storyLabel)} - Part of ${phase}

### Fields required (Mike)

${generateFieldsTable(description, filePath)}

### Acceptance Criteria

${acceptanceCriteria}

### Data needed (Mike)

${generateDataNeeded(description, filePath)}

### Integrations Needed (Team)

${generateIntegrations(description, filePath)}

### Navigation (Mike)

${generateNavigation(description, filePath)}

### Blocks needed (Team)

${generateBlocksNeeded(description, filePath)}

### Definition of Ready

- [ ] Mock up screen signed off (Mike) ${filePath && !isUIFile(filePath) ? '[N/A - Backend/Infrastructure]' : ''}
- [ ] Business Content (Mike)
- [ ] Screen Understood by Dev team (Mike, Gareth & Team)
- [ ] Requirements Documented: Data (Mike & Team)
- [ ] Requirements Documented: Integrations (Mike & Team)
- [ ] Requirements Documented: Navigation (Mike & Team)
- [ ] Requirements Documented: Fields (Mike & Team)
- [ ] Requirements Documented: Blocks (Mike & Team)
- [ ] Dependencies Identified
- [ ] AC Agreed
- [ ] Identify if we can re-use components, if not identify design and tech approach and validate (Doug)
- [ ] Effort is sized and prioritised

### Definition of Done

- [ ] Functional: Works as described in acceptance criteria
- [ ] Documented: Architecture changes and implementation documented
- [ ] Demonstrated: Can show it working
- [ ] Stable: No critical bugs
- [ ] Reviewed: PO confirmed (for sub-issues)
- [ ] Tests pass: All related tests execute successfully
- [ ] Code reviewed: Peer review completed

**Related Tasks**: ${findRelatedTasks(taskId, tasks)}
**File Path**: \`${filePath || 'Multiple files or TBD'}\`
**Estimated Effort**: ${effort}
**Phase**: ${phase}
${storyLabel ? `**User Story**: ${storyLabel}` : ''}

---
`;
}

/**
 * Build the complete issues.md document
 */
function buildIssuesDocument(featureName, featureId, issues, tasks) {
  const phaseSummary = {};
  for (const task of tasks) {
    if (!phaseSummary[task.phase]) {
      phaseSummary[task.phase] = [];
    }
    phaseSummary[task.phase].push(task.taskId);
  }

  let summaryByPhase = '';
  for (const [phase, taskIds] of Object.entries(phaseSummary)) {
    const startNum = tasks.findIndex(t => t.taskId === taskIds[0]) + 1;
    const endNum = tasks.findIndex(t => t.taskId === taskIds[taskIds.length - 1]) + 1;
    summaryByPhase += `### ${phase}\n- Issue #${startNum} - #${endNum}: ${taskIds.length} issues\n\n`;
  }

  return `---
description: "GitHub issues for ${featureName} - ready to create in GitHub"
---

# GitHub Issues: ${featureName}

**Generated from**: tasks.md
**Feature ID**: ${featureId}
**Total Issues**: ${tasks.length}
**Generated**: ${new Date().toISOString().split('T')[0]}

This file contains GitHub-ready issue definitions for each task in tasks.md. Each issue follows the Requirements Ticket template from enterpriseaigroup/Issues2025.

---

## How to Use This File

### Creating Issues in GitHub

**Option 1: GitHub CLI (Recommended)**
\`\`\`bash
# Parse this file and create issues programmatically
# See: .specify/scripts/node/create-github-issues.js
node .specify/scripts/node/create-github-issues.js ${featureId}
\`\`\`

**Option 2: Manual Creation**
1. Copy each issue section below
2. Create new issue in GitHub
3. Paste the content, adjusting as needed

**Option 3: GitHub API**
Use the GitHub REST API with automation scripts.

---

${issues.join('\n')}

---

## Summary by Phase

${summaryByPhase}

---

## Notes

- **All issues**: Pre-filled with enterprise Requirements Ticket template
- **Mike-specific sections**: Review and update before creating issues
- **Assignees**: Adjust based on actual team assignments
- **Dependencies**: Link related issues using #issue-number after creation
- **Sync with tasks.md**: Close issues as tasks are checked off

---

## Quick Stats

- **Total Issues**: ${tasks.length}
- **Parallel Tasks**: ${tasks.filter(t => t.isParallel).length}
- **Story-specific**: ${tasks.filter(t => t.storyLabel).length}
- **Infrastructure**: ${tasks.filter(t => !t.storyLabel).length}

---

**Next Steps**:
1. Review each issue for completeness
2. Update Mike-specific sections (Screen described, Fields, Data, Navigation)
3. Confirm assignees and effort estimates
4. Create issues in GitHub using your preferred method
5. Link issues back to this document and tasks.md
`;
}

// Helper functions for issue generation

function generateScreenDescription(description, filePath) {
  if (!filePath) {
    return `This task involves: ${description}\n\nN/A - Configuration or infrastructure task`;
  }

  if (isUIFile(filePath)) {
    return `UI component or screen at \`${filePath}\` that ${description.toLowerCase()}.\n\n**Purpose**: [To be filled by Mike]\n**Users**: [To be filled by Mike]\n**Key Interactions**: [To be filled by Mike]`;
  }

  if (isAPIFile(filePath)) {
    return `API endpoint or service at \`${filePath}\` that ${description.toLowerCase()}.\n\n**Behavior**: Handles [describe request/response]\n**Consumers**: [List UI components or external systems]\n**Side Effects**: [List data changes or notifications]`;
  }

  if (isModelFile(filePath)) {
    return `Data model at \`${filePath}\` representing ${description.toLowerCase()}.\n\n**Entity**: [Entity name and purpose]\n**Fields**: [Key fields - see Fields Required section]\n**Relationships**: [Related entities]`;
  }

  return `Implementation at \`${filePath}\` that ${description.toLowerCase()}.\n\n**Type**: [Service/Utility/Configuration]\n**Purpose**: [What this code accomplishes]\n**Dependencies**: [What it requires]`;
}

function generateValueStatement(description) {
  const action = description.toLowerCase();
  if (action.includes('test')) {
    return 'ensuring code quality and preventing regressions';
  }
  if (action.includes('setup') || action.includes('configure')) {
    return 'establishing necessary infrastructure';
  }
  if (action.includes('implement') || action.includes('create')) {
    return 'delivering core functionality';
  }
  if (action.includes('fix') || action.includes('handle')) {
    return 'improving reliability and user experience';
  }
  return 'advancing feature implementation';
}

function determinePriority(phase, storyLabel) {
  if (phase.includes('Phase 1') || phase.includes('Setup')) {
    return 'P1 (High)';
  }
  if (phase.includes('Phase 2') || phase.includes('Foundational')) {
    return 'P1 (High)';
  }
  if (storyLabel.includes('US1')) {
    return 'P1 (High)';
  }
  if (storyLabel.includes('US2')) {
    return 'P2 (Medium)';
  }
  if (storyLabel.includes('US3')) {
    return 'P3 (Low)';
  }
  if (phase.includes('Polish')) {
    return 'P3 (Low)';
  }
  return 'P2 (Medium)';
}

function generateFieldsTable(description, filePath) {
  if (!filePath || !isUIFile(filePath) && !isModelFile(filePath)) {
    return 'N/A - This is a backend/infrastructure task without UI fields';
  }

  return `| Field | Type | Source | Validation |
|-------|------|--------|------------|
| [field-1] | [string/number/boolean] | [source] | [validation rules] |
| [field-2] | [string/number/boolean] | [source] | [validation rules] |

**Note**: To be filled by Mike based on design specifications`;
}

function generateAcceptanceCriteria(description, filePath) {
  const criteria = [
    `The implementation in \`${filePath || 'specified files'}\` is complete`,
    `Code follows project conventions and passes linting`,
    `All type definitions are correct with no \`any\` types`
  ];

  if (description.toLowerCase().includes('test')) {
    criteria.push('Tests are written and pass successfully');
    criteria.push('Test coverage meets project standards (>80%)');
  } else {
    criteria.push('Unit tests are written if applicable');
  }

  if (isAPIFile(filePath)) {
    criteria.push('API endpoint returns correct status codes');
    criteria.push('Error handling covers all edge cases');
    criteria.push('Request/response validation is implemented');
  }

  if (isUIFile(filePath)) {
    criteria.push('UI component renders correctly');
    criteria.push('All user interactions work as expected');
    criteria.push('Component is responsive and accessible');
  }

  if (isModelFile(filePath)) {
    criteria.push('Data model includes all required fields');
    criteria.push('Relationships with other models are correctly defined');
    criteria.push('Validation rules are implemented');
  }

  return criteria.map(c => `- [ ] ${c}`).join('\n');
}

function generateDataNeeded(description, filePath) {
  if (!filePath || isTestFile(filePath)) {
    return 'N/A - Test or configuration task';
  }

  if (isModelFile(filePath)) {
    return `**Entities**: Entity defined in \`${filePath}\` with fields [to be specified by Mike]

**Sources**: [Specify data sources and refresh cadence]

**Storage**: [Database/cache/in-memory]`;
  }

  return `**Entities**: [List entities this implementation needs]

**Sources**: [APIs, databases, or services providing data]

**Refresh**: [Real-time/hourly/daily/on-demand]

[If no external data: "N/A - Uses only local/in-memory data"]`;
}

function generateIntegrations(description, filePath) {
  if (!filePath || isTestFile(filePath)) {
    return 'N/A - Test or configuration task';
  }

  if (isAPIFile(filePath)) {
    return `- [External API/Service]: [Purpose and authentication method]
- [Database]: [Connection details and query patterns]

[If standalone: "N/A - No external integrations required"]`;
  }

  return `[List external or internal systems this task must integrate with]

[If standalone: "N/A - No external integrations required"]`;
}

function generateNavigation(description, filePath) {
  if (!filePath) {
    return 'N/A - Configuration or setup task';
  }

  if (isUIFile(filePath)) {
    return `**Access**: [How users reach this screen/component]

**Flow**: [User journey to this point]

**Links**: [Related screens and navigation paths]

**Breadcrumbs**: [Navigation hierarchy]`;
  }

  if (isAPIFile(filePath)) {
    return `**Access**: Called via [HTTP endpoint or service method]

**Request Path**: \`[method] [path]\`

**Consumers**: [UI components or services that call this]

**Response**: [What data/status it returns]`;
  }

  return `**Access**: Used by [list calling code]

**Invocation**: [How this code is executed]

**Integration Points**: [Where this fits in the system]`;
}

function generateBlocksNeeded(description, filePath) {
  if (!filePath) {
    return 'N/A - High-level setup task';
  }

  const blocks = [];

  if (isUIFile(filePath)) {
    blocks.push('**UI Components**:');
    blocks.push('- [Component name]: [New/Reusable] - [Purpose]');
  }

  if (isAPIFile(filePath)) {
    blocks.push('**Services**:');
    blocks.push('- [Service name]: [Purpose and location]');
  }

  blocks.push('\n**Dependencies**:');
  blocks.push('- [List any external libraries or internal modules needed]');

  return blocks.join('\n');
}

function estimateEffort(description, filePath) {
  const desc = description.toLowerCase();

  // Small tasks
  if (desc.includes('add') && desc.length < 50) return 'S (1-2 hours)';
  if (desc.includes('update') && desc.length < 50) return 'S (1-2 hours)';
  if (desc.includes('fix')) return 'S (1-2 hours)';
  if (isTestFile(filePath)) return 'S (2-4 hours)';

  // Medium tasks
  if (desc.includes('implement')) return 'M (4-8 hours)';
  if (desc.includes('create')) return 'M (4-8 hours)';
  if (isModelFile(filePath)) return 'M (4-6 hours)';
  if (isAPIFile(filePath)) return 'M (6-8 hours)';

  // Large tasks
  if (desc.includes('integrate')) return 'L (1-2 days)';
  if (desc.includes('orchestrat')) return 'L (1-2 days)';
  if (isUIFile(filePath)) return 'M-L (6-12 hours)';

  return 'M (4-8 hours)'; // Default
}

function findRelatedTasks(taskId, tasks) {
  const taskNum = parseInt(taskId.replace('T', ''));
  const related = [];

  // Tasks immediately before and after are often related
  if (taskNum > 1) {
    related.push(`T${String(taskNum - 1).padStart(3, '0')}`);
  }
  if (taskNum < tasks.length) {
    related.push(`T${String(taskNum + 1).padStart(3, '0')}`);
  }

  return related.length > 0 ? related.join(', ') : 'None identified';
}

// File type detection helpers
function isUIFile(filePath) {
  return /\.(tsx|jsx|vue|svelte|html)$/i.test(filePath) ||
         /component|screen|page|view/i.test(filePath);
}

function isAPIFile(filePath) {
  return /\.(ts|js|py|java|go)$/i.test(filePath) &&
         /api|endpoint|route|controller|handler/i.test(filePath);
}

function isModelFile(filePath) {
  return /model|entity|schema/i.test(filePath);
}

function isTestFile(filePath) {
  return /test|spec/i.test(filePath);
}
