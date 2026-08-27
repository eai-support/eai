#!/usr/bin/env node

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cliPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const normalizedMappings = [
  ['config', '.specify/config'],
  ['contracts', '.specify/contracts'],
  ['commands', '.specify/commands'],
  ['references', '.specify/references'],
  ['schemas', '.specify/schemas'],
  ['system-skills', '.system/skills'],
  ['agents-skills', '.agents/skills'],
];
const requiredDirectories = [
  'config',
  'contracts',
  'commands',
  'templates',
  'references',
  'schemas',
  'bash-scripts',
  'powershell-scripts',
  'node-scripts',
  'hook-scripts',
  'claude-commands',
  'claude-agents',
  'copilot-prompts',
  'copilot-instructions',
  'system-skills',
  'agents-skills',
  'gemini',
];
const publicSurfaceFiles = [
  '.claude/commands/eai.md',
  '.claude/skills/eai/SKILL.md',
  '.agents/skills/eai/SKILL.md',
  '.system/skills/eai/SKILL.md',
  '.github/prompts/eai.prompt.md',
  '.github/skills/eai/SKILL.md',
  '.github/copilot-instructions.md',
  '.gemini/extension.json',
  '.gemini/commands/gofer/eai.md',
  '.gemini/commands/gofer/eai.toml',
  '.gemini/commands/gofer/manifest.json',
  '.grok/skills/eai/SKILL.md',
  '.vscode/settings.json',
];
const staleVisibleSurfaceFiles = [
  '.claude/commands/gofer.md',
  '.claude/commands/0_gofer_start.md',
  '.agents/skills/gofer/SKILL.md',
  '.agents/skills/0_gofer_start/SKILL.md',
  '.system/skills/0_gofer_start/SKILL.md',
  '.github/prompts/gofer.prompt.md',
  '.github/prompts/0_gofer_start.prompt.md',
  '.github/skills/0-gofer-start/SKILL.md',
  '.gemini/commands/gofer/gofer.toml',
  '.gemini/commands/gofer/0_gofer_start.toml',
  '.grok/skills/gofer/SKILL.md',
  '.grok/skills/0_gofer_start/SKILL.md',
];
const internalCommandFiles = [
  '0_gofer_start',
  '0a_problem_validation',
  '1_gofer_research',
  '2_gofer_specify',
  '3_gofer_plan',
  '4_gofer_tasks',
  '5_gofer_implement',
  '6_gofer_validate',
  '7_gofer_save',
  '7a_stakeholder_comms',
  '8_gofer_branding',
  '9_gofer_tests',
  '10_gofer_cloud',
  'gofer_bootstrap_workspace',
  'gofer_check_workspace',
  'gofer_eai_first_run',
];

function fail(message, result) {
  console.error(`Gofer refresh cache smoke failed: ${message}`);
  if (result?.stdout) console.error(result.stdout.trim());
  if (result?.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

if (!cliPath || !fs.existsSync(cliPath)) {
  fail('pass the installed eai executable as the first argument');
}

function runCli(args, options = {}) {
  const isJavaScriptEntry = path.extname(cliPath) === '.js';
  return spawnSync(
    isJavaScriptEntry ? process.execPath : cliPath,
    isJavaScriptEntry ? [cliPath, ...args] : args,
    options,
  );
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'eai-gofer-cache-smoke-'));
try {
  const projectRoot = path.join(workspace, 'project');
  const cacheRoot = path.join(workspace, 'cache');
  const version = '99.0.1';
  const versionRoot = path.join(cacheRoot, `v${version}`);
  const checkoutRoot = path.join(versionRoot, 'repo');
  const baseResources = path.join(checkoutRoot, 'extension', 'resources');
  const resourcesRoot = path.join(versionRoot, 'resources');
  const bundledResources = path.join(root, 'resources', 'gofer');

  fs.mkdirSync(path.join(projectRoot, 'src', 'eai.config'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'src', 'eai.config', 'object-types.ts'),
    'export const objectTypes = {};\n',
  );
  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    `${JSON.stringify({
      name: '@eai-tools/release-gofer-refresh-smoke',
      version: '0.0.1',
      private: true,
      dependencies: { '@eai-tools/core': '1.0.0' },
    }, null, 2)}\n`,
  );

  fs.cpSync(bundledResources, baseResources, { recursive: true });
  for (const [normalizedDirectory, canonicalDirectory] of normalizedMappings) {
    const source = path.join(baseResources, normalizedDirectory);
    const target = path.join(checkoutRoot, canonicalDirectory);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
    fs.rmSync(source, { recursive: true, force: true });
  }

  execFileSync('git', ['init', '--quiet'], { cwd: checkoutRoot });
  execFileSync('git', ['add', '.'], { cwd: checkoutRoot });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=EAI Release Smoke',
      '-c',
      'user.email=eai-release-smoke@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    { cwd: checkoutRoot },
  );
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: checkoutRoot,
    encoding: 'utf-8',
  }).trim();

  // Reproduce the broken state: the marker matches, but normalized aliases are absent.
  fs.cpSync(baseResources, resourcesRoot, { recursive: true });
  fs.writeFileSync(
    path.join(resourcesRoot, '.gofer-version'),
    `${JSON.stringify({ commit, describe: `v${version}` }, null, 2)}\n`,
  );

  const installedVersion = runCli(['--version'], { encoding: 'utf-8' });
  if (installedVersion.status !== 0) {
    fail('packed CLI could not report its version', installedVersion);
  }
  const updatePackumentUrl =
    `data:application/json,${encodeURIComponent(JSON.stringify({
      'dist-tags': { latest: installedVersion.stdout.trim() },
    }))}`;
  const goferManifestUrl =
    `data:application/json,${encodeURIComponent(JSON.stringify({ version }))}`;

  const result = runCli(['update'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    timeout: 30_000,
    env: {
      ...process.env,
      CI: '1',
      HOME: workspace,
      USERPROFILE: workspace,
      NO_COLOR: '1',
      EAI_UPDATE_NPMJS_PACKUMENT_URL: updatePackumentUrl,
      EAI_UPDATE_PACKUMENT_URL: updatePackumentUrl,
      EAI_GOFER_REFRESH_SOURCE: 'latest',
      EAI_GOFER_REFRESH_CACHE_DIR: cacheRoot,
      EAI_GOFER_REFRESH_MANIFEST_URL: goferManifestUrl,
    },
  });
  if (result.status !== 0) {
    fail(`eai update exited ${result.status ?? 'without a status'}`, result);
  }
  if (!result.stdout.includes('Gofer-managed assets refreshed')) {
    fail('eai update did not complete project maintenance', result);
  }

  for (const directory of requiredDirectories) {
    if (!fs.statSync(path.join(resourcesRoot, directory), { throwIfNoEntry: false })?.isDirectory()) {
      fail(`repaired cache is missing ${directory}`);
    }
  }
  if (!fs.existsSync(path.join(projectRoot, '.specify', 'config', 'object-type-routing.json'))) {
    fail('eai update did not install normalized Gofer config into the project');
  }
  for (const relativePath of publicSurfaceFiles) {
    if (!fs.existsSync(path.join(projectRoot, relativePath))) {
      fail(`eai update did not install public Gofer surface: ${relativePath}`);
    }
  }
  for (const relativePath of staleVisibleSurfaceFiles) {
    if (fs.existsSync(path.join(projectRoot, relativePath))) {
      fail(`eai update left stale visible Gofer surface: ${relativePath}`);
    }
  }
  for (const command of internalCommandFiles) {
    if (!fs.existsSync(path.join(projectRoot, '.specify', 'commands', `${command}.md`))) {
      fail(`eai update did not install internal Gofer command: ${command}`);
    }
  }
  const claudeCommands = fs.readdirSync(path.join(projectRoot, '.claude', 'commands')).sort();
  if (JSON.stringify(claudeCommands) !== JSON.stringify(['eai.md'])) {
    fail(`Claude visible commands are not clean: ${claudeCommands.join(', ')}`);
  }
  const geminiCommands = fs.readdirSync(path.join(projectRoot, '.gemini', 'commands', 'gofer')).sort();
  if (JSON.stringify(geminiCommands) !== JSON.stringify(['eai.md', 'eai.toml', 'manifest.json'])) {
    fail(`Gemini visible commands are not clean: ${geminiCommands.join(', ')}`);
  }

  console.log('Gofer refresh cache smoke passed');
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
