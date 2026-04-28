#!/usr/bin/env node
/**
 * generate-commands.mjs
 * Generates surface-specific command/skill files from canonical stage definitions.
 *
 * Usage:
 *   node generate-commands.mjs [--dry-run] [--surfaces <comma-list>] [--root <path>]
 *
 * Surfaces: claude, claude-mirror, copilot, github-prompts, agents-skills,
 *           system-skills, gemini, agents-md, codex-config
 */

import { promises as fs } from 'fs';
import path from 'path';
import { CANONICAL_DESCRIPTIONS, validateDescriptions } from './canonical-descriptions.mjs';
import { parseStageCommand } from './parse-stage-command.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Stages that are exclusive to Claude surfaces and must not be emitted
 * to non-Claude surfaces (codex, gemini, copilot, github-prompts, etc.).
 */
export const CLAUDE_ONLY_STAGES = [
  '0_business_scenario',
  'gofer_constitution',
  'gofer_hydrate',
  '7_gofer_save',
  '8_gofer_resume',
];

const ALL_SURFACES = [
  'claude',
  'claude-mirror',
  'copilot',
  'github-prompts',
  'agents-skills',
  'system-skills',
  'gemini',
  'agents-md',
  'codex-config',
];

// ---------------------------------------------------------------------------
// Exclusion logic
// ---------------------------------------------------------------------------

/**
 * Returns true if the given stage should be excluded from the given surface.
 * Claude-only stages are excluded from every surface except 'claude' and 'claude-mirror'.
 *
 * @param {string} stageName
 * @param {string} surface
 * @returns {boolean}
 */
export function shouldExclude(stageName, surface) {
  if (!CLAUDE_ONLY_STAGES.includes(stageName)) {
    return false;
  }
  return surface !== 'claude' && surface !== 'claude-mirror';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ensures a directory exists, creating it (and parents) if needed.
 * @param {string} dirPath
 */
async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Loads and parses all stage command files from .specify/commands/.
 * Skips .gitkeep and any non-.md files.
 *
 * @param {string} root Absolute path to project root
 * @returns {Promise<Array<{ filePath: string, frontmatter: Record<string, unknown>, body: string }>>}
 */
async function loadStages(root) {
  const commandsDir = path.join(root, '.specify', 'commands');
  let entries;
  try {
    entries = await fs.readdir(commandsDir);
  } catch {
    console.warn(`[warn] .specify/commands/ not found at ${commandsDir} — no stages loaded`);
    return [];
  }

  const stages = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry === '.gitkeep') continue;
    const filePath = path.join(commandsDir, entry);
    try {
      const parsed = await parseStageCommand(filePath);
      stages.push({ filePath, ...parsed });
    } catch (err) {
      console.warn(`[warn] Skipping ${entry}: ${err.message}`);
    }
  }
  return stages;
}

// ---------------------------------------------------------------------------
// Surface emitters
// ---------------------------------------------------------------------------

/**
 * T037 — claude emitter
 * Emits body to .claude/commands/<name>.md for stages that include 'claude' surface.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitClaude(stages, root, dryRun) {
  const outDir = path.join(root, '.claude', 'commands');
  let count = 0;
  for (const stage of stages) {
    const { name, surfaces } = stage.frontmatter;
    if (!surfaces.includes('claude')) continue;
    if (shouldExclude(String(name), 'claude')) continue;

    const outPath = path.join(outDir, `${name}.md`);
    if (dryRun) {
      console.log(`[dry-run] claude: would write ${outPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(outPath, stage.body, 'utf8');
      console.log(`claude: wrote ${outPath}`);
    }
    count++;
  }
  console.log(`claude: ${count} file(s) emitted`);
  return true;
}

/**
 * T038 — claude-mirror emitter
 * Emits body to extension/resources/claude-commands/<name>.md.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitClaudeMirror(stages, root, dryRun) {
  const outDir = path.join(root, 'extension', 'resources', 'claude-commands');
  let count = 0;
  for (const stage of stages) {
    const { name, surfaces } = stage.frontmatter;
    if (!surfaces.includes('claude-mirror')) continue;
    if (shouldExclude(String(name), 'claude-mirror')) continue;

    const outPath = path.join(outDir, `${name}.md`);
    if (dryRun) {
      console.log(`[dry-run] claude-mirror: would write ${outPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(outPath, stage.body, 'utf8');
      console.log(`claude-mirror: wrote ${outPath}`);
    }
    count++;
  }
  console.log(`claude-mirror: ${count} file(s) emitted`);
  return true;
}

/**
 * T039 — copilot emitter
 * Emits body to extension/resources/copilot-prompts/<name>.prompt.md.
 * Skips CLAUDE_ONLY_STAGES entirely.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitCopilot(stages, root, dryRun) {
  const outDir = path.join(root, 'extension', 'resources', 'copilot-prompts');
  let count = 0;
  for (const stage of stages) {
    const { name, surfaces } = stage.frontmatter;
    if (shouldExclude(String(name), 'copilot')) continue;
    if (!surfaces.includes('copilot')) continue;

    const outPath = path.join(outDir, `${name}.prompt.md`);
    if (dryRun) {
      console.log(`[dry-run] copilot: would write ${outPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(outPath, stage.body, 'utf8');
      console.log(`copilot: wrote ${outPath}`);
    }
    count++;
  }
  console.log(`copilot: ${count} file(s) emitted`);
  return true;
}

/**
 * T040 — github-prompts emitter
 * Emits body to .github/prompts/<name>.prompt.md.
 * Skips CLAUDE_ONLY_STAGES entirely.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitGithubPrompts(stages, root, dryRun) {
  const outDir = path.join(root, '.github', 'prompts');
  let count = 0;
  for (const stage of stages) {
    const { name, surfaces } = stage.frontmatter;
    if (shouldExclude(String(name), 'github-prompts')) continue;
    if (!surfaces.includes('github-prompts')) continue;

    const outPath = path.join(outDir, `${name}.prompt.md`);
    if (dryRun) {
      console.log(`[dry-run] github-prompts: would write ${outPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(outPath, stage.body, 'utf8');
      console.log(`github-prompts: wrote ${outPath}`);
    }
    count++;
  }
  console.log(`github-prompts: ${count} file(s) emitted`);
  return true;
}

/**
 * Builds a SKILL.md content string.
 * @param {string} stageName
 * @param {string} description
 * @param {string} body
 * @returns {string}
 */
function buildSkillContent(stageName, description, body) {
  return `---\nname: gofer/${stageName}\ndescription: "${description}"\n---\n\n${body}`;
}

/**
 * T041 — agents-skills emitter
 * Emits Codex SKILL.md to .agents/skills/gofer/<name>/SKILL.md.
 * Skips CLAUDE_ONLY_STAGES entirely.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitAgentsSkills(stages, root, dryRun) {
  const baseDir = path.join(root, '.agents', 'skills', 'gofer');
  let count = 0;
  for (const stage of stages) {
    const { name, description, surfaces } = stage.frontmatter;
    if (shouldExclude(String(name), 'agents-skills')) continue;
    if (!surfaces.includes('agents-skills')) continue;

    const skillDir = path.join(baseDir, String(name));
    const outPath = path.join(skillDir, 'SKILL.md');
    const content = buildSkillContent(String(name), String(description), stage.body);

    if (dryRun) {
      console.log(`[dry-run] agents-skills: would write ${outPath}`);
    } else {
      await ensureDir(skillDir);
      await fs.writeFile(outPath, content, 'utf8');
      console.log(`agents-skills: wrote ${outPath}`);
    }
    count++;
  }
  console.log(`agents-skills: ${count} file(s) emitted`);
  return true;
}

/**
 * T042 — system-skills emitter
 * Emits SKILL.md to .system/skills/gofer/<name>/SKILL.md.
 * Skips CLAUDE_ONLY_STAGES entirely.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitSystemSkills(stages, root, dryRun) {
  const baseDir = path.join(root, '.system', 'skills', 'gofer');
  let count = 0;
  for (const stage of stages) {
    const { name, description, surfaces } = stage.frontmatter;
    if (shouldExclude(String(name), 'system-skills')) continue;
    if (!surfaces.includes('system-skills')) continue;

    const skillDir = path.join(baseDir, String(name));
    const outPath = path.join(skillDir, 'SKILL.md');
    const content = buildSkillContent(String(name), String(description), stage.body);

    if (dryRun) {
      console.log(`[dry-run] system-skills: would write ${outPath}`);
    } else {
      await ensureDir(skillDir);
      await fs.writeFile(outPath, content, 'utf8');
      console.log(`system-skills: wrote ${outPath}`);
    }
    count++;
  }
  console.log(`system-skills: ${count} file(s) emitted`);
  return true;
}

/**
 * T065 — gemini emitter
 * Emits plain markdown body to .gemini/commands/gofer/<name>.md.
 * Skips CLAUDE_ONLY_STAGES entirely.
 * T066 — also creates .gemini/commands/gofer/manifest.json listing all emitted stage names.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitGemini(stages, root, dryRun) {
  const outDir = path.join(root, '.gemini', 'commands', 'gofer');
  const emittedNames = [];
  let count = 0;

  for (const stage of stages) {
    const { name, surfaces } = stage.frontmatter;
    if (shouldExclude(String(name), 'gemini')) continue;
    if (!surfaces.includes('gemini')) continue;

    const outPath = path.join(outDir, `${name}.md`);
    if (dryRun) {
      console.log(`[dry-run] gemini: would write ${outPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(outPath, stage.body, 'utf8');
      console.log(`gemini: wrote ${outPath}`);
    }
    emittedNames.push(String(name));
    count++;
  }

  // T066 — write manifest.json
  const manifestPath = path.join(outDir, 'manifest.json');
  const sortedNames = [...emittedNames].sort();
  const manifest = {
    version: '1.0',
    generated: new Date().toISOString(),
    commands: sortedNames,
  };

  if (dryRun) {
    console.log(`[dry-run] gemini: would write manifest ${manifestPath}`);
  } else {
    await ensureDir(outDir);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(`gemini: wrote manifest ${manifestPath}`);
  }

  console.log(`gemini: ${count} file(s) emitted`);
  return true;
}

/**
 * T067 — agents-md emitter
 * Creates .agents/AGENTS.md — a consolidated AGENTS.md for Gemini/Codex.
 * Includes all non-claude-only stages.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitAgentsMd(stages, root, dryRun) {
  const outPath = path.join(root, '.agents', 'AGENTS.md');
  const timestamp = new Date().toISOString();
  const sections = [];

  for (const stage of stages) {
    const { name, title, surfaces } = stage.frontmatter;
    if (shouldExclude(String(name), 'agents-md')) continue;
    if (!surfaces.includes('gemini') && !surfaces.includes('codex') && !surfaces.includes('agents-skills')) continue;

    const summary = stage.body.slice(0, 200).replace(/\n+$/, '');
    const sectionTitle = title ? String(title) : String(name);
    sections.push(`### ${sectionTitle}\n${summary}...`);
  }

  const content = `# Gofer Agent Commands

This file documents all Gofer pipeline commands available as agent skills.

Generated: ${timestamp}

## Commands

${sections.join('\n\n')}
`;

  if (dryRun) {
    console.log(`[dry-run] agents-md: would write ${outPath}`);
  } else {
    await ensureDir(path.dirname(outPath));
    await fs.writeFile(outPath, content, 'utf8');
    console.log(`agents-md: wrote ${outPath}`);
  }

  console.log(`agents-md: ${sections.length} section(s) emitted`);
  return true;
}

/**
 * T068 — codex-config emitter
 * Generates .specify/outputs/codex-config-fragment.toml containing skill entries
 * for non-claude-only stages.
 * Does NOT touch ~/.codex/config.toml.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitCodexConfig(stages, root, dryRun) {
  const outDir = path.join(root, '.specify', 'outputs');
  const outPath = path.join(outDir, 'codex-config-fragment.toml');
  const timestamp = new Date().toISOString();
  const lines = [
    `# Gofer skill entries for ~/.codex/config.toml`,
    `# Generated by generate-commands.mjs on ${timestamp}`,
    `# Append this to your ~/.codex/config.toml`,
    ``,
  ];

  let count = 0;
  for (const stage of stages) {
    const { name, surfaces } = stage.frontmatter;
    if (shouldExclude(String(name), 'codex-config')) continue;
    if (!surfaces.includes('codex') && !surfaces.includes('agents-skills')) continue;

    lines.push(`[[skills.config]]`);
    lines.push(`name = "gofer/${name}"`);
    lines.push(`enabled = true`);
    lines.push(``);
    count++;
  }

  const content = lines.join('\n');

  if (dryRun) {
    console.log(`[dry-run] codex-config: would write ${outPath}`);
  } else {
    await ensureDir(outDir);
    await fs.writeFile(outPath, content, 'utf8');
    console.log(`codex-config: wrote ${outPath}`);
  }

  console.log(`codex-config: ${count} skill entrie(s) emitted`);
  return true;
}

const EMITTERS = {
  'claude': emitClaude,
  'claude-mirror': emitClaudeMirror,
  'copilot': emitCopilot,
  'github-prompts': emitGithubPrompts,
  'agents-skills': emitAgentsSkills,
  'system-skills': emitSystemSkills,
  'gemini': emitGemini,
  'agents-md': emitAgentsMd,
  'codex-config': emitCodexConfig,
};

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    dryRun: false,
    surfaces: ALL_SURFACES,
    root: process.cwd(),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--surfaces' && argv[i + 1]) {
      args.surfaces = argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (arg === '--root' && argv[i + 1]) {
      args.root = argv[i + 1];
      i++;
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// T043 — per-CLI exclusion enforcement (validation)
// ---------------------------------------------------------------------------

/**
 * Validates that no stage is being emitted to a surface it should be excluded from.
 * Logs a warning for any violations found.
 *
 * @param {Array} stages
 * @param {string[]} surfaces
 */
function validateExclusions(stages, surfaces) {
  let violations = 0;
  for (const stage of stages) {
    const stageName = String(stage.frontmatter.name);
    for (const surface of surfaces) {
      if (shouldExclude(stageName, surface) && stage.frontmatter.surfaces.includes(surface)) {
        console.warn(
          `[warn] Exclusion violation: stage '${stageName}' is listed under surface '${surface}' in its frontmatter, but shouldExclude() returns true for this combination. The emitter will skip this stage.`
        );
        violations++;
      }
    }
  }
  if (violations === 0) {
    console.log(`Exclusion validation OK: no violations found`);
  } else {
    console.warn(`Exclusion validation: ${violations} violation(s) found (stages will still be skipped)`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const { dryRun, surfaces, root } = parseArgs(argv);

  // Validate canonical descriptions first (budget check)
  try {
    const { count, totalBytes } = validateDescriptions();
    console.log(`Canonical descriptions OK: ${count} stages, ${totalBytes} bytes`);
  } catch (err) {
    console.error(`Canonical description validation failed: ${err.message}`);
    process.exit(1);
  }

  // Load all stage command files from .specify/commands/
  const stages = await loadStages(root);

  if (stages.length === 0) {
    console.warn('[warn] No stage command files found in .specify/commands/ — nothing to emit');
  } else {
    console.log(`Loaded ${stages.length} stage(s): ${stages.map((s) => s.frontmatter.name).join(', ')}`);
  }

  // T043: validate exclusions
  validateExclusions(stages, surfaces);

  if (dryRun) {
    console.log('[dry-run] Would emit to surfaces:', surfaces.join(', '));
    console.log('[dry-run] Stages:', stages.map((s) => s.frontmatter.name).join(', '));
    process.exit(0);
  }

  let allOk = true;
  for (const surface of surfaces) {
    const emitter = EMITTERS[surface];
    if (!emitter) {
      console.warn(`Unknown surface '${surface}' — skipping`);
      continue;
    }

    try {
      const ok = await emitter(stages, root, dryRun);
      if (!ok) {
        console.error(`Emitter for '${surface}' returned false`);
        allOk = false;
      }
    } catch (err) {
      console.error(`Emitter for '${surface}' threw: ${err.message}`);
      allOk = false;
    }
  }

  process.exit(allOk ? 0 : 1);
}

// Only run main when executed directly (not when imported as a module in tests)
const isMain = process.argv[1] && (
  process.argv[1].endsWith('generate-commands.mjs') ||
  process.argv[1] === new URL(import.meta.url).pathname
);

if (isMain) {
  main();
}
