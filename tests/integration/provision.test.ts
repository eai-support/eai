/**
 * Integration tests for eai provision entra
 *
 * Tests the happy path, existing registration path, and HTTP error paths.
 * Uses MSW to intercept HTTP calls and in-process command invocation.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMockServer } from '../helpers/mock-server.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { storeTokens, clearTokens } from '../../src/lib/auth.js';
import { provisionCommand } from '../../src/commands/provision.js';

const API_BASE = 'https://test-api.example.com';

async function setupProject(dir: string): Promise<void> {
  await mkdir(join(dir, 'src', 'eai.config'), { recursive: true });
  await writeFile(join(dir, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
  await writeFile(
    join(dir, '.env.local'),
    `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-vertical\n`,
  );
}

async function storeTestTokens(dir: string): Promise<void> {
  process.env.HOME = dir;
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

describe('eai provision entra', () => {
  let env: TestEnvironment;
  let mockServer: ReturnType<typeof createMockServer>;
  let originalCwd: string;
  let originalHome: string | undefined;
  let originalAccessToken: string | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalHome = process.env.HOME;
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
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalAccessToken === undefined) {
      delete process.env.EAI_ACCESS_TOKEN;
    } else {
      process.env.EAI_ACCESS_TOKEN = originalAccessToken;
    }
    mockServer.stop();
    await clearTokens();
    await env.cleanup();
  });

  test('happy path: writes ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET to .env.local', { timeout: 10000 }, async () => {
    let requestBody: unknown;

    mockServer.server.use(
      http.post(`${API_BASE}/v3/provision/entra-app`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ client_id: 'cid-1', client_secret: 'secret-1', existing: false });
      }),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      vertical_name: 'my-vertical',
      redirect_uris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=cid-1');
    expect(content).toContain('ENTRA_CLIENT_SECRET=secret-1');
    expect(content).toContain('NEXT_PUBLIC_APP_NAME=my-vertical');
  });

  test('existing registration: preserves .env.local keys and confirms ENTRA_CLIENT_ID', { timeout: 10000 }, async () => {
    await writeFile(
      join(env.dir, '.env.local'),
      `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-vertical\nEXISTING_KEY=keep-me\n`,
    );

    mockServer.server.use(
      http.post(`${API_BASE}/v3/provision/entra-app`, () =>
        HttpResponse.json({ client_id: 'cid-1', client_secret: null, existing: true }),
      ),
    );

    await provisionCommand.parseAsync(['entra'], { from: 'user' });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=cid-1');
    expect(content).toContain('EXISTING_KEY=keep-me');
  });

  test('force re-checks an existing local ENTRA_CLIENT_ID without expecting a new secret', { timeout: 10000 }, async () => {
    let requestBody: unknown;

    await writeFile(
      join(env.dir, '.env.local'),
      `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-vertical\nENTRA_CLIENT_ID=local-client\n`,
    );

    mockServer.server.use(
      http.post(`${API_BASE}/v3/provision/entra-app`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ client_id: 'remote-client', client_secret: null, existing: true });
      }),
    );

    await provisionCommand.parseAsync(['entra', '--force'], { from: 'user' });

    expect(requestBody).toEqual({
      tenant_id: 'test-tenant-id',
      vertical_name: 'my-vertical',
      redirect_uris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
      idempotent: true,
    });

    const content = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(content).toContain('ENTRA_CLIENT_ID=remote-client');
  });

  test('HTTP 403: exits with code 1 and reports permission denied', { timeout: 10000 }, async () => {
    mockServer.server.use(
      http.post(`${API_BASE}/v3/provision/entra-app`, () =>
        HttpResponse.json({ error: 'forbidden' }, { status: 403 }),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('Permission denied');
  });

  test('HTTP 409: exits with code 1 and reports quota exceeded', { timeout: 10000 }, async () => {
    mockServer.server.use(
      http.post(`${API_BASE}/v3/provision/entra-app`, () =>
        HttpResponse.json({ error: 'conflict' }, { status: 409 }),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('Maximum app registrations');
  });

  test('HTTP 404: exits with code 1 and reports endpoint not yet available', { timeout: 10000 }, async () => {
    mockServer.server.use(
      http.post(`${API_BASE}/v3/provision/entra-app`, () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      provisionCommand.parseAsync(['entra'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(warnSpy.mock.calls.flat().join(' ')).toContain('not yet available');
  });
});
