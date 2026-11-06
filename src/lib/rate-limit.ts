/**
 * Backoff for PublicAPI's HTTP 429 (Issues2025#3458, event readiness 3).
 *
 * PublicAPI's gateway rate-limits per edge address, so a classroom seeding
 * together can be refused. A 429 from the gateway is refused before the
 * backend sees the request, so retrying is safe for any method. No other
 * status is retried here.
 */

import chalk from 'chalk';

/** At most this many retries after the first request. */
export const RATE_LIMIT_MAX_RETRIES = 4;

/** No single wait is longer than this, whatever Retry-After says. */
export const RATE_LIMIT_MAX_WAIT_MS = 30_000;

/** The first full-jitter backoff window when the gateway sends no Retry-After. */
export const RATE_LIMIT_BASE_DELAY_MS = 1_000;

/** The waits for one request never add up to more than this. */
export const RATE_LIMIT_TOTAL_WAIT_BUDGET_MS = 90_000;

/** Shown when the retries or the wait budget run out. */
export const PUBLIC_API_RATE_LIMITED_MESSAGE = 'PublicAPI is busy (rate limited). Wait a minute and try again.';

/** Thrown when PublicAPI still answers 429 after the bounded retries. */
export class PublicApiRateLimitedError extends Error {
  readonly status = 429;
  readonly code = 'PUBLIC_API_RATE_LIMITED';

  constructor(readonly attempts: number) {
    super(PUBLIC_API_RATE_LIMITED_MESSAGE);
    this.name = 'PublicApiRateLimitedError';
  }
}

/**
 * Retry-After as milliseconds from `now`: delay-seconds (digits only) or an
 * HTTP-date. A date in the past means "now"; anything else is `undefined`.
 */
export function parseRetryAfterMs(value: string | null | undefined, now: number): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  // An HTTP-date always names a weekday and month; this keeps Date.parse
  // away from bare numbers such as "1.5".
  if (!/[A-Za-z]/.test(trimmed)) return undefined;
  const at = Date.parse(trimmed);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

/** Full jitter: a random wait below min(30 s, 1 s × 2^(retry − 1)). `retry` starts at 1. */
export function rateLimitBackoffMs(retry: number, random: () => number = Math.random): number {
  const ceiling = Math.min(RATE_LIMIT_MAX_WAIT_MS, RATE_LIMIT_BASE_DELAY_MS * 2 ** Math.max(0, retry - 1));
  const sample = Math.min(Math.max(random(), 0), 1 - Number.EPSILON);
  return Math.floor(sample * ceiling);
}

export interface RateLimitRetryOptions {
  /** A request deadline: an abort ends the wait with its reason. */
  readonly signal?: AbortSignal | null;
  /** False when the request body cannot be sent twice (a stream); the 429 is then returned as is. */
  readonly replayable?: boolean;
  /** Test seam for the jitter. */
  readonly random?: () => number;
  /** Where each wait line goes; stderr by default so JSON on stdout stays clean. */
  readonly notify?: (line: string) => void;
}

/** True for request bodies fetch can send again unchanged. */
export function isReplayableBody(body: unknown): boolean {
  return body === undefined || body === null || typeof body === 'string'
    || body instanceof Uint8Array || body instanceof ArrayBuffer || body instanceof URLSearchParams
    || body instanceof FormData || body instanceof Blob;
}

function writeRateLimitNotice(line: string): void {
  process.stderr.write(`${chalk.dim(line)}\n`);
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Send a PublicAPI request, waiting and resending on 429. Retry-After is
 * honoured (capped at 30 s per wait); without it the wait is full-jitter
 * exponential backoff. After 4 retries, or when the next wait would pass the
 * 90 s budget, it throws PublicApiRateLimitedError. Any other response is
 * returned at once.
 */
export async function fetchWithRateLimitRetry(
  send: () => Promise<Response>,
  options: RateLimitRetryOptions = {},
): Promise<Response> {
  let waitedMs = 0;
  for (let retry = 1; ; retry += 1) {
    const response = await send();
    if (response.status !== 429 || options.replayable === false) return response;

    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), Date.now());
    const delayMs = Math.min(RATE_LIMIT_MAX_WAIT_MS, retryAfterMs ?? rateLimitBackoffMs(retry, options.random));
    // Free the connection; this response is never handed to a caller.
    await response.body?.cancel().catch(() => undefined);
    if (retry > RATE_LIMIT_MAX_RETRIES || waitedMs + delayMs > RATE_LIMIT_TOTAL_WAIT_BUDGET_MS) {
      throw new PublicApiRateLimitedError(retry);
    }

    (options.notify ?? writeRateLimitNotice)(
      `Rate limited, retrying in ${Math.ceil(delayMs / 1000)}s (attempt ${retry}/${RATE_LIMIT_MAX_RETRIES})`,
    );
    await wait(delayMs, options.signal);
    waitedMs += delayMs;
  }
}
