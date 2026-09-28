import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import {
  assertManagedDirectoryIdentity,
  bindManagedDirectoryIdentity,
  type ManagedDirectoryIdentity,
} from './eai-managed-directory-identity.js';
import { bindManagedProjectRoot, type ManagedProjectRootBinding } from './eai-managed-root-binding.js';

export function isContained(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  const parentPrefix = `..${process.platform === 'win32' ? '\\' : '/'}`;
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(parentPrefix));
}

export async function assertTrustedDirectory(path: string): Promise<void> {
  const status = await lstat(path);
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (!status.isDirectory() || status.isSymbolicLink()
    || (process.platform !== 'win32' && ((uid !== null && status.uid !== uid) || (status.mode & 0o022) !== 0))) {
    throw new Error('Managed deployment refused an untrusted directory.');
  }
}

export async function ensureDirectory(path: string, mode: number): Promise<void> {
  try {
    await mkdir(path, { mode });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await assertTrustedDirectory(path);
}

async function bindNoLinkDirectoryPath(path: string, mode?: number): Promise<ManagedDirectoryIdentity[]> {
  const target = resolve(path);
  const filesystemRoot = parse(target).root;
  const components = relative(filesystemRoot, target).split(/[\\/]/).filter(Boolean);
  let current = filesystemRoot;
  const identities: ManagedDirectoryIdentity[] = [];
  const rootStatus = await lstat(filesystemRoot);
  identities.push(await bindManagedDirectoryIdentity(
    filesystemRoot,
    filesystemRoot,
    rootStatus,
    'Managed deployment refused a linked evidence directory.',
  ));
  for (const component of components) {
    current = join(current, component);
    let status;
    try {
      status = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || mode === undefined) throw error;
      try {
        await mkdir(current, { mode });
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
      }
      status = await lstat(current);
    }
    identities.push(await bindManagedDirectoryIdentity(
      current,
      filesystemRoot,
      status,
      'Managed deployment refused a linked evidence directory.',
    ));
  }
  if (mode !== undefined) await assertTrustedDirectory(target);
  return identities;
}

async function ensureNoLinkDirectoryPath(path: string, mode: number): Promise<ManagedDirectoryIdentity[]> {
  return bindNoLinkDirectoryPath(path, mode);
}

export async function snapshotNoLinkDirectoryPath(path: string): Promise<ManagedDirectoryIdentity[]> {
  return bindNoLinkDirectoryPath(path);
}

export async function assertDirectoryIdentities(identities: readonly ManagedDirectoryIdentity[]): Promise<void> {
  for (const identity of identities) {
    await assertManagedDirectoryIdentity(
      identity,
      'Managed deployment evidence directory changed before the bound write.',
    );
  }
}

/** Never replace required no-follow/nonblocking protection with a platform-specific zero flag. */
export function managedFileOpenFlags(capabilities: { O_NOFOLLOW?: number; O_NONBLOCK?: number } = constants): number {
  const noFollow = capabilities.O_NOFOLLOW;
  const nonblocking = capabilities.O_NONBLOCK;
  if (!Number.isInteger(noFollow) || !noFollow || !Number.isInteger(nonblocking) || !nonblocking) {
    throw new Error('Managed deployment requires no-follow and nonblocking filesystem support. Use a supported POSIX environment.');
  }
  return noFollow | nonblocking;
}

async function assertOpenedPrivateTarget(path: string, handle: FileHandle): Promise<void> {
  const [opened, bound] = await Promise.all([handle.stat(), lstat(path)]);
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (!opened.isFile() || !bound.isFile() || bound.isSymbolicLink()
    || opened.dev !== bound.dev || opened.ino !== bound.ino || opened.nlink !== 1 || bound.nlink !== 1
    || (process.platform !== 'win32' && ((uid !== null && opened.uid !== uid) || (opened.mode & 0o077) !== 0))) {
    throw new Error('Managed deployment refused an untrusted file.');
  }
}

export async function assertOpenedRegularTarget(path: string, handle: FileHandle): Promise<void> {
  const [opened, bound] = await Promise.all([handle.stat(), lstat(path)]);
  if (!opened.isFile() || !bound.isFile() || bound.isSymbolicLink()
    || opened.dev !== bound.dev || opened.ino !== bound.ino || opened.nlink !== 1 || bound.nlink !== 1) {
    throw new Error('Managed deployment refused an untrusted file.');
  }
}

export async function assertRegularTarget(path: string, privateData = false): Promise<Stats | undefined> {
  try {
    const status = await lstat(path);
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!status.isFile() || status.isSymbolicLink() || (privateData && (status.nlink !== 1
      || (process.platform !== 'win32' && ((uid !== null && status.uid !== uid) || (status.mode & 0o077) !== 0))))) {
      throw new Error('Managed deployment refused an untrusted file.');
    }
    return status;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}

export async function prepareProjectTarget(root: string, target: string, binding?: ManagedProjectRootBinding): Promise<void> {
  const rootBinding = binding ?? await bindManagedProjectRoot(root);
  const canonicalRoot = rootBinding.path;
  if (!isContained(canonicalRoot, target)) {
    throw new Error('Canonical deployment file resolved outside its allowed root.');
  }
  const components = relative(canonicalRoot, dirname(target)).split(/[\\/]/).filter(Boolean);
  let parent = canonicalRoot;
  for (const component of components) {
    await rootBinding.assert();
    parent = join(parent, component);
    await ensureDirectory(parent, 0o755);
    await rootBinding.assert();
    if (!isContained(canonicalRoot, await realpath(parent))) {
      throw new Error('Canonical deployment file resolved outside its allowed root.');
    }
  }
  await rootBinding.assert();
  await assertRegularTarget(target);
}

function sameFileSnapshot(current: Stats, expected: Stats): boolean {
  return current.dev === expected.dev && current.ino === expected.ino
    && current.size === expected.size && current.mtimeMs === expected.mtimeMs
    && current.ctimeMs === expected.ctimeMs;
}

async function assertExpectedWriteTarget(
  target: string, before: Stats | undefined, existing: FileHandle | undefined, privateData: boolean,
): Promise<void> {
  if (!before || !existing) {
    if (await assertRegularTarget(target, privateData)) {
      throw Object.assign(new Error('Managed deployment target appeared after its inspected absence.'), { code: 'EEXIST' });
    }
    return;
  }
  await (privateData ? assertOpenedPrivateTarget : assertOpenedRegularTarget)(target, existing);
  if (!sameFileSnapshot(await existing.stat(), before)) {
    throw new Error(`Managed deployment ${privateData ? 'private' : 'generated'} file changed before its bound write.`);
  }
}

/** Stage bytes on a private inode; existing targets are never modified before publication. */
async function publishBoundFile(
  target: string, content: Buffer | string, mode: number, privateData: boolean,
  identities: readonly ManagedDirectoryIdentity[], before: Stats | undefined,
  rootBinding?: Pick<ManagedProjectRootBinding, 'assert'>,
): Promise<void> {
  const bytes = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content);
  const stage = join(dirname(target), `.eai-write-${randomUUID()}.tmp`);
  const assertParents = async (): Promise<void> => {
    await assertDirectoryIdentities(identities);
    await rootBinding?.assert();
  };
  let existing: FileHandle | undefined;
  let staging: FileHandle | undefined;
  let stageIdentity: Stats | undefined;
  let stagePresent = false;
  const unlinkOwnStage = async (): Promise<void> => {
    if (!staging || !stageIdentity || !stagePresent) return;
    await assertParents();
    const [opened, leaf] = await Promise.all([staging.stat(), lstat(stage)]);
    if (!opened.isFile() || !leaf.isFile() || leaf.isSymbolicLink()
      || opened.dev !== stageIdentity.dev || opened.ino !== stageIdentity.ino
      || leaf.dev !== opened.dev || leaf.ino !== opened.ino
      || opened.nlink !== leaf.nlink || ![1, 2].includes(opened.nlink)) {
      throw new Error('Managed deployment staging file changed before cleanup.');
    }
    await unlink(stage);
    stagePresent = false;
  };
  try {
    if (before) existing = await open(target, constants.O_RDONLY | managedFileOpenFlags());
    await assertParents();
    await assertExpectedWriteTarget(target, before, existing, privateData);
    staging = await open(stage, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | managedFileOpenFlags(), 0o600);
    stagePresent = true;
    stageIdentity = await staging.stat();
    await assertParents();
    await assertOpenedPrivateTarget(stage, staging);
    await assertExpectedWriteTarget(target, before, existing, privateData);
    await staging.writeFile(bytes);
    await staging.sync();
    await assertParents();
    await assertOpenedPrivateTarget(stage, staging);
    await assertExpectedWriteTarget(target, before, existing, privateData);
    await staging.chmod(mode);
    await staging.sync();
    await assertParents();
    await (privateData ? assertOpenedPrivateTarget : assertOpenedRegularTarget)(stage, staging);
    const written = await staging.stat();
    if (written.dev !== stageIdentity.dev || written.ino !== stageIdentity.ino
      || written.size !== bytes.length || (written.mode & 0o777) !== mode) {
      throw new Error('Managed deployment staging file changed before publication.');
    }
    await assertExpectedWriteTarget(target, before, existing, privateData);
    await assertParents();
    // Node has no rename-no-replace operation: an absent target must remain exclusive.
    if (before) {
      await rename(stage, target);
      stagePresent = false;
    } else {
      await link(stage, target);
      await unlinkOwnStage();
    }
    await assertParents();
    await (privateData ? assertOpenedPrivateTarget : assertOpenedRegularTarget)(target, staging);
    const accepted = await staging.stat();
    if (accepted.dev !== written.dev || accepted.ino !== written.ino
      || accepted.size !== bytes.length || accepted.mtimeMs !== written.mtimeMs
      || (accepted.mode & 0o777) !== mode) {
      throw new Error('Managed deployment published file changed during its bound write.');
    }
  } finally {
    // A replaced namespace is not ours to clean; never unlink a mismatching staging leaf.
    await unlinkOwnStage().catch(() => undefined);
    await staging?.close().catch(() => undefined);
    await existing?.close().catch(() => undefined);
  }
}

/** Publish generated bytes after revalidating the inspected target and complete parent identity. */
export async function writeBoundRegularFile(
  path: string, content: Buffer | string, mode = 0o644, rootBinding?: ManagedProjectRootBinding,
  expectedTarget?: { status: Stats | undefined },
): Promise<void> {
  const target = resolve(path);
  const identities = await snapshotNoLinkDirectoryPath(dirname(target));
  await rootBinding?.assert();
  const before = expectedTarget ? expectedTarget.status : await assertRegularTarget(target);
  await publishBoundFile(target, content, mode, false, identities, before, rootBinding);
}

/** Publish private local evidence without truncating its previously bound authority. */
export async function writePrivateFileNoFollow(
  path: string, content: Buffer | string, rootBinding?: ManagedProjectRootBinding,
): Promise<void> {
  const target = resolve(path);
  await rootBinding?.assert();
  const identities = await ensureNoLinkDirectoryPath(dirname(target), 0o700);
  await rootBinding?.assert();
  const before = await assertRegularTarget(target, true);
  await publishBoundFile(target, content, 0o600, true, identities, before, rootBinding);
}

/** Create one owner-only recovery file while its complete parent identity remains bound. */
export async function createPrivateFileNoFollow(path: string, content: Buffer | string): Promise<void> {
  const target = resolve(path);
  const identities = await ensureNoLinkDirectoryPath(dirname(target), 0o700);
  const handle = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | managedFileOpenFlags(),
    0o600,
  );
  try {
    await assertDirectoryIdentities(identities);
    await assertOpenedPrivateTarget(target, handle);
    await handle.writeFile(content);
    await handle.sync();
    await handle.chmod(0o600);
    await assertDirectoryIdentities(identities);
    await assertOpenedPrivateTarget(target, handle);
  } finally {
    await handle.close();
  }
}

async function readPrivateFileSnapshot(
  path: string, maxBytes: number, parents?: readonly ManagedDirectoryIdentity[],
): Promise<{ content: string; status: Stats }> {
  const target = resolve(path);
  const identities = parents ?? await snapshotNoLinkDirectoryPath(dirname(target));
  const before = await lstat(target);
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1
    || (process.platform !== 'win32' && ((uid !== null && before.uid !== uid) || (before.mode & 0o077) !== 0))) {
    throw new Error('Managed deployment refused an untrusted file.');
  }
  if (before.size < 1 || before.size > maxBytes) {
    throw new Error('Managed deployment recovery file is outside its size bound.');
  }
  const handle = await open(target, constants.O_RDONLY | managedFileOpenFlags());
  try {
    await assertDirectoryIdentities(identities);
    await assertOpenedPrivateTarget(target, handle);
    const opened = await handle.stat();
    if (opened.size < 1 || opened.size > maxBytes
      || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs
      || opened.ctimeMs !== before.ctimeMs) {
      throw new Error('Managed deployment recovery file changed or exceeded its size bound before reading.');
    }
    const bytes = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, null);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    await assertDirectoryIdentities(identities);
    await assertOpenedPrivateTarget(target, handle);
    if (offset !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino
      || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new Error('Managed deployment recovery file changed during its bounded read.');
    }
    return { content: bytes.toString('utf8'), status: after };
  } finally {
    await handle.close();
  }
}

/** Read owner-only recovery authority through a stable parent and opened inode. */
export async function readPrivateFileNoFollow(path: string, maxBytes = 1024 * 1024): Promise<string> {
  return (await readPrivateFileSnapshot(path, maxBytes)).content;
}

/** Serialize bound updates; a held guard never expires and only its original inode/version is released. */
export async function updatePrivateFileNoFollow(
  path: string, update: (current: string) => string, maxBytes = 16 * 1024,
): Promise<string> {
  const target = resolve(path);
  const identities = await snapshotNoLinkDirectoryPath(dirname(target));
  const guard = `${target}.update-lock`;
  let handle: FileHandle;
  try {
    handle = await open(guard, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | managedFileOpenFlags(), 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw Object.assign(new Error('Managed deployment update guard is held; quiesce its holder and use explicitly authorized conditional recovery. No automatic takeover is permitted.', { cause: error }), { code: 'EEXIST' });
  }
  let held: Stats | undefined;
  const assertGuard = async (): Promise<void> => {
    await assertDirectoryIdentities(identities);
    await assertOpenedPrivateTarget(guard, handle);
    if (!held || !sameFileSnapshot(await handle.stat(), held)) {
      throw new Error('Managed deployment update guard changed before its bound update or release.');
    }
  };
  try {
    held = await handle.stat();
    await assertGuard();
    await handle.writeFile(`${JSON.stringify({ schema: 'eai.private-file-update-guard.v1', ownerId: randomUUID() })}\n`);
    held = await handle.stat();
    await handle.sync();
    await assertGuard();
    const current = await readPrivateFileSnapshot(target, maxBytes, identities);
    const next = update(current.content);
    await assertGuard();
    if (next !== current.content) {
      await publishBoundFile(target, next, 0o600, true, identities, current.status, { assert: assertGuard });
    }
    return next;
  } finally {
    try {
      if (held) {
        await assertGuard();
        await unlink(guard);
      }
    } finally {
      await handle.close();
    }
  }
}

/** Persist owner-only operation evidence without following links or broadening permissions. */
export async function writeManagedDeployEvidence(
  path: string,
  value: unknown,
  rootBinding?: ManagedProjectRootBinding,
): Promise<void> {
  await writePrivateFileNoFollow(path, `${JSON.stringify(value, null, 2)}\n`, rootBinding);
}
