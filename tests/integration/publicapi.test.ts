import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { clearTokens, storeTokens } from '../../src/lib/auth.js';
import { publicApiCommand } from '../../src/commands/publicapi.js';
import type { PlatformMethod } from '../../src/lib/api.js';
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

describe('eai publicapi', () => {
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

  test.each<{
    command: string;
    method: PlatformMethod;
    args: string[];
    expectedBody?: unknown;
  }>([
    {
      command: 'get',
      method: 'GET',
      args: ['get', '/v4/identity/me', '--param', 'expand=roles', '--format', 'json'],
    },
    {
      command: 'post',
      method: 'POST',
      args: ['post', '/v4/geo/resolve-location', '--data', '{"query":"Copenhagen"}', '--format', 'json'],
      expectedBody: { query: 'Copenhagen' },
    },
    {
      command: 'patch',
      method: 'PATCH',
      args: ['patch', '/v4/identity/me/profile', '--data', '{"displayName":"Doug"}', '--format', 'json'],
      expectedBody: { displayName: 'Doug' },
    },
    {
      command: 'put',
      method: 'PUT',
      args: ['put', '/v4/data/resources/tenant-publicapi/customer/customer-1', '--data', '{"data":{"name":"Ada"}}', '--format', 'json'],
      expectedBody: { data: { name: 'Ada' } },
    },
    {
      command: 'delete',
      method: 'DELETE',
      args: ['delete', '/v4/identity/tenants/tenant-publicapi/membership', '--format', 'json'],
    },
  ])('$command executes an authorized PublicAPI V4 request', async ({ method, args, expectedBody }) => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, method }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    await publicApiCommand.parseAsync(args, { from: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`${API_BASE}${args[1]}`);
    expect(init?.method).toBe(method);
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer <fixture-access-token>');
    expect((init?.headers as Record<string, string>)['X-Tenant-Id']).toBe(TENANT_ID);
    if (expectedBody === undefined) {
      expect(init?.body).toBeUndefined();
    } else {
      expect(JSON.parse(String(init?.body))).toEqual(expectedBody);
    }

    const output = outputSpy.mock.calls.flat().join('');
    expect(output).toContain('"ok": true');
    expect(output).toContain(`"method": "${method}"`);
  });

  test('generic Entra DELETE exposes the validated boolean cleanup receipt while masking upstream credentials', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      client_id: 'owned-client', tenant_id: TENANT_ID,
      tenant_deauthorization: { removed: false, already_absent: true, secret: '<fixture-private-receipt-secret>' },
      app_registration_found: false, app_registration_deleted: false,
      app_registration_already_absent: true, app_registration_absence_verified: true,
      client_secret: '<fixture-private-receipt-secret>',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await publicApiCommand.parseAsync(['delete', '/v4/platform/provisioning/entra-apps/owned-client',
      '--data', JSON.stringify({ tenant_id: TENANT_ID, delete_registration: true }), '--format', 'json'], { from: 'user' });
    const output = outputSpy.mock.calls.flat().join('');
    const receipt = JSON.parse(output);
    expect(receipt.request.tenantId).toBe(TENANT_ID);
    expect(receipt.body.tenant_deauthorization).toEqual({ removed: false, already_absent: true });
    expect(receipt.body.app_registration_absence_verified).toBe(true);
    expect(receipt.body.client_secret).toBe('[redacted]');
    expect(output).not.toContain('<fixture-private-receipt-secret>');
  });

  test.each([
    { status: 409, code: 'TENANT_SLUG_CONFLICT', field: 'portalSlug', action: 'Choose a different portal slug' },
    { status: 422, code: 'HOME_REGION_REQUIRED', field: 'homeRegion', action: '--home-region au|ca|eu' },
  ])('forwards safe immediate child-create $status fields and guidance in JSON', async ({ status, code, field, action }) => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: code, message: 'Rejected value: tax-file-secret', details: { field },
    }), { status }));
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    await expect(publicApiCommand.parseAsync([
      'post', `/v4/platform/tenants/${TENANT_ID}/children`,
      '--data', '{"displayName":"Child Workspace","slug":"child-workspace"}', '--format', 'json',
    ], { from: 'user' })).rejects.toThrow('process.exit called');

    const output = outputSpy.mock.calls.flat().join('');
    expect(output).toContain(`"code": "${code}"`);
    expect(output).toContain(`"field": "${field}"`);
    expect(output).toContain(action);
    expect(output).not.toContain('tax-file-secret');
    expect(output).not.toContain('bodyText');
  });

  test('includes the allowlisted rejected field in generic text failures without echoing upstream text', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: 'TENANT_SLUG_CONFLICT', field: 'portalSlug', message: 'Rejected value: tax-file-secret',
    }), { status: 409 }));
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    await expect(publicApiCommand.parseAsync([
      'post', `/v4/platform/tenants/${TENANT_ID}/children`,
      '--data', '{"displayName":"Child Workspace","slug":"child-workspace"}', '--format', 'text',
    ], { from: 'user' })).rejects.toThrow('process.exit called');

    const output = errorSpy.mock.calls.flat().join(' ');
    expect(output).toContain(
      'failed: 409 This portal slug is already in use. Choose a different portal slug. (field: portalSlug)',
    );
    expect(output).not.toContain('tax-file-secret');
  });

  test('keeps the server meaning of a root workspace conflict on the raw request path', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: 'TENANT_SLUG_CONFLICT', message: 'A workspace with this slug already exists.', field: 'slug',
    }), { status: 409 }));
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    await expect(publicApiCommand.parseAsync([
      'post', '/v4/platform/tenants',
      '--data', '{"displayName":"Root Workspace","slug":"root-workspace","homeRegion":"au"}', '--format', 'json',
    ], { from: 'user' })).rejects.toThrow('process.exit called');

    const output = outputSpy.mock.calls.flat().join('');
    expect(output).toContain('"code": "TENANT_SLUG_CONFLICT"');
    expect(output).toContain('A workspace with this slug already exists.');
    expect(output).not.toContain('under this parent');
    expect(output).not.toContain('"field"');
  });

  test('includes machine-readable mutation remediation for a strict v4 405', async () => {
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'RESOURCE_MUTATION_METHOD_NOT_ALLOWED',
          message: 'PublicAPI v4 resource.update requires PUT.',
          expected: {
            method: 'PUT',
            body: { data: 'object', version: 'positive integer' },
          },
        }),
        {
          status: 405,
          statusText: 'Method Not Allowed',
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    await expect(
      publicApiCommand.parseAsync(
        [
          'patch',
          '/v4/data/resources/tenant-publicapi/customer/customer-1',
          '--data',
          '{"name":"Ada"}',
          '--format',
          'json',
        ],
        { from: 'user' },
      ),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = outputSpy.mock.calls.flat().join('');
    expect(output).toContain('"reasonCode": "resource_mutation_contract_invalid"');
    expect(output).toContain('Update requires PUT with');
  });

  test.each([
    {
      name: 'matching mutation guidance',
      status: 405,
      statusText: 'Method Not Allowed',
      payload: {
        error: 'RESOURCE_MUTATION_METHOD_NOT_ALLOWED',
        message: 'PublicAPI v4 resource.update requires PUT.',
      },
      path: '/v4/data/resources/tenant-publicapi/customer/customer-1',
      expectedGuidance: true,
    },
    {
      name: 'unmatched server error',
      status: 500,
      statusText: 'Internal Server Error',
      payload: { message: 'Unexpected upstream failure' },
      path: '/v4/platform/capabilities/catalog',
      expectedGuidance: false,
    },
  ])('prints the base failure in non-TTY text mode for $name', async ({
    status,
    statusText,
    payload,
    path,
    expectedGuidance,
  }) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status,
        statusText,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    await expect(
      publicApiCommand.parseAsync(['get', path, '--format', 'text'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = errorSpy.mock.calls.flat().join(' ');
    expect(output).toContain(`GET ${path} failed: ${status}`);
    expect(output).toContain(String(payload.message));
    if (expectedGuidance) {
      expect(output).toContain('PublicAPI v4 resource mutation contract is invalid');
    } else {
      expect(output).not.toContain('resource_mutation_contract_invalid');
    }
  });
});
