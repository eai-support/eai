import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
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

async function ensureNoLinkDirectoryPath(path: string, mode: number): Promise<void> {
  const target = resolve(path);
  const filesystemRoot = parse(target).root;
  const components = relative(filesystemRoot, target).split(/[\\/]/).filter(Boolean);
  let current = filesystemRoot;
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
  }
  await assertTrustedDirectory(target);
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

/** Persist owner-only operation evidence without following links or broadening permissions. */
export async function writeManagedDeployEvidence(path: string, value: unknown): Promise<void> {
  const target = resolve(path);
  await ensureNoLinkDirectoryPath(dirname(target), 0o700);
  await assertRegularTarget(target, true);
  await writeAtomically(target, `${JSON.stringify(value, null, 2)}\n`, 0o600);
  await chmod(target, 0o600);
}
