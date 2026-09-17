import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AiSurfaceId } from './ai-surfaces.js';

export const LOCAL_ISOLATION_CONTRACT_VERSION = 'eai.local-isolation/v1' as const;

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

function commandAvailable(command: string): boolean {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function gitWorktreeState(projectDirectory: string): { gitRepository: boolean; dedicatedWorktree: boolean } {
  const result = spawnSync('git', ['-C', projectDirectory, 'rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return { gitRepository: false, dedicatedWorktree: false };
  const [topLevel, gitDirectory, commonDirectory] = result.stdout.trim().split('\n').map((value) => value.trim());
  if (!topLevel || !gitDirectory || !commonDirectory) return { gitRepository: false, dedicatedWorktree: false };
  const gitRepository = true;
  try {
    const dedicatedWorktree = realpathSync(topLevel) === realpathSync(projectDirectory)
      && realpathSync(resolve(projectDirectory, gitDirectory)) !== realpathSync(resolve(projectDirectory, commonDirectory));
    return { gitRepository, dedicatedWorktree };
  } catch {
    return { gitRepository, dedicatedWorktree: false };
  }
}

function assessmentFor(surfaceId: AiSurfaceId, platform: NodeJS.Platform, gitRepository: boolean, dedicatedWorktree: boolean): LocalIsolationAssessment {
  const common = {
    surfaceId, localOnly: true as const, requiresGitWorktree: true as const, requiresOsSandbox: true as const,
  };
  if (!gitRepository) {
    return { ...common, status: 'missing-prerequisite', hostArguments: [], prerequisites: ['Git repository'], missing: ['Git repository'], reason: 'A dedicated Git worktree is required before local execution can start.' };
  }
  if (!dedicatedWorktree) {
    return { ...common, status: 'missing-prerequisite', hostArguments: [], prerequisites: ['Dedicated Git worktree'], missing: ['Dedicated Git worktree'], reason: 'Create a dedicated Git worktree for this project before local execution can start.' };
  }
  if (platform === 'linux' && (!commandAvailable('bwrap') || !commandAvailable('socat'))) {
    const missing = [!commandAvailable('bwrap') ? 'bubblewrap (bwrap)' : null, !commandAvailable('socat') ? 'socat' : null].filter((value): value is string => value !== null);
    return { ...common, status: 'missing-prerequisite', hostArguments: [], prerequisites: ['bubblewrap (bwrap)', 'socat'], missing, reason: 'The Linux local sandbox runtime is incomplete.' };
  }
  switch (surfaceId) {
    case 'codex-cli':
      return { ...common, status: 'ready', hostArguments: ['--sandbox', 'workspace-write', '--ask-for-approval', 'never'], prerequisites: platform === 'linux' ? ['bubblewrap (bwrap)', 'socat'] : [], missing: [], reason: 'Codex can run locally with a worktree and workspace-write sandbox.' };
    case 'grok-cli':
      return { ...common, status: 'ready', hostArguments: ['--worktree', '--sandbox', 'strict', '--permission-mode', 'dontAsk'], prerequisites: platform === 'linux' ? ['bubblewrap (bwrap)', 'socat'] : [], missing: [], reason: 'Grok Build can run locally with a worktree and strict sandbox profile.' };
    case 'claude-cli':
      return { ...common, status: 'manual-host-setup', hostArguments: ['--worktree'], prerequisites: ['Claude Code sandbox enabled', ...(platform === 'linux' ? ['bubblewrap (bwrap)', 'socat'] : [])], missing: ['Verified Claude Code sandbox policy'], reason: 'Claude Code needs an enabled sandbox policy with unsandboxed fallback disabled before it qualifies.' };
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
  const { gitRepository, dedicatedWorktree } = existsSync(projectDirectory)
    ? gitWorktreeState(projectDirectory)
    : { gitRepository: false, dedicatedWorktree: false };
  return {
    contractVersion: LOCAL_ISOLATION_CONTRACT_VERSION,
    projectDirectory,
    platform,
    gitRepository,
    cloudExecution: 'prohibited',
    assessments: options.surfaceIds.map((surfaceId) => assessmentFor(surfaceId, platform, gitRepository, dedicatedWorktree)),
  };
}
