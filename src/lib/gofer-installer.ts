import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type GoferWorkflowProfile = 'standard' | 'enterpriseai';

export interface GoferInstallOptions {
  readonly workflowProfile?: GoferWorkflowProfile;
}

export interface GoferInstallSummary {
  readonly copied: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly commands: number;
  readonly agents: number;
  readonly skills: number;
  readonly copilotSkills: number;
}

interface MutableGoferInstallSummary {
  copied: number;
  updated: number;
  unchanged: number;
  commands: number;
  agents: number;
  skills: number;
  copilotSkills: number;
}

interface GoferCommand {
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly checksum: string;
}

interface ProjectInfo {
  readonly name: string;
  readonly language: string;
  readonly framework?: string;
  readonly packageManager?: string;
  readonly buildCommand?: string;
  readonly testCommand?: string;
  readonly lintCommand?: string;
}

const PIPELINE_COMMANDS = [
  '0_business_scenario',
  '0a_problem_validation',
  '1_gofer_research',
  '2_gofer_specify',
  '3_gofer_plan',
  '4_gofer_tasks',
  '5_gofer_implement',
  '6_gofer_validate',
  '6a_gofer_engineering_review',
] as const;

const GOFER_GITIGNORE_ENTRIES = [
  '.specify/hooks/',
  '.specify/memory/local.json',
  '.specify/memory/dependency-graph.json',
  '.specify/specs/*/.branch-info.json',
  '.specify/logs/',
  '.specify/memory/checkpoints/',
  '.specify/memory/context-health-state.json',
  '.specify/memory/observation-cache/',
  '.specify/specs/*/research-index.json',
] as const;

export async function installGoferResources(
  workspacePath: string,
  options: GoferInstallOptions = {},
): Promise<GoferInstallSummary> {
  const targetPath = resolve(workspacePath);
  const resourcesPath = resolveGoferResourcesPath();
  const workflowProfile = options.workflowProfile ?? 'enterpriseai';
  const summary: MutableGoferInstallSummary = {
    copied: 0,
    updated: 0,
    unchanged: 0,
    commands: 0,
    agents: 0,
    skills: 0,
    copilotSkills: 0,
  };

  await assertDirectory(resourcesPath);
  await createGoferDirectories(targetPath);

  await copyResourceDirectory(resourcesPath, 'commands', join(targetPath, '.specify', 'commands'), summary);
  await copyResourceDirectory(resourcesPath, 'templates', join(targetPath, '.specify', 'templates'), summary);
  await copyResourceDirectory(resourcesPath, 'bash-scripts', join(targetPath, '.specify', 'scripts', 'bash'), summary, {
    makeExecutable: true,
  });
  await copyResourceDirectory(
    resourcesPath,
    'powershell-scripts',
    join(targetPath, '.specify', 'scripts', 'powershell'),
    summary,
  );
  await copyResourceDirectory(resourcesPath, 'node-scripts', join(targetPath, '.specify', 'scripts', 'node'), summary, {
    makeExecutable: true,
  });
  await copyResourceDirectory(resourcesPath, 'hook-scripts', join(targetPath, '.specify', 'scripts', 'hooks'), summary);
  await copyResourceDirectory(resourcesPath, 'claude-commands', join(targetPath, '.claude', 'commands'), summary);
  await copyResourceDirectory(resourcesPath, 'claude-agents', join(targetPath, '.claude', 'agents'), summary);
  await copyResourceDirectory(resourcesPath, 'copilot-prompts', join(targetPath, '.github', 'prompts'), summary);
  await copyResourceDirectory(resourcesPath, 'copilot-instructions', join(targetPath, '.github', 'instructions'), summary);
  await copyResourceDirectory(resourcesPath, 'system-skills', join(targetPath, '.system', 'skills'), summary);
  await copyResourceDirectory(resourcesPath, 'agents-skills', join(targetPath, '.agents', 'skills'), summary);
  await copyResourceDirectory(resourcesPath, 'gemini', join(targetPath, '.gemini'), summary);

  summary.commands = await countFiles(join(resourcesPath, 'claude-commands'), '.md');
  summary.agents = await countFiles(join(resourcesPath, 'claude-agents'), '.md');
  summary.skills = await countFilesRecursive(join(resourcesPath, 'agents-skills'), 'SKILL.md');

  const commands = await readGoferCommands(resourcesPath);
  await generateCopilotCliSkills(targetPath, commands, workflowProfile, summary);
  await installClaudeHooks(targetPath);
  await ensureDefaultInstructions(targetPath, resourcesPath);
  await updateVSCodeSettings(targetPath);
  await updateGitignore(targetPath);
  await writeGoferReadme(targetPath);

  return summary;
}

function resolveGoferResourcesPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, '..', '..', 'resources', 'gofer');
}

async function assertDirectory(path: string): Promise<void> {
  await access(path, constants.R_OK);
}

async function createGoferDirectories(workspacePath: string): Promise<void> {
  const directories = [
    join(workspacePath, '.specify', 'memory'),
    join(workspacePath, '.specify', 'commands'),
    join(workspacePath, '.specify', 'scripts', 'bash'),
    join(workspacePath, '.specify', 'scripts', 'powershell'),
    join(workspacePath, '.specify', 'scripts', 'node'),
    join(workspacePath, '.specify', 'scripts', 'hooks'),
    join(workspacePath, '.specify', 'specs'),
    join(workspacePath, '.specify', 'templates'),
    join(workspacePath, '.specify', 'logs'),
    join(workspacePath, '.claude', 'commands'),
    join(workspacePath, '.claude', 'agents'),
    join(workspacePath, '.github', 'prompts'),
    join(workspacePath, '.github', 'instructions'),
    join(workspacePath, '.system', 'skills'),
    join(workspacePath, '.agents', 'skills'),
    join(workspacePath, '.gemini'),
    join(workspacePath, '.gemini', 'commands'),
    join(workspacePath, '.gemini', 'commands', 'gofer'),
    join(workspacePath, '.github', 'skills'),
  ];

  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })));
}

async function copyResourceDirectory(
  resourcesPath: string,
  sourceSubdirectory: string,
  targetDirectory: string,
  summary: MutableGoferInstallSummary,
  options: { readonly makeExecutable?: boolean } = {},
): Promise<void> {
  const sourceDirectory = join(resourcesPath, sourceSubdirectory);
  await copyDirectory(sourceDirectory, targetDirectory, summary, options);
}

async function copyDirectory(
  sourceDirectory: string,
  targetDirectory: string,
  summary: MutableGoferInstallSummary,
  options: { readonly makeExecutable?: boolean } = {},
): Promise<void> {
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  await mkdir(targetDirectory, { recursive: true });

  for (const entry of entries) {
    const sourcePath = join(sourceDirectory, entry.name);
    const targetPath = join(targetDirectory, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath, summary, options);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const action = await upsertFile(sourcePath, targetPath, options.makeExecutable ?? false);
    summary[action] += 1;
  }
}

async function upsertFile(
  sourcePath: string,
  targetPath: string,
  makeExecutable: boolean,
): Promise<'copied' | 'updated' | 'unchanged'> {
  const sourceContent = await readFile(sourcePath);
  const targetExists = await fileExists(targetPath);

  if (targetExists) {
    const targetContent = await readFile(targetPath);
    if (Buffer.compare(sourceContent, targetContent) === 0) {
      if (makeExecutable) {
        await chmod(targetPath, 0o755);
      }
      return 'unchanged';
    }
  } else {
    await mkdir(dirname(targetPath), { recursive: true });
  }

  await copyFile(sourcePath, targetPath);
  if (makeExecutable) {
    await chmod(targetPath, 0o755);
  }

  return targetExists ? 'updated' : 'copied';
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function countFiles(directory: string, extension: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(extension)).length;
}

async function countFilesRecursive(directory: string, filename: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      count += await countFilesRecursive(entryPath, filename);
    } else if (entry.isFile() && entry.name === filename) {
      count += 1;
    }
  }

  return count;
}

async function readGoferCommands(resourcesPath: string): Promise<GoferCommand[]> {
  const commandsDirectory = join(resourcesPath, 'claude-commands');
  const entries = await readdir(commandsDirectory, { withFileTypes: true });
  const commandFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();

  const commands: GoferCommand[] = [];

  for (const file of commandFiles) {
    const name = file.replace(/\.md$/, '');
    const filePath = join(commandsDirectory, file);
    const content = await readFile(filePath, 'utf-8');
    const { frontmatter, body } = splitFrontmatter(content);
    const description = readFrontmatterString(frontmatter, 'description') ?? `Run the ${name} Gofer workflow stage`;

    commands.push({
      name,
      description,
      body,
      checksum: createHash('sha256').update(body, 'utf8').digest('hex'),
    });
  }

  return commands;
}

function splitFrontmatter(content: string): { readonly frontmatter: string; readonly body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: '', body: content };
  }

  return { frontmatter: match[1], body: match[2] };
}

function readFrontmatterString(frontmatter: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = frontmatter.match(new RegExp(`^${escapedKey}:\\s*(.+)$`, 'm'));
  if (!match) {
    return undefined;
  }

  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function transformCommandBodyForCopilot(body: string): string {
  let transformed = body;

  transformed = transformed.replace(/\*\*AUTO-CHAIN[^]*?(?=\n##|\n---|\n\*\*|$)/g, '');
  transformed = transformed.replace(/by calling the Skill tool with skill="[^"]+"/g, 'by running the next command');
  transformed = transformed.replace(/Skill tool/g, 'next command');
  transformed = transformed.replace(/\/(\d+[a-z]?_gofer_\w+)/g, '#$1');
  transformed = transformed.replace(/\/(gofer_\w+)/g, '#$1');

  return transformed;
}

function injectPipelineContinuation(body: string, commandName: string): string {
  const nextCommand = getNextCommand(commandName);
  if (!nextCommand) {
    return body;
  }

  const continuation = `

## Pipeline Continuation

This completes the ${commandName} stage. To continue the Gofer pipeline:

**Next Command:** \`#${nextCommand}\`

The next stage will use the artifacts generated by this command and continue the implementation workflow.

**Note:** Copilot CLI should use this project skill from the repository root so it can read the generated artifacts.
`;

  if (body.includes('## Key Rules')) {
    return body.replace('## Key Rules', `${continuation}\n## Key Rules`);
  }

  return body + continuation;
}

function getNextCommand(commandName: string): string | null {
  const currentIndex = PIPELINE_COMMANDS.indexOf(commandName as typeof PIPELINE_COMMANDS[number]);
  if (currentIndex >= 0 && currentIndex < PIPELINE_COMMANDS.length - 1) {
    return PIPELINE_COMMANDS[currentIndex + 1];
  }

  return null;
}

async function generateCopilotCliSkills(
  workspacePath: string,
  commands: readonly GoferCommand[],
  workflowProfile: GoferWorkflowProfile,
  summary: MutableGoferInstallSummary,
): Promise<void> {
  for (const command of commands) {
    const skillName = toCopilotSkillName(command.name);
    const skillContent = generateCopilotCliSkill(command, skillName, workflowProfile);
    await writeTrackedFile(join(workspacePath, '.github', 'skills', skillName, 'SKILL.md'), skillContent, summary);
    summary.copilotSkills += 1;
  }
}

function toCopilotSkillName(commandName: string): string {
  return commandName.replace(/_/g, '-').toLowerCase();
}

function generateCopilotCliSkill(
  command: GoferCommand,
  skillName: string,
  workflowProfile: GoferWorkflowProfile,
): string {
  const body = injectPipelineContinuation(transformCommandBodyForCopilot(command.body), command.name);

  return `---
name: ${skillName}
description: ${JSON.stringify(command.description)}
gofer:
  workflowProfile: ${workflowProfile}
  canonicalCommand: ${command.name}
  canonicalSource: .claude/commands/${command.name}.md
  canonicalChecksum: ${command.checksum}
  metadataSource: eai-cli/resources/gofer
---

# Gofer Command: ${command.name}

Use this skill when the user asks for \`${command.name}\`, \`#${command.name}\`, or \`${skillName}\`.

${body}`;
}

async function writeTrackedFile(
  targetPath: string,
  content: string,
  summary: MutableGoferInstallSummary,
): Promise<void> {
  const targetExists = await fileExists(targetPath);

  if (targetExists) {
    const existingContent = await readFile(targetPath, 'utf-8');
    if (existingContent === content) {
      summary.unchanged += 1;
      return;
    }
  } else {
    await mkdir(dirname(targetPath), { recursive: true });
  }

  await writeFile(targetPath, content, 'utf-8');
  summary[targetExists ? 'updated' : 'copied'] += 1;
}

async function installClaudeHooks(workspacePath: string): Promise<void> {
  const settingsPath = join(workspacePath, '.claude', 'settings.json');
  await mkdir(dirname(settingsPath), { recursive: true });

  const settings = await readJsonFile(settingsPath);
  const hooks = typeof settings.hooks === 'object' && settings.hooks !== null
    ? settings.hooks as Record<string, unknown>
    : {};

  hooks.UserPromptSubmit = [
    {
      hooks: [
        {
          type: 'command',
          command: 'node "$CLAUDE_PROJECT_DIR/.specify/scripts/hooks/user-prompt-submit.mjs"',
        },
      ],
    },
  ];
  hooks.PostToolUse = [
    {
      matcher: '',
      hooks: [
        {
          type: 'command',
          command: 'node "$CLAUDE_PROJECT_DIR/.specify/scripts/hooks/post-tool-use.mjs"',
        },
      ],
    },
  ];
  hooks.Stop = [
    {
      hooks: [
        {
          type: 'command',
          command: 'node "$CLAUDE_PROJECT_DIR/.specify/scripts/hooks/agent-stop.mjs"',
        },
      ],
    },
  ];

  await writeFile(settingsPath, JSON.stringify({ ...settings, hooks }, null, 2) + '\n', 'utf-8');
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(path, 'utf-8');
    const parsed = JSON.parse(content);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function ensureDefaultInstructions(workspacePath: string, resourcesPath: string): Promise<void> {
  const projectInfo = await detectProjectInfo(workspacePath);
  await ensureFile(join(workspacePath, 'AGENTS.md'), await generateAgentsMd(resourcesPath, projectInfo));
  await ensureClaudeMd(workspacePath, resourcesPath);
  await ensureFile(
    join(workspacePath, '.github', 'copilot-instructions.md'),
    await generateCopilotInstructions(resourcesPath, projectInfo),
  );
}

async function ensureFile(path: string, content: string): Promise<void> {
  if (await fileExists(path)) {
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
}

async function ensureClaudeMd(workspacePath: string, resourcesPath: string): Promise<void> {
  const claudePath = join(workspacePath, 'CLAUDE.md');
  const goferSection = await readTemplate(resourcesPath, 'gofer', 'gofer-claude.md');
  const section = `\n## Gofer Pipeline\n\n${goferSection.trim()}\n`;

  if (!(await fileExists(claudePath))) {
    const base = await readTemplate(resourcesPath, 'base', 'claude-base.md');
    const workflow = await readTemplate(resourcesPath, 'workflow', 'principles.md');
    const content = base
      .replace('{{workflow}}', extractWorkflowSection(workflow))
      .replace('{{goferCommands}}', goferSection.trim());
    await writeFile(claudePath, content, 'utf-8');
    return;
  }

  const existing = await readFile(claudePath, 'utf-8');
  if (existing.includes('## Gofer Pipeline')) {
    return;
  }

  const separator = existing.endsWith('\n') ? '' : '\n';
  await writeFile(claudePath, existing + separator + section, 'utf-8');
}

async function detectProjectInfo(workspacePath: string): Promise<ProjectInfo> {
  const packageJsonPath = join(workspacePath, 'package.json');
  let packageJson: Record<string, unknown>;

  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    packageJson = {};
  }

  const scripts = typeof packageJson.scripts === 'object' && packageJson.scripts !== null
    ? packageJson.scripts as Record<string, unknown>
    : {};

  return {
    name: typeof packageJson.name === 'string' ? packageJson.name : 'project',
    language: 'typescript',
    framework: 'Next.js',
    packageManager: await detectPackageManager(workspacePath),
    buildCommand: typeof scripts.build === 'string' ? 'npm run build' : undefined,
    testCommand: typeof scripts.test === 'string' ? 'npm test' : undefined,
    lintCommand: typeof scripts.lint === 'string' ? 'npm run lint' : undefined,
  };
}

async function detectPackageManager(workspacePath: string): Promise<string> {
  if (await fileExists(join(workspacePath, 'bun.lockb'))) {
    return 'bun';
  }
  if (await fileExists(join(workspacePath, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (await fileExists(join(workspacePath, 'yarn.lock'))) {
    return 'yarn';
  }

  return 'npm';
}

async function generateAgentsMd(resourcesPath: string, projectInfo: ProjectInfo): Promise<string> {
  const base = await readTemplate(resourcesPath, 'base', 'agents-base.md');
  const language = await readLanguageTemplate(resourcesPath, projectInfo.language);

  return base
    .replace('{{projectName}}', projectInfo.name)
    .replace('{{language}}', 'TypeScript')
    .replace('{{frameworkLine}}', projectInfo.framework ? `\n- **Framework**: ${projectInfo.framework}` : '')
    .replace('{{packageManager}}', projectInfo.packageManager ?? 'npm')
    .replace('{{commands}}', buildCommandsSection(projectInfo))
    .replace('{{structure}}', 'Standard Next.js project layout. Source in `src/`, app routes in `src/app/`.')
    .replace('{{codeStyle}}', language.trim())
    .replace('{{testing}}', buildTestingSection(projectInfo))
    .replace('{{gitWorkflow}}', buildGitWorkflowSection())
    .replace('{{boundaries}}', buildBoundariesSection())
    .replace('{{principles}}', (await readTemplate(resourcesPath, 'workflow', 'principles.md')).trim());
}

async function generateCopilotInstructions(resourcesPath: string, projectInfo: ProjectInfo): Promise<string> {
  const base = await readTemplate(resourcesPath, 'base', 'copilot-base.md');
  const gofer = await readTemplate(resourcesPath, 'gofer', 'gofer-copilot.md');
  const language = await readLanguageTemplate(resourcesPath, projectInfo.language);

  return base
    .replace('{{projectOverview}}', `**${projectInfo.name}** is a TypeScript project using Next.js.`)
    .replace('{{availableCommands}}', gofer.trim())
    .replace('{{codeQuality}}', language.trim());
}

async function readLanguageTemplate(resourcesPath: string, language: string): Promise<string> {
  const languageFile = language === 'typescript' ? 'typescript.md' : 'generic.md';
  return readTemplate(resourcesPath, 'languages', languageFile);
}

async function readTemplate(resourcesPath: string, subdirectory: string, filename: string): Promise<string> {
  return readFile(join(resourcesPath, 'instruction-templates', subdirectory, filename), 'utf-8');
}

function buildCommandsSection(projectInfo: ProjectInfo): string {
  const lines: string[] = [];
  if (projectInfo.buildCommand) {
    lines.push(`- **Build**: \`${projectInfo.buildCommand}\``);
  }
  if (projectInfo.testCommand) {
    lines.push(`- **Test**: \`${projectInfo.testCommand}\``);
  }
  if (projectInfo.lintCommand) {
    lines.push(`- **Lint**: \`${projectInfo.lintCommand}\``);
  }

  return lines.length > 0 ? lines.join('\n') : 'No commands detected. Add build/test/lint scripts to your project.';
}

function buildTestingSection(projectInfo: ProjectInfo): string {
  const lines = [
    '- Write tests for new functionality before marking tasks complete',
    '- Run the full test suite before committing',
  ];

  if (projectInfo.testCommand) {
    lines.unshift(`- **Run Tests**: \`${projectInfo.testCommand}\``);
  }

  return lines.join('\n');
}

function buildGitWorkflowSection(): string {
  return [
    '- Use conventional commit messages (feat:, fix:, chore:, docs:)',
    '- Create feature branches for new work',
    '- Run tests and linting before committing',
  ].join('\n');
}

function buildBoundariesSection(): string {
  return [
    '- Do not modify files outside the project scope without approval',
    '- Do not commit secrets, API keys, or credentials',
    '- Do not add dependencies without justification',
  ].join('\n');
}

function extractWorkflowSection(workflow: string): string {
  const lines = workflow.split('\n');
  const startIndex = lines.findIndex((line) => line.startsWith('### Workflow Principles'));
  const endIndex = lines.findIndex((line, index) => index > startIndex && line.startsWith('### Task Management'));

  return lines.slice(startIndex >= 0 ? startIndex + 1 : 0, endIndex >= 0 ? endIndex : lines.length).join('\n').trim();
}

async function updateVSCodeSettings(workspacePath: string): Promise<void> {
  const settingsPath = join(workspacePath, '.vscode', 'settings.json');
  await mkdir(dirname(settingsPath), { recursive: true });

  const settings = await readJsonFile(settingsPath);
  settings['files.associations'] = {
    '**/.specify/**/*.md': 'markdown',
    '**/.claude/commands/*.md': 'markdown',
    ...(asRecord(settings['files.associations'])),
  };
  settings['search.exclude'] = {
    '**/.specify/_backup/**': true,
    '**/.specify/_archive/**': true,
    ...(asRecord(settings['search.exclude'])),
  };
  settings['files.exclude'] = {
    '**/.specify/_backup/**': true,
    ...(asRecord(settings['files.exclude'])),
  };

  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

async function updateGitignore(workspacePath: string): Promise<void> {
  const gitignorePath = join(workspacePath, '.gitignore');
  let content = '';

  try {
    content = await readFile(gitignorePath, 'utf-8');
  } catch {
    content = '';
  }

  const missingEntries = GOFER_GITIGNORE_ENTRIES.filter((entry) => !content.includes(entry));
  if (missingEntries.length === 0) {
    return;
  }

  let updated = content;
  if (updated.length > 0 && !updated.endsWith('\n')) {
    updated += '\n';
  }
  if (!updated.includes('# Gofer runtime files')) {
    updated += '\n# Gofer runtime files (auto-generated, should not be committed)\n';
  }
  updated += missingEntries.map((entry) => `${entry}\n`).join('');

  await writeFile(gitignorePath, updated, 'utf-8');
}

async function writeGoferReadme(workspacePath: string): Promise<void> {
  const readmePath = join(workspacePath, '.specify', 'README.md');
  const content = `# Gofer - Specification Directory

This folder contains project specifications for AI-driven feature development.

## Structure

- **memory/** - Constitution, decisions, and project principles
- **commands/** - Canonical Gofer command definitions
- **specs/** - Feature specifications
- **templates/** - Templates for specs, plans, tasks, and reviews
- **scripts/** - Helper scripts for workflow automation
- **logs/** - Runtime logs and diagnostics

## AI Terminal Commands

- Claude CLI: \`/0_business_scenario\`
- Codex CLI: ask Codex to use the relevant Gofer skill from \`.agents/skills/\`
- Gemini CLI: \`/gofer:1_gofer_research\`
- GitHub Copilot: prompts are in \`.github/prompts\`; CLI skills are in \`.github/skills\`

All artifacts are stored in \`.specify/specs/{feature}/\`.
`;

  await writeFile(readmePath, content, 'utf-8');
}
