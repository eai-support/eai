import { constants, type Stats } from 'node:fs';
import { lstat, open, readFile, type FileHandle } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  assertDirectoryIdentities,
  assertOpenedRegularTarget,
  snapshotNoLinkDirectoryPath,
} from './eai-managed-deploy-filesystem.js';
import type { ManagedProjectRootBinding } from './eai-managed-root-binding.js';

/** Compare an existing generated target while its parent, inode and project root remain bound. */
export async function fileMatches(
  left: string,
  right: string,
  rootBinding?: ManagedProjectRootBinding,
): Promise<boolean> {
  const target = resolve(right);
  let before: Stats;
  try {
    before = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error('Managed deployment refused an untrusted file.');
  }
  const identities = await snapshotNoLinkDirectoryPath(dirname(target));
  await rootBinding?.assert();
  let handle: FileHandle;
  try {
    handle = await open(target, constants.O_RDONLY | (constants.O_NONBLOCK || 0) | (constants.O_NOFOLLOW || 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error('Managed deployment refused an untrusted file.', { cause: error });
    }
    throw error;
  }
  try {
    const opened = await handle.stat();
    await assertDirectoryIdentities(identities);
    await rootBinding?.assert();
    await assertOpenedRegularTarget(target, handle);
    if (opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs
      || opened.ctimeMs !== before.ctimeMs) {
      throw new Error('Managed deployment generated file changed before its bound read.');
    }
    const [leftValue, rightValue] = await Promise.all([readFile(left), handle.readFile()]);
    const after = await handle.stat();
    await assertDirectoryIdentities(identities);
    await rootBinding?.assert();
    await assertOpenedRegularTarget(target, handle);
    if (after.dev !== opened.dev || after.ino !== opened.ino
      || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
      || after.ctimeMs !== opened.ctimeMs || rightValue.length !== opened.size) {
      throw new Error('Managed deployment generated file changed during its bound read.');
    }
    return leftValue.equals(rightValue);
  } finally {
    await handle.close();
  }
}
