#!/usr/bin/env node
// Explicit local build proof; controlled dependencies never produce live qualification.
const fs = require('node:fs');
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const smoke = require('./eai-full-e2e-smoke.cjs');
const { installedGitExecution } = require('./cli-qa-operational-env.cjs');

const ROOT = resolve(__dirname, '..');
const SCHEMA = 'eai.cli-source-build.v1';
const SOURCE_FINGERPRINT = 'eai.cli-tracked-source-sha256.v1';
const COMMAND = ['npm', 'run', 'build'];
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
const NODE = /^v24\.[0-9]+\.[0-9]+$/;
const CANDIDATE_FIELDS = ['gitSha', 'binarySha256', 'runtimeSha256', 'runtimeFileCount', 'version', 'dirty'];
const { canonicalBuildExecution, canonicalExecutionVerified, withNpmConfiguration, npmConfigurationVerified } = require('./cli-qa-npm-execution.cjs');

function requireCondition(condition, code) {
  if (!condition) { const error = new Error('CLI source build receipt failed: ' + code + '.'); error.code = code; throw error; }
}
// Resolve lazily: the foundation may itself import this verifier.
function privateState() { return require('./cli-qa-foundation.cjs'); }
function execute(command, args, options) {
  return spawnSync(command, args, { ...options, encoding: 'utf8', shell: false, maxBuffer: 8 * 1024 * 1024 });
}
function within(root, path) {
  const local = relative(root, path);
  return local === '' || (!local.startsWith('..' + sep) && local !== '..' && !isAbsolute(local));
}
function unlinkedPath(path) {
  let current = resolve(path);
  while (true) {
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    requireCondition(!stat?.isSymbolicLink(), 'LINKED_PATH');
    if (dirname(current) === current) break;
    current = dirname(current);
  }
}
function git(root, run, args, code) {
  const result = run('git', args, { cwd: root, timeout: 10000 });
  requireCondition(result?.status === 0 && !result.error && !result.signal && typeof result.stdout === 'string', code);
  return result.stdout;
}
function sourceSnapshot(root, run) {
  requireCondition(fs.realpathSync(git(root, run, ['rev-parse', '--show-toplevel'], 'GIT_ROOT_UNVERIFIED').trim()) === root,
    'GIT_ROOT_MISMATCH');
  const sourceSha = git(root, run, ['rev-parse', '--verify', 'HEAD'], 'SOURCE_HEAD_UNVERIFIED').trim();
  requireCondition(SHA.test(sourceSha), 'SOURCE_HEAD_UNVERIFIED');
  requireCondition(git(root, run, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'SOURCE_STATUS_UNVERIFIED') === '',
    'SOURCE_DIRTY');
  const records = git(root, run, ['ls-files', '--stage', '-z'], 'SOURCE_INVENTORY_UNVERIFIED').split('\0').filter(Boolean);
  requireCondition(records.length > 0, 'SOURCE_INVENTORY_EMPTY');
  const files = records.map(record => {
    const match = /^(100644|100755) ([a-f0-9]{40}) 0\t(.+)$/.exec(record);
    requireCondition(match && !match[3].includes('\\') && !match[3].startsWith('/')
      && match[3].split('/').every(segment => segment && segment !== '.' && segment !== '..'), 'SOURCE_FILE_UNSUPPORTED');
    return { mode: match[1], name: match[3] };
  }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  requireCondition(new Set(files.map(file => file.name)).size === files.length, 'SOURCE_INVENTORY_DUPLICATE');
  const hash = createHash('sha256'); hash.update(SOURCE_FINGERPRINT + '\n');
  for (const file of files) {
    const path = resolve(root, file.name); requireCondition(within(root, path), 'SOURCE_FILE_UNSUPPORTED');
    unlinkedPath(path);
    const descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(descriptor);
      requireCondition(stat.isFile() && stat.nlink === 1, 'SOURCE_FILE_UNSUPPORTED');
      const bytes = fs.readFileSync(descriptor);
      hash.update(file.mode + ':' + Buffer.byteLength(file.name) + ':' + file.name + ':' + bytes.length + ':'); hash.update(bytes);
    } finally { fs.closeSync(descriptor); }
  }
  return { sourceSha, sourceSha256: hash.digest('hex'), sourceFileCount: files.length, sourceFingerprintVersion: SOURCE_FINGERPRINT };
}
function candidateValid(candidate) {
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate) && typeof candidate.gitSha === 'string' && SHA.test(candidate.gitSha)
    && ['binarySha256', 'runtimeSha256'].every(field => typeof candidate[field] === 'string' && HASH.test(candidate[field]))
    && Number.isSafeInteger(candidate.runtimeFileCount) && candidate.runtimeFileCount > 0
    && typeof candidate.version === 'string' && candidate.version.length <= 100 && VERSION.test(candidate.version) && candidate.dirty === false;
}
/** Every qualification receipt must identify the whole clean CLI candidate. */
function candidateMatches(left, right) {
  return Boolean(candidateValid(left) && candidateValid(right)
    && CANDIDATE_FIELDS.every(field => left[field] === right[field]));
}
function sameSource(left, right) {
  return left.sourceSha === right.sourceSha && left.sourceSha256 === right.sourceSha256 && left.sourceFileCount === right.sourceFileCount;
}
function sourceBuildVerified(receipt, candidate, { now = Date.now() } = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || !candidateValid(candidate)
    || receipt.schemaVersion !== SCHEMA || receipt.qualification !== 'normal-build' || receipt.qualified !== true
    || receipt.status !== 'passed' || receipt.sourceUnchanged !== true || receipt.exitCode !== 0
    || typeof receipt.nodeVersion !== 'string' || !NODE.test(receipt.nodeVersion)
    || !canonicalExecutionVerified(receipt.canonicalExecution, receipt.nodeVersion) || !npmConfigurationVerified(receipt.npmConfiguration)
    || !gitExecutionVerified(receipt.gitExecution)
    || receipt.sourceFingerprintVersion !== SOURCE_FINGERPRINT || typeof receipt.sourceSha256 !== 'string' || !HASH.test(receipt.sourceSha256)
    || !Number.isSafeInteger(receipt.sourceFileCount) || receipt.sourceFileCount <= 0 || receipt.sourceSha !== candidate.gitSha
    || !Array.isArray(receipt.command) || receipt.command.length !== COMMAND.length || !COMMAND.every((part, index) => receipt.command[index] === part)
    || !candidateMatches(receipt.candidate, candidate)
    || typeof receipt.observedAt !== 'string' || !Number.isFinite(now)) return false;
  const age = now - Date.parse(receipt.observedAt);
  return Number.isFinite(age) && age >= -60000 && age <= 3600000;
}

/** Legacy PATH-selected Git observations do not establish the normal source identity. */
function gitExecutionVerified(record) {
  const required = [['rev-parse', '--show-toplevel'], ['rev-parse', '--verify', 'HEAD'],
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'], ['ls-files', '--stage', '-z']];
  return record && typeof record === 'object' && !Array.isArray(record)
    && record.schemaVersion === 'eai.cli-installed-git-execution.v1' && record.selection === 'conventional-installation'
    && typeof record.gitPath === 'string' && record.gitPath.length <= 4096 && isAbsolute(record.gitPath)
    && typeof record.gitSha256 === 'string' && HASH.test(record.gitSha256)
    && typeof record.gitVersion === 'string' && /^git version [^\r\n]{1,100}$/.test(record.gitVersion)
    && record.executablesUnchanged === true && Array.isArray(record.invocations) && record.invocations.length <= 32
    && record.invocations.every(argv => Array.isArray(argv) && argv.length >= 2 && argv.length <= 9
      && argv[0] === record.gitPath && argv.every(value => typeof value === 'string' && value.length <= 4096))
    && required.every(args => record.invocations.some(argv => argv.length === args.length + 1
      && args.every((value, index) => argv[index + 1] === value)));
}

/** Run only the canonical build in this checkout and retain a private source/artifact join. */
function runBuildReceipt(options, dependencies = {}) {
  const state = privateState(), executor = dependencies.execute || execute, now = dependencies.now || Date.now;
  const operational = state.operationalEnvironment(process.env);
  const qualification = Object.keys(dependencies).length ? 'controlled-fixtures' : 'normal-build';
  const selectedGit = qualification === 'normal-build' ? installedGitExecution() : null, gitInvocations = [];
  const run = (command, args, settings) => {
    const executable = command === 'git' && selectedGit ? selectedGit.gitPath : command;
    if (command === 'git' && selectedGit) gitInvocations.push([executable, ...args]);
    return executor(executable, args, { ...settings, env: settings.env || operational });
  };
  const root = fs.realpathSync(dependencies.root || ROOT), cliPath = resolve(options.cliPath || ''), output = resolve(options.output || '');
  const receipt = { schemaVersion: SCHEMA, qualification, qualified: false, status: 'running', command: [...COMMAND],
    exitCode: null, sourceUnchanged: false, nodeVersion: dependencies.nodeVersion || process.version,
    startedAt: new Date(now()).toISOString(), observedAt: new Date(now()).toISOString(), candidate: null };
  requireCondition(options.cliPath && options.output, 'EXPLICIT_PATHS_REQUIRED');
  unlinkedPath(root); unlinkedPath(output);
  requireCondition(!within(join(root, 'dist'), output) && !within(join(root, 'resources'), output)
    && output !== join(root, 'package.json'), 'OUTPUT_INSIDE_RUNTIME');
  if (within(root, output)) {
    const ignored = run('git', ['check-ignore', '--quiet', '--', relative(root, output)], { cwd: root, timeout: 10000 });
    requireCondition(ignored?.status === 0 && !ignored.error && !ignored.signal, 'OUTPUT_NOT_IGNORED');
  }
  let existing;
  try { fs.lstatSync(output); existing = state.readPrivate(output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  requireCondition(!existing || existing.schemaVersion === SCHEMA, 'OUTPUT_NOT_BUILD_RECEIPT');
  return state.withLease(output, () => {
    const save = () => state.writePrivate(output, receipt);
    // Remove any previous successful evidence before preflight or compilation can fail.
    save();
    try {
      requireCondition(typeof receipt.nodeVersion === 'string' && NODE.test(receipt.nodeVersion), 'NODE_24_REQUIRED');
      requireCondition(cliPath === join(root, 'dist', 'index.js'), 'EXACT_CLI_PATH_REQUIRED'); unlinkedPath(cliPath);
      const before = sourceSnapshot(root, run); Object.assign(receipt, before); save();
      const selectedExecution = qualification === 'normal-build' ? canonicalBuildExecution() : null;
      const configured = withNpmConfiguration(root, dirname(output), operational, env =>
        run(selectedExecution ? selectedExecution.nodePath : COMMAND[0],
          selectedExecution ? [selectedExecution.npmCliPath, ...COMMAND.slice(1)] : COMMAND.slice(1),
          { cwd: root, timeout: 300000, env }));
      const build = configured.value;
      receipt.npmConfiguration = configured.npmConfiguration;
      receipt.exitCode = Number.isInteger(build?.status) ? build.status : null;
      if (selectedExecution) {
        const observedExecution = canonicalBuildExecution();
        receipt.canonicalExecution = { ...selectedExecution, exitCode: receipt.exitCode,
          executablesUnchanged: JSON.stringify(observedExecution) === JSON.stringify(selectedExecution) };
        requireCondition(receipt.canonicalExecution.executablesUnchanged, 'CANONICAL_NPM_UNVERIFIED');
      }
      requireCondition(build?.status === 0 && !build.error && !build.signal, 'BUILD_FAILED');
      const after = sourceSnapshot(root, run); requireCondition(sameSource(before, after), 'SOURCE_CHANGED_DURING_BUILD');
      unlinkedPath(cliPath);
      const candidate = (dependencies.candidateEvidence || smoke.candidateEvidence)(cliPath);
      requireCondition(candidateValid(candidate) && candidate.gitSha === before.sourceSha, 'BUILT_CANDIDATE_UNVERIFIED');
      const final = sourceSnapshot(root, run); requireCondition(sameSource(before, final), 'SOURCE_CHANGED_DURING_MEASUREMENT');
      if (selectedGit) {
        receipt.gitExecution = { ...selectedGit, invocations: gitInvocations,
          executablesUnchanged: JSON.stringify(installedGitExecution()) === JSON.stringify(selectedGit) };
        requireCondition(gitExecutionVerified(receipt.gitExecution), 'CANONICAL_GIT_UNVERIFIED');
      }
      receipt.candidate = Object.fromEntries(CANDIDATE_FIELDS.map(field => [field, candidate[field]]));
      receipt.sourceUnchanged = true; receipt.status = 'passed'; receipt.observedAt = new Date(now()).toISOString();
      receipt.qualified = qualification === 'normal-build'; save(); return receipt;
    } catch (error) {
      receipt.qualified = false; receipt.status = 'failed'; receipt.sourceUnchanged = false;
      receipt.failureCode = ['NODE_24_REQUIRED', 'EXACT_CLI_PATH_REQUIRED', 'GIT_ROOT_UNVERIFIED', 'GIT_ROOT_MISMATCH',
        'SOURCE_HEAD_UNVERIFIED', 'SOURCE_STATUS_UNVERIFIED', 'SOURCE_DIRTY', 'SOURCE_INVENTORY_UNVERIFIED', 'SOURCE_INVENTORY_EMPTY',
        'SOURCE_FILE_UNSUPPORTED', 'SOURCE_INVENTORY_DUPLICATE', 'LINKED_PATH', 'BUILD_FAILED', 'SOURCE_CHANGED_DURING_BUILD',
        'BUILT_CANDIDATE_UNVERIFIED', 'SOURCE_CHANGED_DURING_MEASUREMENT', 'NPM_PROJECT_CONFIG_UNSUPPORTED',
        'CANONICAL_NPM_UNVERIFIED', 'CANONICAL_GIT_UNVERIFIED'].includes(error.code) ? error.code : 'BUILD_RECEIPT_UNVERIFIED';
      receipt.observedAt = new Date(now()).toISOString(); save();
      const failure = new Error('CLI source build receipt failed: ' + receipt.failureCode + '.'); failure.receipt = receipt; throw failure;
    }
  });
}
function main() {
  const args = process.argv.slice(2);
  requireCondition(args.length === 4 && [args[0], args[2]].every(value => ['--cli', '--output'].includes(value))
    && args[0] !== args[2] && !args[1].startsWith('--') && !args[3].startsWith('--'),
    'EXPLICIT_PATHS_REQUIRED');
  const argument = name => args[args.indexOf(name) + 1];
  const receipt = runBuildReceipt({ cliPath: argument('--cli'), output: argument('--output') });
  console.log(JSON.stringify({ schemaVersion: receipt.schemaVersion, qualification: receipt.qualification, qualified: receipt.qualified,
    sourceSha: receipt.sourceSha, runtimeSha256: receipt.candidate.runtimeSha256, observedAt: receipt.observedAt }));
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { SCHEMA, SOURCE_FINGERPRINT, runBuildReceipt, sourceBuildVerified, candidateValid, candidateMatches, canonicalBuildExecution, gitExecutionVerified };
