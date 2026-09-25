import { afterEach, describe, expect, test } from 'vitest';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import {
  EAI_MANAGED_EVIDENCE_SCRIPT_PATH,
  EAI_MANAGED_WORKFLOW_PATH,
  assertManagedDeployStateMatchesOperation,
  buildManagedDeployConfigHash,
  canonicalManagedDeployResourceRoot,
  claimManagedDeployDispatch,
  classifyManagedOperationStatus,
  installCanonicalManagedDeployFiles,
  loadManagedDeployState,
  parseGitHubRepository,
  requireCommitSha,
  requireManagedPublicApiUrl,
  managedDeployNonceSha256,
  saveManagedDeployState,
  type ManagedDeployState,
} from '../../src/lib/eai-managed-deploy.js';
import {
  managedDeployPollDelayMs,
  verifyGitHubAccess,
} from '../../src/commands/eai-managed-deploy.js';

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

  function fixtureState(): ManagedDeployState {
    return {
      schema: 'eai.managed-deploy-state.v1', tenantId: 'tenant-1', targetTenantId: 'tenant-1',
      appKey: 'planning-portal', operationId: 'source-unknown-abc123', nonce: 'one-time-nonce',
      repo: 'enterprise/planning-portal', branch: 'main', ref: 'refs/heads/main', commitSha: 'a'.repeat(40),
      workflowPath: EAI_MANAGED_WORKFLOW_PATH, configHash: `sha256:${'b'.repeat(64)}`,
      environment: 'preview', installationId: 123,
      actorId: 'eai-user-oid', githubLinkSessionId: 'github-link-123',
      githubUserId: 456, githubLogin: 'linked-user', githubProofId: 'proof-123',
    };
  }

  test.each(['.github', 'scripts'])('refuses a symlinked canonical-file parent: %s', async (directory) => {
    const project = await temporaryDirectory('eai-managed-symlink-');
    const outside = await temporaryDirectory('eai-managed-outside-');
    await symlink(outside, join(project, directory), 'dir');
    await expect(installCanonicalManagedDeployFiles(project)).rejects.toThrow('untrusted directory');
    expect(await readdir(outside)).toEqual([]);
  });

  test.each(['workflow', 'candidate'])('refuses a symlinked %s file without touching its target', async (kind) => {
    const project = await temporaryDirectory('eai-managed-symlink-file-');
    const outside = join(await temporaryDirectory('eai-managed-outside-'), 'victim');
    await writeFile(outside, 'unchanged');
    const workflow = join(project, EAI_MANAGED_WORKFLOW_PATH);
    await mkdir(join(project, '.github/workflows'), { recursive: true });
    if (kind === 'candidate') await writeFile(workflow, 'custom workflow');
    await symlink(outside, kind === 'workflow' ? workflow : `${workflow}.eai-update`);
    await expect(installCanonicalManagedDeployFiles(project)).rejects.toThrow('untrusted file');
    expect(await readFile(outside, 'utf8')).toBe('unchanged');
  });

  test('refuses symlinked nonce directories and files', async () => {
    const root = await temporaryDirectory('eai-managed-state-symlink-');
    const outside = await temporaryDirectory('eai-managed-state-outside-');
    const state = fixtureState();
    const directory = join(root, 'state');
    await symlink(outside, directory, 'dir');
    await expect(saveManagedDeployState(state, directory)).rejects.toThrow('untrusted directory');
    expect(await readdir(outside)).toEqual([]);
    await rm(directory);
    await mkdir(directory);
    const victim = join(outside, 'victim');
    await writeFile(victim, 'unchanged', { mode: 0o600 });
    await symlink(victim, join(directory, `${state.operationId}.json`));
    await expect(saveManagedDeployState(state, directory)).rejects.toThrow('untrusted file');
    await expect(loadManagedDeployState(state.operationId, directory)).rejects.toThrow('untrusted file');
    expect(await readFile(victim, 'utf8')).toBe('unchanged');
  });

  test('rejects an untrusted writable state directory before changing its permissions', async () => {
    const directory = await temporaryDirectory('eai-managed-state-permissions-');
    await chmod(directory, 0o777);
    await expect(saveManagedDeployState(fixtureState(), directory)).rejects.toThrow('untrusted directory');
    expect((await stat(directory)).mode & 0o777).toBe(0o777);
  });

  test('takes one durable dispatch claim across concurrent clients and process restarts', async () => {
    const directory = await temporaryDirectory('eai-managed-dispatch-');
    const state = fixtureState();
    await saveManagedDeployState(state, directory);
    expect((await Promise.all(Array.from({ length: 8 }, () => claimManagedDeployDispatch(state, directory)))).filter(Boolean)).toHaveLength(1);
    expect(await claimManagedDeployDispatch(await loadManagedDeployState(state.operationId, directory), directory)).toBe(false);
    expect((await stat(join(directory, `${state.operationId}.json.dispatch`))).mode & 0o777).toBe(0o600);
    expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  test('refuses a dispatch claim that is readable by another local user', async () => {
    const directory = await temporaryDirectory('eai-managed-dispatch-permissions-');
    const state = fixtureState();
    await saveManagedDeployState(state, directory);
    expect(await claimManagedDeployDispatch(state, directory)).toBe(true);
    const marker = join(directory, `${state.operationId}.json.dispatch`);
    await chmod(marker, 0o644);
    await expect(claimManagedDeployDispatch(state, directory)).rejects.toThrow('untrusted file');
  });

  test.each([
    'http://api.au.myenterprise.ai/public', 'https://api.au.myenterprise.ai.attacker.example/public',
    'https://attacker.example/public', 'https://api.au.myenterprise.ai:8443/public',
    'https://user@api.au.myenterprise.ai/public', 'https://api.au.myenterprise.ai/public?redirect=bad',
    'https://api.au.myenterprise.ai/public#fragment', 'https://api.au.myenterprise.ai/other',
    'http://localhost:8000',
  ])('rejects workflow token submission to %s', (endpoint) => {
    expect(() => requireManagedPublicApiUrl(endpoint)).toThrow('trusted EAI regional PublicAPI');
  });

  test.each(['api.au', 'api.ca', 'api.eu', 'test-api.au', 'test-api.ca', 'test-api.eu', 'dev-api.au'])('accepts platform endpoint %s only with the public route prefix', (host) => {
    expect(requireManagedPublicApiUrl(`https://${host}.myenterprise.ai/public/`)).toBe(`https://${host}.myenterprise.ai/public`);
  });

  test.each(['valid', 'hash-mismatch', 'duplicate-digest', 'missing-provenance'])('executes the packaged collector with %s fixture evidence', async (scenario) => {
    const project = await temporaryDirectory('eai-managed-collector-');
    await mkdir(join(project, '.eai-build'));
    await writeFile(join(project, '.eai-build/eai-generated-app-image.tar'), 'immutable image archive');
    await writeFile(join(project, 'eai.runtime.json'), JSON.stringify({
      ...(scenario === 'missing-provenance' ? {} : { schemaProvenance: {
        schemaDigest: `sha256:${'a'.repeat(64)}`, validatorDigest: `sha256:${'b'.repeat(64)}`,
        baseTemplateSha: 'c'.repeat(40), templateVersion: 'fixture',
      } }),
    }));
    const configHash = await buildManagedDeployConfigHash(project);
    const invocation = promisify(execFile)(process.execPath, [
      join(canonicalManagedDeployResourceRoot(), EAI_MANAGED_EVIDENCE_SCRIPT_PATH),
      'collect', '--root', project, '--repo', 'enterprise/planning-portal', '--branch', 'main',
      '--ref', 'refs/heads/main', '--commit', 'c'.repeat(40), '--artifact-id', '123',
      '--app-key', 'planning-portal', '--tenant-id', 'tenant-1', '--target-tenant-id', 'tenant-1',
      '--operation-id', 'source-unknown-fixture', '--nonce', 'one-time-nonce', '--environment', 'preview',
      '--workflow-run-id', '456', '--workflow-run-attempt', '1',
      '--artifact-digest', 'd'.repeat(64), '--image-digest', `sha256:${(scenario === 'duplicate-digest' ? 'd' : 'e').repeat(64)}`,
      '--expected-config-hash', scenario === 'hash-mismatch' ? `sha256:${'f'.repeat(64)}` : configHash,
    ]);
    if (scenario !== 'valid') {
      await expect(invocation).rejects.toThrow(scenario === 'hash-mismatch' ? 'config hash does not match'
        : scenario === 'duplicate-digest' ? 'digests must be distinct' : 'schemaProvenance is required');
      await expect(readFile(join(project, '.eai-build/evidence/source-unknown-deployment-evidence.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      return;
    }
    await invocation;
    const evidence = JSON.parse(await readFile(join(project, '.eai-build/evidence/source-unknown-deployment-evidence.json'), 'utf8'));
    expect(evidence.configHash).toBe(configHash);
    expect(evidence.artifactDigest).toBe(`sha256:${'d'.repeat(64)}`);
    expect(new Set([evidence.artifactDigest, evidence.imageDigest, evidence.imageArtifact.archiveDigest]).size).toBe(3);
  });

  test('discovers the packaged canonical workflow and evidence collector', async () => {
    const root = canonicalManagedDeployResourceRoot();
    const workflow = await readFile(join(root, EAI_MANAGED_WORKFLOW_PATH), 'utf8');
    const collector = await readFile(join(root, EAI_MANAGED_EVIDENCE_SCRIPT_PATH), 'utf8');

    expect(workflow).toContain('name: EAI App Deployment Handoff');
    expect(workflow).toContain('run-name: EAI deploy ${{ inputs.app_key }} (${{ inputs.operation_id }})');
    expect(workflow).toContain('api://enterprise-ai-publicapi/eai-cli-generated');
    expect(workflow).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(workflow).toMatch(/^  workflow_call:/m);
    expect(workflow).not.toMatch(/^  (push|pull_request|schedule):/m);
    expect(workflow).toMatch(/^      attestations: write$/m);
    expect(workflow).toMatch(/^  packages: read$/m);
    expect(workflow.slice(workflow.indexOf('  build:'), workflow.indexOf('  handoff:'))).not.toContain('id-token: write');
    expect(collector).toContain('prepare-image-context');

    const pin = JSON.parse(await readFile(join(root, 'producer-pin.json'), 'utf8'));
    expect(pin).toMatchObject({
      schemaVersion: 'eai.managed-deploy-producer-pin.v1',
      candidate: { commit: 'c22a2f63300fa658ac555ef0ad82999aa1a8d08c' },
      releaseGate: { status: 'awaiting-producer-release', tag: null, commit: null },
    });
    expect(`sha256:${createHash('sha256').update(workflow).digest('hex')}`).toBe(pin.candidate.workflow.sha256);
    expect(`sha256:${createHash('sha256').update(collector).digest('hex')}`).toBe(pin.candidate.collector.sha256);
    for (const input of ['source_mode', 'app_key', 'tenant_id', 'target_tenant_id', 'operation_id', 'nonce', 'config_hash', 'commit_sha', 'public_api_url', 'env']) {
      expect(workflow).toMatch(new RegExp(`^      ${input}:`, 'm'));
    }
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
    expect(await readFile(`${workflowPath}.eai-update`, 'utf8')).toContain('EAI App Deployment Handoff');
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
    await writeFile(join(project, 'eai.config.ts'), 'export default { appKey: "fixture" };\n');
    await writeFile(join(project, 'src', 'eai.config', 'object-types.ts'), 'export const types = [];\n');
    await writeFile(join(project, 'src', 'eai.config', 'object-types.json'), '{"generated":1}\n');
    await writeFile(join(project, 'src', 'eai.config', 'object-types.provisioning.json'), '{"generated":1}\n');
    await mkdir(join(project, 'src', 'eai.config', 'nested'));
    await writeFile(join(project, 'src', 'eai.config', 'nested', 'deployment-contract.ts'), 'export const contract = 1;\n');
    await writeFile(join(project, 'src', 'eai.config', 'nested', 'contract.test.ts'), 'not governed\n');

    const first = await buildManagedDeployConfigHash(project);
    const second = await buildManagedDeployConfigHash(project);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second).toBe(first);
    await writeFile(join(project, 'src', 'eai.config', 'nested', 'contract.test.ts'), 'still not governed\n');
    expect(await buildManagedDeployConfigHash(project)).toBe(first);
    await writeFile(join(project, 'src', 'eai.config', 'object-types.json'), '{"generated":2}\n');
    await writeFile(join(project, 'src', 'eai.config', 'object-types.provisioning.json'), '{"generated":2}\n');
    expect(await buildManagedDeployConfigHash(project)).toBe(first);
    await writeFile(join(project, 'src', 'eai.config', 'nested', 'deployment-contract.ts'), 'export const contract = 2;\n');
    expect(await buildManagedDeployConfigHash(project)).not.toBe(first);
  });

  test('rejects links anywhere in governed configuration', async () => {
    const project = await temporaryDirectory('eai-managed-hash-link-');
    const outside = join(await temporaryDirectory('eai-managed-hash-outside-'), 'config.ts');
    await writeFile(join(project, 'eai.runtime.json'), '{}');
    await mkdir(join(project, 'src', 'eai.config'), { recursive: true });
    await writeFile(outside, 'secret');
    await symlink(outside, join(project, 'src', 'eai.config', 'linked.ts'));
    await expect(buildManagedDeployConfigHash(project)).rejects.toThrow('cannot be a symlink');
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
      actorId: 'eai-user-oid',
      githubLinkSessionId: 'github-link-123',
      githubUserId: 456,
      githubLogin: 'linked-user',
      githubProofId: 'proof-123',
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
        nonceSha256: managedDeployNonceSha256(state.nonce),
        actorId: state.actorId,
        githubLinkSessionId: state.githubLinkSessionId,
        repo: { owner: 'enterprise', name: 'planning-portal' },
        deployOnSuccess: true,
      },
    };
    expect(() => assertManagedDeployStateMatchesOperation(state, operation)).not.toThrow();
    expect(() => assertManagedDeployStateMatchesOperation(
      { ...state, commitSha: 'c'.repeat(40) },
      operation,
    )).toThrow('commitSha');
    expect(() => assertManagedDeployStateMatchesOperation(
      { ...state, nonce: 'different-one-time-nonce' },
      operation,
    )).toThrow('nonceSha256');
    expect(() => assertManagedDeployStateMatchesOperation(
      { ...state, actorId: 'different-eai-actor' },
      operation,
    )).toThrow('actorId');
    expect(() => assertManagedDeployStateMatchesOperation(
      { ...state, githubLinkSessionId: 'different-link-session' },
      operation,
    )).toThrow('githubLinkSessionId');
  });

  test('reports success only for a complete active TenantInfra projection', () => {
    expect(() => requireCommitSha('abc1234')).toThrow('exact 40 character');
    expect(parseGitHubRepository('https://github.com/enterprise/app.git').slug).toBe('enterprise/app');
    expect(parseGitHubRepository('git@github.com:enterprise/app.git').slug).toBe('enterprise/app');
    expect(parseGitHubRepository('ssh://git@github.com/enterprise/app.git').slug).toBe('enterprise/app');
    expect(classifyManagedOperationStatus('handoff_pending')).toBe('pending');
    expect(classifyManagedOperationStatus('active')).toBe('pending');
    expect(classifyManagedOperationStatus({ status: 'deployed' })).toBe('pending');
    expect(classifyManagedOperationStatus({
      status: 'active',
      requiresTenantInfra: false,
      deploymentId: 'dep-1',
      runtimeIdentity: { clientId: 'runtime-client', principalId: 'runtime-principal' },
      latestPointerVersion: 3,
      expectedLatestVersion: 3,
    })).toBe('pending');
    expect(classifyManagedOperationStatus({
      status: 'active',
      requiresTenantInfra: false,
      deploymentId: 'dep-1',
      activeUrl: 'http://rates.example.com',
      runtimeIdentity: { clientId: 'runtime-client', principalId: 'runtime-principal' },
      latestPointerVersion: 3,
      expectedLatestVersion: 3,
    })).toBe('pending');
    expect(classifyManagedOperationStatus({
      status: 'active',
      requiresTenantInfra: false,
      deploymentId: 'dep-1',
      activeUrl: 'https://rates.example.com',
      runtimeIdentity: { clientId: 'runtime-client', principalId: 'runtime-principal' },
      latestPointerVersion: 3,
      expectedLatestVersion: 2,
    })).toBe('pending');
    expect(classifyManagedOperationStatus({
      status: 'active',
      requiresTenantInfra: false,
      deploymentId: 'dep-1',
      activeUrl: 'https://rates.example.com',
      runtimeIdentity: { clientId: 'runtime-client', principalId: 'runtime-principal' },
      latestPointerVersion: 3,
      expectedLatestVersion: 3,
    })).toBe('succeeded');
    expect(classifyManagedOperationStatus('failed-readiness')).toBe('failed');
    expect(classifyManagedOperationStatus({ status: 'expired' })).toBe('failed');
    expect(classifyManagedOperationStatus({ status: 'revoked' })).toBe('failed');
  });

  test('bounds faster operation detection to two extra reads before the steady-state interval', () => {
    const delays = Array.from({ length: 6 }, (_, index) => managedDeployPollDelayMs(index + 1, 60_000));

    expect(delays).toEqual([2_000, 3_000, 5_000, 10_000, 10_000, 10_000]);
    expect(delays.slice(0, 3).reduce((total, delay) => total + delay, 0)).toBe(10_000);
    expect(managedDeployPollDelayMs(1, 750)).toBe(750);
  });

  test('runs independent GitHub repository and exact-ref reads concurrently after login', async () => {
    const calls: string[] = [];
    let releaseRemoteReads: (() => void) | undefined;
    const remoteReads = new Promise<void>((resolve) => {
      releaseRemoteReads = resolve;
    });
    const expectedSha = 'a'.repeat(40);
    const runner = async (_command: string, args: string[]): Promise<string> => {
      const invocation = args.slice(0, 2).join(' ');
      calls.push(invocation);
      if (invocation === 'auth status') return '';
      await remoteReads;
      if (invocation === 'repo view') {
        return JSON.stringify({ viewerPermission: 'WRITE', isArchived: false });
      }
      if (args[0] === 'api') return JSON.stringify({ object: { sha: expectedSha } });
      throw new Error(`unexpected invocation: ${args.join(' ')}`);
    };

    const verification = verifyGitHubAccess('enterprise/app', 'main', expectedSha, runner);
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(['auth status', 'repo view', 'api repos/enterprise/app/git/ref/heads/main']);
    releaseRemoteReads?.();
    await expect(verification).resolves.toBeUndefined();
  });

  test('requires the local gh actor to match the browser-linked numeric identity', async () => {
    const expectedSha = 'a'.repeat(40);
    const runner = async (_command: string, args: string[]): Promise<string> => {
      if (args[0] === 'auth') return '';
      if (args[0] === 'repo') return JSON.stringify({ viewerPermission: 'WRITE', isArchived: false });
      if (args[0] === 'api' && args[1] === 'user') return JSON.stringify({ id: 999, login: 'different-user' });
      if (args[0] === 'api') return JSON.stringify({ object: { sha: expectedSha } });
      throw new Error(`unexpected invocation: ${args.join(' ')}`);
    };
    await expect(verifyGitHubAccess('enterprise/app', 'main', expectedSha, runner, {
      id: 123,
      login: 'linked-user',
    })).rejects.toMatchObject({ code: 'GITHUB_ACTOR_MISMATCH' });
  });
});
