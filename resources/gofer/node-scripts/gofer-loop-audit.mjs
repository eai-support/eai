#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';

const STAGE_ORDER = {
  '0_gofer_start': 0,
  '1_gofer_research': 1,
  '1_research': 1,
  '2_gofer_specify': 2,
  '2_specify': 2,
  '3_gofer_plan': 3,
  '3_plan': 3,
  '4_gofer_tasks': 4,
  '4_tasks': 4,
  '5_gofer_implement': 5,
  '5_implement': 5,
  '6_gofer_validate': 6,
  '6_validate': 6,
};

const VALID_RESULTS = new Set(['pass', 'fail', 'warn', 'blocked', 'skipped', 'complete']);
const PLACEHOLDER_PATTERN = /\{\{|\}\}|\[.+\]|^todo$|^tbd$|^unknown$/i;

function usage() {
  return `Usage: node .specify/scripts/node/gofer-loop-audit.mjs --feature-dir <path> [options]

Options:
  --workspace <path>   Workspace root (default: process.cwd())
  --stage <stage>      Current Gofer stage (default: 6_validate)
  --init               Create loop-contract.json when missing
  --force              Overwrite loop-contract.json when used with --init
  --record <json>      Append a loop-ledger.jsonl entry before auditing
  --report <path>      Override markdown report path
  --json               Print JSON summary to stdout
  --strict             Exit non-zero on failed audit
  --no-report          Do not write loop-audit-report.md
`;
}

function parseArgs(argv) {
  const args = {
    workspace: process.cwd(),
    featureDir: '',
    stage: '6_validate',
    init: false,
    force: false,
    record: '',
    reportPath: '',
    json: false,
    strict: false,
    writeReport: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--workspace':
        args.workspace = argv[++index] || args.workspace;
        break;
      case '--feature-dir':
        args.featureDir = argv[++index] || '';
        break;
      case '--stage':
        args.stage = argv[++index] || args.stage;
        break;
      case '--init':
        args.init = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--record':
        args.record = argv[++index] || '';
        break;
      case '--report':
        args.reportPath = argv[++index] || '';
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
  args.stage = normalizeStage(args.stage);
  args.reportPath = args.reportPath
    ? path.resolve(args.workspace, args.reportPath)
    : path.join(args.featureDir, 'loop-audit-report.md');

  return args;
}

function normalizeStage(stage) {
  return String(stage || '6_validate').trim();
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

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function hasMaterialText(value) {
  return typeof value === 'string' && value.trim().length > 0 && !PLACEHOLDER_PATTERN.test(value.trim());
}

function createDefaultContract(featureDir) {
  const featureId = path.basename(featureDir);
  return {
    schemaVersion: 1,
    loopId: featureId,
    profile: 'standard',
    objective:
      'Keep feature delivery aligned with current goals, approved scope, implementation evidence, and validation gates.',
    entryStage: '0_gofer_start',
    maxIterations: 3,
    budget: {
      maxWallClockMinutes: null,
      maxModelSpendUsd: null,
      stopOnBudgetWarning: true,
    },
    modelTiers: {
      simple: 'Use the repo model policy simple tier.',
      medium: 'Use the repo model policy medium tier.',
      hard: 'Use the repo model policy hard tier.',
      arbiter: 'Use the repo model policy arbiter tier only for release-critical or contradictory results.',
    },
    evalCommands: [
      {
        id: 'loop-audit',
        stage: '5_implement',
        command:
          'node .specify/scripts/node/gofer-loop-audit.mjs --feature-dir {FEATURE_DIR} --stage 5_implement --json --strict',
        purpose:
          'Verify bounded loop contract and implementation-loop ledger evidence before marking implementation complete.',
        runWhen: 'before and after implementation loops',
      },
      {
        id: 'closed-loop-audit',
        stage: '6_validate',
        command:
          'node .specify/scripts/node/gofer-closed-loop-audit.mjs --feature-dir {FEATURE_DIR} --json --strict',
        purpose: 'Verify goal, traceability, drift, and validation freshness before final scoring.',
        runWhen: 'before validation scoring',
      },
    ],
    successCriteria: [
      {
        id: 'SC-LOOP-001',
        description: 'Each implementation or validation loop records iteration evidence in loop-ledger.jsonl.',
        evidence: ['loop-ledger.jsonl'],
      },
      {
        id: 'SC-LOOP-002',
        description: 'All configured evaluation commands pass before Gofer reports the feature complete.',
        evidence: ['validation-report.md', 'loop-audit-report.md'],
      },
    ],
    stopConditions: [
      {
        id: 'STOP-001',
        description: 'Stop when all success criteria have evidence and no blocking loop findings remain.',
        status: 'active',
      },
      {
        id: 'STOP-002',
        description: 'Escalate instead of looping forever when the same failing action reaches maxIterations.',
        status: 'active',
      },
    ],
    humanEscalation: {
      maxFailedIterations: 3,
      owner: 'feature owner',
      escalateWhen: [
        'the same failure repeats at maxIterations',
        'a security, privacy, data, or release-critical gate remains red',
        'budget or context-window limits would hide evidence',
      ],
    },
  };
}

async function initContract(contractPath, featureDir, force) {
  if (!force && (await pathExists(contractPath))) {
    return false;
  }
  await fs.mkdir(path.dirname(contractPath), { recursive: true });
  await fs.writeFile(contractPath, `${JSON.stringify(createDefaultContract(featureDir), null, 2)}\n`, 'utf8');
  return true;
}

function validateContract(contract) {
  const findings = [];
  const warnings = [];

  if (!isObject(contract)) {
    findings.push('loop-contract.json must contain a JSON object');
    return { findings, warnings };
  }

  if (contract.schemaVersion !== 1) {
    findings.push('schemaVersion must be 1');
  }
  for (const field of ['loopId', 'profile', 'objective', 'entryStage']) {
    if (!hasMaterialText(contract[field])) {
      findings.push(`${field} must be material text`);
    }
  }
  if (!Number.isInteger(contract.maxIterations) || contract.maxIterations < 1 || contract.maxIterations > 10) {
    findings.push('maxIterations must be an integer from 1 to 10');
  }
  if (!Array.isArray(contract.evalCommands) || contract.evalCommands.length === 0) {
    findings.push('evalCommands must contain at least one evaluation command');
  } else {
    for (const command of contract.evalCommands) {
      if (!isObject(command)) {
        findings.push('each evalCommands item must be an object');
        continue;
      }
      for (const field of ['id', 'command', 'purpose', 'runWhen']) {
        if (!hasMaterialText(command[field])) {
          findings.push(`evalCommands item missing material ${field}`);
        }
      }
    }
  }
  if (!Array.isArray(contract.successCriteria) || contract.successCriteria.length === 0) {
    findings.push('successCriteria must contain at least one criterion');
  } else {
    for (const criterion of contract.successCriteria) {
      if (!isObject(criterion) || !hasMaterialText(criterion.id) || !hasMaterialText(criterion.description)) {
        findings.push('each successCriteria item must include id and description');
      }
    }
  }
  if (!Array.isArray(contract.stopConditions) || contract.stopConditions.length === 0) {
    findings.push('stopConditions must contain at least one stop condition');
  } else {
    for (const condition of contract.stopConditions) {
      if (!isObject(condition) || !hasMaterialText(condition.id) || !hasMaterialText(condition.description)) {
        findings.push('each stopConditions item must include id and description');
      }
    }
  }
  if (!isObject(contract.humanEscalation)) {
    findings.push('humanEscalation must be present');
  } else if (
    !Number.isInteger(contract.humanEscalation.maxFailedIterations) ||
    contract.humanEscalation.maxFailedIterations < 1
  ) {
    findings.push('humanEscalation.maxFailedIterations must be a positive integer');
  }
  if (!isObject(contract.modelTiers)) {
    warnings.push('modelTiers is missing; Gofer will fall back to repo model policy');
  }
  if (!isObject(contract.budget)) {
    warnings.push('budget is missing; loop audit cannot reason about budget stops');
  }

  return { findings, warnings };
}

function parseLedger(content) {
  const entries = [];
  const findings = [];

  if (!content || content.trim().length === 0) {
    return { entries, findings };
  }

  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trim().length === 0) {
      return;
    }
    try {
      const entry = JSON.parse(line);
      entries.push(entry);
    } catch (error) {
      findings.push(`loop-ledger.jsonl line ${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return { entries, findings };
}

function normalizeRecord(record, stage) {
  if (!isObject(record)) {
    throw new Error('--record must be a JSON object');
  }
  const normalized = {
    timestamp: new Date().toISOString(),
    stage,
    ...record,
  };
  return normalized;
}

function validateLedger(entries, contract, stage) {
  const findings = [];
  const warnings = [];
  const maxIterations = Number.isInteger(contract?.maxIterations) ? contract.maxIterations : 3;
  const stageOrder = STAGE_ORDER[stage] ?? 6;

  if (stageOrder >= 5 && entries.length === 0) {
    findings.push('loop-ledger.jsonl must contain at least one loop record for implementation or validation stages');
  }

  const failedActionCounts = new Map();
  for (const [index, entry] of entries.entries()) {
    const label = `loop-ledger.jsonl entry ${index + 1}`;
    if (!isObject(entry)) {
      findings.push(`${label} must be a JSON object`);
      continue;
    }
    for (const field of ['timestamp', 'stage', 'iteration', 'action', 'result', 'summary']) {
      if (entry[field] == null || String(entry[field]).trim().length === 0) {
        findings.push(`${label} missing required field ${field}`);
      }
    }
    if (entry.timestamp && Number.isNaN(Date.parse(entry.timestamp))) {
      findings.push(`${label} timestamp is not ISO-parseable`);
    }
    if (!Number.isInteger(entry.iteration) || entry.iteration < 1) {
      findings.push(`${label} iteration must be a positive integer`);
    } else if (entry.iteration > maxIterations) {
      findings.push(`${label} iteration ${entry.iteration} exceeds maxIterations ${maxIterations}`);
    }
    if (entry.result && !VALID_RESULTS.has(String(entry.result))) {
      findings.push(`${label} result must be one of ${Array.from(VALID_RESULTS).join(', ')}`);
    }
    if (['fail', 'blocked'].includes(entry.result) && !hasMaterialText(entry.nextAction || '')) {
      warnings.push(`${label} is ${entry.result} but does not record a material nextAction`);
    }
    if (['fail', 'blocked'].includes(entry.result)) {
      const key = String(entry.action || 'unknown');
      failedActionCounts.set(key, (failedActionCounts.get(key) || 0) + 1);
    }
  }

  const maxFailedIterations = Number.isInteger(contract?.humanEscalation?.maxFailedIterations)
    ? contract.humanEscalation.maxFailedIterations
    : maxIterations;
  for (const [action, count] of failedActionCounts.entries()) {
    if (count >= maxFailedIterations) {
      findings.push(
        `action ${action} has ${count} failed/blocked records and must escalate instead of continuing the loop`
      );
    }
  }

  return { findings, warnings };
}

async function appendRecord(ledgerPath, record, stage) {
  const normalized = normalizeRecord(JSON.parse(record), stage);
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  await fs.appendFile(ledgerPath, `${JSON.stringify(normalized)}\n`, 'utf8');
  return normalized;
}

function formatList(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- none';
}

function renderReport(result) {
  return `---
feature: ${result.featureId}
audited: ${result.auditedAt}
status: ${result.status}
stage: ${result.stage}
contract: loop-contract.json
ledger: loop-ledger.jsonl
---

# Loop Audit Report: ${result.featureId}

## Summary

- Status: \`${result.status}\`
- Stage: \`${result.stage}\`
- Contract created: ${result.contractCreated ? 'yes' : 'no'}
- Ledger entries: ${result.ledgerEntries}
- Max iterations: ${result.maxIterations ?? 'unknown'}

## Blocking Findings

${formatList(result.blockingFindings)}

## Warnings

${formatList(result.warnings)}

## Last Ledger Entry

\`\`\`json
${result.lastLedgerEntry ? JSON.stringify(result.lastLedgerEntry, null, 2) : 'null'}
\`\`\`
`;
}

async function analyze(args) {
  const contractPath = path.join(args.featureDir, 'loop-contract.json');
  const ledgerPath = path.join(args.featureDir, 'loop-ledger.jsonl');
  const featureId = path.basename(args.featureDir);
  const result = {
    featureId,
    featureDir: path.relative(args.workspace, args.featureDir),
    auditedAt: new Date().toISOString(),
    stage: args.stage,
    status: 'pass',
    contractCreated: false,
    blockingFindings: [],
    warnings: [],
    ledgerEntries: 0,
    maxIterations: null,
    lastLedgerEntry: null,
    appendedRecord: null,
  };

  if (args.init) {
    result.contractCreated = await initContract(contractPath, args.featureDir, args.force);
  }

  if (args.record) {
    result.appendedRecord = await appendRecord(ledgerPath, args.record, args.stage);
  }

  let contract = null;
  try {
    contract = await readJsonIfExists(contractPath);
  } catch (error) {
    result.blockingFindings.push(
      `loop-contract.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!contract) {
    result.blockingFindings.push('loop-contract.json is missing; run gofer-loop-audit.mjs --init or rerun /0_gofer_start');
  } else {
    const contractResult = validateContract(contract);
    result.blockingFindings.push(...contractResult.findings);
    result.warnings.push(...contractResult.warnings);
    result.maxIterations = contract.maxIterations;
  }

  const ledgerContent = await readTextIfExists(ledgerPath);
  const ledgerResult = parseLedger(ledgerContent);
  result.blockingFindings.push(...ledgerResult.findings);
  result.ledgerEntries = ledgerResult.entries.length;
  result.lastLedgerEntry = ledgerResult.entries.at(-1) || null;

  if (contract) {
    const validation = validateLedger(ledgerResult.entries, contract, args.stage);
    result.blockingFindings.push(...validation.findings);
    result.warnings.push(...validation.warnings);
  }

  if (result.blockingFindings.length > 0) {
    result.status = 'fail';
  } else if (result.warnings.length > 0) {
    result.status = 'warn';
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await analyze(args);

  if (args.writeReport) {
    await fs.mkdir(path.dirname(args.reportPath), { recursive: true });
    await fs.writeFile(args.reportPath, renderReport(result), 'utf8');
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${result.featureId}: ${result.status}\n`);
  }

  if (args.strict && result.status === 'fail') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
