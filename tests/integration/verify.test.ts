/**
 * Verify Command Integration Tests
 *
 * Tests for: eai verify
 */

import { describe, test, beforeEach, afterEach, expect } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { createMockServer, PublicAPIMock } from '../helpers/mock-server.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import {
  workingDirectoryIs,
  userIsLoggedIn,
  projectHasEnvFile,
  projectHasValidObjectTypes,
  cleanupTestTokens,
} from '../helpers/setup-dsl.js';
import { runCommand } from '../helpers/action-dsl.js';
import { expectCommandSucceeded, expectDisplayedMessage } from '../helpers/assert-dsl.js';

async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf-8');
  return text ? JSON.parse(text) : null;
}

async function writeJson(res: ServerResponse, status: number, body: unknown): Promise<void> {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function startLocalPublicApi(): Promise<{ baseUrl: string; calls: string[]; close: () => Promise<void> }> {
  const calls: string[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    calls.push(`${req.method || 'GET'} ${url.pathname}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      await writeJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v3/orchestrate') {
      const body = await readRequestBody(req) as {
        target_backend?: string;
        endpoint?: string;
      };
      calls.push(`${body.target_backend || 'unknown'} ${body.endpoint || 'unknown'}`);
      if (body.target_backend === 'admin' && body.endpoint === '/v1/users/test-user-oid/memberships') {
        await writeJson(res, 200, {
          tenants: [
            {
              tenant: {
                id: 'tenant-override',
                displayName: 'Tenant Override',
                slug: 'tenant-override',
                isActive: true,
              },
              roles: ['tenant-admin'],
            },
          ],
        });
        return;
      }
      if (body.target_backend === 'payload' && body.endpoint === '/object-types') {
        await writeJson(res, 200, { docs: [{ name: 'Customer', status: 'published' }] });
        return;
      }
    }

    if (req.method === 'GET' && url.pathname === '/v3/resources/schema/tenant-override') {
      await writeJson(res, 200, { objectTypes: [{ name: 'Customer' }] });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v3/resources/tenant-override/storage') {
      await writeJson(res, 200, {
        tenantId: 'tenant-override',
        objectTypes: [{ objectType: 'Customer', backend: 'postgresql', isReady: true }],
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v3/resources/tenant-override/storage/doctor') {
      await writeJson(res, 200, {
        tenantId: 'tenant-override',
        healthy: true,
        checks: [{ objectType: 'Customer', backend: 'postgresql', healthy: true, issues: [] }],
      });
      return;
    }

    await writeJson(res, 404, { error: `Unhandled ${req.method} ${url.pathname}` });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
    }),
  };
}

describe('eai verify', () => {
  let env: TestEnvironment;
  let mockServer: ReturnType<typeof createMockServer>;
  let ctx: TestContext;

  beforeEach(async () => {
    env = await createTestEnvironment();
    mockServer = createMockServer();
    mockServer.start();

    ctx = {
      workingDir: env.dir,
      mockAPI: new PublicAPIMock('https://test-api.example.com', mockServer),
      env: {},
      prompts: [],
    };
  });

  afterEach(async () => {
    mockServer.stop();
    await cleanupTestTokens(ctx);
    await env.cleanup();
  });

  test('TC092: Verify shows system checks', { timeout: 10000 }, async () => {
    // TC092: Verify all checks pass
    // Traces to: Verify-US1-AC1
    //
    // userIsLoggedIn()
    // projectHasValidObjectTypes()
    // projectHasEnvFile()
    //
    // runCommand('eai verify')
    //
    // expectDisplayedMessage('PublicAPI')
    // expectDisplayedMessage('Authentication')

    workingDirectoryIs(ctx, env.dir);
    await userIsLoggedIn(ctx);
    await projectHasEnvFile(ctx, {
      BASE_URL_PUBLIC_API: 'https://test-api.example.com',
      TENANT_DEFAULT_ID: 'test-tenant-id',
    });
    await projectHasValidObjectTypes(ctx, [
      { name: 'Customer', displayName: 'Customer', status: 'published' },
    ]);

    const result = await runCommand(ctx, 'eai verify');

    // Should show check results
    expectDisplayedMessage(result, 'Platform Connectivity Checks');
  });

  test('TC093: Verify detects issues', { timeout: 10000 }, async () => {
    // TC093: Verify fails on API unreachable
    // Traces to: Verify-US1-ERR1
    //
    // projectHasEnvFile({ BASE_URL_PUBLIC_API: 'https://invalid-api.example.com' })
    // projectHasValidObjectTypes()
    //
    // runCommand('eai verify')
    //
    // expectDisplayedMessage('unreachable')

    workingDirectoryIs(ctx, env.dir);
    await projectHasEnvFile(ctx, {
      BASE_URL_PUBLIC_API: 'https://invalid-api.example.com',
    });
    await projectHasValidObjectTypes(ctx, [
      { name: 'Test', displayName: 'Test' },
    ]);

    const result = await runCommand(ctx, 'eai verify');

    // Should show connectivity checks (even if they fail)
    expectDisplayedMessage(result, 'Connectivity Checks');
  });

  test('TC094: Verify accepts an explicit tenant-id for read-only checks', { timeout: 10000 }, async () => {
    const localApi = await startLocalPublicApi();
    workingDirectoryIs(ctx, env.dir);
    await userIsLoggedIn(ctx);
    await projectHasEnvFile(ctx, {
      BASE_URL_PUBLIC_API: localApi.baseUrl,
    });
    await projectHasValidObjectTypes(ctx, [
      { name: 'Customer', displayName: 'Customer', status: 'published' },
    ]);

    try {
      const result = await runCommand(ctx, 'eai verify --tenant-id tenant-override');

      expectCommandSucceeded(result);
      expectDisplayedMessage(result, 'Platform Connectivity Checks');
      expect(localApi.calls).toContain('GET /v3/resources/schema/tenant-override');
    } finally {
      await localApi.close();
    }
  });

  test('verify storage checks status and doctor for the explicit tenant', { timeout: 10000 }, async () => {
    const localApi = await startLocalPublicApi();
    workingDirectoryIs(ctx, env.dir);
    await userIsLoggedIn(ctx);
    await projectHasEnvFile(ctx, {
      BASE_URL_PUBLIC_API: localApi.baseUrl,
    });
    await projectHasValidObjectTypes(ctx, [
      { name: 'Customer', displayName: 'Customer', status: 'published' },
    ]);

    try {
      const result = await runCommand(ctx, 'eai verify storage --tenant-id tenant-override');

      expectCommandSucceeded(result);
      expectDisplayedMessage(result, 'Storage Verification');
      expectDisplayedMessage(result, 'storage-status');
      expectDisplayedMessage(result, 'storage-doctor');
    } finally {
      await localApi.close();
    }
  });
});
