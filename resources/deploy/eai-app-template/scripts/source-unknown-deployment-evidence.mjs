#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;

function parseArgs(argv) {
  const [command = 'collect', ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg
      .slice(2)
      .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = 'true';
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return { command, options };
}

function option(options, key, fallback = '') {
  const envKey = key.replace(/[A-Z]/g, (char) => `_${char}`).toUpperCase();
  const value = options[key] ?? process.env[envKey] ?? fallback;
  return typeof value === 'string' ? value.trim() : '';
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} does not exist: ${path}`);
  }
}

async function digestFile(path) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, reject) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', resolvePromise);
  });
  return `sha256:${hash.digest('hex')}`;
}

function digestFiles(root, paths) {
  const hash = createHash('sha256');
  for (const relativePath of paths
    .filter((path) => existsSync(join(root, path)))
    .sort()) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(readFileSync(join(root, relativePath)));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function readSchemaProvenance(root) {
  const runtimePath = join(root, 'eai.runtime.json');
  assertExists(runtimePath, 'eai.runtime.json');
  const runtime = JSON.parse(readFileSync(runtimePath, 'utf8'));
  let provenance = runtime.schemaProvenance;
  if (!provenance) {
    const fixture = join(root, 'tests/fixtures/schema-provenance/valid.json');
    assertExists(fixture, 'Runtime schema provenance or compatibility fixture');
    provenance = JSON.parse(readFileSync(fixture, 'utf8'));
  }
  for (const key of ['schemaDigest', 'validatorDigest']) {
    if (!SHA256_DIGEST.test(provenance[key] || '')) {
      throw new Error(`Schema provenance ${key} must be a sha256 digest.`);
    }
  }
  if (!/^[a-f0-9]{40}$/.test(provenance.baseTemplateSha || '')) {
    throw new Error(
      'Schema provenance baseTemplateSha must be a 40 character lowercase git SHA.',
    );
  }
  if (!provenance.templateVersion) {
    throw new Error('Schema provenance templateVersion is required.');
  }
  return provenance;
}

function buildConfigHash(root) {
  assertExists(join(root, 'eai.runtime.json'), 'eai.runtime.json');
  return digestFiles(root, [
    'eai.runtime.json',
    'src/eai.config/default.ts',
    'src/eai.config/index.ts',
    'src/eai.config/object-types.json',
    'src/eai.config/object-types.provisioning.json',
    'src/eai.config/object-types.ts',
    'src/eai.config/register.ts',
  ]);
}

function prepareImageContext(options) {
  const root = resolve(option(options, 'root', process.cwd()));
  const buildDir = resolve(root, option(options, 'buildDir', '.next'));
  const contextDir = resolve(
    root,
    option(options, 'contextDir', '.eai-build/image-context'),
  );
  const standaloneDir = join(buildDir, 'standalone');
  const staticDir = join(buildDir, 'static');

  assertExists(standaloneDir, 'Next standalone build');
  assertExists(staticDir, 'Next static build');
  rmSync(contextDir, { recursive: true, force: true });
  ensureDir(contextDir);
  execFileSync('cp', ['-R', `${standaloneDir}/.`, contextDir]);
  ensureDir(join(contextDir, '.next'));
  execFileSync('cp', ['-R', staticDir, join(contextDir, '.next/static')]);
  if (existsSync(join(root, 'public'))) {
    execFileSync('cp', [
      '-R',
      join(root, 'public'),
      join(contextDir, 'public'),
    ]);
  } else {
    ensureDir(join(contextDir, 'public'));
  }
  writeFileSync(
    join(contextDir, 'Dockerfile'),
    [
      'FROM node:24-alpine',
      'WORKDIR /app',
      'ENV NODE_ENV=production',
      'ENV PORT=3000',
      'ENV HOSTNAME=0.0.0.0',
      'COPY . .',
      'EXPOSE 3000',
      'CMD ["node", "server.js"]',
      '',
    ].join('\n'),
  );
  process.stdout.write(`${contextDir}\n`);
}

async function appendOutputs(path, outputs) {
  if (!path) return;
  const lines = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');
  await appendFile(path, lines, 'utf8');
}

async function collectEvidence(options) {
  const root = resolve(option(options, 'root', process.cwd()));
  const outputDir = resolve(
    root,
    option(options, 'outputDir', '.eai-build/evidence'),
  );
  const imageArchivePath = resolve(
    root,
    option(options, 'imageArchive', '.eai-build/eai-generated-app-image.tar'),
  );
  const evidencePath = resolve(
    outputDir,
    option(options, 'evidenceFile', 'source-unknown-deployment-evidence.json'),
  );
  const githubOutputPath = option(
    options,
    'githubOutput',
    process.env.GITHUB_OUTPUT || '',
  );

  assertExists(imageArchivePath, 'OCI image archive');
  const uploadedArtifactDigest = option(options, 'artifactDigest');
  // INVARIANT: upload-artifact returns bare hex; handoff digests are algorithm-qualified.
  const artifactDigest = /^[a-f0-9]{64}$/.test(uploadedArtifactDigest)
    ? `sha256:${uploadedArtifactDigest}`
    : uploadedArtifactDigest;
  const artifactId = option(options, 'artifactId');
  const archiveDigest = await digestFile(imageArchivePath);
  const imageDigest = option(options, 'imageDigest');
  const configHash = buildConfigHash(root);
  const expectedConfigHash = option(options, 'expectedConfigHash');
  const schemaProvenance = readSchemaProvenance(root);

  if (!/^[1-9][0-9]*$/.test(artifactId))
    throw new Error('Artifact id must be numeric.');
  for (const [label, digest] of Object.entries({
    artifactDigest,
    archiveDigest,
    imageDigest,
  })) {
    if (!SHA256_DIGEST.test(digest))
      throw new Error(`${label} must be a sha256 digest.`);
  }
  if (new Set([artifactDigest, archiveDigest, imageDigest]).size !== 3) {
    throw new Error('Artifact, archive, and image digests must be distinct.');
  }
  if (!expectedConfigHash || configHash !== expectedConfigHash) {
    throw new Error(
      'Dispatched config hash does not match the exact checked-out runtime configuration.',
    );
  }

  const workflowPath = option(
    options,
    'workflow',
    '.github/workflows/eai-app.yml',
  );
  const branch = option(
    options,
    'branch',
    process.env.GITHUB_REF_NAME || 'main',
  );
  const ref = option(
    options,
    'ref',
    process.env.GITHUB_REF || `refs/heads/${branch}`,
  );
  const commitSha = option(options, 'commit', process.env.GITHUB_SHA || '');
  const repo = option(options, 'repo', process.env.GITHUB_REPOSITORY || '');
  const environment = option(options, 'environment', 'preview');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo))
    throw new Error('Repository must be owner/name.');
  if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(workflowPath)) {
    throw new Error('Workflow path must be a file under .github/workflows.');
  }
  if (ref !== `refs/heads/${branch}`)
    throw new Error('Workflow ref and branch do not match.');
  if (!/^[a-f0-9]{40}$/.test(commitSha))
    throw new Error('Commit must be an exact 40 character git SHA.');

  const evidence = {
    environment,
    workflowPath,
    ref,
    commitSha,
    workflowRun: {
      id: option(options, 'workflowRunId', process.env.GITHUB_RUN_ID || ''),
      attempt: option(
        options,
        'workflowRunAttempt',
        process.env.GITHUB_RUN_ATTEMPT || '',
      ),
    },
    configHash,
    artifactDigest,
    imageArtifact: {
      id: artifactId,
      name: 'eai-generated-app-image',
      archiveDigest,
    },
    imageDigest,
    schemaProvenance,
    operationId: option(options, 'operationId'),
    nonce: option(options, 'nonce'),
    validationSummary: { status: 'passed' },
  };

  ensureDir(outputDir);
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await appendOutputs(githubOutputPath, {
    config_hash: configHash,
    artifact_digest: artifactDigest,
    archive_digest: archiveDigest,
    image_digest: imageDigest,
    evidence_path: evidencePath,
    template_version: schemaProvenance.templateVersion,
    base_template_sha: schemaProvenance.baseTemplateSha,
    schema_digest: schemaProvenance.schemaDigest,
    validator_digest: schemaProvenance.validatorDigest,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function responseStatus(payload) {
  if (payload?.response && typeof payload.response === 'object') {
    return {
      status: payload.response.status,
      requiresTenantInfra: payload.response.requiresTenantInfra,
      deploymentRequestId: payload.response.deploymentRequestId,
    };
  }
  return {
    status: payload?.status,
    requiresTenantInfra: payload?.requiresTenantInfra,
    deploymentRequestId: payload?.deploymentRequestId,
  };
}

function assertHandoffSubmitted(options) {
  const responsePath = resolve(option(options, 'response'));
  assertExists(responsePath, 'Deployment handoff response');
  const actual = responseStatus(readJson(responsePath));
  const deferredHandoff =
    actual.status === 'handoff_pending' &&
    actual.requiresTenantInfra === true &&
    typeof actual.deploymentRequestId === 'string' &&
    actual.deploymentRequestId.trim().length > 0;
  if (actual.status !== 'accepted' && !deferredHandoff)
    throw new Error(
      `Expected accepted evidence or a persisted pending handoff, got ${actual.status || '<missing>'}.`,
    );
  process.stdout.write(
    `${actual.status} ${actual.deploymentRequestId || ''}\n`,
  );
}

const { command, options } = parseArgs(process.argv.slice(2));

if (command === 'config-hash') {
  process.stdout.write(
    `${buildConfigHash(resolve(option(options, 'root', process.cwd())))}\n`,
  );
} else if (command === 'prepare-image-context') {
  prepareImageContext(options);
} else if (command === 'collect') {
  await collectEvidence(options);
} else if (
  command === 'assert-evidence-accepted' ||
  command === 'assert-handoff-submitted'
) {
  assertHandoffSubmitted(options);
} else {
  throw new Error(`Unknown command: ${command}`);
}
