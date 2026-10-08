#!/usr/bin/env node

import { constants } from 'fs';
import { promises as fs } from 'fs';
import { execFile, spawn } from 'child_process';
import path from 'path';
import process from 'process';
import { promisify } from 'util';

const SECRET_RELATIVE_PATH = path.join('.specify', 'secrets', 'typesafe.env');
const POLICY_RELATIVE_PATHS = [
  path.join('.specify', 'config', 'typesafe-semantic-review.json'),
  path.join('.specify', 'config', 'typesafe-learning-review.json'),
];
const KEYCHAIN_SERVICE = 'com.enterpriseai.gofer.jev';
const KEYCHAIN_ACCOUNT = 'shared-api-key';
const execFileAsync = promisify(execFile);

export function parseArgs(argv) {
  const action = argv.find((value) => value === '--connect' || value === '--disconnect' || value === '--status');
  const scopeIndex = argv.indexOf('--scope');
  const scope = scopeIndex === -1 ? (process.platform === 'darwin' ? 'shared' : 'project') : argv[scopeIndex + 1];
  const expectedLength = scopeIndex === -1 ? 1 : 3;
  if (!action || argv.length !== expectedLength || !['project', 'shared'].includes(scope)) {
    throw new Error('Usage: --connect | --disconnect | --status [--scope project|shared]');
  }
  if (action === '--status' && scopeIndex !== -1) {
    throw new Error('--status reports the effective credential and does not accept --scope.');
  }
  return { action: action.slice(2), scope };
}

const macOSKeychain = {
  async has() {
    if (process.platform !== 'darwin') return false;
    try {
      await execFileAsync('/usr/bin/security', [
        'find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE,
      ], { encoding: 'utf8', maxBuffer: 64 * 1024 });
      return true;
    } catch (error) {
      if (error?.code === 44 || error?.stderr?.includes('could not be found')) return false;
      throw new Error('Gofer could not check the shared Jev credential in macOS Keychain.');
    }
  },
  async read() {
    if (process.platform !== 'darwin') return '';
    try {
      const { stdout } = await execFileAsync('/usr/bin/security', [
        'find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE, '-w',
      ], { encoding: 'utf8', maxBuffer: 64 * 1024 });
      return String(stdout).trim();
    } catch (error) {
      if (error?.code === 44 || error?.stderr?.includes('could not be found')) return '';
      throw new Error('Gofer could not read the shared Jev credential from macOS Keychain.');
    }
  },
  async write(key) {
    if (process.platform !== 'darwin') throw new Error('Shared Jev credentials require macOS Keychain.');
    const encoded = Buffer.from(String(key), 'utf8').toString('hex');
    const child = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8');
    });
    child.stdin.end(
      `add-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${KEYCHAIN_SERVICE}" ` +
      `-l "EAI Gofer Jev API key" -U -X ${encoded}\n`
    );
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code));
    });
    if (exitCode !== 0 || stderr.includes('SecKeychainItem')) {
      throw new Error('macOS Keychain did not save the shared Jev credential.');
    }
  },
  async remove() {
    if (process.platform !== 'darwin') return false;
    try {
      await execFileAsync('/usr/bin/security', [
        'delete-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE,
      ]);
      return true;
    } catch (error) {
      if (error?.code === 44 || error?.stderr?.includes('could not be found')) return false;
      throw new Error('Gofer could not remove the shared Jev credential from macOS Keychain.');
    }
  },
};

// A lexical check alone does not stop a symlinked intermediate directory
// (e.g. .specify/secrets) from redirecting the confined path outside the
// workspace. Walk every component from the workspace root and reject any
// that is a symlink, matching gofer-surface-update.mjs's existing check.
async function assertNoSymlinkComponents(root, relativeTarget) {
  const components = relativeTarget.split(path.sep).filter(Boolean);
  let currentPath = root;
  for (const component of components) {
    currentPath = path.join(currentPath, component);
    try {
      const status = await fs.lstat(currentPath);
      if (status.isSymbolicLink()) {
        throw new Error('Gofer credential path must not pass through a symbolic link.');
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

// assertNoSymlinkComponents only walks descendants of root; it never checks
// root itself. A caller-supplied workspace that is a symlink (or missing, or
// not a directory) would otherwise sail through every confinement check
// below it. Matches workspace-bootstrap-lib.mjs's assertSafeWorkspaceRoot.
async function assertSafeWorkspaceRoot(workspaceRoot) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const rootStat = await fs.lstat(resolvedRoot).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!rootStat) throw new Error('Gofer workspace root does not exist.');
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Gofer workspace root must be a real directory, not a symbolic link.');
  }
  return resolvedRoot;
}

async function confinedPath(workspace, relativePath) {
  const root = await assertSafeWorkspaceRoot(workspace);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Gofer credential path must remain inside the workspace.');
  }
  await assertNoSymlinkComponents(root, relative);
  return target;
}

async function existingFile(target) {
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Gofer credential path must be a regular file.');
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

// O_NOFOLLOW is unavailable on Windows; the bitwise OR silently contributes
// nothing there rather than erroring. lstat detects a symlink or junction
// cross-platform (including Windows) and is the actual protection;
// O_NOFOLLOW only closes the small remaining gap between that check and the
// open, on platforms that support it.
const noFollowFlag = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
function sameIdentity(left, right) {
  if (left.dev === undefined || left.ino === undefined ||
      right.dev === undefined || right.ino === undefined) return true;
  return left.dev === right.dev && left.ino === right.ino;
}

async function withVerifiedParent(target, action) {
  const parent = path.dirname(target);
  const parentHandle = await fs.open(parent,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollowFlag);
  const openedParent = await parentHandle.stat();
  try {
    const currentParent = await fs.lstat(parent);
    if (!openedParent.isDirectory() || currentParent.isSymbolicLink() ||
        !sameIdentity(openedParent, currentParent)) {
      throw new Error('Gofer credential parent directory changed during access.');
    }
    const result = await action();
    const parentAfter = await fs.lstat(parent);
    if (parentAfter.isSymbolicLink() || !sameIdentity(openedParent, parentAfter)) {
      throw new Error('Gofer credential parent directory changed during access.');
    }
    return result;
  } finally {
    await parentHandle.close();
  }
}

async function assertNotSymlink(target) {
  const info = await fs.lstat(target).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (info?.isSymbolicLink()) throw new Error('Gofer credential path must not be a symbolic link.');
}

// The static confinement check happens before the caller ever opens the file;
// a same-account process could still swap a symlink in between. The lstat
// check immediately before opening, plus O_NOFOLLOW where available, closes
// that window instead of merely trusting the earlier confinedPath check.
async function readNoFollow(target) {
  return withVerifiedParent(target, async () => {
    await assertNotSymlink(target);
    const handle = await fs.open(target, constants.O_RDONLY | noFollowFlag);
    try {
      const opened = await handle.stat();
      const current = await fs.lstat(target);
      if (!opened.isFile() || current.isSymbolicLink() || !sameIdentity(opened, current)) {
        throw new Error('Gofer credential path must be a stable regular file.');
      }
      return await handle.readFile('utf8');
    } finally { await handle.close(); }
  });
}

async function writeNoFollow(target, content, mode) {
  return withVerifiedParent(target, async () => {
    await assertNotSymlink(target);
    const handle = await fs.open(target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollowFlag, mode);
    try {
      const opened = await handle.stat();
      const current = await fs.lstat(target);
      if (!opened.isFile() || current.isSymbolicLink() || !sameIdentity(opened, current)) {
        throw new Error('Gofer credential path must be a stable regular file.');
      }
      await handle.writeFile(content);
      await handle.sync();
    } finally { await handle.close(); }
  });
}

async function unlinkNoFollow(target) {
  return withVerifiedParent(target, async () => {
    const before = await fs.lstat(target);
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new Error('Gofer credential path must be a regular file.');
    }
    await fs.unlink(target);
  });
}

async function ensurePrivateParent(target) {
  const parent = path.dirname(target);
  const grandparent = path.dirname(parent);
  const grandparentHandle = await fs.open(grandparent,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollowFlag);
  const openedGrandparent = await grandparentHandle.stat();
  try {
    const currentGrandparent = await fs.lstat(grandparent);
    if (!openedGrandparent.isDirectory() || currentGrandparent.isSymbolicLink() ||
        !sameIdentity(openedGrandparent, currentGrandparent)) {
      throw new Error('Gofer credential parent directory changed during setup.');
    }
    await fs.mkdir(parent, { mode: 0o700 }).catch((error) => {
      if (error?.code !== 'EEXIST') throw error;
    });
    const parentHandle = await fs.open(parent,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollowFlag);
    try {
      const openedParent = await parentHandle.stat();
      const [parentCurrent, grandparentAfter] = await Promise.all([
        fs.lstat(parent),
        fs.lstat(grandparent),
      ]);
      if (!openedParent.isDirectory() || parentCurrent.isSymbolicLink() ||
          !sameIdentity(openedParent, parentCurrent) || grandparentAfter.isSymbolicLink() ||
          !sameIdentity(openedGrandparent, grandparentAfter)) {
        throw new Error('Gofer credential parent directory changed during setup.');
      }
      await parentHandle.chmod(0o700);
    } finally {
      await parentHandle.close();
    }
  } finally {
    await grandparentHandle.close();
  }
}

async function readSecretFile(secretPath) {
  if (!(await existingFile(secretPath))) return '';
  const match = (await readNoFollow(secretPath)).match(/^TYPESAFE_API_KEY=([^\r\n]+)$/m);
  return match?.[1]?.trim() || '';
}

async function writePolicyEnabled(workspace, enabled) {
  for (const relativePath of POLICY_RELATIVE_PATHS) {
    const policyPath = await confinedPath(workspace, relativePath);
    // Older Gofer workspaces have only the semantic-review policy. Keep
    // connect/disconnect compatible until workspace bootstrap adds the
    // reviewed-learning policy.
    if (!(await existingFile(policyPath))) continue;
    const current = JSON.parse(await readNoFollow(policyPath));
    current.enabled = enabled;
    await writeNoFollow(policyPath, `${JSON.stringify(current, null, 2)}\n`, 0o600);
  }
}

async function promptForKey() {
  if (!process.stdin.isTTY) throw new Error('Set TYPESAFE_API_KEY, then run --connect from an interactive terminal.');
  process.stdout.write('TypeSafe API key: ');
  const key = await new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (chunk) => {
      const character = chunk.toString('utf8');
      if (character === '\r' || character === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve(value);
      } else if (character === '\u0003') {
        process.stdin.setRawMode(false);
        reject(new Error('Credential setup cancelled.'));
      } else if (character === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += character;
      }
    });
  });
  return String(key).trim();
}

export async function credentialStatus({ workspace = process.cwd(), env = process.env, keychain = macOSKeychain } = {}) {
  const { source } = await resolveApiKey({ workspace, env, keychain });
  return {
    configured: source !== 'none',
    source,
    secretPath: source === 'project_secret_file' ? SECRET_RELATIVE_PATH : null,
    sharedAcrossLocalWorkspaces: source === 'macos_keychain',
  };
}

export async function resolveApiKey({ workspace = process.cwd(), env = process.env, keychain = macOSKeychain } = {}) {
  const environmentKey = String(env.TYPESAFE_API_KEY || '').trim();
  if (environmentKey) return { apiKey: environmentKey, source: 'environment' };
  const fileKey = await readSecretFile(await confinedPath(workspace, SECRET_RELATIVE_PATH));
  if (fileKey) return { apiKey: fileKey, source: 'project_secret_file' };
  if (env.GOFER_DISABLE_SHARED_CREDENTIALS !== '1') {
    const sharedKey = String(await keychain.read()).trim();
    if (sharedKey) return { apiKey: sharedKey, source: 'macos_keychain' };
  }
  return { apiKey: '', source: 'none' };
}

export async function sharedCredentialConfigured({ keychain = macOSKeychain } = {}) {
  return keychain.has();
}

export async function requestTypeSafeEvaluation({ workspace, env = process.env, fetchImpl = globalThis.fetch, policy, projection, rubric, keychain = macOSKeychain }) {
  const { apiKey, source } = await resolveApiKey({ workspace, env, keychain });
  if (!apiKey) return { status: 'not_configured', networkCalled: false };
  let response;
  try {
    response = await fetchImpl(policy.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(policy.timeoutMs),
      body: JSON.stringify({ model: policy.model, state: JSON.stringify(projection), questions: rubric }),
    });
  } catch (error) {
    return {
      status: 'unavailable',
      networkCalled: true,
      reason: ['AbortError', 'TimeoutError'].includes(error?.name) ? 'timeout' : 'network_error',
    };
  }
  if (!response.ok) return { status: 'unavailable', networkCalled: true, httpStatus: response.status };
  try {
    if (!response.body?.getReader) throw new Error('response body is not streamable');
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) {
        await reader.cancel('response too large');
        throw new Error('response too large');
      }
      chunks.push(Buffer.from(value));
    }
    const raw = Buffer.concat(chunks, bytes).toString('utf8');
    return { status: 'received', networkCalled: true, credentialSource: source, payload: JSON.parse(raw) };
  } catch {
    return { status: 'unavailable', networkCalled: true, reason: 'invalid_response' };
  }
}

export async function connect({ workspace = process.cwd(), key } = {}) {
  const secretPath = await confinedPath(workspace, SECRET_RELATIVE_PATH);
  const resolvedKey = String(key || process.env.TYPESAFE_API_KEY || '').trim() || await promptForKey();
  if (!resolvedKey) throw new Error('TypeSafe API key cannot be empty.');
  await ensurePrivateParent(secretPath);
  if (await existingFile(secretPath)) await fs.chmod(secretPath, 0o600);
  await writeNoFollow(secretPath, `TYPESAFE_API_KEY=${resolvedKey}\n`, 0o600);
  await fs.chmod(secretPath, 0o600);
  await writePolicyEnabled(workspace, true);
  return { configured: true, source: process.env.TYPESAFE_API_KEY ? 'environment' : 'project_secret_file', secretPath: SECRET_RELATIVE_PATH };
}

export async function connectShared({ workspace = process.cwd(), key, keychain = macOSKeychain } = {}) {
  await assertSafeWorkspaceRoot(workspace);
  const resolvedKey = String(key || process.env.TYPESAFE_API_KEY || '').trim() || await promptForKey();
  if (!resolvedKey) throw new Error('TypeSafe API key cannot be empty.');
  await keychain.write(resolvedKey);
  const stored = String(await keychain.read()).trim();
  if (!stored) throw new Error('macOS Keychain saved no Jev credential.');
  return { configured: true, source: 'macos_keychain', secretPath: null, sharedAcrossLocalWorkspaces: true };
}

export async function disconnect({ workspace = process.cwd() } = {}) {
  const secretPath = await confinedPath(workspace, SECRET_RELATIVE_PATH);
  const existed = await existingFile(secretPath);
  if (existed) await unlinkNoFollow(secretPath);
  await writePolicyEnabled(workspace, false);
  return { removedProjectSecret: existed, environmentStillConfigured: Boolean(process.env.TYPESAFE_API_KEY), secretPath: SECRET_RELATIVE_PATH };
}

export async function disconnectShared({ workspace = process.cwd(), keychain = macOSKeychain } = {}) {
  await assertSafeWorkspaceRoot(workspace);
  const removed = await keychain.remove();
  return { removedSharedCredential: removed, source: 'macos_keychain', sharedAcrossLocalWorkspaces: false };
}

async function main() {
  const { action, scope } = parseArgs(process.argv.slice(2));
  const result = action === 'status' ? await credentialStatus()
    : action === 'connect' && scope === 'shared' ? await connectShared()
    : action === 'disconnect' && scope === 'shared' ? await disconnectShared()
    : action === 'connect' ? await connect() : await disconnect();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
