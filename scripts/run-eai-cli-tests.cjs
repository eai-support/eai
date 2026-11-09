#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const [registryTest, separator, ...vitestArguments] = process.argv.slice(2);
if (!registryTest || separator !== '--' || vitestArguments.length === 0) {
  throw new Error('Usage: run-eai-cli-tests.cjs <registry-test> -- <Vitest suites and options>');
}

mkdirSync('test-results', { recursive: true });
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const suites = [
  ['--test', '--test-reporter=junit', '--test-reporter-destination=test-results/eai-cli-registry-results.xml', registryTest],
  [vitest, 'run', ...vitestArguments],
];

let failed = false;
for (const args of suites) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
