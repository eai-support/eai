import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { clearTokens, storeTokens } from '../../src/lib/auth.js';
import { userCommand } from '../../src/commands/user.js';
import {
  DEFAULT_PROD_AUTH_CLIENT_ID,
  DEFAULT_PROD_AUTH_TENANT_ID,
  DEFAULT_PROD_AUTH_TENANT_NAME,
} from '../../src/lib/profile.js';

const API_BASE = 'https://test-api.example.com';
const TENANT_ID = 'tenant-publicapi';

function setTestHome(dir: string): void {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
}

async function setupProject(dir: string): Promise<void> {
  await mkdir(join(dir, 'src', 'eai.config'), { recursive: true });
  await writeFile(join(dir, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
  await writeFile(join(dir, '.env.local'), `BASE_URL_PUBLIC_API=${API_BASE}\n`);
}

async function storeTestTokens(dir: string): Promise<void> {
  setTestHome(dir);
  await storeTokens({
    accessToken: '<fixture-access-token>',
    refreshToken: '<fixture-refresh-token>',
    expiresAt: Date.now() + 3600000,
    upn: 'test@example.com',
    oid: 'test-oid',
    tenantId: DEFAULT_PROD_AUTH_TENANT_ID,
    tenantName: DEFAULT_PROD_AUTH_TENANT_NAME,
    clientId: DEFAULT_PROD_AUTH_CLIENT_ID,
    activeTenantId: TENANT_ID,
    activeTenantName: 'Test Tenant',
    activeTenantSlug: 'test-tenant',
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

describe('eai user', () => {
  let env: TestEnvironment;
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
    process.env.EAI_ACCESS_TOKEN = '<fixture-access-token>';
    await storeTestTokens(env.dir);
    await setupProject(env.dir);
    process.chdir(env.dir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.chdir(originalCwd);
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

  test('provision-me is idempotent when the current CLI user already has direct membership', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await userCommand.parseAsync([
      'provision-me',
      '--tenant',
      TENANT_ID,
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).not.toHaveBeenCalled();
    const payload = parseJsonOutput(outputSpy).find((value): value is {
      status: string;
      tenantId: string;
      callingApplication: { clientId: string; kind: string };
      note: string;
    } => typeof value === 'object' && value !== null && 'callingApplication' in value);
    expect(payload).toMatchObject({
      status: 'already-provisioned',
      tenantId: TENANT_ID,
      callingApplication: {
        clientId: DEFAULT_PROD_AUTH_CLIENT_ID,
        kind: 'eai-cli',
      },
    });
    expect(payload.note).toContain('not another application client ID');
  });

  test('provision-me identifies the calling CLI client on tenant authorization failure', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: 'FORBIDDEN',
      message: 'Application not authorized for this tenant',
    }), {
      status: 403,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req-provision-me-403',
      },
    }));
    vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit ${code}`);
    }) as never);

    await expect(userCommand.parseAsync([
      'provision-me',
      '--tenant',
      'different-tenant',
      '--format',
      'json',
    ], { from: 'user' })).rejects.toThrow('process.exit 1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE}/v4/identity/me/provision`);
    expect(JSON.parse(String(init?.body))).toEqual({ tenant_id: 'different-tenant' });
    const payload = parseJsonOutput(outputSpy).find((value): value is {
      code: string;
      callingApplication: { clientId: string };
      note: string;
      requestId: string;
    } => typeof value === 'object' && value !== null && 'callingApplication' in value);
    expect(payload).toMatchObject({
      code: 'CALLING_APPLICATION_NOT_AUTHORIZED',
      callingApplication: { clientId: DEFAULT_PROD_AUTH_CLIENT_ID },
      requestId: 'req-provision-me-403',
    });
    expect(payload.note).toContain('does not test another app client ID');
  });

  test('provision-me preserves a tenant self-provisioning 403 instead of blaming the CLI client', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: 'FORBIDDEN',
      message: 'Self-provisioning is not enabled for this tenant',
    }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }));
    vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit ${code}`);
    }) as never);

    await expect(userCommand.parseAsync([
      'provision-me',
      '--tenant',
      'different-tenant',
      '--format',
      'json',
    ], { from: 'user' })).rejects.toThrow('process.exit 1');

    const payload = parseJsonOutput(outputSpy).find((value): value is {
      code: string;
      message: string;
      next: string;
    } => typeof value === 'object' && value !== null && 'code' in value);
    expect(payload).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Self-provisioning is not enabled for this tenant',
    });
    expect(payload?.next).toContain('self-provisioning policy');
    expect(payload?.next).not.toContain('Authorize the calling CLI client');
  });

  test('invite calls the V4 tenant member invite route with role and JSON output', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        status: 'invited',
        email: 'poppy@example.com',
        role: 'tenant-admin',
        userId: 'user-123',
        inviteMode: 'existing_user_reused',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    await userCommand.parseAsync([
      'invite',
      '--email',
      'poppy@example.com',
      '--tenant',
      TENANT_ID,
      '--role',
      'tenant-admin',
      '--first-name',
      'Poppy',
      '--last-name',
      'Lucas',
      '--message',
      'Welcome to the tenant',
      '--redirect-uri',
      'https://example.com/welcome',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE}/v4/platform/tenants/${TENANT_ID}/members/invite`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer <fixture-access-token>');
    expect((init?.headers as Record<string, string>)['X-Tenant-Id']).toBe(TENANT_ID);
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'poppy@example.com',
      role: 'tenant-admin',
      firstName: 'Poppy',
      lastName: 'Lucas',
      message: 'Welcome to the tenant',
      redirectUri: 'https://example.com/welcome',
    });
    expect(outputSpy.mock.calls.flat().join('')).toContain('"inviteMode": "existing_user_reused"');
  });

  test('invite can assign a specific role definition without sending a default base role', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        status: 'invited',
        email: 'custom@example.com',
        role: 'custom-role-definition-id',
        userId: 'user-456',
      }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }));

    await userCommand.parseAsync([
      'invite',
      '--email',
      'custom@example.com',
      '--tenant',
      TENANT_ID,
      '--role-definition-id',
      'custom-role-definition-id',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'custom@example.com',
      roleDefinitionId: 'custom-role-definition-id',
    });
    expect(outputSpy.mock.calls.flat().join('')).toContain('"role": "custom-role-definition-id"');
  });

  test('invite failure emits structured recovery guidance for external service errors', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 'EXTERNAL_SERVICE_ERROR',
      message: 'EXTERNAL_SERVICE_ERROR while inviting tenant member',
    }), {
      status: 502,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req-user-invite-502',
      },
    }));
    vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit ${code}`);
    }) as never);

    await expect(userCommand.parseAsync([
      'invite',
      '--email',
      'poppy@example.com',
      '--tenant',
      TENANT_ID,
      '--role',
      'tenant-admin',
      '--format',
      'json',
    ], { from: 'user' })).rejects.toThrow('process.exit 1');

    const payload = parseJsonOutput(outputSpy).find((value): value is {
      status: number;
      serverCode: string;
      requestId: string;
      guidance: {
        reasonCode: string;
        diagnostics: Array<{ command: string; mutates: boolean }>;
        fixes: Array<{ command: string; mutates: boolean }>;
      };
    } => typeof value === 'object' && value !== null && 'guidance' in value);
    expect(payload).toBeDefined();
    expect(payload.status).toBe(502);
    expect(payload.serverCode).toBe('EXTERNAL_SERVICE_ERROR');
    expect(payload.requestId).toBe('req-user-invite-502');
    expect(payload.guidance.reasonCode).toBe('user_invite_external_service_existing_member');
    expect(payload.guidance.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'eai user list --tenant <tenant-id> --search <email> --format json',
          mutates: false,
        }),
      ]),
    );
    expect(payload.guidance.fixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'eai user role set --tenant <tenant-id> --member-id <member-id> --role tenant-admin --format json',
          mutates: true,
        }),
      ]),
    );
  });

  test('list calls the V4 tenant members route with query options', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        data: [
          {
            id: 'user-123',
            email: 'poppy@example.com',
            roles: ['tenant-admin'],
          },
        ],
        total: 1,
        page: 2,
        limit: 50,
        totalPages: 1,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    await userCommand.parseAsync([
      'list',
      '--tenant',
      TENANT_ID,
      '--search',
      'poppy@example.com',
      '--page',
      '2',
      '--limit',
      '50',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE}/v4/platform/tenants/${TENANT_ID}/members?page=2&limit=50&sort=email&search=poppy%40example.com`);
    expect(init?.method).toBe('GET');
    expect(outputSpy.mock.calls.flat().join('')).toContain('"tenant-admin"');
  });

  test('roles calls the V4 tenant role definitions route', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        data: [
          {
            id: 'tenant-admin-role-id',
            value: 'tenant-admin',
            label: 'Tenant Admin',
            baseRole: 'tenant-admin',
            isSystemRole: true,
          },
        ],
        total: 1,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    await userCommand.parseAsync([
      'roles',
      '--tenant',
      TENANT_ID,
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE}/v4/platform/tenants/${TENANT_ID}/role-definitions`);
    expect(init?.method).toBe('GET');
    expect(outputSpy.mock.calls.flat().join('')).toContain('"value": "tenant-admin"');
  });

  test('role set by email uses the V4 invite/add flow', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        status: 'invited',
        email: 'poppy@example.com',
        role: 'tenant-admin',
        userId: 'user-123',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    await userCommand.parseAsync([
      'role',
      'set',
      '--email',
      'poppy@example.com',
      '--tenant',
      TENANT_ID,
      '--role',
      'tenant-admin',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE}/v4/platform/tenants/${TENANT_ID}/members/invite`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'poppy@example.com',
      role: 'tenant-admin',
    });
    expect(outputSpy.mock.calls.flat().join('')).toContain('"role": "tenant-admin"');
  });

  test('role set forwards complete invitation details for a user who is not in Entra', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        status: 'invited',
        email: 'new-user@example.com',
        role: 'tenant-admin',
        userId: 'user-456',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    await userCommand.parseAsync([
      'role',
      'set',
      '--email',
      'new-user@example.com',
      '--tenant',
      TENANT_ID,
      '--role',
      'tenant-admin',
      '--first-name',
      'EAI',
      '--last-name',
      'Test Admin',
      '--message',
      'Welcome to the test harness',
      '--redirect-uri',
      'https://admin-portal.example.com/login',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'new-user@example.com',
      role: 'tenant-admin',
      firstName: 'EAI',
      lastName: 'Test Admin',
      message: 'Welcome to the test harness',
      redirectUri: 'https://admin-portal.example.com/login',
    });
  });

  test('role set by member id calls the V4 member role update route', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        status: 'updated',
        userId: 'user-123',
        role: 'tenant-admin',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    await userCommand.parseAsync([
      'role',
      'set',
      '--member-id',
      'user-123',
      '--tenant',
      TENANT_ID,
      '--role',
      'tenant-admin',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE}/v4/platform/tenants/${TENANT_ID}/members/user-123/roles`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({
      role: 'tenant-admin',
    });
    expect(outputSpy.mock.calls.flat().join('')).toContain('"status": "updated"');
  });
});
