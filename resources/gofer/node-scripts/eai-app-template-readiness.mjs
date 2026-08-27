#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const MANIFEST_FILE = '.eai-manifest.json';
const REQUIRED_FILES = [
  MANIFEST_FILE,
  'eai.runtime.json',
  'src/eai.config/object-types.ts',
  'src/eai.config/register.ts',
  '.env.example',
  '.npmrc',
  'package.json',
];

function parseArgs(argv) {
  const args = { root: process.cwd(), json: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root' && argv[index + 1]) {
      args.root = argv[++index];
    } else if (arg === '--json') {
      args.json = true;
    }
  }

  return args;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isCanonicalTemplateSource(value) {
  if (typeof value !== 'string' || !value.trim()) return false;

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^git\+/, '')
    .replace(/^git@github\.com:/, 'github.com/')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .replace(/\.git(?=@|$)/, '')
    .replace(/@[0-9a-f]{7,40}$/i, '')
    .replace(/\s+\(legacy scaffold inferred\)$/i, '')
    .replace(/\/+$/, '');

  return [
    'github.com/eai-support/eai-app-template',
    'github.com/eai-tools/eai-app-template',
    'eai-support/eai-app-template',
    'eai-tools/eai-app-template',
  ].includes(normalized);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function nextAction(status) {
  if (status === 'not_initialized') {
    return 'Run eai init for this app before starting Gofer app delivery.';
  }
  if (status === 'unsupported_template') {
    return 'Create a supported EAI app with eai init. Do not build over this custom template.';
  }
  if (status === 'invalid_manifest') {
    return 'Repair or recreate the app through eai init, then run this check again.';
  }
  if (status === 'partial') {
    return 'Complete or recreate the EAI app through eai init, then run this check again.';
  }
  return 'Run eai verify and eai template check before implementation.';
}

export async function checkEaiAppTemplateReadiness(root) {
  const projectRoot = path.resolve(root);
  const presence = Object.fromEntries(
    await Promise.all(
      REQUIRED_FILES.map(async (relativePath) => [
        relativePath,
        await exists(path.join(projectRoot, relativePath)),
      ])
    )
  );
  const presentFiles = REQUIRED_FILES.filter((relativePath) => presence[relativePath]);
  const missingFiles = REQUIRED_FILES.filter((relativePath) => !presence[relativePath]);

  if (presentFiles.length === 0) {
    const status = 'not_initialized';
    return {
      ready: false,
      status,
      missingFiles,
      reasons: ['No EAI app-template files were found.'],
      nextAction: nextAction(status),
    };
  }

  if (!presence[MANIFEST_FILE]) {
    const status = 'partial';
    return {
      ready: false,
      status,
      missingFiles,
      reasons: ['The project has no eai init provenance manifest.'],
      nextAction: nextAction(status),
    };
  }

  let manifest;
  try {
    manifest = await readJson(path.join(projectRoot, MANIFEST_FILE));
  } catch {
    const status = 'invalid_manifest';
    return {
      ready: false,
      status,
      missingFiles,
      reasons: ['The eai init provenance manifest is not valid JSON.'],
      nextAction: nextAction(status),
    };
  }

  const templateSource = manifest?.template?.repo ?? manifest?.template?.displaySource;
  if (!isCanonicalTemplateSource(templateSource)) {
    const status = 'unsupported_template';
    return {
      ready: false,
      status,
      missingFiles,
      reasons: ['The manifest does not identify the supported EAI app template.'],
      nextAction: nextAction(status),
    };
  }

  const reasons = [];
  if (manifest?.schemaVersion !== 1) {
    reasons.push('The project manifest schema is not supported.');
  }
  if (typeof manifest?.template?.initializedAt !== 'string' || !manifest.template.initializedAt) {
    reasons.push('The manifest does not record when eai init created the app.');
  }

  for (const jsonFile of ['eai.runtime.json', 'package.json']) {
    if (!presence[jsonFile]) continue;
    try {
      await readJson(path.join(projectRoot, jsonFile));
    } catch {
      reasons.push(`${jsonFile} is not valid JSON.`);
    }
  }

  if (missingFiles.length > 0) {
    reasons.push('Required EAI app-template files are missing.');
  }

  const ready = reasons.length === 0;
  const status = ready ? 'ready' : 'partial';
  return {
    ready,
    status,
    missingFiles,
    reasons: ready
      ? ['The project has eai init provenance and the supported app-template contract.']
      : reasons,
    nextAction: nextAction(status),
  };
}

function formatReport(report) {
  const lines = [
    report.ready ? 'EAI app template: ready' : 'EAI app template: not ready',
    `Status: ${report.status}`,
  ];

  for (const reason of report.reasons) lines.push(`- ${reason}`);
  if (report.missingFiles.length > 0) {
    lines.push(`Missing: ${report.missingFiles.join(', ')}`);
  }
  lines.push(`Next: ${report.nextAction}`);
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await checkEaiAppTemplateReadiness(args.root);
  process.stdout.write(`${args.json ? JSON.stringify(report, null, 2) : formatReport(report)}\n`);
  process.exitCode = report.ready ? 0 : 2;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
