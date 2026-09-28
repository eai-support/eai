#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  readdirSync,
  writeSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SOURCE_MODES = new Set(['source-unknown', 'eai-cli-generated']);
const APP_KEY = /^[a-z][a-z0-9-]{1,62}$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,254}[A-Za-z0-9])?$/;
const SAFE_OPAQUE_VALUE =
  /^[A-Za-z0-9](?:[A-Za-z0-9._~:-]{0,254}[A-Za-z0-9])?$/;
const SAFE_REPOSITORY =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;
const MANAGED_ENVIRONMENTS = new Set([
  'preview',
  'dev',
  'test',
  'prod',
  'demo',
]);
const GOVERNED_ROOT_FILES = ['eai.config.ts', 'eai.runtime.json'];
const GOVERNED_CONFIG_ROOTS = ['src/eai.config'];
const GENERATED_CONFIG_FILES = new Set([
  'src/eai.config/object-types.json',
  'src/eai.config/object-types.provisioning.json',
]);
const CANONICAL_WORKFLOW_PATH = '.github/workflows/eai-app.yml';
const CANONICAL_COLLECTOR_PATH = 'scripts/source-unknown-deployment-evidence.mjs';
const MAX_IMAGE_ARCHIVE_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_GOVERNED_CONFIG_FILE_BYTES = 10 * 1024 * 1024;
const MAX_GOVERNED_CONFIG_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_GOVERNED_CONFIG_FILES = 4096;
const MAX_BUILD_EVIDENCE_BYTES = 1024 * 1024;
const MAX_HANDOFF_RESPONSE_BYTES = 1024 * 1024;
const MAX_GITHUB_OUTPUT_VALUE_BYTES = 4 * 1024;
const MAX_GITHUB_OUTPUT_TOTAL_BYTES = 64 * 1024;
const MAX_OCI_INDEX_BYTES = 1024 * 1024;
const MAX_OCI_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_TAR_LISTING_BYTES = 64 * 1024;
const TAR_TIMEOUT_MS = 10 * 60 * 1000;
const BOUNDED_READ_BUFFER_BYTES = 64 * 1024;
const OCI_MANIFEST_MEDIA_TYPES = new Set([
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
]);

function requiredOpenFlag(name) {
  const flag = constants[name];
  if (!Number.isSafeInteger(flag) || flag <= 0) {
    throw new Error(`Secure file opens require ${name} support.`);
  }
  return flag;
}

function noFollowOpenFlags(flags, { nonblocking = false } = {}) {
  const noFollow = requiredOpenFlag('O_NOFOLLOW');
  const nonblockingFlag = nonblocking
    ? requiredOpenFlag('O_NONBLOCK')
    : 0;
  return flags | noFollow | nonblockingFlag;
}

function governedConfigReadOpenFlags({
  allowWindowsValidatedFallback = false,
} = {}) {
  if (allowWindowsValidatedFallback && process.platform === 'win32') {
    if (!Number.isSafeInteger(constants.O_RDONLY) || constants.O_RDONLY < 0) {
      throw new Error('Secure file opens require O_RDONLY support.');
    }
    return constants.O_RDONLY;
  }
  return noFollowOpenFlags(constants.O_RDONLY, { nonblocking: true });
}

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
  const appKey = option(options, 'appKey');
  if (!APP_KEY.test(appKey)) {
    throw new Error('Managed deployment requires a canonical app key.');
  }
  for (const key of ['tenantId', 'operationId']) {
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

function assertDirectoryTreeNoFollow(root, directory, label) {
  const resolvedRoot = resolve(root);
  const resolvedDirectory = resolve(directory);
  const relativeDirectory = containedRelativePath(
    resolvedRoot,
    resolvedDirectory,
    label,
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
    const metadata = optionalLstat(current);
    if (!metadata || metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`${label} must be an existing no-follow directory tree.`);
    }
  }
}

function assertOutputAbsentNoFollow(root, path, label) {
  containedRelativePath(root, path, label);
  ensureDirectoryTreeNoFollow(root, dirname(path));
  const metadata = optionalLstat(path);
  if (metadata) {
    throw new Error(
      `${label} must not exist before isolated image preparation. Use a clean checkout.`,
    );
  }
}

function copyRegularTreeNoFollow(
  root,
  sourceDirectory,
  destinationDirectory,
  label,
) {
  containedRelativePath(root, sourceDirectory, label);
  containedRelativePath(root, destinationDirectory, `${label} destination`);
  assertDirectoryTreeNoFollow(root, sourceDirectory, label);
  ensureDirectoryTreeNoFollow(root, destinationDirectory);

  const copyDirectory = (source, destination) => {
    assertDirectoryTreeNoFollow(root, source, label);
    ensureDirectoryTreeNoFollow(root, destination);
    const entries = readdirSync(source, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const sourcePath = join(source, entry.name);
      const destinationPath = join(destination, entry.name);
      const before = lstatSync(sourcePath);
      if (before.isSymbolicLink()) {
        throw new Error(`${label} cannot contain a symlink: ${sourcePath}`);
      }
      if (before.isDirectory()) {
        copyDirectory(sourcePath, destinationPath);
        continue;
      }
      if (!before.isFile() || before.nlink !== 1) {
        throw new Error(
          `${label} entries must be single-link regular files or directories: ${sourcePath}`,
        );
      }

      const sourceAncestors = snapshotAbsoluteDirectoryPath(
        dirname(sourcePath),
        label,
      );
      const sourceDescriptor = openSync(
        sourcePath,
        noFollowOpenFlags(constants.O_RDONLY, { nonblocking: true }),
      );
      const destinationAncestors = snapshotAbsoluteDirectoryPath(
        dirname(destinationPath),
        `${label} destination`,
      );
      let destinationDescriptor;
      try {
        const opened = fstatSync(sourceDescriptor);
        assertAbsoluteDirectorySnapshot(sourceAncestors, label);
        const sourceRebound = lstatSync(sourcePath);
        containedRelativePath(
          realpathSync(root),
          realpathSync(sourcePath),
          label,
        );
        if (
          !opened.isFile() ||
          opened.nlink !== 1 ||
          opened.dev !== before.dev ||
          opened.ino !== before.ino ||
          opened.size !== before.size ||
          opened.mtimeMs !== before.mtimeMs ||
          opened.ctimeMs !== before.ctimeMs ||
          sourceRebound.isSymbolicLink() ||
          !sourceRebound.isFile() ||
          sourceRebound.nlink !== 1 ||
          sourceRebound.dev !== opened.dev ||
          sourceRebound.ino !== opened.ino ||
          sourceRebound.size !== opened.size ||
          sourceRebound.mtimeMs !== opened.mtimeMs ||
          sourceRebound.ctimeMs !== opened.ctimeMs
        ) {
          throw new Error(`${label} changed before its no-follow copy.`);
        }
        destinationDescriptor = openSync(
          destinationPath,
          noFollowOpenFlags(
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
          ),
          before.mode & 0o777,
        );
        const destinationOpened = fstatSync(destinationDescriptor);
        assertAbsoluteDirectorySnapshot(destinationAncestors, `${label} destination`);
        const destinationRebound = lstatSync(destinationPath);
        if (
          !destinationOpened.isFile() ||
          destinationOpened.nlink !== 1 ||
          destinationRebound.isSymbolicLink() ||
          !destinationRebound.isFile() ||
          destinationRebound.dev !== destinationOpened.dev ||
          destinationRebound.ino !== destinationOpened.ino
        ) {
          throw new Error(`${label} destination must be a regular file.`);
        }
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let copied = 0;
        while (copied < opened.size) {
          const bytesRead = readSync(
            sourceDescriptor,
            buffer,
            0,
            Math.min(buffer.length, opened.size - copied),
            null,
          );
          if (bytesRead === 0) break;
          let written = 0;
          while (written < bytesRead) {
            const bytesWritten = writeSync(
              destinationDescriptor,
              buffer,
              written,
              bytesRead - written,
            );
            if (bytesWritten === 0) {
              throw new Error(`${label} destination stopped accepting data.`);
            }
            written += bytesWritten;
          }
          copied += bytesRead;
        }
        assertAbsoluteDirectorySnapshot(destinationAncestors, `${label} destination`);
        const destinationAfter = fstatSync(destinationDescriptor);
        const destinationPathAfter = lstatSync(destinationPath);
        if (
          !destinationAfter.isFile() ||
          destinationAfter.dev !== destinationOpened.dev ||
          destinationAfter.ino !== destinationOpened.ino ||
          destinationAfter.nlink !== 1 ||
          destinationAfter.size !== copied ||
          destinationPathAfter.isSymbolicLink() ||
          !destinationPathAfter.isFile() ||
          destinationPathAfter.dev !== destinationOpened.dev ||
          destinationPathAfter.ino !== destinationOpened.ino ||
          destinationPathAfter.nlink !== 1 ||
          destinationPathAfter.size !== copied
        ) {
          throw new Error(`${label} destination changed during its bound write.`);
        }
        const after = fstatSync(sourceDescriptor);
        assertAbsoluteDirectorySnapshot(sourceAncestors, label);
        const sourcePathAfter = lstatSync(sourcePath);
        containedRelativePath(
          realpathSync(root),
          realpathSync(sourcePath),
          label,
        );
        if (
          copied !== opened.size ||
          !after.isFile() ||
          after.nlink !== 1 ||
          after.dev !== opened.dev ||
          after.ino !== opened.ino ||
          after.size !== opened.size ||
          after.mtimeMs !== opened.mtimeMs ||
          after.ctimeMs !== opened.ctimeMs ||
          sourcePathAfter.isSymbolicLink() ||
          !sourcePathAfter.isFile() ||
          sourcePathAfter.nlink !== 1 ||
          sourcePathAfter.dev !== opened.dev ||
          sourcePathAfter.ino !== opened.ino ||
          sourcePathAfter.size !== opened.size ||
          sourcePathAfter.mtimeMs !== opened.mtimeMs ||
          sourcePathAfter.ctimeMs !== opened.ctimeMs
        ) {
          throw new Error(`${label} changed during its no-follow copy.`);
        }
      } catch (error) {
        if (destinationDescriptor !== undefined) {
          closeSync(destinationDescriptor);
          destinationDescriptor = undefined;
        }
        throw error;
      } finally {
        if (destinationDescriptor !== undefined) {
          closeSync(destinationDescriptor);
        }
        closeSync(sourceDescriptor);
      }
    }
  };

  copyDirectory(sourceDirectory, destinationDirectory);
}

function writeRegularFileNoFollow(root, path, content) {
  containedRelativePath(root, path, 'Image context file');
  assertDirectoryTreeNoFollow(root, dirname(path), 'Image context directory');
  const ancestors = snapshotAbsoluteDirectoryPath(
    dirname(path),
    'Image context output',
  );
  const bytes = Buffer.from(content, 'utf8');
  const descriptor = openSync(
    path,
    noFollowOpenFlags(
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    ),
    0o600,
  );
  const expectedBytes = bytes.length;
  try {
    const opened = fstatSync(descriptor);
    assertAbsoluteDirectorySnapshot(ancestors, 'Image context output');
    const rebound = lstatSync(path);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      rebound.isSymbolicLink() ||
      !rebound.isFile() ||
      rebound.dev !== opened.dev ||
      rebound.ino !== opened.ino
    ) {
      throw new Error('Image context output must be a regular file.');
    }
    writeFileSync(descriptor, bytes);
    assertAbsoluteDirectorySnapshot(ancestors, 'Image context output');
    const after = fstatSync(descriptor);
    const finalPath = lstatSync(path);
    if (
      !after.isFile() ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.nlink !== 1 ||
      after.size !== expectedBytes ||
      finalPath.isSymbolicLink() ||
      !finalPath.isFile() ||
      finalPath.dev !== opened.dev ||
      finalPath.ino !== opened.ino ||
      finalPath.nlink !== 1 ||
      finalPath.size !== expectedBytes
    ) {
      throw new Error('Image context output changed during its bound write.');
    }
  } finally {
    closeSync(descriptor);
  }
}

function writeEvidenceFileNoFollow(root, outputDir, evidencePath, content) {
  containedRelativePath(root, outputDir, 'Evidence output directory', true);
  containedRelativePath(outputDir, evidencePath, 'Evidence output file');
  ensureDirectoryTreeNoFollow(root, dirname(evidencePath));
  const ancestors = snapshotAbsoluteDirectoryPath(
    dirname(evidencePath),
    'Evidence output',
  );

  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > MAX_BUILD_EVIDENCE_BYTES) {
    throw new Error('Build evidence exceeds its byte limit.');
  }
  const descriptor = openSync(
    evidencePath,
    noFollowOpenFlags(
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    ),
    0o600,
  );
  const expectedBytes = bytes.length;
  try {
    const opened = fstatSync(descriptor);
    assertAbsoluteDirectorySnapshot(ancestors, 'Evidence output');
    const rebound = lstatSync(evidencePath);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      rebound.isSymbolicLink() ||
      !rebound.isFile() ||
      rebound.dev !== opened.dev ||
      rebound.ino !== opened.ino
    ) {
      throw new Error('Evidence output must be a regular file.');
    }
    writeFileSync(descriptor, bytes);
    assertAbsoluteDirectorySnapshot(ancestors, 'Evidence output');
    const after = fstatSync(descriptor);
    const finalPath = lstatSync(evidencePath);
    if (
      !after.isFile() ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.nlink !== 1 ||
      after.size !== expectedBytes ||
      finalPath.isSymbolicLink() ||
      !finalPath.isFile() ||
      finalPath.dev !== opened.dev ||
      finalPath.ino !== opened.ino ||
      finalPath.nlink !== 1 ||
      finalPath.size !== expectedBytes
    ) {
      throw new Error('Evidence output changed during its bound write.');
    }
  } finally {
    closeSync(descriptor);
  }
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} does not exist: ${path}`);
  }
}

function readExactBoundedDescriptor(
  descriptor,
  expectedBytes,
  maxBytes,
  label,
) {
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes < 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    expectedBytes > maxBytes
  ) {
    throw new Error(`${label} exceeds its bounded read limit.`);
  }
  const buffer = Buffer.allocUnsafe(BOUNDED_READ_BUFFER_BYTES);
  const chunks = [];
  let offset = 0;
  while (offset < expectedBytes) {
    const bytesRead = readSync(
      descriptor,
      buffer,
      0,
      Math.min(buffer.length, expectedBytes - offset),
      offset,
    );
    if (bytesRead === 0) {
      throw new Error(`${label} shrank during its bounded read.`);
    }
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    offset += bytesRead;
  }
  const growthProbe = Buffer.allocUnsafe(1);
  if (readSync(descriptor, growthProbe, 0, 1, offset) !== 0) {
    throw new Error(`${label} grew during its bounded read.`);
  }
  return Buffer.concat(chunks, offset);
}

function readBoundedRegularFileNoFollow(
  root,
  path,
  label,
  maxBytes = 1024 * 1024,
) {
  containedRelativePath(root, path, label);
  assertDirectoryTreeNoFollow(root, dirname(path), `${label} directory`);
  const ancestors = snapshotAbsoluteDirectoryPath(dirname(path), label);
  const before = lstatSync(path);
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.size < 1 ||
    before.size > maxBytes
  ) {
    throw new Error(`${label} must be a bounded no-follow regular file.`);
  }
  const descriptor = openSync(
    path,
    noFollowOpenFlags(constants.O_RDONLY, { nonblocking: true }),
  );
  try {
    const opened = fstatSync(descriptor);
    assertAbsoluteDirectorySnapshot(ancestors, label);
    const rebound = lstatSync(path);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.ctimeMs !== before.ctimeMs ||
      rebound.isSymbolicLink() ||
      !rebound.isFile() ||
      rebound.dev !== opened.dev ||
      rebound.ino !== opened.ino ||
      rebound.size !== opened.size ||
      rebound.mtimeMs !== opened.mtimeMs ||
      rebound.ctimeMs !== opened.ctimeMs ||
      opened.size < 1 ||
      opened.size > maxBytes
    ) {
      throw new Error(`${label} changed before its no-follow read.`);
    }
    const bytes = readExactBoundedDescriptor(
      descriptor,
      opened.size,
      maxBytes,
      label,
    );
    const after = fstatSync(descriptor);
    assertAbsoluteDirectorySnapshot(ancestors, label);
    const finalPath = lstatSync(path);
    if (
      bytes.length !== opened.size ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      finalPath.isSymbolicLink() ||
      !finalPath.isFile() ||
      finalPath.dev !== opened.dev ||
      finalPath.ino !== opened.ino ||
      finalPath.size !== opened.size ||
      finalPath.mtimeMs !== opened.mtimeMs ||
      finalPath.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error(`${label} changed during its bounded no-follow read.`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function readImageDigest(options) {
  const root = resolve(option(options, 'root', process.cwd()));
  const archivePath = resolve(
    root,
    option(options, 'imageArchive', '.eai-build/eai-generated-app-image.tar'),
  );
  const digest = readOciImageDigestFromArchive(root, archivePath);
  process.stdout.write(`${digest}\n`);
}

function readOciImageDigestFromArchive(root, archivePath) {
  containedRelativePath(root, archivePath, 'OCI image archive');
  assertDirectoryTreeNoFollow(
    root,
    dirname(archivePath),
    'OCI image archive directory',
  );
  const ancestors = snapshotAbsoluteDirectoryPath(
    dirname(archivePath),
    'OCI image archive',
  );
  const before = lstatSync(archivePath);
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1 ||
    before.size < 1 ||
    before.size > MAX_IMAGE_ARCHIVE_BYTES
  ) {
    throw new Error('OCI image archive must be a bounded no-follow regular file.');
  }
  const descriptor = openSync(
    archivePath,
    noFollowOpenFlags(constants.O_RDONLY, { nonblocking: true }),
  );
  try {
    const opened = fstatSync(descriptor);
    const assertArchiveBinding = () => {
      const after = fstatSync(descriptor);
      assertAbsoluteDirectorySnapshot(ancestors, 'OCI image archive');
      const finalPath = lstatSync(archivePath);
      for (const current of [after, finalPath]) {
        if (
          current.isSymbolicLink() ||
          !current.isFile() ||
          current.nlink !== 1 ||
          current.dev !== opened.dev ||
          current.ino !== opened.ino ||
          current.size !== opened.size ||
          current.mtimeMs !== opened.mtimeMs ||
          current.ctimeMs !== opened.ctimeMs
        ) {
          throw new Error('OCI image archive changed while deriving its image digest.');
        }
      }
    };
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.ctimeMs !== before.ctimeMs
    ) {
      throw new Error('OCI image archive changed before digest derivation.');
    }
    const runTar = (arguments_, maxBytes, label) => {
      let output;
      try {
        output = execFileSync('tar', arguments_, {
          cwd: '/',
          encoding: null,
          env: { PATH: process.env.PATH, LC_ALL: 'C' },
          maxBuffer: maxBytes + 1,
          timeout: TAR_TIMEOUT_MS,
          stdio: ['ignore', 'pipe', 'pipe', descriptor],
        });
      } finally {
        assertArchiveBinding();
      }
      if (!Buffer.isBuffer(output) || output.length < 1 || output.length > maxBytes) {
        throw new Error(`${label} is empty or exceeds its byte limit.`);
      }
      return output;
    };
    const archivePathByDescriptor =
      process.platform === 'linux' ? '/proc/self/fd/3' : '/dev/fd/3';
    const listing = runTar(
      ['--list', '--verbose', '--file', archivePathByDescriptor, '--', 'index.json'],
      MAX_TAR_LISTING_BYTES,
      'OCI image index listing',
    ).toString('utf8');
    const entries = listing.split(/\r?\n/).filter(Boolean);
    if (
      entries.length !== 1 ||
      !entries[0].startsWith('-') ||
      !entries[0].endsWith(' index.json')
    ) {
      throw new Error('OCI image index must be one regular archive entry.');
    }
    const index = JSON.parse(
      runTar(
        [
          '--extract',
          '--to-stdout',
          '--occurrence=1',
          '--file',
          archivePathByDescriptor,
          '--',
          'index.json',
        ],
        MAX_OCI_INDEX_BYTES,
        'OCI image index',
      ).toString('utf8'),
    );
    if (
      !index ||
      typeof index !== 'object' ||
      Array.isArray(index) ||
      index.schemaVersion !== 2 ||
      !Array.isArray(index.manifests)
    ) {
      throw new Error('OCI image index is invalid.');
    }
    const candidates = index.manifests.filter(
      (manifest) =>
        manifest?.platform?.os === 'linux' &&
        manifest?.platform?.architecture === 'amd64',
    );
    if (candidates.length !== 1) {
      throw new Error('OCI image index must bind exactly one linux/amd64 manifest.');
    }
    const candidate = candidates[0];
    if (
      !OCI_MANIFEST_MEDIA_TYPES.has(candidate.mediaType) ||
      !SHA256_DIGEST.test(candidate.digest || '') ||
      !Number.isSafeInteger(candidate.size) ||
      candidate.size < 1 ||
      candidate.size > MAX_OCI_MANIFEST_BYTES
    ) {
      throw new Error('OCI image manifest descriptor is invalid.');
    }
    assertArchiveBinding();
    return candidate.digest;
  } finally {
    closeSync(descriptor);
  }
}

async function digestFile(
  path,
  label = 'Artifact',
  maxBytes = MAX_IMAGE_ARCHIVE_BYTES,
) {
  const hash = createHash('sha256');
  const ancestors = snapshotAbsoluteDirectoryPath(dirname(path), label);
  const before = lstatSync(path);
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.size < 1 ||
    before.size > maxBytes
  ) {
    throw new Error(`${label} must be a bounded no-follow regular file.`);
  }
  const descriptor = openSync(
    path,
    noFollowOpenFlags(constants.O_RDONLY, { nonblocking: true }),
  );
  try {
    const opened = fstatSync(descriptor);
    assertAbsoluteDirectorySnapshot(ancestors, label);
    const rebound = lstatSync(path);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.ctimeMs !== before.ctimeMs ||
      opened.size < 1 ||
      opened.size > maxBytes ||
      rebound.isSymbolicLink() ||
      !rebound.isFile() ||
      rebound.dev !== opened.dev ||
      rebound.ino !== opened.ino ||
      rebound.size !== opened.size ||
      rebound.mtimeMs !== opened.mtimeMs ||
      rebound.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error(`${label} changed before its bounded digest.`);
    }
    const buffer = Buffer.allocUnsafe(BOUNDED_READ_BUFFER_BYTES);
    let digested = 0;
    while (digested < opened.size) {
      const bytesRead = readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, opened.size - digested),
        digested,
      );
      if (bytesRead === 0) {
        throw new Error(`${label} shrank during its bounded digest.`);
      }
      hash.update(buffer.subarray(0, bytesRead));
      digested += bytesRead;
    }
    const growthProbe = Buffer.allocUnsafe(1);
    if (readSync(descriptor, growthProbe, 0, 1, digested) !== 0) {
      throw new Error(`${label} grew during its bounded digest.`);
    }
    const after = fstatSync(descriptor);
    assertAbsoluteDirectorySnapshot(ancestors, label);
    const finalPath = lstatSync(path);
    if (
      digested !== opened.size ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      finalPath.isSymbolicLink() ||
      !finalPath.isFile() ||
      finalPath.dev !== opened.dev ||
      finalPath.ino !== opened.ino ||
      finalPath.size !== opened.size ||
      finalPath.mtimeMs !== opened.mtimeMs ||
      finalPath.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error(`${label} changed during its bounded digest.`);
    }
  } finally {
    closeSync(descriptor);
  }
  return `sha256:${hash.digest('hex')}`;
}

function stageImageArtifact(options) {
  const root = resolve(option(options, 'root', process.cwd()));
  const sourcePath = resolve(
    root,
    option(options, 'imageArchive', '.eai-build/eai-generated-app-image.tar'),
  );
  const stagingRootValue = option(
    options,
    'stagingRoot',
    process.env.RUNNER_TEMP || '',
  );
  if (!stagingRootValue) {
    throw new Error(
      'Image artifact staging requires RUNNER_TEMP or --staging-root.',
    );
  }
  const stagingRoot = resolve(stagingRootValue);
  containedRelativePath(root, sourcePath, 'OCI image archive');
  assertDirectoryTreeNoFollow(
    root,
    dirname(sourcePath),
    'OCI image archive directory',
  );
  assertDirectoryTreeNoFollow(
    stagingRoot,
    stagingRoot,
    'Image artifact staging root',
  );
  const stagingRootAncestors = snapshotAbsoluteDirectoryPath(
    stagingRoot,
    'Image artifact staging root',
  );

  const sourceAncestors = snapshotAbsoluteDirectoryPath(
    dirname(sourcePath),
    'OCI image archive',
  );
  const before = lstatSync(sourcePath);
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.size < 1 ||
    before.size > MAX_IMAGE_ARCHIVE_BYTES
  ) {
    throw new Error(
      'OCI image archive must be a bounded no-follow regular file.',
    );
  }
  const sourceDescriptor = openSync(
    sourcePath,
    noFollowOpenFlags(constants.O_RDONLY, { nonblocking: true }),
  );
  let destinationDescriptor;
  try {
    const stagingDirectory = mkdtempSync(
      join(stagingRoot, 'eai-managed-image-'),
    );
    assertAbsoluteDirectorySnapshot(
      stagingRootAncestors,
      'Image artifact staging root',
    );
    containedRelativePath(
      realpathSync(stagingRoot),
      realpathSync(stagingDirectory),
      'Image artifact staging directory',
    );
    const stagedPath = join(stagingDirectory, 'eai-generated-app-image.tar');
    const destinationAncestors = snapshotAbsoluteDirectoryPath(
      stagingDirectory,
      'Staged OCI image archive',
    );
    destinationDescriptor = openSync(
      stagedPath,
      noFollowOpenFlags(
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      ),
      0o600,
    );
    const opened = fstatSync(sourceDescriptor);
    assertAbsoluteDirectorySnapshot(sourceAncestors, 'OCI image archive');
    const sourceRebound = lstatSync(sourcePath);
    containedRelativePath(
      realpathSync(root),
      realpathSync(sourcePath),
      'OCI image archive',
    );
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.ctimeMs !== before.ctimeMs ||
      sourceRebound.isSymbolicLink() ||
      !sourceRebound.isFile() ||
      sourceRebound.dev !== opened.dev ||
      sourceRebound.ino !== opened.ino ||
      sourceRebound.size !== opened.size ||
      sourceRebound.mtimeMs !== opened.mtimeMs ||
      sourceRebound.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error('OCI image archive changed before staging.');
    }
    const destinationOpened = fstatSync(destinationDescriptor);
    assertAbsoluteDirectorySnapshot(
      destinationAncestors,
      'Staged OCI image archive',
    );
    const destinationRebound = lstatSync(stagedPath);
    if (
      !destinationOpened.isFile() ||
      destinationOpened.nlink !== 1 ||
      destinationRebound.isSymbolicLink() ||
      !destinationRebound.isFile() ||
      destinationRebound.dev !== destinationOpened.dev ||
      destinationRebound.ino !== destinationOpened.ino
    ) {
      throw new Error('Staged OCI image archive must be a regular file.');
    }

    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let copied = 0;
    while (copied < opened.size) {
      const bytesRead = readSync(
        sourceDescriptor,
        buffer,
        0,
        Math.min(buffer.length, opened.size - copied),
        null,
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const bytesWritten = writeSync(
          destinationDescriptor,
          buffer,
          written,
          bytesRead - written,
        );
        if (bytesWritten === 0) {
          throw new Error('Staged OCI image archive stopped accepting data.');
        }
        written += bytesWritten;
      }
      copied += bytesRead;
    }

    const sourceAfter = fstatSync(sourceDescriptor);
    const destinationAfter = fstatSync(destinationDescriptor);
    assertAbsoluteDirectorySnapshot(sourceAncestors, 'OCI image archive');
    assertAbsoluteDirectorySnapshot(
      destinationAncestors,
      'Staged OCI image archive',
    );
    const sourcePathAfter = lstatSync(sourcePath);
    const destinationPathAfter = lstatSync(stagedPath);
    if (
      copied !== opened.size ||
      sourceAfter.dev !== opened.dev ||
      sourceAfter.ino !== opened.ino ||
      sourceAfter.size !== opened.size ||
      sourceAfter.mtimeMs !== opened.mtimeMs ||
      sourceAfter.ctimeMs !== opened.ctimeMs ||
      sourcePathAfter.isSymbolicLink() ||
      !sourcePathAfter.isFile() ||
      sourcePathAfter.dev !== opened.dev ||
      sourcePathAfter.ino !== opened.ino ||
      sourcePathAfter.size !== opened.size ||
      sourcePathAfter.mtimeMs !== opened.mtimeMs ||
      sourcePathAfter.ctimeMs !== opened.ctimeMs ||
      destinationAfter.dev !== destinationOpened.dev ||
      destinationAfter.ino !== destinationOpened.ino ||
      destinationAfter.nlink !== 1 ||
      destinationAfter.size !== copied ||
      destinationPathAfter.isSymbolicLink() ||
      !destinationPathAfter.isFile() ||
      destinationPathAfter.dev !== destinationOpened.dev ||
      destinationPathAfter.ino !== destinationOpened.ino ||
      destinationPathAfter.nlink !== 1 ||
      destinationPathAfter.size !== copied
    ) {
      throw new Error(
        'OCI image archive changed during its bound staging copy.',
      );
    }
    const archiveDigest = `sha256:${hash.digest('hex')}`;
    appendOutputs(
      option(options, 'githubOutput', process.env.GITHUB_OUTPUT || ''),
      {
        image_archive_path: stagedPath,
        archive_digest: archiveDigest,
        archive_size: copied,
      },
    );
    process.stdout.write(
      `${JSON.stringify({ imageArchivePath: stagedPath, archiveDigest, size: copied })}\n`,
    );
  } finally {
    if (destinationDescriptor !== undefined) {
      closeSync(destinationDescriptor);
    }
    closeSync(sourceDescriptor);
  }
}

function digestFiles(root, paths, options = {}) {
  if (paths.length > MAX_GOVERNED_CONFIG_FILES) {
    throw new Error('Governed configuration manifest exceeds its file limit.');
  }
  const hash = createHash('sha256');
  let totalBytes = 0;
  for (const relativePath of paths.sort()) {
    if (!assertGovernedAncestors(root, relativePath)) {
      throw new Error(
        `Governed configuration ancestor does not exist: ${relativePath}`,
      );
    }
    const bytes = readRegularFileNoFollow(root, relativePath, options);
    totalBytes += bytes.length;
    if (totalBytes > MAX_GOVERNED_CONFIG_TOTAL_BYTES) {
      throw new Error('Governed configuration manifest exceeds its byte limit.');
    }
    hash.update(relativePath);
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function gitBlobSha(bytes) {
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

function readRegularFileNoFollow(
  root,
  relativePath,
  { allowWindowsValidatedFallback = false } = {},
) {
  if (!assertGovernedAncestors(root, relativePath)) {
    throw new Error(
      `Governed configuration ancestor does not exist: ${relativePath}`,
    );
  }
  const path = join(root, relativePath);
  const ancestors = snapshotRelativeDirectoryPath(root, relativePath);
  const before = lstatSync(path);
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1 ||
    before.size > MAX_GOVERNED_CONFIG_FILE_BYTES
  ) {
    throw new Error(
      `Governed configuration must be a bounded regular file with a single link: ${relativePath}`,
    );
  }
  containedRelativePath(
    realpathSync(root),
    realpathSync(path),
    'Governed configuration file',
  );
  const descriptor = openSync(
    path,
    governedConfigReadOpenFlags({ allowWindowsValidatedFallback }),
  );
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.ctimeMs !== before.ctimeMs ||
      opened.size > MAX_GOVERNED_CONFIG_FILE_BYTES
    ) {
      throw new Error(
        `Governed configuration changed before its no-follow read: ${relativePath}`,
      );
    }
    assertRelativeDirectorySnapshot(ancestors, relativePath);
    const rebound = lstatSync(path);
    containedRelativePath(
      realpathSync(root),
      realpathSync(path),
      'Governed configuration file',
    );
    if (
      rebound.isSymbolicLink() ||
      !rebound.isFile() ||
      rebound.nlink !== 1 ||
      rebound.dev !== opened.dev ||
      rebound.ino !== opened.ino ||
      rebound.size !== opened.size ||
      rebound.mtimeMs !== opened.mtimeMs ||
      rebound.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error(
        `Governed configuration path changed before its no-follow read: ${relativePath}`,
      );
    }
    const bytes = readExactBoundedDescriptor(
      descriptor,
      opened.size,
      MAX_GOVERNED_CONFIG_FILE_BYTES,
      `Governed configuration ${relativePath}`,
    );
    const after = fstatSync(descriptor);
    assertRelativeDirectorySnapshot(ancestors, relativePath);
    const finalPath = lstatSync(path);
    containedRelativePath(
      realpathSync(root),
      realpathSync(path),
      'Governed configuration file',
    );
    if (
      bytes.length !== opened.size ||
      !after.isFile() ||
      after.nlink !== 1 ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      finalPath.isSymbolicLink() ||
      !finalPath.isFile() ||
      finalPath.nlink !== 1 ||
      finalPath.dev !== opened.dev ||
      finalPath.ino !== opened.ino ||
      finalPath.size !== opened.size ||
      finalPath.mtimeMs !== opened.mtimeMs ||
      finalPath.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error(
        `Governed configuration changed during its no-follow read: ${relativePath}`,
      );
    }
    return bytes;
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

function assertGovernedAncestors(root, relativePath) {
  const resolvedRoot = resolve(root);
  const rootMetadata = lstatSync(resolvedRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error('Application root must be a no-follow directory.');
  }
  const components = relativePath.split(/[\\/]/).filter(Boolean);
  let current = resolvedRoot;
  for (const component of components.slice(0, -1)) {
    current = join(current, component);
    const metadata = optionalLstat(current);
    if (!metadata) return false;
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(
        `Governed configuration ancestor must be a regular directory: ${relative(root, current).replaceAll('\\', '/')}`,
      );
    }
  }
  return true;
}

function snapshotRelativeDirectoryPath(root, relativePath) {
  const resolvedRoot = resolve(root);
  const components = relativePath.split(/[\\/]/).filter(Boolean);
  const identities = [];
  let current = resolvedRoot;
  for (const component of ['', ...components.slice(0, -1)]) {
    if (component) current = join(current, component);
    const status = lstatSync(current);
    if (status.isSymbolicLink() || !status.isDirectory()) {
      throw new Error(
        `Governed configuration ancestor must be a regular directory: ${relativePath}`,
      );
    }
    identities.push({ path: current, dev: status.dev, ino: status.ino });
  }
  return identities;
}

function assertRelativeDirectorySnapshot(identities, relativePath) {
  for (const identity of identities) {
    const status = lstatSync(identity.path);
    if (
      status.isSymbolicLink() ||
      !status.isDirectory() ||
      status.dev !== identity.dev ||
      status.ino !== identity.ino
    ) {
      throw new Error(
        `Governed configuration path changed before its no-follow read: ${relativePath}`,
      );
    }
  }
}

function snapshotAbsoluteDirectoryPath(path, label) {
  const target = resolve(path);
  const filesystemRoot = parse(target).root;
  const identities = [];
  let current = filesystemRoot;
  for (const component of ['', ...relative(filesystemRoot, target).split(/[\\/]/).filter(Boolean)]) {
    if (component) current = join(current, component);
    const status = lstatSync(current);
    // macOS exposes trusted system roots such as /var and /tmp as top-level links.
    // Bind every application-controlled descendant beneath that stable root alias.
    if (status.isSymbolicLink() && dirname(current) === filesystemRoot) continue;
    if (status.isSymbolicLink() || !status.isDirectory()) {
      throw new Error(`${label} ancestors must be no-follow directories.`);
    }
    identities.push({ path: current, dev: status.dev, ino: status.ino });
  }
  return identities;
}

function assertAbsoluteDirectorySnapshot(identities, label) {
  for (const identity of identities) {
    const status = lstatSync(identity.path);
    if (status.isSymbolicLink() || !status.isDirectory()
      || status.dev !== identity.dev || status.ino !== identity.ino) {
      throw new Error(`${label} ancestors changed before the bound write.`);
    }
  }
}

function listGovernedConfigFiles(root) {
  const paths = [];
  for (const relativePath of GOVERNED_ROOT_FILES) {
    assertGovernedAncestors(root, relativePath);
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
    if (!assertGovernedAncestors(root, relativeDirectory)) return;
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
      } else if (!GENERATED_CONFIG_FILES.has(relativePath)) {
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
    readRegularFileNoFollow(root, 'eai.runtime.json').toString('utf8'),
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

function buildConfigHash(root, options = {}) {
  assertExists(join(root, 'eai.runtime.json'), 'eai.runtime.json');
  const paths = listGovernedConfigFiles(root).sort();
  const digest = digestFiles(root, paths, options);
  const finalPaths = listGovernedConfigFiles(root).sort();
  if (
    paths.length !== finalPaths.length ||
    paths.some((path, index) => path !== finalPaths[index])
  ) {
    throw new Error(
      'Governed configuration inventory changed during hashing.',
    );
  }
  return digest;
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

  containedRelativePath(root, buildDir, 'Next build directory');
  containedRelativePath(root, contextDir, 'Image context directory');
  assertDirectoryTreeNoFollow(root, standaloneDir, 'Next standalone build');
  assertDirectoryTreeNoFollow(root, staticDir, 'Next static build');
  assertOutputAbsentNoFollow(root, contextDir, 'Image context');
  ensureDirectoryTreeNoFollow(root, contextDir);
  copyRegularTreeNoFollow(
    root,
    standaloneDir,
    contextDir,
    'Next standalone build',
  );
  ensureDirectoryTreeNoFollow(root, join(contextDir, '.next'));
  const contextStaticDir = join(contextDir, '.next/static');
  assertOutputAbsentNoFollow(root, contextStaticDir, 'Image static output');
  copyRegularTreeNoFollow(
    root,
    staticDir,
    contextStaticDir,
    'Next static build',
  );
  const publicPath = join(root, 'public');
  const contextPublicDir = join(contextDir, 'public');
  const publicMetadata = optionalLstat(publicPath);
  if (publicMetadata) {
    assertDirectoryTreeNoFollow(root, publicPath, 'Public asset directory');
    assertOutputAbsentNoFollow(root, contextPublicDir, 'Image public output');
    copyRegularTreeNoFollow(
      root,
      publicPath,
      contextPublicDir,
      'Public asset directory',
    );
  } else {
    assertOutputAbsentNoFollow(root, contextPublicDir, 'Image public output');
    ensureDirectoryTreeNoFollow(root, contextPublicDir);
  }
  writeRegularFileNoFollow(
    root,
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

async function writeImageArchive(options) {
  const stagingRootValue = option(
    options,
    'stagingRoot',
    process.env.RUNNER_TEMP || '',
  );
  if (!stagingRootValue) {
    throw new Error(
      'Image archive writing requires RUNNER_TEMP or --staging-root.',
    );
  }
  const stagingRoot = resolve(stagingRootValue);
  assertDirectoryTreeNoFollow(
    stagingRoot,
    stagingRoot,
    'Image archive staging root',
  );
  const stagingRootAncestors = snapshotAbsoluteDirectoryPath(
    stagingRoot,
    'Image archive staging root',
  );
  const stagingDirectory = mkdtempSync(
    join(stagingRoot, 'eai-managed-image-'),
  );
  assertAbsoluteDirectorySnapshot(
    stagingRootAncestors,
    'Image archive staging root',
  );
  containedRelativePath(
    realpathSync(stagingRoot),
    realpathSync(stagingDirectory),
    'Image archive staging directory',
  );
  const imageArchivePath = join(
    stagingDirectory,
    'eai-generated-app-image.tar',
  );
  const archiveAncestors = snapshotAbsoluteDirectoryPath(
    stagingDirectory,
    'OCI image archive output',
  );
  const archiveDescriptor = openSync(
    imageArchivePath,
    noFollowOpenFlags(
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL,
    ),
    0o600,
  );
  const hash = createHash('sha256');
  let written = 0;
  try {
    const opened = fstatSync(archiveDescriptor);
    assertAbsoluteDirectorySnapshot(
      archiveAncestors,
      'OCI image archive output',
    );
    const rebound = lstatSync(imageArchivePath);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.size !== 0 ||
      rebound.isSymbolicLink() ||
      !rebound.isFile() ||
      rebound.dev !== opened.dev ||
      rebound.ino !== opened.ino ||
      rebound.nlink !== 1 ||
      rebound.size !== 0
    ) {
      throw new Error('OCI image archive output must be a new regular file.');
    }
    for await (const input of process.stdin) {
      const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
      if (written + chunk.length > MAX_IMAGE_ARCHIVE_BYTES) {
        throw new Error('OCI image archive exceeds its streaming byte limit.');
      }
      let offset = 0;
      while (offset < chunk.length) {
        const bytesWritten = writeSync(
          archiveDescriptor,
          chunk,
          offset,
          chunk.length - offset,
        );
        if (bytesWritten < 1) {
          throw new Error('OCI image archive output stopped accepting data.');
        }
        offset += bytesWritten;
      }
      hash.update(chunk);
      written += chunk.length;
    }
    assertAbsoluteDirectorySnapshot(
      archiveAncestors,
      'OCI image archive output',
    );
    const after = fstatSync(archiveDescriptor);
    const finalPath = lstatSync(imageArchivePath);
    for (const current of [after, finalPath]) {
      if (
        current.isSymbolicLink() ||
        !current.isFile() ||
        current.nlink !== 1 ||
        current.dev !== opened.dev ||
        current.ino !== opened.ino ||
        current.size !== written ||
        current.size < 1 ||
        current.size > MAX_IMAGE_ARCHIVE_BYTES
      ) {
        throw new Error('OCI image archive output changed during its bound write.');
      }
    }
  } finally {
    closeSync(archiveDescriptor);
  }
  const archiveDigest = `sha256:${hash.digest('hex')}`;
  const imageDigest = readOciImageDigestFromArchive(
    stagingRoot,
    imageArchivePath,
  );
  appendOutputs(
    option(options, 'githubOutput', process.env.GITHUB_OUTPUT || ''),
    {
      image_archive_path: imageArchivePath,
      archive_digest: archiveDigest,
      archive_size: written,
      image_digest: imageDigest,
    },
  );
  process.stdout.write(
    `${JSON.stringify({ imageArchivePath, archiveDigest, size: written, imageDigest })}\n`,
  );
}

function assertCommandFileBinding(path, descriptor, openedStatus, phase) {
  let descriptorStatus;
  let pathStatus;
  try {
    descriptorStatus = fstatSync(descriptor);
    pathStatus = lstatSync(path);
  } catch {
    throw new Error(`GitHub output command file path changed ${phase}.`);
  }
  if (
    !descriptorStatus.isFile() ||
    descriptorStatus.nlink !== 1 ||
    descriptorStatus.dev !== openedStatus.dev ||
    descriptorStatus.ino !== openedStatus.ino ||
    pathStatus.isSymbolicLink() ||
    !pathStatus.isFile() ||
    pathStatus.nlink !== 1 ||
    pathStatus.dev !== openedStatus.dev ||
    pathStatus.ino !== openedStatus.ino
  ) {
    throw new Error(`GitHub output command file path changed ${phase}.`);
  }
}

function appendOutputs(path, outputs) {
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
      if (
        Buffer.byteLength(serialized, 'utf8') >
        MAX_GITHUB_OUTPUT_VALUE_BYTES
      ) {
        throw new Error(`GitHub output ${key} exceeds its byte limit.`);
      }
      return `${key}=${serialized}\n`;
    })
    .join('');
  const bytes = Buffer.from(lines, 'utf8');
  if (bytes.length > MAX_GITHUB_OUTPUT_TOTAL_BYTES) {
    throw new Error('GitHub outputs exceed their aggregate byte limit.');
  }
  const boundPath = resolve(path);
  const ancestors = snapshotAbsoluteDirectoryPath(
    dirname(boundPath),
    'GitHub output command file',
  );
  const descriptor = openSync(
    boundPath,
    noFollowOpenFlags(
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT,
      { nonblocking: true },
    ),
    0o600,
  );
  try {
    const status = fstatSync(descriptor);
    if (!status.isFile() || status.nlink !== 1) {
      throw new Error('GitHub output command file must be a regular file.');
    }
    assertAbsoluteDirectorySnapshot(ancestors, 'GitHub output command file');
    assertCommandFileBinding(boundPath, descriptor, status, 'before append');
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
      );
      if (written <= 0) {
        throw new Error('GitHub output command file append was incomplete.');
      }
      offset += written;
    }
    assertAbsoluteDirectorySnapshot(ancestors, 'GitHub output command file');
    assertCommandFileBinding(boundPath, descriptor, status, 'during append');
    assertAbsoluteDirectorySnapshot(ancestors, 'GitHub output command file');
  } finally {
    closeSync(descriptor);
  }
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
  const imageStagingRootValue = option(options, 'imageStagingRoot');
  const imageAuthorityRoot = imageStagingRootValue
    ? resolve(imageStagingRootValue)
    : root;
  const evidencePath = resolve(
    outputDir,
    option(options, 'evidenceFile', 'source-unknown-deployment-evidence.json'),
  );
  const githubOutputPath = option(
    options,
    'githubOutput',
    process.env.GITHUB_OUTPUT || '',
  );

  containedRelativePath(
    imageAuthorityRoot,
    imageArchivePath,
    'OCI image archive',
  );
  assertDirectoryTreeNoFollow(
    imageAuthorityRoot,
    dirname(imageArchivePath),
    'OCI image archive directory',
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
  const archiveDigest = await digestFile(imageArchivePath, 'OCI image archive');
  const expectedArchiveDigest = option(options, 'expectedArchiveDigest');
  if (imageStagingRootValue && !SHA256_DIGEST.test(expectedArchiveDigest)) {
    throw new Error(
      'Staged OCI image archive requires its exact expected digest.',
    );
  }
  if (expectedArchiveDigest && expectedArchiveDigest !== archiveDigest) {
    throw new Error(
      'Staged OCI image archive digest does not match its bound copy.',
    );
  }
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
  if (!MANAGED_ENVIRONMENTS.has(environment)) {
    throw new Error('Unsupported managed deployment environment.');
  }
  if (!SAFE_REPOSITORY.test(repo))
    throw new Error('Repository must be owner/name.');
  if (workflowPath !== CANONICAL_WORKFLOW_PATH) {
    throw new Error(`Workflow path must be ${CANONICAL_WORKFLOW_PATH}.`);
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
  const workflowBytes = readBoundedRegularFileNoFollow(
    root,
    join(root, CANONICAL_WORKFLOW_PATH),
    'Canonical deployment workflow',
  );
  const collectorBytes = readBoundedRegularFileNoFollow(
    root,
    join(root, CANONICAL_COLLECTOR_PATH),
    'Canonical deployment evidence collector',
  );
  const workflowBlobSha = gitBlobSha(workflowBytes);
  const collectorDigest = `sha256:${createHash('sha256').update(collectorBytes).digest('hex')}`;

  const evidence = {
    ...(mode === 'eai-cli-generated' ? { sourceMode: mode } : {}),
    ...(targetTenant ? { targetTenantId: targetTenant } : {}),
    environment,
    workflowPath,
    workflowBlobSha,
    collectorDigest,
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
  appendOutputs(githubOutputPath, {
    config_hash: configHash,
    artifact_digest: artifactDigest,
    archive_digest: archiveDigest,
    image_digest: imageDigest,
    workflow_blob_sha: workflowBlobSha,
    collector_digest: collectorDigest,
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
        workflowBlobSha,
        collectorDigest,
        templateVersion: schemaProvenance.templateVersion,
        schemaDigest: schemaProvenance.schemaDigest,
      },
      null,
      2,
    )}\n`,
  );
}

function readJson(path) {
  const responsePath = resolve(path);
  return JSON.parse(
    readBoundedRegularFileNoFollow(
      dirname(responsePath),
      responsePath,
      'Deployment handoff response',
      MAX_HANDOFF_RESPONSE_BYTES,
    ).toString('utf8'),
  );
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
    `${buildConfigHash(resolve(option(options, 'root', process.cwd())), {
      allowWindowsValidatedFallback: true,
    })}\n`,
  );
} else if (command === 'prepare-image-context') {
  prepareImageContext(options);
} else if (command === 'write-image-archive') {
  await writeImageArchive(options);
} else if (command === 'stage-image-artifact') {
  stageImageArtifact(options);
} else if (command === 'read-image-digest') {
  readImageDigest(options);
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
