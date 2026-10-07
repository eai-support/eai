#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TRIALS = 2000;
const MAX_ENTRIES = 10000;
const METRICS = ['calls', 'inputTokens', 'outputTokens', 'costUsd'];
const STATUSES = ['verified', 'failed', 'blocked', 'timed-out', 'cancelled', 'stale', 'incomplete'];
const MATCH_FIELDS = [
  'caseId',
  'requirementsRevision',
  'inputRevision',
  'environmentRevision',
  'surface',
  'measurementClass',
];

function requireValue(condition, code) {
  if (!condition) throw new Error(code);
}

function object(value, fields, label) {
  requireValue(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `INVALID_${label}`
  );
  requireValue(
    Object.keys(value).every((key) => fields.includes(key)),
    `UNSUPPORTED_${label}_FIELD`
  );
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1024;
}

function number(value, integer = false) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER &&
    (!integer || Number.isSafeInteger(value))
  );
}

function sum(values) {
  const result = values.reduce((total, value) => total + value, 0);
  requireValue(
    Number.isFinite(result) && Math.abs(result) <= Number.MAX_SAFE_INTEGER,
    'METRIC_OVERFLOW'
  );
  return result;
}

function usageSummary(entries, complete) {
  const result = { entryCount: entries.length, reported: {} };
  for (const metric of METRICS) {
    const known = entries.map((entry) => entry[metric]).filter((value) => value != null);
    result.reported[metric] = known.length ? sum(known) : null;
    result[metric] =
      complete && entries.length > 0 && known.length === entries.length
        ? result.reported[metric]
        : null;
  }
  return result;
}

export function summarizeUsage(usage) {
  if (usage == null) return usageSummary([], false);
  object(usage, ['complete', 'entries'], 'USAGE');
  requireValue(
    typeof usage.complete === 'boolean' &&
      Array.isArray(usage.entries) &&
      usage.entries.length <= MAX_ENTRIES,
    'INVALID_USAGE'
  );
  const seen = new Set();
  for (const entry of usage.entries) {
    object(entry, ['executionId', 'role', 'attempt', ...METRICS], 'USAGE_ENTRY');
    requireValue(
      text(entry.executionId) && !seen.has(entry.executionId),
      'DUPLICATE_OR_INVALID_EXECUTION_ID'
    );
    seen.add(entry.executionId);
    requireValue(
      ['worker', 'reviewer', 'controller', 'check'].includes(entry.role),
      'INVALID_USAGE_ROLE'
    );
    requireValue(Number.isSafeInteger(entry.attempt) && entry.attempt > 0, 'INVALID_ATTEMPT');
    for (const metric of METRICS) {
      requireValue(
        entry[metric] == null || number(entry[metric], metric !== 'costUsd'),
        `INVALID_USAGE_${metric}`
      );
    }
  }
  return usageSummary(usage.entries, usage.complete);
}

function aggregateUsage(trials) {
  const result = { entryCount: sum(trials.map((trial) => trial.usage.entryCount)), reported: {} };
  for (const metric of METRICS) {
    const reported = trials
      .map((trial) => trial.usage.reported[metric])
      .filter((value) => value != null);
    result.reported[metric] = reported.length ? sum(reported) : null;
    result[metric] =
      trials.length > 0 && trials.every((trial) => trial.usage[metric] != null)
        ? sum(trials.map((trial) => trial.usage[metric]))
        : null;
  }
  return result;
}

function statistics(values) {
  const observed = values.filter((value) => value != null).sort((a, b) => a - b);
  const result = {
    count: values.length,
    observedCount: observed.length,
    missingCount: values.length - observed.length,
    median: null,
    p95: null,
    mean: null,
    min: null,
    max: null,
    sampleStandardDeviation: null,
    standardError: null,
  };
  // Incomplete cohorts must not become favourable complete-case subsets.
  if (!values.length || observed.length !== values.length) return result;
  const n = observed.length;
  const mean = sum(observed.map((value) => value / n));
  const middle = Math.floor(n / 2);
  result.mean = mean;
  result.median = n % 2 ? observed[middle] : observed[middle - 1] / 2 + observed[middle] / 2;
  result.p95 = observed[Math.ceil(0.95 * n) - 1];
  result.min = observed[0];
  result.max = observed[n - 1];
  if (n > 1) {
    const variance = observed.reduce((total, value) => total + (value - mean) ** 2 / (n - 1), 0);
    result.sampleStandardDeviation = Math.sqrt(variance);
    result.standardError = result.sampleStandardDeviation / Math.sqrt(n);
  }
  return result;
}

function normalizeTrial(trial, revisions) {
  object(
    trial,
    [
      'trialId',
      'pairId',
      'variant',
      ...MATCH_FIELDS,
      'implementationRevision',
      'requiredChecks',
      'status',
      'elapsedMs',
      'checks',
      'usage',
    ],
    'TRIAL'
  );
  for (const field of ['trialId', 'pairId', 'implementationRevision', ...MATCH_FIELDS]) {
    requireValue(text(trial[field]), `INVALID_TRIAL_${field}`);
  }
  requireValue(['baseline', 'candidate'].includes(trial.variant), 'INVALID_VARIANT');
  requireValue(trial.implementationRevision === revisions[trial.variant], 'REVISION_MISMATCH');
  requireValue(
    ['synthetic', 'local-process', 'native-host'].includes(trial.measurementClass),
    'INVALID_MEASUREMENT_CLASS'
  );
  requireValue(STATUSES.includes(trial.status), 'INVALID_STATUS');
  requireValue(trial.elapsedMs == null || number(trial.elapsedMs), 'INVALID_ELAPSED_MS');
  requireValue(
    Array.isArray(trial.requiredChecks) &&
      trial.requiredChecks.length > 0 &&
      trial.requiredChecks.length <= 256 &&
      trial.requiredChecks.every(text) &&
      new Set(trial.requiredChecks).size === trial.requiredChecks.length,
    'INVALID_REQUIRED_CHECKS'
  );
  const checks = trial.checks ?? [];
  requireValue(Array.isArray(checks) && checks.length <= 256, 'INVALID_CHECKS');
  const seen = new Set();
  for (const check of checks) {
    object(
      check,
      [
        'id',
        'status',
        'receipt',
        'requirementsRevision',
        'inputRevision',
        'implementationRevision',
      ],
      'CHECK'
    );
    requireValue(text(check.id) && !seen.has(check.id), 'DUPLICATE_OR_INVALID_CHECK');
    requireValue(
      ['passed', 'failed', 'blocked', 'missing', 'timed-out'].includes(check.status),
      'INVALID_CHECK_STATUS'
    );
    seen.add(check.id);
  }
  const requiredChecks = [...trial.requiredChecks].sort();
  const acceptanceIssues = trial.status === 'verified' ? [] : [`TRIAL_${trial.status}`];
  for (const id of requiredChecks) {
    const check = checks.find((item) => item.id === id);
    if (
      !check ||
      check.status !== 'passed' ||
      !text(check.receipt) ||
      check.requirementsRevision !== trial.requirementsRevision ||
      check.inputRevision !== trial.inputRevision ||
      check.implementationRevision !== trial.implementationRevision
    ) {
      acceptanceIssues.push(`MISSING_FAILED_OR_STALE_CHECK:${id}`);
    }
  }
  return {
    ...trial,
    requiredChecks,
    checks,
    elapsedMs: trial.elapsedMs ?? null,
    usage: summarizeUsage(trial.usage),
    usageEntries: trial.usage?.entries ?? [],
    usageDeclaredComplete: trial.usage?.complete ?? false,
    accepted: acceptanceIssues.length === 0,
    acceptanceIssues,
  };
}

function cohortKey(trial) {
  return JSON.stringify([...MATCH_FIELDS.map((field) => trial[field]), trial.requiredChecks]);
}

function summarizeCohort(pairs) {
  const baseline = pairs.map((pair) => pair.baseline);
  const candidate = pairs.map((pair) => pair.candidate);
  const baselineAccepted = baseline.filter((trial) => trial.accepted).length;
  const candidateAccepted = candidate.filter((trial) => trial.accepted).length;
  const elapsedMs = {
    baseline: statistics(baseline.map((trial) => trial.elapsedMs)),
    candidate: statistics(candidate.map((trial) => trial.elapsedMs)),
  };
  const pairedElapsedDeltaMs = statistics(
    pairs.map((pair) =>
      pair.baseline.elapsedMs == null || pair.candidate.elapsedMs == null
        ? null
        : pair.candidate.elapsedMs - pair.baseline.elapsedMs
    )
  );
  const quality = {
    baselineAccepted,
    candidateAccepted,
    baselineAcceptanceRate: baselineAccepted / pairs.length,
    candidateAcceptanceRate: candidateAccepted / pairs.length,
    acceptanceRateDelta: (candidateAccepted - baselineAccepted) / pairs.length,
    regressions: pairs.filter((pair) => pair.baseline.accepted && !pair.candidate.accepted).length,
    improvements: pairs.filter((pair) => !pair.baseline.accepted && pair.candidate.accepted).length,
  };
  const observedMedianReductionFraction =
    elapsedMs.baseline.median > 0 && elapsedMs.candidate.median != null
      ? (elapsedMs.baseline.median - elapsedMs.candidate.median) / elapsedMs.baseline.median
      : null;
  const outcomes = Object.fromEntries(
    ['baseline', 'candidate'].map((variant) => [
      variant,
      Object.fromEntries(
        STATUSES.map((status) => [
          status,
          pairs.filter((pair) => pair[variant].status === status).length,
        ])
      ),
    ])
  );
  return {
    ...Object.fromEntries(MATCH_FIELDS.map((field) => [field, baseline[0][field]])),
    requiredChecks: baseline[0].requiredChecks,
    pairCount: pairs.length,
    pairIds: pairs.map((pair) => pair.baseline.pairId),
    outcomes,
    quality,
    elapsedMs,
    pairedElapsedDeltaMs,
    usage: { baseline: aggregateUsage(baseline), candidate: aggregateUsage(candidate) },
    observedMedianReductionFraction,
    observedTargetMet:
      observedMedianReductionFraction != null &&
      observedMedianReductionFraction >= 0.2 &&
      elapsedMs.candidate.p95 <= elapsedMs.baseline.p95 &&
      baselineAccepted === pairs.length &&
      candidateAccepted === pairs.length,
    uncertainty:
      'Descriptive matched sample only; standard error is not a significance test. Small samples and selection bias limit inference. Failure durations are not time to accepted success.',
  };
}

export function generateExecutionMetrics(input) {
  object(input, ['schemaVersion', 'revisions', 'trials'], 'INPUT');
  requireValue(input.schemaVersion === 1, 'UNSUPPORTED_SCHEMA_VERSION');
  object(input.revisions, ['baseline', 'candidate'], 'REVISIONS');
  requireValue(
    text(input.revisions.baseline) && text(input.revisions.candidate),
    'INVALID_REVISIONS'
  );
  requireValue(
    Array.isArray(input.trials) && input.trials.length <= MAX_TRIALS,
    'INVALID_TRIAL_COUNT'
  );
  const ids = new Set();
  const executions = new Set();
  const pairs = new Map();
  for (const raw of input.trials) {
    const trial = normalizeTrial(raw, input.revisions);
    requireValue(!ids.has(trial.trialId), 'DUPLICATE_TRIAL_ID');
    ids.add(trial.trialId);
    for (const entry of trial.usageEntries) {
      requireValue(!executions.has(entry.executionId), 'DUPLICATE_EXECUTION_ID');
      executions.add(entry.executionId);
      requireValue(executions.size <= 100000, 'TOO_MANY_USAGE_ENTRIES');
    }
    if (!pairs.has(trial.pairId)) pairs.set(trial.pairId, {});
    const pair = pairs.get(trial.pairId);
    requireValue(!pair[trial.variant], 'DUPLICATE_PAIR_VARIANT');
    pair[trial.variant] = trial;
  }
  const groups = new Map();
  const trials = [];
  for (const pairId of [...pairs.keys()].sort()) {
    const pair = pairs.get(pairId);
    requireValue(pair.baseline && pair.candidate, 'UNMATCHED_TRIAL');
    const key = cohortKey(pair.baseline);
    requireValue(key === cohortKey(pair.candidate), 'PAIR_MISMATCH');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pair);
    trials.push(pair.baseline, pair.candidate);
  }
  return {
    schemaVersion: 1,
    revisions: { ...input.revisions },
    trialCount: trials.length,
    pairCount: pairs.size,
    trials,
    cohorts: [...groups.keys()].sort().map((key) => summarizeCohort(groups.get(key))),
    nativeEvidenceAuthenticated: false,
    productSpeedClaimSupported: false,
    limitations: [
      'Synthetic and local-process results are not native product performance evidence.',
      'Native labels, revision tokens and receipt references are declarations, not authenticated host evidence or proof of parallel overlap.',
      'Observed targets are descriptive only. Native qualification, full-population completeness, independent review and existing release gates remain required.',
      'All supplied failed, blocked, timed-out, cancelled, stale and incomplete trials remain in denominators and usage totals.',
      'Unknown metrics are null. Reported partial usage is not a complete total; no pricing or savings is inferred.',
    ],
  };
}

function display(value) {
  return value == null ? 'UNKNOWN' : String(value).replace(/[|\r\n]/g, ' ');
}

export function formatMarkdown(report) {
  const lines = [
    '# Matched Execution Metrics',
    '',
    `Trials: ${report.trialCount}; matched pairs: ${report.pairCount}.`,
    'Product speed claim: not supported by this reporter. Native evidence is not authenticated.',
    '',
    '| Case | Surface | Evidence class | Pairs | Baseline median ms | Candidate median ms | Baseline accepted | Candidate accepted | Baseline total USD | Candidate total USD |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const cohort of report.cohorts) {
    lines.push(
      `| ${[
        cohort.caseId,
        cohort.surface,
        cohort.measurementClass,
        cohort.pairCount,
        cohort.elapsedMs.baseline.median,
        cohort.elapsedMs.candidate.median,
        cohort.quality.baselineAccepted,
        cohort.quality.candidateAccepted,
        cohort.usage.baseline.costUsd,
        cohort.usage.candidate.costUsd,
      ]
        .map(display)
        .join(' | ')} |`
    );
  }
  lines.push(
    '',
    '## Timing And Uncertainty',
    '',
    '| Case | Surface | Evidence class | Baseline p95 ms | Candidate p95 ms | Paired mean delta ms | Paired standard error ms | Quality regressions |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |'
  );
  for (const cohort of report.cohorts) {
    lines.push(
      `| ${[
        cohort.caseId,
        cohort.surface,
        cohort.measurementClass,
        cohort.elapsedMs.baseline.p95,
        cohort.elapsedMs.candidate.p95,
        cohort.pairedElapsedDeltaMs.mean,
        cohort.pairedElapsedDeltaMs.standardError,
        cohort.quality.regressions,
      ]
        .map(display)
        .join(' | ')} |`
    );
  }
  lines.push(
    '',
    'Deltas are candidate minus baseline. Statistics are descriptive, not significance tests; small samples limit inference. Failure durations are not time to accepted success.'
  );
  lines.push(
    '',
    '## Retained Trials',
    '',
    '| Trial | Arm | Status | Accepted | Elapsed ms | Total USD |',
    '| --- | --- | --- | --- | ---: | ---: |'
  );
  for (const trial of report.trials) {
    lines.push(
      `| ${[trial.trialId, trial.variant, trial.status, trial.accepted, trial.elapsedMs, trial.usage.costUsd].map(display).join(' | ')} |`
    );
  }
  lines.push(
    '',
    '## Limitations',
    '',
    ...report.limitations.map((item) => `- ${item}`),
    '- JSON contains complete cohort definitions, paired statistics, uncertainty, acceptance issues and reported partial usage.'
  );
  return lines.join('\n');
}

async function main(argv) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
    console.log(
      'Usage: node gofer-execution-metrics.mjs --input <trials.json|-> [--json]\nRead-only matched-trial report; - reads stdin. No native performance certification.'
    );
    return;
  }
  let inputPath;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--json' && !json) json = true;
    else if (argv[index] === '--input' && inputPath === undefined) {
      inputPath = argv[++index];
      requireValue(text(inputPath) && !inputPath.startsWith('--'), 'MISSING_INPUT_PATH');
    } else throw new Error('UNSUPPORTED_ARGUMENT');
  }
  requireValue(inputPath !== undefined, 'MISSING_INPUT_PATH');
  const stream = inputPath === '-' ? process.stdin : createReadStream(inputPath);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += Buffer.byteLength(chunk);
    requireValue(bytes <= MAX_BYTES, 'INPUT_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  const report = generateExecutionMetrics(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  console.log(json ? JSON.stringify(report, null, 2) : formatMarkdown(report));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Execution metrics error: ${error.message}`);
    process.exitCode = 1;
  });
}
