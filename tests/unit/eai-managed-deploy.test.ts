import { afterEach, describe, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EAI_MANAGED_EVIDENCE_SCRIPT_PATH,
  EAI_MANAGED_WORKFLOW_PATH,
  assertManagedDeployStateMatchesOperation,
  buildManagedDeployConfigHash,
  canonicalManagedDeployResourceRoot,
  classifyManagedOperationStatus,
  installCanonicalManagedDeployFiles,
  loadManagedDeployState,
  parseGitHubRepository,
  requireCommitSha,
  saveManagedDeployState,
  type ManagedDeployState,
} from '../../src/lib/eai-managed-deploy.js';

describe('EAI managed deployment helpers', () => {
  const cleanup: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function temporaryDirectory(prefix: string): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), prefix));
    cleanup.push(path);
    return path;
  }

  test('discovers the packaged canonical workflow and evidence collector', async () => {
    const root = canonicalManagedDeployResourceRoot();
    const workflow = await readFile(join(root, EAI_MANAGED_WORKFLOW_PATH), 'utf8');
    const collector = await readFile(join(root, EAI_MANAGED_EVIDENCE_SCRIPT_PATH), 'utf8');

    expect(workflow).toContain('name: EAI App Source-Unknown Handoff');
    expect(workflow).toContain('api://enterprise-ai-publicapi/source-unknown');
    expect(collector).toContain('prepare-image-context');
  });

  test('installs the canonical pair once and reports stable files on the next pass', async () => {
    const project = await temporaryDirectory('eai-managed-project-');
    const first = await installCanonicalManagedDeployFiles(project);
    const second = await installCanonicalManagedDeployFiles(project);

    expect(first.changed).toEqual([EAI_MANAGED_WORKFLOW_PATH, EAI_MANAGED_EVIDENCE_SCRIPT_PATH]);
    expect(second.unchanged).toEqual([EAI_MANAGED_WORKFLOW_PATH, EAI_MANAGED_EVIDENCE_SCRIPT_PATH]);
  });

  test('preserves a customized workflow and stages the canonical update beside it', async () => {
    const project = await temporaryDirectory('eai-managed-update-');
    const workflowPath = join(project, EAI_MANAGED_WORKFLOW_PATH);
    await mkdir(join(project, '.github', 'workflows'), { recursive: true });
    await writeFile(workflowPath, 'name: Local workflow\n');

    const result = await installCanonicalManagedDeployFiles(project);

    expect(await readFile(workflowPath, 'utf8')).toBe('name: Local workflow\n');
    expect(await readFile(`${workflowPath}.eai-update`, 'utf8')).toContain('EAI App Source-Unknown Handoff');
    expect(result.pendingUpdates).toContain(`${EAI_MANAGED_WORKFLOW_PATH}.eai-update`);
  });

  test('rejects a sibling-prefix traversal target', async () => {
    const parent = await temporaryDirectory('eai-managed-containment-');
    const project = join(parent, 'repo');
    const siblingTarget = join(parent, 'repo-evil', 'workflow.yml');
    await mkdir(project);

    await expect(
      installCanonicalManagedDeployFiles(project, '../repo-evil/workflow.yml'),
    ).rejects.toThrow('outside its allowed root');
    await expect(readFile(siblingTarget)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('hashes the same runtime configuration deterministically', async () => {
    const project = await temporaryDirectory('eai-managed-hash-');
    await mkdir(join(project, 'src', 'eai.config'), { recursive: true });
    await writeFile(join(project, 'eai.runtime.json'), '{"runtime":1}\n');
    await writeFile(join(project, 'src', 'eai.config', 'object-types.ts'), 'export const types = [];\n');

    const first = await buildManagedDeployConfigHash(project);
    const second = await buildManagedDeployConfigHash(project);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  test('persists retry authority outside the project with owner-only file permissions', async () => {
    const stateDir = await temporaryDirectory('eai-managed-state-');
    const state: ManagedDeployState = {
      schema: 'eai.managed-deploy-state.v1',
      tenantId: 'tenant-1',
      targetTenantId: 'tenant-1',
      appKey: 'planning-portal',
      operationId: 'source-unknown-abc123',
      nonce: 'one-time-nonce',
      repo: 'enterprise/planning-portal',
      branch: 'main',
      ref: 'refs/heads/main',
      commitSha: 'a'.repeat(40),
      workflowPath: EAI_MANAGED_WORKFLOW_PATH,
      configHash: `sha256:${'b'.repeat(64)}`,
      environment: 'preview',
      installationId: 123,
    };

    await saveManagedDeployState(state, stateDir);
    expect(await loadManagedDeployState(state.operationId, stateDir)).toEqual(state);
    expect((await stat(join(stateDir, `${state.operationId}.json`))).mode & 0o777).toBe(0o600);
    const operation = {
      tenantId: state.tenantId,
      appKey: state.appKey,
      operationId: state.operationId,
      setup: {
        targetTenantId: state.targetTenantId,
        environment: state.environment,
        workflowPath: state.workflowPath,
        ref: state.ref,
        commitSha: state.commitSha,
        configHash: state.configHash,
        repo: { owner: 'enterprise', name: 'planning-portal' },
        deployOnSuccess: true,
      },
    };
    expect(() => assertManagedDeployStateMatchesOperation(state, operation)).not.toThrow();
    expect(() => assertManagedDeployStateMatchesOperation(
      { ...state, commitSha: 'c'.repeat(40) },
      operation,
    )).toThrow('commitSha');
  });

  test('rejects abbreviated commits and classifies terminal operation status', () => {
    expect(() => requireCommitSha('abc1234')).toThrow('exact 40 character');
    expect(parseGitHubRepository('https://github.com/enterprise/app.git').slug).toBe('enterprise/app');
    expect(parseGitHubRepository('git@github.com:enterprise/app.git').slug).toBe('enterprise/app');
    expect(parseGitHubRepository('ssh://git@github.com/enterprise/app.git').slug).toBe('enterprise/app');
    expect(classifyManagedOperationStatus('handoff_pending')).toBe('pending');
    expect(classifyManagedOperationStatus('active')).toBe('succeeded');
    expect(classifyManagedOperationStatus('failed-readiness')).toBe('failed');
  });
});
