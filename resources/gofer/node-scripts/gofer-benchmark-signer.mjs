/**
 * Sign a held-out benchmark attestation only after this process has re-run
 * every case itself. The executor's saved verdicts are never trusted: the
 * signer re-executes each protected check in the offline sandbox against the
 * captured bytes, and binds the signature to the exact report it rechecked.
 * It never activates a key. An inactive or unregistered key fails closed.
 */
import { createHash, createPublicKey, sign } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { capabilityReceiptHash } from './gofer-host-capability.mjs';
import { recheckHeldOutSnapshot } from './gofer-heldout-verifier.mjs';
import { materializeHeldOutResultSnapshot } from './gofer-heldout-snapshot.mjs';
import { loadActiveBenchmarkVerifierKey, loadTrustedHeldOutCorpus,
  resolveTrustedEvaluatorPublicKey } from './gofer-trusted-evaluator.mjs';
import { verifyTrustedBenchmarkEvidence } from './gofer-trusted-benchmark.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0;
const sha = value => createHash('sha256').update(value).digest('hex');
const denied = () => new Error('BENCHMARK_SIGNER_REQUIRED');
const EVALUATOR = 'gofer-heldout-benchmark-verifier';
const VERIFIER_VERSION = '1';
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * `trustRoot` exists for isolated tests. The production composition root never
 * passes it and always resolves the fixed account trust root.
 */
export async function signHeldOutBenchmarkAttestation({ workspaceRoot, trustRoot,
  capabilityReceipt, capabilityPublicKey, snapshotId, getPassphrase, protectedRegistry,
  ttlMs = DEFAULT_TTL_MS, now = Date.now() } = {}) {
  let materialized;
  try {
    if (!text(workspaceRoot) || !path.isAbsolute(workspaceRoot) ||
        capabilityReceipt?.host !== 'codex' || !text(capabilityReceipt?.provenance?.keyId) ||
        !/^[a-f0-9]{64}$/.test(snapshotId ?? '') || !Number.isFinite(now) ||
        !Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS) throw denied();
    const receiptHash = capabilityReceiptHash(capabilityReceipt);
    const corpus = await loadTrustedHeldOutCorpus({ workspaceRoot, trustRoot });
    const corpusTrustRoot = path.dirname(path.dirname(corpus.corpusRoot));

    // The signing identity must exist and be active before any work is done.
    const signer = await loadActiveBenchmarkVerifierKey({ workspaceRoot, trustRoot, getPassphrase,
      protectedRegistry });
    if (signer.keyId === capabilityReceipt.provenance.keyId) throw denied();
    const signerPublicKey = await resolveTrustedEvaluatorPublicKey({ host: 'codex',
      provenance: { evaluator: EVALUATOR, keyId: signer.keyId } }, { workspaceRoot, trustRoot, protectedRegistry });
    const capabilityKey = capabilityPublicKey?.type === 'public'
      ? capabilityPublicKey : createPublicKey(capabilityPublicKey);
    if (signerPublicKey.export({ type: 'spki', format: 'der' })
      .equals(capabilityKey.export({ type: 'spki', format: 'der' }))) throw denied();

    // Independent re-execution. Any disagreement with the saved verdicts throws.
    const recheck = await recheckHeldOutSnapshot({ corpusRoot: corpus.corpusRoot,
      workspaceRoot, trustRoot: corpusTrustRoot, snapshotId });
    if (recheck.corpusHash !== corpus.corpusHash ||
        recheck.functionalPasses !== recheck.functionalRuns) throw denied();

    materialized = await materializeHeldOutResultSnapshot({ trustRoot: corpusTrustRoot,
      workspaceRoot, snapshotId });
    const saved = JSON.parse(await readFile(path.join(materialized.root, 'receipts',
      'benchmark-report.json'), 'utf8'));
    const evidence = saved?.report;
    // The signature binds the exact report the sandbox just rechecked.
    if (!evidence || sha(JSON.stringify(evidence)) !== recheck.reportHash ||
        evidence.provenance?.capabilityReceiptHash !== receiptHash ||
        evidence.provenance?.corpusHash !== corpus.corpusHash) throw denied();

    const payload = { schemaVersion: 1, host: 'codex', capabilityReceiptHash: receiptHash,
      evidenceHash: sha(JSON.stringify(evidence)),
      verification: 'functional-tests+independent-review', verifierVersion: VERIFIER_VERSION,
      verifiedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString(),
      provenance: { evaluator: EVALUATOR, keyId: signer.keyId,
        source: `heldout-snapshot:${snapshotId}` } };
    const attestation = { ...payload, signature: { algorithm: 'ed25519', keyId: signer.keyId,
      value: sign(null, Buffer.from(JSON.stringify(payload)), signer.privateKey)
        .toString('base64url') } };

    // The consumer must accept exactly what was signed, or nothing is returned.
    const verified = await verifyTrustedBenchmarkEvidence({ host: 'codex', receiptHash,
      evidence, attestation, capabilityKeyId: capabilityReceipt.provenance.keyId,
      capabilityPublicKey: capabilityKey, workspaceRoot, now });
    if (verified?.valid !== true) throw denied();
    return Object.freeze({ attestation, evidence, verification: verified,
      snapshotId, checks: recheck.functionalRuns });
  } catch { throw denied(); }
  finally { if (materialized) await rm(materialized.root, { recursive: true, force: true }); }
}
