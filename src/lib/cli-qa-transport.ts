import { fstatSync, writeSync } from 'node:fs';

/** Optional private QA pipe; never a pathname, normal output or request header. */
export function recordQaTransportResponse(observation: { publicApiUrl: string; tenantId: string | null; proofKind: 'transport-response' },
  method: string, pathname: string, verified: boolean): void {
  const executionId = process.env.EAI_CLI_QA_EXECUTION_ID;
  if (process.env.EAI_CLI_QA_TRANSPORT_FD !== '3' || !executionId
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(executionId)) return;
  try {
    const descriptor = fstatSync(3);
    if (!descriptor.isFIFO() && !descriptor.isSocket()) return;
    // No headers, response body, credentials or query string enter this pipe.
    writeSync(3, JSON.stringify({ schemaVersion: 'eai.cli-qa-transport.v1', executionId,
      ...(verified ? { ...observation, method, path: pathname } : { proofKind: 'unverified-response' }) }) + '\n');
  } catch { /* An unavailable QA pipe supplies no proof and cannot alter normal CLI behavior. */ }
}
