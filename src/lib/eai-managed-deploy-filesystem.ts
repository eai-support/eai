import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, rm, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';

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

async function ensureNoLinkDirectoryPath(path: string, mode: number): Promise<DirectoryIdentity[]> {
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
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try {
        await mkdir(current, { mode });
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
      }
      status = await lstat(current);
    }
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new Error('Managed deployment refused a linked evidence directory.');
    }
    identities.push({ path: current, dev: status.dev, ino: status.ino });
  }
  await assertTrustedDirectory(target);
  return identities;
}

async function assertDirectoryIdentities(identities: readonly DirectoryIdentity[]): Promise<void> {
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

export async function prepareProjectTarget(root: string, target: string): Promise<void> {
  await assertTrustedDirectory(root);
  const canonicalRoot = await realpath(root);
  const components = relative(root, dirname(target)).split(/[\\/]/).filter(Boolean);
  let parent = root;
  for (const component of components) {
    parent = join(parent, component);
    await ensureDirectory(parent, 0o755);
    if (!isContained(canonicalRoot, await realpath(parent))) {
      throw new Error('Canonical deployment file resolved outside its allowed root.');
    }
  }
  await assertRegularTarget(target);
}

export async function fileMatches(left: string, right: string): Promise<boolean> {
  try {
    const [leftValue, rightValue] = await Promise.all([readFile(left), readFile(right)]);
    return leftValue.equals(rightValue);
  } catch {
    return false;
  }
}

export async function writeAtomically(path: string, content: Buffer | string, mode = 0o644): Promise<void> {
  const temporaryPath = `${path}.eai-${process.pid}-${randomBytes(16).toString('hex')}.tmp`;
  const handle = await open(temporaryPath, 'wx', mode);
  try {
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, path);
  } finally {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
  }
}

/** Write private local evidence only through an inode bound after its full parent path is revalidated. */
export async function writePrivateFileNoFollow(path: string, content: Buffer | string): Promise<void> {
  const target = resolve(path);
  const identities = await ensureNoLinkDirectoryPath(dirname(target), 0o700);
  await assertRegularTarget(target, true);
  const handle = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | (constants.O_NOFOLLOW || 0),
    0o600,
  );
  try {
    await assertDirectoryIdentities(identities);
    await assertOpenedPrivateTarget(target, handle);
    await handle.truncate(0);
    await handle.writeFile(content);
    await handle.sync();
    await handle.chmod(0o600);
    await assertDirectoryIdentities(identities);
    await assertOpenedPrivateTarget(target, handle);
  } finally {
    await handle.close();
  }
}

/** Persist owner-only operation evidence without following links or broadening permissions. */
export async function writeManagedDeployEvidence(path: string, value: unknown): Promise<void> {
  await writePrivateFileNoFollow(path, `${JSON.stringify(value, null, 2)}\n`);
}
