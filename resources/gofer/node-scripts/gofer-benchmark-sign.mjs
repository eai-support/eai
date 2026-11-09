#!/usr/bin/env node
/**
 * Human-gated signing. It re-runs the protected checks itself, then asks for
 * the verifier passphrase at a terminal. It refuses to run without one, so an
 * agent, a script, or a worker cannot sign. Output is written once, private.
 */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signHeldOutBenchmarkAttestation } from './gofer-benchmark-signer.mjs';
import { resolveTrustedEvaluatorPublicKey } from './gofer-trusted-evaluator.mjs';
import { promptHidden } from './gofer-tty-prompt.mjs';

const denied = () => new Error('BENCHMARK_SIGN_COMMAND_REQUIRED');

export function parseSignArguments(argv) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!['--workspace-root', '--snapshot-id', '--capability-receipt', '--out', '--ttl-minutes'].includes(argv[index]) ||
        typeof argv[index + 1] !== 'string' || flags.has(argv[index])) throw denied();
    flags.set(argv[index], argv[index + 1]);
  }
  const args = { workspaceRoot: flags.get('--workspace-root'), snapshotId: flags.get('--snapshot-id'),
    receiptPath: flags.get('--capability-receipt'), out: flags.get('--out') };
  // Optional: how long the attestation stays valid. The signer allows up to 24
  // hours; this command allows up to 4, never more than a receipt's own life.
  const lifetime = flags.get('--ttl-minutes');
  if (lifetime !== undefined && (!/^\d{1,3}$/.test(lifetime) || Number(lifetime) < 1 || Number(lifetime) > 240)) throw denied();
  args.ttlMs = lifetime === undefined ? undefined : Number(lifetime) * 60 * 1000;
  if (flags.size !== (lifetime === undefined ? 4 : 5) || !path.isAbsolute(args.workspaceRoot) || !path.isAbsolute(args.receiptPath) ||
      !path.isAbsolute(args.out) || !/^[a-f0-9]{64}$/.test(args.snapshotId)) throw denied();
  return args;
}

async function main() {
  const args = parseSignArguments(process.argv.slice(2));
  // Checked first, before any work: a person must be at this terminal.
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('INTERACTIVE_TERMINAL_REQUIRED');
  const file = await open(args.receiptPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let capabilityReceipt;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 65536) throw denied();
    capabilityReceipt = JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
  const capabilityPublicKey = await resolveTrustedEvaluatorPublicKey(capabilityReceipt,
    { workspaceRoot: args.workspaceRoot });
  const signed = await signHeldOutBenchmarkAttestation({ workspaceRoot: args.workspaceRoot,
    capabilityReceipt, capabilityPublicKey, snapshotId: args.snapshotId,
    ...(args.ttlMs === undefined ? {} : { ttlMs: args.ttlMs }),
    getPassphrase: () => promptHidden('Verifier passphrase: ') });
  const out = await open(args.out, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
    constants.O_NOFOLLOW, 0o600);
  try { await out.writeFile(`${JSON.stringify({ attestation: signed.attestation, evidence: signed.evidence })}\n`); }
  finally { await out.close(); }
  process.stdout.write(`Signed ${signed.checks} re-run checks. Attestation written to ${args.out}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
