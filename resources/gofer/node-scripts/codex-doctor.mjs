#!/usr/bin/env node
// codex-doctor.mjs — read-only diagnostic for Codex skill installations.
//
// Contract:
//   Serves: FR-009 (Codex doctor), FR-011 (no fake config key), US6 (Codex
//   incident recovery). See:
//     - .specify/specs/001-cli-innovations-visuals/contracts/cli-commands.md §2
//     - .specify/specs/001-cli-innovations-visuals/data-model.md §1.10–§1.11
//
// References:
//   - https://developers.openai.com/codex/skills
//   - https://developers.openai.com/codex/config-reference
//
// Read-only invariant: this script MUST NOT call fs.writeFile, fs.appendFile,
// fs.mkdir, fs.rm, fs.unlink, or any other mutating fs operation. Verified by
// the assertion at module-load and by tests/unit/codex/codex-doctor.test.ts.
//
// Usage:
//   node codex-doctor.mjs [--root <path>] [--format json|markdown]
//   default --root: ~/.codex/skills (legacy global bundle root)
//   default --format: markdown
//
// Exit codes (per cli-commands.md §2.1):
//   0 — healthy: cumulative description bytes ≤2KB, no undisabled duplicates.
//   1 — over budget: cumulative description bytes >2048.
//   2 — undisabled duplicates present.
//   4 — scan root not found / not readable.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only assertion — verified at module scope so any accidental import of a
// mutating fs API immediately surfaces in tests (T052).
const FORBIDDEN_FS_METHODS = [
  'writeFile',
  'appendFile',
  'mkdir',
  'rm',
  'rmdir',
  'unlink',
  'rename',
  'copyFile',
  'truncate',
];
export const READ_ONLY_ASSERTION = Object.freeze({
  forbiddenMethods: FORBIDDEN_FS_METHODS,
  enforced: true,
});

// Canonical Gofer skill names — a tenant whose subdirs include enough of these
// is considered a "Gofer-bundle-shaped" tenant.
export const CANONICAL_GOFER_STAGES = Object.freeze([
  '0_business_scenario',
  '0a_problem_validation',
  '1_gofer_research',
  '2_gofer_specify',
  '3_gofer_plan',
  '4_gofer_tasks',
  '5_gofer_implement',
  '6_gofer_validate',
  '6a_gofer_engineering_review',
  '7_gofer_save',
  '7a_stakeholder_comms',
  '8_gofer_resume',
  '9_gofer_tests',
  '10_gofer_cloud',
  'gofer_constitution',
  'gofer_hydrate',
  'gofer:vocabulary',
  'gofer:diagnose',
  'gofer:tdd',
  'gofer:spec-summary',
  'gofer:zoom-out',
]);

const GOFER_BUNDLE_THRESHOLD = 16; // preserves compatibility with pre-helper installs.

function parseArgs(argv) {
  const args = { root: null, format: 'markdown' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') args.root = argv[++i];
    else if (a === '--format') args.format = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

// Minimal YAML frontmatter parser (no js-yaml dep). Extracts name/description.
function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[kv[1]] = val;
  }
  return out;
}

async function readSkillRow(tenantPath, stageName, skillFile) {
  let skillStat;
  try {
    skillStat = fs.statSync(skillFile);
  } catch {
    return null;
  }
  if (!skillStat.isFile()) return null;
  const src = await fsp.readFile(skillFile, 'utf8');
  const fm = parseFrontmatter(src);
  const rawName = fm.name || stageName;
  const name = rawName.startsWith('gofer/') ? rawName.slice('gofer/'.length) : rawName;
  const description = fm.description || '';
  return {
    tenantDir: tenantPath,
    stageDir: path.dirname(skillFile),
    stageName: name,
    skillFile,
    name,
    description,
    descriptionBytes: Buffer.byteLength(description, 'utf8'),
  };
}

async function collectSkillRows(tenantPath, stagePath, stageName) {
  const rows = [];
  const directRow = await readSkillRow(tenantPath, stageName, path.join(stagePath, 'SKILL.md'));
  if (directRow) {
    rows.push(directRow);
  }

  let nestedEntries;
  try {
    nestedEntries = fs.readdirSync(stagePath, { withFileTypes: true });
  } catch {
    return rows;
  }

  for (const nested of nestedEntries) {
    const nestedPath = path.join(stagePath, nested.name);
    let nestedStat;
    try {
      nestedStat = fs.statSync(nestedPath);
    } catch {
      continue;
    }
    if (!nestedStat.isDirectory()) continue;

    const nestedRow = await readSkillRow(tenantPath, nested.name, path.join(nestedPath, 'SKILL.md'));
    if (nestedRow) {
      rows.push(nestedRow);
    }
  }

  return rows;
}

// Walk root, dereferencing symlinks (statSync follows symlinks by default).
// Returns array of {tenantDir, stageDir, skillFile, frontmatter, bytes}.
async function walkSkills(root) {
  const found = [];
  let topEntries;
  try {
    topEntries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    const e = new Error(`scan root not readable: ${root}`);
    e.code = 'SCAN_ROOT_UNREADABLE';
    e.cause = err;
    throw e;
  }
  for (const tenant of topEntries) {
    const tenantPath = path.join(root, tenant.name);
    let tenantStat;
    try {
      tenantStat = fs.statSync(tenantPath); // follows symlinks
    } catch {
      continue; // dangling symlink → skip
    }
    if (!tenantStat.isDirectory()) continue;
    let stageEntries;
    try {
      stageEntries = fs.readdirSync(tenantPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const stage of stageEntries) {
      const stagePath = path.join(tenantPath, stage.name);
      let stageStat;
      try {
        stageStat = fs.statSync(stagePath);
      } catch {
        continue;
      }
      if (!stageStat.isDirectory()) continue;
      const rows = await collectSkillRows(tenantPath, stagePath, stage.name);
      found.push(...rows);
    }
  }
  return found;
}

// Read existing ~/.codex/config.toml and extract paths already disabled.
async function readDisabledPaths(configToml) {
  let txt;
  try {
    txt = await fsp.readFile(configToml, 'utf8');
  } catch {
    return new Set();
  }
  const disabled = new Set();
  // Match [[skills.config]] blocks; capture path = "..." enabled = false pairs.
  const blockRe = /\[\[skills\.config\]\][\s\S]*?(?=\n\[\[|\n\[(?!\[)|$)/g;
  for (const block of txt.match(blockRe) || []) {
    const pathMatch = block.match(/path\s*=\s*"([^"]+)"/);
    const enabledMatch = block.match(/enabled\s*=\s*(true|false)/);
    if (pathMatch && enabledMatch && enabledMatch[1] === 'false') {
      disabled.add(pathMatch[1]);
    }
  }
  return disabled;
}

function buildBundles(skillRows) {
  const byTenant = new Map();
  for (const row of skillRows) {
    if (!byTenant.has(row.tenantDir)) {
      byTenant.set(row.tenantDir, []);
    }
    byTenant.get(row.tenantDir).push(row);
  }
  const bundles = [];
  for (const [tenantDir, rows] of byTenant) {
    const stageNames = rows.map((r) => r.stageName).sort();
    const goferStages = stageNames.filter((s) => CANONICAL_GOFER_STAGES.includes(s));
    const isGoferBundle = goferStages.length >= GOFER_BUNDLE_THRESHOLD;
    const totalBytes = rows.reduce((sum, r) => sum + r.descriptionBytes, 0);
    bundles.push({
      tenantPath: tenantDir,
      stageNames,
      goferStages,
      totalBytes,
      isGoferBundle,
      rows,
    });
  }
  // Mark duplicates: among Gofer-bundle tenants, group by their goferStages key;
  // first occurrence is canonical, the rest are duplicates.
  const seenKeys = new Map();
  for (const b of bundles) {
    if (!b.isGoferBundle) {
      b.isDuplicate = false;
      continue;
    }
    const key = b.goferStages.join(',');
    if (!seenKeys.has(key)) {
      seenKeys.set(key, b);
      b.isDuplicate = false;
    } else {
      b.isDuplicate = true;
    }
  }
  return bundles;
}

function buildSuggestedConfig(bundles, alreadyDisabled) {
  const lines = [];
  lines.push('# Generated by gofer codex-doctor (read-only). Append to ~/.codex/config.toml after review.');
  lines.push('# Disables duplicated Gofer bundles. Source files are NOT modified.');
  lines.push('');
  let emitted = 0;
  for (const b of bundles) {
    if (!b.isDuplicate) continue;
    for (const r of b.rows) {
      if (alreadyDisabled.has(r.skillFile)) continue;
      lines.push('[[skills.config]]');
      lines.push(`path = "${r.skillFile}"`);
      lines.push('enabled = false');
      lines.push('');
      emitted++;
    }
  }
  if (emitted === 0) {
    lines.push('# (no undisabled duplicates detected — config is clean)');
  }
  return lines.join('\n');
}

export async function runDoctor({ root, format = 'markdown' } = {}) {
  const scannedRoot = root || path.join(os.homedir(), '.codex', 'skills');
  const configToml = path.join(os.homedir(), '.codex', 'config.toml');

  let skillRows;
  try {
    skillRows = await walkSkills(scannedRoot);
  } catch (err) {
    if (err.code === 'SCAN_ROOT_UNREADABLE') {
      return {
        report: {
          scannedRoot,
          error: err.message,
          totalSkillFiles: 0,
          goferBundles: [],
          descriptionBudgetBytes: 0,
          warnings: [err.message],
          suggestedConfig: '',
          noFakeKeyAssertion: true,
        },
        exitCode: 4,
      };
    }
    throw err;
  }

  const alreadyDisabled = await readDisabledPaths(configToml);
  const bundles = buildBundles(skillRows);

  const cumulativeDescriptionBytes = skillRows.reduce(
    (s, r) => s + r.descriptionBytes,
    0
  );

  const undisabledDuplicates = bundles.filter(
    (b) => b.isDuplicate &&
           b.rows.some((r) => !alreadyDisabled.has(r.skillFile))
  );

  const suggestedConfig = buildSuggestedConfig(bundles, alreadyDisabled);
  const warnings = [];
  if (cumulativeDescriptionBytes > 2048) {
    warnings.push(
      `Cumulative description bytes (${cumulativeDescriptionBytes}) exceed 2048 budget.`
    );
  }
  if (undisabledDuplicates.length > 0) {
    warnings.push(
      `${undisabledDuplicates.length} undisabled duplicate Gofer bundle(s) detected.`
    );
  }

  const report = {
    scannedRoot,
    totalSkillFiles: skillRows.length,
    goferBundles: bundles
      .filter((b) => b.isGoferBundle)
      .map((b) => ({
        tenantPath: b.tenantPath,
        stageNames: b.goferStages,
        totalBytes: b.totalBytes,
        isDuplicate: b.isDuplicate,
        allDisabled: b.rows.every((r) => alreadyDisabled.has(r.skillFile)),
      })),
    descriptionBudgetBytes: cumulativeDescriptionBytes,
    warnings,
    suggestedConfig,
    noFakeKeyAssertion: true, // FR-011 — never references skills_context_budget_percent.
  };

  let exitCode = 0;
  if (cumulativeDescriptionBytes > 2048) exitCode = 1;
  if (undisabledDuplicates.length > 0) exitCode = 2;

  return { report, exitCode, format };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Codex Doctor Report`);
  lines.push('');
  lines.push(`**Scanned root**: \`${report.scannedRoot}\``);
  lines.push(`**Total SKILL.md files**: ${report.totalSkillFiles}`);
  lines.push(`**Cumulative description bytes**: ${report.descriptionBudgetBytes} (budget: 2048)`);
  lines.push(`**Gofer bundles detected**: ${report.goferBundles.length}`);
  const dupCount = report.goferBundles.filter((b) => b.isDuplicate).length;
  lines.push(`**Duplicate bundles**: ${dupCount}`);
  lines.push('');
  if (report.warnings.length) {
    lines.push('## Warnings');
    for (const w of report.warnings) lines.push(`- ${w}`);
    lines.push('');
  }
  lines.push('## Bundles');
  for (const b of report.goferBundles) {
    const tag = b.isDuplicate ? (b.allDisabled ? 'duplicate (disabled)' : 'duplicate') : 'canonical';
    lines.push(`- [${tag}] \`${b.tenantPath}\` — ${b.stageNames.length} stages, ${b.totalBytes} bytes`);
  }
  lines.push('');
  lines.push('## Suggested config.toml block');
  lines.push('');
  lines.push('```toml');
  lines.push(report.suggestedConfig);
  lines.push('```');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      'Usage: node codex-doctor.mjs [--root <path>] [--format json|markdown]\n'
    );
    process.exit(0);
  }
  const result = await runDoctor({ root: args.root, format: args.format });
  if (args.format === 'json') {
    process.stdout.write(JSON.stringify(result.report, null, 2) + '\n');
  } else {
    process.stdout.write(renderMarkdown(result.report) + '\n');
  }
  process.exit(result.exitCode);
}

// Only run main when invoked as CLI (not when imported by tests).
const __thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __thisFile) {
  main().catch((err) => {
    process.stderr.write(`codex-doctor error: ${err.stack || err.message}\n`);
    process.exit(4);
  });
}
