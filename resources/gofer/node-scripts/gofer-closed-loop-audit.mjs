#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';

const STAGE_ORDER = {
  '1_research': 1,
  '2_specify': 2,
  '3_plan': 3,
  '4_tasks': 4,
  '5_implement': 5,
  '6_validate': 6,
};

const PLACEHOLDER_PATTERN = /^(?:—|-|n\/a|none|tbd|unknown|pending|not mapped)$/i;

function usage() {
  return `Usage: node .specify/scripts/node/gofer-closed-loop-audit.mjs --feature-dir <path> [options]

Options:
  --workspace <path>   Workspace root (default: process.cwd())
  --report <path>      Override markdown report path
  --json               Print JSON summary to stdout
  --strict             Exit non-zero on drift, missing evidence, or invalid artifacts
  --no-report          Do not write goal-rebaseline-report.md
`;
}

function parseArgs(argv) {
  const args = {
    featureDir: '',
    workspace: process.cwd(),
    reportPath: '',
    json: false,
    strict: false,
    writeReport: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--feature-dir':
        args.featureDir = argv[index + 1] || '';
        index += 1;
        break;
      case '--workspace':
        args.workspace = argv[index + 1] || args.workspace;
        index += 1;
        break;
      case '--report':
        args.reportPath = argv[index + 1] || '';
        index += 1;
        break;
      case '--json':
        args.json = true;
        break;
      case '--strict':
        args.strict = true;
        break;
      case '--no-report':
        args.writeReport = false;
        break;
      case '--help':
      case '-h':
        process.stdout.write(`${usage()}\n`);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.featureDir) {
    throw new Error('--feature-dir is required');
  }

  args.workspace = path.resolve(args.workspace);
  args.featureDir = path.isAbsolute(args.featureDir)
    ? args.featureDir
    : path.resolve(args.workspace, args.featureDir);
  args.reportPath = args.reportPath
    ? path.resolve(args.workspace, args.reportPath)
    : path.join(args.featureDir, 'goal-rebaseline-report.md');

  return args;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function readTextIfExists(targetPath) {
  try {
    return await fs.readFile(targetPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readJsonIfExists(targetPath) {
  const content = await readTextIfExists(targetPath);
  if (content == null) {
    return null;
  }
  return JSON.parse(content);
}

async function latestMtimeMs(targetPath) {
  if (!(await pathExists(targetPath))) {
    return null;
  }

  const stat = await fs.stat(targetPath);
  if (stat.isFile()) {
    return stat.mtimeMs;
  }

  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  let latest = stat.mtimeMs;
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const childLatest = await latestMtimeMs(path.join(targetPath, entry.name));
    if (childLatest != null) {
      latest = Math.max(latest, childLatest);
    }
  }

  return latest;
}

function normalizeHeader(header) {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseMarkdownTables(content) {
  const lines = content.split(/\r?\n/);
  const tables = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim().startsWith('|')) {
      continue;
    }

    const tableLines = [line];
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].trim().startsWith('|')) {
      tableLines.push(lines[cursor]);
      cursor += 1;
    }

    if (tableLines.length >= 2 && /^(\|\s*:?-+:?\s*)+\|?$/.test(tableLines[1].trim())) {
      const headers = tableLines[0]
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean);
      const rows = tableLines.slice(2).map((tableLine) => {
        const cells = tableLine
          .split('|')
          .map((cell) => cell.trim())
          .filter((_, cellIndex, all) => !(cellIndex === 0 && all[0] === ''))
          .filter((_, cellIndex, all) => !(cellIndex === all.length - 1 && all[all.length - 1] === ''));
        return Object.fromEntries(headers.map((header, headerIndex) => [header, cells[headerIndex] || '']));
      });
      tables.push({ headers, rows });
    }

    index = cursor - 1;
  }

  return tables;
}

function extractAcceptanceCriteria(specContent) {
  const out = [];
  const userStoryHeading = /^### User Story (\d+)\b/gm;
  const headings = [];
  let match;

  while ((match = userStoryHeading.exec(specContent)) !== null) {
    headings.push({ story: Number(match[1]), index: match.index });
  }

  for (let index = 0; index < headings.length; index += 1) {
    const start = headings[index].index;
    const end = index + 1 < headings.length ? headings[index + 1].index : specContent.length;
    const section = specContent.slice(start, end);
    const acceptanceIndex = section.search(/\*\*Acceptance Scenarios\*\*/);
    if (acceptanceIndex === -1) {
      continue;
    }

    const acceptanceBlock = section.slice(acceptanceIndex);
    const scenarioPattern = /^(\d+)\.\s+\*\*Given\*\*/gm;
    let scenarioMatch;
    while ((scenarioMatch = scenarioPattern.exec(acceptanceBlock)) !== null) {
      out.push(`US${headings[index].story} AC-${Number(scenarioMatch[1])}`);
    }
  }

  return out;
}

function extractRequirementIds(specContent) {
  const ids = new Set();
  for (const pattern of [/\bFR-\d{3}\b/g, /\bNFR-\d{3}\b/g, /\bSC-\d{3}\b/g]) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(specContent)) !== null) {
      ids.add(match[0]);
    }
  }

  for (const acceptanceCriterion of extractAcceptanceCriteria(specContent)) {
    ids.add(acceptanceCriterion);
  }

  return Array.from(ids).sort();
}

function splitEvidenceRefs(value) {
  if (!value || PLACEHOLDER_PATTERN.test(value.trim())) {
    return [];
  }

  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .map((item) => item.replace(/^`|`$/g, ''))
    .map((item) => {
      const markdownLink = item.match(/\[[^\]]+\]\(([^)]+)\)/);
      return markdownLink ? markdownLink[1] : item;
    })
    .map((item) => item.replace(/^file:\/\//, ''))
    .map((item) => item.replace(/:\d+$/, ''))
    .map((item) => item.trim())
    .filter(Boolean);
}

function findTraceabilityTable(tables) {
  return (
    tables.find(({ headers }) => {
      const normalized = headers.map(normalizeHeader);
      const hasRequirement = normalized.some((header) => header.includes('requirement'));
      const hasCode = normalized.some((header) => header.includes('code'));
      const hasTests = normalized.some(
        (header) => header.includes('test') || header.includes('validation')
      );
      return hasRequirement && hasCode && hasTests;
    }) || null
  );
}

function findAssumptionDriftTable(tables) {
  return (
    tables.find(({ headers }) => {
      const normalized = headers.map(normalizeHeader);
      return (
        normalized.some((header) => header.includes('assumptionid')) &&
        normalized.some((header) => header.includes('reopenstage')) &&
        normalized.some((header) => header.includes('expire'))
      );
    }) || null
  );
}

function getColumn(row, headers, candidates) {
  const normalizedHeaders = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const index = normalizedHeaders.findIndex((header) => header === candidate || header.includes(candidate));
    if (index !== -1) {
      return row[headers[index]] || '';
    }
  }
  return '';
}

function parseIsoDate(value) {
  if (!value || PLACEHOLDER_PATTERN.test(value.trim())) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function resolveEvidencePath(ref, workspaceRoot, featureDir) {
  if (!ref) {
    return null;
  }

  const candidate = ref.trim();
  if (!candidate) {
    return null;
  }

  const attempts = [];
  if (path.isAbsolute(candidate)) {
    attempts.push(candidate);
  } else {
    attempts.push(path.resolve(workspaceRoot, candidate));
    attempts.push(path.resolve(featureDir, candidate));
  }

  return attempts;
}

async function latestMtimeForRef(ref, workspaceRoot, featureDir) {
  const attempts = resolveEvidencePath(ref, workspaceRoot, featureDir) || [];
  for (const attempt of attempts) {
    if (!(await pathExists(attempt))) {
      continue;
    }
    return latestMtimeMs(attempt);
  }
  return null;
}

function pickEarlierStage(currentStage, candidateStage) {
  if (!candidateStage) {
    return currentStage;
  }
  if (!currentStage) {
    return candidateStage;
  }
  return STAGE_ORDER[candidateStage] < STAGE_ORDER[currentStage] ? candidateStage : currentStage;
}

function addFinding(bucket, finding) {
  bucket.push({
    stage: finding.stage || null,
    message: finding.message,
    source: finding.source,
  });
}

async function analyzeFeature({ featureDir, workspaceRoot }) {
  const featureId = path.basename(featureDir);
  const specPath = path.join(featureDir, 'spec.md');
  const planPath = path.join(featureDir, 'plan.md');
  const tasksPath = path.join(featureDir, 'tasks.md');
  const traceabilityPath = path.join(featureDir, 'traceability.md');
  const assumptionsPath = path.join(featureDir, 'assumptions.md');
  const goalLedgerPath = path.join(featureDir, 'goal-ledger.json');
  const validationPath = path.join(featureDir, 'validation-report.md');

  const result = {
    featureId,
    featureDir: path.relative(workspaceRoot, featureDir),
    auditedAt: new Date().toISOString(),
    status: 'healthy',
    recommendedStartStage: null,
    blockingFindings: [],
    warnings: [],
    driftFindings: [],
    coverage: {
      requirements: {
        total: 0,
        missingRows: [],
        missingCodeEvidence: [],
        missingTestEvidence: [],
      },
      goals: {
        total: 0,
        missingRequirementLinks: [],
        missingTraceRows: [],
      },
      assumptions: {
        expired: [],
        disproven: [],
      },
    },
    deliveryStates: {
      total: 0,
      incomplete: [],
    },
    watchedPathFindings: [],
  };

  const requiredArtifacts = [
    { path: specPath, stage: '2_specify', source: 'spec.md' },
    { path: planPath, stage: '3_plan', source: 'plan.md' },
    { path: tasksPath, stage: '4_tasks', source: 'tasks.md' },
  ];

  for (const artifact of requiredArtifacts) {
    if (!(await pathExists(artifact.path))) {
      result.status = 'fail';
      result.recommendedStartStage = pickEarlierStage(result.recommendedStartStage, artifact.stage);
      addFinding(result.blockingFindings, {
        stage: artifact.stage,
        source: artifact.source,
        message: `${artifact.source} is missing`,
      });
    }
  }

  const [specContent, traceabilityContent, assumptionsContent] = await Promise.all([
    readTextIfExists(specPath),
    readTextIfExists(traceabilityPath),
    readTextIfExists(assumptionsPath),
  ]);

  let goalLedger = null;
  try {
    goalLedger = await readJsonIfExists(goalLedgerPath);
  } catch (error) {
    result.status = 'fail';
    addFinding(result.blockingFindings, {
      stage: '1_research',
      source: 'goal-ledger.json',
      message: `goal-ledger.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    result.recommendedStartStage = pickEarlierStage(result.recommendedStartStage, '1_research');
  }

  if (!goalLedger) {
    if (await pathExists(goalLedgerPath)) {
      result.status = 'fail';
    } else {
      result.status = result.status === 'fail' ? 'fail' : 'warning';
    }
    addFinding(result.blockingFindings, {
      stage: '1_research',
      source: 'goal-ledger.json',
      message: 'goal-ledger.json is missing or empty',
    });
    result.recommendedStartStage = pickEarlierStage(result.recommendedStartStage, '1_research');
  }

  if (goalLedger?.goals && Array.isArray(goalLedger.goals)) {
    result.coverage.goals.total = goalLedger.goals.length;
  }

  if (goalLedger?.deliveryStates && Array.isArray(goalLedger.deliveryStates)) {
    result.deliveryStates.total = goalLedger.deliveryStates.length;
    for (const state of goalLedger.deliveryStates) {
      if (
        state &&
        state.targetState === 'live' &&
        state.currentState !== 'live' &&
        (!Array.isArray(state.promotionCriteria) || state.promotionCriteria.length === 0)
      ) {
        result.deliveryStates.incomplete.push(state.capability || 'unknown capability');
      }
    }
  }

  if (result.deliveryStates.incomplete.length > 0) {
    result.status = result.status === 'fail' ? 'fail' : 'warning';
    addFinding(result.warnings, {
      source: 'goal-ledger.json',
      message:
        'One or more mock/hybrid capabilities target live delivery but do not record promotion criteria',
    });
  }

  const requirementIds = specContent ? extractRequirementIds(specContent) : [];
  result.coverage.requirements.total = requirementIds.length;

  let traceRows = [];
  if (traceabilityContent) {
    const tables = parseMarkdownTables(traceabilityContent);
    const traceabilityTable = findTraceabilityTable(tables);
    if (traceabilityTable) {
      traceRows = traceabilityTable.rows.map((row) => {
        const requirementId = getColumn(row, traceabilityTable.headers, [
          'requirementid',
          'requirement',
          'specid',
        ]);
        const goalId = getColumn(row, traceabilityTable.headers, ['goalid', 'goal']);
        const codeRefs = splitEvidenceRefs(
          getColumn(row, traceabilityTable.headers, ['codeevidence', 'code', 'plannedcode'])
        );
        const testRefs = splitEvidenceRefs(
          getColumn(row, traceabilityTable.headers, ['testevidence', 'tests', 'plannedtests', 'validation'])
        );
        return {
          requirementId: requirementId.trim(),
          goalId: goalId.trim(),
          codeRefs,
          testRefs,
        };
      });
    } else {
      result.status = result.status === 'fail' ? 'fail' : 'warning';
      addFinding(result.warnings, {
        stage: '4_tasks',
        source: 'traceability.md',
        message:
          'traceability.md exists but does not expose a Requirement → Code → Test matrix',
      });
    }
  } else {
    result.status = result.status === 'fail' ? 'fail' : 'warning';
    addFinding(result.warnings, {
      stage: '4_tasks',
      source: 'traceability.md',
      message: 'traceability.md is missing',
    });
  }

  const traceRowByRequirement = new Map(traceRows.map((row) => [row.requirementId, row]));
  for (const requirementId of requirementIds) {
    const row = traceRowByRequirement.get(requirementId);
    if (!row) {
      result.coverage.requirements.missingRows.push(requirementId);
      continue;
    }
    if (row.codeRefs.length === 0) {
      result.coverage.requirements.missingCodeEvidence.push(requirementId);
    }
    if (row.testRefs.length === 0) {
      result.coverage.requirements.missingTestEvidence.push(requirementId);
    }
  }

  if (
    result.coverage.requirements.missingRows.length > 0 ||
    result.coverage.requirements.missingCodeEvidence.length > 0 ||
    result.coverage.requirements.missingTestEvidence.length > 0
  ) {
    result.status = 'fail';
    result.recommendedStartStage = pickEarlierStage(result.recommendedStartStage, '4_tasks');
    addFinding(result.blockingFindings, {
      stage: '4_tasks',
      source: 'traceability.md',
      message: 'Requirement trace matrix is incomplete for one or more requirements',
    });
  }

  if (goalLedger?.goals && Array.isArray(goalLedger.goals)) {
    for (const goal of goalLedger.goals) {
      const goalId = goal?.id || 'unknown goal';
      const goalRequirements = Array.isArray(goal?.trace?.requirements) ? goal.trace.requirements : [];
      if (goalRequirements.length === 0) {
        result.coverage.goals.missingRequirementLinks.push(goalId);
      }
      for (const requirementId of goalRequirements) {
        if (!traceRowByRequirement.has(requirementId)) {
          result.coverage.goals.missingTraceRows.push(`${goalId} -> ${requirementId}`);
        }
      }
    }
  }

  if (
    result.coverage.goals.missingRequirementLinks.length > 0 ||
    result.coverage.goals.missingTraceRows.length > 0
  ) {
    result.status = 'fail';
    result.recommendedStartStage = pickEarlierStage(result.recommendedStartStage, '2_specify');
    addFinding(result.blockingFindings, {
      stage: '2_specify',
      source: 'goal-ledger.json',
      message: 'Goal ledger does not map cleanly to specification and traceability artifacts',
    });
  }

  if (assumptionsContent) {
    const tables = parseMarkdownTables(assumptionsContent);
    const driftTable = findAssumptionDriftTable(tables);
    if (driftTable) {
      const now = Date.now();
      for (const row of driftTable.rows) {
        const assumptionId = getColumn(row, driftTable.headers, ['assumptionid', 'id']).trim();
        const status = getColumn(row, driftTable.headers, ['status']).trim();
        const expiresAt = parseIsoDate(
          getColumn(row, driftTable.headers, ['expiresat', 'expires', 'verifyby'])
        );
        const reopenStage = getColumn(row, driftTable.headers, ['reopenstage']).trim();

        if (status.toUpperCase() === 'DISPROVEN') {
          result.coverage.assumptions.disproven.push(assumptionId || 'unknown assumption');
          result.recommendedStartStage = pickEarlierStage(
            result.recommendedStartStage,
            reopenStage || '2_specify'
          );
        }

        if (
          expiresAt != null &&
          expiresAt < now &&
          status.toUpperCase() !== 'VALIDATED' &&
          status.toUpperCase() !== 'PARTIALLY_VALID'
        ) {
          result.coverage.assumptions.expired.push(assumptionId || 'unknown assumption');
          result.recommendedStartStage = pickEarlierStage(
            result.recommendedStartStage,
            reopenStage || '1_research'
          );
        }
      }
    } else {
      result.status = result.status === 'fail' ? 'fail' : 'warning';
      addFinding(result.warnings, {
        stage: '0a_problem_validation',
        source: 'assumptions.md',
        message:
          'assumptions.md exists but does not expose an assumption drift control table with expiry and reopen-stage metadata',
      });
    }
  }

  if (
    result.coverage.assumptions.expired.length > 0 ||
    result.coverage.assumptions.disproven.length > 0
  ) {
    result.status = result.status === 'fail' ? 'fail' : 'drift';
    addFinding(result.driftFindings, {
      stage: result.recommendedStartStage,
      source: 'assumptions.md',
      message: 'Assumption drift requires a mini-loop before continuing',
    });
  }

  const specMtime = await latestMtimeMs(specPath);
  const goalLedgerMtime = await latestMtimeMs(goalLedgerPath);
  const planMtime = await latestMtimeMs(planPath);
  const tasksMtime = await latestMtimeMs(tasksPath);
  const validationMtime = await latestMtimeMs(validationPath);

  const stage3Inputs = await Promise.all([
    latestMtimeMs(path.join(featureDir, 'contract-pack.md')),
    latestMtimeMs(path.join(featureDir, 'contracts')),
    latestMtimeMs(path.join(featureDir, 'ui-preview-brief.md')),
    latestMtimeMs(path.join(featureDir, 'ui-approval.md')),
    latestMtimeMs(path.join(featureDir, 'service-fit-matrix.md')),
  ]);

  if (goalLedgerMtime != null && specMtime != null && goalLedgerMtime > specMtime) {
    result.status = result.status === 'fail' ? 'fail' : 'drift';
    result.recommendedStartStage = pickEarlierStage(result.recommendedStartStage, '2_specify');
    addFinding(result.driftFindings, {
      stage: '2_specify',
      source: 'goal-ledger.json',
      message: 'Goal ledger is newer than spec.md; refresh the specification mini-loop',
    });
  }

  if (specMtime != null && planMtime != null && specMtime > planMtime) {
    result.status = result.status === 'fail' ? 'fail' : 'drift';
    result.recommendedStartStage = pickEarlierStage(result.recommendedStartStage, '3_plan');
    addFinding(result.driftFindings, {
      stage: '3_plan',
      source: 'spec.md',
      message: 'spec.md is newer than plan.md; refresh the plan before continuing',
    });
  }

  const planInputLatest = [planMtime, ...stage3Inputs].filter((value) => value != null).reduce(
    (latest, value) => Math.max(latest, value),
    0
  );
  if (planInputLatest > 0 && tasksMtime != null && planInputLatest > tasksMtime) {
    result.status = result.status === 'fail' ? 'fail' : 'drift';
    result.recommendedStartStage = pickEarlierStage(result.recommendedStartStage, '4_tasks');
    addFinding(result.driftFindings, {
      stage: '4_tasks',
      source: 'plan/contracts/ui artifacts',
      message: 'Planning or UX artifacts moved after tasks.md; regenerate runnable tasks',
    });
  }

  const watchedPaths = new Map();
  for (const row of traceRows) {
    for (const ref of [...row.codeRefs, ...row.testRefs]) {
      watchedPaths.set(ref, resolveEvidencePath(ref, workspaceRoot, featureDir));
    }
  }

  if (goalLedger?.reloopTriggers && Array.isArray(goalLedger.reloopTriggers)) {
    for (const trigger of goalLedger.reloopTriggers) {
      const baselineMtime = await latestMtimeForRef(
        trigger.baselineArtifact || '',
        workspaceRoot,
        featureDir
      );
      if (baselineMtime == null) {
        continue;
      }

      for (const watch of Array.isArray(trigger.watch) ? trigger.watch : []) {
        const watchMtime = await latestMtimeForRef(watch, workspaceRoot, featureDir);
        if (watchMtime != null && watchMtime > baselineMtime) {
          result.status = result.status === 'fail' ? 'fail' : 'drift';
          result.recommendedStartStage = pickEarlierStage(
            result.recommendedStartStage,
            trigger.reopenStage || '4_tasks'
          );
          result.watchedPathFindings.push({
            trigger: trigger.id || trigger.label || 'unknown-trigger',
            watch,
            baselineArtifact: trigger.baselineArtifact || '',
          });
        }
      }
    }
  }

  if (validationMtime == null) {
    result.status = result.status === 'fail' ? 'fail' : 'drift';
    result.recommendedStartStage = pickEarlierStage(result.recommendedStartStage, '6_validate');
    addFinding(result.driftFindings, {
      stage: '6_validate',
      source: 'validation-report.md',
      message: 'validation-report.md is missing; the feature has no current objective outcome gate',
    });
  } else {
    for (const [ref, attempts] of watchedPaths.entries()) {
      for (const attempt of attempts || []) {
        if (!(await pathExists(attempt))) {
          continue;
        }
        const watchedMtime = await latestMtimeMs(attempt);
        if (watchedMtime != null && watchedMtime > validationMtime) {
          result.status = result.status === 'fail' ? 'fail' : 'drift';
          result.recommendedStartStage = pickEarlierStage(result.recommendedStartStage, '6_validate');
          addFinding(result.driftFindings, {
            stage: '6_validate',
            source: ref,
            message: `${ref} changed after validation-report.md; rerun validation`,
          });
        }
        break;
      }
    }
  }

  if (
    result.status === 'healthy' &&
    (result.warnings.length > 0 || result.deliveryStates.incomplete.length > 0)
  ) {
    result.status = 'warning';
  }

  return result;
}

function formatList(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- none';
}

function renderMarkdownReport(result) {
  return `---
feature: ${result.featureId}
audited: ${result.auditedAt}
status: ${result.status}
recommended_start_stage: ${result.recommendedStartStage || 'none'}
---

# Goal Rebaseline Report: ${result.featureId}

## Summary

- Status: \`${result.status}\`
- Recommended start stage: \`${result.recommendedStartStage || 'none'}\`
- Requirement count: ${result.coverage.requirements.total}
- Goal count: ${result.coverage.goals.total}
- Delivery states tracked: ${result.deliveryStates.total}

## Blocking Findings

${formatList(result.blockingFindings.map((finding) => `${finding.source}: ${finding.message}`))}

## Drift Findings

${formatList(result.driftFindings.map((finding) => `${finding.source}: ${finding.message}`))}

## Warnings

${formatList(result.warnings.map((finding) => `${finding.source}: ${finding.message}`))}

## Requirement Coverage

- Missing trace rows: ${result.coverage.requirements.missingRows.join(', ') || 'none'}
- Missing code evidence: ${result.coverage.requirements.missingCodeEvidence.join(', ') || 'none'}
- Missing test evidence: ${result.coverage.requirements.missingTestEvidence.join(', ') || 'none'}

## Goal Coverage

- Goals missing requirement links: ${
    result.coverage.goals.missingRequirementLinks.join(', ') || 'none'
  }
- Goal links missing trace rows: ${result.coverage.goals.missingTraceRows.join(', ') || 'none'}

## Assumption Drift

- Expired assumptions: ${result.coverage.assumptions.expired.join(', ') || 'none'}
- Disproven assumptions: ${result.coverage.assumptions.disproven.join(', ') || 'none'}

## Delivery State Discipline

- Capabilities missing promotion criteria: ${
    result.deliveryStates.incomplete.join(', ') || 'none'
  }

## Watched Path Drift

${formatList(
    result.watchedPathFindings.map(
      (finding) =>
        `${finding.trigger}: \`${finding.watch}\` moved after \`${finding.baselineArtifact}\``
    )
  )}
`;
}

async function writeReport(reportPath, content) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, content, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await analyzeFeature({
    featureDir: args.featureDir,
    workspaceRoot: args.workspace,
  });

  if (args.writeReport) {
    await writeReport(args.reportPath, renderMarkdownReport(result));
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      `${result.featureId}: ${result.status}${result.recommendedStartStage ? ` -> ${result.recommendedStartStage}` : ''}\n`
    );
  }

  const shouldFail =
    args.strict &&
    (result.status === 'fail' || result.status === 'drift' || result.blockingFindings.length > 0);
  if (shouldFail) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
