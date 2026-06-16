/**
 * eai types — manage Object Type definitions.
 *
 * seed:     Push local Object Types to platform via PublicAPI
 * validate: Check types against platform schema rules
 * diff:     Compare local definitions with remote platform state
 * pull:     Download remote Object Types to local TypeScript
 * define:   Interactive Object Type builder (future)
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { findProjectRoot, loadObjectTypes, type ObjectTypeDefinition } from '../lib/config.js';
import { extractServerErrorContext, PlatformAPIClient } from '../lib/api.js';
import { resolveCommandContext } from '../lib/context.js';
import { validateObjectTypeDefaultValues } from '../lib/object-type-defaults.js';
import { isRecord, toObjectTypeSlug } from '../lib/utils.js';
import * as out from '../lib/output.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';

export interface TenantResolution {
  tenantId?: string;
  source: 'option' | 'active:tenant' | 'unresolved';
}

export interface TypeSeedVerificationResult {
  tenantId: string;
  requestedTypes: string[];
  matchedTypes: string[];
  missingTypes: string[];
  driftedTypes: string[];
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  converged: boolean;
}

export interface TypeSeedResult {
  tenantKey: string;
  tenantId: string;
  created: number;
  updated: number;
  failed: number;
  verification?: TypeSeedVerificationResult;
  publishingMode?: 'app-manifest' | 'direct-object-types';
  resourceApiSchemaSync?: Record<string, unknown>;
  appManifestFallbackReason?: string;
  error?: string;
}

interface RemoteObjectTypeDocument {
  id?: string;
  name: string;
  slug?: string;
  properties: unknown[];
  linkTypes: unknown[];
  actions: unknown[];
  storageBackend?: string;
  schemaVersion?: number;
  storageMetadataStatus?: string;
  storageBinding?: unknown;
  provisioningHints?: unknown;
  status?: string;
  publishedAt?: string | null;
}

export function shouldFailTypeSeedRun(
  results: Array<Pick<TypeSeedResult, 'verification' | 'resourceApiSchemaSync'>>,
): boolean {
  return results.some((result) => {
    const syncStatus = isRecord(result.resourceApiSchemaSync)
      ? result.resourceApiSchemaSync.status
      : undefined;
    return !result.verification?.converged || (typeof syncStatus === 'string' && syncStatus !== 'synced');
  });
}

export interface TypeDefaultValueValidationIssue {
  tenantKey: string;
  typeName: string;
  issue: string;
}

export interface TypeStorageValidationIssue {
  tenantKey: string;
  typeName: string;
  issue: string;
}

const VALID_STORAGE_BACKENDS = ['postgresql', 'documentdb', 'blob', 'search'] as const;
const VALID_STORAGE_METADATA_STATUSES = ['draft', 'ready'] as const;

export function collectTypeDefaultValueValidationIssues(
  objectTypes: Record<string, ObjectTypeDefinition[]>,
): TypeDefaultValueValidationIssue[] {
  return Object.entries(objectTypes).flatMap(([tenantKey, types]) => (
    types.flatMap((type) => (
      validateObjectTypeDefaultValues(type).map((issue) => ({
        tenantKey,
        typeName: type.name,
        issue,
      }))
    ))
  ));
}

function hasStorageValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

function getStorageBindingScope(binding: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(binding)) {
    return null;
  }

  const scope = binding[key];
  return isRecord(scope) ? scope : null;
}

function collectMissingStorageFields(
  scope: Record<string, unknown> | null,
  fields: string[],
): string[] {
  return fields.filter((field) => !hasStorageValue(scope?.[field]));
}

function formatStorageFieldIssue(label: string, missing: string[]): string {
  return `${label} is incomplete. Missing: ${missing.join(', ')}`;
}

export function validateObjectTypeStorageMetadata(type: ObjectTypeDefinition): string[] {
  const issues: string[] = [];
  const backend = type.storageBackend || 'postgresql';
  const storageMetadataStatus = type.storageMetadataStatus || 'draft';

  if (!VALID_STORAGE_BACKENDS.includes(backend as typeof VALID_STORAGE_BACKENDS[number])) {
    issues.push(`storageBackend "${backend}" must be one of: ${VALID_STORAGE_BACKENDS.join(', ')}`);
  }

  if (!VALID_STORAGE_METADATA_STATUSES.includes(storageMetadataStatus as typeof VALID_STORAGE_METADATA_STATUSES[number])) {
    issues.push(`storageMetadataStatus "${storageMetadataStatus}" must be one of: ${VALID_STORAGE_METADATA_STATUSES.join(', ')}`);
  }

  if (type.status === 'published' && storageMetadataStatus !== 'ready') {
    issues.push('published Object Types require storageMetadataStatus "ready"');
  }

  if (
    storageMetadataStatus !== 'ready'
    || !VALID_STORAGE_BACKENDS.includes(backend as typeof VALID_STORAGE_BACKENDS[number])
  ) {
    return issues;
  }

  if (!isRecord(type.storageBinding)) {
    issues.push('storageMetadataStatus "ready" requires storageBinding');
    return issues;
  }

  if (backend === 'postgresql') {
    const missing = collectMissingStorageFields(
      getStorageBindingScope(type.storageBinding, 'sql'),
      ['databaseAlias', 'tenantSchemaStrategy', 'tableName'],
    );
    if (missing.length > 0) {
      issues.push(formatStorageFieldIssue('PostgreSQL storageBinding', missing));
    }
  } else if (backend === 'documentdb') {
    const missing = collectMissingStorageFields(
      getStorageBindingScope(type.storageBinding, 'documentdb'),
      ['databaseAlias', 'databaseName', 'collectionName', 'partitionKey'],
    );
    if (missing.length > 0) {
      issues.push(formatStorageFieldIssue('DocumentDB storageBinding', missing));
    }
  } else if (backend === 'blob') {
    const missing = collectMissingStorageFields(
      getStorageBindingScope(type.storageBinding, 'blob'),
      ['storageAccountAlias', 'containerName'],
    );
    if (missing.length > 0) {
      issues.push(formatStorageFieldIssue('Blob storageBinding', missing));
    }
  } else if (backend === 'search') {
    const missing = collectMissingStorageFields(
      getStorageBindingScope(type.storageBinding, 'search'),
      ['searchServiceAlias'],
    );
    if (missing.length > 0) {
      issues.push(formatStorageFieldIssue('Search storageBinding', missing));
    }
  }

  return issues;
}

export function collectTypeStorageValidationIssues(
  objectTypes: Record<string, ObjectTypeDefinition[]>,
): TypeStorageValidationIssue[] {
  return Object.entries(objectTypes).flatMap(([tenantKey, types]) => (
    types.flatMap((type) => (
      validateObjectTypeStorageMetadata(type).map((issue) => ({
        tenantKey,
        typeName: type.name,
        issue,
      }))
    ))
  ));
}

export function resolveTenantIdForKey(
  tenantKey: string,
  explicitTenantId?: string,
  activeTenantId?: string,
): TenantResolution {
  if (explicitTenantId) {
    return { tenantId: explicitTenantId, source: 'option' };
  }

  if (activeTenantId) {
    return { tenantId: activeTenantId, source: 'active:tenant' };
  }

  return { source: 'unresolved' };
}

function describeTenantResolutionSource(source: TenantResolution['source']): string {
  switch (source) {
    case 'option':
      return 'CLI override';
    case 'active:tenant':
      return 'active tenant';
    default:
      return 'unresolved';
  }
}

function explainMissingTenantId(tenantKey: string): void {
  out.warn(`No active tenant is available for "${tenantKey}"`);
  out.info(`Run ${chalk.cyan('eai login')} and ${chalk.cyan('eai tenant select')} to choose the tenant to work with, or use ${chalk.cyan(`--tenant-key ${tenantKey} --tenant-id <uuid>`)}`);
}

export function resolveDefaultTenantKey(
  objectTypes: Record<string, ObjectTypeDefinition[]>,
  activeTenantSlug?: string,
): string | null {
  const keys = Object.keys(objectTypes);
  if (keys.length === 1) {
    return keys[0];
  }
  if (activeTenantSlug && objectTypes[activeTenantSlug]) {
    return activeTenantSlug;
  }
  if (objectTypes.template) {
    return 'template';
  }
  if (objectTypes.default) {
    return 'default';
  }
  return null;
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareRemoteDocs(a: RemoteObjectTypeDocument, b: RemoteObjectTypeDocument): number {
  const publishedDelta = toTimestamp(b.publishedAt) - toTimestamp(a.publishedAt);
  if (publishedDelta !== 0) {
    return publishedDelta;
  }

  const aSlug = typeof a.slug === 'string' ? a.slug : toObjectTypeSlug(a.name);
  const bSlug = typeof b.slug === 'string' ? b.slug : toObjectTypeSlug(b.name);
  return aSlug.localeCompare(bSlug) || a.name.localeCompare(b.name);
}

function matchesRequestedType(doc: RemoteObjectTypeDocument, requestedType: string): boolean {
  const requestedSlug = toObjectTypeSlug(requestedType);
  return (
    doc.name === requestedType
    || doc.slug === requestedSlug
    || toObjectTypeSlug(doc.name) === requestedSlug
  );
}

export function findMatchingRemoteTypes(
  remoteDocs: RemoteObjectTypeDocument[],
  requestedType: string,
): RemoteObjectTypeDocument[] {
  return remoteDocs
    .filter((doc) => matchesRequestedType(doc, requestedType))
    .sort(compareRemoteDocs);
}

function dedupeRemoteObjectTypeDocs(
  remoteDocs: RemoteObjectTypeDocument[],
): RemoteObjectTypeDocument[] {
  const bySlug = new Map<string, RemoteObjectTypeDocument>();

  for (const doc of remoteDocs) {
    const slug = typeof doc.slug === 'string' ? doc.slug : toObjectTypeSlug(doc.name);
    const existing = bySlug.get(slug);
    if (!existing || compareRemoteDocs(doc, existing) < 0) {
      bySlug.set(slug, doc);
    }
  }

  return Array.from(bySlug.values()).sort(compareRemoteDocs);
}

function extractRemoteTypeState(payload: unknown): {
  published: Set<string>;
  available: Set<string>;
} {
  const published = new Set<string>();
  const available = new Set<string>();

  const mark = (value: unknown, isPublished: boolean): void => {
    if (!isRecord(value) || typeof value.name !== 'string') {
      return;
    }

    const slug = typeof value.slug === 'string' ? value.slug : toObjectTypeSlug(value.name);
    available.add(slug);
    if (isPublished) {
      published.add(slug);
    }
  };

  if (isRecord(payload) && Array.isArray(payload.objectTypes)) {
    payload.objectTypes.forEach((value) => mark(value, true));
    return { published, available };
  }

  if (isRecord(payload) && Array.isArray(payload.object_types)) {
    payload.object_types.forEach((value) => mark(value, true));
    return { published, available };
  }

  if (isRecord(payload) && Array.isArray(payload.docs)) {
    dedupeRemoteObjectTypeDocs(extractRemoteObjectTypeDocs(payload)).forEach((value) => {
      const publishedState = value.status === 'published'
        || value.publishedAt !== null && value.publishedAt !== undefined;
      mark(value, publishedState);
    });
  }

  return { published, available };
}

function extractRemoteObjectTypeDocs(payload: unknown): RemoteObjectTypeDocument[] {
  if (!isRecord(payload) || !Array.isArray(payload.docs)) {
    return [];
  }

  return payload.docs
    .filter((value): value is RemoteObjectTypeDocument => isRecord(value) && typeof value.name === 'string')
    .map((value) => ({
      id: typeof value.id === 'string' ? value.id : undefined,
      name: value.name,
      slug: typeof value.slug === 'string' ? value.slug : undefined,
      properties: Array.isArray(value.properties) ? value.properties : [],
      linkTypes: Array.isArray(value.linkTypes) ? value.linkTypes : [],
      actions: Array.isArray(value.actions) ? value.actions : [],
      storageBackend: typeof value.storageBackend === 'string' ? value.storageBackend : undefined,
      schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : undefined,
      storageMetadataStatus: typeof value.storageMetadataStatus === 'string' ? value.storageMetadataStatus : undefined,
      storageBinding: isRecord(value.storageBinding) ? value.storageBinding : undefined,
      provisioningHints: isRecord(value.provisioningHints) ? value.provisioningHints : undefined,
      status: typeof value.status === 'string' ? value.status : undefined,
      publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : null,
    }))
    .sort(compareRemoteDocs);
}

function findMatchingRemoteType(
  remoteDocs: RemoteObjectTypeDocument[],
  requestedType: string,
): RemoteObjectTypeDocument | undefined {
  return findMatchingRemoteTypes(remoteDocs, requestedType)[0];
}

export async function describeFailedPlatformResponse(response: Response): Promise<string> {
  const context = await extractServerErrorContext(response);
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const detail = (context.serverMessage ?? context.rawBody).trim();

  if (!detail) {
    return status;
  }

  const truncatedDetail = detail.length > 500 ? `${detail.slice(0, 497)}...` : detail;
  const code = context.serverCode ? `[${context.serverCode}] ` : '';
  const requestId = context.requestId ? ` (request ${context.requestId})` : '';

  return `${status} - ${code}${truncatedDetail}${requestId}`;
}

async function archiveDuplicateRemoteTypes(
  client: PlatformAPIClient,
  duplicates: RemoteObjectTypeDocument[],
): Promise<number> {
  let archived = 0;

  for (const duplicate of duplicates) {
    if (!duplicate.id) {
      continue;
    }

    const response = await client.updateObjectType(duplicate.id, {
      status: 'draft',
    });

    if (!response.ok) {
      throw new Error(`archive failed: ${await describeFailedPlatformResponse(response)}`);
    }

    archived++;
  }

  return archived;
}

export async function appObjectTypePublishFallbackReason(
  response: Response,
  phase: 'save' | 'publish',
): Promise<string | null> {
  if (response.status === 404 || response.status === 405) {
    return `app object-type manifest ${phase} route unavailable`;
  }
  return null;
}

export function toAppManifestObjectTypes(types: ObjectTypeDefinition[]): Record<string, unknown>[] {
  return types.map((type) => ({
    ...type,
    status: type.status ?? 'published',
  }));
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readTypeSeedVerification(
  tenantId: string,
  requestedTypes: string[],
  value: unknown,
  counts: { createdCount: number; updatedCount: number; failedCount: number },
): TypeSeedVerificationResult {
  if (!isRecord(value)) {
    return {
      tenantId,
      requestedTypes,
      matchedTypes: [],
      missingTypes: requestedTypes,
      driftedTypes: [],
      ...counts,
      converged: false,
    };
  }

  return {
    tenantId: typeof value.tenantId === 'string' ? value.tenantId : tenantId,
    requestedTypes: readStringArray(value.requestedTypes),
    matchedTypes: readStringArray(value.matchedTypes),
    missingTypes: readStringArray(value.missingTypes),
    driftedTypes: readStringArray(value.driftedTypes),
    createdCount: typeof value.createdCount === 'number' ? value.createdCount : counts.createdCount,
    updatedCount: typeof value.updatedCount === 'number' ? value.updatedCount : counts.updatedCount,
    failedCount: typeof value.failedCount === 'number' ? value.failedCount : counts.failedCount,
    converged: value.converged === true,
  };
}

export function summarizeAppObjectTypePublish(
  tenantKey: string,
  tenantId: string,
  types: ObjectTypeDefinition[],
  payload: unknown,
): TypeSeedResult {
  const body = isRecord(payload) ? payload : {};
  const results = Array.isArray(body.results) ? body.results.filter(isRecord) : [];
  const created = results.filter((result) => result.status === 'created').length;
  const updated = results.filter((result) => result.status === 'updated').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const counts = {
    createdCount: created,
    updatedCount: updated,
    failedCount: failed,
  };

  return {
    tenantKey,
    tenantId,
    created,
    updated,
    failed,
    verification: readTypeSeedVerification(tenantId, types.map((type) => type.name), body.verification, counts),
    publishingMode: 'app-manifest',
    resourceApiSchemaSync: isRecord(body.resourceApiSchemaSync) ? body.resourceApiSchemaSync : undefined,
  };
}

export async function trySeedViaAppManifestPublish(
  client: PlatformAPIClient,
  tenantKey: string,
  tenantId: string,
  types: ObjectTypeDefinition[],
): Promise<{ result?: TypeSeedResult; fallbackReason?: string }> {
  const manifestResponse = await client.saveAppObjectTypeManifest(
    tenantKey,
    toAppManifestObjectTypes(types),
  );
  const manifestFallbackReason = await appObjectTypePublishFallbackReason(manifestResponse, 'save');
  if (manifestFallbackReason) {
    return { fallbackReason: manifestFallbackReason };
  }
  if (!manifestResponse.ok) {
    throw new Error(`app manifest save failed: ${await describeFailedPlatformResponse(manifestResponse)}`);
  }

  const publishResponse = await client.publishAppObjectTypes(tenantKey);
  const publishFallbackReason = await appObjectTypePublishFallbackReason(publishResponse, 'publish');
  if (publishFallbackReason) {
    return { fallbackReason: publishFallbackReason };
  }
  if (!publishResponse.ok) {
    throw new Error(`app manifest publish failed: ${await describeFailedPlatformResponse(publishResponse)}`);
  }

  const result = summarizeAppObjectTypePublish(tenantKey, tenantId, types, await publishResponse.json());
  if (result.verification?.converged) {
    result.resourceApiSchemaSync = await summarizeResourceApiSchemaSync(
      await client.syncStorageSchema({
        dryRun: false,
        objectTypes: types.map((type) => toObjectTypeSlug(type.name)),
      }),
    );
  }

  return { result };
}

export async function summarizeResourceApiSchemaSync(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    return {
      status: 'failed',
      error: await describeFailedPlatformResponse(response),
    };
  }

  const payload = await response.json() as unknown;
  const results = isRecord(payload) && Array.isArray(payload.results) ? payload.results.filter(isRecord) : [];
  const failedResults = results.filter((result) => result.status === 'failed');
  return {
    ...(isRecord(payload) ? payload : {}),
    status: failedResults.length > 0 ? 'failed' : 'synced',
  };
}

export function verifyTypeSeedConvergence(
  tenantId: string,
  requestedTypes: string[],
  payload: unknown,
  counts: {
    createdCount: number;
    updatedCount: number;
    failedCount: number;
  },
): TypeSeedVerificationResult {
  const remote = extractRemoteTypeState(payload);
  const matchedTypes: string[] = [];
  const missingTypes: string[] = [];
  const driftedTypes: string[] = [];

  for (const requestedType of requestedTypes) {
    const slug = toObjectTypeSlug(requestedType);
    if (remote.published.has(slug)) {
      matchedTypes.push(requestedType);
    } else if (remote.available.has(slug)) {
      driftedTypes.push(requestedType);
    } else {
      missingTypes.push(requestedType);
    }
  }

  return {
    tenantId,
    requestedTypes,
    matchedTypes,
    missingTypes,
    driftedTypes,
    createdCount: counts.createdCount,
    updatedCount: counts.updatedCount,
    failedCount: counts.failedCount,
    converged: counts.failedCount === 0 && missingTypes.length === 0 && driftedTypes.length === 0,
  };
}

export async function verifyTypeSeedConvergenceWithRetry(
  client: PlatformAPIClient,
  tenantId: string,
  requestedTypes: string[],
  counts: {
    createdCount: number;
    updatedCount: number;
    failedCount: number;
  },
  options?: {
    attempts?: number;
    delayMs?: number;
  },
): Promise<TypeSeedVerificationResult> {
  const attempts = Math.max(options?.attempts ?? 60, 1);
  const delayMs = Math.max(options?.delayMs ?? 1000, 0);

  let lastVerification: TypeSeedVerificationResult | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (typeof client.getPublishedObjectTypes === 'function') {
      const publishedResponse = await client.getPublishedObjectTypes({
        limit: Math.max(requestedTypes.length, 20),
      });
      if (!publishedResponse.ok) {
        throw new Error(`published type re-fetch failed: ${publishedResponse.status} ${publishedResponse.statusText}`);
      }

      const publishedPayload = await publishedResponse.json() as unknown;
      let publishedVerification = verifyTypeSeedConvergence(
        tenantId,
        requestedTypes,
        publishedPayload,
        counts,
      );

      if (!publishedVerification.converged && publishedVerification.failedCount === 0) {
        const preciseDocs: RemoteObjectTypeDocument[] = [];
        for (const requestedType of requestedTypes) {
          const preciseResponse = await client.getPublishedObjectTypes({
            name: requestedType,
            limit: 10,
          });
          if (!preciseResponse.ok) {
            throw new Error(`published type re-fetch failed for ${requestedType}: ${preciseResponse.status} ${preciseResponse.statusText}`);
          }
          preciseDocs.push(...extractRemoteObjectTypeDocs(await preciseResponse.json() as unknown));
        }

        const preciseVerification = verifyTypeSeedConvergence(
          tenantId,
          requestedTypes,
          { docs: preciseDocs },
          counts,
        );
        if (
          preciseVerification.converged
          || preciseVerification.matchedTypes.length > publishedVerification.matchedTypes.length
        ) {
          publishedVerification = preciseVerification;
        }
      }

      lastVerification = publishedVerification;
      if (publishedVerification.converged || publishedVerification.failedCount > 0) {
        return publishedVerification;
      }

      if (
        attempt < attempts
      ) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
    }

    const schemaResponse = await client.getSchema();
    if (!schemaResponse.ok) {
      throw new Error(`schema re-fetch failed: ${schemaResponse.status} ${schemaResponse.statusText}`);
    }

    const schemaPayload = await schemaResponse.json() as unknown;
    const verification = verifyTypeSeedConvergence(
      tenantId,
      requestedTypes,
      schemaPayload,
      counts,
    );

    lastVerification = verification;
    if (
      verification.converged
      || verification.failedCount > 0
      || attempt === attempts
    ) {
      return verification;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (lastVerification) {
    return lastVerification;
  }

  throw new Error('schema verification did not produce a result');
}

async function selectTenantKey(
  objectTypes: Record<string, ObjectTypeDefinition[]>,
  explicitTenantKey?: string,
  activeTenantSlug?: string,
): Promise<string[]> {
  if (explicitTenantKey) {
    return [explicitTenantKey];
  }

  const defaultKey = resolveDefaultTenantKey(objectTypes, activeTenantSlug);
  if (defaultKey) {
    return [defaultKey];
  }

  const keys = Object.keys(objectTypes);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    exitWithError(ErrorCode.E303, { field: '--tenant-key' });
  }

  const { tenantKey } = await inquirer.prompt([{
    type: 'list',
    name: 'tenantKey',
    message: 'Select the local object-type scope to publish or diff',
    choices: keys.map((key) => ({
      name: key,
      value: key,
    })),
  }]);

  return [tenantKey as string];
}

export const typesCommand = new Command('types')
  .description('Manage Object Type definitions')
  .addHelpText('after', `
Workflow:
  1. Validate local definitions:
       eai types validate
  2. Login and select the active tenant:
       eai login
       eai tenant select
  3. Preview remote differences:
       eai types diff --tenant-key <key>
  4. Publish:
       eai types seed --tenant-key <key>
  5. Verify published schema:
       eai resources schema
  `);

// ─── eai types seed ────────────────────────────────────────────────────────

typesCommand
  .command('seed')
  .description('Push Object Types to platform')
  .option('--env <label>', 'Optional deployment label for compatibility')
  .option('--tenant-key <key>', 'Specific tenant key from object-types.ts')
  .option('--tenant-id <id>', 'Override the resolved tenant ID (use with --tenant-key)')
  .option('--dry-run', 'Show what would be seeded without making changes', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai types seed
  $ eai types seed --dry-run
  $ eai types seed --tenant-key trial-portal
  $ eai types seed --tenant-key template --tenant-id 00000000-0000-4000-8000-000000000000
  $ eai types seed --format json | jq
  `)
  .action(async (options) => {
    // Backward compatibility: --json maps to --format json
    if (options.json) {
      options.format = 'json';
    }

    const ctx = await resolveCommandContext({ tenantId: options.tenantId });
    const { root, publicApiUrl, activeTenant: activeContextTenant } = ctx;
    // Wrap in shape expected by downstream helpers
    const activeContext = { activeTenant: activeContextTenant };

    const spinner = options.format === 'json' ? null : ora('Loading Object Types...').start();

    let objectTypes: Record<string, ObjectTypeDefinition[]>;
    try {
      objectTypes = await loadObjectTypes(root);
      const totalTypes = Object.values(objectTypes).reduce((sum, types) => sum + types.length, 0);
      const tenantKeys = Object.keys(objectTypes);
      if (spinner) {
        spinner.succeed(`Found ${totalTypes} types across ${tenantKeys.length} tenant scope(s): ${tenantKeys.join(', ')}`);
      }
    } catch (err) {
      if (spinner) spinner.fail('Failed to load Object Types');
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    if (options.tenantId && !options.tenantKey && Object.keys(objectTypes).length > 1) {
      exitWithError(ErrorCode.E303, { field: '--tenant-key when using --tenant-id with multiple tenant scopes' }, options.format);
    }

    const defaultValueIssues = collectTypeDefaultValueValidationIssues(objectTypes);
    if (defaultValueIssues.length > 0) {
      if (options.format === 'json') {
        out.json({
          error: 'Object Type defaultValue validation failed',
          issues: defaultValueIssues,
        });
      } else {
        out.error('Object Type defaultValue validation failed');
        for (const issue of defaultValueIssues) {
          out.error(`  [${issue.tenantKey}/${issue.typeName}] ${issue.issue}`);
        }
      }
      process.exit(1);
    }

    const storageIssues = collectTypeStorageValidationIssues(objectTypes);
    if (storageIssues.length > 0) {
      if (options.format === 'json') {
        out.json({
          error: 'Object Type storage metadata validation failed',
          issues: storageIssues,
        });
      } else {
        out.error('Object Type storage metadata validation failed');
        for (const issue of storageIssues) {
          out.error(`  [${issue.tenantKey}/${issue.typeName}] ${issue.issue}`);
        }
      }
      process.exit(1);
    }

    // Filter to specific tenant key if requested
    const keysToSeed = await selectTenantKey(objectTypes, options.tenantKey, activeContext.activeTenant.slug);

    if (options.format !== 'json') {
      out.blank();
    }

    const jsonResults: TypeSeedResult[] = [];

    for (const tenantKey of keysToSeed) {
      const types = objectTypes[tenantKey];
      if (!types || types.length === 0) {
        if (options.format !== 'json') {
          out.warn(`No types for tenant key "${tenantKey}"`);
        }
        continue;
      }

      // Resolve tenant ID
      const resolution = resolveTenantIdForKey(tenantKey, options.tenantId, activeContext.activeTenant.id);
      const tenantId = resolution.tenantId;

      if (!tenantId) {
        explainMissingTenantId(tenantKey);
        continue;
      }

      if (options.format !== 'json') {
        out.heading(`Tenant: ${tenantKey} → ${chalk.dim(tenantId)} ${chalk.dim(`(${describeTenantResolutionSource(resolution.source)})`)}`);
      }

      if (options.dryRun) {
        if (options.format !== 'json') {
          for (const type of types) {
            out.info(`Would publish: ${chalk.cyan(type.name)}`);
          }
          out.info('Dry run — no changes made');
        }
        continue;
      }

      const client = new PlatformAPIClient(publicApiUrl, tenantId);
      let created = 0, updated = 0, failed = 0;
      let remoteDocs: RemoteObjectTypeDocument[] = [];
      let appManifestFallbackReason: string | undefined;

      try {
        const appPublishOutcome = await trySeedViaAppManifestPublish(client, tenantKey, tenantId, types);
        if (appPublishOutcome.result) {
          if (options.format !== 'json') {
            out.success('Published via app object-type manifest');
            out.info(`Result: ${chalk.green(`${appPublishOutcome.result.created} created`)}, ${chalk.cyan(`${appPublishOutcome.result.updated} updated`)}, ${chalk.red(`${appPublishOutcome.result.failed} failed`)}`);
            const verification = appPublishOutcome.result.verification;
            if (verification?.converged) {
              out.success(`Verification: converged (${verification.matchedTypes.length}/${verification.requestedTypes.length} published remotely)`);
            } else if (verification) {
              const issues = [
                verification.missingTypes.length > 0 ? `${verification.missingTypes.length} missing` : null,
                verification.driftedTypes.length > 0 ? `${verification.driftedTypes.length} drifted` : null,
                verification.failedCount > 0 ? `${verification.failedCount} failed writes` : null,
              ].filter(Boolean).join(', ');
              out.warn(`Verification: partial (${issues || 'remote schema did not converge'})`);
            }
            const syncStatus = appPublishOutcome.result.resourceApiSchemaSync?.status;
            if (typeof syncStatus === 'string' && syncStatus) {
              out.info(`ResourceAPI schema sync: ${chalk.cyan(syncStatus)}`);
            }
            out.blank();
          }
          jsonResults.push(appPublishOutcome.result);
          continue;
        }

        appManifestFallbackReason = appPublishOutcome.fallbackReason;
        if (options.format !== 'json') {
          out.warn(`${appManifestFallbackReason ?? 'App manifest publish unavailable'}; falling back to direct Object Type writes.`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (options.format !== 'json') {
          out.error(message);
        }
        jsonResults.push({
          tenantKey,
          tenantId,
          created: 0,
          updated: 0,
          failed: types.length,
          publishingMode: 'app-manifest',
          error: message,
          verification: {
            tenantId,
            requestedTypes: types.map((type) => type.name),
            matchedTypes: [],
            missingTypes: types.map((type) => type.name),
            driftedTypes: [],
            createdCount: 0,
            updatedCount: 0,
            failedCount: types.length,
            converged: false,
          },
        });
        continue;
      }

      try {
        const remoteRes = await client.getPublishedObjectTypes({ limit: 200 });
        if (!remoteRes.ok) {
          throw new Error(`remote lookup failed: ${await describeFailedPlatformResponse(remoteRes)}`);
        }
        remoteDocs = extractRemoteObjectTypeDocs(await remoteRes.json());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (options.format !== 'json') {
          out.warn(`Pre-flight lookup failed: ${message}`);
        }
      }

      for (const type of types) {
        const typeSpinner = options.format === 'json' ? null : ora(`  ${type.name}`).start();

        try {
          const matches = findMatchingRemoteTypes(remoteDocs, type.name);
          const existing = matches[0];
          const duplicates = matches.slice(1).filter((doc) => doc.id);

          if (duplicates.length > 0) {
            const archivedCount = await archiveDuplicateRemoteTypes(client, duplicates);
            if (archivedCount > 0) {
              remoteDocs = remoteDocs.filter((doc) => !duplicates.some((duplicate) => duplicate.id === doc.id));
            }
          }

          if (existing?.id) {
            // Update
            const updateRes = await client.updateObjectType(existing.id, {
              name: type.name,
              slug: toObjectTypeSlug(type.name),
              tenant: tenantId,
              displayName: type.displayName,
              description: type.description,
              properties: type.properties,
              linkTypes: type.linkTypes,
              actions: type.actions,
              storageBackend: type.storageBackend,
              schemaVersion: type.schemaVersion,
              storageMetadataStatus: type.storageMetadataStatus,
              storageBinding: type.storageBinding,
              provisioningHints: type.provisioningHints,
              status: type.status,
            });

            if (updateRes.ok) {
              const archivedSuffix = duplicates.length > 0
                ? chalk.dim(` + archived ${duplicates.length} duplicate${duplicates.length === 1 ? '' : 's'}`)
                : '';
              if (typeSpinner) {
                typeSpinner.succeed(`  ${type.name} ${chalk.cyan('(updated)')}${archivedSuffix}`);
              }
              updated++;
              remoteDocs = remoteDocs.map((doc) => (
                doc.id === existing.id
                  ? {
                      ...doc,
                      name: type.name,
                      slug: toObjectTypeSlug(type.name),
                      properties: type.properties,
                      linkTypes: type.linkTypes,
                      actions: type.actions,
                      storageBackend: type.storageBackend,
                      schemaVersion: type.schemaVersion,
                      storageMetadataStatus: type.storageMetadataStatus,
                      storageBinding: type.storageBinding,
                      provisioningHints: type.provisioningHints,
                      status: type.status,
                    }
                  : doc
              ));
            } else {
              if (typeSpinner) {
                typeSpinner.fail(`  ${type.name} — update failed: ${await describeFailedPlatformResponse(updateRes)}`);
              }
              failed++;
            }
          } else {
            // Create
            const createRes = await client.createObjectType({
              name: type.name,
              slug: toObjectTypeSlug(type.name),
              displayName: type.displayName,
              description: type.description,
              properties: type.properties,
              linkTypes: type.linkTypes,
              actions: type.actions,
              storageBackend: type.storageBackend,
              schemaVersion: type.schemaVersion,
              storageMetadataStatus: type.storageMetadataStatus,
              storageBinding: type.storageBinding,
              provisioningHints: type.provisioningHints,
              status: type.status,
              tenant: tenantId,
            });

            if (createRes.ok) {
              const archivedSuffix = duplicates.length > 0
                ? chalk.dim(` + archived ${duplicates.length} duplicate${duplicates.length === 1 ? '' : 's'}`)
                : '';
              if (typeSpinner) {
                typeSpinner.succeed(`  ${type.name} ${chalk.green('(created)')}${archivedSuffix}`);
              }
              created++;
              remoteDocs.push({
                name: type.name,
                slug: toObjectTypeSlug(type.name),
                properties: type.properties,
                linkTypes: type.linkTypes,
                actions: type.actions,
                storageBackend: type.storageBackend,
                schemaVersion: type.schemaVersion,
                storageMetadataStatus: type.storageMetadataStatus,
                storageBinding: type.storageBinding,
                provisioningHints: type.provisioningHints,
                status: type.status,
              });
            } else {
              if (typeSpinner) {
                typeSpinner.fail(`  ${type.name} — create failed: ${await describeFailedPlatformResponse(createRes)}`);
              }
              failed++;
            }
          }
        } catch (err) {
          if (typeSpinner) {
            typeSpinner.fail(`  ${type.name} — ${err instanceof Error ? err.message : String(err)}`);
          }
          failed++;
        }
      }

      if (options.format !== 'json') {
        out.blank();
      }
      let verification: TypeSeedVerificationResult | undefined;
      let resourceApiSchemaSync: Record<string, unknown> | undefined;
      try {
        verification = await verifyTypeSeedConvergenceWithRetry(
          client,
          tenantId,
          types.map((type) => type.name),
          {
            createdCount: created,
            updatedCount: updated,
            failedCount: failed,
          },
          {
            attempts: failed > 0 ? 1 : 6,
            delayMs: 1000,
          },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        verification = {
          tenantId,
          requestedTypes: types.map((type) => type.name),
          matchedTypes: [],
          missingTypes: types.map((type) => type.name),
          driftedTypes: [],
          createdCount: created,
          updatedCount: updated,
          failedCount: failed,
          converged: false,
        };
        if (options.format !== 'json') {
          out.warn(`Verification: ${message}`);
        }
      }

      if (verification.converged) {
        resourceApiSchemaSync = await summarizeResourceApiSchemaSync(
          await client.syncStorageSchema({
            dryRun: false,
            objectTypes: types.map((type) => toObjectTypeSlug(type.name)),
          }),
        );
      }

      if (options.format !== 'json') {
        out.info(`Result: ${chalk.green(`${created} created`)}, ${chalk.cyan(`${updated} updated`)}, ${chalk.red(`${failed} failed`)}`);
        if (verification.converged) {
          out.success(`Verification: converged (${verification.matchedTypes.length}/${verification.requestedTypes.length} published remotely)`);
        } else {
          const issues = [
            verification.missingTypes.length > 0 ? `${verification.missingTypes.length} missing` : null,
            verification.driftedTypes.length > 0 ? `${verification.driftedTypes.length} drifted` : null,
            verification.failedCount > 0 ? `${verification.failedCount} failed writes` : null,
          ].filter(Boolean).join(', ');
          out.warn(`Verification: partial (${issues || 'remote schema did not converge'})`);
        }
        const syncStatus = resourceApiSchemaSync?.status;
        if (typeof syncStatus === 'string' && syncStatus) {
          const line = `ResourceAPI schema sync: ${chalk.cyan(syncStatus)}`;
          if (syncStatus === 'failed') {
            out.warn(line);
          } else {
            out.info(line);
          }
        }
      }
      jsonResults.push({
        tenantKey,
        tenantId: tenantId!,
        created,
        updated,
        failed,
        verification,
        publishingMode: 'direct-object-types',
        resourceApiSchemaSync,
        appManifestFallbackReason,
      });
    }

    if (options.format === 'json') {
      out.json({ tenants: jsonResults });
    }

    if (shouldFailTypeSeedRun(jsonResults)) {
      process.exitCode = 1;
    }
  });

// ─── eai types validate ────────────────────────────────────────────────────

typesCommand
  .command('validate')
  .description('Validate Object Types against platform schema rules')
  .addHelpText('after', `
Examples:
  $ eai types validate
  `)
  .action(async () => {
    const root = await findProjectRoot();
    if (!root) {
      exitWithError(ErrorCode.E001);
    }

    const spinner = ora('Loading Object Types...').start();

    let objectTypes: Record<string, ObjectTypeDefinition[]>;
    try {
      objectTypes = await loadObjectTypes(root);
      spinner.succeed('Loaded Object Types');
    } catch (err) {
      spinner.fail('Failed to load Object Types');
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    let errors = 0;
    let warnings = 0;

    for (const [tenantKey, types] of Object.entries(objectTypes)) {
      out.heading(`Tenant: ${tenantKey}`);

      for (const type of types) {
        const issues: string[] = [];
        const warns: string[] = [];

        // Name must be PascalCase
        if (!/^[A-Z][a-zA-Z0-9]*$/.test(type.name)) {
          issues.push(`name "${type.name}" must be PascalCase`);
        }

        // Must have displayName
        if (!type.displayName) {
          issues.push('missing displayName');
        }

        // Status must be valid
        if (!['draft', 'published', 'deprecated'].includes(type.status)) {
          issues.push(`invalid status "${type.status}"`);
        }

        // Validate properties
        const propNames = new Set<string>();
        const validTypes = ['text', 'number', 'boolean', 'date', 'select', 'json', 'file', 'relationship'];

        for (const prop of type.properties) {
          if (propNames.has(prop.name)) {
            issues.push(`duplicate property name "${prop.name}"`);
          }
          propNames.add(prop.name);

          if (!validTypes.includes(prop.type)) {
            issues.push(`property "${prop.name}" has invalid type "${prop.type}"`);
          }

          if (prop.type === 'select' && (!prop.options || prop.options.length === 0)) {
            issues.push(`select property "${prop.name}" must have options`);
          }

          if (prop.type !== 'select' && prop.options && prop.options.length > 0) {
            warns.push(`property "${prop.name}" has options but type is "${prop.type}" (not select)`);
          }
        }

        issues.push(...validateObjectTypeDefaultValues(type));
        issues.push(...validateObjectTypeStorageMetadata(type));

        // Validate link types
        for (const link of type.linkTypes) {
          if (!link.targetObjectType) {
            issues.push(`link "${link.name}" missing targetObjectType`);
          }
          if (!['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'].includes(link.cardinality)) {
            issues.push(`link "${link.name}" has invalid cardinality "${link.cardinality}"`);
          }
        }

        // Validate actions
        for (const action of type.actions) {
          if (!action.name) {
            issues.push('action missing name');
          }
          if (!['tenant-viewer', 'tenant-builder', 'tenant-admin'].includes(action.requiredRole)) {
            issues.push(`action "${action.name}" has invalid requiredRole "${action.requiredRole}"`);
          }
          for (const effect of action.sideEffects) {
            if (!['set_field', 'set_timestamp', 'set_user'].includes(effect.type)) {
              issues.push(`action "${action.name}" side effect has invalid type "${effect.type}"`);
            }
            if (effect.type === 'set_field' && !propNames.has(effect.field)) {
              warns.push(`action "${action.name}" side effect references unknown field "${effect.field}"`);
            }
          }
        }

        // Print results
        if (issues.length === 0 && warns.length === 0) {
          out.success(`${type.name} — ${type.properties.length} props, ${type.linkTypes.length} links, ${type.actions.length} actions`);
        } else {
          if (issues.length > 0) {
            out.error(`${type.name}`);
            for (const issue of issues) {
              out.error(`  ${issue}`);
            }
            errors += issues.length;
          }
          if (warns.length > 0) {
            if (issues.length === 0) out.warn(`${type.name}`);
            for (const w of warns) {
              out.warn(`  ${w}`);
            }
            warnings += warns.length;
          }
        }
      }
    }

    out.blank();
    if (errors > 0) {
      exitWithError(ErrorCode.E302, { details: `${errors} validation error(s), ${warnings} warning(s)` });
    } else if (warnings > 0) {
      out.warn(`${warnings} warning(s), 0 errors`);
    } else {
      out.success('All Object Types are valid');
    }
  });

// ─── eai types diff ────────────────────────────────────────────────────────

typesCommand
  .command('diff')
  .description('Compare local Object Types with remote platform')
  .option('--tenant-key <key>', 'Specific tenant key from object-types.ts')
  .option('--tenant-id <id>', 'Override the resolved tenant ID (use with --tenant-key)')
  .addHelpText('after', `
Examples:
  $ eai types diff
  $ eai types diff --tenant-key council --tenant-id 423b7e9c-9a69-4763-5b9a-69570218f65d
  `)
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId });
    const { root, publicApiUrl } = ctx;
    const activeContext = options.tenantId ? null : ctx;

    const spinner = ora('Loading local Object Types...').start();

    let objectTypes: Record<string, ObjectTypeDefinition[]>;
    try {
      objectTypes = await loadObjectTypes(root);
      spinner.succeed('Loaded local types');
    } catch (err) {
      spinner.fail('Failed to load local types');
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const keysToDiff = await selectTenantKey(
      objectTypes,
      options.tenantKey,
      activeContext?.activeTenant.slug,
    );
    const entries = keysToDiff
      .map((key) => [key, objectTypes[key] as ObjectTypeDefinition[] | undefined] as const);

    if (options.tenantId && !options.tenantKey && Object.keys(objectTypes).length > 1) {
      exitWithError(ErrorCode.E303, { field: '--tenant-key when using --tenant-id with multiple tenant scopes' });
    }

    for (const [tenantKey, localTypes] of entries) {
      if (!localTypes || localTypes.length === 0) {
        out.warn(`No local Object Types found for "${tenantKey}"`);
        continue;
      }

      const resolution = resolveTenantIdForKey(
        tenantKey,
        options.tenantId,
        activeContext?.activeTenant.id,
      );
      const tenantId = resolution.tenantId;
      if (!tenantId) {
        explainMissingTenantId(tenantKey);
        continue;
      }

      out.heading(`Tenant: ${tenantKey} → ${chalk.dim(tenantId)} ${chalk.dim(`(${describeTenantResolutionSource(resolution.source)})`)}`);

      const client = new PlatformAPIClient(publicApiUrl, tenantId);
      const remoteSpinner = ora('  Fetching remote types...').start();

      try {
        const res = await client.getPublishedObjectTypes({ limit: 100 });

        const remoteDocs = extractRemoteObjectTypeDocs(await res.json());
        remoteSpinner.succeed(`  ${remoteDocs.length} remote types`);

        const matchedRemoteNames = new Set<string>();

        // Local-only types
        for (const localType of localTypes) {
          const remote = findMatchingRemoteType(remoteDocs, localType.name);
          if (!remote) {
            out.info(`  ${out.symbols.added} ${localType.name} — local only`);
            continue;
          }

          matchedRemoteNames.add(remote.name);
          const localPropNames = new Set(localType.properties.map(p => p.name));
          const remotePropNames = new Set((remote.properties as Array<{ name: string }>).map(p => p.name));

          const added = [...localPropNames].filter(p => !remotePropNames.has(p));
          const removed = [...remotePropNames].filter(p => !localPropNames.has(p));
          const unchanged = [...localPropNames].filter(p => remotePropNames.has(p));

          if (added.length === 0 && removed.length === 0) {
            out.info(`  ${out.symbols.unchanged} ${localType.name} — no changes`);
          } else {
            out.info(`  ${out.symbols.changed} ${localType.name}`);
            for (const p of added) {
              out.info(`    ${out.symbols.added} ${p}`);
            }
            for (const p of removed) {
              out.info(`    ${out.symbols.removed} ${p}`);
            }
            if (unchanged.length > 0) {
              out.dim(`    ${unchanged.length} unchanged`);
            }
          }
        }

        // Remote-only types
        for (const remote of remoteDocs) {
          if (!matchedRemoteNames.has(remote.name)) {
            out.warn(`  ${out.symbols.warning} ${remote.name} — exists remotely but not locally`);
          }
        }
      } catch (err) {
        remoteSpinner.fail('  Failed to fetch remote types');
        out.error(err instanceof Error ? err.message : String(err));
      }
    }
  });

// ─── eai types pull ────────────────────────────────────────────────────────

typesCommand
  .command('pull')
  .description('Download remote Object Types to local TypeScript')
  .option('--tenant-id <id>', 'platform tenant ID')
  .option('--output <path>', 'Output file path', 'src/eai.config/object-types.generated.ts')
  .addHelpText('after', `
Examples:
  $ eai types pull
  $ eai types pull --output src/types/generated.ts
  `)
  .action(async (options) => {
    const ctx = await resolveCommandContext({ tenantId: options.tenantId });

    const spinner = ora('Fetching remote Object Types...').start();

    try {
      const { client, tenantId, root } = ctx;
      const res = await client.getPublishedObjectTypes({ limit: 100 });

      const data = await res.json() as { docs?: ObjectTypeDefinition[] };
      const types = data?.docs || [];
      spinner.succeed(`Found ${types.length} remote types`);

      // Generate TypeScript
      const ts = generateTypeScript(types, tenantId);
      const { writeFile: write } = await import('node:fs/promises');
      const { join: pathJoin } = await import('node:path');
      const outputPath = pathJoin(root, options.output);
      await write(outputPath, ts, 'utf-8');

      out.success(`Written to ${chalk.bold(options.output)}`);
      out.info('Review the generated file and merge into object-types.ts');
    } catch (err) {
      spinner.fail('Failed to pull types');
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai types define ──────────────────────────────────────────────────────

typesCommand
  .command('define')
  .description('Interactive Object Type builder (coming soon)')
  .action(async () => {
    out.info('Interactive Object Type builder is planned for Phase 3.');
    out.info('For now, edit src/eai.config/object-types.ts directly.');
    out.info('See the Object Types Guide in CLAUDE.md for the schema format.');
  });

// ─── Helpers ───────────────────────────────────────────────────────────────

function generateTypeScript(types: ObjectTypeDefinition[], tenantKey: string): string {
  const lines: string[] = [
    '/**',
    ' * Object Types — auto-generated by `eai types pull`',
    ` * Generated: ${new Date().toISOString()}`,
    ' *',
    ' * Review and merge into object-types.ts.',
    ' */',
    '',
    'import type { ObjectTypeDefinition } from \'./object-types\';',
    '',
    `export const pulledTypes: Record<string, ObjectTypeDefinition[]> = {`,
    `  '${tenantKey}': ${JSON.stringify(types, null, 4).split('\n').map((l, i) => i === 0 ? l : '  ' + l).join('\n')},`,
    '};',
    '',
  ];
  return lines.join('\n');
}
