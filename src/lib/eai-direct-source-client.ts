import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { PlatformAPIClient, awaitManagedRequestDeadline } from "./api.js";
import { getAccessToken } from "./auth.js";
import {
  CLI_MANAGED_SOURCE_RECEIPT_PATH,
  ManagedSourceError,
  type CliManagedSourceBundle,
} from "./eai-managed-source.js";
import type { CliManagedSourceScope } from "./eai-managed-source-client-types.js";
import {
  isManagedDeploymentIdentifier,
  isManagedScopeIdentifier,
} from "./eai-managed-identifiers.js";
import { requireManagedPublicApiUrl } from "./managed-public-api.js";

export const DIRECT_SOURCE_REQUEST_SCHEMA = "eai.cli_direct_source_request.v1";
export const DIRECT_SOURCE_OPERATION_SCHEMA = "eai.direct_source_operation.v1";
/** Contract §9: 5 s cadence; backoff after the first `building` keeps many concurrent CLIs off one gateway. */
export const DIRECT_SOURCE_POLL_INTERVAL_MS = 5_000;
export const DIRECT_SOURCE_POLL_CAP_MS = 30_000;
const DIRECT_SOURCE_RETRY_AFTER_CAP_MS = 60_000;
const DIRECT_SOURCE_SUBMIT_ATTEMPTS = 4;
const DIRECT_SOURCE_STATUSES = new Set(["accepted", "building", "deploying", "ready", "failed"]);
const DIRECT_BUILD_STATUSES = new Set(["queued", "running", "succeeded", "failed", "timeout"]);
const SHA256_HEX = /^[a-f0-9]{64}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const MAX_ERROR_BODY_BYTES = 4_096;
const MAX_SERVER_MESSAGE_CHARS = 240;

export type DirectSourceStatus = "accepted" | "building" | "deploying" | "ready" | "failed";

export interface DirectSourceBuild {
  runId: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "timeout";
  startedAt: string | null;
  finishedAt: string | null;
  /** Last 4 KiB of the registry build log; present only on failure. */
  logTail: string | null;
  /** Not in contract §3; printed as `queued (position N)` only when a projection carries it. */
  queuePosition?: number;
}

/** Contract §3 projection; `repository` is always null and `failure` only accompanies `failed`. */
export interface DirectSourceOperation {
  schemaVersion: typeof DIRECT_SOURCE_OPERATION_SCHEMA;
  operationId: string;
  sourceMode: "direct";
  status: DirectSourceStatus;
  tenantId: string;
  appKey: string;
  targetTenantId: string;
  environment: string;
  actorId: string;
  bundleSha256: string;
  templateCommitSha: string;
  configHash: string;
  repository: null;
  build: DirectSourceBuild | null;
  imageDigest: string | null;
  deploymentId: string | null;
  activeUrl: string | null;
  failure: { reason: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** Resume may omit the environment; the sealed projection then supplies it. */
export type DirectSourceScope = Omit<CliManagedSourceScope, "environment"> & { environment?: string };

export interface ExpectedDirectSourceOperation {
  operationId?: string;
  bundleSha256Hex?: string;
  templateCommitSha?: string;
  configHash?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoopbackHttpOrigin(url: URL): boolean {
  return url.protocol === "http:"
    && ["localhost", "127.0.0.1"].includes(url.hostname)
    && !url.username && !url.password && !url.search && !url.hash;
}

/** SECURITY: loopback is allowed only under the explicit local-run flags; GitHub modes never use it. */
function approvedLocalDirectSourceGateway(value: string): string | undefined {
  if (process.env.E2E_3503_LOCAL_RUN !== "1" || process.env.E2E_3503_EXTERNAL_MUTATIONS !== "1") return undefined;
  let url: URL;
  let configured: URL;
  try {
    url = new URL(value);
    configured = new URL(process.env.EAI_DIRECT_SOURCE_LOCAL_PUBLIC_API_ORIGIN || "");
  } catch {
    return undefined;
  }
  if (!isLoopbackHttpOrigin(url) || !isLoopbackHttpOrigin(configured)
    || configured.pathname !== "/" || configured.origin !== url.origin
    || url.pathname.replace(/\/$/, "") !== "") return undefined;
  return url.origin;
}

/** Regional and profile-pinned HTTPS gateways as today, plus the explicitly pinned loopback PublicAPI for the local-stack sign-off. */
export function requireDirectSourcePublicApiUrl(value: string): string {
  try {
    return requireManagedPublicApiUrl(value);
  } catch (error) {
    const local = approvedLocalDirectSourceGateway(value);
    if (local) return local;
    throw error;
  }
}

/** A local GitHub publication receipt means the app already has an EAI-maintained repository link. */
export async function hasCliManagedSourceReceipt(projectRoot: string): Promise<boolean> {
  try {
    const status = await lstat(join(projectRoot, CLI_MANAGED_SOURCE_RECEIPT_PATH));
    return status.isFile() || status.isSymbolicLink();
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

/** Extract hex only for digest comparisons; uploads and idempotency retain the canonical sha256 prefix. */
export function directSourceBundleSha256Hex(bundleSha256: string): string {
  const hex = bundleSha256.replace(/^sha256:/, "");
  if (!SHA256_HEX.test(hex)) throw new ManagedSourceError("DIRECT_SOURCE_BINDING_MISMATCH", "The local bundle digest is not a SHA-256 hex digest.");
  return hex;
}

/** Contract §3: sha256("{tenant_id}|{vertical_key}|{targetTenantId}|{environment}|{bundleSha256}") hex. */
export function directSourceIdempotencyKey(scope: CliManagedSourceScope, bundleSha256: string): string {
  return createHash("sha256")
    .update(`${scope.tenantId}|${scope.appKey}|${scope.targetTenantId}|${scope.environment}|${bundleSha256}`)
    .digest("hex");
}

/** Serialize per file so a 20 MiB bundle never becomes one JSON string; the Blob still carries Content-Length. */
export function directSourceRequestBody(scope: CliManagedSourceScope, bundle: CliManagedSourceBundle): Blob {
  directSourceBundleSha256Hex(bundle.bundleSha256);
  const bundleSha256 = bundle.bundleSha256;
  const head = JSON.stringify({
    schemaVersion: DIRECT_SOURCE_REQUEST_SCHEMA,
    targetTenantId: scope.targetTenantId,
    environment: scope.environment,
    templateCommitSha: bundle.templateCommitSha,
    configHash: bundle.configHash,
    bundleSha256,
    bundle: {
      schemaVersion: bundle.schemaVersion,
      templateCommitSha: bundle.templateCommitSha,
      bundleSha256: bundle.bundleSha256,
      configHash: bundle.configHash,
    },
  });
  const parts: string[] = [`${head.slice(0, -2)},"files":[`];
  bundle.files.forEach((file, index) => {
    parts.push(index === 0 ? JSON.stringify(file) : `,${JSON.stringify(file)}`);
  });
  parts.push("]}}");
  return new Blob(parts, { type: "application/json" });
}

function boundedServerMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = Array.from(value, character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("").trim();
  if (!text || text.length > MAX_SERVER_MESSAGE_CHARS || /\bBearer\b/i.test(text)) return undefined;
  return text;
}

interface DirectSourceErrorPayload {
  code?: string;
  message?: string;
}

/** Accept `{error,message}` and FastAPI `{detail}` shapes; never trust unbounded or credential-bearing text. */
async function readErrorPayload(response: Response, signal: AbortSignal): Promise<DirectSourceErrorPayload> {
  let text: string;
  try {
    text = await awaitManagedRequestDeadline(signal, response.text());
  } catch {
    return {};
  }
  if (!text || Buffer.byteLength(text) > MAX_ERROR_BODY_BYTES) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { message: boundedServerMessage(text) };
  }
  if (!isRecord(parsed)) return {};
  const detail = parsed.detail;
  const source = isRecord(detail) ? detail : parsed;
  // PublicAPI emits upper-case codes (`DIRECT_DEPLOY_DISABLED`); the contract names them in lower case.
  const code = [source.error, source.code, parsed.error, parsed.code, typeof detail === "string" ? detail : undefined]
    .find((candidate): candidate is string => typeof candidate === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(candidate))
    ?.toLowerCase();
  const message = boundedServerMessage(source.message) ?? boundedServerMessage(typeof detail === "string" ? detail : undefined);
  return { code, message };
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, DIRECT_SOURCE_RETRY_AFTER_CAP_MS);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), DIRECT_SOURCE_RETRY_AFTER_CAP_MS);
  return undefined;
}

function submitFailure(status: number, payload: DirectSourceErrorPayload, scope: CliManagedSourceScope): ManagedSourceError {
  const detail = payload.message ? `: ${payload.message}` : "";
  switch (status) {
    case 401:
      return new ManagedSourceError("EAI_LOGIN_REQUIRED", "Sign in again with eai login, then rerun the same deploy.");
    case 403:
      return new ManagedSourceError("DIRECT_SOURCE_FORBIDDEN", `You are not entitled to deploy ${scope.appKey} to tenant ${scope.targetTenantId}${detail}. Ask a tenant administrator for app hosting access, then rerun the same deploy.`);
    case 409:
      if (payload.code === "direct_deploy_disabled") {
        return new ManagedSourceError("DIRECT_DEPLOY_DISABLED", `The gateway rejected direct deployment for ${scope.environment}. Confirm the deployment service is current and retry the same source; contact EAI support if this persists.`);
      }
      if (payload.code === "idempotency_conflict") {
        return new ManagedSourceError("DIRECT_SOURCE_IDEMPOTENCY_CONFLICT", `This exact source digest was already submitted with a different request for ${scope.appKey} in ${scope.environment}. Wait for that operation or change the source, then rerun the deploy.`);
      }
      return new ManagedSourceError("DIRECT_SOURCE_CONFLICT", `Direct deploy was refused (409${detail}). Resolve the reported conflict, then rerun the same deploy.`);
    case 413:
      return new ManagedSourceError("DIRECT_SOURCE_TOO_LARGE", "The source bundle exceeds the bounded publication limits (500 files, 2 MiB per file, 20 MiB total). Remove generated artifacts from the app source, then rerun the deploy.");
    case 422:
      return new ManagedSourceError("DIRECT_SOURCE_BUNDLE_INVALID", `PublicAPI rejected the source bundle${detail || ": bundle invalid or digest mismatch"}. Run eai deploy source validate, fix the reported problem, then rerun the deploy.`);
    case 429:
      return new ManagedSourceError("DIRECT_SOURCE_RATE_LIMITED", "PublicAPI is rate limiting direct deploys. Wait a minute, then rerun the same deploy; unchanged source reuses the same operation.");
    default:
      return new ManagedSourceError("DIRECT_SOURCE_UNAVAILABLE", `Direct deploy is unavailable (${status}${detail}). Retry the same deploy; unchanged source reuses the same operation.`);
  }
}

function isValidHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateBuild(value: unknown): DirectSourceBuild | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !DIRECT_BUILD_STATUSES.has(String(value.status))) throw mismatch("build block");
  for (const key of ["runId", "startedAt", "finishedAt", "logTail"] as const) {
    if (value[key] !== null && value[key] !== undefined && typeof value[key] !== "string") throw mismatch(`build.${key}`);
  }
  if (typeof value.logTail === "string" && value.logTail.length > 8_192) throw mismatch("build.logTail");
  const queuePosition = value.queuePosition;
  if (queuePosition !== undefined && (!Number.isSafeInteger(queuePosition) || Number(queuePosition) < 1)) throw mismatch("build.queuePosition");
  return {
    runId: (value.runId as string | null | undefined) ?? null,
    status: value.status as DirectSourceBuild["status"],
    startedAt: (value.startedAt as string | null | undefined) ?? null,
    finishedAt: (value.finishedAt as string | null | undefined) ?? null,
    logTail: (value.logTail as string | null | undefined) ?? null,
    ...(queuePosition === undefined ? {} : { queuePosition: Number(queuePosition) }),
  };
}

function mismatch(field: string): ManagedSourceError {
  return new ManagedSourceError(
    "DIRECT_SOURCE_BINDING_MISMATCH",
    `The direct deploy response does not match the signed-in actor, exact tenant/app/runtime scope and local source snapshot (${field}).`,
  );
}

/** Every readback must retain the actor, runtime scope and the sealed source digest; GitHub fields must be absent. */
export function validateDirectSourceOperation(
  value: unknown,
  scope: DirectSourceScope,
  expected: ExpectedDirectSourceOperation = {},
): DirectSourceOperation {
  if (!isRecord(value)) throw mismatch("body");
  if (value.schemaVersion !== DIRECT_SOURCE_OPERATION_SCHEMA) throw mismatch("schemaVersion");
  if (value.sourceMode !== "direct") throw mismatch("sourceMode");
  if (!isManagedDeploymentIdentifier(value.operationId)) throw mismatch("operationId");
  if (expected.operationId && value.operationId !== expected.operationId) throw mismatch("operationId");
  if (!DIRECT_SOURCE_STATUSES.has(String(value.status))) throw mismatch("status");
  if (value.tenantId !== scope.tenantId) throw mismatch("tenantId");
  if (value.appKey !== scope.appKey) throw mismatch("appKey");
  if (value.targetTenantId !== scope.targetTenantId) throw mismatch("targetTenantId");
  if (!["preview", "dev", "test", "prod"].includes(String(value.environment))) throw mismatch("environment");
  if (scope.environment !== undefined && value.environment !== scope.environment) throw mismatch("environment");
  if (!scope.actorId || value.actorId !== scope.actorId) throw mismatch("actorId");
  if (typeof value.bundleSha256 !== "string") throw mismatch("bundleSha256");
  const bundleSha256Hex = value.bundleSha256.replace(/^sha256:/, "");
  if (!SHA256_HEX.test(bundleSha256Hex)) throw mismatch("bundleSha256");
  if (expected.bundleSha256Hex && bundleSha256Hex !== expected.bundleSha256Hex) throw mismatch("bundleSha256");
  if (typeof value.templateCommitSha !== "string" || !COMMIT_SHA.test(value.templateCommitSha)) throw mismatch("templateCommitSha");
  if (expected.templateCommitSha && value.templateCommitSha !== expected.templateCommitSha) throw mismatch("templateCommitSha");
  if (typeof value.configHash !== "string" || !value.configHash) throw mismatch("configHash");
  if (expected.configHash && value.configHash !== expected.configHash) throw mismatch("configHash");
  if (value.repository !== null && value.repository !== undefined) throw mismatch("repository");
  const build = validateBuild(value.build);
  for (const key of ["imageDigest", "deploymentId", "activeUrl"] as const) {
    if (value[key] !== null && value[key] !== undefined && typeof value[key] !== "string") throw mismatch(key);
  }
  if (value.status === "ready" && !isValidHttpsUrl(value.activeUrl)) throw mismatch("activeUrl");
  if (value.status !== "ready" && value.activeUrl != null) throw mismatch("activeUrl");
  if (typeof value.imageDigest === "string" && !/^.+@sha256:[a-f0-9]{64}$/.test(value.imageDigest)) throw mismatch("imageDigest");
  let failure: DirectSourceOperation["failure"] = null;
  if (value.status === "failed") {
    if (!isRecord(value.failure) || typeof value.failure.reason !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.failure.reason)) throw mismatch("failure");
    failure = { reason: value.failure.reason, message: boundedServerMessage(value.failure.message) ?? "" };
  } else if (value.failure !== null && value.failure !== undefined) throw mismatch("failure");
  for (const key of ["createdAt", "updatedAt"] as const) {
    if (typeof value[key] !== "string" || !Number.isFinite(Date.parse(value[key] as string))) throw mismatch(key);
  }
  return {
    schemaVersion: DIRECT_SOURCE_OPERATION_SCHEMA,
    operationId: value.operationId,
    sourceMode: "direct",
    status: value.status as DirectSourceStatus,
    tenantId: scope.tenantId,
    appKey: scope.appKey,
    targetTenantId: scope.targetTenantId,
    environment: value.environment as string,
    actorId: scope.actorId,
    bundleSha256: value.bundleSha256,
    templateCommitSha: value.templateCommitSha,
    configHash: value.configHash,
    repository: null,
    build,
    imageDigest: (value.imageDigest as string | null | undefined) ?? null,
    deploymentId: (value.deploymentId as string | null | undefined) ?? null,
    activeUrl: (value.activeUrl as string | null | undefined) ?? null,
    failure,
    createdAt: value.createdAt as string,
    updatedAt: value.updatedAt as string,
  };
}

/** Contract §9 line per transition; the failure message is already bounded by validation. */
export function directSourceTransitionLabel(operation: DirectSourceOperation): string {
  switch (operation.status) {
    case "accepted":
      return "uploaded";
    case "building":
      return operation.build?.status === "queued" && operation.build.queuePosition !== undefined
        ? `queued (position ${operation.build.queuePosition})`
        : "building";
    case "deploying":
      return "deploying";
    case "ready":
      return `ready ${operation.activeUrl}`;
    case "failed":
      return `failed ${operation.failure?.reason}${operation.failure?.message ? `: ${operation.failure.message}` : ""}`;
  }
}

export function directSourceTransitionLine(operation: DirectSourceOperation): string {
  return `${directSourceTransitionLabel(operation)} (operation ${operation.operationId})`;
}

export function isDirectSourceTerminal(operation: DirectSourceOperation): boolean {
  return operation.status === "ready" || operation.status === "failed";
}

export type DirectSourceReadResult =
  | { operation: DirectSourceOperation; retryAfterMs?: undefined }
  | { operation?: undefined; retryAfterMs: number };

/** One transport per command: the global fetch pool reuses keep-alive connections across upload and polling. */
export class DirectSourceClient {
  private readonly gateway: string;

  constructor(
    private readonly client: PlatformAPIClient,
    publicApiUrl: string,
    private readonly tenantId: string,
    private readonly dependencies: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.gateway = requireDirectSourcePublicApiUrl(publicApiUrl);
  }

  private path(scope: DirectSourceScope, suffix: string): string {
    if (!isManagedScopeIdentifier(scope.tenantId) || !isManagedScopeIdentifier(scope.appKey)) {
      throw new Error("Direct source tenant and app identifiers must be safe opaque path segments.");
    }
    return `${this.gateway}/v4/platform/tenants/${scope.tenantId}/apps/${scope.appKey}/source-direct${suffix}`;
  }

  private async request(
    url: string,
    init: { method: "GET" | "POST"; body?: Blob; headers?: Record<string, string>; signal: AbortSignal },
  ): Promise<Response> {
    this.client.assertProfileAuthority();
    const token = await awaitManagedRequestDeadline(init.signal, getAccessToken());
    if (!token) throw new ManagedSourceError("EAI_LOGIN_REQUIRED", "Sign in with eai login before deploying source.");
    init.signal.throwIfAborted();
    this.client.assertProfileAuthority();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(this.tenantId && this.tenantId !== "system" ? { "X-Tenant-Id": this.tenantId } : {}),
      ...init.headers,
    };
    const fetchImpl = this.dependencies.fetch ?? fetch;
    return fetchImpl(url, {
      method: init.method,
      headers,
      redirect: "error",
      signal: init.signal,
      ...(init.body ? { body: init.body } : {}),
    });
  }

  /** A missing local receipt is not proof that the server has no GitHub source link. */
  async hasLinkedSource(scope: CliManagedSourceScope): Promise<boolean> {
    const base = this.path(scope, "").replace(/\/source-direct$/, "");
    const query = `?targetTenantId=${encodeURIComponent(scope.targetTenantId)}&environment=${encodeURIComponent(scope.environment)}`;
    for (const suffix of ["/cli-managed-source/source-anchor", "/source-anchor"]) {
      const signal = this.client.managedRequestSignal();
      const response = await this.request(`${base}${suffix}${query}`, { method: "GET", signal });
      if (response.status === 404) continue;
      // An incomplete existing anchor still owns source authority; never silently replace it.
      if (response.ok || response.status === 409) return true;
      throw new ManagedSourceError("SOURCE_LINK_STATUS_UNAVAILABLE", "Cannot confirm whether this app already has a GitHub source link. Retry, or explicitly choose --source direct, --source eai-managed or --source customer-owned.");
    }
    return false;
  }

  /** POST contract §3; 429 is retried under the same Idempotency-Key, so a replay cannot create a second operation. */
  async submit(
    scope: CliManagedSourceScope,
    bundle: CliManagedSourceBundle,
    options: { timeoutMs?: number } = {},
  ): Promise<DirectSourceOperation> {
    const bundleSha256Hex = directSourceBundleSha256Hex(bundle.bundleSha256);
    const idempotencyKey = directSourceIdempotencyKey(scope, bundle.bundleSha256);
    const body = directSourceRequestBody(scope, bundle);
    const url = this.path(scope, "/deploy");
    const sleep = this.dependencies.sleep ?? defaultSleep;
    const expected: ExpectedDirectSourceOperation = { bundleSha256Hex, templateCommitSha: bundle.templateCommitSha, configHash: bundle.configHash };
    for (let attempt = 1; ; attempt += 1) {
      const signal = this.client.managedSourceUploadSignal(options.timeoutMs);
      let response: Response;
      try {
        response = await this.request(url, {
          method: "POST", body, signal,
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        });
      } catch (error) {
        if (error instanceof ManagedSourceError) throw error;
        throw new ManagedSourceError(
          "DIRECT_SOURCE_UPLOAD_UNCERTAIN",
          "Source upload did not return a confirmed result. Rerun the same deploy; unchanged source reuses the same operation through its idempotency key.",
        );
      }
      if (response.status === 202 || response.status === 200 || response.status === 201) {
        const text = await awaitManagedRequestDeadline(signal, response.text());
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { throw mismatch("body"); }
        return validateDirectSourceOperation(parsed, scope, expected);
      }
      const payload = await readErrorPayload(response, signal);
      if (response.status === 429 && attempt < DIRECT_SOURCE_SUBMIT_ATTEMPTS) {
        await sleep(retryAfterMs(response) ?? DIRECT_SOURCE_POLL_INTERVAL_MS * attempt);
        continue;
      }
      throw submitFailure(response.status, payload, scope);
    }
  }

  /** GET contract §3; 429 and 503 return a wait hint instead of failing a long-running operation. */
  async read(
    scope: DirectSourceScope,
    operationId: string,
    options: { timeoutMs?: number } = {},
  ): Promise<DirectSourceReadResult> {
    if (!isManagedDeploymentIdentifier(operationId)) throw mismatch("operationId");
    const signal = this.client.managedRequestSignal(options.timeoutMs);
    const url = this.path(scope, `/operations/${encodeURIComponent(operationId)}`);
    let response: Response;
    try {
      response = await this.request(url, { method: "GET", signal });
    } catch (error) {
      if (error instanceof ManagedSourceError) throw error;
      throw new ManagedSourceError(
        "DIRECT_SOURCE_UNAVAILABLE",
        `Direct deploy status is unavailable. Resume with --source direct --resume ${operationId} once the gateway is reachable.`,
      );
    }
    if (response.status === 429 || response.status === 503) {
      await readErrorPayload(response, signal);
      return { retryAfterMs: retryAfterMs(response) ?? DIRECT_SOURCE_POLL_INTERVAL_MS };
    }
    if (!response.ok) {
      const payload = await readErrorPayload(response, signal);
      if (response.status === 401) throw submitFailure(401, payload, scope as CliManagedSourceScope);
      if (response.status === 403) throw new ManagedSourceError("DIRECT_SOURCE_FORBIDDEN", `You are not entitled to read direct operation ${operationId} for ${scope.appKey}${payload.message ? `: ${payload.message}` : ""}.`);
      if (response.status === 404) throw new ManagedSourceError("DIRECT_SOURCE_OPERATION_NOT_FOUND", `Direct operation ${operationId} does not exist for ${scope.appKey} in tenant ${scope.tenantId}.`);
      throw new ManagedSourceError("DIRECT_SOURCE_UNAVAILABLE", `Direct deploy status is unavailable (${response.status}${payload.message ? `: ${payload.message}` : ""}). Resume with --source direct --resume ${operationId}.`);
    }
    const text = await awaitManagedRequestDeadline(signal, response.text());
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw mismatch("body"); }
    return { operation: validateDirectSourceOperation(parsed, scope, { operationId }) };
  }
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DirectSourcePollOptions {
  wait: boolean;
  timeoutMs: number;
  onTransition?: (line: string, operation: DirectSourceOperation) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** 5 s until the first `building`, then 5→10→20→30 s with ±20 % jitter; Retry-After always wins when present. */
export function directSourcePollDelayMs(
  state: { buildingSeen: boolean; backoffSteps: number; retryAfterMs?: number },
  random: () => number = Math.random,
): number {
  if (state.retryAfterMs !== undefined) return Math.min(state.retryAfterMs, DIRECT_SOURCE_RETRY_AFTER_CAP_MS);
  const base = state.buildingSeen
    ? Math.min(DIRECT_SOURCE_POLL_INTERVAL_MS * 2 ** state.backoffSteps, DIRECT_SOURCE_POLL_CAP_MS)
    : DIRECT_SOURCE_POLL_INTERVAL_MS;
  const jitter = state.buildingSeen ? (random() * 2 - 1) * 0.2 : 0;
  return Math.round(base * (1 + jitter));
}

/** Observe one operation until `ready` or `failed`; every status change is reported exactly once. */
export async function pollDirectSourceOperation(
  transport: DirectSourceClient,
  scope: DirectSourceScope,
  operationId: string,
  options: DirectSourcePollOptions,
  initial?: DirectSourceOperation,
): Promise<DirectSourceOperation> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const deadline = Date.now() + options.timeoutMs;
  const state = { buildingSeen: false, backoffSteps: 0, retryAfterMs: undefined as number | undefined };
  let lastLabel: string | undefined;
  let operation = initial;
  const expected: ExpectedDirectSourceOperation = initial
    ? { operationId, bundleSha256Hex: initial.bundleSha256.replace(/^sha256:/, ""), templateCommitSha: initial.templateCommitSha, configHash: initial.configHash }
    : { operationId };
  const observe = (current: DirectSourceOperation): void => {
    const label = directSourceTransitionLabel(current);
    if (label !== lastLabel) {
      lastLabel = label;
      options.onTransition?.(directSourceTransitionLine(current), current);
    }
    if (current.status !== "accepted" && !state.buildingSeen) {
      state.buildingSeen = true;
      state.backoffSteps = 0;
    } else if (state.buildingSeen) {
      state.backoffSteps += 1;
    }
    Object.assign(expected, {
      bundleSha256Hex: current.bundleSha256.replace(/^sha256:/, ""),
      templateCommitSha: current.templateCommitSha,
      configHash: current.configHash,
    });
    if (scope.environment === undefined) scope = { ...scope, environment: current.environment };
  };
  if (operation) observe(operation);
  while (true) {
    if (operation && (isDirectSourceTerminal(operation) || !options.wait)) return operation;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new ManagedSourceError(
        "SOURCE_OPERATION_TIMEOUT",
        `Direct operation ${operationId} did not finish within the polling deadline. Resume it with --source direct --resume ${operationId}; do not start another deploy of the same source.`,
      );
    }
    if (operation || state.retryAfterMs !== undefined) {
      await sleep(Math.max(0, Math.min(directSourcePollDelayMs(state, random), remaining)));
      state.retryAfterMs = undefined;
      if (Date.now() >= deadline) continue;
    }
    const result = await transport.read(scope, operationId, { timeoutMs: Math.max(1, deadline - Date.now()) });
    if (result.retryAfterMs !== undefined) {
      state.retryAfterMs = result.retryAfterMs;
      if (!operation) operation = undefined;
      continue;
    }
    operation = validateDirectSourceOperation(result.operation, scope, expected);
    observe(operation);
  }
}
