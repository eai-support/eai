/**
 * #3502: PublicAPI and AdminAPI refuse a deploy step with HTTP 402 and
 * `error: "CREDITS_EXHAUSTED"` when the paying workspace has no credits left.
 * Every CLI deploy step that can see that refusal takes its words from here.
 */

/** Stable error code in the 402 body. */
export const CREDITS_EXHAUSTED_ERROR = "CREDITS_EXHAUSTED";
export const CREDITS_EXHAUSTED_MESSAGE = "This workspace has run out of credits.";
export const CREDITS_EXHAUSTED_NEXT_ACTION =
  `${CREDITS_EXHAUSTED_MESSAGE} Raise its monthly credits, upgrade, or buy credits in the Portal under Plan and Billing, then retry.`;
/** PublicAPI gates every deploy start again at zero, so a retry after a lost response can get a 402 for a deploy it already started. */
export const CREDITS_EXHAUSTED_RETRY_HINT =
  "If you were retrying after a lost response, the first deploy may already be running: check it with `eai deploy doctor --operation-id <id>` first.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The 402 body is top-level (contracts C5); a `detail`-wrapped body is accepted too. */
export function apiErrorCode(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.error === "string") return payload.error;
  if (isRecord(payload.detail) && typeof payload.detail.error === "string")
    return payload.detail.error;
  return undefined;
}

/** The next action for a credits refusal, or `undefined` when this is not one. */
export function creditsExhaustedNextAction(
  status: number,
  errorCode: string | undefined,
): string | undefined {
  if (status !== 402 || errorCode !== CREDITS_EXHAUSTED_ERROR) return undefined;
  return `${CREDITS_EXHAUSTED_NEXT_ACTION} ${CREDITS_EXHAUSTED_RETRY_HINT}`;
}
