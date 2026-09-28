import { managedFileOpenFlags } from './eai-managed-deploy-filesystem.js';
import { constants, type Stats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, parse, relative, resolve } from 'node:path';
import {
  assertManagedDirectoryIdentity,
  bindManagedDirectoryIdentity,
  type ManagedDirectoryIdentity,
} from './eai-managed-directory-identity.js';

export const MAX_SOURCE_UNKNOWN_EVIDENCE_BYTES = 1024 * 1024;

function sameOpenedFile(before: Stats, opened: Stats): boolean {
  return before.dev === opened.dev && before.ino === opened.ino;
}

async function snapshotEvidenceParents(path: string): Promise<ManagedDirectoryIdentity[]> {
  const target = resolve(path);
  const filesystemRoot = parse(target).root;
  const components = relative(filesystemRoot, dirname(target))
    .split(/[\\/]/)
    .filter(Boolean);
  const identities: ManagedDirectoryIdentity[] = [];
  let current = filesystemRoot;
  for (const component of ['', ...components]) {
    if (component) current = resolve(current, component);
    const status = await lstat(current);
    identities.push(await bindManagedDirectoryIdentity(
      current,
      filesystemRoot,
      status,
      'Workflow evidence parents must be no-follow directories.',
    ));
  }
  return identities;
}

async function assertEvidenceParents(identities: readonly ManagedDirectoryIdentity[]): Promise<void> {
  for (const identity of identities) {
    await assertManagedDirectoryIdentity(
      identity,
      'Workflow evidence parents changed during the bounded read.',
    );
  }
}

/** Read one bounded regular evidence file without following a caller-supplied final link. */
export async function readSourceUnknownEvidenceFile(
  path: string,
  maxBytes = MAX_SOURCE_UNKNOWN_EVIDENCE_BYTES,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('Workflow evidence size limit must be a positive integer.');
  }
  const resolvedPath = resolve(path);
  const parents = await snapshotEvidenceParents(resolvedPath);
  const before = await lstat(resolvedPath);
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
    throw new Error('Workflow evidence must be a no-follow regular file.');
  }
  if (before.size < 1 || before.size > maxBytes) {
    throw new Error(`Workflow evidence must contain 1 to ${maxBytes} bytes.`);
  }

  const handle = await open(resolvedPath, constants.O_RDONLY | managedFileOpenFlags());
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || !sameOpenedFile(before, opened)) {
      throw new Error('Workflow evidence changed before its no-follow read.');
    }
    if (opened.size < 1 || opened.size > maxBytes) {
      throw new Error(`Workflow evidence must contain 1 to ${maxBytes} bytes.`);
    }

    await assertEvidenceParents(parents);
    const rebound = await lstat(resolvedPath);
    if (rebound.isSymbolicLink() || !rebound.isFile() || rebound.nlink !== 1 || !sameOpenedFile(opened, rebound)) {
      throw new Error('Workflow evidence path changed before its no-follow read.');
    }

    const content = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < content.length) {
      const { bytesRead } = await handle.read(content, offset, content.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    await assertEvidenceParents(parents);
    const finalPath = await lstat(resolvedPath);
    if (
      offset !== opened.size ||
      after.nlink !== 1 ||
      finalPath.nlink !== 1 ||
      !sameOpenedFile(opened, after) ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      finalPath.isSymbolicLink() ||
      !finalPath.isFile() ||
      !sameOpenedFile(after, finalPath) ||
      finalPath.size !== after.size
    ) {
      throw new Error('Workflow evidence changed during its bounded no-follow read.');
    }
    return content.toString('utf8');
  } finally {
    await handle.close();
  }
}
