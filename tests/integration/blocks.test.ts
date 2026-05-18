import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import { runCommand } from '../helpers/action-dsl.js';

async function writeFileRecursive(root: string, relativePath: string, contents: string): Promise<void> {
  const absolutePath = join(root, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

describe('blocks command journey', () => {
  let env: TestEnvironment;
  let ctx: TestContext;

  beforeEach(async () => {
    env = await createTestEnvironment();
    ctx = {
      workingDir: env.dir,
      mockAPI: {} as TestContext['mockAPI'],
      env: {},
      prompts: [],
    };
  });

  afterEach(async () => {
    await env.cleanup();
  });

  test('HP001 lists built-in foundation and product block ids for app delivery', async () => {
    const result = await runCommand(ctx, 'eai blocks list --format json');

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.blocks.map((block: { id: string }) => block.id)).toContain('core.button');
    expect(payload.blocks.map((block: { id: string }) => block.id)).toContain('daisy.chatbot');
  });

  test('HP002 discovers installed, workspace, and pinned manifests with profile grouping', async () => {
    await writeFileRecursive(env.dir, 'package.json', JSON.stringify({
      name: 'blocks-fixture',
      type: 'module',
      dependencies: {
        '@enterpriseaigroup/custom': '1.2.3',
      },
    }, null, 2));
    await writeFileRecursive(env.dir, 'node_modules/@enterpriseaigroup/custom/package.json', JSON.stringify({
      name: '@enterpriseaigroup/custom',
      version: '1.2.3',
      type: 'module',
      eai: {
        blockManifest: './eai-blocks.json',
        uiBlocks: {
          catalogVersion: '2026.05',
        },
      },
    }, null, 2));
    await writeFileRecursive(env.dir, 'node_modules/@enterpriseaigroup/custom/eai-blocks.json', JSON.stringify({
      schemaVersion: '1.0.0',
      packageName: '@enterpriseaigroup/custom',
      packageProfiles: ['external', 'hybrid'],
      blocks: [{
        id: 'installed.workflow-card',
        title: 'WorkflowCard',
        exportName: 'WorkflowCard',
        packageLane: 'product',
        backendCoupling: 'external-with-adapter',
        publicReadiness: 'public-ready',
        requiredResources: [{ type: 'WorkflowRun', fields: ['status'], actions: ['advance'] }],
        dataBindings: [{ name: 'status', resource: 'WorkflowRun', field: 'status', required: true }],
        actionBindings: [{ name: 'advance', resource: 'WorkflowRun', action: 'advance' }],
        overridePoints: [{ name: 'statusCopy', path: 'presentationConfig.statusCopy' }],
      }],
    }, null, 2));
    await writeFileRecursive(env.dir, 'eai.blocks.json', JSON.stringify({
      schemaVersion: '1.0.0',
      packageName: '@local/ui',
      blocks: [{
        id: 'local.custom-dashboard',
        title: 'CustomDashboard',
        packageName: '@local/ui',
        importPath: '@local/ui/custom-dashboard',
        exportName: 'CustomDashboard',
        packageLane: 'addon',
        backendCoupling: 'internal-only',
        publicReadiness: 'internal',
        packageProfiles: ['internal'],
        customExtension: true,
        requiredResources: [{ type: 'TenantMetric', fields: ['score'] }],
      }],
    }, null, 2));
    await writeFileRecursive(env.dir, '.eai/pinned-blocks.json', JSON.stringify({
      schemaVersion: '1.0.0',
      packageName: '@pinned/catalog',
      blocks: [{
        id: 'pinned.summary-panel',
        title: 'SummaryPanel',
        packageName: '@pinned/catalog',
        importPath: '@pinned/catalog/summary-panel',
        exportName: 'SummaryPanel',
        packageLane: 'foundation',
        backendCoupling: 'external-safe',
        publicReadiness: 'preview',
        packageProfiles: ['hybrid'],
      }],
    }, null, 2));
    await writeFileRecursive(env.dir, '.eai-manifest.json', JSON.stringify({
      schemaVersion: 1,
      packages: {
        profile: 'hybrid',
        source: 'eai-packages',
        recordedAt: '2026-05-18T00:00:00.000Z',
      },
      blocks: {
        manifests: [{ path: '.eai/pinned-blocks.json', version: '2026.05' }],
      },
    }, null, 2));

    const result = await runCommand(ctx, 'eai blocks list --format json --package-profile hybrid --group-by profile');

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.packageProfile).toBe('hybrid');
    expect(payload.manifests.map((manifest: { source: string }) => manifest.source)).toEqual(
      expect.arrayContaining(['installed-package', 'workspace', 'pinned'])
    );
    expect(payload.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'hybrid',
        blocks: expect.arrayContaining([
          expect.objectContaining({ id: 'installed.workflow-card' }),
          expect.objectContaining({ id: 'pinned.summary-panel' }),
        ]),
      }),
    ]));
    expect(payload.blocks.map((block: { id: string }) => block.id)).not.toContain('local.custom-dashboard');
  });

  test('HP003 describes readiness, resource bindings, override points, and custom extension blocks', async () => {
    await writeFileRecursive(env.dir, 'eai.blocks.json', JSON.stringify({
      schemaVersion: '1.0.0',
      packageName: '@local/ui',
      blocks: [{
        id: 'local.custom-dashboard',
        title: 'CustomDashboard',
        packageName: '@local/ui',
        importPath: '@local/ui/custom-dashboard',
        exportName: 'CustomDashboard',
        packageLane: 'addon',
        backendCoupling: 'internal-only',
        publicReadiness: 'internal',
        packageProfiles: ['internal'],
        customExtension: true,
        requiredResources: [{ type: 'TenantMetric', fields: ['score'] }],
        dataBindings: [{ name: 'score', resource: 'TenantMetric', field: 'score' }],
        actionBindings: [{ name: 'refresh', resource: 'TenantMetric', action: 'refresh' }],
        overridePoints: [{ name: 'chartTheme', path: 'presentationConfig.chartTheme' }],
      }],
    }, null, 2));

    const customList = await runCommand(ctx, 'eai blocks list --format json --custom');
    const describe = await runCommand(ctx, 'eai blocks describe local.custom-dashboard --format json');

    expect(customList.exitCode).toBe(0);
    expect(JSON.parse(customList.stdout).blocks.map((block: { id: string }) => block.id)).toEqual(['local.custom-dashboard']);
    expect(describe.exitCode).toBe(0);
    expect(JSON.parse(describe.stdout)).toEqual(expect.objectContaining({
      id: 'local.custom-dashboard',
      publicReadiness: 'internal',
      packageProfiles: ['internal'],
      customExtension: true,
      requiredResources: [expect.objectContaining({ type: 'TenantMetric', fields: ['score'] })],
      dataBindings: [expect.objectContaining({ name: 'score', resource: 'TenantMetric', field: 'score' })],
      actionBindings: [expect.objectContaining({ name: 'refresh', resource: 'TenantMetric', action: 'refresh' })],
      overridePoints: [expect.objectContaining({ name: 'chartTheme', path: 'presentationConfig.chartTheme' })],
    }));
  });

  test('HP004 reports readiness compatibility for the active package profile', async () => {
    await writeFileRecursive(env.dir, '.eai-manifest.json', JSON.stringify({
      schemaVersion: 1,
      packages: {
        profile: 'internal',
      },
    }, null, 2));

    const result = await runCommand(ctx, 'eai blocks readiness --format json');

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.packageProfile).toBe('internal');
    expect(payload.compatibleBlocks).toContain('core.button');
    expect(payload.compatibleBlocks).toContain('daisy.chatbot');
    expect(payload.byReadiness['public-ready']).toBeGreaterThan(0);
  });

  test('BP001 rejects unknown block ids with a helpful message', async () => {
    const result = await runCommand(ctx, 'eai blocks describe missing.block');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown block id "missing.block"');
  });

  test('BP002 rejects invalid catalog filter values before discovery', async () => {
    const result = await runCommand(ctx, 'eai blocks list --format json --readiness secret');

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.message).toContain('Invalid --readiness "secret"');
  });

  test('BP003 validates manifest shape and reports bad-path errors', async () => {
    await writeFileRecursive(env.dir, 'bad-blocks.json', JSON.stringify({
      schemaVersion: '1.0.0',
      packageName: '@bad/catalog',
      blocks: [{
        id: 'bad.block',
        title: 'BadBlock',
        exportName: 'BadBlock',
        packageLane: 'unknown',
        backendCoupling: 'external-safe',
        packageProfiles: ['external'],
      }, {
        id: 'bad.block',
        title: 'DuplicateBadBlock',
        exportName: 'DuplicateBadBlock',
        packageLane: 'foundation',
        backendCoupling: 'external-safe',
      }],
    }, null, 2));

    const result = await runCommand(ctx, 'eai blocks validate --file bad-blocks.json --format json');

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.valid).toBe(false);
    expect(payload.errors).toEqual(expect.arrayContaining([
      'blocks[0] has invalid packageLane "unknown"',
      'Duplicate block id "bad.block"',
    ]));
  });
});
