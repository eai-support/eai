import { afterEach, describe, expect, test, vi } from 'vitest';
import { PlatformAPIClient, type CliManagedGithubLinkSession } from '../../src/lib/api.js';
import * as auth from '../../src/lib/auth.js';
import { classifyCliManagedSourceOperation, cliManagedPortalOrigin, cliManagedSourceIdempotencyKey, pollCliManagedSource, resumeCliManagedSourceUpload, submitCliManagedSource, validateCliGithubLinkSession, verifyCliGithubIdentity, type CliManagedSourceOperation, type CliManagedSourceScope } from '../../src/lib/eai-managed-source-client.js';

const scope: CliManagedSourceScope = { tenantId: 'company', appKey: 'my-app', targetTenantId: 'runtime', environment: 'preview', actorId: 'eai-user-oid' };
function session(status: CliManagedGithubLinkSession['status'] = 'verified'): CliManagedGithubLinkSession {
  return {
    schemaVersion: 'eai.cli_managed_github_link_session.v1', sessionId: 'github-link-123', ...scope, status,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    browserUrl: 'https://dev-admin-portal.myenterprise.ai/api/platform/generated-apps/github-user?ticket=fixture',
    ...(status === 'verified' ? { verifiedGithubUser: { id: 123, login: 'linked-user', proofId: 'proof-123', actorId: scope.actorId } } : {}),
  };
}
const response = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200 });
afterEach(() => { vi.restoreAllMocks(); });

describe('actor-bound GitHub linking', () => {
  test('uses existing verified identity without opening a browser or requiring local gh', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const create = vi.spyOn(client, 'createCliManagedGithubLinkSession').mockResolvedValue(response(session()));
    const openBrowser = vi.fn();
    expect((await verifyCliGithubIdentity(client, scope, { interactive: false, timeoutMs: 1000 }, { openBrowser })).verifiedGithubUser?.id).toBe(123);
    expect(openBrowser).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith('company', 'my-app', expect.objectContaining({ targetTenantId: 'runtime', environment: 'preview', schemaVersion: 'eai.cli_managed_github_link.v1', idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/) }));
  });

  test('opens the platform handoff and polls only its exact actor-bound session', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    vi.spyOn(client, 'createCliManagedGithubLinkSession').mockResolvedValue(response(session('pending')));
    const read = vi.spyOn(client, 'getCliManagedGithubLinkSession').mockResolvedValue(response(session()));
    const openBrowser = vi.fn(async () => {});
    const result = await verifyCliGithubIdentity(client, scope, { interactive: true, timeoutMs: 1000 }, { openBrowser, sleep: async () => {} });
    expect(result.status).toBe('verified');
    expect(read).toHaveBeenCalledExactlyOnceWith('company', 'my-app', 'github-link-123', 'runtime', 'preview');
    expect(openBrowser).toHaveBeenCalledExactlyOnceWith(session().browserUrl);
  });

  test('backs off a pending browser handoff after 30 seconds without exceeding its deadline', async () => {
    let now = Date.parse('2026-09-24T00:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const pending = { ...session('pending'), expiresAt: new Date(now + 1_200_000).toISOString() };
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    vi.spyOn(client, 'createCliManagedGithubLinkSession').mockResolvedValue(response(pending));
    const read = vi.spyOn(client, 'getCliManagedGithubLinkSession').mockImplementation(async () => response(pending));
    const delays: number[] = [];
    await expect(verifyCliGithubIdentity(client, scope, { interactive: true, timeoutMs: 600_000 }, {
      openBrowser: async () => {},
      sleep: async ms => { delays.push(ms); now += ms; },
    })).rejects.toMatchObject({ code: 'GITHUB_LINK_PENDING' });
    expect(now).toBe(Date.parse('2026-09-24T00:10:00Z'));
    expect(delays.slice(0, 15)).toEqual(Array(15).fill(2_000));
    expect(delays.slice(15)).toEqual(Array(114).fill(5_000));
    expect(read).toHaveBeenCalledTimes(129);
    expect(read).toHaveBeenCalledWith('company', 'my-app', 'github-link-123', 'runtime', 'preview');
  });

  test('returns an actionable browser handoff for noninteractive callers without mutating source', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    vi.spyOn(client, 'createCliManagedGithubLinkSession').mockResolvedValue(response(session('pending')));
    await expect(verifyCliGithubIdentity(client, scope, { interactive: false, timeoutMs: 1000 })).rejects.toMatchObject({ code: 'GITHUB_LINK_REQUIRED', message: expect.stringContaining('--github-link-session github-link-123') });
  });

  test('resumes the named handoff without creating another session', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const create = vi.spyOn(client, 'createCliManagedGithubLinkSession');
    vi.spyOn(client, 'getCliManagedGithubLinkSession').mockResolvedValue(response(session()));
    await verifyCliGithubIdentity(client, scope, { sessionId: 'github-link-123', interactive: false, timeoutMs: 1000 });
    expect(create).not.toHaveBeenCalled();
  });

  test.each(['actorId', 'tenantId', 'appKey', 'targetTenantId', 'environment', 'sessionId'] as const)('rejects a different %s from the server', key => {
    expect(() => validateCliGithubLinkSession({ ...session(), [key]: 'other' }, scope, 'github-link-123')).toThrow('does not match');
  });

  test('rejects an identity proof attached to another EAI actor', () => {
    const value = session();
    value.verifiedGithubUser!.actorId = 'other-user';
    expect(() => validateCliGithubLinkSession(value, scope)).toThrow('valid GitHub identity proof');
  });

  test('rejects a verified status without independent GitHub proof', () => {
    const value = session();
    delete value.verifiedGithubUser;
    expect(() => validateCliGithubLinkSession(value, scope)).toThrow('valid GitHub identity proof');
  });

  test('rejects stale browser authority', () => {
    expect(() => validateCliGithubLinkSession({ ...session(), expiresAt: '2000-01-01T00:00:00Z' }, scope)).toThrow('expired');
  });

  test.each(['http://dev-admin-portal.myenterprise.ai/link', 'https://user:secret@dev-admin-portal.myenterprise.ai/link', 'file:///tmp/link', 'https://dev-admin-portal.myenterprise.ai/link#fragment'])('refuses an unsafe browser URL %s', browserUrl => {
    expect(() => validateCliGithubLinkSession({ ...session(), browserUrl }, scope)).toThrow('approved EAI Portal origin');
  });

  test.each([
    'https://attacker.example/api/platform/generated-apps/github-user?ticket=fixture',
    'https://admin-portal.myenterprise.ai.evil.example/api/platform/generated-apps/github-user?ticket=fixture',
    'https://admin-portal.au.myenterprise.ai/api/platform/generated-apps/github-user?ticket=fixture',
    'https://admin.ca.myenterprise.ai/api/platform/generated-apps/github-user?ticket=fixture',
    'https://admin-portal.myenterprise.ai/api/platform/generated-apps/github-user?ticket=one&ticket=two',
    'https://admin-portal.myenterprise.ai/api/platform/generated-apps/github-user?ticket=fixture&redirect=evil',
    'https://admin-portal.myenterprise.ai/api/platform/generated-apps/other?ticket=fixture',
  ])('rejects an unapproved or malformed returned Portal handoff %s', browserUrl => {
    expect(() => validateCliGithubLinkSession({ ...session(), browserUrl }, scope)).toThrow('approved EAI Portal origin');
  });

  test('pins the authenticated handoff origin even for already verified sessions', () => {
    expect(cliManagedPortalOrigin(validateCliGithubLinkSession(session(), scope))).toBe('https://dev-admin-portal.myenterprise.ai');
  });

  test.each([
    'https://test-admin-portal.myenterprise.ai',
    'https://admin-portal.myenterprise.ai',
    'https://admin-portal.ca.myenterprise.ai',
    'https://admin-portal.eu.myenterprise.ai',
  ])('accepts the exact staged Portal origin %s', (origin) => {
    const value = { ...session(), browserUrl: `${origin}/api/platform/generated-apps/github-user?ticket=fixture` };
    expect(cliManagedPortalOrigin(validateCliGithubLinkSession(value, scope))).toBe(origin);
  });
});

describe('managed publication authority and readiness', () => {
  const bundle = { schemaVersion: 'eai.cli_managed_source_bundle.v1' as const, templateCommitSha: 'a'.repeat(40), bundleSha256: `sha256:${'b'.repeat(64)}`, configHash: `sha256:${'d'.repeat(64)}`, files: [{ path: 'src/app/page.tsx', type: 'file' as const, size: 3, sha256: `sha256:${'c'.repeat(64)}`, contentBase64: 'YXBw' }] };
  function operation(status: CliManagedSourceOperation['status'] = 'accepted'): CliManagedSourceOperation {
    return {
      schemaVersion: 'eai.cli_managed_source_operation.v1', sourceMode: 'eai-cli-generated', ...scope,
      operationId: 'cli-managed-source-123', status, githubLinkSessionId: 'github-link-123', templateCommitSha: bundle.templateCommitSha, bundleSha256: bundle.bundleSha256, configHash: bundle.configHash,
      verifiedGithubUser: session().verifiedGithubUser!, repository: { owner: 'eai-generated-apps', name: 'platform-derived-app', private: true },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      upload: { url: 'https://dev-admin-portal.myenterprise.ai/api/platform/generated-apps/cli-managed-source/uploads/cli-managed-source-123', ticket: 'one-use-upload-proof', sha256: bundle.bundleSha256, expiresAt: new Date(Date.now() + 300_000).toISOString() },
    };
  }

  test('keeps idempotency stable for the exact source and different across actors or deployment scopes', () => {
    const key = cliManagedSourceIdempotencyKey(scope, bundle.bundleSha256);
    expect(key).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(cliManagedSourceIdempotencyKey(scope, bundle.bundleSha256)).toBe(key);
    for (const field of ['actorId', 'tenantId', 'appKey', 'targetTenantId'] as const) expect(cliManagedSourceIdempotencyKey({ ...scope, [field]: 'other' }, bundle.bundleSha256)).not.toBe(key);
    expect(cliManagedSourceIdempotencyKey(scope, `sha256:${'d'.repeat(64)}`)).not.toBe(key);
  });

  test('uploads exact source through scoped one-use authority and reads authoritative operation status', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const prepare = vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(operation()));
    const read = vi.spyOn(client, 'getCliManagedSourceOperation').mockResolvedValue(response(operation('pending_review')));
    vi.spyOn(auth, 'getAccessToken').mockResolvedValue('fixture-eai-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ status: 'pending_review' }));
    const result = await submitCliManagedSource(client, scope, session(), bundle);
    expect(result.status).toBe('pending_review');
    expect(prepare).toHaveBeenCalledWith('company', 'my-app', expect.objectContaining({ githubLinkSessionId: 'github-link-123', bundleSha256: bundle.bundleSha256, fileCount: 1, totalBytes: 3, targetTenantId: 'runtime', environment: 'preview' }));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(operation().upload!.url, expect.objectContaining({ method: 'POST', redirect: 'error', body: JSON.stringify({ tenantId: scope.tenantId, appKey: scope.appKey, targetTenantId: scope.targetTenantId, environment: scope.environment, bundle }), headers: { Authorization: 'Bearer fixture-eai-token', 'Content-Type': 'application/json', 'X-EAI-Upload-Ticket': 'one-use-upload-proof' } }));
    expect(read).toHaveBeenCalledExactlyOnceWith('company', 'my-app', 'cli-managed-source-123', 'runtime', 'preview');
  });

  test.each([
    { url: 'https://attacker.example/upload' },
    { url: 'http://dev-admin-portal.myenterprise.ai/api/platform/generated-apps/cli-managed-source/uploads/cli-managed-source-123' },
    { url: 'https://dev-admin-portal.myenterprise.ai/api/platform/generated-apps/cli-managed-source/uploads/other-operation' },
    { url: 'https://dev-admin-portal.myenterprise.ai/api/platform/generated-apps/cli-managed-source/uploads/cli-managed-source-123?redirect=elsewhere' },
    { sha256: `sha256:${'f'.repeat(64)}` }, { expiresAt: '2000-01-01T00:00:00Z' }, { ticket: '' },
  ])('refuses mismatched upload authority before reading a token or sending bytes: %j', async changed => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const prepared = operation();
    prepared.upload = { ...prepared.upload!, ...changed };
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(prepared));
    const token = vi.spyOn(auth, 'getAccessToken');
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(submitCliManagedSource(client, scope, session(), bundle)).rejects.toMatchObject({ code: 'MANAGED_SOURCE_UPLOAD_INVALID' });
    expect(token).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("replays an in-progress publication with the original ticket and exact bundle", async () => {
    const client = new PlatformAPIClient(
      "https://api.example.test/public",
      scope.tenantId,
    );
    vi.spyOn(client, "prepareCliManagedSource").mockResolvedValue(
      response(operation("publishing")),
    );
    vi.spyOn(client, "getCliManagedSourceOperation").mockResolvedValue(
      response(operation("pending_review")),
    );
    vi.spyOn(auth, "getAccessToken").mockResolvedValue("fixture-eai-token");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response({ status: "pending_review" }));
    expect(
      (await submitCliManagedSource(client, scope, session(), bundle)).status,
    ).toBe("pending_review");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      operation().upload!.url,
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-EAI-Upload-Ticket": operation().upload!.ticket,
        }),
      }),
    );
  });

  test("resumes a publishing upload through the original verified link without another preparation", async () => {
    const client = new PlatformAPIClient(
      "https://api.example.test/public",
      scope.tenantId,
    );
    const create = vi.spyOn(client, "createCliManagedGithubLinkSession");
    const prepare = vi.spyOn(client, "prepareCliManagedSource");
    const linkRead = vi
      .spyOn(client, "getCliManagedGithubLinkSession")
      .mockResolvedValue(response(session()));
    vi.spyOn(client, "getCliManagedSourceOperation").mockResolvedValue(
      response(operation("pending_review")),
    );
    vi.spyOn(auth, "getAccessToken").mockResolvedValue("fixture-eai-token");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response({ status: "pending_review" }));
    expect(
      (
        await resumeCliManagedSourceUpload(
          client,
          scope,
          operation("publishing"),
          bundle,
        )
      ).status,
    ).toBe("pending_review");
    expect(linkRead).toHaveBeenCalledExactlyOnceWith(
      "company",
      "my-app",
      "github-link-123",
      "runtime",
      "preview",
    );
    expect(create).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("allows exact upload retry after verified link expiry while its original ticket remains valid", async () => {
    const client = new PlatformAPIClient(
      "https://api.example.test/public",
      scope.tenantId,
    );
    const expiredVerified = {
      ...session(),
      expiresAt: "2000-01-01T00:00:00Z",
    };
    vi.spyOn(client, "getCliManagedGithubLinkSession").mockResolvedValue(
      response(expiredVerified),
    );
    vi.spyOn(client, "getCliManagedSourceOperation").mockResolvedValue(
      response(operation("pending_review")),
    );
    vi.spyOn(auth, "getAccessToken").mockResolvedValue("fixture-eai-token");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response({ status: "pending_review" }));
    expect(
      (
        await resumeCliManagedSourceUpload(
          client,
          scope,
          operation("publishing"),
          bundle,
        )
      ).status,
    ).toBe("pending_review");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(() => validateCliGithubLinkSession(expiredVerified, scope)).toThrow(
      "expired",
    );
  });

  test("refuses a changed local bundle or upload origin before sending bytes on resume", async () => {
    const client = new PlatformAPIClient(
      "https://api.example.test/public",
      scope.tenantId,
    );
    const linkRead = vi
      .spyOn(client, "getCliManagedGithubLinkSession")
      .mockResolvedValue(response(session()));
    const token = vi.spyOn(auth, "getAccessToken");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(
      resumeCliManagedSourceUpload(client, scope, operation("publishing"), {
        ...bundle,
        bundleSha256: `sha256:${"d".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "MANAGED_SOURCE_BINDING_MISMATCH" });
    expect(linkRead).not.toHaveBeenCalled();
    const wrongOrigin = operation("publishing");
    wrongOrigin.upload!.url = wrongOrigin.upload!.url.replace(
      "dev-admin-portal.myenterprise.ai",
      "attacker.example.test",
    );
    await expect(
      resumeCliManagedSourceUpload(client, scope, wrongOrigin, bundle),
    ).rejects.toMatchObject({ code: "MANAGED_SOURCE_UPLOAD_INVALID" });
    expect(token).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects a different server-authorized bundle before upload', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response({ ...operation(), bundleSha256: `sha256:${'e'.repeat(64)}` }));
    await expect(submitCliManagedSource(client, scope, session(), bundle)).rejects.toMatchObject({ code: 'MANAGED_SOURCE_BINDING_MISMATCH' });
  });

  test('does not upload if preparation refers to another linked GitHub account', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const prepared = operation();
    prepared.verifiedGithubUser.id = 999;
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(prepared));
    await expect(submitCliManagedSource(client, scope, session(), bundle)).rejects.toMatchObject({ code: 'MANAGED_SOURCE_BINDING_MISMATCH' });
  });

  test.each([undefined, 'github-link-other'])('does not upload if preparation omits or changes the exact GitHub link session: %s', async githubLinkSessionId => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const prepared = operation();
    prepared.githubLinkSessionId = githubLinkSessionId;
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(prepared));
    const token = vi.spyOn(auth, 'getAccessToken');
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(submitCliManagedSource(client, scope, session(), bundle)).rejects.toMatchObject({ code: 'MANAGED_SOURCE_BINDING_MISMATCH' });
    expect(token).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('does not reupload after an uncertain network response', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(operation()));
    vi.spyOn(auth, 'getAccessToken').mockResolvedValue('fixture-eai-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('lost response'));
    await expect(submitCliManagedSource(client, scope, session(), bundle)).rejects.toMatchObject({ code: 'MANAGED_SOURCE_UPLOAD_UNCERTAIN', message: expect.stringContaining('cli-managed-source-123') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('returns pending review without falsely waiting for customer repository write access', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const read = vi.spyOn(client, 'getCliManagedSourceOperation').mockResolvedValue(response(operation('pending_review')));
    const result = await pollCliManagedSource(client, scope, 'cli-managed-source-123', { wait: true, timeoutMs: 60_000 });
    expect(classifyCliManagedSourceOperation(result)).toBe('pending');
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('backs off a long publication wait without changing its exact operation or deadline', async () => {
    let now = Date.parse('2026-09-24T00:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const read = vi.spyOn(client, 'getCliManagedSourceOperation').mockImplementation(async () => response(operation('publishing')));
    const delays: number[] = [];
    const result = await pollCliManagedSource(
      client,
      scope,
      'cli-managed-source-123',
      { wait: true, timeoutMs: 600_000 },
      undefined,
      { sleep: async ms => { delays.push(ms); now += ms; } },
    );
    expect(result.status).toBe('publishing');
    expect(now).toBe(Date.parse('2026-09-24T00:10:00Z'));
    expect(delays.slice(0, 15)).toEqual(Array(15).fill(2_000));
    expect(delays.slice(15)).toEqual(Array(114).fill(5_000));
    expect(read).toHaveBeenCalledTimes(130);
    expect(read).toHaveBeenCalledWith('company', 'my-app', 'cli-managed-source-123', 'runtime', 'preview');
  });

  test('requires the full observed readiness evidence even when server status says completed', () => {
    const value = operation('completed');
    value.deployment = { status: 'ready', liveUrl: 'https://live.example.test' };
    expect(classifyCliManagedSourceOperation(value)).toBe('incomplete');
    value.review = { mergedSha: 'd'.repeat(40) };
    Object.assign(value.deployment, { requestId: 'deployment-123', workflowRunId: '12345', artifactDigest: `sha256:${'e'.repeat(64)}`, imageDigest: `sha256:${'f'.repeat(64)}`, runtimeIdentity: { clientId: 'runtime-client', principalId: 'runtime-principal' }, requiresTenantInfra: false, latestPointerVersion: 3, expectedLatestVersion: 3 });
    expect(classifyCliManagedSourceOperation(value)).toBe('succeeded');
    value.deployment.expectedLatestVersion = 4;
    expect(classifyCliManagedSourceOperation(value)).toBe('incomplete');
  });
});
