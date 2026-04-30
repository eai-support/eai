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
import { createHash } from 'crypto';
import { CANONICAL_DESCRIPTIONS, validateDescriptions } from './canonical-descriptions.mjs';
import { parseStageCommand } from './parse-stage-command.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Legacy compatibility export. Gofer now emits every command/helper to every
 * supported surface when the stage frontmatter lists that surface.
 */
export const CLAUDE_ONLY_STAGES = [];

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
 * Gofer keeps this function for older tests/imports, but no stages are
 * excluded by name anymore. Surface availability is controlled by stage
 * frontmatter so Claude, Copilot, Codex, and Gemini stay in parity.
 *
 * @param {string} stageName
 * @param {string} surface
 * @returns {boolean}
 */
export function shouldExclude(stageName, surface) {
  void stageName;
  void surface;
  return false;
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
 * Emits every stage whose frontmatter includes the Copilot surface.
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
      await fs.writeFile(outPath, buildCopilotPromptContent(stage), 'utf8');
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
 * Emits every stage whose frontmatter includes the GitHub prompts surface.
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
      await fs.writeFile(outPath, buildCopilotPromptContent(stage), 'utf8');
      console.log(`github-prompts: wrote ${outPath}`);
    }
    count++;
  }
  console.log(`github-prompts: ${count} file(s) emitted`);
  return true;
}

/**
 * Builds a Copilot prompt using the same metadata and body transform as the
 * runtime CommandGenerator. This keeps .github/prompts and bundled VSIX
 * resources byte-equivalent to generated Copilot mirrors.
 *
 * @param {{ frontmatter: Record<string, unknown>, body: string }} stage
 * @returns {string}
 */
function buildCopilotPromptContent(stage) {
  const stageName = String(stage.frontmatter.name);
  const { frontmatter, body } = splitMarkdownFrontmatter(stage.body);
  const description = readString(frontmatter.description) ?? String(stage.frontmatter.description);
  const transformedBody = injectPipelineContinuation(
    transformClaudeContent(body, 'copilot'),
    'copilot',
    stageName
  );
  const canonicalChecksum = createHash('sha256').update(body, 'utf8').digest('hex');

  return [
    '---',
    `name: ${stageName}`,
    `description: ${description}`,
    'agent: copilot-workspace',
    'tools:',
    '  - Read',
    '  - Grep',
    '  - Glob',
    '  - Bash',
    '  - WebSearch',
    'argument-hint: feature-name-or-description',
    'gofer:',
    '  workflowProfile: enterpriseai',
    `  canonicalSource: .claude/commands/${stageName}.md`,
    `  canonicalChecksum: ${canonicalChecksum}`,
    '  metadataSource: scripts/generate-commands.ts',
    '---',
    '',
    transformedBody,
  ].join('\n');
}

/**
 * @param {string} content
 * @returns {{ frontmatter: Record<string, unknown>, body: string }}
 */
function splitMarkdownFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const fieldMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!fieldMatch) continue;
    frontmatter[fieldMatch[1]] = fieldMatch[2].trim().replace(/^["']|["']$/g, '');
  }

  return { frontmatter, body: match[2] };
}

/**
 * @param {string} content
 * @param {'copilot'} toPlatform
 * @returns {string}
 */
function transformClaudeContent(content, toPlatform) {
  let transformed = content;

  transformed = transformed.replace(/\*\*AUTO-CHAIN[^]*?(?=\n##|\n---|\n\*\*|$)/g, '');
  transformed = transformed.replace(
    /by calling the Skill tool with skill="[^"]+"/g,
    'by running the next command'
  );
  transformed = transformed.replace(/Skill tool/g, 'next command');

  if (toPlatform === 'copilot') {
    transformed = transformed.replace(/\/(\d+[a-z]?_gofer_\w+)/g, '#$1');
    transformed = transformed.replace(/\/(gofer_\w+)/g, '#$1');
  }

  return transformed;
}

/**
 * @param {string} content
 * @param {'copilot'} platform
 * @param {string} commandName
 * @returns {string}
 */
function injectPipelineContinuation(content, platform, commandName) {
  const nextCommand = getNextCommand(commandName);
  if (!nextCommand) return content;

  const autoChainSection = `\n\n## Pipeline Continuation\n\nThis completes the ${commandName} stage. To continue the Gofer pipeline:\n\n**Next Command:** \`#${nextCommand}\`\n\nThe next stage will read the artifacts from this stage and continue the workflow automatically.\n\n**Note:** Copilot Chat supports context preservation. Your conversation history will be maintained as you progress through pipeline stages.\n`;

  if (content.includes('## Key Rules')) {
    return content.replace('## Key Rules', `${autoChainSection}\n## Key Rules`);
  }

  return content + autoChainSection;
}

/**
 * @param {string} currentCommand
 * @returns {string | null}
 */
function getNextCommand(currentCommand) {
  const pipeline = [
    '0_business_scenario',
    '0a_problem_validation',
    '1_gofer_research',
    '2_gofer_specify',
    '3_gofer_plan',
    '4_gofer_tasks',
    '5_gofer_implement',
    '6_gofer_validate',
    '6a_gofer_engineering_review',
  ];

  const currentIndex = pipeline.indexOf(currentCommand);
  if (currentIndex >= 0 && currentIndex < pipeline.length - 1) {
    return pipeline[currentIndex + 1];
  }

  return null;
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function readString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
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
 * Escapes a string for a basic TOML double-quoted value.
 * @param {string} value
 * @returns {string}
 */
function escapeTomlString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * T041 — agents-skills emitter
 * Emits Codex SKILL.md to .agents/skills/gofer/<name>/SKILL.md.
 * Emits every stage whose frontmatter includes the agents-skills surface.
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
 * Emits every stage whose frontmatter includes the system-skills surface.
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
 * Emits plain markdown body and TOML command wrappers to
 * .gemini/commands/gofer/<name>.md and <name>.toml.
 * T066 — also creates .gemini/commands/gofer/manifest.json listing all emitted stage names.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitGemini(stages, root, dryRun) {
  const outDir = path.join(root, '.gemini', 'commands', 'gofer');
  const extensionPath = path.join(root, '.gemini', 'extension.json');
  const emittedNames = [];
  let count = 0;

  for (const stage of stages) {
    const { name, description, surfaces } = stage.frontmatter;
    if (shouldExclude(String(name), 'gemini')) continue;
    if (!surfaces.includes('gemini')) continue;

    const markdownPath = path.join(outDir, `${name}.md`);
    const tomlPath = path.join(outDir, `${name}.toml`);
    const sourceFileName = path.basename(stage.filePath);
    const tomlContent = [
      `description = "${escapeTomlString(String(description || name))}"`,
      `prompt = "{{include: ../../../.specify/commands/${sourceFileName}}}"`,
      '',
    ].join('\n');

    if (dryRun) {
      console.log(`[dry-run] gemini: would write ${markdownPath}`);
      console.log(`[dry-run] gemini: would write ${tomlPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(markdownPath, stage.body, 'utf8');
      await fs.writeFile(tomlPath, tomlContent, 'utf8');
      console.log(`gemini: wrote ${markdownPath}`);
      console.log(`gemini: wrote ${tomlPath}`);
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
    console.log(`[dry-run] gemini: would write extension manifest ${extensionPath}`);
  } else {
    await ensureDir(outDir);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    await fs.writeFile(
      extensionPath,
      JSON.stringify(
        {
          name: 'gofer',
          version: '1.0.0',
          description: 'Gofer pipeline as Gemini CLI extension',
          commands: '.gemini/commands/gofer/',
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    console.log(`gemini: wrote manifest ${manifestPath}`);
    console.log(`gemini: wrote extension manifest ${extensionPath}`);
  }

  console.log(`gemini: ${count} file(s) emitted`);
  return true;
}

/**
 * T067 — agents-md emitter
 * Creates .agents/AGENTS.md — a consolidated AGENTS.md for Gemini/Codex.
 * Includes all stages emitted to portable agent surfaces.
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
 * for every stage emitted to Codex/agents-skills.
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
