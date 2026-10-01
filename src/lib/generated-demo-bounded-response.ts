/** Distinguishes a rejected oversized response from upstream transport failures. */
export class GeneratedResponseTooLargeError extends Error {}

/** Reject an oversized platform response while streaming, before retaining its full body. */
export async function readBoundedGeneratedResponse(response: Response, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Response limit is invalid.');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new GeneratedResponseTooLargeError('Response exceeded the byte limit.');
      chunks.push(value);
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
