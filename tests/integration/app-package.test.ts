import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import { workingDirectoryIs } from '../helpers/setup-dsl.js';
import {
  applicationPackageSubmissionBody,
  applicationPackageStatusPath,
  applicationPackageSubmissionPath,
} from '../../src/commands/vertical.js';
import {
  buildApplicationPackage,
  createApplicationPackageDraft,
  validateApplicationPackage,
} from '../../src/lib/application-package.js';

describe('eai app package', () => {
  let env: TestEnvironment;

  afterEach(async () => {
    vi.restoreAllMocks();
    await env?.cleanup();
  });

  test('creates a deterministic draft without credentials or tenant-specific values', async () => {
    env = await createTestEnvironment();
    workingDirectoryIs({ workingDir: env.dir, mockAPI: undefined as never, env: {}, prompts: [] }, env.dir);

    const draft = await createApplicationPackageDraft(env.dir, {
      appKey: 'testing-studio',
      displayName: 'Testing Studio',
      publisherRef: 'publisher:eai-partner',
    });

    expect(draft.schemaVersion).toBe('eai.application-package.v1');
    expect(draft.appKey).toBe('testing-studio');
    expect(JSON.stringify(draft)).not.toMatch(/token|secret|password|tenantId/i);
    expect(JSON.parse(await readFile(join(env.dir, 'eai.application.json'), 'utf8'))).toEqual(draft);
  });

  test('rejects mutable artifacts, wildcard capabilities, secrets and unknown top-level fields', () => {
    const base = validPackage();
    expect(validateApplicationPackage({
      ...base,
      artifact: { ...base.artifact as object, repository: 'registry.example/app:latest' },
    })).toContain('artifact.repository must be an untagged OCI repository; artifact.digest supplies the immutable identity');
    expect(validateApplicationPackage({
      ...base,
      capabilities: { contractVersion: 'eai.app_capabilities.v1', interactive: ['*'], workload: [] },
    })).toContain('capabilities.interactive must not contain wildcards');
    expect(validateApplicationPackage({ ...base, clientSecret: 'not-allowed' })).toContain(
      'Unknown application package field: clientSecret',
    );
  });

  test('builds byte-identical canonical output and digest', async () => {
    env = await createTestEnvironment();
    await mkdir(join(env.dir, '.eai'), { recursive: true });
    const source = validPackage();
    await writeFile(join(env.dir, 'eai.application.json'), `${JSON.stringify(source, null, 2)}\n`);

    const first = await buildApplicationPackage(env.dir);
    const second = await buildApplicationPackage(env.dir);

    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second).toEqual(first);
    expect(JSON.parse(await readFile(first.outputPath, 'utf8'))).toEqual(source);
  });

  test('uses only the dedicated regional PublicAPI publisher ingress', () => {
    expect(applicationPackageSubmissionPath()).toBe('/v4/platform/app-marketplace/publisher/submissions');
    expect(applicationPackageStatusPath('submission_123')).toBe(
      '/v4/platform/app-marketplace/publisher/submissions/submission_123',
    );
    expect(() => applicationPackageStatusPath('../Configurator')).toThrow(/submissionId/);
    const packageValue = validPackage();
    const digest = `sha256:${'e'.repeat(64)}`;
    expect(applicationPackageSubmissionBody(packageValue, digest)).toEqual({
      package: packageValue,
      packageDigest: digest,
      idempotencyKey: digest,
    });
  });
});

function validPackage(): Record<string, unknown> {
  return {
    schemaVersion: 'eai.application-package.v1',
    packageId: 'testing-studio',
    appKey: 'testing-studio',
    displayName: 'Testing Studio',
    publisher: { id: 'eai-partner', kind: 'partner', displayName: 'EAI Partner' },
    distribution: { visibility: 'distributable' },
    version: '1.0.0',
    source: { repository: 'github.com/example/testing-studio', digest: `sha256:${'b'.repeat(64)}` },
    artifact: {
      repository: 'registry.example/testing-studio',
      digest: `sha256:${'c'.repeat(64)}`,
      provenanceRef: 'evidence/provenance.json',
      signatureRef: 'evidence/signature.json',
      sbomRef: 'evidence/sbom.cdx.json',
    },
    manifestDigest: `sha256:${'d'.repeat(64)}`,
    runtime: { type: 'isolated-hosted', topology: 'buyer-hosted', healthPath: '/health' },
    routes: [{ id: 'testing.home', methods: ['GET'], path: '/testing' }],
    objectTypes: [{ name: 'TestRun', slug: 'test-run', manifestRef: 'object-types/test-run.json' }],
    services: [{ id: 'curate', minimumContractVersion: 'v4' }],
    capabilities: { contractVersion: 'eai.app_capabilities.v1', interactive: ['resource.read'], workload: [] },
    dataGovernance: {
      purposes: ['Application quality assurance'],
      classifications: ['internal'],
      residency: ['AU'],
      retentionDays: 30,
      export: 'none',
      deletionPolicyRef: 'legal/deletion.md',
    },
    callbacks: [],
    commercial: { model: 'manual-pilot', termsRef: 'legal/terms.md' },
    support: { owner: 'EAI Partner', runbookRef: 'support/runbook.md', slaRef: 'support/sla.md' },
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
}
