import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSite } from './build-site.mjs';

const script = fileURLToPath(new URL('./build-site.mjs', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));

function fixture() {
  const site = mkdtempSync(path.join(tmpdir(), 'eai-docs-registry-test-'));
  const registry = path.join(site, 'static/registry');
  mkdirSync(path.join(registry, '@enterpriseai'), { recursive: true });
  const canonical = Buffer.from('{"latest":"3.19.2"}\n');
  for (const alias of [
    '@enterpriseai/cli',
    '%40enterpriseai%2Fcli',
    '@enterpriseai%2fcli',
    '@enterpriseai%2Fcli',
  ]) writeFileSync(path.join(registry, alias), canonical);
  const llms = [
    '- [Content Understanding](/eai/docs/content-understanding)',
    '- [Help](/eai/cli-help.txt)',
    '- [Registry](/eai/registry/)',
    '- [Canonical docs](https://eai-support.github.io/eai/docs/content-understanding)',
    '- [Unrelated](/eai-other/docs)',
    'npm install -g @enterpriseai/cli --@enterpriseai:registry=https://eai-support.github.io/eai/registry/',
    '',
  ].join('\n');
  writeFileSync(path.join(site, 'static/llms.txt'), llms);
  return { site, canonical, registry, llms };
}

for (const baseUrl of ['/eai/', '/docs/eai/', '/docs/eai']) {
  test(`build mounts local llms links at ${baseUrl} without changing source or cross-host links`, () => {
    const { site, llms } = fixture();
    try {
      buildSite(site, (_directory, prepared) => {
        cpSync(prepared, path.join(site, 'build'), { recursive: true });
        return { status: 0 };
      }, baseUrl);
      const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
      const built = readFileSync(path.join(site, 'build/llms.txt'), 'utf8');
      assert.ok(built.includes(`- [Content Understanding](${normalizedBaseUrl}docs/content-understanding)`));
      assert.ok(built.includes(`- [Help](${normalizedBaseUrl}cli-help.txt)`));
      assert.ok(built.includes(`- [Registry](${normalizedBaseUrl}registry/)`));
      for (const line of llms.split('\n').slice(3)) assert.ok(built.includes(line));
      assert.equal(readFileSync(path.join(site, 'static/llms.txt'), 'utf8'), llms);
    } finally {
      rmSync(site, { recursive: true, force: true });
    }
  });
}

test('docs asset verification rejects guidance for a different package version', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'eai-docs-guidance-test-'));
  const files = [
    'scripts/verify-docs-experience-assets.cjs',
    'package.json',
    'docs-site/static/docs-search-index.json',
    'docs-site/static/docs-capabilities.json',
    'docs-site/static/error-guidance.json',
    'docs-site/src/components/RequestBuilder/index.js',
    'docs-site/src/components/InstallerDownload/index.js',
  ];
  try {
    for (const relative of files) {
      const destination = path.join(root, relative);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(path.join(sourceRoot, relative), destination);
    }
    const verifier = path.join(root, 'scripts/verify-docs-experience-assets.cjs');
    const current = spawnSync(process.execPath, [verifier], { encoding: 'utf8' });
    assert.equal(current.status, 0, current.stderr);
    const guidancePath = path.join(root, 'docs-site/static/error-guidance.json');
    const guidance = JSON.parse(readFileSync(guidancePath, 'utf8'));
    writeFileSync(guidancePath, JSON.stringify({ ...guidance, version: '0.0.0-stale' }));
    const stale = spawnSync(process.execPath, [verifier], { encoding: 'utf8' });
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /Error guidance version does not match package version/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('build emits every registry alias from exact canonical bytes without editing the source tree', () => {
  const { site, canonical, registry } = fixture();
  let preparedStatic;
  try {
    buildSite(site, (_directory, prepared) => {
      preparedStatic = prepared;
      const staged = path.join(prepared, 'registry');
      assert.deepEqual(readFileSync(path.join(staged, '@enterpriseai%2fcli')), canonical);
      assert.equal(readdirSync(staged).includes('@enterpriseai%2Fcli'), false);
      const built = path.join(site, 'build/registry');
      mkdirSync(path.join(built, '@enterpriseai'), { recursive: true });
      for (const alias of ['@enterpriseai/cli', '%40enterpriseai%2Fcli', '@enterpriseai%2fcli']) {
        copyFileSync(path.join(staged, alias), path.join(built, alias));
      }
      return { status: 0 };
    });
    for (const alias of ['@enterpriseai/cli', '%40enterpriseai%2Fcli', '@enterpriseai%2fcli', '@enterpriseai%2Fcli']) {
      assert.deepEqual(readFileSync(path.join(site, 'build/registry', alias)), canonical);
      assert.deepEqual(readFileSync(path.join(registry, alias)), canonical);
    }
    assert.equal(existsSync(path.dirname(preparedStatic)), false);
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});

test('compiler failure cleans prepared static files and does not emit an uppercase alias', () => {
  const { site } = fixture();
  let preparedStatic;
  try {
    assert.throws(() => buildSite(site, (_directory, prepared) => {
      preparedStatic = prepared;
      return { status: 1 };
    }), /Docusaurus build failed/);
    assert.equal(existsSync(path.dirname(preparedStatic)), false);
    assert.equal(existsSync(path.join(site, 'build/registry/@enterpriseai%2Fcli')), false);
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});

test('source or compiled registry byte drift fails before publishing the second alias', () => {
  const { site, registry } = fixture();
  try {
    writeFileSync(path.join(registry, '%40enterpriseai%2Fcli'), 'changed\n');
    assert.throws(() => buildSite(site, () => ({ status: 0 })), /Static registry alias differs/);
    writeFileSync(path.join(registry, '%40enterpriseai%2Fcli'), '{"latest":"3.19.2"}\n');
    assert.throws(() => buildSite(site, (_directory, prepared) => {
      const built = path.join(site, 'build/registry');
      mkdirSync(path.join(built, '@enterpriseai'), { recursive: true });
      writeFileSync(path.join(built, '@enterpriseai/cli'), 'changed\n');
      copyFileSync(path.join(prepared, 'registry/%40enterpriseai%2Fcli'), path.join(built, '%40enterpriseai%2Fcli'));
      copyFileSync(path.join(prepared, 'registry/@enterpriseai%2fcli'), path.join(built, '@enterpriseai%2fcli'));
      return { status: 0 };
    }), /Built registry packument differs/);
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});

test('alternate output arguments are rejected before any build starts', () => {
  const result = spawnSync(process.execPath, [script, '--out-dir', '/tmp/other'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not accept alternate output arguments/);
});
