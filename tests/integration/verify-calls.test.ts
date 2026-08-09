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
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalAccessToken: string | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalHome = process.env.HOME;
    originalAccessToken = process.env.EAI_ACCESS_TOKEN;
    env = await createTestEnvironment();
    mockServer = createMockServer();
    mockServer.start();
    originalUserProfile = process.env.USERPROFILE;

    ctx = {
      workingDir: env.dir,
      mockAPI: {} as TestContext['mockAPI'],
      env: {},
      prompts: [],
    };

    workingDirectoryIs(ctx, env.dir);
    process.env.HOME = env.dir;
    process.env.USERPROFILE = env.dir;
    delete process.env.EAI_ACCESS_TOKEN;
    await projectHasValidObjectTypes(ctx, [
      { name: 'Customer', displayName: 'Customer', status: 'published' },
    ]);
    await projectHasEnvFile(ctx, {
      BASE_URL_PUBLIC_API: 'https://test-api.example.com',
      WORKFLOW_DEFAULT_ID: 'workflow-123',
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
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
    mockServer.stop();
    await cleanupTestTokens(ctx);
    await env.cleanup();
  });

  test('audits configured read-only routes and reports mutation routes as skipped', async () => {
    await userIsLoggedIn(ctx, { email: 'jane@example.com' });

    mockServer.server.use(
      http.get('https://test-api.example.com/v4/identity/tenants', () => {
        return HttpResponse.json({
          tenants: [
            {
              id: 'tenant-1',
              displayName: 'Tenant One',
              slug: 'tenant-one',
              isActive: true,
              roles: ['tenant-admin'],
              isTenantAdmin: true,
            },
          ],
        });
      }),
      http.get('https://test-api.example.com/health', () => {
        return HttpResponse.json({ status: 'ok' });
      }),
      http.get('https://test-api.example.com/v4/data/resources/tenant-1/customer', ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get('cursor');
        return HttpResponse.json({
          docs: [],
          totalDocs: 0,
          page: 1,
          totalPages: 1,
          nextCursor: cursor ? null : 'cursor-1',
        });
      }),
      http.get('https://test-api.example.com/v4/data/resources/schema/tenant-1', () => {
        return HttpResponse.json({
          tenant_id: 'tenant-1',
          object_types: [{ id: 'ot-1', name: 'Customer', slug: 'customer', properties: [], linkTypes: [], actions: [] }],
          generated_at: '2026-04-05T00:00:00Z',
        });
      }),
      http.get('https://test-api.example.com/v4/data/resources/tenant-1/customer/cust-1', () => {
        return HttpResponse.json({
          id: 'cust-1',
          data: { name: 'Example Customer' },
          version: 1,
        });
      }),
      http.post('https://test-api.example.com/v4/data/resources/tenant-1/query', () => {
        return HttpResponse.json({ docs: [] });
      }),
      http.post('https://test-api.example.com/v4/data/resources/tenant-1/customer/aggregate', () => {
        return HttpResponse.json({ rows: [], totalRows: 0 });
      }),
      http.get('https://test-api.example.com/v4/platform/tenants/tenant-1/users/test-user-oid/memberships', () => {
        return HttpResponse.json({
          tenants: [
            {
              id: 'tenant-1',
              displayName: 'Tenant One',
              slug: 'tenant-one',
              isTenantAdmin: true,
              roles: ['tenant-admin'],
            },
          ],
        });
      }),
      http.get('https://test-api.example.com/v4/data/resources/object-types', () => {
        return HttpResponse.json({
          docs: [{ id: 'ot-1', name: 'Customer', status: 'published', properties: [], linkTypes: [], actions: [] }],
        });
      }),
      http.get('https://test-api.example.com/v4/platform/tenants/tenant-1/users/by-email', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('email') !== 'jane@example.com') {
          return HttpResponse.json({ error: 'unexpected email' }, { status: 404 });
        }
        return HttpResponse.json({
          id: 'user-1',
          email: 'jane@example.com',
        });
      }),
    );

    const report = await runContractAudit({
      resourceType: 'Customer',
      resourceId: 'cust-1',
      tenantRecordId: 'tenant-1',
      userEmail: 'jane@example.com',
    });

    expect(report.summary.failed).toBe(0);
    expect(report.summary.passed).toBeGreaterThanOrEqual(5);
    expect(report.summary.skipped).toBeGreaterThan(0);
    expect(report.summary.coverageComplete).toBe(false);
    expect(
      report.checks
        .filter((check) => check.status === 'skipped')
        .every((check) => check.details.trim().length > 0),
    ).toBe(true);
    expect(report.checks.find((check) => check.id === 'backend-config')?.status).toBe('passed');
    expect(report.checks.find((check) => check.id === 'schema')?.status).toBe('passed');
    expect(report.checks.find((check) => check.id === 'resource-get')?.status).toBe('passed');
    expect(report.checks.find((check) => check.id === 'resource-cursor')?.status).toBe('passed');
    expect(report.checks.find((check) => check.id === 'resource-aggregate')?.status).toBe('passed');
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
    expect(report.checks.find((check) => check.id === 'backend-config')?.status).toBe('passed');
    expect(report.checks.find((check) => check.id === 'auth')?.status).toBe('failed');
    expect(report.checks.find((check) => check.id === 'current-user')?.status).toBe('skipped');
    expect(report.checks.find((check) => check.id === 'schema')?.status).toBe('skipped');
  });

  test('uses an explicit tenant-id override for read-only contract checks', async () => {
    await userIsLoggedIn(ctx, { email: 'jane@example.com' });

    mockServer.server.use(
      http.get('https://test-api.example.com/v4/identity/tenants', () => {
        return HttpResponse.json({
          tenants: [
            {
              id: 'tenant-override',
              displayName: 'Tenant Override',
              slug: 'tenant-override',
              isActive: true,
              roles: ['tenant-admin'],
              isTenantAdmin: true,
            },
          ],
        });
      }),
      http.get('https://test-api.example.com/health', () => {
        return HttpResponse.json({ status: 'ok' });
      }),
      http.get('https://test-api.example.com/v4/data/resources/schema/tenant-override', () => {
        return HttpResponse.json({
          tenant_id: 'tenant-override',
          object_types: [{ id: 'ot-1', name: 'Customer', slug: 'customer', properties: [], linkTypes: [], actions: [] }],
          generated_at: '2026-04-05T00:00:00Z',
        });
      }),
      http.get('https://test-api.example.com/v4/platform/tenants/tenant-override/users/test-user-oid/memberships', () => {
        return HttpResponse.json({
          tenants: [
            {
              id: 'tenant-override',
              displayName: 'Tenant Override',
              slug: 'tenant-override',
              isTenantAdmin: true,
              roles: ['tenant-admin'],
            },
          ],
        });
      }),
      http.get('https://test-api.example.com/v4/data/resources/object-types', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('where[tenant][equals]') !== 'tenant-override') {
          return HttpResponse.json({ error: 'unexpected tenant filter' }, { status: 404 });
        }
        return HttpResponse.json({
          docs: [{ id: 'ot-1', name: 'Customer', status: 'published', properties: [], linkTypes: [], actions: [] }],
        });
      }),
    );

    const report = await runContractAudit({
      tenantId: 'tenant-override',
    });

    expect(report.tenantId).toBe('tenant-override');
    expect(report.checks.find((check) => check.id === 'schema')?.status).toBe('passed');
  });
});
