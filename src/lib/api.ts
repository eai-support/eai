/**
 * Platform API client for CLI — wraps PublicAPI calls with auth.
 *
 * Unlike the Platform SDK (which goes through the BFF proxy),
 * the CLI calls PublicAPI directly with a Bearer token from browser-based
 * authorization code flow with PKCE.
 */

import { getAccessToken } from './auth.js';
import { toObjectTypeSlug } from './utils.js';

export type PlatformMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type ResourceWhere = Record<string, unknown>;

const PUBLIC_AI_PATH = '/v4/ai';
const PUBLIC_DATA_DOCUMENTS_PATH = '/v4/data/documents';
const PUBLIC_DATA_RESOURCES_PATH = '/v4/data/resources';
const PUBLIC_GEO_PATH = '/v4/geo';
const PUBLIC_IDENTITY_PATH = '/v4/identity';
const PUBLIC_INTEGRATIONS_PATH = '/v4/integrations';
const PUBLIC_PLATFORM_PATH = '/v4/platform';
const PUBLIC_REALTIME_PATH = '/v4/realtime';
const PUBLIC_VERTICALS_DAISY_PATH = '/v4/verticals/daisy';
const PUBLIC_WEBHOOKS_PATH = '/v4/webhooks';
const PUBLIC_WORKFLOWS_PATH = '/v4/workflows';

const PUBLIC_API_V4_PATH_PREFIXES = [
  PUBLIC_AI_PATH,
  PUBLIC_DATA_DOCUMENTS_PATH,
  PUBLIC_DATA_RESOURCES_PATH,
  PUBLIC_GEO_PATH,
  PUBLIC_IDENTITY_PATH,
  PUBLIC_INTEGRATIONS_PATH,
  PUBLIC_PLATFORM_PATH,
  PUBLIC_REALTIME_PATH,
  PUBLIC_VERTICALS_DAISY_PATH,
  PUBLIC_WEBHOOKS_PATH,
  PUBLIC_WORKFLOWS_PATH,
] as const;

export interface PublicApiRequestOptions {
  method?: PlatformMethod;
  body?: unknown;
  params?: Record<string, unknown>;
}

export interface ChildTenantBootstrapRequest {
  userOid: string;
  userEmail?: string;
}

export interface TenantMemberInviteRequest {
  email: string;
  role?: string;
  roleDefinitionId?: string;
  firstName?: string;
  lastName?: string;
  message?: string;
  redirectUri?: string;
}

export interface TenantMemberListOptions {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
}

export interface TenantMemberRoleUpdateRequest {
  role?: string;
  roleDefinitionId?: string;
}

export type TenantUsecase = 'council' | 'retail' | 'healthcare' | 'finance' | 'manufacturing' | 'generic';
export type TenantHomeRegion = 'au' | 'ca' | 'eu';

export interface ChildTenantBootstrapResult {
  parentTenantId: string;
  childTenantId: string;
  userOid: string;
  membershipCreated: boolean;
  adminAssigned: boolean;
  usable: boolean;
  status: 'bootstrapped' | 'already-usable';
  reason?: string | null;
}

export interface TenantAppCreateRequest {
  appDisplayName: string;
  verticalKey: string;
  parentTenantId?: string;
  childTenantDisplayName?: string;
  childTenantSlug?: string;
  templateKey?: string;
  source?: string;
  appUrl?: string;
  usecase?: TenantUsecase;
  industry?: string;
  homeRegion?: TenantHomeRegion;
}

export interface SourceUnknownSchemaProvenance {
  templateVersion: string;
  baseTemplateSha?: string;
  approvedSourceSha?: string;
  approvedReleaseId?: string;
  schemaDigest: string;
  validatorDigest: string;
}

/**
 * Existing repository binding for tenant apps whose source is not owned by the
 * generated-source export pipeline.
 */
export interface SourceUnknownAppRegistrationRequest {
  repoOwner: string;
  repoName: string;
  repoUrl?: string;
  defaultBranch?: string;
  workflowPath?: string;
  ref?: string;
  commitSha?: string;
  configPath?: string;
  runtimePath?: string;
  sourceMode?: 'source-unknown';
  adoptionMode?: 'connect-existing' | 'adopted-observed';
  schemaProvenance?: SourceUnknownSchemaProvenance;
  observedDeployment?: {
    environment: string;
    activeUrl: string;
    status: 'adopted_observed';
    observedAt: string;
    deploymentId?: string;
    imageDigest?: string;
    configHash?: string;
  };
  validationSummary?: Record<string, unknown>;
}

export interface SourceUnknownWorkflowSetupRequest {
  environment?: string;
  workflowPath?: string;
  ref?: string;
  commitSha?: string;
  configHash?: string;
}

export interface SourceUnknownWorkflowEvidenceRequest {
  operationId: string;
  nonce: string;
  environment?: string;
  workflowPath: string;
  ref: string;
  commitSha: string;
  configHash: string;
  artifactDigest: string;
  imageDigest: string;
  schemaProvenance: SourceUnknownSchemaProvenance;
  workflowRun?: Record<string, unknown>;
  oidcClaims: Record<string, unknown>;
  validationSummary?: Record<string, unknown>;
}

export interface SourceUnknownDeploymentRequest {
  operationId: string;
  environment?: string;
  repoOwner?: string;
  repoName?: string;
  workflowPath?: string;
  ref?: string;
  commitSha?: string;
  workflowRunId?: string;
  configHash?: string;
  artifactDigest?: string;
  imageDigest?: string;
  deploymentTarget?: Record<string, unknown>;
  validationSummary?: Record<string, unknown>;
}

export interface CapabilityEvaluationRequest {
  tenantId: string;
  targetCapability: 'child-tenants' | 'ai-chat' | 'documents' | 'auth-b2b' | 'auth-dual';
  requestedOperation?: 'create' | 'enable' | 'configure' | 'inspect';
}

export interface CapabilityDecision {
  outcome: 'allow' | 'deny' | 'upgrade-required';
  reasonCode: string;
  reasonMessage: string;
  upgradeUrl?: string | null;
}

export type RuntimeWorkflowStatus =
  | 'available'
  | 'not_ready'
  | 'blocked'
  | 'operator_required'
  | 'paid_upgrade_required'
  | 'rate_limited'
  | 'upgrade_required'
  | 'unsupported';

export interface RuntimeWorkflowStatusResult {
  workflowKey: string;
  tenantId: string | null;
  status: RuntimeWorkflowStatus;
  reasonCode: string;
  reasonMessage: string;
  runtimeWorkflowRef: string | null;
  nextAction: string | null;
  checkedAt?: string | null;
}

export interface RuntimeWorkflowRequestResult {
  requestId: string;
  workflowKey: string;
  tenantId: string;
  status: RuntimeWorkflowStatus;
  reasonCode: string;
  reasonMessage: string;
  runtimeWorkflowRef: string | null;
  nextAction: string | null;
}

export interface BuilderReadinessCheck {
  key: string;
  status: RuntimeWorkflowStatus;
  reasonCode: string;
  reasonMessage: string;
  nextAction: string | null;
}

export interface BuilderReadinessResult {
  tenantId: string;
  status: RuntimeWorkflowStatus;
  checks: BuilderReadinessCheck[];
  checkedAt?: string | null;
}

export interface RotateEntraSecretResult {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  expiresAt: string | null;
}

export interface TenantDeauthorizationSummary {
  removed: boolean;
  alreadyAbsent: boolean;
}

export interface DeprovisionEntraAppResult {
  clientId: string;
  tenantId: string;
  tenantDeauthorization: TenantDeauthorizationSummary;
  appRegistrationFound: boolean;
  appRegistrationDeleted: boolean;
}

/** Safe API error summary; rejected request bodies are never retained for HTTP 422. */
export interface ParsedApiError {
  status: number;
  code?: string;
  message: string;
  bodyText?: string;
}

interface ValidationFieldIssue {
  path?: unknown;
  code?: unknown;
}

const VALIDATION_PATH_SEGMENT = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const VALIDATION_CODE = /^[a-z][a-z0-9_.]{0,63}$/;
const CALLER_CONTROLLED_LOCATION_CODES = new Set(['extra_forbidden', 'invalid_key']);

function normalizeValidationCode(value: unknown): string {
  return typeof value === 'string' && VALIDATION_CODE.test(value) ? value : 'invalid';
}

function normalizeValidationPath(value: unknown, code: string): string | undefined {
  const rawParts = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split('.')
      : [];
  if (rawParts.length === 0) {
    return undefined;
  }

  const parts = rawParts.slice(0, 8).map((part) => {
    if (typeof part === 'number') {
      return '*';
    }
    if (part === '*' || part === '<field>') {
      return part;
    }
    return typeof part === 'string' && VALIDATION_PATH_SEGMENT.test(part)
      ? part
      : '<field>';
  });
  if (CALLER_CONTROLLED_LOCATION_CODES.has(code) && parts.length > 1) {
    parts[parts.length - 1] = '<field>';
  }
  return parts.join('.');
}

function formatValidationIssues(issues: ValidationFieldIssue[]): string | undefined {
  const messages = issues
    .map((issue) => {
      const code = normalizeValidationCode(issue.code);
      const path = normalizeValidationPath(issue.path, code);
      if (!path) {
        return null;
      }
      const guidance = code === 'missing'
        ? 'Field required'
        : code === 'extra_forbidden'
          ? 'Unexpected field'
          : 'Invalid value';
      return `${path}: ${guidance}`;
    })
    .filter((value): value is string => Boolean(value));
  return messages.length > 0 ? [...new Set(messages)].join('; ') : undefined;
}

export interface PlatformAPIRequestErrorOptions {
  operation: string;
  status: number;
  statusText: string;
  serverMessage?: string;
  serverCode?: string;
  requestId?: string;
  rawBody?: string;
}

function formatApiRequestErrorMessage(options: PlatformAPIRequestErrorOptions): string {
  return `${options.operation} failed`;
}

export class PlatformAPIRequestError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly statusText: string;
  readonly serverMessage?: string;
  readonly serverCode?: string;
  readonly requestId?: string;
  readonly rawBody?: string;

  constructor(options: PlatformAPIRequestErrorOptions) {
    super(formatApiRequestErrorMessage(options));
    this.name = 'PlatformAPIRequestError';
    this.operation = options.operation;
    this.status = options.status;
    this.statusText = options.statusText;
    this.serverMessage = options.serverMessage;
    this.serverCode = options.serverCode;
    this.requestId = options.requestId;
    this.rawBody = options.rawBody;
  }
}

/**
 * Best-effort extraction of server-provided diagnostic context from a failed
 * Response. Tolerates non-JSON bodies and FastAPI/Pydantic error envelopes
 * (``{detail: "..."}``, ``{detail: {message, code}}``, ``{errors: [...]}``).
 *
 * Always returns the raw text so ``--debug`` can show the full body, even
 * when no message field could be parsed.
 */
/**
 * Coerce a server-provided error field to a string. Platform responses
 * sometimes nest a structured object in message/error/detail/code despite the
 * declared string shape; returning a non-string here previously crashed
 * callers that assume a string (e.g. `.trim()`).
 */
function coerceServerMessage(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function extractServerErrorContext(res: Response): Promise<{
  serverMessage?: string;
  serverCode?: string;
  requestId?: string;
  rawBody: string;
}> {
  const requestId = res.headers.get('x-request-id') ?? res.headers.get('x-correlation-id') ?? undefined;
  const rawBody = await res.text().catch(() => '');
  if (!rawBody) {
    return { requestId, rawBody: '' };
  }

  try {
    const parsed = JSON.parse(rawBody) as {
      detail?: string | { message?: string; error?: string; code?: string };
      message?: string;
      error?: string;
      code?: string;
      errors?: { message?: string; code?: string }[];
    };
    let serverMessage: string | undefined;
    let serverCode: string | undefined;

    if (typeof parsed.detail === 'string') {
      serverMessage = parsed.detail;
    } else if (parsed.detail && typeof parsed.detail === 'object') {
      serverMessage = coerceServerMessage(parsed.detail.message ?? parsed.detail.error);
      serverCode = coerceServerMessage(parsed.detail.code);
    }
    if (!serverMessage) {
      serverMessage = coerceServerMessage(parsed.message ?? parsed.error);
    }
    if (!serverMessage && Array.isArray(parsed.errors) && parsed.errors[0]?.message) {
      serverMessage = coerceServerMessage(parsed.errors[0].message);
      serverCode = serverCode ?? coerceServerMessage(parsed.errors[0].code);
    }
    serverCode = serverCode ?? coerceServerMessage(parsed.code);

    return { serverMessage, serverCode, requestId, rawBody };
  } catch {
    return { requestId, rawBody };
  }
}

export function buildPayloadEqualsParams(
  filters: Record<string, string>,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = { ...(extras || {}) };
  for (const [field, value] of Object.entries(filters)) {
    params[`where[${field}][equals]`] = value;
  }
  return params;
}

function appendParams(path: string, params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) {
    return path;
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          searchParams.append(key, String(item));
        }
      }
      continue;
    }
    searchParams.set(key, String(value));
  }

  const qs = searchParams.toString();
  return qs ? `${path}?${qs}` : path;
}

function normalizePublicApiV4Path(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error('PublicAPI path is required.');
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (!normalized.startsWith('/v4/')) {
    throw new Error('Only PublicAPI V4 paths are supported. Start the path with /v4/.');
  }

  const allowed = PUBLIC_API_V4_PATH_PREFIXES.some((prefix) => (
    normalized === prefix || normalized.startsWith(`${prefix}/`)
  ));
  if (!allowed) {
    throw new Error(`Unsupported PublicAPI V4 path: ${normalized}`);
  }

  return normalized;
}

/**
 * Extracts published validation locations or compatible FastAPI detail metadata
 * without returning rejected values or server-provided validation messages.
 */
export async function parseApiError(response: Response): Promise<ParsedApiError> {
  const bodyText = await response.text();
  const validationCode = response.status === 422 ? 'VALIDATION_ERROR' : undefined;
  const safeBodyText = validationCode ? {} : { bodyText };

  if (!bodyText) {
    return {
      status: response.status,
      code: validationCode,
      message: response.statusText || `HTTP ${response.status}`,
    };
  }

  try {
    const body = JSON.parse(bodyText) as {
      detail?: {
        error?: string;
        message?: string;
      } | Array<{
        loc?: Array<string | number>;
        msg?: string;
        type?: string;
      }> | string;
      error?: string;
      message?: string;
      details?: string | { message?: string };
      invalidFields?: ValidationFieldIssue[];
    };

    const publishedValidationMessage = Array.isArray(body.invalidFields)
      ? formatValidationIssues(body.invalidFields)
      : undefined;
    if (publishedValidationMessage) {
      return {
        status: response.status,
        code: typeof body.error === 'string' ? body.error : validationCode,
        message: publishedValidationMessage,
        ...safeBodyText,
      };
    }

    const detail = body.detail;
    if (Array.isArray(detail)) {
      const validationMessage = formatValidationIssues(
        detail
          .filter((issue): issue is NonNullable<typeof issue> => Boolean(issue) && typeof issue === 'object')
          .map((issue) => ({ path: issue.loc, code: issue.type })),
      );
      return {
        status: response.status,
        code: validationCode,
        message: validationMessage || response.statusText || `HTTP ${response.status}`,
        ...safeBodyText,
      };
    }

    if (validationCode) {
      return {
        status: response.status,
        code: typeof body.error === 'string' ? body.error : validationCode,
        message: 'Request validation failed',
      };
    }

    if (detail && typeof detail === 'object') {
      return {
        status: response.status,
        code: detail.error || validationCode,
        message: detail.message || response.statusText || `HTTP ${response.status}`,
        ...safeBodyText,
      };
    }

    const details = typeof body.details === 'string'
      ? body.details
      : body.details?.message;
    return {
      status: response.status,
      code: typeof body.error === 'string' ? body.error : validationCode,
      message: typeof body.message === 'string'
        ? body.message
        : typeof detail === 'string'
          ? detail
          : details
            ? details
            : response.statusText || `HTTP ${response.status}`,
      ...safeBodyText,
    };
  } catch {
    return {
      status: response.status,
      code: validationCode,
      message: validationCode
        ? response.statusText || `HTTP ${response.status}`
        : bodyText,
      ...safeBodyText,
    };
  }
}

function readStringField(body: Record<string, unknown>, camelKey: string, snakeKey: string): string | null {
  const value = body[camelKey] ?? body[snakeKey];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readWorkflowStatus(value: unknown): RuntimeWorkflowStatus {
  if (value === 'upgrade-required' || value === 'paid-upgrade-required') {
    return 'paid_upgrade_required';
  }
  if (
    value === 'available'
    || value === 'not_ready'
    || value === 'blocked'
    || value === 'operator_required'
    || value === 'paid_upgrade_required'
    || value === 'rate_limited'
    || value === 'upgrade_required'
    || value === 'unsupported'
  ) {
    return value;
  }
  return 'operator_required';
}

function parseRuntimeWorkflowStatus(body: Record<string, unknown>): RuntimeWorkflowStatusResult {
  return {
    workflowKey: readStringField(body, 'workflowKey', 'workflow_key') ?? 'unknown',
    tenantId: readStringField(body, 'tenantId', 'tenant_id'),
    status: readWorkflowStatus(body.status),
    reasonCode: readStringField(body, 'reasonCode', 'reason_code') ?? 'runtime_workflow_status_unknown',
    reasonMessage: readStringField(body, 'reasonMessage', 'reason_message') ?? 'Runtime workflow status is unknown.',
    runtimeWorkflowRef: readStringField(body, 'runtimeWorkflowRef', 'runtime_workflow_ref'),
    nextAction: readStringField(body, 'nextAction', 'next_action'),
    checkedAt: readStringField(body, 'checkedAt', 'checked_at'),
  };
}

function parseRuntimeWorkflowRequest(body: Record<string, unknown>): RuntimeWorkflowRequestResult {
  return {
    requestId: readStringField(body, 'requestId', 'request_id') ?? 'unknown',
    workflowKey: readStringField(body, 'workflowKey', 'workflow_key') ?? 'unknown',
    tenantId: readStringField(body, 'tenantId', 'tenant_id') ?? 'unknown',
    status: readWorkflowStatus(body.status),
    reasonCode: readStringField(body, 'reasonCode', 'reason_code') ?? 'runtime_workflow_requested',
    reasonMessage: readStringField(body, 'reasonMessage', 'reason_message') ?? 'Runtime workflow request submitted.',
    runtimeWorkflowRef: readStringField(body, 'runtimeWorkflowRef', 'runtime_workflow_ref'),
    nextAction: readStringField(body, 'nextAction', 'next_action'),
  };
}

function parseBuilderReadiness(body: Record<string, unknown>): BuilderReadinessResult {
  const checks = Array.isArray(body.checks)
    ? body.checks.filter((check): check is Record<string, unknown> => Boolean(check) && typeof check === 'object')
    : [];

  return {
    tenantId: readStringField(body, 'tenantId', 'tenant_id') ?? 'unknown',
    status: readWorkflowStatus(body.status),
    checkedAt: readStringField(body, 'checkedAt', 'checked_at'),
    checks: checks.map((check) => ({
      key: readStringField(check, 'key', 'key') ?? 'unknown',
      status: readWorkflowStatus(check.status),
      reasonCode: readStringField(check, 'reasonCode', 'reason_code') ?? 'builder_check_unknown',
      reasonMessage: readStringField(check, 'reasonMessage', 'reason_message') ?? 'Builder check did not return detail.',
      nextAction: readStringField(check, 'nextAction', 'next_action'),
    })),
  };
}

export class PlatformAPIClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tenantId: string,
  ) {}

  private async headers(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      h['Authorization'] = `Bearer ${token}`;
    }
    if (this.tenantId && this.tenantId !== 'system') {
      h['X-Tenant-Id'] = this.tenantId;
    }
    return h;
  }

  // --------------- V4 PublicAPI routing ---------------

  private async publicRequest(
    path: string,
    method: PlatformMethod = 'GET',
    body?: unknown,
    params?: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(`${this.baseUrl}${appendParams(path, params)}`, {
      method,
      headers: await this.headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async requestPublicApi(path: string, options?: PublicApiRequestOptions): Promise<Response> {
    return this.publicRequest(
      normalizePublicApiV4Path(path),
      options?.method ?? 'GET',
      options?.body,
      options?.params,
    );
  }

  // --------------- Resources ---------------

  async listResources(
    objectType: string,
    options?: {
      page?: number;
      limit?: number;
      sort?: string;
      where?: ResourceWhere;
      cursor?: string;
    },
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    const params = new URLSearchParams();
    if (options?.page) params.set('page', String(options.page));
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.sort) params.set('sort', options.sort);
    if (options?.where) params.set('where', JSON.stringify(options.where));
    if (options?.cursor) params.set('cursor', options.cursor);
    const qs = params.toString();
    const url = `${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}${qs ? `?${qs}` : ''}`;
    return fetch(url, { headers: await this.headers() });
  }

  async streamResources(
    objectType: string,
    options?: { limit?: number; sort?: string; where?: ResourceWhere; cursor?: string },
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.sort) params.set('sort', options.sort);
    if (options?.where) params.set('where', JSON.stringify(options.where));
    if (options?.cursor) params.set('cursor', options.cursor);
    const qs = params.toString();
    const url = `${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}/stream${qs ? `?${qs}` : ''}`;
    return fetch(url, { headers: await this.headers() });
  }

  async getResource(objectType: string, id: string): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(
      `${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}/${id}`,
      { headers: await this.headers() },
    );
  }

  async createResource(objectType: string, data: Record<string, unknown>): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ data }),
    });
  }

  async updateResource(
    objectType: string,
    id: string,
    data: Record<string, unknown>,
    version: number,
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}/${id}`, {
      method: 'PUT',
      headers: await this.headers(),
      body: JSON.stringify({ data, version }),
    });
  }

  async deleteResource(objectType: string, id: string): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}/${id}`, {
      method: 'DELETE',
      headers: await this.headers(),
    });
  }

  async batchCreateResources(
    objectType: string,
    items: Array<{ data: Record<string, unknown> }>,
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}/batch/create`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ items }),
    });
  }

  async batchImportResources(
    objectType: string,
    items: Array<{ data: Record<string, unknown> }>,
    options?: { projectionMode?: 'deferred' | 'sync' },
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}/batch/import`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        items,
        projectionMode: options?.projectionMode ?? 'deferred',
      }),
    });
  }

  async batchUpdateResources(
    objectType: string,
    items: Array<{ id: string; data: Record<string, unknown>; version: number }>,
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}/batch/update`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ items }),
    });
  }

  async batchDeleteResources(objectType: string, ids: string[]): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}/batch/delete`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ ids }),
    });
  }

  async aggregateResources(
    objectType: string,
    request: {
      groupBy: string[];
      metrics: Record<string, unknown>;
      where?: ResourceWhere;
      limit?: number;
    },
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}/aggregate`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(request),
    });
  }

  async executeAction(
    objectType: string,
    id: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(
      `${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}/${id}/actions/${action}`,
      {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({ params: params || {} }),
      },
    );
  }

  async queryResources(query: {
    object_types: string[];
    where?: Record<string, unknown>;
    join?: unknown;
    limit?: number;
  }): Promise<Response> {
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/query`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        ...query,
        object_types: query.object_types.map(toObjectTypeSlug),
      }),
    });
  }

  async getPublishedObjectTypes(options?: {
    name?: string;
    limit?: number;
    sort?: string;
  }): Promise<Response> {
    const filters: Record<string, string> = {
      tenant: this.tenantId,
    };
    if (options?.name) {
      filters.name = options.name;
    }

    return this.publicRequest(
      `${PUBLIC_DATA_RESOURCES_PATH}/object-types`,
      'GET',
      undefined,
      buildPayloadEqualsParams(filters, {
        limit: Math.min(options?.limit ?? 100, 100),
        sort: options?.sort ?? 'name',
      }),
    );
  }

  async createObjectType(data: Record<string, unknown>): Promise<Response> {
    return this.publicRequest(`${PUBLIC_DATA_RESOURCES_PATH}/object-types`, 'POST', data);
  }

  async updateObjectType(objectTypeId: string, data: Record<string, unknown>): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_DATA_RESOURCES_PATH}/object-types/${encodeURIComponent(objectTypeId)}`,
      'PATCH',
      data,
    );
  }

  async saveAppObjectTypeManifest(
    verticalKey: string,
    objectTypes: Record<string, unknown>[],
  ): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(this.tenantId)}/apps/${encodeURIComponent(verticalKey)}/object-types/manifest`,
      'PUT',
      { objectTypes },
    );
  }

  async publishAppObjectTypes(verticalKey: string): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(this.tenantId)}/apps/${encodeURIComponent(verticalKey)}/object-types/publish`,
      'POST',
    );
  }

  async getSchema(): Promise<Response> {
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/schema/${this.tenantId}`, {
      method: 'GET',
      headers: await this.headers(),
    });
  }

  async getStorageStatus(): Promise<Response> {
    return this.getResourceStorageStatus();
  }

  async getResourceStorageStatus(): Promise<Response> {
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/storage`, {
      method: 'GET',
      headers: await this.headers(),
    });
  }

  async getStorageDoctor(): Promise<Response> {
    return this.getResourceStorageDoctor();
  }

  async getResourceStorageDoctor(): Promise<Response> {
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/storage/doctor`, {
      method: 'GET',
      headers: await this.headers(),
    });
  }

  async getResourceStorageSchemaStatus(): Promise<Response> {
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/storage/schema-status`, {
      method: 'GET',
      headers: await this.headers(),
    });
  }

  async provisionStorage(options: {
    backend?: string;
    dryRun?: boolean;
    rebuildSearch?: boolean;
    provisioningMode?: string;
  }): Promise<Response> {
    const backend = options.backend === 'mongodb' ? 'documentdb' : options.backend;
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/storage/provision`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        backend: backend || 'all',
        dry_run: Boolean(options.dryRun),
        rebuild_search: Boolean(options.rebuildSearch),
        provisioning_mode: options.provisioningMode ?? 'dedicated-tenant-storage',
      }),
    });
  }

  async syncStorageSchema(options?: {
    backend?: string;
    dryRun?: boolean;
    objectTypes?: string[];
  }): Promise<Response> {
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/storage/sync-schema`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        backend: options?.backend,
        dry_run: options?.dryRun ?? false,
        objectTypes: options?.objectTypes,
      }),
    });
  }

  async planResourceIndexes(objectTypes?: string[]): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(this.tenantId)}/resourceapi/index-plan`,
      'POST',
      { objectTypes, apply: false, dryRun: true },
    );
  }

  async applyResourceIndexes(objectTypes?: string[]): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(this.tenantId)}/resourceapi/index-plan`,
      'POST',
      { objectTypes, apply: true, dryRun: false },
    );
  }

  async refreshResourceCache(objectTypes: string[] | undefined, reason: string): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(this.tenantId)}/resourceapi/cache-refresh`,
      'POST',
      { objectTypes, reason },
    );
  }

  async searchResources(request: {
    query: string;
    objectTypes?: string[];
    mode?: string;
    limit?: number;
    includePayload?: boolean;
  }): Promise<Response> {
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/search`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        query: request.query,
        objectTypes: request.objectTypes?.map(toObjectTypeSlug),
        mode: request.mode || 'hybrid',
        limit: request.limit ?? 10,
        includePayload: request.includePayload ?? true,
      }),
    });
  }

  async uploadResourceFile(
    objectType: string,
    id: string,
    propertyName: string,
    filePath: string,
  ): Promise<Response> {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const normalizedObjectType = toObjectTypeSlug(objectType);
    const content = await readFile(filePath);
    const h = await this.headers();
    h['Content-Type'] = 'application/octet-stream';

    const filename = encodeURIComponent(basename(filePath));
    return fetch(
      `${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}/${id}/files/${propertyName}?filename=${filename}`,
      {
        method: 'POST',
        headers: h,
        body: content,
      },
    );
  }

  async downloadResourceFile(
    objectType: string,
    id: string,
    propertyName: string,
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}/${id}/files/${propertyName}`, {
      method: 'GET',
      headers: await this.headers(),
    });
  }

  async deleteResourceFile(
    objectType: string,
    id: string,
    propertyName: string,
  ): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(`${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}/${id}/files/${propertyName}`, {
      method: 'DELETE',
      headers: await this.headers(),
    });
  }

  async getHistory(objectType: string, id: string): Promise<Response> {
    const normalizedObjectType = toObjectTypeSlug(objectType);
    return fetch(
      `${this.baseUrl}${PUBLIC_DATA_RESOURCES_PATH}/${this.tenantId}/${normalizedObjectType}/${id}/history`,
      { headers: await this.headers() },
    );
  }

  // --------------- Chat ---------------

  async sendChat(
    workflowId: string,
    stage: string,
    message: string,
    conversationId: string,
    params?: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(
      `${this.baseUrl}${PUBLIC_AI_PATH}/chat/${this.tenantId}/${workflowId}/${stage}`,
      {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({
          message,
          conversation_id: conversationId,
          params: params || {},
        }),
      },
    );
  }

  async streamChat(
    workflowId: string,
    stage: string,
    message: string,
    conversationId: string,
    params?: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(
      `${this.baseUrl}${PUBLIC_AI_PATH}/chat/stream/${this.tenantId}/${workflowId}/${stage}`,
      {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({
          message,
          conversation_id: conversationId,
          params: params || {},
        }),
      },
    );
  }

  // --------------- Builder / Workflows ---------------

  async getBuilderReadiness(options?: {
    tenantId?: string;
    workflowKeys?: string[];
  }): Promise<BuilderReadinessResult> {
    const params = new URLSearchParams();
    params.set('tenant_id', options?.tenantId || this.tenantId);
    for (const workflowKey of options?.workflowKeys || []) {
      params.append('workflow_keys', workflowKey);
    }

    const response = await fetch(`${this.baseUrl}${PUBLIC_INTEGRATIONS_PATH}/builder/readiness?${params.toString()}`, {
      method: 'GET',
      headers: await this.headers(),
    });

    if (!response.ok) {
      const context = await extractServerErrorContext(response);
      throw new PlatformAPIRequestError({
        operation: 'Builder readiness check',
        status: response.status,
        statusText: response.statusText,
        ...context,
      });
    }

    return parseBuilderReadiness(await response.json() as Record<string, unknown>);
  }

  async getRuntimeWorkflowStatus(
    workflowKey: string,
    tenantId = this.tenantId,
  ): Promise<RuntimeWorkflowStatusResult> {
    const params = new URLSearchParams({ tenant_id: tenantId });
    const response = await fetch(
      `${this.baseUrl}${PUBLIC_WORKFLOWS_PATH}/runtime/${encodeURIComponent(workflowKey)}/status?${params.toString()}`,
      {
        method: 'GET',
        headers: await this.headers(),
      },
    );

    if (!response.ok) {
      const context = await extractServerErrorContext(response);
      throw new PlatformAPIRequestError({
        operation: `Runtime workflow status (${workflowKey})`,
        status: response.status,
        statusText: response.statusText,
        ...context,
      });
    }

    return parseRuntimeWorkflowStatus(await response.json() as Record<string, unknown>);
  }

  async requestRuntimeWorkflow(request: {
    tenantId?: string;
    workflowKey: string;
    displayName?: string;
    reason?: string;
  }): Promise<RuntimeWorkflowRequestResult> {
    const response = await fetch(`${this.baseUrl}${PUBLIC_WORKFLOWS_PATH}/runtime-requests`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        tenant_id: request.tenantId || this.tenantId,
        workflow_key: request.workflowKey,
        display_name: request.displayName,
        reason: request.reason,
      }),
    });

    if (!response.ok) {
      const context = await extractServerErrorContext(response);
      throw new PlatformAPIRequestError({
        operation: `Runtime workflow request (${request.workflowKey})`,
        status: response.status,
        statusText: response.statusText,
        ...context,
      });
    }

    return parseRuntimeWorkflowRequest(await response.json() as Record<string, unknown>);
  }

  // --------------- Documents ---------------

  private inferUploadContentType(filePath: string): string {
    const extension = filePath.toLowerCase().slice(filePath.lastIndexOf("."));
    const contentTypes: Record<string, string> = {
      ".csv": "text/csv",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".gif": "image/gif",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".json": "application/json",
      ".md": "text/markdown",
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".txt": "text/plain",
      ".webp": "image/webp",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".xml": "application/xml",
    };
    return contentTypes[extension] ?? "application/octet-stream";
  }

  private async uploadDocumentBatch(
    filePath: string,
    processingMode: 'full' | 'classification',
  ): Promise<Response> {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const content = await readFile(filePath);
    const form = new FormData();
    form.append(
      'files',
      new File([content], basename(filePath), {
        type: this.inferUploadContentType(filePath),
      }),
    );
    form.append('tenant_id', this.tenantId);
    form.append('processing_mode', processingMode);

    const token = await getAccessToken();
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    h['X-Tenant-Id'] = this.tenantId;

    const endpoint = processingMode === 'classification'
      ? `${PUBLIC_DATA_DOCUMENTS_PATH}/classify`
      : `${PUBLIC_DATA_DOCUMENTS_PATH}/upload`;

    return fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: h,
      body: form,
    });
  }

  async uploadDocument(filePath: string): Promise<Response> {
    return this.uploadDocumentBatch(filePath, 'full');
  }

  async classifyDocument(filePath: string): Promise<Response> {
    return this.uploadDocumentBatch(filePath, 'classification');
  }

  async indexDocument(documentId: string): Promise<Response> {
    return fetch(`${this.baseUrl}${PUBLIC_DATA_DOCUMENTS_PATH}/rag-index`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        documentId,
        tenantId: this.tenantId,
      }),
    });
  }

  // --------------- Tenants ---------------

  async listTenants(parentId?: string): Promise<Response> {
    const params: Record<string, unknown> = { limit: 100 };
    if (parentId) {
      params['where[parentTenant][equals]'] = parentId;
    }
    return this.publicRequest(`${PUBLIC_PLATFORM_PATH}/tenants`, 'GET', undefined, params);
  }

  async getTenant(id: string): Promise<Response> {
    return this.publicRequest(`${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(id)}/management`, 'GET');
  }

  async listTenantChildren(
    tenantId: string,
    options?: {
      includeDescendants?: boolean;
      limit?: number;
      offset?: number;
    },
  ): Promise<Response> {
    const params: Record<string, unknown> = {};
    if (options?.includeDescendants !== undefined) {
      params.include_descendants = options.includeDescendants;
    }
    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }
    if (options?.offset !== undefined) {
      params.offset = options.offset;
    }
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/children`,
      'GET',
      undefined,
      params,
    );
  }

  async createTenantApp(parentTenantId: string, data: TenantAppCreateRequest): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(parentTenantId)}/apps`,
      'POST',
      data,
    );
  }

  async getAppDeletionPlan(tenantId: string, appKey: string): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/apps/${encodeURIComponent(appKey)}/deletion-plan`,
      'GET',
    );
  }

  async deleteApp(
    tenantId: string,
    appKey: string,
    request: {
      confirmationAppKey: string;
      ownershipManifestHash: string;
      environments: string[];
    },
  ): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/apps/${encodeURIComponent(appKey)}`,
      'DELETE',
      request,
    );
  }

  /** Read the tenant's exact app-client allowlist without mutating authorization. */
  async getTenantAuthorizedApps(tenantId: string): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/authorized-apps`,
      'GET',
    );
  }

  async createAppProvisioningJob(verticalKey: string): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(this.tenantId)}/apps/${encodeURIComponent(verticalKey)}/provisioning-jobs`,
      'POST',
    );
  }

  async registerSourceUnknownApp(
    tenantId: string,
    appKey: string,
    data: SourceUnknownAppRegistrationRequest,
  ): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/apps/${encodeURIComponent(appKey)}/source-unknown/register`,
      'POST',
      data,
    );
  }

  async setupSourceUnknownWorkflow(
    tenantId: string,
    appKey: string,
    data: SourceUnknownWorkflowSetupRequest,
  ): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/apps/${encodeURIComponent(appKey)}/source-unknown/workflow-setup`,
      'POST',
      data,
    );
  }

  async submitSourceUnknownWorkflowEvidence(
    tenantId: string,
    appKey: string,
    data: SourceUnknownWorkflowEvidenceRequest,
    githubOidcToken: string,
  ): Promise<Response> {
    const headers = await this.headers();
    headers.Authorization = `Bearer ${githubOidcToken}`;
    return fetch(
      `${this.baseUrl}${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/apps/${encodeURIComponent(appKey)}/source-unknown/workflow-evidence`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      },
    );
  }

  async requestSourceUnknownDeployment(
    tenantId: string,
    appKey: string,
    data: SourceUnknownDeploymentRequest,
  ): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/apps/${encodeURIComponent(appKey)}/source-unknown/deploy`,
      'POST',
      data,
    );
  }

  async getLatestSourceUnknownDeployment(tenantId: string, appKey: string): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/apps/${encodeURIComponent(appKey)}/source-unknown/deployments/latest`,
      'GET',
    );
  }

  async createTenant(data: {
    name: string;
    slug: string;
    parent?: string;
    domain?: string[];
    usecase?: TenantUsecase;
    industry?: string;
    starterTemplate?: string;
    homeRegion?: TenantHomeRegion;
  }): Promise<Response> {
    if (data.parent) {
      return this.publicRequest(
        `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(data.parent)}/children`,
        'POST',
        {
          displayName: data.name,
          slug: data.slug,
          usecase: data.usecase || 'generic',
          ...(data.homeRegion ? { homeRegion: data.homeRegion } : {}),
          ...(data.industry ? { industry: data.industry } : {}),
          ...(data.starterTemplate ? { starterTemplate: data.starterTemplate } : {}),
        },
      );
    }

    return this.publicRequest(`${PUBLIC_PLATFORM_PATH}/tenants`, 'POST', {
      displayName: data.name,
      name: data.name,
      slug: data.slug,
      parentTenant: data.parent,
      domain: data.domain,
      usecase: data.usecase || 'generic',
      ...(data.homeRegion ? { homeRegion: data.homeRegion } : {}),
      ...(data.industry ? { industry: data.industry } : {}),
      ...(data.starterTemplate ? { starterTemplate: data.starterTemplate } : {}),
    });
  }

  async deleteTenant(
    tenantId: string,
    options: { forceHardPurge?: boolean; reason?: string } = {},
  ): Promise<Response> {
    const body = options.forceHardPurge
      ? {
          forceHardPurge: true,
          confirmationTenantId: tenantId,
          reason: options.reason || 'eai tenant delete --force-hard-purge',
        }
      : undefined;
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/delete`,
      'POST',
      body,
    );
  }

  async bootstrapChildTenantAdmin(
    parentTenantId: string,
    childTenantId: string,
    body: ChildTenantBootstrapRequest,
  ): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(parentTenantId)}/children/${encodeURIComponent(childTenantId)}/bootstrap-admin`,
      'POST',
      body,
    );
  }

  async evaluateCapability(request: CapabilityEvaluationRequest): Promise<CapabilityDecision> {
    const response = await fetch(`${this.baseUrl}${PUBLIC_PLATFORM_PATH}/capabilities/evaluate`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        tenant_id: request.tenantId,
        target_capability: request.targetCapability,
        requested_operation: request.requestedOperation || 'inspect',
      }),
    });

    if (!response.ok) {
      const context = await extractServerErrorContext(response);
      throw new PlatformAPIRequestError({
        operation: `POST ${PUBLIC_PLATFORM_PATH}/capabilities/evaluate (${request.targetCapability})`,
        status: response.status,
        statusText: response.statusText,
        serverMessage: context.serverMessage,
        serverCode: context.serverCode,
        requestId: context.requestId,
        rawBody: context.rawBody,
      });
    }

    return await response.json() as CapabilityDecision;
  }

  // --------------- Users ---------------

  async getUserMemberships(tenantId: string, oid: string): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(oid)}/memberships`,
      'GET',
    );
  }

  async provisionMe(): Promise<Response> {
    return fetch(`${this.baseUrl}${PUBLIC_IDENTITY_PATH}/me/provision`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ tenant_id: this.tenantId }),
    });
  }

  async lookupUserByEmail(tenantId: string, email: string): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/users/by-email`,
      'GET',
      undefined,
      { email },
    );
  }

  async listCurrentUserTenants(): Promise<Response> {
    return fetch(`${this.baseUrl}${PUBLIC_IDENTITY_PATH}/tenants`, {
      method: 'GET',
      headers: await this.headers(),
    });
  }

  async provisionUserToTenant(tenantId: string, userOid?: string): Promise<Response> {
    if (userOid) {
      return this.publicRequest(
        `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userOid)}/provision`,
        'POST',
        { tenant_id: tenantId },
      );
    }

    const body: Record<string, string> = { tenant_id: tenantId };
    return fetch(`${this.baseUrl}${PUBLIC_IDENTITY_PATH}/me/provision`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
  }

  async inviteTenantMember(tenantId: string, request: TenantMemberInviteRequest): Promise<Response> {
    const body: Record<string, string> = {
      email: request.email,
    };
    if (request.roleDefinitionId) {
      body.roleDefinitionId = request.roleDefinitionId;
    }
    if (request.role || !request.roleDefinitionId) {
      body.role = request.role || 'tenant-viewer';
    }
    if (request.firstName) body.firstName = request.firstName;
    if (request.lastName) body.lastName = request.lastName;
    if (request.message) body.message = request.message;
    if (request.redirectUri) body.redirectUri = request.redirectUri;

    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/members/invite`,
      'POST',
      body,
    );
  }

  async listTenantMembers(tenantId: string, options?: TenantMemberListOptions): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/members`,
      'GET',
      undefined,
      {
        page: options?.page,
        limit: options?.limit,
        sort: options?.sort,
        search: options?.search,
      },
    );
  }

  async listTenantRoleDefinitions(tenantId: string): Promise<Response> {
    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/role-definitions`,
      'GET',
    );
  }

  async updateTenantMemberRole(
    tenantId: string,
    memberId: string,
    request: TenantMemberRoleUpdateRequest,
  ): Promise<Response> {
    const body: Record<string, string> = {};
    if (request.roleDefinitionId) {
      body.roleDefinitionId = request.roleDefinitionId;
    }
    if (request.role || !request.roleDefinitionId) {
      body.role = request.role || 'tenant-viewer';
    }

    return this.publicRequest(
      `${PUBLIC_PLATFORM_PATH}/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(memberId)}/roles`,
      'PATCH',
      body,
    );
  }

  // --------------- Provisioning ---------------

  async provisionEntraApp(request: {
    tenantId: string;
    appName: string;
    redirectUris: string[];
    existingClientId?: string;
    idempotent?: boolean;
  }): Promise<{
    clientId: string;
    clientSecret: string | null;
    existing: boolean;
    scopes: string[];
    redirectUris: string[];
    environment: string | null;
    tenantId: string | null;
    tenantAuthorization: TenantAuthorizationSummary | null;
    signinCompleteness: SigninCompletenessSummary | null;
  }> {
    const body = {
      tenant_id: request.tenantId,
      app_name: request.appName,
      redirect_uris: request.redirectUris,
      ...(request.existingClientId ? { existing_client_id: request.existingClientId } : {}),
      idempotent: request.idempotent ?? false,
    };

    const endpoint = `${PUBLIC_PLATFORM_PATH}/provisioning/entra-apps`;
    const url = `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const ctx = await extractServerErrorContext(res);
      throw new PlatformAPIRequestError({
        operation: 'Entra app provisioning',
        status: res.status,
        statusText: res.statusText,
        ...ctx,
      });
    }

    const data = await res.json() as {
      client_id?: string;
      client_secret?: string | null;
      clientId?: string;
      clientSecret?: string | null;
      existing?: boolean;
      scopes?: unknown;
      redirect_uris?: unknown;
      redirectUris?: unknown;
      environment?: unknown;
      tenant_id?: unknown;
      tenantId?: unknown;
      tenant_authorization?: unknown;
      tenantAuthorization?: unknown;
      signin_completeness?: unknown;
      signinCompleteness?: unknown;
    };
    const clientId = data.clientId ?? data.client_id;

    if (typeof clientId !== 'string' || clientId.trim() === '') {
      throw new PlatformAPIRequestError({
        operation: 'Entra app provisioning',
        status: res.status,
        statusText: 'Invalid provisioning response',
      });
    }

    const toStringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];

    return {
      clientId,
      clientSecret: data.clientSecret ?? data.client_secret ?? null,
      existing: Boolean(data.existing),
      scopes: toStringArray(data.scopes),
      redirectUris: toStringArray(data.redirectUris ?? data.redirect_uris),
      environment: typeof data.environment === 'string' ? data.environment : null,
      tenantId: typeof (data.tenantId ?? data.tenant_id) === 'string'
        ? (data.tenantId ?? data.tenant_id) as string
        : null,
      tenantAuthorization: parseTenantAuthorization(data.tenantAuthorization ?? data.tenant_authorization),
      signinCompleteness: parseSigninCompleteness(data.signinCompleteness ?? data.signin_completeness),
    };
  }

  async rotateEntraAppSecret(request: {
    tenantId: string;
    clientId: string;
  }): Promise<RotateEntraSecretResult> {
    const response = await fetch(
      `${this.baseUrl}${PUBLIC_PLATFORM_PATH}/provisioning/entra-apps/${encodeURIComponent(request.clientId)}/rotate-secret`,
      {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({ tenant_id: request.tenantId }),
      },
    );

    if (!response.ok) {
      const context = await extractServerErrorContext(response);
      throw new PlatformAPIRequestError({
        operation: 'Entra app secret rotation',
        status: response.status,
        statusText: response.statusText,
        ...context,
      });
    }

    const data = await response.json() as Record<string, unknown>;
    const clientId = readStringField(data, 'clientId', 'client_id');
    const clientSecret = readStringField(data, 'clientSecret', 'client_secret');
    if (!clientId || !clientSecret) {
      throw new PlatformAPIRequestError({
        operation: 'Entra app secret rotation',
        status: response.status,
        statusText: 'Invalid secret rotation response',
      });
    }

    return {
      clientId,
      clientSecret,
      tenantId: readStringField(data, 'tenantId', 'tenant_id') ?? request.tenantId,
      expiresAt: readStringField(data, 'expiresAt', 'expires_at'),
    };
  }

  async deprovisionEntraApp(request: {
    tenantId: string;
    clientId: string;
    deleteRegistration?: boolean;
  }): Promise<DeprovisionEntraAppResult> {
    const response = await fetch(
      `${this.baseUrl}${PUBLIC_PLATFORM_PATH}/provisioning/entra-apps/${encodeURIComponent(request.clientId)}`,
      {
        method: 'DELETE',
        headers: await this.headers(),
        body: JSON.stringify({
          tenant_id: request.tenantId,
          delete_registration: request.deleteRegistration ?? true,
        }),
      },
    );

    if (!response.ok) {
      const context = await extractServerErrorContext(response);
      throw new PlatformAPIRequestError({
        operation: 'Entra app deprovisioning',
        status: response.status,
        statusText: response.statusText,
        ...context,
      });
    }

    const data = await response.json() as Record<string, unknown>;
    const clientId = readStringField(data, 'clientId', 'client_id');
    const tenantId = readStringField(data, 'tenantId', 'tenant_id');
    if (!clientId || !tenantId) {
      throw new PlatformAPIRequestError({
        operation: 'Entra app deprovisioning',
        status: response.status,
        statusText: 'Invalid deprovision response',
      });
    }

    const tenantDeauthorizationRaw = (
      data.tenantDeauthorization ?? data.tenant_deauthorization
    ) as Record<string, unknown> | undefined;

    return {
      clientId,
      tenantId,
      tenantDeauthorization: {
        removed: Boolean(tenantDeauthorizationRaw?.removed),
        alreadyAbsent: Boolean(tenantDeauthorizationRaw?.alreadyAbsent ?? tenantDeauthorizationRaw?.already_absent),
      },
      appRegistrationFound: Boolean(data.appRegistrationFound ?? data.app_registration_found),
      appRegistrationDeleted: Boolean(data.appRegistrationDeleted ?? data.app_registration_deleted),
    };
  }
}

/**
 * AdminAPI's per-step rollup of the post-provision sign-in wiring it
 * performed against MS Graph (requiredResourceAccess merge, admin consent,
 * preAuthorizedApplications). PublicAPI relays this verbatim. `signin_ready`
 * is True only when every step the user-session sign-in path depends on
 * landed; False is the silent-failure pattern that produces AADSTS650057
 * the moment an app's BFF proxy tries to call PublicAPI.
 */
export interface SigninCompletenessSummary {
  graphPermsAdded: boolean;
  publicapiPermsAdded: boolean;
  consentGranted: boolean;
  publicapiPreauthorized: boolean;
  signinReady: boolean;
  warnings: string[];
}

export interface TenantAuthorizationSummary {
  added: boolean;
  alreadyAuthorized: boolean;
  warning: string | null;
}

function parseTenantAuthorization(value: unknown): TenantAuthorizationSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const v = value as Record<string, unknown>;
  const warning = v.warning;
  return {
    added: Boolean(v.added),
    alreadyAuthorized: Boolean(v.already_authorized ?? v.alreadyAuthorized),
    warning: typeof warning === 'string' && warning.trim() !== '' ? warning : null,
  };
}

function parseSigninCompleteness(value: unknown): SigninCompletenessSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const v = value as Record<string, unknown>;
  const warnings = Array.isArray(v.warnings)
    ? v.warnings.filter((w): w is string => typeof w === 'string')
    : [];
  return {
    graphPermsAdded: Boolean(v.graph_perms_added ?? v.graphPermsAdded),
    publicapiPermsAdded: Boolean(v.publicapi_perms_added ?? v.publicapiPermsAdded),
    consentGranted: Boolean(v.consent_granted ?? v.consentGranted),
    publicapiPreauthorized: Boolean(v.publicapi_preauthorized ?? v.publicapiPreauthorized),
    // Older AdminAPI deployments don't emit `signin_ready`; derive it from
    // the four boolean steps so the CLI behaves identically once each step
    // is observably True/False.
    signinReady: typeof (v.signin_ready ?? v.signinReady) === 'boolean'
      ? Boolean(v.signin_ready ?? v.signinReady)
      : Boolean(
        v.graph_perms_added ?? v.graphPermsAdded
      )
        && Boolean(v.publicapi_perms_added ?? v.publicapiPermsAdded)
        && Boolean(v.consent_granted ?? v.consentGranted)
        && Boolean(v.publicapi_preauthorized ?? v.publicapiPreauthorized),
    warnings,
  };
}
