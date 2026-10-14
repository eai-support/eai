// Shared installed npm and private configuration policy for owned qualification builds.
const fs = require('node:fs');
const { delimiter, dirname, isAbsolute, join, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { operationalEnvironment } = require('./cli-qa-operational-env.cjs');
const CANONICAL_EXECUTION = 'eai.cli-canonical-npm-execution.v1';
const HASH = /^[a-f0-9]{64}$/;
const TEMPLATE_REGISTRY = 'https://enterpriseaigroup.github.io/enterpriseai-packages/registry';
let installedNpmCache;
function toolStamp(path) {
  const stat = fs.statSync(path, { bigint: true });
  requireCondition(stat.isFile(), 'CANONICAL_NPM_UNVERIFIED');
  return [path, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
function requireCondition(condition, code) { if (!condition) { const error = new Error('Owned npm execution failed: ' + code + '.'); error.code = code; throw error; } }
/** Admit only the pinned template registry and harmless installation pins. */
function projectConfigPins(path) {
  const descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096) return null;
    const lines = fs.readFileSync(descriptor, 'utf8').split(/\r?\n/).map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && !line.startsWith(';'));
    const seen = new Set();
    const registry = `@enterpriseaigroup:registry=${TEMPLATE_REGISTRY}`;
    const allowed = lines.every(line => {
      const match = /^(save-exact|package-lock)\s*=\s*true$/.exec(line);
      if (match) {
        if (seen.has(match[1])) return false;
        seen.add(match[1]); return true;
      }
      if (line !== registry || seen.has('@enterpriseaigroup:registry')) return false;
      seen.add('@enterpriseaigroup:registry'); return true;
    });
    if (!allowed) return null;
    return seen.has('@enterpriseaigroup:registry') ? 'pinned-template-registry' : 'installation-pins-only';
  } finally { fs.closeSync(descriptor); }
}
/** Select npm beside the active Node installation, independently of PATH. Trusted installation/scripts are not sandboxed. */
function canonicalBuildExecution() {
  const nodePath = fs.realpathSync(process.execPath);
  const possible = [resolve(dirname(nodePath), '../lib/node_modules/npm/bin/npm-cli.js'),
    join(dirname(nodePath), 'node_modules/npm/bin/npm-cli.js')];
  const selected = possible.find(path => fs.existsSync(path));
  requireCondition(selected, 'CANONICAL_NPM_UNVERIFIED');
  const npmCliPath = fs.realpathSync(selected);
  const packagePath = join(dirname(npmCliPath), '..', 'package.json');
  const key = [nodePath, npmCliPath, packagePath].map(toolStamp).join('|');
  // Cache only an unchanged installed identity within this trusted invocation, never an imported claim.
  if (installedNpmCache?.key === key) return structuredClone(installedNpmCache.value);
  const npmVersion = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
  requireCondition(typeof npmVersion === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(npmVersion), 'CANONICAL_NPM_UNVERIFIED');
  const value = { schemaVersion: CANONICAL_EXECUTION, selection: 'node-installation', nodePath, npmCliPath,
    nodeVersion: process.version, npmVersion, nodeSha256: createHash('sha256').update(fs.readFileSync(nodePath)).digest('hex'),
    npmCliSha256: createHash('sha256').update(fs.readFileSync(npmCliPath)).digest('hex'),
    argv: [nodePath, npmCliPath, 'run', 'build'] };
  requireCondition([nodePath, npmCliPath, packagePath].map(toolStamp).join('|') === key, 'CANONICAL_NPM_UNVERIFIED');
  installedNpmCache = { key, value }; return structuredClone(value);
}
function canonicalExecutionVerified(record, nodeVersion, script = 'build') {
  const valid = record && typeof record === 'object' && !Array.isArray(record)
    && record.schemaVersion === CANONICAL_EXECUTION && record.selection === 'node-installation'
    && typeof record.nodeVersion === 'string' && /^v[0-9]+\.[0-9]+\.[0-9]+$/.test(record.nodeVersion)
    && record.nodeVersion === nodeVersion && record.executablesUnchanged === true && record.exitCode === 0
    && ['nodePath', 'npmCliPath'].every(field => typeof record[field] === 'string' && record[field].length <= 4096 && isAbsolute(record[field]))
    && ['nodeSha256', 'npmCliSha256'].every(field => typeof record[field] === 'string' && HASH.test(record[field]))
    && Array.isArray(record.argv) && record.argv.length === 4
    && [record.nodePath, record.npmCliPath, 'run', script].every((value, index) => record.argv[index] === value);
  if (!valid) return false;
  try {
    const installed = canonicalBuildExecution();
    return ['nodePath', 'npmCliPath', 'nodeVersion', 'npmVersion', 'nodeSha256', 'npmCliSha256']
      .every(field => record[field] === installed[field]);
  } catch { return false; }
}

/** Empty user/global configs and approved project settings are shared across owned builds. */
function withNpmConfiguration(cwd, parent, environment, action) {
  const state = require('./cli-qa-foundation.cjs');
  let project;
  try { project = fs.lstatSync(join(cwd, '.npmrc')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const projectPolicy = project ? projectConfigPins(join(cwd, '.npmrc')) : 'absent';
  requireCondition(projectPolicy !== null, 'NPM_PROJECT_CONFIG_UNSUPPORTED');
  const configRoot = fs.mkdtempSync(join(fs.realpathSync(parent), '.eai-npm-config-'));
  const parents = state.privateDirectory(configRoot);
  const nodePath = fs.realpathSync(process.execPath);
  try {
    const user = join(configRoot, 'user.npmrc'), global = join(configRoot, 'global.npmrc');
    state.writePrivateText(user, ''); state.writePrivateText(global, '');
    const env = { ...environment, PATH: dirname(nodePath) + delimiter + (environment.PATH || environment.Path || ''),
      npm_config_userconfig: user, npm_config_globalconfig: global, npm_config_ignore_scripts: 'false',
      npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' };
    delete env.Path;
    return { value: action(env), npmConfiguration: { user: 'empty-private', global: 'empty-private',
      project: projectPolicy, lifecycleNode: 'active-node-bin-first' } };
  } finally { state.assertPrivateDirectory(parents); fs.rmSync(configRoot, { recursive: true }); }
}
/** Execute only an owning app script through the active installed Node/npm pair. */
function runNpmScript(options, dependencies = {}) {
  requireCondition(['build', 'build:object-types', 'check:object-types'].includes(options.script), 'APP_SCRIPT_UNSUPPORTED');
  const selected = canonicalBuildExecution(); selected.argv[3] = options.script;
  const keys = new Set(['EAI_PROFILE', 'BASE_URL_PUBLIC_API', 'EAI_TENANT_ID', 'EAI_PARENT_TENANT_ID', 'EAI_APP_KEY',
    'EAI_OBJECT_TYPES_INPUT_PATH', 'EAI_OBJECT_TYPES_OUTPUT_PATH', 'EAI_OBJECT_TYPES_PROVISIONING_OUTPUT_PATH']);
  const context = Object.fromEntries(Object.entries(options.context || {}).filter(([key, value]) => keys.has(key) && typeof value === 'string'));
  const execute = dependencies.execute || ((file, args, settings) => require('node:child_process').spawnSync(file, args,
    { ...settings, encoding: 'utf8', shell: false, maxBuffer: 8 * 1024 * 1024 }));
  const built = withNpmConfiguration(options.cwd, options.configParent || require('node:os').tmpdir(),
    { ...operationalEnvironment(options.env || process.env), ...context }, env => execute(selected.nodePath,
      [selected.npmCliPath, 'run', options.script], { cwd: options.cwd, env, timeout: options.timeout || 600000 }));
  const observed = canonicalBuildExecution(); observed.argv[3] = options.script;
  const result = built.value;
  const canonicalExecution = { ...selected, exitCode: Number.isInteger(result?.status) ? result.status : null,
    executablesUnchanged: JSON.stringify(observed) === JSON.stringify(selected) };
  requireCondition(canonicalExecution.executablesUnchanged, 'CANONICAL_NPM_UNVERIFIED');
  return { result, npmExecution: { schemaVersion: 'eai.cli-app-npm-execution.v1', script: options.script,
    qualification: dependencies.execute ? 'controlled-fixtures' : 'normal-execution',
    canonicalExecution, npmConfiguration: built.npmConfiguration } };
}
function appNpmExecutionVerified(value, script) {
  return value && typeof value === 'object' && !Array.isArray(value) && value.schemaVersion === 'eai.cli-app-npm-execution.v1'
    && value.qualification === 'normal-execution' && value.script === script
    && canonicalExecutionVerified(value.canonicalExecution, value.canonicalExecution?.nodeVersion, script)
    && npmConfigurationVerified(value.npmConfiguration);
}
function npmConfigurationVerified(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && value.user === 'empty-private' && value.global === 'empty-private'
    && ['absent', 'installation-pins-only', 'pinned-template-registry'].includes(value.project)
    && value.lifecycleNode === 'active-node-bin-first';
}
if (require.main === module) {
  try {
    requireCondition(process.argv.length === 3, 'EXPLICIT_APP_PATH_REQUIRED');
    const output = runNpmScript({ cwd: resolve(process.argv[2]), script: 'build' });
    process.stdout.write(output.result.stdout || ''); process.stderr.write(output.result.stderr || '');
    process.exitCode = output.result.status ?? 1;
  } catch (error) { console.error('Owned npm build failed: ' + (error.code || 'BUILD_UNVERIFIED') + '.'); process.exitCode = 1; }
}
module.exports = { projectConfigPins, canonicalBuildExecution, canonicalExecutionVerified, withNpmConfiguration,
  runNpmScript, appNpmExecutionVerified, npmConfigurationVerified };
