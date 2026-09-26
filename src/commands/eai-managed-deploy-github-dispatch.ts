import {
  claimManagedDeployDispatch,
  readManagedDeployDispatchClaim,
  recordManagedDeployDispatch,
  requireManagedPublicApiUrl,
  saveManagedDeployState,
  type ManagedDeployState,
} from "../lib/eai-managed-deploy.js";
import {
  NEW_SOURCE_OPERATION_ACTION,
  fail,
  isRecord,
  run,
  type ManagedDeployCommandRunner,
} from "./eai-managed-deploy-contract.js";
import { verifyGitHubAccess } from "./eai-managed-deploy-github-access.js";

interface GitHubWorkflowRun {
  databaseId: number;
  displayTitle: string;
  createdAt: string;
  headSha: string;
  event: string;
}

function managedWorkflowRunName(state: ManagedDeployState): string {
  return `EAI deploy ${state.appKey} (${state.operationId})`;
}

async function findManagedWorkflowRun(
  state: ManagedDeployState,
  claimedAt: string,
  runCommand: ManagedDeployCommandRunner = run,
): Promise<GitHubWorkflowRun | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await runCommand("gh", [
        "run",
        "list",
        "--repo",
        state.repo,
        "--workflow",
        state.workflowPath,
        "--branch",
        state.branch,
        "--commit",
        state.commitSha,
        "--event",
        "workflow_dispatch",
        "--limit",
        "100",
        "--json",
        "databaseId,displayTitle,createdAt,headSha,event",
      ]),
    );
  } catch (error) {
    fail(
      "GITHUB_DISPATCH_RECONCILIATION_FAILED",
      String(error),
      `Inspect GitHub Actions for ${state.operationId}, then retry the exact operation.`,
    );
  }
  if (!Array.isArray(parsed)) {
    fail(
      "GITHUB_DISPATCH_RECONCILIATION_FAILED",
      "GitHub returned an invalid workflow-run list.",
      `Inspect GitHub Actions for ${state.operationId}, then retry the exact operation.`,
    );
  }
  const claimTime = Date.parse(claimedAt);
  return parsed.find(
    (candidate): candidate is GitHubWorkflowRun =>
      isRecord(candidate) &&
      Number.isSafeInteger(candidate.databaseId) &&
      Number(candidate.databaseId) > 0 &&
      candidate.displayTitle === managedWorkflowRunName(state) &&
      candidate.headSha === state.commitSha &&
      candidate.event === "workflow_dispatch" &&
      typeof candidate.createdAt === "string" &&
      Date.parse(candidate.createdAt) >= claimTime - 5_000,
  ) as GitHubWorkflowRun | undefined;
}

async function reconcileManagedWorkflowRun(
  state: ManagedDeployState,
  attempts = 1,
): Promise<GitHubWorkflowRun | undefined> {
  const claim = await readManagedDeployDispatchClaim(state);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const found = await findManagedWorkflowRun(state, claim.claimedAt);
    if (found) return found;
    if (attempt + 1 < attempts)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  return undefined;
}

export async function dispatchWorkflow(
  state: ManagedDeployState,
  publicApiUrl: string,
  root: string,
): Promise<void> {
  const trustedPublicApiUrl = requireManagedPublicApiUrl(publicApiUrl);
  if (state.publicApiUrl && state.publicApiUrl !== trustedPublicApiUrl) {
    fail(
      "RETRY_API_BINDING_MISMATCH",
      "Retry profile differs from the original workflow endpoint.",
      "Select the original EAI profile, then resume this exact operation.",
    );
  }
  if (!state.githubUserId || !state.githubLogin) {
    fail(
      "GITHUB_ACTOR_BINDING_MISSING",
      "Retry state does not contain the verified GitHub actor.",
      NEW_SOURCE_OPERATION_ACTION,
    );
  }
  await verifyGitHubAccess(
    state.repo,
    state.branch,
    state.commitSha,
    undefined,
    {
      id: state.githubUserId,
      login: state.githubLogin,
    },
  );
  // Persist the recovery boundary before the exclusive provider-mutation claim.
  // A crash before the claim is retryable; a claim without a visible run is
  // deliberately treated as uncertain so the one-time nonce is never replayed.
  state.dispatchStartedAt ||= new Date().toISOString();
  state.publicApiUrl = trustedPublicApiUrl;
  await saveManagedDeployState(state);
  const acquired = await claimManagedDeployDispatch(state);
  const existingClaim = await readManagedDeployDispatchClaim(state);
  if (state.dispatchedAt || existingClaim.status === "accepted") {
    if (!state.dispatchedAt) {
      state.dispatchedAt = existingClaim.updatedAt;
      state.githubRunId = existingClaim.githubRunId;
      await saveManagedDeployState(state);
    }
    return;
  }
  if (!acquired) {
    const recovered = await reconcileManagedWorkflowRun(state, 3);
    if (recovered) {
      await recordManagedDeployDispatch(
        state,
        "accepted",
        recovered.databaseId,
      );
      state.dispatchStartedAt ||= existingClaim.claimedAt;
      state.dispatchedAt = recovered.createdAt;
      state.githubRunId = recovered.databaseId;
      await saveManagedDeployState(state);
      return;
    }
    fail(
      "GITHUB_WORKFLOW_DISPATCH_UNCERTAIN",
      `The prior provider request for ${state.operationId} is still unconfirmed.`,
      `Inspect the exact GitHub Actions run named "${managedWorkflowRunName(state)}". Resume the operation if it exists; otherwise start a fresh source operation so the nonce is never replayed.`,
    );
  }
  // The exclusive claim already records `dispatching` before provider mutation.
  try {
    await run(
      "gh",
      [
        "workflow",
        "run",
        state.workflowPath,
        "--repo",
        state.repo,
        "--ref",
        state.branch,
        "-f",
        `app_key=${state.appKey}`,
        "-f",
        `tenant_id=${state.tenantId}`,
        "-f",
        `target_tenant_id=${state.targetTenantId}`,
        "-f",
        "source_mode=source-unknown",
        "-f",
        `operation_id=${state.operationId}`,
        "-f",
        `nonce=${state.nonce}`,
        "-f",
        `config_hash=${state.configHash}`,
        "-f",
        `commit_sha=${state.commitSha}`,
        "-f",
        `public_api_url=${trustedPublicApiUrl}`,
        "-f",
        `env=${state.environment}`,
      ],
      root,
    );
  } catch (error) {
    const recovered = await reconcileManagedWorkflowRun(state, 6);
    if (recovered) {
      await recordManagedDeployDispatch(
        state,
        "accepted",
        recovered.databaseId,
      );
      state.dispatchedAt = recovered.createdAt;
      state.githubRunId = recovered.databaseId;
      await saveManagedDeployState(state);
      return;
    }
    fail(
      "GITHUB_WORKFLOW_DISPATCH_FAILED",
      String(error),
      `Dispatch acceptance is uncertain. Retry ${state.operationId} to reconcile only the exact workflow run named "${managedWorkflowRunName(state)}"; the nonce will not be blindly replayed.`,
    );
  }
  await recordManagedDeployDispatch(state, "accepted");
  state.dispatchedAt = new Date().toISOString();
  await saveManagedDeployState(state);
}
