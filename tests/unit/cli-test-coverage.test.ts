import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

interface FeatureCoverage {
  id: string;
  required_repo_tests: string[];
  required_ci_checks: string[];
}

const root = fileURLToPath(new URL('../../', import.meta.url));
const coverage = JSON.parse(readFileSync(join(root, '.eai/test-coverage.json'), 'utf8')) as {
  repositories: { eai: { features: FeatureCoverage[] } };
};
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const focusedCommand = packageJson.scripts['test:eai-cli:ci'];
const focusedSuites = focusedCommand.split(/\s+/).filter(argument => /^(?:tests\/.*\.test\.ts|docs-site\/scripts\/.*\.test\.mjs)$/.test(argument));
const focusedSuiteSet = new Set(focusedSuites);

describe('focused CLI evidence ownership', () => {
  test('the focused gate selects existing explicit suites without duplicates', () => {
    expect(focusedSuites.length).toBeGreaterThan(0);
    expect(focusedSuiteSet.size).toBe(focusedSuites.length);
    for (const suite of focusedSuites) {
      expect(existsSync(join(root, suite)), `Focused suite is missing: ${suite}`).toBe(true);
    }
  });

  test.each(coverage.repositories.eai.features)('$id required tests belong to their CI gate', feature => {
    expect(feature.required_ci_checks).toContain('ci/eai-cli-tests');
    expect(new Set(feature.required_repo_tests).size).toBe(feature.required_repo_tests.length);
    for (const suite of feature.required_repo_tests) {
      expect(existsSync(join(root, suite)), `${feature.id} required suite is missing: ${suite}`).toBe(true);
      expect(focusedSuiteSet.has(suite), `${feature.id} required suite is absent from ci/eai-cli-tests: ${suite}`).toBe(true);
    }
  });

  test('the named CI check runs the focused gate and retains its evidence', () => {
    const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    const focusedJob = workflow.split(/^  eai-cli-tests:\s*$/m)[1];
    expect(focusedJob).toBeDefined();
    expect(focusedJob).toMatch(/^    name: ci\/eai-cli-tests\s*$/m);
    expect(focusedJob).toContain('run: npm run test:eai-cli:ci');
    expect(focusedCommand).toContain('--reporter=junit');
    expect(focusedCommand).toContain('--outputFile=test-results/eai-cli-results.xml');
    expect(focusedCommand).toContain('node --test --test-reporter=junit');
    expect(focusedCommand).toContain('--test-reporter-destination=test-results/eai-cli-registry-results.xml docs-site/scripts/build-site.test.mjs');
    expect(focusedJob).toContain('test-results/eai-cli-results.xml');
    expect(focusedJob).toContain('test-results/eai-cli-registry-results.xml');
    expect(focusedJob).toContain('test-results/eai-cli-evidence.json');
  });
});
