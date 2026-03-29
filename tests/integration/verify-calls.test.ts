/**
 * Contract audit tests for eai verify calls.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { http, HttpResponse } from 'msw';
import { runContractAudit } from '../../src/commands/verify.js';
import { createMockServer } from '../helpers/mock-server.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import {
  cleanupTestTokens,
  projectHasEnvFile,
  projectHasValidObjectTypes,
  userIsLoggedIn,
  workingDirectoryIs,
  type TestContext,
} from '../helpers/setup-dsl.js';

describe('runContractAudit', () => {
  let env: TestEnvironment;
  let mockServer: ReturnType<typeof createMockServer>;
  let ctx: TestContext;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    env = await createTestEnvironment();
    mockServer = createMockServer();
    mockServer.start();

    ctx = {
      workingDir: env.dir,
      mockAPI: {} as TestContext['mockAPI'],
      env: {},
      prompts: [],
    };

    workingDirectoryIs(ctx, env.dir);
    await projectHasValidObjectTypes(ctx, [
      { name: 'Customer', displayName: 'Customer', status: 'published' },
    ]);
    await projectHasEnvFile(ctx, {
      BASE_URL_PUBLIC_API: 'https://test-api.example.com',
      TENANT_DEFAULT_ID: 'test-tenant-id',
      WORKFLOW_DEFAULT_ID: 'workflow-123',
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    mockServer.stop();
    await cleanupTestTokens();
    await env.cleanup();
  });

  test('audits configured read-only routes and reports mutation routes as skipped', async () => {
    await userIsLoggedIn(ctx, { email: 'jane@example.com' });

    mockServer.server.use(
      http.get('https://test-api.example.com/health', () => {
        return HttpResponse.json({ status: 'ok' });
      }),
      http.get('https://test-api.example.com/v3/resources/schema/test-tenant-id', () => {
        return HttpResponse.json({
          objectTypes: [{ name: 'Customer', properties: [], linkTypes: [], actions: [] }],
        });
      }),
      http.get('https://test-api.example.com/v3/resources/test-tenant-id/Customer', () => {
        return HttpResponse.json({
          docs: [],
          totalDocs: 0,
          page: 1,
          totalPages: 1,
        });
      }),
      http.get('https://test-api.example.com/v3/resources/test-tenant-id/Customer/cust-1', () => {
        return HttpResponse.json({
          id: 'cust-1',
          data: { name: 'Example Customer' },
          version: 1,
        });
      }),
      http.post('https://test-api.example.com/v3/resources/test-tenant-id/query', () => {
        return HttpResponse.json({ docs: [] });
      }),
      http.post('https://test-api.example.com/v3/orchestrate', async ({ request }) => {
        const body = await request.json() as {
          endpoint?: string;
        };

        switch (body.endpoint) {
          case '/custom-users/me':
            return HttpResponse.json({
              tenants: [
                {
                  tenant: {
                    id: 'tenant-1',
                    displayName: 'Tenant One',
                    slug: 'tenant-one',
                    isActive: true,
                  },
                  roleAssignments: [
                    { baseRole: 'tenant-admin', displayName: 'Admin' },
                  ],
                },
              ],
            });
          case '/object-types':
            return HttpResponse.json({
              docs: [{ id: 'ot-1', name: 'Customer' }],
            });
          case '/tenants/tenant-1':
            return HttpResponse.json({
              id: 'tenant-1',
              name: 'Tenant One',
              slug: 'tenant-one',
            });
          case '/custom-users/by-email':
            return HttpResponse.json({
              user: { id: 'user-1', email: 'jane@example.com' },
            });
          default:
            return HttpResponse.json({ error: 'unexpected endpoint' }, { status: 404 });
        }
      }),
    );

    const report = await runContractAudit({
      resourceType: 'Customer',
      resourceId: 'cust-1',
      tenantRecordId: 'tenant-1',
      userEmail: 'jane@example.com',
    });

    expect(report.summary.failed).toBe(0);
    expect(report.summary.passed).toBeGreaterThanOrEqual(8);
    expect(report.summary.skipped).toBeGreaterThan(0);
    expect(report.checks.find((check) => check.id === 'schema')?.status).toBe('passed');
    expect(report.checks.find((check) => check.id === 'resource-get')?.status).toBe('passed');
    expect(report.checks.find((check) => check.id === 'resource-mutations')?.status).toBe('skipped');
  });

  test('fails auth check and skips protected contracts when not logged in', async () => {
    mockServer.server.use(
      http.get('https://test-api.example.com/health', () => {
        return HttpResponse.json({ status: 'ok' });
      }),
    );

    const report = await runContractAudit({});

    expect(report.summary.failed).toBe(1);
    expect(report.checks.find((check) => check.id === 'auth')?.status).toBe('failed');
    expect(report.checks.find((check) => check.id === 'current-user')?.status).toBe('skipped');
    expect(report.checks.find((check) => check.id === 'schema')?.status).toBe('skipped');
  });
});
