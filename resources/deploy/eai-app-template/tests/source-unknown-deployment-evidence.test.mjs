import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceScript = join(
  repoRoot,
  'scripts/source-unknown-deployment-evidence.mjs',
);
const workflowPath = join(repoRoot, '.github/workflows/eai-app.yml');
const readmePath = join(repoRoot, 'README.md');
const digestPattern = /^sha256:[a-f0-9]{64}$/;

function handoffBinding(sourceMode = 'source-unknown') {
  return {
    sourceMode, tenantId: 'company-1', appScopeTenantId: 'company-1', targetTenantId: 'hosting-1',
    appKey: 'permit-app', environment: 'preview', operationId: 'operation-1',
    commitSha: 'a'.repeat(40), configHash: `sha256:${'b'.repeat(64)}`,
    workflowPath: '.github/workflows/eai-app.yml', ref: 'refs/heads/main', workflowRunId: '123',
    workflowBlobSha: 'c'.repeat(40), collectorDigest: `sha256:${'d'.repeat(64)}`,
    artifactDigest: `sha256:${'e'.repeat(64)}`, imageDigest: `sha256:${'f'.repeat(64)}`,
    repositoryId: 77, repo: { owner: 'customer', name: 'permit-app' },
    imageArtifact: { id: 88, name: 'eai-generated-app-image', archiveDigest: `sha256:${'e'.repeat(64)}` },
  };
}

function handoffReceipt(status, binding = handoffBinding()) {
  const pending = status === 'handoff_pending';
  const deploymentId = 'deployment-1';
  const requestId = 'sealed-admin-request-1';
  return {
    status, requiresTenantInfra: pending, deploymentRequestId: pending ? requestId : deploymentId,
    ...(pending ? {} : { deploymentId }),
    deploymentRequest: {
      ...structuredClone(binding), status, requiresTenantInfra: pending, requestId,
      ...(binding.sourceMode === 'eai-cli-generated' ? { sourceOperationId: binding.operationId } : {}),
      ...(pending ? {} : { deploymentId }),
      handoff: { backend: 'TenantInfra', status: pending ? 'pending' : 'configured' },
    },
  };
}

function writeFixtureApp(root) {
  mkdirSync(join(root, '.next/standalone'), { recursive: true });
  mkdirSync(join(root, '.next/static'), { recursive: true });
  mkdirSync(join(root, 'src/eai.config'), { recursive: true });
  mkdirSync(join(root, 'tests/fixtures/schema-provenance'), {
    recursive: true,
  });
  mkdirSync(join(root, '.eai-build'), { recursive: true });
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });

  writeFileSync(
    join(root, '.next/standalone/server.js'),
    'console.log("ok");\n',
  );
  writeFileSync(join(root, '.next/static/app.js'), 'static\n');
  writeFileSync(join(root, 'package.json'), '{"name":"fixture-app"}\n');
  writeFileSync(
    join(root, 'eai.runtime.json'),
    JSON.stringify({
      runtime: 'fixture',
      schemaProvenance: JSON.parse(
        readFileSync(
          join(repoRoot, 'tests/fixtures/schema-provenance/valid.json'),
          'utf8',
        ),
      ),
    }),
  );
  writeFileSync(
    join(root, 'src/eai.config/object-types.json'),
    '{"types":[]}\n',
  );
  writeFileSync(
    join(root, '.eai-build/eai-generated-app-image.tar'),
    'oci image archive fixture\n',
  );

  cpSync(
    join(repoRoot, 'tests/fixtures/schema-provenance/valid.json'),
    join(root, 'tests/fixtures/schema-provenance/valid.json'),
  );
  cpSync(workflowPath, join(root, '.github/workflows/eai-app.yml'));
  cpSync(evidenceScript, join(root, 'scripts/source-unknown-deployment-evidence.mjs'));
}

function runEvidenceScript(args, options = {}) {
  return execFileSync(process.execPath, [evidenceScript, ...args], {
    encoding: 'utf8',
    ...options,
  });
}

function configHash(root) {
  return runEvidenceScript(['config-hash', '--root', root]).trim();
}

function createMinimalOciArchive(workDir, name = 'image') {
  const contentRoot = join(workDir, `${name}-oci-root`);
  const configBytes = Buffer.from('{"architecture":"amd64","os":"linux"}');
  const configDigest = `sha256:${createHash('sha256')
    .update(configBytes)
    .digest('hex')}`;
  const manifestBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {
        mediaType: 'application/vnd.oci.image.config.v1+json',
        digest: configDigest,
        size: configBytes.length,
      },
      layers: [],
    }),
  );
  const imageDigest = `sha256:${createHash('sha256')
    .update(manifestBytes)
    .digest('hex')}`;
  const manifestPath = join(
    contentRoot,
    'blobs/sha256',
    imageDigest.slice('sha256:'.length),
  );
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, manifestBytes);
  writeFileSync(
    join(contentRoot, 'blobs/sha256', configDigest.slice('sha256:'.length)),
    configBytes,
  );
  writeFileSync(
    join(contentRoot, 'oci-layout'),
    JSON.stringify({ imageLayoutVersion: '1.0.0' }),
  );
  writeFileSync(
    join(contentRoot, 'index.json'),
    JSON.stringify({
      schemaVersion: 2,
      manifests: [
        {
          mediaType: 'application/vnd.oci.image.manifest.v1+json',
          digest: imageDigest,
          size: manifestBytes.length,
          platform: { os: 'linux', architecture: 'amd64' },
        },
      ],
    }),
  );
  const archivePath = join(workDir, `${name}.tar`);
  execFileSync('tar', [
    '-cf',
    archivePath,
    '-C',
    contentRoot,
    'oci-layout',
    'index.json',
    'blobs',
  ]);
  return { archivePath, imageDigest };
}

function sourceUnknownBindingArgs(root) {
  return [
    '--app-key',
    'rates-review',
    '--tenant-id',
    'tenant-parent',
    '--operation-id',
    'source-op-1',
    '--nonce',
    'single-use-nonce',
    '--environment',
    'preview',
    '--repo',
    'enterpriseaigroup/rates-review',
    '--workflow',
    '.github/workflows/eai-app.yml',
    '--ref',
    'refs/heads/main',
    '--branch',
    'main',
    '--commit',
    'abcdef1234567890abcdef1234567890abcdef12',
    '--workflow-run-id',
    '123456789',
    '--workflow-run-attempt',
    '1',
    '--expected-config-hash',
    configHash(root),
  ];
}

function sourceUnknownCollectArgs(root) {
  return [
    'collect',
    '--root',
    root,
    ...sourceUnknownBindingArgs(root),
    '--artifact-id',
    '987654321',
    '--artifact-digest',
    `sha256:${'d'.repeat(64)}`,
    '--image-digest',
    `sha256:${'c'.repeat(64)}`,
  ];
}

function dispatchBindingArgs(root) {
  return [
    '--app-key',
    'rates-review',
    '--tenant-id',
    'tenant-parent',
    '--operation-id',
    'source-op-1',
    '--nonce',
    'single-use-nonce',
    '--environment',
    'preview',
    '--expected-config-hash',
    configHash(root),
  ];
}

test('collect normalizes upload-artifact bare hex and writes canonical handoff digests', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-source-unknown-evidence-'));
  try {
    const fixtureRoot = join(workDir, 'app');
    const outputFile = join(realpathSync(workDir), 'github-output.txt');
    writeFixtureApp(fixtureRoot);

    const stdout = runEvidenceScript([
      'collect',
      '--root',
      fixtureRoot,
      '--app-key',
      'rates-review',
      '--tenant-id',
      'tenant-parent',
      '--repo',
      'enterpriseaigroup/rates-review',
      '--workflow',
      '.github/workflows/eai-app.yml',
      '--ref',
      'refs/heads/main',
      '--branch',
      'main',
      '--commit',
      'abcdef1234567890abcdef1234567890abcdef12',
      '--workflow-run-id',
      '123456789',
      '--workflow-run-attempt',
      '1',
      '--operation-id',
      'source-op-1',
      '--nonce',
      'single-use-nonce',
      '--environment',
      'demo',
      '--expected-config-hash',
      configHash(fixtureRoot),
      '--artifact-id',
      '987654321',
      '--artifact-digest',
      'd'.repeat(64),
      '--image-digest',
      `sha256:${'c'.repeat(64)}`,
      '--github-output',
      outputFile,
    ]);

    const evidencePath = join(
      fixtureRoot,
      '.eai-build/evidence/source-unknown-deployment-evidence.json',
    );
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    const summary = JSON.parse(stdout);
    assert.equal(evidence.nonce, 'single-use-nonce');
    assert.equal(evidence.environment, 'demo');
    assert.equal(Object.hasOwn(summary, 'nonce'), false);
    assert.equal(stdout.includes('single-use-nonce'), false);
    assert.equal(summary.operationId, evidence.operationId);
    assert.equal(summary.evidencePath, evidencePath);
    assert.equal(summary.configHash, evidence.configHash);
    assert.equal(summary.artifactDigest, evidence.artifactDigest);
    assert.equal(summary.imageDigest, evidence.imageDigest);
    assert.equal(evidence.operationId, 'source-op-1');
    assert.equal(evidence.validationSummary.status, 'passed');
    assert.match(evidence.configHash, digestPattern);
    assert.match(evidence.artifactDigest, digestPattern);
    assert.equal(evidence.artifactDigest, `sha256:${'d'.repeat(64)}`);
    assert.match(evidence.imageArtifact.archiveDigest, digestPattern);
    assert.match(evidence.imageDigest, digestPattern);
    assert.match(evidence.workflowBlobSha, /^[a-f0-9]{40}$/);
    assert.match(evidence.collectorDigest, digestPattern);
    const workflowBytes = readFileSync(
      join(fixtureRoot, '.github/workflows/eai-app.yml'),
    );
    assert.equal(
      evidence.workflowBlobSha,
      createHash('sha1')
        .update(`blob ${workflowBytes.length}\0`)
        .update(workflowBytes)
        .digest('hex'),
    );
    assert.equal(
      evidence.collectorDigest,
      `sha256:${createHash('sha256')
        .update(
          readFileSync(
            join(fixtureRoot, 'scripts/source-unknown-deployment-evidence.mjs'),
          ),
        )
        .digest('hex')}`,
    );
    assert.equal(
      new Set([
        evidence.artifactDigest,
        evidence.imageArtifact.archiveDigest,
        evidence.imageDigest,
      ]).size,
      3,
    );

    const outputs = readFileSync(outputFile, 'utf8');
    for (const key of [
      'config_hash',
      'artifact_digest',
      'image_digest',
      'workflow_blob_sha',
      'collector_digest',
      'template_version',
      'base_template_sha',
      'schema_digest',
      'validator_digest',
    ]) {
      assert.match(outputs, new RegExp(`^${key}=`, 'm'));
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('CLI managed source computes checked-out config hash and labels its evidence', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-cli-managed-evidence-'));
  try {
    const root = join(workDir, 'app');
    writeFixtureApp(root);
    const args = [
      'collect',
      '--root',
      root,
      '--repo',
      'eai-generated-apps/demo',
      '--app-key',
      'demo',
      '--tenant-id',
      'company-1',
      '--environment',
      'preview',
      '--ref',
      'refs/heads/main',
      '--branch',
      'main',
      '--commit',
      'a'.repeat(40),
      '--artifact-id',
      '123',
      '--artifact-digest',
      'd'.repeat(64),
      '--image-digest',
      `sha256:${'c'.repeat(64)}`,
      '--operation-id',
      'cli-op-1',
      '--nonce',
      'a'.repeat(64),
      '--expected-config-hash',
      configHash(root),
      '--target-tenant-id',
      'hosting-tenant-1',
      '--workflow-run-id',
      '123',
      '--workflow-run-attempt',
      '1',
    ];
    runEvidenceScript([...args, '--source-mode', 'eai-cli-generated']);
    const evidence = JSON.parse(
      readFileSync(
        join(
          root,
          '.eai-build/evidence/source-unknown-deployment-evidence.json',
        ),
        'utf8',
      ),
    );
    assert.equal(evidence.sourceMode, 'eai-cli-generated');
    assert.equal(evidence.targetTenantId, 'hosting-tenant-1');
    assert.equal(
      evidence.configHash,
      runEvidenceScript(['config-hash', '--root', root]).trim(),
    );

    for (const sourceMode of ['unreviewed-source']) {
      const failure = spawnSync(
        process.execPath,
        [evidenceScript, ...args, '--source-mode', sourceMode],
        { encoding: 'utf8' },
      );
      assert.equal(failure.status, 1);
    }
    const missingTargetArgs = [...args];
    missingTargetArgs.splice(
      missingTargetArgs.indexOf('--target-tenant-id'),
      2,
    );
    const missingTarget = spawnSync(
      process.execPath,
      [
        evidenceScript,
        ...missingTargetArgs,
        '--source-mode',
        'eai-cli-generated',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(missingTarget.status, 1);
    assert.match(missingTarget.stderr, /signed target tenant ID/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('CLI evidence binds each merged commit and remains repository-owner agnostic', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-cli-managed-update-'));
  try {
    const root = join(workDir, 'app');
    writeFixtureApp(root);
    const states = [
      {
        repo: 'eai-generated-apps/demo',
        commit: 'a'.repeat(40),
        operation: 'cli-managed-initial',
        nonce: '1'.repeat(64),
      },
      {
        repo: 'eai-generated-apps/demo',
        commit: 'b'.repeat(40),
        operation: 'cli-managed-update',
        nonce: '2'.repeat(64),
      },
      {
        repo: 'customer-org/demo',
        commit: 'c'.repeat(40),
        operation: 'cli-managed-relocated',
        nonce: '3'.repeat(64),
      },
    ];
    const configHashes = new Set();
    for (const [index, state] of states.entries()) {
      const evidenceFile = `source-unknown-deployment-evidence-${index}.json`;
      const evidencePath = join(root, '.eai-build/evidence', evidenceFile);
      const runtimePath = join(root, 'eai.runtime.json');
      const runtime = JSON.parse(readFileSync(runtimePath, 'utf8'));
      runtime.release = index;
      writeFileSync(runtimePath, `${JSON.stringify(runtime)}\n`);
      runEvidenceScript([
        'collect',
        '--root',
        root,
        '--source-mode',
        'eai-cli-generated',
        '--target-tenant-id',
        'hosting-tenant-1',
        '--app-key',
        'demo',
        '--tenant-id',
        'company-1',
        '--environment',
        'preview',
        '--repo',
        state.repo,
        '--ref',
        'refs/heads/main',
        '--branch',
        'main',
        '--commit',
        state.commit,
        '--operation-id',
        state.operation,
        '--nonce',
        state.nonce,
        '--expected-config-hash',
        configHash(root),
        '--artifact-id',
        '123',
        '--artifact-digest',
        'd'.repeat(64),
        '--image-digest',
        `sha256:${'c'.repeat(64)}`,
        '--workflow-run-id',
        String(100 + index),
        '--workflow-run-attempt',
        '1',
        '--evidence-file',
        evidenceFile,
      ]);
      const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
      assert.equal(evidence.sourceMode, 'eai-cli-generated');
      assert.equal(evidence.targetTenantId, 'hosting-tenant-1');
      assert.equal(evidence.operationId, state.operation);
      assert.equal(evidence.commitSha, state.commit);
      assert.equal(evidence.nonce, state.nonce);
      assert.equal(
        evidence.configHash,
        runEvidenceScript(['config-hash', '--root', root]).trim(),
      );
      configHashes.add(evidence.configHash);
    }
    assert.equal(configHashes.size, states.length);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('workflow sends OIDC evidence directly to the canonical PublicAPI route', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const buildJob = workflow.slice(
    workflow.indexOf('  build:'),
    workflow.indexOf('  handoff:'),
  );
  const handoffJob = workflow.slice(workflow.indexOf('  handoff:'));
  const collectorSource = readFileSync(evidenceScript, 'utf8');
  const validatorStart = collectorSource.indexOf('function validateHandoffReceipt(');
  const validatorEnd = collectorSource.indexOf('\nfunction assertHandoffSubmitted', validatorStart);
  assert.ok(handoffJob.replace(/^ {10}/gm, '').includes(collectorSource.slice(validatorStart, validatorEnd)),
    'clean OIDC job must enforce the same receipt validator as the controlled collector tests');
  assert.match(buildJob, /github_environment: \$\{\{ steps\.dispatch-binding\.outputs\.github_environment \}\}/);
  assert.match(handoffJob, /environment:\n      name: \$\{\{ needs\.build\.outputs\.github_environment \}\}/);
  assert.match(handoffJob, /DEPLOY_ENVIRONMENT: \$\{\{ needs\.build\.outputs\.deployment_environment \}\}/);
  assert.doesNotMatch(handoffJob, /DEPLOY_ENVIRONMENT:.*inputs\.|name:.*inputs\.|github_environment\s*\|\|/);
  assert.match(
    workflow,
    /^run-name: EAI deploy \$\{\{ inputs\.app_key \}\} \(\$\{\{ inputs\.operation_id \}\}\)$/m,
  );
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.match(workflow, /^  workflow_call:/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.match(workflow, /^  packages: read$/m);
  assert.doesNotMatch(buildJob, /id-token: write|ACTIONS_ID_TOKEN/);
  assert.match(handoffJob, /^      attestations: write$/m);
  assert.match(handoffJob, /^      id-token: write$/m);
  assert.ok(
    buildJob.indexOf('Run dependency install scripts') <
      workflow.indexOf('  handoff:'),
  );
  assert.match(workflow, /name: eai-generated-app-image/);
  assert.match(
    workflow,
    /image_artifact_id: \$\{\{ steps\.image-artifact\.outputs\.artifact-id \}\}/,
  );
  assert.match(
    workflow,
    /image_artifact_digest: \$\{\{ steps\.image-artifact\.outputs\.artifact-digest \}\}/,
  );
  assert.match(workflow, /--platform linux\/amd64/);
  assert.match(workflow, /inputs\.public_api_url/);
  assert.match(workflow, /inputs\.publicapi_base_url/);
  assert.match(workflow, /inputs\.env \|\| inputs\.environment \|\| 'preview'/);
  assert.doesNotMatch(workflow, /vars\.EAI_PUBLIC_API_URL/);
  assert.doesNotMatch(workflow, /secrets\.EAI_PUBLIC_API_URL/);
  assert.match(
    workflow,
    /EAI_BOUND_PUBLIC_API_URL: \$\{\{ inputs\.public_api_url \|\| inputs\.publicapi_base_url \}\}/,
  );
  assert.match(
    workflow,
    /ref: \$\{\{ github\.sha \}\}/,
  );
  assert.doesNotMatch(
    workflow,
    /ref: \$\{\{ steps\.invocation\.outputs\.source_commit_sha \}\}/,
  );
  assert.doesNotMatch(workflow, /inputs\.commit_sha \|\| github\.sha/);
  assert.match(
    handoffJob,
    /SOURCE_COMMIT_SHA: \$\{\{ needs\.build\.outputs\.source_commit_sha \}\}/,
  );
  assert.match(workflow, /--commit "\$SOURCE_COMMIT_SHA"/);
  assert.match(workflow, /--workflow-sha "\$GITHUB_SHA"/);
  assert.match(
    handoffJob,
    /BUILD_IMAGE_ARTIFACT_ID: \$\{\{ needs\.build\.outputs\.image_artifact_id \}\}/,
  );
  assert.match(
    handoffJob,
    /BUILD_IMAGE_ARTIFACT_DIGEST: \$\{\{ needs\.build\.outputs\.image_artifact_digest \}\}/,
  );
  assert.match(
    handoffJob,
    /GITHUB_REPOSITORY_ID: \$\{\{ github\.repository_id \}\}/,
  );
  assert.match(
    handoffJob,
    /assertTargetTenantBinding\(evidence, process\.env\.TARGET_TENANT_ID\)/,
  );
  assert.match(
    handoffJob,
    /assertCurrentUploadBinding\(evidence, artifactId\)/,
  );
  assert.match(
    handoffJob,
    /actions\/runs\/\$\{encodeURIComponent\(process\.env\.GITHUB_RUN_ID\)\}\/attempts\/\$\{encodeURIComponent\(process\.env\.GITHUB_RUN_ATTEMPT\)\}/,
  );
  assert.match(
    handoffJob,
    /artifact\.workflow_run\.head_sha !== process\.env\.SOURCE_COMMIT_SHA/,
  );
  assert.match(handoffJob, /runAttempt\.run_attempt !== attempt/);
  assert.ok(
    workflow.indexOf('validate-dispatch') <
      workflow.indexOf('Install dependencies'),
  );
  assert.match(workflow, /source-unknown\/workflow-evidence/);
  assert.match(
    workflow,
    /cli-managed-source\/operations\/\$\{OPERATION_ID\}\/workflow-evidence/,
  );
  assert.match(workflow, /api:\/\/enterprise-ai-publicapi\/eai-cli-generated/);
  assert.match(workflow, /--source-mode "\$SOURCE_MODE"/);
  assert.match(workflow, /--target-tenant-id "\$TARGET_TENANT_ID"/);
  assert.match(workflow, /--operation-id "\$OPERATION_ID"/);
  assert.match(workflow, /--nonce "\$NONCE"/);
  assert.match(workflow, /--expected-config-hash "\$CONFIG_HASH"/);
  assert.match(handoffJob, /NONCE: \$\{\{ inputs\.nonce \}\}/);
  assert.match(handoffJob, /nonce: process\.env\.NONCE/);
  assert.match(handoffJob, /workflowBlobSha/);
  assert.match(handoffJob, /collectorDigest/);
  assert.match(handoffJob, /async function sourceConfigHash\(\)/);
  assert.match(handoffJob, /\/git\/commits\/\$\{encodeURIComponent\(process\.env\.SOURCE_COMMIT_SHA\)\}/);
  assert.match(handoffJob, /\/git\/trees\/\$\{commit\.tree\.sha\}\?recursive=1/);
  assert.match(handoffJob, /\/git\/blobs\/\$\{entry\.sha\}/);
  assert.match(handoffJob, /Math\.min\(8, sortedEntries\.length\)/);
  assert.match(handoffJob, /blobs\[index\] = \{ path: entry\.path, bytes \}/);
  assert.match(
    handoffJob,
    /MAX_GOVERNED_CONFIG_FILE_BYTES = 10 \* 1024 \* 1024/,
  );
  assert.match(
    handoffJob,
    /MAX_GOVERNED_CONFIG_TOTAL_BYTES = 32 \* 1024 \* 1024/,
  );
  assert.match(handoffJob, /MAX_GOVERNED_CONFIG_FILES = 4096/);
  assert.match(handoffJob, /entry\.size > MAX_GOVERNED_CONFIG_FILE_BYTES/);
  assert.match(handoffJob, /entries\.length >= MAX_GOVERNED_CONFIG_FILES/);
  assert.match(handoffJob, /totalBytes > MAX_GOVERNED_CONFIG_TOTAL_BYTES/);
  assert.doesNotMatch(handoffJob, /entry\.size > 4 \* 1024 \* 1024/);
  assert.doesNotMatch(handoffJob, /Promise\.all\(entries\.sort/);
  assert.match(handoffJob, /src\/eai\.config\/object-types\.provisioning\.json/);
  assert.match(handoffJob, /canonicalConfigHash !== process\.env\.CONFIG_HASH/);
  assert.match(handoffJob, /canonicalConfigHash !== evidence\.configHash/);
  assert.match(handoffJob, /function validateSchemaProvenance\(provenance\)/);
  assert.match(handoffJob, /Array\.isArray\(provenance\)/);
  assert.match(handoffJob, /Object\.keys\(provenance\).*canonicalFields\.has\(key\)/);
  assert.match(handoffJob, /\^sha256:\[a-f0-9\]\{64\}\$/);
  assert.match(handoffJob, /\^\[a-f0-9\]\{40\}\$/);
  assert.match(handoffJob, /provenance\.templateVersion\.trim\(\) !== provenance\.templateVersion/);
  assert.match(handoffJob, /\[\\r\\n\]\/\.test\(value\)/);
  assert.match(handoffJob, /anchors\.some\(\(\[, value\]\) => value !== undefined\)/);
  assert.match(
    handoffJob,
    /const sourceProvenance = validateSchemaProvenance\(runtime\.schemaProvenance\)/,
  );
  assert.match(
    handoffJob,
    /isDeepStrictEqual\(evidence\.schemaProvenance, sourceProvenance\)/,
  );
  assert.match(
    handoffJob,
    /const artifactId = evidence\.imageArtifact\?\.id/,
  );
  assert.match(
    handoffJob,
    /typeof artifactId === 'string' \? Number\(artifactId\) : NaN/,
  );
  assert.match(
    handoffJob,
    /typeof artifactId !== 'string'.*Number\.isSafeInteger\(artifactIdNumber\).*String\(artifactIdNumber\) !== artifactId/,
  );
  assert.match(
    handoffJob,
    /actions\/artifacts\/\$\{encodeURIComponent\(artifactId\)\}/,
  );
  assert.ok(
    handoffJob.indexOf('const artifactId = evidence.imageArtifact?.id') <
      handoffJob.indexOf('const [workflowBytes, collectorBytes'),
  );
  assert.doesNotMatch(
    handoffJob,
    /actions\/artifacts\/\$\{evidence\.imageArtifact\.id\}/,
  );
  assert.match(
    handoffJob,
    /artifact\.id !== Number\(artifactId\)/,
  );
  assert.match(
    handoffJob,
    /artifact\.digest !== evidence\.artifactDigest/,
  );
  assert.doesNotMatch(handoffJob, /sha256:\$\{artifact\.digest\}/);
  assert.match(handoffJob, /execFileSync\('tar', arguments_/);
  assert.doesNotMatch(workflow, /secrets\.EAI_ACCESS_TOKEN|\$EAI_ACCESS_TOKEN/);
  assert.doesNotMatch(buildJob, /GITHUB_TOKEN|NODE_AUTH_TOKEN|_authToken/);
  assert.doesNotMatch(
    buildJob,
    /actions\/cache@|^\s+cache(?:-from|-to)?:\s/m,
  );
  assert.match(handoffJob, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(handoffJob, /^      actions: read$/m);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.doesNotMatch(workflow, /> \.npmrc|>> \.npmrc/);
  assert.match(workflow, /include-hidden-files: true/);
  assert.match(workflow, /actions\/attest-build-provenance@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /name: Verify post-build source integrity/);
  assert.match(workflow, /git diff --exit-code/);
  assert.match(workflow, /git status --porcelain=v1 --untracked-files=all/);
  assert.ok(
    workflow.indexOf('Verify post-build source integrity') <
      workflow.indexOf('Collect immutable build evidence'),
  );
  assert.ok(
    workflow.indexOf('Upload immutable build evidence') <
      workflow.indexOf('  handoff:'),
  );
  assert.ok(
    workflow.indexOf('  handoff:') <
      workflow.indexOf('Request GitHub OIDC token'),
  );
  assert.ok(
    workflow.indexOf('async function sourceConfigHash()') <
      workflow.indexOf('Request GitHub OIDC token'),
  );
  assert.match(
    handoffJob,
    /name: Request GitHub OIDC token and submit workflow evidence/,
  );
  assert.match(handoffJob, /Authorization: Bearer \$token/);
  assert.doesNotMatch(handoffJob, /steps\.github-oidc\.outputs\.token/);
  assert.doesNotMatch(handoffJob, /token=\$token.*GITHUB_OUTPUT/);
  assert.match(handoffJob, /\[\[ "\$EAI_BOUND_PUBLIC_API_URL" =~ \^https:\/\//);
  assert.match(
    handoffJob,
    /if \[\[ "\$SOURCE_MODE" == "eai-cli-generated" \|\| -n "\$TARGET_TENANT_ID" \]\]; then/,
  );
  assert.match(workflow, /--max-redirs 0/);
  assert.match(
    handoffJob,
    /MAX_BUILD_EVIDENCE_BYTES = 1024 \* 1024/,
  );
  assert.match(
    handoffJob,
    /MAX_GITHUB_TREE_RESPONSE_BYTES = 16 \* 1024 \* 1024/,
  );
  assert.match(
    handoffJob,
    /MAX_GITHUB_BLOB_RESPONSE_BYTES = 16 \* 1024 \* 1024/,
  );
  assert.match(handoffJob, /function readBoundedRegularFile\(/);
  assert.match(handoffJob, /async function readBoundedResponseBytes\(/);
  assert.match(handoffJob, /response\.body\.getReader\(\)/);
  assert.match(handoffJob, /value\.byteLength > maxBytes - totalBytes/);
  assert.match(handoffJob, /reader\.cancel\(\)\.catch/);
  assert.match(handoffJob, /readBoundedResponseJson\(/);
  assert.match(handoffJob, /MAX_PRODUCER_SOURCE_BYTES/);
  assert.match(handoffJob, /MAX_GOVERNED_CONFIG_FILE_BYTES/);
  assert.match(
    handoffJob,
    /readBoundedRegularFile\(\s*'\.eai-build\/evidence\/source-unknown-deployment-evidence\.json'/,
  );
  assert.match(handoffJob, /--max-filesize 1048576/);
  assert.match(handoffJob, /process\.stdin\.on\("data"/);
  assert.match(handoffJob, /chunk\.byteLength > maxBytes - totalBytes/);
  assert.match(handoffJob, /fs\.constants\.O_EXCL \| fs\.constants\.O_NOFOLLOW/);
  assert.match(
    handoffJob,
    /EAI_RESPONSE_PATH=\.eai-build\/evidence\/workflow-evidence-response\.json/,
  );
  assert.doesNotMatch(handoffJob, /response="\$\(curl/);
  assert.doesNotMatch(handoffJob, /let s=''; process\.stdin/);
  assert.doesNotMatch(handoffJob, /--output \.eai-build\/evidence/);
  assert.match(
    handoffJob,
    /readBoundedJson\('\.eai-build\/evidence\/workflow-evidence-response\.json'\)/,
  );
  assert.match(handoffJob, /fs\.constants\.O_NOFOLLOW/);
  assert.match(handoffJob, /Deployment handoff response grew during verification/);
  assert.doesNotMatch(handoffJob, /actions\/checkout@/);
  assert.doesNotMatch(
    handoffJob,
    /node scripts\/source-unknown-deployment-evidence\.mjs assert-evidence-accepted/,
  );
  assert.doesNotMatch(handoffJob, /fs\.readFileSync\(/);
  assert.doesNotMatch(handoffJob, /response\.(?:arrayBuffer|json)\(/);
  assert.doesNotMatch(handoffJob, /\|\s*tee /);
  for (const action of workflow.matchAll(/^\s+uses:\s+([^\s#]+)/gm)) {
    assert.match(action[1], /@[a-f0-9]{40}$/);
  }
});

test('reusable workflow compatibility keeps manual same-repository OIDC authority', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const readme = readFileSync(readmePath, 'utf8');
  const dispatchInputs = workflow.slice(
    workflow.indexOf('  workflow_dispatch:'),
    workflow.indexOf('  workflow_call:'),
  );
  const reusableInputs = workflow.slice(
    workflow.indexOf('  workflow_call:'),
    workflow.indexOf('\npermissions:'),
  );
  const invocationGate = workflow.indexOf('name: Validate workflow invocation');
  const checkout = workflow.indexOf('name: Check out repository');
  const configResolution = workflow.indexOf(
    'name: Resolve immutable configuration hash',
  );
  const applicationInstall = workflow.indexOf(
    'name: Install dependencies without running application-controlled scripts',
  );

  assert.match(workflow, /^  workflow_call:/m);
  assert.match(
    workflow,
    /EAI_CALLER_EVENT_NAME: \$\{\{ github\.event_name \}\}/,
  );
  assert.match(
    workflow,
    /if \[\[ "\$EAI_CALLER_EVENT_NAME" != "workflow_dispatch" \]\]; then/,
  );
  assert.ok(invocationGate >= 0 && invocationGate < checkout);
  assert.ok(
    checkout < configResolution && configResolution < applicationInstall,
  );
  assert.match(
    dispatchInputs,
    /config_hash:\n\s+description:[^\n]+\n\s+required: true/,
  );
  assert.match(
    reusableInputs,
    /config_hash:\n\s+description:[^\n]+\n\s+required: false/,
  );
  assert.match(
    reusableInputs,
    /eai_reusable_call:\n\s+description:[^\n]+\n\s+required: false\n\s+type: boolean\n\s+default: true/,
  );
  assert.doesNotMatch(dispatchInputs, /eai_reusable_call:/);
  assert.match(
    workflow,
    /EAI_REUSABLE_CALL: \$\{\{ inputs\.eai_reusable_call \}\}/,
  );
  assert.match(
    workflow,
    /-z "\$REQUESTED_CONFIG_HASH" && "\$EAI_REUSABLE_CALL" != "true"/,
  );
  assert.match(
    workflow,
    /config_hash="\$\(node scripts\/source-unknown-deployment-evidence\.mjs config-hash\)"/,
  );
  assert.match(
    workflow,
    /-n "\$REQUESTED_CONFIG_HASH" && "\$REQUESTED_CONFIG_HASH" != "\$config_hash"/,
  );
  assert.match(
    workflow,
    /CONFIG_HASH: \$\{\{ steps\.deployment-binding\.outputs\.config_hash \}\}/,
  );
  assert.match(
    workflow,
    /CONFIG_HASH: \$\{\{ needs\.build\.outputs\.config_hash \}\}/,
  );
  assert.match(workflow, /workflow_ref/);
  assert.match(workflow, /job_workflow_ref\/job_workflow_sha/);
  assert.doesNotMatch(workflow, /secrets\.EAI_ACCESS_TOKEN|\$EAI_ACCESS_TOKEN/);
  assert.match(readme, /same repository/);
  assert.match(readme, /Cross-repository and cross-ref reusable calls fail/);
  assert.match(readme, /`actions: read`, `attestations: write`, and `id-token: write`/);
});

test('local CLI dispatch binds direct DEV tunnel, original template and numeric repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'eai-cli-local-dispatch-'));
  try {
    writeFixtureApp(root);
    mkdirSync(join(root, '.eai'), { recursive: true });
    const operationId = `cli-managed-${'a'.repeat(32)}`;
    writeFileSync(join(root, '.eai/cli-managed-source-operation.json'), JSON.stringify({
      schemaVersion: 'eai.cli_managed_source_operation.v1',
      sourceMode: 'eai-cli-generated', operationId, environment: 'dev',
      templateCommitSha: 'b'.repeat(40),
    }));
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com',
      'commit', '--allow-empty', '-m', 'fixture'], { cwd: root });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const expiry = new Date(Date.now() + 45 * 60 * 1000).toISOString().replace('Z', '+00:00');
    const args = ['validate-dispatch', '--root', root, '--app-key', 'rates-review',
      '--tenant-id', 'tenant-parent', '--target-tenant-id', 'hosting-tenant',
      '--operation-id', operationId, '--nonce', 'c'.repeat(64),
      '--environment', 'dev', '--expected-config-hash', configHash(root),
      '--commit', commit, '--workflow-sha', commit,
      '--source-mode', 'eai-cli-generated', '--public-api-url',
      'https://careful-8000.eai.devtunnels.ms', '--local-e2e-tunnel', 'true',
      '--local-e2e-expires-at', expiry, '--github-event-name', 'workflow_dispatch',
      '--reusable-call', 'false', '--repository-id', '12345'];
    runEvidenceScript(args);
    for (const [key, value] of [
      ['--public-api-url', 'https://attacker.example'],
      ['--environment', 'test'],
      ['--reusable-call', 'true'],
      ['--github-event-name', 'push'],
      ['--repository-id', '0'],
      ['--local-e2e-expires-at', '2000-01-01T00:00:00+00:00'],
      ['--source-mode', 'source-unknown'],
    ]) {
      const mutated = [...args];
      mutated[mutated.indexOf(key) + 1] = value;
      const result = spawnSync(process.execPath, [evidenceScript, ...mutated], { encoding: 'utf8' });
      assert.equal(result.status, 1, `${key}=${value} must fail`);
    }
    const partial = [...args];
    partial[partial.indexOf('--local-e2e-tunnel') + 1] = 'false';
    assert.equal(spawnSync(process.execPath, [evidenceScript, ...partial], { encoding: 'utf8' }).status, 1);
    const workflow = readFileSync(workflowPath, 'utf8');
    const directInputs = workflow.slice(workflow.indexOf('  workflow_dispatch:'), workflow.indexOf('  workflow_call:'));
    const reusableInputs = workflow.slice(workflow.indexOf('  workflow_call:'), workflow.indexOf('\npermissions:'));
    assert.match(directInputs, /local_e2e_tunnel:/);
    assert.match(directInputs, /local_e2e_expires_at:/);
    assert.doesNotMatch(reusableInputs, /local_e2e_tunnel:|local_e2e_expires_at:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source commit is resolved before checkout for direct and reusable calls', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const stepStart = workflow.indexOf('      - name: Validate workflow invocation');
  const scriptStart = workflow.indexOf('        run: |\n', stepStart);
  const scriptEnd = workflow.indexOf('\n\n      - name: Check out repository', scriptStart);
  assert.ok(stepStart >= 0 && scriptStart > stepStart && scriptEnd > scriptStart);
  const script = workflow
    .slice(scriptStart + '        run: |\n'.length, scriptEnd)
    .replace(/^ {10}/gm, '');
  const callerSha = 'a'.repeat(40);
  const explicitSha = 'b'.repeat(40);
  const runGate = ({ requested = '', reusable = 'false' } = {}) => {
    const workDir = mkdtempSync(join(tmpdir(), 'eai-source-commit-gate-'));
    const outputPath = join(workDir, 'github-output.txt');
    writeFileSync(outputPath, '');
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        EAI_CALLER_EVENT_NAME: 'workflow_dispatch',
        EAI_REQUESTED_COMMIT_SHA: requested,
        EAI_REUSABLE_CALL: reusable,
        EAI_CALLER_COMMIT_SHA: callerSha,
        GITHUB_OUTPUT: outputPath,
      },
    });
    const output = readFileSync(outputPath, 'utf8');
    rmSync(workDir, { recursive: true, force: true });
    return { result, output };
  };

  const direct = runGate({ requested: callerSha });
  assert.equal(direct.result.status, 0, direct.result.stderr);
  assert.equal(direct.output, `source_commit_sha=${callerSha}\n`);

  const mismatchedDirect = runGate({ requested: explicitSha });
  assert.notEqual(mismatchedDirect.result.status, 0);
  assert.match(mismatchedDirect.result.stderr, /signed workflow event SHA/);

  const missingDirect = runGate();
  assert.notEqual(missingDirect.result.status, 0);
  assert.match(missingDirect.result.stderr, /exact lowercase source commit SHA/);

  const malformedDirect = runGate({ requested: 'ABC' });
  assert.notEqual(malformedDirect.result.status, 0);
  assert.match(malformedDirect.result.stderr, /exact lowercase source commit SHA/);

  const reusable = runGate({ reusable: 'true' });
  assert.equal(reusable.result.status, 0, reusable.result.stderr);
  assert.equal(reusable.output, `source_commit_sha=${callerSha}\n`);

  const reusableExplicit = runGate({
    requested: callerSha,
    reusable: 'true',
  });
  assert.equal(reusableExplicit.result.status, 0, reusableExplicit.result.stderr);
  assert.equal(reusableExplicit.output, `source_commit_sha=${callerSha}\n`);

  const mismatchedReusableExplicit = runGate({
    requested: explicitSha,
    reusable: 'true',
  });
  assert.notEqual(mismatchedReusableExplicit.result.status, 0);
  assert.match(
    mismatchedReusableExplicit.result.stderr,
    /signed workflow event SHA/,
  );
});

test('direct dispatch requires a configuration hash while reusable calls may derive it', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const stepStart = workflow.indexOf(
    '      - name: Resolve immutable configuration hash',
  );
  const scriptStart = workflow.indexOf('        run: |\n', stepStart);
  const scriptEnd = workflow.indexOf(
    '\n\n      - name: Validate immutable dispatch',
    scriptStart,
  );
  assert.ok(stepStart >= 0 && scriptStart > stepStart && scriptEnd > scriptStart);
  const script = workflow
    .slice(scriptStart + '        run: |\n'.length, scriptEnd)
    .replace(/^ {10}/gm, '');
  const exactHash = runEvidenceScript(['config-hash', '--root', repoRoot]).trim();
  const runGate = ({ requested = '', reusable = '' } = {}) => {
    const workDir = mkdtempSync(join(tmpdir(), 'eai-config-hash-gate-'));
    const outputPath = join(workDir, 'github-output.txt');
    writeFileSync(outputPath, '');
    try {
      const result = spawnSync('bash', ['-c', script], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          REQUESTED_CONFIG_HASH: requested,
          EAI_REUSABLE_CALL: reusable,
          GITHUB_OUTPUT: outputPath,
        },
      });
      return { result, output: readFileSync(outputPath, 'utf8') };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  };

  const direct = runGate({ requested: exactHash });
  assert.equal(direct.result.status, 0, direct.result.stderr);
  assert.equal(direct.output, `config_hash=${exactHash}\n`);

  const missingDirect = runGate();
  assert.notEqual(missingDirect.result.status, 0);
  assert.match(missingDirect.result.stderr, /server-approved config_hash/);

  const reusable = runGate({ reusable: 'true' });
  assert.equal(reusable.result.status, 0, reusable.result.stderr);
  assert.equal(reusable.output, `config_hash=${exactHash}\n`);

  const mismatched = runGate({ requested: `sha256:${'f'.repeat(64)}` });
  assert.notEqual(mismatched.result.status, 0);
  assert.match(mismatched.result.stderr, /does not match/);
});

test('handoff exact-binds optional target tenant and the current artifact attempt', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const scriptStart = workflow.indexOf(
    "          const { createHash } = require('node:crypto');",
  );
  const scriptEnd = workflow.indexOf(
    '          const evidence = JSON.parse(',
    scriptStart,
  );
  assert.ok(scriptStart >= 0 && scriptEnd > scriptStart);
  const definitions = workflow
    .slice(scriptStart, scriptEnd)
    .replace(/^ {10}/gm, '');
  const bindingScript = `${definitions}\nconst payload = JSON.parse(process.env.EAI_TEST_PAYLOAD);\nassertSourceModeBinding(payload.evidence, payload.sourceMode);\nassertTargetTenantBinding(payload.evidence, payload.targetTenantId);\nassertCurrentUploadBinding(payload.evidence, payload.artifactId);\nassertGitHubArtifactBinding(payload.evidence, payload.artifact, payload.runAttempt, payload.artifactId);\n`;
  const sourceCommit = 'a'.repeat(40);
  const artifactDigest = `sha256:${'d'.repeat(64)}`;
  const valid = {
    sourceMode: 'eai-cli-generated',
    targetTenantId: 'hosting-tenant-1',
    artifactId: '123',
    evidence: {
      sourceMode: 'eai-cli-generated',
      targetTenantId: 'hosting-tenant-1',
      artifactDigest,
      imageArtifact: { name: 'eai-generated-app-image' },
    },
    artifact: {
      id: 123,
      name: 'eai-generated-app-image',
      digest: artifactDigest,
      workflow_run: {
        id: 456,
        repository_id: 789,
        head_repository_id: 789,
        head_sha: sourceCommit,
      },
    },
    runAttempt: {
      id: 456,
      run_attempt: 2,
      head_sha: sourceCommit,
      event: 'workflow_dispatch',
      repository: { id: 789 },
    },
  };
  const runBinding = (payload, environment = {}) =>
    spawnSync(process.execPath, ['-e', bindingScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        EAI_TEST_PAYLOAD: JSON.stringify(payload),
        BUILD_IMAGE_ARTIFACT_ID: '123',
        BUILD_IMAGE_ARTIFACT_DIGEST: 'd'.repeat(64),
        GITHUB_REPOSITORY_ID: '789',
        GITHUB_RUN_ID: '456',
        GITHUB_RUN_ATTEMPT: '2',
        SOURCE_COMMIT_SHA: sourceCommit,
        ...environment,
      },
    });

  const accepted = runBinding(valid);
  assert.equal(accepted.status, 0, accepted.stderr);
  const acceptedAbsentTarget = runBinding({
    ...valid,
    sourceMode: 'source-unknown',
    targetTenantId: '',
    evidence: {
      ...valid.evidence,
      sourceMode: undefined,
      targetTenantId: undefined,
    },
  });
  assert.equal(acceptedAbsentTarget.status, 0, acceptedAbsentTarget.stderr);

  for (const [name, payload, environment, pattern] of [
    [
      'unexpected target tenant',
      { ...valid, targetTenantId: '' },
      {},
      /target tenant/,
    ],
    [
      'missing target tenant',
      {
        ...valid,
        evidence: { ...valid.evidence, targetTenantId: undefined },
      },
      {},
      /target tenant/,
    ],
    [
      'falsey noncanonical source mode',
      {
        ...valid,
        sourceMode: 'source-unknown',
        evidence: { ...valid.evidence, sourceMode: '' },
      },
      {},
      /source mode/,
    ],
    [
      'missing generated source mode',
      { ...valid, evidence: { ...valid.evidence, sourceMode: undefined } },
      {},
      /source mode/,
    ],
    [
      'prior artifact output',
      valid,
      { BUILD_IMAGE_ARTIFACT_ID: '122' },
      /current upload step/,
    ],
    [
      'wrong artifact source',
      {
        ...valid,
        artifact: {
          ...valid.artifact,
          workflow_run: {
            ...valid.artifact.workflow_run,
            head_sha: 'b'.repeat(40),
          },
        },
      },
      {},
      /artifact metadata/,
    ],
    [
      'wrong run attempt',
      { ...valid, runAttempt: { ...valid.runAttempt, run_attempt: 1 } },
      {},
      /run attempt/,
    ],
    [
      'wrong caller event',
      {
        ...valid,
        runAttempt: { ...valid.runAttempt, event: 'workflow_call' },
      },
      {},
      /run attempt/,
    ],
  ]) {
    const rejected = runBinding(payload, environment);
    assert.notEqual(rejected.status, 0, name);
    assert.match(rejected.stderr, pattern, name);
  }
});

test('OIDC response parser bounds unknown-length input before token retention', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const oidcStep = workflow.slice(
    workflow.indexOf('name: Request GitHub OIDC token and submit workflow evidence'),
    workflow.indexOf('name: Assert evidence accepted'),
  );
  const scriptMatch = oidcStep.match(
    /bounded_response_reader='\n([\s\S]*?)\n\s{10}'\n\s{10}audience=/,
  );
  assert.ok(scriptMatch, 'expected inline bounded OIDC response parser');
  const parser = scriptMatch[1];
  const token = 'header.payload.signature';
  const accepted = spawnSync(process.execPath, ['-e', parser, 'token'], {
    input: JSON.stringify({ value: token }),
    encoding: 'utf8',
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.stdout, token);

  const oversized = spawnSync(process.execPath, ['-e', parser, 'token'], {
    input: Buffer.alloc(1024 * 1024 + 1, 0x61),
    encoding: 'utf8',
  });
  assert.notEqual(oversized.status, 0);
  assert.match(oversized.stderr, /exceeds its 1 MiB limit/);

  const multiline = spawnSync(process.execPath, ['-e', parser, 'token'], {
    input: JSON.stringify({ value: 'header.payload.signature\ninjected' }),
    encoding: 'utf8',
  });
  assert.notEqual(multiline.status, 0);
  assert.match(multiline.stderr, /canonical JWT/);
});

test('handoff response writer bounds unknown-length input and creates no-follow output', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const oidcStep = workflow.slice(
    workflow.indexOf('name: Request GitHub OIDC token and submit workflow evidence'),
    workflow.indexOf('name: Assert evidence accepted'),
  );
  const scriptMatch = oidcStep.match(
    /bounded_response_reader='\n([\s\S]*?)\n\s{10}'\n\s{10}audience=/,
  );
  assert.ok(scriptMatch, 'expected inline bounded response reader');
  const parser = scriptMatch[1];
  const workDir = mkdtempSync(join(tmpdir(), 'eai-bounded-handoff-'));
  try {
    const responsePath = join(realpathSync(workDir), 'response.json');
    const acceptedBody = '{"status":"accepted"}';
    const accepted = spawnSync(process.execPath, ['-e', parser, 'file'], {
      input: acceptedBody,
      encoding: 'utf8',
      env: { ...process.env, EAI_RESPONSE_PATH: responsePath },
    });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(readFileSync(responsePath, 'utf8'), acceptedBody);

    const oversizedPath = join(realpathSync(workDir), 'oversized.json');
    const oversized = spawnSync(process.execPath, ['-e', parser, 'file'], {
      input: Buffer.alloc(1024 * 1024 + 1, 0x61),
      encoding: 'utf8',
      env: { ...process.env, EAI_RESPONSE_PATH: oversizedPath },
    });
    assert.notEqual(oversized.status, 0);
    assert.match(oversized.stderr, /Deployment handoff response exceeds its 1 MiB limit/);
    assert.ok(readFileSync(oversizedPath).byteLength <= 1024 * 1024);

    const linkedPath = join(realpathSync(workDir), 'linked.json');
    const linkedTarget = join(realpathSync(workDir), 'linked-target.json');
    writeFileSync(linkedTarget, 'unchanged');
    symlinkSync(linkedTarget, linkedPath);
    const linked = spawnSync(process.execPath, ['-e', parser, 'file'], {
      input: acceptedBody,
      encoding: 'utf8',
      env: { ...process.env, EAI_RESPONSE_PATH: linkedPath },
    });
    assert.notEqual(linked.status, 0);
    assert.equal(readFileSync(linkedTarget, 'utf8'), 'unchanged');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('handoff binds the bounded OCI archive and referenced manifest bytes', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const handoffJob = workflow.slice(workflow.indexOf('  handoff:'));
  const archiveInspector = handoffJob.slice(
    handoffJob.indexOf('function inspectOciArchive('),
    handoffJob.indexOf('const expected = {'),
  );

  assert.match(
    handoffJob,
    /MAX_IMAGE_ARCHIVE_BYTES = 10 \* 1024 \* 1024 \* 1024/,
  );
  assert.match(archiveInspector, /fs\.constants\.O_NOFOLLOW/);
  assert.match(archiveInspector, /fs\.constants\.O_NONBLOCK/);
  assert.match(archiveInspector, /before\.size > maxBytes/);
  assert.match(archiveInspector, /Buffer\.allocUnsafe\(1024 \* 1024\)/);
  assert.match(archiveInspector, /while \(offset < opened\.size\)/);
  assert.match(archiveInspector, /fs\.readSync\(descriptor, buffer/);
  assert.match(archiveInspector, /growthProbe = Buffer\.allocUnsafe\(1\)/);
  assert.match(
    archiveInspector,
    /fs\.readSync\(descriptor, growthProbe, 0, 1, offset\)/,
  );
  assert.match(
    archiveInspector,
    /stdio: \['ignore', 'pipe', 'pipe', descriptor\]/,
  );
  assert.match(archiveInspector, /'\/proc\/self\/fd\/3'/);
  assert.match(archiveInspector, /timeout: TAR_TIMEOUT_MS/);
  assert.match(handoffJob, /TAR_TIMEOUT_MS = 10 \* 60 \* 1000/);
  assert.match(archiveInspector, /maxBuffer: outputLimit \+ 1/);
  assert.match(archiveInspector, /entries\.length !== 1/);
  assert.match(archiveInspector, /'--occurrence=1', '--file'/);
  assert.doesNotMatch(workflow, /--fast-read/);
  assert.match(archiveInspector, /extractBoundedRegularEntry\('oci-layout'/);
  assert.match(
    archiveInspector,
    /blobs\/sha256\/\$\{imageManifest\.digest\.slice/,
  );
  assert.match(
    archiveInspector,
    /manifestBytes\.length !== imageManifest\.size/,
  );
  assert.match(
    archiveInspector,
    /createHash\('sha256'\)\.update\(manifestBytes\)/,
  );
  assert.match(archiveInspector, /manifestDigest !== expectedImageDigest/);
  assert.match(archiveInspector, /function assertOciDescriptor\(/);
  assert.match(archiveInspector, /function verifyReferencedOciBlobs\(/);
  assert.match(archiveInspector, /assertOciDescriptor\(manifest\.config/);
  assert.match(
    archiveInspector,
    /manifest\.layers\.length > MAX_OCI_LAYER_COUNT/,
  );
  assert.match(
    archiveInspector,
    /'--extract', '--verbose', '--quoting-style=escape', '--to-command', validatorCommand/,
  );
  assert.match(archiveInspector, /process\.env\.TAR_FILETYPE !== 'f'/);
  assert.match(archiveInspector, /bytesRead !== descriptor\.size/);
  assert.match(archiveInspector, /process\.stdout\.write\('verified:' \+ filename/);
  assert.match(archiveInspector, /EAI_OCI_EXPECTED_BLOB_TABLE/);
  assert.match(archiveInspector, /encodedExpectedTable/);
  assert.match(
    archiveInspector,
    /Buffer\.byteLength\(encodedExpectedTable\) > MAX_OCI_EXPECTED_BLOB_TABLE_BYTES/,
  );
  assert.doesNotMatch(archiveInspector, /JSON\.stringify\(expected\)/);
  assert.match(
    archiveInspector,
    /verifyReferencedOciBlobs\(\[configDescriptor, \.\.\.layerDescriptors\]\)/,
  );
  assert.match(archiveInspector, /assertArchiveBinding\(\)/);
  assert.doesNotMatch(
    handoffJob,
    /fs\.readFileSync\('\.eai-build\/eai-generated-app-image\.tar'/,
  );
  assert.doesNotMatch(
    archiveInspector,
    /execFileSync\('tar'.*\.eai-build\/eai-generated-app-image\.tar/,
  );

  const maximumCompactTable = Array.from(
    { length: 1025 },
    (_, index) =>
      `${index.toString(16).padStart(64, '0')}:${10 * 1024 * 1024 * 1024}`,
  ).join('\n');
  assert.ok(
    Buffer.byteLength(Buffer.from(maximumCompactTable).toString('base64')) <=
      112 * 1024,
  );
  const maximumValidationOutputBytes =
    1025 *
    (Buffer.byteLength(`blobs/sha256/${'0'.repeat(64)}\n`) +
      Buffer.byteLength(`verified:blobs/sha256/${'0'.repeat(64)}\n`));
  assert.equal(maximumValidationOutputBytes, 169125);
  assert.match(
    handoffJob,
    /MAX_OCI_BLOB_PATH_BYTES = Buffer\.byteLength\('blobs\/sha256\/'\) \+ 64/,
  );
  assert.match(
    handoffJob,
    /MAX_OCI_BLOB_MEMBER_RECORD_BYTES = MAX_OCI_BLOB_PATH_BYTES \+ 1/,
  );
  assert.match(
    handoffJob,
    /MAX_OCI_BLOB_VERIFIED_RECORD_BYTES = Buffer\.byteLength\('verified:'\) \+ MAX_OCI_BLOB_PATH_BYTES \+ 1/,
  );
  assert.match(
    handoffJob,
    /MAX_OCI_BLOB_VALIDATION_OUTPUT_BYTES = \(MAX_OCI_LAYER_COUNT \+ 1\) \* \(MAX_OCI_BLOB_MEMBER_RECORD_BYTES \+ MAX_OCI_BLOB_VERIFIED_RECORD_BYTES\)/,
  );
});

test(
  'handoff verifies the actual OCI manifest blob selected by the index',
  { skip: process.platform !== 'linux' },
  () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    const scriptStart = workflow.indexOf(
      "          const { createHash } = require('node:crypto');",
    );
    const scriptEnd = workflow.indexOf(
      '          const evidence = JSON.parse(',
      scriptStart,
    );
    assert.ok(scriptStart >= 0 && scriptEnd > scriptStart);
    const definitions = workflow
      .slice(scriptStart, scriptEnd)
      .replace(/^ {10}/gm, '');
    const inspectScript = `${definitions}\nconst result = inspectOciArchive(process.argv[1], MAX_IMAGE_ARCHIVE_BYTES, process.argv[2]);\nprocess.stdout.write(JSON.stringify(result));\n`;
    const workDir = realpathSync(
      mkdtempSync(join(tmpdir(), 'eai-oci-manifest-')),
    );
    const mediaType = 'application/vnd.oci.image.manifest.v1+json';
    const configBytes = Buffer.from('{"architecture":"amd64","os":"linux"}');
    const layerBytes = Buffer.from('compressed layer fixture');
    const configDigest = `sha256:${createHash('sha256').update(configBytes).digest('hex')}`;
    const layerDigest = `sha256:${createHash('sha256').update(layerBytes).digest('hex')}`;
    const validManifestValue = {
      schemaVersion: 2,
      mediaType,
      config: {
        mediaType: 'application/vnd.oci.image.config.v1+json',
        digest: configDigest,
        size: configBytes.length,
      },
      layers: [
        {
          mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
          digest: layerDigest,
          size: layerBytes.length,
        },
      ],
    };
    const validManifest = Buffer.from(JSON.stringify(validManifestValue));
    const validDigest = `sha256:${createHash('sha256').update(validManifest).digest('hex')}`;

    const createArchive = (
      name,
      {
        blobBytes = validManifest,
        descriptorDigest = `sha256:${createHash('sha256').update(blobBytes).digest('hex')}`,
        includeBlob = true,
        includeLayout = true,
        omitReferencedDigest,
        substituteReferencedDigest,
        linkReferencedDigest,
      } = {},
    ) => {
      const contentRoot = join(workDir, `${name}-root`);
      const blobPath = join(
        contentRoot,
        'blobs/sha256',
        descriptorDigest.slice('sha256:'.length),
      );
      mkdirSync(dirname(blobPath), { recursive: true });
      if (includeBlob) writeFileSync(blobPath, blobBytes);
      for (const [digest, bytes] of [
        [configDigest, configBytes],
        [layerDigest, layerBytes],
      ]) {
        if (digest === omitReferencedDigest) continue;
        const referencedPath = join(
          contentRoot,
          'blobs/sha256',
          digest.slice('sha256:'.length),
        );
        if (digest === linkReferencedDigest) {
          const linkTarget = join(contentRoot, `${digest.slice(-12)}.target`);
          writeFileSync(linkTarget, bytes);
          symlinkSync(linkTarget, referencedPath);
        } else {
          writeFileSync(
            referencedPath,
            digest === substituteReferencedDigest
              ? Buffer.from('substituted')
              : bytes,
          );
        }
      }
      if (includeLayout) {
        writeFileSync(
          join(contentRoot, 'oci-layout'),
          JSON.stringify({ imageLayoutVersion: '1.0.0' }),
        );
      }
      writeFileSync(
        join(contentRoot, 'index.json'),
        JSON.stringify({
          schemaVersion: 2,
          manifests: [
            {
              mediaType,
              digest: descriptorDigest,
              size: blobBytes.length,
              platform: { os: 'linux', architecture: 'amd64' },
            },
          ],
        }),
      );
      const archivePath = join(workDir, `${name}.tar`);
      execFileSync('tar', [
        '-cf',
        archivePath,
        '-C',
        contentRoot,
        ...(includeLayout ? ['oci-layout'] : []),
        'index.json',
        'blobs',
      ]);
      return { archivePath, descriptorDigest };
    };
    const inspect = ({ archivePath, descriptorDigest }) =>
      spawnSync(
        process.execPath,
        ['-e', inspectScript, archivePath, descriptorDigest],
        {
          encoding: 'utf8',
        },
      );

    try {
      const validArchive = createArchive('valid');
      const valid = inspect(validArchive);
      assert.equal(valid.status, 0, valid.stderr);
      const result = JSON.parse(valid.stdout);
      assert.equal(result.imageDigest, validDigest);
      assert.match(result.archiveDigest, digestPattern);

      const substitutedArchive = createArchive('substituted', {
        blobBytes: Buffer.from(
          JSON.stringify({ ...validManifestValue, layers: [{}] }),
        ),
        descriptorDigest: validDigest,
      });
      const substituted = inspect(substitutedArchive);
      assert.equal(substituted.status, 1);
      assert.match(
        substituted.stderr,
        /manifest bytes do not match build evidence/,
      );

      const missingArchive = createArchive('missing', { includeBlob: false });
      const missing = inspect(missingArchive);
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /Command failed: tar/);

      const missingLayout = inspect(
        createArchive('missing-layout', { includeLayout: false }),
      );
      assert.equal(missingLayout.status, 1);
      assert.match(missingLayout.stderr, /Command failed: tar/);

      const missingReferenced = inspect(
        createArchive('missing-referenced', {
          omitReferencedDigest: configDigest,
        }),
      );
      assert.equal(missingReferenced.status, 1);
      assert.match(missingReferenced.stderr, /Command failed: tar/);

      const substitutedReferenced = inspect(
        createArchive('substituted-referenced', {
          substituteReferencedDigest: configDigest,
        }),
      );
      assert.equal(substitutedReferenced.status, 1);
      assert.match(substitutedReferenced.stderr, /Command failed: tar/);

      const linkedReferenced = inspect(
        createArchive('linked-referenced', {
          linkReferencedDigest: configDigest,
        }),
      );
      assert.equal(linkedReferenced.status, 1);
      assert.match(
        linkedReferenced.stderr,
        /referenced blobs are missing, nonregular, or duplicated/,
      );

      const malformedManifests = [
        ['missing-config', { ...validManifestValue, config: undefined }],
        ['missing-layers', { ...validManifestValue, layers: undefined }],
        [
          'mixed-media-family',
          {
            ...validManifestValue,
            config: {
              ...validManifestValue.config,
              mediaType: 'application/vnd.docker.container.image.v1+json',
            },
          },
        ],
        [
          'invalid-layer-digest',
          {
            ...validManifestValue,
            layers: [
              {
                ...validManifestValue.layers[0],
                digest: `sha256:${'A'.repeat(64)}`,
              },
            ],
          },
        ],
        [
          'too-many-layers',
          {
            ...validManifestValue,
            layers: Array.from(
              { length: 1025 },
              () => validManifestValue.layers[0],
            ),
          },
        ],
      ];
      for (const [name, value] of malformedManifests) {
        const malformed = inspect(
          createArchive(name, {
            blobBytes: Buffer.from(JSON.stringify(value)),
          }),
        );
        assert.equal(malformed.status, 1, `${name}: ${malformed.stderr}`);
        assert.match(
          malformed.stderr,
          /OCI image (?:configuration|layers|layer)/,
        );
      }

      const duplicateReferencedArchive = createArchive('duplicate-referenced');
      const duplicateReferencedRoot = join(
        workDir,
        'duplicate-referenced-root',
      );
      const duplicateReferencedPath = join(
        duplicateReferencedRoot,
        'blobs/sha256',
        configDigest.slice('sha256:'.length),
      );
      mkdirSync(dirname(duplicateReferencedPath), { recursive: true });
      writeFileSync(duplicateReferencedPath, configBytes);
      execFileSync('tar', [
        '-rf',
        duplicateReferencedArchive.archivePath,
        '-C',
        duplicateReferencedRoot,
        `blobs/sha256/${configDigest.slice('sha256:'.length)}`,
      ]);
      const duplicateReferenced = inspect(duplicateReferencedArchive);
      assert.equal(duplicateReferenced.status, 1);
      assert.match(
        duplicateReferenced.stderr,
        /referenced blobs are missing, nonregular, or duplicated/,
      );

      const mixedDuplicateArchive = createArchive('mixed-duplicate');
      const mixedDuplicateRoot = join(workDir, 'mixed-duplicate-root');
      const mixedDuplicatePath = join(
        mixedDuplicateRoot,
        'blobs/sha256',
        configDigest.slice('sha256:'.length),
      );
      mkdirSync(dirname(mixedDuplicatePath), { recursive: true });
      const mixedDuplicateTarget = join(mixedDuplicateRoot, 'target');
      writeFileSync(mixedDuplicateTarget, configBytes);
      rmSync(mixedDuplicatePath);
      symlinkSync(mixedDuplicateTarget, mixedDuplicatePath);
      execFileSync('tar', [
        '-rf',
        mixedDuplicateArchive.archivePath,
        '-C',
        mixedDuplicateRoot,
        `blobs/sha256/${configDigest.slice('sha256:'.length)}`,
      ]);
      const mixedDuplicate = inspect(mixedDuplicateArchive);
      assert.equal(mixedDuplicate.status, 1);
      assert.match(
        mixedDuplicate.stderr,
        /referenced blobs are missing, nonregular, or duplicated/,
      );

      const duplicateRoot = join(workDir, 'duplicate-root');
      mkdirSync(duplicateRoot);
      writeFileSync(join(duplicateRoot, 'index.json'), '{}');
      execFileSync('tar', [
        '-rf',
        validArchive.archivePath,
        '-C',
        duplicateRoot,
        'index.json',
      ]);
      const duplicate = inspect(validArchive);
      assert.equal(duplicate.status, 1);
      assert.match(duplicate.stderr, /must be one regular archive entry/);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  },
);

test('dispatch accepts only trusted endpoints and the exact source and workflow identity', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-dispatch-validation-'));
  try {
    writeFixtureApp(workDir);
    execFileSync('git', ['init', '-q'], { cwd: workDir });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.com',
        'commit',
        '--allow-empty',
        '-m',
        'fixture',
      ],
      { cwd: workDir },
    );
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: workDir,
      encoding: 'utf8',
    }).trim();
    const binding = dispatchBindingArgs(workDir);
    for (const host of [
      'api.au',
      'api.ca',
      'api.eu',
      'test-api.au',
      'test-api.ca',
      'test-api.eu',
      'dev-api.au',
    ]) {
      runEvidenceScript([
        'validate-dispatch',
        '--root',
        workDir,
        ...binding,
        '--commit',
        commit,
        '--workflow-sha',
        commit,
        '--public-api-url',
        `https://${host}.myenterprise.ai/public`,
      ]);
    }
    for (const endpoint of [
      'https://attacker.example/public',
      'https://api.au.myenterprise.ai.attacker.example/public',
      'http://api.au.myenterprise.ai/public',
      'https://api.au.myenterprise.ai:8443/public',
      'https://user@api.au.myenterprise.ai/public',
      'https://api.au.myenterprise.ai/public?redirect=bad',
      'https://api.au.myenterprise.ai/public#fragment',
      'https://api.au.myenterprise.ai/other',
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          evidenceScript,
          'validate-dispatch',
          '--root',
          workDir,
          ...binding,
          '--commit',
          commit,
          '--workflow-sha',
          commit,
          '--public-api-url',
          endpoint,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /trusted EAI regional PublicAPI/);
    }
    for (const [sourceCommit, workflowSha] of [
      ['a'.repeat(40), commit],
      [commit, 'b'.repeat(40)],
      ['main', commit],
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          evidenceScript,
          'validate-dispatch',
          '--root',
          workDir,
          ...binding,
          '--commit',
          sourceCommit,
          '--workflow-sha',
          workflowSha,
          '--public-api-url',
          'https://api.au.myenterprise.ai/public',
        ],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /source, and workflow identity must match/);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('CLI dispatch rejects an incomplete or malformed signed grant before the build', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-cli-dispatch-validation-'));
  try {
    writeFixtureApp(workDir);
    execFileSync('git', ['init', '-q'], { cwd: workDir });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.com',
        'commit',
        '--allow-empty',
        '-m',
        'fixture',
      ],
      { cwd: workDir },
    );
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: workDir,
      encoding: 'utf8',
    }).trim();
    const args = [
      'validate-dispatch',
      '--root',
      workDir,
      '--source-mode',
      'eai-cli-generated',
      '--app-key',
      'demo',
      '--tenant-id',
      'company-1',
      '--target-tenant-id',
      'hosting-tenant-1',
      '--operation-id',
      'cli-managed-' + 'a'.repeat(32),
      '--nonce',
      'b'.repeat(64),
      '--expected-config-hash',
      configHash(workDir),
      '--environment',
      'preview',
      '--public-api-url',
      'https://dev-api.au.myenterprise.ai/public',
      '--commit',
      commit,
      '--workflow-sha',
      commit,
    ];
    runEvidenceScript(args);
    const outputPath = join(workDir, 'dispatch-outputs');
    for (const environment of ['preview', 'dev', 'test', 'prod']) {
      writeFileSync(outputPath, '');
      const selected = [...args, '--github-output', outputPath];
      selected[selected.indexOf('--environment') + 1] = environment;
      runEvidenceScript(selected);
      assert.equal(readFileSync(outputPath, 'utf8'),
        `deployment_environment=${environment}\ngithub_environment=eai-generated-${environment}\n`);
    }
    for (const [flag, invalidValue, message] of [
      ['--operation-id', '../other', /safe operationId path segment/],
      ['--nonce', 'short', /exact signed nonce/],
      ['--expected-config-hash', 'not-a-hash', /approved sha256 config hash/],
      ['--environment', 'production', /approved deployment environment/],
      ['--environment', 'demo', /GitHub deployment requires preview, dev, test, or prod/],
      ['--app-key', 'other/app', /canonical app key/],
      ['--app-key', '1other', /canonical app key/],
      ['--app-key', 'Other', /canonical app key/],
    ]) {
      writeFileSync(outputPath, '');
      const altered = [...args, '--github-output', outputPath];
      altered[altered.indexOf(flag) + 1] = invalidValue;
      const result = spawnSync(process.execPath, [evidenceScript, ...altered], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
      assert.equal(readFileSync(outputPath, 'utf8'), '', 'rejected dispatch must not select an OIDC environment');
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('workflow runs independent validations concurrently and waits for both', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const buildStepStart = workflow.indexOf(
    '      - name: Build OCI image archive',
  );
  const buildStepEnd = workflow.indexOf(
    '\n\n      - name: Verify post-build source integrity',
    buildStepStart,
  );
  assert.ok(buildStepStart >= 0 && buildStepEnd > buildStepStart);
  const buildStep = workflow.slice(buildStepStart, buildStepEnd);

  assert.match(workflow, /npm run typecheck &\n\s+typecheck_pid=\$!/);
  assert.match(workflow, /npm run test:unit:ci &\n\s+tests_pid=\$!/);
  assert.match(workflow, /wait "\$typecheck_pid" \|\| validation_status=1/);
  assert.match(workflow, /wait "\$tests_pid" \|\| validation_status=1/);
  assert.match(workflow, /exit "\$validation_status"/);
  assert.match(
    workflow,
    /\[\[ "\$APP_KEY" =~ \^\[a-z\]\[a-z0-9-\]\{1,62\}\$ \]\]/,
  );
  assert.match(
    buildStep,
    /--output type=oci,dest=-[\s\S]*\| node scripts\/source-unknown-deployment-evidence\.mjs write-image-archive/,
  );
  assert.match(buildStep, /run: \|\n\s+set -euo pipefail/);
  assert.doesNotMatch(buildStep, /--metadata-file/);
  const pipefail = spawnSync('bash', ['-c', 'set -euo pipefail\nfalse | cat'], {
    encoding: 'utf8',
  });
  assert.notEqual(pipefail.status, 0);
});

test('workflow uploads only the staged image archive and binds its digest', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const buildOffset = workflow.indexOf('- name: Build OCI image archive');
  const uploadOffset = workflow.indexOf(
    '- name: Upload immutable image artifact',
  );
  const collectOffset = workflow.indexOf(
    '- name: Collect immutable build evidence',
  );

  assert.ok(buildOffset >= 0);
  assert.ok(uploadOffset > buildOffset);
  assert.ok(collectOffset > uploadOffset);
  assert.match(
    workflow,
    /write-image-archive[\s\S]*--staging-root "\$IMAGE_STAGING_ROOT"[\s\S]*--github-output "\$GITHUB_OUTPUT"/,
  );
  assert.match(
    workflow,
    /path: \$\{\{ steps\.built-image\.outputs\.image_archive_path \}\}/,
  );
  assert.match(
    workflow,
    /STAGED_ARCHIVE_DIGEST: \$\{\{ steps\.built-image\.outputs\.archive_digest \}\}/,
  );
  assert.match(
    workflow,
    /IMAGE_DIGEST: \$\{\{ steps\.built-image\.outputs\.image_digest \}\}/,
  );
  assert.match(
    workflow,
    /--image-archive "\$STAGED_IMAGE_ARCHIVE"[\s\S]*--image-staging-root "\$IMAGE_STAGING_ROOT"[\s\S]*--expected-archive-digest "\$STAGED_ARCHIVE_DIGEST"/,
  );
});

test(
  'image archive writer binds Buildx stdout to a bounded exclusive file',
  { skip: process.platform !== 'linux' },
  () => {
    const workDir = realpathSync(
      mkdtempSync(join(tmpdir(), 'eai-image-stream-writer-')),
    );
    try {
      const stagingRoot = join(workDir, 'runner-temp');
      const outputPath = join(workDir, 'github-output.txt');
      const protectedPath = join(workDir, 'protected.txt');
      const preload = join(workDir, 'rebind-image-output.cjs');
      mkdirSync(stagingRoot);
      writeFileSync(outputPath, '');
      writeFileSync(protectedPath, 'protected bytes\n');
      const fixture = createMinimalOciArchive(workDir, 'stream-source');
      const archiveBytes = readFileSync(fixture.archivePath);

      const valid = spawnSync(
        process.execPath,
        [
          evidenceScript,
          'write-image-archive',
          '--staging-root',
          stagingRoot,
          '--github-output',
          outputPath,
        ],
        { input: archiveBytes, encoding: 'utf8' },
      );
      assert.equal(valid.status, 0, valid.stderr);
      const result = JSON.parse(valid.stdout);
      assert.equal(readFileSync(result.imageArchivePath).equals(archiveBytes), true);
      assert.equal(lstatSync(result.imageArchivePath).nlink, 1);
      assert.equal(result.imageDigest, fixture.imageDigest);
      assert.equal(
        result.archiveDigest,
        `sha256:${createHash('sha256').update(archiveBytes).digest('hex')}`,
      );
      const outputs = readFileSync(outputPath, 'utf8');
      assert.match(outputs, /^image_archive_path=/m);
      assert.match(outputs, new RegExp(`^image_digest=${fixture.imageDigest}$`, 'm'));

      const empty = spawnSync(
        process.execPath,
        [evidenceScript, 'write-image-archive', '--staging-root', stagingRoot],
        { input: Buffer.alloc(0), encoding: 'utf8' },
      );
      assert.notEqual(empty.status, 0);
      assert.match(empty.stderr, /changed during its bound write/);

      writeFileSync(
        preload,
        String.raw`
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalOpenSync = fs.openSync;
const originalWriteSync = fs.writeSync;
let outputPath;
let rebound = false;
fs.openSync = function patchedOpenSync(path, ...args) {
  const descriptor = originalOpenSync.call(fs, path, ...args);
  if (!outputPath && String(path).endsWith('eai-generated-app-image.tar')) {
    outputPath = String(path);
  }
  return descriptor;
};
fs.writeSync = function patchedWriteSync(descriptor, ...args) {
  if (!rebound && outputPath) {
    rebound = true;
    fs.unlinkSync(outputPath);
    fs.symlinkSync(process.env.EAI_TEST_PROTECTED_PATH, outputPath);
  }
  return originalWriteSync.call(fs, descriptor, ...args);
};
syncBuiltinESMExports();
`,
      );
      const rebound = spawnSync(
        process.execPath,
        [evidenceScript, 'write-image-archive', '--staging-root', stagingRoot],
        {
          input: archiveBytes,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_OPTIONS: `--require=${preload}`,
            EAI_TEST_PROTECTED_PATH: protectedPath,
          },
        },
      );
      assert.notEqual(rebound.status, 0);
      assert.match(rebound.stderr, /changed during its bound write/);
      assert.equal(readFileSync(protectedPath, 'utf8'), 'protected bytes\n');

      const implementation = readFileSync(evidenceScript, 'utf8');
      const writerStart = implementation.indexOf('async function writeImageArchive(');
      const writerEnd = implementation.indexOf(
        '\nfunction assertCommandFileBinding(',
        writerStart,
      );
      const writer = implementation.slice(writerStart, writerEnd);
      assert.match(writer, /written \+ chunk\.length > MAX_IMAGE_ARCHIVE_BYTES/);
      assert.match(writer, /constants\.O_RDWR \| constants\.O_CREAT \| constants\.O_EXCL/);
      assert.match(writer, /current\.nlink !== 1/);
      assert.doesNotMatch(writer, /rmSync|unlinkSync/);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  },
);

test('artifact staging creates a private bound copy used by evidence', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-image-staging-'));
  try {
    const fixtureRoot = join(workDir, 'app');
    const stagingRoot = join(workDir, 'runner-temp');
    const outputFile = join(workDir, 'github-output.txt');
    writeFixtureApp(fixtureRoot);
    mkdirSync(stagingRoot);

    const sourcePath = join(
      fixtureRoot,
      '.eai-build/eai-generated-app-image.tar',
    );
    const sourceBytes = readFileSync(sourcePath);
    const expectedDigest = `sha256:${createHash('sha256')
      .update(sourceBytes)
      .digest('hex')}`;
    const staged = JSON.parse(
      runEvidenceScript([
        'stage-image-artifact',
        '--root',
        fixtureRoot,
        '--staging-root',
        stagingRoot,
        '--github-output',
        outputFile,
      ]),
    );

    const stagedRelativePath = relative(stagingRoot, staged.imageArchivePath);
    assert.notEqual(staged.imageArchivePath, sourcePath);
    assert.equal(isAbsolute(stagedRelativePath), false);
    assert.notEqual(stagedRelativePath, '');
    assert.equal(stagedRelativePath.startsWith('..'), false);
    assert.deepEqual(readFileSync(staged.imageArchivePath), sourceBytes);
    assert.equal(staged.archiveDigest, expectedDigest);
    assert.equal(staged.size, sourceBytes.length);

    const outputs = readFileSync(outputFile, 'utf8');
    assert.match(
      outputs,
      new RegExp(`^image_archive_path=${staged.imageArchivePath}$`, 'm'),
    );
    assert.match(
      outputs,
      new RegExp(`^archive_digest=${expectedDigest}$`, 'm'),
    );
    assert.match(
      outputs,
      new RegExp(`^archive_size=${sourceBytes.length}$`, 'm'),
    );

    writeFileSync(staged.imageArchivePath, 'substituted archive\n');
    const substituted = spawnSync(
      process.execPath,
      [
        evidenceScript,
        ...sourceUnknownCollectArgs(fixtureRoot),
        '--image-archive',
        staged.imageArchivePath,
        '--image-staging-root',
        stagingRoot,
        '--expected-archive-digest',
        staged.archiveDigest,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(substituted.status, 1);
    assert.match(substituted.stderr, /does not match its bound copy/);
    writeFileSync(staged.imageArchivePath, sourceBytes);

    runEvidenceScript([
      ...sourceUnknownCollectArgs(fixtureRoot),
      '--image-archive',
      staged.imageArchivePath,
      '--image-staging-root',
      stagingRoot,
      '--expected-archive-digest',
      staged.archiveDigest,
    ]);
    const evidence = JSON.parse(
      readFileSync(
        join(
          fixtureRoot,
          '.eai-build/evidence/source-unknown-deployment-evidence.json',
        ),
        'utf8',
      ),
    );
    assert.equal(evidence.imageArtifact.archiveDigest, expectedDigest);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('image context pins the runtime minimum Node image by immutable digest', () => {
  const workDir = mkdtempSync(
    join(tmpdir(), 'eai-source-unknown-image-context-'),
  );
  try {
    const fixtureRoot = join(workDir, 'app');
    writeFixtureApp(fixtureRoot);
    rmSync(join(fixtureRoot, '.eai-build/eai-generated-app-image.tar'));
    runEvidenceScript(['prepare-image-context', '--root', fixtureRoot]);
    assert.match(
      readFileSync(
        join(fixtureRoot, '.eai-build/image-context/Dockerfile'),
        'utf8',
      ),
      /^FROM node:24-alpine@sha256:[a-f0-9]{64}$/m,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test(
  'image context rejects nested links in standalone, static, and public trees',
  { skip: process.platform === 'win32' },
  () => {
    const cases = [
      [
        '.next/standalone/nested/linked.js',
        '.eai-build/image-context/nested/linked.js',
      ],
      [
        '.next/static/nested/linked.js',
        '.eai-build/image-context/.next/static/nested/linked.js',
      ],
      [
        'public/nested/linked.txt',
        '.eai-build/image-context/public/nested/linked.txt',
      ],
    ];
    for (const [sourceRelative, destinationRelative] of cases) {
      const workDir = mkdtempSync(join(tmpdir(), 'eai-linked-image-source-'));
      try {
        const root = join(workDir, 'app');
        const outside = join(workDir, 'outside.txt');
        writeFixtureApp(root);
        writeFileSync(outside, 'outside must not be copied\n');
        mkdirSync(dirname(join(root, sourceRelative)), { recursive: true });
        symlinkSync(outside, join(root, sourceRelative));

        const result = spawnSync(
          process.execPath,
          [evidenceScript, 'prepare-image-context', '--root', root],
          { encoding: 'utf8' },
        );
        assert.equal(result.status, 1);
        assert.match(result.stderr, /cannot contain a symlink/);
        assert.equal(existsSync(join(root, destinationRelative)), false);
        assert.equal(
          readFileSync(outside, 'utf8'),
          'outside must not be copied\n',
        );
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    }
  },
);

test('image context rejects an application-controlled linked build-output root', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-linked-build-root-'));
  try {
    const root = join(workDir, 'app');
    const outside = join(workDir, 'outside');
    writeFixtureApp(root);
    mkdirSync(outside);
    rmSync(join(root, '.eai-build'), { recursive: true });
    symlinkSync(outside, join(root, '.eai-build'), 'dir');

    const result = spawnSync(
      process.execPath,
      [evidenceScript, 'prepare-image-context', '--root', root],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must not contain links|no-follow directory/);
    assert.equal(existsSync(join(outside, 'image-context/Dockerfile')), false);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('image context rejects outside hard links in each captured source tree', () => {
  for (const [sourceRelative, destinationRelative] of [
    ['.next/standalone/linked.js', '.eai-build/image-context/linked.js'],
    ['.next/static/linked.js', '.eai-build/image-context/.next/static/linked.js'],
    ['public/linked.txt', '.eai-build/image-context/public/linked.txt'],
  ]) {
    const workDir = mkdtempSync(join(tmpdir(), 'eai-hard-linked-image-source-'));
    try {
      const root = join(workDir, 'app');
      const outside = join(workDir, 'outside.txt');
      const source = join(root, sourceRelative);
      writeFixtureApp(root);
      writeFileSync(outside, 'outside must not enter the image\n');
      mkdirSync(dirname(source), { recursive: true });
      linkSync(outside, source);

      const result = spawnSync(
        process.execPath,
        [evidenceScript, 'prepare-image-context', '--root', root],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 1, sourceRelative);
      assert.match(result.stderr, /single-link regular files/);
      assert.equal(existsSync(join(root, destinationRelative)), false);
      assert.equal(readFileSync(outside, 'utf8'), 'outside must not enter the image\n');
      assert.equal(result.stdout, '');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
});

test('image preparation rejects a preexisting context without deleting it', () => {
  for (const relativePath of ['.eai-build/image-context']) {
    const workDir = mkdtempSync(join(tmpdir(), 'eai-preexisting-output-'));
    try {
      const root = join(workDir, 'app');
      writeFixtureApp(root);
      const output = join(root, relativePath);
      if (relativePath.endsWith('image-context')) {
        mkdirSync(output, { recursive: true });
        writeFileSync(join(output, 'sentinel'), 'unchanged');
      } else {
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, 'unchanged');
      }
      const result = spawnSync(
        process.execPath,
        [evidenceScript, 'prepare-image-context', '--root', root],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /must not exist before isolated image preparation/);
      if (relativePath.endsWith('image-context')) {
        assert.equal(readFileSync(join(output, 'sentinel'), 'utf8'), 'unchanged');
      } else {
        assert.equal(readFileSync(output, 'utf8'), 'unchanged');
      }
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
});

test('image preparation never truncates a hard-linked generated output', () => {
  const workDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'eai-hard-linked-image-output-')),
  );
  try {
    const root = join(workDir, 'app');
    const protectedPath = join(workDir, 'protected.txt');
    const dockerfilePath = join(
      root,
      '.eai-build/image-context/Dockerfile',
    );
    const preload = join(workDir, 'hard-link-image-output.cjs');
    writeFixtureApp(root);
    writeFileSync(protectedPath, 'protected bytes\n');
    writeFileSync(
      preload,
      String.raw`
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalOpenSync = fs.openSync;
let linked = false;
fs.openSync = function patchedOpenSync(path, ...args) {
  const target = process.env.EAI_TEST_IMAGE_OUTPUT_PATH;
  if (!linked && target && String(path) === target) {
    linked = true;
    fs.linkSync(process.env.EAI_TEST_PROTECTED_PATH, target);
  }
  return originalOpenSync.call(fs, path, ...args);
};
syncBuiltinESMExports();
`,
    );

    const result = spawnSync(
      process.execPath,
      [evidenceScript, 'prepare-image-context', '--root', root],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preload}`,
          EAI_TEST_IMAGE_OUTPUT_PATH: dockerfilePath,
          EAI_TEST_PROTECTED_PATH: protectedPath,
        },
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /EEXIST|file already exists/);
    assert.equal(readFileSync(protectedPath, 'utf8'), 'protected bytes\n');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('collector error paths do not unlink a copy destination after parent validation fails', () => {
  const implementation = readFileSync(evidenceScript, 'utf8');
  const copyStart = implementation.indexOf('function copyRegularTreeNoFollow(');
  const copyEnd = implementation.indexOf('\nfunction writeRegularFileNoFollow(', copyStart);
  assert.ok(copyStart >= 0 && copyEnd > copyStart);
  const copy = implementation.slice(copyStart, copyEnd);
  assert.doesNotMatch(copy, /rmSync\(destinationPath/);
  assert.doesNotMatch(implementation, /rmSync\(path(?:,|\))/);
});

test('image-tree copies bind each source ancestor and final path through the read', () => {
  const implementation = readFileSync(evidenceScript, 'utf8');
  const copyStart = implementation.indexOf('function copyRegularTreeNoFollow(');
  const copyEnd = implementation.indexOf('\nfunction writeRegularFileNoFollow(', copyStart);
  assert.ok(copyStart >= 0 && copyEnd > copyStart);
  const copy = implementation.slice(copyStart, copyEnd);
  assert.match(copy, /snapshotAbsoluteDirectoryPath\(\s*dirname\(sourcePath\),\s*label/);
  assert.equal(
    (copy.match(/assertAbsoluteDirectorySnapshot\(sourceAncestors, label\)/g) || [])
      .length,
    2,
  );
  assert.match(copy, /sourceRebound\.ino !== opened\.ino/);
  assert.match(copy, /before\.nlink !== 1/);
  assert.match(copy, /opened\.nlink !== 1/);
  assert.match(copy, /sourceRebound\.nlink !== 1/);
  assert.match(copy, /opened\.mtimeMs !== before\.mtimeMs/);
  assert.match(copy, /opened\.ctimeMs !== before\.ctimeMs/);
  assert.match(copy, /sourceRebound\.mtimeMs !== opened\.mtimeMs/);
  assert.match(copy, /sourceRebound\.ctimeMs !== opened\.ctimeMs/);
  assert.match(copy, /sourcePathAfter\.ino !== opened\.ino/);
  assert.match(copy, /sourcePathAfter\.nlink !== 1/);
  assert.match(copy, /after\.nlink !== 1/);
  assert.match(copy, /sourcePathAfter\.mtimeMs !== opened\.mtimeMs/);
  assert.match(copy, /sourcePathAfter\.ctimeMs !== opened\.ctimeMs/);
  assert.match(copy, /after\.mtimeMs !== opened\.mtimeMs/);
  assert.match(copy, /destinationAfter\.nlink !== 1/);
  assert.match(copy, /destinationAfter\.size !== copied/);
  assert.match(copy, /destinationPathAfter\.nlink !== 1/);
  assert.match(copy, /destinationPathAfter\.size !== copied/);
  assert.match(copy, /realpathSync\(sourcePath\)/);
});

test('generated and evidence writers bind exact size and single-link identity', () => {
  const implementation = readFileSync(evidenceScript, 'utf8');
  const generatedStart = implementation.indexOf(
    'function writeRegularFileNoFollow(',
  );
  const evidenceStart = implementation.indexOf(
    'function writeEvidenceFileNoFollow(',
    generatedStart,
  );
  const evidenceEnd = implementation.indexOf(
    '\nfunction assertExists(',
    evidenceStart,
  );
  assert.ok(
    generatedStart >= 0 &&
      evidenceStart > generatedStart &&
      evidenceEnd > evidenceStart,
  );
  const generated = implementation.slice(generatedStart, evidenceStart);
  const evidence = implementation.slice(evidenceStart, evidenceEnd);
  for (const writer of [generated, evidence]) {
    assert.match(writer, /const bytes = Buffer\.from\(content, 'utf8'\)/);
    assert.match(writer, /after\.isFile\(\)/);
    assert.match(writer, /after\.nlink !== 1/);
    assert.match(writer, /after\.size !== expectedBytes/);
    assert.match(writer, /finalPath\.nlink !== 1/);
    assert.match(writer, /finalPath\.size !== expectedBytes/);
  }
  assert.match(evidence, /bytes\.length > MAX_BUILD_EVIDENCE_BYTES/);

  const stagingStart = implementation.indexOf('function stageImageArtifact(');
  const stagingEnd = implementation.indexOf('\nfunction digestFiles(', stagingStart);
  const staging = implementation.slice(stagingStart, stagingEnd);
  assert.match(staging, /destinationAfter\.nlink !== 1/);
  assert.match(staging, /destinationPathAfter\.nlink !== 1/);
});

test('image preparation rejects destination growth after bound writes', () => {
  for (const targetKind of ['copy', 'generated']) {
    const workDir = realpathSync(
      mkdtempSync(join(tmpdir(), `eai-image-destination-${targetKind}-`)),
    );
    try {
      const root = join(workDir, 'app');
      const preload = join(workDir, 'grow-image-destination.cjs');
      const target = join(
        root,
        targetKind === 'copy'
          ? '.eai-build/image-context/server.js'
          : '.eai-build/image-context/Dockerfile',
      );
      writeFixtureApp(root);
      writeFileSync(
        preload,
        String.raw`
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalOpenSync = fs.openSync;
const originalWriteSync = fs.writeSync;
const originalWriteFileSync = fs.writeFileSync;
let targetDescriptor;
let mutated = false;
fs.openSync = function patchedOpenSync(path, ...args) {
  const descriptor = originalOpenSync.call(fs, path, ...args);
  if (String(path) === process.env.EAI_TEST_DESTINATION_PATH) {
    targetDescriptor = descriptor;
  }
  return descriptor;
};
function mutate(path) {
  if (!mutated) {
    mutated = true;
    fs.appendFileSync(path, 'x');
  }
}
fs.writeSync = function patchedWriteSync(descriptor, ...args) {
  const result = originalWriteSync.call(fs, descriptor, ...args);
  if (descriptor === targetDescriptor) mutate(process.env.EAI_TEST_DESTINATION_PATH);
  return result;
};
fs.writeFileSync = function patchedWriteFileSync(path, ...args) {
  const result = originalWriteFileSync.call(fs, path, ...args);
  if (path === targetDescriptor) mutate(process.env.EAI_TEST_DESTINATION_PATH);
  return result;
};
syncBuiltinESMExports();
`,
      );
      const result = spawnSync(
        process.execPath,
        [evidenceScript, 'prepare-image-context', '--root', root],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_OPTIONS: `--require=${preload}`,
            EAI_TEST_DESTINATION_PATH: target,
          },
        },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /changed during its bound write/);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
});

test('image tree and archive staging reject same-size rewrites before open', () => {
  const workDir = realpathSync(mkdtempSync(join(tmpdir(), 'eai-copy-pre-open-')));
  try {
    const preload = join(workDir, 'rewrite-source-before-open.cjs');
    writeFileSync(
      preload,
      String.raw`
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalOpenSync = fs.openSync;
const originalCloseSync = fs.closeSync;
const originalWriteSync = fs.writeSync;
let rewritten = false;
fs.openSync = function patchedOpenSync(path, ...args) {
  const target = process.env.EAI_TEST_SOURCE_REWRITE_PATH;
  if (!rewritten && target && String(path) === target) {
    rewritten = true;
    const length = fs.readFileSync(target).length;
    const writer = originalOpenSync.call(
      fs,
      target,
      fs.constants.O_WRONLY | fs.constants.O_TRUNC,
    );
    try {
      originalWriteSync.call(fs, writer, Buffer.alloc(length, 0x78));
    } finally {
      originalCloseSync.call(fs, writer);
    }
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(target, future, future);
  }
  return originalOpenSync.call(fs, path, ...args);
};
syncBuiltinESMExports();
`,
    );

    const treeRoot = join(workDir, 'tree-app');
    writeFixtureApp(treeRoot);
    const treeTarget = join(treeRoot, '.next/standalone/server.js');
    const treeResult = spawnSync(
      process.execPath,
      [evidenceScript, 'prepare-image-context', '--root', treeRoot],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preload}`,
          EAI_TEST_SOURCE_REWRITE_PATH: treeTarget,
        },
      },
    );
    assert.equal(treeResult.status, 1);
    assert.match(treeResult.stderr, /changed before its no-follow copy/);

    const archiveRoot = join(workDir, 'archive-app');
    const stagingRoot = join(workDir, 'runner-temp');
    writeFixtureApp(archiveRoot);
    mkdirSync(stagingRoot);
    const archiveTarget = join(
      archiveRoot,
      '.eai-build/eai-generated-app-image.tar',
    );
    const archiveResult = spawnSync(
      process.execPath,
      [
        evidenceScript,
        'stage-image-artifact',
        '--root',
        archiveRoot,
        '--staging-root',
        stagingRoot,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preload}`,
          EAI_TEST_SOURCE_REWRITE_PATH: archiveTarget,
        },
      },
    );
    assert.equal(archiveResult.status, 1);
    assert.match(archiveResult.stderr, /changed before staging/);

    const digestRoot = join(workDir, 'digest-app');
    writeFixtureApp(digestRoot);
    const digestTarget = join(
      digestRoot,
      '.eai-build/eai-generated-app-image.tar',
    );
    const digestResult = spawnSync(
      process.execPath,
      [evidenceScript, ...sourceUnknownCollectArgs(digestRoot)],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preload}`,
          EAI_TEST_SOURCE_REWRITE_PATH: digestTarget,
        },
      },
    );
    assert.equal(digestResult.status, 1);
    assert.match(digestResult.stderr, /changed before its bounded digest/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('archive staging binds source timestamps from pre-open through final path', () => {
  const implementation = readFileSync(evidenceScript, 'utf8');
  const digestStart = implementation.indexOf('async function digestFile(');
  const start = implementation.indexOf('function stageImageArtifact(');
  const end = implementation.indexOf('\nfunction digestFiles(', start);
  assert.ok(digestStart >= 0 && start > digestStart && end > start);
  const digest = implementation.slice(digestStart, start);
  const staging = implementation.slice(start, end);
  for (const reader of [digest, staging]) {
    assert.match(reader, /opened\.mtimeMs !== before\.mtimeMs/);
    assert.match(reader, /opened\.ctimeMs !== before\.ctimeMs/);
  }
  assert.match(digest, /rebound\.mtimeMs !== opened\.mtimeMs/);
  assert.match(digest, /rebound\.ctimeMs !== opened\.ctimeMs/);
  assert.match(digest, /finalPath\.mtimeMs !== opened\.mtimeMs/);
  assert.match(digest, /finalPath\.ctimeMs !== opened\.ctimeMs/);
  assert.match(digest, /Buffer\.allocUnsafe\(BOUNDED_READ_BUFFER_BYTES\)/);
  assert.match(digest, /while \(digested < opened\.size\)/);
  assert.match(digest, /readSync\(descriptor, growthProbe, 0, 1, digested\)/);
  assert.doesNotMatch(implementation, /createReadStream/);
  assert.match(staging, /opened\.mtimeMs !== before\.mtimeMs/);
  assert.match(staging, /opened\.ctimeMs !== before\.ctimeMs/);
  assert.match(staging, /sourceRebound\.mtimeMs !== opened\.mtimeMs/);
  assert.match(staging, /sourceRebound\.ctimeMs !== opened\.ctimeMs/);
  assert.match(staging, /sourcePathAfter\.mtimeMs !== opened\.mtimeMs/);
  assert.match(staging, /sourcePathAfter\.ctimeMs !== opened\.ctimeMs/);
});

test(
  'image digest is derived from a bounded no-follow OCI archive',
  { skip: process.platform !== 'linux' },
  () => {
    const workDir = mkdtempSync(join(tmpdir(), 'eai-image-digest-'));
    try {
      const root = join(workDir, 'app');
      const outside = join(workDir, 'outside');
      writeFixtureApp(root);
      const fixture = createMinimalOciArchive(workDir, 'digest-source');
      cpSync(
        fixture.archivePath,
        join(root, '.eai-build/eai-generated-app-image.tar'),
        { force: true },
      );
      assert.equal(
        runEvidenceScript(['read-image-digest', '--root', root]).trim(),
        fixture.imageDigest,
      );

      mkdirSync(outside);
      cpSync(
        fixture.archivePath,
        join(outside, 'eai-generated-app-image.tar'),
      );
      rmSync(join(root, '.eai-build'), { recursive: true });
      symlinkSync(outside, join(root, '.eai-build'), 'dir');
      const linked = spawnSync(
        process.execPath,
        [evidenceScript, 'read-image-digest', '--root', root],
        { encoding: 'utf8' },
      );
      assert.equal(linked.status, 1);
      assert.match(linked.stderr, /no-follow directory tree/);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  },
);

test('bounded collector reads bind parent and leaf identity through the read', () => {
  const implementation = readFileSync(evidenceScript, 'utf8');
  const descriptorStart = implementation.indexOf(
    'function readExactBoundedDescriptor(',
  );
  const start = implementation.indexOf('function readBoundedRegularFileNoFollow(');
  const end = implementation.indexOf('\nfunction readImageDigest(', start);
  assert.ok(descriptorStart >= 0 && start > descriptorStart && end > start);
  const descriptorReader = implementation.slice(descriptorStart, start);
  const reader = implementation.slice(start, end);
  assert.match(descriptorReader, /Buffer\.allocUnsafe\(BOUNDED_READ_BUFFER_BYTES\)/);
  assert.match(descriptorReader, /readSync\(\s*descriptor,\s*buffer/);
  assert.match(descriptorReader, /readSync\(descriptor, growthProbe, 0, 1, offset\)/);
  assert.match(descriptorReader, /grew during its bounded read/);
  assert.doesNotMatch(implementation, /readFileSync\(descriptor\)/);
  assert.match(reader, /snapshotAbsoluteDirectoryPath\(dirname\(path\), label\)/);
  assert.equal(
    (reader.match(/assertAbsoluteDirectorySnapshot\(ancestors, label\)/g) || []).length,
    2,
  );
  assert.match(reader, /rebound\.dev !== opened\.dev/);
  assert.match(reader, /after\.mtimeMs !== opened\.mtimeMs/);
  assert.match(reader, /finalPath\.ino !== opened\.ino/);
  assert.match(reader, /bytes\.length !== opened\.size/);
});

test('collector requires no-follow and nonblocking open capabilities centrally', () => {
  const implementation = readFileSync(evidenceScript, 'utf8');
  const openCount = (implementation.match(/\bopenSync\(/g) || []).length;
  const strictGuardedOpenCount =
    (implementation.match(/\bnoFollowOpenFlags\(/g) || []).length - 2;
  const governedConfigOpenCount =
    (implementation.match(/\bgovernedConfigReadOpenFlags\(/g) || []).length - 1;
  assert.match(implementation, /function requiredOpenFlag\(name\)/);
  assert.match(implementation, /Number\.isSafeInteger\(flag\) \|\| flag <= 0/);
  assert.match(implementation, /requiredOpenFlag\('O_NOFOLLOW'\)/);
  assert.match(implementation, /requiredOpenFlag\('O_NONBLOCK'\)/);
  assert.match(implementation, /function governedConfigReadOpenFlags\(/);
  assert.match(
    implementation,
    /allowWindowsValidatedFallback && process\.platform === 'win32'/,
  );
  assert.equal(strictGuardedOpenCount + governedConfigOpenCount, openCount);
  assert.doesNotMatch(implementation, /O_NOFOLLOW\s*(?:\|\||\?\?)/);
  assert.doesNotMatch(implementation, /O_NONBLOCK\s*(?:\|\||\?\?)/);

  const workDir = realpathSync(mkdtempSync(join(tmpdir(), 'eai-open-flags-')));
  try {
    const root = join(workDir, 'app');
    const copiedScript = join(workDir, 'evidence.mjs');
    const fakeFs = join(workDir, 'fake-fs.mjs');
    writeFixtureApp(root);
    writeFileSync(
      fakeFs,
      String.raw`
import { createRequire } from 'node:module';
const fs = createRequire(import.meta.url)('node:fs');
const mutableConstants = { ...fs.constants };
delete mutableConstants[process.env.EAI_TEST_MISSING_OPEN_FLAG];
export const constants = Object.freeze(mutableConstants);
export const closeSync = fs.closeSync;
export const existsSync = fs.existsSync;
export const fstatSync = fs.fstatSync;
export const lstatSync = fs.lstatSync;
export const mkdtempSync = fs.mkdtempSync;
export const mkdirSync = fs.mkdirSync;
export const readSync = fs.readSync;
export const realpathSync = fs.realpathSync;
export const readdirSync = fs.readdirSync;
export const writeSync = fs.writeSync;
export const writeFileSync = fs.writeFileSync;
export function openSync() {
  throw new Error('openSync must not run without required secure flags.');
}
`,
    );
    writeFileSync(
      copiedScript,
      implementation.replace("from 'node:fs';", "from './fake-fs.mjs';"),
    );
    for (const missingFlag of ['O_NOFOLLOW', 'O_NONBLOCK']) {
      const result = spawnSync(
        process.execPath,
        [copiedScript, 'config-hash', '--root', root],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            EAI_TEST_MISSING_OPEN_FLAG: missingFlag,
          },
        },
      );
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        new RegExp(`Secure file opens require ${missingFlag} support`),
      );
      assert.doesNotMatch(result.stderr, /openSync must not run/);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('Windows local config hashing uses only its validated read fallback', () => {
  const implementation = readFileSync(evidenceScript, 'utf8');
  const workDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'eai-windows-config-open-')),
  );
  try {
    const root = join(workDir, 'app');
    const deploymentRoot = join(workDir, 'deployment-app');
    const copiedScript = join(workDir, 'evidence.mjs');
    const fakeFs = join(workDir, 'fake-fs.mjs');
    const windowsPlatform = join(workDir, 'windows-platform.cjs');
    writeFixtureApp(root);
    writeFixtureApp(deploymentRoot);
    writeFileSync(
      windowsPlatform,
      "Object.defineProperty(process, 'platform', { value: 'win32' });\n",
    );
    writeFileSync(
      fakeFs,
      String.raw`
import { createRequire } from 'node:module';
const fs = createRequire(import.meta.url)('node:fs');
const mutableConstants = { ...fs.constants };
delete mutableConstants.O_NOFOLLOW;
delete mutableConstants.O_NONBLOCK;
export const constants = Object.freeze(mutableConstants);
export const closeSync = fs.closeSync;
export const existsSync = fs.existsSync;
export const fstatSync = fs.fstatSync;
export const lstatSync = fs.lstatSync;
export const mkdtempSync = fs.mkdtempSync;
export const mkdirSync = fs.mkdirSync;
export const openSync = fs.openSync;
export const readSync = fs.readSync;
export const realpathSync = fs.realpathSync;
export const readdirSync = fs.readdirSync;
export const writeSync = fs.writeSync;
export const writeFileSync = fs.writeFileSync;
`,
    );
    writeFileSync(
      copiedScript,
      implementation.replace("from 'node:fs';", "from './fake-fs.mjs';"),
    );
    const env = {
      ...process.env,
      NODE_OPTIONS: `--require=${windowsPlatform}`,
    };

    const valid = spawnSync(
      process.execPath,
      [copiedScript, 'config-hash', '--root', root],
      { encoding: 'utf8', env },
    );
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout.trim(), digestPattern);

    const outsideRuntime = join(workDir, 'outside-runtime.json');
    writeFileSync(outsideRuntime, readFileSync(join(root, 'eai.runtime.json')));
    rmSync(join(root, 'eai.runtime.json'));
    symlinkSync(outsideRuntime, join(root, 'eai.runtime.json'));
    const linked = spawnSync(
      process.execPath,
      [copiedScript, 'config-hash', '--root', root],
      { encoding: 'utf8', env },
    );
    assert.equal(linked.status, 1);
    assert.match(
      linked.stderr,
      /Governed configuration must be a regular file/,
    );

    const deployment = spawnSync(
      process.execPath,
      [copiedScript, 'prepare-image-context', '--root', deploymentRoot],
      { encoding: 'utf8', env },
    );
    assert.equal(deployment.status, 1);
    assert.match(
      deployment.stderr,
      /Secure file opens require O_NOFOLLOW support/,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('bounded collector reads reject post-open growth and archive shrinkage', () => {
  const workDir = realpathSync(mkdtempSync(join(tmpdir(), 'eai-bounded-growth-')));
  try {
    const root = join(workDir, 'app');
    const preload = join(workDir, 'grow-after-open.cjs');
    writeFixtureApp(root);
    writeFileSync(
      preload,
      String.raw`
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalOpenSync = fs.openSync;
const originalCloseSync = fs.closeSync;
const originalFtruncateSync = fs.ftruncateSync;
const originalReadSync = fs.readSync;
const originalWriteSync = fs.writeSync;
let targetDescriptor;
let mutated = false;
fs.openSync = function patchedOpenSync(path, ...args) {
  const descriptor = originalOpenSync.call(fs, path, ...args);
  if (
    targetDescriptor === undefined &&
    process.env.EAI_TEST_MUTATE_PATH &&
    String(path) === process.env.EAI_TEST_MUTATE_PATH
  ) {
    targetDescriptor = descriptor;
  }
  return descriptor;
};
fs.readSync = function patchedReadSync(descriptor, ...args) {
  if (!mutated && descriptor === targetDescriptor) {
    mutated = true;
    const writer = originalOpenSync.call(
      fs,
      process.env.EAI_TEST_MUTATE_PATH,
      fs.constants.O_WRONLY |
        (process.env.EAI_TEST_MUTATION === 'truncate' ? 0 : fs.constants.O_APPEND),
    );
    try {
      if (process.env.EAI_TEST_MUTATION === 'truncate') {
        originalFtruncateSync.call(
          fs,
          writer,
          Math.max(0, fs.fstatSync(writer).size - 1),
        );
      } else {
        originalWriteSync.call(fs, writer, Buffer.from('x'));
      }
    } finally {
      originalCloseSync.call(fs, writer);
    }
  }
  return originalReadSync.call(fs, descriptor, ...args);
};
syncBuiltinESMExports();
`,
    );

    const configPath = join(root, 'eai.runtime.json');
    const config = spawnSync(
      process.execPath,
      [evidenceScript, 'config-hash', '--root', root],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preload}`,
          EAI_TEST_MUTATE_PATH: configPath,
        },
      },
    );
    assert.equal(config.status, 1);
    assert.match(config.stderr, /grew during its bounded read/);

    const archivePath = join(
      root,
      '.eai-build/eai-generated-app-image.tar',
    );
    const growingArchive = spawnSync(
      process.execPath,
      [evidenceScript, ...sourceUnknownCollectArgs(root)],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preload}`,
          EAI_TEST_MUTATE_PATH: archivePath,
        },
      },
    );
    assert.equal(growingArchive.status, 1);
    assert.match(growingArchive.stderr, /grew during its bounded digest/);

    const shrinkingArchive = spawnSync(
      process.execPath,
      [evidenceScript, ...sourceUnknownCollectArgs(root)],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preload}`,
          EAI_TEST_MUTATE_PATH: archivePath,
          EAI_TEST_MUTATION: 'truncate',
        },
      },
    );
    assert.equal(shrinkingArchive.status, 1);
    assert.match(shrinkingArchive.stderr, /shrank during its bounded digest/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

for (const [operation, phase] of [
  'response-read',
  'archive-digest',
  'archive-stage',
].flatMap((operation) =>
  ['during-read', 'between-final-snapshots'].map((phase) => [operation, phase]),
)) {
  test(`${operation} rejects ${phase} hard links even with unchanged timestamp snapshots`, () => {
    const workDir = realpathSync(
      mkdtempSync(join(tmpdir(), 'eai-post-open-source-link-')),
    );
    try {
      const root = join(workDir, 'app');
      const preload = join(workDir, 'link-after-read.cjs');
      const alias = join(workDir, 'external-alias');
      writeFixtureApp(root);
      const target =
        operation === 'response-read'
          ? join(workDir, 'response.json')
          : join(root, '.eai-build/eai-generated-app-image.tar');
      if (operation === 'response-read') {
        writeFileSync(
          target,
          JSON.stringify({
            status: 'accepted',
            deploymentRequestId: 'source-unknown-deploy-1',
            requiresTenantInfra: false,
          }),
        );
      }
      writeFileSync(
        preload,
        String.raw`
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalOpenSync = fs.openSync;
const originalReadSync = fs.readSync;
const originalFstatSync = fs.fstatSync;
const originalLstatSync = fs.lstatSync;
const target = process.env.EAI_TEST_SOURCE_LINK_PATH;
const before = originalLstatSync.call(fs, target);
let descriptorToLink;
let linked = false;
let hasRead = false;
function unchangedTimestamp(status) {
  if (status.dev === before.dev && status.ino === before.ino) {
    // Model coarse filesystem timestamp snapshots; the real link count remains visible.
    status.ctimeMs = before.ctimeMs;
  }
  return status;
}
fs.openSync = function patchedOpenSync(path, ...args) {
  const descriptor = originalOpenSync.call(fs, path, ...args);
  if (String(path) === target) descriptorToLink = descriptor;
  return descriptor;
};
fs.readSync = function patchedReadSync(descriptor, ...args) {
  const result = originalReadSync.call(fs, descriptor, ...args);
  if (descriptor === descriptorToLink && result > 0) {
    hasRead = true;
    if (!linked && process.env.EAI_TEST_SOURCE_LINK_PHASE === 'during-read') {
      linked = true;
      fs.linkSync(target, process.env.EAI_TEST_SOURCE_LINK_ALIAS);
    }
  }
  return result;
};
fs.fstatSync = function patchedFstatSync(descriptor, ...args) {
  const status = originalFstatSync.call(fs, descriptor, ...args);
  if (
    !linked && hasRead && descriptor === descriptorToLink &&
    process.env.EAI_TEST_SOURCE_LINK_PHASE === 'between-final-snapshots'
  ) {
    linked = true;
    fs.linkSync(target, process.env.EAI_TEST_SOURCE_LINK_ALIAS);
  }
  return unchangedTimestamp(status);
};
fs.lstatSync = function patchedLstatSync(path, ...args) {
  return unchangedTimestamp(originalLstatSync.call(fs, path, ...args));
};
syncBuiltinESMExports();
`,
      );
      const args =
        operation === 'response-read'
          ? ['assert-evidence-accepted', '--response', target]
          : operation === 'archive-digest'
            ? sourceUnknownCollectArgs(root)
            : [
                'stage-image-artifact',
                '--root',
                root,
                '--staging-root',
                workDir,
              ];
      const result = spawnSync(process.execPath, [evidenceScript, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preload}`,
          EAI_TEST_SOURCE_LINK_PATH: target,
          EAI_TEST_SOURCE_LINK_ALIAS: alias,
          EAI_TEST_SOURCE_LINK_PHASE: phase,
        },
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /changed during its (?:bounded|bound)/);
      assert.equal(result.stdout, '');
      assert.equal(lstatSync(target).nlink, 2);
      assert.equal(lstatSync(alias).ino, lstatSync(target).ino);
      assert.equal(existsSync(join(root, '.eai-build/evidence')), false);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
}

test('governed configuration reads enforce the explicit per-file cap', () => {
  const workDir = realpathSync(mkdtempSync(join(tmpdir(), 'eai-config-cap-')));
  try {
    const root = join(workDir, 'app');
    const target = join(root, 'eai.runtime.json');
    writeFixtureApp(root);
    truncateSync(target, 10 * 1024 * 1024 + 1);
    const result = spawnSync(
      process.execPath,
      [evidenceScript, 'config-hash', '--root', root],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /bounded regular file/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('governed configuration accepts 4-10 MiB files and enforces the shared total cap', () => {
  const workDir = realpathSync(mkdtempSync(join(tmpdir(), 'eai-config-bounds-')));
  try {
    const acceptedRoot = join(workDir, 'accepted');
    writeFixtureApp(acceptedRoot);
    const accepted = join(acceptedRoot, 'src/eai.config/large.config.ts');
    writeFileSync(accepted, 'x');
    truncateSync(accepted, 5 * 1024 * 1024);
    assert.match(configHash(acceptedRoot), digestPattern);

    const oversizedRoot = join(workDir, 'oversized');
    writeFixtureApp(oversizedRoot);
    for (let index = 0; index < 4; index += 1) {
      const path = join(oversizedRoot, `src/eai.config/large-${index}.ts`);
      writeFileSync(path, 'x');
      truncateSync(path, 9 * 1024 * 1024);
    }
    const result = spawnSync(
      process.execPath,
      [evidenceScript, 'config-hash', '--root', oversizedRoot],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /manifest exceeds its byte limit/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('configuration hashing repeats inventory and binds each post-read path', () => {
  const implementation = readFileSync(evidenceScript, 'utf8');
  const hashStart = implementation.indexOf('function buildConfigHash(');
  const hashEnd = implementation.indexOf('\nfunction prepareImageContext(', hashStart);
  const readerStart = implementation.indexOf('function readRegularFileNoFollow(');
  const readerEnd = implementation.indexOf('\nfunction optionalLstat(', readerStart);
  assert.ok(hashStart >= 0 && hashEnd > hashStart && readerStart >= 0 && readerEnd > readerStart);
  const hash = implementation.slice(hashStart, hashEnd);
  const reader = implementation.slice(readerStart, readerEnd);
  assert.equal((hash.match(/listGovernedConfigFiles\(root\)/g) || []).length, 2);
  assert.match(hash, /paths\.some\(\(path, index\) => path !== finalPaths\[index\]\)/);
  assert.match(reader, /assertRelativeDirectorySnapshot\(ancestors, relativePath\)/);
  assert.match(reader, /finalPath\.ino !== opened\.ino/);
  assert.match(reader, /opened\.size !== before\.size/);
  assert.match(reader, /opened\.mtimeMs !== before\.mtimeMs/);
  assert.match(reader, /opened\.ctimeMs !== before\.ctimeMs/);
  assert.match(reader, /rebound\.mtimeMs !== opened\.mtimeMs/);
  assert.match(reader, /rebound\.ctimeMs !== opened\.ctimeMs/);
  assert.match(reader, /after\.mtimeMs !== opened\.mtimeMs/);
  assert.match(reader, /after\.ctimeMs !== opened\.ctimeMs/);
  assert.match(reader, /finalPath\.mtimeMs !== opened\.mtimeMs/);
  assert.match(reader, /finalPath\.ctimeMs !== opened\.ctimeMs/);
  assert.match(reader, /bytes\.length !== opened\.size/);
  assert.match(reader, /MAX_GOVERNED_CONFIG_FILE_BYTES/);
  assert.match(reader, /readExactBoundedDescriptor\(/);
  assert.match(implementation, /paths\.length > MAX_GOVERNED_CONFIG_FILES/);
  assert.match(
    implementation,
    /totalBytes > MAX_GOVERNED_CONFIG_TOTAL_BYTES/,
  );
});

test('configuration hashing rejects an in-place rewrite before no-follow open', () => {
  const workDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'eai-config-pre-open-rewrite-')),
  );
  try {
    const root = join(workDir, 'app');
    const target = join(root, 'eai.runtime.json');
    const preload = join(workDir, 'rewrite-config-before-open.cjs');
    writeFixtureApp(root);
    writeFileSync(
      preload,
      String.raw`
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalOpenSync = fs.openSync;
const originalCloseSync = fs.closeSync;
const originalWriteSync = fs.writeSync;
let rewritten = false;
fs.openSync = function patchedOpenSync(path, ...args) {
  const target = process.env.EAI_TEST_CONFIG_REWRITE_PATH;
  if (!rewritten && target && String(path) === target) {
    rewritten = true;
    const length = fs.readFileSync(target).length;
    const writer = originalOpenSync.call(
      fs,
      target,
      fs.constants.O_WRONLY | fs.constants.O_TRUNC,
    );
    try {
      originalWriteSync.call(fs, writer, Buffer.alloc(length, 0x78));
    } finally {
      originalCloseSync.call(fs, writer);
    }
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(target, future, future);
  }
  return originalOpenSync.call(fs, path, ...args);
};
syncBuiltinESMExports();
`,
    );

    const result = spawnSync(
      process.execPath,
      [evidenceScript, 'config-hash', '--root', root],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preload}`,
          EAI_TEST_CONFIG_REWRITE_PATH: target,
        },
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /changed before its no-follow read/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('schema provenance must be present in the governed runtime manifest', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-source-unknown-provenance-'));
  try {
    const fixtureRoot = join(workDir, 'app');
    writeFixtureApp(fixtureRoot);
    writeFileSync(
      join(fixtureRoot, 'eai.runtime.json'),
      '{"runtime":"legacy"}\n',
    );
    const result = spawnSync(
      process.execPath,
      [
        evidenceScript,
        'collect',
        '--root',
        fixtureRoot,
        ...sourceUnknownBindingArgs(fixtureRoot),
        '--artifact-id',
        '987654321',
        '--artifact-digest',
        `sha256:${'d'.repeat(64)}`,
        '--image-digest',
        `sha256:${'c'.repeat(64)}`,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /schemaProvenance is required/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('schema provenance accepts every approved source anchor and preserves it in evidence', () => {
  const anchors = [
    ['baseTemplateSha', 'a'.repeat(40), 'base_template_sha'],
    ['approvedSourceSha', 'b'.repeat(40), 'approved_source_sha'],
    ['approvedReleaseId', 'approved-release-2026-09-25', 'approved_release_id'],
  ];
  for (const [key, value, outputKey] of anchors) {
    const workDir = mkdtempSync(join(tmpdir(), `eai-source-unknown-${key}-`));
    try {
      const fixtureRoot = join(workDir, 'app');
      const outputFile = join(realpathSync(workDir), 'github-output.txt');
      writeFixtureApp(fixtureRoot);
      writeFileSync(
        join(fixtureRoot, 'eai.runtime.json'),
        JSON.stringify({
          runtime: 'fixture',
          schemaProvenance: {
            templateVersion: '0.1.0',
            [key]: value,
            schemaDigest: `sha256:${'c'.repeat(64)}`,
            validatorDigest: `sha256:${'d'.repeat(64)}`,
          },
        }),
      );
      runEvidenceScript([
        'collect',
        '--root',
        fixtureRoot,
        ...sourceUnknownBindingArgs(fixtureRoot),
        '--artifact-id',
        '987654321',
        '--artifact-digest',
        `sha256:${'e'.repeat(64)}`,
        '--image-digest',
        `sha256:${'f'.repeat(64)}`,
        '--github-output',
        outputFile,
      ]);
      const evidence = JSON.parse(
        readFileSync(
          join(
            fixtureRoot,
            '.eai-build/evidence/source-unknown-deployment-evidence.json',
          ),
          'utf8',
        ),
      );
      assert.equal(evidence.schemaProvenance[key], value);
      assert.match(
        readFileSync(outputFile, 'utf8'),
        new RegExp(`^${outputKey}=${value}$`, 'm'),
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
});

test('schema provenance rejects missing and malformed approved source anchors', () => {
  const invalidProvenance = [
    {
      templateVersion: '0.1.0',
      schemaDigest: `sha256:${'c'.repeat(64)}`,
      validatorDigest: `sha256:${'d'.repeat(64)}`,
    },
    {
      templateVersion: '0.1.0',
      approvedSourceSha: 'not-a-commit',
      schemaDigest: `sha256:${'c'.repeat(64)}`,
      validatorDigest: `sha256:${'d'.repeat(64)}`,
    },
    {
      templateVersion: '0.1.0\ninjected=value',
      baseTemplateSha: 'a'.repeat(40),
      schemaDigest: `sha256:${'c'.repeat(64)}`,
      validatorDigest: `sha256:${'d'.repeat(64)}`,
    },
    {
      templateVersion: '0.1.0',
      approvedReleaseId: '',
      schemaDigest: `sha256:${'c'.repeat(64)}`,
      validatorDigest: `sha256:${'d'.repeat(64)}`,
    },
    {
      templateVersion: '0.1.0',
      approvedReleaseId: 'release-1\ninjected=value',
      schemaDigest: `sha256:${'c'.repeat(64)}`,
      validatorDigest: `sha256:${'d'.repeat(64)}`,
    },
    {
      templateVersion: '0.1.0',
      approvedReleaseId: ' release-with-whitespace ',
      schemaDigest: `sha256:${'c'.repeat(64)}`,
      validatorDigest: `sha256:${'d'.repeat(64)}`,
    },
    {
      templateVersion: '0.1.0',
      approvedReleaseId: 'release-1',
      unexpectedAnchor: 'not-canonical',
      schemaDigest: `sha256:${'c'.repeat(64)}`,
      validatorDigest: `sha256:${'d'.repeat(64)}`,
    },
  ];
  for (const schemaProvenance of invalidProvenance) {
    const workDir = mkdtempSync(
      join(tmpdir(), 'eai-source-unknown-invalid-provenance-'),
    );
    try {
      writeFixtureApp(workDir);
      writeFileSync(
        join(workDir, 'eai.runtime.json'),
        JSON.stringify({ runtime: 'fixture', schemaProvenance }),
      );
      const result = spawnSync(
        process.execPath,
        [
          evidenceScript,
          'collect',
          '--root',
          workDir,
          ...sourceUnknownBindingArgs(workDir),
          '--artifact-id',
          '987654321',
          '--artifact-digest',
          `sha256:${'e'.repeat(64)}`,
          '--image-digest',
          `sha256:${'f'.repeat(64)}`,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Schema provenance/);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
});

test('collect rejects multiline provenance before writing evidence or GitHub outputs', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-output-injection-'));
  try {
    writeFixtureApp(workDir);
    const runtimePath = join(workDir, 'eai.runtime.json');
    const runtime = JSON.parse(readFileSync(runtimePath, 'utf8'));
    runtime.schemaProvenance.templateVersion = '0.1.0\ninjected=value';
    writeFileSync(runtimePath, JSON.stringify(runtime));
    const githubOutput = join(realpathSync(workDir), 'github-output.txt');
    writeFileSync(githubOutput, 'trusted=value\n');

    const result = spawnSync(
      process.execPath,
      [
        evidenceScript,
        'collect',
        '--root',
        workDir,
        ...sourceUnknownBindingArgs(workDir),
        '--artifact-id',
        '987654321',
        '--artifact-digest',
        `sha256:${'e'.repeat(64)}`,
        '--image-digest',
        `sha256:${'f'.repeat(64)}`,
        '--github-output',
        githubOutput,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /templateVersion is required/);
    assert.equal(readFileSync(githubOutput, 'utf8'), 'trusted=value\n');
    assert.equal(
      existsSync(
        join(
          workDir,
          '.eai-build/evidence/source-unknown-deployment-evidence.json',
        ),
      ),
      false,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('GitHub output serialization enforces UTF-8 value and aggregate byte limits before open', () => {
  const source = readFileSync(evidenceScript, 'utf8');
  const functionStart = source.indexOf('function appendOutputs(');
  const functionEnd = source.indexOf('\n\nasync function collectEvidence', functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const functionSource = source.slice(functionStart, functionEnd);
  let openCount = 0;
  let appended = Buffer.alloc(0);
  const status = {
    isFile: () => true,
    nlink: 1,
    dev: 1,
    ino: 1,
  };
  const appendOutputs = Function(
    'MAX_GITHUB_OUTPUT_VALUE_BYTES',
    'MAX_GITHUB_OUTPUT_TOTAL_BYTES',
    'resolve',
    'snapshotAbsoluteDirectoryPath',
    'dirname',
    'openSync',
    'noFollowOpenFlags',
    'constants',
    'fstatSync',
    'assertAbsoluteDirectorySnapshot',
    'assertCommandFileBinding',
    'writeSync',
    'closeSync',
    `${functionSource}; return appendOutputs;`,
  )(
    4 * 1024,
    64 * 1024,
    (value) => value,
    () => [],
    () => '/',
    () => {
      openCount += 1;
      return 3;
    },
    (flags) => flags,
    { O_WRONLY: 1, O_APPEND: 2, O_CREAT: 4 },
    () => status,
    () => {},
    () => {},
    (_descriptor, bytes, offset, length) => {
      appended = Buffer.concat([
        appended,
        Buffer.from(bytes.subarray(offset, offset + length)),
      ]);
      return length;
    },
    () => {},
  );

  appendOutputs('/bounded-output', { exact: 'a'.repeat(4 * 1024) });
  assert.match(appended.toString('utf8'), /^exact=a+\n$/);

  let opensBefore = openCount;
  assert.throws(
    () => appendOutputs('/bounded-output', { oversized: 'a'.repeat(4 * 1024 + 1) }),
    /oversized exceeds its byte limit/,
  );
  assert.equal(openCount, opensBefore);
  assert.throws(
    () => appendOutputs('/bounded-output', { multibyte: 'é'.repeat(2049) }),
    /multibyte exceeds its byte limit/,
  );
  assert.equal(openCount, opensBefore);

  const full = Object.fromEntries(
    Array.from({ length: 16 }, (_, index) => [
      `k${String(index).padStart(2, '0')}`,
      'b'.repeat(4091),
    ]),
  );
  appended = Buffer.alloc(0);
  appendOutputs('/bounded-output', full);
  assert.equal(appended.length, 64 * 1024);

  const overflowing = { ...full, k00: 'b'.repeat(4092) };
  opensBefore = openCount;
  assert.throws(
    () => appendOutputs('/bounded-output', overflowing),
    /aggregate byte limit/,
  );
  assert.equal(openCount, opensBefore);
});

test('collect never follows a replaced GitHub output command file', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-linked-github-output-'));
  try {
    const root = join(workDir, 'app');
    const protectedPath = join(workDir, 'protected.txt');
    const githubOutput = join(realpathSync(workDir), 'github-output.txt');
    writeFixtureApp(root);
    writeFileSync(protectedPath, 'protected\n');
    symlinkSync(protectedPath, githubOutput);

    const result = spawnSync(
      process.execPath,
      [
        evidenceScript,
        ...sourceUnknownCollectArgs(root),
        '--github-output',
        githubOutput,
      ],
      { encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /ELOOP|symbolic link/i);
    assert.equal(readFileSync(protectedPath, 'utf8'), 'protected\n');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('collect rejects a linked GitHub output command-file ancestor', () => {
  const workDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'eai-linked-github-output-parent-')),
  );
  try {
    const root = join(workDir, 'app');
    const protectedDirectory = join(workDir, 'protected');
    const linkedDirectory = join(workDir, 'linked-output');
    writeFixtureApp(root);
    mkdirSync(protectedDirectory);
    writeFileSync(join(protectedDirectory, 'marker.txt'), 'protected\n');
    symlinkSync(protectedDirectory, linkedDirectory, 'dir');

    const result = spawnSync(
      process.execPath,
      [
        evidenceScript,
        ...sourceUnknownCollectArgs(root),
        '--github-output',
        join(linkedDirectory, 'github-output.txt'),
      ],
      { encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /ancestors must be no-follow directories/);
    assert.equal(
      existsSync(join(protectedDirectory, 'github-output.txt')),
      false,
    );
    assert.equal(
      readFileSync(join(protectedDirectory, 'marker.txt'), 'utf8'),
      'protected\n',
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('collect rejects a GitHub output command file replaced after append', () => {
  const workDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'eai-replaced-github-output-after-append-')),
  );
  try {
    const root = join(workDir, 'app');
    const githubOutput = join(workDir, 'github-output.txt');
    const preload = join(workDir, 'replace-command-file.cjs');
    writeFixtureApp(root);
    writeFileSync(githubOutput, 'trusted=before\n');
    writeFileSync(
      preload,
      String.raw`
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalWriteSync = fs.writeSync;
let replaced = false;
fs.writeSync = function patchedWriteSync(descriptor, ...args) {
  const result = originalWriteSync.call(fs, descriptor, ...args);
  const target = process.env.EAI_TEST_GITHUB_OUTPUT_SWAP_PATH;
  if (!replaced && target) {
    try {
      const opened = fs.fstatSync(descriptor);
      const leaf = fs.lstatSync(target);
      if (opened.dev === leaf.dev && opened.ino === leaf.ino) {
        replaced = true;
        fs.renameSync(target, target + '.bound');
        fs.writeFileSync(target, 'attacker=value\n');
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }
  return result;
};
syncBuiltinESMExports();
`,
    );

    const result = spawnSync(
      process.execPath,
      [
        evidenceScript,
        ...sourceUnknownCollectArgs(root),
        '--github-output',
        githubOutput,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preload}`,
          EAI_TEST_GITHUB_OUTPUT_SWAP_PATH: githubOutput,
        },
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /path changed during append/);
    assert.equal(readFileSync(githubOutput, 'utf8'), 'attacker=value\n');
    assert.match(
      readFileSync(`${githubOutput}.bound`, 'utf8'),
      /artifact_digest=sha256:/,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('collect rejects a command-file hard link added after the descriptor snapshot', () => {
  const workDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'eai-linked-github-output-after-snapshot-')),
  );
  try {
    const root = join(workDir, 'app');
    const githubOutput = join(workDir, 'github-output.txt');
    const preload = join(workDir, 'link-command-file.cjs');
    writeFixtureApp(root);
    writeFileSync(githubOutput, 'trusted=before\n');
    writeFileSync(
      preload,
      String.raw`
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalWriteSync = fs.writeSync;
const originalFstatSync = fs.fstatSync;
let appended = false;
let linked = false;
fs.writeSync = function patchedWriteSync(descriptor, ...args) {
  const result = originalWriteSync.call(fs, descriptor, ...args);
  const target = process.env.EAI_TEST_GITHUB_OUTPUT_LINK_PATH;
  const opened = originalFstatSync.call(fs, descriptor);
  const leaf = fs.lstatSync(target);
  if (opened.dev === leaf.dev && opened.ino === leaf.ino) appended = true;
  return result;
};
fs.fstatSync = function patchedFstatSync(descriptor, ...args) {
  const status = originalFstatSync.call(fs, descriptor, ...args);
  const target = process.env.EAI_TEST_GITHUB_OUTPUT_LINK_PATH;
  const leaf = fs.lstatSync(target);
  if (appended && !linked && status.dev === leaf.dev && status.ino === leaf.ino) {
    linked = true;
    fs.linkSync(target, target + '.alias');
  }
  return status;
};
syncBuiltinESMExports();
`,
    );

    const result = spawnSync(
      process.execPath,
      [
        evidenceScript,
        ...sourceUnknownCollectArgs(root),
        '--github-output',
        githubOutput,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preload}`,
          EAI_TEST_GITHUB_OUTPUT_LINK_PATH: githubOutput,
        },
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /path changed during append/);
    assert.equal(lstatSync(githubOutput).nlink, 2);
    assert.equal(lstatSync(`${githubOutput}.alias`).ino, lstatSync(githubOutput).ino);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('collect rejects a config hash that does not bind the checked-out files', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-source-unknown-tamper-'));
  try {
    const fixtureRoot = join(workDir, 'app');
    writeFixtureApp(fixtureRoot);
    const result = spawnSync(
      process.execPath,
      [
        evidenceScript,
        'collect',
        '--root',
        fixtureRoot,
        ...sourceUnknownBindingArgs(fixtureRoot),
        '--artifact-id',
        '987654321',
        '--artifact-digest',
        `sha256:${'d'.repeat(64)}`,
        '--image-digest',
        `sha256:${'c'.repeat(64)}`,
        '--expected-config-hash',
        `sha256:${'f'.repeat(64)}`,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /config hash does not match/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('collect rejects malformed upload-artifact digests without weakening image validation', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-source-unknown-digest-'));
  try {
    writeFixtureApp(workDir);
    const configHash = runEvidenceScript([
      'config-hash',
      '--root',
      workDir,
    ]).trim();
    for (const artifactDigest of [
      'd'.repeat(63),
      'D'.repeat(64),
      `md5:${'d'.repeat(64)}`,
      `sha256:sha256:${'d'.repeat(64)}`,
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          evidenceScript,
          'collect',
          '--root',
          workDir,
          ...sourceUnknownBindingArgs(workDir),
          '--artifact-id',
          '987654321',
          '--artifact-digest',
          artifactDigest,
          '--image-digest',
          `sha256:${'c'.repeat(64)}`,
          '--expected-config-hash',
          configHash,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /artifactDigest must be a sha256 digest/);
    }
    const result = spawnSync(
      process.execPath,
      [
        evidenceScript,
        'collect',
        '--root',
        workDir,
        ...sourceUnknownBindingArgs(workDir),
        '--artifact-id',
        '987654321',
        '--artifact-digest',
        'd'.repeat(64),
        '--image-digest',
        'c'.repeat(64),
        '--expected-config-hash',
        configHash,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /imageDigest must be a sha256 digest/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('configuration digest binds nested tenants, deployment contract, and rejects symlinks', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-config-manifest-'));
  try {
    writeFixtureApp(workDir);
    mkdirSync(join(workDir, 'src/eai.config/tenants/acme'), {
      recursive: true,
    });
    writeFileSync(
      join(workDir, 'src/eai.config/deployment-contract.ts'),
      'export const deployment = { region: "au" };\n',
    );
    const tenantPath = join(
      workDir,
      'src/eai.config/tenants/acme/runtime.json',
    );
    writeFileSync(tenantPath, '{"tenant":"one"}\n');
    const first = configHash(workDir);

    writeFileSync(
      join(workDir, 'src/eai.config/object-types.json'),
      '{"generated":"changed"}\n',
    );
    writeFileSync(
      join(workDir, 'src/eai.config/object-types.provisioning.json'),
      '{"generated":"new"}\n',
    );
    assert.equal(first, configHash(workDir));

    const specPath = join(workDir, 'src/eai.config/policy.spec.ts');
    writeFileSync(specPath, 'export const policy = "one";\n');
    const specAdded = configHash(workDir);
    assert.notEqual(first, specAdded);

    const testPath = join(workDir, 'src/eai.config/policy.test.json');
    writeFileSync(testPath, '{"policy":"one"}\n');
    const testAdded = configHash(workDir);
    assert.notEqual(specAdded, testAdded);

    writeFileSync(specPath, 'export const policy = "two";\n');
    const specChanged = configHash(workDir);
    assert.notEqual(testAdded, specChanged);

    writeFileSync(tenantPath, '{"tenant":"two"}\n');
    const nestedChanged = configHash(workDir);
    assert.notEqual(specChanged, nestedChanged);

    writeFileSync(
      join(workDir, 'src/eai.config/deployment-contract.ts'),
      'export const deployment = { region: "ca" };\n',
    );
    assert.notEqual(nestedChanged, configHash(workDir));

    symlinkSync(
      join(workDir, 'eai.runtime.json'),
      join(workDir, 'src/eai.config/tenants/runtime-link.json'),
    );
    const result = spawnSync(
      process.execPath,
      [evidenceScript, 'config-hash', '--root', workDir],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot be a symlink/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('configuration hashing rejects outside hard links in governed source files', () => {
  for (const relativePath of [
    'eai.runtime.json',
    'eai.config.ts',
    'src/eai.config/policy.ts',
  ]) {
    const workDir = mkdtempSync(join(tmpdir(), 'eai-hard-linked-config-'));
    try {
      const root = join(workDir, 'app');
      const outside = join(workDir, 'outside.txt');
      const source = join(root, relativePath);
      writeFixtureApp(root);
      const content = existsSync(source) ? readFileSync(source) : Buffer.from('export const policy = true;\n');
      writeFileSync(outside, content);
      rmSync(source, { force: true });
      linkSync(outside, source);

      const result = spawnSync(
        process.execPath,
        [evidenceScript, 'config-hash', '--root', root],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 1, relativePath);
      assert.match(result.stderr, /bounded regular file with a single link/);
      assert.equal(readFileSync(outside).equals(content), true);
      assert.equal(result.stdout, '');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
});

test('configuration digest rejects dangling governed root links', () => {
  const cases = [
    ['eai.config.ts', 'missing-config.ts'],
    ['src/eai.config', 'missing-config-directory'],
  ];
  for (const [governedPath, target] of cases) {
    const workDir = mkdtempSync(join(tmpdir(), 'eai-config-dangling-'));
    try {
      writeFixtureApp(workDir);
      rmSync(join(workDir, governedPath), { recursive: true, force: true });
      symlinkSync(target, join(workDir, governedPath));
      const result = spawnSync(
        process.execPath,
        [evidenceScript, 'config-hash', '--root', workDir],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /regular (?:file|directory)/);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
});

test(
  'configuration digest rejects linked or non-directory governed ancestors',
  { skip: process.platform === 'win32' },
  () => {
    for (const scenario of ['link', 'file']) {
      const workDir = mkdtempSync(
        join(tmpdir(), `eai-config-ancestor-${scenario}-`),
      );
      try {
        const root = join(workDir, 'app');
        const outside = join(workDir, 'outside');
        writeFixtureApp(root);
        mkdirSync(join(outside, 'eai.config'), { recursive: true });
        writeFileSync(
          join(outside, 'eai.config/runtime.ts'),
          'export const escaped = true;\n',
        );
        rmSync(join(root, 'src'), { recursive: true, force: true });
        if (scenario === 'link') symlinkSync(outside, join(root, 'src'), 'dir');
        else writeFileSync(join(root, 'src'), 'not a directory\n');

        const result = spawnSync(
          process.execPath,
          [evidenceScript, 'config-hash', '--root', root],
          { encoding: 'utf8' },
        );
        assert.equal(result.status, 1);
        assert.match(result.stderr, /ancestor must be a regular directory/);
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    }
  },
);

test(
  'configuration digest rejects nonregular governed entries',
  { skip: process.platform === 'win32' },
  () => {
    const workDir = mkdtempSync(join(tmpdir(), 'eai-config-special-file-'));
    try {
      writeFixtureApp(workDir);
      const fifoPath = join(workDir, 'src/eai.config/runtime-input');
      execFileSync('mkfifo', [fifoPath]);
      const result = spawnSync(
        process.execPath,
        [evidenceScript, 'config-hash', '--root', workDir],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /regular file or directory/);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  },
);

test('dispatch rejects auto config grants, unsafe source-unknown paths, and conflicting aliases', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-dispatch-aliases-'));
  try {
    writeFixtureApp(workDir);
    execFileSync('git', ['init', '-q'], { cwd: workDir });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.com',
        'commit',
        '--allow-empty',
        '-m',
        'fixture',
      ],
      { cwd: workDir },
    );
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: workDir,
      encoding: 'utf8',
    }).trim();
    const valid = [
      'validate-dispatch',
      '--root',
      workDir,
      ...dispatchBindingArgs(workDir),
      '--commit',
      commit,
      '--workflow-sha',
      commit,
      '--public-api-url',
      'https://api.au.myenterprise.ai/public',
    ];
    runEvidenceScript([
      ...valid,
      '--target-tenant-id',
      '',
      '--preferred-environment',
      '',
      '--legacy-environment',
      '',
      '--preferred-public-api-url',
      '',
      '--legacy-public-api-url',
      '',
    ]);
    for (const extra of [
      ['--expected-config-hash', 'auto'],
      ['--app-key', '../other'],
      ['--nonce', '../other'],
      ['--preferred-environment', 'test', '--legacy-environment', 'prod'],
      [
        '--preferred-public-api-url',
        'https://api.au.myenterprise.ai/public',
        '--legacy-public-api-url',
        'https://api.ca.myenterprise.ai/public',
      ],
    ]) {
      const result = spawnSync(
        process.execPath,
        [evidenceScript, ...valid, ...extra],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 1);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('collect rejects an empty OCI archive before producing evidence', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-empty-image-'));
  try {
    writeFixtureApp(workDir);
    writeFileSync(join(workDir, '.eai-build/eai-generated-app-image.tar'), '');
    const result = spawnSync(
      process.execPath,
      [
        evidenceScript,
        'collect',
        '--root',
        workDir,
        ...sourceUnknownBindingArgs(workDir),
        '--artifact-id',
        '987654321',
        '--artifact-digest',
        `sha256:${'d'.repeat(64)}`,
        '--image-digest',
        `sha256:${'c'.repeat(64)}`,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /nonempty regular file/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('collect rejects a linked OCI archive before hashing evidence', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-linked-image-'));
  try {
    writeFixtureApp(workDir);
    const archivePath = join(workDir, '.eai-build/eai-generated-app-image.tar');
    rmSync(archivePath);
    symlinkSync(join(workDir, 'eai.runtime.json'), archivePath);
    const result = spawnSync(
      process.execPath,
      [
        evidenceScript,
        'collect',
        '--root',
        workDir,
        ...sourceUnknownBindingArgs(workDir),
        '--artifact-id',
        '987654321',
        '--artifact-digest',
        `sha256:${'d'.repeat(64)}`,
        '--image-digest',
        `sha256:${'c'.repeat(64)}`,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /nonempty regular file/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('collect rejects a linked OCI archive ancestor before hashing evidence', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-linked-image-parent-'));
  try {
    const root = join(workDir, 'app');
    const outside = join(workDir, 'outside');
    writeFixtureApp(root);
    mkdirSync(outside);
    writeFileSync(
      join(outside, 'eai-generated-app-image.tar'),
      'outside archive\n',
    );
    rmSync(join(root, '.eai-build'), { recursive: true });
    symlinkSync(outside, join(root, '.eai-build'), 'dir');
    const result = spawnSync(
      process.execPath,
      [evidenceScript, ...sourceUnknownCollectArgs(root)],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no-follow directory tree/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('collect confines evidence to a no-link directory inside the application root', () => {
  const cases = ['outside-root', 'escaped-file', 'linked-directory'];
  for (const scenario of cases) {
    const workDir = mkdtempSync(join(tmpdir(), `eai-evidence-${scenario}-`));
    try {
      const root = join(workDir, 'app');
      const outside = join(workDir, 'outside');
      writeFixtureApp(root);
      mkdirSync(outside);
      const args = sourceUnknownCollectArgs(root);
      if (scenario === 'outside-root') {
        args.push('--output-dir', outside);
      } else if (scenario === 'escaped-file') {
        args.push('--evidence-file', '../escaped.json');
      } else {
        symlinkSync(outside, join(root, '.eai-build/evidence'), 'dir');
      }

      const result = spawnSync(process.execPath, [evidenceScript, ...args], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /must remain within its approved directory|must not contain links/,
      );
      assert.equal(
        existsSync(join(outside, 'source-unknown-deployment-evidence.json')),
        false,
      );
      assert.equal(existsSync(join(root, '.eai-build/escaped.json')), false);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
});

test('collect never replaces an existing or linked evidence file', () => {
  for (const scenario of ['regular', 'link']) {
    const workDir = mkdtempSync(join(tmpdir(), `eai-evidence-${scenario}-`));
    try {
      const root = join(workDir, 'app');
      writeFixtureApp(root);
      const evidenceDir = join(root, '.eai-build/evidence');
      const evidencePath = join(
        evidenceDir,
        'source-unknown-deployment-evidence.json',
      );
      const protectedPath = join(workDir, 'protected.txt');
      mkdirSync(evidenceDir);
      writeFileSync(protectedPath, 'protected\n');
      if (scenario === 'regular') {
        writeFileSync(evidencePath, 'existing evidence\n');
      } else {
        symlinkSync(protectedPath, evidencePath);
      }

      const result = spawnSync(
        process.execPath,
        [evidenceScript, ...sourceUnknownCollectArgs(root)],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /EEXIST/);
      assert.equal(readFileSync(protectedPath, 'utf8'), 'protected\n');
      if (scenario === 'regular') {
        assert.equal(readFileSync(evidencePath, 'utf8'), 'existing evidence\n');
      }
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
});

test('collect rejects post-write evidence growth and hard links', () => {
  for (const mutation of ['append', 'link']) {
    const workDir = realpathSync(
      mkdtempSync(join(tmpdir(), `eai-evidence-final-${mutation}-`)),
    );
    try {
      const root = join(workDir, 'app');
      const preload = join(workDir, 'mutate-evidence-output.cjs');
      writeFixtureApp(root);
      writeFileSync(
        preload,
        String.raw`
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalOpenSync = fs.openSync;
const originalWriteFileSync = fs.writeFileSync;
let evidenceDescriptor;
let evidencePath;
let mutated = false;
fs.openSync = function patchedOpenSync(path, ...args) {
  const descriptor = originalOpenSync.call(fs, path, ...args);
  if (String(path).endsWith('source-unknown-deployment-evidence.json')) {
    evidenceDescriptor = descriptor;
    evidencePath = String(path);
  }
  return descriptor;
};
fs.writeFileSync = function patchedWriteFileSync(path, ...args) {
  const result = originalWriteFileSync.call(fs, path, ...args);
  if (!mutated && path === evidenceDescriptor) {
    mutated = true;
    if (process.env.EAI_TEST_EVIDENCE_MUTATION === 'append') {
      fs.appendFileSync(evidencePath, 'x');
    } else {
      fs.linkSync(evidencePath, evidencePath + '.link');
    }
  }
  return result;
};
syncBuiltinESMExports();
`,
      );
      const result = spawnSync(
        process.execPath,
        [evidenceScript, ...sourceUnknownCollectArgs(root)],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_OPTIONS: `--require=${preload}`,
            EAI_TEST_EVIDENCE_MUTATION: mutation,
          },
        },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Evidence output changed during its bound write/);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
});

test('handoff accepts only exact bound TenantInfra lifecycle and retains pending for same-operation recovery', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-bound-handoff-'));
  const responsePath = join(workDir, 'response.json');
  const bindingPath = join(workDir, 'binding.json');
  const run = () => spawnSync(process.execPath, [evidenceScript, 'assert-evidence-accepted',
    '--response', responsePath, '--binding', bindingPath], { encoding: 'utf8' });
  try {
    for (const sourceMode of ['source-unknown', 'eai-cli-generated']) {
      const binding = handoffBinding(sourceMode);
      writeFileSync(bindingPath, JSON.stringify(binding));
      for (const nested of [false, true]) {
        const pending = handoffReceipt('handoff_pending', binding);
        writeFileSync(responsePath, JSON.stringify(nested ? { response: pending } : pending));
        const deferred = run();
        assert.equal(deferred.status, 1);
        assert.match(deferred.stdout, /^handoff_pending sealed-admin-request-1/);
        assert.match(deferred.stderr, /handoff remains pending/);
        assert.deepEqual(JSON.parse(readFileSync(responsePath, 'utf8')), nested ? { response: pending } : pending);
        for (const status of ['awaiting-runtime', 'accepted', 'queued', 'running', 'deployed-awaiting-readiness', 'active']) {
          const receipt = handoffReceipt(status, binding);
          writeFileSync(responsePath, JSON.stringify(nested ? { response: receipt } : receipt));
          const accepted = run();
          assert.equal(accepted.status, 0, accepted.stderr);
          assert.match(accepted.stdout, new RegExp(`^${status} deployment-1`));
        }
      }
    }
  } finally { rmSync(workDir, { recursive: true, force: true }); }
});

test('handoff rejects crossed source, artifact, scope and false configured or terminal receipts', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eai-bound-handoff-bad-'));
  const responsePath = join(workDir, 'response.json');
  const bindingPath = join(workDir, 'binding.json');
  const binding = handoffBinding('eai-cli-generated');
  const run = (receipt) => {
    writeFileSync(responsePath, JSON.stringify({ response: receipt }));
    return spawnSync(process.execPath, [evidenceScript, 'assert-evidence-accepted',
      '--response', responsePath, '--binding', bindingPath], { encoding: 'utf8' });
  };
  try {
    writeFileSync(bindingPath, JSON.stringify(binding));
    for (const key of ['sourceMode', 'tenantId', 'appScopeTenantId', 'targetTenantId', 'appKey',
      'environment', 'operationId', 'sourceOperationId', 'commitSha', 'configHash', 'workflowPath',
      'ref', 'workflowRunId', 'workflowBlobSha', 'collectorDigest', 'artifactDigest', 'imageDigest', 'repositoryId']) {
      for (const remove of [false, true]) {
        const receipt = handoffReceipt('accepted', binding);
        if (remove) delete receipt.deploymentRequest[key];
        else receipt.deploymentRequest[key] = 'crossed';
        assert.equal(run(receipt).status, 1, `${key}/${remove}`);
      }
    }
    for (const mutate of [
      (r) => { r.deploymentRequest.repo.owner = 'other'; },
      (r) => { r.deploymentRequest.imageArtifact.archiveDigest = `sha256:${'0'.repeat(64)}`; },
      (r) => { r.deploymentRequest.imageArtifact.id = 89; },
      (r) => { r.deploymentRequest.status = 'active'; },
      (r) => { r.requiresTenantInfra = true; },
      (r) => { r.deploymentRequest.requiresTenantInfra = true; },
      (r) => { r.deploymentRequest.handoff.backend = 'other'; },
      (r) => { r.deploymentRequest.handoff.status = 'pending'; },
      (r) => { delete r.deploymentId; },
      (r) => { r.deploymentRequestId = 'other'; },
      (r) => { r.deploymentRequest.deploymentId = 'other'; },
      (r) => { r.deploymentId = ' '; },
    ]) {
      const receipt = handoffReceipt('accepted', binding); mutate(receipt);
      assert.equal(run(receipt).status, 1);
    }
    for (const status of ['configured', 'failed', 'failed-readiness', 'recovery-blocked', 'cancelled', 'rolled-back', 'disabled']) {
      const receipt = handoffReceipt(status, binding);
      const result = run(receipt); assert.equal(result.status, 1, status);
      assert.match(result.stderr, /has not accepted/);
    }
    for (const receipt of [{ status: 'accepted' }, {}, { deploymentRequest: [] }]) assert.equal(run(receipt).status, 1);
    const pending = handoffReceipt('handoff_pending', binding);
    pending.deploymentRequestId = 'other'; assert.equal(run(pending).status, 1);
  } finally { rmSync(workDir, { recursive: true, force: true }); }
});

test('clean handoff validates bounded responses without a repository checkout', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const stepStart = workflow.indexOf('      - name: Assert evidence accepted');
  const scriptMarker = "          node - <<'NODE'\n";
  const scriptStart = workflow.indexOf(scriptMarker, stepStart);
  const scriptEnd = workflow.indexOf('\n          NODE', scriptStart);
  assert.ok(stepStart >= 0 && scriptStart > stepStart && scriptEnd > scriptStart);
  const script = workflow
    .slice(scriptStart + scriptMarker.length, scriptEnd)
    .replace(/^ {10}/gm, '');
  const workDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'eai-inline-handoff-response-')),
  );
  const responseDirectory = join(workDir, '.eai-build/evidence');
  const responsePath = join(
    responseDirectory,
    'workflow-evidence-response.json',
  );
  const binding = handoffBinding();
  const bindingEnv = { SOURCE_MODE: binding.sourceMode, TENANT_ID: binding.tenantId,
    TARGET_TENANT_ID: binding.targetTenantId, APP_KEY: binding.appKey,
    DEPLOY_ENVIRONMENT: binding.environment, OPERATION_ID: binding.operationId,
    SOURCE_COMMIT_SHA: binding.commitSha, CONFIG_HASH: binding.configHash,
    GITHUB_REPOSITORY: 'customer/permit-app', GITHUB_REF: binding.ref,
    GITHUB_RUN_ID: binding.workflowRunId, GITHUB_REPOSITORY_ID: String(binding.repositoryId) };
  const run = (env = process.env) =>
    spawnSync(process.execPath, ['-e', script], {
      cwd: workDir,
      encoding: 'utf8',
      env: { ...env, ...bindingEnv },
    });
  try {
    mkdirSync(responseDirectory, { recursive: true });
    writeFileSync(join(responseDirectory, 'source-unknown-deployment-evidence.json'), JSON.stringify(binding));
    for (const response of [handoffReceipt('accepted', binding), { response: handoffReceipt('awaiting-runtime', binding) }]) {
      writeFileSync(responsePath, JSON.stringify(response));
      const result = run(); assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /runtime readiness remains a separate check/);
    }
    const pending = handoffReceipt('handoff_pending', binding);
    writeFileSync(responsePath, JSON.stringify(pending));
    const deferred = run(); assert.equal(deferred.status, 1);
    assert.match(deferred.stderr, /handoff remains pending/);
    assert.deepEqual(JSON.parse(readFileSync(responsePath, 'utf8')), pending);
    const crossed = handoffReceipt('accepted', binding);
    crossed.deploymentRequest.targetTenantId = 'other';
    writeFileSync(responsePath, JSON.stringify(crossed));
    assert.equal(run().status, 1);

    writeFileSync(responsePath, 'x');
    truncateSync(responsePath, 1024 * 1024 + 1);
    const oversized = run();
    assert.equal(oversized.status, 1);
    assert.match(oversized.stderr, /bounded no-follow regular file/);

    rmSync(responsePath);
    const targetPath = join(workDir, 'response-target.json');
    writeFileSync(
      targetPath,
      JSON.stringify({ status: 'accepted' }),
    );
    symlinkSync(targetPath, responsePath);
    const linked = run();
    assert.equal(linked.status, 1);
    assert.match(linked.stderr, /bounded no-follow regular file/);

    rmSync(responsePath);
    writeFileSync(
      responsePath,
      JSON.stringify({ status: 'accepted' }),
    );
    const preload = join(workDir, 'grow-inline-response-after-open.cjs');
    writeFileSync(
      preload,
      String.raw`
const fs = require('node:fs');
const originalOpenSync = fs.openSync;
const originalCloseSync = fs.closeSync;
const originalReadSync = fs.readSync;
const originalWriteSync = fs.writeSync;
let targetDescriptor;
let grew = false;
fs.openSync = function patchedOpenSync(path, ...args) {
  const descriptor = originalOpenSync.call(fs, path, ...args);
  if (targetDescriptor === undefined && String(path) === process.env.EAI_TEST_RESPONSE_PATH) {
    targetDescriptor = descriptor;
  }
  return descriptor;
};
fs.readSync = function patchedReadSync(descriptor, ...args) {
  if (!grew && descriptor === targetDescriptor) {
    grew = true;
    const writer = originalOpenSync.call(fs, process.env.EAI_TEST_RESPONSE_PATH, fs.constants.O_WRONLY | fs.constants.O_APPEND);
    try {
      originalWriteSync.call(fs, writer, Buffer.from('x'));
    } finally {
      originalCloseSync.call(fs, writer);
    }
  }
  return originalReadSync.call(fs, descriptor, ...args);
};
`,
    );
    const growing = run({
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      EAI_TEST_RESPONSE_PATH:
        '.eai-build/evidence/workflow-evidence-response.json',
    });
    assert.equal(growing.status, 1);
    assert.match(growing.stderr, /grew during verification/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('assert-evidence-accepted bounds and binds the response file', () => {
  const workDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'eai-source-unknown-handoff-file-')),
  );
  const run = (responsePath, env = process.env) =>
    spawnSync(
      process.execPath,
      [
        evidenceScript,
        'assert-evidence-accepted',
        '--response',
        responsePath,
      ],
      { encoding: 'utf8', env },
    );
  const accepted = JSON.stringify({
    status: 'accepted',
    deploymentRequestId: 'source-unknown-deploy-1',
    requiresTenantInfra: false,
  });
  try {
    const oversizedPath = join(workDir, 'oversized.json');
    writeFileSync(oversizedPath, 'x');
    truncateSync(oversizedPath, 1024 * 1024 + 1);
    const oversized = run(oversizedPath);
    assert.equal(oversized.status, 1);
    assert.match(oversized.stderr, /bounded no-follow regular file/);

    const targetPath = join(workDir, 'target.json');
    writeFileSync(targetPath, accepted);
    const linkedPath = join(workDir, 'linked.json');
    symlinkSync(targetPath, linkedPath);
    const linked = run(linkedPath);
    assert.equal(linked.status, 1);
    assert.match(linked.stderr, /bounded no-follow regular file/);

    const hardLinkedPath = join(workDir, 'hard-linked.json');
    linkSync(targetPath, hardLinkedPath);
    const hardLinked = run(hardLinkedPath);
    assert.equal(hardLinked.status, 1);
    assert.match(hardLinked.stderr, /changed before its no-follow read/);

    const directoryPath = join(workDir, 'directory.json');
    mkdirSync(directoryPath);
    const directory = run(directoryPath);
    assert.equal(directory.status, 1);
    assert.match(directory.stderr, /bounded no-follow regular file/);

    const outside = join(workDir, 'outside');
    const linkedParent = join(workDir, 'linked-parent');
    mkdirSync(outside);
    writeFileSync(join(outside, 'response.json'), accepted);
    symlinkSync(outside, linkedParent, 'dir');
    const parentLinked = run(join(linkedParent, 'response.json'));
    assert.equal(parentLinked.status, 1);
    assert.match(parentLinked.stderr, /no-follow directory/);

    const growingPath = join(workDir, 'growing.json');
    const preload = join(workDir, 'grow-response-after-open.cjs');
    writeFileSync(growingPath, accepted);
    writeFileSync(
      preload,
      String.raw`
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalOpenSync = fs.openSync;
const originalCloseSync = fs.closeSync;
const originalReadSync = fs.readSync;
const originalWriteSync = fs.writeSync;
let targetDescriptor;
let grew = false;
fs.openSync = function patchedOpenSync(path, ...args) {
  const descriptor = originalOpenSync.call(fs, path, ...args);
  if (
    targetDescriptor === undefined &&
    String(path) === process.env.EAI_TEST_GROW_RESPONSE_PATH
  ) {
    targetDescriptor = descriptor;
  }
  return descriptor;
};
fs.readSync = function patchedReadSync(descriptor, ...args) {
  if (!grew && descriptor === targetDescriptor) {
    grew = true;
    const writer = originalOpenSync.call(
      fs,
      process.env.EAI_TEST_GROW_RESPONSE_PATH,
      fs.constants.O_WRONLY | fs.constants.O_APPEND,
    );
    try {
      originalWriteSync.call(fs, writer, Buffer.from('x'));
    } finally {
      originalCloseSync.call(fs, writer);
    }
  }
  return originalReadSync.call(fs, descriptor, ...args);
};
syncBuiltinESMExports();
`,
    );
    const growing = run(growingPath, {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      EAI_TEST_GROW_RESPONSE_PATH: growingPath,
    });
    assert.equal(growing.status, 1);
    assert.match(growing.stderr, /grew during its bounded read/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
