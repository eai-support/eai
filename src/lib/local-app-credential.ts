import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadEnvFile } from './config.js';

export class LocalAppCredentialError extends Error {}

interface CredentialBinding { tenantId: string; appName: string; clientId: string }
interface CredentialJournal extends CredentialBinding {
  schema: 'eai.local_app_credential.v1';
  phase: 'pending' | 'issued' | 'complete';
  baseSha256: string;
  secret?: string;
}

function assignmentKey(line: string): string | undefined {
  return /^\s*(?:export\s+)?([\w.-]+)\s*(?:=|:\s+)/.exec(line)?.[1];
}

async function privateFile(path: string): Promise<void> {
  const file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1
    || (process.getuid && file.uid !== process.getuid()) || (file.mode & 0o077) !== 0)
    throw new LocalAppCredentialError('App credential recovery requires an owner-only local file.');
}

async function readJournal(path: string): Promise<CredentialJournal | undefined> {
  try { await privateFile(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const value = JSON.parse(await readFile(path, 'utf8')) as CredentialJournal;
  if (value.schema !== 'eai.local_app_credential.v1'
    || !['pending', 'issued', 'complete'].includes(value.phase)
    || !['tenantId', 'appName', 'clientId', 'baseSha256'].every(key => typeof value[key as keyof CredentialJournal] === 'string')
    || !/^[a-f0-9]{64}$/.test(value.baseSha256)
    || Object.keys(value).some(key => !['schema', 'phase', 'tenantId', 'appName', 'clientId', 'baseSha256', 'secret'].includes(key))
    || (value.phase !== 'issued' && value.secret !== undefined)
    || (value.phase === 'issued' && (typeof value.secret !== 'string' || !value.secret || /[\r\n]/.test(value.secret))))
    throw new LocalAppCredentialError('App credential recovery record is invalid.');
  return value;
}

async function atomicPrivateWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(content, 'utf8');
    await file.sync();
    await file.close();
    await rename(temporary, path);
  } finally { await file.close(); await unlink(temporary).catch(() => {}); }
}

async function acquireSetupLock(path: string): Promise<{ handle: Awaited<ReturnType<typeof open>>; content: string }> {
  const create = async () => {
    const handle = await open(path, 'wx', 0o600);
    try {
      const content = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
      await handle.writeFile(content);
      await handle.sync();
      return { handle, content };
    } catch (error) { await handle.close(); throw error; }
  };
  try { return await create(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await privateFile(path);
  const original = await readFile(path, 'utf8');
  const owner = JSON.parse(original) as { pid?: number; nonce?: string };
  const ended = () => {
    if (!Number.isSafeInteger(owner.pid) || owner.pid! <= 0 || typeof owner.nonce !== 'string') return false;
    try { process.kill(owner.pid!, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
  };
  if (!ended()) throw new LocalAppCredentialError('Another app credential setup is in progress. Wait for it to finish; no credential was requested.');
  // A separate exclusive recovery gate prevents two observers from removing each other's replacement lock.
  const gatePath = `${path}.recovery`;
  let gate;
  try { gate = await open(gatePath, 'wx', 0o600); }
  catch { throw new LocalAppCredentialError('App credential lock recovery is already in progress; no credential was requested.'); }
  try {
    await privateFile(path);
    if (await readFile(path, 'utf8') !== original || !ended())
      throw new LocalAppCredentialError('App credential lock authority changed; no credential was requested.');
    await unlink(path);
    return await create();
  } finally { await gate.close(); await unlink(gatePath); }
}

async function releaseSetupLock(path: string, lock: { handle: Awaited<ReturnType<typeof open>>; content: string }): Promise<void> {
  await lock.handle.close();
  await privateFile(path);
  if (await readFile(path, 'utf8') !== lock.content)
    throw new LocalAppCredentialError('App credential lock changed; the replacement lock is preserved.');
  await unlink(path);
}

/** SECURITY: Cooperative setup lock and durable one-time issuance record; neither permits an uncertain automatic reissue. */
export async function createLocalAppCredential(options: {
  root: string;
  binding: CredentialBinding;
  patches: Record<string, string>;
  expectedEnv?: Record<string, string>;
  reissue: boolean;
  issue: () => Promise<string>;
}): Promise<string> {
  const envPath = join(options.root, '.env.local');
  const journalPath = join(options.root, '.env.credential.local');
  const lockPath = join(options.root, '.env.credential-lock.local');
  const lock = await acquireSetupLock(lockPath);
  try {
    await privateFile(envPath);
    const before = await readFile(envPath, 'utf8');
    const managedKeys = new Set([...Object.keys(options.patches), 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET']);
    const seen = new Set<string>();
    for (const line of before.split('\n')) {
      const key = assignmentKey(line);
      if (!key || !managedKeys.has(key)) continue;
      if (seen.has(key))
        throw new LocalAppCredentialError('Duplicate app credential configuration keys must be resolved before setup; no credential was requested.');
      seen.add(key);
    }
    if (options.expectedEnv && JSON.stringify(await loadEnvFile(options.root)) !== JSON.stringify(options.expectedEnv))
      throw new LocalAppCredentialError('Local app configuration changed before credential setup; no credential was requested.');
    const digest = createHash('sha256').update(before).digest('hex');
    let journal = await readJournal(journalPath);
    if (journal && (journal.tenantId !== options.binding.tenantId || journal.appName !== options.binding.appName
      || journal.clientId !== options.binding.clientId))
      throw new LocalAppCredentialError('App credential recovery belongs to a different selected app.');
    if (journal?.phase === 'issued' && journal.baseSha256 !== digest)
      throw new LocalAppCredentialError('Local app configuration changed after issuance. Restore its previous configuration before recovering this credential.');
    if (journal && journal.phase !== 'issued' && !options.reissue)
      throw new LocalAppCredentialError('A previous credential request may have succeeded. No additional credential was requested. Restore the credential or explicitly rerun this scoped command with --reissue-local-secret.');
    if (!journal || journal.phase !== 'issued') {
      journal = { schema: 'eai.local_app_credential.v1', phase: 'pending', ...options.binding, baseSha256: digest };
      await atomicPrivateWrite(journalPath, JSON.stringify(journal));
      let secret: string;
      try { secret = await options.issue(); }
      catch (error) {
        const status = (error as { status?: number }).status;
        if (status !== undefined && [400, 401, 403, 404, 422].includes(status)) await unlink(journalPath);
        throw error;
      }
      if (typeof secret !== 'string' || !secret.trim() || /[\r\n]/.test(secret))
        throw new LocalAppCredentialError('Invalid credential response; no automatic reissue is permitted.');
      journal = { ...journal, phase: 'issued', secret };
      await atomicPrivateWrite(journalPath, JSON.stringify(journal));
    }
    const secret = journal.secret!;
    await privateFile(envPath);
    if (await readFile(envPath, 'utf8') !== before)
      throw new LocalAppCredentialError('Local app configuration changed during issuance. The issued credential is retained privately for recovery; no local credentials were overwritten.');
    const patches: Record<string, string> = { ...options.patches, ENTRA_CLIENT_ID: options.binding.clientId, ENTRA_CLIENT_SECRET: secret };
    const remaining = new Set(Object.keys(patches));
    const lines = before.replace(/\n$/, '').split('\n').map(line => {
      const key = assignmentKey(line);
      if (!key || !remaining.has(key)) return line;
      remaining.delete(key);
      return `${key}=${patches[key]}`;
    });
    for (const key of remaining) lines.push(`${key}=${patches[key]}`);
    // Atomic replacement prevents partial readers. Uncooperative external editors must still be detected by the final read above.
    await atomicPrivateWrite(envPath, `${lines.join('\n')}\n`);
    await atomicPrivateWrite(journalPath, JSON.stringify({ ...options.binding,
      schema: 'eai.local_app_credential.v1', phase: 'complete', baseSha256: digest }));
    return secret;
  } finally {
    await releaseSetupLock(lockPath, lock);
  }
}
