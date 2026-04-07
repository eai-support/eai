/**
 * eai verify — run platform connectivity checks.
 * eai doctor — comprehensive diagnostics with fix suggestions.
 */

import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot, loadEnvFile, loadObjectTypes } from '../lib/config.js';
import { isAuthenticated, loadTokens } from '../lib/auth.js';
import { PlatformAPIClient } from '../lib/api.js';
import { normalizeTenantEntries, resolveActiveTenantContext, resolvePublicApiUrl } from '../lib/tenant-context.js';
import { isRecord } from '../lib/utils.js';
import * as out from '../lib/output.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';

interface VerifyEnvironment {
  root: string;
  env: Record<string, string>;
  publicApiUrl: string;
  tenantId?: string;
  workflowId?: string;
}

export interface ContractAuditOptions {
  tenantId?: string;
  resourceType?: string;
  resourceId?: string;
  workflowId?: string;
  stage?: string;
  tenantRecordId?: string;
  userEmail?: string;
  includeChat?: boolean;
  chatMessage?: string;
}

export interface ContractCheckResult {
  id: string;
  label: string;
  method: string;
  endpoint: string;
  status: 'passed' | 'failed' | 'skipped';
  details: string;
}

export interface ContractAuditReport {
  generatedAt: string;
  publicApiUrl: string;
  tenantId?: string;
  workflowId?: string;
  checks: ContractCheckResult[];
  summary: {
    passed: number;
    failed: number;
    skipped: number;
  };
}

async function loadVerifyEnvironment(options?: { tenantId?: string }): Promise<VerifyEnvironment> {
  const root = await findProjectRoot();
  if (!root) {
    exitWithError(ErrorCode.E001);
  }

  const envVars = await loadEnvFile(root);
  const env = { ...envVars, ...process.env } as Record<string, string>;
  const publicApiUrl = await resolvePublicApiUrl(root);

  let tenantId: string | undefined = options?.tenantId;
  if (!tenantId) {
    try {
      const activeContext = await resolveActiveTenantContext({
        projectRoot: root,
        publicApiUrl,
        interactive: false,
      });
      tenantId = activeContext.activeTenant.id;
    } catch {
      tenantId = undefined;
    }
  }

  return {
    root,
    env,
    publicApiUrl,
    tenantId,
    workflowId: env.WORKFLOW_DEFAULT_ID || Object.keys(env)
      .filter((key) => key.startsWith('WORKFLOW_') && key.endsWith('_ID'))
      .map((key) => env[key])
      .find(Boolean),
  };
}

async function parseJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Expected JSON response but received: ${text.slice(0, 120)}`);
  }
}

function addCheck(
  checks: ContractCheckResult[],
  check: ContractCheckResult,
): void {
  checks.push(check);
}

function summarizeChecks(checks: ContractCheckResult[]): ContractAuditReport['summary'] {
  return checks.reduce<ContractAuditReport['summary']>((summary, check) => {
    summary[check.status]++;
    return summary;
  }, {
    passed: 0,
    failed: 0,
    skipped: 0,
  });
}

function describeShape(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (isRecord(value)) {
    return `object keys: ${Object.keys(value).join(', ') || '(none)'}`;
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

function extractSchemaTypeCount(payload: unknown): number {
  if (!isRecord(payload)) {
    return 0;
  }

  if (Array.isArray(payload.objectTypes)) {
    return payload.objectTypes.length;
  }

  if (Array.isArray(payload.object_types)) {
    return payload.object_types.length;
  }

  if (!Array.isArray(payload.docs)) {
    return 0;
  }

  return payload.docs.filter((value) => (
    isRecord(value) && (
      value.status === 'published'
      || value.publishedAt !== null && value.publishedAt !== undefined
    )
  )).length;
}

function renderContractAudit(report: ContractAuditReport): void {
  out.heading('Platform Call Audit');
  out.info(`PublicAPI: ${report.publicApiUrl}`);
  if (report.tenantId) {
    out.info(`Tenant: ${report.tenantId}`);
  }
  if (report.workflowId) {
    out.info(`Workflow: ${report.workflowId}`);
  }
  out.blank();

  for (const check of report.checks) {
    const icon = check.status === 'passed'
      ? out.symbols.success
      : check.status === 'failed'
        ? out.symbols.error
        : out.symbols.warning;
    out.info(`${icon} ${check.label}`);
    out.dim(`  ${check.method} ${check.endpoint}`);
    out.dim(`  ${check.details}`);
  }

  out.blank();
  if (report.summary.failed === 0) {
    out.success(`${report.summary.passed} passed, ${report.summary.skipped} skipped`);
  } else {
    out.warn(`${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped`);
  }
}

function collectPublishedStorageBackends(
  objectTypesByScope: Record<string, Array<{ status?: string; storageBackend?: string }>>,
): { backends: string[]; invalid: string[] } {
  const backends = new Set<string>();
  const invalid = new Set<string>();
  const allowed = new Set(['postgresql', 'documentdb', 'blob', 'search']);

  for (const types of Object.values(objectTypesByScope)) {
    for (const objectType of types) {
      if (objectType.status && objectType.status !== 'published') {
        continue;
      }
      if (!objectType.storageBackend) {
        continue;
      }
      backends.add(objectType.storageBackend);
      if (!allowed.has(objectType.storageBackend)) {
        invalid.add(objectType.storageBackend);
      }
    }
  }

  return {
    backends: [...backends].sort(),
    invalid: [...invalid].sort(),
  };
}

export async function runContractAudit(
  options: ContractAuditOptions,
): Promise<ContractAuditReport> {
  const context = await loadVerifyEnvironment({ tenantId: options.tenantId });
  const checks: ContractCheckResult[] = [];
  let remoteObjectTypeCount: number | null = null;
  const workflowId = options.workflowId || context.workflowId;
  const stage = options.stage || 'chat';
  const client = context.tenantId
    ? new PlatformAPIClient(context.publicApiUrl, context.tenantId)
    : null;
  const systemClient = new PlatformAPIClient(context.publicApiUrl, 'system');

  // Public API health
  try {
    const start = Date.now();
    const res = await fetch(`${context.publicApiUrl}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    const latency = Date.now() - start;
    if (res.ok || res.status === 404) {
      addCheck(checks, {
        id: 'health',
        label: 'PublicAPI health',
        method: 'GET',
        endpoint: '/health',
        status: 'passed',
        details: `Reachable in ${latency}ms (status ${res.status})`,
      });
    } else {
      addCheck(checks, {
        id: 'health',
        label: 'PublicAPI health',
        method: 'GET',
        endpoint: '/health',
        status: 'failed',
        details: `Unexpected status ${res.status}`,
      });
    }
  } catch (err) {
    addCheck(checks, {
      id: 'health',
      label: 'PublicAPI health',
      method: 'GET',
      endpoint: '/health',
      status: 'failed',
      details: err instanceof Error ? err.message : String(err),
    });
  }

  const authenticated = await isAuthenticated();
  const tokens = await loadTokens();
  addCheck(checks, {
    id: 'auth',
    label: 'Authentication token',
    method: 'LOCAL',
    endpoint: '~/.eai/tokens.json or EAI_ACCESS_TOKEN',
    status: authenticated ? 'passed' : 'failed',
    details: authenticated
      ? `Authenticated as ${tokens?.upn || (process.env.EAI_ACCESS_TOKEN ? 'injected access token' : 'user')}`
      : 'Not authenticated. Run `eai login` or set EAI_ACCESS_TOKEN.',
  });

  try {
    const localTypes = await loadObjectTypes(context.root);
    const backendSummary = collectPublishedStorageBackends(localTypes);
    if (backendSummary.invalid.length > 0) {
      throw new Error(
        `Unsupported storageBackend value(s): ${backendSummary.invalid.join(', ')}. Use postgresql, documentdb, blob, or search.`,
      );
    }
    addCheck(checks, {
      id: 'backend-config',
      label: 'Local backend contract',
      method: 'LOCAL',
      endpoint: 'src/eai.config/object-types.ts',
      status: 'passed',
      details: backendSummary.backends.length > 0
        ? `Published local backends: ${backendSummary.backends.join(', ')}`
        : 'No explicit storageBackend declarations found; default PostgreSQL routing remains valid.',
    });
  } catch (err) {
    addCheck(checks, {
      id: 'backend-config',
      label: 'Local backend contract',
      method: 'LOCAL',
      endpoint: 'src/eai.config/object-types.ts',
      status: 'failed',
      details: err instanceof Error ? err.message : String(err),
    });
  }

  if (!authenticated) {
    const skippedDueToAuth = [
      ['current-user', 'Tenant membership contract', 'POST', '/v3/orchestrate -> admin:/v1/users/{oid}/memberships'],
      ['object-types', 'Object Types list contract', 'POST', '/v3/orchestrate -> payload:/object-types'],
      ['schema', 'Schema contract', 'GET', '/v3/resources/schema/{tenantId}'],
    ] as const;

    for (const [id, label, method, endpoint] of skippedDueToAuth) {
      addCheck(checks, {
        id,
        label,
        method,
        endpoint,
        status: 'skipped',
        details: 'Skipped because authentication is required.',
      });
    }
  } else if (!context.tenantId || !client) {
    const skippedDueToTenant = [
      ['current-user', 'Tenant membership contract', 'POST', '/v3/orchestrate -> admin:/v1/users/{oid}/memberships'],
      ['object-types', 'Object Types list contract', 'POST', '/v3/orchestrate -> payload:/object-types'],
      ['schema', 'Schema contract', 'GET', '/v3/resources/schema/{tenantId}'],
    ] as const;

    for (const [id, label, method, endpoint] of skippedDueToTenant) {
      addCheck(checks, {
        id,
        label,
        method,
        endpoint,
        status: 'skipped',
        details: 'Skipped because no active tenant is selected. Run `eai tenant select`.',
      });
    }
  } else {
    try {
      const res = await systemClient.getUserMemberships(tokens?.oid || '');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = await parseJsonBody(res);
      const tenantEntries = normalizeTenantEntries(payload);
      if (tenantEntries.length === 0) {
        throw new Error('Expected tenant membership entries in response');
      }
      addCheck(checks, {
        id: 'current-user',
        label: 'Tenant membership contract',
        method: 'POST',
        endpoint: '/v3/orchestrate -> admin:/v1/users/{oid}/memberships',
        status: 'passed',
        details: `Tenant entries: ${tenantEntries.length}`,
      });
    } catch (err) {
      addCheck(checks, {
        id: 'current-user',
        label: 'Tenant membership contract',
        method: 'POST',
        endpoint: '/v3/orchestrate -> admin:/v1/users/{oid}/memberships',
        status: 'failed',
        details: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const res = await client.getPublishedObjectTypes({ limit: 1 });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = await parseJsonBody(res);
      if (!isRecord(payload) || !Array.isArray(payload.docs)) {
        throw new Error('Expected docs[] in Object Types response');
      }
      addCheck(checks, {
        id: 'object-types',
        label: 'Object Types list contract',
        method: 'POST',
        endpoint: '/v3/orchestrate -> payload:/object-types',
        status: 'passed',
        details: `Response includes docs[] (${payload.docs.length} item(s) in sample)`,
      });
      remoteObjectTypeCount = payload.docs.length;
    } catch (err) {
      addCheck(checks, {
        id: 'object-types',
        label: 'Object Types list contract',
        method: 'POST',
        endpoint: '/v3/orchestrate -> payload:/object-types',
        status: 'failed',
        details: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const res = await client.getSchema();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = await parseJsonBody(res);
      const typeCount = extractSchemaTypeCount(payload);
      remoteObjectTypeCount = remoteObjectTypeCount ?? typeCount;
      if (typeCount === 0 && (!isRecord(payload) || !Array.isArray(payload.docs))) {
        throw new Error('Expected published Object Types in response');
      }
      addCheck(checks, {
        id: 'schema',
        label: 'Schema contract',
        method: 'GET',
        endpoint: `/v3/resources/schema/${context.tenantId}`,
        status: 'passed',
        details: `ResourceAPI schema present (${typeCount} published type(s))`,
      });
    } catch (err) {
      addCheck(checks, {
        id: 'schema',
        label: 'Schema contract',
        method: 'GET',
        endpoint: `/v3/resources/schema/${context.tenantId}`,
        status: 'failed',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (authenticated && client && options.resourceType) {
    if (remoteObjectTypeCount === 0) {
      addCheck(checks, {
        id: 'resource-list',
        label: 'Resource list contract',
        method: 'GET',
        endpoint: '/v3/resources/{tenantId}/{objectType}',
        status: 'skipped',
        details: 'Skipped because the active tenant has no published Object Types remotely.',
      });
      addCheck(checks, {
        id: 'resource-query',
        label: 'Resource query contract',
        method: 'POST',
        endpoint: '/v3/resources/{tenantId}/query',
        status: 'skipped',
        details: 'Skipped because the active tenant has no published Object Types remotely.',
      });
      addCheck(checks, {
        id: 'resource-cursor',
        label: 'Resource cursor contract',
        method: 'GET',
        endpoint: '/v3/resources/{tenantId}/{objectType}?cursor=...',
        status: 'skipped',
        details: 'Skipped because the active tenant has no published Object Types remotely.',
      });
      addCheck(checks, {
        id: 'resource-aggregate',
        label: 'Resource aggregate contract',
        method: 'POST',
        endpoint: '/v3/resources/{tenantId}/{objectType}/aggregate',
        status: 'skipped',
        details: 'Skipped because the active tenant has no published Object Types remotely.',
      });
    } else {
      try {
        const res = await client.listResources(options.resourceType, { limit: 1, page: 1 });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const payload = await parseJsonBody(res);
        if (!isRecord(payload) || !Array.isArray(payload.docs)) {
          throw new Error('Expected docs[] in list response');
        }
        addCheck(checks, {
          id: 'resource-list',
          label: 'Resource list contract',
          method: 'GET',
          endpoint: `/v3/resources/${context.tenantId}/${options.resourceType}`,
          status: 'passed',
          details: `docs[] present (${payload.docs.length} item(s) in sample)`,
        });
      } catch (err) {
        addCheck(checks, {
          id: 'resource-list',
          label: 'Resource list contract',
          method: 'GET',
          endpoint: `/v3/resources/${context.tenantId}/${options.resourceType}`,
          status: 'failed',
          details: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        const res = await client.listResources(options.resourceType, {
          limit: 1,
          cursor: 'opaque-test-cursor',
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const payload = await parseJsonBody(res);
        if (!isRecord(payload) || (!('nextCursor' in payload) && !('docs' in payload))) {
          throw new Error('Expected docs[] and optional nextCursor in cursor list response');
        }
        addCheck(checks, {
          id: 'resource-cursor',
          label: 'Resource cursor contract',
          method: 'GET',
          endpoint: `/v3/resources/${context.tenantId}/${options.resourceType}?cursor=...`,
          status: 'passed',
          details: `Cursor-aware list response shape: ${describeShape(payload)}`,
        });
      } catch (err) {
        addCheck(checks, {
          id: 'resource-cursor',
          label: 'Resource cursor contract',
          method: 'GET',
          endpoint: `/v3/resources/${context.tenantId}/${options.resourceType}?cursor=...`,
          status: 'failed',
          details: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        const res = await client.queryResources({
          object_types: [options.resourceType],
          limit: 1,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const payload = await parseJsonBody(res);
        if (!isRecord(payload)) {
          throw new Error(`Expected object, received ${describeShape(payload)}`);
        }
        addCheck(checks, {
          id: 'resource-query',
          label: 'Resource query contract',
          method: 'POST',
          endpoint: `/v3/resources/${context.tenantId}/query`,
          status: 'passed',
          details: describeShape(payload),
        });
      } catch (err) {
        addCheck(checks, {
          id: 'resource-query',
          label: 'Resource query contract',
          method: 'POST',
          endpoint: `/v3/resources/${context.tenantId}/query`,
          status: 'failed',
          details: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        const res = await client.aggregateResources(options.resourceType, {
          groupBy: ['id'],
          metrics: {
            count: { function: 'count' },
          },
          limit: 1,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const payload = await parseJsonBody(res);
        if (!isRecord(payload) || !Array.isArray(payload.rows)) {
          throw new Error('Expected rows[] in aggregate response');
        }
        addCheck(checks, {
          id: 'resource-aggregate',
          label: 'Resource aggregate contract',
          method: 'POST',
          endpoint: `/v3/resources/${context.tenantId}/${options.resourceType}/aggregate`,
          status: 'passed',
          details: `rows[] present (${payload.rows.length} row(s) in sample)`,
        });
      } catch (err) {
        addCheck(checks, {
          id: 'resource-aggregate',
          label: 'Resource aggregate contract',
          method: 'POST',
          endpoint: `/v3/resources/${context.tenantId}/${options.resourceType}/aggregate`,
          status: 'failed',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else {
    addCheck(checks, {
      id: 'resource-list',
      label: 'Resource list contract',
      method: 'GET',
      endpoint: '/v3/resources/{tenantId}/{objectType}',
      status: 'skipped',
      details: 'Provide --resource-type to exercise list/query contracts.',
    });
    addCheck(checks, {
      id: 'resource-query',
      label: 'Resource query contract',
      method: 'POST',
      endpoint: '/v3/resources/{tenantId}/query',
      status: 'skipped',
      details: 'Provide --resource-type to exercise query contract.',
    });
    addCheck(checks, {
      id: 'resource-cursor',
      label: 'Resource cursor contract',
      method: 'GET',
      endpoint: '/v3/resources/{tenantId}/{objectType}?cursor=...',
      status: 'skipped',
      details: 'Provide --resource-type to exercise cursor contract.',
    });
    addCheck(checks, {
      id: 'resource-aggregate',
      label: 'Resource aggregate contract',
      method: 'POST',
      endpoint: '/v3/resources/{tenantId}/{objectType}/aggregate',
      status: 'skipped',
      details: 'Provide --resource-type to exercise aggregate contract.',
    });
  }

  if (authenticated && client && options.resourceType && options.resourceId) {
    if (remoteObjectTypeCount === 0) {
      addCheck(checks, {
        id: 'resource-get',
        label: 'Resource get contract',
        method: 'GET',
        endpoint: '/v3/resources/{tenantId}/{objectType}/{id}',
        status: 'skipped',
        details: 'Skipped because the active tenant has no published Object Types remotely.',
      });
    } else {
      try {
        const res = await client.getResource(options.resourceType, options.resourceId);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const payload = await parseJsonBody(res);
        if (!isRecord(payload) || !('id' in payload) || !('data' in payload) || typeof payload.version !== 'number') {
          throw new Error('Expected id, data, and numeric version in resource payload');
        }
        addCheck(checks, {
          id: 'resource-get',
          label: 'Resource get contract',
          method: 'GET',
          endpoint: `/v3/resources/${context.tenantId}/${options.resourceType}/${options.resourceId}`,
          status: 'passed',
          details: 'Resource payload includes id, data, and version',
        });
      } catch (err) {
        addCheck(checks, {
          id: 'resource-get',
          label: 'Resource get contract',
          method: 'GET',
          endpoint: `/v3/resources/${context.tenantId}/${options.resourceType}/${options.resourceId}`,
          status: 'failed',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else {
    addCheck(checks, {
      id: 'resource-get',
      label: 'Resource get contract',
      method: 'GET',
      endpoint: '/v3/resources/{tenantId}/{objectType}/{id}',
      status: 'skipped',
      details: 'Provide both --resource-type and --resource-id to exercise get/update version contract.',
    });
  }

  if (authenticated && options.tenantRecordId) {
    try {
      const res = await systemClient.getUserMemberships(tokens?.oid || '');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = await parseJsonBody(res);
      const tenantEntries = normalizeTenantEntries(payload);
      const tenant = tenantEntries.find((entry) => (
        entry.tenant.id === options.tenantRecordId || entry.tenant.slug === options.tenantRecordId
      ));
      if (!tenant) {
        throw new Error('Requested tenant was not found in the current tenant-admin memberships');
      }
      addCheck(checks, {
        id: 'tenant-info',
        label: 'Tenant info resolution',
        method: 'POST',
        endpoint: '/v3/orchestrate -> admin:/v1/users/{oid}/memberships',
        status: 'passed',
        details: `Resolved ${tenant.tenant.displayName} (${tenant.tenant.slug})`,
      });
    } catch (err) {
      addCheck(checks, {
        id: 'tenant-info',
        label: 'Tenant info resolution',
        method: 'POST',
        endpoint: '/v3/orchestrate -> admin:/v1/users/{oid}/memberships',
        status: 'failed',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    addCheck(checks, {
      id: 'tenant-info',
      label: 'Tenant info resolution',
      method: 'POST',
      endpoint: '/v3/orchestrate -> admin:/v1/users/{oid}/memberships',
      status: 'skipped',
      details: 'Provide --tenant-record to exercise tenant info lookup.',
    });
  }

  if (authenticated && options.userEmail) {
    try {
      const res = await systemClient.lookupUserByEmail(options.userEmail);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = await parseJsonBody(res);
      if (!isRecord(payload)) {
        throw new Error(`Expected object, received ${describeShape(payload)}`);
      }
      const userId = typeof payload.id === 'string'
        ? payload.id
        : isRecord(payload.user) && typeof payload.user.id === 'string'
          ? payload.user.id
          : null;
      if (!userId) {
        throw new Error('Expected direct id or payload.user.id in lookup response');
      }
      addCheck(checks, {
        id: 'user-lookup',
        label: 'User lookup contract',
        method: 'POST',
        endpoint: '/v3/orchestrate -> admin:/v1/users/by-email?email=...',
        status: 'passed',
        details: `${describeShape(payload)} (resolved user id ${userId})`,
      });
    } catch (err) {
      addCheck(checks, {
        id: 'user-lookup',
        label: 'User lookup contract',
        method: 'POST',
        endpoint: '/v3/orchestrate -> admin:/v1/users/by-email?email=...',
        status: 'failed',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    addCheck(checks, {
      id: 'user-lookup',
      label: 'User lookup contract',
      method: 'POST',
      endpoint: '/v3/orchestrate -> admin:/v1/users/by-email?email=...',
      status: 'skipped',
      details: 'Provide --user-email to exercise user lookup.',
    });
  }

  if (authenticated && client && options.includeChat) {
    if (!workflowId) {
      addCheck(checks, {
        id: 'chat-send',
        label: 'Chat send contract',
        method: 'POST',
        endpoint: '/v3/chat/{tenantId}/{workflowId}/{stage}',
        status: 'skipped',
        details: 'Provide --workflow or WORKFLOW_*_ID to exercise chat.',
      });
    } else {
      try {
        const res = await client.sendChat(
          workflowId,
          stage,
          options.chatMessage || 'Smoke test from `eai verify calls`',
          randomUUID(),
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const payload = await parseJsonBody(res);
        if (!isRecord(payload) || (typeof payload.response !== 'string' && typeof payload.message !== 'string')) {
          throw new Error('Expected response or message string in chat payload');
        }
        addCheck(checks, {
          id: 'chat-send',
          label: 'Chat send contract',
          method: 'POST',
          endpoint: `/v3/chat/${context.tenantId}/${workflowId}/${stage}`,
          status: 'passed',
          details: 'Chat response payload includes response/message text',
        });
      } catch (err) {
        addCheck(checks, {
          id: 'chat-send',
          label: 'Chat send contract',
          method: 'POST',
          endpoint: `/v3/chat/${context.tenantId || '{tenantId}'}/${workflowId}/${stage}`,
          status: 'failed',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else {
    addCheck(checks, {
      id: 'chat-send',
      label: 'Chat send contract',
      method: 'POST',
      endpoint: '/v3/chat/{tenantId}/{workflowId}/{stage}',
      status: 'skipped',
      details: 'Opt in with --include-chat. This creates a conversation record.',
    });
  }

  const intentionallySkipped: Array<Omit<ContractCheckResult, 'status'>> = [
    {
      id: 'resource-mutations',
      label: 'Resource create/update/delete contracts',
      method: 'POST/PUT/DELETE',
      endpoint: '/v3/resources/{tenantId}/{objectType}[/{id}]',
      details: 'Not auto-executed because they mutate data.',
    },
    {
      id: 'document-contracts',
      label: 'Document upload/classify/index contracts',
      method: 'POST',
      endpoint: '/v3/documents/*',
      details: 'Not auto-executed because they upload files or trigger indexing.',
    },
    {
      id: 'user-provisioning',
      label: 'User provisioning contracts',
      method: 'POST',
      endpoint: '/v3/users/provisionme and /v3/orchestrate -> payload:/custom-users/provisionme',
      details: 'Not auto-executed because they change tenant membership.',
    },
    {
      id: 'tenant-create',
      label: 'Tenant create contract',
      method: 'POST',
      endpoint: '/v3/orchestrate -> payload:/tenants',
      details: 'Not auto-executed because it creates tenants.',
    },
    {
      id: 'chat-stream',
      label: 'Chat stream contract',
      method: 'POST',
      endpoint: '/v3/chat/stream/{tenantId}/{workflowId}/{stage}',
      details: 'Not auto-executed because it requires streaming response handling.',
    },
  ];

  for (const check of intentionallySkipped) {
    addCheck(checks, {
      ...check,
      status: 'skipped',
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    publicApiUrl: context.publicApiUrl,
    tenantId: context.tenantId,
    workflowId,
    checks,
    summary: summarizeChecks(checks),
  };
}

export const verifyCommand = new Command('verify')
  .description('Run platform connectivity checks')
  .option('--tenant-id <id>', 'Run read-only connectivity checks against a specific tenant ID')
  .addHelpText('after', `
Examples:
  $ eai verify
  $ eai verify --tenant-id <tenantId>
  $ eai verify calls --format json

Use 'eai verify' for a quick health check.
Use 'eai verify calls' when you need to inspect the exact API contracts the CLI depends on.
  `)
  .action(async (options) => {
    const { root, publicApiUrl, tenantId } = await loadVerifyEnvironment({ tenantId: options.tenantId });

    out.heading('Platform Connectivity Checks');
    out.blank();

    const client = new PlatformAPIClient(publicApiUrl, tenantId || 'unknown');
    let passed = 0;
    let failed = 0;

    // Check 1: PublicAPI reachable
    const apiSpinner = ora('PublicAPI gateway').start();
    try {
      const start = Date.now();
      const res = await fetch(`${publicApiUrl}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      const latency = Date.now() - start;
      if (res.ok || res.status === 404) {
        // 404 is fine — means server is up, just no /health endpoint
        apiSpinner.succeed(`PublicAPI reachable (${latency}ms)`);
        passed++;
      } else {
        apiSpinner.fail(`PublicAPI returned ${res.status}`);
        failed++;
      }
    } catch (err) {
      apiSpinner.fail(`PublicAPI not reachable: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }

    // Check 2: Auth token
    const authSpinner = ora('Authentication').start();
    const authenticated = await isAuthenticated();
    if (authenticated) {
      const tokens = await loadTokens();
      authSpinner.succeed(`Authenticated as ${tokens?.upn || 'user'}`);
      passed++;
    } else {
      authSpinner.warn('Not authenticated — run `eai login`');
      failed++;
    }

    // Check 3: Platform service connectivity
    if (authenticated && tenantId) {
      const cfgSpinner = ora('Platform service').start();
      try {
        const res = await client.getPublishedObjectTypes({ limit: 1 });
        if (res.ok) {
          cfgSpinner.succeed('Platform service reachable');
          passed++;
        } else {
          cfgSpinner.fail(`Platform service returned ${res.status}`);
          failed++;
        }
      } catch (err) {
        cfgSpinner.fail(`Platform service not reachable: ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      }
    }

    // Check 4: Data service (schema)
    if (authenticated && tenantId) {
      const resSpinner = ora('Data service (schema)').start();
      try {
        const res = await client.getSchema();
        if (res.ok) {
          const schema = await res.json() as { objectTypes?: unknown[]; object_types?: unknown[] };
          const typeCount = Array.isArray(schema?.object_types)
            ? schema.object_types.length
            : (schema?.objectTypes as unknown[])?.length || 0;
          resSpinner.succeed(`Data service reachable — ${typeCount} published types`);
          passed++;
        } else {
          resSpinner.fail(`Data service returned ${res.status}`);
          failed++;
        }
      } catch (err) {
        resSpinner.fail(`Data service not reachable: ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      }
    }

    // Check 5: Local Object Types
    const typesSpinner = ora('Local Object Types').start();
    try {
      const types = await loadObjectTypes(root);
      const totalTypes = Object.values(types).reduce((sum, t) => sum + t.length, 0);
      const tenantKeys = Object.keys(types);
      typesSpinner.succeed(`${totalTypes} types across ${tenantKeys.length} tenant scope(s)`);
      passed++;
    } catch (err) {
      typesSpinner.fail(`No Object Types found: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }

    // Summary
    out.blank();
    if (failed === 0) {
      out.success(`All ${passed} checks passed`);
    } else {
      out.warn(`${passed} passed, ${failed} failed`);
    }
  });

verifyCommand
  .command('calls')
  .description('Audit platform-facing API call contracts used by the CLI')
  .option('--tenant-id <id>', 'Tenant ID to use for read-only resource and schema checks')
  .option('--resource-type <type>', 'Resource type to probe with list/query/get checks')
  .option('--resource-id <id>', 'Specific resource ID to fetch during contract audit')
  .option('--workflow <id>', 'Workflow ID to use for chat smoke test')
  .option('--stage <stage>', 'Chat stage to use when --include-chat is enabled', 'chat')
  .option('--tenant-record <id>', 'Tenant record ID to use for tenant info lookup')
  .option('--user-email <email>', 'Email address to use for user lookup contract check')
  .option('--include-chat', 'Execute a non-streaming chat request (creates a conversation)', false)
  .option('--chat-message <message>', 'Message to send when probing chat', 'Smoke test from `eai verify calls`')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action(async (options) => {
    if (options.json) {
      options.format = 'json';
    }

    const report = await runContractAudit({
      tenantId: options.tenantId,
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      workflowId: options.workflow,
      stage: options.stage,
      tenantRecordId: options.tenantRecord,
      userEmail: options.userEmail,
      includeChat: options.includeChat,
      chatMessage: options.chatMessage,
    });

    if (options.format === 'json') {
      out.json(report);
      return;
    }

    renderContractAudit(report);
    if (report.summary.failed > 0) {
      process.exit(1);
    }
  });

// ─── eai doctor ────────────────────────────────────────────────────────────

export const doctorCommand = new Command('doctor')
  .description('Diagnose common issues and suggest fixes')
  .option('--fix', 'Attempt to fix issues automatically', false)
  .action(async (_options) => {
    const issues: Array<{ severity: 'error' | 'warn' | 'info'; message: string; fix?: string }> = [];

    out.heading('EAI Platform Health Check');
    out.blank();

    // 1. Project detection
    const root = await findProjectRoot();
    if (!root) {
      out.error('Not in an EAI project directory.');
      exitWithError(ErrorCode.E001);
    }
    out.success(`Project root: ${chalk.dim(root)}`);

    // 2. Local app env file (optional for CLI platform operations)
    try {
      await access(join(root, '.env.local'));
      out.success('.env.local found for local app runtime');
    } catch {
      out.info('.env.local not found — CLI auth and tenant selection use stored login context');
    }

    // 3. PublicAPI resolution
    const envVars = await loadEnvFile(root);
    const publicApiUrl = await resolvePublicApiUrl(root);
    const publicApiSource = envVars.BASE_URL_PUBLIC_API || process.env.BASE_URL_PUBLIC_API
      ? 'environment'
      : 'stored login/default';
    out.success(`PublicAPI URL resolved (${publicApiSource}): ${chalk.dim(publicApiUrl)}`);

    // 4. Auth status
    const authenticated = await isAuthenticated();
    if (authenticated) {
      const tokens = await loadTokens();
      out.success(`Authenticated as ${tokens?.upn || 'user'}`);
    } else {
      issues.push({
        severity: 'warn',
        message: 'Not authenticated',
        fix: 'Run `eai login` to authenticate with Entra CIAM',
      });
      out.warn('Not authenticated');
    }

    // 5. Active tenant selection
    if (authenticated) {
      try {
        const tenantContext = await resolveActiveTenantContext({
          projectRoot: root,
          publicApiUrl,
          interactive: false,
        });
        out.success(`Active tenant selected: ${tenantContext.activeTenant.displayName} ${chalk.dim(`(${tenantContext.activeTenant.id})`)}`);
      } catch (err) {
        issues.push({
          severity: 'warn',
          message: err instanceof Error ? err.message : String(err),
          fix: 'Run `eai tenant list` to inspect memberships, then `eai tenant select` to choose one',
        });
        out.warn(err instanceof Error ? err.message : String(err));
      }
    }

    // 6. Object types loadable
    try {
      const types = await loadObjectTypes(root);
      const totalTypes = Object.values(types).reduce((sum, t) => sum + t.length, 0);
      out.success(`Object Types: ${totalTypes} defined`);
    } catch (err) {
      issues.push({
        severity: 'warn',
        message: `Object Types not loadable: ${err instanceof Error ? err.message : String(err)}`,
        fix: 'Check src/eai.config/object-types.ts for syntax errors',
      });
      out.warn('Object Types not loadable');
    }

    // 7. Deployment workflow exists
    try {
      await access(join(root, '.github', 'workflows', 'deploy-demo.yml'));
      out.success('Deployment workflow exists');
    } catch {
      issues.push({
        severity: 'warn',
        message: 'deploy-demo.yml not found',
        fix: 'Run `eai deploy setup` to generate the workflow',
      });
      out.warn('deploy-demo.yml not found');
    }

    // 8. node_modules exists
    try {
      await access(join(root, 'node_modules'));
      out.success('Dependencies installed');
    } catch {
      issues.push({
        severity: 'error',
        message: 'node_modules not found',
        fix: 'Run `npm install`',
      });
      out.error('Dependencies not installed');
    }

    // 9. Platform SDK available
    try {
      await access(join(root, 'packages', 'platform-sdk'));
      out.success('Platform SDK present');
    } catch {
      try {
        await access(join(root, 'node_modules', '@eai-tools', 'platform-sdk'));
        out.success('Platform SDK installed');
      } catch {
        issues.push({
          severity: 'warn',
          message: 'Platform SDK not found',
          fix: 'Run `npm install` to install @eai-tools/platform-sdk',
        });
        out.warn('Platform SDK not found');
      }
    }

    // Summary
    out.blank();
    if (issues.length === 0) {
      out.success('No issues found. Your project is healthy!');
    } else {
      out.heading(`${issues.length} issue(s) found`);
      out.blank();
      for (const issue of issues) {
        const icon = issue.severity === 'error' ? out.symbols.error
          : issue.severity === 'warn' ? out.symbols.warning
          : out.symbols.info;
        out.info(`${icon} ${issue.message}`);
        if (issue.fix) {
          out.dim(`  Fix: ${issue.fix}`);
        }
      }
    }
  });
