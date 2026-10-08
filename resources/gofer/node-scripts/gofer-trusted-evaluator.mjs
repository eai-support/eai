/** Read a locally provisioned evaluator key. The worker never chooses it. */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { loadHeldOutCorpus } from './gofer-heldout-corpus.mjs';
import { decryptSigningKey } from './gofer-encrypted-key.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0;
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const denied = () => new Error('TRUSTED_EVALUATOR_REQUIRED');

export function accountTrustRoot() {
  // HOME is caller-controlled. Resolve the account record by effective UID.
  if (process.platform === 'linux') {
    const uid = process.getuid();
    const record = execFileSync('/usr/bin/getent', ['passwd', String(uid)],
      { encoding: 'utf8', timeout: 3000 }).trim();
    const fields = record.split(':');
    const home = fields.length === 7 && fields[2] === String(uid) ? fields[5] : null;
    if (!home || !path.isAbsolute(home) || home.includes('\n')) throw denied();
    return path.join(home, '.eai-gofer-trust');
  }
  if (process.platform !== 'darwin') throw denied();
  const name = execFileSync('/usr/bin/id', ['-un'], { encoding: 'utf8', timeout: 3000 }).trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw denied();
  const record = execFileSync('/usr/bin/dscl', ['.', '-read', path.join(path.sep, 'Users', name), 'NFSHomeDirectory'],
    { encoding: 'utf8', timeout: 3000 }).trim();
  const home = /^NFSHomeDirectory: (\/[^\n]+)$/.exec(record)?.[1];
  if (!home) throw denied();
  return path.join(home, '.eai-gofer-trust');
}

// A directory handle stays bound to the inode it opened even if something
// later renames or replaces the path. Re-checking a path-based file open
// against the handle's device/inode closes the gap between validating a
// directory and reading a file inside it: a same-uid path substitution is
// detected instead of silently trusted.
async function assertSameDirectory(candidatePath, boundInfo) {
  const current = await lstat(candidatePath).catch(() => null);
  if (!current || current.dev !== boundInfo.dev || current.ino !== boundInfo.ino) throw denied();
}

async function inspectAccountTrustRoot(root, workspaceRoot) {
  if (!path.isAbsolute(root)) throw denied();
  const [workspace, parent] = await Promise.all([realpath(workspaceRoot), realpath(path.dirname(root))]);
  const parentInfo = await lstat(parent);
  const canonicalRoot = path.join(parent, path.basename(root));
  if (!parentInfo.isDirectory() || ![0, process.getuid()].includes(parentInfo.uid) ||
      (parentInfo.mode & 0o022) !== 0 || inside(workspace, canonicalRoot) ||
      inside(canonicalRoot, workspace)) throw denied();
  const handle = await open(canonicalRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const rootInfo = await handle.stat();
    if (!rootInfo.isDirectory() || rootInfo.uid !== process.getuid() ||
        (rootInfo.mode & 0o077) !== 0) throw denied();
    return { canonicalRoot, handle, info: rootInfo };
  } catch (err) { await handle.close(); throw err; }
}

// Open a file below a directory already validated by `inspectAccountTrustRoot`,
// re-confirming immediately beforehand that the directory path has not been
// substituted since that validation.
async function openVerifiedFile(directory, filename) {
  const filePath = path.join(directory.canonicalRoot, filename);
  const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await assertSameDirectory(directory.canonicalRoot, directory.info);
    return file;
  } catch (err) { await file.close(); throw err; }
}

export const VERIFIER_EVALUATOR = 'gofer-heldout-benchmark-verifier';

/** Verifier keys are trusted only from a root-owned registry. Anything the
 * account can write, an unsandboxed process in that account can also write. */
export function protectedVerifierRegistryPath() {
  if (process.platform === 'darwin') return '/Library/Application Support/EAI Gofer/verifier-registry.json';
  if (process.platform === 'linux') return '/etc/eai-gofer/verifier-registry.json';
  throw denied();
}

async function loadProtectedVerifierKey(receipt, { path: registryPath = protectedVerifierRegistryPath(),
  ownerUid = 0 } = {}) {
  try {
    if (!path.isAbsolute(registryPath) || !Number.isInteger(ownerUid)) throw denied();
    const parent = await realpath(path.dirname(registryPath));
    for (let current = parent; ;) {
      const info = await lstat(current);
      if (!info.isDirectory() || ![0, ownerUid].includes(info.uid) || (info.mode & 0o022) !== 0) throw denied();
      const above = path.dirname(current);
      if (above === current) break;
      current = above;
    }
    let registry;
    const file = await open(path.join(parent, path.basename(registryPath)),
      constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.uid !== ownerUid || info.nlink !== 1 ||
          (info.mode & 0o022) !== 0 || info.size < 2 || info.size > 65536) throw denied();
      registry = JSON.parse(await file.readFile('utf8'));
    } finally { await file.close(); }
    if (registry?.schemaVersion !== 1 || !Array.isArray(registry.evaluators) ||
        registry.evaluators.length < 1 || registry.evaluators.length > 32 ||
        registry.evaluators.some(item => !text(item?.keyId) || !text(item?.host) ||
          item.evaluator !== VERIFIER_EVALUATOR || !text(item?.publicKeyPem)) ||
        new Set(registry.evaluators.map(item => item.keyId)).size !== registry.evaluators.length) throw denied();
    const entry = registry.evaluators.find(item => item.keyId === receipt.provenance.keyId &&
      item.host === receipt.host);
    if (!entry) throw denied();
    const key = createPublicKey(entry.publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') throw denied();
    return key;
  } catch { throw denied(); }
}

/**
 * The default trust root is fixed outside the checkout. `trustRoot` exists for
 * isolated tests; the production composition root never accepts an override.
 */
export async function resolveTrustedEvaluatorPublicKey(receipt, { workspaceRoot, trustRoot, protectedRegistry } = {}) {
  if (process.platform === 'win32' || typeof process.getuid !== 'function' ||
      !text(workspaceRoot) || !text(receipt?.host) || !text(receipt?.provenance?.keyId) ||
      !text(receipt?.provenance?.evaluator)) throw denied();
  if (receipt.provenance.evaluator === VERIFIER_EVALUATOR) return loadProtectedVerifierKey(receipt, protectedRegistry);
  const root = trustRoot ?? accountTrustRoot();
  try {
    const directory = await inspectAccountTrustRoot(root, workspaceRoot);
    let registry;
    try {
      const file = await openVerifiedFile(directory, 'trusted-evaluators.json');
      try {
        const actual = await file.stat();
        if (!actual.isFile() || actual.uid !== process.getuid() ||
            (actual.mode & 0o077) !== 0 || actual.size < 2 || actual.size > 65536) throw denied();
        registry = JSON.parse(await file.readFile('utf8'));
      } finally { await file.close(); }
    } finally { await directory.handle.close(); }
    if (registry?.schemaVersion !== 1 || !Array.isArray(registry.evaluators) ||
        registry.evaluators.length < 1 || registry.evaluators.length > 32 ||
        registry.evaluators.some(item => !text(item?.keyId) || !text(item?.host) ||
          !text(item?.evaluator) || !text(item?.publicKeyPem)) ||
        new Set(registry.evaluators.map(item => item.keyId)).size !== registry.evaluators.length) throw denied();
    const entry = registry.evaluators.find(item => item.keyId === receipt.provenance.keyId &&
      item.host === receipt.host && item.evaluator === receipt.provenance.evaluator);
    if (!entry) throw denied();
    const key = createPublicKey(entry.publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') throw denied();
    return key;
  } catch { throw denied(); }
}

/** Only activated identities can sign. Production issuers never expose a
 * caller-selected trust root; the override is for isolated tests. */
async function loadActiveEvaluatorKey({ workspaceRoot, trustRoot, identityName, evaluator,
  getPassphrase, protectedRegistry } = {}) {
  if (!text(workspaceRoot) || process.platform === 'win32' || typeof process.getuid !== 'function') throw denied();
  const root = trustRoot ?? accountTrustRoot();
  try {
    const active = path.join(root, 'active-keys');
    const handle = await open(active, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    let identity, privateKey;
    try {
      const activeInfo = await handle.stat();
      if (!activeInfo.isDirectory() || activeInfo.uid !== process.getuid() ||
          (activeInfo.mode & 0o077) !== 0) throw denied();
      const directory = { canonicalRoot: active, handle, info: activeInfo };
      const identityFile = await openVerifiedFile(directory, `${identityName}.json`);
      try {
        const info = await identityFile.stat();
        if (!info.isFile() || info.uid !== process.getuid() ||
            (info.mode & 0o077) !== 0 || info.size < 2 || info.size > 4096) throw denied();
        identity = JSON.parse(await identityFile.readFile('utf8'));
      } finally { await identityFile.close(); }
      if (identity?.schemaVersion !== 1 || identity.host !== 'codex' ||
          identity.evaluator !== evaluator || !text(identity.keyId)) throw denied();
      const publicKey = await resolveTrustedEvaluatorPublicKey({ host: identity.host,
        provenance: { evaluator: identity.evaluator, keyId: identity.keyId } }, { workspaceRoot, trustRoot, protectedRegistry });
      if (evaluator === VERIFIER_EVALUATOR) {
        // A plaintext verifier key is readable by any worker. Only an
        // encrypted envelope, opened with a passphrase a person types, loads.
        if (typeof getPassphrase !== 'function') throw denied();
        const envelopeFile = await openVerifiedFile(directory, `${identityName}.private.enc.json`);
        let envelope;
        try {
          const info = await envelopeFile.stat();
          if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1 ||
              (info.mode & 0o077) !== 0 || info.size < 100 || info.size > 8192) throw denied();
          envelope = JSON.parse(await envelopeFile.readFile('utf8'));
        } finally { await envelopeFile.close(); }
        privateKey = await decryptSigningKey(envelope, await getPassphrase());
      } else {
        const privateFile = await openVerifiedFile(directory, `${identityName}.private.pem`);
        try {
          const info = await privateFile.stat();
          if (!info.isFile() || info.uid !== process.getuid() ||
              (info.mode & 0o077) !== 0 || info.size < 32 || info.size > 8192) throw denied();
          privateKey = createPrivateKey(await privateFile.readFile('utf8'));
        } finally { await privateFile.close(); }
      }
      if (privateKey.asymmetricKeyType !== 'ed25519' ||
          !createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
            .equals(publicKey.export({ type: 'spki', format: 'der' }))) throw denied();
    } finally { await handle.close(); }
    return Object.freeze({ privateKey, keyId: identity.keyId });
  } catch { throw denied(); }
}

export async function loadActiveCodexEvaluatorKey({ workspaceRoot, trustRoot } = {}) {
  return loadActiveEvaluatorKey({ workspaceRoot, trustRoot,
    identityName: 'codex-evaluator', evaluator: 'gofer-native-host-evaluator' });
}

export async function loadActiveBenchmarkVerifierKey({ workspaceRoot, trustRoot, getPassphrase,
  protectedRegistry } = {}) {
  return loadActiveEvaluatorKey({ workspaceRoot, trustRoot, getPassphrase, protectedRegistry,
    identityName: 'heldout-verifier', evaluator: VERIFIER_EVALUATOR });
}

/** The controller pins one corpus inside its account-owned trust root.
 * A worker cannot select a path or replace a pinned input through this API. */
export async function loadTrustedHeldOutCorpus({ workspaceRoot, trustRoot } = {}) {
  if (!text(workspaceRoot) || process.platform === 'win32' ||
      typeof process.getuid !== 'function') throw denied();
  const root = trustRoot ?? accountTrustRoot();
  try {
    const trustDirectory = await inspectAccountTrustRoot(root, workspaceRoot);
    let config;
    try {
      const configFile = await openVerifiedFile(trustDirectory, 'heldout-corpus.json');
      try {
        const info = await configFile.stat();
        if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1 ||
            (info.mode & 0o077) !== 0 || info.size < 2 || info.size > 4096) throw denied();
        config = JSON.parse(await configFile.readFile('utf8'));
      } finally { await configFile.close(); }
    } finally { await trustDirectory.handle.close(); }
    if (config?.schemaVersion !== 1 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(config.corpusId ?? '') ||
        !/^[a-f0-9]{64}$/.test(config.corpusHash ?? '')) throw denied();
    const corpora = path.join(trustDirectory.canonicalRoot, 'corpora');
    const corpusRoot = path.join(corpora, config.corpusId);
    for (const directory of [corpora, corpusRoot]) {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.uid !== process.getuid() ||
          (info.mode & 0o077) !== 0) throw denied();
    }
    const manifestFile = await open(path.join(corpusRoot, 'manifest.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW);
    let manifest;
    try {
      const info = await manifestFile.stat();
      if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1 ||
          (info.mode & 0o077) !== 0 || info.size < 2 || info.size > 65536) throw denied();
      manifest = JSON.parse(await manifestFile.readFile('utf8'));
    } finally { await manifestFile.close(); }
    if (!Array.isArray(manifest?.cases) ||
        createHash('sha256').update(JSON.stringify(manifest)).digest('hex') !== config.corpusHash) throw denied();
    for (const name of manifest.cases.map(item => item?.inputFile)) {
      if (!text(name) || name === '.' || name === '..' || name.includes('/') ||
          name.includes('\\')) throw denied();
      const info = await lstat(path.join(corpusRoot, name));
      if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1 ||
          (info.mode & 0o077) !== 0) throw denied();
    }
    const corpus = await loadHeldOutCorpus({ corpusRoot, workspaceRoot });
    if (corpus.corpusHash !== config.corpusHash) throw denied();
    return Object.freeze({ ...corpus, corpusRoot });
  } catch { throw denied(); }
}
