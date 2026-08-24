import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  APPLICATION_PACKAGE_SCHEMA_VERSION as CONTRACT_SCHEMA_VERSION,
  canonicalizeJson,
  digestCanonicalJson,
  validateApplicationPackageContract,
} from './generated/application-package-runtime.mjs';

const applicationPackageSchema = JSON.parse(
  readFileSync(new URL('./generated/application-package.schema.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

export const APPLICATION_PACKAGE_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION;
export const APPLICATION_PACKAGE_FILE = 'eai.application.json';

/** User-owned metadata used to create an incomplete, non-publishable package draft. */
export interface ApplicationPackageDraftInput {
  readonly appKey: string;
  readonly displayName: string;
  readonly publisherRef: string;
}

/** Validated canonical package bytes and digest prepared for a publisher submission. */
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
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(appKey)) {
    throw new Error('appKey must be lowercase kebab-case.');
  }
  if (!displayName || !publisherRef) {
    throw new Error('displayName and publisherRef are required.');
  }
  const publisherId = publisherRef
    .replace(/^publisher:/u, '')
    .replace(/[^a-z0-9-]+/giu, '-')
    .replace(/^-|-$/gu, '')
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

/** Validate against the exact published schema and its security invariants. */
export function validateApplicationPackage(value: unknown): string[] {
  return validateApplicationPackageContract(
    applicationPackageSchema,
    value,
  ).sort();
}

/** Serialize package bytes with the platform canonicalizer. */
export function canonicalizeApplicationPackage(value: unknown): string {
  return canonicalizeJson(value);
}

/** Validate and digest one package using the platform canonicalizer. */
export function digestApplicationPackage(value: unknown): `sha256:${string}` {
  const errors = validateApplicationPackage(value);
  if (errors.length > 0) throw new Error(errors.join('; '));
  return digestCanonicalJson(value) as `sha256:${string}`;
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
  const canonical = canonicalizeApplicationPackage(packageValue);
  const digest = digestCanonicalJson(packageValue);
  const outputPath = join(projectRoot, '.eai', 'application-package', 'application-package.json');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, canonical, 'utf8');
  return { digest, outputPath, package: packageValue };
}

/** Read and validate a local application package without changing it. */
export async function readApplicationPackage(
  projectRoot: string,
  inputPath = APPLICATION_PACKAGE_FILE,
): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(resolve(projectRoot, inputPath), 'utf8')) as unknown;
  const errors = validateApplicationPackage(parsed);
  if (errors.length > 0) throw new Error(errors.join('; '));
  return parsed as Record<string, unknown>;
}
