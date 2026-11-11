import { afterEach, describe, expect, test, vi } from 'vitest';
import { PlatformAPIClient } from '../../src/lib/api.js';
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
  ])('rejects %o', (changes, code) => {
    expect(() => validateManagedDeployInput('my-app', { ...base, ...changes } as ManagedDeployOptions))
      .toThrow(expect.objectContaining({ code }));
  });
});
