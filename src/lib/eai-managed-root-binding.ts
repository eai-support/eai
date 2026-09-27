import type { Stats } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, join, parse, relative, resolve } from 'node:path';

interface DirectoryIdentity {
  path: string;
  dev: number;
  ino: number;
}

export interface ManagedProjectRootBinding {
  path: string;
  assert(): Promise<void>;
}

function assertTrustedRoot(status: Stats): void {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (!status.isDirectory() || status.isSymbolicLink()
    || (process.platform !== 'win32'
      && ((uid !== null && status.uid !== uid) || (status.mode & 0o022) !== 0))) {
    throw new Error('Managed deployment refused an untrusted project root.');
  }
}

async function snapshotDirectoryPath(path: string): Promise<DirectoryIdentity[]> {
  const target = resolve(path);
  const filesystemRoot = parse(target).root;
  const components = relative(filesystemRoot, target).split(/[\\/]/).filter(Boolean);
  const identities: DirectoryIdentity[] = [];
  let current = filesystemRoot;
  for (const component of ['', ...components]) {
    if (component) current = join(current, component);
    const status = await lstat(current);
    // macOS exposes stable system aliases such as /tmp and /var at this level.
    if (status.isSymbolicLink() && dirname(current) === filesystemRoot) continue;
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new Error('Managed deployment project root cannot pass through a linked directory.');
    }
    identities.push({ path: current, dev: status.dev, ino: status.ino });
  }
  return identities;
}

async function assertDirectoryPath(identities: readonly DirectoryIdentity[]): Promise<void> {
  for (const identity of identities) {
    const status = await lstat(identity.path);
    if (!status.isDirectory() || status.isSymbolicLink()
      || status.dev !== identity.dev || status.ino !== identity.ino) {
      throw new Error('Managed deployment project root changed during canonical resolution.');
    }
  }
}

/** Bind the requested and canonical project paths to one trusted directory inode. */
export async function bindManagedProjectRoot(value: string): Promise<ManagedProjectRootBinding> {
  const requested = resolve(value);
  const requestedParents = await snapshotDirectoryPath(dirname(requested));
  const before = await lstat(requested);
  assertTrustedRoot(before);
  const canonical = await realpath(requested);
  const canonicalParents = await snapshotDirectoryPath(dirname(canonical));
  const canonicalStatus = await lstat(canonical);
  assertTrustedRoot(canonicalStatus);
  if (canonicalStatus.dev !== before.dev || canonicalStatus.ino !== before.ino) {
    throw new Error('Managed deployment project root changed during canonical resolution.');
  }

  const assert = async (): Promise<void> => {
    await assertDirectoryPath(requestedParents);
    await assertDirectoryPath(canonicalParents);
    const [requestedStatus, currentCanonicalStatus] = await Promise.all([
      lstat(requested),
      lstat(canonical),
    ]);
    assertTrustedRoot(requestedStatus);
    assertTrustedRoot(currentCanonicalStatus);
    if (requestedStatus.dev !== before.dev || requestedStatus.ino !== before.ino
      || currentCanonicalStatus.dev !== before.dev || currentCanonicalStatus.ino !== before.ino) {
      throw new Error('Managed deployment project root changed during canonical resolution.');
    }
  };

  await assert();
  return { path: canonical, assert };
}
