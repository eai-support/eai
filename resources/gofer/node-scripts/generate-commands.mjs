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

const PUBLIC_SITE_URL = 'https://eai-tools.github.io/eai-gofer';
const PUBLIC_RELEASES_URL = `${PUBLIC_SITE_URL}/releases`;
const PUBLIC_PLUGIN_URL = `${PUBLIC_RELEASES_URL}/plugins/eai-gofer`;
const SURFACE_WORKSPACE_HOSTS = {
  'claude': 'claude',
  'claude-mirror': 'claude',
  'copilot': 'copilot',
  'github-prompts': 'copilot',
  'agents-skills': 'codex',
  'system-skills': 'codex',
  'gemini': 'gemini',
};
const WORKSPACE_PREFLIGHT_EXCLUDED_COMMANDS = new Set([
  'gofer:plan',
  'gofer:side',
  'gofer:personality',
  'gofer:check-workspace',
  'gofer:bootstrap-workspace',
]);

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

async function detectPackageVersion(root) {
  const candidates = [
    path.join(root, 'package.json'),
    path.join(root, 'extension', 'package.json'),
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await fs.readFile(candidate, 'utf8'));
      if (typeof parsed.version === 'string' && parsed.version.length > 0) {
        return parsed.version;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return '1.0.0';
}

function buildGeminiExtensionManifest(version) {
  return {
    name: 'eai-gofer',
    version,
    description: 'Gofer core pipeline and helper commands as a Gemini CLI extension',
    commands: '.gemini/commands/gofer/',
    gofer: {
      bundle_url: PUBLIC_PLUGIN_URL,
      manifest_url: `${PUBLIC_PLUGIN_URL}/gemini-extension.json`,
      commands_manifest_url: `${PUBLIC_PLUGIN_URL}/gemini-commands-manifest.json`,
      download_url: `${PUBLIC_RELEASES_URL}/eai-gofer-agent-plugin-${version}.zip`,
      latest_download_url: `${PUBLIC_RELEASES_URL}/eai-gofer-agent-plugin-latest.zip`,
      vsix_url: `${PUBLIC_RELEASES_URL}/eai-gofer-${version}.vsix`,
      latest_vsix_url: `${PUBLIC_RELEASES_URL}/eai-gofer-latest.vsix`,
    },
  };
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
    throw new Error(`.specify/commands/ not found at ${commandsDir}`);
  }

  const stages = [];
  const parseErrors = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry === '.gitkeep') continue;
    const filePath = path.join(commandsDir, entry);
    try {
      const parsed = await parseStageCommand(filePath);
      stages.push({ filePath, ...parsed });
    } catch (err) {
      parseErrors.push(`${entry}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (parseErrors.length > 0) {
    throw new Error(
      `Failed to parse ${parseErrors.length} command file(s):\n${parseErrors.join('\n')}`
    );
  }

  return stages;
}

function getStageOutputStem(stage) {
  return path.basename(stage.filePath, '.md');
}

async function removeLegacyGeneratedPath(outPath, legacyPath) {
  if (outPath === legacyPath) {
    return;
  }

  await fs.rm(legacyPath, { recursive: true, force: true });
}

async function removeLegacyGeneratedPaths(outPath, legacyPaths) {
  for (const legacyPath of legacyPaths) {
    await removeLegacyGeneratedPath(outPath, legacyPath);
  }
}

function getCodexLegacySkillDirs(root, surfaceRoot, stageStem, stageName) {
  return [
    path.join(root, surfaceRoot, stageName),
    path.join(root, surfaceRoot, 'gofer', stageStem),
    path.join(root, surfaceRoot, 'gofer', stageName),
  ];
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

    const stageStem = getStageOutputStem(stage);
    const outPath = path.join(outDir, `${stageStem}.md`);
    const legacyPath = path.join(outDir, `${name}.md`);
    if (dryRun) {
      console.log(`[dry-run] claude: would write ${outPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(
        outPath,
        injectTokenCostPolicy(
          injectWorkspacePreflight(stage.body, String(name), SURFACE_WORKSPACE_HOSTS['claude'])
        ),
        'utf8'
      );
      await removeLegacyGeneratedPath(outPath, legacyPath);
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

    const stageStem = getStageOutputStem(stage);
    const outPath = path.join(outDir, `${stageStem}.md`);
    const legacyPath = path.join(outDir, `${name}.md`);
    if (dryRun) {
      console.log(`[dry-run] claude-mirror: would write ${outPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(
        outPath,
        injectTokenCostPolicy(
          injectWorkspacePreflight(
            stage.body,
            String(name),
            SURFACE_WORKSPACE_HOSTS['claude-mirror']
          )
        ),
        'utf8'
      );
      await removeLegacyGeneratedPath(outPath, legacyPath);
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

    const stageStem = getStageOutputStem(stage);
    const outPath = path.join(outDir, `${stageStem}.prompt.md`);
    const legacyPath = path.join(outDir, `${name}.prompt.md`);
    if (dryRun) {
      console.log(`[dry-run] copilot: would write ${outPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(
        outPath,
        buildCopilotPromptContent(stage, SURFACE_WORKSPACE_HOSTS['copilot']),
        'utf8'
      );
      await removeLegacyGeneratedPath(outPath, legacyPath);
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

    const stageStem = getStageOutputStem(stage);
    const outPath = path.join(outDir, `${stageStem}.prompt.md`);
    const legacyPath = path.join(outDir, `${name}.prompt.md`);
    if (dryRun) {
      console.log(`[dry-run] github-prompts: would write ${outPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(
        outPath,
        buildCopilotPromptContent(stage, SURFACE_WORKSPACE_HOSTS['github-prompts']),
        'utf8'
      );
      await removeLegacyGeneratedPath(outPath, legacyPath);
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
function buildCopilotPromptContent(stage, host = SURFACE_WORKSPACE_HOSTS['copilot']) {
  const stageName = String(stage.frontmatter.name);
  const { frontmatter, body } = splitMarkdownFrontmatter(stage.body);
  const description = readString(frontmatter.description) ?? String(stage.frontmatter.description);
  const transformedBody = injectPipelineContinuation(
    injectTokenCostPolicy(
      injectWorkspacePreflight(transformClaudeContent(body, 'copilot'), stageName, host)
    ),
    'copilot',
    stageName
  );
  const canonicalChecksum = createHash('sha256').update(body, 'utf8').digest('hex');
  const sourceFileName = path.basename(stage.filePath);

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
    `  canonicalSource: .specify/commands/${sourceFileName}`,
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
  const stageCommandPattern = /\/(\d+[a-z]?_[a-z0-9_]+)/g;
  const helperCommandPattern = /\/(gofer_[a-z0-9_]+)/g;

  transformed = transformed.replace(/\*\*AUTO-CHAIN[^]*?(?=\n##|\n---|\n\*\*|$)/g, '');
  transformed = transformed.replace(
    /by calling the Skill tool with skill="[^"]+"/g,
    'by running the next command'
  );
  transformed = transformed.replace(/Skill tool/g, 'next command');

  if (toPlatform === 'copilot') {
    transformed = transformed.replace(stageCommandPattern, '#$1');
    transformed = transformed.replace(helperCommandPattern, '#$1');
    transformed = transformed.replace(/(^SourceCommandId:\s*)#/gm, '$1/');
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
  void platform;
  const nextCommand = getNextCommand(commandName);
  if (!nextCommand) return content;

  const autoChainSection = `\n\n## Pipeline Continuation\n\nThis completes the ${commandName} stage. To continue the Gofer pipeline:\n\n**Next Command:** \`#${nextCommand}\`\n\nThe next stage will read the artifacts from this stage and continue the workflow automatically.\n\n**Note:** Copilot Chat supports context preservation. Your conversation history will be maintained as you progress through pipeline stages.\n`;

  if (content.includes('## Key Rules')) {
    return content.replace('## Key Rules', `${autoChainSection}\n## Key Rules`);
  }

  return content + autoChainSection;
}

function buildWorkspacePreflightSection(host = 'auto') {
  return `
## Workspace Preflight

Before doing stage/helper work:

1. Resolve the repository root.
2. Check the core Gofer sentinels:
   - \`.specify/.gofer-version\`
   - \`.specify/commands/0_business_scenario.md\`
   - \`.specify/templates/spec-template.md\`
   - \`.specify/scripts/bash/create-new-feature.sh\`
   - \`.specify/scripts/node/parse-stage-command.mjs\`
   - \`.specify/scripts/hooks/post-tool-use.mjs\`
   - \`.specify/scripts/powershell/install-optional-tools.ps1\`
   - \`.specify/templates/gofer-model-policy.yaml\`
   - \`.specify/memory/gofer-model-policy.yaml\`
   - \`.specify/specs/\`
   - \`.specify/memory/\`
3. Check host-specific repo-owned files when relevant:
   - Claude: \`AGENTS.md\`, \`CLAUDE.md\`, \`.claude/settings.json\`
   - Codex: \`AGENTS.md\`
   - Copilot: \`.github/copilot-instructions.md\`
   - VS Code extension mirrors Claude/Copilot/Gemini resources itself and should still keep the core scaffold healthy
4. If the repo already has the workspace checker script, prefer running:
   - \`node .specify/scripts/node/gofer-workspace-check.mjs --host ${host} --json\`
5. If the workspace is missing or stale, ask exactly:
   - **"This repo is missing or stale for Gofer. Initialize/update it now?"**
6. If the user says yes, run the Gofer workspace bootstrap helper and then resume this command from the top.
7. If the user says no, stop and explain that Gofer stage/helper work depends on the repo-owned scaffold.
`.trim();
}

function injectWorkspacePreflight(content, commandName, host = 'auto') {
  if (WORKSPACE_PREFLIGHT_EXCLUDED_COMMANDS.has(commandName)) {
    return content;
  }

  if (content.includes('## Workspace Preflight')) {
    return content.replace(
      /`node \.specify\/scripts\/node\/gofer-workspace-check\.mjs --host [^`\n]+ --json`/,
      `\`node .specify/scripts/node/gofer-workspace-check.mjs --host ${host} --json\``
    );
  }

  const section = buildWorkspacePreflightSection(host);
  const headingMatch = content.match(/^# [^\n]+\n+/);
  if (!headingMatch) {
    return `${section}\n\n${content}`;
  }

  const insertAt = headingMatch[0].length;
  const prefix = content.slice(0, insertAt);
  const suffix = content.slice(insertAt).replace(/^\n+/, '');
  return `${prefix}${section}\n\n${suffix}`;
}

function buildTokenCostPolicySection() {
  return `
## Token And Cost Policy
<!-- gofer:token-cost-policy:start -->

Before spawning agents, calling tools, or loading large files:

1. Treat \`.specify/memory/gofer-model-policy.yaml\` as the repo-owned source of truth for simple, medium, hard, and arbiter model routing. If it is missing, run \`/gofer:bootstrap-workspace\` before continuing.
2. Use the cheapest capable model first.
   - Claude: Haiku for scouting/extraction; Sonnet for normal implementation, synthesis, validation, and security; Opus for high-risk arbitration or release-critical failures.
   - Codex/OpenAI: GPT mini for simple coding; GPT nano only for locate/classify/summarize/mechanical work; GPT-5.3-Codex or flagship GPT for tool-heavy coding, architecture, and release-critical validation.
   - Gemini: Flash-Lite for cheap large-context scan/summarize; Flash for default research synthesis; Pro for large-context architecture or high-risk arbitration.
   - Copilot: prefer Auto for simple and default work; ask the user before choosing a paid/high-tier picker model for hard security, architecture, or release gates.
3. Keep raw tool output out of the main conversation context. Save stable findings to \`.specify/specs/{feature}/context-bundle.md\`, then work from summaries.
4. Use provider prompt/context caching only for stable, non-secret prefixes: Gofer scaffold, AGENTS/CLAUDE/Copilot instructions, constitution, repo map, stage contracts, and validation rubric.
5. Before continuing after large research, planning, implementation, or validation bursts, checkpoint the durable artifacts and compact/clear/resume context when the host supports it.
6. Escalate model tier only when a cheaper pass is low-confidence, contradictory, security-sensitive, or blocking release quality.
<!-- gofer:token-cost-policy:end -->
`.trim();
}

function injectTokenCostPolicy(content) {
  const section = buildTokenCostPolicySection();
  const startMarker = '<!-- gofer:token-cost-policy:start -->';
  const endMarker = '<!-- gofer:token-cost-policy:end -->';

  if (content.includes(startMarker) && content.includes(endMarker)) {
    const headingIndex = content.indexOf('## Token And Cost Policy');
    const endIndex = content.indexOf(endMarker, headingIndex) + endMarker.length;
    const suffix = content.slice(endIndex).replace(/^\n+/, '');
    return suffix
      ? `${content.slice(0, headingIndex).trimEnd()}\n\n${section}\n\n${suffix}`
      : `${content.slice(0, headingIndex).trimEnd()}\n\n${section}\n`;
  }

  if (content.includes('## Token And Cost Policy')) {
    const legacyPolicyPattern =
      /## Token And Cost Policy\n\nBefore spawning agents, calling tools, or loading large files:\n\n[\s\S]*?^6\. Escalate model tier only when a cheaper pass is low-confidence, contradictory, security-sensitive, or blocking release quality\.\n?/m;
    const legacyMatch = content.match(legacyPolicyPattern);
    if (legacyMatch && legacyMatch.index !== undefined) {
      const suffix = content.slice(legacyMatch.index + legacyMatch[0].length).replace(/^\n+/, '');
      return suffix
        ? `${content.slice(0, legacyMatch.index).trimEnd()}\n\n${section}\n\n${suffix}`
        : `${content.slice(0, legacyMatch.index).trimEnd()}\n\n${section}\n`;
    }

    const headingIndex = content.indexOf('## Token And Cost Policy');
    const nextHeading = content.indexOf('\n## ', headingIndex + 1);
    if (nextHeading !== -1) {
      return `${content.slice(0, headingIndex).trimEnd()}\n\n${section}\n\n${content
        .slice(nextHeading)
        .replace(/^\n+/, '')}`;
    }

    return content;
  }

  if (content.includes('## Workspace Preflight')) {
    const nextHeading = content.indexOf('\n## ', content.indexOf('## Workspace Preflight') + 1);
    if (nextHeading !== -1) {
      return `${content.slice(0, nextHeading).trimEnd()}\n\n${section}\n\n${content
        .slice(nextHeading)
        .replace(/^\n+/, '')}`;
    }
  }

  const headingMatch = content.match(/^# [^\n]+\n+/);
  if (!headingMatch) {
    return `${section}\n\n${content}`;
  }

  const insertAt = headingMatch[0].length;
  const prefix = content.slice(0, insertAt);
  const suffix = content.slice(insertAt).replace(/^\n+/, '');
  return `${prefix}${section}\n\n${suffix}`;
}

/**
 * @param {string} currentCommand
 * @returns {string | null}
 */
function getNextCommand(currentCommand) {
  const pipeline = [
    '0_business_scenario',
    '1_gofer_research',
    '2_gofer_specify',
    '3_gofer_plan',
    '4_gofer_tasks',
    '5_gofer_implement',
    '6_gofer_validate',
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
  return `---\nname: ${stageName}\ndescription: "${description}"\n---\n\n${body}`;
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
 * Emits Codex SKILL.md to .agents/skills/<name>/SKILL.md.
 * Emits every stage whose frontmatter includes the agents-skills surface.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitAgentsSkills(stages, root, dryRun) {
  const baseDir = path.join(root, '.agents', 'skills');
  let count = 0;
  for (const stage of stages) {
    const { name, description, surfaces } = stage.frontmatter;
    if (shouldExclude(String(name), 'agents-skills')) continue;
    if (!surfaces.includes('agents-skills')) continue;

    const stageStem = getStageOutputStem(stage);
    const skillDir = path.join(baseDir, stageStem);
    const outPath = path.join(skillDir, 'SKILL.md');
    const legacySkillDir = path.join(baseDir, String(name));
    const content = buildSkillContent(
      String(name),
      String(description),
      injectTokenCostPolicy(
        injectWorkspacePreflight(stage.body, String(name), SURFACE_WORKSPACE_HOSTS['agents-skills'])
      )
    );

    if (dryRun) {
      console.log(`[dry-run] agents-skills: would write ${outPath}`);
    } else {
      await ensureDir(skillDir);
      await fs.writeFile(outPath, content, 'utf8');
      await removeLegacyGeneratedPaths(skillDir, [
        legacySkillDir,
        ...getCodexLegacySkillDirs(root, '.agents/skills', stageStem, String(name)),
      ]);
      console.log(`agents-skills: wrote ${outPath}`);
    }
    count++;
  }
  console.log(`agents-skills: ${count} file(s) emitted`);
  return true;
}

/**
 * T042 — system-skills emitter
 * Emits SKILL.md to .system/skills/<name>/SKILL.md.
 * Emits every stage whose frontmatter includes the system-skills surface.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitSystemSkills(stages, root, dryRun) {
  const baseDir = path.join(root, '.system', 'skills');
  let count = 0;
  for (const stage of stages) {
    const { name, description, surfaces } = stage.frontmatter;
    if (shouldExclude(String(name), 'system-skills')) continue;
    if (!surfaces.includes('system-skills')) continue;

    const stageStem = getStageOutputStem(stage);
    const skillDir = path.join(baseDir, stageStem);
    const outPath = path.join(skillDir, 'SKILL.md');
    const legacySkillDir = path.join(baseDir, String(name));
    const content = buildSkillContent(
      String(name),
      String(description),
      injectTokenCostPolicy(
        injectWorkspacePreflight(stage.body, String(name), SURFACE_WORKSPACE_HOSTS['system-skills'])
      )
    );

    if (dryRun) {
      console.log(`[dry-run] system-skills: would write ${outPath}`);
    } else {
      await ensureDir(skillDir);
      await fs.writeFile(outPath, content, 'utf8');
      await removeLegacyGeneratedPaths(skillDir, [
        legacySkillDir,
        ...getCodexLegacySkillDirs(root, '.system/skills', stageStem, String(name)),
      ]);
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
  const version = await detectPackageVersion(root);
  const emittedNames = [];
  let count = 0;

  for (const stage of stages) {
    const { name, description, surfaces } = stage.frontmatter;
    if (shouldExclude(String(name), 'gemini')) continue;
    if (!surfaces.includes('gemini')) continue;

    const stageStem = getStageOutputStem(stage);
    const markdownPath = path.join(outDir, `${stageStem}.md`);
    const tomlPath = path.join(outDir, `${stageStem}.toml`);
    const legacyMarkdownPath = path.join(outDir, `${name}.md`);
    const legacyTomlPath = path.join(outDir, `${name}.toml`);
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
      await fs.writeFile(
        markdownPath,
        injectTokenCostPolicy(
          injectWorkspacePreflight(stage.body, String(name), SURFACE_WORKSPACE_HOSTS['gemini'])
        ),
        'utf8'
      );
      await fs.writeFile(tomlPath, tomlContent, 'utf8');
      await removeLegacyGeneratedPath(markdownPath, legacyMarkdownPath);
      await removeLegacyGeneratedPath(tomlPath, legacyTomlPath);
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
      JSON.stringify(buildGeminiExtensionManifest(version), null, 2) + '\n',
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
    `# Gofer skill overrides for ~/.codex/config.toml`,
    `# Generated by generate-commands.mjs on ${timestamp}`,
    `# Codex discovers repository-local Gofer skills from .agents/skills automatically.`,
    `# Only use these [[skills.config]] blocks when you need explicit per-skill overrides.`,
    `# Replace /full/path/to/repo with the absolute path to your local checkout.`,
    ``,
  ];

  let count = 0;
  for (const stage of stages) {
    const { name, surfaces } = stage.frontmatter;
    if (shouldExclude(String(name), 'codex-config')) continue;
    if (!surfaces.includes('codex') && !surfaces.includes('agents-skills')) continue;

    const stageStem = getStageOutputStem(stage);
    lines.push(`[[skills.config]]`);
    lines.push(`path = "/full/path/to/repo/.agents/skills/${escapeTomlString(stageStem)}"`);
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
  let stages;
  try {
    stages = await loadStages(root);
  } catch (err) {
    console.error(`Stage loading failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

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
