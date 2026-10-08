import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSite } from './build-site.mjs';

const script = fileURLToPath(new URL('./build-site.mjs', import.meta.url));

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
  return { site, canonical, registry };
}

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
