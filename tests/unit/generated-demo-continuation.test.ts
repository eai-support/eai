import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectGeneratedDemoContinuation } from '../../src/lib/generated-demo-continuation.js';
import { planGeneratedDemoReadOnlyBinding } from '../../src/lib/generated-demo-operational.js';
import { assertCliMayWriteProjectManifest, saveProjectManifest } from '../../src/lib/project-manifest.js';
import { planGoferRefresh } from '../../src/lib/gofer-refresh.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const appSource = 'export default function GeneratedApp() { return null; }\n';
const workflowSource = 'name: Generated demo\n';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function write(root: string, path: string, contents: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), contents);
}

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'EAI CLI Tests',
      GIT_AUTHOR_EMAIL: 'tests@example.com',
      GIT_COMMITTER_NAME: 'EAI CLI Tests',
      GIT_COMMITTER_EMAIL: 'tests@example.com',
    },
  });
  return stdout.trim();
}

async function fixture(mode: 'v2' | 'legacy' = 'v2'): Promise<{ root: string; artifact: Record<string, unknown>; manifest: Record<string, unknown> }> {
  const root = await mkdtemp(join(tmpdir(), 'eai-ncb-continuation-'));
  roots.push(root);
  const members = {
    appDefinition: {
      schemaVersion: 'eai.generated_app_definition.v2', appKey: 'fleet-demo', appName: 'Fleet Demo',
      businessCard: { description: 'Fleet app', goal: 'See cars', audience: 'Manager', outcome: 'Faster allocation' },
      workflow: { steps: [{ id: 'fleet', title: 'Fleet', viewId: 'fleet-view' }] },
      views: [{ id: 'fleet-view', title: 'Fleet', componentIds: ['fleet-table'] }],
      entryPath: 'src/generated/app.tsx',
    },
    sourceBundle: { schemaVersion: 'eai.generated_app_source.v1', files: [{ path: 'src/generated/app.tsx', content: appSource }] },
    previewFixtures: {
      schemaVersion: 'eai.generated_app_fixtures.v1',
      collections: { vehicles: [{ id: 'sample-1', name: 'Sample car' }] },
      actions: { reserve: { effect: 'session-local', message: 'Simulated booking' } },
    },
    objectTypeDefinitions: [{ name: 'Vehicle', slug: 'vehicle', status: 'published' }],
  };
  const artifact: Record<string, unknown> = {
    schemaVersion: 'eai.generated_app_artifact.v2',
    ...members,
    digests: Object.fromEntries(Object.entries(members).map(([key, value]) => [key, hash(`${canonical(value)}\n`)])),
  };
  const artifactContent = `${JSON.stringify(artifact, null, 2)}\n`;
  const managedFiles = [
    { path: 'src/generated/app.tsx', checksum: hash(appSource), encoding: 'utf8', owner: 'admin-portal-generated' },
    { path: 'src/eai.config/generated-demo.json', checksum: hash(artifactContent), encoding: 'utf8', owner: 'admin-portal-generated' },
    { path: '.github/workflows/eai-app.yml', checksum: hash(workflowSource), encoding: 'utf8', owner: 'admin-portal-generated' },
  ];
  const manifest: Record<string, unknown> = {
    schemaVersion: 'eai.generated_app_manifest.v1', sourceMode: 'admin-portal-generated',
    appKey: 'fleet-demo', templateRepository: 'eai-support/eai-app-template',
    ...(mode === 'v2' ? { generatedDemo: {
      schemaVersion: 'eai.generated_app_artifact.v2', artifactDigest: hash(`${canonical(artifact)}\n`),
    } } : { runtimeBinding: {
      schemaVersion: 'eai.generated_app_runtime_binding.v1',
      workflowTemplate: { id: 'fleet-workflow', version: 1, digest: hash('workflow'), title: 'Fleet Demo' },
    } }),
    managedFiles, generatedFileScope: managedFiles.map((item) => item.path),
  };
  await write(root, 'src/generated/app.tsx', appSource);
  await write(root, 'src/eai.config/generated-demo.json', artifactContent);
  await write(root, '.github/workflows/eai-app.yml', workflowSource);
  await write(root, '.eai-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  await git(root, 'init', '-q');
  await git(root, 'remote', 'add', 'origin', 'git@github.com:eai3438-customer-van/fleet-demo.git');
  await git(root, 'add', '.');
  await git(root, 'commit', '-qm', 'Generated demo');
  return { root, artifact, manifest };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('NCB demo continuation', () => {
  it('reports exact clone lineage and demo-only adapters without writing files', async () => {
    const { root, artifact } = await fixture();
    const before = await readFile(join(root, '.eai-manifest.json'));
    const result = await inspectGeneratedDemoContinuation(root);
    expect(result).toMatchObject({
      appKey: 'fleet-demo', repository: 'eai3438-customer-van/fleet-demo',
      sourceMode: 'admin-portal-generated', adapterStatus: 'demo-only',
      appArtifactMode: 'app-v2-demo', acceptedArtifactDigest: hash(`${canonical(artifact)}\n`),
      runtimeBindingRecorded: false,
      objectTypeDefinitionCount: 1, sampleCollectionCount: 1, simulatedActionCount: 1,
      proposedObjectTypes: [{ name: 'Vehicle', slug: 'vehicle', status: 'published' }],
      fixtureCollections: ['vehicles'],
    });
    expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(await readFile(join(root, '.eai-manifest.json'))).toEqual(before);
  });

  it('rejects accepted-artifact tampering and local source changes', async () => {
    const { root, artifact, manifest } = await fixture();
    (artifact.previewFixtures as { collections: Record<string, object[]> }).collections.vehicles.push({ id: 'sample-2' });
    const changed = `${JSON.stringify(artifact, null, 2)}\n`;
    await write(root, 'src/eai.config/generated-demo.json', changed);
    (manifest.managedFiles as Array<{ path: string; checksum: string }>)[1].checksum = hash(changed);
    (manifest.generatedDemo as { artifactDigest: string }).artifactDigest = hash(`${canonical(artifact)}\n`);
    await write(root, '.eai-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(inspectGeneratedDemoContinuation(root)).rejects.toThrow('previewFixtures digest');
    await git(root, 'checkout', '--', '.');
    await write(root, 'src/generated/app.tsx', `${appSource}// drift\n`);
    await expect(inspectGeneratedDemoContinuation(root)).rejects.toThrow('managed file differs');
  });

  it('plans one app-owned read without writing an operational binding', async () => {
    const { root } = await fixture();
    const before = await readFile(join(root, '.eai-manifest.json'));
    const inspection = await inspectGeneratedDemoContinuation(root);
    const tenantId = 'e2ff83b7-4635-6838-6de6-827484a6b01c';
    const proposal = {
      tenantId, appKey: 'fleet-demo', status: 'ready', validationErrors: [],
      objectTypes: [{
        name: 'Vehicle', slug: 'vehicle', status: 'published',
        provisioningHints: { ncbOwner: { appKey: 'fleet-demo', enrollmentId: 'app-1' } },
      }],
      publishedObjectTypes: ['Vehicle'],
    };
    const plan = planGeneratedDemoReadOnlyBinding(inspection, {
      tenantId, fixtureCollection: 'vehicles', objectTypeSlug: 'vehicle', maxRows: 25,
    }, proposal);
    expect(plan).toMatchObject({
      status: 'blocked-pending-operational-qualification',
      config: {
        tenantId, appKey: 'fleet-demo', actionsMode: 'simulated',
        readBindings: [{ fixtureCollection: 'vehicles', objectTypeSlug: 'vehicle', maxRows: 25 }],
      },
    });
    expect(await readFile(join(root, '.eai-manifest.json'))).toEqual(before);
    await expect(readFile(join(root, 'src/eai.config/generated-operational.json'))).rejects.toThrow();
    expect(() => planGeneratedDemoReadOnlyBinding(inspection, {
      tenantId, fixtureCollection: 'vehicles', objectTypeSlug: 'vehicle', maxRows: 25,
    }, {
      ...proposal,
      objectTypes: [{
        name: 'Vehicle', slug: 'vehicle', status: 'published',
        provisioningHints: { ncbOwner: { appKey: 'other-app', enrollmentId: 'app-2' } },
      }],
    })).toThrow('not owned');
    expect(() => planGeneratedDemoReadOnlyBinding(inspection, {
      tenantId, fixtureCollection: 'vehicles', objectTypeSlug: 'vehicle', maxRows: 51,
    }, proposal)).toThrow('1 to 50 rows');
  });

  it('rejects a changed deployment workflow even when the demo source is intact', async () => {
    const { root } = await fixture();
    await write(root, '.github/workflows/eai-app.yml', `${workflowSource}# unreviewed change\n`);
    await expect(inspectGeneratedDemoContinuation(root)).rejects.toThrow('.github/workflows/eai-app.yml');
  });

  it('rejects a generated source that the managed manifest does not anchor', async () => {
    const { root, manifest } = await fixture();
    manifest.managedFiles = (manifest.managedFiles as Array<{ path: string }>).filter((item) => item.path !== 'src/generated/app.tsx');
    manifest.generatedFileScope = (manifest.managedFiles as Array<{ path: string }>).map((item) => item.path);
    await write(root, '.eai-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(inspectGeneratedDemoContinuation(root)).rejects.toThrow('not anchored');
  });

  it('rejects continuation when the existing hosted-app runtime binding is missing', async () => {
    const { root, manifest } = await fixture('legacy');
    delete manifest.runtimeBinding;
    await write(root, '.eai-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(inspectGeneratedDemoContinuation(root)).rejects.toThrow('runtime binding');
  });

  it('preserves legacy respondent binding evidence for existing generated source', async () => {
    const { root } = await fixture('legacy');
    expect(await inspectGeneratedDemoContinuation(root)).toMatchObject({
      runtimeBindingRecorded: true, appArtifactMode: null, acceptedArtifactDigest: null,
    });
  });

  it('rejects a v2 manifest with a tampered or mixed authority', async () => {
    const { root, artifact, manifest } = await fixture();
    (manifest.generatedDemo as { artifactDigest: string }).artifactDigest = hash('different');
    await write(root, '.eai-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(inspectGeneratedDemoContinuation(root)).rejects.toThrow('digest differs');
    (manifest.generatedDemo as { artifactDigest: string }).artifactDigest = hash(`${canonical(artifact)}\n`);
    manifest.runtimeBinding = {
      schemaVersion: 'eai.generated_app_runtime_binding.v1',
      workflowTemplate: { id: 'fleet-workflow', version: 1, digest: hash('workflow') },
    };
    await write(root, '.eai-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(inspectGeneratedDemoContinuation(root)).rejects.toThrow('mixed demo authority');
  });

  it('prevents Gofer refresh or manifest save from replacing NCB source ownership', async () => {
    const { root } = await fixture();
    const before = await readFile(join(root, '.eai-manifest.json'));
    await expect(assertCliMayWriteProjectManifest(root)).rejects.toThrow('cannot replace');
    await expect(planGoferRefresh(root, null)).rejects.toThrow('cannot replace');
    await expect(saveProjectManifest(root, { schemaVersion: 1 })).rejects.toThrow('cannot replace');
    expect(await readFile(join(root, '.eai-manifest.json'))).toEqual(before);
  });

  it('rejects an unknown manifest schema rather than overwriting it', async () => {
    const { root } = await fixture();
    await write(root, '.eai-manifest.json', '{"schemaVersion":"future.project_manifest.v3"}\n');
    await expect(assertCliMayWriteProjectManifest(root)).rejects.toThrow('not a CLI project manifest');
  });
});
