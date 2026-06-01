import { isRecord } from './utils.js';

export const PASSIVE_RESOURCEAPI_BUNDLE_SCHEMA =
  'resourceapi.passive.bundle.v1';

export interface PassiveResourceApiBundleOptions {
  tenantId: string;
  installId: string;
  source: string;
  productKey?: string;
  schemaVersion?: string;
  generatedAt?: string;
}

export interface PassiveResourceApiBundle {
  schemaVersion: typeof PASSIVE_RESOURCEAPI_BUNDLE_SCHEMA;
  tenantId: string;
  installId: string;
  source: string;
  productKeys: string[];
  generatedAt: string;
  objectTypes: Array<Record<string, unknown>>;
  storageBackends: string[];
  tenants: Record<string, {
    installId: string;
    objectTypes: Array<Record<string, unknown>>;
    storageBackends: string[];
    generatedAt: string;
  }>;
  metadata: {
    source: string;
    provisionedBy: 'eai-cli';
    schemaVersion: string;
  };
}

function normalizeStorageBackend(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'mongodb' || raw === 'mongo' || raw === 'cosmos') {
    return 'documentdb';
  }
  return raw || 'postgresql';
}

function isPublishedObjectType(value: Record<string, unknown>): boolean {
  if (typeof value.status === 'string') {
    return value.status === 'published';
  }
  if ('publishedAt' in value) {
    return value.publishedAt !== null && value.publishedAt !== undefined;
  }
  return true;
}

export function extractObjectTypesForPassiveBundle(payload: unknown): Array<Record<string, unknown>> {
  if (!isRecord(payload)) {
    throw new Error('Schema export must be a JSON object.');
  }

  const candidates = payload.objectTypes ?? payload.object_types ?? payload.docs;
  if (!Array.isArray(candidates)) {
    throw new Error('Schema export must contain objectTypes, object_types, or docs.');
  }

  const objectTypes = candidates
    .filter((value): value is Record<string, unknown> => isRecord(value))
    .filter(isPublishedObjectType)
    .map((value) => ({
      ...value,
      storageBackend: normalizeStorageBackend(value.storageBackend),
    }));

  if (objectTypes.length === 0) {
    throw new Error('Schema export did not contain any published object types.');
  }

  return objectTypes;
}

export function buildPassiveResourceApiBundle(
  schemaExport: unknown,
  options: PassiveResourceApiBundleOptions,
): PassiveResourceApiBundle {
  const tenantId = options.tenantId.trim();
  const installId = options.installId.trim();
  if (!tenantId) {
    throw new Error('tenantId is required.');
  }
  if (!installId) {
    throw new Error('installId is required.');
  }

  const objectTypes = extractObjectTypesForPassiveBundle(schemaExport);
  const storageBackends = Array.from(
    new Set(objectTypes.map((objectType) => String(objectType.storageBackend))),
  ).sort();
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const productKeys = options.productKey?.trim()
    ? [options.productKey.trim()]
    : [];
  const schemaVersion = options.schemaVersion?.trim() || '1';

  return {
    schemaVersion: PASSIVE_RESOURCEAPI_BUNDLE_SCHEMA,
    tenantId,
    installId,
    source: options.source,
    productKeys,
    generatedAt,
    objectTypes,
    storageBackends,
    tenants: {
      [tenantId]: {
        installId,
        objectTypes,
        storageBackends,
        generatedAt,
      },
    },
    metadata: {
      source: options.source,
      provisionedBy: 'eai-cli',
      schemaVersion,
    },
  };
}
