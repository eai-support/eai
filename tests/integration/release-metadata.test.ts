import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

interface PublishedPackage {
  name: string;
  'dist-tags': { latest: string };
  versions: Record<string, { name: string; version: string; dist: { shasum: string; integrity: string } }>;
}

const publication = createRequire(import.meta.url)('../../scripts/verify-docs-publication.cjs') as {
  verifyDocsPublication(options: { root: string; readPublished: () => Promise<unknown> }): Promise<{ allowed: boolean; reason: string }>;
  verifyPreparedSource(root: string): { runtimeFilesVerified: number };
};

const repoRoot = path.resolve(__dirname, '../..');
const scriptPath = path.join(repoRoot, 'scripts/update-release-doc-metadata.cjs');

describe('public documentation release qualification', () => {
  async function fixture(run: (root: string, published: PublishedPackage) => Promise<void>): Promise<void> {
    const root = mkdtempSync(path.join(tmpdir(), 'eai-docs-publication-'));
    const registry = path.join(root, 'docs-site/static/registry');
    try {
      mkdirSync(path.join(registry, '@enterpriseai'), { recursive: true });
      mkdirSync(path.join(registry, '-/@enterpriseai'), { recursive: true });
      const archive = Buffer.from('controlled canonical archive');
      const entry = { name: '@enterpriseai/cli', version: '3.20.0', dist: {
        shasum: createHash('sha1').update(archive).digest('hex'),
        integrity: 'sha512-' + createHash('sha512').update(archive).digest('base64'),
      } };
      const prepared = { name: '@enterpriseai/cli', 'dist-tags': { latest: '3.20.0' }, versions: { '3.20.0': entry } };
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@enterpriseai/cli', version: '3.20.0' }));
      for (const relative of ['@enterpriseai/cli', '@enterpriseai%2fcli', '@enterpriseai%2Fcli', '%40enterpriseai%2Fcli']) {
        writeFileSync(path.join(registry, relative), JSON.stringify(prepared));
      }
      for (const filename of ['cli-3.20.0.tgz', 'cli-latest.tgz']) writeFileSync(path.join(registry, '-/@enterpriseai', filename), archive);
      await run(root, JSON.parse(JSON.stringify(prepared)));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }

  test('matching actual canonical publication permits deployment', async () => {
    await fixture(async (root, published) => {
      expect(await publication.verifyDocsPublication({ root, readPublished: async () => published }))
        .toMatchObject({ allowed: true, reason: 'canonical-publication-matches' });
    });
  });
  test.each(['unpublished', 'wrong-name', 'wrong-latest', 'wrong-version', 'wrong-sha1', 'wrong-sha512', 'malformed'])
    ('%s publication cannot promote the prepared candidate', async kind => {
      await fixture(async (root, published) => {
        if (kind === 'unpublished') delete published.versions['3.20.0'];
        if (kind === 'wrong-name') published.name = 'eai-cli';
        if (kind === 'wrong-latest') published['dist-tags'].latest = '3.19.5';
        if (kind === 'wrong-version') published.versions['3.20.0'].version = '3.19.5';
        if (kind === 'wrong-sha1') published.versions['3.20.0'].dist.shasum = '0'.repeat(40);
        if (kind === 'wrong-sha512') published.versions['3.20.0'].dist.integrity = 'sha512-wrong';
        expect(await publication.verifyDocsPublication({ root, readPublished: async () => kind === 'malformed' ? null : published }))
          .toMatchObject({ allowed: false });
      });
    });
  test('publication read failure fails closed without echoing transport details', async () => {
    await fixture(async (root) => {
      const result = await publication.verifyDocsPublication({ root, readPublished: async () => { throw new Error('private-transport-value'); } });
      expect(result).toMatchObject({ allowed: false, reason: 'canonical-publication-unavailable' });
      expect(JSON.stringify(result)).not.toContain('private-transport-value');
    });
  });
  test.each(['alias', 'latest-archive', 'versioned-archive'])('invalid prepared %s blocks before the primary request', async kind => {
    await fixture(async (root, published) => {
      const registry = path.join(root, 'docs-site/static/registry');
      const relative = kind === 'alias' ? '@enterpriseai%2Fcli' : '-/@enterpriseai/' + (kind === 'latest-archive' ? 'cli-latest.tgz' : 'cli-3.20.0.tgz');
      writeFileSync(path.join(registry, relative), 'changed');
      let reads = 0;
      expect(await publication.verifyDocsPublication({ root, readPublished: async () => { reads++; return published; } }))
        .toMatchObject({ allowed: false, reason: 'prepared-artifacts-invalid' });
      expect(reads).toBe(0);
    });
  });
  test('real prepared archive exactly matches all current packaged runtime files', () => {
    expect(publication.verifyPreparedSource(repoRoot).runtimeFilesVerified).toBeGreaterThan(0);
  });
  test('a checksummed prepared archive cannot publish different current runtime source', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'eai-prepared-source-mismatch-'));
    try {
      for (const relative of ['dist', 'resources', 'package.json', 'docs-site/static/registry']) {
        cpSync(path.join(repoRoot, relative), path.join(root, relative), { recursive: true });
      }
      const binary = path.join(root, 'dist/index.js');
      writeFileSync(binary, readFileSync(binary, 'utf8') + '\n// changed current runtime\n');
      expect(() => publication.verifyPreparedSource(root)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test('Docs validation remains unconditional and every publication path requires the real proof', () => {
    const docs = readFileSync(path.join(repoRoot, '.github/workflows/docs.yml'), 'utf8');
    const validate = docs.split('\n  validate:\n')[1].split('\n  publication:\n')[0];
    expect(validate).not.toContain('\n    if:');
    expect(docs).toContain('if node scripts/verify-docs-publication.cjs; then');
    expect(docs).toContain('needs: [validate, publication]');
    expect(docs).toContain("if: needs.publication.outputs.allowed == 'true'");
    expect(docs.indexOf('needs: [validate, publication]')).toBeLessThan(docs.indexOf('name: Configure Pages'));
  });
  test.each([
    { release: false, proof: false, exitCode: 0, allowed: 'false' },
    { release: true, proof: false, exitCode: 1, allowed: 'false' },
    { release: false, proof: true, exitCode: 0, allowed: 'true' },
    { release: true, proof: true, exitCode: 0, allowed: 'true' },
  ])('publication step release=$release proof=$proof returns $exitCode with $allowed deployment', ({ release, proof, exitCode, allowed }) => {
    const docs = readFileSync(path.join(repoRoot, '.github/workflows/docs.yml'), 'utf8');
    expect(docs).toContain("REQUIRE_PUBLISHED_RELEASE: ${{ startsWith(github.ref, 'refs/tags/v') }}");
    const block = docs.split('id: publication\n')[1].split('run: |\n')[1].split('\n\n  deploy:')[0];
    const shell = block.split('\n').map(line => line.slice(10)).join('\n')
      .replace('node scripts/verify-docs-publication.cjs', proof ? 'true' : 'false');
    const root = mkdtempSync(path.join(tmpdir(), 'eai-docs-proof-step-'));
    try {
      const output = path.join(root, 'output');
      let observed = 0;
      try { execFileSync('/bin/bash', ['-e', '-c', shell], { env: { ...process.env, GITHUB_OUTPUT: output, REQUIRE_PUBLISHED_RELEASE: String(release) }, stdio: 'pipe' }); }
      catch (error) { observed = (error as { status: number }).status; }
      expect(observed).toBe(exitCode);
      expect(readFileSync(output, 'utf8')).toBe(`allowed=${allowed}\n`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test('owner release publishes the verified prepared archive before qualified Docs and never waits before tagging', () => {
    const release = readFileSync(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
    expect(release).toContain('node scripts/verify-docs-publication.cjs --prepared-source');
    expect(release).toContain('npm publish --access public --provenance "docs-site/static/registry/-/@enterpriseai/cli-${VERSION}.tgz"');
    expect(release).toContain('npm run verify:managed-deploy-producer:release');
    expect(release).toContain('npm run lint:no-placeholder');
    expect(release).toContain('needs: release\n    uses: ./.github/workflows/docs.yml');
    expect(release).toContain('publish_github_pages: true');
    const owner = readFileSync(path.join(repoRoot, 'release.sh'), 'utf8').split('if [[ "$RELEASE_PHASE" == "publish" ]]; then').at(-1) || '';
    expect(owner.slice(0, owner.indexOf('git push origin "$TAG_NAME"'))).not.toContain('wait_for_main_docs_run');
    expect(owner).toContain('wait_for_release_run "$TAG_NAME"');
  });
});

describe('release metadata updater', () => {
  test('updates the consolidated public docs tree', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'eai-release-docs-'));

    try {
      const techDocs = path.join(workspace, '.tech-docs');
      mkdirSync(techDocs, { recursive: true });

      writeFileSync(
        path.join(techDocs, 'start-here.md'),
        ['---', 'generated: false', 'title: Start Here', '---', '', '# Start Here', '', '## What The Pieces Do', '', 'Existing copy.', ''].join('\n'),
      );
      writeFileSync(
        path.join(techDocs, 'eai-cli.md'),
        ['---', 'generated: false', 'title: EAI CLI', '---', '', '# EAI CLI', '', '## Common Workflow', '', 'Existing workflow.', ''].join('\n'),
      );
      writeFileSync(
        path.join(techDocs, 'api-reference.md'),
        ['---', 'generated: true', 'generated_at: "2026-01-01T00:00:00.000Z"', 'source_commit: "old"', '---', '', '# API Reference', ''].join('\n'),
      );
      writeFileSync(
        path.join(techDocs, 'configuration.md'),
        ['---', 'generated: true', 'generated_at: "2026-01-01T00:00:00.000Z"', 'source_commit: "old"', '---', '', '# Configuration', ''].join('\n'),
      );

      execFileSync(process.execPath, [scriptPath, '9.9.9', 'Metadata smoke test'], {
        cwd: repoRoot,
        env: {
          ...process.env,
          EAI_RELEASE_METADATA_ROOT: workspace,
        },
      });

      expect(readFileSync(path.join(techDocs, 'start-here.md'), 'utf-8')).toContain(
        'The current CLI release is **v9.9.9**',
      );
      expect(readFileSync(path.join(techDocs, 'eai-cli.md'), 'utf-8')).toContain(
        '| Version | 9.9.9 |',
      );
      expect(readFileSync(path.join(techDocs, 'api-reference.md'), 'utf-8')).toContain(
        'source_commit:',
      );
      expect(readFileSync(path.join(techDocs, 'configuration.md'), 'utf-8')).not.toContain(
        'source_commit: "old"',
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('managed-deployment release documentation', () => {
  test('ships the managed deployment help and portable documentation', () => {
    const help = readFileSync(path.join(repoRoot, 'docs-site/static/cli-help.txt'), 'utf-8');
    const full = readFileSync(path.join(repoRoot, 'docs-site/static/llms-full.txt'), 'utf-8');
    for (const asset of [help, full]) {
      expect(asset).toContain('eai deploy app --help');
      expect(asset).toContain('--target-tenant-id <id>');
      expect(asset).toContain('--resume <operation-id>');
    }
    expect(full).not.toContain("import Link from '@docusaurus/Link'");
    expect(full).not.toContain('<Link to=');
    expect(full).toContain('[Business Scenarios](/scenarios/)');
  });
});

describe('static registry release staging', () => {
  test.skipIf(process.platform === 'win32')('stages every encoded alias from the new canonical Git blob', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'eai-release-registry-'));
    const canonical = 'docs-site/static/registry/@enterpriseai/cli';
    const aliases = [
      'docs-site/static/registry/%40enterpriseai%2Fcli',
      'docs-site/static/registry/@enterpriseai%2fcli',
      'docs-site/static/registry/@enterpriseai%2Fcli',
    ];
    const git = (...args: string[]) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8' }).trim();

    try {
      git('init', '-q');
      mkdirSync(path.join(workspace, 'docs-site/static/registry/@enterpriseai'), { recursive: true });
      writeFileSync(path.join(workspace, canonical), '{"latest":"3.19.2"}\n');
      git('add', canonical);
      const expected = git('rev-parse', `:${canonical}`);
      for (const [index, alias] of aliases.entries()) {
        const old = execFileSync('git', ['hash-object', '-w', '--stdin'], {
          cwd: workspace,
          input: `{"latest":"3.19.${index}"}\n`,
          encoding: 'utf8',
        }).trim();
        git('update-index', '--add', '--cacheinfo', `100644,${old},${alias}`);
        expect(git('rev-parse', `:${alias}`)).toBe(old);
      }

      const release = readFileSync(path.join(repoRoot, 'release.sh'), 'utf8');
      const start = release.indexOf('PACKUMENT_BLOB="$(git hash-object -w docs-site/static/registry/@enterpriseai/cli)"');
      const end = release.indexOf('\ngit commit -m ', start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      execFileSync('/bin/bash', ['-e', '-c', release.slice(start, end)], { cwd: workspace });

      for (const alias of aliases) {
        expect(git('rev-parse', `:${alias}`)).toBe(expected);
      }
      expect(git('rev-parse', `:${canonical}`)).toBe(expected);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
