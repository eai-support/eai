import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, realpath, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
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

interface DirectoryIdentity {
  path: string;
  dev: number;
  ino: number;
}

async function bindNoLinkDirectoryPath(path: string, mode?: number): Promise<DirectoryIdentity[]> {
  const target = resolve(path);
  const filesystemRoot = parse(target).root;
  const components = relative(filesystemRoot, target).split(/[\\/]/).filter(Boolean);
  let current = filesystemRoot;
  const identities: DirectoryIdentity[] = [];
  const rootStatus = await lstat(filesystemRoot);
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
    throw new Error('Managed deployment refused a linked evidence directory.');
  }
  identities.push({ path: filesystemRoot, dev: rootStatus.dev, ino: rootStatus.ino });
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
    // macOS exposes stable system roots such as /var and /tmp as top-level links.
    if (status.isSymbolicLink() && dirname(current) === filesystemRoot) continue;
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new Error('Managed deployment refused a linked evidence directory.');
    }
    identities.push({ path: current, dev: status.dev, ino: status.ino });
  }
  if (mode !== undefined) await assertTrustedDirectory(target);
  return identities;
}

async function ensureNoLinkDirectoryPath(path: string, mode: number): Promise<DirectoryIdentity[]> {
  return bindNoLinkDirectoryPath(path, mode);
}

export async function snapshotNoLinkDirectoryPath(path: string): Promise<DirectoryIdentity[]> {
  return bindNoLinkDirectoryPath(path);
}

export async function assertDirectoryIdentities(identities: readonly DirectoryIdentity[]): Promise<void> {
  for (const identity of identities) {
    const status = await lstat(identity.path);
    if (!status.isDirectory() || status.isSymbolicLink()
      || status.dev !== identity.dev || status.ino !== identity.ino) {
      throw new Error('Managed deployment evidence directory changed before the bound write.');
    }
  }
}

async function assertOpenedPrivateTarget(path: string, handle: FileHandle): Promise<void> {
  const [opened, bound] = await Promise.all([handle.stat(), lstat(path)]);
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (!opened.isFile() || !bound.isFile() || bound.isSymbolicLink()
    || opened.dev !== bound.dev || opened.ino !== bound.ino || opened.nlink !== 1
    || (process.platform !== 'win32' && ((uid !== null && opened.uid !== uid) || (opened.mode & 0o077) !== 0))) {
    throw new Error('Managed deployment refused an untrusted file.');
  }
}

export async function assertOpenedRegularTarget(path: string, handle: FileHandle): Promise<void> {
  const [opened, bound] = await Promise.all([handle.stat(), lstat(path)]);
  if (!opened.isFile() || !bound.isFile() || bound.isSymbolicLink()
    || opened.dev !== bound.dev || opened.ino !== bound.ino || opened.nlink !== 1) {
    throw new Error('Managed deployment refused an untrusted file.');
  }
}

export async function assertRegularTarget(path: string, privateData = false): Promise<void> {
  try {
    const status = await lstat(path);
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!status.isFile() || status.isSymbolicLink() || (privateData && (status.nlink !== 1
      || (process.platform !== 'win32' && ((uid !== null && status.uid !== uid) || (status.mode & 0o077) !== 0))))) {
      throw new Error('Managed deployment refused an untrusted file.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
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

/** Write generated bytes only through a target descriptor bound before mutation. */
export async function writeBoundRegularFile(
  path: string, content: Buffer | string, mode = 0o644, rootBinding?: ManagedProjectRootBinding,
): Promise<void> {
  const target = resolve(path);
  const identities = await snapshotNoLinkDirectoryPath(dirname(target));
  await rootBinding?.assert();
  let before: Stats | undefined;
  try {
    before = await lstat(target);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error('Managed deployment refused an untrusted file.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const handle = await open(
    target,
    constants.O_WRONLY
      | (before ? 0 : constants.O_CREAT | constants.O_EXCL)
      | (constants.O_NOFOLLOW || 0),
    mode,
  );
  try {
    const opened = await handle.stat();
    await assertDirectoryIdentities(identities);
    await rootBinding?.assert();
    await assertOpenedRegularTarget(target, handle);
    if (before && (opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs
      || opened.ctimeMs !== before.ctimeMs)) {
      throw new Error('Managed deployment generated file changed before its bound write.');
    }
    await handle.truncate(0);
    await handle.writeFile(content);
    await handle.sync();
    const written = await handle.stat();
    await assertDirectoryIdentities(identities);
    await rootBinding?.assert();
    await assertOpenedRegularTarget(target, handle);
    if (written.dev !== opened.dev || written.ino !== opened.ino || !written.isFile()
      || written.size !== Buffer.byteLength(content)) {
      throw new Error('Managed deployment generated file changed during its bound write.');
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Write private local evidence only through an inode bound after its full parent path is revalidated. */
export async function writePrivateFileNoFollow(
  path: string, content: Buffer | string, rootBinding?: ManagedProjectRootBinding,
): Promise<void> {
  const target = resolve(path);
  const identities = await ensureNoLinkDirectoryPath(dirname(target), 0o700);
  await rootBinding?.assert();
  await assertRegularTarget(target, true);
  const handle = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | (constants.O_NOFOLLOW || 0),
    0o600,
  );
  try {
    await assertDirectoryIdentities(identities);
    await rootBinding?.assert();
    await assertOpenedPrivateTarget(target, handle);
    await handle.truncate(0);
    await handle.writeFile(content);
    await handle.sync();
    await handle.chmod(0o600);
    await assertDirectoryIdentities(identities);
    await rootBinding?.assert();
    await assertOpenedPrivateTarget(target, handle);
  } finally {
    await handle.close();
  }
}

/** Create one owner-only recovery file while its complete parent identity remains bound. */
export async function createPrivateFileNoFollow(path: string, content: Buffer | string): Promise<void> {
  const target = resolve(path);
  const identities = await ensureNoLinkDirectoryPath(dirname(target), 0o700);
  const handle = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0),
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

/** Read owner-only recovery authority through a stable parent and opened inode. */
export async function readPrivateFileNoFollow(path: string, maxBytes = 1024 * 1024): Promise<string> {
  const target = resolve(path);
  const identities = await snapshotNoLinkDirectoryPath(dirname(target));
  const before = await lstat(target);
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1
    || (process.platform !== 'win32' && ((uid !== null && before.uid !== uid) || (before.mode & 0o077) !== 0))) {
    throw new Error('Managed deployment refused an untrusted file.');
  }
  if (before.size < 1 || before.size > maxBytes) {
    throw new Error('Managed deployment recovery file is outside its size bound.');
  }
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
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
    return bytes.toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Persist owner-only operation evidence without following links or broadening permissions. */
export async function writeManagedDeployEvidence(path: string, value: unknown): Promise<void> {
  await writePrivateFileNoFollow(path, `${JSON.stringify(value, null, 2)}\n`);
}
