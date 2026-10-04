#!/usr/bin/env node

import { promises as fs } from 'fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'path';
import { fileURLToPath } from 'url';

const MANIFEST_FILE = '.eai-manifest.json';
const execute = promisify(execFile);
const SOURCE_SCHEMA = 'eai.cli_managed_source_validation.v1';
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
    } else if (arg === '--source' || arg === '--cli') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('Source and CLI options require an explicit value.');
      args[arg.slice(2)] = value;
    }
  }

  if (args.source && !['eai-managed', 'customer-owned', 'local-only'].includes(args.source)) {
    throw new Error('Select eai-managed, customer-owned, or local-only source validation.');
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
    // The template is pinned by release tag as well as by commit SHA, so both
    // ref shapes must normalize away before the canonical-source comparison.
    .replace(/@(?:v\d+\.\d+\.\d+|[0-9a-f]{7,40})$/i, '')
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
  if (status === 'source_not_ready') {
    return 'Resolve the managed-source validation finding before reporting deployment readiness. Preserve business changes; do not omit them or restore files automatically.';
  }
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

function sourceFailure(code) {
  return { status: 'failed', code };
}

/** INVARIANT: Reuse the selected CLI publication boundary without auth, publication, or source-content output. */
async function checkManagedSourceReadiness(root, cli = 'eai') {
  const args = ['deploy', 'source', 'validate', '--format', 'json'];
  let command = cli;
  let commandArgs = args;
  if (/\.(?:c?js|mjs)$/i.test(cli)) {
    command = process.execPath;
    commandArgs = [path.resolve(cli), ...args];
  } else if (process.platform === 'win32') {
    // SECURITY: cmd shims receive only a quoted executable and fixed arguments, never shell syntax from a path.
    if (/["%\!\r\n&|<>^]/.test(cli)) return sourceFailure('SOURCE_VALIDATOR_UNAVAILABLE');
    command = process.env.ComSpec || 'cmd.exe';
    commandArgs = ['/d', '/s', '/c', `""${cli}" ${args.join(' ')}"`];
  }
  let stdout;
  let exitCode = 0;
  try {
    ({ stdout } = await execute(command, commandArgs, {
      cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024, windowsHide: true,
    }));
  } catch (error) {
    if (error.code !== 1 || typeof error.stdout !== 'string') {
      return sourceFailure('SOURCE_VALIDATOR_UNAVAILABLE');
    }
    stdout = error.stdout;
    exitCode = 1;
  }
  try {
    const report = JSON.parse(stdout);
    if (!report || report.schemaVersion !== SOURCE_SCHEMA || report.sourceMode !== 'eai-cli-generated') {
      return sourceFailure('SOURCE_VALIDATOR_INVALID');
    }
    const keys = Object.keys(report).sort().join(',');
    if (exitCode === 0 && report.status === 'passed'
      && keys === 'fileCount,schemaVersion,sourceMode,status,templateCommitSha,totalBytes'
      && typeof report.templateCommitSha === 'string' && /^[a-f0-9]{40}$/.test(report.templateCommitSha)
      && Number.isSafeInteger(report.fileCount) && report.fileCount >= 1 && report.fileCount <= 500
      && Number.isSafeInteger(report.totalBytes) && report.totalBytes >= 1 && report.totalBytes <= 20 * 1024 * 1024) {
      return { status: 'passed', fileCount: report.fileCount, totalBytes: report.totalBytes };
    }
    if (exitCode === 1 && report.status === 'failed'
      && keys === 'error,schemaVersion,sourceMode,status'
      && report.error && Object.keys(report.error).sort().join(',') === 'code,message'
      && typeof report.error.code === 'string' && /^(?:SOURCE_[A-Z0-9_]{1,64}|TEMPLATE_PIN_CHANGED)$/.test(report.error.code)
      && typeof report.error.message === 'string' && report.error.message.length <= 4096) {
      return sourceFailure(report.error.code);
    }
  } catch { /* Invalid CLI output must not become readiness or be printed. */ }
  return sourceFailure('SOURCE_VALIDATOR_INVALID');
}

export async function checkEaiAppTemplateReadiness(root, { source, cli } = {}) {
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
  if (ready && source === 'eai-managed') {
    const sourceValidation = await checkManagedSourceReadiness(projectRoot, cli);
    if (sourceValidation.status !== 'passed') {
      return {
        ready: false, status: 'source_not_ready', missingFiles,
        reasons: [`Managed source validation failed: ${sourceValidation.code}.`],
        sourceValidation, nextAction: nextAction('source_not_ready'),
      };
    }
    return {
      ready: true, status: 'ready', missingFiles,
      reasons: ['The supported app template and current managed source passed read-only validation.'],
      sourceValidation, nextAction: 'Continue app validation. This check does not prove publication or deployment.',
    };
  }
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
  const report = await checkEaiAppTemplateReadiness(args.root, args);
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
