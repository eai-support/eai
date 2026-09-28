import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { clearTokens, storeTokens } from '../../src/lib/auth.js';
import {
  DEFAULT_PROD_AUTH_CLIENT_ID,
  DEFAULT_PROD_AUTH_TENANT_ID,
  DEFAULT_PROD_AUTH_TENANT_NAME,
  setActiveProfile,
} from '../../src/lib/profile.js';
import { loadManagedRetryAuthority, saveManagedRecoveryAuthority } from '../../src/commands/eai-managed-deploy-recovery.js';
import { eaiManagedDeployCommand } from '../../src/commands/eai-managed-deploy.js';
import { deployCommand } from '../../src/commands/deploy.js';
import { buildCliManagedSourceBundle } from '../../src/lib/eai-managed-source.js';
import { claimManagedDeployDispatch, installCanonicalManagedDeployFiles, buildManagedDeployConfigHash, managedDeployNonceSha256, managedDeployStatePath, saveManagedDeployState, type ManagedDeployState } from '../../src/lib/eai-managed-deploy.js';

const exec = promisify(execFile);
const API_BASE = 'https://test-api.au.myenterprise.ai/public';
const TENANT_ID = 'company-tenant';
const ACTOR_BINDING = {
  actorId: 'test-user-oid', githubLinkSessionId: 'github-link-123', githubUserId: 123,
  githubLogin: 'linked-user', githubProofId: 'proof-123',
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function linkedGitHubSession(
  status: 'verified' | 'pending' = 'verified',
  targetTenantId = TENANT_ID,
): Record<string, unknown> {
  return {
    schemaVersion: 'eai.cli_managed_github_link_session.v1', sessionId: 'github-link-123', status,
    tenantId: TENANT_ID, appKey: 'planning-portal', targetTenantId, environment: 'preview', actorId: 'test-user-oid',
    expiresAt: new Date(Date.now() + 600_000).toISOString(), browserUrl: 'https://dev-admin-portal.myenterprise.ai/api/platform/generated-apps/github-user?ticket=fixture',
    ...(status === 'verified' ? { verifiedGithubUser: { id: 123, login: 'linked-user', proofId: 'proof-123', actorId: 'test-user-oid' } } : {}),
  };
}

function completeUnifiedOperation(options: {
  targetTenantId?: string;
  branch?: string;
  commitSha?: string;
  configHash?: string;
  environment?: string;
  operationId?: string;
  sourceMode?: 'source-unknown' | 'eai-cli-generated';
  repoOwner?: string;
  repoName?: string;
} = {}): Record<string, unknown> {
  const targetTenantId = options.targetTenantId ?? TENANT_ID;
  const branch = options.branch ?? 'main';
  const commitSha = options.commitSha ?? 'a'.repeat(40);
  const configHash = options.configHash ?? `sha256:${'b'.repeat(64)}`;
  const environment = options.environment ?? 'preview';
  const operationId = options.operationId ?? 'source-unknown-abc123';
  const sourceMode = options.sourceMode ?? 'source-unknown';
  const repoOwner = options.repoOwner ?? 'enterprise';
  const repoName = options.repoName ?? 'planning-portal';
  return {
    tenantId: TENANT_ID, appScopeTenantId: TENANT_ID, targetTenantId,
    appKey: 'planning-portal', operationId, environment,
    sourceMode, sourceStatus: 'completed', configHash, status: 'active',
    requiresTenantInfra: true, deploymentId: 'dep-1', activeUrl: 'https://planning.example.com',
    latestPointerVersion: 3, expectedLatestVersion: 3,
    runtimeIdentity: { clientId: 'runtime-client', principalId: 'runtime-principal' },
    deployment: { deploymentId: 'dep-1', status: 'active' },
    doctor: {
      deploymentId: 'dep-1', status: 'active', ready: true,
      scope: { tenantId: targetTenantId, appKey: 'planning-portal', environment },
    },
    sourceRevision: {
      operationId, sourceMode,
      appScopeTenantId: TENANT_ID, targetTenantId,
      repoOwner, repoName, repositoryId: 123, installationId: 12345,
      branchRef: `refs/heads/${branch}`, workflowPath: '.github/workflows/eai-app.yml',
      workflowHeadBranch: branch, sourceCommitSha: commitSha, commitSha, workflowRunId: '789',
      workflowBlobSha: 'f'.repeat(40), collectorDigest: `sha256:${'1'.repeat(64)}`, configHash,
      ...(sourceMode === 'eai-cli-generated' ? { reviewHeadSha: commitSha } : {}),
      artifactDigest: `sha256:${'c'.repeat(64)}`,
      imageArtifact: { id: '987', name: 'eai-generated-app-image', archiveDigest: `sha256:${'d'.repeat(64)}` },
      imageDigest: `sha256:${'e'.repeat(64)}`,
    },
    setup: {
      targetTenantId, environment, repo: { owner: repoOwner, name: repoName },
      repositoryId: 123, installationId: 12345,
      workflowPath: '.github/workflows/eai-app.yml', ref: `refs/heads/${branch}`, commitSha, sourceCommitSha: commitSha, configHash,
      ...(sourceMode === 'eai-cli-generated' ? { reviewHeadSha: commitSha } : {}),
      nonceSha256: managedDeployNonceSha256('one-time-nonce'), deployOnSuccess: true,
      ...ACTOR_BINDING,
    },
  };
}

function completedManagedPublication(): Record<string, unknown> {
  return {
    schemaVersion: 'eai.cli_managed_source_operation.v1', sourceMode: 'eai-cli-generated',
    operationId: 'cli-managed-source-123', status: 'completed',
    tenantId: TENANT_ID, targetTenantId: TENANT_ID, appKey: 'planning-portal', environment: 'preview',
    actorId: 'test-user-oid', templateCommitSha: 'a'.repeat(40),
    bundleSha256: `sha256:${'b'.repeat(64)}`, configHash: `sha256:${'c'.repeat(64)}`,
    verifiedGithubUser: linkedGitHubSession().verifiedGithubUser,
    repository: { owner: 'eai-generated-apps', name: 'app' },
    review: { mergedSha: 'a'.repeat(40) },
    deployment: { status: 'ready', liveUrl: 'https://live.example.test' },
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
}

function failedManagedPublication(): Record<string, unknown> {
  return {
    ...completedManagedPublication(),
    status: 'failed',
    review: undefined,
    deployment: undefined,
    error: { code: 'PUBLICATION_FAILED' },
  };
}

function customerRetryState(options: {
  targetTenantId?: string;
  environment?: string;
  publicApiUrl?: string;
} = {}): ManagedDeployState {
  return {
    schema: 'eai.managed-deploy-state.v1', tenantId: TENANT_ID,
    targetTenantId: options.targetTenantId ?? TENANT_ID,
    appKey: 'planning-portal', operationId: 'source-unknown-abc123', nonce: 'one-time-nonce',
    repo: 'enterprise/planning-portal', branch: 'main', ref: 'refs/heads/main',
    commitSha: 'a'.repeat(40), workflowPath: '.github/workflows/eai-app.yml',
    configHash: `sha256:${'b'.repeat(64)}`, environment: options.environment ?? 'preview',
    installationId: 12345, publicApiUrl: options.publicApiUrl ?? API_BASE,
    ...ACTOR_BINDING,
  };
}

function customerOperationSetup(
  state: ManagedDeployState,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    targetTenantId: state.targetTenantId,
    environment: state.environment,
    workflowPath: state.workflowPath,
    ref: state.ref,
    commitSha: state.commitSha, sourceCommitSha: state.commitSha,
    repositoryId: 123, installationId: state.installationId,
    configHash: state.configHash,
    nonceSha256: managedDeployNonceSha256(state.nonce),
    actorId: state.actorId,
    githubLinkSessionId: state.githubLinkSessionId,
    repo: { owner: 'enterprise', name: 'planning-portal' },
    deployOnSuccess: true,
    ...extra,
  };
}

describe('eai deploy app --target eai', () => {
  let env: TestEnvironment;
  let projectRoot: string;
  let original: NodeJS.ProcessEnv;

  function stubManagedOperation(operation?: Record<string, unknown>): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === `${API_BASE}/v4/identity/tenants`) {
        return jsonResponse({ tenants: [{ id: TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'] }] });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${TENANT_ID}` || url === `${API_BASE}/v4/platform/tenants/${TENANT_ID}/management`) {
        return jsonResponse({ id: TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'] });
      }
      if (url.includes('/managed-deployments/operations/')) {
        if (operation) return jsonResponse({ ...(!Object.hasOwn(operation, 'environment') ? { environment: 'preview' } : {}), ...operation });
        if (url.includes('/operations/cli-managed-source-123')) return jsonResponse(completeUnifiedOperation({ operationId: 'cli-managed-source-123', sourceMode: 'eai-cli-generated', repoOwner: 'eai-generated-apps', repoName: 'app', configHash: `sha256:${'c'.repeat(64)}` }));
        return jsonResponse({ message: 'operation missing' }, 404);
      }
      if (url.endsWith('/cli-managed-source/github-link-sessions') || url.includes('/cli-managed-source/github-link-sessions/github-link-123?')) return jsonResponse(linkedGitHubSession());
      return jsonResponse({ message: `Unhandled GET ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeEach(async () => {
    original = { ...process.env };
    env = await createTestEnvironment();
    projectRoot = join(env.dir, 'project');
    await mkdir(projectRoot);
    setActiveProfile('default');
    process.chdir(projectRoot);
    process.env.HOME = env.dir;
    process.env.USERPROFILE = env.dir;
    await saveManagedRecoveryAuthority({ schema: 'eai.managed-recovery-authority.v1', operationId: 'cli-managed-source-123', tenantId: TENANT_ID, targetTenantId: TENANT_ID, appKey: 'planning-portal', actorId: 'test-user-oid', publicApiUrl: API_BASE });
    expect(managedDeployStatePath('source-unknown-fixture')).toContain(env.dir);
    process.env.BASE_URL_PUBLIC_API = API_BASE;
    process.env.EAI_ACCESS_TOKEN = '<fixture-access-token>';
    process.exitCode = 0;
    await storeTokens({
      accessToken: '<fixture-access-token>',
      refreshToken: '<fixture-refresh-token>',
      expiresAt: Date.now() + 3_600_000,
      tenantId: DEFAULT_PROD_AUTH_TENANT_ID,
      tenantName: DEFAULT_PROD_AUTH_TENANT_NAME,
      clientId: DEFAULT_PROD_AUTH_CLIENT_ID,
      oid: 'test-user-oid',
      upn: 'builder@example.com',
      activeTenantId: TENANT_ID,
      activeTenantName: 'Builder Workspace',
      activeTenantSlug: 'builder-workspace',
      publicApiUrl: API_BASE,
      membershipsCachedAt: Date.now(),
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await clearTokens();
    setActiveProfile('default');
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
    process.exitCode = 0;
    process.chdir('/');
    await env.cleanup();
  });

  test.each(['accepted', 'lost-response', 'unsafe-directory'] as const)('saves original recovery authority before exact managed source upload: %s', async (uploadOutcome) => {
    await rm(managedDeployStatePath('cli-managed-source-123'));
    await mkdir(join(projectRoot, 'src/app'), { recursive: true });
    await writeFile(join(projectRoot, 'src/app/page.tsx'), 'export default function Page() { return "local source"; }');
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    await writeFile(join(projectRoot, '.eai-manifest.json'), JSON.stringify({ template: { commit: 'a'.repeat(40) } }));
    await exec('git', ['init', '-b', 'main'], { cwd: projectRoot });
    await exec('git', ['add', '.'], { cwd: projectRoot });
    await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Initial scaffold from template\n\nCreated by: eai init'], { cwd: projectRoot });
    expect((await exec('git', ['remote'], { cwd: projectRoot })).stdout).toBe('');
    const identity = stubManagedOperation().getMockImplementation()!;
    let prepared: Record<string, unknown> = {};
    let uploaded: Record<string, unknown> = {};
    const envelope = (status: string): Record<string, unknown> => ({
      schemaVersion: 'eai.cli_managed_source_operation.v1', sourceMode: 'eai-cli-generated', operationId: 'cli-managed-source-123', status,
      tenantId: TENANT_ID, targetTenantId: TENANT_ID, appKey: 'planning-portal', environment: 'preview', actorId: 'test-user-oid',
      templateCommitSha: prepared.templateCommitSha, bundleSha256: prepared.bundleSha256, configHash: prepared.configHash,
      githubLinkSessionId: prepared.githubLinkSessionId,
      verifiedGithubUser: (linkedGitHubSession().verifiedGithubUser), repository: { owner: 'eai-generated-apps', name: 'server-derived-app' },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      upload: { url: 'https://dev-admin-portal.myenterprise.ai/api/platform/generated-apps/cli-managed-source/uploads/cli-managed-source-123', ticket: 'one-use-ticket', expiresAt: new Date(Date.now() + 300_000).toISOString(), sha256: prepared.bundleSha256 },
    });
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/cli-managed-source/preparations')) {
        prepared = JSON.parse(String(init?.body));
        if (uploadOutcome === 'unsafe-directory') await chmod(join(env.dir, '.eai', 'managed-deployments'), 0o770);
        return jsonResponse(envelope('accepted'));
      }
      if (url.startsWith('https://dev-admin-portal.myenterprise.ai/')) {
        const authority = JSON.parse(await readFile(managedDeployStatePath('cli-managed-source-123'), 'utf8'));
        expect(authority).toMatchObject({ schema: 'eai.managed-recovery-authority.v1', operationId: 'cli-managed-source-123', publicApiUrl: API_BASE, tenantId: TENANT_ID, targetTenantId: TENANT_ID, appKey: 'planning-portal', actorId: 'test-user-oid' });
        if (uploadOutcome === 'lost-response') throw new Error('provider response lost');
        uploaded = JSON.parse(String(init?.body)).bundle;
        expect(init?.redirect).toBe('error');
        expect(init?.headers).toMatchObject({ 'X-EAI-Upload-Ticket': 'one-use-ticket' });
        return jsonResponse({ status: 'pending_review' }, 202);
      }
      if (url.includes('/cli-managed-source/operations/')) return jsonResponse(envelope('pending_review'));
      return identity(input);
    }));
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync(['planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID, '--source', 'eai-managed', '--format', 'json'], { from: 'user' });
    const result = JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''));
    if (uploadOutcome !== 'accepted') {
      expect(process.exitCode).toBe(1);
      expect(result).toMatchObject({ ok: false, error: { code: uploadOutcome === 'lost-response' ? 'MANAGED_SOURCE_UPLOAD_UNCERTAIN' : 'MANAGED_SOURCE_RECOVERY_UNAVAILABLE' } });
      expect(result.error.message).toContain('cli-managed-source-123');
      expect(requests.filter(url => url.startsWith('https://dev-admin-portal.myenterprise.ai/'))).toHaveLength(uploadOutcome === 'lost-response' ? 1 : 0);
      if (uploadOutcome === 'lost-response') await expect(loadManagedRetryAuthority('cli-managed-source-123', TENANT_ID, TENANT_ID, 'planning-portal')).resolves.toMatchObject({ publicApiUrl: API_BASE, actorId: 'test-user-oid' });
      else await expect(readFile(managedDeployStatePath('cli-managed-source-123'))).rejects.toMatchObject({ code: 'ENOENT' });
      return;
    }
    expect(process.exitCode).toBe(0);
    expect(result).toMatchObject({ source: 'eai-managed', sourceMode: 'eai-cli-generated', classification: 'pending', status: 'pending_review', operationId: 'cli-managed-source-123' });
    expect(JSON.stringify(result)).not.toContain('one-use-ticket');
    expect(prepared).not.toHaveProperty('repo');
    expect(requests.some(url => url.includes('/source-unknown/'))).toBe(false);
    const receipt = JSON.parse(await readFile(join(projectRoot, '.eai/cli-managed-source-receipt.json'), 'utf8'));
    expect(receipt.bundleSha256).toBe(uploaded.bundleSha256);
    expect(receipt.bundleSha256).toBe(result.bundleSha256);
  });

  test('requires browser verification before accepting the source choice', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const identity = stubManagedOperation().getMockImplementation()!;
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      requests.push(url);
      return url.endsWith('/github-link-sessions') ? jsonResponse(linkedGitHubSession('pending')) : identity(input);
    }));
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync(['planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID, '--source', 'eai-managed', '--format', 'json'], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ ok: false, error: { code: 'GITHUB_LINK_REQUIRED', message: expect.stringContaining('--github-link-session github-link-123') } });
    expect(requests.some(url => url.endsWith('/preparations') || url.includes('/source-unknown/'))).toBe(false);
  });

  test('rejects an unapproved PublicAPI origin before any authenticated request', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    process.env.BASE_URL_PUBLIC_API = 'https://attacker.example/public';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID,
      '--target-tenant-id', TENANT_ID, '--source', 'eai-managed', '--format', 'json',
    ], { from: 'user' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      ok: false,
      error: { code: 'EAI_MANAGED_DEPLOY_FAILED', message: expect.stringContaining('trusted EAI regional PublicAPI') },
    });
    expect(process.exitCode).toBe(1);
  });

  test('rejects redirects for authenticated tenant-context setup traffic', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const requests: Array<{ url: string; redirect?: RequestRedirect }> = [];
    const fetchMock = vi.fn(async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const url = String(input);
      requests.push({ url, redirect: init?.redirect });
      if (url === `${API_BASE}/v4/identity/tenants`) {
        return jsonResponse({ tenants: [{ id: TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'] }] });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${TENANT_ID}` || url === `${API_BASE}/v4/platform/tenants/${TENANT_ID}/management`) {
        return jsonResponse({ id: TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'] });
      }
      if (url.endsWith('/cli-managed-source/github-link-sessions')) {
        return jsonResponse(linkedGitHubSession('pending'));
      }
      return jsonResponse({ message: `Unhandled request ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID,
      '--target-tenant-id', TENANT_ID, '--source', 'eai-managed', '--format', 'json',
    ], { from: 'user' });

    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      ok: false,
      error: { code: 'GITHUB_LINK_REQUIRED' },
    });
    expect(requests.filter(({ url }) => url.startsWith(API_BASE))).not.toHaveLength(0);
    expect(requests.filter(({ url, redirect }) => url.startsWith(API_BASE) && redirect !== 'error')).toEqual([]);
  });

  test("resumes a publishing upload using unchanged local bytes and the original linked Portal origin", async () => {
    await mkdir(join(projectRoot, "src/app"), { recursive: true });
    await writeFile(join(projectRoot, "eai.runtime.json"), "{}");
    await writeFile(
      join(projectRoot, "src/app/page.tsx"),
      'export default function Page() { return "retry"; }',
    );
    await writeFile(
      join(projectRoot, ".eai-manifest.json"),
      JSON.stringify({ template: { commit: "a".repeat(40) } }),
    );
    await exec("git", ["init", "-b", "main"], { cwd: projectRoot });
    await exec("git", ["add", "."], { cwd: projectRoot });
    await exec(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-m",
        "Initial scaffold from template\n\nCreated by: eai init",
      ],
      { cwd: projectRoot },
    );
    const { bundle } = await buildCliManagedSourceBundle(projectRoot);
    const identity = stubManagedOperation().getMockImplementation()!;
    let operationReads = 0;
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          const url = String(input);
          requests.push(url);
          if (
            url.includes(
              "/cli-managed-source/github-link-sessions/github-link-123",
            )
          )
            return jsonResponse(linkedGitHubSession());
          if (url.startsWith("https://dev-admin-portal.myenterprise.ai/")) {
            expect(init?.headers).toMatchObject({
              "X-EAI-Upload-Ticket": "original-upload-ticket",
            });
            expect(JSON.parse(String(init?.body)).bundle.bundleSha256).toBe(
              bundle.bundleSha256,
            );
            return jsonResponse({ status: "pending_review" }, 202);
          }
          if (url.includes("/cli-managed-source/operations/"))
            return jsonResponse({
              schemaVersion: "eai.cli_managed_source_operation.v1",
              sourceMode: "eai-cli-generated",
              operationId: "cli-managed-source-123",
              status: operationReads++ === 0 ? "publishing" : "pending_review",
              tenantId: TENANT_ID,
              targetTenantId: TENANT_ID,
              appKey: "planning-portal",
              environment: "preview",
              actorId: "test-user-oid",
              templateCommitSha: bundle.templateCommitSha,
              bundleSha256: bundle.bundleSha256,
              configHash: bundle.configHash,
              githubLinkSessionId: "github-link-123",
              verifiedGithubUser: linkedGitHubSession().verifiedGithubUser,
              repository: {
                owner: "eai-generated-apps",
                name: "server-derived-app",
              },
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
              upload: {
                url: "https://dev-admin-portal.myenterprise.ai/api/platform/generated-apps/cli-managed-source/uploads/cli-managed-source-123",
                ticket: "original-upload-ticket",
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
                sha256: bundle.bundleSha256,
              },
            });
          return identity(input);
        },
      ),
    );
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync(
      [
        "planning-portal",
        "--target",
        "eai",
        "--tenant-id",
        TENANT_ID,
        "--target-tenant-id",
        TENANT_ID,
        "--source",
        "eai-managed",
        "--resume",
        "cli-managed-source-123",
        "--no-wait",
        "--format",
        "json",
      ],
      { from: "user" },
    );
    expect(
      JSON.parse(output.mock.calls.map(([value]) => String(value)).join("")),
    ).toMatchObject({
      classification: "pending",
      publicationStatus: "pending_review",
    });
    expect(
      requests.filter((url) => url.startsWith("https://dev-admin-portal.myenterprise.ai/")),
    ).toHaveLength(1);
    expect(
      requests.some((url) => url.endsWith("/cli-managed-source/preparations")),
    ).toBe(false);
  });

  test.each(['--resume', '--retry'] as const)(
    'requires a fresh EAI-maintained operation after terminal publication failure for %s',
    async recoveryFlag => {
      await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
      const identity = stubManagedOperation().getMockImplementation()!;
      const requests: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        requests.push(url);
        if (url.includes('/cli-managed-source/operations/')) {
          return jsonResponse(failedManagedPublication());
        }
        return identity(input);
      }));
      const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await eaiManagedDeployCommand.parseAsync([
        'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID,
        '--target-tenant-id', TENANT_ID, '--source', 'eai-managed',
        recoveryFlag, 'cli-managed-source-123', '--no-wait', '--format', 'json',
      ], { from: 'user' });

      expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
        ok: false,
        error: {
          code: 'SOURCE_OPERATION_INACTIVE',
          nextAction: expect.stringContaining('fresh source operation and nonce'),
        },
      });
      expect(requests.filter(url => url.includes('/cli-managed-source/operations/'))).toHaveLength(1);
      expect(requests.filter(url => url.includes('/managed-deployments/operations/'))).toHaveLength(1);
      expect(process.exitCode).toBe(1);
    },
  );

  test.each(['--resume', '--retry'] as const)('rejects an explicit source conflict before recovery mutation for %s', async flag => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const state = customerRetryState();
    if (flag === '--retry') await saveManagedDeployState(state);
    const fetchMock = stubManagedOperation(completeUnifiedOperation());
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID,
      '--target-tenant-id', TENANT_ID, '--source', 'eai-managed', flag, state.operationId,
      '--no-wait', '--format', 'json',
    ], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ ok: false, error: { code: 'RECOVERY_SOURCE_MISMATCH' } });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/cli-managed-source/operations/'))).toBe(false);
  });

  test.each(['dev', 'test', 'prod'] as const)('uses the sealed managed recovery environment %s without a flag', async environment => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const identity = stubManagedOperation(completeUnifiedOperation({ operationId: 'cli-managed-source-123', sourceMode: 'eai-cli-generated', environment, repoOwner: 'eai-generated-apps', repoName: 'app', configHash: `sha256:${'c'.repeat(64)}` })).getMockImplementation()!;
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async input => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/cli-managed-source/operations/')) return jsonResponse({ ...completedManagedPublication(), environment });
      return identity(input);
    }));
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID,
      '--resume', 'cli-managed-source-123', '--no-wait', '--format', 'json',
    ], { from: 'user' });
    expect(requests.filter(url => url.includes('/cli-managed-source/operations/')).every(url => url.includes(`environment=${environment}`))).toBe(true);
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ classification: 'succeeded' });
  });

  test('loads original retry authority independently of the source-operation namespace', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const state = { ...customerRetryState({ publicApiUrl: 'https://test-api.ca.myenterprise.ai/public' }), operationId: 'other-customer-operation' };
    await saveManagedDeployState(state);
    const operation = completeUnifiedOperation({ operationId: state.operationId });
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async input => {
      const url = String(input); calls.push(url);
      expect(url.startsWith(state.publicApiUrl)).toBe(true);
      if (url.includes('/managed-deployments/operations/')) return jsonResponse(operation);
      if (url.endsWith('/identity/tenants')) return jsonResponse({ tenants: [{ id: TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'] }] });
      return jsonResponse({ id: TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'] });
    }));
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID,
      '--retry', state.operationId, '--no-wait', '--format', 'json',
    ], { from: 'user' });
    expect(calls.some(url => url.includes('/managed-deployments/operations/other-customer-operation'))).toBe(true);
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ classification: 'succeeded' });
  });

  test('does not silently choose customer-owned source from repository flags', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const fetchMock = stubManagedOperation();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync(['planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID, '--repo', 'customer/app', '--installation-id', '123', '--format', 'json'], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ ok: false, error: { code: 'SOURCE_CHOICE_REQUIRED' } });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/github-link-sessions'))).toBe(false);
  });

  test('keeps managed completion pending until the unified operation has exact doctor proof', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const identity = stubManagedOperation().getMockImplementation()!;
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/cli-managed-source/operations/')) return jsonResponse(completedManagedPublication());
      if (url.includes('/managed-deployments/operations/')) {
        const operation = completeUnifiedOperation({
          operationId: 'cli-managed-source-123', sourceMode: 'eai-cli-generated',
          repoOwner: 'eai-generated-apps', repoName: 'app', configHash: `sha256:${'c'.repeat(64)}`,
        });
        (operation.doctor as Record<string, unknown>).ready = false;
        return jsonResponse(operation);
      }
      return identity(input);
    }));
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync(['planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID, '--source', 'eai-managed', '--resume', 'cli-managed-source-123', '--no-wait', '--format', 'json'], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      source: 'eai-managed', sourceMode: 'eai-cli-generated', classification: 'pending', publicationStatus: 'completed',
    });
    expect(requests.some(url => url.includes('/managed-deployments/operations/cli-managed-source-123'))).toBe(true);
    expect(requests.some(url => url.includes('/source-unknown/') || url.endsWith('/github-link-sessions'))).toBe(false);
    expect(process.exitCode).toBe(0);
  });

  test('reports EAI-maintained success only from exact unified source and doctor evidence', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const identity = stubManagedOperation().getMockImplementation()!;
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/cli-managed-source/operations/')) return jsonResponse(completedManagedPublication());
      if (url.includes('/managed-deployments/operations/')) return jsonResponse(completeUnifiedOperation({
        operationId: 'cli-managed-source-123', sourceMode: 'eai-cli-generated',
        repoOwner: 'eai-generated-apps', repoName: 'app', configHash: `sha256:${'c'.repeat(64)}`,
      }));
      return identity(input);
    }));
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID,
      '--resume', 'cli-managed-source-123', '--no-wait', '--format', 'json',
    ], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      source: 'eai-managed', sourceMode: 'eai-cli-generated', status: 'active',
      classification: 'succeeded', publicationStatus: 'completed',
      sourceBinding: {
        repository: 'eai-generated-apps/app', workflowPath: '.github/workflows/eai-app.yml',
        artifactDigest: expect.stringMatching(/^sha256:/), imageDigest: expect.stringMatching(/^sha256:/),
      },
    });
    expect(requests.some(url => url.includes('/managed-deployments/operations/cli-managed-source-123'))).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  test.each([
    ['missing', undefined],
    ['malformed', 'not-a-commit'],
    ['mismatched', 'd'.repeat(40)],
  ] as const)('rejects %s EAI-maintained merged commit evidence', async (_label, mergedSha) => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const identity = stubManagedOperation().getMockImplementation()!;
    const publication = completedManagedPublication();
    publication.review = mergedSha === undefined ? {} : { mergedSha };
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('/cli-managed-source/operations/')) return jsonResponse(publication);
      if (url.includes('/managed-deployments/operations/')) return jsonResponse(completeUnifiedOperation({
        operationId: 'cli-managed-source-123', sourceMode: 'eai-cli-generated',
        repoOwner: 'eai-generated-apps', repoName: 'app', configHash: `sha256:${'c'.repeat(64)}`,
      }));
      return identity(input);
    }));
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID,
      '--target-tenant-id', TENANT_ID, '--source', 'eai-managed',
      '--resume', 'cli-managed-source-123', '--no-wait', '--format', 'json',
    ], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      ok: false, error: { code: 'MANAGED_SOURCE_BINDING_MISMATCH' },
    });
    expect(process.exitCode).toBe(1);
  });

  test.each([
    ['configuration', { configHash: `sha256:${'d'.repeat(64)}` }],
    ['repository', { repoName: 'other-app' }],
  ])('rejects a unified EAI-maintained %s substitution', async (_label, replacement) => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const identity = stubManagedOperation().getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('/cli-managed-source/operations/')) return jsonResponse(completedManagedPublication());
      if (url.includes('/managed-deployments/operations/')) return jsonResponse(completeUnifiedOperation({
        operationId: 'cli-managed-source-123', sourceMode: 'eai-cli-generated',
        repoOwner: 'eai-generated-apps', repoName: 'app', configHash: `sha256:${'c'.repeat(64)}`,
        ...replacement,
      }));
      return identity(input);
    }));
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID,
      '--source', 'eai-managed', '--resume', 'cli-managed-source-123', '--no-wait', '--format', 'json',
    ], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      ok: false, error: { code: 'MANAGED_SOURCE_BINDING_MISMATCH' },
    });
    expect(process.exitCode).toBe(1);
  });

  test('rejects an unsupported new deployment environment before any API or repository work', async () => {
    const fetchMock = stubManagedOperation();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID,
      '--environment', 'staging', '--format', 'json',
    ], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ ok: false, error: { code: 'DEPLOY_ENVIRONMENT_INVALID' } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test.each(['eai-managed', 'customer-owned'] as const)('requires an explicit initial target tenant for %s source before any request', async source => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--source', source,
      ...(source === 'customer-owned' ? ['--repo', 'enterprise/planning-portal', '--installation-id', '12345'] : []),
      '--format', 'json',
    ], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ ok: false, error: { code: 'TARGET_TENANT_REQUIRED' } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test.each(['configured', 'cross-tenant', 'failed', 'wrong-target', 'retry', 'crash-before-claim', 'source-mismatch', 'already-dispatched', 'uncertain-dispatch', 'lost-response'] as const)('bootstraps runtime before immutable dispatch: %s', async (bootstrap) => {
    const targetTenantId = bootstrap === 'cross-tenant' ? 'runtime-child' : TENANT_ID;
    await mkdir(join(projectRoot, 'src', 'eai.config'), { recursive: true });
    await writeFile(join(projectRoot, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{"schemaVersion":"1"}\n');
    await installCanonicalManagedDeployFiles(projectRoot);
    await exec('git', ['init', '-b', 'main'], { cwd: projectRoot });
    await exec('git', ['config', 'user.name', 'EAI Test'], { cwd: projectRoot });
    await exec('git', ['config', 'user.email', 'eai-test@example.com'], { cwd: projectRoot });
    await exec('git', ['remote', 'add', 'origin', 'git@github.com:enterprise/planning-portal.git'], { cwd: projectRoot });
    await exec('git', ['add', '.'], { cwd: projectRoot });
    await exec('git', ['commit', '-m', 'test fixture'], { cwd: projectRoot });
    const { stdout: shaOutput } = await exec('git', ['rev-parse', 'HEAD'], { cwd: projectRoot });
    const commitSha = shaOutput.trim();

    const binDir = join(env.dir, 'bin');
    const ghLog = join(env.dir, 'gh.log');
    await mkdir(binDir);
    const ghPath = join(binDir, 'gh');
    await writeFile(ghPath, `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_GH_LOG"
if [ "$1 $2" = "repo view" ]; then
  printf '{"viewerPermission":"WRITE","isArchived":false,"isPrivate":true}\\n'
elif [ "$1 $2" = "api user" ]; then
  printf '{"id":123,"login":"linked-user"}\\n'
elif [ "$1" = "api" ]; then
  printf '{"object":{"sha":"%s"}}\\n' "$FAKE_GIT_SHA"
elif [ "$1 $2" = "workflow run" ]; then
  test -f "$HOME/.eai/managed-deployments/source-unknown-abc123.json.dispatch" || exit 90
  grep -q '"status": "dispatching"' "$HOME/.eai/managed-deployments/source-unknown-abc123.json.dispatch" || exit 91
  ${bootstrap === 'lost-response' ? 'touch "$HOME/lost-response-accepted"; exit 1' : ':'}
elif [ "$1 $2" = "run list" ]; then
  if [ -f "$HOME/lost-response-accepted" ]; then
    printf '[{"databaseId":789,"displayTitle":"EAI deploy planning-portal (source-unknown-abc123)","createdAt":"%s","headSha":"%s","event":"workflow_dispatch"}]\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$FAKE_GIT_SHA"
  else
    printf '[]\\n'
  fi
fi
`);
    await chmod(ghPath, 0o755);
    process.env.PATH = `${binDir}:${original.PATH}`;
    process.env.FAKE_GH_LOG = ghLog;
    process.env.FAKE_GIT_SHA = commitSha;

    const configHash = await buildManagedDeployConfigHash(projectRoot);
    const retryState: ManagedDeployState = {
      schema: 'eai.managed-deploy-state.v1', tenantId: TENANT_ID, targetTenantId,
      appKey: 'planning-portal', operationId: 'source-unknown-abc123', nonce: 'one-time-nonce',
      repo: 'enterprise/planning-portal', branch: 'main', ref: 'refs/heads/main', commitSha,
      workflowPath: '.github/workflows/eai-app.yml', configHash, environment: 'preview', installationId: 12345,
      publicApiUrl: API_BASE,
      ...ACTOR_BINDING,
    };
    const retryMode = ['retry', 'crash-before-claim', 'already-dispatched', 'uncertain-dispatch'].includes(bootstrap);
    if (bootstrap === 'already-dispatched') retryState.dispatchedAt = new Date().toISOString();
    if (bootstrap === 'crash-before-claim' || bootstrap === 'uncertain-dispatch') retryState.dispatchStartedAt = new Date().toISOString();
    if (retryMode) await saveManagedDeployState(retryState);
    if (bootstrap === 'uncertain-dispatch') await claimManagedDeployDispatch(retryState);
    let operationReads = 0;
    const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = String(init?.method || 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      requests.push({ url, method, body });
      if (url === `${API_BASE}/v4/identity/tenants`) {
        return jsonResponse({ tenants: [{ id: TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'] }] });
      }
      if (url === `${API_BASE}/v4/platform/tenants/${TENANT_ID}` || url === `${API_BASE}/v4/platform/tenants/${TENANT_ID}/management`) {
        return jsonResponse({ id: TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'] });
      }
      if (url.endsWith('/source-unknown/register')) return jsonResponse({ status: 'registered' });
      if (url.endsWith('/cli-managed-source/github-link-sessions') || url.includes('/cli-managed-source/github-link-sessions/github-link-123?')) return jsonResponse(linkedGitHubSession('verified', targetTenantId));
      if (url.endsWith('/source-unknown/workflow-setup')) {
        return jsonResponse({ status: 'issued', operationId: 'source-unknown-abc123', nonce: 'one-time-nonce' });
      }
      if (url.endsWith('/environments/preview/runtime-bootstrap')) {
        return bootstrap === 'failed' ? jsonResponse({ message: 'runtime setup unavailable' }, 503) : jsonResponse({
          status: 'configured', sourceOperationId: 'source-unknown-abc123', appKey: 'planning-portal',
          tenantId: TENANT_ID, targetTenantId: bootstrap === 'wrong-target' ? 'different-child' : targetTenantId, environment: 'preview',
        });
      }
      if (url.endsWith(`/managed-deployments/operations/source-unknown-abc123?targetTenantId=${targetTenantId}`)) {
        if ((retryMode || bootstrap === 'lost-response') && operationReads++ === 0) return jsonResponse({
          appScopeTenantId: TENANT_ID, targetTenantId, appKey: retryState.appKey, operationId: retryState.operationId, environment: retryState.environment,
          sourceMode: 'source-unknown', sourceStatus: 'issued', status: 'issued',
          setup: { ...retryState, nonceSha256: managedDeployNonceSha256(retryState.nonce), repo: { owner: 'enterprise', name: 'planning-portal' }, deployOnSuccess: true },
        });

        return jsonResponse({
          ...completeUnifiedOperation({ targetTenantId, commitSha, configHash }),
          setup: {
            targetTenantId,
            repo: { owner: 'enterprise', name: 'planning-portal' },
            workflowPath: '.github/workflows/eai-app.yml',
            ref: 'refs/heads/main',
            commitSha: bootstrap === 'source-mismatch' ? 'f'.repeat(40) : commitSha,
            sourceCommitSha: commitSha, repositoryId: 123, installationId: 12345,
            configHash,
            environment: 'preview',
            deployOnSuccess: true,
            nonceSha256: managedDeployNonceSha256(retryState.nonce),
            actorId: ACTOR_BINDING.actorId,
            githubLinkSessionId: ACTOR_BINDING.githubLinkSessionId,
          },
          evidence: { status: 'accepted' },
          deploymentRequest: { status: 'active' },
        });
      }
      return jsonResponse({ message: `Unhandled ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await eaiManagedDeployCommand.parseAsync([
      'planning-portal',
      '--target', 'eai',
      '--tenant-id', TENANT_ID,
      '--target-tenant-id', targetTenantId,
      '--source', 'customer-owned', '--repo', 'enterprise/planning-portal',
      '--installation-id', '12345',
      ...(retryMode ? ['--retry', retryState.operationId] : []),
      '--wait',
      '--format', 'json',
    ], { from: 'user' });

    const registration = requests.find((request) => request.url.endsWith('/source-unknown/register'));
    const setup = requests.find((request) => request.url.endsWith('/source-unknown/workflow-setup'));
    if (retryMode) {
      expect(registration).toBeUndefined();
      expect(setup).toBeUndefined();
    } else {
      expect(registration?.body).toMatchObject({
        repoOwner: 'enterprise',
        repoName: 'planning-portal',
        installationId: 12345,
        targetTenantId,
        commitSha,
        githubLinkSessionId: ACTOR_BINDING.githubLinkSessionId,
      });
      expect(setup?.body).toMatchObject({
        deployOnSuccess: true,
        ref: 'refs/heads/main',
        commitSha,
        targetTenantId,
        githubLinkSessionId: ACTOR_BINDING.githubLinkSessionId,
      });
    }
    if (bootstrap === 'already-dispatched') {
      expect(requests.some(request => request.url.endsWith('/runtime-bootstrap'))).toBe(false);
      expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ classification: 'succeeded' });
      await expect(readFile(ghLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      return;
    }
    if (bootstrap === 'uncertain-dispatch') {
      const result = JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''));
      expect(result).toMatchObject({ ok: false, error: { code: 'GITHUB_WORKFLOW_DISPATCH_UNCERTAIN' } });
      expect(await readFile(ghLog, 'utf8')).not.toContain('workflow run');
      expect(process.exitCode).toBe(1);
      return;
    }
    if (bootstrap === 'source-mismatch') {
      expect(await readFile(ghLog, 'utf8')).not.toContain('workflow run');
      expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
        ok: false, error: { code: 'WORKFLOW_SETUP_BINDING_MISMATCH' },
      });
      expect(requests.some(request => request.url.endsWith('/runtime-bootstrap'))).toBe(false);
      expect(process.exitCode).toBe(1);
      return;
    }
    const bootstrapIndex = requests.findIndex(request => request.url.endsWith('/runtime-bootstrap'));
    expect(bootstrapIndex).toBeGreaterThan(requests.findIndex(request => request.url.endsWith('/workflow-setup')));
    expect(requests[bootstrapIndex]?.body).toEqual({
      sourceOperationId: 'source-unknown-abc123', targetTenantId, sourceMode: 'source-unknown',
    });
    if (bootstrap === 'failed' || bootstrap === 'wrong-target') {
      expect(await readFile(ghLog, 'utf8')).not.toContain('workflow run');
      expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
        ok: false, error: { code: bootstrap === 'failed' ? 'RUNTIME_BOOTSTRAP_FAILED' : 'RUNTIME_BOOTSTRAP_BINDING_MISMATCH' },
      });
      expect(process.exitCode).toBe(1);
      return;
    }
    expect(requests.some((request) => request.url.includes('/deployments/latest'))).toBe(false);
    expect(requests.some((request) => request.url.includes('/managed-deployments/operations/source-unknown-abc123'))).toBe(true);
    expect(requests.some((request) => request.url.includes('/source-unknown/operations/'))).toBe(false);
    const result = JSON.parse(output.mock.calls.map(([value]) => String(value)).join('')) as Record<string, unknown>;
    const ghCalls = await readFile(ghLog, 'utf8');
    expect(ghCalls).not.toContain('variable set');
    expect(ghCalls, JSON.stringify(result)).toContain(`commit_sha=${commitSha}`);
    expect(ghCalls).toContain(`public_api_url=${API_BASE}`);
    expect(ghCalls).toContain(`target_tenant_id=${targetTenantId}`);
    expect(ghCalls).toContain('source_mode=source-unknown');
    expect(ghCalls).toContain('workflow run .github/workflows/eai-app.yml');
    expect(ghCalls).toContain('operation_id=source-unknown-abc123');
    if (bootstrap === 'lost-response') {
      expect(result).toMatchObject({ classification: 'succeeded', status: 'active' });
      const saved = JSON.parse(await readFile(managedDeployStatePath(retryState.operationId), 'utf8'));
      expect(saved.dispatchStartedAt).toBeTruthy();
      expect(saved.dispatchedAt).toBeTruthy();
      expect(saved.githubRunId).toBe(789);
      expect((await readFile(ghLog, 'utf8')).match(/workflow run/g)).toHaveLength(1);
      expect(requests.filter(request => request.url.endsWith('/runtime-bootstrap'))).toHaveLength(1);
      expect(process.exitCode).toBe(0);
      return;
    }
    expect(result).toMatchObject({
      targetTenantId,
      status: 'active',
      classification: 'succeeded',
      deploymentId: 'dep-1',
      activeUrl: 'https://planning.example.com',
      requiresTenantInfra: true,
      sourceBinding: {
        repository: 'enterprise/planning-portal',
        ref: 'refs/heads/main',
        commitSha,
      },
    });
    expect(String(result.nextAction)).toContain('eai deploy doctor --operation-id source-unknown-abc123');
    expect(process.exitCode).toBe(0);
  });

  test.each([
    ['accepted', 'handoff_pending', 'preview'], ['consumed', 'handoff_pending', 'dev'],
    ['accepted', 'expired', 'test'], ['consumed', 'expired', 'prod'],
    ['accepted', 'revoked', 'test'], ['consumed', 'revoked', 'prod'],
  ] as const)('retries server %s evidence handoff in %s for %s without redispatch or Git checkout', async (evidenceState, operationStatus, environment) => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const state = customerRetryState({
      targetTenantId: 'runtime-child',
      environment,
    });
    await saveManagedDeployState(state);
    let deployed = false;
    const requests: Array<{ url: string; body: unknown }> = [];
    const identityFetch = stubManagedOperation();
    const identityImpl = identityFetch.getMockImplementation()!;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/managed-deployments/operations/')) return jsonResponse({
        appScopeTenantId: TENANT_ID, targetTenantId: 'runtime-child', appKey: 'planning-portal',
        operationId: 'source-unknown-abc123', environment, sourceMode: 'source-unknown',
        sourceStatus: deployed ? 'queued' : operationStatus, status: deployed ? 'queued' : operationStatus,
        setup: customerOperationSetup(state, {
          status: evidenceState === 'consumed' ? 'consumed' : 'issued',
        }),
        evidence: evidenceState === 'accepted' ? { status: 'accepted' } : undefined,
      });
      if (url.endsWith('/source-unknown/deploy')) { deployed = true; return jsonResponse({ status: 'queued' }, 202); }
      return identityImpl(input);
    });
    vi.stubGlobal('fetch', fetchMock);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', 'runtime-child',
      '--retry', 'source-unknown-abc123', '--no-wait', '--format', 'json',
    ], { from: 'user' });
    expect(requests.filter(request => request.url.endsWith('/source-unknown/deploy'))).toEqual([{
      url: `${API_BASE}/v4/platform/tenants/${TENANT_ID}/apps/planning-portal/source-unknown/deploy`,
      body: { operationId: 'source-unknown-abc123', targetTenantId: 'runtime-child', environment },
    }]);
    expect(requests.some(request => request.url.endsWith('/workflow-setup') || request.url.endsWith('/runtime-bootstrap'))).toBe(false);
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ status: 'queued' });
    expect(process.exitCode).toBe(0);
  });

  test.each([undefined, 'staging'] as const)('refuses accepted-evidence retry without a supported server environment (%s)', async (environment) => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const state = customerRetryState({ targetTenantId: 'runtime-child' });
    await saveManagedDeployState(state);
    const requests: string[] = [];
    const identityFetch = stubManagedOperation();
    const identityImpl = identityFetch.getMockImplementation()!;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/managed-deployments/operations/')) return jsonResponse({
        appScopeTenantId: TENANT_ID, targetTenantId: 'runtime-child', appKey: 'planning-portal',
        operationId: 'source-unknown-abc123', environment, sourceMode: 'source-unknown',
        sourceStatus: 'handoff_pending', status: 'handoff_pending',
        setup: customerOperationSetup(state, { status: 'issued' }),
        evidence: { status: 'accepted' },
      });
      return identityImpl(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', 'runtime-child',
      '--retry', 'source-unknown-abc123', '--no-wait', '--format', 'json',
    ], { from: 'user' });

    expect(requests.some(url => url.endsWith('/source-unknown/deploy'))).toBe(false);
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      ok: false, error: { code: 'SOURCE_OPERATION_ENVIRONMENT_INVALID' },
    });
    expect(process.exitCode).toBe(1);
  });

  test.each([
    ['expired', '--resume'], ['revoked', '--resume'],
    ['failed', '--resume'], ['rejected', '--resume'],
    ['expired', '--retry'], ['revoked', '--retry'],
    ['failed', '--retry'], ['rejected', '--retry'],
  ] as const)('stops %s %s immediately and requests a new setup without dispatch', async (status, mode) => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    if (mode === '--retry') await saveManagedDeployState(customerRetryState());
    const fetchMock = stubManagedOperation({
      appScopeTenantId: TENANT_ID, targetTenantId: TENANT_ID, appKey: 'planning-portal',
      operationId: 'source-unknown-abc123', sourceMode: 'source-unknown', sourceStatus: status,
      status, setup: { status, targetTenantId: TENANT_ID },
    });
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID,
      mode, 'source-unknown-abc123', '--wait', '--format', 'json',
    ], { from: 'user' });

    const result = JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''));
    expect(result).toMatchObject(mode === '--retry'
      ? { ok: false, error: { code: 'SOURCE_OPERATION_INACTIVE' } }
      : { status, classification: 'failed' });
    if (mode === '--retry') expect(result.error.nextAction).toContain('fresh source operation and nonce');
    else expect(result.nextAction).toContain('fresh source operation and nonce');
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/managed-deployments/operations/'))).toHaveLength(1);
    expect(fetchMock.mock.calls.every(([input]) => !String(input).endsWith('/deploy')
      && !String(input).endsWith('/runtime-bootstrap') && !String(input).endsWith('/workflow-setup'))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  test('refuses pre-evidence retry when protected state differs from server setup', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const state: ManagedDeployState = {
      schema: 'eai.managed-deploy-state.v1', tenantId: TENANT_ID, targetTenantId: TENANT_ID,
      appKey: 'planning-portal', operationId: 'source-unknown-abc123', nonce: 'original-nonce',
      repo: 'enterprise/planning-portal', branch: 'main', ref: 'refs/heads/main', commitSha: 'a'.repeat(40),
      workflowPath: '.github/workflows/eai-app.yml', configHash: `sha256:${'b'.repeat(64)}`,
      environment: 'preview', installationId: 12345,
      publicApiUrl: API_BASE,
      ...ACTOR_BINDING,
    };
    await saveManagedDeployState(state);
    const fetchMock = stubManagedOperation({
      appScopeTenantId: TENANT_ID, targetTenantId: TENANT_ID, appKey: state.appKey, operationId: state.operationId,
      environment: state.environment, configHash: state.configHash,
      sourceMode: 'source-unknown', sourceStatus: 'issued', status: 'issued',
      setup: { ...state, nonceSha256: managedDeployNonceSha256(state.nonce), repo: { owner: 'enterprise', name: 'planning-portal' }, commitSha: 'c'.repeat(40), deployOnSuccess: true },
    });
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      state.appKey, '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID,
      '--retry', state.operationId, '--no-wait', '--format', 'json',
    ], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ ok: false, error: { code: 'RETRY_SERVER_BINDING_MISMATCH' } });
    expect(fetchMock.mock.calls.every(([input]) => !String(input).endsWith('/deploy') && !String(input).endsWith('/runtime-bootstrap'))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  test.each([
    { githubUserId: 999 }, { githubLogin: 'different-user' }, { githubProofId: 'different-proof' },
  ])('rejects changed local GitHub proof before retry provider mutation: %j', async changed => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const originalState = customerRetryState();
    const state = { ...originalState, ...changed };
    await saveManagedDeployState(state);
    const fetchMock = stubManagedOperation({
      appScopeTenantId: TENANT_ID, targetTenantId: TENANT_ID, appKey: state.appKey,
      operationId: state.operationId, environment: state.environment, configHash: state.configHash,
      sourceMode: 'source-unknown', sourceStatus: 'issued', status: 'issued',
      setup: customerOperationSetup(originalState),
    });
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      state.appKey, '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID,
      '--retry', state.operationId, '--no-wait', '--format', 'json',
    ], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      ok: false, error: { code: 'RETRY_GITHUB_BINDING_MISMATCH' },
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/github-link-sessions/github-link-123?'))).toBe(true);
    expect(fetchMock.mock.calls.every(([input]) => !String(input).endsWith('/runtime-bootstrap')
      && !String(input).endsWith('/deploy') && !String(input).endsWith('/workflow-setup'))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  test('tightens recovery directory before saving and reading original endpoint authority', async () => {
    const directory = join(env.dir, '.eai', 'managed-deployments');
    const authority = {
      schema: 'eai.managed-recovery-authority.v1' as const, operationId: 'cli-managed-source-123',
      tenantId: TENANT_ID, targetTenantId: TENANT_ID, appKey: 'planning-portal',
      actorId: 'test-user-oid', publicApiUrl: API_BASE,
    };
    await chmod(directory, 0o755);
    await saveManagedRecoveryAuthority(authority);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(managedDeployStatePath(authority.operationId))).mode & 0o777).toBe(0o600);
    await chmod(directory, 0o755);
    await expect(loadManagedRetryAuthority(authority.operationId, TENANT_ID, TENANT_ID, authority.appKey))
      .resolves.toMatchObject({ publicApiUrl: API_BASE, actorId: authority.actorId });
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
  });

  test.each(['.eai', '.eai/managed-deployments'])('rejects a shared writable recovery parent before authority load or save: %s', async unsafe => {
    const path = managedDeployStatePath('cli-managed-source-123');
    const before = await readFile(path, 'utf8');
    await chmod(join(env.dir, unsafe), 0o770);
    await expect(loadManagedRetryAuthority('cli-managed-source-123', TENANT_ID, TENANT_ID, 'planning-portal'))
      .rejects.toMatchObject({ code: 'RETRY_AUTHORITY_UNAVAILABLE' });
    await expect(saveManagedRecoveryAuthority({
      schema: 'eai.managed-recovery-authority.v1', operationId: 'cli-managed-source-123',
      tenantId: TENANT_ID, targetTenantId: TENANT_ID, appKey: 'planning-portal',
      actorId: 'test-user-oid', publicApiUrl: API_BASE,
    })).rejects.toThrow('untrusted directory');
    expect(await readFile(path, 'utf8')).toBe(before);
    expect((await stat(join(env.dir, unsafe))).mode & 0o777).toBe(0o770);
  });

  test.each(['terminal success', 'accepted evidence'] as const)(
    'binds protected retry state before accepting %s',
    async (phase) => {
      await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
      const state = customerRetryState();
      await saveManagedDeployState(state);
      const operation = completeUnifiedOperation();
      (operation.setup as Record<string, unknown>).commitSha = 'c'.repeat(40);
      if (phase === 'accepted evidence') {
        operation.sourceStatus = 'handoff_pending';
        operation.status = 'handoff_pending';
        operation.evidence = { status: 'accepted' };
      }
      const fetchMock = stubManagedOperation(operation);
      const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await eaiManagedDeployCommand.parseAsync([
        state.appKey, '--target', 'eai', '--tenant-id', TENANT_ID,
        '--target-tenant-id', TENANT_ID, '--retry', state.operationId,
        '--no-wait', '--format', 'json',
      ], { from: 'user' });

      expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
        ok: false, error: { code: 'RETRY_SERVER_BINDING_MISMATCH' },
      });
      expect(fetchMock.mock.calls.every(([input]) => !String(input).endsWith('/deploy'))).toBe(true);
      expect(process.exitCode).toBe(1);
    },
  );

  test.each(['before dispatch', 'already dispatched', 'accepted evidence', 'terminal success'] as const)(
    'rejects a changed persisted installation before retry %s without mutation',
    async phase => {
      await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
      const state = { ...customerRetryState(), installationId: 67890 };
      if (phase === 'already dispatched') state.dispatchedAt = new Date().toISOString();
      await saveManagedDeployState(state);
      const operation = completeUnifiedOperation();
      if (phase === 'before dispatch' || phase === 'already dispatched') {
        operation.sourceStatus = 'issued';
        operation.status = 'issued';
      } else if (phase === 'accepted evidence') {
        operation.sourceStatus = 'handoff_pending';
        operation.status = 'handoff_pending';
        operation.evidence = { status: 'accepted' };
      }
      const fetchMock = stubManagedOperation(operation);
      const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await eaiManagedDeployCommand.parseAsync([
        state.appKey, '--target', 'eai', '--tenant-id', TENANT_ID,
        '--target-tenant-id', TENANT_ID, '--retry', state.operationId,
        '--no-wait', '--format', 'json',
      ], { from: 'user' });

      expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
        ok: false, error: { code: 'RETRY_SERVER_BINDING_MISMATCH', message: expect.stringContaining('installationId') },
      });
      expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
      expect(fetchMock.mock.calls.every(([input]) => !String(input).startsWith('https://api.github.com/'))).toBe(true);
      expect(process.exitCode).toBe(1);
    },
  );

  test('requires the target tenant when resuming an exact operation', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{"schemaVersion":"1"}\n');
    stubManagedOperation();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await eaiManagedDeployCommand.parseAsync([
      'planning-portal',
      '--target', 'eai',
      '--tenant-id', TENANT_ID,
      '--resume', 'source-unknown-abc123',
      '--format', 'json',
    ], { from: 'user' });

    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      ok: false, error: { code: 'TARGET_TENANT_REQUIRED' },
    });
    expect(process.exitCode).toBe(1);
  });

  test('rejects an unsafe target tenant before context resolution or network access', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID,
      '--target-tenant-id', '../runtime?tenant=other', '--source', 'customer-owned',
      '--repo', 'enterprise/planning-portal', '--installation-id', '12345', '--format', 'json',
    ], { from: 'user' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      ok: false, error: { code: 'TARGET_TENANT_INVALID' },
    });
    expect(process.exitCode).toBe(1);
  });

  test.each([
    ['--resume', '../other?operation=1'],
    ['--retry', '../other?operation=1'],
    ['--resume', ' source-unknown-abc123 '],
    ['--retry', ' source-unknown-abc123 '],
  ] as const)(
    'rejects an unsafe %s operation ID %s before context, state lookup, or network access',
    async (recoveryFlag, operationId) => {
      await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await eaiManagedDeployCommand.parseAsync([
        'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID,
        '--target-tenant-id', TENANT_ID, recoveryFlag, operationId,
        '--format', 'json',
      ], { from: 'user' });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
        ok: false,
        error: { code: 'SOURCE_OPERATION_ID_INVALID' },
      });
      expect(process.exitCode).toBe(1);
    },
  );

  test('rejects retry without original endpoint authority before any request', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID,
      '--target-tenant-id', TENANT_ID, '--retry', 'source-unknown-missing',
      '--format', 'json',
    ], { from: 'user' });

    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      ok: false, error: { code: 'RETRY_AUTHORITY_UNAVAILABLE' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test('rejects a resumed operation bound to a different child tenant', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{"schemaVersion":"1"}\n');
    stubManagedOperation({
      appScopeTenantId: TENANT_ID,
      targetTenantId: 'different-child',
      appKey: 'planning-portal',
      operationId: 'source-unknown-abc123',
      sourceMode: 'source-unknown',
      sourceStatus: 'handoff_pending',
      status: 'handoff_pending',
      setup: { targetTenantId: 'different-child' },
    });
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await eaiManagedDeployCommand.parseAsync([
      'planning-portal',
      '--target', 'eai',
      '--tenant-id', TENANT_ID,
      '--target-tenant-id', 'runtime-child',
      '--resume', 'source-unknown-abc123',
      '--no-wait',
      '--format', 'json',
    ], { from: 'user' });

    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      ok: false, error: { code: 'SOURCE_OPERATION_TARGET_MISMATCH' },
    });
    expect(process.exitCode).toBe(1);
  });

  test.each([
    ['source mode', { sourceMode: 'eai-cli-generated' }],
    ['app-scope tenant', { appScopeTenantId: 'other-tenant' }],
    ['app key', { appKey: 'other-app' }],
    ['operation ID', { operationId: 'source-unknown-other' }],
  ])('rejects a unified operation with a substituted %s', async (_label, replacement) => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{"schemaVersion":"1"}\n');
    stubManagedOperation({
      ...completeUnifiedOperation({ targetTenantId: 'runtime-child' }),
      ...replacement,
    });
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID,
      '--target-tenant-id', 'runtime-child', '--source', 'customer-owned',
      '--resume', 'source-unknown-abc123',
      '--no-wait', '--format', 'json',
    ], { from: 'user' });

    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      ok: false, error: { code: replacement.sourceMode ? 'RECOVERY_SOURCE_MISMATCH' : 'SOURCE_OPERATION_BINDING_MISMATCH' },
    });
    expect(process.exitCode).toBe(1);
  });

  test('prints the exact child target, source binding, and active URL on resume', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{"schemaVersion":"1"}\n');
    stubManagedOperation({
      ...completeUnifiedOperation({ targetTenantId: 'runtime-child', branch: 'release' }),
      setup: {
        targetTenantId: 'runtime-child', environment: 'preview', repositoryId: 123, installationId: 12345,
        repo: { owner: 'enterprise', name: 'planning-portal' },
        workflowPath: '.github/workflows/eai-app.yml',
        ref: 'refs/heads/release',
        commitSha: 'a'.repeat(40), sourceCommitSha: 'a'.repeat(40),
        configHash: `sha256:${'b'.repeat(64)}`,
      },
    });
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await eaiManagedDeployCommand.parseAsync([
      'planning-portal',
      '--target', 'eai',
      '--tenant-id', TENANT_ID,
      '--target-tenant-id', 'runtime-child',
      '--resume', 'source-unknown-abc123',
      '--wait',
      '--format', 'json',
    ], { from: 'user' });

    const result = JSON.parse(output.mock.calls.map(([value]) => String(value)).join('')) as Record<string, unknown>;
    expect(result).toMatchObject({
      targetTenantId: 'runtime-child',
      classification: 'succeeded',
      activeUrl: 'https://planning.example.com',
      sourceBinding: {
        repository: 'enterprise/planning-portal',
        ref: 'refs/heads/release',
        commitSha: 'a'.repeat(40),
        configHash: `sha256:${'b'.repeat(64)}`,
      },
    });
    expect(String(result.nextAction)).toContain('eai deploy doctor --operation-id source-unknown-abc123');
    expect(process.exitCode).toBe(0);
  });

  test('binds every retry request to the protected original PublicAPI endpoint', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const originalApi = 'https://test-api.ca.myenterprise.ai/public';
    await saveManagedDeployState(customerRetryState({ publicApiUrl: originalApi }));
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      requests.push(url);
      if (url === `${originalApi}/v4/identity/tenants`) {
        return jsonResponse({ tenants: [{ id: TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'], homeRegion: 'au' }] });
      }
      if (url === `${originalApi}/v4/platform/tenants/${TENANT_ID}`
        || url === `${originalApi}/v4/platform/tenants/${TENANT_ID}/management`) {
        return jsonResponse({ id: TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'], homeRegion: 'au' });
      }
      if (url.includes('/managed-deployments/operations/source-unknown-abc123')) {
        return jsonResponse(completeUnifiedOperation());
      }
      return jsonResponse({ message: `Unexpected ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID,
      '--target-tenant-id', TENANT_ID, '--retry', 'source-unknown-abc123',
      '--no-wait', '--format', 'json',
    ], { from: 'user' });

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(url => url.startsWith(`${originalApi}/`))).toBe(true);
    expect(requests.every(url => !url.startsWith(`${API_BASE}/`))).toBe(true);
    await expect(readFile(join(projectRoot, '.env.local'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      operationId: 'source-unknown-abc123', classification: 'succeeded',
    });
    expect(process.exitCode).toBe(0);
  });

  test('writes owner-only doctor evidence bound to one exact active managed operation', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), JSON.stringify({
      schemaVersion: 1,
      capabilities: { authjsEntraSignIn: true, publicApiBffAccess: true, tenantWorkflowConfiguration: true },
      environment: {
        required: ['BASE_URL_PUBLIC_API', 'TENANT_KEYS', 'ENTRA_CLIENT_ID', 'AUTH_URL'],
        tenantKeyPattern: { keysEnv: 'TENANT_KEYS', tenantIdEnv: 'TENANT_{KEY}_ID', workflowIdEnv: 'WORKFLOW_{KEY}_ID' },
      },
      secrets: { required: ['AUTH_SECRET', 'ENTRA_CLIENT_SECRET', 'EAI_READINESS_PROBE_TOKEN'], optional: [] },
      auth: { callbackPath: '/api/auth/callback/microsoft-entra-id' },
      endpoints: {
        health: '/health', authProviders: '/api/auth/providers', runtimeConfig: '/api/eai/config', bffBasePath: '/api/eai', public: [],
        smokeTests: [
          { name: 'health', method: 'GET', path: '/health', expectedStatus: 200, category: 'app_not_running' },
          { name: 'auth-providers', method: 'GET', path: '/api/auth/providers', expectedStatus: 200, category: 'authjs_config' },
          { name: 'runtime-config', method: 'GET', path: '/api/eai/config', expectedStatus: 200, category: 'tenant_workflow_config' },
          { name: 'readiness', method: 'GET', path: '/api/eai/readiness', expectedStatus: 200, category: 'app_code_runtime_error', headers: { authorization: 'Bearer ${EAI_READINESS_PROBE_TOKEN}' }, requiresSecret: 'EAI_READINESS_PROBE_TOKEN' },
        ],
      },
    }, null, 2));
    await writeFile(join(projectRoot, '.env.example'), 'TENANT_KEYS=template\nTENANT_TEMPLATE_ID=<tenant-id>\nWORKFLOW_TEMPLATE_ID=<workflow-id>\n');
    process.env.EAI_READINESS_PROBE_TOKEN = 'doctor-secret-value';
    let replacementRoot = '';
    let displacedRoot = '';
    let replaceRootOnOperationRead = false;
    let replaceRootOnProbe = false;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      if (url === `${API_BASE}/v4/identity/tenants`) return jsonResponse({ tenants: [{ id: TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'] }] });
      if (url === `${API_BASE}/v4/platform/tenants/${TENANT_ID}` || url === `${API_BASE}/v4/platform/tenants/${TENANT_ID}/management`) return jsonResponse({ id: TENANT_ID, displayName: 'Builder Workspace', slug: 'builder-workspace', isActive: true, roles: ['tenant-admin'] });
      if (url === `${API_BASE}/v4/platform/tenants/${TENANT_ID}/apps/planning-portal/managed-deployments/operations/source-unknown-abc123?targetTenantId=runtime-child`) {
        if (replaceRootOnOperationRead) {
          replaceRootOnOperationRead = false;
          await rename(projectRoot, displacedRoot);
          await rename(replacementRoot, projectRoot);
        }
        return jsonResponse({
          ...completeUnifiedOperation({ targetTenantId: 'runtime-child' }),
          setup: { targetTenantId: 'runtime-child', environment: 'preview', repositoryId: 123, installationId: 12345, repo: { owner: 'enterprise', name: 'planning-portal' }, workflowPath: '.github/workflows/eai-app.yml', ref: 'refs/heads/main', commitSha: 'a'.repeat(40), sourceCommitSha: 'a'.repeat(40), configHash: `sha256:${'b'.repeat(64)}` },
        });
      }
      if (replaceRootOnProbe && url.endsWith('/health')) {
        replaceRootOnProbe = false;
        await rename(projectRoot, displacedRoot);
        await rename(replacementRoot, projectRoot);
      }
      expect(init?.redirect).toBe('error');
      if (url.endsWith('/api/eai/readiness')) expect(new Headers(init?.headers).get('authorization')).toBe('Bearer doctor-secret-value');
      if (url.endsWith('/api/auth/providers')) return jsonResponse({ entra: { id: 'entra' } });
      if (url.endsWith('/api/eai/config')) return jsonResponse({ tenants: { template: { tenantId: 'runtime-child', workflowId: 'workflow-1' } } });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await deployCommand.parseAsync([
      'doctor', '--operation-id', 'source-unknown-abc123', '--app-key', 'planning-portal',
      '--tenant-id', TENANT_ID, '--target-tenant-id', 'runtime-child',
      '--evidence-out', '.eai/deploy-doctor.json', '--format', 'json',
    ], { from: 'user' });
    const result = JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''));
    expect(result).toMatchObject({
      schemaVersion: 'eai.managed-deploy-doctor-evidence.v1', status: 'pass', authenticatedReadiness: true,
      operation: { operationId: 'source-unknown-abc123', tenantId: TENANT_ID, targetTenantId: 'runtime-child', configHash: `sha256:${'b'.repeat(64)}` },
      sourceBinding: { repository: 'enterprise/planning-portal', commitSha: 'a'.repeat(40) },
      deployment: { deploymentId: 'dep-1', runtimeIdentity: { clientId: 'runtime-client', principalId: 'runtime-principal' } },
    });
    expect(JSON.stringify(result)).not.toContain('doctor-secret-value');
    const evidencePath = join(projectRoot, '.eai', 'deploy-doctor.json');
    expect(JSON.parse(await readFile(evidencePath, 'utf8'))).toEqual(result);
    expect((await stat(evidencePath)).mode & 0o777).toBe(0o600);
    expect(process.exitCode).toBe(0);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      process.exitCode = Number(code);
      return undefined as never;
    }) as typeof process.exit);
    output.mockClear();
    const outsideEvidence = join(env.dir, 'outside-doctor.json');
    await deployCommand.parseAsync([
      'doctor', '--operation-id', 'source-unknown-abc123', '--app-key', 'planning-portal',
      '--tenant-id', TENANT_ID, '--target-tenant-id', 'runtime-child',
      '--evidence-out', outsideEvidence, '--format', 'json',
    ], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      status: 'fail', error: expect.stringContaining('inside the application root'),
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    await expect(readFile(outsideEvidence, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    replacementRoot = join(env.dir, 'replacement-project');
    displacedRoot = join(env.dir, 'project-original');
    await mkdir(replacementRoot);
    replaceRootOnProbe = true;
    output.mockClear(); fetchMock.mockClear();
    await deployCommand.parseAsync([
      'doctor', '--operation-id', 'source-unknown-abc123', '--app-key', 'planning-portal',
      '--tenant-id', TENANT_ID, '--target-tenant-id', 'runtime-child',
      '--evidence-out', '.eai/probe-race-doctor.json', '--format', 'json',
    ], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ status: 'fail', error: expect.stringContaining('project root changed') });
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/api/eai/readiness'))).toBe(false);
    await rename(projectRoot, replacementRoot);
    await rename(displacedRoot, projectRoot);
    replaceRootOnOperationRead = true;
    output.mockClear();
    await deployCommand.parseAsync([
      'doctor', '--operation-id', 'source-unknown-abc123', '--app-key', 'planning-portal',
      '--tenant-id', TENANT_ID, '--target-tenant-id', 'runtime-child',
      '--evidence-out', '.eai/replaced-root-doctor.json', '--format', 'json',
    ], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
      status: 'fail', error: expect.stringContaining('project root changed'),
    });
    await expect(readFile(join(projectRoot, '.eai', 'replaced-root-doctor.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
