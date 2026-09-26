import { constants, type Stats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, parse, relative, resolve } from 'node:path';

export const MAX_SOURCE_UNKNOWN_EVIDENCE_BYTES = 1024 * 1024;

function sameOpenedFile(before: Stats, opened: Stats): boolean {
  return before.dev === opened.dev && before.ino === opened.ino;
}

interface DirectoryIdentity {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
}

async function snapshotEvidenceParents(path: string): Promise<DirectoryIdentity[]> {
  const target = resolve(path);
  const filesystemRoot = parse(target).root;
  const components = relative(filesystemRoot, dirname(target))
    .split(/[\\/]/)
    .filter(Boolean);
  const identities: DirectoryIdentity[] = [];
  let current = filesystemRoot;
  for (const component of ['', ...components]) {
    if (component) current = resolve(current, component);
    const status = await lstat(current);
    // macOS exposes trusted system roots such as /var and /tmp as top-level links.
    // Bind every caller-controlled descendant while leaving that root alias intact.
    if (status.isSymbolicLink() && dirname(current) === filesystemRoot) continue;
    if (status.isSymbolicLink() || !status.isDirectory()) {
      throw new Error('Workflow evidence parents must be no-follow directories.');
    }
    identities.push({ path: current, dev: status.dev, ino: status.ino });
  }
  return identities;
}

async function assertEvidenceParents(identities: readonly DirectoryIdentity[]): Promise<void> {
  for (const identity of identities) {
    const status = await lstat(identity.path);
    if (status.isSymbolicLink() || !status.isDirectory()
      || status.dev !== identity.dev || status.ino !== identity.ino) {
      throw new Error('Workflow evidence parents changed during the bounded read.');
    }
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
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error('Workflow evidence must be a no-follow regular file.');
  }
  if (before.size < 1 || before.size > maxBytes) {
    throw new Error(`Workflow evidence must contain 1 to ${maxBytes} bytes.`);
  }

  const handle = await open(resolvedPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameOpenedFile(before, opened)) {
      throw new Error('Workflow evidence changed before its no-follow read.');
    }
    if (opened.size < 1 || opened.size > maxBytes) {
      throw new Error(`Workflow evidence must contain 1 to ${maxBytes} bytes.`);
    }

    await assertEvidenceParents(parents);
    const rebound = await lstat(resolvedPath);
    if (rebound.isSymbolicLink() || !rebound.isFile() || !sameOpenedFile(opened, rebound)) {
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
