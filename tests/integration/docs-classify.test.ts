import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { http, HttpResponse } from 'msw';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PlatformAPIClient } from '../../src/lib/api.js';
import { createMockServer } from '../helpers/mock-server.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { cleanupTestTokens, type TestContext, userIsLoggedIn } from '../helpers/setup-dsl.js';

describe('PlatformAPIClient.classifyDocument', () => {
  let env: TestEnvironment;
  let mockServer: ReturnType<typeof createMockServer>;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalAccessToken: string | undefined;
  let ctx: TestContext;

  beforeEach(async () => {
    env = await createTestEnvironment();
    mockServer = createMockServer();
    mockServer.start();
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalAccessToken = process.env.EAI_ACCESS_TOKEN;
    process.env.HOME = env.dir;
    process.env.USERPROFILE = env.dir;
    delete process.env.EAI_ACCESS_TOKEN;

    ctx = {
      workingDir: env.dir,
      mockAPI: {} as TestContext['mockAPI'],
      env: {},
      prompts: [],
    };

    await userIsLoggedIn(ctx, { email: 'jane@example.com', tenant: 'tenant-one' });
  });

  afterEach(async () => {
    mockServer.stop();
    await cleanupTestTokens(ctx);
    await env.cleanup();
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
  });

  test('posts classification requests to the direct PublicAPI classify endpoint', async () => {
    const filePath = join(env.dir, 'sample.pdf');
    await writeFile(filePath, 'pdf-bytes');

    mockServer.server.use(
      http.post('https://test-api.example.com/v3/documents/classify', async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer test-access-token');
        expect(request.headers.get('x-tenant-id')).toBe('tenant-one');

        const formData = await request.formData();
        expect(formData.get('tenant_id')).toBe('tenant-one');
        expect(formData.get('processing_mode')).toBe('classification');

        const uploaded = formData.get('files');
        expect(uploaded).toBeInstanceOf(File);
        expect((uploaded as File).name).toBe('sample.pdf');

        return HttpResponse.json({
          status: 'accepted',
          jobId: 'job-123',
          documents: [{ documentId: 'doc-123' }],
        });
      }),
    );

    const client = new PlatformAPIClient('https://test-api.example.com', 'tenant-one');
    const response = await client.classifyDocument(filePath);
    const payload = await response.json() as {
      status: string;
      jobId: string;
      documents: Array<{ documentId: string }>;
    };

    expect(response.ok).toBe(true);
    expect(payload).toMatchObject({
      status: 'accepted',
      jobId: 'job-123',
      documents: [{ documentId: 'doc-123' }],
    });
  });
});
