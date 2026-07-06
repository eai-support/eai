import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import { cleanupTestTokens, workingDirectoryIs } from '../helpers/setup-dsl.js';
import { clearTokens, storeTokens } from '../../src/lib/auth.js';
import {
  DEFAULT_PROD_AUTH_CLIENT_ID,
  DEFAULT_PROD_AUTH_TENANT_ID,
  DEFAULT_PROD_AUTH_TENANT_NAME,
  setActiveProfile,
} from '../../src/lib/profile.js';
import {
  appCommand,
  buildSourceUnknownDeploymentData,
  buildSourceUnknownRegistrationData,
  buildSourceUnknownWorkflowEvidenceData,
  verticalCommand,
} from '../../src/commands/vertical.js';

const API_BASE = 'https://test-api.example.com';
const COMPANY_TENANT_ID = 'company-tenant';
const PLATFORM_PARENT_ID = 'eai-developers';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(init?: Parameters<typeof fetch>[1]): string {
  return String(init?.method || 'GET').toUpperCase();
}

async function seedLoggedInTenant(): Promise<void> {
  await storeTokens({
    accessToken: '<fixture-access-token>',
    refreshToken: '<fixture-refresh-token>',
    expiresAt: Date.now() + 3600000,
    tenantId: DEFAULT_PROD_AUTH_TENANT_ID,
    tenantName: DEFAULT_PROD_AUTH_TENANT_NAME,
    clientId: DEFAULT_PROD_AUTH_CLIENT_ID,
    oid: 'test-user-oid',
    upn: 'builder@example.com',
    activeTenantId: COMPANY_TENANT_ID,
    activeTenantName: 'Builder Workspace',
    activeTenantSlug: 'builder-workspace',
    publicApiUrl: API_BASE,
    membershipsCachedAt: Date.now(),
  });
}

async function seedProjectRoot(dir: string): Promise<void> {
  await mkdir(join(dir, 'src', 'eai.config'), { recursive: true });
  await writeFile(join(dir, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
  await writeFile(join(dir, '.env.local'), `BASE_URL_PUBLIC_API=${API_BASE}\n`);
}

describe('eai app', () => {
  let env: TestEnvironment;
  let ctx: TestContext;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalBaseUrl: string | undefined;
  let originalAccessToken: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalBaseUrl = process.env.BASE_URL_PUBLIC_API;
    originalAccessToken = process.env.EAI_ACCESS_TOKEN;
    setActiveProfile('default');
    env = await createTestEnvironment();
    ctx = {
      workingDir: env.dir,
      mockAPI: undefined as never,
      env: {},
      prompts: [],
    };
    workingDirectoryIs(ctx, env.dir);
    process.env.HOME = env.dir;
    process.env.USERPROFILE = env.dir;
    process.env.BASE_URL_PUBLIC_API = API_BASE;
    process.env.EAI_ACCESS_TOKEN = '<fixture-access-token>';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await cleanupTestTokens(ctx);
    await clearTokens();
    setActiveProfile('default');
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
    if (originalBaseUrl === undefined) {
      delete process.env.BASE_URL_PUBLIC_API;
    } else {
      process.env.BASE_URL_PUBLIC_API = originalBaseUrl;
    }
    if (originalAccessToken === undefined) {
      delete process.env.EAI_ACCESS_TOKEN;
    } else {
      process.env.EAI_ACCESS_TOKEN = originalAccessToken;
    }
    await env.cleanup();
  });

  test('HP001 creates an app from outside an EAI project using the selected builder workspace tenant', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps` && method === 'POST') {
        return jsonResponse({ app: { id: 'app-1', verticalKey: 'planning-portal' } }, 201);
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'create',
      'PlanningPortal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--key',
      'planning-portal',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          appDisplayName: 'PlanningPortal',
          verticalKey: 'planning-portal',
          source: 'eai-cli',
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining(`/v4/platform/tenants/${PLATFORM_PARENT_ID}/apps`),
      expect.anything(),
    );
  });

  test('HP003 writes canonical and legacy app env keys when selecting an app', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);

    await appCommand.parseAsync([
      'select',
      'planning-portal',
      '--skip-validate',
      '--format',
      'json',
    ], { from: 'user' });

    const envFile = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(envFile).toContain('EAI_APP_KEY=planning-portal');
    expect(envFile).toContain('EAI_VERTICAL_KEY=planning-portal');
  });

  test('HP004 provisions app resources through the v4 app provisioning job', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
              displayName: 'Planning Portal',
            },
            version: 1,
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs`
        && method === 'POST'
      ) {
        return jsonResponse({
          tenantId: COMPANY_TENANT_ID,
          appKey: 'planning-portal',
          verticalKey: 'planning-portal',
          jobId: 'app-prov-123',
          status: 'ready',
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'provision',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--select',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/provisioning-jobs`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining(`/v4/data/resources/${COMPANY_TENANT_ID}/storage/provision`),
      expect.anything(),
    );
    const envFile = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(envFile).toContain('EAI_APP_KEY=planning-portal');
    expect(envFile).toContain('EAI_VERTICAL_KEY=planning-portal');
  });

  test('HP005 plans app storage readiness without running the provisioning job during dry-run', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
              displayName: 'Planning Portal',
            },
            version: 1,
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/storage/provision`
        && method === 'POST'
      ) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          backend: 'all',
          dry_run: true,
          rebuild_search: false,
        });
        return jsonResponse({
          tenantId: COMPANY_TENANT_ID,
          dryRun: true,
          results: [
            { objectType: 'vertical-product-config', backend: 'documentdb', status: 'planned' },
          ],
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'provision',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--dry-run',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/storage/provision`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/provisioning-jobs'),
      expect.anything(),
    );
  });

  test('HP004 registers an existing app repo as source-unknown under the company tenant', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
              displayName: 'Planning Portal',
            },
            version: 1,
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/register`
        && method === 'POST'
      ) {
        return jsonResponse({ status: 'registered', sourceMetadata: { sourceMode: 'source-unknown' } });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'connect-existing',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--repo',
      'enterpriseaigroup/planning-portal',
      '--commit',
      'abcdef1234567890',
      '--template-version',
      'eai.generated_app_config.v1',
      '--base-template-sha',
      '3fa18d004b20ff409ab9687d623028f24d9e5543',
      '--schema-digest',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--validator-digest',
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/register`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          repoOwner: 'enterpriseaigroup',
          repoName: 'planning-portal',
          repoUrl: 'https://github.com/enterpriseaigroup/planning-portal',
          defaultBranch: 'main',
          workflowPath: '.github/workflows/eai-app.yml',
          ref: 'refs/heads/main',
          commitSha: 'abcdef1234567890',
          configPath: 'src/eai.config/index.ts',
          runtimePath: 'eai.runtime.json',
          sourceMode: 'source-unknown',
          schemaProvenance: {
            templateVersion: 'eai.generated_app_config.v1',
            baseTemplateSha: '3fa18d004b20ff409ab9687d623028f24d9e5543',
            schemaDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            validatorDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          validationSummary: {
            status: 'registered_by_cli',
            appValidated: true,
          },
        }),
      }),
    );
  });

  test('HP005 adopts an already-running app as observed-only source-unknown state', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
            },
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/register`
        && method === 'POST'
      ) {
        return jsonResponse({
          status: 'registered',
          sourceMetadata: {
            sourceMode: 'source-unknown',
            adoptionMode: 'adopted-observed',
          },
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'adopt-observed',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--repo',
      'enterpriseaigroup/planning-portal',
      '--url',
      'https://planning.example.com',
      '--environment',
      'production',
      '--commit',
      'abcdef1234567890',
      '--deployment-id',
      'aca-revision-42',
      '--image-digest',
      'sha256:1234567890abcdef',
      '--config-hash',
      'sha256:feedface',
      '--observed-at',
      '2026-07-02T00:00:00.000Z',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/register`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          repoOwner: 'enterpriseaigroup',
          repoName: 'planning-portal',
          repoUrl: 'https://github.com/enterpriseaigroup/planning-portal',
          defaultBranch: 'main',
          workflowPath: '.github/workflows/eai-app.yml',
          ref: 'refs/heads/main',
          commitSha: 'abcdef1234567890',
          configPath: 'src/eai.config/index.ts',
          runtimePath: 'eai.runtime.json',
          sourceMode: 'source-unknown',
          validationSummary: {
            status: 'adopted_observed_by_cli',
            appValidated: true,
            destructiveOperationsBlocked: true,
          },
          adoptionMode: 'adopted-observed',
          observedDeployment: {
            environment: 'production',
            activeUrl: 'https://planning.example.com',
            status: 'adopted_observed',
            observedAt: '2026-07-02T00:00:00.000Z',
            deploymentId: 'aca-revision-42',
            imageDigest: 'sha256:1234567890abcdef',
            configHash: 'sha256:feedface',
          },
        }),
      }),
    );
  });

  test('HP006 issues source-unknown workflow setup under the company tenant', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
            },
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/workflow-setup`
        && method === 'POST'
      ) {
        return jsonResponse({
          status: 'issued',
          operationId: 'source-unknown-op',
          nonce: 'nonce-token',
          expiresAt: '2026-07-02T00:15:00.000Z',
          setup: {
            workflowPath: '.github/workflows/eai-app.yml',
            publicApiEvidencePath: '/v4/platform/tenants/company-tenant/apps/planning-portal/source-unknown/workflow-evidence',
          },
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'workflow-setup',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--environment',
      'preview',
      '--workflow',
      '.github/workflows/eai-app.yml',
      '--ref',
      'refs/heads/main',
      '--commit',
      'abcdef1234567890',
      '--config-hash',
      'sha256:config',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/workflow-setup`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          environment: 'preview',
          workflowPath: '.github/workflows/eai-app.yml',
          ref: 'refs/heads/main',
          commitSha: 'abcdef1234567890',
          configHash: 'sha256:config',
        }),
      }),
    );
  });

  test('HP007 submits source-unknown workflow evidence under the company tenant', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
            },
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/workflow-evidence`
        && method === 'POST'
      ) {
        return jsonResponse({
          status: 'accepted',
          sourceMetadata: {
            sourceMode: 'source-unknown',
            artifactDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'workflow-evidence',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--repo',
      'enterpriseaigroup/planning-portal',
      '--operation-id',
      'source-unknown-op',
      '--nonce',
      'nonce-token',
      '--commit',
      'abcdef1234567890',
      '--config-hash',
      'sha256:config',
      '--artifact-digest',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--image-digest',
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '--workflow-run-id',
      '123456789',
      '--workflow-run-attempt',
      '1',
      '--github-oidc-token',
      'github-oidc-token',
      '--template-version',
      'eai.generated_app_config.v1',
      '--base-template-sha',
      '3fa18d004b20ff409ab9687d623028f24d9e5543',
      '--schema-digest',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '--validator-digest',
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/workflow-evidence`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer github-oidc-token',
        }),
        body: JSON.stringify({
          operationId: 'source-unknown-op',
          nonce: 'nonce-token',
          environment: 'preview',
          workflowPath: '.github/workflows/eai-app.yml',
          ref: 'refs/heads/main',
          commitSha: 'abcdef1234567890',
          configHash: 'sha256:config',
          artifactDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          imageDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          schemaProvenance: {
            templateVersion: 'eai.generated_app_config.v1',
            baseTemplateSha: '3fa18d004b20ff409ab9687d623028f24d9e5543',
            schemaDigest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            validatorDigest: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          },
          workflowRun: {
            id: '123456789',
            attempt: 1,
          },
          oidcClaims: {
            repository: 'enterpriseaigroup/planning-portal',
            ref: 'refs/heads/main',
            sha: 'abcdef1234567890',
            workflow_ref: 'enterpriseaigroup/planning-portal/.github/workflows/eai-app.yml@refs/heads/main',
            run_id: '123456789',
            run_attempt: '1',
          },
          validationSummary: {
            status: 'passed_by_cli',
            appValidated: true,
          },
        }),
      }),
    );
  });

  test('HP008 requests source-unknown deployment handoff under the company tenant', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
            },
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/deploy`
        && method === 'POST'
      ) {
        return jsonResponse({
          status: 'handoff_pending',
          deploymentRequestId: 'source-unknown-deploy-1',
          requiresTenantInfra: true,
        }, 202);
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'deploy-source-unknown',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--operation-id',
      'source-unknown-op',
      '--environment',
      'preview',
      '--repo',
      'enterpriseaigroup/planning-portal',
      '--workflow',
      '.github/workflows/eai-app.yml',
      '--ref',
      'refs/heads/main',
      '--commit',
      'abcdef1234567890',
      '--workflow-run-id',
      '123456789',
      '--config-hash',
      'sha256:config',
      '--artifact-digest',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--image-digest',
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '--release-channel',
      'preview',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/deploy`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          operationId: 'source-unknown-op',
          environment: 'preview',
          repoOwner: 'enterpriseaigroup',
          repoName: 'planning-portal',
          workflowPath: '.github/workflows/eai-app.yml',
          ref: 'refs/heads/main',
          commitSha: 'abcdef1234567890',
          workflowRunId: '123456789',
          configHash: 'sha256:config',
          artifactDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          imageDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          deploymentTarget: {
            kind: 'tenantinfra',
            releaseChannel: 'preview',
          },
          validationSummary: {
            status: 'deployment_requested_by_cli',
            appValidated: true,
            requiresTenantInfra: true,
          },
        }),
      }),
    );
  });

  test('HP009 reads source-unknown deployment handoff status under the company tenant', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (
        url.startsWith(`${API_BASE}/v4/data/resources/${COMPANY_TENANT_ID}/tenant-vertical-enrollment`)
        && method === 'GET'
      ) {
        return jsonResponse({
          docs: [{
            id: 'app-1',
            data: {
              tenantId: COMPANY_TENANT_ID,
              verticalKey: 'planning-portal',
            },
          }],
        });
      }

      if (
        url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/deployments/latest`
        && method === 'GET'
      ) {
        return jsonResponse({
          status: 'handoff_pending',
          deploymentRequestId: 'source-unknown-deploy-1',
          requiresTenantInfra: true,
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await appCommand.parseAsync([
      'deploy-source-unknown-status',
      'planning-portal',
      '--tenant-id',
      COMPANY_TENANT_ID,
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps/planning-portal/source-unknown/deployments/latest`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  test('BC002 rejects incomplete schema provenance before registration', () => {
    expect(() =>
      buildSourceUnknownRegistrationData({
        repo: 'enterpriseaigroup/planning-portal',
        schemaDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    ).toThrow('Schema provenance requires --schema-digest and --validator-digest.');
  });

  test('BC003 rejects schema provenance without an approved source anchor', () => {
    expect(() =>
      buildSourceUnknownRegistrationData({
        repo: 'enterpriseaigroup/planning-portal',
        templateVersion: 'eai.generated_app_config.v1',
        schemaDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        validatorDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    ).toThrow('Schema provenance requires --base-template-sha, --approved-source-sha, or --approved-release.');
  });

  test('BC004 rejects workflow evidence without schema provenance before request', () => {
    expect(() =>
      buildSourceUnknownWorkflowEvidenceData({
        repo: 'enterpriseaigroup/planning-portal',
        operationId: 'source-unknown-op',
        nonce: 'nonce-token',
        commit: 'abcdef1234567890',
        configHash: 'sha256:config',
        artifactDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        imageDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    ).toThrow('Workflow evidence requires schema provenance');
  });

  test('BC005 rejects invalid deployment handoff artifact digest before request', () => {
    expect(() =>
      buildSourceUnknownDeploymentData({
        operationId: 'source-unknown-op',
        artifactDigest: 'sha256:not-a-real-digest',
      }),
    ).toThrow('--artifact-digest must be a sha256:<64 hex chars> digest.');
  });

  test('BC006 includes TenantInfra source metadata in deployment handoff payloads', () => {
    expect(
      buildSourceUnknownDeploymentData({
        operationId: 'source-unknown-op',
        environment: 'preview',
        repo: 'enterpriseaigroup/planning-portal',
        workflow: '.github/workflows/eai-app.yml',
        ref: 'refs/heads/main',
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        workflowRunId: '123456789',
        artifactDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        imageDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    ).toMatchObject({
      operationId: 'source-unknown-op',
      environment: 'preview',
      repoOwner: 'enterpriseaigroup',
      repoName: 'planning-portal',
      workflowPath: '.github/workflows/eai-app.yml',
      ref: 'refs/heads/main',
      commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
      workflowRunId: '123456789',
    });
  });

  test('BC001 keeps the legacy vertical alias working', async () => {
    await seedLoggedInTenant();
    await seedProjectRoot(env.dir);

    await verticalCommand.parseAsync([
      'select',
      'planning-portal',
      '--skip-validate',
      '--format',
      'json',
    ], { from: 'user' });

    const envFile = await readFile(join(env.dir, '.env.local'), 'utf-8');
    expect(envFile).toContain('EAI_APP_KEY=planning-portal');
    expect(envFile).toContain('EAI_VERTICAL_KEY=planning-portal');
  });

  test('HP002 creates an app for the active builder workspace when tier is omitted from tenant lookups', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/management` && method === 'GET') {
        return jsonResponse({
          id: COMPANY_TENANT_ID,
          displayName: 'Builder Workspace',
          slug: 'builder-workspace',
          parentTenant: PLATFORM_PARENT_ID,
          ultimateParent: PLATFORM_PARENT_ID,
        });
      }

      if (url === `${API_BASE}/v4/platform/tenants/${PLATFORM_PARENT_ID}/management` && method === 'GET') {
        return jsonResponse({
          id: PLATFORM_PARENT_ID,
          displayName: 'EAI Developers',
          slug: 'eai-developers',
          parentTenant: null,
          ultimateParent: PLATFORM_PARENT_ID,
        });
      }

      if (url === `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps` && method === 'POST') {
        return jsonResponse({ app: { id: 'app-1', verticalKey: 'planning-portal' } }, 201);
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await verticalCommand.parseAsync([
      'create',
      'PlanningPortal',
      '--key',
      'planning-portal',
      '--format',
      'json',
    ], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/v4/platform/tenants/${COMPANY_TENANT_ID}/apps`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining(`/v4/platform/tenants/${PLATFORM_PARENT_ID}/apps`),
      expect.anything(),
    );
  });

  test('BP001 blocks app creation for a tenant outside the current tenant-admin memberships', async () => {
    await seedLoggedInTenant();
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      const method = requestMethod(init);

      if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
        return jsonResponse({
          tenants: [{
            id: COMPANY_TENANT_ID,
            displayName: 'Builder Workspace',
            slug: 'builder-workspace',
            isActive: true,
            roles: ['tenant-admin'],
          }],
        });
      }

      return jsonResponse({ message: `Unhandled request: ${method} ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(verticalCommand.parseAsync([
      'create',
      'PlanningPortal',
      '--tenant-id',
      'other-tenant',
      '--key',
      'planning-portal',
      '--format',
      'json',
    ], { from: 'user' })).rejects.toThrow('Tenant "other-tenant" is not available');

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/apps'),
      expect.anything(),
    );
  });
});
