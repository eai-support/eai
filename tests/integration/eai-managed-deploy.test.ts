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
import { installCanonicalManagedDeployFiles } from '../../src/lib/eai-managed-deploy.js';

const exec = promisify(execFile);
const API_BASE = 'https://test-api.example.com';
const TENANT_ID = 'company-tenant';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
    process.env = original;
    process.exitCode = 0;
    process.chdir('/');
    await env.cleanup();
  });

  test('binds and polls the exact immutable operation without reading latest', async () => {
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
fi
`);
    await chmod(ghPath, 0o755);
    process.env.PATH = `${binDir}:${original.PATH}`;
    process.env.FAKE_GH_LOG = ghLog;
    process.env.FAKE_GIT_SHA = commitSha;

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
      if (url.endsWith('/source-unknown/workflow-setup')) {
        return jsonResponse({ status: 'issued', operationId: 'source-unknown-abc123', nonce: 'one-time-nonce' });
      }
      if (url.endsWith('/source-unknown/operations/source-unknown-abc123?targetTenantId=company-tenant')) {
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
            commitSha,
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
      '--repo', 'enterprise/planning-portal',
      '--installation-id', '12345',
      '--wait',
      '--format', 'json',
    ], { from: 'user' });

    const registration = requests.find((request) => request.url.endsWith('/source-unknown/register'));
    const setup = requests.find((request) => request.url.endsWith('/source-unknown/workflow-setup'));
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
    expect(requests.some((request) => request.url.includes('/deployments/latest'))).toBe(false);
    expect(requests.some((request) => request.url.includes('/operations/source-unknown-abc123'))).toBe(true);
    const ghCalls = await readFile(ghLog, 'utf8');
    expect(ghCalls).toContain('variable set EAI_PUBLIC_API_URL');
    expect(ghCalls).toContain('workflow run .github/workflows/eai-app.yml');
    expect(ghCalls).toContain('operation_id=source-unknown-abc123');
    const result = JSON.parse(output.mock.calls.map(([value]) => String(value)).join('')) as Record<string, unknown>;
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
