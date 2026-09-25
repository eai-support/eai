#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const PRODUCER_REPOSITORY = 'eai-support/eai-app-template';
const PRODUCER_REMOTE = `https://github.com/${PRODUCER_REPOSITORY}.git`;
const PRODUCER_FILES = Object.freeze({
  workflow: '.github/workflows/eai-app.yml',
  collector: 'scripts/source-unknown-deployment-evidence.mjs',
});

function assertCanonicalProducerPaths(pin) {
  for (const [key, path] of Object.entries(PRODUCER_FILES)) {
    if (pin.candidate?.[key]?.path !== path) {
      throw new Error(`${key} path must be the canonical ${path}.`);
    }
  }
}

function resolveProducerReleaseCommit(tag, runGit = execFileSync) {
  let output;
  try {
    output = runGit(
      'git',
      [
        'ls-remote',
        '--tags',
        PRODUCER_REMOTE,
        `refs/tags/${tag}`,
        `refs/tags/${tag}^{}`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch {
    throw new Error(
      `release tag ${tag} could not be resolved from ${PRODUCER_REPOSITORY}.`,
    );
  }

  const refs = new Map(
    String(output)
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [commit, ref] = line.trim().split(/\s+/, 2);
        return [ref, commit];
      }),
  );
  const commit =
    refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`);
  if (!/^[a-f0-9]{40}$/.test(commit || '')) {
    throw new Error(
      `release tag ${tag} does not exist in ${PRODUCER_REPOSITORY}.`,
    );
  }
  return commit;
}

function assertProducerRelease(pin, runGit = execFileSync) {
  if (
    pin.releaseGate?.status !== 'released' ||
    !/^v\d+\.\d+\.\d+$/.test(pin.releaseGate?.tag || '') ||
    pin.releaseGate?.commit !== pin.candidate?.commit
  ) {
    throw new Error(
      'release is blocked until the producer publishes a new immutable tag at the reviewed candidate commit.',
    );
  }
  const remoteCommit = resolveProducerReleaseCommit(
    pin.releaseGate.tag,
    runGit,
  );
  if (remoteCommit !== pin.candidate.commit) {
    throw new Error(
      `release tag ${pin.releaseGate.tag} does not resolve to the reviewed candidate commit.`,
    );
  }
}

function verifyProducerPin({ release = false, runGit = execFileSync } = {}) {
  const root = resolve(__dirname, '..');
  const resourceRoot = join(root, 'resources', 'deploy', 'eai-app-template');
  const pin = JSON.parse(
    readFileSync(join(resourceRoot, 'producer-pin.json'), 'utf8'),
  );
  const fail = (message) => {
    console.error(`Managed deployment producer pin: ${message}`);
    process.exitCode = 1;
  };
  const digest = (path) =>
    `sha256:${createHash('sha256')
      .update(readFileSync(join(resourceRoot, path)))
      .digest('hex')}`;

  if (
    pin.schemaVersion !== 'eai.managed-deploy-producer-pin.v1' ||
    pin.repository !== PRODUCER_REPOSITORY
  )
    fail('invalid manifest identity.');
  if (!/^[a-f0-9]{40}$/.test(pin.candidate?.commit || ''))
    fail('candidate commit must be exact.');
  try {
    assertCanonicalProducerPaths(pin);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }
  for (const key of ['workflow', 'collector']) {
    const file = pin.candidate?.[key];
    if (
      !file ||
      !/^sha256:[a-f0-9]{64}$/.test(file.sha256 || '') ||
      digest(file.path) !== file.sha256
    )
      fail(`${key} bytes do not match the candidate digest.`);
  }
  const workflow = readFileSync(
    join(resourceRoot, pin.candidate.workflow.path),
    'utf8',
  );
  for (const input of [
    'source_mode',
    'app_key',
    'tenant_id',
    'target_tenant_id',
    'operation_id',
    'nonce',
    'config_hash',
    'commit_sha',
    'public_api_url',
    'env',
  ]) {
    if (!new RegExp(`^      ${input}:`, 'm').test(workflow))
      fail(`workflow does not declare dispatch input ${input}.`);
  }
  if (release && !process.exitCode) {
    try {
      assertProducerRelease(pin, runGit);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }
  if (!process.exitCode)
    console.log(
      `Managed deployment producer bytes verified at ${pin.candidate.commit}.`,
    );
}

if (require.main === module) {
  verifyProducerPin({ release: process.argv.includes('--release') });
}

module.exports = {
  PRODUCER_FILES,
  PRODUCER_REMOTE,
  assertCanonicalProducerPaths,
  assertProducerRelease,
  resolveProducerReleaseCommit,
  verifyProducerPin,
};
