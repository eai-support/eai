#!/usr/bin/env node

import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { SUPPORTED_HOSTS } from './gofer-surface-update.mjs';
import { parseStageCommand } from './parse-stage-command.mjs';

export const GOFER_VERSION_FILE = path.join('.specify', '.gofer-version');
export const CORE_SENTINELS = [
  GOFER_VERSION_FILE,
  path.join('.specify', 'commands', '0_gofer_start.md'),
  path.join('.specify', 'config', 'object-type-routing.json'),
  path.join('.specify', 'templates', 'spec-template.md'),
  path.join('.specify', 'templates', 'build-map-template.md'),
  path.join('.specify', 'templates', 'loop-contract-template.json'),
  path.join('.specify', 'templates', 'business-scenarios-template.json'),
  path.join('.specify', 'templates', 'working-backwards-prfaq-template.md'),
  path.join('.specify', 'templates', 'business-owner-summary-template.md'),
  path.join('.specify', 'templates', 'cto-architecture-summary-template.md'),
  path.join('.specify', 'templates', 'ciso-security-summary-template.md'),
  path.join('.specify', 'templates', 'stakeholder-review-index-template.md'),
  path.join('.specify', 'templates', 'brand', 'brand-profile-template.json'),
  path.join('.specify', 'templates', 'brand', 'document-style-template.md'),
  path.join('.specify', 'templates', 'brand', 'marp-theme-template.css'),
  path.join('.specify', 'scripts', 'bash', 'create-new-feature.sh'),
  path.join('.specify', 'scripts', 'node', 'parse-stage-command.mjs'),
  path.join('.specify', 'scripts', 'node', 'gofer-local-settings-cleanup.mjs'),
  path.join('.specify', 'scripts', 'node', 'gofer-loop-audit.mjs'),
  path.join('.specify', 'scripts', 'node', 'gofer-ui-preview.mjs'),
  path.join('.specify', 'scripts', 'hooks', 'post-tool-use.mjs'),
  path.join('.specify', 'scripts', 'powershell', 'install-optional-tools.ps1'),
  path.join('.specify', 'references', 'platform', 'README.md'),
  path.join('.specify', 'references', 'platform', 'eai.md'),
  path.join('.specify', 'references', 'platform', 'eai-repo-contract.md'),
  path.join('.specify', 'references', 'platform', 'eai-error-catalog.yaml'),
  path.join('.specify', 'templates', 'gofer-model-policy.yaml'),
  path.join('.specify', 'memory', 'gofer-model-policy.yaml'),
  path.join('.specify', 'specs'),
  path.join('.specify', 'memory'),
];
const LEGACY_MANAGED_PATHS = [
  path.join('.specify', 'commands', '0_business_scenario.md'),
  path.join('.claude', 'commands', '0_business_scenario.md'),
  path.join('.github', 'prompts', '0_business_scenario.prompt.md'),
  path.join('.agents', 'skills', '0_business_scenario'),
  path.join('.system', 'skills', '0_business_scenario'),
  path.join('.gemini', 'commands', 'gofer', '0_business_scenario.md'),
  path.join('.gemini', 'commands', 'gofer', '0_business_scenario.toml'),
];
const RETIRED_PUBLIC_ENTRYPOINT_STEMS = ['gofer'];
const LEGACY_MANAGED_ARCHIVE_ROOT = path.join('.specify', 'logs', 'legacy-command-backups');

export const WORKSPACE_HOSTS = SUPPORTED_HOSTS;

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
  antigravity: {
    required: ['AGENTS.md', 'GEMINI.md'],
  },
  grok: {
    required: ['AGENTS.md'],
  },
  vscode: {
    required: [path.join('.github', 'copilot-instructions.md')],
  },
};

const LEGACY_HOST_ALIASES = {
  gemini: 'antigravity',
};

const WORKSPACE_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  '.specify',
];

const EAI_CONFIG_DIR = path.join('src', 'eai.config');
const EAI_OBJECT_TYPES_MARKER = path.join(EAI_CONFIG_DIR, 'object-types.ts');
const EAI_REGISTER_MARKER = path.join(EAI_CONFIG_DIR, 'register.ts');
const EAI_MANIFEST_MARKER = 'manifest.yml';
const EAI_RUNTIME_CONTRACT_MARKER = 'eai.runtime.json';

const EXTENSION_RESOURCE_PATHS = new Map([
  [path.join('.specify', 'commands'), path.join('resources', 'specify-commands')],
  [path.join('.specify', 'config'), path.join('resources', 'specify-config')],
  [path.join('.specify', 'references'), path.join('resources', 'references')],
  [path.join('.specify', 'schemas'), path.join('resources', 'schemas')],
  [path.join('.specify', 'templates'), path.join('resources', 'templates')],
  [path.join('.specify', 'scripts', 'bash'), path.join('resources', 'bash-scripts')],
  [path.join('.specify', 'scripts', 'node'), path.join('resources', 'node-scripts')],
  [path.join('.specify', 'scripts', 'hooks'), path.join('resources', 'hook-scripts')],
  [
    path.join('.specify', 'scripts', 'powershell'),
    path.join('resources', 'powershell-scripts'),
  ],
  ['commands', path.join('resources', 'claude-commands')],
  ['agents', path.join('resources', 'claude-agents')],
  [path.join('.claude', 'skills'), path.join('resources', 'claude-skills')],
  [path.join('.github', 'agents'), path.join('resources', 'github-agents')],
  [path.join('.github', 'prompts'), path.join('resources', 'copilot-prompts')],
  [path.join('.github', 'instructions'), path.join('resources', 'copilot-instructions')],
  [path.join('.github', 'skills'), path.join('resources', 'github-skills')],
  [path.join('.gemini'), path.join('resources', 'gemini')],
  [path.join('.grok', 'skills'), path.join('resources', 'grok-skills')],
  [path.join('.agents', 'skills'), 'skills'],
  [path.join('.system', 'skills'), 'skills'],
]);

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
    eaiInitialized: false,
  };
}

export function normalizeHost(host = 'auto') {
  const normalized = host == null ? 'auto' : String(host).trim().toLowerCase();
  if (normalized === '' || normalized === 'auto') {
    return 'auto';
  }
  if (Object.prototype.hasOwnProperty.call(LEGACY_HOST_ALIASES, normalized)) {
    return LEGACY_HOST_ALIASES[normalized];
  }
  if (Object.prototype.hasOwnProperty.call(HOST_POLICIES, normalized)) {
    return normalized;
  }
  throw new Error(
    `Unsupported Gofer host. Expected auto or one of: ${WORKSPACE_HOSTS.join(', ')}.`
  );
}

export function scriptRootFromUrl(scriptUrl) {
  const filePath = fileURLToPath(scriptUrl);
  const dirPath = path.dirname(filePath);
  if (path.basename(path.dirname(dirPath)) === 'resources') {
    return path.resolve(dirPath, '..', '..');
  }
  return path.resolve(dirPath, '..', '..', '..');
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

async function lstatIfExists(targetPath) {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function resolveConfinedWorkspacePath(workspaceRoot, relativePath) {
  const resolvedRoot = path.resolve(workspaceRoot);
  if (path.isAbsolute(relativePath)) {
    throw new Error('Unsafe Gofer workspace path: absolute managed paths are not allowed.');
  }

  const targetPath = path.resolve(resolvedRoot, relativePath);
  const relativeTarget = path.relative(resolvedRoot, targetPath);
  if (
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    throw new Error('Unsafe Gofer workspace path: managed paths must stay inside the workspace.');
  }

  return { resolvedRoot, targetPath, relativeTarget };
}

async function assertSafeWorkspaceRoot(workspaceRoot) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const rootStat = await lstatIfExists(resolvedRoot);
  if (!rootStat) {
    throw new Error('Unsafe Gofer workspace path: the workspace root does not exist.');
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(
      'Unsafe Gofer workspace path: the workspace root must be a real directory, not a symbolic link.'
    );
  }
  return resolvedRoot;
}

async function inspectWorkspacePath(
  workspaceRoot,
  relativePath,
  { leafType = 'any', allowMissing = true } = {}
) {
  const { resolvedRoot, targetPath, relativeTarget } = resolveConfinedWorkspacePath(
    workspaceRoot,
    relativePath
  );
  await assertSafeWorkspaceRoot(resolvedRoot);

  if (relativeTarget === '') {
    return {
      exists: true,
      path: resolvedRoot,
      stat: await fs.lstat(resolvedRoot),
      relativeTarget,
    };
  }

  const components = relativeTarget.split(path.sep).filter(Boolean);
  let currentPath = resolvedRoot;
  let leafStat = null;
  for (let index = 0; index < components.length; index += 1) {
    currentPath = path.join(currentPath, components[index]);
    const currentStat = await lstatIfExists(currentPath);
    if (!currentStat) {
      if (!allowMissing) {
        throw new Error('Unsafe Gofer workspace path: a required managed path is missing.');
      }
      return { exists: false, path: targetPath, stat: null, relativeTarget };
    }
    if (currentStat.isSymbolicLink()) {
      throw new Error(
        'Unsafe Gofer workspace path: symbolic links are not allowed in managed paths.'
      );
    }

    const isLeaf = index === components.length - 1;
    if (isLeaf) {
      leafStat = currentStat;
    }
    if (!isLeaf && !currentStat.isDirectory()) {
      throw new Error(
        'Unsafe Gofer workspace path: every managed parent component must be a directory.'
      );
    }
    if (isLeaf && leafType === 'directory' && !currentStat.isDirectory()) {
      throw new Error('Unsafe Gofer workspace path: the managed path must be a directory.');
    }
    if (isLeaf && leafType === 'file' && !currentStat.isFile()) {
      throw new Error('Unsafe Gofer workspace path: the managed path must be a regular file.');
    }
    if (
      isLeaf &&
      leafType === 'any' &&
      !currentStat.isDirectory() &&
      !currentStat.isFile()
    ) {
      throw new Error(
        'Unsafe Gofer workspace path: managed paths must be regular files or directories.'
      );
    }
  }

  return {
    exists: true,
    path: targetPath,
    stat: leafStat,
    relativeTarget,
  };
}

async function ensureSafeWorkspaceDirectory(workspaceRoot, relativePath, dryRun) {
  const { resolvedRoot, targetPath, relativeTarget } = resolveConfinedWorkspacePath(
    workspaceRoot,
    relativePath
  );
  await assertSafeWorkspaceRoot(resolvedRoot);
  if (relativeTarget === '') {
    return targetPath;
  }

  const components = relativeTarget.split(path.sep).filter(Boolean);
  let currentPath = resolvedRoot;
  for (const component of components) {
    currentPath = path.join(currentPath, component);
    let currentStat = await lstatIfExists(currentPath);
    if (!currentStat) {
      if (dryRun) {
        return targetPath;
      }
      try {
        await fs.mkdir(currentPath);
      } catch (error) {
        if (error?.code !== 'EEXIST') {
          throw error;
        }
      }
      currentStat = await lstatIfExists(currentPath);
    }
    if (!currentStat || currentStat.isSymbolicLink() || !currentStat.isDirectory()) {
      throw new Error(
        'Unsafe Gofer workspace path: every managed directory component must be a real directory; symbolic links are not allowed.'
      );
    }
  }

  return targetPath;
}

function directoryIdentityMatches(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.isDirectory() &&
    right.isDirectory()
  );
}

async function openValidatedDirectory(directoryPath) {
  const initialStat = await fs.lstat(directoryPath);
  let handle = null;
  try {
    handle = await fs.open(directoryPath, 'r');
  } catch (error) {
    if (
      process.platform !== 'win32' ||
      !['EACCES', 'EISDIR', 'EPERM'].includes(String(error?.code))
    ) {
      throw error;
    }
  }
  const validation = { handle, initialStat };
  await assertDirectoryMatchesPath(validation, directoryPath);
  return validation;
}

async function assertDirectoryMatchesPath(validation, directoryPath) {
  const [openedStat, pathStat] = await Promise.all([
    validation.handle ? validation.handle.stat() : validation.initialStat,
    fs.lstat(directoryPath),
  ]);
  if (pathStat.isSymbolicLink() || !directoryIdentityMatches(openedStat, pathStat)) {
    throw new Error(
      'Unsafe Gofer workspace path: a managed parent directory changed during validation.'
    );
  }
}

async function writeWorkspaceFile(workspaceRoot, relativePath, content, dryRun, mode = null) {
  const target = await inspectWorkspacePath(workspaceRoot, relativePath, {
    leafType: 'file',
    allowMissing: true,
  });
  if (dryRun) {
    return;
  }

  const parentRelativePath = path.dirname(target.relativeTarget);
  const normalizedParent = parentRelativePath === '.' ? '' : parentRelativePath;
  const parentPath = await ensureSafeWorkspaceDirectory(
    workspaceRoot,
    normalizedParent,
    false
  );
  const existingMode = target.exists ? target.stat.mode & 0o777 : 0o666;
  const temporaryName = `.gofer-write-${process.pid}-${randomUUID()}.tmp`;
  const temporaryRelativePath = path.join(normalizedParent, temporaryName);
  const temporaryPath = path.join(parentPath, temporaryName);
  let temporaryHandle;
  let parentValidation;

  try {
    parentValidation = await openValidatedDirectory(parentPath);
    await inspectWorkspacePath(workspaceRoot, temporaryRelativePath, {
      leafType: 'file',
      allowMissing: true,
    });
    temporaryHandle = await fs.open(temporaryPath, 'wx', mode ?? existingMode);
    await temporaryHandle.writeFile(content);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = null;

    await inspectWorkspacePath(workspaceRoot, normalizedParent, {
      leafType: 'directory',
      allowMissing: false,
    });
    await assertDirectoryMatchesPath(parentValidation, parentPath);
    await inspectWorkspacePath(workspaceRoot, relativePath, {
      leafType: 'file',
      allowMissing: true,
    });
    await fs.rename(temporaryPath, target.path);
    await assertDirectoryMatchesPath(parentValidation, parentPath);
    await inspectWorkspacePath(workspaceRoot, relativePath, {
      leafType: 'file',
      allowMissing: false,
    });
  } finally {
    if (temporaryHandle) {
      await temporaryHandle.close().catch(() => {});
    }
    if (parentValidation) {
      try {
        await assertDirectoryMatchesPath(parentValidation, parentPath);
        await fs.rm(temporaryPath, { force: true });
      } catch {
        // If the parent identity changed, do not risk deleting through its replacement.
      }
    }
    if (parentValidation?.handle) {
      await parentValidation.handle.close().catch(() => {});
    }
  }
}

function buildArchiveStamp() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
}

async function archiveLegacyManagedPath(workspaceRoot, relativePath, archiveStamp, dryRun) {
  const archiveRelativePath = path.join(LEGACY_MANAGED_ARCHIVE_ROOT, archiveStamp, relativePath);
  const source = await inspectWorkspacePath(workspaceRoot, relativePath, {
    leafType: 'any',
    allowMissing: false,
  });
  const archiveTarget = await inspectWorkspacePath(workspaceRoot, archiveRelativePath, {
    leafType: 'any',
    allowMissing: true,
  });
  if (archiveTarget.exists) {
    throw new Error('Unsafe Gofer archive path: the managed archive target already exists.');
  }

  if (!dryRun) {
    const archiveParent = path.dirname(archiveRelativePath);
    const archiveParentPath = await ensureSafeWorkspaceDirectory(
      workspaceRoot,
      archiveParent,
      false
    );
    const sourceParentPath = resolveConfinedWorkspacePath(
      workspaceRoot,
      path.dirname(relativePath)
    ).targetPath;
    const sourceParentValidation = await openValidatedDirectory(sourceParentPath);
    const archiveParentValidation = await openValidatedDirectory(archiveParentPath);
    try {
      await assertDirectoryMatchesPath(sourceParentValidation, sourceParentPath);
      await assertDirectoryMatchesPath(archiveParentValidation, archiveParentPath);
      const currentSource = await inspectWorkspacePath(workspaceRoot, relativePath, {
        leafType: 'any',
        allowMissing: false,
      });
      if (
        currentSource.stat.dev !== source.stat.dev ||
        currentSource.stat.ino !== source.stat.ino ||
        currentSource.stat.isDirectory() !== source.stat.isDirectory() ||
        currentSource.stat.isFile() !== source.stat.isFile()
      ) {
        throw new Error(
          'Unsafe Gofer archive path: the legacy path changed during validation.'
        );
      }
      const currentArchiveTarget = await inspectWorkspacePath(
        workspaceRoot,
        archiveRelativePath,
        { leafType: 'any', allowMissing: true }
      );
      if (currentArchiveTarget.exists) {
        throw new Error('Unsafe Gofer archive path: the managed archive target already exists.');
      }
      await fs.rename(source.path, archiveTarget.path);
      await assertDirectoryMatchesPath(sourceParentValidation, sourceParentPath);
      await assertDirectoryMatchesPath(archiveParentValidation, archiveParentPath);
    } catch (error) {
      if (error?.code === 'EXDEV') {
        throw new Error(
          'Unsafe Gofer archive path: cross-device legacy archives are not supported.'
        );
      }
      throw error;
    } finally {
      if (sourceParentValidation.handle) {
        await sourceParentValidation.handle.close().catch(() => {});
      }
      if (archiveParentValidation.handle) {
        await archiveParentValidation.handle.close().catch(() => {});
      }
    }
    const archived = await inspectWorkspacePath(workspaceRoot, archiveRelativePath, {
      leafType: 'any',
      allowMissing: false,
    });
    if (
      archived.stat.dev !== source.stat.dev ||
      archived.stat.ino !== source.stat.ino ||
      archived.stat.isDirectory() !== source.stat.isDirectory() ||
      archived.stat.isFile() !== source.stat.isFile()
    ) {
      throw new Error('Unsafe Gofer archive path: the archived path failed identity validation.');
    }
  }

  return archiveRelativePath;
}

function buildVisibleSurfacePathsForStem(stem) {
  return [
    path.join('.claude', 'commands', `${stem}.md`),
    path.join('.github', 'prompts', `${stem}.prompt.md`),
    path.join('.agents', 'skills', stem),
    path.join('.system', 'skills', stem),
    path.join('.gemini', 'commands', 'gofer', `${stem}.md`),
    path.join('.gemini', 'commands', 'gofer', `${stem}.toml`),
  ];
}

function buildStaleVisibleManagedPaths(stages) {
  const staleStems = new Set(RETIRED_PUBLIC_ENTRYPOINT_STEMS);
  for (const stage of stages) {
    staleStems.add(String(stage.stem));
  }

  return Array.from(staleStems).flatMap((stem) => buildVisibleSurfacePathsForStem(stem));
}

async function removeLegacyManagedPaths(workspaceRoot, dryRun, stages = []) {
  const archived = [];
  const archiveStamp = buildArchiveStamp();
  const legacyPaths = Array.from(
    new Set([...LEGACY_MANAGED_PATHS, ...buildStaleVisibleManagedPaths(stages)])
  );

  for (const relativePath of legacyPaths) {
    const target = await inspectWorkspacePath(workspaceRoot, relativePath, {
      leafType: 'any',
      allowMissing: true,
    });
    if (!target.exists) {
      continue;
    }

    archived.push({
      relativePath,
      archivePath: await archiveLegacyManagedPath(workspaceRoot, relativePath, archiveStamp, dryRun),
    });
  }
  return archived;
}

async function resolveSourcePath(sourceRoot, relativePath) {
  const directPath = path.join(sourceRoot, relativePath);
  if (await pathExists(directPath)) {
    return directPath;
  }

  const resourceRelativePath = EXTENSION_RESOURCE_PATHS.get(path.normalize(relativePath));
  if (resourceRelativePath) {
    for (const resourcePath of [
      path.join(sourceRoot, resourceRelativePath),
      path.join(sourceRoot, 'extension', resourceRelativePath),
    ]) {
      if (await pathExists(resourcePath)) {
        return resourcePath;
      }
    }
  }

  return directPath;
}

async function readSourceFile(sourceRoot, relativePath, encoding = 'utf8') {
  return fs.readFile(await resolveSourcePath(sourceRoot, relativePath), encoding);
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
    {
      path: path.join(sourceRoot, '.eai-gofer-plugin-version'),
      type: 'marker',
    },
    {
      path: path.join(sourceRoot, 'plugin.json'),
      type: 'manifest',
      validName: (name) => name === 'eai-gofer',
    },
    {
      path: path.join(sourceRoot, 'package.json'),
      type: 'manifest',
      validName: (name) => name === 'eai-gofer' || name === 'gofer',
    },
    {
      path: path.join(sourceRoot, 'extension', 'package.json'),
      type: 'manifest',
      validName: (name) => name === 'gofer',
    },
    {
      path: path.join(sourceRoot, GOFER_VERSION_FILE),
      type: 'marker',
    },
  ];

  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate.path, 'utf8');
      if (candidate.type === 'marker') {
        const firstLine = content.split('\n')[0]?.trim();
        if (firstLine) {
          return firstLine;
        }
        continue;
      }

      const parsed = JSON.parse(content);
      const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
      if (
        candidate.validName?.(name) &&
        typeof parsed.version === 'string' &&
        parsed.version.trim().length > 0
      ) {
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
  const commandsDir = await resolveSourcePath(sourceRoot, path.join('.specify', 'commands'));
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
  info.eaiInitialized = await detectEaiInitialized(workspaceRoot);

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

async function detectEaiInitialized(workspaceRoot) {
  const [hasEaiConfigDir, hasObjectTypes, hasRegister, hasManifest, hasRuntimeContract] =
    await Promise.all([
      pathExists(path.join(workspaceRoot, EAI_CONFIG_DIR)),
      pathExists(path.join(workspaceRoot, EAI_OBJECT_TYPES_MARKER)),
      pathExists(path.join(workspaceRoot, EAI_REGISTER_MARKER)),
      pathExists(path.join(workspaceRoot, EAI_MANIFEST_MARKER)),
      pathExists(path.join(workspaceRoot, EAI_RUNTIME_CONTRACT_MARKER)),
    ]);

  return hasRuntimeContract || (hasObjectTypes && hasRegister) || (hasEaiConfigDir && hasManifest);
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

function buildEaiRepoContractSection(projectInfo) {
  if (!projectInfo.eaiInitialized) {
    return `## EAI Platform Readiness

- Classify the request before EAI readiness. If it is EAI app delivery or ambiguous, continue directly to EAI readiness. If it is clearly non-app work, confirm once before skipping EAI tenant/app setup.
- This repo is not confirmed as EAI-initialized yet. Run \`eai whoami\` only for EAI app delivery work or explicit EAI CLI recovery.
- If \`eai\` is missing, login fails, the token is expired, or no active tenant is visible during app delivery, use the public \`eai\` entrypoint and the internal \`.specify/commands/gofer_eai_first_run.md\` setup contract before building.
- Do not invent, guess, or complete EAI CLI commands from memory. Verify exact \`eai ...\` syntax and flags with \`eai --describe\` and command-specific \`--help\` before suggesting or running them.
- Build on EAI Platform first and Azure second for app delivery. Treat non-EAI runtimes as explicit exceptions only.
- Do not write tokens, secrets, private tenant IDs, or local \`.env\` values into Gofer artifacts.`;
  }

  return `## EAI Repo Contract

- This repo appears to be initialized from the EAI app template. Before app-delivery work, read \`.specify/references/platform/eai-repo-contract.md\` and \`.specify/references/platform/eai-error-catalog.yaml\`.
- Classify the request before EAI readiness. If it is EAI app delivery or ambiguous, continue directly to EAI readiness. If it is clearly non-app work, confirm once before skipping EAI tenant/app setup.
- Run \`eai whoami\` only for EAI app delivery work or explicit EAI CLI recovery. If \`eai\` is missing, login fails, the token is expired, or no active tenant is visible during app delivery, use the public \`eai\` entrypoint and the internal \`.specify/commands/gofer_eai_first_run.md\` setup contract before building.
- If CLI, login, tenant, template, or Gofer readiness is missing or stale during app delivery, use the public \`eai\` entrypoint and the internal first-run setup contract before building.
- Use \`eai update --check\`, \`eai --describe\`, \`eai agent guide --format json\`, \`eai template check --format json\`, \`eai gofer refresh --check --format json\`, and \`eai workflow readiness --format json\` when the CLI advertises them before assuming the repo is current.
- Do not invent, guess, or complete EAI CLI commands from memory. Verify exact \`eai ...\` syntax and flags with \`eai --describe\` and command-specific \`--help\` before suggesting or running them. If the installed CLI does not list a command, do not run it.
- After any \`eai\` command error, use \`eai errors explain <code-or-reason> --format json\` before guessing remediation.
- If \`eai errors explain\` is unavailable, match \`.specify/references/platform/eai-error-catalog.yaml\`, run read-only diagnostics before mutating fixes, and stop at the retry or escalation condition.
- For \`eai user invite\` 5xx or \`EXTERNAL_SERVICE_ERROR\`, check existing members with \`eai user list --tenant <tenant-id> --search <email> --format json\`; use \`eai user role set --tenant <tenant-id> --member-id <member-id> --role tenant-admin --format json\` only after verification and user approval, then tell the app user to sign out and sign back in.
- For \`MISSING_TENANT\`, \`app_token_tenant_context_required\`, or "Tenant context required for app tokens" on platform user lookup or membership prerequisites, run \`eai errors explain app_token_tenant_context_required --format json\`, confirm tenant context, and retry \`/v4/platform/tenants/<tenant-id>/...\` routes before changing tenant members, Entra, role definitions, databases, or cloud portals.
- Build on EAI Platform first and Azure second. Treat non-EAI runtimes as explicit exceptions only.
- Keep provisioning, types seed, schema/storage health, workflow readiness, and preview as separate gates.`;
}

function buildUserFacingResponseGateSection() {
  return `## User-Facing Response Gate

Before each user-facing reply, check the draft against these rules:

1. Lead with the business outcome, effect, risk, or decision.
2. Use concise, simple language.
3. Include technical detail only when it supports a decision or the user asks for it.
4. If any check fails, rewrite the reply before sending it.`;
}

function buildAlwaysOnEaiSection() {
  return `## Always-On EAI Contract
<!-- gofer:always-on-eai:start -->

Apply this contract to every request after Gofer is installed for this repo or AI coding app. The user does not need to type \`/eai\` or \`$eai\`.

1. Preserve the user's request. Do not rewrite it or add a visible command prefix.
2. Treat an explicit \`/eai\` in Claude, Copilot, Antigravity, Grok, or VS Code, and \`$eai\` in Codex, as an idempotent request for the same contract.
3. Apply Gofer's Controlled English and business-first response rules.
4. Select the internal pipeline stage. Do not make the user select a stage.
5. Check workspace health before meaningful repo work, tool use, or a pipeline stage. Do not repeat setup on every message.
6. When the user explicitly asks to update Gofer, use its maintenance contract only.
<!-- gofer:always-on-eai:end -->`;
}

export function buildAgentsMd(projectInfo, stages) {
  const corePipelineOrder = [
    '0_gofer_start',
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

${buildUserFacingResponseGateSection()}

${buildAlwaysOnEaiSection()}

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

This project uses Gofer for spec-driven development. Run \`/eai\` in Claude, Copilot, Antigravity, Grok, or VS Code, and \`$eai\` in Codex, to start or continue the core pipeline (Gofer Start -> research -> specify -> plan -> tasks -> implement -> validate). Gofer routes internally through \`.specify/commands/*.md\` contracts; validation is the terminal quality gate and includes the final engineering review loop. Before EAI readiness, classify the request: app delivery continues directly, while clear non-app work asks once before skipping EAI tenant/app setup. Artifacts in \`.specify/specs/{feature}/\`.

Each feature should carry a bounded loop contract:

- \`loop-contract.json\` defines the objective, evaluation commands, maximum
  loop count, stop conditions, and escalation rules.
- \`loop-ledger.jsonl\` records each implementation/validation check-repair
  iteration.
- \`loop-audit-report.md\` is produced by
  \`node .specify/scripts/node/gofer-loop-audit.mjs --feature-dir .specify/specs/{feature} --stage 6_validate --strict\`.

Implementation and validation must not finish if the loop audit reports
blocking findings.

${buildEaiRepoContractSection(projectInfo)}

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
`;
}

export function buildClaudeMd(projectInfo) {
  const eaiSection = buildEaiRepoContractSection(projectInfo);

  return `# CLAUDE.md

See @AGENTS.md for project conventions, commands, and code style.

${buildAlwaysOnEaiSection()}

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

Run \`/eai\` in Claude, Copilot, Antigravity, Grok, or VS Code, and \`$eai\` in Codex, to start or continue the core pipeline: Gofer Start -> research -> specify -> plan -> tasks -> implement -> validate. Gofer routes internally through \`.specify/commands/*.md\` contracts; validation is the terminal quality gate and includes the final engineering review loop. Before EAI readiness, classify the request: app delivery continues directly, while clear non-app work asks once before skipping EAI tenant/app setup. Artifacts go to \`.specify/specs/{feature}/\`.

For each active feature, keep \`loop-contract.json\`, \`loop-ledger.jsonl\`, and
\`loop-audit-report.md\` in the feature directory. The loop contract bounds
check-repair iterations, and validation must run
\`node .specify/scripts/node/gofer-loop-audit.mjs --feature-dir .specify/specs/{feature} --stage 6_validate --strict\`
before declaring the work complete.

${eaiSection}
`;
}

export function buildCopilotInstructions(projectInfo) {
  const frameworkBit = projectInfo.framework ? ` using ${projectInfo.framework}` : '';
  const eaiSection = buildEaiRepoContractSection(projectInfo);
  return `# Copilot Instructions

## Project Overview

**${projectInfo.name}** is a ${formatLanguage(projectInfo.language)} project${frameworkBit}.

${buildAlwaysOnEaiSection()}

## Gofer Pipeline

This project uses Gofer for spec-driven development. Run \`/eai\` to start or continue the core pipeline: Gofer Start -> research -> specify -> plan -> tasks -> implement -> validate.

Gofer routes internally through \`.specify/commands/*.md\` contracts; validation is the terminal quality gate and includes the final engineering review loop. Before EAI readiness, classify the request: app delivery continues directly, while clear non-app work asks once before skipping EAI tenant/app setup. Artifacts in \`.specify/specs/{feature}/\`.

${eaiSection}

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
  const target = await inspectWorkspacePath(workspaceRoot, GOFER_VERSION_FILE, {
    leafType: 'file',
    allowMissing: true,
  });
  if (!target.exists) {
    return null;
  }
  const content = await fs.readFile(target.path, 'utf8');
  return content.split('\n')[0]?.trim() || null;
}

async function collectMissingPaths(workspaceRoot, relativePaths) {
  const missing = [];
  for (const relativePath of relativePaths) {
    const target = await inspectWorkspacePath(workspaceRoot, relativePath, {
      leafType: 'any',
      allowMissing: true,
    });
    if (!target.exists) {
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
  await assertSafeWorkspaceRoot(workspaceRoot);
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

async function ensureDir(workspaceRoot, relativePath, dryRun) {
  await ensureSafeWorkspaceDirectory(workspaceRoot, relativePath, dryRun);
}

function sourceIdentityMatches(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.isFile() === right.isFile()
  );
}

async function readStableSourceFile(sourcePath) {
  const before = await fs.lstat(sourcePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error('Unsafe Gofer source path: copied entries must be regular files.');
  }

  const handle = await fs.open(sourcePath, 'r');
  try {
    const opened = await handle.stat();
    if (!sourceIdentityMatches(before, opened)) {
      throw new Error('Unsafe Gofer source path: a copied file changed during validation.');
    }
    const content = await handle.readFile();
    const after = await fs.lstat(sourcePath);
    if (!sourceIdentityMatches(opened, after)) {
      throw new Error('Unsafe Gofer source path: a copied file changed during validation.');
    }
    return { content, mode: opened.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

async function copyDirectory(sourcePath, workspaceRoot, targetRelativePath, dryRun) {
  const sourceStat = await lstatIfExists(sourcePath);
  if (!sourceStat) {
    return false;
  }
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    throw new Error('Unsafe Gofer source path: copied roots must be real directories.');
  }

  await ensureSafeWorkspaceDirectory(workspaceRoot, targetRelativePath, dryRun);
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    const sourceEntryPath = path.join(sourcePath, entry.name);
    const targetEntryRelativePath = path.join(targetRelativePath, entry.name);
    const entryStat = await fs.lstat(sourceEntryPath);
    if (entryStat.isSymbolicLink()) {
      throw new Error('Unsafe Gofer source path: symbolic links are not copied.');
    }
    if (entryStat.isDirectory()) {
      await copyDirectory(sourceEntryPath, workspaceRoot, targetEntryRelativePath, dryRun);
    } else if (entryStat.isFile()) {
      const sourceFile = await readStableSourceFile(sourceEntryPath);
      await writeWorkspaceFile(
        workspaceRoot,
        targetEntryRelativePath,
        sourceFile.content,
        dryRun,
        sourceFile.mode
      );
    } else {
      throw new Error(
        'Unsafe Gofer source path: only regular files and directories may be copied.'
      );
    }
  }
  return true;
}

async function writeFileIfMissing(workspaceRoot, relativePath, content, dryRun) {
  const target = await inspectWorkspacePath(workspaceRoot, relativePath, {
    leafType: 'file',
    allowMissing: true,
  });
  if (target.exists) {
    return false;
  }
  await writeWorkspaceFile(workspaceRoot, relativePath, content, dryRun);
  return true;
}

async function ensureAlwaysOnEaiSection(workspaceRoot, relativePath, fallbackContent, dryRun) {
  let existing = '';
  const target = await inspectWorkspacePath(workspaceRoot, relativePath, {
    leafType: 'file',
    allowMissing: true,
  });
  if (target.exists) {
    existing = await fs.readFile(target.path, 'utf8');
  }

  const section = buildAlwaysOnEaiSection();
  const markerPattern = /## Always-On EAI Contract\r?\n<!-- gofer:always-on-eai:start -->[\s\S]*?<!-- gofer:always-on-eai:end -->/;
  const legacySectionPattern = /## Always-On EAI Contract\r?\n[\s\S]*?(?=^##\s|(?![\s\S]))/m;
  const updated = existing
    ? markerPattern.test(existing)
      ? existing.replace(markerPattern, section)
      : legacySectionPattern.test(existing)
        ? existing.replace(legacySectionPattern, `${section}\n`)
        : `${existing.trimEnd()}\n\n${section}\n`
    : fallbackContent;

  if (updated === existing) {
    return false;
  }

  await writeTextFile(workspaceRoot, relativePath, updated, dryRun);
  return true;
}

function buildGeminiMd(projectInfo) {
  return `# GEMINI.md

See @AGENTS.md for project conventions, commands, and code style.

${buildAlwaysOnEaiSection()}

Use the internal Gofer pipeline to select the next stage. Keep the user-facing
conversation in business language.\n`;
}

async function writeTextFile(workspaceRoot, relativePath, content, dryRun) {
  await writeWorkspaceFile(workspaceRoot, relativePath, content, dryRun);
}

async function writeModelPolicyIfMissing(workspaceRoot, sourceRoot, dryRun) {
  const targetRelativePath = path.join('.specify', 'memory', 'gofer-model-policy.yaml');

  let template = '';
  try {
    template = await readSourceFile(
      sourceRoot,
      path.join('.specify', 'templates', 'gofer-model-policy.yaml')
    );
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  return writeFileIfMissing(workspaceRoot, targetRelativePath, template, dryRun);
}

async function mergeGitignore(workspaceRoot, dryRun) {
  const gitignoreRelativePath = '.gitignore';
  let existing = '';
  const gitignoreTarget = await inspectWorkspacePath(workspaceRoot, gitignoreRelativePath, {
    leafType: 'file',
    allowMissing: true,
  });
  if (gitignoreTarget.exists) {
    existing = await fs.readFile(gitignoreTarget.path, 'utf8');
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

  await writeTextFile(workspaceRoot, gitignoreRelativePath, updated, dryRun);
  return true;
}

function buildSpecifyReadme() {
  return `# Gofer - Specification Directory

This folder contains all project specifications for AI-driven feature development.

## Structure

- **memory/** - Constitution, decisions, and project principles
- **specs/** - Feature specifications (numbered: 001-feature-name/)
- **templates/** - Templates for specs, plans, and tasks
- **references/** - Public-safe EAI fallback references and recovery guides
- **scripts/** - Helper scripts for workflow automation
- **logs/** - Execution logs and support artifacts

## Quick Start

Run the unified Gofer pipeline with one public command:

\`\`\`
/eai Add user authentication with OAuth2 and JWT
\`\`\`

Use \`/eai\` in Claude, Copilot, Antigravity, Grok, or VS Code, and \`$eai\` in Codex. Gofer routes internally through \`.specify/commands/*.md\` contracts.

Artifacts are stored in \`.specify/specs/{feature}/\`.

Each feature should include a bounded loop contract:

- \`loop-contract.json\` - objective, maximum iterations, stop conditions, and
  evaluation commands.
- \`loop-ledger.jsonl\` - append-only check-repair evidence written during
  implementation and validation.
- \`loop-audit-report.md\` - generated by
  \`node .specify/scripts/node/gofer-loop-audit.mjs --feature-dir .specify/specs/{feature} --stage 6_validate --strict\`.

Each feature should also keep a running stakeholder review pack:

- \`working-backwards-prfaq.md\` - product release PR/FAQ that starts as a
  launch-day fiction and becomes evidence-backed across stages.
- \`prfaq-history/\` - immutable stage snapshots of the PR/FAQ.
- \`business-owner-summary.md\` - business scenario, process, value case,
  success metrics, and assumptions.
- \`cto-architecture-summary.md\` - EAI Platform/Azure architecture, auth,
  tenancy, data, integration, and platform-fit evidence.
- \`ciso-security-summary.md\` - security posture, controls, residual risks,
  and validation evidence.
- \`stakeholder-review-index.md\` - what is ready for review and who must
  approve, revise, or defer.

## Model Policy

Edit \`.specify/memory/gofer-model-policy.yaml\` to tune simple, medium, hard,
and arbiter model routes for Claude, Codex/OpenAI, Gemini, and Copilot. The
file is copied from \`.specify/templates/gofer-model-policy.yaml\` when missing
and is not overwritten by bootstrap.
`;
}

function getMirrorCopyCandidates() {
  return [
    { sourceRelativePath: 'commands', target: path.join('.claude', 'commands') },
    { sourceRelativePath: 'agents', target: path.join('.claude', 'agents') },
    {
      sourceRelativePath: path.join('.claude', 'skills'),
      target: path.join('.claude', 'skills'),
    },
    {
      sourceRelativePath: path.join('.github', 'agents'),
      target: path.join('.github', 'agents'),
    },
    {
      sourceRelativePath: path.join('.github', 'prompts'),
      target: path.join('.github', 'prompts'),
    },
    {
      sourceRelativePath: path.join('.github', 'instructions'),
      target: path.join('.github', 'instructions'),
    },
    {
      sourceRelativePath: path.join('.github', 'skills'),
      target: path.join('.github', 'skills'),
    },
    { sourceRelativePath: '.gemini', target: '.gemini' },
    { sourceRelativePath: path.join('.grok', 'skills'), target: path.join('.grok', 'skills') },
    { sourceRelativePath: path.join('.agents', 'skills'), target: path.join('.agents', 'skills') },
    { sourceRelativePath: path.join('.system', 'skills'), target: path.join('.system', 'skills') },
  ];
}

async function installClaudeHooksSettings(workspaceRoot, dryRun) {
  const settingsRelativePath = path.join('.claude', 'settings.json');
  let settings = {};
  const settingsTarget = await inspectWorkspacePath(workspaceRoot, settingsRelativePath, {
    leafType: 'file',
    allowMissing: true,
  });
  if (settingsTarget.exists) {
    try {
      settings = JSON.parse(await fs.readFile(settingsTarget.path, 'utf8'));
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
    }
  }

  settings.hooks = {
    ...(settings.hooks || {}),
    ...CLAUDE_HOOKS_CONFIG,
  };

  await writeTextFile(
    workspaceRoot,
    settingsRelativePath,
    `${JSON.stringify(settings, null, 2)}\n`,
    dryRun
  );
}

export async function bootstrapWorkspace({
  workspaceRoot,
  host = 'auto',
  sourceRoot,
  dryRun = false,
  includeMirrors = false,
}) {
  const normalizedHost = normalizeHost(host);
  await assertSafeWorkspaceRoot(workspaceRoot);
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
    await ensureDir(workspaceRoot, relativeDir, dryRun);
    changed.push(relativeDir);
  }

  const coreCopies = [
    path.join('.specify', 'commands'),
    path.join('.specify', 'config'),
    path.join('.specify', 'references'),
    path.join('.specify', 'schemas'),
    path.join('.specify', 'templates'),
    path.join('.specify', 'scripts', 'bash'),
    path.join('.specify', 'scripts', 'node'),
    path.join('.specify', 'scripts', 'hooks'),
    path.join('.specify', 'scripts', 'powershell'),
  ];
  for (const relativePath of coreCopies) {
    const copied = await copyDirectory(
      await resolveSourcePath(sourceRoot, relativePath),
      workspaceRoot,
      relativePath,
      dryRun
    );
    if (copied) {
      changed.push(relativePath);
    }
  }

  if (await writeModelPolicyIfMissing(workspaceRoot, sourceRoot, dryRun)) {
    changed.push(path.join('.specify', 'memory', 'gofer-model-policy.yaml'));
  }

  await writeTextFile(workspaceRoot, GOFER_VERSION_FILE, `${version}\n`, dryRun);
  changed.push(GOFER_VERSION_FILE);

  if (
    await writeFileIfMissing(
      workspaceRoot,
      path.join('.specify', 'README.md'),
      buildSpecifyReadme(),
      dryRun
    )
  ) {
    changed.push(path.join('.specify', 'README.md'));
  }

  if (
    await ensureAlwaysOnEaiSection(
      workspaceRoot,
      'AGENTS.md',
      buildAgentsMd(projectInfo, stages),
      dryRun
    )
  ) {
    changed.push('AGENTS.md');
  }

  if (
    await ensureAlwaysOnEaiSection(
      workspaceRoot,
      'CLAUDE.md',
      buildClaudeMd(projectInfo),
      dryRun
    )
  ) {
    changed.push('CLAUDE.md');
  }

  if (
    await ensureAlwaysOnEaiSection(
      workspaceRoot,
      path.join('.github', 'copilot-instructions.md'),
      buildCopilotInstructions(projectInfo),
      dryRun
    )
  ) {
    changed.push(path.join('.github', 'copilot-instructions.md'));
  }

  if (
    await ensureAlwaysOnEaiSection(
      workspaceRoot,
      'GEMINI.md',
      buildGeminiMd(projectInfo),
      dryRun
    )
  ) {
    changed.push('GEMINI.md');
  }

  if (normalizedHost === 'claude') {
    await installClaudeHooksSettings(workspaceRoot, dryRun);
    changed.push(path.join('.claude', 'settings.json'));
  }

  if (includeMirrors) {
    for (const candidate of getMirrorCopyCandidates(sourceRoot)) {
      const copied = await copyDirectory(
        await resolveSourcePath(sourceRoot, candidate.sourceRelativePath),
        workspaceRoot,
        candidate.target,
        dryRun
      );
      if (copied) {
        changed.push(candidate.target);
      }
    }
  }

  const archivedLegacyPaths = await removeLegacyManagedPaths(workspaceRoot, dryRun, stages);
  changed.push(
    ...archivedLegacyPaths.map(
      ({ relativePath, archivePath }) => `${relativePath} (archived legacy to ${archivePath})`
    )
  );

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
