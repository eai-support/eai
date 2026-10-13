import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  assertDirectoryIdentities, assertOpenedRegularTarget, assertRegularTarget,
  managedFileOpenFlags, snapshotNoLinkDirectoryPath,
} from './eai-managed-deploy-filesystem.js';

function sameSnapshot(current: Stats, expected: Stats): boolean {
  return current.dev === expected.dev && current.ino === expected.ino
    && current.size === expected.size && current.mtimeMs === expected.mtimeMs
    && current.ctimeMs === expected.ctimeMs && current.mode === expected.mode;
}

/** Windows lacks POSIX open flags; other platforms retain the strict managed policy. */
export function objectTypeExportOpenFlags(
  capabilities: { O_NOFOLLOW?: number; O_NONBLOCK?: number } = constants,
  platform = process.platform,
): number {
  if (platform !== 'win32') return managedFileOpenFlags(capabilities);
  return (capabilities.O_NOFOLLOW || 0) | (capabilities.O_NONBLOCK || 0);
}

/** Publish a portable generated export while checking its parent and exact file identities.
 * Windows mode bits are advisory. These path checks detect observed namespace
 * changes; they do not isolate an arbitrary concurrent writer with the same permissions.
 */
export async function writeObjectTypeExportFile(
  path: string, content: string, binding: { assert(): Promise<void> },
): Promise<void> {
  const target = resolve(path);
  const platform = process.platform;
  const flags = objectTypeExportOpenFlags(constants, platform);
  const parents = await snapshotNoLinkDirectoryPath(dirname(target));
  const assertParents = async (): Promise<void> => {
    await assertDirectoryIdentities(parents);
    await binding.assert();
  };
  await assertParents();
  const before = await assertRegularTarget(target);
  const stagePath = join(dirname(target), `.eai-types-pull-${randomUUID()}.tmp`);
  let existing: FileHandle | undefined;
  let stage: FileHandle | undefined;
  let stageIdentity: Stats | undefined;
  let stagePresent = false;
  const assertTarget = async (): Promise<void> => {
    if (!before || !existing) {
      if (await assertRegularTarget(target)) throw new Error('Generated export target appeared after inspection.');
      return;
    }
    await assertOpenedRegularTarget(target, existing);
    if (!sameSnapshot(await existing.stat(), before)) throw new Error('Generated export target changed after inspection.');
  };
  const unlinkOwnStage = async (): Promise<void> => {
    if (!stage || !stageIdentity || !stagePresent) return;
    await assertParents();
    const [opened, leaf] = await Promise.all([stage.stat(), lstat(stagePath)]);
    if (!opened.isFile() || !leaf.isFile() || leaf.isSymbolicLink()
      || opened.dev !== stageIdentity.dev || opened.ino !== stageIdentity.ino
      || leaf.dev !== opened.dev || leaf.ino !== opened.ino
      || leaf.nlink !== opened.nlink || ![1, 2].includes(opened.nlink)) {
      throw new Error('Generated export staging file changed before cleanup.');
    }
    await unlink(stagePath);
    stagePresent = false;
  };
  try {
    if (before) existing = await open(target, constants.O_RDONLY | flags);
    await assertParents();
    await assertTarget();
    stage = await open(stagePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | flags, 0o600);
    stagePresent = true;
    stageIdentity = await stage.stat();
    await assertParents();
    await assertOpenedRegularTarget(stagePath, stage);
    await assertTarget();
    await stage.writeFile(content, 'utf8');
    await stage.sync();
    await assertParents();
    await assertOpenedRegularTarget(stagePath, stage);
    if (platform !== 'win32') {
      await stage.chmod(0o644);
      await stage.sync();
    }
    const written = await stage.stat();
    if (written.dev !== stageIdentity.dev || written.ino !== stageIdentity.ino
      || written.size !== Buffer.byteLength(content)
      || (platform !== 'win32' && (written.mode & 0o777) !== 0o644)) {
      throw new Error('Generated export staging file changed before publication.');
    }
    await assertTarget();
    await assertParents();
    if (before) {
      await rename(stagePath, target);
      stagePresent = false;
    } else {
      // Preserve a target that appeared after the last absence check.
      await link(stagePath, target);
      await unlinkOwnStage();
    }
    await assertParents();
    await assertOpenedRegularTarget(target, stage);
    const accepted = await stage.stat();
    if (accepted.size !== written.size || accepted.mtimeMs !== written.mtimeMs
      || (platform !== 'win32' && (accepted.mode & 0o777) !== 0o644)) {
      throw new Error('Generated export changed during publication.');
    }
  } finally {
    // A replaced namespace or unrelated leaf is never ours to unlink.
    await unlinkOwnStage().catch(() => undefined);
    await stage?.close().catch(() => undefined);
    await existing?.close().catch(() => undefined);
  }
}
