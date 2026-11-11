import { PlatformAPIClient, awaitManagedRequestDeadline, readManagedPublicResponseTextBounded } from "./api.js";
import { getAccessToken } from "./auth.js";
import { ManagedSourceError } from "./eai-managed-source.js";
import type { CliManagedSourceScope } from "./eai-managed-source-client-types.js";
import { isApprovedManagedPortalOrigin } from "./eai-managed-source-link-client.js";

const OPERATION_ID = /^cli-managed-[a-f0-9]{32}$/;
const RECOVERY_PATH = "/api/platform/generated-apps/cli-managed-source/managed-review-failure";
export const MANAGED_REVIEW_FAILURE_CODE = "managed_review_checks_failed";
// 20 checks of at most ~700 bytes each plus the envelope; anything larger is not a valid recovery result.
const MAX_RECOVERY_RESPONSE_BYTES = 32 * 1024;

export interface ManagedReviewFailedCheck {
  readonly name: string;
  readonly conclusion: string;
  readonly htmlUrl: string;
}

export interface ManagedReviewFailureResult {
  readonly operationId: string;
  readonly status: "failed";
  readonly failedChecks: readonly ManagedReviewFailedCheck[];
}

function portalMessage(body: string): string | undefined {
  if (body.length > 512) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const { error, message } = parsed as { error?: unknown; message?: unknown };
    return error === "cli_managed_review_failure" &&
      typeof message === "string" &&
      message.length <= 180 &&
      !/\bBearer\b/i.test(message) &&
      /^[A-Za-z][A-Za-z0-9 .,;:'()/-]*\.?$/.test(message)
      ? message
      : undefined;
  } catch {
    return undefined;
  }
}

// SECURITY: check names come from the app's own workflows; strip C0/DEL/C1 controls (Cc) and
// bidi/zero-width format characters (Cf) before printing, as readableServerText does.
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;
const GITHUB_URL = /^https:\/\/github\.com\/[\x21-\x7e]{1,400}$/;

function failedChecks(value: unknown): ManagedReviewFailedCheck[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return undefined;
  const checks = value.map((item: unknown) => {
    const check = (item ?? {}) as Record<string, unknown>;
    return typeof check.name === "string" && typeof check.conclusion === "string" &&
      typeof check.htmlUrl === "string" && GITHUB_URL.test(check.htmlUrl)
      ? {
          name: check.name.replace(CONTROL_CHARACTERS, "").slice(0, 200),
          conclusion: check.conclusion.replace(CONTROL_CHARACTERS, "").slice(0, 40),
          htmlUrl: check.htmlUrl,
        }
      : undefined;
  });
  return checks.every(Boolean) ? (checks as ManagedReviewFailedCheck[]) : undefined;
}

function uncertainRecovery(operationId: string): ManagedSourceError {
  return new ManagedSourceError(
    "MANAGED_REVIEW_RECOVERY_UNCERTAIN",
    `The recovery did not return a confirmed result. Run the same --recover-failed-review ${operationId} command again; it is safe to repeat.`,
  );
}

/**
 * Ask the approved Portal to close one EAI review whose required checks failed and
 * record it as failed. The Portal re-verifies everything with the signed-in actor and GitHub.
 */
export async function recoverFailedCliManagedReview(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  operationId: string,
  portalOrigin: string,
): Promise<ManagedReviewFailureResult> {
  let url: URL;
  try {
    url = new URL(RECOVERY_PATH, portalOrigin);
  } catch {
    url = new URL("invalid:");
  }
  if (!OPERATION_ID.test(operationId) || !isApprovedManagedPortalOrigin(url) || url.origin !== portalOrigin) {
    throw new ManagedSourceError(
      "MANAGED_REVIEW_RECOVERY_INVALID",
      "The operation ID or Portal address is not an approved EAI recovery target. Nothing was changed.",
    );
  }
  const signal = client.managedSourceUploadSignal();
  let response: Response;
  try {
    client.assertProfileAuthority();
    const token = await awaitManagedRequestDeadline(signal, getAccessToken());
    if (!token) throw new ManagedSourceError("EAI_LOGIN_REQUIRED", "Sign in with eai login before recovering a review.");
    client.assertProfileAuthority();
    response = await fetch(url.href, {
      method: "POST",
      redirect: "error",
      signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: scope.tenantId,
        appKey: scope.appKey,
        targetTenantId: scope.targetTenantId,
        environment: scope.environment,
        operationId,
      }),
    });
  } catch (error) {
    if (error instanceof ManagedSourceError) throw error;
    throw uncertainRecovery(operationId);
  }
  let body: string;
  try {
    // The Portal may already have acted, so a failed or timed-out body read is uncertain; an oversized body is empty.
    body = (await awaitManagedRequestDeadline(
      signal,
      readManagedPublicResponseTextBounded(response, MAX_RECOVERY_RESPONSE_BYTES),
    )) ?? "";
  } catch {
    throw uncertainRecovery(operationId);
  }
  if (!response.ok) {
    throw new ManagedSourceError(
      response.status === 409 ? "MANAGED_REVIEW_RECOVERY_REFUSED" : "MANAGED_REVIEW_RECOVERY_UNAVAILABLE",
      portalMessage(body) ?? `The EAI review could not be recovered (${response.status}). Nothing else was changed.`,
    );
  }
  let parsed: { operationId?: unknown; status?: unknown; error?: { code?: unknown; failedChecks?: unknown } } = {};
  try {
    const value: unknown = JSON.parse(body);
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as typeof parsed;
  } catch {
    // An unreadable success body is handled as an uncertain result below.
  }
  const checks = failedChecks(parsed.error?.failedChecks);
  if (
    parsed.operationId !== operationId ||
    parsed.status !== "failed" ||
    parsed.error?.code !== MANAGED_REVIEW_FAILURE_CODE ||
    !checks
  ) {
    throw new ManagedSourceError(
      "MANAGED_REVIEW_RECOVERY_UNCERTAIN",
      `The recovery result did not match ${operationId}. Run the same command again to confirm it.`,
    );
  }
  return { operationId, status: "failed", failedChecks: checks };
}
