/**
 * Select a current model from authenticated host evidence. Static policy may
 * narrow permitted capabilities but never provides model identity or authority.
 */
import { capabilityReceiptHash, verifyCapabilityReceipt } from './gofer-host-capability.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0;
const list = value => Array.isArray(value) && value.every(text);
function validateAdvisoryConstraints(value) {
  const allowed = new Set(['reasoningEfforts', 'toolCapabilities', 'grantedPermissions',
    'isolationClass', 'maxCostUsd', 'maxDurationMs', 'minReliability']);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.has(key)) ||
      ['reasoningEfforts', 'toolCapabilities', 'grantedPermissions'].some(key =>
        value[key] !== undefined && !list(value[key])) ||
      (value.isolationClass !== undefined && !text(value.isolationClass)) ||
      ['maxCostUsd', 'maxDurationMs'].some(key => value[key] !== undefined &&
        (!Number.isFinite(value[key]) || value[key] < 0)) ||
      (value.minReliability !== undefined &&
        (!Number.isFinite(value.minReliability) || value.minReliability < 0 || value.minReliability > 1))) {
    throw new Error('UNSUPPORTED_ADVISORY_CONSTRAINT');
  }
}
function benchmarkResult(report, modelId, receiptHash) {
  if (report?.schemaVersion !== 2 || report.repetitions !== 3 ||
      report.provenance?.modelId !== modelId || report.provenance?.capabilityReceiptHash !== receiptHash ||
      !Number.isInteger(report.caseCount) || report.caseCount < 1 ||
      !Array.isArray(report.runs) || report.runs.length !== report.caseCount * 3) return null;
  const cases = new Map();
  const receipts = new Set();
  const verifierReceipts = new Set();
  let passes = 0;
  let costUsd = 0;
  let durationMs = 0;
  for (const run of report.runs) {
    if (run?.modelId !== modelId || !text(run.caseId) || ![1, 2, 3].includes(run.run) ||
        !text(run.inputHash) || !text(run.receipt) || !text(run.verifierReceipt) ||
        !text(run.verifierId) || !text(run.reviewReceipt) || !text(run.failureClassification) ||
        typeof run.functionalVerified !== 'boolean' || !Number.isFinite(run.costUsd) || run.costUsd < 0 ||
        !Number.isFinite(run.durationMs) || run.durationMs < 0 ||
        receipts.has(run.receipt) || verifierReceipts.has(run.verifierReceipt)) return null;
    receipts.add(run.receipt);
    verifierReceipts.add(run.verifierReceipt);
    const repetitions = cases.get(run.caseId) ?? new Set();
    if (repetitions.has(run.run)) return null;
    repetitions.add(run.run);
    cases.set(run.caseId, repetitions);
    if (run.functionalVerified) passes++;
    costUsd += run.costUsd;
    durationMs += run.durationMs;
  }
  if (cases.size !== report.caseCount || [...cases.values()].some(repetitions => repetitions.size !== 3) ||
      !Number.isFinite(report.reliability) || report.reliability < 0 || report.reliability > 1 ||
      !Number.isFinite(report.costUsd) || report.costUsd < 0 ||
      !Number.isFinite(report.durationMs) || report.durationMs < 0 ||
      report.functionalPasses !== passes || report.functionalRuns !== report.runs.length ||
      Math.abs(report.reliability - passes / report.runs.length) > 1e-12 ||
      Math.abs(report.costUsd - costUsd) > 1e-9 || report.durationMs !== durationMs ||
      report.status !== (passes === report.runs.length ? 'pass' : 'fail')) return null;
  return { modelId, receiptHash, functionalVerified: passes === report.runs.length,
    reliability: report.reliability, costUsd: report.costUsd, durationMs: report.durationMs };
}

export async function selectCapabilityRoute({ receipt, publicKey, host, requiredCapabilities = {},
  advisoryConstraints = {}, benchmarkEvidence, verifyBenchmark, now = Date.now() } = {}) {
  const { reasoningEfforts = [] } = requiredCapabilities;
  validateAdvisoryConstraints(advisoryConstraints);
  if (!verifyCapabilityReceipt(receipt, { publicKey, host, requiredCapabilities, now })) {
    throw new Error('LIVE_RECEIPT_REQUIRED');
  }
  if (['toolCapabilities', 'grantedPermissions'].some(key =>
    advisoryConstraints[key]?.some(value => !receipt[key].includes(value))) ||
    (advisoryConstraints.isolationClass !== undefined &&
      receipt.isolationClass !== advisoryConstraints.isolationClass)) {
    throw new Error('NO_LIVE_CAPABILITY_MATCH');
  }
  const reports = Array.isArray(benchmarkEvidence) ? benchmarkEvidence : [benchmarkEvidence];
  if (typeof verifyBenchmark !== 'function' || !reports.length ||
      reports.some(report => report?.schemaVersion !== 2)) {
    throw new Error('INDEPENDENT_BENCHMARK_REQUIRED');
  }
  const receiptHash = capabilityReceiptHash(receipt);
  const candidates = receipt.models.filter(model => {
    const requiredEfforts = reasoningEfforts;
    const permittedEfforts = advisoryConstraints.reasoningEfforts ?? requiredEfforts;
    return requiredEfforts.every(effort => model.reasoningEfforts?.includes(effort)) &&
      permittedEfforts.every(effort => model.reasoningEfforts?.includes(effort));
  });
  if (!candidates.length) throw new Error('NO_LIVE_CAPABILITY_MATCH');
  const verified = await verifyBenchmark({ host: receipt.host, receiptHash, evidence: benchmarkEvidence });
  if (verified?.valid !== true || verified.receiptHash !== receiptHash || !text(verified.receipt)) {
    throw new Error('INDEPENDENT_BENCHMARK_REQUIRED');
  }
  const scored = candidates.map(model => {
    const result = reports.map(report => benchmarkResult(report, model.id, receiptHash))
      .find(item => item?.functionalVerified === true);
    return { model, result };
  }).filter(item => item.result &&
    (advisoryConstraints.maxCostUsd === undefined || item.result.costUsd <= advisoryConstraints.maxCostUsd) &&
    (advisoryConstraints.minReliability === undefined || item.result.reliability >= advisoryConstraints.minReliability) &&
    (advisoryConstraints.maxDurationMs === undefined || item.result.durationMs <= advisoryConstraints.maxDurationMs));
  if (!scored.length) throw new Error('NO_VERIFIED_BENCHMARK_MATCH');
  scored.sort((left, right) => right.result.reliability - left.result.reliability ||
    left.result.costUsd - right.result.costUsd || left.model.id.localeCompare(right.model.id));
  const selected = scored[0];
  return Object.freeze({ host: receipt.host, model: { ...selected.model }, receiptHash,
    benchmarkReceipt: verified.receipt, benchmark: { ...selected.result },
    authority: 'live-capability-and-independent-benchmark', advisoryConstraints: { ...advisoryConstraints } });
}
