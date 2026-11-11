import { afterEach, describe, expect, test, vi } from 'vitest';
import { PlatformAPIClient, isManagedPublicRequestTimeout } from '../../src/lib/api.js';
import * as auth from '../../src/lib/auth.js';
import * as profile from '../../src/lib/profile.js';
import { responseOperation } from '../../src/lib/eai-managed-source-operation-client.js';
import { recoverFailedCliManagedReview } from '../../src/lib/eai-managed-source-review-failure-client.js';
import { validateManagedDeployInput } from '../../src/commands/eai-managed-deploy-validation.js';
import type { CliManagedSourceScope } from '../../src/lib/eai-managed-source-client.js';
import type { ManagedDeployOptions } from '../../src/commands/eai-managed-deploy-contract.js';

const scope: CliManagedSourceScope = { tenantId: 'company', appKey: 'my-app', targetTenantId: 'runtime', environment: 'preview', actorId: 'eai-user-oid' };
const operationId = 'cli-managed-' + 'e'.repeat(32);
const portal = 'https://test-admin-portal.myenterprise.ai';
const failedChecks = [{
  name: 'Validate generated source',
  conclusion: 'failure',
  checkRunId: 1,
  htmlUrl: 'https://github.com/eai-generated-apps/app/runs/1',
}];
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => { vi.restoreAllMocks(); profile.setActiveProfile('default'); });

function client(): PlatformAPIClient {
  vi.spyOn(auth, 'getAccessToken').mockResolvedValue('cli-access-token');
  return new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', scope.tenantId);
}

describe('EAI-managed review failure recovery', () => {
  test('posts only the exact operation scope with the CLI bearer and returns the failing checks', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({
      operationId, status: 'failed', error: { code: 'managed_review_checks_failed', failedChecks },
    }));
    const result = await recoverFailedCliManagedReview(client(), scope, operationId, portal);
    expect(result).toEqual({
      operationId,
      status: 'failed',
      failedChecks: [{ name: 'Validate generated source', conclusion: 'failure', htmlUrl: failedChecks[0].htmlUrl }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${portal}/api/platform/generated-apps/cli-managed-source/managed-review-failure`);
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer cli-access-token');
    expect(JSON.parse(String(init!.body))).toEqual({
      tenantId: 'company', appKey: 'my-app', targetTenantId: 'runtime', environment: 'preview', operationId,
    });
    expect(init!.redirect).toBe('error');
  });

  test('shows the Portal refusal reason without echoing anything unsafe', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(
      { error: 'cli_managed_review_failure', message: 'EAI review checks are still running; try again when they finish.' }, 409,
    ));
    await expect(recoverFailedCliManagedReview(client(), scope, operationId, portal)).rejects.toMatchObject({
      code: 'MANAGED_REVIEW_RECOVERY_REFUSED',
      message: 'EAI review checks are still running; try again when they finish.',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(
      { error: 'cli_managed_review_failure', message: 'Bearer abc leaked' }, 409,
    ));
    await expect(recoverFailedCliManagedReview(client(), scope, operationId, portal)).rejects.toMatchObject({
      message: 'The EAI review could not be recovered (409). Nothing else was changed.',
    });
  });

  test('strips terminal control sequences and refuses links that are not plain GitHub URLs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({
      operationId, status: 'failed',
      error: { code: 'managed_review_checks_failed', failedChecks: [{ ...failedChecks[0], name: 'Validate\u001b[31m source' }] },
    }));
    const result = await recoverFailedCliManagedReview(client(), scope, operationId, portal);
    expect(result.failedChecks[0].name).toBe('Validate[31m source');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({
      operationId, status: 'failed',
      error: { code: 'managed_review_checks_failed', failedChecks: [{ ...failedChecks[0], htmlUrl: 'https://github.com/x/\u001b]8;;evil' }] },
    }));
    await expect(recoverFailedCliManagedReview(client(), scope, operationId, portal)).rejects.toMatchObject({
      code: 'MANAGED_REVIEW_RECOVERY_UNCERTAIN',
    });
  });

  test('strips Unicode format and bidi characters from check names', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({
      operationId, status: 'failed',
      error: { code: 'managed_review_checks_failed', failedChecks: [{ ...failedChecks[0], name: 'Validate\u202e\u200b\u2066 source\ufeff', conclusion: 'fail\u200dure' }] },
    }));
    const result = await recoverFailedCliManagedReview(client(), scope, operationId, portal);
    expect(result.failedChecks[0]).toMatchObject({ name: 'Validate source', conclusion: 'failure' });
  });

  test.each(['null', '[]', '"failed"', '42'])('treats a successful non-object body %s as uncertain', async body => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
    await expect(recoverFailedCliManagedReview(client(), scope, operationId, portal)).rejects.toMatchObject({
      code: 'MANAGED_REVIEW_RECOVERY_UNCERTAIN',
    });
  });

  test.each([200, 409, 503])('treats a failed body read after a %i response as uncertain', async status => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new TypeError('socket reset')); },
    }), { status }));
    await expect(recoverFailedCliManagedReview(client(), scope, operationId, portal)).rejects.toMatchObject({
      code: 'MANAGED_REVIEW_RECOVERY_UNCERTAIN',
      message: expect.stringContaining(`--recover-failed-review ${operationId}`),
    });
  });

  test('treats a body read that outlives the managed deadline as uncertain', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
      start() { /* never delivers */ },
    }), { status: 409 }));
    const managed = client();
    const controller = new AbortController();
    vi.spyOn(managed, 'managedSourceUploadSignal').mockReturnValue(controller.signal);
    const pending = recoverFailedCliManagedReview(managed, scope, operationId, portal);
    setTimeout(() => controller.abort(new Error('deadline')), 10);
    await expect(pending).rejects.toMatchObject({ code: 'MANAGED_REVIEW_RECOVERY_UNCERTAIN' });
  });

  test('stops reading an oversized Portal response instead of buffering it', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(16 * 1024).fill(0x20);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      pull(controller) { pulled += 1; controller.enqueue(chunk); },
    }), { status: 200 }));
    await expect(recoverFailedCliManagedReview(client(), scope, operationId, portal)).rejects.toMatchObject({
      code: 'MANAGED_REVIEW_RECOVERY_UNCERTAIN',
    });
    expect(pulled).toBeLessThan(10);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x'.repeat(1024 * 1024), { status: 409 }));
    await expect(recoverFailedCliManagedReview(client(), scope, operationId, portal)).rejects.toMatchObject({
      code: 'MANAGED_REVIEW_RECOVERY_REFUSED',
      message: 'The EAI review could not be recovered (409). Nothing else was changed.',
    });
  });

  test('treats a mismatched result as uncertain', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({
      operationId: 'cli-managed-' + 'f'.repeat(32), status: 'failed', error: { code: 'managed_review_checks_failed', failedChecks },
    }));
    await expect(recoverFailedCliManagedReview(client(), scope, operationId, portal)).rejects.toMatchObject({
      code: 'MANAGED_REVIEW_RECOVERY_UNCERTAIN',
    });
  });

  test('refuses an unapproved Portal or operation before sending anything', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(recoverFailedCliManagedReview(client(), scope, operationId, 'https://attacker.example')).rejects.toMatchObject({
      code: 'MANAGED_REVIEW_RECOVERY_INVALID',
    });
    await expect(recoverFailedCliManagedReview(client(), scope, 'source-unknown-1', portal)).rejects.toMatchObject({
      code: 'MANAGED_REVIEW_RECOVERY_INVALID',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('safe managed-source conflicts (Issues2025#3637)', () => {
  test('names an active earlier publish and the recovery command', async () => {
    await expect(responseOperation(json(
      { error: 'CLI_MANAGED_SOURCE_OPERATION_ACTIVE', message: 'An earlier CLI managed source operation is still active.' }, 409,
    ))).rejects.toMatchObject({
      code: 'CLI_MANAGED_SOURCE_OPERATION_ACTIVE',
      message: expect.stringContaining('--recover-failed-review <operation-id>'),
    });
  });

  test('keeps unknown rejections generic', async () => {
    await expect(responseOperation(json(
      { error: 'CLI_MANAGED_SOURCE_UPSTREAM_REJECTED', message: 'The managed source request was rejected.' }, 409,
    ))).rejects.toMatchObject({ code: 'MANAGED_SOURCE_UNAVAILABLE' });
  });

  test.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])('does not read inherited guidance for %s', async code => {
    await expect(responseOperation(json({ error: code }, 409))).rejects.toMatchObject({
      code: 'MANAGED_SOURCE_UNAVAILABLE',
      message: expect.stringContaining('Managed source operation is unavailable (409)'),
    });
  });

  test('keeps the managed request timeout when a 409 body read expires', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const signal = init!.signal!;
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        const alive = setInterval(() => {}, 1000);
        signal.addEventListener('abort', () => { clearInterval(alive); controller.error(signal.reason); }, { once: true });
      } });
      return new Response(body, { status: 409 });
    });
    const response = await new PlatformAPIClient('https://example.test', 'tenant-parent')
      .getAppProvisioningJob('planning-portal', 'app-prov-owned', 'runtime-child', 25);
    let error: unknown;
    try { await responseOperation(response); } catch (caught) { error = caught; }
    expect(isManagedPublicRequestTimeout(error)).toBe(true);
  });
});

describe('--recover-failed-review input', () => {
  const base = {
    target: 'eai', tenantId: 'company', targetTenantId: 'runtime', workflow: '.github/workflows/eai-app.yml',
    environment: 'preview', timeout: '60', branch: 'main', format: 'text',
  } as unknown as ManagedDeployOptions;

  test('accepts one exact EAI-maintained operation ID', () => {
    expect(validateManagedDeployInput('my-app', { ...base, recoverFailedReview: operationId }).recoverReviewOperationId)
      .toBe(operationId);
  });

  test.each([
    [{ recoverFailedReview: operationId, resume: operationId }, 'DEPLOY_MODE_CONFLICT'],
    [{ recoverFailedReview: operationId, retry: operationId }, 'DEPLOY_MODE_CONFLICT'],
    [{ recoverFailedReview: 'source-unknown-abc123' }, 'SOURCE_OPERATION_ID_INVALID'],
    [{ recoverFailedReview: operationId, source: 'eai-managed' }, 'RECOVERY_OPTION_CONFLICT'],
    [{ recoverFailedReview: operationId, source: 'customer-owned' }, 'RECOVERY_OPTION_CONFLICT'],
    [{ recoverFailedReview: operationId, repo: 'customer/app' }, 'RECOVERY_OPTION_CONFLICT'],
    [{ recoverFailedReview: operationId, githubLinkSession: 'github-link-123' }, 'RECOVERY_OPTION_CONFLICT'],
    [{ recoverFailedReview: operationId, installationId: '123' }, 'RECOVERY_OPTION_CONFLICT'],
    [{ recoverFailedReview: operationId, commit: 'a'.repeat(40) }, 'RECOVERY_OPTION_CONFLICT'],
    [{ recoverFailedReview: operationId, branch: 'release' }, 'RECOVERY_OPTION_CONFLICT'],
  ])('rejects %o', (changes, code) => {
    expect(() => validateManagedDeployInput('my-app', { ...base, ...changes } as ManagedDeployOptions))
      .toThrow(expect.objectContaining({ code }));
  });
});
