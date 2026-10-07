/** Shared checks about where a task worktree and its Git store live. */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';

const text = value => typeof value === 'string' && value.trim().length > 0;
const gitEnvironment = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !key.startsWith('GIT_')));

export const insideDirectory = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

/** The shared Git store of a linked worktree, or null. A plain repository is
 * refused: its Git store lies inside the workspace, so it cannot be protected. */
export function sharedGitDirectory(workspaceRoot) {
  if (!text(workspaceRoot)) return null;
  const result = spawnSync('/usr/bin/git', ['-C', workspaceRoot, 'rev-parse', '--path-format=absolute',
    '--show-toplevel', '--git-dir', '--git-common-dir'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, env: gitEnvironment });
  if (result.status !== 0 || !result.stdout?.trim()) return null;
  const [topLevel, gitDirectory, commonDirectory] = result.stdout.trim().split('\n');
  if (!topLevel || !gitDirectory || !commonDirectory) return null;
  try {
    const workspace = realpathSync(workspaceRoot);
    const common = realpathSync(commonDirectory);
    if (realpathSync(topLevel) !== workspace || realpathSync(gitDirectory) === common ||
        insideDirectory(workspace, common)) return null;
    return common;
  } catch { return null; }
}
