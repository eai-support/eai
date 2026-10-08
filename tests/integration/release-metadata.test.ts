import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const scriptPath = path.join(repoRoot, 'scripts/update-release-doc-metadata.cjs');

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
