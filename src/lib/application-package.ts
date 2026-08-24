import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export const APPLICATION_PACKAGE_SCHEMA_VERSION = 'eai.application-package.v1';
export const APPLICATION_PACKAGE_FILE = 'eai.application.json';

const TOP_LEVEL_FIELDS = new Set([
  'schemaVersion', 'packageId', 'appKey', 'displayName', 'publisher', 'version',
  'distribution', 'source', 'artifact', 'manifestDigest', 'runtime', 'routes',
  'objectTypes', 'services', 'capabilities', 'dataGovernance', 'callbacks',
  'commercial', 'support', 'compatibility', 'lifecycle', 'evidence',
]);
const REQUIRED_FIELDS = [...TOP_LEVEL_FIELDS];
const SECRET_FIELD = /(secret|password|credential|accessToken|refreshToken|privateKey|connectionString)/i;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const OCI_REPOSITORY = /^[a-z0-9.-]+(?:\/[a-z0-9._-]+)+$/;

export interface ApplicationPackageDraftInput {
  readonly appKey: string;
  readonly displayName: string;
  readonly publisherRef: string;
}

export interface ApplicationPackageBuildResult {
  readonly digest: string;
  readonly outputPath: string;
  readonly package: Record<string, unknown>;
}

/** Create a local draft only; platform approval and publication remain remote authorities. */
export async function createApplicationPackageDraft(
  projectRoot: string,
  input: ApplicationPackageDraftInput,
): Promise<Record<string, unknown>> {
  const appKey = input.appKey.trim();
  const displayName = input.displayName.trim();
  const publisherRef = input.publisherRef.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appKey)) {
    throw new Error('appKey must be lowercase kebab-case.');
  }
  if (!displayName || !publisherRef) {
    throw new Error('displayName and publisherRef are required.');
  }
  const publisherId = publisherRef
    .replace(/^publisher:/, '')
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || appKey;
  const draft: Record<string, unknown> = {
    schemaVersion: APPLICATION_PACKAGE_SCHEMA_VERSION,
    packageId: `${publisherId}-${appKey}`,
    appKey,
    displayName,
    publisher: { id: publisherId, kind: 'partner', displayName: publisherRef },
    distribution: { visibility: 'private' },
    version: '0.1.0',
    source: { repository: 'https://github.com/replace-owner/replace-repository', digest: 'replace-with-sha256-digest' },
    artifact: {
      repository: 'replace.azurecr.io/replace-with-repository/app',
      digest: 'replace-with-sha256-digest',
      provenanceRef: 'evidence/provenance.json',
      signatureRef: 'evidence/signature.json',
      sbomRef: 'evidence/sbom.cdx.json',
    },
    manifestDigest: 'replace-with-sha256-digest',
    runtime: { type: 'isolated-hosted', topology: 'buyer-hosted', healthPath: '/health' },
    routes: [{ id: 'app.home', path: '/', methods: ['GET'] }],
    objectTypes: [],
    services: [{ id: 'public-api', minimumContractVersion: 'v4' }],
    capabilities: { contractVersion: 'eai.app_capabilities.v1', interactive: [], workload: [] },
    dataGovernance: {
      purposes: [], classifications: [], residency: [], retentionDays: 30,
      export: 'none', deletionPolicyRef: 'legal/deletion.md',
    },
    callbacks: [],
    commercial: { model: 'manual-pilot', termsRef: 'legal/terms.md' },
    support: { owner: publisherRef, slaRef: 'support/sla.md', runbookRef: 'support/runbook.md' },
    compatibility: { platformContract: 'eai.app-marketplace/v1', minimumTemplateVersion: '1.0.0' },
    lifecycle: {
      installRef: 'lifecycle/install.json', updateRef: 'lifecycle/update.json',
      uninstallRef: 'lifecycle/uninstall.json', migrationRef: 'lifecycle/migrate.json',
      rollbackRef: 'lifecycle/rollback.json',
    },
    evidence: {
      ciRef: 'evidence/ci.json', securityRef: 'evidence/security.json',
      accessibilityRef: 'evidence/accessibility.json',
      tenantIsolationRef: 'evidence/tenant-isolation.json',
    },
  };
  await writeFile(resolve(projectRoot, APPLICATION_PACKAGE_FILE), `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  return draft;
}

/** Validate the security-critical package invariants before any remote submission. */
export function validateApplicationPackage(value: unknown): string[] {
  if (!isRecord(value)) return ['Application package must be a JSON object.'];
  const errors: string[] = [];
  for (const field of Object.keys(value)) {
    if (!TOP_LEVEL_FIELDS.has(field)) errors.push(`Unknown application package field: ${field}`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in value)) errors.push(`Missing application package field: ${field}`);
  }
  if (value.schemaVersion !== APPLICATION_PACKAGE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${APPLICATION_PACKAGE_SCHEMA_VERSION}`);
  }
  if (typeof value.appKey !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.appKey)) {
    errors.push('appKey must be lowercase kebab-case');
  }
  const source = isRecord(value.source) ? value.source : {};
  if (!SHA256.test(String(source.digest ?? ''))) errors.push('source.digest must be sha256:<64 hex>');
  const artifact = isRecord(value.artifact) ? value.artifact : {};
  if (!SHA256.test(String(artifact.digest ?? ''))) errors.push('artifact.digest must be sha256:<64 hex>');
  if (!OCI_REPOSITORY.test(String(artifact.repository ?? ''))) {
    errors.push('artifact.repository must be an untagged OCI repository; artifact.digest supplies the immutable identity');
  }
  if (!SHA256.test(String(value.manifestDigest ?? ''))) errors.push('manifestDigest must be sha256:<64 hex>');
  const runtime = isRecord(value.runtime) ? value.runtime : {};
  if (!['trusted-embedded', 'isolated-hosted'].includes(String(runtime.type ?? ''))) {
    errors.push('runtime.type must be trusted-embedded or isolated-hosted');
  }
  if (!['eai-owned-embedded', 'eai-hosted', 'buyer-hosted'].includes(String(runtime.topology ?? ''))) {
    errors.push('runtime.topology must be eai-owned-embedded, eai-hosted or buyer-hosted');
  }
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
  if (capabilities.contractVersion !== 'eai.app_capabilities.v1') {
    errors.push('capabilities.contractVersion must be eai.app_capabilities.v1');
  }
  for (const field of ['interactive', 'workload']) {
    const items = capabilities[field];
    if (!Array.isArray(items)) errors.push(`capabilities.${field} must be an array`);
    else if (items.some((item) => typeof item !== 'string' || !item || item.includes('*'))) {
      errors.push(`capabilities.${field} must not contain wildcards`);
    }
  }
  visit(value, [], (path, field, child) => {
    if (SECRET_FIELD.test(field)) errors.push(`${path} must not contain credentials or secrets`);
    if (typeof child === 'string' && /\b(?:Bearer\s+|client_secret=|password=)/i.test(child)) {
      errors.push(`${path} contains a secret-like value`);
    }
  });
  return [...new Set(errors)].sort();
}

/** Build content-addressed canonical JSON for review; this does not approve or publish it. */
export async function buildApplicationPackage(
  projectRoot: string,
  inputPath = APPLICATION_PACKAGE_FILE,
): Promise<ApplicationPackageBuildResult> {
  const parsed = JSON.parse(await readFile(resolve(projectRoot, inputPath), 'utf8')) as unknown;
  const errors = validateApplicationPackage(parsed);
  if (errors.length > 0) throw new Error(errors.join('; '));
  const packageValue = parsed as Record<string, unknown>;
  const canonical = `${JSON.stringify(sortValue(packageValue), null, 2)}\n`;
  const digest = `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
  const outputPath = join(projectRoot, '.eai', 'application-package', 'application-package.json');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, canonical, 'utf8');
  return { digest, outputPath, package: packageValue };
}

export async function readApplicationPackage(projectRoot: string, inputPath = APPLICATION_PACKAGE_FILE): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(resolve(projectRoot, inputPath), 'utf8')) as unknown;
  const errors = validateApplicationPackage(parsed);
  if (errors.length > 0) throw new Error(errors.join('; '));
  return parsed as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

function visit(
  value: unknown,
  path: string[],
  callback: (path: string, field: string, value: unknown) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => visit(child, [...path, String(index)], callback));
    return;
  }
  if (!isRecord(value)) return;
  for (const [field, child] of Object.entries(value)) {
    const next = [...path, field];
    callback(next.join('.'), field, child);
    visit(child, next, callback);
  }
}
