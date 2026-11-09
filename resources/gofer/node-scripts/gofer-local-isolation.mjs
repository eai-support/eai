/** Validate the EAI local-isolation contract for Gofer's new task worktree.
 * This is preflight evidence only. Native host invocation must still prove
 * that the effective sandbox remained enabled for the task. */
import { execFile, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants, existsSync, mkdtempSync, realpathSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const text = value => typeof value === 'string' && value.trim().length > 0;
// Observed on the local Codex CLI 0.154.0. A changed signing identity fails
// closed until the host contract is reviewed.
const CODEX_MACOS_SIGNATURE_REQUIREMENT =
  '=anchor apple generic and certificate leaf[subject.OU] = "2DC432GLL2"';
const CODEX_PROFILE = 'gofer-isolated';

/** Build one policy for both the no-model probe and the native invocation. */
export function codexIsolatedPermissionArgs(workspaceRoot) {
  if (!text(workspaceRoot)) return null;
  const git = spawnSync('/usr/bin/git', ['-C', workspaceRoot, 'rev-parse',
    '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))) });
  if (git.status !== 0 || !git.stdout?.trim()) return null;
  const [topLevel, gitDirectory, commonDirectory] = git.stdout.trim().split('\n');
  if (!topLevel || !gitDirectory || !commonDirectory) return null;
  let common;
  let workspace;
  let gitDir;
  let top;
  try {
    common = realpathSync(commonDirectory);
    workspace = realpathSync(workspaceRoot);
    gitDir = realpathSync(gitDirectory);
    top = realpathSync(topLevel);
  } catch { return null; }
  const commonRelative = relative(workspace, common);
  if (top !== workspace || gitDir === common || commonRelative === '' ||
      (!commonRelative.startsWith(`..${sep}`) && commonRelative !== '..' && !isAbsolute(commonRelative))) return null;
  return Object.freeze({ common,
    config: Object.freeze([
      `permissions.${CODEX_PROFILE}.extends=":workspace"`,
      `permissions.${CODEX_PROFILE}.filesystem={ ":tmpdir" = "read", ":slash_tmp" = "read", ${JSON.stringify(common)} = "read" }`,
      `default_permissions="${CODEX_PROFILE}"`,
    ]) });
}

function signedCodexExecutable() {
  if (process.platform !== 'darwin') return null;
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (!entry || !isAbsolute(entry)) continue;
    const candidate = join(entry, 'codex');
    try {
      accessSync(candidate, constants.X_OK);
      const executable = realpathSync(candidate);
      if (!statSync(executable).isFile()) return null;
      const signature = spawnSync('/usr/bin/codesign', ['--verify', '--strict', '--requirement',
        CODEX_MACOS_SIGNATURE_REQUIREMENT, executable], { stdio: 'ignore', timeout: 10000 });
      const identity = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', executable], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
      });
      if (signature.status !== 0 || signature.error || identity.status !== 0 ||
          !/\bTeamIdentifier=2DC432GLL2\b/.test(identity.stderr)) return null;
      return executable;
    } catch { /* Try the next PATH entry only when this one has no executable. */ }
  }
  return null;
}

/** A no-model boundary probe. A worker must not write the shared Git store. */
export function probeMacCodexSandboxBoundary({ workspaceRoot, executable, runSandbox = spawnSync } = {}) {
  if (!workspaceRoot || !executable || !existsSync('/usr/bin/touch') ||
      typeof runSandbox !== 'function') return null;
  const policy = codexIsolatedPermissionArgs(workspaceRoot);
  if (!policy) return null;
  let sibling;
  try { sibling = mkdtempSync(join(dirname(workspaceRoot), '.gofer-isolation-probe-')); }
  catch { return null; }
  const inside = join(workspaceRoot, `.gofer-isolation-probe-${randomUUID()}`);
  const outside = join(sibling, 'outside');
  const sharedGit = join(policy.common, `.gofer-isolation-probe-${randomUUID()}`);
  const probe = target => runSandbox(executable,
    ['sandbox', '-P', CODEX_PROFILE, ...policy.config.flatMap(value => ['-c', value]),
      '-C', workspaceRoot, '--', '/usr/bin/touch', target],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 16384 });
  const denied = result => result.status !== 0 && !result.error &&
    /Operation not permitted|Permission denied/i.test(`${result.stderr}\n${result.stdout}`);
  try {
    for (const target of [outside, sharedGit]) {
      const baseline = spawnSync('/usr/bin/touch', [target], { stdio: 'ignore', timeout: 5000 });
      if (baseline.status !== 0 || !existsSync(target)) return null;
      rmSync(target);
    }
    const allowed = probe(inside);
    if (allowed.status !== 0 || !existsSync(inside)) return null;
    const siblingResult = probe(outside);
    if (!denied(siblingResult) || existsSync(outside)) return null;
    const gitResult = probe(sharedGit);
    return denied(gitResult) && !existsSync(sharedGit) ? executable : null;
  } catch { return null; }
  finally {
    rmSync(inside, { force: true });
    rmSync(outside, { force: true });
    rmSync(sharedGit, { force: true });
    try { rmdirSync(sibling); } catch { /* Preserve unexpected contents. */ }
  }
}

/** An independent check of the signed executable Gofer will launch. */
export function probeNativeCodexSandbox(workspaceRoot) {
  const executable = signedCodexExecutable();
  return executable ? probeMacCodexSandboxBoundary({ workspaceRoot, executable }) : null;
}

export const LOCAL_ISOLATION_CONTRACT = 'eai.local-isolation/v2';

const HOST_SURFACES = Object.freeze({
  codex: 'codex-cli',
});

function hasQualifiedHostArguments(host, workspaceRoot, args) {
  if (host !== 'codex' || !Array.isArray(args)) return false;
  const policy = codexIsolatedPermissionArgs(workspaceRoot);
  if (!policy) return false;
  const expected = ['--ask-for-approval', 'never', 'exec', '--ignore-user-config',
    ...policy.config.flatMap(value => ['-c', value])];
  return args.length === expected.length && args.every((value, index) => value === expected[index]);
}

export function verifyLocalIsolationReport(report, { host, workspaceRoot } = {}) {
  const surfaceId = HOST_SURFACES[host];
  if (!surfaceId || !text(workspaceRoot) || !report || report.contractVersion !== LOCAL_ISOLATION_CONTRACT ||
      report.cloudExecution !== 'prohibited' || report.gitRepository !== true || !text(report.projectDirectory) ||
      !Array.isArray(report.assessments)) return false;
  const matchingAssessments = report.assessments.filter(item => item?.surfaceId === surfaceId);
  if (matchingAssessments.length !== 1) return false;
  const assessment = matchingAssessments[0];
  if (!assessment || assessment.status !== 'ready' || assessment.localOnly !== true ||
      assessment.requiresGitWorktree !== true || assessment.requiresOsSandbox !== true ||
      !hasQualifiedHostArguments(host, workspaceRoot, assessment.hostArguments) ||
      !Array.isArray(assessment.missing) || assessment.missing.length !== 0) return false;
  const normalizedReportRoot = report.projectDirectory.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedWorkspace = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalizedReportRoot === normalizedWorkspace;
}

/** Query the installed local EAI CLI for the worktree Gofer actually created. */
export async function inspectEaiLocalIsolation({ host, workspaceRoot, command = 'eai',
  run = execFileAsync, verifyNativeSandbox = probeNativeCodexSandbox } = {}) {
  const surfaceId = HOST_SURFACES[host];
  if (!surfaceId || !text(workspaceRoot) || !text(command) ||
      typeof run !== 'function' || typeof verifyNativeSandbox !== 'function') {
    throw new Error('LOCAL_SANDBOX_REQUIRED');
  }
  let stdout;
  try {
    ({ stdout } = await run(command,
      ['start', workspaceRoot, '--isolation-check', '--surface', surfaceId, '--format', 'json'],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true }));
  } catch {
    throw new Error('LOCAL_SANDBOX_REQUIRED');
  }
  let report;
  try { report = JSON.parse(stdout); }
  catch { throw new Error('LOCAL_SANDBOX_REQUIRED'); }
  if (!verifyLocalIsolationReport(report, { host, workspaceRoot })) {
    throw new Error('LOCAL_SANDBOX_REQUIRED');
  }
  let nativeExecutable;
  try { nativeExecutable = verifyNativeSandbox(workspaceRoot); }
  catch { throw new Error('LOCAL_SANDBOX_REQUIRED'); }
  if (!text(nativeExecutable) || !isAbsolute(nativeExecutable)) throw new Error('LOCAL_SANDBOX_REQUIRED');
  return Object.freeze({ ...report, nativeExecutable });
}
