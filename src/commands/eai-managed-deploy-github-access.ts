import {
  parseGitHubRepository,
  requireBranch,
  requireCommitSha,
} from "../lib/eai-managed-deploy.js";
import {
  POLL_INTERVALS_MS,
  fail,
  run,
  type ManagedDeployCommandRunner,
  type VerifiedGitHubActor,
} from "./eai-managed-deploy-contract.js";

interface GitHubRepoView {
  viewerPermission?: string;
  isArchived?: boolean;
}

/** Authenticate first, then overlap the independent repository-policy and immutable-ref reads. */
export async function verifyGitHubAccess(
  repo: string,
  branch: string,
  expectedSha: string,
  runCommand: ManagedDeployCommandRunner = run,
  expectedActor?: VerifiedGitHubActor,
): Promise<void> {
  try {
    await runCommand("gh", ["auth", "status"]);
  } catch (error) {
    fail(
      "GITHUB_LOGIN_REQUIRED",
      String(error),
      "Run `gh auth login`, then retry the same deploy command.",
    );
  }

  const repository = parseGitHubRepository(repo);
  const repoViewPromise = runCommand("gh", [
    "repo",
    "view",
    repo,
    "--json",
    "viewerPermission,isArchived",
  ])
    .then((value) => JSON.parse(value) as GitHubRepoView)
    .catch((error: unknown) => {
      fail(
        "GITHUB_REPOSITORY_UNAVAILABLE",
        String(error),
        `Confirm the signed-in GitHub account can read ${repo}.`,
      );
    });
  const remoteShaPromise = runCommand("gh", [
    "api",
    `repos/${repository.owner}/${repository.name}/git/ref/heads/${encodeURIComponent(branch)}`,
  ])
    .then((value) => {
      const ref = JSON.parse(value) as { object?: { sha?: string } };
      return requireCommitSha(
        String(ref.object?.sha || ""),
        "Remote branch SHA",
      );
    })
    .catch((error: unknown) => {
      fail(
        "GITHUB_BRANCH_UNAVAILABLE",
        String(error),
        `Push branch ${branch} to ${repo}, then retry.`,
      );
    });
  const actorPromise = expectedActor
    ? runCommand("gh", ["api", "user", "--jq", "{id: .id, login: .login}"])
        .then((value) => JSON.parse(value) as { id?: unknown; login?: unknown })
        .catch((error: unknown) => {
          fail(
            "GITHUB_ACTOR_UNAVAILABLE",
            String(error),
            "Run `gh auth login`, then verify the same GitHub account linked in the EAI browser handoff.",
          );
        })
    : Promise.resolve(undefined);
  const [repoView, remoteSha, actor] = await Promise.all([
    repoViewPromise,
    remoteShaPromise,
    actorPromise,
  ]);

  if (repoView.isArchived) {
    fail(
      "GITHUB_REPOSITORY_ARCHIVED",
      `${repo} is archived.`,
      "Choose an active repository before deployment.",
    );
  }
  if (
    !["ADMIN", "MAINTAIN", "WRITE"].includes(
      String(repoView.viewerPermission || "").toUpperCase(),
    )
  ) {
    fail(
      "GITHUB_WRITE_REQUIRED",
      `The GitHub account does not have write access to ${repo}.`,
      "Ask a repository administrator for write access, then retry.",
    );
  }
  if (remoteSha !== expectedSha) {
    fail(
      "GITHUB_SHA_MISMATCH",
      `Local HEAD ${expectedSha} does not match ${repo}@${branch} (${remoteSha}).`,
      `Push the exact local commit to ${branch}, or check out the remote commit, then retry.`,
    );
  }
  if (
    expectedActor &&
    (actor?.id !== expectedActor.id ||
      String(actor?.login || "").toLowerCase() !==
        expectedActor.login.toLowerCase())
  ) {
    fail(
      "GITHUB_ACTOR_MISMATCH",
      `The local gh actor ${String(actor?.login || "<unknown>")} (${String(actor?.id || "<unknown>")}) does not match the browser-linked GitHub actor ${expectedActor.login} (${expectedActor.id}).`,
      `Run \`gh auth switch --user ${expectedActor.login}\`, confirm with \`gh api user\`, then retry the exact operation.`,
    );
  }
}

/** Bound early exact-operation checks while retaining the 10-second steady-state ceiling. */
export function managedDeployPollDelayMs(
  pendingReadsAtStatus: number,
  remainingMs: number,
): number {
  const intervalIndex = Math.min(
    Math.max(0, Math.floor(pendingReadsAtStatus) - 1),
    POLL_INTERVALS_MS.length - 1,
  );
  return Math.max(0, Math.min(POLL_INTERVALS_MS[intervalIndex], remainingMs));
}

export async function verifyLocalSource(
  root: string,
  repo: string,
  requestedBranch: string,
  requestedCommit?: string,
): Promise<{ branch: string; commitSha: string }> {
  let commitSha: string;
  let branch: string;
  let origin: string;
  try {
    [commitSha, branch, origin] = await Promise.all([
      run("git", ["rev-parse", "HEAD"], root),
      run("git", ["branch", "--show-current"], root),
      run("git", ["remote", "get-url", "origin"], root),
    ]);
  } catch (error) {
    fail(
      "GIT_REPOSITORY_REQUIRED",
      String(error),
      "Run the command from a Git repository with an origin remote.",
    );
  }
  commitSha = requireCommitSha(commitSha);
  branch = requireBranch(branch);
  const expectedBranch = requireBranch(requestedBranch);
  if (branch !== expectedBranch) {
    fail(
      "GIT_BRANCH_MISMATCH",
      `Checked-out branch ${branch} does not match requested branch ${expectedBranch}.`,
      `Check out ${expectedBranch}, then retry.`,
    );
  }
  if (requestedCommit && requireCommitSha(requestedCommit) !== commitSha) {
    fail(
      "GIT_SHA_MISMATCH",
      `Checked-out commit ${commitSha} does not match --commit ${requestedCommit}.`,
      "Check out the exact requested commit, then retry.",
    );
  }
  if (
    parseGitHubRepository(origin).slug.toLowerCase() !==
    parseGitHubRepository(repo).slug.toLowerCase()
  ) {
    fail(
      "GIT_REMOTE_MISMATCH",
      `Origin ${origin} does not match --repo ${repo}.`,
      "Use the repository bound to this project, or correct the origin remote.",
    );
  }
  const changes = await run(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    root,
  );
  if (changes) {
    fail(
      "GIT_WORKTREE_DIRTY",
      "The project has uncommitted files, so deployment cannot bind an immutable commit.",
      `Commit and push all intended files on ${branch}, then retry.`,
    );
  }
  return { branch, commitSha };
}
