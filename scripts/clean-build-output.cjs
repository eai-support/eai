#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function cleanBuildOutput(root) {
  const sourceRoot = fs.realpathSync(root);
  const tsconfig = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'tsconfig.json'), 'utf8'));
  const output = path.join(sourceRoot, 'dist');
  if (path.resolve(sourceRoot, tsconfig.compilerOptions?.outDir || '') !== output) {
    throw new Error('TypeScript output directory is no longer the reviewed dist path');
  }

  let metadata;
  try {
    metadata = fs.lstatSync(output);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Refusing to clean a non-directory or linked dist path');
  }
  fs.rmSync(output, { recursive: true });
}

if (require.main === module) cleanBuildOutput(path.join(__dirname, '..'));

module.exports = { cleanBuildOutput };
