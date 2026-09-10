import { createHash } from 'node:crypto';
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
  canonicalizeApplicationPackage,
  createApplicationPackageDraft,
  digestApplicationPackage,
  validateApplicationPackage,
} from '../../src/lib/application-package.js';
import { materializeFixture } from '../../src/lib/generated/application-package-runtime.mjs';

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
    })).toEqual(expect.arrayContaining([expect.stringMatching(/artifact\.repository/)]));
    expect(validateApplicationPackage({
      ...base,
      capabilities: { contractVersion: 'eai.app_capabilities.v1', interactive: ['*'], workload: [] },
    })).toEqual(expect.arrayContaining([expect.stringMatching(/capabilities\.interactive/)]));
    expect(validateApplicationPackage({ ...base, clientSecret: 'not-allowed' })).toEqual(
      expect.arrayContaining([expect.stringMatching(/clientSecret/)]),
    );
  });

  test('builds byte-identical canonical output and digest', async () => {
    env = await createTestEnvironment();
    await mkdir(join(env.dir, '.eai'), { recursive: true });
    const source = validPackage();
    await writeFile(join(env.dir, 'eai.application.json'), `${JSON.stringify(source, null, 2)}\n`);

    const first = await buildApplicationPackage(env.dir);
    const second = await buildApplicationPackage(env.dir);

    expect(first.digest).toBe(digestApplicationPackage(source));
    expect(second).toEqual(first);
    expect(await readFile(first.outputPath, 'utf8')).toBe(canonicalizeApplicationPackage(source));
  });

  test('enforces every canonical schema constraint instead of a local subset', () => {
    expect(validateApplicationPackage({
      ...validPackage(),
      displayName: 'x'.repeat(121),
    })).toEqual(expect.arrayContaining([expect.stringMatching(/displayName/)]));
    expect(validateApplicationPackage({
      ...validPackage(),
      dataGovernance: {
        ...(validPackage().dataGovernance as object),
        classifications: ['not-a-classification'],
      },
    })).toEqual(expect.arrayContaining([expect.stringMatching(/classifications/)]));
  });

  test('fails closed if generated contract bytes drift from tech-docs', async () => {
    for (const [url, expected] of [
      [new URL('../../src/lib/generated/application-package.schema.json', import.meta.url), '1d20803fac09adbf7e5276137082b5c737ad621cdeb383581ab61ef9ae0fbc47'],
      [new URL('../../src/lib/generated/application-package-runtime.mjs', import.meta.url), '3f0999722404d9dff9dc0545a36ec5071f8a2339de0ad6456d4368a191421972'],
    ] as const) {
      expect(createHash('sha256').update(await readFile(url)).digest('hex')).toBe(expected);
    }
  });

  test('accepts and rejects the complete authoritative fixture corpus', async () => {
    const base = JSON.parse(await readFile(
      new URL('../../src/lib/generated/fixtures/application-package.valid.json', import.meta.url),
      'utf8',
    )) as Record<string, unknown>;
    const fixtures = JSON.parse(await readFile(
      new URL('../../src/lib/generated/fixtures/application-package.fixtures.json', import.meta.url),
      'utf8',
    )) as { readonly name: string; readonly valid: boolean; readonly set?: Record<string, unknown>; readonly delete?: string[] }[];
    for (const fixture of fixtures) {
      expect(validateApplicationPackage(materializeFixture(base, fixture)).length === 0, fixture.name)
        .toBe(fixture.valid);
    }
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
    source: { repository: 'https://github.com/example/testing-studio', digest: `sha256:${'b'.repeat(64)}` },
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
