import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../src/lib/auth.js', async (original) => ({
  ...await original<typeof import('../../src/lib/auth.js')>(),
  getAccessToken: vi.fn(async () => '<fixture-access-value>'),
}));

import {
  PUBLIC_API_RATE_LIMITED_MESSAGE,
  PublicApiRateLimitedError,
  RATE_LIMIT_MAX_RETRIES,
  RATE_LIMIT_MAX_WAIT_MS,
  fetchWithRateLimitRetry,
  parseRetryAfterMs,
  rateLimitBackoffMs,
} from '../../src/lib/rate-limit.js';
import { PlatformAPIClient } from '../../src/lib/api.js';

function limited(retryAfter?: string): Response {
  return new Response('{"statusCode":429,"message":"Rate limit is exceeded."}', {
    status: 429,
    headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
  });
}

/** Settle the retry loop's pending promise, advancing fake time in small steps. */
async function settle<T>(promise: Promise<T>, totalMs: number): Promise<T> {
  let outcome: { value: T } | { error: unknown } | undefined;
  promise.then((value) => { outcome = { value }; }, (error: unknown) => { outcome = { error }; });
  await vi.advanceTimersByTimeAsync(totalMs);
  if (!outcome) throw new Error(`still waiting after ${totalMs}ms`);
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}

describe('PublicAPI 429 backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T01:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('Retry-After is read as seconds or as an HTTP-date', () => {
    const now = Date.now();
    expect(parseRetryAfterMs('4', now)).toBe(4000);
    expect(parseRetryAfterMs(' 0 ', now)).toBe(0);
    expect(parseRetryAfterMs(new Date(now + 7000).toUTCString(), now)).toBe(7000);
    expect(parseRetryAfterMs(new Date(now - 7000).toUTCString(), now)).toBe(0);
    for (const bad of [null, undefined, '', 'soon', '1.5', '-3']) {
      expect(parseRetryAfterMs(bad, now), String(bad)).toBeUndefined();
    }
  });

  test('a 429 with Retry-After in seconds waits exactly that long, then returns the next response', async () => {
    const notices: string[] = [];
    const send = vi.fn<() => Promise<Response>>()
      .mockResolvedValueOnce(limited('4'))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    const pending = fetchWithRateLimitRetry(send, { notify: (line) => notices.push(line) });
    await vi.advanceTimersByTimeAsync(3999);
    expect(send).toHaveBeenCalledTimes(1);
    const response = await settle(pending, 1);

    expect(send).toHaveBeenCalledTimes(2);
    expect(await response.json()).toEqual({ ok: true });
    expect(notices).toEqual(['Rate limited, retrying in 4s (attempt 1/4)']);
  });

  test('a Retry-After HTTP-date waits until that time', async () => {
    const notices: string[] = [];
    const send = vi.fn<() => Promise<Response>>()
      .mockResolvedValueOnce(limited(new Date(Date.now() + 7000).toUTCString()))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const pending = fetchWithRateLimitRetry(send, { notify: (line) => notices.push(line) });
    await vi.advanceTimersByTimeAsync(6999);
    expect(send).toHaveBeenCalledTimes(1);
    await settle(pending, 1);

    expect(send).toHaveBeenCalledTimes(2);
    expect(notices).toEqual(['Rate limited, retrying in 7s (attempt 1/4)']);
  });

  test('a long Retry-After is capped at 30 seconds per wait', async () => {
    const send = vi.fn<() => Promise<Response>>()
      .mockResolvedValueOnce(limited('120'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const pending = fetchWithRateLimitRetry(send, { notify: () => undefined });
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_MAX_WAIT_MS - 1);
    expect(send).toHaveBeenCalledTimes(1);
    await settle(pending, 1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('without Retry-After it uses full-jitter exponential backoff from 1 second, capped at 30 seconds', async () => {
    for (let retry = 1; retry <= 12; retry += 1) {
      const ceiling = Math.min(RATE_LIMIT_MAX_WAIT_MS, 1000 * 2 ** (retry - 1));
      expect(rateLimitBackoffMs(retry, () => 0)).toBe(0);
      expect(rateLimitBackoffMs(retry, () => 0.5)).toBe(Math.floor(ceiling / 2));
      expect(rateLimitBackoffMs(retry, () => 0.999999)).toBeLessThan(ceiling);
      expect(rateLimitBackoffMs(retry, () => 0.999999)).toBeLessThanOrEqual(RATE_LIMIT_MAX_WAIT_MS);
    }

    const notices: string[] = [];
    const send = vi.fn<() => Promise<Response>>()
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const pending = fetchWithRateLimitRetry(send, { random: () => 0.5, notify: (line) => notices.push(line) });
    await settle(pending, 500 + 1000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(notices).toEqual([
      'Rate limited, retrying in 1s (attempt 1/4)',
      'Rate limited, retrying in 1s (attempt 2/4)',
    ]);
  });

  test('it gives up after 4 retries with a clear message', async () => {
    const notices: string[] = [];
    const send = vi.fn<() => Promise<Response>>(async () => limited('1'));

    const pending = fetchWithRateLimitRetry(send, { notify: (line) => notices.push(line) });
    const failure = settle(pending, 4 * 1000);

    await expect(failure).rejects.toBeInstanceOf(PublicApiRateLimitedError);
    await expect(failure).rejects.toThrow(PUBLIC_API_RATE_LIMITED_MESSAGE);
    expect(PUBLIC_API_RATE_LIMITED_MESSAGE).toBe('PublicAPI is busy (rate limited). Wait a minute and try again.');
    expect(send).toHaveBeenCalledTimes(RATE_LIMIT_MAX_RETRIES + 1);
    expect(notices).toHaveLength(RATE_LIMIT_MAX_RETRIES);
    expect(notices.at(-1)).toBe('Rate limited, retrying in 1s (attempt 4/4)');
  });

  test('it stops when the next wait would pass the 90 second budget', async () => {
    const send = vi.fn<() => Promise<Response>>(async () => limited('30'));

    const failure = settle(fetchWithRateLimitRetry(send, { notify: () => undefined }), 90_000);

    await expect(failure).rejects.toBeInstanceOf(PublicApiRateLimitedError);
    // Three 30 s waits use the budget; the fourth would pass it.
    expect(send).toHaveBeenCalledTimes(4);
  });

  test('other statuses are returned at once, without a retry', async () => {
    for (const status of [200, 400, 401, 403, 404, 500, 502, 503]) {
      const send = vi.fn<() => Promise<Response>>(async () => new Response('{}', { status }));
      const response = await fetchWithRateLimitRetry(send, { notify: () => undefined });
      expect(response.status).toBe(status);
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  test('a request body that cannot be replayed is not retried', async () => {
    const send = vi.fn<() => Promise<Response>>(async () => limited('1'));
    const response = await fetchWithRateLimitRetry(send, { replayable: false, notify: () => undefined });
    expect(response.status).toBe(429);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('an aborted request deadline ends the wait with the abort reason', async () => {
    const controller = new AbortController();
    const send = vi.fn<() => Promise<Response>>(async () => limited('20'));
    const pending = fetchWithRateLimitRetry(send, { signal: controller.signal, notify: () => undefined });
    let failure: unknown;
    pending.catch((error: unknown) => { failure = error; });
    await vi.advanceTimersByTimeAsync(5000);
    const reason = new Error('fixture deadline');
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(failure).toBe(reason);
    expect(send).toHaveBeenCalledTimes(1);
  });

  describe('through the shared PublicAPI client', () => {
    test('a POST is retried on 429 with the same body, but not on 500', async () => {
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(limited('2'))
        .mockResolvedValueOnce(new Response('{"id":"created"}', { status: 201 }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new PlatformAPIClient('https://example.test/public', 'fixture-tenant');

      const response = await settle(client.syncStorageSchema({ objectTypes: ['task'] }), 2000);

      expect(response.status).toBe(201);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [first, second] = fetchMock.mock.calls;
      expect(first[1]?.method).toBe('POST');
      expect(second[0]).toBe(first[0]);
      expect(second[1]?.body).toBe(first[1]?.body);

      const failing = vi.fn<typeof fetch>(async () => new Response('{"detail":"boom"}', { status: 500 }));
      vi.stubGlobal('fetch', failing);
      const serverError = await client.syncStorageSchema({ objectTypes: ['task'] });
      expect(serverError.status).toBe(500);
      expect(failing).toHaveBeenCalledTimes(1);
    });

    test('wait lines go to stderr only, so JSON on stdout stays clean', async () => {
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.stubGlobal('fetch', vi.fn<typeof fetch>()
        .mockResolvedValueOnce(limited('3'))
        .mockResolvedValueOnce(new Response('{"items":[{"slug":"task"}]}', { status: 200 })));
      const client = new PlatformAPIClient('https://example.test/public', 'fixture-tenant');

      const response = await settle(client.getSchema(), 3000);

      expect(await response.json()).toEqual({ items: [{ slug: 'task' }] });
      expect(stdout).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(String(stderr.mock.calls[0][0])).toContain('Rate limited, retrying in 3s (attempt 1/4)');
    });

    test('a polled read in a long-running loop waits instead of failing the loop', async () => {
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(limited('5'))
        .mockResolvedValueOnce(new Response('{"objectTypes":[]}', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new PlatformAPIClient('https://example.test/public', 'fixture-tenant');

      const pending = client.getResourceStorageSchemaStatus();
      await vi.advanceTimersByTimeAsync(4999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const response = await settle(pending, 1);
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});

describe('types seed polling and rate limits', () => {
  afterEach(() => vi.restoreAllMocks());

  test('schema-visibility polling stops on an exhausted rate limit instead of polling on', async () => {
    const { waitForResourceApiSchemaVisibility } = await import('../../src/commands/types.js');
    const client = {
      getResourceStorageSchemaStatus: vi.fn(async () => { throw new PublicApiRateLimitedError(RATE_LIMIT_MAX_RETRIES + 1); }),
      getSchema: vi.fn(async () => new Response('{}', { status: 200 })),
    } as unknown as PlatformAPIClient;

    await expect(waitForResourceApiSchemaVisibility(client, 'fixture-tenant', ['Task'], { status: 'queued' }, {
      attempts: 45, delayMs: 0,
    })).rejects.toThrow(PUBLIC_API_RATE_LIMITED_MESSAGE);
    expect(client.getResourceStorageSchemaStatus).toHaveBeenCalledTimes(1);
    expect(client.getSchema).not.toHaveBeenCalled();
  });
});
