import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { findProjectRoot } from './config.js';

const exec = promisify(execFile);

export const RUNTIME_CONTRACT_FILE = 'eai.runtime.json';

export type RuntimeFindingSeverity = 'error' | 'warning' | 'info';

export interface RuntimeValidationFinding {
  code: string;
  severity: RuntimeFindingSeverity;
  message: string;
  fix?: string;
}

export interface RuntimeValidationResult {
  projectRoot: string;
  contractPath: string;
  status: 'pass' | 'fail';
  findings: RuntimeValidationFinding[];
  summary: {
    requiredEnv: string[];
    requiredSecrets: string[];
    optionalSecrets: string[];
    smokeTests: RuntimeSmokeTest[];
  };
}

/** Declarative smoke request; header templates remain unresolved until execution. */
export interface RuntimeSmokeTest {
  name: string;
  method: string;
  path: string;
  expectedStatus: number | number[];
  category?: string;
  optional?: boolean;
  headers?: Record<string, string>;
  requiresSecret?: string;
}

export interface RuntimePublicEndpoint {
  method?: string;
  path?: string;
  serverSidePlatformAccess?: boolean;
}

export interface RuntimeContract {
  schemaVersion?: unknown;
  name?: unknown;
  capabilities?: unknown;
  environment?: unknown;
  secrets?: unknown;
  auth?: unknown;
  platform?: unknown;
  serviceIdentity?: unknown;
  endpoints?: unknown;
}

export interface RuntimeEnvironmentShape {
  required: string[];
  tenantKeyPattern?: {
    keysEnv?: string;
    tenantIdEnv?: string;
    workflowIdEnv?: string;
  };
}

export interface RuntimeSecretsShape {
  required: string[];
  optional: string[];
}

export interface RuntimeAuthShape {
  callbackPath?: string;
}

export interface RuntimeEndpointShape {
  health?: string;
  authProviders?: string;
  runtimeConfig?: string;
  bffBasePath?: string;
  public: RuntimePublicEndpoint[];
  smokeTests: RuntimeSmokeTest[];
}

export interface NormalizedRuntimeContract {
  raw: RuntimeContract;
  environment: RuntimeEnvironmentShape;
  secrets: RuntimeSecretsShape;
  auth: RuntimeAuthShape;
  endpoints: RuntimeEndpointShape;
  serviceIdentityDeclared: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

function readPath(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function startsWithSlash(pathValue: string | undefined): boolean {
  return typeof pathValue === 'string' && pathValue.startsWith('/');
}

function normalizeSmokeTest(value: unknown): RuntimeSmokeTest | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : '';
  const method = typeof value.method === 'string' && value.method.trim() ? value.method.trim().toUpperCase() : 'GET';
  const path = readPath(value.path);
  const expectedStatus =
    typeof value.expectedStatus === 'number' ||
    (Array.isArray(value.expectedStatus) && value.expectedStatus.every((status) => typeof status === 'number'))
      ? value.expectedStatus
      : 200;

  if (!name || !path) return null;

  const headers = isRecord(value.headers)
    ? Object.fromEntries(
        Object.entries(value.headers).filter(
          (entry): entry is [string, string] =>
            entry[0].trim() !== '' && typeof entry[1] === 'string',
        ),
      )
    : undefined;

  return {
    name,
    method,
    path,
    expectedStatus,
    category: typeof value.category === 'string' ? value.category : undefined,
    optional: value.optional === true,
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
    ...(typeof value.requiresSecret === 'string' && value.requiresSecret.trim()
      ? { requiresSecret: value.requiresSecret.trim() }
      : {}),
  };
}

function normalizePublicEndpoint(value: unknown): RuntimePublicEndpoint | null {
  if (!isRecord(value)) return null;
  const path = readPath(value.path);
  if (!path) return null;
  return {
    method: typeof value.method === 'string' ? value.method.toUpperCase() : 'GET',
    path,
    serverSidePlatformAccess: value.serverSidePlatformAccess === true,
  };
}

export function normalizeRuntimeContract(raw: RuntimeContract): NormalizedRuntimeContract {
  const environment = isRecord(raw.environment) ? raw.environment : {};
  const tenantKeyPattern = isRecord(environment.tenantKeyPattern)
    ? {
        keysEnv: readPath(environment.tenantKeyPattern.keysEnv),
        tenantIdEnv: readPath(environment.tenantKeyPattern.tenantIdEnv),
        workflowIdEnv: readPath(environment.tenantKeyPattern.workflowIdEnv),
      }
    : undefined;

  const secrets = isRecord(raw.secrets) ? raw.secrets : {};
  const auth = isRecord(raw.auth) ? raw.auth : {};
  const endpoints = isRecord(raw.endpoints) ? raw.endpoints : {};

  return {
    raw,
    environment: {
      required: stringArray(environment.required),
      tenantKeyPattern,
    },
    secrets: {
      required: stringArray(secrets.required),
      optional: stringArray(secrets.optional),
    },
    auth: {
      callbackPath: readPath(auth.callbackPath),
    },
    endpoints: {
      health: readPath(endpoints.health),
      authProviders: readPath(endpoints.authProviders),
      runtimeConfig: readPath(endpoints.runtimeConfig),
      bffBasePath: readPath(endpoints.bffBasePath),
      public: Array.isArray(endpoints.public)
        ? endpoints.public
            .map((endpoint) => normalizePublicEndpoint(endpoint))
            .filter((endpoint): endpoint is RuntimePublicEndpoint => endpoint !== null)
        : [],
      smokeTests: Array.isArray(endpoints.smokeTests)
        ? endpoints.smokeTests
            .map((test) => normalizeSmokeTest(test))
            .filter((test): test is RuntimeSmokeTest => test !== null)
        : [],
    },
    serviceIdentityDeclared: isRecord(raw.serviceIdentity),
  };
}

async function readJsonFile(path: string): Promise<unknown> {
  const content = await readFile(path, 'utf8');
  return JSON.parse(content);
}

async function readEnvFile(projectRoot: string, fileName: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(join(projectRoot, fileName), 'utf8');
    const env: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function normalizeTenantEnvKey(key: string): string {
  return key.trim().toUpperCase().replace(/-/g, '_');
}

function interpolatePattern(pattern: string | undefined, key: string): string | null {
  if (!pattern || !pattern.includes('{KEY}')) return null;
  return pattern.replace('{KEY}', normalizeTenantEnvKey(key));
}

async function findTrackedSecretFiles(projectRoot: string): Promise<string[]> {
  const candidateFiles = ['.env', '.env.local', '.env.production', '.env.test'];
  try {
    const { stdout } = await exec('git', ['ls-files', ...candidateFiles], { cwd: projectRoot });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function loadRuntimeContract(projectRoot?: string): Promise<{
  projectRoot: string;
  contractPath: string;
  contract: NormalizedRuntimeContract;
}> {
  const root = projectRoot ?? (await findProjectRoot());
  if (!root) {
    throw new Error(`Could not find an EAI project root containing ${RUNTIME_CONTRACT_FILE}`);
  }

  const contractPath = join(root, RUNTIME_CONTRACT_FILE);
  const raw = await readJsonFile(contractPath);
  if (!isRecord(raw)) {
    throw new Error(`${RUNTIME_CONTRACT_FILE} must contain a JSON object`);
  }

  return {
    projectRoot: root,
    contractPath,
    contract: normalizeRuntimeContract(raw),
  };
}

export async function validateRuntimeContract(projectRoot?: string): Promise<RuntimeValidationResult> {
  const findings: RuntimeValidationFinding[] = [];
  let loaded: Awaited<ReturnType<typeof loadRuntimeContract>>;

  try {
    loaded = await loadRuntimeContract(projectRoot);
  } catch (error) {
    const root = projectRoot ?? process.cwd();
    const message = error instanceof Error ? error.message : String(error);
    return {
      projectRoot: root,
      contractPath: join(root, RUNTIME_CONTRACT_FILE),
      status: 'fail',
      findings: [
        {
          code: 'runtime_contract_missing_or_invalid',
          severity: 'error',
          message,
          fix: `Create ${RUNTIME_CONTRACT_FILE} or run eai init with the latest template.`,
        },
      ],
      summary: {
        requiredEnv: [],
        requiredSecrets: [],
        optionalSecrets: [],
        smokeTests: [],
      },
    };
  }

  const { projectRoot: root, contractPath, contract } = loaded;
  const raw = contract.raw;

  if (raw.schemaVersion !== 1) {
    findings.push({
      code: 'runtime_schema_version',
      severity: 'error',
      message: `${RUNTIME_CONTRACT_FILE} must declare schemaVersion: 1.`,
      fix: 'Update the runtime contract to the current schema before deploying.',
    });
  }

  if (contract.environment.required.length === 0) {
    findings.push({
      code: 'runtime_env_required_empty',
      severity: 'error',
      message: 'The runtime contract does not declare any required environment variables.',
      fix: 'Add environment.required entries for Auth.js, PublicAPI, tenant, and workflow settings.',
    });
  }

  if (contract.secrets.required.length === 0) {
    findings.push({
      code: 'runtime_secrets_required_empty',
      severity: 'error',
      message: 'The runtime contract does not declare any required secrets.',
      fix: 'Add secrets.required entries such as AUTH_SECRET and ENTRA_CLIENT_SECRET.',
    });
  }

  if (!startsWithSlash(contract.auth.callbackPath) || !contract.auth.callbackPath?.includes('/api/auth/callback/')) {
    findings.push({
      code: 'runtime_auth_callback_invalid',
      severity: 'error',
      message: 'The Auth.js callback path must be a relative /api/auth/callback/... path.',
      fix: 'Set auth.callbackPath to a route such as /api/auth/callback/microsoft-entra-id.',
    });
  }

  const endpointChecks: Array<[string, string | undefined]> = [
    ['health', contract.endpoints.health],
    ['authProviders', contract.endpoints.authProviders],
    ['runtimeConfig', contract.endpoints.runtimeConfig],
    ['bffBasePath', contract.endpoints.bffBasePath],
  ];
  for (const [name, pathValue] of endpointChecks) {
    if (!startsWithSlash(pathValue)) {
      findings.push({
        code: `runtime_endpoint_${name}_invalid`,
        severity: 'error',
        message: `endpoints.${name} must be declared as a relative path starting with /.`,
        fix: `Add endpoints.${name} to ${RUNTIME_CONTRACT_FILE}.`,
      });
    }
  }

  const serverSidePublicEndpoints = contract.endpoints.public.filter(
    (endpoint) => endpoint.serverSidePlatformAccess === true,
  );
  if (contract.serviceIdentityDeclared) {
    findings.push({
      code: 'runtime_service_identity_not_supported',
      severity: 'error',
      message: 'Tenant app runtime contracts must not declare app-only PublicAPI service identity.',
      fix: 'Remove serviceIdentity from eai.runtime.json. Use user-delegated access through /api/eai, or move background work into a user-authorized platform workflow.',
    });
  }
  if (serverSidePublicEndpoints.length > 0) {
    findings.push({
      code: 'runtime_anonymous_platform_access_not_supported',
      severity: 'error',
      message: 'Public anonymous endpoints must not declare server-side EAI platform access.',
      fix: 'Require sign-in before calling /api/eai, or expose only public non-platform endpoints. Long-running work should be requested by a user and executed by a platform workflow.',
    });
  }

  const env = {
    ...(await readEnvFile(root, '.env.example')),
    ...(await readEnvFile(root, '.env.local')),
  };
  const tenantKeysEnvName = contract.environment.tenantKeyPattern?.keysEnv || 'TENANT_KEYS';
  const tenantKeys = env[tenantKeysEnvName]
    ?.split(',')
    .map((key) => key.trim())
    .filter(Boolean);

  if (tenantKeys && tenantKeys.length > 0) {
    for (const key of tenantKeys) {
      const tenantEnv = interpolatePattern(contract.environment.tenantKeyPattern?.tenantIdEnv, key);
      const workflowEnv = interpolatePattern(contract.environment.tenantKeyPattern?.workflowIdEnv, key);
      if (tenantEnv && !(tenantEnv in env)) {
        findings.push({
          code: 'runtime_tenant_key_missing_tenant_id',
          severity: 'error',
          message: `${tenantKeysEnvName} includes ${key}, but ${tenantEnv} is not present in .env.example or .env.local.`,
          fix: `Declare ${tenantEnv} for tenant key ${key}.`,
        });
      }
      if (workflowEnv && !(workflowEnv in env)) {
        findings.push({
          code: 'runtime_tenant_key_missing_workflow_id',
          severity: 'error',
          message: `${tenantKeysEnvName} includes ${key}, but ${workflowEnv} is not present in .env.example or .env.local.`,
          fix: `Declare ${workflowEnv} for tenant key ${key}.`,
        });
      }
    }
  }

  const trackedSecretFiles = await findTrackedSecretFiles(root);
  if (trackedSecretFiles.length > 0) {
    findings.push({
      code: 'runtime_secret_file_tracked',
      severity: 'error',
      message: `Secret-bearing env files are tracked by git: ${trackedSecretFiles.join(', ')}.`,
      fix: 'Remove runtime secret files from git and keep only safe examples committed.',
    });
  }

  if (contract.endpoints.smokeTests.length === 0) {
    findings.push({
      code: 'runtime_smoke_tests_missing',
      severity: 'error',
      message: 'The runtime contract does not declare post-deploy smoke tests.',
      fix: 'Add endpoints.smokeTests for /health, /api/auth/providers, /api/eai/config, and any public endpoints.',
    });
  }

  const status = findings.some((finding) => finding.severity === 'error') ? 'fail' : 'pass';
  return {
    projectRoot: root,
    contractPath,
    status,
    findings,
    summary: {
      requiredEnv: contract.environment.required,
      requiredSecrets: contract.secrets.required,
      optionalSecrets: contract.secrets.optional,
      smokeTests: contract.endpoints.smokeTests,
    },
  };
}

export function expectedStatuses(test: RuntimeSmokeTest): number[] {
  return Array.isArray(test.expectedStatus) ? test.expectedStatus : [test.expectedStatus];
}
