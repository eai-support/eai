import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { cleanBuildOutput } = require('../../scripts/clean-build-output.cjs') as {
  cleanBuildOutput: (root: string) => void;
};
const compiler = fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url));

describe('release build output', () => {
  test('removes retired generated modules before rebuilding current source', () => {
    const root = mkdtempSync(join(tmpdir(), 'eai-cli-build-'));
    try {
      mkdirSync(join(root, 'src'));
      mkdirSync(join(root, 'dist'));
      writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { outDir: './dist', rootDir: './src', target: 'ES2022', types: [] },
        include: ['src/**/*'],
      }));
      writeFileSync(join(root, 'src', 'current.ts'), 'export const current = 1;\n');
      writeFileSync(join(root, 'dist', 'retired.js'), 'export const retired = 1;\n');

      cleanBuildOutput(root);
      execFileSync(process.execPath, [compiler, '--project', root], { cwd: root });

      expect(existsSync(join(root, 'dist', 'retired.js'))).toBe(false);
      expect(readFileSync(join(root, 'dist', 'current.js'), 'utf8')).toContain('current = 1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('refuses a linked output path without changing its target', () => {
    const root = mkdtempSync(join(tmpdir(), 'eai-cli-build-'));
    const target = mkdtempSync(join(tmpdir(), 'eai-cli-build-target-'));
    try {
      writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { outDir: './dist' } }));
      writeFileSync(join(target, 'preserve.js'), 'preserved\n');
      symlinkSync(target, join(root, 'dist'), process.platform === 'win32' ? 'junction' : 'dir');

      expect(() => cleanBuildOutput(root)).toThrow('linked dist path');
      expect(readFileSync(join(target, 'preserve.js'), 'utf8')).toBe('preserved\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });

  test('refuses a changed compiler output directory without deleting it', () => {
    const root = mkdtempSync(join(tmpdir(), 'eai-cli-build-'));
    try {
      mkdirSync(join(root, 'generated'));
      writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { outDir: './generated' } }));
      writeFileSync(join(root, 'generated', 'preserve.js'), 'preserved\n');

      expect(() => cleanBuildOutput(root)).toThrow('reviewed dist path');
      expect(readFileSync(join(root, 'generated', 'preserve.js'), 'utf8')).toBe('preserved\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
