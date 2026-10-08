#!/usr/bin/env node
/** Issue a live Codex receipt only with an activated local evaluator key. */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodexAppServerRuntime, evaluateNativeHost,
  verifyCapabilityReceipt } from './gofer-host-capability.mjs';
import { inspectEaiLocalIsolation } from './gofer-local-isolation.mjs';
import { loadActiveCodexEvaluatorKey,
  resolveTrustedEvaluatorPublicKey } from './gofer-trusted-evaluator.mjs';

/** Issue and verify a live Codex capability receipt for one workspace. This is
 * the same production path `main` exposes as a CLI, extracted so a runtime
 * composition root can call it directly instead of shelling out. */
// A benchmark result is bound to one exact receipt, so the receipt must outlive
// the benchmark, the signing step, and the routed run. The default of five
// minutes is far too short for that; callers may ask for up to six hours.
const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 6 * 60 * 60 * 1000;

export async function issueLocalCapabilityReceipt({ workspaceRoot, ttlMs }) {
  if (!path.isAbsolute(workspaceRoot)) throw new Error('TRUSTED_EVALUATOR_REQUIRED');
  if (ttlMs !== undefined && (!Number.isInteger(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS)) {
    throw new Error('RECEIPT_LIFETIME_OUT_OF_RANGE');
  }
  const isolation = await inspectEaiLocalIsolation({ host: 'codex', workspaceRoot });
  const session = await createCodexAppServerRuntime({ workspaceRoot,
    localIsolation: isolation }).inspect();
  let version;
  try {
    version = execFileSync(isolation.nativeExecutable, ['--version'],
      { encoding: 'utf8', timeout: 3000 }).trim();
  } catch { throw new Error('NATIVE_CODEX_CATALOG_REQUIRED'); }
  if (!version) throw new Error('NATIVE_CODEX_CATALOG_REQUIRED');
  // Finish every host subprocess before the private signing key enters memory.
  const { privateKey, keyId } = await loadActiveCodexEvaluatorKey({ workspaceRoot });
  const receipt = await evaluateNativeHost('codex', { signingKey: privateKey, keyId,
    ...(ttlMs === undefined ? {} : { ttlMs }),
    runtime: { inspect: async () => session },
    run: async ({ program, args: versionArgs }) => ({
      ok: program === 'codex' && versionArgs?.length === 1 && versionArgs[0] === '--version',
      version,
    }) });
  const publicKey = await resolveTrustedEvaluatorPublicKey(receipt, { workspaceRoot });
  if (!verifyCapabilityReceipt(receipt, { publicKey, host: 'codex',
    requiredCapabilities: { isolationClass: 'git-worktree+local-os-sandbox' } })) {
    throw new Error('TRUSTED_EVALUATOR_REQUIRED');
  }
  return receipt;
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node gofer-local-capability-issuer.mjs --workspace <absolute-task-worktree> [--ttl-minutes 1-360]\n');
    return;
  }
  const withLifetime = args.length === 4 && args[2] === '--ttl-minutes' && /^\d{1,3}$/.test(args[3]);
  if ((args.length !== 2 && !withLifetime) || args[0] !== '--workspace' || !path.isAbsolute(args[1])) {
    throw new Error('TRUSTED_EVALUATOR_REQUIRED');
  }
  const receipt = await issueLocalCapabilityReceipt({ workspaceRoot: args[1],
    ...(withLifetime ? { ttlMs: Number(args[3]) * 60 * 1000 } : {}) });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
