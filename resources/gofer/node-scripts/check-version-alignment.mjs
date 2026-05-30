#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..', '..');

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      args.root = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  return args;
}

function readJson(root, relativePath) {
  const fullPath = path.join(root, relativePath);
  const content = fs.readFileSync(fullPath, 'utf8');
  return JSON.parse(content);
}

function readText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').trim();
}

function collectVersions(root) {
  const codexPluginManifest = readJson(root, '.codex-plugin/plugin.json');
  const releaseAssetVersion =
    /eai-gofer-agent-plugin-([^/]+)\.zip$/.exec(
      codexPluginManifest.gofer?.releaseAsset ?? ''
    )?.[1] ?? 'missing';

  return [
    {
      name: 'root package',
      path: 'package.json',
      version: readJson(root, 'package.json').version,
    },
    {
      name: 'root package lock',
      path: 'package-lock.json',
      version: readJson(root, 'package-lock.json').version,
    },
    {
      name: 'extension package',
      path: 'extension/package.json',
      version: readJson(root, 'extension/package.json').version,
    },
    {
      name: 'extension package lock',
      path: 'extension/package-lock.json',
      version: readJson(root, 'extension/package-lock.json').version,
    },
    {
      name: 'Claude plugin manifest',
      path: '.claude-plugin/plugin.json',
      version: readJson(root, '.claude-plugin/plugin.json').version,
    },
    {
      name: 'Codex plugin manifest',
      path: '.codex-plugin/plugin.json',
      version: codexPluginManifest.version,
    },
    {
      name: 'Codex plugin release asset',
      path: '.codex-plugin/plugin.json#gofer.releaseAsset',
      version: releaseAssetVersion,
    },
    {
      name: 'workspace version marker',
      path: '.specify/.gofer-version',
      version: readText(root, '.specify/.gofer-version'),
    },
  ];
}

function checkVersionAlignment(root) {
  const entries = collectVersions(root);
  const uniqueVersions = [...new Set(entries.map((entry) => entry.version))].sort();
  const aligned = uniqueVersions.length === 1;
  return {
    aligned,
    expectedVersion: aligned ? uniqueVersions[0] : undefined,
    versions: entries,
    mismatches: aligned ? [] : entries,
  };
}

function formatMarkdown(result) {
  const lines = ['# Gofer Version Alignment', ''];
  lines.push(`Status: ${result.aligned ? 'PASS' : 'FAIL'}`);
  if (result.expectedVersion) {
    lines.push(`Version: ${result.expectedVersion}`);
  }
  lines.push('', '| Source | Path | Version |', '| --- | --- | --- |');
  for (const entry of result.versions) {
    lines.push(`| ${entry.name} | \`${entry.path}\` | \`${entry.version ?? 'missing'}\` |`);
  }
  return lines.join('\n');
}

if (__filename === path.resolve(process.argv[1] ?? '')) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node .specify/scripts/node/check-version-alignment.mjs [--root <path>] [--json]

Checks that root package, extension package, plugin manifests, and .gofer-version
all carry the same Gofer release version.`);
    process.exit(0);
  }

  const result = checkVersionAlignment(args.root);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatMarkdown(result));
  }
  process.exit(result.aligned ? 0 : 1);
}

export { checkVersionAlignment, collectVersions, formatMarkdown, parseArgs };
