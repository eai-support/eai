import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants, existsSync, mkdtempSync, realpathSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { AiSurfaceId } from './ai-surfaces.js';

export const LOCAL_ISOLATION_CONTRACT_VERSION = 'eai.local-isolation/v1' as const;

// Observed with `codesign -dv --verbose=2` on the local Codex CLI 0.154.0
// artifact signed by Developer ID Application: OpenAI OpCo, LLC. The sandbox
// docs (https://learn.chatgpt.com/docs/sandboxing) describe Seatbelt but do
// not publish a stable signing Team ID.
// A future signing change must fail closed until the new identity is reviewed.
const CODEX_MACOS_SIGNATURE_REQUIREMENT =
  '=anchor apple generic and certificate leaf[subject.OU] = "2DC432GLL2"';

export type LocalIsolationStatus = 'ready' | 'missing-prerequisite' | 'manual-host-setup' | 'unsupported';

export interface LocalIsolationAssessment {
  readonly surfaceId: AiSurfaceId;
  readonly status: LocalIsolationStatus;
  readonly localOnly: true;
  readonly requiresGitWorktree: true;
  readonly requiresOsSandbox: true;
  readonly hostArguments: readonly string[];
  readonly prerequisites: readonly string[];
  readonly missing: readonly string[];
  readonly reason: string;
}

export interface LocalIsolationReport {
  readonly contractVersion: typeof LOCAL_ISOLATION_CONTRACT_VERSION;
  readonly projectDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly gitRepository: boolean;
  readonly cloudExecution: 'prohibited';
  readonly assessments: readonly LocalIsolationAssessment[];
}

function gitWorktreeState(projectDirectory: string): { gitRepository: boolean; dedicatedWorktree: boolean; worktreeRoot: string | null } {
  const result = spawnSync('git', ['-C', projectDirectory, 'rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return { gitRepository: false, dedicatedWorktree: false, worktreeRoot: null };
  const [topLevel, gitDirectory, commonDirectory] = result.stdout.trim().split('\n').map((value) => value.trim());
  if (!topLevel || !gitDirectory || !commonDirectory) return { gitRepository: false, dedicatedWorktree: false, worktreeRoot: null };
  const gitRepository = true;
  try {
    const worktreeRoot = realpathSync(topLevel);
    const projectPath = realpathSync(projectDirectory);
    const relativeProjectPath = relative(worktreeRoot, projectPath);
    const projectWithinWorktree = relativeProjectPath !== '..'
      && !relativeProjectPath.startsWith(`..${sep}`)
      && !isAbsolute(relativeProjectPath);
    const dedicatedWorktree = projectWithinWorktree
      && realpathSync(resolve(projectDirectory, gitDirectory)) !== realpathSync(resolve(projectDirectory, commonDirectory));
    return { gitRepository, dedicatedWorktree, worktreeRoot: dedicatedWorktree ? worktreeRoot : null };
  } catch {
    return { gitRepository, dedicatedWorktree: false, worktreeRoot: null };
  }
}

function signedCodexExecutable(): string | null {
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (!entry || !isAbsolute(entry)) continue;
    const candidate = join(entry, 'codex');
    try {
      accessSync(candidate, constants.X_OK);
      const executable = realpathSync(candidate);
      if (!statSync(executable).isFile()) return null;
      const verification = spawnSync('/usr/bin/codesign', [
        '--verify', '--strict', '--requirement',
        CODEX_MACOS_SIGNATURE_REQUIREMENT, executable,
      ], { stdio: 'ignore', timeout: 10_000 });
      if (verification.status !== 0 || verification.error) return null;
      const identity = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', executable], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
      });
      if (identity.status !== 0 || !/\bTeamIdentifier=2DC432GLL2\b/.test(identity.stderr)) return null;
      return executable;
    } catch {
      // Continue only when this PATH entry has no usable executable.
    }
  }
  return null;
}

/** @internal Installed Codex CLI 0.154.0 accepts this no-model sandbox form. */
export function buildMacCodexSandboxProbeArgs(worktreeRoot: string, target: string): readonly string[] {
  return ['sandbox', '-P', ':workspace', '-C', worktreeRoot, '--', '/usr/bin/touch', target];
}

function macCodexSandboxEnforced(worktreeRoot: string): boolean {
  const codex = signedCodexExecutable();
  if (!codex || !existsSync('/usr/bin/touch')) return false;
  let sibling: string;
  try { sibling = mkdtempSync(join(dirname(worktreeRoot), '.eai-isolation-probe-')); }
  catch { return false; }
  const inside = join(worktreeRoot, `.eai-isolation-probe-${randomUUID()}`);
  const outside = join(sibling, 'outside');
  const probe = (target: string) => spawnSync(codex, buildMacCodexSandboxProbeArgs(worktreeRoot, target), {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000, maxBuffer: 16_384,
  });
  try {
    // Prove the sibling is writable without the sandbox before testing denial.
    const baseline = spawnSync('/usr/bin/touch', [outside], { stdio: 'ignore', timeout: 5_000 });
    if (baseline.status !== 0 || !existsSync(outside)) return false;
    rmSync(outside);
    const allowed = probe(inside);
    if (allowed.status !== 0 || !existsSync(inside)) return false;
    const denied = probe(outside);
    return denied.status !== 0 && !denied.error && !existsSync(outside)
      && /Operation not permitted|Permission denied/i.test(`${denied.stderr}\n${denied.stdout}`);
  } catch {
    return false;
  } finally {
    rmSync(inside, { force: true });
    rmSync(outside, { force: true });
    try { rmdirSync(sibling); } catch { /* Retain unexpected contents rather than delete them. */ }
  }
}

function assessmentFor(surfaceId: AiSurfaceId, platform: NodeJS.Platform, gitRepository: boolean, dedicatedWorktree: boolean, macCodexEnforced: boolean): LocalIsolationAssessment {
  const common = {
    surfaceId, localOnly: true as const, requiresGitWorktree: true as const, requiresOsSandbox: true as const,
  };
  if (!gitRepository) {
    return { ...common, status: 'missing-prerequisite', hostArguments: [], prerequisites: ['Git repository'], missing: ['Git repository'], reason: 'A dedicated Git worktree is required before local execution can start.' };
  }
  if (!dedicatedWorktree) {
    return { ...common, status: 'missing-prerequisite', hostArguments: [], prerequisites: ['Dedicated Git worktree'], missing: ['Dedicated Git worktree'], reason: 'Create a dedicated Git worktree for this project before local execution can start.' };
  }
  if (platform !== 'linux' && platform !== 'darwin' && platform !== 'win32') {
    return { ...common, status: 'unsupported', hostArguments: [], prerequisites: [], missing: ['Supported OS sandbox contract'], reason: `No local sandbox contract is available for ${platform}.` };
  }
  switch (surfaceId) {
    case 'codex-cli':
      return { ...common, status: macCodexEnforced ? 'ready' : 'manual-host-setup', hostArguments: ['--sandbox', 'workspace-write', '--ask-for-approval', 'never'], prerequisites: ['Native sandbox enforcement'], missing: macCodexEnforced ? [] : ['Verified native Codex sandbox enforcement'], reason: macCodexEnforced ? 'A signed local Codex sandbox allowed a worktree write and denied a writable sibling write.' : 'A native Codex sandbox boundary was not proven on this host.' };
    case 'grok-cli':
      return { ...common, status: 'manual-host-setup', hostArguments: ['--worktree', '--sandbox', 'strict', '--permission-mode', 'dontAsk'], prerequisites: ['Native Grok sandbox enforcement'], missing: ['Verified native Grok sandbox enforcement'], reason: 'Grok Build sandbox enforcement has not been proven by a native boundary check.' };
    case 'claude-cli':
      return { ...common, status: 'manual-host-setup', hostArguments: ['--worktree'], prerequisites: ['Claude Code sandbox enabled'], missing: ['Verified Claude Code sandbox policy'], reason: 'Claude Code needs an enabled sandbox policy with unsandboxed fallback disabled before it qualifies.' };
    case 'antigravity-cli':
      return { ...common, status: 'manual-host-setup', hostArguments: ['--sandbox'], prerequisites: ['Antigravity project bound only to the task worktree'], missing: ['Verified Antigravity project binding'], reason: 'Antigravity must prove that its selected project root is the task worktree before it qualifies.' };
    case 'copilot-cli':
      return { ...common, status: 'manual-host-setup', hostArguments: ['--experimental', '--sandbox'], prerequisites: ['Copilot local sandbox enabled', 'sandbox bypass disabled'], missing: ['OS-enforced coverage for all file tools'], reason: 'Copilot local sandboxing needs an explicit policy review before it can qualify.' };
    default:
      return { ...common, status: 'unsupported', hostArguments: [], prerequisites: [], missing: ['A native CLI isolation contract'], reason: 'This surface cannot provide a verified local CLI isolation contract.' };
  }
}

export function assessLocalIsolation(options: {
  readonly projectDirectory: string;
  readonly platform?: NodeJS.Platform;
  readonly surfaceIds: readonly AiSurfaceId[];
}): LocalIsolationReport {
  const projectDirectory = resolve(options.projectDirectory);
  const platform = options.platform ?? process.platform;
  const { gitRepository, dedicatedWorktree, worktreeRoot } = existsSync(projectDirectory)
    ? gitWorktreeState(projectDirectory)
    : { gitRepository: false, dedicatedWorktree: false, worktreeRoot: null };
  const macCodexEnforced = platform === 'darwin' && process.platform === 'darwin'
    && worktreeRoot !== null && options.surfaceIds.includes('codex-cli')
    && macCodexSandboxEnforced(worktreeRoot);
  return {
    contractVersion: LOCAL_ISOLATION_CONTRACT_VERSION,
    projectDirectory,
    platform,
    gitRepository,
    cloudExecution: 'prohibited',
    assessments: options.surfaceIds.map((surfaceId) => assessmentFor(surfaceId, platform, gitRepository, dedicatedWorktree, macCodexEnforced)),
  };
}
