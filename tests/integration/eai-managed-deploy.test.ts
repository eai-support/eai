import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { clearTokens, storeTokens } from '../../src/lib/auth.js';
import {
  DEFAULT_PROD_AUTH_CLIENT_ID,
  DEFAULT_PROD_AUTH_TENANT_ID,
  DEFAULT_PROD_AUTH_TENANT_NAME,
  setActiveProfile,
} from '../../src/lib/profile.js';
import { eaiManagedDeployCommand } from '../../src/commands/eai-managed-deploy.js';
import { buildCliManagedSourceBundle } from '../../src/lib/eai-managed-source.js';
import { installCanonicalManagedDeployFiles, buildManagedDeployConfigHash, managedDeployStatePath, saveManagedDeployState, type ManagedDeployState } from '../../src/lib/eai-managed-deploy.js';

const exec = promisify(execFile);
const API_BASE = 'https://test-api.au.myenterprise.ai/public';
const TENANT_ID = 'company-tenant';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function linkedGitHubSession(status: 'verified' | 'pending' = 'verified'): Record<string, unknown> {
  return {
    schemaVersion: 'eai.cli_managed_github_link_session.v1', sessionId: 'github-link-123', status,
    tenantId: TENANT_ID, appKey: 'planning-portal', targetTenantId: TENANT_ID, environment: 'preview', actorId: 'test-user-oid',
    expiresAt: new Date(Date.now() + 600_000).toISOString(), browserUrl: 'https://portal.example.test/github/link',
    ...(status === 'verified' ? { verifiedGithubUser: { id: 123, login: 'linked-user', proofId: 'proof-123', actorId: 'test-user-oid' } } : {}),
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
      if (url.includes('/source-unknown/operations/')) {
        return operation ? jsonResponse(operation) : jsonResponse({ message: 'operation missing' }, 404);
      }
      if (url.endsWith('/cli-managed-source/github-link-sessions')) return jsonResponse(linkedGitHubSession());
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

  test('publishes exact local source with no customer origin or GitHub write access and reports pending bot review', async () => {
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
      templateCommitSha: prepared.templateCommitSha, bundleSha256: prepared.bundleSha256,
      verifiedGithubUser: (linkedGitHubSession().verifiedGithubUser), repository: { owner: 'eai-generated-apps', name: 'server-derived-app' },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      upload: { url: 'https://portal.example.test/api/platform/generated-apps/cli-managed-source/uploads/cli-managed-source-123', ticket: 'one-use-ticket', expiresAt: new Date(Date.now() + 300_000).toISOString(), sha256: prepared.bundleSha256 },
    });
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/cli-managed-source/preparations')) {
        prepared = JSON.parse(String(init?.body));
        return jsonResponse(envelope('accepted'));
      }
      if (url.startsWith('https://portal.example.test/')) {
        uploaded = JSON.parse(String(init?.body)).bundle;
        expect(init?.redirect).toBe('error');
        expect(init?.headers).toMatchObject({ 'X-EAI-Upload-Ticket': 'one-use-ticket' });
        return jsonResponse({ status: 'pending_review' }, 202);
      }
      if (url.includes('/cli-managed-source/operations/')) return jsonResponse(envelope('pending_review'));
      return identity(input);
    }));
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync(['planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--source', 'eai-managed', '--format', 'json'], { from: 'user' });
    expect(process.exitCode).toBe(0);
    const result = JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''));
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
    await eaiManagedDeployCommand.parseAsync(['planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--source', 'eai-managed', '--format', 'json'], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ error: 'GITHUB_LINK_REQUIRED', message: expect.stringContaining('--github-link-session github-link-123') });
    expect(requests.some(url => url.endsWith('/preparations') || url.includes('/source-unknown/'))).toBe(false);
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
          if (url.startsWith("https://portal.example.test/")) {
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
              githubLinkSessionId: "github-link-123",
              verifiedGithubUser: linkedGitHubSession().verifiedGithubUser,
              repository: {
                owner: "eai-generated-apps",
                name: "server-derived-app",
              },
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
              upload: {
                url: "https://portal.example.test/api/platform/generated-apps/cli-managed-source/uploads/cli-managed-source-123",
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
      requests.filter((url) => url.startsWith("https://portal.example.test/")),
    ).toHaveLength(1);
    expect(
      requests.some((url) => url.endsWith("/cli-managed-source/preparations")),
    ).toBe(false);
  });

  test('does not silently choose customer-owned source from repository flags', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    stubManagedOperation();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync(['planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--repo', 'customer/app', '--installation-id', '123', '--format', 'json'], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ error: 'SOURCE_CHOICE_REQUIRED' });
  });

  test('keeps managed resume on its exact publication route and refuses incomplete runtime proof', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const identity = stubManagedOperation().getMockImplementation()!;
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/cli-managed-source/operations/')) return jsonResponse({
        schemaVersion: 'eai.cli_managed_source_operation.v1', sourceMode: 'eai-cli-generated', operationId: 'cli-managed-source-123', status: 'completed',
        tenantId: TENANT_ID, targetTenantId: TENANT_ID, appKey: 'planning-portal', environment: 'preview', actorId: 'test-user-oid',
        templateCommitSha: 'a'.repeat(40), bundleSha256: `sha256:${'b'.repeat(64)}`, verifiedGithubUser: linkedGitHubSession().verifiedGithubUser,
        repository: { owner: 'eai-generated-apps', name: 'app' }, deployment: { status: 'ready', liveUrl: 'https://live.example.test' },
      });
      return identity(input);
    }));
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync(['planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID, '--source', 'eai-managed', '--resume', 'cli-managed-source-123', '--format', 'json'], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ classification: 'incomplete', publicationStatus: 'completed' });
    expect(requests.some(url => url.includes('/source-unknown/') || url.endsWith('/github-link-sessions'))).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  test('rejects an unsupported new deployment environment before any API or repository work', async () => {
    const fetchMock = stubManagedOperation();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID,
      '--environment', 'staging', '--format', 'json',
    ], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ error: 'DEPLOY_ENVIRONMENT_INVALID' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test.each(['configured', 'failed', 'wrong-target', 'retry', 'source-mismatch', 'already-dispatched', 'uncertain-dispatch', 'lost-response'] as const)('bootstraps runtime before immutable dispatch: %s', async (bootstrap) => {
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
  printf '{"viewerPermission":"WRITE","isArchived":false}\\n'
elif [ "$1" = "api" ]; then
  printf '{"object":{"sha":"%s"}}\\n' "$FAKE_GIT_SHA"
elif [ "$1 $2" = "workflow run" ]; then
  test -f "$HOME/.eai/managed-deployments/source-unknown-abc123.json.dispatch" || exit 90
  ${bootstrap === 'lost-response' ? 'exit 1' : ':'}
fi
`);
    await chmod(ghPath, 0o755);
    process.env.PATH = `${binDir}:${original.PATH}`;
    process.env.FAKE_GH_LOG = ghLog;
    process.env.FAKE_GIT_SHA = commitSha;

    const configHash = await buildManagedDeployConfigHash(projectRoot);
    const retryState: ManagedDeployState = {
      schema: 'eai.managed-deploy-state.v1', tenantId: TENANT_ID, targetTenantId: TENANT_ID,
      appKey: 'planning-portal', operationId: 'source-unknown-abc123', nonce: 'one-time-nonce',
      repo: 'enterprise/planning-portal', branch: 'main', ref: 'refs/heads/main', commitSha,
      workflowPath: '.github/workflows/eai-app.yml', configHash, environment: 'preview', installationId: 12345,
    };
    const retryMode = ['retry', 'already-dispatched', 'uncertain-dispatch'].includes(bootstrap);
    if (bootstrap === 'already-dispatched') retryState.dispatchedAt = new Date().toISOString();
    if (bootstrap === 'uncertain-dispatch') retryState.dispatchStartedAt = new Date().toISOString();
    if (retryMode) await saveManagedDeployState(retryState);
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
      if (url.endsWith('/cli-managed-source/github-link-sessions')) return jsonResponse(linkedGitHubSession());
      if (url.endsWith('/source-unknown/workflow-setup')) {
        return jsonResponse({ status: 'issued', operationId: 'source-unknown-abc123', nonce: 'one-time-nonce' });
      }
      if (url.endsWith('/environments/preview/runtime-bootstrap')) {
        return bootstrap === 'failed' ? jsonResponse({ message: 'runtime setup unavailable' }, 503) : jsonResponse({
          status: 'configured', sourceOperationId: 'source-unknown-abc123', appKey: 'planning-portal',
          tenantId: bootstrap === 'wrong-target' ? 'different-child' : TENANT_ID, environment: 'preview',
        });
      }
      if (url.endsWith('/source-unknown/operations/source-unknown-abc123?targetTenantId=company-tenant')) {
        if ((retryMode || bootstrap === 'lost-response') && operationReads++ === 0) return jsonResponse({
          tenantId: TENANT_ID, targetTenantId: TENANT_ID, appKey: retryState.appKey, operationId: retryState.operationId,
          status: 'issued', setup: { ...retryState, repo: { owner: 'enterprise', name: 'planning-portal' }, deployOnSuccess: true },
        });

        return jsonResponse({
          tenantId: TENANT_ID,
          targetTenantId: TENANT_ID,
          appKey: 'planning-portal',
          operationId: 'source-unknown-abc123',
          status: 'active',
          requiresTenantInfra: false,
          deploymentId: 'dep-1',
          activeUrl: 'https://planning.example.com',
          latestPointerVersion: 3,
          expectedLatestVersion: 3,
          runtimeIdentity: { clientId: 'runtime-client', principalId: 'runtime-principal' },
          setup: {
            targetTenantId: TENANT_ID,
            repo: { owner: 'enterprise', name: 'planning-portal' },
            workflowPath: '.github/workflows/eai-app.yml',
            ref: 'refs/heads/main',
            commitSha: bootstrap === 'source-mismatch' ? 'f'.repeat(40) : commitSha,
            configHash,
            environment: 'preview',
            deployOnSuccess: true,
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
      '--source', 'customer-owned', '--repo', 'enterprise/planning-portal',
      '--installation-id', '12345',
      ...(retryMode ? ['--target-tenant-id', TENANT_ID, '--retry', retryState.operationId] : []),
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
        targetTenantId: TENANT_ID,
        commitSha,
      });
      expect(setup?.body).toMatchObject({
        deployOnSuccess: true,
        ref: 'refs/heads/main',
        commitSha,
        targetTenantId: TENANT_ID,
      });
    }
    if (bootstrap === 'already-dispatched' || bootstrap === 'uncertain-dispatch') {
      expect(requests.some(request => request.url.endsWith('/runtime-bootstrap'))).toBe(false);
      expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ classification: 'succeeded' });
      await expect(readFile(ghLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      return;
    }
    const bootstrapIndex = requests.findIndex(request => request.url.endsWith('/runtime-bootstrap'));
    expect(bootstrapIndex).toBeGreaterThan(requests.findIndex(request => request.url.endsWith('/workflow-setup')));
    expect(requests[bootstrapIndex]?.body).toEqual({
      sourceOperationId: 'source-unknown-abc123', targetTenantId: TENANT_ID, sourceMode: 'source-unknown',
    });
    if (bootstrap === 'failed' || bootstrap === 'wrong-target') {
      expect(await readFile(ghLog, 'utf8')).not.toContain('workflow run');
      expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({
        error: bootstrap === 'failed' ? 'RUNTIME_BOOTSTRAP_FAILED' : 'RUNTIME_BOOTSTRAP_BINDING_MISMATCH',
      });
      expect(process.exitCode).toBe(1);
      return;
    }
    expect(requests.some((request) => request.url.includes('/deployments/latest'))).toBe(false);
    expect(requests.some((request) => request.url.includes('/operations/source-unknown-abc123'))).toBe(bootstrap !== 'lost-response');
    const result = JSON.parse(output.mock.calls.map(([value]) => String(value)).join('')) as Record<string, unknown>;
    const ghCalls = await readFile(ghLog, 'utf8');
    expect(ghCalls).not.toContain('variable set');
    expect(ghCalls, JSON.stringify(result)).toContain(`commit_sha=${commitSha}`);
    expect(ghCalls).toContain(`public_api_url=${API_BASE}`);
    expect(ghCalls).toContain(`target_tenant_id=${TENANT_ID}`);
    expect(ghCalls).toContain('source_mode=source-unknown');
    expect(ghCalls).toContain('workflow run .github/workflows/eai-app.yml');
    expect(ghCalls).toContain('operation_id=source-unknown-abc123');
    if (bootstrap === 'lost-response') {
      expect(result).toMatchObject({ error: 'GITHUB_WORKFLOW_DISPATCH_FAILED' });
      expect(result.nextAction).toContain('retry will not reuse this nonce');
      const saved = JSON.parse(await readFile(managedDeployStatePath(retryState.operationId), 'utf8'));
      expect(saved.dispatchStartedAt).toBeTruthy();
      expect(saved.dispatchedAt).toBeUndefined();
      output.mockClear();
      process.exitCode = 0;
      await eaiManagedDeployCommand.parseAsync([
        'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID,
        '--retry', retryState.operationId, '--no-wait', '--format', 'json',
      ], { from: 'user' });
      expect((await readFile(ghLog, 'utf8')).match(/workflow run/g)).toHaveLength(1);
      expect(requests.filter(request => request.url.endsWith('/runtime-bootstrap'))).toHaveLength(1);
      expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ classification: 'succeeded' });
      expect(process.exitCode).toBe(0);
      return;
    }
    if (bootstrap === 'source-mismatch') {
      expect(result).toMatchObject({ error: 'SOURCE_OPERATION_SOURCE_MISMATCH' });
      expect(process.exitCode).toBe(1);
      return;
    }
    expect(result).toMatchObject({
      targetTenantId: TENANT_ID,
      status: 'active',
      classification: 'succeeded',
      deploymentId: 'dep-1',
      activeUrl: 'https://planning.example.com',
      requiresTenantInfra: false,
      sourceBinding: {
        repository: 'enterprise/planning-portal',
        ref: 'refs/heads/main',
        commitSha,
      },
    });
    expect(String(result.nextAction)).toContain('eai deploy doctor --url https://planning.example.com');
    expect(process.exitCode).toBe(0);
  });

  test.each([
    ['accepted', 'handoff_pending', 'preview'], ['consumed', 'handoff_pending', 'dev'],
    ['accepted', 'expired', 'test'], ['consumed', 'expired', 'prod'],
    ['accepted', 'revoked', 'test'], ['consumed', 'revoked', 'prod'],
  ] as const)('retries server %s evidence handoff in %s for %s without local nonce or Git checkout', async (evidenceState, operationStatus, environment) => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    let deployed = false;
    const requests: Array<{ url: string; body: unknown }> = [];
    const identityFetch = stubManagedOperation();
    const identityImpl = identityFetch.getMockImplementation()!;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/source-unknown/operations/')) return jsonResponse({
        tenantId: TENANT_ID, targetTenantId: 'runtime-child', appKey: 'planning-portal',
        operationId: 'source-unknown-abc123', environment, status: deployed ? 'queued' : operationStatus,
        setup: { targetTenantId: 'runtime-child', status: evidenceState === 'consumed' ? 'consumed' : 'issued' },
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
    const requests: string[] = [];
    const identityFetch = stubManagedOperation();
    const identityImpl = identityFetch.getMockImplementation()!;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/source-unknown/operations/')) return jsonResponse({
        tenantId: TENANT_ID, targetTenantId: 'runtime-child', appKey: 'planning-portal',
        operationId: 'source-unknown-abc123', environment, status: 'handoff_pending',
        setup: { targetTenantId: 'runtime-child', status: 'issued' },
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
      error: 'SOURCE_OPERATION_ENVIRONMENT_INVALID',
    });
    expect(process.exitCode).toBe(1);
  });

  test.each([
    ['expired', '--resume'], ['revoked', '--resume'],
    ['expired', '--retry'], ['revoked', '--retry'],
  ] as const)('stops %s %s immediately and requests a new setup without dispatch', async (status, mode) => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{}');
    const fetchMock = stubManagedOperation({
      tenantId: TENANT_ID, targetTenantId: TENANT_ID, appKey: 'planning-portal',
      operationId: 'source-unknown-abc123', status, setup: { status, targetTenantId: TENANT_ID },
    });
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      'planning-portal', '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID,
      mode, 'source-unknown-abc123', '--wait', '--format', 'json',
    ], { from: 'user' });

    const result = JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''));
    expect(result).toMatchObject(mode === '--retry'
      ? { error: 'SOURCE_OPERATION_INACTIVE' }
      : { status, classification: 'failed' });
    expect(result.nextAction).toContain('fresh source operation and nonce');
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/source-unknown/operations/'))).toHaveLength(1);
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
    };
    await saveManagedDeployState(state);
    const fetchMock = stubManagedOperation({
      tenantId: TENANT_ID, targetTenantId: TENANT_ID, appKey: state.appKey, operationId: state.operationId,
      status: 'issued', setup: { ...state, repo: { owner: 'enterprise', name: 'planning-portal' }, commitSha: 'c'.repeat(40), deployOnSuccess: true },
    });
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eaiManagedDeployCommand.parseAsync([
      state.appKey, '--target', 'eai', '--tenant-id', TENANT_ID, '--target-tenant-id', TENANT_ID,
      '--retry', state.operationId, '--no-wait', '--format', 'json',
    ], { from: 'user' });
    expect(JSON.parse(output.mock.calls.map(([value]) => String(value)).join(''))).toMatchObject({ error: 'RETRY_SERVER_BINDING_MISMATCH' });
    expect(fetchMock.mock.calls.every(([input]) => !String(input).endsWith('/deploy') && !String(input).endsWith('/runtime-bootstrap'))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

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
      error: 'TARGET_TENANT_REQUIRED',
    });
    expect(process.exitCode).toBe(1);
  });

  test('rejects a resumed operation bound to a different child tenant', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{"schemaVersion":"1"}\n');
    stubManagedOperation({
      tenantId: TENANT_ID,
      targetTenantId: 'different-child',
      appKey: 'planning-portal',
      operationId: 'source-unknown-abc123',
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
      error: 'SOURCE_OPERATION_TARGET_MISMATCH',
    });
    expect(process.exitCode).toBe(1);
  });

  test('prints the exact child target, source binding, and active URL on resume', async () => {
    await writeFile(join(projectRoot, 'eai.runtime.json'), '{"schemaVersion":"1"}\n');
    stubManagedOperation({
      tenantId: TENANT_ID,
      targetTenantId: 'runtime-child',
      appKey: 'planning-portal',
      operationId: 'source-unknown-abc123',
      status: 'active',
      requiresTenantInfra: false,
      deploymentId: 'dep-1',
      activeUrl: 'https://planning.example.com',
      latestPointerVersion: 3,
      expectedLatestVersion: 3,
      runtimeIdentity: { clientId: 'runtime-client', principalId: 'runtime-principal' },
      setup: {
        targetTenantId: 'runtime-child',
        repo: { owner: 'enterprise', name: 'planning-portal' },
        workflowPath: '.github/workflows/eai-app.yml',
        ref: 'refs/heads/release',
        commitSha: 'a'.repeat(40),
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
    expect(String(result.nextAction)).toContain('eai deploy doctor --url https://planning.example.com');
    expect(process.exitCode).toBe(0);
  });
});
