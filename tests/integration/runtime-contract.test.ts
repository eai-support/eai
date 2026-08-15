import { afterEach, describe, expect, test, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { validateRuntimeContract } from '../../src/lib/runtime-contract.js';
import { runDeployDoctor } from '../../src/commands/deploy.js';

const execFileAsync = promisify(execFile);
const cliEntry = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

async function createRuntimeProject(): Promise<string> {
  const root = join(tmpdir(), `eai-runtime-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'eai.runtime.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        capabilities: {
          authjsEntraSignIn: true,
          publicApiBffAccess: true,
          tenantWorkflowConfiguration: true,
        },
        environment: {
          required: [
            'BASE_URL_PUBLIC_API',
            'TENANT_KEYS',
            'ENTRA_CLIENT_ID',
            'AUTH_URL',
          ],
          tenantKeyPattern: {
            keysEnv: 'TENANT_KEYS',
            tenantIdEnv: 'TENANT_{KEY}_ID',
            workflowIdEnv: 'WORKFLOW_{KEY}_ID',
          },
        },
        secrets: {
          required: ['AUTH_SECRET', 'ENTRA_CLIENT_SECRET'],
          optional: [],
        },
        auth: {
          callbackPath: '/api/auth/callback/microsoft-entra-id',
        },
        endpoints: {
          health: '/health',
          authProviders: '/api/auth/providers',
          runtimeConfig: '/api/eai/config',
          bffBasePath: '/api/eai',
          public: [],
          smokeTests: [
            {
              name: 'health',
              method: 'GET',
              path: '/health',
              expectedStatus: 200,
              category: 'app_not_running',
            },
            {
              name: 'auth-providers',
              method: 'GET',
              path: '/api/auth/providers',
              expectedStatus: 200,
              category: 'authjs_config',
            },
            {
              name: 'runtime-config',
              method: 'GET',
              path: '/api/eai/config',
              expectedStatus: 200,
              category: 'tenant_workflow_config',
            },
          ],
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(root, '.env.example'),
    [
      'TENANT_KEYS=template',
      'TENANT_TEMPLATE_ID=<tenant-id>',
      'WORKFLOW_TEMPLATE_ID=<workflow-id>',
    ].join('\n'),
  );
  return root;
}

async function addProtectedReadinessSmoke(root: string): Promise<void> {
  const contract = JSON.parse(
    await readFile(join(root, 'eai.runtime.json'), 'utf8'),
  ) as Record<string, unknown>;
  const endpoints = contract.endpoints as Record<string, unknown>;
  endpoints.smokeTests = [
    ...(endpoints.smokeTests as unknown[]),
    {
      name: 'readiness',
      method: 'GET',
      path: '/api/eai/readiness',
      expectedStatus: 200,
      category: 'app_code_runtime_error',
      headers: {
        'x-eai-readiness-probe': 'tenantinfra',
        authorization: 'Bearer ${EAI_READINESS_PROBE_TOKEN}',
        'x-eai-tenant-id': '${EAI_TENANT_ID}',
        'x-eai-app-key': 'boardapp-og',
        'x-eai-environment': '${EAI_ENVIRONMENT}',
        'x-eai-config-hash': '${EAI_CONFIG_HASH}',
      },
      requiresSecret: 'EAI_READINESS_PROBE_TOKEN',
    },
  ];
  await writeFile(join(root, 'eai.runtime.json'), JSON.stringify(contract, null, 2));
}

describe('runtime contract validation and deploy doctor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('validates a provider-neutral runtime contract with tenant/workflow keys', async () => {
    const root = await createRuntimeProject();
    try {
      const result = await validateRuntimeContract(root);
      expect(result.status).toBe('pass');
      expect(result.summary.requiredEnv).toContain('BASE_URL_PUBLIC_API');
      expect(result.summary.requiredSecrets).toContain('AUTH_SECRET');
      expect(result.summary.smokeTests).toHaveLength(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('fails validation when a TENANT_KEYS entry lacks a workflow id declaration', async () => {
    const root = await createRuntimeProject();
    try {
      await writeFile(
        join(root, '.env.example'),
        ['TENANT_KEYS=template', 'TENANT_TEMPLATE_ID=<tenant-id>'].join('\n'),
      );
      const result = await validateRuntimeContract(root);
      expect(result.status).toBe('fail');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'runtime_tenant_key_missing_workflow_id',
            severity: 'error',
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('JSON commands expose protected environment variable names without redaction', async () => {
    const root = await createRuntimeProject();
    try {
      const commandEnv = {
        ...process.env,
        HOME: root,
        USERPROFILE: root,
        NO_UPDATE_NOTIFIER: '1',
      };
      const runtime = await execFileAsync(
        process.execPath,
        [cliEntry, 'runtime', 'validate', '--format', 'json'],
        { cwd: root, env: commandEnv },
      );
      const runtimeJson = JSON.parse(runtime.stdout) as {
        summary: {
          requiredProtectedEnvNames: string[];
          optionalProtectedEnvNames: string[];
        };
      };

      expect(runtimeJson.summary.requiredProtectedEnvNames).toContain('AUTH_SECRET');
      expect(runtimeJson.summary.optionalProtectedEnvNames).not.toContain('EAI_SERVICE_CLIENT_SECRET');
      expect(runtime.stdout).not.toContain('[redacted]');

      const deploy = await execFileAsync(
        process.execPath,
        [cliEntry, 'deploy', 'env', '--provider', 'generic', '--format', 'json'],
        { cwd: root, env: commandEnv },
      );
      const deployJson = JSON.parse(deploy.stdout) as {
        requiredProtectedEnvNames: string[];
        optionalProtectedEnvNames: string[];
      };

      expect(deployJson.requiredProtectedEnvNames).toContain('ENTRA_CLIENT_SECRET');
      expect(deployJson.optionalProtectedEnvNames).not.toContain('OBO_CLIENT_SECRET');
      expect(deploy.stdout).not.toContain('[redacted]');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('deploy doctor classifies runtime config failures even when health passes', async () => {
    const root = await createRuntimeProject();
    const originalCwd = process.cwd();
    process.chdir(root);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/health')) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.endsWith('/api/auth/providers')) {
          return new Response(JSON.stringify({ 'microsoft-entra-id': { id: 'microsoft-entra-id' } }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ tenants: { template: { tenantId: 'tenant-id' } } }),
          { status: 200 },
        );
      }),
    );

    try {
      const result = await runDeployDoctor('https://app.example.com');
      expect(result.status).toBe('fail');
      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'runtime-config',
            category: 'tenant_workflow_config',
            status: 'fail',
          }),
        ]),
      );
    } finally {
      process.chdir(originalCwd);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('preserves, interpolates, and sends authenticated readiness headers without exposing secrets', async () => {
    const root = await createRuntimeProject();
    await addProtectedReadinessSmoke(root);
    const originalCwd = process.cwd();
    process.chdir(root);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/auth/providers')) {
        return new Response(JSON.stringify({ entra: { id: 'entra' } }), { status: 200 });
      }
      if (url.endsWith('/api/eai/config')) {
        return new Response(JSON.stringify({
          tenants: { boardapp: { tenantId: 'tenant-id', workflowId: 'workflow-id' } },
        }), { status: 200 });
      }
      if (url.endsWith('/api/eai/readiness')) {
        const headers = new Headers(init?.headers);
        expect(headers.get('authorization')).toBe('Bearer probe-secret-value');
        expect(headers.get('x-eai-readiness-probe')).toBe('tenantinfra');
        expect(headers.get('x-eai-tenant-id')).toBe('tenant-id');
        expect(headers.get('x-eai-app-key')).toBe('boardapp-og');
        expect(headers.get('x-eai-environment')).toBe('production');
        expect(headers.get('x-eai-config-hash')).toBe('config-hash');
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const validation = await validateRuntimeContract(root);
      expect(validation.summary.smokeTests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'readiness',
            requiresSecret: 'EAI_READINESS_PROBE_TOKEN',
            headers: expect.objectContaining({
              authorization: 'Bearer ${EAI_READINESS_PROBE_TOKEN}',
            }),
          }),
        ]),
      );

      const result = await runDeployDoctor('https://app.example.com', {
        environment: {
          EAI_READINESS_PROBE_TOKEN: 'probe-secret-value',
          EAI_TENANT_ID: 'tenant-id',
          EAI_ENVIRONMENT: 'production',
          EAI_CONFIG_HASH: 'config-hash',
        },
      });

      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'readiness', status: 'pass', httpStatus: 200 }),
        ]),
      );
      expect(JSON.stringify(result)).not.toContain('probe-secret-value');
      await expect(access(join(root, '.eai', 'deploy-doctor.json'))).rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('does not send a protected readiness request when the required secret is missing', async () => {
    const root = await createRuntimeProject();
    await addProtectedReadinessSmoke(root);
    const originalCwd = process.cwd();
    process.chdir(root);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/auth/providers')) {
        return new Response(JSON.stringify({ entra: { id: 'entra' } }), { status: 200 });
      }
      if (url.endsWith('/api/eai/config')) {
        return new Response(JSON.stringify({
          tenants: { boardapp: { tenantId: 'tenant-id', workflowId: 'workflow-id' } },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await runDeployDoctor('https://app.example.com', {
        environment: {
          EAI_TENANT_ID: 'tenant-id',
          EAI_ENVIRONMENT: 'production',
          EAI_CONFIG_HASH: 'config-hash',
        },
      });

      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'readiness',
            status: 'fail',
            category: 'authenticated_probe_not_available',
            message: expect.stringContaining('EAI_READINESS_PROBE_TOKEN'),
          }),
        ]),
      );
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/eai/readiness'))).toBe(false);
    } finally {
      process.chdir(originalCwd);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('classifies a local BFF 401 separately from PublicAPI authorization', async () => {
    const root = await createRuntimeProject();
    await addProtectedReadinessSmoke(root);
    const originalCwd = process.cwd();
    process.chdir(root);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/api/auth/providers')) {
        return new Response(JSON.stringify({ entra: { id: 'entra' } }), { status: 200 });
      }
      if (url.endsWith('/api/eai/config')) {
        return new Response(JSON.stringify({
          tenants: { boardapp: { tenantId: 'tenant-id', workflowId: 'workflow-id' } },
        }), { status: 200 });
      }
      if (url.endsWith('/api/eai/readiness')) {
        return new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));

    try {
      const result = await runDeployDoctor('https://app.example.com', {
        environment: {
          EAI_READINESS_PROBE_TOKEN: 'probe-secret-value',
          EAI_TENANT_ID: 'tenant-id',
          EAI_ENVIRONMENT: 'production',
          EAI_CONFIG_HASH: 'config-hash',
        },
      });
      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'readiness',
            status: 'fail',
            category: 'app_bff_authorization',
            httpStatus: 401,
          }),
        ]),
      );
    } finally {
      process.chdir(originalCwd);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects app-only service identity and anonymous platform access in tenant app contracts', async () => {
    const root = await createRuntimeProject();
    try {
      const contract = JSON.parse(
        await readFile(join(root, 'eai.runtime.json'), 'utf8'),
      ) as Record<string, unknown>;
      contract.serviceIdentity = {
        preferred: {
          clientId: 'EAI_SERVICE_CLIENT_ID',
          clientSecret: 'EAI_SERVICE_CLIENT_SECRET',
          targetScope: 'EAI_SERVICE_TARGET_SCOPE',
          tenantName: 'EAI_SERVICE_TENANT_NAME',
        },
      };
      contract.endpoints = {
        ...(contract.endpoints as Record<string, unknown>),
        public: [
          {
            method: 'GET',
            path: '/api/public/feed',
            serverSidePlatformAccess: true,
          },
        ],
      };
      await writeFile(join(root, 'eai.runtime.json'), JSON.stringify(contract, null, 2));

      const result = await validateRuntimeContract(root);
      expect(result.status).toBe('fail');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'runtime_service_identity_not_supported',
            severity: 'error',
          }),
          expect.objectContaining({
            code: 'runtime_anonymous_platform_access_not_supported',
            severity: 'error',
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
