import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { DirectSourceClient, pollDirectSourceOperation, directSourceRequestBody, directSourceIdempotencyKey, directSourceRetryIdempotencyKey, validateDirectSourceOperation, directSourceTransitionLine } from '../../src/lib/eai-direct-source-client.js';
import { chooseManagedDeploySource } from '../../src/lib/eai-managed-source.js';
vi.mock('../../src/lib/auth.js', () => ({ getAccessToken: vi.fn(async () => 'test-token') }));
const scope = { tenantId: 'tenant-a', targetTenantId: 'runtime-a', appKey: 'test-app', environment: 'dev', actorId: 'actor-a' };
const digest = `sha256:${'a'.repeat(64)}`;
const bundle = { schemaVersion: 'eai.cli_managed_source_bundle.v2', templateCommitSha: 'b'.repeat(40), bundleSha256: digest, configHash: digest, files: [{ path: 'app/page.tsx', content: 'hello', encoding: 'utf8' }] };
const operation = { schemaVersion: 'eai.direct_source_operation.v1', operationId: 'direct-abc123', sourceMode: 'direct', ...scope, status: 'ready', bundleSha256: digest, templateCommitSha: bundle.templateCommitSha, configHash: digest, repository: null, imageDigest: `registry.test/app@${digest}`, activeUrl: 'https://app.example.test', createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z' };
describe('direct source contract', () => {
  it('retains canonical v2 bundle digests and exact file bytes in upload', async () => {
    const body = JSON.parse(await directSourceRequestBody(scope, bundle as never).text());
    expect(body.bundleSha256).toBe(digest);
    expect(body.bundle).toEqual(bundle);
    expect(directSourceIdempotencyKey(scope, digest)).toBe(createHash('sha256').update(`tenant-a|test-app|runtime-a|dev|${digest}`).digest('hex'));
  });
  it('defaults an unlinked app to direct without prompting', async () => {
    await expect(chooseManagedDeploySource({ format: 'json', githubLinked: false }, false)).resolves.toBe('direct');
    await expect(chooseManagedDeploySource({ format: 'json', githubLinked: true }, false)).rejects.toThrow('Choose --source');
  });
  it('accepts a fully bound ready projection and produces its live URL', () => {
    expect(directSourceTransitionLine(validateDirectSourceOperation(operation, scope))).toBe('ready https://app.example.test (operation direct-abc123)');
    expect(validateDirectSourceOperation(operation, scope)).toMatchObject({ retryOf: null, attempt: 1 });
  });
  it('binds retry lineage and rejects malformed or changed attempts', () => {
    const child = { ...operation, operationId: 'direct-child-123', retryOf: operation.operationId, attempt: 2 };
    expect(validateDirectSourceOperation(child, scope, { retryOf: operation.operationId, attempt: 2 })).toMatchObject({ retryOf: operation.operationId, attempt: 2 });
    expect(() => validateDirectSourceOperation({ ...child, attempt: 1 }, scope)).toThrow('does not match');
    expect(() => validateDirectSourceOperation({ ...child, retryOf: 'direct-other-123' }, scope, { retryOf: operation.operationId })).toThrow('does not match');
    expect(() => validateDirectSourceOperation({ ...child, attempt: 4 }, scope)).toThrow('does not match');
  });
  it.each(['tenantId', 'targetTenantId', 'appKey', 'actorId', 'environment'])('rejects a mismatched %s', (field) => {
    expect(() => validateDirectSourceOperation({ ...operation, [field]: 'wrong' }, scope)).toThrow('does not match');
  });
  it.each(['javascript:alert(1)', 'http://app.example.test', 'https://user:secret@example.test'])('rejects unsafe ready URL %s', (activeUrl) => {
    expect(() => validateDirectSourceOperation({ ...operation, activeUrl }, scope)).toThrow();
  });
});

describe('direct source transport and observation', () => {
  const client = { assertProfileAuthority: vi.fn(), managedSourceUploadSignal: () => AbortSignal.timeout(10_000), managedRequestSignal: () => AbortSignal.timeout(10_000) };
  it('checks both server-side anchors before defaulting an app to direct', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 404 })).mockResolvedValueOnce(new Response('{}', { status: 404 }));
    const transport = new DirectSourceClient(client as never, 'https://dev-api.au.myenterprise.ai/public', scope.tenantId, { fetch });
    await expect(transport.hasLinkedSource(scope)).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([200, 409])('preserves existing or incomplete GitHub source authority (%s)', async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status }));
    const transport = new DirectSourceClient(client as never, 'https://dev-api.au.myenterprise.ai/public', scope.tenantId, { fetch });
    await expect(transport.hasLinkedSource(scope)).resolves.toBe(true);
  });
  it('does not mistake failed source discovery for an unlinked app', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    const transport = new DirectSourceClient(client as never, 'https://dev-api.au.myenterprise.ai/public', scope.tenantId, { fetch });
    await expect(transport.hasLinkedSource(scope)).rejects.toMatchObject({ code: 'SOURCE_LINK_STATUS_UNAVAILABLE' });
  });
  it('submits the same idempotent body after rate limiting without following redirects', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '0' } })).mockResolvedValueOnce(new Response(JSON.stringify(operation), { status: 202 }));
    const transport = new DirectSourceClient(client as never, 'https://dev-api.au.myenterprise.ai/public', scope.tenantId, { fetch, sleep: async () => {} });
    await expect(transport.submit(scope, bundle as never)).resolves.toMatchObject({ status: 'ready' });
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = fetch.mock.calls[0][1];
    expect(first.redirect).toBe('error');
    expect(first.headers['Idempotency-Key']).toBe(fetch.mock.calls[1][1].headers['Idempotency-Key']);
    expect(first.body).toBe(fetch.mock.calls[1][1].body);
  });
  it('retries a sealed failed parent with the same bounded body and replay key', async () => {
    const failed = validateDirectSourceOperation({ ...operation, status: 'failed', activeUrl: null, failure: { reason: 'build_failed', message: 'Transient registry failure' } }, scope);
    const child = { ...failed, operationId: 'direct-child-123', status: 'accepted', failure: null, retryOf: failed.operationId, attempt: 2 };
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '0' } })).mockResolvedValueOnce(new Response(JSON.stringify(child), { status: 202 }));
    const transport = new DirectSourceClient(client as never, 'https://dev-api.au.myenterprise.ai/public', scope.tenantId, { fetch, sleep: async () => {} });
    await expect(transport.retry(scope, failed, bundle as never)).resolves.toMatchObject({ operationId: child.operationId, retryOf: failed.operationId, attempt: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toContain(`/source-direct/operations/${failed.operationId}/retry`);
    const first = fetch.mock.calls[0][1];
    const second = fetch.mock.calls[1][1];
    expect(first.headers['Idempotency-Key']).toBe(directSourceRetryIdempotencyKey(failed.operationId, digest));
    expect(first.headers['Idempotency-Key']).toBe(second.headers['Idempotency-Key']);
    expect(first.body).toBe(second.body);
    expect(first.redirect).toBe('error');
    expect(JSON.parse(await (first.body as Blob).text()).bundle).toEqual(bundle);
  });
  it('rejects changed source, nonfailed parents, exhausted attempts and wrong child lineage before claiming success', async () => {
    const failed = validateDirectSourceOperation({ ...operation, status: 'failed', activeUrl: null, failure: { reason: 'build_failed', message: 'Transient failure' } }, scope);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...failed, operationId: 'direct-child-123', status: 'accepted', failure: null, retryOf: 'direct-wrong-123', attempt: 2 }), { status: 202 }));
    const transport = new DirectSourceClient(client as never, 'https://dev-api.au.myenterprise.ai/public', scope.tenantId, { fetch });
    await expect(transport.retry(scope, failed, { ...bundle, configHash: 'changed' } as never)).rejects.toMatchObject({ code: 'DIRECT_SOURCE_BINDING_MISMATCH' });
    await expect(transport.retry(scope, validateDirectSourceOperation(operation, scope), bundle as never)).rejects.toMatchObject({ code: 'DIRECT_SOURCE_BINDING_MISMATCH' });
    await expect(transport.retry(scope, { ...failed, retryOf: 'direct-prior-123', attempt: 3 }, bundle as never)).rejects.toMatchObject({ code: 'DIRECT_SOURCE_BINDING_MISMATCH' });
    expect(fetch).not.toHaveBeenCalled();
    await expect(transport.retry(scope, failed, bundle as never)).rejects.toMatchObject({ code: 'DIRECT_SOURCE_BINDING_MISMATCH' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reports lost retry response as replayable with the same parent and source', async () => {
    const failed = validateDirectSourceOperation({ ...operation, status: 'failed', activeUrl: null, failure: { reason: 'build_failed', message: 'Transient failure' } }, scope);
    const child = { ...failed, operationId: 'direct-child-123', status: 'accepted', failure: null, retryOf: failed.operationId, attempt: 2 };
    const fetch = vi.fn().mockRejectedValueOnce(new Error('connection reset')).mockResolvedValueOnce(new Response(JSON.stringify(child), { status: 200 }));
    const transport = new DirectSourceClient(client as never, 'https://dev-api.au.myenterprise.ai/public', scope.tenantId, { fetch });
    await expect(transport.retry(scope, failed, bundle as never)).rejects.toMatchObject({ code: 'DIRECT_SOURCE_RETRY_UNCERTAIN' });
    await expect(transport.retry(scope, failed, bundle as never)).resolves.toMatchObject({ operationId: child.operationId });
    expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(fetch.mock.calls[1][1].headers['Idempotency-Key']);
  });
  it('reports each transition and stops at failure with a previously live URL', async () => {
    const accepted = validateDirectSourceOperation({ ...operation, status: 'accepted', activeUrl: null }, scope);
    const building = validateDirectSourceOperation({ ...operation, status: 'building', activeUrl: null }, scope);
    const failed = validateDirectSourceOperation({ ...operation, status: 'failed', activeUrl: null, failure: { reason: 'build_failed', message: 'Compile failed' } }, scope);
    const read = vi.fn().mockResolvedValueOnce({ operation: building }).mockResolvedValueOnce({ operation: building }).mockResolvedValueOnce({ operation: failed });
    const onTransition = vi.fn();
    const result = await pollDirectSourceOperation({ read } as never, scope, operation.operationId, { wait: true, timeoutMs: 10_000, sleep: async () => {}, random: () => 0.5, onTransition }, accepted);
    expect(result.status).toBe('failed');
    expect(result.activeUrl).toBeNull();
    expect(onTransition.mock.calls.map(call => call[1].status)).toEqual(['accepted', 'building', 'failed']);
    expect(read).toHaveBeenCalledTimes(3);
  });
});
