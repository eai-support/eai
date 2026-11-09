#!/usr/bin/env node
/** Prepare the local capability identity without granting it runtime authority. */
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const denied = () => new Error('LOCAL_TRUST_SETUP_REQUIRES_REVIEW');

function accountHome() {
  if (typeof process.getuid !== 'function') throw denied();
  if (process.platform === 'darwin') {
    const name = execFileSync('/usr/bin/id', ['-un'], { encoding: 'utf8', timeout: 3000 }).trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw denied();
    const record = execFileSync('/usr/bin/dscl', ['.', '-read', path.join(path.sep, 'Users', name), 'NFSHomeDirectory'],
      { encoding: 'utf8', timeout: 3000 }).trim();
    return /^NFSHomeDirectory: (\/[^\n]+)$/.exec(record)?.[1] ?? null;
  }
  if (process.platform === 'linux') {
    const record = execFileSync('/usr/bin/getent', ['passwd', String(process.getuid())],
      { encoding: 'utf8', timeout: 3000 }).trim().split(':');
    return record.length === 7 && record[2] === String(process.getuid()) ? record[5] : null;
  }
  throw denied();
}

async function writeExclusive(filename, value) {
  const file = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(value, 'utf8'); }
  finally { await file.close(); }
}

/** Used by trusted setup only. Existing material is never replaced or activated. */
export async function initializeStagedTrust(root) {
  if (!path.isAbsolute(root)) throw denied();
  const parent = await realpath(path.dirname(root));
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || ![0, process.getuid()].includes(parentInfo.uid) ||
      (parentInfo.mode & 0o022) !== 0 || parent !== path.dirname(root)) throw denied();
  await mkdir(root, { mode: 0o700 });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.uid !== process.getuid() ||
      (rootInfo.mode & 0o077) !== 0) throw denied();
  const staged = path.join(root, 'staged-keys');
  await mkdir(staged, { mode: 0o700 });
  // The benchmark verifier key is not staged here. A worker sandbox can read
  // the account home, so a plaintext verifier key would be forgeable. It is
  // created, encrypted, by the human-run gofer-verifier-key-ceremony.mjs.
  const identities = [
    { name: 'capability-evaluator', host: 'codex', evaluator: 'gofer-native-host-evaluator' },
  ];
  const records = [];
  for (const identity of identities) {
    const pair = generateKeyPairSync('ed25519');
    const keyId = `${identity.name}-${randomUUID()}`;
    await writeExclusive(path.join(staged, `${identity.name}.private.pem`),
      pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await writeExclusive(path.join(staged, `${identity.name}.public.pem`),
      pair.publicKey.export({ type: 'spki', format: 'pem' }));
    records.push({ ...identity, keyId });
  }
  await writeExclusive(path.join(root, 'trusted-evaluators.json'),
    `${JSON.stringify({ schemaVersion: 1, evaluators: [] }, null, 2)}\n`);
  await writeExclusive(path.join(staged, 'identities.json'), `${JSON.stringify(records, null, 2)}\n`);
  return { root, identities: records.map(({ name, keyId }) => ({ name, keyId })), active: false };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.length !== 2) throw denied();
  const home = accountHome();
  if (!home || !path.isAbsolute(home)) throw denied();
  initializeStagedTrust(path.join(home, '.eai-gofer-trust'))
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
