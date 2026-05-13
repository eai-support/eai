import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMockServer } from '../helpers/mock-server.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { clearTokens, storeTokens } from '../../src/lib/auth.js';
import { workflowCommand } from '../../src/commands/workflow.js';

const API_BASE = 'https://test-api.example.com';

function setTestHome(dir: string): void {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
}

async function setupProject(dir: string): Promise<void> {
  await mkdir(join(dir, 'src', 'eai.config'), { recursive: true });
  await writeFile(join(dir, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
  await writeFile(join(dir, '.env.local'), `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-vertical\n`);
}

async function storeTestTokens(dir: string): Promise<void> {
  setTestHome(dir);
  await storeTokens({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600000,
    upn: 'test@example.com',
    oid: 'test-oid',
    tenantId: 'test-tenant-id',
    tenantName: 'test-tenant',
    clientId: 'test-client-id',
    activeTenantId: 'test-tenant-id',
    activeTenantName: 'Test Tenant',
    activeTenantSlug: 'test-tenant',
    publicApiUrl: API_BASE,
    membershipsCachedAt: Date.now(),
  });
}

describe('eai workflow', () => {
  let env: TestEnvironment;
  let mockServer: ReturnType<typeof createMockServer>;
  let originalCwd: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalAccessToken: string | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalAccessToken = process.env.EAI_ACCESS_TOKEN;

    env = await createTestEnvironment();
    mockServer = createMockServer();
    mockServer.start();

    process.env.EAI_ACCESS_TOKEN = 'test-access-token';
    await storeTestTokens(env.dir);
    await setupProject(env.dir);
    process.chdir(env.dir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    mockServer.stop();
    await clearTokens();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    if (originalAccessToken === undefined) {
      delete process.env.EAI_ACCESS_TOKEN;
    } else {
      process.env.EAI_ACCESS_TOKEN = originalAccessToken;
    }
    await env.cleanup();
  });

  test('status checks the public workflow status endpoint', { timeout: 10000 }, async () => {
    let requestUrl = '';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockServer.server.use(
      http.get(`${API_BASE}/v3/workflows/runtime/strategy-monitor/status`, ({ request }) => {
        requestUrl = request.url;
        return HttpResponse.json({
          workflow_key: 'strategy-monitor',
          tenant_id: 'test-tenant-id',
          status: 'operator_required',
          reason_code: 'runtime_workflow_not_bound',
          reason_message: 'Workflow is not bound.',
        });
      }),
    );

    await workflowCommand.parseAsync(['status', 'strategy-monitor', '--format', 'json'], { from: 'user' });

    expect(requestUrl).toContain('tenant_id=test-tenant-id');
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('"workflowKey": "strategy-monitor"');
    expect(output).toContain('"status": "operator_required"');
  });

  test('readiness checks the public builder readiness endpoint', { timeout: 10000 }, async () => {
    let requestUrl = '';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockServer.server.use(
      http.get(`${API_BASE}/v3/builder/readiness`, ({ request }) => {
        requestUrl = request.url;
        return HttpResponse.json({
          tenant_id: 'test-tenant-id',
          status: 'operator_required',
          checks: [
            {
              key: 'workflow:strategy-monitor',
              status: 'operator_required',
              reason_code: 'runtime_workflow_not_bound',
              reason_message: 'Workflow is not bound.',
            },
          ],
        });
      }),
    );

    await workflowCommand.parseAsync(['readiness', 'strategy-monitor', '--format', 'json'], { from: 'user' });

    expect(requestUrl).toContain('tenant_id=test-tenant-id');
    expect(requestUrl).toContain('workflow_keys=strategy-monitor');
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('"tenantId": "test-tenant-id"');
    expect(output).toContain('"key": "workflow:strategy-monitor"');
  });

  test('request posts an operator-assisted workflow request', { timeout: 10000 }, async () => {
    let requestBody: unknown;

    mockServer.server.use(
      http.post(`${API_BASE}/v3/workflows/runtime-requests`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({
          request_id: 'rwf_123',
          workflow_key: 'strategy-monitor',
          tenant_id: 'test-tenant-id',
          status: 'operator_required',
          reason_code: 'runtime_workflow_operator_required',
          reason_message: 'Operator required.',
        });
      }),
    );

    await workflowCommand.parseAsync([
      'request',
      'strategy-monitor',
      '--reason',
      'CEO strategy cockpit',
      '--format',
      'json',
    ], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      workflow_key: 'strategy-monitor',
      reason: 'CEO strategy cockpit',
    });
  });
});
