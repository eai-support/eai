import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PlatformAPIClient, validateDocumentUploadContext, type DocumentUploadContext } from '../../src/lib/api.js';
import { docsCommand, readResponseError } from '../../src/commands/docs.js';
import { createMockServer } from '../helpers/mock-server.js';
import { createTestEnvironment, createTestProject, type TestEnvironment } from '../helpers/test-env.js';
import { cleanupTestTokens, type TestContext, userIsLoggedIn } from '../helpers/setup-dsl.js';

test.each(['app-template/service-patterns.md', 'examples/ai-chat.md'])(
  'bundled guidance uses one configured classification submission: %s',
  async (path) => {
    const guide = await readFile(new URL(`../../.tech-docs/${path}`, import.meta.url), 'utf8');
    expect(guide).toContain('verticalKey: "business-docs"');
    expect(guide).toContain('workflowKey: "document-review"');
    expect(guide).toContain('business-document-v1');
    expect(guide).not.toContain('application_id: applicationId');
    expect(guide).not.toContain('await classify([file]);');
    expect(guide).not.toContain('uploaded.documentId');
  },
);

describe('PlatformAPIClient.classifyDocument', () => {
  let env: TestEnvironment;
  let mockServer: ReturnType<typeof createMockServer>;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalAccessToken: string | undefined;
  let originalCwd: string;
  let originalExitCode: typeof process.exitCode;
  let ctx: TestContext;

  beforeEach(async () => {
    for (const command of docsCommand.commands) {
      for (const field of ['tenantId', 'storageTarget', 'businessRequestId', 'planningApplicationId', 'verticalKey', 'workflowKey']) {
        command.setOptionValue(field, undefined);
      }
    }
    originalCwd = process.cwd();
    originalExitCode = process.exitCode;
    env = await createTestEnvironment();
    mockServer = createMockServer();
    mockServer.server.listen({ onUnhandledRequest: 'error' });
    mockServer.server.use(
      http.get('https://test-api.example.com/v4/identity/tenants', () => HttpResponse.json({
        tenants: [{ id: 'tenant-one', slug: 'tenant-one', displayName: 'Tenant One', roles: ['tenant-admin'] }],
      })),
      http.get('https://test-api.example.com/v4/platform/tenants/tenant-one', () => HttpResponse.json({
        id: 'tenant-one', slug: 'tenant-one', displayName: 'Tenant One', parentId: null,
      })),
    );
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
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
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

  test('posts classification requests to the Curate queued upload endpoint', async () => {
    const filePath = join(env.dir, 'sample.pdf');
    await writeFile(filePath, 'pdf-bytes');

    mockServer.server.use(
      http.post('https://test-api.example.com/v4/data/documents/upload', async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer <fixture-access-token>');
        expect(request.headers.get('x-tenant-id')).toBe('tenant-one');

        const formData = await request.formData();
        expect(formData.get('tenant_id')).toBe('tenant-one');
        expect(formData.get('processing_mode')).toBe('classification');

        const uploaded = formData.get('files');
        expect(uploaded).toBeInstanceOf(File);
        expect((uploaded as File).name).toBe('sample.pdf');
        expect((uploaded as File).type).toBe('application/pdf');

        return HttpResponse.json({
          status: 'accepted',
          jobId: 'job-123',
          documents: [{ documentId: 'doc-123' }],
        });
      }),
    );

    const client = new PlatformAPIClient('https://test-api.example.com', 'tenant-one');
    const response = await client.classifyDocument(filePath, { planningApplicationId: 'project-1' });
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

  test('preserves supported Office document MIME types for upload requests', async () => {
    const filePath = join(env.dir, 'brief.docx');
    await writeFile(filePath, 'docx-bytes');

    mockServer.server.use(
      http.post('https://test-api.example.com/v4/data/documents/upload', async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer <fixture-access-token>');
        expect(request.headers.get('x-tenant-id')).toBe('tenant-one');

        const formData = await request.formData();
        expect(formData.get('tenant_id')).toBe('tenant-one');
        expect(formData.get('processing_mode')).toBe('full');

        const uploaded = formData.get('files');
        expect(uploaded).toBeInstanceOf(File);
        expect((uploaded as File).name).toBe('brief.docx');
        expect((uploaded as File).type).toBe(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        );

        return HttpResponse.json({
          status: 'accepted',
          jobId: 'job-456',
          documents: [{ documentId: 'doc-456' }],
        });
      }),
    );

    const client = new PlatformAPIClient('https://test-api.example.com', 'tenant-one');
    const response = await client.uploadDocument(filePath, { planningApplicationId: 'project-1' });
    const payload = await response.json() as {
      status: string;
      jobId: string;
      documents: Array<{ documentId: string }>;
    };

    expect(response.ok).toBe(true);
    expect(payload).toMatchObject({
      status: 'accepted',
      jobId: 'job-456',
      documents: [{ documentId: 'doc-456' }],
    });
  });

  test.each(['classification', 'full'] as const)('uses the DAISY queued upload route for contextual %s', async (mode) => {
    const filePath = join(env.dir, 'sample.pdf');
    await writeFile(filePath, 'pdf-bytes');
    let called = false;
    mockServer.server.use(http.post('https://test-api.example.com/v4/data/documents/upload', async ({ request }) => {
      called = true;
      expect(request.headers.get('authorization')).toBe('Bearer <fixture-access-token>');
      expect(request.headers.get('x-tenant-id')).toBe('tenant-one');
      const form = await request.formData();
      expect(Object.fromEntries([...form.entries()].filter(([key]) => key !== 'files'))).toEqual({
        tenant_id: 'tenant-one', processing_mode: mode, storage_target: 'resourceapi',
        business_request_id: 'BR-1', planning_application_id: 'project-1',
        verticalKey: 'sample-app', workflowKey: 'sample-workflow',
      });
      expect((form.get('files') as File).type).toBe('application/pdf');
      return HttpResponse.json({ jobId: 'job_123', documents: [{ documentId: 'DOC-123' }] }, { status: 202 });
    }));
    const client = new PlatformAPIClient('https://test-api.example.com', 'tenant-one');
    const context = { storageTarget: 'resourceapi' as const, businessRequestId: 'BR-1',
      planningApplicationId: 'project-1', verticalKey: 'sample-app', workflowKey: 'sample-workflow' };
    const response = mode === 'full'
      ? await client.uploadDocument(filePath, context)
      : await client.classifyDocument(filePath, context);
    expect(response.status).toBe(202);
    expect(called).toBe(true);
  });

  test('a project context alone selects Curate and preserves the authenticated tenant', async () => {
    const filePath = join(env.dir, 'sample.pdf');
    await writeFile(filePath, 'pdf-bytes');
    let called = false;
    mockServer.server.use(http.post('https://test-api.example.com/v4/data/documents/upload', async ({ request }) => {
      called = true;
      const form = await request.formData();
      expect(form.get('storage_target')).toBe('resourceapi');
      expect(form.get('planning_application_id')).toBe('project-1');
      expect(form.get('tenant_id')).toBe('tenant-one');
      expect(form.has('verticalKey')).toBe(false);
      return HttpResponse.json({ jobId: 'job_123' }, { status: 202 });
    }));
    const client = new PlatformAPIClient('https://test-api.example.com', 'tenant-one');
    expect((await client.classifyDocument(filePath, { planningApplicationId: 'project-1' })).status).toBe(202);
    expect(called).toBe(true);
  });

  test.each([
    {},
    { storageTarget: 'resourceapi' },
    { verticalKey: 'sample-app' },
    { workflowKey: 'sample-workflow' },
    { businessRequestId: 'BR-1', verticalKey: 'sample-app' },
    { businessRequestId: 'BR-1', workflowKey: 'sample-workflow' },
    { businessRequestId: ' ' },
    { businessRequestId: 'BR-1', storageTarget: 'legacy' },
  ])('rejects incomplete context before file reads or network calls: %j', async (context) => {
    const client = new PlatformAPIClient('https://test-api.example.com', 'tenant-one');
    await expect(client.classifyDocument('/nonexistent.pdf', context as DocumentUploadContext)).rejects.toThrow(
      /Legacy document uploads are deprecated|Curate document uploads require|Supply --vertical-key|must not be empty|only resourceapi/,
    );
  });

  test.each(['classification', 'full'] as const)('preserves configured standalone %s admission or rejection without retry', async (mode) => {
    const filePath = join(env.dir, 'trust-deed.pdf');
    await writeFile(filePath, 'pdf-bytes');
    let calls = 0;
    mockServer.server.use(http.post('https://test-api.example.com/v4/data/documents/upload', async ({ request }) => {
      calls += 1;
      expect(request.headers.get('authorization')).toBe('Bearer <fixture-access-token>');
      const form = await request.formData();
      expect(Object.fromEntries([...form.entries()].filter(([key]) => key !== 'files'))).toEqual({
        tenant_id: 'tenant-one', processing_mode: mode, storage_target: 'resourceapi',
        verticalKey: 'business-docs', workflowKey: 'trust-review',
      });
      expect(form.has('planning_application_id')).toBe(false);
      expect(form.has('business_request_id')).toBe(false);
      expect(form.has('documentLifecycle')).toBe(false);
      return mode === 'full'
        ? HttpResponse.json({ error: 'DOCUMENT_LIFECYCLE_MODE_UNSUPPORTED' }, { status: 400 })
        : HttpResponse.json({ jobId: 'job_business', documents: [{ documentId: 'DOC-BUSINESS' }] }, { status: 202 });
    }));
    const client = new PlatformAPIClient('https://test-api.example.com', 'tenant-one');
    const context = { verticalKey: 'business-docs', workflowKey: 'trust-review' };
    const response = mode === 'full'
      ? await client.uploadDocument(filePath, context)
      : await client.classifyDocument(filePath, context);
    expect(response.status).toBe(mode === 'full' ? 400 : 202);
    expect(await response.json()).toMatchObject(mode === 'full'
      ? { error: 'DOCUMENT_LIFECYCLE_MODE_UNSUPPORTED' } : { jobId: 'job_business' });
    expect(calls).toBe(1);
  });

  test.each(['classify', 'upload'])('%s forwards command context and returns clean acceptance JSON', async (command) => {
    const project = await createTestProject(env.dir, { name: 'app', hasEnvFile: true, hasObjectTypes: true });
    process.chdir(project);
    const filePath = join(env.dir, 'sample.pdf');
    await writeFile(filePath, 'pdf-bytes');
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const mode = command === 'classify' ? 'classification' : 'full';
    mockServer.server.use(http.post('https://test-api.example.com/v4/data/documents/upload', async ({ request }) => {
      expect(request.headers.get('x-tenant-id')).toBe('tenant-one');
      const form = await request.formData();
      expect(form.get('planning_application_id')).toBe('project-1');
      expect(form.get('business_request_id')).toBe('BR-1');
      expect(form.get('storage_target')).toBe('resourceapi');
      expect(form.get('verticalKey')).toBe('sample-app');
      expect(form.get('workflowKey')).toBe('sample-workflow');
      expect(form.get('processing_mode')).toBe(mode);
      return HttpResponse.json({ jobId: 'job_123', processingMode: mode }, { status: 202 });
    }));
    await docsCommand.parseAsync([command, filePath, '--tenant-id', 'tenant-one', '--storage-target', 'resourceapi',
      '--planning-application-id', 'project-1', '--business-request-id', 'BR-1',
      '--vertical-key', 'sample-app', '--workflow-key', 'sample-workflow', '--format', 'json'], { from: 'user' });
    expect(JSON.parse(output.mock.calls.flat().join(''))).toEqual({
      ok: true, status: 202, body: { jobId: 'job_123', processingMode: mode },
    });
  });

  test.each(['classify', 'upload'])('%s reports the standalone server verdict without inventing a job or retry', async (command) => {
    const project = await createTestProject(env.dir, { name: 'app', hasEnvFile: true, hasObjectTypes: true });
    process.chdir(project);
    const filePath = join(env.dir, 'standalone.pdf');
    await writeFile(filePath, 'pdf-bytes');
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let calls = 0;
    mockServer.server.use(http.post('https://test-api.example.com/v4/data/documents/upload', async ({ request }) => {
      calls += 1;
      const form = await request.formData();
      expect(form.get('verticalKey')).toBe('business-docs');
      expect(form.get('workflowKey')).toBe('trust-review');
      expect(form.has('planning_application_id')).toBe(false);
      expect(form.has('business_request_id')).toBe(false);
      expect(form.get('processing_mode')).toBe(command === 'upload' ? 'full' : 'classification');
      return command === 'upload'
        ? HttpResponse.json({ error: 'DOCUMENT_LIFECYCLE_MODE_UNSUPPORTED' }, { status: 400 })
        : HttpResponse.json({ jobId: 'job_business', status: 'processing' }, { status: 202 });
    }));
    await docsCommand.parseAsync([command, filePath, '--tenant-id', 'tenant-one',
      '--vertical-key', 'business-docs', '--workflow-key', 'trust-review', '--format', 'json'], { from: 'user' });
    expect(calls).toBe(1);
    const result = JSON.parse(output.mock.calls.flat().join(''));
    if (command === 'upload') {
      expect(process.exitCode).toBe(1);
      expect(result).toMatchObject({
        ok: false, status: 400,
        error: { message: expect.stringContaining('DOCUMENT_LIFECYCLE_MODE_UNSUPPORTED') },
      });
      expect(result).not.toHaveProperty('body');
    } else {
      expect(result).toEqual({
        ok: true, status: 202, body: { jobId: 'job_business', status: 'processing' },
      });
    }
  });

  test.each(['classify', 'upload'])('%s reports HTTP rejection as failure JSON', async (command) => {
    const project = await createTestProject(env.dir, { name: 'app', hasEnvFile: true, hasObjectTypes: true });
    process.chdir(project);
    const filePath = join(env.dir, 'sample.pdf');
    await writeFile(filePath, 'pdf-bytes');
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockServer.server.use(http.post('https://test-api.example.com/v4/data/documents/upload', () =>
      HttpResponse.json({ detail: 'Project access denied' }, { status: 403 })));
    await docsCommand.parseAsync([command, filePath, '--tenant-id', 'tenant-one',
      '--planning-application-id', 'project-1', '--format', 'json'], { from: 'user' });
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(output.mock.calls.flat().join(''))).toMatchObject({
      ok: false, status: 403, error: { message: expect.stringContaining('Project access denied') },
    });
  });

  test('exposes the project, classifier and JSON options on both document commands', () => {
    for (const name of ['upload', 'classify']) {
      const command = docsCommand.commands.find((entry) => entry.name() === name)!;
      const flags = command.options.map((option) => option.long);
      expect(flags).toEqual(expect.arrayContaining(['--tenant-id', '--storage-target', '--business-request-id',
        '--planning-application-id', '--vertical-key', '--workflow-key', '--format']));
    }
    expect(() => validateDocumentUploadContext({})).toThrow('Legacy document uploads are deprecated');
  });
  test('document errors preserve field-level validation guidance', async () => {
    const message = await readResponseError(new Response(JSON.stringify({
      error: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      invalidFields: [
        { path: 'body.storagePath', code: 'missing' },
      ],
      rejectedValue: 'tax-file-secret',
    }), {
      status: 422,
      statusText: 'Unprocessable Entity',
    }));

    expect(message).toBe('VALIDATION_ERROR: body.storagePath: Field required');
    expect(message).not.toContain('tax-file-secret');
  });
});
