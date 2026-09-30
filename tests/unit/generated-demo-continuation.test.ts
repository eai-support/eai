import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectGeneratedDemoContinuation } from '../../src/lib/generated-demo-continuation.js';
import { planGeneratedDemoReadOnlyBinding, planGeneratedDemoSelectedCreateBinding } from '../../src/lib/generated-demo-operational.js';
import { importGeneratedDemoData, parseBoundedImportRows } from '../../src/lib/generated-demo-operational-import.js';
import {
  prepareGeneratedDemoOperationalReview,
  upgradeGeneratedWorkflow,
} from '../../src/lib/generated-demo-operational-pr.js';
import type { PlatformAPIClient } from '../../src/lib/api.js';
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
    objectTypeDefinitions: [{ name: 'Vehicle', slug: 'vehicle', status: 'published',
      properties: [{name: 'name', type: 'text'}] }],
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
  it('parses bounded CSV and JSON imports and rejects ambiguous rows before any write', () => {
    expect(parseBoundedImportRows(Buffer.from('name,count\r\n"Car, one",2\r\n'), 'cars.csv'))
      .toEqual([{name: 'Car, one', count: '2'}]);
    expect(parseBoundedImportRows(Buffer.from('[{"name":"Car one","count":2}]'), 'cars.json'))
      .toEqual([{name: 'Car one', count: 2}]);
    expect(() => parseBoundedImportRows(Buffer.from('name,name\nA,B\n'), 'cars.csv'))
      .toThrow('duplicate');
    expect(() => parseBoundedImportRows(Buffer.from('name,count\nA\n'), 'cars.csv'))
      .toThrow('field count');
    expect(() => parseBoundedImportRows(Buffer.from('name\n"Car"extra\n'), 'cars.csv'))
      .toThrow('closing quote');
    expect(() => parseBoundedImportRows(Buffer.from('[{"name":"Car"},null]'), 'cars.json'))
      .toThrow('object rows');
  });

  it('replaces both v1 operation reads with the versioned operational evidence path', async () => {
    const resourceRoot = join(process.cwd(), 'resources/generated-operational');
    const loader = await readFile(join(resourceRoot, 'workflow-loader-v1.yml'), 'utf8');
    const evidence = await readFile(join(resourceRoot, 'workflow-evidence-v1.yml'), 'utf8');
    const workflow = [
      'name: EAI Generated App', 'on:', '  pull_request:', '  workflow_dispatch:',
      '    inputs: {}', 'permissions:', '  contents: read',
      'env:', '  EAI_GITHUB_OIDC_AUDIENCE: api://enterprise-ai-publicapi/generated-app',
      '  EAI_DEPLOYMENT_ENVIRONMENT: preview', '  EAI_RELEASE_CHANNEL: preview',
      'jobs:', '  validate-generated-source:', '    steps:',
      '      - name: Checkout', '        uses: actions/checkout@v4',
      '        with:', '          persist-credentials: false',
      '      - name: Load generated source operation', '        run: old source-preparations/',
      '      - name: Prepare source evidence input', '        run: echo source',
      '      - name: Build runtime image archive', '        uses: docker/build-push-action@v6',
      '  submit-eai-evidence:', '    environment: preview',
      '    permissions:', '      id-token: write', '    steps:',
      '      - name: Download exact runtime image artifact', '        uses: actions/download-artifact@v4',
      '      - name: Load generated source operation', '        run: old source-preparations/',
      '      - name: Verify GitHub run, source and image artifact', '        run: echo verified',
      '      - name: Submit validated Configurator Plus handover evidence', '        run: old source-unknown/workflow-evidence',
      '      - name: Submit TenantInfra workflow evidence', '        run: old source-preparations/',
      '      - name: Request deployment handoff', '        run: old',
      '  complete-eai-managed-review:', '    runs-on: ubuntu-latest', '',
    ].join('\n');
    const upgraded = upgradeGeneratedWorkflow(workflow, loader, evidence, 'dev');
    expect(upgraded).toContain("readFileSync('.eai/generated-source-operation.json'");
    expect(upgraded).toContain("readFileSync('evidence-input/.eai/generated-source-operation.json'");
    expect(upgraded).toContain('/source-updates/');
    expect(upgraded).toContain('  EAI_DEPLOYMENT_ENVIRONMENT: dev');
    expect(upgraded).not.toContain('source-preparations/');
    expect(upgraded).not.toContain('source-unknown/workflow-evidence');
    expect(upgraded).not.toContain('__EAI_SOURCE_OPERATION_PATH__');
    expect(upgraded).not.toContain('complete-eai-managed-review:');
    expect(() => upgradeGeneratedWorkflow(workflow.replace('id-token: write', 'id-token: none'), loader, evidence, 'dev'))
      .toThrow('vetted source-review template');
  });

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
    const { root, artifact } = await fixture();
    const before = await readFile(join(root, '.eai-manifest.json'));
    const inspection = await inspectGeneratedDemoContinuation(root);
    const tenantId = 'e2ff83b7-4635-6838-6de6-827484a6b01c';
    const proposal = {
      tenantId, appKey: 'fleet-demo', status: 'ready', validationErrors: [],
      objectTypes: [{
        name: 'Vehicle', slug: 'vehicle', status: 'published',
        properties: [{name: 'name', type: 'text'}],
        provisioningHints: { ncbOwner: { appKey: 'fleet-demo', enrollmentId: 'app-1' } },
      }],
      publishedObjectTypes: ['Vehicle'],
    };
    const plan = planGeneratedDemoReadOnlyBinding(inspection, {
      tenantId, fixtureCollection: 'vehicles', objectTypeSlug: 'vehicle', maxRows: 25,
    }, proposal, (artifact.objectTypeDefinitions as Record<string, unknown>[])[0]);
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
        properties: [{name: 'name', type: 'text'}],
        provisioningHints: { ncbOwner: { appKey: 'other-app', enrollmentId: 'app-2' } },
      }],
    }, (artifact.objectTypeDefinitions as Record<string, unknown>[])[0])).toThrow('not owned');
    expect(() => planGeneratedDemoReadOnlyBinding(inspection, {
      tenantId, fixtureCollection: 'vehicles', objectTypeSlug: 'vehicle', maxRows: 51,
    }, proposal, (artifact.objectTypeDefinitions as Record<string, unknown>[])[0])).toThrow('1 to 50 rows');
    const unsafe = {...(artifact.objectTypeDefinitions as Record<string, unknown>[])[0],
      properties: [{name: 'privateNote', type: 'text'}]};
    expect(() => planGeneratedDemoReadOnlyBinding(inspection, {
      tenantId, fixtureCollection: 'vehicles', objectTypeSlug: 'vehicle', maxRows: 25,
    }, {...proposal, objectTypes: [{...proposal.objectTypes[0], ...unsafe}]}, unsafe))
      .toThrow('unsafe operational read field');
  });

  it('selects only accepted and published scalar create fields on the same Object Type', async () => {
    const {root} = await fixture();
    const inspection = await inspectGeneratedDemoContinuation(root);
    const tenantId = 'e2ff83b7-4635-6838-6de6-827484a6b01c';
    const request = {tenantId, fixtureCollection: 'vehicles', objectTypeSlug: 'vehicle', maxRows: 25};
    const properties = [
      {name: 'name', type: 'text', required: true},
      {name: 'count', type: 'number'},
      {name: 'secretToken', type: 'text', serverOnly: true},
    ];
    const accepted = {name: 'Vehicle', slug: 'vehicle', properties};
    const manifest = {
      tenantId, appKey: 'fleet-demo', status: 'ready', validationErrors: [],
      objectTypes: [{...accepted, status: 'published',
        provisioningHints: {ncbOwner: {appKey: 'fleet-demo', enrollmentId: 'app-1'}}}],
      publishedObjectTypes: ['Vehicle'],
    };
    const plan = planGeneratedDemoSelectedCreateBinding(inspection, request, manifest, accepted, ['count', 'name']);
    expect(plan.config).toMatchObject({
      schemaVersion: 'eai.generated_app_operational.v2', actionsMode: 'selected-create',
      createBinding: {objectTypeSlug: 'vehicle', fields: ['count', 'name']},
    });
    expect(() => planGeneratedDemoSelectedCreateBinding(inspection, request, manifest, accepted, ['count']))
      .toThrow('required');
    expect(() => planGeneratedDemoSelectedCreateBinding(inspection, request, manifest, accepted, ['name', 'secretToken']))
      .toThrow('non-sensitive');
    expect(() => planGeneratedDemoSelectedCreateBinding(inspection, request, manifest, accepted, ['name', 'count', 'name']))
      .toThrow('unique');
    expect(() => planGeneratedDemoSelectedCreateBinding(inspection, request, {
      ...manifest, objectTypes: [{...accepted, properties: [{name: 'name', type: 'number', required: true}],
        status: 'published', provisioningHints: {ncbOwner: {appKey: 'fleet-demo', enrollmentId: 'app-1'}}}],
    }, accepted, ['name'])).toThrow('read properties');
  });

  it('imports only after signed operational completion and reads back each idempotent create', async () => {
    const {root, artifact, manifest} = await fixture();
    const tenantId = 'e2ff83b7-4635-6838-6de6-827484a6b01c';
    const definition = {name: 'Vehicle', slug: 'vehicle', status: 'published',
      properties: [{name: 'name', type: 'text', required: true}]};
    artifact.objectTypeDefinitions = [definition];
    const digests = artifact.digests as Record<string, string>;
    digests.objectTypeDefinitions = hash(`${canonical(artifact.objectTypeDefinitions)}\n`);
    const artifactBytes = `${JSON.stringify(artifact, null, 2)}\n`;
    await write(root, 'src/eai.config/generated-demo.json', artifactBytes);
    const generatedDemo = manifest.generatedDemo as Record<string, string>;
    generatedDemo.artifactDigest = hash(`${canonical(artifact)}\n`);
    const managed = manifest.managedFiles as Array<{path: string; checksum: string}>;
    managed.find(item => item.path === 'src/eai.config/generated-demo.json')!.checksum = hash(artifactBytes);
    await write(root, '.eai-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    await git(root, 'add', '.eai-manifest.json', 'src/eai.config/generated-demo.json');
    await git(root, 'commit', '-m', 'Accepted defined vehicle');
    const inspection = await inspectGeneratedDemoContinuation(root);
    const configBytes = `${JSON.stringify({
      schemaVersion: 'eai.generated_app_operational.v2', tenantId, appKey: 'fleet-demo',
      acceptedArtifactDigest: inspection.acceptedArtifactDigest,
      readBindings: [{fixtureCollection: 'vehicles', objectTypeSlug: 'vehicle', maxRows: 25}],
      actionsMode: 'selected-create', createBinding: {objectTypeSlug: 'vehicle', fields: ['name']},
    }, null, 2)}\n`;
    const operationBytes = `${JSON.stringify({appArtifactMode: 'app-v2-operational',
      operationId: 'operational-11111111-1111-4111-8111-111111111111', tenantId, appKey: 'fleet-demo'})}\n`;
    await write(root, 'src/eai.config/generated-operational.json', configBytes);
    await write(root, '.eai/generated-source-operation.json', operationBytes);
    const input = join(root, 'vehicles.json');
    await write(root, 'vehicles.json', '[{"name":"Sample customer car"}]');
    const requests: Array<{path: string; method: string; body: unknown}> = [];
    const anchor = {status: 'completed', appArtifactMode: 'app-v2-operational', tenantId,
      appKey: 'fleet-demo', operationId: 'operational-11111111-1111-4111-8111-111111111111',
      repoOwner: 'eai3438-customer-van', repoName: 'fleet-demo', integrityHash: hash('anchor'),
      acceptedArtifactDigest: inspection.acceptedArtifactDigest,
      fileChecksums: {'src/eai.config/generated-operational.json': hash(configBytes),
        '.eai/generated-source-operation.json': hash(operationBytes)}};
    const published = {tenantId, appKey: 'fleet-demo', status: 'ready', validationErrors: [],
      objectTypes: [{...definition, provisioningHints: {ncbOwner: {appKey: 'fleet-demo', enrollmentId: 'app-1'}}}],
      publishedObjectTypes: ['Vehicle']};
    const resource = {id: '11111111-1111-4111-8111-111111111111', data: {name: 'Sample customer car'}};
    const client = {requestPublicApi: async (path: string, options?: {method?: string; body?: unknown}) => {
      requests.push({path, method: options?.method || 'GET', body: options?.body});
      const payload = path.endsWith('/source-anchor') ? anchor :
        path.endsWith('/object-types/manifest') ? published : resource;
      return new Response(JSON.stringify(payload), {status: 200});
    }} as unknown as PlatformAPIClient;
    const planned = await importGeneratedDemoData({projectPath: root, filePath: input, tenantId, apply: false, client});
    expect(planned).toMatchObject({status: 'planned', rowCount: 1, records: []});
    expect(requests).toHaveLength(2);
    const applied = await importGeneratedDemoData({projectPath: root, filePath: input, tenantId, apply: true, client});
    expect(applied).toMatchObject({status: 'completed', rowCount: 1,
      records: [{row: 1, id: resource.id}]});
    const create = requests.find(item => item.method === 'POST')!;
    expect(create.body).toMatchObject({data: resource.data,
      idempotencyKey: expect.stringMatching(/^ncb-import-v1:[a-f0-9]{64}$/)});
    expect(requests.at(-1)?.path).toBe(`/v4/platform/tenants/${tenantId}/apps/fleet-demo/generated-operational/create`);
  });

  it('keeps the customer clone unchanged when the upstream operational gate is off', async () => {
    const { root, artifact } = await fixture();
    const inspection = await inspectGeneratedDemoContinuation(root);
    const branch = await git(root, 'branch', '--show-current');
    const tenantId = 'e2ff83b7-4635-6838-6de6-827484a6b01c';
    const anchor = {
      status: 'completed', tenantId, appKey: 'fleet-demo',
      repoOwner: 'eai3438-customer-van', repoName: 'fleet-demo',
      appArtifactMode: 'app-v2-demo', acceptedArtifactDigest: hash(`${canonical(artifact)}\n`),
      operationId: 'source-op-1', integrityHash: hash('anchor'),
      defaultBranch: branch, defaultBranchCommitSha: inspection.commitSha,
      configHash: hash('config'),
    };
    const requests: string[] = [];
    const client = {
      requestPublicApi: async (path: string) => {
        requests.push(path);
        return requests.length === 1
          ? new Response(JSON.stringify(anchor), {status: 200})
          : new Response(JSON.stringify({detail: 'disabled'}), {status: 503});
      },
    } as unknown as PlatformAPIClient;
    const manifestBefore = await readFile(join(root, '.eai-manifest.json'));
    await expect(prepareGeneratedDemoOperationalReview({
      projectPath: root, environment: 'preview', inspection, client,
      operationalBinding: {
        schemaVersion: 'eai.generated_app_operational.v1', tenantId, appKey: 'fleet-demo',
        acceptedArtifactDigest: inspection.acceptedArtifactDigest!,
        readBindings: [{fixtureCollection: 'vehicles', objectTypeSlug: 'vehicle', maxRows: 25}],
        actionsMode: 'simulated',
      },
    })).rejects.toThrow('disabled');
    expect(requests).toHaveLength(2);
    expect(await readFile(join(root, '.eai-manifest.json'))).toEqual(manifestBefore);
    expect(await git(root, 'status', '--porcelain')).toBe('');
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
