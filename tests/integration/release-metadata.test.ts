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
