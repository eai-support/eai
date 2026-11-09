/**
 * Grok Build host profile for the shared native launcher. It reuses the same
 * process-group evidence, Git baseline and scope checks as the Codex launcher.
 *
 * Isolation is Grok's own OS sandbox (Seatbelt on macOS), driven by a per-task
 * profile. What live tests found, and what this adapter therefore does:
 *
 * - Grok's built-in `strict` profile still allows writes to the OS temp
 *   folder, where Gofer worktrees normally live. This adapter denies the
 *   temp folders and so REFUSES a worktree or shared Git store inside them.
 *   Keep Grok worktrees under another root, for example under your home folder.
 * - An unknown profile, or one that cannot be applied, only prints a warning
 *   and runs UNSANDBOXED. The adapter kills the process the moment that
 *   warning appears and rejects the run. Unknown profile keys are silently
 *   ignored, so only `extends` and `deny`, which were verified live, are used.
 * - The profile name is random per run, and the profile file is written into
 *   the worktree before start and removed after exit.
 * - A worker can READ `~/.grok/auth.json`. It cannot be hidden, because Grok
 *   itself cannot start without it. It cannot WRITE anywhere in `~/.grok`.
 *
 * Grok has no spend flag, so cost is bounded by `--max-turns` here and by the
 * caller's spend cap. There is no model catalogue use and no capability
 * receipt in this adapter, and the EAI CLI does not qualify Grok, so this does
 * not by itself pass the EAI isolation gate. See docs/verified-autonomous-runtime.md.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, closeSync,
  realpathSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLocalHostInvocation } from './gofer-native-adapter.mjs';
import { insideDirectory, sharedGitDirectory } from './gofer-worktree-layout.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0;
const TEMPORARY_ROOTS = Object.freeze(['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp',
  '/var/folders', '/private/var/folders']);
const PROFILE_FILE = path.join('.grok', 'sandbox.toml');

/**
 * The per-task profile, or null when the layout cannot be protected. Only paths
 * that exist are listed: Grok cannot apply a profile that names a missing path.
 * `temporaryRoots` exists for isolated tests; production never passes it.
 */
export function grokSandboxPolicy(workspaceRoot, { temporaryRoots = TEMPORARY_ROOTS } = {}) {
  const common = sharedGitDirectory(workspaceRoot);
  if (!common || !Array.isArray(temporaryRoots)) return null;
  let workspace;
  try { workspace = realpathSync(workspaceRoot); } catch { return null; }
  const denied = [...new Set(temporaryRoots.filter(root => path.isAbsolute(root ?? '') && existsSync(root)))];
  const resolved = denied.flatMap(root => { try { return [root, realpathSync(root)]; } catch { return [root]; } });
  // The temp folders are denied, so a worktree inside them would be denied too.
  if (resolved.some(root => insideDirectory(root, workspace) || insideDirectory(root, common))) return null;
  // Never overwrite a project's own sandbox file, tracked or not.
  try { lstatSync(path.join(workspace, PROFILE_FILE)); return null; } catch { /* absent, as required */ }
  const profileName = `gofer-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const toml = `[profiles.${profileName}]\nextends = "strict"\ndeny = ${JSON.stringify(denied)}\n`;
  return Object.freeze({ profileName, toml, common, workspace, denied: Object.freeze(denied) });
}

function parseResult(stdoutText) {
  const trimmed = String(stdoutText ?? '').trim();
  for (const candidate of [trimmed, trimmed.split('\n').at(-1)]) {
    try { const value = JSON.parse(candidate); if (value && typeof value === 'object') return value; }
    catch { /* try the next candidate */ }
  }
  return null;
}

/** Token counts in the shape the pricing code expects, plus Grok's own cost.
 * Grok's `input_tokens` excludes cache reads, as Claude's does. */
export function extractGrokUsage(stdoutText) {
  const result = parseResult(stdoutText);
  const usage = result?.usage;
  const output = usage?.output_tokens;
  const fresh = usage?.input_tokens;
  const cachedRead = usage?.cache_read_input_tokens ?? 0;
  const cachedWrite = usage?.cache_creation_input_tokens ?? 0;
  if (![output, fresh, cachedRead, cachedWrite].every(value => Number.isInteger(value) && value >= 0)) return null;
  const reported = result.total_cost_usd;
  return Object.freeze({ inputTokens: fresh + cachedRead + cachedWrite, cachedInputTokens: cachedRead,
    outputTokens: output, reportedCostUsd: Number.isFinite(reported) && reported >= 0 ? reported : null });
}

const SANDBOX_FAILURE = /sandbox could not be applied/i;

export const GROK_HOST = Object.freeze({
  name: 'grok',
  sandboxPolicy: (workspace, hostOptions) => grokSandboxPolicy(workspace, hostOptions),
  buildArgs: ({ sandboxPolicy, modelId, prompt, workspace, hostOptions }) => {
    const turns = hostOptions?.maxTurns;
    if (!Number.isInteger(turns) || turns < 1 || turns > 200) throw new Error('INVALID_NATIVE_REQUEST');
    return ['-p', prompt, '--cwd', workspace, '--output-format', 'json', '--model', modelId, '--always-approve',
      '--sandbox', sandboxPolicy.profileName, '--max-turns', String(turns), '--no-subagents', '--disable-web-search'];
  },
  // The parent's sandbox variables must not be able to weaken this run.
  env: base => Object.fromEntries(Object.entries(base).filter(([key]) =>
    !key.startsWith('GROK_SANDBOX') && !key.startsWith('GIT_'))),
  fatalStderr: SANDBOX_FAILURE,
  // `wx`: fail closed if the file appeared since the policy was made.
  beforeStart: ({ workspace, sandboxPolicy }) => {
    mkdirSync(path.join(workspace, '.grok'), { recursive: true, mode: 0o700 });
    const descriptor = openSync(path.join(workspace, PROFILE_FILE), constants.O_WRONLY | constants.O_CREAT |
      constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(descriptor, sandboxPolicy.toml); } finally { closeSync(descriptor); }
  },
  cleanup: ({ workspace }) => {
    const file = path.join(workspace, PROFILE_FILE);
    try { if (lstatSync(file).isFile()) rmSync(file, { force: true }); } catch { /* nothing to remove */ }
    try { rmdirSync(path.join(workspace, '.grok')); } catch { /* not empty or absent: left for the scope check */ }
  },
  finalMessage: ({ stdout }) => String(parseResult(stdout)?.text ?? ''),
  extractUsage: stdoutText => extractGrokUsage(stdoutText),
  assertSuccess: (stdoutText, stderrText) => {
    if (SANDBOX_FAILURE.test(String(stderrText ?? ''))) throw new Error('NATIVE_HOST_SANDBOX_NOT_APPLIED');
    const result = parseResult(stdoutText);
    if (!result) throw new Error('NATIVE_HOST_RESULT_UNPARSEABLE');
    if (result.is_error === true || result.stopReason !== 'end_turn') throw new Error('NATIVE_HOST_REPORTED_ERROR');
  },
});

/** `command` must be the pinned absolute path of the Grok executable, and
 * `hostOptions.maxTurns` bounds this run. Grok has no spend flag. */
export function startLocalGrokInvocation(options = {}) {
  if (!path.isAbsolute(options.command ?? '')) throw new Error('NATIVE_HOST_COMMAND_MUST_BE_PINNED');
  return startLocalHostInvocation({ ...options, host: GROK_HOST });
}

/**
 * A live boundary probe. Grok has no no-model sandbox command, so this asks a
 * real model (about US$0.01) to try one allowed write and four forbidden ones:
 * a sibling folder, the shared Git store, the OS temp folder, and Grok's own
 * home. It then checks the disk and requires Grok's own report to describe the
 * refusals. It spends money, so nothing calls it implicitly. Returns the
 * executable when the boundary held.
 */
export function probeGrokSandboxBoundary({ workspaceRoot, executable, model = 'grok-4.5', maxTurns = 8,
  run = spawnSync, temporaryRoots } = {}) {
  if (!text(workspaceRoot) || !path.isAbsolute(executable ?? '')) return null;
  const policy = grokSandboxPolicy(workspaceRoot, temporaryRoots ? { temporaryRoots } : undefined);
  if (!policy) return null;
  const grokHome = path.join(os.homedir(), '.grok');
  let sibling;
  const created = [];
  try {
    sibling = mkdtempSync(path.join(path.dirname(policy.workspace), '.gofer-grok-probe-'));
    const targets = {
      inside: path.join(policy.workspace, `.gofer-grok-probe-${process.pid}`),
      sibling: path.join(sibling, 'outside.txt'),
      store: path.join(policy.common, `.gofer-grok-probe-${process.pid}`),
      temp: path.join(os.tmpdir(), `.gofer-grok-probe-${process.pid}`),
      home: path.join(grokHome, `.gofer-grok-probe-${process.pid}`),
    };
    created.push(...Object.values(targets));
    const prompt = 'This is a file-permission test. Use your shell tool to run exactly these five commands, one at a ' +
      `time, even if an earlier one fails, and never retry or work around a failure: (1) touch ${targets.inside} ` +
      `(2) touch ${targets.sibling} (3) touch ${targets.store} (4) touch ${targets.temp} (5) touch ${targets.home}. ` +
      'Report each exit code and the error text, then stop.';
    const args = GROK_HOST.buildArgs({ sandboxPolicy: policy, modelId: model, prompt, workspace: policy.workspace,
      hostOptions: { maxTurns } });
    GROK_HOST.beforeStart({ workspace: policy.workspace, sandboxPolicy: policy });
    let result;
    try {
      result = run(executable, args, { cwd: policy.workspace, encoding: 'utf8', timeout: 240000,
        maxBuffer: 8 * 1024 * 1024, env: GROK_HOST.env(process.env) });
    } finally { GROK_HOST.cleanup({ workspace: policy.workspace }); }
    const parsed = parseResult(result.stdout);
    const refusals = (String(parsed?.text ?? '').match(/not permitted|permission denied|denied|blocked|refused|not allowed/gi) ?? []).length;
    const held = result.status === 0 && !SANDBOX_FAILURE.test(String(result.stderr ?? '')) &&
      parsed?.stopReason === 'end_turn' && refusals >= 4 && existsSync(targets.inside) &&
      ['sibling', 'store', 'temp', 'home'].every(key => !existsSync(targets[key]));
    return held ? executable : null;
  } catch { return null; }
  finally {
    for (const file of created) rmSync(file, { force: true });
    if (sibling) rmSync(sibling, { recursive: true, force: true });
  }
}

export function grokExecutableVersion(executable) {
  try { return execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim(); }
  catch { return null; }
}

