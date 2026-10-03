import { afterEach, describe, expect, test, vi } from 'vitest';
import { PlatformAPIClient, type CliManagedGithubLinkSession } from '../../src/lib/api.js';
import * as auth from '../../src/lib/auth.js';
import * as profile from '../../src/lib/profile.js';
import { classifyCliManagedSourceOperation, cliManagedPortalOrigin, cliManagedSourceIdempotencyKey, pollCliManagedSource, recoverAcceptedCliManagedSourceUpload, resumeCliManagedSourceUpload, submitCliManagedSource, validateCliGithubLinkSession, verifyCliGithubIdentity, type CliManagedSourceOperation, type CliManagedSourceScope } from '../../src/lib/eai-managed-source-client.js';

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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); profile.setActiveProfile('default'); });

describe('actor-bound GitHub linking', () => {
  test('uses existing verified identity without opening a browser or requiring local gh', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const create = vi.spyOn(client, 'createCliManagedGithubLinkSession').mockResolvedValue(response(session()));
    const openBrowser = vi.fn();
    expect((await verifyCliGithubIdentity(client, scope, { interactive: false, timeoutMs: 1000 }, { openBrowser })).verifiedGithubUser?.id).toBe(123);
    expect(openBrowser).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith('company', 'my-app', expect.objectContaining({ targetTenantId: 'runtime', environment: 'preview', schemaVersion: 'eai.cli_managed_github_link.v1', idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/) }), 1000);
  });

  test('opens the platform handoff and polls only its exact actor-bound session', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    vi.spyOn(client, 'createCliManagedGithubLinkSession').mockResolvedValue(response(session('pending')));
    const read = vi.spyOn(client, 'getCliManagedGithubLinkSession').mockResolvedValue(response(session()));
    const openBrowser = vi.fn(async () => {});
    const result = await verifyCliGithubIdentity(client, scope, { interactive: true, timeoutMs: 1000 }, { openBrowser, sleep: async () => {} });
    expect(result.status).toBe('verified');
    expect(read).toHaveBeenCalledExactlyOnceWith('company', 'my-app', 'github-link-123', 'runtime', 'preview', expect.any(Number));
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
    expect(read).toHaveBeenCalledTimes(128);
    expect(read).toHaveBeenCalledWith('company', 'my-app', 'github-link-123', 'runtime', 'preview', expect.any(Number));
    expect(read.mock.calls[0][5]).toBe(598_000);
    expect(read.mock.calls.at(-1)?.[5]).toBe(5000);
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

  test('admits only the exact dual-flag local E2E Portal origin', () => {
    const local = { ...session(), browserUrl: 'http://localhost:3010/api/platform/generated-apps/github-user?ticket=fixture' };
    expect(() => validateCliGithubLinkSession(local, scope)).toThrow('approved EAI Portal origin');
    vi.stubEnv('E2E_3503_LOCAL_RUN', '1');
    vi.stubEnv('EAI_MANAGED_SOURCE_LOCAL_PORTAL_ORIGIN', 'http://localhost:3010');
    expect(() => validateCliGithubLinkSession(local, scope)).toThrow('approved EAI Portal origin');
    vi.stubEnv('E2E_3503_EXTERNAL_MUTATIONS', '1');
    expect(cliManagedPortalOrigin(validateCliGithubLinkSession(local, scope))).toBe('http://localhost:3010');
    for (const browserUrl of [
      'http://127.0.0.1:3010/api/platform/generated-apps/github-user?ticket=fixture',
      'http://evil.example/api/platform/generated-apps/github-user?ticket=fixture',
      'http://user:secret@localhost:3010/api/platform/generated-apps/github-user?ticket=fixture',
    ]) expect(() => validateCliGithubLinkSession({ ...local, browserUrl }, scope)).toThrow('approved EAI Portal origin');
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
      operationId: 'cli-managed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', status, githubLinkSessionId: 'github-link-123', templateCommitSha: bundle.templateCommitSha, bundleSha256: bundle.bundleSha256, configHash: bundle.configHash,
      verifiedGithubUser: session().verifiedGithubUser!, repository: { owner: 'eai-generated-apps', name: 'platform-derived-app', private: true },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      upload: { url: 'https://dev-admin-portal.myenterprise.ai/api/platform/generated-apps/cli-managed-source/uploads/cli-managed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ticket: 'one-use-upload-proof', sha256: bundle.bundleSha256, expiresAt: new Date(Date.now() + 300_000).toISOString() },
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
    const result = await submitCliManagedSource(client, scope, session(), bundle, async () => {});
    expect(result.status).toBe('pending_review');
    expect(prepare).toHaveBeenCalledWith('company', 'my-app', expect.objectContaining({ githubLinkSessionId: 'github-link-123', bundleSha256: bundle.bundleSha256, fileCount: 1, totalBytes: 3, targetTenantId: 'runtime', environment: 'preview' }));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(operation().upload!.url, expect.objectContaining({ method: 'POST', redirect: 'error', body: JSON.stringify({ tenantId: scope.tenantId, appKey: scope.appKey, targetTenantId: scope.targetTenantId, environment: scope.environment, bundle }), headers: { Authorization: 'Bearer fixture-eai-token', 'Content-Type': 'application/json', 'X-EAI-Upload-Ticket': 'one-use-upload-proof' } }));
    expect(read).toHaveBeenCalledExactlyOnceWith('company', 'my-app', 'cli-managed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'runtime', 'preview');
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  test('local E2E uploads only to the same pinned loopback Portal', async () => {
    vi.stubEnv('E2E_3503_LOCAL_RUN', '1');
    vi.stubEnv('E2E_3503_EXTERNAL_MUTATIONS', '1');
    vi.stubEnv('EAI_MANAGED_SOURCE_LOCAL_PORTAL_ORIGIN', 'http://localhost:3010');
    const localLink = { ...session(), browserUrl: 'http://localhost:3010/api/platform/generated-apps/github-user?ticket=fixture' };
    const localOperation = { ...operation(), upload: {
      ...operation().upload!,
      url: 'http://localhost:3010/api/platform/generated-apps/cli-managed-source/uploads/cli-managed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    } };
    const client = new PlatformAPIClient('http://localhost:8000/public', scope.tenantId);
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(localOperation));
    vi.spyOn(client, 'getCliManagedSourceOperation').mockResolvedValue(response(operation('pending_review')));
    vi.spyOn(auth, 'getAccessToken').mockResolvedValue('fixture-eai-token');
    const upload = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ status: 'pending_review' }));
    await submitCliManagedSource(client, scope, localLink, bundle, async () => {});
    expect(upload.mock.calls[0][0]).toBe(localOperation.upload.url);
  });

  test.each(['different-profile', 'same-profile-reselected', 'profile-saved'])('profile capture change during token await blocks upload: %s', async (change) => {
    vi.spyOn(profile, 'captureProfileConfig').mockReturnValue(null);
    profile.setActiveProfile('original-profile');
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(operation()));
    const read = vi.spyOn(client, 'getCliManagedSourceOperation');
    let release!: (token: string) => void;
    let signalTokenStarted!: () => void;
    const started = new Promise<void>(resolve => { signalTokenStarted = resolve; });
    const token = vi.spyOn(auth, 'getAccessToken').mockImplementation(() => {
      signalTokenStarted(); return new Promise<string>(resolve => { release = resolve; });
    });
    const upload = vi.spyOn(globalThis, 'fetch');
    const prepared = vi.fn(async () => {});
    const pending = submitCliManagedSource(client, scope, session(), bundle, prepared);
    await started;
    if (change === 'profile-saved') {
      const originalGeneration = profile.getProfileCaptureGeneration();
      vi.spyOn(profile, 'getProfileCaptureGeneration').mockReturnValue(originalGeneration + 1);
    } else profile.setActiveProfile(change === 'different-profile' ? 'other-profile' : 'original-profile');
    release('different-profile-token');
    await expect(pending).rejects.toMatchObject({ code: 'MANAGED_SOURCE_UPLOAD_UNCERTAIN' });
    expect(prepared).toHaveBeenCalledTimes(1); expect(token).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });

  test('already changed client capture is rejected before reading any upload credential', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(operation()));
    const token = vi.spyOn(auth, 'getAccessToken');
    const upload = vi.spyOn(globalThis, 'fetch');
    await expect(submitCliManagedSource(client, scope, session(), bundle, async () => {
      profile.setActiveProfile('default');
    })).rejects.toMatchObject({ code: 'MANAGED_SOURCE_UPLOAD_UNCERTAIN' });
    expect(token).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });

  test.each(['source-unknown-abc123', 'cli-managed-source-123', 'cli-managed-' + 'a'.repeat(31), 'cli-managed-' + 'a'.repeat(33), 'cli-managed-' + 'A'.repeat(32)])('rejects crossed or noncanonical publication ID %s before persistence or upload', async operationId => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const value = { ...operation(), operationId };
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(value));
    const persist = vi.fn(async () => {});
    const token = vi.spyOn(auth, 'getAccessToken');
    const upload = vi.spyOn(globalThis, 'fetch');
    await expect(submitCliManagedSource(client, scope, session(), bundle, persist)).rejects.toMatchObject({ code: 'MANAGED_SOURCE_BINDING_MISMATCH' });
    const read = vi.spyOn(client, 'getCliManagedSourceOperation');
    await expect(pollCliManagedSource(client, scope, operationId, { wait: false, timeoutMs: 1000 })).rejects.toMatchObject({ code: 'MANAGED_SOURCE_BINDING_MISMATCH' });
    expect(persist).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  test.each(['fetch', 'credentials'] as const)('bounds a stalled Portal upload %s without replaying or losing prepared recovery', async boundary => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId, { managedRequestTimeoutMs: 25 });
    const prepare = vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(operation()));
    const read = vi.spyOn(client, 'getCliManagedSourceOperation');
    let finishToken!: (value: string) => void;
    const token = vi.spyOn(auth, 'getAccessToken').mockImplementation(() => boundary === 'credentials'
      ? new Promise(resolve => { finishToken = resolve; }) : Promise.resolve('fixture-eai-token'));
    const upload = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error('Portal upload must have its native deadline');
      return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const alive = setInterval(() => {}, 1000);
    const persisted: CliManagedSourceOperation[] = [];
    try {
      await expect(submitCliManagedSource(client, scope, session(), bundle, async value => { persisted.push(value); })).rejects.toMatchObject({
        code: 'MANAGED_SOURCE_UPLOAD_UNCERTAIN', message: expect.stringContaining('--retry cli-managed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      });
      if (boundary === 'credentials') { finishToken('fixture-eai-token'); await Promise.resolve(); }
      expect(persisted).toHaveLength(1);
      expect(persisted[0].operationId).toBe(operation().operationId);
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(token).toHaveBeenCalledTimes(1);
      expect(upload).toHaveBeenCalledTimes(boundary === 'fetch' ? 1 : 0);
      if (boundary === 'fetch') expect(upload.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(read).not.toHaveBeenCalled();
    } finally { clearInterval(alive); }
  });

  test('retains missing-login classification and never uploads without an EAI token', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(operation()));
    vi.spyOn(auth, 'getAccessToken').mockResolvedValue(null);
    const upload = vi.spyOn(globalThis, 'fetch');
    await expect(submitCliManagedSource(client, scope, session(), bundle, async () => {})).rejects.toMatchObject({ code: 'EAI_LOGIN_REQUIRED' });
    expect(upload).not.toHaveBeenCalled();
  });

  test('persists the prepared operation before reading a token or uploading source', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const prepared = operation();
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(prepared));
    vi.spyOn(client, 'getCliManagedSourceOperation').mockResolvedValue(response(operation('pending_review')));
    let saved = false;
    const token = vi.spyOn(auth, 'getAccessToken').mockImplementation(async () => {
      expect(saved).toBe(true);
      return 'fixture-eai-token';
    });
    const upload = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      expect(saved).toBe(true);
      return response({ status: 'pending_review' });
    });
    await submitCliManagedSource(client, scope, session(), bundle, async value => {
      expect(value).toEqual(prepared);
      expect(token).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
      saved = true;
    });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  test('refuses source upload when protected operation recovery cannot be persisted', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(operation()));
    const token = vi.spyOn(auth, 'getAccessToken');
    const upload = vi.spyOn(globalThis, 'fetch');
    await expect(submitCliManagedSource(client, scope, session(), bundle, async () => {
      throw new Error('local recovery write failed');
    })).rejects.toMatchObject({ code: 'MANAGED_SOURCE_RECOVERY_UNAVAILABLE', message: expect.stringContaining('cli-managed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') });
    expect(token).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  test.each([
    { url: 'https://attacker.example/upload' },
    { url: 'http://dev-admin-portal.myenterprise.ai/api/platform/generated-apps/cli-managed-source/uploads/cli-managed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { url: 'https://dev-admin-portal.myenterprise.ai/api/platform/generated-apps/cli-managed-source/uploads/other-operation' },
    { url: 'https://dev-admin-portal.myenterprise.ai/api/platform/generated-apps/cli-managed-source/uploads/cli-managed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?redirect=elsewhere' },
    { sha256: `sha256:${'f'.repeat(64)}` }, { expiresAt: '2000-01-01T00:00:00Z' }, { ticket: '' },
  ])('refuses mismatched upload authority before reading a token or sending bytes: %j', async changed => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const prepared = operation();
    prepared.upload = { ...prepared.upload!, ...changed };
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(prepared));
    const token = vi.spyOn(auth, 'getAccessToken');
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(submitCliManagedSource(client, scope, session(), bundle, async () => {})).rejects.toMatchObject({ code: 'MANAGED_SOURCE_UPLOAD_INVALID' });
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
      (await submitCliManagedSource(client, scope, session(), bundle, async () => {})).status,
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

  test("recovers the same accepted operation after first-response loss and expired link", async () => {
    const client = new PlatformAPIClient("https://api.example.test/public", scope.tenantId);
    const expired = { ...session(), expiresAt: "2000-01-01T00:00:00Z" };
    const accepted = { ...operation(), upload: undefined };
    vi.spyOn(client, "getCliManagedGithubLinkSession").mockImplementation(async () => response(expired));
    const prepare = vi.spyOn(client, "prepareCliManagedSource").mockResolvedValue(response(operation()));
    vi.spyOn(client, "getCliManagedSourceOperation").mockResolvedValue(response(operation("pending_review")));
    vi.spyOn(auth, "getAccessToken").mockResolvedValue("fixture-eai-token");
    const upload = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ status: "pending_review" }));
    const persisted = vi.fn(async () => {});
    expect((await recoverAcceptedCliManagedSourceUpload(client, scope, accepted, bundle, persisted)).status).toBe("pending_review");
    expect(prepare).toHaveBeenCalledExactlyOnceWith("company", "my-app", expect.objectContaining({
      idempotencyKey: cliManagedSourceIdempotencyKey(scope, bundle.bundleSha256),
      githubLinkSessionId: "github-link-123", bundleSha256: bundle.bundleSha256,
    }));
    expect(persisted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operationId: accepted.operationId }));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  test("renews only the original publishing operation after its consumed upload ticket expires", async () => {
    const client = new PlatformAPIClient("https://api.example.test/public", scope.tenantId);
    const expired = { ...session(), expiresAt: "2000-01-01T00:00:00Z" };
    const publishing = { ...operation("publishing"), upload: undefined };
    const renewed = { ...operation("publishing"), upload: { ...operation().upload!, ticket: "renewed-ticket" } };
    vi.spyOn(client, "getCliManagedGithubLinkSession").mockImplementation(async () => response(expired));
    const prepare = vi.spyOn(client, "prepareCliManagedSource").mockResolvedValue(response(renewed));
    vi.spyOn(client, "getCliManagedSourceOperation").mockResolvedValue(response(operation("pending_review")));
    vi.spyOn(auth, "getAccessToken").mockResolvedValue("fixture-eai-token");
    const upload = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ status: "pending_review" }));
    const persisted = vi.fn(async () => {});
    expect((await recoverAcceptedCliManagedSourceUpload(client, scope, publishing, bundle, persisted)).status).toBe("pending_review");
    expect(prepare).toHaveBeenCalledExactlyOnceWith("company", "my-app", expect.objectContaining({
      idempotencyKey: cliManagedSourceIdempotencyKey(scope, bundle.bundleSha256),
      githubLinkSessionId: publishing.githubLinkSessionId,
    }));
    expect(persisted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operationId: publishing.operationId }));
    expect(upload).toHaveBeenCalledExactlyOnceWith(renewed.upload.url, expect.objectContaining({
      headers: expect.objectContaining({ "X-EAI-Upload-Ticket": "renewed-ticket" }),
    }));
  });

  test("publishing renewal refuses a changed repository before saving authority or uploading", async () => {
    const client = new PlatformAPIClient("https://api.example.test/public", scope.tenantId);
    vi.spyOn(client, "getCliManagedGithubLinkSession").mockResolvedValue(response(session()));
    vi.spyOn(client, "prepareCliManagedSource").mockResolvedValue(response({
      ...operation("publishing"), repository: { ...operation().repository, name: "different-repo" },
    }));
    const persisted = vi.fn(async () => {});
    const upload = vi.spyOn(globalThis, "fetch");
    await expect(recoverAcceptedCliManagedSourceUpload(client, scope, {
      ...operation("publishing"), upload: undefined,
    }, bundle, persisted)).rejects.toMatchObject({ code: "MANAGED_SOURCE_BINDING_MISMATCH" });
    expect(persisted).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  test("missing-receipt recovery rejects changed source, proof, or operation before replay", async () => {
    const client = new PlatformAPIClient("https://api.example.test/public", scope.tenantId);
    const linkRead = vi.spyOn(client, "getCliManagedGithubLinkSession").mockResolvedValue(response(session()));
    const prepare = vi.spyOn(client, "prepareCliManagedSource");
    const upload = vi.spyOn(globalThis, "fetch");
    const persist = vi.fn(async () => {});
    await expect(recoverAcceptedCliManagedSourceUpload(client, scope, operation(), {
      ...bundle, bundleSha256: `sha256:${"f".repeat(64)}`,
    }, persist)).rejects.toMatchObject({ code: "MANAGED_SOURCE_BINDING_MISMATCH" });
    expect(linkRead).not.toHaveBeenCalled();
    linkRead.mockResolvedValue(response({ ...session(), verifiedGithubUser: { ...session().verifiedGithubUser!, proofId: "changed-proof" } }));
    await expect(recoverAcceptedCliManagedSourceUpload(client, scope, operation(), bundle, persist))
      .rejects.toMatchObject({ code: "MANAGED_SOURCE_BINDING_MISMATCH" });
    await expect(recoverAcceptedCliManagedSourceUpload(client, scope, operation("pending_review"), bundle, persist))
      .rejects.toMatchObject({ code: "MANAGED_SOURCE_RECOVERY_UNAVAILABLE" });
    expect(prepare).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
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
    await expect(submitCliManagedSource(client, scope, session(), bundle, async () => {})).rejects.toMatchObject({ code: 'MANAGED_SOURCE_BINDING_MISMATCH' });
  });

  test('does not upload if preparation refers to another linked GitHub account', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const prepared = operation();
    prepared.verifiedGithubUser.id = 999;
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(prepared));
    await expect(submitCliManagedSource(client, scope, session(), bundle, async () => {})).rejects.toMatchObject({ code: 'MANAGED_SOURCE_BINDING_MISMATCH' });
  });

  test.each(['preparation', 'retry', 'readback'] as const)('binds the captured GitHub login and proof during %s without extra I/O', async boundary => {
    for (const changed of [{ login: 'other-user' }, { proofId: 'other-proof' }]) {
      const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
      const altered = operation(boundary === 'readback' ? 'pending_review' : 'publishing');
      Object.assign(altered.verifiedGithubUser, changed);
      const prepare = vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(boundary === 'preparation' ? altered : operation()));
      const linkRead = vi.spyOn(client, 'getCliManagedGithubLinkSession').mockResolvedValue(response(session()));
      const read = vi.spyOn(client, 'getCliManagedSourceOperation').mockResolvedValue(response(altered));
      const persist = vi.fn(async () => {});
      const token = vi.spyOn(auth, 'getAccessToken').mockResolvedValue('fixture-eai-token');
      const upload = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ status: 'pending_review' }));

      await expect(boundary === 'retry'
        ? resumeCliManagedSourceUpload(client, scope, altered, bundle)
        : submitCliManagedSource(client, scope, session(), bundle, persist)
      ).rejects.toMatchObject({ code: 'MANAGED_SOURCE_BINDING_MISMATCH' });

      expect(prepare).toHaveBeenCalledTimes(boundary === 'retry' ? 0 : 1);
      expect(linkRead).toHaveBeenCalledTimes(boundary === 'retry' ? 1 : 0);
      expect(persist).toHaveBeenCalledTimes(boundary === 'readback' ? 1 : 0);
      expect(token).toHaveBeenCalledTimes(boundary === 'readback' ? 1 : 0);
      expect(upload).toHaveBeenCalledTimes(boundary === 'readback' ? 1 : 0);
      expect(read).toHaveBeenCalledTimes(boundary === 'readback' ? 1 : 0);
      vi.restoreAllMocks();
    }
  });

  test.each(['submission', 'retry'] as const)('preserves case-insensitive GitHub login equality during %s at existing request counts', async boundary => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const prepared = operation('publishing');
    prepared.verifiedGithubUser.login = 'LINKED-USER';
    const prepare = vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(prepared));
    const linkRead = vi.spyOn(client, 'getCliManagedGithubLinkSession').mockResolvedValue(response(session()));
    const read = vi.spyOn(client, 'getCliManagedSourceOperation').mockResolvedValue(response(operation('pending_review')));
    vi.spyOn(auth, 'getAccessToken').mockResolvedValue('fixture-eai-token');
    const upload = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ status: 'pending_review' }));
    const result = boundary === 'retry'
      ? await resumeCliManagedSourceUpload(client, scope, prepared, bundle)
      : await submitCliManagedSource(client, scope, session(), bundle, async () => {});
    expect(result.status).toBe('pending_review');
    expect(prepare).toHaveBeenCalledTimes(boundary === 'retry' ? 0 : 1);
    expect(linkRead).toHaveBeenCalledTimes(boundary === 'retry' ? 1 : 0);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test.each([undefined, 'github-link-other'])('does not upload if preparation omits or changes the exact GitHub link session: %s', async githubLinkSessionId => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const prepared = operation();
    prepared.githubLinkSessionId = githubLinkSessionId;
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(prepared));
    const token = vi.spyOn(auth, 'getAccessToken');
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(submitCliManagedSource(client, scope, session(), bundle, async () => {})).rejects.toMatchObject({ code: 'MANAGED_SOURCE_BINDING_MISMATCH' });
    expect(token).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('does not reupload after an uncertain network response', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    vi.spyOn(client, 'prepareCliManagedSource').mockResolvedValue(response(operation()));
    vi.spyOn(auth, 'getAccessToken').mockResolvedValue('fixture-eai-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('lost response'));
    await expect(submitCliManagedSource(client, scope, session(), bundle, async () => {})).rejects.toMatchObject({ code: 'MANAGED_SOURCE_UPLOAD_UNCERTAIN', message: expect.stringContaining('--retry cli-managed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('returns pending review without falsely waiting for customer repository write access', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const read = vi.spyOn(client, 'getCliManagedSourceOperation').mockResolvedValue(response(operation('pending_review')));
    const result = await pollCliManagedSource(client, scope, 'cli-managed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { wait: true, timeoutMs: 60_000 });
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
      'cli-managed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      { wait: true, timeoutMs: 600_000 },
      undefined,
      { sleep: async ms => { delays.push(ms); now += ms; } },
    );
    expect(result.status).toBe('publishing');
    expect(now).toBe(Date.parse('2026-09-24T00:10:00Z'));
    expect(delays.slice(0, 15)).toEqual(Array(15).fill(2_000));
    expect(delays.slice(15)).toEqual(Array(114).fill(5_000));
    expect(read).toHaveBeenCalledTimes(129);
    expect(read).toHaveBeenCalledWith('company', 'my-app', 'cli-managed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'runtime', 'preview', expect.any(Number));
    expect(read.mock.calls[0][5]).toBe(600_000);
    expect(read.mock.calls.at(-1)?.[5]).toBe(5000);
  });

  test.each([0, 1])('performs no publication read when its %s ms budget is already exhausted', async timeoutMs => {
    const startedAt = Date.parse('2026-09-28T00:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValueOnce(startedAt).mockReturnValue(startedAt + timeoutMs);
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const read = vi.spyOn(client, 'getCliManagedSourceOperation');
    const token = vi.spyOn(auth, 'getAccessToken');
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(pollCliManagedSource(client, scope, 'cli-managed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { wait: true, timeoutMs }))
      .rejects.toMatchObject({ code: 'SOURCE_OPERATION_TIMEOUT' });
    expect(read).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects changed publication GitHub proof before another poll read', async () => {
    const initial = operation('publishing');
    const changed = operation('publishing');
    changed.verifiedGithubUser.proofId = 'other-proof';
    let now = Date.parse('2026-09-28T00:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const read = vi.spyOn(client, 'getCliManagedSourceOperation').mockResolvedValue(response(changed));
    const sleep = vi.fn(async () => { now += 1_000; });
    await expect(pollCliManagedSource(client, scope, initial.operationId, { wait: true, timeoutMs: 2_000 }, initial, { sleep }))
      .rejects.toMatchObject({ code: 'MANAGED_SOURCE_BINDING_MISMATCH' });
    expect(read).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  test('never treats publication-route deployment fields as terminal readiness evidence', () => {
    const value = operation('completed');
    value.deployment = { status: 'ready', liveUrl: 'https://live.example.test' };
    expect(classifyCliManagedSourceOperation(value)).toBe('incomplete');
    value.review = { mergedSha: 'd'.repeat(40) };
    Object.assign(value.deployment, { requestId: 'deployment-123', workflowRunId: '12345', artifactDigest: `sha256:${'e'.repeat(64)}`, imageDigest: `sha256:${'f'.repeat(64)}`, runtimeIdentity: { clientId: 'runtime-client', principalId: 'runtime-principal' }, requiresTenantInfra: false, latestPointerVersion: 3, expectedLatestVersion: 3 });
    expect(classifyCliManagedSourceOperation(value)).toBe('incomplete');
    value.deployment.expectedLatestVersion = 4;
    expect(classifyCliManagedSourceOperation(value)).toBe('incomplete');
  });
});
