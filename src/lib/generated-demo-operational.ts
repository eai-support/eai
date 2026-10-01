import type { GeneratedDemoContinuation } from './generated-demo-continuation.js';

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export interface ReadOnlyBindingRequest {
  readonly tenantId: string;
  readonly fixtureCollection: string;
  readonly objectTypeSlug: string;
  readonly maxRows: number;
}

export interface ViewReadBindingRequest extends ReadOnlyBindingRequest {
  readonly viewId: string;
  readonly componentId: string;
}

interface GeneratedOperationalBase {
  readonly tenantId: string;
  readonly appKey: string;
  readonly acceptedArtifactDigest: string;
  readonly readBindings: readonly [{
    readonly fixtureCollection: string;
    readonly objectTypeSlug: string;
    readonly maxRows: number;
  }];
}

export type GeneratedOperationalLegacyConfig = GeneratedOperationalBase & (
  { readonly schemaVersion: 'eai.generated_app_operational.v1'; readonly actionsMode: 'simulated' }
  | { readonly schemaVersion: 'eai.generated_app_operational.v2'; readonly actionsMode: 'selected-create';
      readonly createBinding: { readonly objectTypeSlug: string; readonly fields: readonly string[] } }
);

export interface GeneratedOperationalViewConfig {
  readonly schemaVersion: 'eai.generated_app_operational.v3';
  readonly tenantId: string;
  readonly appKey: string;
  readonly acceptedArtifactDigest: string;
  readonly readBindings: ReadonlyArray<{
    readonly viewId: string;
    readonly componentId: string;
    readonly fixtureCollection: string;
    readonly objectTypeSlug: string;
    readonly maxRows: number;
  }>;
  readonly actionsMode: 'simulated';
}

export type GeneratedOperationalConfig = GeneratedOperationalLegacyConfig | GeneratedOperationalViewConfig;

export interface ReadOnlyBindingPlan<T extends GeneratedOperationalConfig = GeneratedOperationalConfig> {
  readonly config: T;
  readonly status: 'blocked-pending-operational-qualification';
  readonly nextAction: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const SAFE_FIELD = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SENSITIVE_FIELD = /password|secret|token|credential|api.?key|private|ssn|(?:authorization|url|uri|endpoint|key)$/i;
const RESERVED_FIELD = new Set(['id', '__proto__', 'prototype', 'constructor']);
const READ_SCALAR_TYPES = new Set(['text', 'number', 'boolean', 'date', 'select']);

function assertReadProjection(
  acceptedDefinition: Record<string, unknown>, publishedDefinition: Record<string, unknown>,
): void {
  if (!Array.isArray(acceptedDefinition.properties) || !Array.isArray(publishedDefinition.properties) ||
    acceptedDefinition.properties.length > 100 ||
    acceptedDefinition.properties.length !== publishedDefinition.properties.length) {
    throw new Error('Accepted and published read properties are unavailable or changed.');
  }
  const published = new Map<string, Record<string, unknown>>();
  for (const item of publishedDefinition.properties) {
    if (!isRecord(item) || typeof item.name !== 'string' || published.has(item.name)) {
      throw new Error('Published read properties are ambiguous.');
    }
    published.set(item.name, item);
  }
  const names = new Set<string>();
  let projected = 0;
  for (const item of acceptedDefinition.properties) {
    if (!isRecord(item) || typeof item.name !== 'string' || names.has(item.name)) {
      throw new Error('Accepted read properties are ambiguous.');
    }
    names.add(item.name);
    const current = published.get(item.name);
    if (!current || current.type !== item.type || current.serverOnly !== item.serverOnly ||
      current.required !== item.required) {
      throw new Error('Published read properties differ from the accepted app.');
    }
    if (item.serverOnly === true || !READ_SCALAR_TYPES.has(String(item.type))) continue;
    if (!SAFE_FIELD.test(item.name) || RESERVED_FIELD.has(item.name.toLowerCase()) ||
      SENSITIVE_FIELD.test(item.name)) {
      throw new Error('The Object Type contains an unsafe operational read field.');
    }
    projected++;
  }
  if (projected < 1 || projected > 16) {
    throw new Error('Operational read requires 1 to 16 safe scalar properties.');
  }
}

/** Select one authorized create form; the generated iframe stays simulated. */
export function planGeneratedDemoSelectedCreateBinding(
  inspection: GeneratedDemoContinuation,
  request: ReadOnlyBindingRequest,
  remoteManifest: unknown,
  acceptedDefinition: Record<string, unknown>,
  fields: readonly string[],
): ReadOnlyBindingPlan<GeneratedOperationalLegacyConfig> {
  const readPlan = planGeneratedDemoReadOnlyBinding(inspection, request, remoteManifest, acceptedDefinition);
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 16 ||
    new Set(fields).size !== fields.length ||
    fields.some(field => typeof field !== 'string' || !SAFE_FIELD.test(field) ||
      RESERVED_FIELD.has(field.toLowerCase()) || SENSITIVE_FIELD.test(field))) {
    throw new Error('Selected-create fields must be 1 to 16 unique non-sensitive property names.');
  }
  if (acceptedDefinition.slug !== request.objectTypeSlug || !Array.isArray(acceptedDefinition.properties) ||
    !isRecord(remoteManifest) || !Array.isArray(remoteManifest.objectTypes)) {
    throw new Error('The accepted and published Object Type field contracts are unavailable.');
  }
  const published = remoteManifest.objectTypes.find(
    (item: unknown) => isRecord(item) && item.slug === request.objectTypeSlug,
  );
  if (!isRecord(published) || !Array.isArray(published.properties)) {
    throw new Error('The published Object Type has no field contract.');
  }
  const accepted = acceptedDefinition.properties;
  const remote = published.properties;
  const scalar = new Set(['text', 'number', 'boolean']);
  for (const field of fields) {
    const original = accepted.find((item: unknown) => isRecord(item) && item.name === field);
    const current = remote.find((item: unknown) => isRecord(item) && item.name === field);
    if (!isRecord(original) || !isRecord(current) || !scalar.has(String(original.type)) ||
      current.type !== original.type || Boolean(original.serverOnly) || Boolean(current.serverOnly)) {
      throw new Error(`Selected-create property is not an accepted published scalar: ${field}`);
    }
  }
  for (const property of [...accepted, ...remote]) {
    if (isRecord(property) && property.required === true &&
      (!SAFE_FIELD.test(String(property.name)) || RESERVED_FIELD.has(String(property.name).toLowerCase()) ||
        SENSITIVE_FIELD.test(String(property.name)) ||
        !fields.includes(String(property.name)))) {
      throw new Error('Selected-create cannot omit a required published property.');
    }
  }
  return {
    ...readPlan,
    config: {
      ...readPlan.config,
      schemaVersion: 'eai.generated_app_operational.v2',
      actionsMode: 'selected-create',
      createBinding: { objectTypeSlug: request.objectTypeSlug, fields: [...fields].sort() },
    },
  };
}

/** Check the user-scoped app manifest; server reservation repeats all authority checks. */
export function assertPublishedReadOnlyObjectType(
  inspection: GeneratedDemoContinuation,
  tenantId: string,
  slug: string,
  response: unknown,
): void {
  if (!isRecord(response) || response.tenantId !== tenantId || response.appKey !== inspection.appKey ||
    !['ready', 'published'].includes(String(response.status)) || !Array.isArray(response.objectTypes) ||
    !Array.isArray(response.publishedObjectTypes) || !Array.isArray(response.validationErrors) ||
    response.validationErrors.length > 0) {
    throw new Error('The app Object Type manifest is not ready for this tenant.');
  }
  const proposal = inspection.proposedObjectTypes.find((item) => item.slug === slug);
  const remote = response.objectTypes.find((item: unknown) => isRecord(item) && item.slug === slug);
  if (!proposal || !isRecord(remote) || remote.name !== proposal.name || remote.status !== 'published' ||
    !response.publishedObjectTypes.includes(proposal.name)) {
    throw new Error('The accepted Object Type has not converged in this app.');
  }
  const hints = remote.provisioningHints;
  const owner = isRecord(hints) ? hints.ncbOwner : null;
  if (!isRecord(owner) || owner.appKey !== inspection.appKey ||
    typeof owner.enrollmentId !== 'string' || !owner.enrollmentId) {
    throw new Error('The published Object Type is not owned by this accepted app.');
  }
}

/** Plan one real-data read without changing source, tenant resources, or deployment. */
export function planGeneratedDemoReadOnlyBinding(
  inspection: GeneratedDemoContinuation,
  request: ReadOnlyBindingRequest,
  remoteManifest: unknown,
  acceptedDefinition: Record<string, unknown>,
): ReadOnlyBindingPlan<GeneratedOperationalLegacyConfig> {
  if (inspection.appArtifactMode !== 'app-v2-demo' || !inspection.acceptedArtifactDigest) {
    throw new Error('Read-only continuation requires an accepted v2 generated demo.');
  }
  if (!UUID_PATTERN.test(request.tenantId)) throw new Error('The target tenant ID must be a UUID.');
  if (!inspection.fixtureCollections.includes(request.fixtureCollection)) {
    throw new Error('The fixture collection is not in the accepted demo.');
  }
  if (!inspection.proposedObjectTypes.some((item) => item.slug === request.objectTypeSlug)) {
    throw new Error('The Object Type slug is not in the accepted proposal.');
  }
  if (!Number.isInteger(request.maxRows) || request.maxRows < 1 || request.maxRows > 50) {
    throw new Error('Read-only continuation supports 1 to 50 rows.');
  }
  const tenantId = request.tenantId.toLowerCase();
  assertPublishedReadOnlyObjectType(inspection, tenantId, request.objectTypeSlug, remoteManifest);
  const published = isRecord(remoteManifest) && Array.isArray(remoteManifest.objectTypes)
    ? remoteManifest.objectTypes.find((item: unknown) => isRecord(item) && item.slug === request.objectTypeSlug)
    : null;
  if (!isRecord(published) || acceptedDefinition.slug !== request.objectTypeSlug) {
    throw new Error('The accepted and published Object Type definitions are unavailable.');
  }
  assertReadProjection(acceptedDefinition, published);
  return {
    config: {
      schemaVersion: 'eai.generated_app_operational.v1',
      tenantId,
      appKey: inspection.appKey,
      acceptedArtifactDigest: inspection.acceptedArtifactDigest,
      readBindings: [{
        fixtureCollection: request.fixtureCollection,
        objectTypeSlug: request.objectTypeSlug,
        maxRows: request.maxRows,
      }],
      actionsMode: 'simulated',
    },
    status: 'blocked-pending-operational-qualification',
    nextAction: 'Qualify the server-side read adapter, reviewed source-update authority, and unchanged app/URL deployment before preparing a customer PR.',
  };
}

/** Activate only accepted component-to-fixture-to-Object-Type tuples in step-linked views. */
export function planGeneratedDemoViewReadBindings(
  inspection: GeneratedDemoContinuation,
  requests: readonly ViewReadBindingRequest[],
  remoteManifest: unknown,
  acceptedDefinitions: readonly Record<string, unknown>[],
): ReadOnlyBindingPlan<GeneratedOperationalViewConfig> {
  if (requests.length < 1 || requests.length > 4 || requests.length !== acceptedDefinitions.length) {
    throw new Error('Operational view reads require 1 to 4 accepted binding requests and definitions.');
  }
  const views = new Set<string>();
  const components = new Set<string>();
  const readBindings: GeneratedOperationalViewConfig['readBindings'][number][] = [];
  for (const [index, request] of requests.entries()) {
    if (request.tenantId.toLowerCase() !== requests[0].tenantId.toLowerCase() ||
      !inspection.workflowViewIds.includes(request.viewId) || views.has(request.viewId) ||
      components.has(request.componentId) ||
      !inspection.acceptedViewBindings.some(item => item.viewId === request.viewId &&
        item.componentId === request.componentId && item.fixtureCollection === request.fixtureCollection &&
        item.objectTypeSlug === request.objectTypeSlug) ||
      !inspection.acceptedTrustedSlots.some(item => item.viewId === request.viewId &&
        item.componentId === request.componentId && item.kind === 'read-table')) {
      throw new Error('The view read is not an accepted workflow component and data mapping.');
    }
    const legacy = planGeneratedDemoReadOnlyBinding(
      inspection, request, remoteManifest, acceptedDefinitions[index],
    );
    views.add(request.viewId);
    components.add(request.componentId);
    readBindings.push({viewId: request.viewId, componentId: request.componentId,
      ...legacy.config.readBindings[0]});
  }
  return {
    config: {
      schemaVersion: 'eai.generated_app_operational.v3',
      tenantId: requests[0].tenantId.toLowerCase(),
      appKey: inspection.appKey,
      acceptedArtifactDigest: inspection.acceptedArtifactDigest!,
      readBindings,
      actionsMode: 'simulated',
    },
    status: 'blocked-pending-operational-qualification',
    nextAction: 'Review each accepted view read and the unchanged app/URL deployment before merging the customer PR.',
  };
}
