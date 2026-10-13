import { parseApiError, readManagedPublicResponseText } from './api.js';
import { ContentUnderstandingError } from './content-understanding-manifest.js';
import { isRecord } from './utils.js';

const DIGEST = /^(?:sha256:)?[a-f0-9]{64}$/;
const OPERATION = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export interface ContentUnderstandingCapabilities extends Record<string, unknown> {
  schemaVersion: 1;
  tenantId: string;
  provider: 'azure-content-understanding';
  apiVersion: '2025-11-01';
  mode: 'typed-document-v1';
  enabled: boolean;
  ready: boolean;
  modelProfile: 'default';
  capabilityFingerprint: string;
  modelBindingFingerprint: string | null;
  blockers: unknown[];
}
export interface ContentUnderstandingPlan extends Record<string, unknown> {
  planVersion: 1;
  tenantId: string;
  bundleKey: string;
  definitionDigest: string;
  planDigest: string;
  capabilityFingerprint: string;
  modelBindingFingerprint: string | null;
  expectedVersions: Record<string, unknown>;
  actions: unknown[];
  ready: boolean;
  blockers: unknown[];
}
export interface ContentUnderstandingOperation extends Record<string, unknown> {
  operationId: string;
  tenantId: string;
  bundleKey: string;
  definitionDigest: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'partial';
  phase: string;
  steps: unknown[];
  currentReady?: boolean;
}
export interface ContentUnderstandingPlanFile {
  ok: true;
  kind: 'eai.content-understanding.plan';
  schemaVersion: 1;
  binding: { tenantId: string; bundleKey: string; publicApiUrl: string; manifestSha256: string };
  body: ContentUnderstandingPlan;
}

/** Consume the same response deadline as the request, retaining safe server failures. */
export async function readContentUnderstandingResponse(response: Response): Promise<Record<string, unknown>> {
  const raw = await readManagedPublicResponseText(response);
  if (!response.ok) {
    const failure = await parseApiError(new Response(raw, { status: response.status }));
    const code = failure.code && /^[A-Za-z0-9_.:-]{1,100}$/.test(failure.code) ? failure.code : 'CU_REQUEST_FAILED';
    // Reservation may have succeeded before a later safe HTTP failure. Only
    // the validated platform response can acknowledge a new operation identity.
    let operationId: string | undefined;
    try {
      const envelope: unknown = JSON.parse(raw);
      if (isRecord(envelope) && typeof envelope.operationId === 'string' && OPERATION.test(envelope.operationId)) operationId = envelope.operationId;
    } catch { /* An invalid error envelope cannot acknowledge an operation. */ }
    throw new ContentUnderstandingError(code, failure.message, operationId, response.status);
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ContentUnderstandingError('CU_INVALID_RESPONSE', 'The platform returned an invalid JSON response.'); }
  if (!isRecord(value)) throw new ContentUnderstandingError('CU_INVALID_RESPONSE', 'The platform returned an invalid response envelope.');
  return value;
}

export function parseContentUnderstandingCapabilities(value: Record<string, unknown>, tenantId: string): ContentUnderstandingCapabilities {
  if (value.schemaVersion !== 1 || value.tenantId !== tenantId || value.provider !== 'azure-content-understanding'
    || value.apiVersion !== '2025-11-01' || value.mode !== 'typed-document-v1'
    || typeof value.enabled !== 'boolean' || typeof value.ready !== 'boolean' || value.modelProfile !== 'default'
    || typeof value.capabilityFingerprint !== 'string' || !DIGEST.test(value.capabilityFingerprint)
    || !Array.isArray(value.blockers) || !isRecord(value.limits) || !isRecord(value.features)
    || (value.modelBindingFingerprint !== null && (typeof value.modelBindingFingerprint !== 'string' || !DIGEST.test(value.modelBindingFingerprint)))
    || (value.ready && value.blockers.length > 0)
    || (value.ready && (!value.enabled || typeof value.modelBindingFingerprint !== 'string' || !DIGEST.test(value.modelBindingFingerprint)))) {
    throw new ContentUnderstandingError('CU_INVALID_RESPONSE', 'Capabilities do not match the selected workspace and typed document mode.');
  }
  return value as ContentUnderstandingCapabilities;
}

export function parseContentUnderstandingPlan(value: unknown, tenantId: string, bundleKey: string): ContentUnderstandingPlan {
  if (!isRecord(value) || value.planVersion !== 1 || value.tenantId !== tenantId || value.bundleKey !== bundleKey
    || !['definitionDigest', 'planDigest', 'capabilityFingerprint'].every(key => typeof value[key] === 'string' && DIGEST.test(value[key]))
    || !isRecord(value.expectedVersions) || !Array.isArray(value.actions) || typeof value.ready !== 'boolean' || !Array.isArray(value.blockers)
    || (value.modelBindingFingerprint !== null && (typeof value.modelBindingFingerprint !== 'string' || !DIGEST.test(value.modelBindingFingerprint)))
    || (value.ready && (typeof value.modelBindingFingerprint !== 'string' || value.blockers.length > 0))) {
    throw new ContentUnderstandingError('CU_PLAN_MISMATCH', 'The platform plan does not match the selected workspace, bundle and supported plan contract.');
  }
  return value as ContentUnderstandingPlan;
}

export function requireContentUnderstandingOperationId(value: unknown, originalOperationId?: string): string {
  if (typeof value !== 'string' || !OPERATION.test(value)) throw new ContentUnderstandingError('CU_OPERATION_INVALID', 'Operation ID must be a bounded platform identifier.', originalOperationId);
  return value;
}

export function parseContentUnderstandingOperation(value: Record<string, unknown>, tenantId: string,
  expected?: { operationId?: string; bundleKey?: string; definitionDigest?: string }): ContentUnderstandingOperation {
  const operationId = requireContentUnderstandingOperationId(value.operationId, expected?.operationId);
  if (value.tenantId !== tenantId || typeof value.bundleKey !== 'string' || !value.bundleKey
    || typeof value.definitionDigest !== 'string' || !DIGEST.test(value.definitionDigest)
    || typeof value.phase !== 'string' || !value.phase || !Array.isArray(value.steps)
    || typeof value.status !== 'string' || !['pending', 'running', 'succeeded', 'failed', 'unknown', 'partial'].includes(value.status)
    || (value.nextAction !== undefined && value.nextAction !== null && value.nextAction !== 'status' && value.nextAction !== 'apply')
    || (expected?.operationId && operationId !== expected.operationId)
    || (expected?.bundleKey && value.bundleKey !== expected.bundleKey)
    || (expected?.definitionDigest && value.definitionDigest !== expected.definitionDigest)) {
    throw new ContentUnderstandingError('CU_OPERATION_MISMATCH', 'Operation receipt does not match the original workspace, bundle and definition.', expected?.operationId);
  }
  return value as ContentUnderstandingOperation;
}

export function requireWaitTimeout(value: unknown): number {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > 1800) {
    throw new ContentUnderstandingError('INVALID_WAIT_TIMEOUT', 'Timeout must be an integer between 1 and 1800 seconds.');
  }
  return Number(value) * 1000;
}
