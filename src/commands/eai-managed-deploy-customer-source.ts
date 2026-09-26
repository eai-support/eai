import type { CliManagedGithubLinkSession } from "../lib/api.js";
import {
  assertManagedDeployStateMatchesOperation,
  buildManagedDeployConfigHash,
  classifyManagedOperationStatus,
  installCanonicalManagedDeployFiles,
  parseGitHubRepository,
  requireInstallationId,
  saveManagedDeployState,
  type ManagedDeployState,
} from "../lib/eai-managed-deploy.js";
import {
  apiMessage,
  fail,
  repositoryNextAction,
  requireApiSuccess,
  type ManagedDeployExecutionContext,
} from "./eai-managed-deploy-contract.js";
import {
  dispatchWorkflow,
  verifyGitHubAccess,
  verifyLocalSource,
} from "./eai-managed-deploy-github.js";
import {
  pollExactOperation,
  prepareRuntime,
  printOperation,
  readExactOperation,
} from "./eai-managed-deploy-operation.js";

export async function startCustomerSource(
  execution: ManagedDeployExecutionContext,
  link: CliManagedGithubLinkSession,
): Promise<void> {
  const {
    context,
    client,
    options,
    appKey,
    targetTenantId,
    workflowPath,
    timeoutSeconds,
    format,
    spinner,
  } = execution;
  if (!options.repo || !options.installationId) {
    fail(
      "REPOSITORY_AUTHORITY_REQUIRED",
      "--repo and --installation-id are required for a new EAI deployment.",
      "Connect the repository to the tenant, install the EAI GitHub App, then pass both exact values.",
    );
  }
  const repository = parseGitHubRepository(options.repo);
  const installationId = requireInstallationId(options.installationId);
  const install = await installCanonicalManagedDeployFiles(
    context.root,
    workflowPath,
  );
  if (install.changed.length > 0 || install.pendingUpdates.length > 0) {
    const installed =
      install.changed.length > 0
        ? `Installed: ${install.changed.join(", ")}.`
        : "";
    const pending =
      install.pendingUpdates.length > 0
        ? ` Review candidates: ${install.pendingUpdates.join(", ")}.`
        : "";
    fail(
      "CANONICAL_WORKFLOW_UPDATE_REQUIRED",
      `${installed}${pending}`.trim(),
      "Review each candidate without losing local edits. Apply it to the canonical path, remove the candidate, then commit and push through the repository branch rules before retrying.",
    );
  }
  const source = await verifyLocalSource(
    context.root,
    repository.slug,
    options.branch,
    options.commit,
  );
  const verifiedGithubUser = link.verifiedGithubUser;
  if (!verifiedGithubUser) {
    fail(
      "GITHUB_LINK_PROOF_INVALID",
      "The verified browser handoff did not include a GitHub actor.",
      "Start the deployment again and complete GitHub browser linking.",
    );
  }
  await verifyGitHubAccess(
    repository.slug,
    source.branch,
    source.commitSha,
    undefined,
    verifiedGithubUser,
  );
  const configHash = await buildManagedDeployConfigHash(context.root);
  const ref = `refs/heads/${source.branch}`;

  await requireApiSuccess(
    await client.registerSourceUnknownApp(context.tenantId, appKey, {
      repoOwner: repository.owner,
      repoName: repository.name,
      repoUrl: `https://github.com/${repository.slug}`,
      defaultBranch: source.branch,
      workflowPath,
      ref,
      commitSha: source.commitSha,
      configPath: "src/eai.config",
      runtimePath: "eai.runtime.json",
      sourceMode: "source-unknown",
      adoptionMode: "connect-existing",
      installationId,
      githubLinkSessionId: link.sessionId,
      targetTenantId,
    }),
    "REPOSITORY_REGISTRATION_FAILED",
    (payload, status) =>
      repositoryNextAction(
        status,
        apiMessage(payload, ""),
        context.tenantId,
        repository.slug,
      ),
  );

  const setup = await requireApiSuccess(
    await client.setupSourceUnknownWorkflow(context.tenantId, appKey, {
      environment: options.environment,
      workflowPath,
      ref,
      commitSha: source.commitSha,
      configHash,
      targetTenantId,
      deployOnSuccess: true,
      githubLinkSessionId: link.sessionId,
    }),
    "WORKFLOW_SETUP_FAILED",
    () =>
      "Confirm the app enrollment, repository authority, exact commit, and target tenant binding, then retry.",
  );
  const operationId =
    typeof setup.operationId === "string" ? setup.operationId : "";
  const nonce = typeof setup.nonce === "string" ? setup.nonce : "";
  if (!operationId || !nonce) {
    fail(
      "WORKFLOW_SETUP_INVALID",
      "PublicAPI did not return an operation ID and one-time nonce.",
      "Stop and inspect the PublicAPI/AdminAPI setup response.",
    );
  }
  const state: ManagedDeployState = {
    schema: "eai.managed-deploy-state.v1",
    tenantId: context.tenantId,
    targetTenantId,
    appKey,
    operationId,
    nonce,
    repo: repository.slug,
    branch: source.branch,
    ref,
    commitSha: source.commitSha,
    workflowPath,
    configHash,
    environment: options.environment,
    installationId,
    actorId: context.tokens.oid,
    githubLinkSessionId: link.sessionId,
    githubUserId: verifiedGithubUser.id,
    githubLogin: verifiedGithubUser.login,
    githubProofId: verifiedGithubUser.proofId,
    publicApiUrl: context.publicApiUrl,
  };
  await saveManagedDeployState(state);
  const issuedOperation = await readExactOperation(
    client,
    state.tenantId,
    state.targetTenantId,
    state.appKey,
    state.operationId,
  );
  try {
    assertManagedDeployStateMatchesOperation(state, issuedOperation);
  } catch (error) {
    fail(
      "WORKFLOW_SETUP_BINDING_MISMATCH",
      error instanceof Error ? error.message : String(error),
      "Do not dispatch this operation. Start a fresh deployment only after PublicAPI returns the exact actor, tenant, repository, commit, configuration and nonce binding.",
    );
  }
  await prepareRuntime(client, state);
  await dispatchWorkflow(state, context.publicApiUrl, context.root);

  const operation = await pollExactOperation(
    client,
    state,
    options.wait,
    timeoutSeconds,
  );
  spinner?.stop();
  printOperation(format, operation, {
    repo: state.repo,
    ref: state.ref,
    commitSha: state.commitSha,
    configHash: state.configHash,
  });
  if (classifyManagedOperationStatus(operation) === "failed")
    process.exitCode = 1;
}
