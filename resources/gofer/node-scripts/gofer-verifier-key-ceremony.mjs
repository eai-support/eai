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
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStrongPassphrase, encryptSigningKey } from './gofer-encrypted-key.mjs';
import { VERIFIER_EVALUATOR, accountTrustRoot, protectedVerifierRegistryPath } from './gofer-trusted-evaluator.mjs';
import { promptHidden } from './gofer-tty-prompt.mjs';

const denied = () => new Error('VERIFIER_KEY_CEREMONY_REQUIRES_REVIEW');

async function writeExclusive(filename, value) {
  const file = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
    constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(value, 'utf8'); await file.sync(); } finally { await file.close(); }
}

/** `existingEntries` are the entries already in the protected registry, so
 * the pending file replaces it without dropping earlier verifier keys. */
export async function runVerifierKeyCeremony({ trustRoot, getPassphrase, existingEntries = [],
  keyId = `heldout-verifier-${randomUUID()}`, registryPath = protectedVerifierRegistryPath() } = {}) {
  if (!path.isAbsolute(trustRoot ?? '') || typeof getPassphrase !== 'function' ||
      !/^[a-zA-Z0-9._-]{8,80}$/.test(keyId) || !Array.isArray(existingEntries) ||
      existingEntries.some(entry => entry?.evaluator !== VERIFIER_EVALUATOR || entry.keyId === keyId)) throw denied();
  const rootInfo = await lstat(trustRoot);
  if (!rootInfo.isDirectory() || rootInfo.uid !== process.getuid() || (rootInfo.mode & 0o077) !== 0) throw denied();
  const active = path.join(trustRoot, 'active-keys');
  await mkdir(active, { mode: 0o700, recursive: true });
  const activeInfo = await lstat(active);
  if (!activeInfo.isDirectory() || activeInfo.uid !== process.getuid() || (activeInfo.mode & 0o077) !== 0) throw denied();

  const passphrase = await getPassphrase('New verifier passphrase (12+ characters): ');
  assertStrongPassphrase(passphrase);
  if (passphrase !== await getPassphrase('Repeat the passphrase: ')) throw denied();

  const pair = generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const envelope = await encryptSigningKey(pair.privateKey, passphrase);
  // O_EXCL: an existing verifier identity is never replaced.
  await writeExclusive(path.join(active, 'heldout-verifier.private.enc.json'), `${JSON.stringify(envelope)}\n`);
  await writeExclusive(path.join(active, 'heldout-verifier.json'), `${JSON.stringify({ schemaVersion: 1,
    host: 'codex', evaluator: VERIFIER_EVALUATOR, keyId })}\n`);
  const pendingPath = path.join(trustRoot, 'verifier-registry.pending.json');
  await writeExclusive(pendingPath, `${JSON.stringify({ schemaVersion: 1, evaluators: [
    ...existingEntries, { keyId, host: 'codex', evaluator: VERIFIER_EVALUATOR, publicKeyPem }] }, null, 2)}\n`);
  const directory = path.dirname(registryPath);
  return Object.freeze({ keyId, publicKeyPem, pendingPath, installCommands: Object.freeze([
    `sudo mkdir -p "${directory}"`,
    `sudo install -o root -g wheel -m 0644 "${pendingPath}" "${registryPath}"`,
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
