#!/usr/bin/env node
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const resourceRoot = join(root, 'resources', 'deploy', 'eai-app-template');
const pin = JSON.parse(readFileSync(join(resourceRoot, 'producer-pin.json'), 'utf8'));
const fail = message => { console.error(`Managed deployment producer pin: ${message}`); process.exitCode = 1; };
const digest = path => `sha256:${createHash('sha256').update(readFileSync(join(resourceRoot, path))).digest('hex')}`;

if (pin.schemaVersion !== 'eai.managed-deploy-producer-pin.v1' || pin.repository !== 'eai-support/eai-app-template') fail('invalid manifest identity.');
if (!/^[a-f0-9]{40}$/.test(pin.candidate?.commit || '')) fail('candidate commit must be exact.');
for (const key of ['workflow', 'collector']) {
  const file = pin.candidate?.[key];
  if (!file || !/^sha256:[a-f0-9]{64}$/.test(file.sha256 || '') || digest(file.path) !== file.sha256) fail(`${key} bytes do not match the candidate digest.`);
}
const workflow = readFileSync(join(resourceRoot, pin.candidate.workflow.path), 'utf8');
for (const input of ['source_mode', 'app_key', 'tenant_id', 'target_tenant_id', 'operation_id', 'nonce', 'config_hash', 'commit_sha', 'public_api_url', 'env']) {
  if (!new RegExp(`^      ${input}:`, 'm').test(workflow)) fail(`workflow does not declare dispatch input ${input}.`);
}
if (process.argv.includes('--release')) {
  if (pin.releaseGate?.status !== 'released' || !/^v\d+\.\d+\.\d+$/.test(pin.releaseGate?.tag || '')
    || pin.releaseGate?.commit !== pin.candidate.commit) {
    fail('release is blocked until the producer publishes a new immutable tag at the reviewed candidate commit.');
  }
}
if (!process.exitCode) console.log(`Managed deployment producer bytes verified at ${pin.candidate.commit}.`);
