import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
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

  test.each([
    { registryPass: false, vitestPass: true },
    { registryPass: false, vitestPass: false },
    { registryPass: true, vitestPass: false },
    { registryPass: true, vitestPass: true },
  ])('both actual CI suites retain JUnit when registry=$registryPass and Vitest=$vitestPass', ({ registryPass, vitestPass }) => {
    const fixture = mkdtempSync(join(tmpdir(), 'eai-ci-artifacts-'));
    try {
      mkdirSync(join(fixture, 'tests'));
      writeFileSync(join(fixture, 'registry.test.mjs'), `import { test } from 'node:test'; import assert from 'node:assert/strict'; test('registry fixture', () => assert.equal(true, ${registryPass}));\n`);
      writeFileSync(join(fixture, 'tests', 'artifact.test.ts'), `import { test, expect } from 'vitest'; test('Vitest fixture', () => expect(true).toBe(${vitestPass}));\n`);
      let command = focusedCommand.replace('docs-site/scripts/build-site.test.mjs', 'registry.test.mjs');
      let inserted = false;
      command = command.replace(/tests\/[^\s]+\.test\.ts/g, () => {
        if (inserted) return '';
        inserted = true;
        return 'tests/artifact.test.ts';
      });
      command = command.replace('node scripts/run-eai-cli-tests.cjs', `node ${JSON.stringify(join(root, 'scripts', 'run-eai-cli-tests.cjs'))}`);
      writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'eai-ci-artifact-fixture', private: true, type: 'module', scripts: { 'test:eai-cli:ci': command } }));
      // Resolve the real installed test tools from their owning repository.
      const toolEnvironment = { ...process.env, PATH: `${join(root, 'node_modules', '.bin')}${delimiter}${process.env.PATH || ''}` };
      const npm = process.env.npm_execpath;
      const executable = npm ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const args = [...(npm ? [npm] : []), 'run', 'test:eai-cli:ci', '--', '--maxWorkers=1'];
      let status = 0;
      try { execFileSync(executable, args, { cwd: fixture, env: toolEnvironment, stdio: 'pipe', timeout: 30_000 }); }
      catch (failure) {
        const error = failure as { status?: number; stdout?: Buffer; stderr?: Buffer };
        if (typeof error.status !== 'number') throw failure;
        status = error.status;
      }
      expect(status).toBe(registryPass && vitestPass ? 0 : 1);
      for (const report of ['eai-cli-registry-results.xml', 'eai-cli-results.xml']) {
        const path = join(fixture, 'test-results', report);
        expect(existsSync(path), `CI skipped ${report}`).toBe(true);
        expect(readFileSync(path, 'utf8')).toContain('<testsuite');
      }
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  }, 30_000);

  test('the named CI check runs the focused gate and retains its evidence', () => {
    const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    const focusedJob = workflow.split(/^  eai-cli-tests:\s*$/m)[1];
    expect(focusedJob).toBeDefined();
    expect(focusedJob).toMatch(/^    name: ci\/eai-cli-tests\s*$/m);
    expect(focusedJob).toContain('run: npm run test:eai-cli:ci');
    expect(focusedCommand).toContain('--reporter=junit');
    expect(focusedCommand).toContain('--outputFile=test-results/eai-cli-results.xml');
    expect(focusedCommand).toContain('node scripts/run-eai-cli-tests.cjs docs-site/scripts/build-site.test.mjs -- ');
    expect(focusedJob).toContain('test-results/eai-cli-results.xml');
    expect(focusedJob).toContain('test-results/eai-cli-registry-results.xml');
    expect(focusedJob).toContain('test-results/eai-cli-evidence.json');
  });

  test('stacked pull requests receive the required check with read-only repository permissions', () => {
    const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    const lines = workflow.split('\n');
    const eventIndex = lines.indexOf('  pull_request:');
    expect(eventIndex).toBeGreaterThan(-1);
    const following = lines.slice(eventIndex + 1);
    const nextBlock = following.findIndex(line => /^(?:\S|  \S)/.test(line));
    const eventOptions = following.slice(0, nextBlock === -1 ? undefined : nextBlock).join('\n');
    expect(eventOptions).not.toMatch(/^    (?:branches|branches-ignore|paths|paths-ignore):/m);
    expect(workflow).toMatch(/^permissions:\n  contents: read\n/m);
    expect(workflow).toMatch(/^  push:\n    branches: \[main\]\n/m);
  });
});
