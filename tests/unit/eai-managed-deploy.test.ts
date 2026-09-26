import { afterEach, describe, expect, test } from 'vitest';
import { chmod, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
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
  writeManagedDeployEvidence,
  type ManagedDeployState,
} from '../../src/lib/eai-managed-deploy.js';
import {
  managedDeployPollDelayMs,
  verifyGitHubAccess,
} from '../../src/commands/eai-managed-deploy.js';
import {
  MAX_SOURCE_UNKNOWN_EVIDENCE_BYTES,
  readSourceUnknownEvidenceFile,
} from '../../src/lib/source-unknown-evidence-file.js';

const requireFromTest = createRequire(import.meta.url);
const producerPinVerifier = requireFromTest(
  '../../scripts/verify-managed-deploy-producer-pin.cjs',
) as {
  assertCanonicalProducerPaths: (pin: Record<string, unknown>) => void;
  assertProducerRelease: (
    pin: Record<string, unknown>,
    runGit?: (command: string, args: string[], options?: unknown) => string | Buffer,
  ) => void;
  resolveProducerReleaseCommit: (
    tag: string,
    runGit?: (command: string, args: string[], options?: unknown) => string | Buffer,
  ) => string;
};

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
      publicApiUrl: 'https://test-api.au.myenterprise.ai/public',
    };
  }

  function fixtureUnifiedOperation(): Record<string, unknown> {
    const configHash = `sha256:${'b'.repeat(64)}`;
    return {
      tenantId: 'tenant-1', appScopeTenantId: 'tenant-1', targetTenantId: 'tenant-1',
      appKey: 'planning-portal', operationId: 'source-unknown-abc123', environment: 'preview',
      sourceMode: 'source-unknown', sourceStatus: 'completed', configHash, status: 'active',
      requiresTenantInfra: false, deploymentId: 'dep-1', activeUrl: 'https://rates.example.com',
      runtimeIdentity: { clientId: 'runtime-client', principalId: 'runtime-principal' },
      latestPointerVersion: 3, expectedLatestVersion: 3,
      deployment: { deploymentId: 'dep-1', status: 'active' },
      doctor: {
        deploymentId: 'dep-1', status: 'active', ready: true,
        scope: { tenantId: 'tenant-1', appKey: 'planning-portal', environment: 'preview' },
      },
      sourceRevision: {
        operationId: 'source-unknown-abc123', sourceMode: 'source-unknown',
        appScopeTenantId: 'tenant-1', targetTenantId: 'tenant-1',
        repoOwner: 'enterprise', repoName: 'planning-portal', repositoryId: 123, installationId: 456,
        branchRef: 'refs/heads/main', workflowPath: EAI_MANAGED_WORKFLOW_PATH, workflowHeadBranch: 'main',
        sourceCommitSha: 'a'.repeat(40), commitSha: 'a'.repeat(40), workflowRunId: '789',
        workflowBlobSha: 'f'.repeat(40), collectorDigest: `sha256:${'1'.repeat(64)}`, configHash,
        artifactDigest: `sha256:${'c'.repeat(64)}`,
        imageArtifact: { id: '987', name: 'eai-generated-app-image', archiveDigest: `sha256:${'d'.repeat(64)}` },
        imageDigest: `sha256:${'e'.repeat(64)}`,
      },
    };
  }

  test('keeps managed command and source-client implementation modules focused', async () => {
    const groups = [['src/commands', 'eai-managed-deploy'], ['src/lib', 'eai-managed-source-client']] as const;
    for (const [directory, prefix] of groups) {
      const names = (await readdir(join(process.cwd(), directory))).filter(name => name.startsWith(prefix) && name.endsWith('.ts'));
      expect(names.length).toBeGreaterThan(1);
      for (const name of names) {
        const content = await readFile(join(process.cwd(), directory, name), 'utf8');
        expect(content.split('\n').length, `${directory}/${name}`).toBeLessThanOrEqual(300);
      }
    }
  });

  test.each(['.github', 'scripts'])('refuses a symlinked canonical-file parent: %s', async (directory) => {
    const project = await temporaryDirectory('eai-managed-symlink-');
    const outside = await temporaryDirectory('eai-managed-outside-');
    await symlink(outside, join(project, directory), 'dir');
    await expect(installCanonicalManagedDeployFiles(project)).rejects.toThrow('untrusted directory');
    expect(await readdir(outside)).toEqual([]);
  });

  test('reads workflow evidence through a bounded no-follow regular-file handle', async () => {
    const directory = await temporaryDirectory('eai-workflow-evidence-');
    const evidence = join(directory, 'evidence.json');
    const target = join(directory, 'target.json');
    await writeFile(evidence, '{"status":"passed"}\n');
    expect(await readSourceUnknownEvidenceFile(evidence)).toBe('{"status":"passed"}\n');

    await writeFile(target, '{"status":"swapped"}\n');
    await rm(evidence);
    await symlink(target, evidence);
    await expect(readSourceUnknownEvidenceFile(evidence)).rejects.toThrow('no-follow regular file');

    await rm(evidence);
    await writeFile(evidence, Buffer.alloc(MAX_SOURCE_UNKNOWN_EVIDENCE_BYTES + 1, 0x20));
    await expect(readSourceUnknownEvidenceFile(evidence)).rejects.toThrow('must contain 1 to');
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
    await installCanonicalManagedDeployFiles(project);
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
    expect(evidence.workflowBlobSha).toMatch(/^[a-f0-9]{40}$/);
    expect(evidence.collectorDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(new Set([evidence.artifactDigest, evidence.imageDigest, evidence.imageArtifact.archiveDigest]).size).toBe(3);
  });

  test.each(['link', 'file'])('rejects a %s in a governed configuration ancestor', async (scenario) => {
    if (process.platform === 'win32' && scenario === 'link') return;
    const project = await temporaryDirectory('eai-managed-config-ancestor-');
    const outside = await temporaryDirectory('eai-managed-config-outside-');
    await writeFile(join(project, 'eai.runtime.json'), '{}\n');
    await mkdir(join(outside, 'eai.config'), { recursive: true });
    await writeFile(join(outside, 'eai.config', 'runtime.ts'), 'export const escaped = true;\n');
    if (scenario === 'link') await symlink(outside, join(project, 'src'), 'dir');
    else await writeFile(join(project, 'src'), 'not a directory\n');

    await expect(buildManagedDeployConfigHash(project)).rejects.toThrow(
      'Governed configuration ancestor must be a regular directory',
    );
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
      candidate: { commit: 'e401ac1003b5143c8a1f33cc084138f1301340bb' },
      releaseGate: { status: 'awaiting-producer-release', tag: null, commit: null },
    });
    expect(`sha256:${createHash('sha256').update(workflow).digest('hex')}`).toBe(pin.candidate.workflow.sha256);
    expect(`sha256:${createHash('sha256').update(collector).digest('hex')}`).toBe(pin.candidate.collector.sha256);
    for (const input of ['source_mode', 'app_key', 'tenant_id', 'target_tenant_id', 'operation_id', 'nonce', 'config_hash', 'commit_sha', 'public_api_url', 'env']) {
      expect(workflow).toMatch(new RegExp(`^      ${input}:`, 'm'));
    }
  });

  test('requires the real producer release tag to resolve to the exact candidate commit', () => {
    const commit = 'c'.repeat(40);
    const tagObject = 'd'.repeat(40);
    const workflow = Buffer.from('name: reviewed workflow\n');
    const collector = Buffer.from('#!/usr/bin/env node\n');
    const pin = {
      candidate: {
        commit,
        workflow: {
          path: EAI_MANAGED_WORKFLOW_PATH,
          sha256: `sha256:${createHash('sha256').update(workflow).digest('hex')}`,
        },
        collector: {
          path: EAI_MANAGED_EVIDENCE_SCRIPT_PATH,
          sha256: `sha256:${createHash('sha256').update(collector).digest('hex')}`,
        },
      },
      releaseGate: { status: 'released', tag: 'v9.9.9', commit },
    };
    const annotatedTag = (): string => [
      `${tagObject}\trefs/tags/v9.9.9`,
      `${commit}\trefs/tags/v9.9.9^{}`,
      '',
    ].join('\n');
    const reviewedRemote = (_command: string, args: string[]): string | Buffer => {
      if (args[0] === 'ls-remote') return annotatedTag();
      const object = args.at(-1);
      if (object === `${commit}:${EAI_MANAGED_WORKFLOW_PATH}`) return workflow;
      if (object === `${commit}:${EAI_MANAGED_EVIDENCE_SCRIPT_PATH}`) return collector;
      return '';
    };

    expect(
      producerPinVerifier.resolveProducerReleaseCommit('v9.9.9', annotatedTag),
    ).toBe(commit);
    expect(() =>
      producerPinVerifier.assertProducerRelease(pin, reviewedRemote),
    ).not.toThrow();
    expect(() =>
      producerPinVerifier.assertProducerRelease(pin, (command, args, options) => {
        const value = reviewedRemote(command, args, options);
        return args.at(-1) === `${commit}:${EAI_MANAGED_WORKFLOW_PATH}`
          ? Buffer.from('changed workflow\n')
          : value;
      }),
    ).toThrow(/workflow bytes .* do not match/);
    expect(() =>
      producerPinVerifier.assertProducerRelease(pin, () => ''),
    ).toThrow(/does not exist/);
    expect(() =>
      producerPinVerifier.assertProducerRelease(
        pin,
        () => `${'e'.repeat(40)}\trefs/tags/v9.9.9\n`,
      ),
    ).toThrow(/does not resolve to the reviewed candidate/);
    expect(() =>
      producerPinVerifier.assertProducerRelease({
        ...pin,
        releaseGate: {
          status: 'awaiting-producer-release',
          tag: null,
          commit: null,
        },
      }),
    ).toThrow(/release is blocked/);
  });

  test('requires producer pin entries to name only the canonical packaged paths', () => {
    const pin = {
      candidate: {
        workflow: { path: EAI_MANAGED_WORKFLOW_PATH },
        collector: { path: EAI_MANAGED_EVIDENCE_SCRIPT_PATH },
      },
    };
    expect(() => producerPinVerifier.assertCanonicalProducerPaths(pin)).not.toThrow();
    expect(() => producerPinVerifier.assertCanonicalProducerPaths({
      candidate: { ...pin.candidate, workflow: { path: 'approved-copy.yml' } },
    })).toThrow('workflow path must be the canonical');
    expect(() => producerPinVerifier.assertCanonicalProducerPaths({
      candidate: { ...pin.candidate, collector: { path: '../approved-copy.mjs' } },
    })).toThrow('collector path must be the canonical');
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
    const testPath = join(project, 'src', 'eai.config', 'nested', 'contract.test.ts');
    const specPath = join(project, 'src', 'eai.config', 'nested', 'contract.spec.json');
    await writeFile(testPath, 'export const fixture = 1;\n');

    const first = await buildManagedDeployConfigHash(project);
    const second = await buildManagedDeployConfigHash(project);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second).toBe(first);
    const collector = join(canonicalManagedDeployResourceRoot(), EAI_MANAGED_EVIDENCE_SCRIPT_PATH);
    expect((await promisify(execFile)(process.execPath, [collector, 'config-hash', '--root', project])).stdout.trim()).toBe(first);
    await writeFile(testPath, 'export const fixture = 2;\n');
    const testChanged = await buildManagedDeployConfigHash(project);
    expect(testChanged).not.toBe(first);
    await writeFile(specPath, '{"fixture":1}\n');
    const specAdded = await buildManagedDeployConfigHash(project);
    expect(specAdded).not.toBe(testChanged);
    expect((await promisify(execFile)(process.execPath, [collector, 'config-hash', '--root', project])).stdout.trim()).toBe(specAdded);
    await writeFile(join(project, 'src', 'eai.config', 'object-types.json'), '{"generated":2}\n');
    await writeFile(join(project, 'src', 'eai.config', 'object-types.provisioning.json'), '{"generated":2}\n');
    expect(await buildManagedDeployConfigHash(project)).toBe(specAdded);
    await writeFile(join(project, 'src', 'eai.config', 'nested', 'deployment-contract.ts'), 'export const contract = 2;\n');
    expect(await buildManagedDeployConfigHash(project)).not.toBe(specAdded);
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

  test.skipIf(process.platform === 'win32')('rejects nonregular governed configuration entries', async () => {
    const project = await temporaryDirectory('eai-managed-hash-special-');
    await writeFile(join(project, 'eai.runtime.json'), '{}');
    await mkdir(join(project, 'src', 'eai.config'), { recursive: true });
    const fifo = join(project, 'src', 'eai.config', 'runtime-input');
    await promisify(execFile)('mkfifo', [fifo]);
    await expect(buildManagedDeployConfigHash(project)).rejects.toThrow('regular file or directory');
  });

  test('writes nested doctor evidence only through regular directory ancestors', async () => {
    const project = await realpath(await temporaryDirectory('eai-managed-doctor-evidence-'));
    const target = join(project, '.eai', 'reports', 'deploy-doctor.json');
    await writeManagedDeployEvidence(target, { status: 'pass' });
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ status: 'pass' });
    expect((await stat(target)).mode & 0o777).toBe(0o600);

    const linkedRoot = await realpath(await temporaryDirectory('eai-managed-doctor-linked-'));
    const outside = await realpath(await temporaryDirectory('eai-managed-doctor-outside-'));
    await symlink(outside, join(linkedRoot, '.eai'), 'dir');
    await expect(writeManagedDeployEvidence(
      join(linkedRoot, '.eai', 'reports', 'deploy-doctor.json'),
      { status: 'pass' },
    )).rejects.toThrow('linked evidence directory');
    expect(await readdir(outside)).toEqual([]);
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
      publicApiUrl: 'https://test-api.au.myenterprise.ai/public',
    };

    await saveManagedDeployState(state, stateDir);
    expect(await loadManagedDeployState(state.operationId, stateDir)).toEqual(state);
    expect((await stat(join(stateDir, `${state.operationId}.json`))).mode & 0o777).toBe(0o600);

    const missingEndpoint = { ...state } as Partial<ManagedDeployState>;
    delete missingEndpoint.publicApiUrl;
    await expect(saveManagedDeployState(
      missingEndpoint as ManagedDeployState,
      stateDir,
    )).rejects.toThrow('missing its original PublicAPI URL');
    const operation = {
      appScopeTenantId: state.tenantId,
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

    await writeFile(
      join(stateDir, `${state.operationId}.json`),
      `${JSON.stringify(missingEndpoint)}\n`,
      { mode: 0o600 },
    );
    await expect(loadManagedDeployState(state.operationId, stateDir))
      .rejects.toThrow('missing its original PublicAPI URL');
  });

  test('reports success only for complete unified source, deployment, and doctor evidence', () => {
    expect(() => requireCommitSha('abc1234')).toThrow('exact 40 character');
    expect(parseGitHubRepository('https://github.com/enterprise/app.git').slug).toBe('enterprise/app');
    expect(parseGitHubRepository('git@github.com:enterprise/app.git').slug).toBe('enterprise/app');
    expect(parseGitHubRepository('ssh://git@github.com/enterprise/app.git').slug).toBe('enterprise/app');
    expect(classifyManagedOperationStatus('handoff_pending')).toBe('pending');
    expect(classifyManagedOperationStatus('active')).toBe('pending');
    expect(classifyManagedOperationStatus({ status: 'deployed' })).toBe('pending');
    const legacyProjection = {
      status: 'active',
      requiresTenantInfra: false,
      deploymentId: 'dep-1',
      activeUrl: 'https://rates.example.com',
      runtimeIdentity: { clientId: 'runtime-client', principalId: 'runtime-principal' },
      latestPointerVersion: 3,
      expectedLatestVersion: 3,
    };
    expect(classifyManagedOperationStatus(legacyProjection)).toBe('pending');
    expect(classifyManagedOperationStatus(fixtureUnifiedOperation())).toBe('succeeded');

    const mismatches: Array<(operation: Record<string, unknown>) => void> = [
      operation => { operation.sourceStatus = 'queued'; },
      operation => { operation.configHash = `sha256:${'f'.repeat(64)}`; },
      operation => { (operation.sourceRevision as Record<string, unknown>).operationId = 'source-unknown-other'; },
      operation => { (operation.sourceRevision as Record<string, unknown>).sourceMode = 'eai-cli-generated'; },
      operation => { (operation.sourceRevision as Record<string, unknown>).workflowPath = '.github/workflows/other.yml'; },
      operation => {
        const revision = operation.sourceRevision as Record<string, unknown>;
        revision.workflowHeadBranch = '../other';
        revision.branchRef = 'refs/heads/../other';
      },
      operation => { (operation.sourceRevision as Record<string, unknown>).commitSha = 'f'.repeat(39); },
      operation => { (operation.sourceRevision as Record<string, unknown>).workflowBlobSha = 'f'.repeat(39); },
      operation => { (operation.sourceRevision as Record<string, unknown>).collectorDigest = 'missing-sha256-prefix'; },
      operation => { delete (operation.sourceRevision as Record<string, unknown>).workflowBlobSha; },
      operation => { delete (operation.sourceRevision as Record<string, unknown>).collectorDigest; },
      operation => { (operation.sourceRevision as Record<string, unknown>).artifactDigest = 'missing-sha256-prefix'; },
      operation => { (operation.sourceRevision as Record<string, unknown>).imageDigest = `sha256:${'c'.repeat(64)}`; },
      operation => { (operation.sourceRevision as Record<string, unknown>).workflowRunId = '0'; },
      operation => { (operation.deployment as Record<string, unknown>).status = 'queued'; },
      operation => { (operation.doctor as Record<string, unknown>).ready = false; },
      operation => { (operation.doctor as Record<string, unknown>).deploymentId = 'dep-other'; },
      operation => {
        ((operation.doctor as Record<string, unknown>).scope as Record<string, unknown>).tenantId = 'other-tenant';
      },
      operation => {
        ((operation.doctor as Record<string, unknown>).scope as Record<string, unknown>).appKey = 'other-app';
      },
    ];
    for (const mutate of mismatches) {
      const operation = structuredClone(fixtureUnifiedOperation());
      mutate(operation);
      expect(classifyManagedOperationStatus(operation)).toBe('pending');
    }

    const managedSource = structuredClone(fixtureUnifiedOperation());
    managedSource.sourceMode = 'eai-cli-generated';
    (managedSource.sourceRevision as Record<string, unknown>).sourceMode = 'eai-cli-generated';
    expect(classifyManagedOperationStatus(managedSource)).toBe('pending');
    (managedSource.sourceRevision as Record<string, unknown>).reviewHeadSha = 'f'.repeat(40);
    expect(classifyManagedOperationStatus(managedSource)).toBe('succeeded');
    expect(classifyManagedOperationStatus({ ...fixtureUnifiedOperation(), sourceStatus: 'rejected' })).toBe('failed');
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
