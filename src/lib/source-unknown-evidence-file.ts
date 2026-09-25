import { constants, type Stats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

export const MAX_SOURCE_UNKNOWN_EVIDENCE_BYTES = 1024 * 1024;

function sameOpenedFile(before: Stats, opened: Stats): boolean {
  return before.dev === opened.dev && before.ino === opened.ino;
}

/** Read one bounded regular evidence file without following a caller-supplied final link. */
export async function readSourceUnknownEvidenceFile(
  path: string,
  maxBytes = MAX_SOURCE_UNKNOWN_EVIDENCE_BYTES,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('Workflow evidence size limit must be a positive integer.');
  }
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error('Workflow evidence must be a no-follow regular file.');
  }
  if (before.size < 1 || before.size > maxBytes) {
    throw new Error(`Workflow evidence must contain 1 to ${maxBytes} bytes.`);
  }

  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameOpenedFile(before, opened)) {
      throw new Error('Workflow evidence changed before its no-follow read.');
    }
    if (opened.size < 1 || opened.size > maxBytes) {
      throw new Error(`Workflow evidence must contain 1 to ${maxBytes} bytes.`);
    }

    const content = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < content.length) {
      const { bytesRead } = await handle.read(content, offset, content.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset < 1 || offset > maxBytes) {
      throw new Error(`Workflow evidence must contain 1 to ${maxBytes} bytes.`);
    }
    return content.subarray(0, offset).toString('utf8');
  } finally {
    await handle.close();
  }
}
