/** Authenticate a held-out benchmark report before it can govern routing. */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { resolveTrustedEvaluatorPublicKey } from './gofer-trusted-evaluator.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const denied = () => new Error('TRUSTED_BENCHMARK_REQUIRED');
const VERIFIER = 'gofer-heldout-benchmark-verifier';
const digest = value => /^[a-f0-9]{64}$/.test(value ?? '');
const nonnegative = value => Number.isFinite(value) && value >= 0;
const wilson95 = (passes, total) => {
  const z = 1.96;
  const p = passes / total;
  const denominator = 1 + z ** 2 / total;
  const centre = (p + z ** 2 / (2 * total)) / denominator;
  const spread = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * total)) / total) / denominator;
  return { lower: Math.max(0, centre - spread), upper: Math.min(1, centre + spread) };
};

function validReport(report, receiptHash) {
  if (report?.schemaVersion !== 2 || report.repetitions !== 3 ||
      !Number.isInteger(report.caseCount) || report.caseCount < 4 ||
      !Array.isArray(report.runs) || report.runs.length !== report.caseCount * 3 ||
      !text(report.provenance?.harnessId) || !text(report.provenance?.modelId) ||
      !digest(report.provenance?.corpusHash) ||
      report.provenance?.capabilityReceiptHash !== receiptHash) return false;
  const seen = new Set();
  const executions = new Set();
  const verifications = new Set();
  let passes = 0;
  let cost = 0;
  let duration = 0;
  for (const run of report.runs) {
    const pair = `${run?.caseId}:${run?.run}`;
    if (!text(run?.caseId) || !Number.isInteger(run.run) || run.run < 1 || run.run > 3 ||
        seen.has(pair) || run.modelId !== report.provenance.modelId ||
        !nonnegative(run.costUsd) || !nonnegative(run.durationMs) ||
        !digest(run.receipt) || !digest(run.inputHash) || !digest(run.verifierReceipt) ||
        !digest(run.reviewReceipt) || !text(run.verifierId) ||
        !text(run.failureClassification) || typeof run.functionalVerified !== 'boolean' ||
        executions.has(run.receipt) || verifications.has(run.verifierReceipt)) return false;
    seen.add(pair);
    executions.add(run.receipt);
    verifications.add(run.verifierReceipt);
    passes += Number(run.functionalVerified);
    cost += run.costUsd;
    duration += run.durationMs;
  }
  const cases = new Set(report.runs.map(run => run.caseId));
  if (cases.size !== report.caseCount ||
      [...cases].some(id => [1, 2, 3].some(run => !seen.has(`${id}:${run}`)))) return false;
  const reliability = passes / report.runs.length;
  const interval = report.confidenceInterval;
  const expectedInterval = wilson95(passes, report.runs.length);
  return report.functionalPasses === passes && report.functionalRuns === report.runs.length &&
    Math.abs(report.reliability - reliability) < 1e-12 &&
    Math.abs(report.costUsd - cost) < 1e-9 && report.durationMs === duration &&
    report.status === (passes === report.runs.length ? 'pass' : 'fail') &&
    interval?.level === 0.95 &&
    Math.abs(interval.lower - expectedInterval.lower) < 1e-12 &&
    Math.abs(interval.upper - expectedInterval.upper) < 1e-12;
}

/**
 * A signed attestation binds all report fields, including every run verdict,
 * cost, review receipt, and provenance field. Only a separately registered
 * verifier key may authorize this evidence for the native runtime.
 */
export async function verifyTrustedBenchmarkEvidence({ host, receiptHash, evidence,
  attestation, capabilityKeyId, capabilityPublicKey, workspaceRoot, now = Date.now() } = {}) {
  if (!text(host) || !/^[a-f0-9]{64}$/.test(receiptHash ?? '') || !text(capabilityKeyId) ||
      !capabilityPublicKey || !text(workspaceRoot) || !Number.isFinite(now) || !attestation ||
      attestation.schemaVersion !== 1 || attestation.host !== host ||
      attestation.capabilityReceiptHash !== receiptHash ||
      attestation.verification !== 'functional-tests+independent-review' ||
      !text(attestation.verifierVersion) || attestation.provenance?.evaluator !== VERIFIER ||
      !text(attestation.provenance?.keyId) || attestation.provenance.keyId === capabilityKeyId ||
      !text(attestation.provenance?.source) || attestation.signature?.algorithm !== 'ed25519' ||
      attestation.signature.keyId !== attestation.provenance.keyId ||
      !/^[A-Za-z0-9_-]+$/.test(attestation.signature.value ?? '')) throw denied();
  const verifiedAt = Date.parse(attestation.verifiedAt);
  const expiresAt = Date.parse(attestation.expiresAt);
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(expiresAt) ||
      verifiedAt > now || expiresAt <= now || expiresAt <= verifiedAt) throw denied();
  let bytes;
  try { bytes = JSON.stringify(evidence); } catch { throw denied(); }
  const reports = Array.isArray(evidence) ? evidence : [evidence];
  if (!reports.length || !reports.every(report => validReport(report, receiptHash)) ||
      attestation.evidenceHash !== sha256(bytes)) throw denied();
  const { signature, ...payload } = attestation;
  const publicKey = await resolveTrustedEvaluatorPublicKey(attestation,
    { workspaceRoot }).catch(() => { throw denied(); });
  try {
    const capabilityKey = capabilityPublicKey?.type === 'public'
      ? capabilityPublicKey : createPublicKey(capabilityPublicKey);
    if (publicKey.export({ type: 'spki', format: 'der' }).equals(
      capabilityKey.export({ type: 'spki', format: 'der' }))) throw denied();
  } catch { throw denied(); }
  if (!verify(null, Buffer.from(JSON.stringify(payload)), publicKey,
    Buffer.from(signature.value, 'base64url'))) throw denied();
  return Object.freeze({ valid: true, receiptHash, receipt: `benchmark:${sha256(JSON.stringify(attestation))}` });
}
