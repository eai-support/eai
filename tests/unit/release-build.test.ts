import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { cleanBuildOutput } = require('../../scripts/clean-build-output.cjs') as {
  cleanBuildOutput: (root: string) => void;
};
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourcePackage = require('../../package.json') as { scripts: { build: string; prepare: string } };

describe('release build output', () => {
  test('npm pack prepare removes retired generated modules and packages current source', () => {
    const root = mkdtempSync(join(tmpdir(), 'eai-cli-build-'));
    try {
      mkdirSync(join(root, 'src'));
      mkdirSync(join(root, 'dist'));
      mkdirSync(join(root, 'scripts'));
      writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { outDir: './dist', rootDir: './src', target: 'ES2022', types: [] },
        include: ['src/**/*'],
      }));
      writeFileSync(join(root, 'package.json'), JSON.stringify({
        name: 'eai-cli-release-build-fixture',
        version: '0.0.1',
        scripts: sourcePackage.scripts,
        files: ['dist'],
      }));
      copyFileSync(join(sourceRoot, 'scripts', 'clean-build-output.cjs'), join(root, 'scripts', 'clean-build-output.cjs'));
      writeFileSync(join(root, 'src', 'current.ts'), 'export const current = 1;\n');
      writeFileSync(join(root, 'dist', 'retired.js'), 'export const retired = 1;\n');

      const npm = process.env.npm_execpath;
      const command = npm ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const args = npm ? [npm, 'pack', '--dry-run', '--json'] : ['pack', '--dry-run', '--json'];
      const output = execFileSync(command, args, {
        cwd: root,
        env: { ...process.env, PATH: `${join(sourceRoot, 'node_modules', '.bin')}${delimiter}${process.env.PATH || ''}` },
        encoding: 'utf8',
      });
      const packed = JSON.parse(output) as Array<{ files: Array<{ path: string }> }>;

      expect(existsSync(join(root, 'dist', 'retired.js'))).toBe(false);
      expect(readFileSync(join(root, 'dist', 'current.js'), 'utf8')).toContain('current = 1');
      expect(packed[0].files.map((file) => file.path)).toContain('dist/current.js');
      expect(packed[0].files.map((file) => file.path)).not.toContain('dist/retired.js');
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
