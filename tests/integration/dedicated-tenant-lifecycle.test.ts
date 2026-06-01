import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMockServer } from '../helpers/mock-server.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { storeTokens, clearTokens } from '../../src/lib/auth.js';
import { tenantCommand } from '../../src/commands/tenant.js';
import { provisionCommand } from '../../src/commands/provision.js';
import { PlatformAPIClient } from '../../src/lib/api.js';

const API_BASE = 'https://test-api.example.com';
const PARENT_TENANT_ID = 'root-tenant-id';
const CREATED_TENANT_ID = 'tenant-dedicated-001';
const CREATED_TENANT_SLUG = 'dedicated-tenant';
const OBJECT_TYPE = 'TenantCase';
const OBJECT_TYPE_SLUG = 'tenant-case';
const RESOURCE_ID = 'resource-001';

function setTestHome(dir: string): void {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
}

async function setupProject(dir: string): Promise<void> {
  await mkdir(join(dir, 'src', 'eai.config'), { recursive: true });
  await writeFile(join(dir, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
  await writeFile(
    join(dir, '.env.local'),
    `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-vertical\n`,
  );
}

async function storeTestTokens(dir: string): Promise<void> {
  setTestHome(dir);
  await storeTokens({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600000,
    upn: 'test@example.com',
    oid: 'test-oid',
    tenantId: 'root-tenant-id',
    tenantName: 'root-tenant',
    clientId: 'test-client-id',
    activeTenantId: 'root-tenant-id',
    activeTenantName: 'Root Tenant',
    activeTenantSlug: 'root-tenant',
    publicApiUrl: API_BASE,
    membershipsCachedAt: Date.now(),
  });
}

function parseJsonOutput(spy: ReturnType<typeof vi.spyOn>): unknown[] {
  return spy.mock.calls
    .flat()
    .map((value) => {
      if (typeof value !== 'string') {
        return null;
      }
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    })
    .filter((value) => value !== null);
}

describe('dedicated tenant lifecycle', () => {
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

  test('creates a tenant, provisions dedicated storage, and CRUDs resources via ResourceAPI', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const resourceState = {
      version: 1,
      data: { title: 'Initial tenant case', status: 'draft' },
    };
    const provisionRequests: Array<Record<string, unknown>> = [];

    mockServer.server.use(
      http.post(`${API_BASE}/v4/platform/tenants`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          id: CREATED_TENANT_ID,
          slug: CREATED_TENANT_SLUG,
          displayName: body.displayName,
        }, { status: 201 });
      }),
      http.get(`${API_BASE}/v4/identity/tenants`, async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer test-access-token');
        return HttpResponse.json({
          tenants: [
            {
              id: CREATED_TENANT_ID,
              displayName: 'Dedicated Tenant',
              slug: CREATED_TENANT_SLUG,
              isActive: true,
              roles: ['tenant-admin'],
              isTenantAdmin: true,
            },
          ],
        });
      }),
      http.post(`${API_BASE}/v4/data/resources/${CREATED_TENANT_ID}/storage/provision`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        provisionRequests.push(body);
        return HttpResponse.json({
          tenantId: CREATED_TENANT_ID,
          dryRun: false,
          results: [
            { objectType: 'tenant-postgresql-base', backend: 'postgresql', status: 'provisioned' },
            { objectType: 'tenant-documentdb-base', backend: 'documentdb', status: 'provisioned' },
            { objectType: 'tenant-blob-base', backend: 'blob', status: 'provisioned' },
            { objectType: 'tenant-search-base', backend: 'search', status: 'provisioned' },
          ],
        });
      }),
      http.post(`${API_BASE}/v4/data/resources/${CREATED_TENANT_ID}/${OBJECT_TYPE_SLUG}`, async ({ request }) => {
        const body = await request.json() as { data?: Record<string, unknown> };
        resourceState.data = body.data || {};
        resourceState.version = 1;
        return HttpResponse.json({
          id: RESOURCE_ID,
          data: resourceState.data,
          version: resourceState.version,
        }, { status: 201 });
      }),
      http.get(`${API_BASE}/v4/data/resources/${CREATED_TENANT_ID}/${OBJECT_TYPE_SLUG}/${RESOURCE_ID}`, async () => {
        return HttpResponse.json({
          id: RESOURCE_ID,
          data: resourceState.data,
          version: resourceState.version,
        });
      }),
      http.put(`${API_BASE}/v4/data/resources/${CREATED_TENANT_ID}/${OBJECT_TYPE_SLUG}/${RESOURCE_ID}`, async ({ request }) => {
        const body = await request.json() as { data?: Record<string, unknown>; version?: number };
        resourceState.data = body.data || {};
        resourceState.version = Number(body.version || resourceState.version) + 1;
        return HttpResponse.json({
          id: RESOURCE_ID,
          data: resourceState.data,
          version: resourceState.version,
        });
      }),
      http.delete(`${API_BASE}/v4/data/resources/${CREATED_TENANT_ID}/${OBJECT_TYPE_SLUG}/${RESOURCE_ID}`, async () => {
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await tenantCommand.parseAsync([
      'create',
      '--name', 'Dedicated Tenant',
      '--slug', CREATED_TENANT_SLUG,
      '--allow-root',
      '--format', 'json',
    ], { from: 'user' });

    await provisionCommand.parseAsync([
      'storage',
      '--tenant-id', CREATED_TENANT_ID,
      '--backend', 'all',
      '--format', 'json',
    ], { from: 'user' });

    const client = new PlatformAPIClient(API_BASE, CREATED_TENANT_ID);
    const createResponse = await client.createResource(OBJECT_TYPE, {
      title: 'Initial tenant case',
      status: 'draft',
    });
    expect(createResponse.status).toBe(201);

    const getResponse = await client.getResource(OBJECT_TYPE, RESOURCE_ID);
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toMatchObject({
      id: RESOURCE_ID,
      data: { title: 'Initial tenant case', status: 'draft' },
      version: 1,
    });

    const updateResponse = await client.updateResource(
      OBJECT_TYPE,
      RESOURCE_ID,
      { title: 'Updated tenant case', status: 'ready' },
      1,
    );
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({
      id: RESOURCE_ID,
      data: { title: 'Updated tenant case', status: 'ready' },
      version: 2,
    });

    const deleteResponse = await client.deleteResource(OBJECT_TYPE, RESOURCE_ID);
    expect(deleteResponse.status).toBe(204);

    const jsonOutputs = parseJsonOutput(outputSpy);
    expect(jsonOutputs[0]).toMatchObject({
      tenant: expect.objectContaining({
        id: CREATED_TENANT_ID,
        slug: CREATED_TENANT_SLUG,
      }),
      usability: expect.objectContaining({
        tenantId: CREATED_TENANT_ID,
        usable: true,
        adminConfirmed: true,
      }),
    });
    expect(jsonOutputs[1]).toMatchObject({
      tenantId: CREATED_TENANT_ID,
      dryRun: false,
    });
    expect(provisionRequests).toEqual([
      {
        backend: 'all',
        dry_run: false,
        rebuild_search: false,
        provisioning_mode: 'dedicated-tenant-storage',
      },
    ]);
  });

  test('creates a child tenant with active tenant context without redundant bootstrap when already usable', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const platformHeaders: Array<Record<string, string>> = [];

    mockServer.server.use(
      http.get(`${API_BASE}/v4/identity/tenants`, async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer test-access-token');
        return HttpResponse.json({
          tenants: [
            {
              id: PARENT_TENANT_ID,
              displayName: 'Root Tenant',
              slug: 'root-tenant',
              isActive: true,
              roles: ['tenant-admin'],
              isTenantAdmin: true,
            },
            {
              id: CREATED_TENANT_ID,
              displayName: 'Dedicated Tenant',
              slug: CREATED_TENANT_SLUG,
              isActive: true,
              roles: ['tenant-admin'],
              isTenantAdmin: true,
            },
          ],
        });
      }),
      http.post(`${API_BASE}/v4/platform/tenants/${PARENT_TENANT_ID}/children`, async ({ request }) => {
        platformHeaders.push(Object.fromEntries(request.headers.entries()));
        const body = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          id: CREATED_TENANT_ID,
          slug: CREATED_TENANT_SLUG,
          displayName: body.displayName,
        }, { status: 201 });
      }),
    );

    await tenantCommand.parseAsync([
      'create',
      '--name', 'Dedicated Tenant',
      '--slug', CREATED_TENANT_SLUG,
      '--parent', PARENT_TENANT_ID,
      '--format', 'json',
    ], { from: 'user' });

    const jsonOutputs = parseJsonOutput(outputSpy);
    expect(jsonOutputs[0]).toMatchObject({
      tenant: expect.objectContaining({
        id: CREATED_TENANT_ID,
        slug: CREATED_TENANT_SLUG,
      }),
      bootstrap: null,
      usability: expect.objectContaining({
        tenantId: CREATED_TENANT_ID,
        usable: true,
      }),
    });
    expect(platformHeaders).toHaveLength(1);
    expect(platformHeaders[0]['x-tenant-id']).toBe(PARENT_TENANT_ID);
  });
});
