#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  createReadStream,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SOURCE_MODES = new Set(['source-unknown', 'eai-cli-generated']);
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,254}[A-Za-z0-9])?$/;
const SAFE_OPAQUE_VALUE =
  /^[A-Za-z0-9](?:[A-Za-z0-9._~:-]{0,254}[A-Za-z0-9])?$/;
const SAFE_REPOSITORY =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;
const MANAGED_ENVIRONMENTS = new Set(['preview', 'dev', 'test', 'prod']);
const GOVERNED_ROOT_FILES = ['eai.config.ts', 'eai.runtime.json'];
const GOVERNED_CONFIG_ROOTS = ['src/eai.config'];
const NON_RUNTIME_CONFIG_FILE = /(?:^|\.)(?:test|spec)\.[^.]+$/;
const GENERATED_CONFIG_FILES = new Set([
  'src/eai.config/object-types.json',
  'src/eai.config/object-types.provisioning.json',
]);

function sourceMode(options) {
  const mode = option(options, 'sourceMode', 'source-unknown');
  if (!SOURCE_MODES.has(mode)) {
    throw new Error('Unsupported managed deployment source mode.');
  }
  return mode;
}

function requiredSafePathSegment(options, key, label = key) {
  const value = option(options, key);
  if (!SAFE_PATH_SEGMENT.test(value)) {
    throw new Error(
      `Managed deployment requires a safe ${label} path segment.`,
    );
  }
  return value;
}

function targetTenantId(options, mode) {
  const targetTenant = option(options, 'targetTenantId');
  if (mode === 'eai-cli-generated' && !targetTenant) {
    throw new Error(
      'CLI generated source requires its exact signed target tenant ID.',
    );
  }
  if (targetTenant && !SAFE_PATH_SEGMENT.test(targetTenant)) {
    throw new Error(
      'Managed deployment requires a safe targetTenantId path segment.',
    );
  }
  return targetTenant;
}

function validateDeploymentBinding(options, mode) {
  const targetTenant = targetTenantId(options, mode);
  for (const key of ['appKey', 'tenantId', 'operationId']) {
    requiredSafePathSegment(options, key);
  }
  const nonce = option(options, 'nonce');
  if (mode === 'eai-cli-generated' && !/^[a-f0-9]{64}$/.test(nonce)) {
    throw new Error('CLI generated source requires its exact signed nonce.');
  }
  if (mode === 'source-unknown' && !SAFE_OPAQUE_VALUE.test(nonce)) {
    throw new Error('Source-unknown deployment requires a safe signed nonce.');
  }
  const expectedConfigHash = option(options, 'expectedConfigHash');
  if (!SHA256_DIGEST.test(expectedConfigHash)) {
    throw new Error(
      'Managed deployment requires its exact approved sha256 config hash.',
    );
  }
  const environment = option(options, 'environment', 'preview');
  const preferredEnvironment = option(options, 'preferredEnvironment');
  const legacyEnvironment = option(options, 'legacyEnvironment');
  if (
    preferredEnvironment &&
    legacyEnvironment &&
    preferredEnvironment !== legacyEnvironment
  ) {
    throw new Error('env and environment inputs must not conflict.');
  }
  const requestedEnvironment =
    preferredEnvironment || legacyEnvironment || environment || 'preview';
  if (environment !== requestedEnvironment) {
    throw new Error(
      'Resolved deployment environment does not match its inputs.',
    );
  }
  if (!MANAGED_ENVIRONMENTS.has(environment)) {
    throw new Error(
      'Managed deployment requires an approved deployment environment.',
    );
  }
  return targetTenant;
}

function validateDispatch(options) {
  validateDeploymentBinding(options, sourceMode(options));
  const endpoint = option(options, 'publicApiUrl');
  const preferredEndpoint = option(options, 'preferredPublicApiUrl');
  const legacyEndpoint = option(options, 'legacyPublicApiUrl');
  if (
    preferredEndpoint &&
    legacyEndpoint &&
    preferredEndpoint !== legacyEndpoint
  ) {
    throw new Error(
      'public_api_url and publicapi_base_url inputs must not conflict.',
    );
  }
  if (endpoint !== (preferredEndpoint || legacyEndpoint || endpoint)) {
    throw new Error('Resolved PublicAPI URL does not match its inputs.');
  }
  if (
    !/^https:\/\/(?:dev-api\.au|(?:test-api|api)\.(?:au|ca|eu))\.myenterprise\.ai\/public\/?$/.test(
      endpoint,
    )
  ) {
    throw new Error(
      'Managed deployment requires a trusted EAI regional PublicAPI HTTPS URL ending in /public.',
    );
  }
  const commit = option(options, 'commit');
  const workflowSha = option(options, 'workflowSha');
  const root = resolve(option(options, 'root', process.cwd()));
  const configHash = buildConfigHash(root);
  if (option(options, 'expectedConfigHash') !== configHash) {
    throw new Error(
      'Dispatched config hash does not match the exact checked-out runtime configuration.',
    );
  }
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  // SECURITY: the GitHub OIDC sha and built source must match the server-issued immutable operation.
  if (
    !/^[a-f0-9]{40}$/.test(commit) ||
    commit !== actual ||
    commit !== workflowSha
  ) {
    throw new Error(
      'Dispatched commit, checked-out source, and workflow identity must match. Start a new operation after a branch update.',
    );
  }
}

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
    if (next === undefined || next.startsWith('--')) {
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

function containedRelativePath(parent, candidate, label, allowParent = false) {
  const relativePath = relative(resolve(parent), resolve(candidate));
  if (
    isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.startsWith('..\\') ||
    (!allowParent && relativePath === '')
  ) {
    throw new Error(`${label} must remain within its approved directory.`);
  }
  return relativePath;
}

function ensureDirectoryTreeNoFollow(root, directory) {
  const resolvedRoot = resolve(root);
  const resolvedDirectory = resolve(directory);
  const relativeDirectory = containedRelativePath(
    resolvedRoot,
    resolvedDirectory,
    'Evidence output directory',
    true,
  );
  const rootMetadata = lstatSync(resolvedRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error('Application root must be a no-follow directory.');
  }

  let current = resolvedRoot;
  const components = relativeDirectory
    ? relativeDirectory.split(/[\\/]/).filter(Boolean)
    : [];
  for (const component of components) {
    current = join(current, component);
    let metadata = optionalLstat(current);
    if (!metadata) {
      mkdirSync(current, { mode: 0o700 });
      metadata = lstatSync(current);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(
        `Evidence output directory must not contain links: ${current}`,
      );
    }
  }
}

function writeEvidenceFileNoFollow(root, outputDir, evidencePath, content) {
  containedRelativePath(root, outputDir, 'Evidence output directory', true);
  containedRelativePath(outputDir, evidencePath, 'Evidence output file');
  ensureDirectoryTreeNoFollow(root, dirname(evidencePath));

  const descriptor = openSync(
    evidencePath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      (constants.O_NOFOLLOW || 0),
    0o600,
  );
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error('Evidence output must be a regular file.');
    }
    writeFileSync(descriptor, content, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} does not exist: ${path}`);
  }
}

async function digestFile(path) {
  const hash = createHash('sha256');
  const descriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
  );
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error(`Artifact must be a regular file: ${path}`);
    }
    await new Promise((resolvePromise, reject) => {
      createReadStream(path, { fd: descriptor, autoClose: false })
        .on('data', (chunk) => hash.update(chunk))
        .on('error', reject)
        .on('end', resolvePromise);
    });
  } finally {
    closeSync(descriptor);
  }
  return `sha256:${hash.digest('hex')}`;
}

function digestFiles(root, paths) {
  const hash = createHash('sha256');
  for (const relativePath of paths.sort()) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(
      readRegularFileNoFollow(join(root, relativePath), relativePath),
    );
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function readRegularFileNoFollow(path, label = path) {
  const descriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
  );
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error(
        `Governed configuration must be a regular file: ${label}`,
      );
    }
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function optionalLstat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function listGovernedConfigFiles(root) {
  const paths = [];
  for (const relativePath of GOVERNED_ROOT_FILES) {
    const absolutePath = join(root, relativePath);
    const metadata = optionalLstat(absolutePath);
    if (!metadata) continue;
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(
        `Governed configuration must be a regular file: ${relativePath}`,
      );
    }
    paths.push(relativePath);
  }

  const visit = (relativeDirectory) => {
    const absoluteDirectory = join(root, relativeDirectory);
    const directoryMetadata = optionalLstat(absoluteDirectory);
    if (!directoryMetadata) return;
    if (
      directoryMetadata.isSymbolicLink() ||
      !directoryMetadata.isDirectory()
    ) {
      throw new Error(
        `Governed configuration root must be a regular directory: ${relativeDirectory}`,
      );
    }
    for (const entry of readdirSync(absoluteDirectory, {
      withFileTypes: true,
    })) {
      const relativePath = join(relativeDirectory, entry.name).replaceAll(
        '\\',
        '/',
      );
      const absolutePath = join(root, relativePath);
      const metadata = lstatSync(absolutePath);
      if (metadata.isSymbolicLink()) {
        throw new Error(
          `Governed configuration cannot be a symlink: ${relativePath}`,
        );
      }
      if (metadata.isDirectory()) {
        visit(relativePath);
      } else if (!metadata.isFile()) {
        throw new Error(
          `Governed configuration entry must be a regular file or directory: ${relativePath}`,
        );
      } else if (
        !NON_RUNTIME_CONFIG_FILE.test(entry.name) &&
        !GENERATED_CONFIG_FILES.has(relativePath)
      ) {
        paths.push(relativePath);
      }
    }
  };
  for (const relativeDirectory of GOVERNED_CONFIG_ROOTS)
    visit(relativeDirectory);
  return [...new Set(paths)].sort();
}

function readSchemaProvenance(root) {
  const runtimePath = join(root, 'eai.runtime.json');
  assertExists(runtimePath, 'eai.runtime.json');
  const runtime = JSON.parse(
    readRegularFileNoFollow(runtimePath, 'eai.runtime.json').toString('utf8'),
  );
  const provenance = runtime.schemaProvenance;
  if (!provenance || typeof provenance !== 'object') {
    throw new Error('eai.runtime.json schemaProvenance is required.');
  }
  const canonicalFields = new Set([
    'templateVersion',
    'baseTemplateSha',
    'approvedSourceSha',
    'approvedReleaseId',
    'schemaDigest',
    'validatorDigest',
  ]);
  if (Object.keys(provenance).some((key) => !canonicalFields.has(key))) {
    throw new Error('Schema provenance contains a noncanonical field.');
  }
  for (const key of ['schemaDigest', 'validatorDigest']) {
    if (!SHA256_DIGEST.test(provenance[key] || '')) {
      throw new Error(`Schema provenance ${key} must be a sha256 digest.`);
    }
  }
  if (
    typeof provenance.templateVersion !== 'string' ||
    !provenance.templateVersion.trim() ||
    provenance.templateVersion.trim() !== provenance.templateVersion ||
    /[\r\n]/.test(provenance.templateVersion)
  ) {
    throw new Error('Schema provenance templateVersion is required.');
  }
  const anchors = [
    ['baseTemplateSha', provenance.baseTemplateSha, /^[a-f0-9]{40}$/],
    ['approvedSourceSha', provenance.approvedSourceSha, /^[a-f0-9]{40}$/],
    ['approvedReleaseId', provenance.approvedReleaseId, /\S/],
  ];
  if (!anchors.some(([, value]) => value !== undefined)) {
    throw new Error(
      'Schema provenance requires baseTemplateSha, approvedSourceSha, or approvedReleaseId.',
    );
  }
  for (const [key, value, pattern] of anchors) {
    if (
      value !== undefined &&
      (typeof value !== 'string' ||
        value.trim() !== value ||
        /[\r\n]/.test(value) ||
        !pattern.test(value))
    ) {
      throw new Error(`Schema provenance ${key} is invalid.`);
    }
  }
  return provenance;
}

function buildConfigHash(root) {
  assertExists(join(root, 'eai.runtime.json'), 'eai.runtime.json');
  return digestFiles(root, listGovernedConfigFiles(root));
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
      'FROM node:24-alpine@sha256:83f1c388c31fb2e51f7cbd4dea949b96260798c98f206e8e4696bc93bd964e3a',
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
    .map(([key, value]) => {
      const serialized = String(value);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error('GitHub output key is invalid.');
      }
      if (/[\r\n\0]/.test(serialized)) {
        throw new Error(`GitHub output ${key} must be a single safe line.`);
      }
      return `${key}=${serialized}\n`;
    })
    .join('');
  await appendFile(path, lines, 'utf8');
}

async function collectEvidence(options) {
  const mode = sourceMode(options);
  const targetTenant = validateDeploymentBinding(options, mode);
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

  const archiveMetadata = optionalLstat(imageArchivePath);
  if (
    !archiveMetadata ||
    archiveMetadata.isSymbolicLink() ||
    !archiveMetadata.isFile() ||
    archiveMetadata.size <= 0
  ) {
    throw new Error('OCI image archive must be a nonempty regular file.');
  }
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
  if (expectedConfigHash !== configHash) {
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
  if (!['preview', 'dev', 'test', 'prod'].includes(environment)) {
    throw new Error('Unsupported managed deployment environment.');
  }
  if (!SAFE_REPOSITORY.test(repo))
    throw new Error('Repository must be owner/name.');
  if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(workflowPath)) {
    throw new Error('Workflow path must be a file under .github/workflows.');
  }
  if (ref !== `refs/heads/${branch}`)
    throw new Error('Workflow ref and branch do not match.');
  if (!/^[a-f0-9]{40}$/.test(commitSha))
    throw new Error('Commit must be an exact 40 character git SHA.');
  const workflowRunId = option(
    options,
    'workflowRunId',
    process.env.GITHUB_RUN_ID || '',
  );
  const workflowRunAttempt = option(
    options,
    'workflowRunAttempt',
    process.env.GITHUB_RUN_ATTEMPT || '',
  );
  if (!/^[1-9][0-9]*$/.test(workflowRunId)) {
    throw new Error('Workflow run id must be a positive integer.');
  }
  if (!/^[1-9][0-9]*$/.test(workflowRunAttempt)) {
    throw new Error('Workflow run attempt must be a positive integer.');
  }

  const evidence = {
    ...(mode === 'eai-cli-generated' ? { sourceMode: mode } : {}),
    ...(mode === 'eai-cli-generated' ? { targetTenantId: targetTenant } : {}),
    environment,
    workflowPath,
    ref,
    commitSha,
    workflowRun: {
      id: workflowRunId,
      attempt: workflowRunAttempt,
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

  writeEvidenceFileNoFollow(
    root,
    outputDir,
    evidencePath,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  await appendOutputs(githubOutputPath, {
    config_hash: configHash,
    artifact_digest: artifactDigest,
    archive_digest: archiveDigest,
    image_digest: imageDigest,
    evidence_path: evidencePath,
    template_version: schemaProvenance.templateVersion,
    ...(schemaProvenance.baseTemplateSha
      ? { base_template_sha: schemaProvenance.baseTemplateSha }
      : {}),
    ...(schemaProvenance.approvedSourceSha
      ? { approved_source_sha: schemaProvenance.approvedSourceSha }
      : {}),
    ...(schemaProvenance.approvedReleaseId
      ? { approved_release_id: schemaProvenance.approvedReleaseId }
      : {}),
    schema_digest: schemaProvenance.schemaDigest,
    validator_digest: schemaProvenance.validatorDigest,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        operationId: evidence.operationId,
        evidencePath,
        configHash,
        artifactDigest,
        imageArtifact: evidence.imageArtifact,
        imageDigest,
        templateVersion: schemaProvenance.templateVersion,
        schemaDigest: schemaProvenance.schemaDigest,
      },
      null,
      2,
    )}\n`,
  );
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

if (command === 'validate-dispatch') {
  validateDispatch(options);
} else if (command === 'config-hash') {
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
