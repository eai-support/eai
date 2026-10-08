#!/usr/bin/env node
/**
 * Human-run ceremony that creates the benchmark verifier's signing key.
 *
 * It generates a fresh Ed25519 key, encrypts it with a passphrase you type,
 * and stores only the encrypted envelope. It never registers the key: trust
 * comes from a root-owned registry file that only an administrator can write,
 * so this tool prints the exact commands and changes nothing outside your
 * trust folder. Run it in a terminal yourself. Do not run it through an agent.
 */
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStrongPassphrase, encryptSigningKey } from './gofer-encrypted-key.mjs';
import { VERIFIER_EVALUATOR, accountTrustRoot, protectedVerifierRegistryPath } from './gofer-trusted-evaluator.mjs';
import { promptHidden } from './gofer-tty-prompt.mjs';

const denied = () => new Error('VERIFIER_KEY_CEREMONY_REQUIRES_REVIEW');
const shellQuote = value => `'${value.replaceAll("'", "'\"'\"'")}'`;

async function writeExclusive(filename, value) {
  const file = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
    constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(value, 'utf8'); await file.sync(); } finally { await file.close(); }
}

async function requireUninitializedRegistry(registryPath) {
  try {
    await lstat(registryPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw denied();
  }
  throw denied();
}

/** First-key setup only: an installed registry requires reviewed rotation. */
export async function runVerifierKeyCeremony({ trustRoot, getPassphrase, existingEntries,
  keyId = `heldout-verifier-${randomUUID()}`, registryPath = protectedVerifierRegistryPath() } = {}) {
  if (!path.isAbsolute(trustRoot ?? '') || typeof getPassphrase !== 'function' ||
      !path.isAbsolute(registryPath) || !/^[a-zA-Z0-9._-]{8,80}$/.test(keyId) ||
      existingEntries !== undefined) throw denied();
  await requireUninitializedRegistry(registryPath);
  const rootInfo = await lstat(trustRoot);
  if (!rootInfo.isDirectory() || rootInfo.uid !== process.getuid() || (rootInfo.mode & 0o077) !== 0) throw denied();
  const active = path.join(trustRoot, 'active-keys');
  await mkdir(active, { mode: 0o700, recursive: true });
  const activeInfo = await lstat(active);
  if (!activeInfo.isDirectory() || activeInfo.uid !== process.getuid() || (activeInfo.mode & 0o077) !== 0) throw denied();

  const passphrase = await getPassphrase('New verifier passphrase (12+ characters): ');
  assertStrongPassphrase(passphrase);
  if (passphrase !== await getPassphrase('Repeat the passphrase: ')) throw denied();
  await requireUninitializedRegistry(registryPath);

  const pair = generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const envelope = await encryptSigningKey(pair.privateKey, passphrase);
  // O_EXCL: an existing verifier identity is never replaced.
  await writeExclusive(path.join(active, 'heldout-verifier.private.enc.json'), `${JSON.stringify(envelope)}\n`);
  await writeExclusive(path.join(active, 'heldout-verifier.json'), `${JSON.stringify({ schemaVersion: 1,
    host: 'codex', evaluator: VERIFIER_EVALUATOR, keyId })}\n`);
  const pendingPath = path.join(trustRoot, 'verifier-registry.pending.json');
  const pendingBytes = `${JSON.stringify({ schemaVersion: 1, evaluators: [
    { keyId, host: 'codex', evaluator: VERIFIER_EVALUATOR, publicKeyPem }] }, null, 2)}\n`;
  await writeExclusive(pendingPath, pendingBytes);
  const pendingSha256 = createHash('sha256').update(pendingBytes, 'utf8').digest('hex');
  const directory = path.dirname(registryPath);
  const stageTemplate = path.join(directory, `${path.basename(registryPath)}.${keyId}.XXXXXX`);
  const installScript = [
    'set -eu',
    'PATH=/usr/bin:/bin; export PATH',
    `stage=$(mktemp ${shellQuote(stageTemplate)})`,
    `trap 'rm -f -- "$stage"' EXIT`,
    `install -o root -m 0600 ${shellQuote(pendingPath)} "$stage"`,
    // SECURITY: Check the root-owned copy against ceremony bytes, not the mutable pending file.
    'if command -v sha256sum >/dev/null 2>&1; then staged_hash=$(sha256sum < "$stage"); elif command -v shasum >/dev/null 2>&1; then staged_hash=$(shasum -a 256 < "$stage"); else exit 1; fi',
    `[ "\${staged_hash%% *}" = ${shellQuote(pendingSha256)} ]`,
    'chmod 0644 "$stage"',
    `link "$stage" ${shellQuote(registryPath)}`,
  ].join('; ');
  return Object.freeze({ keyId, publicKeyPem, pendingPath, installCommands: Object.freeze([
    `sudo /bin/mkdir -p ${shellQuote(directory)}`,
    `sudo /bin/sh -c ${shellQuote(installScript)}`,
  ]) });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.length !== 2) throw denied();
  runVerifierKeyCeremony({ trustRoot: accountTrustRoot(), getPassphrase: promptHidden })
    .then(result => {
      process.stdout.write(`\nVerifier key created (encrypted). Key id: ${result.keyId}\n\n` +
        'It is NOT trusted yet. An administrator must install the registry:\n\n' +
        `${result.installCommands.map(command => `  ${command}`).join('\n')}\n\n` +
        'Then delete the old plaintext verifier key, which a worker can read:\n\n' +
        '  rm ~/.eai-gofer-trust/staged-keys/heldout-verifier.private.pem\n');
    })
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
