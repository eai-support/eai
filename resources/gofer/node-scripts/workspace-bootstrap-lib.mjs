#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseStageCommand } from './parse-stage-command.mjs';

export const GOFER_VERSION_FILE = path.join('.specify', '.gofer-version');
export const CORE_SENTINELS = [
  GOFER_VERSION_FILE,
  path.join('.specify', 'commands', '0_business_scenario.md'),
  path.join('.specify', 'templates', 'spec-template.md'),
  path.join('.specify', 'scripts', 'bash', 'create-new-feature.sh'),
  path.join('.specify', 'scripts', 'node', 'parse-stage-command.mjs'),
  path.join('.specify', 'scripts', 'hooks', 'post-tool-use.mjs'),
  path.join('.specify', 'scripts', 'powershell', 'install-optional-tools.ps1'),
  path.join('.specify', 'templates', 'gofer-model-policy.yaml'),
  path.join('.specify', 'memory', 'gofer-model-policy.yaml'),
  path.join('.specify', 'specs'),
  path.join('.specify', 'memory'),
];

export const HOST_POLICIES = {
  auto: { required: [] },
  claude: {
    required: ['AGENTS.md', 'CLAUDE.md', path.join('.claude', 'settings.json')],
  },
  codex: {
    required: ['AGENTS.md'],
  },
  copilot: {
    required: [path.join('.github', 'copilot-instructions.md')],
  },
  gemini: {
    required: [],
  },
};

const WORKSPACE_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  '.specify',
];

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
];

const CLAUDE_HOOKS_CONFIG = {
  UserPromptSubmit: [
    {
      hooks: [
        {
          type: 'command',
          command: 'node "$CLAUDE_PROJECT_DIR/.specify/scripts/hooks/user-prompt-submit.mjs"',
        },
      ],
    },
  ],
  PostToolUse: [
    {
      matcher: '',
      hooks: [
        {
          type: 'command',
          command: 'node "$CLAUDE_PROJECT_DIR/.specify/scripts/hooks/post-tool-use.mjs"',
        },
      ],
    },
  ],
  Stop: [
    {
      hooks: [
        {
          type: 'command',
          command: 'node "$CLAUDE_PROJECT_DIR/.specify/scripts/hooks/agent-stop.mjs"',
        },
      ],
    },
  ],
};

function createEmptyProjectInfo(workspaceRoot) {
  return {
    name: path.basename(workspaceRoot),
    language: 'unknown',
    framework: null,
    testRunner: null,
    testCommand: null,
    buildCommand: null,
    lintCommand: null,
    formatCommand: null,
    packageManager: null,
  };
}

export function normalizeHost(host = 'auto') {
  const normalized = String(host || 'auto').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(HOST_POLICIES, normalized) ? normalized : 'auto';
}

export function scriptRootFromUrl(scriptUrl) {
  const filePath = fileURLToPath(scriptUrl);
  return path.resolve(path.dirname(filePath), '..', '..', '..');
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function detectGoferVersion(sourceRoot) {
  const candidates = [
    path.join(sourceRoot, '.eai-gofer-plugin-version'),
    path.join(sourceRoot, 'plugin.json'),
    path.join(sourceRoot, 'package.json'),
    path.join(sourceRoot, 'extension', 'package.json'),
  ];

  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate, 'utf8');
      if (candidate.endsWith('.eai-gofer-plugin-version')) {
        const firstLine = content.split('\n')[0]?.trim();
        if (firstLine) {
          return firstLine;
        }
        continue;
      }

      const parsed = JSON.parse(content);
      if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
        return parsed.version.trim();
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return '0.0.0';
}

export async function findWorkspaceRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  const fallbackRoot = current;

  while (true) {
    for (const marker of WORKSPACE_MARKERS) {
      if (await pathExists(path.join(current, marker))) {
        return current;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return fallbackRoot;
    }
    current = parent;
  }
}

export async function loadStageMetadata(sourceRoot) {
  const commandsDir = path.join(sourceRoot, '.specify', 'commands');
  const entries = (await fs.readdir(commandsDir))
    .filter((entry) => entry.endsWith('.md') && entry !== '.gitkeep')
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const stages = [];
  for (const entry of entries) {
    const filePath = path.join(commandsDir, entry);
    const parsed = await parseStageCommand(filePath);
    stages.push({
      stem: path.basename(entry, '.md'),
      ...parsed,
    });
  }

  return stages;
}

async function detectPackageManager(workspaceRoot) {
  if (await pathExists(path.join(workspaceRoot, 'bun.lockb'))) {
    return 'bun';
  }
  if (await pathExists(path.join(workspaceRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (await pathExists(path.join(workspaceRoot, 'yarn.lock'))) {
    return 'yarn';
  }
  if (await pathExists(path.join(workspaceRoot, 'package-lock.json'))) {
    return 'npm';
  }
  if (await pathExists(path.join(workspaceRoot, 'pyproject.toml'))) {
    return 'poetry';
  }
  return null;
}

export async function detectProjectInfo(workspaceRoot) {
  const info = createEmptyProjectInfo(workspaceRoot);
  info.packageManager = await detectPackageManager(workspaceRoot);

  if (await pathExists(path.join(workspaceRoot, 'tsconfig.json'))) {
    info.language = 'typescript';
  } else if (await pathExists(path.join(workspaceRoot, 'package.json'))) {
    info.language = 'javascript';
  } else if (
    (await pathExists(path.join(workspaceRoot, 'pyproject.toml'))) ||
    (await pathExists(path.join(workspaceRoot, 'requirements.txt')))
  ) {
    info.language = 'python';
  } else if (await pathExists(path.join(workspaceRoot, 'go.mod'))) {
    info.language = 'go';
  } else if (await pathExists(path.join(workspaceRoot, 'Cargo.toml'))) {
    info.language = 'rust';
  }

  const packageJson = await readJsonIfExists(path.join(workspaceRoot, 'package.json'));
  if (packageJson) {
    const scripts = packageJson.scripts || {};
    const deps = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };

    if (scripts.test) {
      info.testCommand = 'npm test';
      if (!info.testRunner) {
        info.testRunner = 'test';
      }
    }
    if (scripts.build) {
      info.buildCommand = 'npm run build';
    }
    if (scripts.lint) {
      info.lintCommand = 'npm run lint';
    }
    if (scripts.format) {
      info.formatCommand = 'npm run format';
    }

    const frameworkMatchers = [
      ['next', 'Next.js'],
      ['react', 'React'],
      ['vue', 'Vue'],
      ['express', 'Express'],
      ['@angular/core', 'Angular'],
      ['svelte', 'Svelte'],
    ];
    for (const [dep, name] of frameworkMatchers) {
      if (deps[dep]) {
        info.framework = name;
        break;
      }
    }

    if (deps.vitest || (await pathExists(path.join(workspaceRoot, 'vitest.config.ts')))) {
      info.testRunner = 'vitest';
    } else if (deps.jest || (await pathExists(path.join(workspaceRoot, 'jest.config.js')))) {
      info.testRunner = 'jest';
    }
  }

  if (
    info.language === 'python' &&
    (await pathExists(path.join(workspaceRoot, 'pytest.ini')))
  ) {
    info.testRunner = 'pytest';
  }

  return info;
}

function formatLanguage(language) {
  const names = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    python: 'Python',
    go: 'Go',
    rust: 'Rust',
    unknown: 'Unknown',
  };
  return names[language] || language;
}

function buildCommandsSection(projectInfo) {
  const lines = [];
  if (projectInfo.buildCommand) {
    lines.push(`- **Build**: \`${projectInfo.buildCommand}\``);
  }
  if (projectInfo.testCommand) {
    lines.push(`- **Test**: \`${projectInfo.testCommand}\``);
  }
  if (projectInfo.lintCommand) {
    lines.push(`- **Lint**: \`${projectInfo.lintCommand}\``);
  }
  if (projectInfo.formatCommand) {
    lines.push(`- **Format**: \`${projectInfo.formatCommand}\``);
  }

  return lines.length > 0
    ? lines.join('\n')
    : 'No commands detected. Add build/test/lint scripts to your project.';
}

function buildCodeStyleSection(projectInfo) {
  const languageSpecific = {
    typescript: [
      '- Prefer explicit types at boundaries and strict TypeScript defaults',
      '- Keep modules small and use ESM imports consistently',
    ],
    javascript: [
      '- Prefer explicit runtime validation at boundaries',
      '- Keep modules small and use ESM imports consistently',
    ],
    python: [
      '- Prefer type hints for public functions and clear module boundaries',
      '- Keep scripts deterministic and avoid hidden side effects',
    ],
    go: [
      '- Keep packages small and favor explicit error handling',
      '- Prefer table-driven tests for behavior coverage',
    ],
    rust: [
      '- Prefer clear ownership boundaries and small modules',
      '- Use Result-based error handling instead of panics for expected failures',
    ],
    unknown: [],
  };

  const lines = [
    '### Code Conventions',
    '',
    '- Follow existing code style and naming conventions in this project',
    '- Write clear, self-documenting code with descriptive names',
    '- Keep functions focused and small',
    '- Add comments only where the logic is not self-evident',
    '- Handle errors at appropriate boundaries',
    ...languageSpecific[projectInfo.language],
  ];

  return lines.join('\n');
}

export function buildAgentsMd(projectInfo, stages) {
  const corePipelineOrder = [
    '0_business_scenario',
    '1_gofer_research',
    '2_gofer_specify',
    '3_gofer_plan',
    '4_gofer_tasks',
    '5_gofer_implement',
    '6_gofer_validate',
  ];
  const corePipelineSet = new Set(corePipelineOrder);
  const helperStages = [];
  const pipelineStages = [];

  for (const stage of stages) {
    if (corePipelineSet.has(String(stage.frontmatter.name))) {
      pipelineStages.push(stage);
    } else {
      helperStages.push(stage);
    }
  }

  pipelineStages.sort(
    (a, b) =>
      corePipelineOrder.indexOf(String(a.frontmatter.name)) -
      corePipelineOrder.indexOf(String(b.frontmatter.name))
  );

  const pipelineSections = pipelineStages
    .map(
      (stage) =>
        `### ${stage.frontmatter.name}\n\n${String(stage.frontmatter.description).trim()}`
    )
    .join('\n\n');
  const helperSections = helperStages
    .map(
      (stage) =>
        `### ${stage.frontmatter.name}\n\n${String(stage.frontmatter.description).trim()}`
    )
    .join('\n\n');

  const frameworkLine = projectInfo.framework ? ` | **Framework**: ${projectInfo.framework}` : '';

  return `# AGENTS.md

**Project**: ${projectInfo.name} | **Language**: ${formatLanguage(projectInfo.language)}${frameworkLine} | **Package Manager**: ${projectInfo.packageManager || 'Not detected'}

## Core Pipeline Stages

${pipelineSections}

## Optional Helper Commands

${helperSections}

## Commands

${buildCommandsSection(projectInfo)}

## Code Style

${buildCodeStyleSection(projectInfo)}

## Testing

- **Test Runner**: ${projectInfo.testRunner || 'Not detected'}
- Write tests for new functionality before marking tasks complete
- Run the full test suite before committing

## Git Workflow

- Use conventional commit messages (feat:, fix:, chore:, docs:)
- Create feature branches for new work
- Run tests and linting before committing

## Gofer Pipeline

This project uses Gofer for spec-driven development. Run \`/0_business_scenario\` to start the core pipeline (business scenario -> research -> specify -> plan -> tasks -> implement -> validate). \`/6_gofer_validate\` is the terminal quality gate and includes the final engineering review loop. Artifacts in \`.specify/specs/{feature}/\`.

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
`;
}

export function buildClaudeMd() {
  return `# CLAUDE.md

See @AGENTS.md for project conventions, commands, and code style.

## Workflow Orchestration

### 1. Plan Node Default
- Enter plan mode for any non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, stop and re-plan immediately instead of pushing through
- Use plan mode for verification steps, not just building

### 2. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Run tests, check logs, and demonstrate correctness

### 3. Demand Elegance (Balanced)
- For non-trivial changes, pause and ask whether there is a cleaner solution
- Skip over-engineering for simple fixes

## Task Management

1. **Plan First**: Write a plan with checkable items before implementation
2. **Track Progress**: Mark items complete as you go
3. **Explain Changes**: Give high-level summaries at meaningful checkpoints
4. **Verify**: Run tests before calling the work done

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Gofer Pipeline

Run \`/0_business_scenario\` to start the core pipeline: business scenario -> research -> specify -> plan -> tasks -> implement -> validate. \`/6_gofer_validate\` is the terminal quality gate and includes the final engineering review loop. Use \`/7_gofer_save\` and \`/8_gofer_resume\` for session continuity. Artifacts go to \`.specify/specs/{feature}/\`.
`;
}

export function buildCopilotInstructions(projectInfo) {
  const frameworkBit = projectInfo.framework ? ` using ${projectInfo.framework}` : '';
  return `# Copilot Instructions

## Project Overview

**${projectInfo.name}** is a ${formatLanguage(projectInfo.language)} project${frameworkBit}.

## Gofer Pipeline

This project uses Gofer for spec-driven development. Run \`/0_business_scenario\` to start the core pipeline: business scenario -> research -> specify -> plan -> tasks -> implement -> validate.

Key commands: \`/1_gofer_research\`, \`/2_gofer_specify\`, \`/3_gofer_plan\`, \`/4_gofer_tasks\`, \`/5_gofer_implement\`, \`/6_gofer_validate\`. \`/6_gofer_validate\` is the terminal quality gate and includes the final engineering review loop. Use \`/7_gofer_save\` and \`/8_gofer_resume\` for session continuity. Artifacts in \`.specify/specs/{feature}/\`.

## Code Quality

${buildCodeStyleSection(projectInfo)}

## Task Management

1. **Plan First**: Write a plan with checkable items before starting
2. **Track Progress**: Mark items complete as you go
3. **Verify**: Run tests and demonstrate correctness before marking done
4. **Capture Lessons**: Update lessons after meaningful corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
`;
}

export async function readManagedVersion(workspaceRoot) {
  try {
    const content = await fs.readFile(path.join(workspaceRoot, GOFER_VERSION_FILE), 'utf8');
    return content.split('\n')[0]?.trim() || null;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function collectMissingPaths(workspaceRoot, relativePaths) {
  const missing = [];
  for (const relativePath of relativePaths) {
    if (!(await pathExists(path.join(workspaceRoot, relativePath)))) {
      missing.push(relativePath);
    }
  }
  return missing;
}

export async function checkWorkspaceState({
  workspaceRoot,
  host = 'auto',
  sourceRoot,
}) {
  const normalizedHost = normalizeHost(host);
  const expectedVersion = await detectGoferVersion(sourceRoot);
  const actualVersion = await readManagedVersion(workspaceRoot);
  const missingCore = await collectMissingPaths(workspaceRoot, CORE_SENTINELS);
  const requiredHostPaths = HOST_POLICIES[normalizedHost]?.required || [];
  const missingHost = await collectMissingPaths(workspaceRoot, requiredHostPaths);

  let status = 'healthy';
  const reasons = [];

  if (missingCore.length > 0 || missingHost.length > 0) {
    status = 'missing';
    if (missingCore.length > 0) {
      reasons.push('core scaffold missing');
    }
    if (missingHost.length > 0) {
      reasons.push(`${normalizedHost} host files missing`);
    }
  } else if (actualVersion !== expectedVersion) {
    status = 'stale';
    reasons.push(`workspace version ${actualVersion ?? 'missing'} != plugin version ${expectedVersion}`);
  }

  return {
    workspaceRoot,
    host: normalizedHost,
    status,
    expectedVersion,
    actualVersion,
    missingCore,
    missingHost,
    shouldPromptInitialize: status !== 'healthy',
    prompt:
      status === 'healthy'
        ? null
        : 'This repo is missing or stale for Gofer. Initialize/update it now?',
    summary:
      status === 'healthy'
        ? `Gofer workspace is healthy for ${normalizedHost}.`
        : `Gofer workspace is ${status}: ${reasons.join('; ')}`,
  };
}

async function ensureDir(targetPath, dryRun) {
  if (!dryRun) {
    await fs.mkdir(targetPath, { recursive: true });
  }
}

async function copyDirectory(sourcePath, targetPath, dryRun) {
  if (!(await pathExists(sourcePath))) {
    return false;
  }
  if (dryRun) {
    return true;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.cp(sourcePath, targetPath, { recursive: true, force: true, dereference: false });
  return true;
}

async function writeFileIfMissing(filePath, content, dryRun) {
  if (await pathExists(filePath)) {
    return false;
  }
  if (!dryRun) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }
  return true;
}

async function writeTextFile(filePath, content, dryRun) {
  if (!dryRun) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }
}

async function writeModelPolicyIfMissing(workspaceRoot, sourceRoot, dryRun) {
  const sourcePath = path.join(sourceRoot, '.specify', 'templates', 'gofer-model-policy.yaml');
  const targetPath = path.join(workspaceRoot, '.specify', 'memory', 'gofer-model-policy.yaml');

  let template = '';
  try {
    template = await fs.readFile(sourcePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  return writeFileIfMissing(targetPath, template, dryRun);
}

async function mergeGitignore(workspaceRoot, dryRun) {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  let existing = '';
  try {
    existing = await fs.readFile(gitignorePath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  const missingEntries = GOFER_GITIGNORE_ENTRIES.filter((entry) => !existing.includes(entry));
  if (missingEntries.length === 0) {
    return false;
  }

  let updated = existing;
  if (updated.length > 0 && !updated.endsWith('\n')) {
    updated += '\n';
  }
  if (!updated.includes('# Gofer runtime files')) {
    updated += '\n# Gofer runtime files (auto-generated, should not be committed)\n';
  }
  for (const entry of missingEntries) {
    updated += `${entry}\n`;
  }

  await writeTextFile(gitignorePath, updated, dryRun);
  return true;
}

function buildSpecifyReadme() {
  return `# Gofer - Specification Directory

This folder contains all project specifications for AI-driven feature development.

## Structure

- **memory/** - Constitution, decisions, and project principles
- **specs/** - Feature specifications (numbered: 001-feature-name/)
- **templates/** - Templates for specs, plans, and tasks
- **scripts/** - Helper scripts for workflow automation
- **logs/** - Execution logs and support artifacts

## Quick Start

Run the unified Gofer pipeline with:

\`\`\`
/0_business_scenario Add user authentication with OAuth2 and JWT
\`\`\`

Artifacts are stored in \`.specify/specs/{feature}/\`.

## Model Policy

Edit \`.specify/memory/gofer-model-policy.yaml\` to tune simple, medium, hard,
and arbiter model routes for Claude, Codex/OpenAI, Gemini, and Copilot. The
file is copied from \`.specify/templates/gofer-model-policy.yaml\` when missing
and is not overwritten by bootstrap.
`;
}

function getMirrorCopyCandidates(sourceRoot) {
  return [
    { source: path.join(sourceRoot, 'commands'), target: path.join('.claude', 'commands') },
    { source: path.join(sourceRoot, 'agents'), target: path.join('.claude', 'agents') },
    { source: path.join(sourceRoot, '.github', 'prompts'), target: path.join('.github', 'prompts') },
    {
      source: path.join(sourceRoot, '.github', 'instructions'),
      target: path.join('.github', 'instructions'),
    },
    { source: path.join(sourceRoot, '.gemini'), target: '.gemini' },
    { source: path.join(sourceRoot, 'skills'), target: path.join('.agents', 'skills') },
    { source: path.join(sourceRoot, 'skills'), target: path.join('.system', 'skills') },
  ];
}

async function installClaudeHooksSettings(workspaceRoot, dryRun) {
  const settingsPath = path.join(workspaceRoot, '.claude', 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      throw error;
    }
  }

  settings.hooks = {
    ...(settings.hooks || {}),
    ...CLAUDE_HOOKS_CONFIG,
  };

  await writeTextFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, dryRun);
}

export async function bootstrapWorkspace({
  workspaceRoot,
  host = 'auto',
  sourceRoot,
  dryRun = false,
  includeMirrors = false,
}) {
  const normalizedHost = normalizeHost(host);
  const projectInfo = await detectProjectInfo(workspaceRoot);
  const stages = await loadStageMetadata(sourceRoot);
  const version = await detectGoferVersion(sourceRoot);
  const changed = [];

  const coreDirs = [
    path.join('.specify', 'specs'),
    path.join('.specify', 'memory'),
    path.join('.specify', 'logs'),
  ];
  for (const relativeDir of coreDirs) {
    await ensureDir(path.join(workspaceRoot, relativeDir), dryRun);
    changed.push(relativeDir);
  }

  const coreCopies = [
    path.join('.specify', 'commands'),
    path.join('.specify', 'templates'),
    path.join('.specify', 'scripts', 'bash'),
    path.join('.specify', 'scripts', 'node'),
    path.join('.specify', 'scripts', 'hooks'),
    path.join('.specify', 'scripts', 'powershell'),
  ];
  for (const relativePath of coreCopies) {
    const copied = await copyDirectory(
      path.join(sourceRoot, relativePath),
      path.join(workspaceRoot, relativePath),
      dryRun
    );
    if (copied) {
      changed.push(relativePath);
    }
  }

  if (await writeModelPolicyIfMissing(workspaceRoot, sourceRoot, dryRun)) {
    changed.push(path.join('.specify', 'memory', 'gofer-model-policy.yaml'));
  }

  await writeTextFile(
    path.join(workspaceRoot, GOFER_VERSION_FILE),
    `${version}\n`,
    dryRun
  );
  changed.push(GOFER_VERSION_FILE);

  if (await writeFileIfMissing(path.join(workspaceRoot, '.specify', 'README.md'), buildSpecifyReadme(), dryRun)) {
    changed.push(path.join('.specify', 'README.md'));
  }

  if (await writeFileIfMissing(path.join(workspaceRoot, 'AGENTS.md'), buildAgentsMd(projectInfo, stages), dryRun)) {
    changed.push('AGENTS.md');
  }

  if (normalizedHost === 'claude') {
    if (await writeFileIfMissing(path.join(workspaceRoot, 'CLAUDE.md'), buildClaudeMd(), dryRun)) {
      changed.push('CLAUDE.md');
    }
    await installClaudeHooksSettings(workspaceRoot, dryRun);
    changed.push(path.join('.claude', 'settings.json'));
  }

  if (normalizedHost === 'copilot') {
    if (
      await writeFileIfMissing(
        path.join(workspaceRoot, '.github', 'copilot-instructions.md'),
        buildCopilotInstructions(projectInfo),
        dryRun
      )
    ) {
      changed.push(path.join('.github', 'copilot-instructions.md'));
    }
  }

  if (includeMirrors) {
    for (const candidate of getMirrorCopyCandidates(sourceRoot)) {
      const copied = await copyDirectory(
        candidate.source,
        path.join(workspaceRoot, candidate.target),
        dryRun
      );
      if (copied) {
        changed.push(candidate.target);
      }
    }
  }

  if (await mergeGitignore(workspaceRoot, dryRun)) {
    changed.push('.gitignore');
  }

  const postCheck = await checkWorkspaceState({
    workspaceRoot,
    host: normalizedHost,
    sourceRoot,
  });

  return {
    workspaceRoot,
    host: normalizedHost,
    version,
    dryRun,
    includeMirrors,
    changed,
    status: postCheck.status,
    check: postCheck,
  };
}

export function formatWorkspaceCheckReport(report) {
  const lines = [
    `Workspace: ${report.workspaceRoot}`,
    `Host: ${report.host}`,
    `Status: ${report.status}`,
    `Expected version: ${report.expectedVersion}`,
    `Workspace version: ${report.actualVersion ?? 'missing'}`,
  ];

  if (report.missingCore.length > 0) {
    lines.push(`Missing core: ${report.missingCore.join(', ')}`);
  }
  if (report.missingHost.length > 0) {
    lines.push(`Missing host files: ${report.missingHost.join(', ')}`);
  }
  if (report.prompt) {
    lines.push(`Prompt: ${report.prompt}`);
  }

  return lines.join('\n');
}
