import type { GeneratedDemoContinuation } from './generated-demo-continuation.js';

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export interface ReadOnlyBindingRequest {
  readonly tenantId: string;
  readonly fixtureCollection: string;
  readonly objectTypeSlug: string;
  readonly maxRows: number;
}

export interface GeneratedOperationalConfig {
  readonly schemaVersion: 'eai.generated_app_operational.v1';
  readonly tenantId: string;
  readonly appKey: string;
  readonly acceptedArtifactDigest: string;
  readonly readBindings: readonly [{
    readonly fixtureCollection: string;
    readonly objectTypeSlug: string;
    readonly maxRows: number;
  }];
  readonly actionsMode: 'simulated';
}

export interface ReadOnlyBindingPlan {
  readonly config: GeneratedOperationalConfig;
  readonly status: 'blocked-pending-operational-qualification';
  readonly nextAction: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
): ReadOnlyBindingPlan {
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
