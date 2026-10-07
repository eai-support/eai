/**
 * Claude Code host profile for the shared native launcher. It reuses the same
 * process-group evidence, Git baseline and scope checks as the Codex launcher.
 * Only three things are Claude-specific: how the sandbox policy is described,
 * how the command line is built, and how the result and usage are read.
 *
 * Isolation comes from Claude Code's own OS sandbox, configured per task. A
 * live probe found the default sandbox lets a worker write the shared Git
 * store of a linked worktree, so this policy denies that folder explicitly.
 * Claude has no model catalogue command and no no-model boundary test, so this
 * adapter does not issue capability receipts and does not, by itself, satisfy
 * the EAI CLI isolation gate. See docs/verified-autonomous-runtime.md.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, existsSync, readdirSync, realpathSync, rmSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { startLocalHostInvocation } from './gofer-native-adapter.mjs';
import { sharedGitDirectory } from './gofer-worktree-layout.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0;
/**
 * The per-task sandbox settings. `protectedReadPaths` (for example the account
 * trust folder) are denied for both the shell sandbox and the file tools.
 */
export function claudeSandboxPolicy(workspaceRoot, { protectedReadPaths = [] } = {}) {
  const common = sharedGitDirectory(workspaceRoot);
  if (!common || !Array.isArray(protectedReadPaths) ||
      protectedReadPaths.some(item => !path.isAbsolute(item ?? ''))) return null;
  const denied = [...protectedReadPaths];
  const settings = { sandbox: { enabled: true, allowUnsandboxedCommands: false,
    filesystem: { denyWrite: [common], ...(denied.length ? { denyRead: denied } : {}) } },
  ...(denied.length ? { permissions: { deny: denied.flatMap(item =>
    ['Read', 'Edit', 'Write'].map(tool => `${tool}(/${item}/**)`)) } } : {}) };
  return Object.freeze({ common, settings: JSON.stringify(settings) });
}

function parseResult(stdoutText) {
  const trimmed = String(stdoutText ?? '').trim();
  for (const candidate of [trimmed, trimmed.split('\n').at(-1)]) {
    try { const value = JSON.parse(candidate); if (value && typeof value === 'object') return value; }
    catch { /* try the next candidate */ }
  }
  return null;
}

/** Token counts in the shape the pricing code expects, plus Claude's own cost. */
export function extractClaudeUsage(stdoutText) {
  const usage = parseResult(stdoutText)?.usage;
  const output = usage?.output_tokens;
  const fresh = usage?.input_tokens;
  const cachedRead = usage?.cache_read_input_tokens ?? 0;
  const cachedWrite = usage?.cache_creation_input_tokens ?? 0;
  if (![output, fresh, cachedRead, cachedWrite].every(value => Number.isInteger(value) && value >= 0)) return null;
  const reported = parseResult(stdoutText)?.total_cost_usd;
  return Object.freeze({ inputTokens: fresh + cachedRead + cachedWrite, cachedInputTokens: cachedRead,
    outputTokens: output, reportedCostUsd: Number.isFinite(reported) && reported >= 0 ? reported : null });
}

const editRule = (tool, scope) => {
  const clean = scope.replace(/\/$/, '');
  return `${tool}(${scope.endsWith('/') ? `${clean}/**` : clean})`;
};

export const CLAUDE_HOST = Object.freeze({
  name: 'claude',
  sandboxPolicy: (workspace, hostOptions) => claudeSandboxPolicy(workspace, hostOptions),
  buildArgs: ({ sandboxPolicy, modelId, prompt, allowedWriteScope, hostOptions }) => {
    const budget = hostOptions?.maxBudgetUsd;
    if (!(budget > 0) || budget > 100) throw new Error('INVALID_NATIVE_REQUEST');
    const tools = ['Bash', 'Read', 'Glob', 'Grep',
      ...allowedWriteScope.flatMap(scope => [editRule('Edit', scope), editRule('Write', scope)])];
    return ['-p', prompt, '--output-format', 'json', '--model', modelId, '--permission-mode', 'dontAsk',
      '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config',
      '--max-budget-usd', String(budget), '--settings', sandboxPolicy.settings,
      '--allowedTools', tools.join(',')];
  },
  // A nested Claude session must not inherit its parent's session variables.
  env: base => Object.fromEntries(Object.entries(base).filter(([key]) =>
    key !== 'CLAUDECODE' && !key.startsWith('CLAUDE_CODE') && !key.startsWith('GIT_'))),
  // Claude's sandbox leaves an empty `.claude/.cc-writes` folder in the worktree.
  // It is removed only when it is empty and alone, so a file a worker places
  // there is still reported as a scope violation.
  afterExit: ({ workspace }) => {
    const directory = path.join(workspace, '.claude');
    const bookkeeping = path.join(directory, '.cc-writes');
    try {
      if (lstatSync(directory).isDirectory() && readdirSync(directory).join() === '.cc-writes' &&
          lstatSync(bookkeeping).isDirectory() && readdirSync(bookkeeping).length === 0) {
        rmdirSync(bookkeeping);
        rmdirSync(directory);
      }
    } catch { /* nothing to clean */ }
  },
  finalMessage: ({ stdout }) => String(parseResult(stdout)?.result ?? ''),
  extractUsage: stdoutText => extractClaudeUsage(stdoutText),
  assertSuccess: stdoutText => {
    const result = parseResult(stdoutText);
    if (!result) throw new Error('NATIVE_HOST_RESULT_UNPARSEABLE');
    if (result.is_error === true || result.subtype !== 'success') throw new Error('NATIVE_HOST_REPORTED_ERROR');
  },
});

/** `command` must be the pinned absolute path of the Claude executable, and
 * `hostOptions.maxBudgetUsd` bounds this one run inside Claude itself. */
export function startLocalClaudeInvocation(options = {}) {
  if (!path.isAbsolute(options.command ?? '')) throw new Error('NATIVE_HOST_COMMAND_MUST_BE_PINNED');
  return startLocalHostInvocation({ ...options, host: CLAUDE_HOST });
}

/**
 * A live boundary probe. Unlike Codex, Claude has no no-model sandbox command,
 * so this asks a real model (about US$0.05 on Haiku) to try one allowed write
 * and four forbidden ones (shell and file tool, sibling folder and shared Git
 * store), then checks the filesystem. It spends money, so nothing calls it
 * implicitly. Returns the executable when the boundary held, otherwise null.
 */
export function probeClaudeSandboxBoundary({ workspaceRoot, executable, model = 'haiku',
  maxBudgetUsd = 0.25, run = spawnSync } = {}) {
  if (!text(workspaceRoot) || !path.isAbsolute(executable ?? '')) return null;
  const policy = claudeSandboxPolicy(workspaceRoot);
  if (!policy) return null;
  const workspace = realpathSync(workspaceRoot);
  let sibling;
  try {
    sibling = mkdtempSync(path.join(path.dirname(workspace), '.gofer-claude-probe-'));
    const inside_ = path.join(workspace, `.gofer-claude-probe-${process.pid}`);
    const outside = path.join(sibling, 'outside.txt');
    const outsideTool = path.join(sibling, 'outside-tool.txt');
    const store = path.join(policy.common, `.gofer-claude-probe-${process.pid}`);
    const prompt = 'This is a file-permission test. Do these five things, each separately, even if an ' +
      `earlier one fails, and never retry or work around a failure. Shell: (1) touch ${inside_} (2) touch ${outside} ` +
      `(3) touch ${store}. File tool: (4) use the Write tool to create ${outsideTool} with the text x. Then report each result and stop.`;
    const args = ['-p', prompt, '--output-format', 'json', '--model', model, '--permission-mode', 'dontAsk',
      '--no-session-persistence', '--max-budget-usd', String(maxBudgetUsd), '--settings', policy.settings,
      // Mirrors production: Bash, and file tools scoped to one in-scope file only.
      '--allowedTools', 'Bash,Write(gofer-claude-probe-scope.txt)'];
    const result = run(executable, args, { cwd: workspace, encoding: 'utf8', timeout: 180000,
      maxBuffer: 4 * 1024 * 1024, env: CLAUDE_HOST.env(process.env) });
    const parsed = parseResult(result.stdout);
    // A model that skipped the forbidden attempts would pass by doing nothing.
    // Require its own report to describe at least three refusals as well.
    const refusals = (String(parsed?.result ?? '').match(/not permitted|permission denied|denied|blocked|refused|not allowed/gi) ?? []).length;
    const held = result.status === 0 && parsed?.is_error !== true && refusals >= 3 && existsSync(inside_) &&
      !existsSync(outside) && !existsSync(store) && !existsSync(outsideTool);
    rmSync(inside_, { force: true }); rmSync(outside, { force: true }); rmSync(store, { force: true });
    return held ? executable : null;
  } catch { return null; }
  finally { if (sibling) rmSync(sibling, { recursive: true, force: true }); }
}

export function claudeExecutableVersion(executable) {
  try { return execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim(); }
  catch { return null; }
}
